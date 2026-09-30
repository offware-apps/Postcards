import { test, expect } from "@playwright/test";
import { openApp, markVisited } from "./nav-helper";

// PRIORITY #1 regression guard: on a phone, tapping to mark a place visited must
// paint the new state immediately — the visible flip is DECOUPLED from the
// IndexedDB write (the original bug: marking a photo-laden place re-serialized
// multi-MB of base64 to IndexedDB on the main thread BEFORE the flag painted).
//
// What we assert here is the FLIP LATENCY: how long until the tapped control
// reflects the new state. That is our synchronous React commit and is unaffected
// by the GPU, so it is stable in CI. The test holds every IndexedDB write open
// for WRITE_HOLD_MS while it measures, so a change that re-couples the paint to
// the persist flips no sooner than the write lands and fails the 100 ms bound,
// however fast IndexedDB is on the machine running the suite.
//
// We deliberately do NOT assert on `longtask` wall-clock. Marking a place also
// triggers a MapLibre WebGL repaint; under the headless software-GL used in CI a
// single repaint frame costs ~100ms, but on a real device's GPU it is cheap and
// off the main thread. Asserting an absolute long-task ceiling would measure the
// test environment's GL emulation, not our code. The one repaint cost that IS
// real on-device — decoding OSM raster tiles — is avoided by defaulting to the
// offline vector basemap. The "mutation writes tiny refs, not MB of photos"
// invariant is covered deterministically in tests/unit/photoBlobs.spec.ts.

// A representative modern phone: 390×844 CSS px, touch input. DPR 2 (not 3) keeps
// the software-GL map render light enough not to starve sibling e2e workers — the
// flip-latency we measure is a React commit and is independent of pixel ratio.
test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});

const WRITE_HOLD_MS = 1000;

interface W {
  __holdWrites: boolean;
  __lastWriteMs: number;
}

// Once __holdWrites is set, every read-write transaction stays open for
// WRITE_HOLD_MS by chaining reads, so its completion (what the app awaits to
// persist) lands no sooner. Installed before the app opens its database.
const HOLD_WRITES_INIT = (holdMs: number) => {
  const w = window as unknown as W;
  w.__holdWrites = false;
  w.__lastWriteMs = 0;
  const open = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function (
    this: IDBDatabase,
    ...args: Parameters<IDBDatabase["transaction"]>
  ) {
    const tx = open.apply(this, args);
    if (w.__holdWrites && args[1] === "readwrite") {
      const t0 = performance.now();
      const store = tx.objectStore(tx.objectStoreNames[0]);
      const spin = () => {
        if (performance.now() - t0 < holdMs) store.count().onsuccess = spin;
      };
      spin();
      tx.addEventListener("complete", () => (w.__lastWriteMs = performance.now() - t0));
    }
    return tx;
  };
};

/** Click the button whose aria-label matches `markLabel`, then report how long
 *  until a button labelled `flippedLabel` exists — the visible state flip — and
 *  how long the write that persists it took. */
async function measureFlip(
  page: import("@playwright/test").Page,
  markLabel: string,
  flippedLabel: string,
): Promise<{ latency: number; writeMs: number }> {
  return page.evaluate(
    async ({ markLabel, flippedLabel }) => {
      const w = window as unknown as W;
      const byLabel = (label: string) =>
        [...document.querySelectorAll("button")].find(
          (b) => b.getAttribute("aria-label") === label,
        );
      const btn = byLabel(markLabel);
      if (!btn) return { latency: -1, writeMs: 0 };
      w.__holdWrites = true;
      const t0 = performance.now();
      btn.click();
      // Poll on timers, not animation frames: a software-GL map frame can take
      // longer than the bound, and the flip does not wait for one.
      let latency = -1;
      while (performance.now() - t0 < 3000) {
        if (byLabel(flippedLabel)) {
          latency = performance.now() - t0;
          break;
        }
        await new Promise((r) => setTimeout(r, 0));
      }
      while (!w.__lastWriteMs && performance.now() - t0 < 5000) {
        await new Promise((r) => setTimeout(r, 20));
      }
      w.__holdWrites = false;
      return { latency, writeMs: w.__lastWriteMs };
    },
    { markLabel, flippedLabel },
  );
}

test("marking a place visited paints instantly on mobile (paint decoupled from persist)", async ({
  page,
}) => {
  await page.addInitScript(HOLD_WRITES_INIT, WRITE_HOLD_MS);
  await openApp(page);

  // Warm up: the very first visit fits the camera to your places (a one-time
  // move) and the full gazetteer loads in the background. Mark one, then MEASURE
  // a subsequent mark — the steady-state interaction a user actually repeats.
  await markVisited(page, "Paris");
  await page.getByLabel("Search a city or country").fill("Lyon");
  await expect(page.getByRole("button", { name: "Mark Lyon visited" }).first()).toBeVisible();

  const { latency, writeMs } = await measureFlip(page, "Mark Lyon visited", "Remove Lyon from visited");
  // eslint-disable-next-line no-console
  console.log(`[perf] mark-visited flip=${latency.toFixed(1)}ms, write held ${writeMs.toFixed(0)}ms`);
  // The hold applied, so a paint that waited for the write would be late.
  expect(writeMs).toBeGreaterThanOrEqual(WRITE_HOLD_MS);
  expect(latency).toBeGreaterThanOrEqual(0);
  expect(latency).toBeLessThan(100);
});
