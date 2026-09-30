import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";

// A MapLibre stand-in whose canvas and panel sizes the test sets, and whose
// "load" the test fires by hand.
const { FakeMap, maps, sizes } = vi.hoisted(() => {
  const maps: InstanceType<typeof FakeMap>[] = [];
  const sizes = { canvas: [612, 654], box: [612, 654] };
  class FakeMap {
    handlers: Record<string, ((e?: unknown) => void)[]> = {};
    resize = vi.fn();
    constructor() {
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
    getCanvas() {
      return { clientWidth: sizes.canvas[0], clientHeight: sizes.canvas[1], style: {} };
    }
    getContainer() {
      return { clientWidth: sizes.box[0], clientHeight: sizes.box[1], parentElement: null };
    }
    addControl() {}
    getLayer() {
      return true;
    }
    setLayoutProperty() {}
    setPaintProperty() {}
    setFilter() {}
    setLayerZoomRange() {}
    setProjection() {}
    getSource() {
      return { setData() {}, setTiles() {} };
    }
    addSource() {}
    addLayer() {}
    moveLayer() {}
    getBounds() {
      return { getWest: () => -10, getEast: () => 10, getSouth: () => -10, getNorth: () => 10 };
    }
    getZoom() {
      return 2;
    }
    getCenter() {
      return { lng: 0, lat: 0 };
    }
    hasImage() {
      return true;
    }
    addImage() {}
    triggerRepaint() {}
    remove() {}
    queryRenderedFeatures() {
      return [];
    }
    fitBounds() {}
    easeTo() {}
    project() {
      return { x: 0, y: 0 };
    }
    areTilesLoaded() {
      return true;
    }
  }
  return { FakeMap, maps, sizes };
});

vi.mock("maplibre-gl", () => {
  class Ctl {}
  const lib = {
    Map: FakeMap,
    NavigationControl: Ctl,
    GeolocateControl: Ctl,
    AttributionControl: Ctl,
    Popup: class {},
    LngLat: class {},
    addProtocol() {},
  };
  return { default: lib, ...lib };
});

import { MapView } from "../../src/features/map/MapView";

async function loadWith(canvas: number[], box: number[]) {
  sizes.canvas = canvas;
  sizes.box = box;
  render(<MapView basemap="osm" mode="all" dark={false} />);
  await vi.waitFor(() => expect(maps.length).toBe(1));
  act(() => maps[0]!.fire("load"));
  return maps[0]!;
}

beforeEach(() => {
  maps.length = 0;
  globalThis.fetch = vi.fn(() => Promise.reject(new Error("offline"))) as unknown as typeof fetch;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
});

describe("the map's size once it loads", () => {
  it("resizes a canvas left smaller than its panel", async () => {
    const map = await loadWith([400, 190], [612, 654]);
    expect(map.resize).toHaveBeenCalledTimes(1);
  });

  it("leaves a canvas that already fills its panel alone", async () => {
    const map = await loadWith([612, 654], [612, 654]);
    expect(map.resize).not.toHaveBeenCalled();
  });
});
