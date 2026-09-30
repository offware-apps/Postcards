import { test, expect, type Page } from "@playwright/test";
import { gotoTab } from "./nav-helper";

// Spec 020, US1 — fast, keyboard-first capture. A postcard needs only a date +
// content; place is optional. `W` opens the focused composer dated today with the
// cursor in the content box; Ctrl+Enter saves; Ctrl+Shift+Enter saves & starts
// another. None of this requires a visited place.

test("keyboard-only: write a place-less postcard with zero visited places", async ({ page }: { page: Page }) => {
  await page.goto("/");
  // Land on Journal first (ensures the app is hydrated and focus is off the search),
  // then `W` opens the composer.
  await gotoTab(page, "Journal");
  await page.keyboard.press("w");
  await expect(page.locator(".story-composer")).toBeVisible();
  // The content field is focused on open — type straight away.
  await page.locator("#story-text").fill("A quiet, good day.");
  // Save with the keyboard chord.
  await page.keyboard.press("Control+Enter");
  await expect(page.locator(".story-composer")).toHaveCount(0);
  // It's in the feed, dated, with no place.
  await expect(page.getByText("A quiet, good day.")).toBeVisible();
});

test("'save & start another' writes several without leaving the page", async ({ page }: { page: Page }) => {
  await page.goto("/");
  await gotoTab(page, "Journal");
  await page.keyboard.press("w");
  await expect(page.locator(".story-composer")).toBeVisible();

  await page.locator("#story-text").fill("Entry one.");
  await page.keyboard.press("Control+Shift+Enter");
  // Still on the composer page, cleared and ready for the next.
  await expect(page.locator(".story-composer")).toBeVisible();
  await expect(page.locator("#story-text")).toHaveValue("");

  await page.locator("#story-text").fill("Entry two.");
  await page.keyboard.press("Control+Enter");
  await expect(page.locator(".story-composer")).toHaveCount(0);

  await gotoTab(page, "Journal");
  await expect(page.getByText("Entry one.")).toBeVisible();
  await expect(page.getByText("Entry two.")).toBeVisible();
});

test("a postcard with no content cannot be saved", async ({ page }: { page: Page }) => {
  await page.goto("/");
  await gotoTab(page, "Journal");
  await page.keyboard.press("w");
  const save = page.getByRole("button", { name: "Save postcard" });
  await expect(save).toBeDisabled();
  await page.locator("#story-text").fill("now it has content");
  await expect(save).toBeEnabled();
});

test("Escape closes the composer without saving and returns", async ({ page }: { page: Page }) => {
  await page.goto("/");
  await gotoTab(page, "Journal");
  await page.getByRole("button", { name: /Write a postcard/ }).click();
  await expect(page.locator(".story-composer")).toBeVisible();
  await page.locator("#story-text").fill("draft in progress");
  await page.keyboard.press("Escape");
  // Back on the Journal feed, nothing saved.
  await expect(page.locator(".story-composer")).toHaveCount(0);
  await expect(page.getByText("draft in progress")).toHaveCount(0);
});

test("long-press the Journal nav opens today's composer; a short tap opens the feed", async ({
  page,
}: {
  page: Page;
}) => {
  await page.goto("/");
  const journal = page.getByRole("button", { name: "Journal", exact: true });
  // Short tap → the feed (Journal tab).
  await journal.click();
  await expect(page.locator(".story-composer")).toHaveCount(0);
  await expect(journal).toHaveAttribute("aria-current", "page");

  // Press-and-hold → the composer.
  const box = (await journal.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
  await expect(page.locator(".story-composer")).toBeVisible();
});
