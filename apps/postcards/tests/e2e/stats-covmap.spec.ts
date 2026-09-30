import { test, expect, type Page } from "@playwright/test";
import { gotoTab, openAppWithVisits, assertNoSeriousViolations } from "./nav-helper";

// Expanding a country card in Stats shows a STATIC coverage map (not the old text
// lists): the country silhouette with visited-city dots and "still to explore"
// region blobs. It's a role=img with a descriptive label, so it passes the a11y gate.
test("a country card shows a static coverage map that passes the a11y gate", async ({
  page,
}: {
  page: Page;
}) => {
  await openAppWithVisits(page, ["Paris", "Lyon", "Marseille"]);
  await gotoTab(page, "Stats");
  await page.locator(".country-summary", { hasText: "France" }).click();

  const map = page.locator(".country-card", { hasText: "France" }).locator(".country-cov-map svg");
  await expect(map).toBeVisible();
  await expect(map).toHaveAttribute("role", "img");
  // The silhouette + at least one visited dot rendered.
  await expect(map.locator("path.ccov-land")).toHaveCount(1);
  await expect.poll(() => map.locator("circle.ccov-visited").count()).toBeGreaterThan(0);

  await assertNoSeriousViolations(page, "stats country coverage map");
});
