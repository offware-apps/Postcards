import { test, expect } from "@playwright/test";

// A chunk that fails to download (a dropped connection mid-boot) must leave a
// way out, never a blank page: the failed part says so and offers a reload.

test("the app's code failing to download shows a reload screen", async ({ page }) => {
  let blocked = true;
  await page.route("**/assets/App-*.js", (route) =>
    blocked ? route.abort("internetdisconnected") : route.continue(),
  );
  await page.goto("/");

  const failure = page.getByRole("alert");
  await expect(failure).toContainText("Part of Postcards did not load");
  const reload = failure.getByRole("button", { name: "Reload" });
  await expect(reload).toHaveAttribute("title", "Reload Postcards and try again");

  // Once the connection is back, the reload boots the app.
  blocked = false;
  await reload.click();
  await expect(page.getByText("Cities in view")).toBeVisible({ timeout: 15_000 });
});

test("the entry itself failing to download shows the boot guard's reload screen", async ({ page }) => {
  // The module graph never runs, so only public/boot-guard.js can say so.
  let blocked = true;
  await page.route("**/assets/index-*.js", (route) =>
    blocked ? route.abort("internetdisconnected") : route.continue(),
  );
  await page.goto("/");

  const failure = page.getByRole("alert");
  await expect(failure).toBeInViewport();
  await expect(failure).toContainText("Part of Postcards did not load");
  const reload = failure.getByRole("button", { name: "Reload" });
  await expect(reload).toHaveAttribute("title", "Reload Postcards and try again");

  blocked = false;
  await reload.click();
  await expect(page.getByText("Cities in view")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#boot-failure")).toHaveCount(0);
});

test("the boot guard never shows on a boot that is only slow", async ({ page }) => {
  // Every script arrives late, well past the error path but inside the timeout.
  await page.route("**/assets/*.js", async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await page.goto("/");
  await expect(page.getByText("Cities in view")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#boot-failure")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("the map's code failing to download keeps the rest of the app up", async ({ page }) => {
  await page.route("**/assets/MapScreen-*.js", (route) => route.abort("internetdisconnected"));
  await page.goto("/");

  await expect(page.getByRole("alert")).toContainText("Part of Postcards did not load");
  // The app had mounted, so the boot guard stood down and adds no second message.
  await expect(page.locator("#boot-failure")).toHaveCount(0);
  // Only the map is replaced: search and the other sections still work.
  await expect(page.getByLabel("Search a city or country")).toBeVisible();
  await page.getByRole("button", { name: "Stats", exact: true }).click();
  await expect(page.getByText("Statistics")).toBeVisible();
});
