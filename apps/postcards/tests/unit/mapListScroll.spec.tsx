import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { useEffect } from "react";

// The map itself stands in as a view of the whole world.
vi.mock("../../src/features/map/MapView", () => ({
  MapView: ({ onBounds }: { onBounds?: (b: unknown) => void }) => {
    useEffect(() => onBounds?.({ west: -180, south: -90, east: 180, north: 90 }), [onBounds]);
    return null;
  },
  hasSavedCamera: () => false,
}));

import { MapScreen } from "../../src/features/map/MapScreen";
import { useUi } from "../../src/lib/store/useUi";
import { getReferenceData } from "../../src/lib/reference/referenceData";

describe("the map list's scroll to a picked place", () => {
  const scrolls: ScrollIntoViewOptions[] = [];
  beforeEach(() => {
    scrolls.length = 0;
    Element.prototype.scrollIntoView = function (o?: boolean | ScrollIntoViewOptions) {
      if (typeof o === "object") scrolls.push(o);
    };
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: q.includes("prefers-reduced-motion"),
      media: q,
      addEventListener() {},
      removeEventListener() {},
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("jumps rather than glides when the user asks for reduced motion", async () => {
    render(<MapScreen />);
    const tokyo = getReferenceData().searchCities("Tokyo")[0]!;
    await act(async () =>
      useUi.getState().selectPlace(tokyo.lon, tokyo.lat, {
        kind: "city",
        id: tokyo.id,
        name: tokyo.name,
        countryId: tokyo.countryIso2,
      }),
    );
    await vi.waitFor(() => expect(scrolls.length).toBeGreaterThan(0));
    expect(scrolls.every((o) => o.behavior !== "smooth")).toBe(true);
  });
});
