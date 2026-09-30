import { describe, it, expect } from "vitest";
import { tilesForBounds, saveAreaOffline } from "../../src/features/map/offlineTiles";
import type { Bounds } from "../../src/features/map/viewport";

// A small area around Paris.
const paris: Bounds = { west: 2.2, south: 48.8, east: 2.5, north: 48.9 };

describe("tilesForBounds", () => {
  it("covers the viewport at a single zoom with the slippy-map tile grid", () => {
    const urls = tilesForBounds(paris, 10, 1);
    // 2 tiles wide × 1 tall around Paris at z10.
    expect(urls).toHaveLength(2);
    expect(urls).toContain("https://tile.openstreetmap.org/10/518/352.png");
    for (const u of urls) expect(u).toMatch(/^https:\/\/tile\.openstreetmap\.org\/10\/\d+\/\d+\.png$/);
  });

  it("adds deeper zoom levels (more, finer tiles)", () => {
    const one = tilesForBounds(paris, 10, 1);
    const three = tilesForBounds(paris, 10, 3);
    expect(three.length).toBeGreaterThan(one.length);
    expect(three.some((u) => u.includes("/12/"))).toBe(true);
  });

  it("caps the tile count (coarse levels first)", () => {
    const capped = tilesForBounds({ west: -20, south: 30, east: 40, north: 60 }, 6, 4, 50);
    expect(capped).toHaveLength(50);
  });

  it("covers a viewport that crosses the antimeridian (west > east)", () => {
    // Straddling the date line near Fiji: west=170, east=-170.
    const urls = tilesForBounds({ west: 170, south: -20, east: -170, north: -16 }, 6, 1);
    expect(urls.length).toBeGreaterThan(0); // not silently empty
    // Includes tiles from both the far-east and far-west edges of the grid (z6 → 64 wide).
    const xs = urls.map((u) => Number(u.split("/")[4]));
    expect(Math.max(...xs)).toBeGreaterThan(60); // near x=63 (east of 170°)
    expect(Math.min(...xs)).toBeLessThan(3); // near x=0 (west of -170°)
  });

  it("clamps zoom into range and never emits out-of-grid indices", () => {
    const urls = tilesForBounds({ west: -180, south: -85, east: 180, north: 85 }, 0, 1);
    expect(urls.length).toBeGreaterThan(0);
    // z clamps to 1 → grid is 2×2, indices 0..1.
    for (const u of urls) expect(u).toMatch(/\/1\/[01]\/[01]\.png$/);
  });
});

describe("saveAreaOffline", () => {
  it("fetches each unique tile (no-cors) and reports counts", async () => {
    const seen: string[] = [];
    const fetchFn = (async (url: string) => {
      seen.push(String(url));
      return { ok: true } as Response;
    }) as unknown as typeof fetch;
    const res = await saveAreaOffline(paris, 10, { levels: 1, fetchFn });
    expect(res.total).toBe(2);
    expect(res.saved).toBe(2);
    expect(res.failed).toBe(0);
    expect(new Set(seen).size).toBe(2);
  });

  it("counts failures without throwing, and honors the cap flag", async () => {
    const fetchFn = (async () => {
      throw new Error("blocked");
    }) as unknown as typeof fetch;
    const res = await saveAreaOffline({ west: -20, south: 30, east: 40, north: 60 }, 6, {
      levels: 4,
      maxTiles: 20,
      fetchFn,
    });
    expect(res.total).toBe(20);
    expect(res.failed).toBe(20);
    expect(res.saved).toBe(0);
    expect(res.capped).toBe(true);
  });

  it("hands its abort signal to every fetch, so aborting stops the requests in flight", async () => {
    const ctl = new AbortController();
    const signals: (AbortSignal | undefined)[] = [];
    // A tile request that only ends when its signal aborts.
    const fetchFn = ((_url: string, init?: RequestInit) => {
      signals.push(init?.signal ?? undefined);
      return new Promise((_res, rej) =>
        init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))),
      );
    }) as unknown as typeof fetch;
    const run = saveAreaOffline({ west: -20, south: 30, east: 40, north: 60 }, 6, {
      levels: 2,
      signal: ctl.signal,
      fetchFn,
    });
    await new Promise((r) => setTimeout(r, 0));
    ctl.abort();
    await run;
    expect(signals).toHaveLength(3);
    expect(signals.every((s) => s === ctl.signal)).toBe(true);
  });

  it("requests no further tile once stop() reports true", async () => {
    let offline = false;
    let calls = 0;
    const fetchFn = (async () => {
      calls++;
      if (calls === 5) offline = true;
      return { ok: true } as Response;
    }) as unknown as typeof fetch;
    await saveAreaOffline({ west: -20, south: 30, east: 40, north: 60 }, 6, {
      levels: 3,
      fetchFn,
      stop: () => offline,
    });
    // The 3 workers each finish the request they had started, then stop.
    expect(calls).toBeLessThanOrEqual(7);
  });
});

describe("prefetchAroundBounds (warm the ring around the viewport)", () => {
  it("fetches only tiles OUTSIDE the visible view, and never the same tile twice", async () => {
    const { prefetchAroundBounds, tilesForBounds: tiles } = await import(
      "../../src/lib/offline/tiles"
    );
    const bounds = { west: 2, south: 48, east: 3, north: 49 };
    const seen: string[] = [];
    const fetchFn = (async (url: RequestInfo | URL) => {
      seen.push(String(url));
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;

    prefetchAroundBounds(bounds, 8, { maxTiles: 30, fetchFn });
    await new Promise((r) => setTimeout(r, 20));
    const visible = new Set(tiles(bounds, 8, 1, 500));
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.length).toBeLessThanOrEqual(30);
    for (const url of seen) expect(visible.has(url)).toBe(false);

    // Same stop again: everything is already warmed — nothing refetches.
    const before = seen.length;
    prefetchAroundBounds(bounds, 8, { maxTiles: 30, fetchFn });
    await new Promise((r) => setTimeout(r, 20));
    expect(seen.length).toBe(before);
  });
});
