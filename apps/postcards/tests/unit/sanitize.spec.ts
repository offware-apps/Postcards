import { describe, it, expect } from "vitest";
import { sanitizeText } from "../../src/lib/schema/sanitize";

describe("sanitizeText (inert data)", () => {
  it("neutralizes leading formula characters", () => {
    expect(sanitizeText("=SUM(A1)")).toBe("SUM(A1)");
    expect(sanitizeText("+cmd")).toBe("cmd");
    expect(sanitizeText("@ref")).toBe("ref");
    expect(sanitizeText("-danger")).toBe("danger");
  });

  it("strips control characters but keeps normal text and newlines", () => {
    expect(sanitizeText("ab")).toBe("ab");
    expect(sanitizeText("line1\nline2")).toContain("line1");
    expect(sanitizeText("line1\nline2")).toContain("line2");
  });

  it("caps length", () => {
    expect(sanitizeText("x".repeat(50), 10)).toHaveLength(10);
  });

  it("leaves ordinary text unchanged", () => {
    expect(sanitizeText("Paris, France")).toBe("Paris, France");
  });

  it("keeps the zero-width joiners that emoji and scripts need", () => {
    const zwj = "\u200d", zwnj = "\u200c";
    const coder = `👩${zwj}💻`; // one emoji, not a woman and a laptop
    const persian = `می${zwnj}خواهم`; // the joiner is part of the spelling
    expect(sanitizeText(`with ${coder} and ${persian}`)).toBe(`with ${coder} and ${persian}`);
  });

  it("strips zero-width and bidi-override characters (Trojan Source)", () => {
    // zero-width space + right-to-left override embedded in text
    const evil = "ad‮min​ istrator";
    const out = sanitizeText(evil);
    expect(out).not.toContain("‮");
    expect(out).not.toContain("​");
  });
});
