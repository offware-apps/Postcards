import type { Story } from "../../lib/schema/models";
import type { ReferenceData } from "../../lib/reference/types";
import { formatDate } from "../../lib/format/format";
import { placesOf, primaryPlace, dateSpan } from "./postcardModel";

/**
 * Escape free text for a shared Markdown document so it stays inert: angle
 * brackets and backticks are neutralized so imported titles/text can't smuggle
 * raw HTML or code spans, and square brackets are escaped so `[link](…)` /
 * `![img](…)` syntax can't form — a hostile imported story must not plant a
 * remote tracking pixel in a journal the user shares. Newlines are kept —
 * a story body is multi-line prose.
 */
function md(s: string): string {
  return s
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/`/g, "\\`")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .trim();
}

/**
 * Human-readable, non-authoritative Markdown feed of your journal, for sharing
 * with friends (date, place, title, text — no photos). Not re-importable;
 * contains no executable content.
 */
export function journalToMarkdown(stories: Story[], ref: ReferenceData): string {
  const lines: string[] = [];
  lines.push("# Travel journal");
  for (const s of stories) {
    const places = placesOf(s);
    const primary = primaryPlace(s);
    const span = dateSpan(s);
    lines.push("");
    // Image-only / text-only entries have no title — fall back to the primary place
    // name (same convention as the feed), or "Untitled" for a place-less postcard,
    // so the heading is never an empty "## ".
    lines.push(`## ${md(s.title.trim() || primary?.name || "Untitled")}`);
    lines.push("");
    // Meta: the day (or span) — then the place(s): "Name, Country" for a single
    // place, a comma list for several, nothing for a place-less postcard.
    const dateStr = span.end ? `${formatDate(span.start)} – ${formatDate(span.end)}` : formatDate(span.start);
    let meta = md(dateStr);
    if (places.length === 1 && primary) {
      const country = ref.countryByIso2(primary.countryId)?.name ?? primary.countryId;
      meta += ` — ${md(primary.name)}, ${md(country)}`;
    } else if (places.length > 1) {
      meta += ` — ${md(places.map((p) => p.name).join(", "))}`;
    }
    lines.push(`_${meta}_`);
    if (s.tags?.length) {
      lines.push("");
      lines.push(md(s.tags.map((t) => `#${t}`).join(" ")));
    }
    if (s.text) {
      lines.push("");
      lines.push(md(s.text));
    }
  }
  lines.push("");
  lines.push("_Exported from Postcards — local-first, private, offline._");
  return lines.join("\n");
}

export const JOURNAL_EXPORT_FILENAME = "journal.md";
