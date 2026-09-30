import { test, expect, type Page } from "@playwright/test";
import { gotoTab, openApp, markVisited } from "./nav-helper";

// The composer's real map picker (RouteMap): switching to the Map segment mounts an
// actual MapLibre canvas (not the old SVG), and the companion list beneath it — the
// keyboard/AT path — still builds the route, with the live arc reflecting each add.

test("Map segment shows a real MapLibre map; the companion list builds the route", async ({
  page,
}: {
  page: Page;
}) => {
  await openApp(page);
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
