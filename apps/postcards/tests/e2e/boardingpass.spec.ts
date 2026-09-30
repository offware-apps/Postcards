import { test, expect } from "@playwright/test";
import { gotoTab, openApp } from "./nav-helper";

// End-to-end: paste a boarding-pass (BCBP) code, and the trip form is prefilled
// with the resolved airports so it can be saved as a logged flight.
test("import a trip from a pasted boarding-pass code", async ({ page }) => {
  await openApp(page);
  await gotoTab(page, "Trips");

  await page.getByRole("button", { name: /Add from a boarding pass/ }).click();
  await page
    .getByLabel("Boarding-pass code")
    .fill("M1DESMARAIS/LUC       EABC123 YULFRAAC 0834 226F001A0025 100");
  await page.getByRole("button", { name: "Read pass" }).click();

  // Parsed on-device: a confirmation toast, and the form now holds YUL → FRA.
  await expect(page.getByText(/Read YUL → FRA/)).toBeVisible();
  await page.getByRole("button", { name: "Add trip" }).click();

  await expect(page.locator(".travel-totals")).toContainText("1 trip");
  await expect(page.getByText(/YUL → FRA/).first()).toBeVisible();
});
