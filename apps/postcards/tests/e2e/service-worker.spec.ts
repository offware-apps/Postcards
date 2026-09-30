import { test, expect, type Page } from "@playwright/test";

// The built app's service worker (vite preview serves it; the dev server does
// not). OSM tiles are answered locally with a 1×1 PNG, so nothing leaves the host.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const TILE_HEADERS = { "access-control-allow-origin": "*" };

// Each test installs the worker, which precaches the whole app: run them one at
// a time, with room for a slow machine.
test.describe.configure({ mode: "serial" });
// The suite blocks service workers; this file is about the installed one.
test.use({ serviceWorkers: "allow" });
test.setTimeout(120_000);

/** Open the app with the service worker controlling the page. */
async function openControlled(page: Page): Promise<void> {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, undefined, {
    timeout: 60_000,
  });
}

const cacheSize = (page: Page, name: string) =>
  page.evaluate(
    async (n) =>
      (await caches.keys()).includes(n) ? (await (await caches.open(n)).keys()).length : 0,
    name,
  );

const fetchIn = (page: Page, url: string) =>
  page.evaluate((u) => fetch(u, { mode: "cors" }).then((r) => r.status), url);

test("the first visit is controlled at once, so a tile download is kept offline", async ({
  page,
  context,
}) => {
  await context.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PNG, headers: TILE_HEADERS }),
  );
  await page.goto("/");
  await page.evaluate(() => ((window as unknown as { firstLoad: boolean }).firstLoad = true));
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, undefined, {
    timeout: 60_000,
  });
  // Taking control of the first visit must not reload it (that is only for updates).
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as unknown as { firstLoad?: boolean }).firstLoad)).toBe(
    true,
  );

  expect(await fetchIn(page, "https://tile.openstreetmap.org/3/4/2.png")).toBe(200);
  await expect.poll(() => cacheSize(page, "osm-tiles-v2")).toBe(1);
});

test("downloaded tiles and the full city list outlive the cache's age limit", async ({
  page,
  context,
}) => {
  await context.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PNG, headers: TILE_HEADERS }),
  );
  await openControlled(page);
  for (const t of ["3/4/2", "3/4/3", "3/5/2"])
    await fetchIn(page, `https://tile.openstreetmap.org/${t}.png`);
  await fetchIn(page, "/reference/cities-all.json");
  await expect.poll(() => cacheSize(page, "osm-tiles-v2")).toBe(3);
  await expect.poll(() => cacheSize(page, "gazetteer-v1")).toBe(1);

  // As if 61 days passed without opening them: age every expiration timestamp.
  // The worker records each entry's timestamp after the cache write settles, so
  // age again until all four are there to age.
  const ageAll = () =>
    page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const req = indexedDB.open("workbox-expiration");
          req.onsuccess = () => {
            const tx = req.result.transaction("cache-entries", "readwrite");
            const old = Date.now() - 61 * 24 * 3600 * 1000;
            let n = 0;
            tx.objectStore("cache-entries").openCursor().onsuccess = (e) => {
              const c = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
              if (!c) return;
              c.update({ ...c.value, timestamp: old });
              n++;
              c.continue();
            };
            tx.oncomplete = () => resolve(n);
          };
          req.onerror = () => resolve(-1);
        }),
    );
  await expect.poll(ageAll).toBe(4);

  // Using either cache again runs its expiration pass.
  await fetchIn(page, "https://tile.openstreetmap.org/3/4/2.png");
  await fetchIn(page, "/reference/cities-all.json");
  await page.waitForTimeout(1500);
  expect(await cacheSize(page, "osm-tiles-v2")).toBe(3);
  expect(await cacheSize(page, "gazetteer-v1")).toBe(1);
});
