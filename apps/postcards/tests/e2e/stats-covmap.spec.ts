import { test, expect, type Page } from "@playwright/test";
import { gotoTab } from "./nav-helper";
import AxeBuilder from "@axe-core/playwright";

async function assertNoSeriousViolations(page: Page, screen: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const serious = results.violations.filter((v) => ["serious", "critical"].includes(v.impact ?? ""));
  expect(serious, `${screen}: ${serious.map((v) => v.id).join(", ")}`).toEqual([]);
}

// Expanding a country card in Stats shows a coverage map (not the old text lists):
// the country silhouette with visited-city dots and "still to explore" region
// blobs. The whole map is a BUTTON that opens the country's full page; the SVG is
// decorative (aria-hidden) and the button carries the descriptive label, so AT
// hears one clear action and the a11y gate passes.
test("a country card's coverage map is a labelled button that opens the country page", async ({
  page,
}: {
  page: Page;
}) => {
  await page.goto("/");
  for (const c of ["Paris", "Lyon", "Marseille"]) {
    await page.getByLabel("Search a city or country").fill(c);
    await page.getByRole("button", { name: `Mark ${c} visited` }).first().click();
    await page.keyboard.press("Escape");
  }
  await gotoTab(page, "Stats");
  await page.locator(".country-summary", { hasText: "France" }).click();

  const card = page.locator(".country-card", { hasText: "France" });
  const mapBtn = card.locator("button.country-cov-map");
  await expect(mapBtn).toBeVisible();
  // The button (not the svg) carries the accessible name; the svg is decorative.
  await expect(mapBtn).toHaveAccessibleName(/France/);
  const svg = mapBtn.locator("svg");
  await expect(svg).toHaveAttribute("aria-hidden", "true");
  // The silhouette + at least one visited dot rendered.
  await expect(svg.locator("path.ccov-land")).toHaveCount(1);
  expect(await svg.locator("circle.ccov-visited").count()).toBeGreaterThan(0);

  await assertNoSeriousViolations(page, "stats country coverage map");

  // Tapping the map opens France's full page.
  await mapBtn.click();
  await expect(page.getByRole("heading", { name: "France", level: 2 })).toBeVisible();
});
