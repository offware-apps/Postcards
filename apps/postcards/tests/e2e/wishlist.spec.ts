import { test, expect } from "@playwright/test";
import { openApp } from "./nav-helper";

// Spec 016 follow-on — the want-list ("I want to go") is now first-class on the map:
// the same flag pill as visited (fixed elsewhere), and — proven here — removal via
// the shared StateToggles is UNDOABLE, so an accidental tap is never a silent loss.
test("removing a want-list city is undoable (shared toggle)", async ({ page }) => {
  await openApp(page);

  // Add London to the want-list from the search results' ⚑.
  await page.getByLabel("Search a city or country").fill("London");
  await page.getByRole("button", { name: "Add London to wishlist" }).first().click();

  // The same control now REMOVES it — and removal shows an undo toast, like visited.
  await page.getByRole("button", { name: "Remove London from wishlist" }).first().click();
  await expect(page.getByText("Removed London")).toBeVisible();

  // Undo restores the want-list record: the control offers "remove" again.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(
    page.getByRole("button", { name: "Remove London from wishlist" }).first(),
  ).toBeVisible();
});
