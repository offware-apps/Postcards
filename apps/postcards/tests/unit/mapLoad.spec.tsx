import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";

// Minimal MapLibre fake: records calls, lets the test fire "load" by hand.
const { FakeMap, maps } = vi.hoisted(() => {
  const maps: any[] = [];
class FakeMap {
  handlers: Record<string, ((e?: unknown) => void)[]> = {};
  calls: [string, ...unknown[]][] = [];
  sources: Record<string, unknown> = {};
  constructor(public opts: { style: { layers: { id: string }[] } }) {
    maps.push(this);
  }
  on(ev: string, a: unknown, b?: unknown) {
    const fn = (typeof a === "function" ? a : b) as (e?: unknown) => void;
    (this.handlers[ev] ??= []).push(fn);
    return this;
  }
  fire(ev: string) {
    for (const h of this.handlers[ev] ?? []) h({});
  }
  addControl() {}
  getLayer(id: string) {
    return this.opts.style.layers.some((l) => l.id === id) || id in this.sources || true;
  }
  setLayoutProperty(...a: unknown[]) { this.calls.push(["setLayoutProperty", ...a]); }
  setPaintProperty(...a: unknown[]) { this.calls.push(["setPaintProperty", ...a]); }
  setFilter(...a: unknown[]) { this.calls.push(["setFilter", ...a]); }
  setLayerZoomRange() {}
  setProjection(...a: unknown[]) { this.calls.push(["setProjection", ...a]); }
  getSource(id: string) { return { setData: (d: unknown) => this.calls.push(["setData", id, d]), setTiles() {} }; }
  addSource(id: string, s: unknown) { this.sources[id] = s; this.calls.push(["addSource", id, s]); }
  addLayer() {}
  moveLayer() {}
  getBounds() { return { getWest: () => -10, getEast: () => 10, getSouth: () => -10, getNorth: () => 10 }; }
  getZoom() { return 2; }
  getCenter() { return { lng: 0, lat: 0 }; }
  hasImage() { return true; }
  addImage() {}
  triggerRepaint() {}
  remove() {}
  resize() {}
  getContainer() { return { clientHeight: 600, parentElement: null }; }
  getCanvas() { return { style: {} }; }
  queryRenderedFeatures() { return []; }
  fitBounds() {}
  easeTo() {}
  project() { return { x: 0, y: 0 }; }
  areTilesLoaded() { return true; }
}
  return { FakeMap, maps };
});
type FakeMap = InstanceType<typeof FakeMap>;
vi.mock("maplibre-gl", () => {
  class Ctl {}
  const lib = {
    Map: FakeMap,
    NavigationControl: Ctl,
    GeolocateControl: Ctl,
    AttributionControl: Ctl,
    // A chainable popup: the place card builds one on every open.
    Popup: class {
      setLngLat() { return this; }
      setDOMContent() { return this; }
      addTo() { return this; }
      on() { return this; }
      remove() {}
    },
    LngLat: class {},
    addProtocol() {},
  };
  return { default: lib, ...lib };
});

import { MapView } from "../../src/features/map/MapView";
import { useSettings } from "../../src/lib/store/useSettings";
import { RouteMap } from "../../src/features/travel/RouteMap";
import type { MyPlace } from "../../src/features/travel/myPlaces";

beforeEach(() => {
  maps.length = 0;
  globalThis.fetch = vi.fn(() => Promise.reject(new Error("offline"))) as unknown as typeof fetch;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
});

describe("props that change before the map's load event", () => {
  it("MapView applies the latest mode, theme and projection at load", async () => {
    const { rerender } = render(<MapView basemap="osm" mode="all" dark={false} globe={false} />);
    await act(async () => {}); // resolveStyle (sync for osm) → map constructed
    const map = maps[0]! as FakeMap;
    // Airports mode, dark theme and the globe picked before the map finished loading.
    rerender(<MapView basemap="osm" mode="airports" dark={true} globe={true} />);
    await act(async () => map.fire("load"));
    const last = (layer: string, prop: string, kind = "setLayoutProperty") =>
      map.calls.filter((c) => c[0] === kind && c[1] === layer && c[2] === prop).at(-1)?.[3];
    expect(last("poi-monuments", "visibility")).toBe("none");
    expect(last("osm", "raster-brightness-max", "setPaintProperty")).toBe(0.6);
    expect(map.calls.filter((c) => c[0] === "setProjection").at(-1)?.[1]).toEqual({ type: "globe" });
  });

  it("RouteMap draws the stops picked before load", async () => {
    const pool = [
      { key: "city:2988507", place: { kind: "city", id: "2988507", name: "Paris", countryId: "FR" }, name: "Paris", countryId: "FR", lon: 2.35, lat: 48.85 },
      { key: "city:1850147", place: { kind: "city", id: "1850147", name: "Tokyo", countryId: "JP" }, name: "Tokyo", countryId: "JP", lon: 139.69, lat: 35.69 },
    ] as unknown as MyPlace[];
    const props = { pool, mode: "flight" as const, addedKeys: new Set<string>(), onPick: () => {} };
    const { rerender } = render(<RouteMap {...props} stops={[]} />);
    const map = maps[0]! as FakeMap;
    // A keyboard user picks two places from the list before the canvas fired load.
    rerender(<RouteMap {...props} stops={[pool[0]!.place, pool[1]!.place]} />);
    await act(async () => map.fire("load"));
    const pins = map.calls.find((c) => c[0] === "addSource" && c[1] === "pins")?.[2] as {
      data: { features: { properties: { added: boolean } }[] };
    };
    const arcs = map.calls.find((c) => c[0] === "addSource" && c[1] === "arcs")?.[2] as { data: { features: unknown[] } };
    expect(pins.data.features.map((f) => f.properties.added)).toEqual([true, true]);
    expect(arcs.data.features.length).toBe(1);
  });
});

describe("the map's place card photo", () => {
  const kyoto = { kind: "city", id: "1857910", name: "Kyoto", countryId: "JP" } as const;
  async function openCard(): Promise<string[]> {
    const { rerender } = render(<MapView basemap="osm" mode="all" dark={false} />);
    await act(async () => {});
    const map = maps[0]! as FakeMap;
    await act(async () => map.fire("load"));
    const popup = { name: "Kyoto", sub: "Japan", place: kyoto, hasPage: true, showImage: true };
    rerender(<MapView basemap="osm" mode="all" dark={false} focus={{ lon: 135.75, lat: 35.01, key: 1, popup }} />);
    // The photo loader imports the guides module first: give it time to fetch.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    const fetchMock = globalThis.fetch as unknown as { mock: { calls: unknown[][] } };
    return fetchMock.mock.calls.map((c) => String(c[0]));
  }

  it("never asks Wikipedia while guides are off, even on the online map", async () => {
    useSettings.setState({ autoLoadGuides: false, offlineMode: false });
    expect((await openCard()).filter((u) => u.includes("wikipedia.org"))).toEqual([]);
  });

  it("loads once guides are on", async () => {
    useSettings.setState({ autoLoadGuides: true, offlineMode: false });
    await openCard();
    // Under a loaded suite the guides module can take longer than the card's wait.
    const fetchMock = globalThis.fetch as unknown as { mock: { calls: unknown[][] } };
    await vi.waitFor(
      () => expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("wikipedia.org"))).toBe(true),
      { timeout: 5000 },
    );
  });
});
