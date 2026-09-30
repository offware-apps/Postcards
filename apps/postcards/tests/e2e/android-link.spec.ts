import { test, expect } from "@playwright/test";

const APK = "https://github.com/offware-apps/Postcards/releases/download/android-latest/postcards.apk";

// The web build offers the Android app from Settings; the Android app itself,
// running inside Capacitor, does not offer itself.
test("Settings links to the Android app on the web", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Cities in view")).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();

  const link = page.getByRole("link", { name: /Get the Android app/ });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", APK);
  await expect(link).toHaveAttribute("title", /Android app/);
});

test("Settings shows no Android link inside the native app", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { CapacitorCustomPlatform: unknown }).CapacitorCustomPlatform = {
      name: "android",
      plugins: {},
    };
  });
  await page.goto("/");
  await expect(page.getByText("Cities in view")).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();

  await expect(page.getByRole("heading", { name: "Your data" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Get the Android app/ })).toHaveCount(0);
});
