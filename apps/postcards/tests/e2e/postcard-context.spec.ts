import { test, expect, type Page } from "@playwright/test";
import { gotoTab } from "./nav-helper";

// Spec 020, US2 — optional context by keyboard. Here: mood/weather + free tags,
// each optional, round-tripping through save + edit, and filtering the feed.

test("add mood + free tags, filter by one, and round-trip on edit", async ({ page }: { page: Page }) => {
  await page.goto("/");
  await gotoTab(page, "Journal");
  await page.keyboard.press("w");
  await expect(page.locator(".story-composer")).toBeVisible();
  await page.locator("#story-text").fill("Museum, then a long walk.");

  // Reveal the optional context, add a preset tag + a typed tag, remove one.
  await page.getByText("Add details", { exact: true }).click();
  await page.getByRole("button", { name: "☀️ sunny" }).click();
  const tagInput = page.getByPlaceholder("Add a tag and press Enter…");
  await tagInput.fill("with Léa");
  await tagInput.press("Enter");
  await expect(page.locator(".story-tag")).toHaveCount(2);
  // Remove the preset one.
  await page.getByRole("button", { name: "Remove tag ☀️ sunny" }).click();
  await expect(page.locator(".story-tag")).toHaveCount(1);

  await page.getByRole("button", { name: "Save postcard" }).click();
  await expect(page.locator(".story-composer")).toHaveCount(0);

  // The surviving tag shows on the card and filters the feed when tapped.
  const chip = page.getByRole("button", { name: "with Léa" });
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(page.getByText("Museum, then a long walk.")).toBeVisible();

  // Editing the postcard shows the tag again (round-trip).
  await page.getByRole("button", { name: "Edit" }).first().click();
  await expect(page.locator(".story-composer")).toBeVisible();
  await page.getByText("Add details", { exact: true }).click();
  await expect(page.getByText("with Léa", { exact: false })).toBeVisible();
});
