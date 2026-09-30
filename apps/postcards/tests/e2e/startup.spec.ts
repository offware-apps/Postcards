import { test, expect } from "@playwright/test";

// On a throttled phone nothing painted for ~7 s: the page waited for the
// bundle, MapLibre (pulled into the entry by its stylesheet and the trip
// composer's route map) and every reference file. The shell now paints from the
// HTML, MapLibre loads with the map, and the first render waits only for the
// cities and their regions.
test("the first paint needs neither MapLibre nor the airport and heritage lists", async ({
  page,
}) => {
  const html = await (await page.request.get("/")).text();
  expect(html).toMatch(/<div id="root"><div class="app"><header class="topbar">/);
  expect(html).not.toMatch(/maplibre/);
  const preloads = [...html.matchAll(/rel="preload" href="([^"]+)"/g)].map((m) => m[1]);
  expect(preloads).toEqual(["/reference/cities.json", "/reference/subdivisions.json"]);

  const entry = html.match(/<script type="module" crossorigin src="([^"]+)"/)![1]!;
  const js = await (await page.request.get(entry)).text();
  // A static import of the MapLibre chunk (the lazy ones sit in a preload map).
  expect(js).not.toMatch(/(from|import)\s*"\.\/maplibre-/);
});

test("a reload onto Trips shows it once the airports have landed", async ({ page }) => {
  await page.goto("/#/trips");
  await expect(page.getByRole("button", { name: "Trips", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByText("Loading…")).toBeHidden();
  await expect(page.locator("main .screen")).toBeVisible();
});
