import { test, expect } from "@playwright/test";
import { openApp, openAppWithVisits, markVisited } from "./nav-helper";

// Spec 016 — the ONE Filter panel. Every slicing dimension the map used to
// scatter across its header (status segmented, population row, sort, place-kind
// mode) now lives inside a single focus-trapped panel, and the active filters
// show as removable chips. These prove the consolidation and the summary.

test("the one Filter panel drives the map; the old inline controls are gone", async ({ page }) => {
  await openApp(page);

  // A visited city so the list has something to slice.
  await markVisited(page, "Paris");

  // The scattered per-dimension map controls are gone: no population row. The
  // place-kind switch (cities / monuments / airports) is its OWN prominent pill
  // now — different datasets, not one more filter — so it lives on the map, not
  // in the panel.
  await expect(page.locator(".pop-filter-row")).toHaveCount(0);
  const modePill = page.locator(".map-ctl-top");
  await expect(modePill).toBeVisible();
  await expect(modePill.getByRole("button", { name: /Monuments/ })).toBeVisible();

  // Open the one panel; it hosts every WITHIN-kind dimension (status, people,
  // date, folder, sort) — but NOT the place-kind mode (that's the pill above).
  await page.locator(".map-ctl-right").getByRole("button", { name: /Filter/ }).click();
  const panel = page.getByRole("dialog", { name: "Filters" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("button", { name: /Monuments/ })).toHaveCount(0);

  // Apply status = Want list and People = 1M+.
  await panel.getByRole("button", { name: "Want list", exact: true }).click();
  await panel.getByRole("button", { name: "1M+", exact: true }).click();
  await panel.getByRole("button", { name: "Done" }).click();

  // The applied filters render as a chip summary with a Clear all.
  const summary = page.locator(".filter-summary");
  await expect(summary).toBeVisible();
  await expect(summary).toContainText("Want list");
  await expect(summary).toContainText("1M+");
  await expect(summary.getByRole("button", { name: "Clear all" })).toBeVisible();

  // Reopening shows the applied values still selected (persisted preferences).
  await page.locator(".map-ctl-right").getByRole("button", { name: /Filter/ }).click();
  await expect(panel.getByRole("button", { name: "Want list", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(panel.getByRole("button", { name: "1M+", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // Escape closes the panel and restores focus.
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
});

test("'Lists only' scope stops the filter from touching the map", async ({ page }) => {
  await openApp(page);
  await markVisited(page, "Paris");

  const openFilter = () =>
    page.locator(".map-ctl-right").getByRole("button", { name: /Filter/ }).click();
  const panel = page.getByRole("dialog", { name: "Filters" });

  // Apply a filter — the map shows its chip summary.
  await openFilter();
  await panel.getByRole("button", { name: "1M+", exact: true }).click();
  await panel.getByRole("button", { name: "Done" }).click();
  await expect(page.locator(".filter-summary")).toContainText("1M+");

  // Switch scope to "Lists only" → the map is no longer filtered: its chip summary
  // disappears even though the filter is still set (Places would still apply it).
  await openFilter();
  await panel.getByRole("button", { name: "Lists only", exact: true }).click();
  await panel.getByRole("button", { name: "Done" }).click();
  await expect(page.locator(".filter-summary")).toHaveCount(0);

  // Back to "Map & lists" restores the map filter.
  await openFilter();
  await expect(panel.getByRole("button", { name: "Lists only", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await panel.getByRole("button", { name: "Map & lists", exact: true }).click();
  await panel.getByRole("button", { name: "Done" }).click();
  await expect(page.locator(".filter-summary")).toContainText("1M+");
});

test("status is MULTI-SELECT: pick any combination, deselect to show all", async ({ page }) => {
  await openApp(page);

  await page.locator(".map-ctl-right").getByRole("button", { name: /Filter/ }).click();
  const panel = page.getByRole("dialog", { name: "Filters" });
  await expect(panel).toBeVisible();

  // Nothing selected by default (= show everything).
  const visited = panel.getByRole("button", { name: "Visited", exact: true });
  const wishlist = panel.getByRole("button", { name: "Want list", exact: true });
  await expect(visited).toHaveAttribute("aria-pressed", "false");
  await expect(wishlist).toHaveAttribute("aria-pressed", "false");

  // Select TWO statuses at once — both stay pressed (checkbox-like toggles).
  await visited.click();
  await wishlist.click();
  await expect(visited).toHaveAttribute("aria-pressed", "true");
  await expect(wishlist).toHaveAttribute("aria-pressed", "true");
  await panel.getByRole("button", { name: "Done" }).click();

  // The summary lists both selected statuses.
  const summary = page.locator(".filter-summary");
  await expect(summary).toContainText("Visited");
  await expect(summary).toContainText("Want list");

  // Deselecting both returns to "show everything" — the status chip disappears.
  await page.locator(".map-ctl-right").getByRole("button", { name: /Filter/ }).click();
  await visited.click();
  await wishlist.click();
  await expect(visited).toHaveAttribute("aria-pressed", "false");
  await expect(wishlist).toHaveAttribute("aria-pressed", "false");
  await panel.getByRole("button", { name: "Done" }).click();
  await expect(page.locator(".filter-summary")).toHaveCount(0);
});

test("the place-kind pill switches the map's dataset", async ({ page }) => {
  await openApp(page);

  // Cities / monuments / airports are genuinely different data, so the switch is
  // a first-class map control (its own prominent pill), not a row in the Filter
  // panel. Tapping Monuments repaints the in-view list.
  const modePill = page.locator(".map-ctl-top");
  await modePill.getByRole("button", { name: /Monuments/ }).click();
  await expect(page.getByText("Monuments in view")).toBeVisible();

  // And back to Cities.
  await modePill.getByRole("button", { name: /Cities/ }).click();
  await expect(page.getByText("Cities in view")).toBeVisible();
});

test("chips remove one dimension; Clear all resets everything", async ({ page }) => {
  await openApp(page);
  await markVisited(page, "Paris");

  // Apply two dimensions.
  await page.locator(".map-ctl-right").getByRole("button", { name: /Filter/ }).click();
  const panel = page.getByRole("dialog", { name: "Filters" });
  await panel.getByRole("button", { name: "Want list", exact: true }).click();
  await panel.getByRole("button", { name: "1M+", exact: true }).click();
  await panel.getByRole("button", { name: "Done" }).click();

  const summary = page.locator(".filter-summary");
  await expect(summary).toContainText("Want list");
  await expect(summary).toContainText("1M+");

  // Removing the population chip resets only that dimension.
  await summary.getByRole("button", { name: "Remove 1M+ filter" }).click();
  await expect(summary).not.toContainText("1M+");
  await expect(summary).toContainText("Want list");

  // Clear all wipes the rest and hides the summary entirely.
  await summary.getByRole("button", { name: "Clear all" }).click();
  await expect(page.locator(".filter-summary")).toHaveCount(0);
});

test("Places shares the same Filter panel; population gates cities only (D4)", async ({ page }) => {
  await openApp(page);

  // A big city (>1M), a small city (<1M) and an airport (a non-city).
  await markVisited(page, "Tokyo");
  await markVisited(page, "Reykjavik", "Reykjavík");
  await markVisited(page, "JFK", "John F Kennedy International Airport (JFK)");

  // Places → Visited (default view) lists all three.
  await page.getByRole("button", { name: "Places", exact: true }).click();
  const list = page.locator(".city-list").first();
  await expect(list.getByText(/Tokyo/)).toBeVisible();
  await expect(list.getByText(/Reykjav/)).toBeVisible();
  await expect(list.getByText(/JFK/)).toBeVisible();

  // The SAME panel opens here — but Places owns status via its tabs, so the panel
  // has no Status section and no map-only place-kind Mode section.
  await page.locator(".places-filter-row").getByRole("button", { name: /Filter/ }).click();
  const panel = page.getByRole("dialog", { name: "Filters" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("button", { name: "Not visited" })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: /Monuments/ })).toHaveCount(0);

  // 1M+ people: the big city stays, the small city drops, and the airport (a
  // non-city) is untouched by the population threshold (spec 016 D4).
  await panel.getByRole("button", { name: "1M+", exact: true }).click();
  await panel.getByRole("button", { name: "Done" }).click();
  await expect(list.getByText(/Tokyo/)).toBeVisible();
  await expect(list.getByText(/JFK/)).toBeVisible();
  await expect(list.getByText(/Reykjav/)).toHaveCount(0);

  // The shared summary reflects it.
  await expect(page.locator(".filter-summary")).toContainText("1M+");
});

test("Places grows: Favorites-only narrows to starred places (spec 016 US4)", async ({ page }) => {
  // Two visited cities.
  await openAppWithVisits(page, ["Paris", "Tokyo"]);

  await page.getByRole("button", { name: "Places", exact: true }).click();
  const list = page.locator(".city-list").first();
  await expect(list.getByText(/Paris/)).toBeVisible();
  await expect(list.getByText(/Tokyo/)).toBeVisible();

  // Star Paris.
  await page.getByRole("button", { name: "Favorite Paris" }).click();

  // Open the panel → the growth "More" section → Favorites only.
  await page.locator(".places-filter-row").getByRole("button", { name: /Filter/ }).click();
  const panel = page.getByRole("dialog", { name: "Filters" });
  await panel.getByRole("button", { name: /Favorites only/ }).click();
  await panel.getByRole("button", { name: "Done" }).click();

  // Only the starred city remains; the chip shows it.
  await expect(list.getByText(/Paris/)).toBeVisible();
  await expect(list.getByText(/Tokyo/)).toHaveCount(0);
  await expect(page.locator(".filter-summary")).toContainText("Favorites only");
});
