// Inert-data helpers (Constitution VI: data is parsed, never executed).
// These neutralize content that could be dangerous when a data file is later
// opened in another tool (e.g. a spreadsheet) or rendered.

/** Characters that trigger formula evaluation in spreadsheet software. */
const FORMULA_PREFIXES = new Set(["=", "+", "-", "@"]);

/**
 * Remove characters that are invisible or can spoof text direction:
 * - C0 AND C1 control characters (0x00–0x1F, 0x7F, 0x80–0x9F; except tab 9 / LF 10),
 * - zero-width characters (U+200B space, U+2060 word joiner, U+FEFF), but not
 *   the joiners U+200C/U+200D, which emoji sequences and Persian or Indic
 *   spelling need,
 * - directional marks (U+200E LRM, U+200F RLM, U+061C ALM),
 * - Unicode bidirectional overrides/isolates (U+202A–202E, U+2066–2069)
 *   — the "Trojan Source" class of visual-spoofing attacks.
 * All sinks are JSX/textContent (inert), so this is export-fidelity / anti-spoof
 * hardening, not an in-app injection fix.
 */
function stripControlChars(input: string): string {
  let out = "";
  for (const ch of input) {
    const code = ch.codePointAt(0)!;
    const isC0C1 =
      (code >= 0 && code <= 31 && code !== 9 && code !== 10) ||
      code === 127 ||
      (code >= 0x80 && code <= 0x9f);
    const isZeroWidth = code === 0x200b || code === 0x2060 || code === 0xfeff;
    const isDirMark = code === 0x200e || code === 0x200f || code === 0x061c; // LRM / RLM / ALM
    const isBidi = (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
    if (!isC0C1 && !isZeroWidth && !isDirMark && !isBidi) out += ch;
  }
  return out;
}

/**
 * Sanitize a free-text string from (potentially untrusted) data:
 * - normalize newlines and remove control characters,
 * - neutralize leading formula/command characters,
 * - collapse to a bounded length.
 * Returns plain, inert text. Never evaluates anything.
 */
export function sanitizeText(input: string, maxLength = 2000): string {
  let out = stripControlChars(input.replace(/\r\n?/g, "\n")).trim();
  while (out.length > 0 && (FORMULA_PREFIXES.has(out[0]!) || out[0] === "\t")) {
    out = out.slice(1).trimStart();
  }
  if (out.length > maxLength) out = out.slice(0, maxLength);
  return out;
}
