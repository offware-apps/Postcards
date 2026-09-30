import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// A MapLibre whose map cannot start, as when the browser has no WebGL.
vi.mock("maplibre-gl", () => {
  class Ctl {}
  const lib = {
    Map: class {
      constructor() {
        throw new Error("Failed to initialize WebGL");
      }
    },
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

describe("a map that cannot start", () => {
  it("hands the list the whole world, so the cities list still works", async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error("offline"))) as unknown as typeof fetch;
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
    const onBounds = vi.fn();
    render(<MapView basemap="osm" mode="all" dark={false} onBounds={onBounds} />);
    expect(await screen.findByText(/The map couldn’t start/)).toBeTruthy();
    await waitFor(() =>
      expect(onBounds).toHaveBeenCalledWith({ west: -180, south: -90, east: 180, north: 90 }),
    );
  });
});
