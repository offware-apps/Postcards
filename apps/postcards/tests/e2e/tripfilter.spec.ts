import { test, expect } from "@playwright/test";
import { gotoTab, openApp, addTrip } from "./nav-helper";

// Log trips in two different years, then filter the Travel log by year and see
// the list + totals narrow to the chosen period.
test("filter the travel log by year", async ({ page }) => {
  await openApp(page);
  await gotoTab(page, "Trips");

  await addTrip(page, "CDG", "JFK", "2024-08-14");
  await addTrip(page, "LHR", "SFO", "2023-05-01");

  // No filter yet → both trips counted.
  await expect(page.locator(".travel-totals")).toContainText("2 trips");

  // Filter to 2024 → one trip; the month sub-filter appears.
  const trip = (label: string) => page.locator("li.city-row", { hasText: label });
  await page.locator("#trip-filter-year").selectOption("2024");
  await expect(page.locator(".travel-totals")).toContainText("1 trip");
  await expect(trip("CDG → JFK")).toBeVisible();
  await expect(trip("LHR → SFO")).toHaveCount(0);
  await expect(page.locator("#trip-filter-month")).toBeVisible();

  // Switch to 2023 → the other trip, with the same count as before.
  await page.locator("#trip-filter-year").selectOption("2023");
  await expect(trip("LHR → SFO")).toBeVisible();
  await expect(trip("CDG → JFK")).toHaveCount(0);
  await expect(page.locator(".travel-totals")).toContainText("1 trip");

  // Back to all years → both again.
  await page.locator("#trip-filter-year").selectOption("all");
  await expect(page.locator(".travel-totals")).toContainText("2 trips");
});

// The map has its OWN date filter (independent of the Trips tab now), with quick
// chips built from your dated content. Picking a year narrows the trip arcs and
// tags the map's Trips toggle with that period.
test("the map's own date filter tags the trip arcs by period", async ({ page }) => {
  await openApp(page);
  await gotoTab(page, "Trips");

  await addTrip(page, "CDG", "JFK", "2024-08-14");
  await addTrip(page, "LHR", "SFO", "2023-05-01");

  await page.getByRole("button", { name: "Map", exact: true }).click();
  // Open the ONE Filter panel and pick 2024 in its Date section (chips derive
  // from the dated trips). The panel is modal, so close it before opening Layers.
  await page.locator(".map-ctl-right").getByRole("button", { name: /Filter/ }).click();
  const panel = page.getByRole("dialog", { name: "Filters" });
  await panel.getByRole("button", { name: "2024", exact: true }).click();
  await panel.getByRole("button", { name: "Done" }).click();

  // The Trips toggle (in the Layers panel) reflects the map's period; the
  // selection stays applied after the panel closes.
  await page.getByRole("button", { name: /Layers/ }).click();
  await expect(page.getByRole("button", { name: /Trips.*2024/ })).toBeVisible();
});

// If the trips underneath the filter change so the selected year vanishes, the
// stored period is reconciled back to "all" — no phantom <select> value, no
// silently-empty map.
test("filtering to a year whose trips are all deleted resets to all years", async ({ page }) => {
  await openApp(page);
  await gotoTab(page, "Trips");

  await addTrip(page, "CDG", "JFK", "2024-08-14");
  await addTrip(page, "LHR", "SFO", "2023-05-01");

  await page.locator("#trip-filter-year").selectOption("2024");
  await expect(page.locator(".travel-totals")).toContainText("1 trip");

  // Remove the only 2024 trip; the year no longer exists in the data.
  await page.getByRole("button", { name: "Remove trip CDG → JFK" }).click();

  // The filter self-heals to "All years" and the remaining 2023 trip is shown.
  await expect(page.locator("#trip-filter-year")).toHaveValue("all");
  await expect(page.getByText("LHR → SFO")).toBeVisible();
});
