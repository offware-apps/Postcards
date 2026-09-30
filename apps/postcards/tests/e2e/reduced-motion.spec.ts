import { test, expect } from "@playwright/test";
import { openApp } from "./nav-helper";

// The global reduced-motion rule reaches generated content too: the Settings
// disclosure arrow is a ::before that turns with a transition.
test("reduced motion stops transitions on generated content", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openApp(page);
  await page.getByRole("button", { name: "Settings" }).click();
  const duration = await page
    .locator(".settings-details > summary")
    .first()
    .evaluate((el) => getComputedStyle(el, "::before").transitionDuration);
  expect(parseFloat(duration)).toBeLessThan(0.01);
});
