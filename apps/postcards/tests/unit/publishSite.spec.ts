import { describe, it, expect, beforeEach } from "vitest";
import { isSyncRepo, lockedSlug, publishTravel, slugify } from "../../src/lib/publish/site";
import { GitHubTarget } from "../../src/lib/publish/gitTarget";

describe("slugify (one folder per published travel)", () => {
  it("keeps Latin names readable and drops their diacritics", () => {
    expect(slugify("Japan 2024")).toBe("japan-2024");
    expect(slugify("  Côte d'Azur!  ")).toBe("cote-d-azur");
  });

  it("gives non-Latin names their own folder instead of the shared fallback", () => {
    expect(slugify("東京 2024")).toBe("東京-2024");
    expect(slugify("Москва")).toBe("москва");
    expect(slugify("서울 여행")).toBe("서울-여행");
    expect(slugify("ガイド")).toBe("ガイド"); // voiced kana stay whole
    expect(new Set([slugify("東京"), slugify("Москва"), slugify("서울")]).size).toBe(3);
  });

  it("falls back to 'journey' only when nothing nameable is left", () => {
    expect(slugify("!!!")).toBe("journey");
    expect(slugify("x".repeat(80))).toHaveLength(60);
  });
});

/** A fake GitHub repo behind the Contents API: files by path, folders implied. */
function fakeRepo(files: Record<string, string>) {
  const puts: { path: string; message: string }[] = [];
  let n = 0;
  const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const method = init?.method ?? "GET";
    if (u.pathname.endsWith("/pages")) return new Response("{}", { status: method === "GET" ? 404 : 201 });
    const path = decodeURIComponent(u.pathname.replace(/^\/repos\/me\/site\/contents\/?/, ""));
    if (method === "PUT") {
      const body = JSON.parse(String(init!.body)) as { message: string; content: string };
      puts.push({ path, message: body.message });
      files[path] = new TextDecoder().decode(Uint8Array.from(atob(body.content), (c) => c.charCodeAt(0)));
      return new Response("{}", { status: 200 });
    }
    if (path === "") {
      const names = new Map<string, string>();
      for (const p of Object.keys(files)) names.set(p.split("/")[0]!, p.includes("/") ? "dir" : "file");
      return new Response(JSON.stringify([...names].map(([name, type]) => ({ name, type }))), { status: 200 });
    }
    const hit = files[path];
    if (hit == null) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify({ sha: `sha${++n}`, encoding: "base64", content: b64(hit) }), { status: 200 });
  }) as unknown as typeof fetch;
  const target = new GitHubTarget({ owner: "me", repo: "site", branch: "main", token: "t", fetchFn });
  return { target, files, puts };
}

describe("publishTravel (GitHub site layout)", () => {
  beforeEach(() => localStorage.clear());

  it("never names a passphrase-locked travel in its folder, commit or the root index", async () => {
    const repo = fakeRepo({});
    const slug = lockedSlug("me/site", "Japan with Alice");
    await publishTravel(repo.target, { html: "<html>env</html>", name: "Japan with Alice", slug, locked: true, siteTitle: "site" });
    expect(slug).toMatch(/^locked-[0-9a-f]{12}$/);
    const leaks = repo.puts.filter((p) => /japan|alice/i.test(p.path + p.message + (repo.files[p.path] ?? "")));
    expect(leaks.filter((p) => p.path !== `${slug}/index.html`)).toEqual([]);
    expect(repo.files["index.html"] ?? "").not.toContain(slug);
    // Re-publishing the same journey updates its folder rather than adding one.
    expect(lockedSlug("me/site", "Japan with Alice")).toBe(slug);
    expect(lockedSlug("me/site", "Korea")).not.toBe(slug);
  });

  it("leaves a root index.html it did not write alone", async () => {
    const repo = fakeRepo({ "index.html": "<h1>My homepage</h1>", "blog/post.html": "x" });
    await publishTravel(repo.target, { html: "<html/>", name: "Japan", slug: "japan", locked: false, siteTitle: "site" });
    expect(repo.files["index.html"]).toBe("<h1>My homepage</h1>");
    expect(repo.puts.map((p) => p.path)).toEqual(["japan/index.html", "japan/README.md"]);
  });

  it("lists only the travel folders Postcards published", async () => {
    const repo = fakeRepo({ "assets/app.css": "x", "blog/post.html": "x" });
    await publishTravel(repo.target, { html: "<html/>", name: "Japan", slug: "japan", locked: false, siteTitle: "site" });
    await publishTravel(repo.target, { html: "<html/>", name: "Korea", slug: "korea", locked: false, siteTitle: "site" });
    const index = repo.files["index.html"]!;
    expect(index).toContain('href="./japan/"');
    expect(index).toContain('href="./korea/"');
    expect(index).not.toContain("assets");
    expect(index).not.toContain("blog");
  });
});

describe("isSyncRepo", () => {
  beforeEach(() => localStorage.clear());

  it("recognises the device-sync repo, whose data file publishing would expose", () => {
    localStorage.setItem("postcards-sync-owner", "Me");
    localStorage.setItem("postcards-sync-repo", "Data");
    expect(isSyncRepo("me", "data")).toBe(true);
    expect(isSyncRepo("me", "site")).toBe(false);
    localStorage.clear();
    expect(isSyncRepo("me", "data")).toBe(false);
  });
});
