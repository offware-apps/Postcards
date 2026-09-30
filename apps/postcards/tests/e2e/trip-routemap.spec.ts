import { test, expect, type Page } from "@playwright/test";
import { gotoTab } from "./nav-helper";

// The composer's real map picker (RouteMap): switching to the Map segment mounts an
// actual MapLibre canvas (not the old SVG), and the companion list beneath it — the
// keyboard/AT path — still builds the route, with the live arc reflecting each add.

async function markVisited(page: Page, city: string): Promise<void> {
  await page.getByLabel("Search a city or country").fill(city);
  await page.getByRole("button", { name: `Mark ${city} visited` }).first().click();
  await page.keyboard.press("Escape");
}

test("Map segment shows a real MapLibre map; the companion list builds the route", async ({
  page,
}: {
  page: Page;
}) => {
  await page.goto("/");
  for (const city of ["Paris", "Tokyo", "Osaka"]) await markVisited(page, city);

  await gotoTab(page, "Trips");
  await page.getByRole("button", { name: "Reconstruct a journey" }).click();
  await expect(page.getByRole("heading", { name: "New trip" })).toBeVisible();

  // Switch the picker to the Map segment (scoped to the picker — the bottom-nav
  // also has a "Map" tab).
  await page.locator(".myplaces-picker").getByRole("button", { name: /Map/ }).click();

  // A REAL MapLibre map mounts — its WebGL canvas is present inside our sized box.
  const canvas = page.locator(".route-map-canvas canvas.maplibregl-canvas");
  await expect(canvas).toBeVisible();

  // Build the route via the companion list (the keyboard/AT mirror of the pins).
  await page.getByRole("button", { name: "Add Paris to the trip" }).click();
  await page.getByRole("button", { name: "Add Tokyo to the trip" }).click();
  const stops = page.locator(".trip-stops li");
  await expect(stops).toHaveCount(2);

  // Save and confirm the trip landed (a 2-stop trip reads as "Paris → Tokyo").
  await page.getByRole("button", { name: "Save trip" }).click();
  await expect(page.getByRole("heading", { name: "Travel log" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Edit trip/ }).first()).toBeVisible();
  await expect(page.getByText("Tokyo", { exact: false }).first()).toBeVisible();
});

test("the map's city/airport filter narrows the pins (and the companion list)", async ({
  page,
}: {
  page: Page;
}) => {
  await page.goto("/");
  for (const city of ["Paris", "Tokyo", "Osaka"]) await markVisited(page, city);

  await gotoTab(page, "Trips");
  await page.getByRole("button", { name: "Reconstruct a journey" }).click();
  await page.locator(".myplaces-picker").getByRole("button", { name: /Map/ }).click();

  const list = page.locator(".route-map-list li");
  const filter = page.locator(".route-map-filter");
  // All three visited cities are pins by default.
  await expect(list).toHaveCount(3);

  // Filtering to Airports empties the list (nothing but cities was visited)…
  await filter.getByRole("button", { name: "Airports" }).click();
  await expect(list).toHaveCount(0);
  // …and Cities brings them back.
  await filter.getByRole("button", { name: "Cities" }).click();
  await expect(list).toHaveCount(3);
});
