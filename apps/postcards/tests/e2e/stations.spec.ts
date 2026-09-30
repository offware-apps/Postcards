import { test, expect, type Page } from "@playwright/test";
import { gotoTab } from "./nav-helper";

// Spec 021, US1 — find and mark a railway station VISITED, fully offline, from the
// bundled Trainline dataset. Zero network egress. ("Lyon Part-Dieu" is a stable,
// uniquely-named entry in the bundled data.)

test("offline: search a station, mark it visited, zero external requests", async ({
  page,
  baseURL,
}: {
  page: Page;
  baseURL?: string;
}) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("postcards-offline-mode", "1");
      localStorage.setItem("postcards-intro-seen", "1");
    } catch {
      /* private mode */
    }
  });

  const external: string[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (url.startsWith(baseURL!) || url.startsWith("data:") || url.startsWith("blob:")) return;
    external.push(url);
  });

  await page.goto("/");
  await expect(page.getByText("Cities in view")).toBeVisible();

  await page.getByLabel("Search a city or country").fill("Part-Dieu");
  await page.getByRole("button", { name: "Mark Lyon Part-Dieu visited" }).first().click();
  await page.keyboard.press("Escape");

  // It's a visited place, listed with the station glyph.
  await gotoTab(page, "Places");
  await expect(page.getByText("Lyon Part-Dieu")).toBeVisible();

  await page.waitForTimeout(500);
  expect(external, `station flow external requests: ${external.join(", ")}`).toEqual([]);
});

// Spec 021, US2/US3 — a logged station flows through to the totals strip (its own
// counter), the map's Stations mode, and the Places browse kind.
test("a visited station surfaces in the strip, map mode, and Places browse", async ({
  page,
}: {
  page: Page;
}) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("postcards-offline-mode", "1");
      localStorage.setItem("postcards-intro-seen", "1");
    } catch {
      /* private mode */
    }
  });

  await page.goto("/");
  await expect(page.getByText("Cities in view")).toBeVisible();

  await page.getByLabel("Search a city or country").fill("Part-Dieu");
  await page.getByRole("button", { name: "Mark Lyon Part-Dieu visited" }).first().click();
  await page.keyboard.press("Escape");

  // Totals strip gains a stations counter.
  await expect(page.locator(".stat-strip")).toContainText("stations");

  // The map's Stations mode heads its in-view list accordingly.
  await page.locator(".map-mode").getByRole("button", { name: "Stations" }).click();
  await expect(page.getByText("Stations in view")).toBeVisible();

  // Places browses the world of stations by kind; search narrows the (large) set.
  await gotoTab(page, "Places");
  await page.getByRole("group", { name: /kind/i }).getByRole("button", { name: "Stations" }).click();
  await page.getByRole("searchbox").fill("Part-Dieu");
  await expect(page.getByText("Lyon Part-Dieu").first()).toBeVisible();
});

// Spec 021, US4 — a station is a reachable trip stop (you travel between stations),
// found by search in the journey composer, with the leg distance measured.
test("stations are reachable as train trip stops", async ({ page }: { page: Page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("postcards-offline-mode", "1");
      localStorage.setItem("postcards-intro-seen", "1");
    } catch {
      /* private mode */
    }
  });

  await page.goto("/");
  await expect(page.getByText("Cities in view")).toBeVisible();

  await gotoTab(page, "Trips");
  await page.getByRole("button", { name: "Reconstruct a journey" }).click();
  await expect(page.getByRole("heading", { name: "New trip" })).toBeVisible();

  const search = page.getByRole("searchbox");
  await search.fill("Gare de Lyon");
  await page.getByRole("button", { name: /Add .*Gare de Lyon.* to the trip/ }).first().click();
  await search.fill("Part-Dieu");
  await page.getByRole("button", { name: /Add .*Part-Dieu.* to the trip/ }).first().click();

  await expect(page.locator(".trip-stops li")).toHaveCount(2);
  await expect(page.locator(".trip-distance-km")).toContainText("km");
});

// The Settings data-source picker: people choose which station dataset they load.
// Trainline is the recommended default; switching to "None" unloads them live.
test("Settings: choosing 'None' unloads station data", async ({ page }: { page: Page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("postcards-offline-mode", "1");
      localStorage.setItem("postcards-intro-seen", "1");
    } catch {
      /* private mode */
    }
  });

  await page.goto("/");
  await expect(page.getByText("Cities in view")).toBeVisible();

  // Default (Trainline recommended): the station is searchable.
  await page.getByLabel("Search a city or country").fill("Part-Dieu");
  await expect(page.getByRole("button", { name: "Mark Lyon Part-Dieu visited" }).first()).toBeVisible();

  // Switch the railway-station source to None in Settings.
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("Railway stations").selectOption("none");

  // Back on the map, the station is gone from search (data unloaded, no reload).
  await page.getByRole("button", { name: "Map", exact: true }).click();
  const search = page.getByLabel("Search a city or country");
  await search.fill("");
  await search.fill("Part-Dieu");
  await expect(page.getByRole("button", { name: "Mark Lyon Part-Dieu visited" })).toHaveCount(0);
});
