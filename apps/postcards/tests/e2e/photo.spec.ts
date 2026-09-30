import { test, expect } from "@playwright/test";
import { openApp, markVisited } from "./nav-helper";

// A small valid 8×8 PNG — enough for the browser to decode + downscale on-device.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFElEQVR4nGP8z8Dwn4EIwDiqkL4KAZM0A/9c0iBQAAAAAElFTkSuQmCC",
  "base64",
);

test("attach photos to a place, caption one, view and remove", async ({ page }) => {
  await openApp(page);
  await markVisited(page, "Paris");

  await page.getByRole("button", { name: "Places", exact: true }).click();

  // No photos yet → the "Add a photo" affordance is present; attach an image.
  await expect(page.getByRole("button", { name: /Add a photo for Paris/ })).toBeVisible();
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "postcard.png",
    mimeType: "image/png",
    buffer: PNG,
  });

  // The gallery opens automatically; caption the photo (spaces must survive).
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const caption = dialog.getByLabel(/Caption for photo 1 of Paris/);
  await caption.fill("The Louvre at dusk");
  await expect(caption).toHaveValue("The Louvre at dusk");
  await dialog.getByRole("button", { name: "Close" }).click();

  // A thumbnail appears (downscaled on-device to a JPEG data URL).
  const thumb = page.locator(".postcard-thumb img");
  await expect(thumb).toBeVisible();
  await expect(thumb).toHaveAttribute("src", /^data:image\/jpeg/);

  // Reopen; focus moves into the dialog (WCAG). Remove the only photo → empties.
  await page.locator(".postcard-thumb").click();
  const dialog2 = page.getByRole("dialog");
  await expect(dialog2.getByRole("button", { name: "Close" })).toBeFocused();
  await dialog2.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Add a photo for Paris/ })).toBeVisible();
});
