import { describe, it, expect } from "vitest";
import { slugify } from "../../src/lib/publish/site";

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
