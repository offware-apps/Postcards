import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { gotoTab, openApp, markVisited } from "./nav-helper";

// SC-006 / Constitution III: no personal data and no third-party trackers ever
// leave the device. The detailed OpenStreetMap basemap is opt-in (governed by the
// global Online/Offline mode), so core flows should make ZERO external requests.
// tile.openstreetmap.org stays on the allow-list so this first test still passes
// if a run has the online map enabled — but no OSM tile is expected here. EVERY
// other outbound request — telemetry, analytics, fonts, anything — is a violation.
// App, gazetteer and map geometry are served locally.
const ALLOWED_HOSTS = ["tile.openstreetmap.org"];

// The service worker is what fetches for an installed app, so it runs here.
test.use({ serviceWorkers: "allow" });

/** Every request leaving the origin, the service worker's included, which a
 *  page-level listener never sees. `workerRequests` counts the latter. */
function watchEgress(context: BrowserContext, baseURL: string, allowed: string[]) {
  const seen = { external: [] as string[], workerRequests: 0 };
  context.on("request", (req) => {
    if (req.serviceWorker()) seen.workerRequests++;
    const url = req.url();
    if (url.startsWith(baseURL) || url.startsWith("data:") || url.startsWith("blob:")) return;
    try {
      if (allowed.includes(new URL(url).hostname)) return;
    } catch {
      /* unparseable url — treat as external below */
    }
    seen.external.push(url);
  });
  return seen;
}

/** Wait until the service worker has installed, which it does only once it has
 *  fetched everything it caches, and prove the listener saw it do so. */
async function afterWorkerInstall(page: Page, seen: { workerRequests: number }) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  expect(seen.workerRequests, "the service worker's own requests were watched").toBeGreaterThan(0);
}

test("only OpenStreetMap tiles leave the origin during core flows", async ({
  page,
  context,
  baseURL,
}) => {
  const seen = watchEgress(context, baseURL!, ALLOWED_HOSTS);

  await openApp(page);

  // Exercise every core flow: add, map, stats, places, export surface.
  await markVisited(page, "Rome");
  await gotoTab(page, "Stats");
  await expect(page.getByText("Statistics")).toBeVisible();
  await page.getByRole("button", { name: "Places", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Places" })).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Your data" })).toBeVisible(); // export surface lives here now
  await afterWorkerInstall(page, seen);

  expect(seen.external, `external requests: ${seen.external.join(", ")}`).toEqual([]);
});

// FR-001/002, SC-001: Offline mode is the single egress gate. With it ON, NOTHING
// optional may leave the origin — not even an OpenStreetMap tile. This is the
// self-contained guarantee the "weak/metered connection" user relies on.
test("Offline mode makes ZERO external requests, including no map tiles", async ({
  page,
  context,
  baseURL,
}) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("postcards-offline-mode", "1");
    } catch {
      /* private mode */
    }
  });

  // Not even tile.openstreetmap.org is allowed here — Offline mode means offline.
  const seen = watchEgress(context, baseURL!, []);

  await openApp(page);

  // Exercise the surfaces that would otherwise reach the network.
  await markVisited(page, "Rome");
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Your data" })).toBeVisible();
  await afterWorkerInstall(page, seen);

  expect(seen.external, `offline-mode external requests: ${seen.external.join(", ")}`).toEqual([]);
});
