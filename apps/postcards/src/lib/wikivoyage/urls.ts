// Pure Wikivoyage URL builders. No network, no side effects — safe offline, they
// just produce links the app opens in the browser.

export const DEFAULT_LANG = "en";

/** Wikimedia sister project a summary can come from. */
export type WikiProject = "wikivoyage" | "wikipedia";

function host(lang: string, project: WikiProject = "wikivoyage"): string {
  return `https://${lang}.${project}.org`;
}

/**
 * Encode a Wikivoyage article title into its URL path. MediaWiki maps spaces to
 * underscores, then percent-encodes; slashes in subpage titles stay literal.
 */
export function titleToPath(title: string): string {
  return encodeURIComponent(title.trim().replace(/\s+/g, "_")).replace(/%2F/g, "/");
}

/** URL of an article (optionally to a section anchor), on Wikivoyage unless
 *  another project is named (the Wikipedia fallback links to Wikipedia). */
export function articleUrl(
  title: string,
  lang: string = DEFAULT_LANG,
  section?: string,
  project: WikiProject = "wikivoyage",
): string {
  const base = `${host(lang, project)}/wiki/${titleToPath(title)}`;
  return section ? `${base}#${titleToPath(section)}` : base;
}

/** Wikivoyage phrasebook article title for a language, e.g. "French phrasebook". */
export function phrasebookTitle(languageName: string): string {
  return `${languageName} phrasebook`;
}

/** Full-text search URL — the graceful fallback when an exact title may not exist. */
export function searchUrl(query: string, lang: string = DEFAULT_LANG): string {
  return `${host(lang)}/w/index.php?search=${encodeURIComponent(query)}`;
}

/** REST summary endpoint for a title (used by the opt-in online fetch). */
export function summaryEndpoint(
  title: string,
  lang: string = DEFAULT_LANG,
  project: WikiProject = "wikivoyage",
): string {
  return `https://${lang}.${project}.org/api/rest_v1/page/summary/${titleToPath(title)}`;
}
