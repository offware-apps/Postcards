import { test, expect } from "@playwright/test";
import { openApp } from "./nav-helper";

// US2 / FR-007, SC-003: picking a place anywhere (here: the top-bar search) flies
// the map AND selects it in the in-view list. We assert with a city that's in the
// default world view (Istanbul), so the selection is observable without depending
// on headless MapLibre recomputing bounds after a programmatic fly.
test("searching a place selects its row in the map list", async ({ page }) => {
  await openApp(page);

  await page.getByLabel("Search a city or country").fill("Istanbul");
  // Pick "show on the map" (never the mark-visited button).
  await page.locator(".result-open").first().click();

  const selected = page.locator(".city-row.selected");
  await expect(selected).toHaveCount(1);
  await expect(selected).toContainText("Istanbul");
});
