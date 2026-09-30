// Where a publish/sync push GOES — kept behind a small seam so the app never
// hard-codes a vendor (Constitution: zero lock-in). The default deliverable is a
// portable bundle you can drop on ANY static host or `git push` yourself; the
// GitHub connector below is ONE optional implementation of the same seam, used by
// both Publish mode (push the site) and Device sync (push the data file).
//
// Every push is an explicit user action (Constitution: data leaves the device
// only when the user asks). No SDK — plain fetch against the GitHub REST API, so
// there's no proprietary dependency and it works from the PWA or the native wrap.

export interface PublishFile {
  /** Repo-relative path, e.g. "index.html" or "data/journal.json". */
  path: string;
  /** UTF-8 text content. */
  content: string;
}

export interface PublishTarget {
  /** Human label for the destination (shown in the UI). */
  readonly name: string;
  /** Create/update the given files in one logical push. Throws on failure. */
  putFiles(files: PublishFile[], message: string): Promise<void>;
}

export interface GitHubTargetConfig {
  owner: string;
  repo: string;
  /** Branch to commit to (e.g. "main" or "gh-pages"). */
  branch: string;
  /** A fine-grained PAT with contents:write on the repo. Held only in memory /
   *  on-device; never bundled into an export. */
  token: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchFn?: typeof fetch;
  /** Override the API base (GitHub Enterprise). Defaults to github.com. */
  apiBase?: string;
}

const encodeContent = (text: string): string => {
  // UTF-8 → base64 (btoa is latin1-only, so widen first).
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};

const decodeContent = (base64: string): string => {
  // base64 (GitHub wraps it with newlines) → UTF-8. The reverse of encodeContent.
  const bin = atob(base64.replace(/\s+/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
};

/**
 * Thrown when a conditional write is rejected because the remote advanced since
 * the caller last read it (a non-fast-forward). Device sync catches this to
 * re-pull, re-merge and retry, so the user never resolves a git text conflict by
 * hand (spec 013, FR-012). A distinct type keeps that "retry" branch unambiguous.
 */
export class GitPushConflictError extends Error {
  constructor(message = "The remote advanced since the last pull.") {
    super(message);
    this.name = "GitPushConflictError";
  }
}

/**
 * Push to a GitHub repo via the Contents API. Each file is upserted: we look up
 * its current blob SHA (needed to update), then PUT the new content. Sequential
 * on purpose — the Contents API is per-file and rate-limited, and a handful of
 * files (a small site or one data file) is the normal case.
 */
export class GitHubTarget implements PublishTarget {
  readonly name: string;
  private cfg: GitHubTargetConfig;
  private fetchFn: typeof fetch;
  private apiBase: string;

  constructor(cfg: GitHubTargetConfig) {
    if (!cfg.owner || !cfg.repo || !cfg.branch || !cfg.token) {
      throw new Error("GitHub target needs owner, repo, branch and a token.");
    }
    this.cfg = cfg;
    this.name = `github:${cfg.owner}/${cfg.repo}@${cfg.branch}`;
    this.fetchFn = cfg.fetchFn ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    this.apiBase = (cfg.apiBase ?? "https://api.github.com").replace(/\/$/, "");
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.cfg.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  private contentsUrl(path: string): string {
    const clean = path.replace(/^\/+/, "");
    const encoded = clean.split("/").map(encodeURIComponent).join("/");
    return `${this.apiBase}/repos/${this.cfg.owner}/${this.cfg.repo}/contents/${encoded}`;
  }

  /** Current blob SHA for a path on the target branch, or null if it doesn't exist. */
  private async currentSha(path: string): Promise<string | null> {
    const res = await this.fetchFn(
      `${this.contentsUrl(path)}?ref=${encodeURIComponent(this.cfg.branch)}`,
      { headers: this.headers(), referrerPolicy: "no-referrer" },
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      const detail = res.status === 401 || res.status === 403 ? " (check the token's scope)" : "";
      throw new Error(`GitHub read failed for ${path} (${res.status})${detail}.`);
    }
    const body = (await res.json()) as { sha?: string };
    return body.sha ?? null;
  }

  async putFiles(files: PublishFile[], message: string): Promise<void> {
    for (const file of files) {
      const sha = await this.currentSha(file.path);
      const res = await this.fetchFn(this.contentsUrl(file.path), {
        method: "PUT",
        referrerPolicy: "no-referrer",
        headers: { ...this.headers(), "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          content: encodeContent(file.content),
          branch: this.cfg.branch,
          ...(sha ? { sha } : {}),
        }),
      });
      if (!res.ok) {
        const detail = res.status === 401 || res.status === 403 ? " (check the token's scope)" : "";
        throw new Error(`GitHub write failed for ${file.path} (${res.status})${detail}.`);
      }
    }
  }

  /**
   * PULL for device sync: read a file's current text and its blob SHA (the SHA is
   * the version token a conditional write later checks). Returns null when the
   * file doesn't exist yet — a fresh/empty repo, which sync treats as "seed me".
   * The Contents API returns the content base64-encoded up to 1 MB; above that it
   * answers `encoding: "none"` with no content, and the text is read from the
   * git blob of that same SHA instead. `no-store`: GitHub marks these answers
   * cacheable for 60 s, and a pull must never see the file before our last push.
   */
  async getFile(path: string): Promise<{ content: string; version: string } | null> {
    const res = await this.fetchFn(
      `${this.contentsUrl(path)}?ref=${encodeURIComponent(this.cfg.branch)}`,
      { headers: this.headers(), referrerPolicy: "no-referrer", cache: "no-store" },
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      const detail = res.status === 401 || res.status === 403 ? " (check the token's scope)" : "";
      throw new Error(`GitHub read failed for ${path} (${res.status})${detail}.`);
    }
    const body = (await res.json()) as { content?: string; encoding?: string; sha?: string };
    if (!body.sha) return null;
    if (body.encoding === "base64" && body.content != null) {
      return { content: decodeContent(body.content), version: body.sha };
    }
    const blob = await this.fetchFn(
      `${this.apiBase}/repos/${this.cfg.owner}/${this.cfg.repo}/git/blobs/${body.sha}`,
      {
        headers: { ...this.headers(), Accept: "application/vnd.github.raw+json" },
        referrerPolicy: "no-referrer",
        cache: "no-store",
      },
    );
    if (!blob.ok) throw new Error(`GitHub read failed for ${path} (${blob.status}).`);
    return { content: await blob.text(), version: body.sha };
  }

  /**
   * Conditional PUSH for device sync: write `content`, asserting the remote is
   * still at `expectedVersion` (the blob SHA from the matching getFile; null to
   * create a new file). If the remote moved on, GitHub answers 409/422 and we
   * throw GitPushConflictError so sync re-pulls and re-merges (FR-012).
   */
  async putFileConditional(
    path: string,
    content: string,
    message: string,
    expectedVersion: string | null,
  ): Promise<void> {
    const res = await this.fetchFn(this.contentsUrl(path), {
      method: "PUT",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        content: encodeContent(content),
        branch: this.cfg.branch,
        ...(expectedVersion ? { sha: expectedVersion } : {}),
      }),
    });
    if (res.status === 409 || res.status === 422) {
      throw new GitPushConflictError(`GitHub rejected the write to ${path} (${res.status}).`);
    }
    if (!res.ok) {
      const detail = res.status === 401 || res.status === 403 ? " (check the token's scope)" : "";
      throw new Error(`GitHub write failed for ${path} (${res.status})${detail}.`);
    }
  }

  /** List a directory's entries on the target branch (name + type). Empty on a
   *  missing path or a non-directory. Used to build the root index of travels. */
  async listDir(path = ""): Promise<{ name: string; type: string }[]> {
    const url = path ? this.contentsUrl(path) : `${this.apiBase}/repos/${this.cfg.owner}/${this.cfg.repo}/contents`;
    const res = await this.fetchFn(`${url}?ref=${encodeURIComponent(this.cfg.branch)}`, {
      headers: this.headers(),
      referrerPolicy: "no-referrer",
    });
    if (!res.ok) return [];
    const body = await res.json();
    return Array.isArray(body) ? body.map((e: { name: string; type: string }) => ({ name: e.name, type: e.type })) : [];
  }

  /** The public GitHub Pages URL this repo serves at once Pages is enabled.
   *  A `<owner>.github.io` repo is served at the root; every other repo is a
   *  project site at `https://<owner>.github.io/<repo>/`. */
  pagesSiteUrl(): string {
    if (/^[^/]+\.github\.io$/i.test(this.cfg.repo)) return `https://${this.cfg.repo}/`;
    return `https://${this.cfg.owner}.github.io/${this.cfg.repo}/`;
  }

  /**
   * Best-effort: turn on GitHub Pages for the target branch (served from `/`), so
   * a published journey goes live without the user visiting the repo's Settings →
   * Pages. Returns the site URL when Pages is on (or was just enabled), or null
   * when this token can't manage Pages — a fine-grained PAT scoped only to
   * `contents:write` cannot, and that's fine: the caller falls back to the
   * in-export README's manual instructions. Never throws for the permission case.
   */
  async enablePages(): Promise<string | null> {
    const url = `${this.apiBase}/repos/${this.cfg.owner}/${this.cfg.repo}/pages`;
    // Already enabled? (GET needs only read access; 200 => on, 404 => off.)
    const cur = await this.fetchFn(url, { headers: this.headers(), referrerPolicy: "no-referrer" });
    if (cur.ok) return this.pagesSiteUrl();
    if (cur.status !== 404) return null; // 403/401: token can't manage Pages.
    // Not enabled yet — create it, sourced from our publish branch's root.
    const res = await this.fetchFn(url, {
      method: "POST",
      referrerPolicy: "no-referrer",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ source: { branch: this.cfg.branch, path: "/" } }),
    });
    // 201 created, or 409 if a concurrent enable won the race — both mean "on".
    if (res.ok || res.status === 409) return this.pagesSiteUrl();
    return null;
  }
}
