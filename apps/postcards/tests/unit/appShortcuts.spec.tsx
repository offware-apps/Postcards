import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { App } from "../../src/app/App";
import { useUi } from "../../src/lib/store/useUi";

// A place card left open on the map: MapLibre keeps it in the map's container,
// which stays mounted (hidden) while another tab shows.
function mapPopup(hidden: boolean): HTMLElement {
  const keep = document.createElement("div");
  keep.className = "map-keep" + (hidden ? " map-keep-hidden" : "");
  const popup = document.createElement("div");
  popup.className = "maplibregl-popup";
  keep.appendChild(popup);
  document.body.appendChild(keep);
  return keep;
}

beforeEach(() => {
  localStorage.setItem("postcards-intro-seen", "1");
  useUi.setState({ tab: "places", cityPageId: null, countryPageId: null, tripEditId: null });
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("single-key shortcuts", () => {
  it("still switch tabs while a popup waits on the hidden map", () => {
    render(<App />);
    mapPopup(true);
    fireEvent.keyDown(window, { key: "3" });
    expect(useUi.getState().tab).toBe("trips");
  });

  it("stay inert while a popup is open on the visible map", () => {
    useUi.setState({ tab: "map" });
    render(<App />);
    mapPopup(false);
    fireEvent.keyDown(window, { key: "3" });
    expect(useUi.getState().tab).toBe("map");
  });
});
