import { describe, it, expect } from "vitest";
import { sanitizeText } from "../../src/lib/schema/sanitize";

describe("sanitizeText (inert data)", () => {
  it("keeps a leading - + = @ (formulas are neutralized by the CSV writer only)", () => {
    expect(sanitizeText("=SUM(A1)")).toBe("=SUM(A1)");
    expect(sanitizeText("- packed: boots\n- thermos")).toBe("- packed: boots\n- thermos");
    expect(sanitizeText("-20°C in Tromsø")).toBe("-20°C in Tromsø");
    expect(sanitizeText("@home")).toBe("@home");
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
