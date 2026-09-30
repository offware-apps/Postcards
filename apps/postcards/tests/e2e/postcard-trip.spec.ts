import { test, expect, type Page } from "@playwright/test";
import { gotoTab } from "./nav-helper";

// Spec 020, T026 — a postcard linked to a reconstructed trip is listed on that
// trip's page (the multi-stop trip composer), read-only, tap to open the postcard.

async function mark(page: Page, city: string): Promise<void> {
  await page.getByLabel("Search a city or country").fill(city);
  await page.getByRole("button", { name: `Mark ${city} visited` }).first().click();
  await page.keyboard.press("Escape");
}

test("a postcard linked to a trip shows on the trip's page", async ({ page }: { page: Page }) => {
  await page.goto("/");
  for (const c of ["Paris", "Tokyo"]) await mark(page, c);

  // Reconstruct a multi-stop trip (opens the composer page on edit).
  await gotoTab(page, "Trips");
  await page.getByRole("button", { name: "Reconstruct a journey" }).click();
  await page.getByRole("button", { name: "Add Paris to the trip" }).click();
  await page.getByRole("button", { name: "Add Tokyo to the trip" }).click();
  await page.getByRole("button", { name: "Save trip" }).click();

  // Write a postcard and link it to that trip.
  await gotoTab(page, "Journal");
  await page.keyboard.press("w");
  await page.locator("#story-title").fill("Flight day");
  await page.locator("#story-text").fill("Long haul across the Pacific.");
  await page.getByText("Add details", { exact: true }).click();
  await page.locator("#story-trip").selectOption({ index: 1 }); // 0 is "— no trip —"
  await page.getByRole("button", { name: "Save postcard" }).click();
  await expect(page.locator(".story-composer")).toHaveCount(0);

  // Open the trip → its linked postcard is listed.
  await gotoTab(page, "Trips");
  await page.getByRole("button", { name: /Edit trip/ }).first().click();
  await expect(page.getByRole("heading", { name: "Postcards from this trip" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Flight day/ })).toBeVisible();
});
