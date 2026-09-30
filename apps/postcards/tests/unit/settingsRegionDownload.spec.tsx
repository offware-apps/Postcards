import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { SettingsScreen } from "../../src/features/settings/SettingsScreen";
import { useSettings } from "../../src/lib/store/useSettings";

// Each tile request answers after 5 ms unless its signal aborts it first.
let tileCalls = 0;
let signals: (AbortSignal | undefined)[] = [];
const fetchMock = vi.fn((url: string, init?: RequestInit) => {
  if (!String(url).includes("tile.openstreetmap.org")) return Promise.reject(new Error("offline"));
  tileCalls++;
  signals.push(init?.signal ?? undefined);
  return new Promise((res, rej) => {
    const t = setTimeout(() => res({ ok: true } as Response), 5);
    init?.signal?.addEventListener("abort", () => {
      clearTimeout(t);
      rej(new DOMException("aborted", "AbortError"));
    });
  });
});

const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));

beforeEach(() => {
  tileCalls = 0;
  signals = [];
  vi.stubGlobal("fetch", fetchMock);
  // The download needs a controlling service worker to keep the tiles.
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { controller: {} },
  });
  useSettings.getState().setOfflineMode(false);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useSettings.getState().setOfflineMode(false);
});

async function startWorldDownload() {
  render(<SettingsScreen />);
  const [btn] = screen.getAllByRole("button", { name: /Download/ });
  fireEvent.click(btn!);
  await wait(30);
  expect(tileCalls).toBeGreaterThan(0);
}

describe("a region download", () => {
  it("stops, and aborts the requests in flight, when Offline mode is switched on", async () => {
    await startWorldDownload();
    act(() => useSettings.getState().setOfflineMode(true));
    const atSwitch = tileCalls;
    await wait(60);
    expect(tileCalls).toBe(atSwitch);
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((s) => s?.aborted)).toBe(true);
  });

  it("stops, and aborts the requests in flight, when Settings is left", async () => {
    await startWorldDownload();
    cleanup();
    const atLeave = tileCalls;
    await wait(60);
    expect(tileCalls).toBe(atLeave);
    expect(signals.every((s) => s?.aborted)).toBe(true);
  });
});
