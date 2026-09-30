import { test, expect } from "@playwright/test";
import { gotoTab } from "./nav-helper";

// SC-006 / Constitution III: no personal data and no third-party trackers ever
// leave the device. The detailed OpenStreetMap basemap is opt-in (governed by the
// global Online/Offline mode), so core flows should make ZERO external requests.
// tile.openstreetmap.org stays on the allow-list so this first test still passes
// if a run has the online map enabled — but no OSM tile is expected here. EVERY
// other outbound request — telemetry, analytics, fonts, anything — is a violation.
// App, gazetteer and map geometry are served locally.
const ALLOWED_HOSTS = ["tile.openstreetmap.org"];

test("only OpenStreetMap tiles leave the origin during core flows", async ({ page, baseURL }) => {
  const external: string[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (url.startsWith(baseURL!) || url.startsWith("data:") || url.startsWith("blob:")) return;
    try {
      if (ALLOWED_HOSTS.includes(new URL(url).hostname)) return;
    } catch {
      /* unparseable url — treat as external below */
    }
    external.push(url);
  });

  await page.goto("/");
  await expect(page.getByText("Cities in view")).toBeVisible();

  // Exercise every core flow: add, map, stats, places, export surface.
  await page.getByLabel("Search a city or country").fill("Rome");
  await page.getByRole("button", { name: "Mark Rome visited" }).first().click();
  await page.keyboard.press("Escape");
  await gotoTab(page, "Stats");
  await expect(page.getByText("Statistics")).toBeVisible();
  await page.getByRole("button", { name: "Places", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Places" })).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Your data" })).toBeVisible(); // export surface lives here now
  await page.waitForTimeout(1000); // let any stray beacons fire

  expect(external, `external requests: ${external.join(", ")}`).toEqual([]);
});

// FR-001/002, SC-001: Offline mode is the single egress gate. With it ON, NOTHING
// optional may leave the origin — not even an OpenStreetMap tile. This is the
// self-contained guarantee the "weak/metered connection" user relies on.
test("Offline mode makes ZERO external requests, including no map tiles", async ({ page, baseURL }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("postcards-offline-mode", "1");
      localStorage.setItem("postcards-intro-seen", "1");
    } catch {
      /* private mode */
    }
  });

  const external: string[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (url.startsWith(baseURL!) || url.startsWith("data:") || url.startsWith("blob:")) return;
    external.push(url);
  });

  await page.goto("/");
  await expect(page.getByText("Cities in view")).toBeVisible();

  // Exercise the surfaces that would otherwise reach the network.
  await page.getByLabel("Search a city or country").fill("Rome");
  await page.getByRole("button", { name: "Mark Rome visited" }).first().click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Your data" })).toBeVisible();
  await page.waitForTimeout(1000);

  // Not even tile.openstreetmap.org is allowed here — Offline mode means offline.
  expect(external, `offline-mode external requests: ${external.join(", ")}`).toEqual([]);
});

// Spec 020, SC-008/SC-011: writing a postcard — the redesign's core flow — must be
// fully self-contained. Opening the composer, writing, tagging and saving makes
// ZERO external requests (the composer runs offline; near-you would only read the
// on-device gazetteer and is never granted here). Photos stay inline data URLs.
test("writing a postcard makes ZERO external requests", async ({ page, baseURL }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("postcards-offline-mode", "1");
      localStorage.setItem("postcards-intro-seen", "1");
    } catch {
      /* private mode */
    }
  });

  const external: string[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (url.startsWith(baseURL!) || url.startsWith("data:") || url.startsWith("blob:")) return;
    external.push(url);
  });

  await page.goto("/");
  await gotoTab(page, "Journal");
  await page.keyboard.press("w");
  await expect(page.locator(".story-composer")).toBeVisible();
  await page.locator("#story-text").fill("Offline, self-contained, private.");
  await page.getByText("Add details", { exact: true }).click();
  await page.getByRole("button", { name: "☀️ sunny" }).click();
  await page.getByRole("button", { name: "Save postcard" }).click();
  await expect(page.locator(".story-composer")).toHaveCount(0);
  await page.waitForTimeout(1000);

  expect(external, `composer external requests: ${external.join(", ")}`).toEqual([]);
});
