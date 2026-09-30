import { test, expect } from "@playwright/test";
import { gotoTab } from "./nav-helper";
import AxeBuilder from "@axe-core/playwright";

// WCAG 2.1 AA gate (SC-005): no serious/critical axe violations on any screen.
async function assertNoSeriousViolations(page: import("@playwright/test").Page, screen: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const serious = results.violations.filter((v) =>
    ["serious", "critical"].includes(v.impact ?? ""),
  );
  expect(
    serious,
    `${screen}: ${serious.map((v) => `${v.id} (${v.nodes.length} nodes)`).join(", ")}`,
  ).toEqual([]);
}

test("the postcard composer passes the axe WCAG 2.1 AA gate", async ({ page }) => {
  await page.goto("/");
  await gotoTab(page, "Journal");
  await page.getByRole("button", { name: /Write a postcard/ }).click();
  await expect(page.locator(".story-composer")).toBeVisible();
  // Expand the optional "add details" so those controls are audited too.
  await page.getByText("Add details", { exact: true }).click();
  await assertNoSeriousViolations(page, "postcard composer");
});

test("map, stats and places screens pass the axe WCAG 2.1 AA gate", async ({ page }) => {
  await page.goto("/");

  // Seed one visit so lists/bars render (the row's chip is the explicit add).
  await page.getByLabel("Search a city or country").fill("Lisbon");
  await page.getByRole("button", { name: "Mark Lisbon visited" }).first().click();
  await page.keyboard.press("Escape");

  await expect(page.getByText("Cities in view")).toBeVisible();
  await assertNoSeriousViolations(page, "map");

  // The ONE Filter panel (spec 016) must also pass the gate; Escape must close it
  // and restore focus to the opener.
  await page.locator(".map-ctl-right").getByRole("button", { name: /Filter/ }).click();
  await expect(page.getByRole("dialog", { name: "Filters" })).toBeVisible();
  await assertNoSeriousViolations(page, "filter panel");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Filters" })).toBeHidden();

  await gotoTab(page, "Stats");
  await expect(page.getByText("Statistics")).toBeVisible();
  await assertNoSeriousViolations(page, "stats");

  await page.getByRole("button", { name: "Places", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Places" })).toBeVisible();
  await assertNoSeriousViolations(page, "places");

  await page.getByRole("button", { name: "Passport", exact: true }).click();
  await expect(page.getByText("flags collected")).toBeVisible();
  await assertNoSeriousViolations(page, "passport");

  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Your data" })).toBeVisible();
  await assertNoSeriousViolations(page, "settings");
});

// Spec 019: the multi-stop trip composer must pass the same gate, with its place
// picker, stop list, reorder controls, and distance readout all present.
test("the trip composer passes the axe WCAG 2.1 AA gate", async ({ page }) => {
  await page.goto("/");
  // Seed visited places so the picker has something to tap.
  for (const city of ["Paris", "Tokyo"]) {
    await page.getByLabel("Search a city or country").fill(city);
    await page.getByRole("button", { name: `Mark ${city} visited` }).first().click();
    await page.keyboard.press("Escape");
  }
  await gotoTab(page, "Trips");
  await page.getByRole("button", { name: "Reconstruct a journey" }).click();
  await expect(page.getByRole("heading", { name: "New trip" })).toBeVisible();

  await page.getByRole("button", { name: "Add Paris to the trip" }).click();
  await page.getByRole("button", { name: "Add Tokyo to the trip" }).click();
  await expect(page.locator(".trip-stops li")).toHaveCount(2);

  await assertNoSeriousViolations(page, "trip composer (list)");

  // The map pick mode (the real MapLibre RouteMap) must also pass the gate.
  await page
    .getByRole("group", { name: "How to pick places" })
    .getByRole("button", { name: "Map" })
    .click();
  await expect(page.locator(".route-map-canvas canvas.maplibregl-canvas")).toBeVisible();
  await assertNoSeriousViolations(page, "trip composer (map)");
});
