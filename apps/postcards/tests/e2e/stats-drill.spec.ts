import { test, expect } from "@playwright/test";
import { gotoTab, openApp, markVisited } from "./nav-helper";

// A Stats country-card tier (cities / big / mega / sites) drills into Places,
// scoped to THAT country + tier via the ONE shared filter — and because the
// filter lives in the shared store, it survives leaving and returning to Places.
test("a country tier opens Places filtered, and the filter persists across pages", async ({
  page,
}) => {
  await openApp(page);
  for (const q of ["Paris", "Lyon", "Tokyo"]) {
    await markVisited(page, q);
  }

  await gotoTab(page, "Stats");
  await page.locator(".country-summary", { hasText: "France" }).click();

  // Tap "Big cities" in the France card → Places, cities kind, France + 100k+.
  await page
    .locator(".country-card", { hasText: "France" })
    .locator("button.metric-btn", { hasText: "Big cities" })
    .click();

  // Both dimensions surface as removable chips, and the list is French cities.
  await expect(page.locator(".filter-chip", { hasText: "France" })).toBeVisible();
  await expect(page.locator(".filter-chip", { hasText: "100k+" })).toBeVisible();
  await expect(page.getByText("Marseille", { exact: false }).first()).toBeVisible();
  // Tokyo (Japan) must NOT appear — the country filter excludes it.
  await expect(page.getByText("Tokyo", { exact: false })).toHaveCount(0);

  // Leave to the Map and come back: the France filter is still applied.
  await gotoTab(page, "Map");
  await page.getByRole("button", { name: "Places", exact: true }).click();
  await expect(page.locator(".filter-chip", { hasText: "France" })).toBeVisible();

  // Clearing the country chip widens the list back out: Tokyo returns.
  await page
    .locator(".filter-chip", { hasText: "France" })
    .getByRole("button")
    .click();
  await expect(page.locator(".filter-chip", { hasText: "France" })).toHaveCount(0);
  await expect(page.getByText("Tokyo", { exact: false }).first()).toBeVisible();
});
