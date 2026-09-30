import type { WikivoyageSummary } from "./types";
import { articleUrl, summaryEndpoint, DEFAULT_LANG } from "./urls";

/** Strip any stray HTML/markup so only inert plain text is ever shown. */
function toPlainText(s: string): string {
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface FetchSummaryOpts {
  lang?: string;
  /** Which sister project to read from (default wikivoyage). */
  project?: "wikivoyage" | "wikipedia";
  signal?: AbortSignal;
  /** Injectable for tests; defaults to global fetch. */
  fetchFn?: typeof fetch;
}

/**
 * ONLINE fetch of a Wikivoyage/Wikipedia article summary (MediaWiki REST API).
 *
 * Called when you open a place and guide auto-load is on (the default; a Settings
 * switch makes it manual instead). Degrades gracefully: returns null on offline /
 * blocked / missing-article / any error — the caller then just shows the plain
 * links. Inert: reads only the plain-text `extract`, never HTML, and strips markup
 * defensively. No cookies, no telemetry, no referrer; attribution is returned for
 * display (text is CC BY-SA 4.0).
 */
export async function fetchSummary(
  title: string,
  opts: FetchSummaryOpts = {},
): Promise<WikivoyageSummary | null> {
  const lang = opts.lang ?? DEFAULT_LANG;
  const project = opts.project ?? "wikivoyage";
  const doFetch = opts.fetchFn ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  try {
    const res = await doFetch(summaryEndpoint(title, lang, project), {
      signal: opts.signal,
      headers: { Accept: "application/json" },
      credentials: "omit",
      // Leak nothing to Wikivoyage — this request doesn't need a Referer (only the
      // OSM tile server does). The site-wide policy stays untouched for tiles.
      referrerPolicy: "no-referrer",
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      title?: string;
      extract?: string;
      type?: string;
      content_urls?: { desktop?: { page?: string } };
      thumbnail?: { source?: string };
      originalimage?: { source?: string };
    };
    // Disambiguation / missing pages carry no useful overview.
    if (j.type && j.type !== "standard") return null;
    const extract = typeof j.extract === "string" ? toPlainText(j.extract) : "";
    if (!extract) return null;
    // The page's lead image (Wikimedia-hosted): shown only after the user's
    // explicit "load overview" action, same as the text.
    const rawThumb = j.thumbnail?.source;
    const thumb =
      typeof rawThumb === "string" && /^https:\/\/upload\.wikimedia\.org\//.test(rawThumb)
        ? rawThumb
        : undefined;
    return {
      title: j.title ?? title,
      extract,
      url: j.content_urls?.desktop?.page ?? articleUrl(title, lang, undefined, project),
      attribution: `${project === "wikipedia" ? "Wikipedia" : "Wikivoyage"} · CC BY-SA 4.0`,
      ...(thumb ? { thumb } : {}),
    };
  } catch {
    return null;
  }
}
