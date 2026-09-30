import { test, expect } from "@playwright/test";
import { openApp } from "./nav-helper";

// Escape / Back should step out of a LOCAL sub-view (a screen's own inner view)
// back to that screen's home view BEFORE leaving the tab — the same way the
// Journal's map view backs out to the feed. Places' collections (Moments, Photos,
// Passport) are little screens of their own; Escape returns to the kind × status
// browse instead of jumping straight to the map (spec 018 keeps this behaviour).
test("Escape backs out of a Places collection to the browse before leaving the tab", async ({
  page,
}) => {
  await openApp(page);

  // Land on Places — its home is the two-axis browse (header title "Places").
  await page.getByRole("button", { name: "Places", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Places" })).toBeVisible();

  // Open the Moments collection — a sub-view of Places.
  const moments = page.getByRole("button", { name: "Moments", exact: true });
  await moments.click();
  await expect(moments).toHaveAttribute("aria-pressed", "true");
  // The collection shows its OWN heading; the "Places" browse title is hidden.
  await expect(page.getByRole("heading", { name: "Moments" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Places" })).toHaveCount(0);

  // Move focus off the button (so the global handler owns Escape, not the button),
  // then press Escape: it must return to the browse, NOT navigate away from Places.
  await page.getByRole("heading", { name: "Moments" }).click();
  await page.keyboard.press("Escape");

  await expect(page.getByRole("heading", { name: "Places" })).toBeVisible();
  await expect(moments).toHaveAttribute("aria-pressed", "false");
  // Still on the Places tab (didn't fall through to the previous screen).
  await expect(page.getByRole("button", { name: "Places", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );

  // A second Escape (now on the home browse) leaves Places for the previous screen.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Places", exact: true })).not.toHaveAttribute(
    "aria-current",
    "page",
  );
});
