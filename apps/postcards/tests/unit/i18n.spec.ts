import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { en } from "../../src/lib/i18n/en";
import { fr } from "../../src/lib/i18n/fr";
import { ko } from "../../src/lib/i18n/ko";
import { translate, detectLocale, isLocale, LOCALES } from "../../src/lib/i18n/core";
import { useT } from "../../src/lib/i18n";
import { useSettings } from "../../src/lib/store/useSettings";
import { countPhrases } from "../../src/features/backup/restore";

describe("translate: interpolation", () => {
  it("fills a named {param}", () => {
    expect(translate("en", "nav.sectionStatus", { section: "Map" })).toBe("Map section");
  });
  it("accepts numbers and stringifies them", () => {
    expect(translate("en", "places.tab.visited", { count: 3 })).toBe("Visited (3)");
  });
  it("leaves an unfilled placeholder verbatim (never throws)", () => {
    expect(translate("en", "nav.sectionStatus")).toBe("{section} section");
  });
  it("translates into the active locale", () => {
    expect(translate("fr", "nav.map")).toBe("Carte");
    expect(translate("ko", "nav.map")).toBe("지도");
  });
});

describe("translate: safe fallback chain", () => {
  it("returns the English text when a locale is unknown", () => {
    // An unrecognised locale has no catalog → falls back to English.
    expect(translate("de" as never, "nav.map")).toBe("Map");
  });
  it("returns the key itself when the key does not exist anywhere", () => {
    expect(translate("fr", "totally.missing.key")).toBe("totally.missing.key");
    expect(translate("en", "totally.missing.key", { a: 1 })).toBe("totally.missing.key");
  });
});

describe("catalog key parity", () => {
  const enKeys = Object.keys(en).sort();
  it("fr has exactly the same keys as en (no missing, no extra)", () => {
    expect(Object.keys(fr).sort()).toEqual(enKeys);
  });
  it("ko has exactly the same keys as en (no missing, no extra)", () => {
    expect(Object.keys(ko).sort()).toEqual(enKeys);
  });
  it("every fr and ko value is a non-empty string", () => {
    for (const k of enKeys) {
      expect((fr as Record<string, string>)[k]?.length ?? 0).toBeGreaterThan(0);
      expect((ko as Record<string, string>)[k]?.length ?? 0).toBeGreaterThan(0);
    }
  });
  it("keeps every {param} placeholder across all three catalogs", () => {
    const slots = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort();
    for (const k of enKeys) {
      const want = slots(en[k as keyof typeof en]);
      expect(slots((fr as Record<string, string>)[k]!)).toEqual(want);
      expect(slots((ko as Record<string, string>)[k]!)).toEqual(want);
    }
  });
});

describe("locale detection helpers", () => {
  it("recognises the shipped locales", () => {
    expect(LOCALES).toEqual(["en", "fr", "ko"]);
    expect(isLocale("fr")).toBe(true);
    expect(isLocale("de")).toBe(false);
  });
  it("always returns a valid locale from the environment", () => {
    expect(isLocale(detectLocale())).toBe(true);
  });
});

describe("useT() plural helper", () => {
  it("picks singular/plural in English and French, and never inflects in Korean", () => {
    const { result } = renderHook(() => useT());

    act(() => useSettings.getState().setLocale("en"));
    expect(result.current.plural("noun.place", 1)).toBe("place");
    expect(result.current.plural("noun.place", 2)).toBe("places");

    act(() => useSettings.getState().setLocale("fr"));
    expect(result.current.plural("noun.place", 1)).toBe("lieu");
    expect(result.current.plural("noun.place", 2)).toBe("lieux");
    // French takes the singular for zero too ("0 lieu"), unlike English.
    expect(result.current.plural("noun.place", 0)).toBe("lieu");

    act(() => useSettings.getState().setLocale("ko"));
    expect(result.current.plural("noun.place", 1)).toBe("장소");
    expect(result.current.plural("noun.place", 2)).toBe("장소");
  });

  it("counts places, trips and stories in the restore and move messages", () => {
    const { result } = renderHook(() => useT());
    const one = { places: 1, trips: 0, stories: 2 };

    act(() => useSettings.getState().setLocale("en"));
    const t = () => result.current;
    expect(t()("moved.received", countPhrases(t(), one))).toBe(
      "Moved 1 place, 0 trips and 2 stories from the old address.",
    );
    expect(t()("backup.msg.restored", countPhrases(t(), one))).toBe(
      "Restored 1 place, 0 trips and 2 stories.",
    );
    expect(t().plural("backup.msg.merged", 1, { updated: 0, skip: "" })).toMatch(/^Added 1 place, /);

    act(() => useSettings.getState().setLocale("fr"));
    expect(t()("moved.received", countPhrases(t(), one))).toBe(
      "1 lieu, 0 voyage et 2 récits transférés depuis l'ancienne adresse.",
    );
    expect(t().plural("backup.msg.merged", 1, { updated: 0, skip: "" })).toMatch(/^1 lieu ajouté, /);

    act(() => useSettings.getState().setLocale("ko"));
    expect(t()("moved.received", countPhrases(t(), one))).toBe(
      "이전 주소에서 장소 1곳, 여행 0개, 이야기 2개를 옮겼습니다.",
    );
    act(() => useSettings.getState().setLocale("en"));
  });
});

describe("switching language", () => {
  it("updates the store and reflects the locale on <html lang> (a11y)", () => {
    act(() => useSettings.getState().setLocale("fr"));
    expect(useSettings.getState().locale).toBe("fr");
    expect(document.documentElement.lang).toBe("fr");

    act(() => useSettings.getState().setLocale("ko"));
    expect(useSettings.getState().locale).toBe("ko");
    expect(document.documentElement.lang).toBe("ko");

    act(() => useSettings.getState().setLocale("en"));
    expect(useSettings.getState().locale).toBe("en");
    expect(document.documentElement.lang).toBe("en");
  });
});
