import { test, expect, type Page } from "@playwright/test";
import { gotoTab } from "./nav-helper";

// Spec 020, US3 — a postcard can span several places and a date range.

async function mark(page: Page, city: string): Promise<void> {
  await page.getByLabel("Search a city or country").fill(city);
  await page.getByRole("button", { name: `Mark ${city} visited` }).first().click();
  await page.keyboard.press("Escape");
}

test("a postcard spans two places and a date range; it shows under each place", async ({
  page,
}: {
  page: Page;
}) => {
  await page.goto("/");
  for (const c of ["Paris", "Lyon"]) await mark(page, c);

  await gotoTab(page, "Journal");
  await page.keyboard.press("w");
  await expect(page.locator(".story-composer")).toBeVisible();
  await page.locator("#story-text").fill("Paris then Lyon by train.");
  await page.locator("#story-date").fill("2024-05-01");

  await page.getByText("Add details", { exact: true }).click();
  // Primary place = Paris; add Lyon as an extra place (resolve each option's value).
  const parisVal = await page.locator("#story-place option", { hasText: "Paris" }).getAttribute("value");
  await page.locator("#story-place").selectOption(parisVal!);
  const lyonVal = await page.locator("#story-extra-place option", { hasText: "Lyon" }).getAttribute("value");
  await page.locator("#story-extra-place").selectOption(lyonVal!);
  await expect(page.locator(".story-tag")).toHaveCount(1); // Lyon chip
  // A later end date makes it a range.
  await page.locator("#story-enddate").fill("2024-05-05");

  await page.getByRole("button", { name: "Save postcard" }).click();
  await expect(page.locator(".story-composer")).toHaveCount(0);

  // The feed shows the span.
  await expect(page.getByText(/May 1, 2024.*May 5, 2024/)).toBeVisible();

  // "By place" lists the postcard under BOTH Paris and Lyon (match the group
  // SUMMARIES, which carry only the place name — the entry text mentions both).
  await page.getByRole("button", { name: /By place/ }).click();
  await expect(page.locator(".journal-place-summary", { hasText: "Paris" })).toHaveCount(1);
  await expect(page.locator(".journal-place-summary", { hasText: "Lyon" })).toHaveCount(1);
});
