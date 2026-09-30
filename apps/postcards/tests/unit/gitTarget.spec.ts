import { describe, it, expect, vi } from "vitest";
import { GitHubTarget } from "../../src/lib/publish/gitTarget";

function mockFetch(handlers: (url: string, init?: RequestInit) => Response) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handlers(String(input), init)),
  ) as unknown as typeof fetch;
}

const cfg = { owner: "davd-gzl", repo: "postcards", branch: "gh-pages", token: "tok" };

describe("GitHubTarget", () => {
  it("creates a new file (no prior SHA) with base64 content on the branch", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchFn = mockFetch((url, init) => {
      calls.push({ url, init });
      if (init?.method === "PUT") return new Response("{}", { status: 201 });
      return new Response("Not Found", { status: 404 }); // no existing file
    });
    const t = new GitHubTarget({ ...cfg, fetchFn });
    await t.putFiles([{ path: "index.html", content: "<h1>Hi ☕</h1>" }], "publish");

    const put = calls.find((c) => c.init?.method === "PUT")!;
    const body = JSON.parse(String(put.init!.body));
    expect(body.branch).toBe("gh-pages");
    expect(body.sha).toBeUndefined(); // new file → no sha
    // base64 round-trips back to the UTF-8 source
    expect(Buffer.from(body.content, "base64").toString("utf-8")).toBe("<h1>Hi ☕</h1>");
    expect(put.url).toContain("/repos/davd-gzl/postcards/contents/index.html");
  });

  it("updates an existing file by passing its current SHA", async () => {
    let putBody: Record<string, unknown> | null = null;
    const fetchFn = mockFetch((_url, init) => {
      if (init?.method === "PUT") {
        putBody = JSON.parse(String(init.body));
        return new Response("{}", { status: 200 });
      }
      return new Response(JSON.stringify({ sha: "abc123" }), { status: 200 });
    });
    await new GitHubTarget({ ...cfg, fetchFn }).putFiles(
      [{ path: "data/journal.json", content: "{}" }],
      "sync",
    );
    expect(putBody!.sha).toBe("abc123");
  });

  it("throws a helpful error on an auth failure", async () => {
    const fetchFn = mockFetch(() => new Response("Bad creds", { status: 401 }));
    const t = new GitHubTarget({ ...cfg, fetchFn });
    await expect(t.putFiles([{ path: "x", content: "y" }], "m")).rejects.toThrow(/token's scope/);
  });

  it("requires owner, repo, branch and token", () => {
    expect(() => new GitHubTarget({ owner: "", repo: "r", branch: "b", token: "t" })).toThrow();
    expect(() => new GitHubTarget({ owner: "o", repo: "r", branch: "b", token: "" })).toThrow();
  });

  describe("GitHub Pages", () => {
    it("builds the project-site URL and the user-site URL", () => {
      expect(new GitHubTarget({ ...cfg, fetchFn: mockFetch(() => new Response("")) }).pagesSiteUrl()).toBe(
        "https://davd-gzl.github.io/postcards/",
      );
      expect(
        new GitHubTarget({
          ...cfg,
          repo: "davd-gzl.github.io",
          fetchFn: mockFetch(() => new Response("")),
        }).pagesSiteUrl(),
      ).toBe("https://davd-gzl.github.io/");
    });

    it("returns the site URL without creating when Pages is already on", async () => {
      let posted = false;
      const fetchFn = mockFetch((_url, init) => {
        if (init?.method === "POST") {
          posted = true;
          return new Response("{}", { status: 201 });
        }
        return new Response(JSON.stringify({ html_url: "x" }), { status: 200 }); // already enabled
      });
      const url = await new GitHubTarget({ ...cfg, fetchFn }).enablePages();
      expect(url).toBe("https://davd-gzl.github.io/postcards/");
      expect(posted).toBe(false);
    });

    it("creates Pages (sourced from the publish branch root) when it is off", async () => {
      let body: Record<string, unknown> | null = null;
      const fetchFn = mockFetch((url, init) => {
        if (init?.method === "POST") {
          body = JSON.parse(String(init.body));
          return new Response("{}", { status: 201 });
        }
        expect(url).toContain("/repos/davd-gzl/postcards/pages");
        return new Response("Not Found", { status: 404 }); // not enabled yet
      });
      const url = await new GitHubTarget({ ...cfg, fetchFn }).enablePages();
      expect(url).toBe("https://davd-gzl.github.io/postcards/");
      expect(body).toEqual({ source: { branch: "gh-pages", path: "/" } });
    });

    it("returns null (no throw) when the token cannot manage Pages", async () => {
      const fetchFn = mockFetch(() => new Response("Forbidden", { status: 403 }));
      const url = await new GitHubTarget({ ...cfg, fetchFn }).enablePages();
      expect(url).toBeNull();
    });
  });

  describe("getFile (device sync pull)", () => {
    it("reads a file over 1 MB, which the Contents API returns without content", async () => {
      const text = JSON.stringify({ note: "café ☕", pad: "x".repeat(1_100_000) });
      const calls: { url: string; init?: RequestInit }[] = [];
      const fetchFn = mockFetch((url, init) => {
        calls.push({ url, init });
        if (url.includes("/git/blobs/abc123")) return new Response(text, { status: 200 });
        // The shape GitHub answers for a file between 1 and 100 MB.
        return new Response(JSON.stringify({ sha: "abc123", content: "", encoding: "none" }), {
          status: 200,
        });
      });
      const file = await new GitHubTarget({ ...cfg, fetchFn }).getFile("postcards-sync.json");
      expect(file).toEqual({ content: text, version: "abc123" });
      expect(calls.map((c) => c.init?.cache)).toEqual(["no-store", "no-store"]);
    });

    it("never reads a cached copy of a small file", async () => {
      const calls: RequestInit[] = [];
      const fetchFn = mockFetch((_url, init) => {
        calls.push(init!);
        const content = Buffer.from("{}").toString("base64");
        return new Response(JSON.stringify({ sha: "s1", content, encoding: "base64" }), {
          status: 200,
        });
      });
      const file = await new GitHubTarget({ ...cfg, fetchFn }).getFile("postcards-sync.json");
      expect(file).toEqual({ content: "{}", version: "s1" });
      expect(calls[0]!.cache).toBe("no-store");
    });
  });

  describe("listDir (root index of travels)", () => {
    it("returns dir/file entries of the repo root, empty on failure", async () => {
      const ok = mockFetch((url) => {
        expect(url).toContain("/repos/davd-gzl/postcards/contents");
        return new Response(
          JSON.stringify([
            { name: "japan-2024", type: "dir" },
            { name: "index.html", type: "file" },
          ]),
          { status: 200 },
        );
      });
      const entries = await new GitHubTarget({ ...cfg, fetchFn: ok }).listDir("");
      expect(entries).toEqual([
        { name: "japan-2024", type: "dir" },
        { name: "index.html", type: "file" },
      ]);
      const bad = mockFetch(() => new Response("Not Found", { status: 404 }));
      expect(await new GitHubTarget({ ...cfg, fetchFn: bad }).listDir("")).toEqual([]);
    });
  });
});
