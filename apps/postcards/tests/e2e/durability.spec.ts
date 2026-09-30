import { test, expect } from "@playwright/test";
import { openApp, markVisited } from "./nav-helper";

// US7 / FR-028..031, SC-010: long-term memory. Once there is data worth losing,
// the "Your data" screen must surface a durability status so a user is never
// silently one browser-reset away from losing everything. (Restore-from-backup is
// covered by the import specs + unit tests; persistence granting is
// environment-dependent, so here we assert the always-present protection status.)
test("the durability status appears once there's data to protect", async ({ page }) => {
  await openApp(page);

  // Log a place so there is data.
  await markVisited(page, "Rome");

  // Settings → Your data shows the protection status line.
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Your data" })).toBeVisible();
  const note = page.locator(".durability-note");
  await expect(note).toBeVisible();
  // It states either "saved on this device" (granted) or the at-risk warning, and
  // always a last-backup read.
  await expect(note).toContainText(/device|clear your data/i);
});
