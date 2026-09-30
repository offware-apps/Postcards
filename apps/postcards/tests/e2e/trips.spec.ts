import { test, expect } from "@playwright/test";
import { gotoTab, openApp, addTrip } from "./nav-helper";

// End-to-end: log a journey in the Travel log via the two place pickers, and see
// it listed with a computed distance and reflected in the totals.
test("log a trip and see its distance in the totals", async ({ page }) => {
  await openApp(page);
  await gotoTab(page, "Trips");
  await expect(page.getByRole("heading", { name: "Travel log" })).toBeVisible();

  // Pick both airports by IATA code; the undo toast confirms the add.
  await addTrip(page, "CDG", "JFK");

  // Totals updated and the trip is listed with a km distance.
  await expect(page.locator(".travel-totals")).toContainText("1 trip");
  await expect(page.locator(".travel-totals")).toContainText("km");
  await expect(page.locator("li.city-row", { hasText: "CDG → JFK" })).toContainText(/·\s[\d,]+\skm/);
});
