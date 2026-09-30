// Where a published travel lives on a static host: one folder per travel, so
// journeys published to the same repository coexist instead of overwriting each
// other, plus a root index listing them.

import type { GitHubTarget } from "./gitTarget";
import { HOSTING_README } from "./hosting";
import { readRemoteConfig } from "../sync/syncConfig";

/** Marks a root index.html that Postcards wrote, so it may rewrite it. */
const ROOT_MARKER = "<!-- postcards:travels-index -->";
/** The footer of root indexes written before the marker existed. */
const LEGACY_ROOT_FOOTER = "Published with Postcards — a private, local-first travel journal.";
/** The first line of the README Postcards ships in every travel folder. */
const TRAVEL_README_HEAD = HOSTING_README.split("\n", 1)[0]!;
/** Folder names of passphrase-locked travels: random, so they name nothing. */
const LOCKED_SLUG = /^locked-[0-9a-f]{12}$/;
const LOCKED_KEY = "postcards-publish-locked-slugs";

/** A URL-safe subdirectory name for one travel, e.g. "Japan 2024" → "japan-2024",
 *  "東京 2024" → "東京-2024". Letters and digits of every script are kept (Latin
 *  diacritics dropped), so a Korean, Japanese or Cyrillic name gets its own folder
 *  rather than the shared fallback "journey" overwriting an earlier publish. */
export function slugify(name: string): string {
  const s = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip Latin combining diacritics
    .normalize("NFC") // recompose Hangul syllables and kana voicing marks
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return [...s].slice(0, 60).join("").replace(/-+$/, "") || "journey";
}

/** The folder of a passphrase-locked travel: random, so its public URL says
 *  nothing about the journey, and remembered on this device per repo and travel
 *  name so a re-publish updates the same folder instead of adding another. */
export function lockedSlug(repo: string, name: string): string {
  const key = `${repo}\n${name}`;
  let saved: Record<string, string> = {};
  try {
    saved = JSON.parse(localStorage.getItem(LOCKED_KEY) || "{}") as Record<string, string>;
  } catch {
    /* private mode or a damaged entry: start afresh */
  }
  const known = saved[key];
  if (known && LOCKED_SLUG.test(known)) return known;
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(6));
  const slug = `locked-${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
  try {
    localStorage.setItem(LOCKED_KEY, JSON.stringify({ ...saved, [key]: slug }));
  } catch {
    /* not remembered: the next publish gets a new folder */
  }
  return slug;
}

/** Whether owner/repo is the device-sync repository (case-insensitive, as GitHub is). */
export function isSyncRepo(owner: string, repo: string): boolean {
  const sync = readRemoteConfig();
  return (
    !!sync.owner &&
    !!sync.repo &&
    sync.owner.toLowerCase() === owner.toLowerCase() &&
    sync.repo.toLowerCase() === repo.toLowerCase()
  );
}

/** A minimal, inert root landing page listing every published travel folder, so
 *  the repo root isn't a 404 and visitors can browse between journeys. */
function buildRootIndex(siteTitle: string, folders: string[]): string {
  const esc = (x: string) =>
    x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const items = folders
    .map((f) => `<li><a href="./${esc(f)}/">${esc(f.replace(/-/g, " "))}</a></li>`)
    .join("\n      ");
  return `<!doctype html>
${ROOT_MARKER}
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(siteTitle)}</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:42rem;margin:3rem auto;padding:0 1rem}
h1{font-size:1.4rem}ul{list-style:none;padding:0}li{margin:.4rem 0}
a{display:inline-block;padding:.5rem .8rem;border:1px solid #ccc;border-radius:.5rem;text-decoration:none;color:inherit}
@media(prefers-color-scheme:dark){body{background:#111;color:#eee}a{border-color:#444}}</style>
</head><body>
<h1>${esc(siteTitle)}</h1>
<ul>
      ${items}
</ul>
<p style="opacity:.6;font-size:.85rem">Published with Postcards — a private, local-first travel journal.</p>
</body></html>
`;
}

/**
 * Push one travel into its folder, then refresh the root index (best-effort).
 * A locked travel's commit message and the index never carry its name. The root
 * index.html is rewritten only when Postcards wrote it (a user's own homepage is
 * left alone), and lists only folders holding a Postcards travel README, never
 * the repo's other directories or a locked travel.
 */
export async function publishTravel(
  target: GitHubTarget,
  opts: { html: string; name: string; slug: string; locked: boolean; siteTitle: string },
): Promise<void> {
  await target.putFiles(
    [
      { path: `${opts.slug}/index.html`, content: opts.html },
      // Ship the host-facing README beside each travel (FR-015).
      { path: `${opts.slug}/README.md`, content: HOSTING_README },
    ],
    opts.locked ? "Publish a travel via Postcards" : `Publish "${opts.name}" via Postcards`,
  );
  try {
    const current = await target.getFile("index.html");
    if (current && !current.content.includes(ROOT_MARKER) && !current.content.includes(LEGACY_ROOT_FOOTER)) return;
    const folders: string[] = [];
    for (const e of await target.listDir("")) {
      if (e.type !== "dir" || e.name.startsWith(".") || LOCKED_SLUG.test(e.name)) continue;
      const readme = await target.getFile(`${e.name}/README.md`);
      if (readme?.content.startsWith(TRAVEL_README_HEAD)) folders.push(e.name);
    }
    if (!opts.locked && !folders.includes(opts.slug)) folders.push(opts.slug);
    if (!current && folders.length === 0) return;
    folders.sort((a, b) => a.localeCompare(b));
    await target.putFiles(
      [{ path: "index.html", content: buildRootIndex(opts.siteTitle, folders) }],
      "Update travels index via Postcards",
    );
  } catch {
    /* listing/root-index is a nicety; the travel itself already published */
  }
}
