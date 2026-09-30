import { test, expect } from "@playwright/test";
import { openApp, markVisited } from "./nav-helper";

// SC-002 / SC-007 / US2-AC1: every core action works with no network. The
// locally-served app stands in for the service-worker-installed one (same
// role: the shell is on the device); every request that would LEAVE the
// device is blocked — tiles, fonts, anything.
test("core actions work with no network: offline map renders, visits persist", async ({
  page,
  context,
}) => {
  await context.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());

  await openApp(page);

  // With tiles unreachable the map falls back to the bundled offline vector
  // world map — a usable map still renders (no blank screen, no spinner trap).
  await expect(page.locator(".maplibregl-canvas").first()).toBeVisible();

  // Log a visit, reload (still offline), and it's still there (IndexedDB).
  await markVisited(page, "Lisbon");
  await page.reload();
  await page.getByRole("button", { name: "Places", exact: true }).click();
  await expect(page.getByText("Lisbon", { exact: true })).toBeVisible();

  // Stats work offline too.
  await page.getByRole("button", { name: "Stats", exact: true }).click();
  await expect(page.getByText("Statistics")).toBeVisible();
  await expect(page.locator(".country-summary", { hasText: "Portugal" })).toBeVisible();
});
