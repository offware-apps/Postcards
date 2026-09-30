import { test, expect, type Page } from "@playwright/test";
import { gotoTab, openApp, markVisited, addTrip } from "./nav-helper";

// Spec 019 — Trip Reconstruction. Fast reconstruction: tap the places you've BEEN
// (list or map, with flags) to build an ordered chain of stops; the date is
// optional. Plus the Travel back-navigation fix.

async function openComposer(page: Page): Promise<void> {
  await gotoTab(page, "Trips");
  await page.getByRole("button", { name: "Reconstruct a journey" }).click();
  await expect(page.getByRole("heading", { name: "New trip" })).toBeVisible();
}

function kmOf(text: string | null): number {
  return Number((text ?? "").replace(/[^\d]/g, "")) || 0;
}

// US1 — build a multi-stop trip by tapping your visited places; save (no date); reopen.
test("build a multi-stop trip from your visited places", async ({ page }) => {
  await openApp(page);
  for (const city of ["Paris", "Tokyo", "London"]) await markVisited(page, city);
  await openComposer(page);

  // Tap three places from the list of where you've been.
  await page.getByRole("button", { name: "Add Paris to the trip" }).click();
  await page.getByRole("button", { name: "Add Tokyo to the trip" }).click();
  await page.getByRole("button", { name: "Add London to the trip" }).click();

  const stops = page.locator(".trip-stops li");
  await expect(stops).toHaveCount(3);
  await expect(stops.nth(0)).toContainText("Paris");
  await expect(stops.nth(2)).toContainText("London");

  // Reorder: move the last stop up.
  await page.getByRole("button", { name: /Move .*London.* up/ }).click();
  await expect(page.locator(".trip-stops li").nth(1)).toContainText("London");

  // Save with NO date (the date is optional / deferred).
  await page.getByRole("button", { name: "Save trip" }).click();
  await expect(page.getByRole("heading", { name: "Travel log" })).toBeVisible();
  await expect(page.getByText(/3 stops/)).toBeVisible();

  // Reopen it → the three stops are restored.
  await page.getByRole("button", { name: /Edit trip/ }).first().click();
  await expect(page.getByRole("heading", { name: "Edit trip" })).toBeVisible();
  await expect(page.locator(".trip-stops li")).toHaveCount(3);
});

// US1 — airports are reachable by search even with nothing logged yet (flights are
// central to reconstruction, and airports are rarely logged as visits).
test("airports are reachable by search with no prior visits", async ({ page }) => {
  await openApp(page);
  await openComposer(page); // fresh profile — no visited places

  const search = page.getByRole("searchbox");
  await search.fill("CDG");
  await page.getByRole("button", { name: /Add .*CDG.* to the trip/ }).first().click();
  await search.fill("JFK");
  await page.getByRole("button", { name: /Add .*JFK.* to the trip/ }).first().click();

  await expect(page.locator(".trip-stops li")).toHaveCount(2);
  await expect(page.locator(".trip-distance-km")).toContainText("km");
});

// US2 — the total distance shows and grows as stops are added.
test("distance is shown and updates live as stops change", async ({ page }) => {
  await openApp(page);
  for (const city of ["Paris", "Tokyo", "Berlin"]) await markVisited(page, city);
  await openComposer(page);

  await page.getByRole("button", { name: "Add Paris to the trip" }).click();
  await page.getByRole("button", { name: "Add Tokyo to the trip" }).click();
  const km = page.locator(".trip-distance-km");
  await expect.poll(async () => kmOf(await km.textContent())).toBeGreaterThan(4000); // Paris↔Tokyo ≈ 9,700 km
  const two = kmOf(await km.textContent());

  await page.getByRole("button", { name: "Add Berlin to the trip" }).click();
  await expect.poll(async () => kmOf(await km.textContent())).toBeGreaterThan(two); // adding a leg only grows the great-circle path
});

// US3 — opening an airport from the Travel screen and pressing Back returns to the
// Travel list (not a dead-end on the map). Seeded via the quick single-leg form.
test("Back from a Travel airport returns to the Travel list", async ({ page }) => {
  await openApp(page);
  await gotoTab(page, "Trips");

  // Quick single-leg trip between two airports → seeds the most-visited roll-up.
  await addTrip(page, "CDG", "JFK");
  await expect(page.locator(".travel-totals")).toContainText("1 trip");

  // Open an airport from the roll-up → its detail page (a page layer covers Travel).
  const rollup = page.locator(".airport-rollup");
  await rollup.getByRole("button").filter({ hasText: "CDG" }).first().click();
  await expect(page.getByRole("heading", { name: "Travel log" })).toHaveCount(0);

  // A single Escape returns to the Travel list — not the map, app never exits.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Travel log" })).toBeVisible();
});
