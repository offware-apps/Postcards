import { articleUrl, DEFAULT_LANG, type WikiProject } from "./urls";

/** One readable section of an article: a heading and its plain-text body. */
export interface WikiGuideSection {
  /** Section heading ("" for the article lead). */
  heading: string;
  /** Plain text; paragraphs separated by blank lines. */
  text: string;
}

/** A whole article as inert plain text, split into readable sections. */
export interface WikiFullText {
  title: string;
  url: string;
  attribution: string;
  sections: WikiGuideSection[];
}

// Housekeeping sections that carry no readable travel content in plain text.
const SKIP_HEADINGS = new Set([
  "references",
  "external links",
  "see also",
  "further reading",
  "notes",
  "sources",
  "bibliography",
  "gallery",
]);

/** Strip any stray markup so only inert plain text is ever shown. */
function toPlainText(s: string): string {
  return s.replace(/<[^>]*>/g, "").trim();
}

/**
 * Split MediaWiki `explaintext` output into top-level sections. Headings arrive
 * as "== Heading ==" lines; deeper levels ("=== x ===") stay inside their
 * parent section as short lead-in lines of their own.
 */
export function splitSections(text: string): WikiGuideSection[] {
  const sections: WikiGuideSection[] = [];
  let heading = "";
  let buf: string[] = [];
  const push = () => {
    const body = buf.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    if (body && !SKIP_HEADINGS.has(heading.toLowerCase())) sections.push({ heading, text: body });
    buf = [];
  };
  for (const line of text.split("\n")) {
    const top = /^==([^=].*?)==\s*$/.exec(line);
    if (top) {
      push();
      heading = top[1]!.trim();
      continue;
    }
    // Sub-headings become their own short paragraph line, kept readable.
    const sub = /^===+(.*?)===+\s*$/.exec(line);
    buf.push(sub ? `\n${sub[1]!.trim()}\n` : line);
  }
  push();
  return sections;
}

export interface FetchFullTextOpts {
  lang?: string;
  /** Which sister project to read from (default wikivoyage). */
  project?: WikiProject;
  signal?: AbortSignal;
  /** Injectable for tests; defaults to global fetch. */
  fetchFn?: typeof fetch;
}

/** MediaWiki Action API endpoint returning the WHOLE article as plain text. */
export function fullTextEndpoint(
  title: string,
  lang: string = DEFAULT_LANG,
  project: WikiProject = "wikivoyage",
): string {
  const params = new URLSearchParams({
    action: "query",
    prop: "extracts",
    explaintext: "1",
    redirects: "1",
    format: "json",
    formatversion: "2",
    origin: "*", // anonymous CORS — no cookies, no credentials
    titles: title.trim().replace(/\s+/g, " "),
  });
  return `https://${lang}.${project}.org/w/api.php?${params.toString()}`;
}

/**
 * ONLINE fetch of the FULL article text (MediaWiki TextExtracts, plain text
 * only). The REST summary is just the lead — often visibly cut off — and made
 * people leave for the website; this brings the whole readable guide into the
 * app instead. Same rules as fetchSummary: explicit user action, inert text
 * (markup stripped defensively), no cookies/referrer, null on any failure.
 */
export async function fetchFullText(
  title: string,
  opts: FetchFullTextOpts = {},
): Promise<WikiFullText | null> {
  const lang = opts.lang ?? DEFAULT_LANG;
  const project = opts.project ?? "wikivoyage";
  const doFetch = opts.fetchFn ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  try {
    const res = await doFetch(fullTextEndpoint(title, lang, project), {
      signal: opts.signal,
      headers: { Accept: "application/json" },
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      query?: { pages?: { title?: string; extract?: string; missing?: boolean }[] };
    };
    const page = j.query?.pages?.[0];
    if (!page || page.missing || typeof page.extract !== "string") return null;
    const sections = splitSections(toPlainText(page.extract));
    if (!sections.length) return null;
    const resolvedTitle = page.title ?? title;
    return {
      title: resolvedTitle,
      url: articleUrl(resolvedTitle, lang, undefined, project),
      attribution: `${project === "wikipedia" ? "Wikipedia" : "Wikivoyage"} · CC BY-SA 4.0`,
      sections,
    };
  } catch {
    return null;
  }
}
