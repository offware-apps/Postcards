import { test, expect } from "@playwright/test";
import { openApp } from "./nav-helper";

// US5: the core flow is fully keyboard-operable.
test("add a visit and browse with the keyboard only", async ({ page }) => {
  await openApp(page);

  // "/" focuses the search input.
  await page.keyboard.press("/");
  await expect(page.getByLabel("Search a city or country")).toBeFocused();

  // Type, arrow to the first option, Shift+Enter to add (plain Enter only
  // shows the place — adding is always explicit).
  await page.keyboard.type("tokyo");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.press("Escape");

  // Leave the input, then switch tabs with number keys (5 = Stats, 2 = Places).
  await page.getByRole("heading", { name: "Postcards" }).click();
  await page.keyboard.press("5");
  await expect(page.getByText("Statistics")).toBeVisible();
  await expect(page.locator(".country-summary", { hasText: "Japan" })).toBeVisible();

  await page.keyboard.press("2");
  await expect(page.getByRole("button", { name: "Countries" })).toBeVisible();

  // "?" opens the shortcuts overlay; Escape closes it.
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
