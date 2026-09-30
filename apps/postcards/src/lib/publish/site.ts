// Where a published travel lives on a static host: one folder per travel, so
// journeys published to the same repository coexist instead of overwriting each
// other. Pure, no I/O.

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
