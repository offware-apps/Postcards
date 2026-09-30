import { test, expect } from "@playwright/test";
import { openApp, markVisited } from "./nav-helper";

// End-to-end: an airport can be found by IATA code, logged, and shows up in the
// totals strip (as an "airports" counter) and the Places list — proving the new
// place kind is wired through search → store → stats → lists.
test("log an airport by IATA code and see it counted", async ({ page }) => {
  await openApp(page);

  // Search by IATA code; the top result is the matching airport. The row's
  // chip logs it (picking the row itself only flies the map there).
  await markVisited(page, "JFK", "John F Kennedy International Airport (JFK)");
  // Add is silent; verified by the totals strip + Places list below.

  // Totals strip gains an airports counter.
  await expect(page.locator(".stat-strip")).toContainText("airports");

  // Places lists the airport, labelled as one.
  await page.getByRole("button", { name: "Places", exact: true }).click();
  await expect(page.getByText(/JFK/).first()).toBeVisible();
  await expect(page.getByText(/Airport ·/).first()).toBeVisible();
});
