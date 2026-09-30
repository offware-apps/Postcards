import { test, expect, type Page } from "@playwright/test";
import { gotoTab } from "./nav-helper";

// Spec 020, US4 — "near you" auto-suggests places on open, opt-in and degrading.

test.describe("with location granted", () => {
  test.use({ permissions: ["geolocation"], geolocation: { latitude: 48.8566, longitude: 2.3522 } });

  test("suggests nearby places on open and attaches one in a tap", async ({ page }: { page: Page }) => {
    await page.goto("/");
    await gotoTab(page, "Journal");
    await page.keyboard.press("w");
    await page.getByText("Add details", { exact: true }).click();

    const nearby = page.locator(".story-nearby");
    await expect(nearby).toBeVisible(); // a location fix produced suggestions
    await nearby.locator("button.mini-btn").first().click();

    // Attaching a suggestion sets the place and dismisses the list.
    await expect(nearby).toHaveCount(0);
    expect(await page.locator("#story-place").inputValue()).not.toBe("");
  });
});

test.describe("with location unavailable", () => {
  test("no error, place stays optional, composer fully usable", async ({ page }: { page: Page }) => {
    await page.goto("/");
    await gotoTab(page, "Journal");
    await page.keyboard.press("w");
    await page.getByText("Add details", { exact: true }).click();

    // No permission granted → no suggestions, no error, place stays optional.
    await expect(page.locator(".story-nearby")).toHaveCount(0);
    await page.locator("#story-text").fill("no location needed");
    await expect(page.getByRole("button", { name: "Save postcard" })).toBeEnabled();
  });
});
