import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import { gotoTab, openAppWithVisits } from "./nav-helper";

// A backup is only a backup if it comes back whole. Build one of everything the
// file carries (a place with a captioned photo, a multi-stop trip, a story),
// export it both ways, erase the device, and import each file back.

// A small valid 8×8 PNG — enough for the browser to decode + downscale on-device.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFElEQVR4nGP8z8Dwn4EIwDiqkL4KAZM0A/9c0iBQAAAAAElFTkSuQmCC",
  "base64",
);
const CAPTION = "The Louvre at dusk";
const STORY = "Three days in Paris";

async function exportFile(page: Page, button: string): Promise<Buffer> {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: button }).click(),
  ]);
  return readFile(await download.path());
}

async function eraseAll(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Reset all data" }).click();
  await page.getByLabel("Type RESET to confirm erasing all data").fill("RESET");
  await page.getByRole("button", { name: "Erase everything" }).click();
  await expect(page.getByRole("status").filter({ hasText: "All data erased." })).toBeVisible();
}

async function importFile(page: Page, name: string, mimeType: string, buffer: Buffer): Promise<void> {
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("region", { name: "Backup and restore" }).getByRole("button", { name: "Import…" }).click(),
  ]);
  await chooser.setFiles({ name, mimeType, buffer });
  await expect(page.locator(".notice-ok")).toHaveText("Restored 3 places, 1 trip and 1 story.");
}

/** Everything built at the start is back: the photo with its caption, the trip, the story. */
async function expectEverything(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Places", exact: true }).click();
  const thumb = page.locator(".postcard-thumb img");
  await expect(thumb).toHaveAttribute("src", /^data:image\/jpeg/);
  await page.locator(".postcard-thumb").click();
  const gallery = page.getByRole("dialog");
  await expect(gallery.getByLabel(/Caption for photo 1 of Paris/)).toHaveValue(CAPTION);
  await gallery.getByRole("button", { name: "Close" }).click();

  await gotoTab(page, "Trips");
  await expect(page.getByText(/3 stops/)).toBeVisible();

  await gotoTab(page, "Journal");
  await expect(page.getByRole("heading", { name: STORY })).toBeVisible();

  await page.getByRole("button", { name: "Settings" }).click();
}

test("export, erase and import back: every place, photo, trip and story returns", async ({ page }) => {
  // Builds three kinds of record through the UI and restores twice.
  test.slow();
  await openAppWithVisits(page, ["Paris", "Tokyo", "London"]);

  // A captioned photo on Paris.
  await page.getByRole("button", { name: "Places", exact: true }).click();
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "Add a photo for Paris" }).click(),
  ]);
  await chooser.setFiles({ name: "postcard.png", mimeType: "image/png", buffer: PNG });
  const gallery = page.getByRole("dialog");
  await gallery.getByLabel(/Caption for photo 1 of Paris/).fill(CAPTION);
  await gallery.getByRole("button", { name: "Close" }).click();
  await expect(page.locator(".postcard-thumb img")).toBeVisible();

  // A three-stop trip.
  await gotoTab(page, "Trips");
  await page.getByRole("button", { name: "Reconstruct a journey" }).click();
  for (const city of ["Paris", "Tokyo", "London"]) {
    await page.getByRole("button", { name: `Add ${city} to the trip` }).click();
  }
  await page.getByRole("button", { name: "Save trip" }).click();
  await expect(page.getByText(/3 stops/)).toBeVisible();

  // A story about Paris.
  await gotoTab(page, "Journal");
  await page.getByRole("button", { name: /Write a postcard/ }).click();
  await page.getByText("Add details", { exact: true }).click();
  const place = page.locator("#story-place");
  const paris = await place.locator("option", { hasText: "Paris" }).getAttribute("value");
  await place.selectOption(paris ?? "");
  await page.getByLabel("Title (optional)").fill(STORY);
  await page.getByRole("button", { name: "Save postcard" }).click();
  await expect(page.getByRole("heading", { name: STORY })).toBeVisible();

  await page.getByRole("button", { name: "Settings" }).click();
  const json = await exportFile(page, "Export data (.json)");
  const zip = await exportFile(page, "Save everything (.zip)");

  await eraseAll(page);
  await importFile(page, "postcards-backup.json", "application/json", json);
  await expectEverything(page);

  await eraseAll(page);
  await importFile(page, "postcards-backup.zip", "application/zip", zip);
  await expectEverything(page);
});
