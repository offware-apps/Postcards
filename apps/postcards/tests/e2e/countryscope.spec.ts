import { test, expect } from "@playwright/test";
import { gotoTab, openApp, markVisited } from "./nav-helper";

// "What counts as a country" — switching the scope changes both the count of
// visited countries and the world denominator, dropping dependent territories.
test("count with or without dependent territories", async ({ page }) => {
  await openApp(page);

  // Countries are visited via places inside them: a city in a UN member
  // (Paris → France) and one in a territory (Hong Kong city → Hong Kong).
  await markVisited(page, "Paris");
  await markVisited(page, "Hong Kong");

  await gotoTab(page, "Stats");

  // Default scope counts both, against the full countries + territories list.
  // The count lives in the "Countries" headline bar; the active scope shows in
  // its denominator (the full list incl. territories vs UN members only).
  const countriesBar = page.locator(".stat-bar").first();
  const countNum = countriesBar.locator(".stat-bar-fig strong");
  await expect(countNum).toHaveText("2");
  await expect(countriesBar).toContainText("250"); // full countries & territories

  // Switch to UN members only (segmented toggle) → Hong Kong (a territory)
  // drops from the count, and the denominator shrinks to the UN list.
  await page.getByRole("button", { name: "UN · 193" }).first().click();
  await expect(countNum).toHaveText("1");
  await expect(countriesBar).toContainText("193"); // UN member states only
  await expect(countriesBar).not.toContainText("250");
});
