import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { render, act, cleanup } from "@testing-library/react";

// A minimal in-memory stand-in for the part of `idb` the guide cache uses.
const fake = vi.hoisted(() => {
  const stores = new Map<string, Map<unknown, { key: string }>>();
  const d = {
    objectStoreNames: { contains: (n: string) => stores.has(n) },
    createObjectStore: (n: string) => void stores.set(n, new Map()),
    get: async (n: string, k: unknown) => stores.get(n)?.get(k),
    getAll: async (n: string) => [...(stores.get(n)?.values() ?? [])],
    put: async (n: string, v: { key: string }) => void stores.get(n)!.set(v.key, { ...v }),
    delete: async (n: string, k: unknown) => void stores.get(n)?.delete(k),
  };
  return {
    reset: () => stores.clear(),
    openDB: async (_name: string, _v: number, opts?: { upgrade?: (db: typeof d) => void }) => {
      opts?.upgrade?.(d);
      return d;
    },
  };
});
vi.mock("idb", () => ({ openDB: fake.openDB }));
import { readGuide, saveGuide, moveLocalGuides, GUIDE_CACHE_CAP } from "../../src/features/guides/guideCache";
import { GuideSection } from "../../src/features/guides/GuideButton";
import { useSettings } from "../../src/lib/store/useSettings";
import { getReferenceData } from "../../src/lib/reference/referenceData";

beforeEach(() => {
  fake.reset();
  localStorage.clear();
  (globalThis as { indexedDB?: unknown }).indexedDB = {};
});

describe("guide cache", () => {
  it("keeps the most recently used guides up to its cap", async () => {
    for (let i = 0; i < GUIDE_CACHE_CAP; i++) await saveGuide(`g${i}`, { n: i });
    // Reading the oldest makes it recent, so the next save evicts g1 instead.
    expect(await readGuide("g0")).toEqual({ n: 0 });
    await saveGuide("new", { n: -1 });
    expect(await readGuide("g0")).toEqual({ n: 0 });
    expect(await readGuide("g1")).toBeNull();
    expect(await readGuide("new")).toEqual({ n: -1 });
  });

  it("moves guides saved in localStorage out of it", async () => {
    localStorage.setItem("postcards-guidefull:wikivoyage:GB:London", JSON.stringify({ title: "London" }));
    localStorage.setItem("postcards-guide:wikivoyage:GB:London", JSON.stringify({ title: "London" }));
    localStorage.setItem("postcards-offline", "1");
    await moveLocalGuides();
    expect(localStorage.getItem("postcards-guidefull:wikivoyage:GB:London")).toBeNull();
    // Overviews and settings stay where they are.
    expect(localStorage.getItem("postcards-guide:wikivoyage:GB:London")).not.toBeNull();
    expect(localStorage.getItem("postcards-offline")).toBe("1");
    expect(await readGuide("postcards-guidefull:wikivoyage:GB:London")).toEqual({ title: "London" });
  });
});

describe("a place's saved whole guide", () => {
  it("still shows once moved out of localStorage", async () => {
    act(() => useSettings.setState({ autoLoadGuides: false, offlineMode: true }));
    const paris = getReferenceData().searchCities("Paris")[0]!;
    localStorage.setItem(
      `postcards-guidefull:wikivoyage:FR:${paris.name}`,
      JSON.stringify({
        title: paris.name,
        url: "https://example.org",
        attribution: "Wikivoyage",
        sections: [{ heading: "", text: "PARIS-WHOLE-GUIDE" }],
      }),
    );
    await moveLocalGuides();
    const place = { kind: "city", id: paris.id, name: paris.name, countryId: "FR" } as const;
    const { container } = render(createElement(GuideSection, { place }));
    await act(async () => {});
    expect(container.textContent).toContain("PARIS-WHOLE-GUIDE");
    cleanup();
  });
});
