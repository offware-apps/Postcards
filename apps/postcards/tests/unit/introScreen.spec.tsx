import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { App } from "../../src/app/App";
import { useUi } from "../../src/lib/store/useUi";

beforeEach(() => {
  localStorage.clear(); // first run: the intro shows
  useUi.setState({ tab: "places", cityPageId: null, countryPageId: null, tripEditId: null });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("first-run intro", () => {
  it("keeps focus where the user put it when the app behind it re-renders", () => {
    render(<App />);
    const offline = screen.getByRole("button", { name: "Offline" });
    offline.focus();
    // The browser offers installation: the app re-renders to show its Install button.
    act(() => {
      window.dispatchEvent(new Event("beforeinstallprompt"));
    });
    expect(document.activeElement).toBe(offline);
  });
});
