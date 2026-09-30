import { test, expect, type Page } from "@playwright/test";
import { gotoTab, openAppWithVisits } from "./nav-helper";

// Per-leg transport (spec 019): a journey can mix modes — fly one leg, take the
// train the next — and the per-leg choice survives save + reopen.
test("set a different transport per leg; it persists across save + reopen", async ({
  page,
}: {
  page: Page;
}) => {
  await openAppWithVisits(page, ["Paris", "Tokyo", "Osaka"]);
  await gotoTab(page, "Trips");
  await page.getByRole("button", { name: "Reconstruct a journey" }).click();
  await page.getByRole("button", { name: "Add Paris to the trip" }).click();
  await page.getByRole("button", { name: "Add Tokyo to the trip" }).click();
  await page.getByRole("button", { name: "Add Osaka to the trip" }).click();

  // Two legs → two per-leg pickers. Make the second leg (Tokyo → Osaka) a train.
  const legs = page.locator(".trip-leg-mode select");
  await expect(legs).toHaveCount(2);
  await legs.nth(0).selectOption("flight");
  await legs.nth(1).selectOption("train");

  await page.getByRole("button", { name: "Save trip" }).click();
  await expect(page.getByRole("heading", { name: "Travel log" })).toBeVisible();

  // Reopen → the per-leg choice is restored (flight, then train).
  await page.getByRole("button", { name: /Edit trip/ }).first().click();
  await expect(page.getByRole("heading", { name: "Edit trip" })).toBeVisible();
  const legs2 = page.locator(".trip-leg-mode select");
  await expect(legs2).toHaveCount(2);
  await expect(legs2.nth(0)).toHaveValue("flight");
  await expect(legs2.nth(1)).toHaveValue("train");
});
