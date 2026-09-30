import { test, expect } from "@playwright/test";
import { openApp, markVisited } from "./nav-helper";

// A places CSV (the app's own export shape) imports by MERGING — it adds places
// and never erases what you already have. No confirm dialog on this path.
const CSV = [
  "lat;lon;country;city;been",
  '35.6895;139.69171;"jp";"Tokyo";"been"',
  '39.9075;116.39723;"cn";"Beijing";"want"',
  '48.85341;2.3488;"fr";"Paris";"been,fave"',
].join("\n");

test("import a places CSV — merges without erasing, no confirm", async ({ page }) => {
  // Any confirm() would mean this path treated the merge as destructive.
  page.on("dialog", (d) => {
    throw new Error(`Unexpected dialog on CSV import: ${d.message()}`);
  });
  await openApp(page);

  // Seed one existing visit that the CSV does NOT mention — it must survive.
  await markVisited(page, "Lisbon");

  await page.getByRole("button", { name: "Settings" }).click();
  // The Backup import is the only file input that accepts CSV — target it
  // directly so a sibling file input (e.g. data packs) can never shadow it.
  await page.locator('input[type="file"][accept*="csv"]').setInputFiles({
    name: "places_export.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(CSV),
  });
  await expect(page.locator(".notice-ok")).toContainText(/Added 3 places/);

  // The imported places show up, and the pre-existing one is untouched.
  await page.getByRole("button", { name: "Places", exact: true }).click();
  await expect(page.getByText("Tokyo", { exact: true })).toBeVisible();
  await expect(page.getByText("Lisbon", { exact: true })).toBeVisible(); // not erased

  // Beijing was tagged "want" → it lands on the Wishlist, not Visited.
  await page.getByRole("button", { name: /Wishlist/ }).click();
  await expect(page.getByText("Beijing", { exact: true })).toBeVisible();
});
