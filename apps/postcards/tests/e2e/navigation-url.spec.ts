import { test, expect } from "@playwright/test";

// The current screen lives in the address (#/places, #/places/country/FR), so a
// reload lands where you were and the browser's Back and Forward walk screens.
test("a reload keeps the tab and the open page; Back and Forward walk them", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/#\/map$/);
  await page.getByRole("button", { name: "Places", exact: true }).click();
  await expect(page).toHaveURL(/#\/places$/);
  await page.reload();
  await expect(page.getByRole("button", { name: "Places", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await page.getByLabel("Search a city or country").fill("France");
  await page.locator("#search-results .result-open", { hasText: "France" }).first().click();
  await expect(page).toHaveURL(/#\/places\/country\/FR$/);
  await page.reload();
  const heading = page.getByRole("heading", { name: /France/ }).first();
  await expect(heading).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/#\/places$/);
  await expect(heading).toBeHidden();
  await page.goForward();
  await expect(page).toHaveURL(/#\/places\/country\/FR$/);
  await expect(heading).toBeVisible();
});

test("Back at the home screen stays in the app", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Cities in view")).toBeVisible();
  await page.goBack();
  await page.goBack();
  await expect(page).toHaveURL(/localhost:4173\/#\/map$/);
  await expect(page.getByText("Cities in view")).toBeVisible();
});
