import { test, expect, type Page } from "@playwright/test";
import { gotoTab } from "./nav-helper";

// Per-stop dates (spec 021): each waypoint in a reconstructed journey can carry the
// day you were there. The date belongs to the stop, so it survives save + reopen and
// travels with its stop when the chain is reordered.
test("set a date per stop; it persists across save + reopen", async ({
  page,
}: {
  page: Page;
}) => {
  await page.goto("/");
  for (const c of ["Paris", "Tokyo"]) {
    await page.getByLabel("Search a city or country").fill(c);
    await page.getByRole("button", { name: `Mark ${c} visited` }).first().click();
    await page.keyboard.press("Escape");
  }
  await gotoTab(page, "Trips");
  await page.getByRole("button", { name: "Reconstruct a journey" }).click();
  await page.getByRole("button", { name: "Add Paris to the trip" }).click();
  await page.getByRole("button", { name: "Add Tokyo to the trip" }).click();

  // One date input per stop. Date the two ends of the journey.
  const dates = page.locator(".trip-stop-date input");
  await expect(dates).toHaveCount(2);
  await dates.nth(0).fill("2024-05-01");
  await dates.nth(1).fill("2024-05-09");

  await page.getByRole("button", { name: "Save trip" }).click();
  await expect(page.getByRole("heading", { name: "Travel log" })).toBeVisible();

  // Reopen → each stop's date is restored.
  await page.getByRole("button", { name: /Edit trip/ }).first().click();
  await expect(page.getByRole("heading", { name: "Edit trip" })).toBeVisible();
  const dates2 = page.locator(".trip-stop-date input");
  await expect(dates2).toHaveCount(2);
  await expect(dates2.nth(0)).toHaveValue("2024-05-01");
  await expect(dates2.nth(1)).toHaveValue("2024-05-09");
});
