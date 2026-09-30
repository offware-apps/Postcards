import { fileURLToPath } from "node:url";
import { test, expect, type Page } from "@playwright/test";
import { gotoTab, openApp, openAppWithVisits, assertNoSeriousViolations } from "./nav-helper";

// A backup with visits, trips, stories and photos, so every screen has rows.
const BACKUP = fileURLToPath(new URL("./fixtures/a11y-backup.json", import.meta.url));

/** Open the app with the backup restored, back on the map. */
async function openAppWithBackup(page: Page): Promise<void> {
  await openApp(page);
  page.on("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Settings" }).click();
  await page.locator('input[type="file"][accept*="zip"]').setInputFiles(BACKUP);
  await expect(page.locator(".notice-ok")).toBeVisible();
  await gotoTab(page, "Map");
  await expect(page.getByText("Cities in view")).toBeVisible();
}

const dialog = (page: Page, name: string | RegExp) => page.getByRole("dialog", { name });

async function openPlaceView(page: Page, name: string): Promise<void> {
  await gotoTab(page, "Places");
  await page.getByRole("button", { name, exact: true }).click();
}

async function openJournalView(page: Page, name: string): Promise<void> {
  await gotoTab(page, "Journal");
  await page.getByRole("group", { name: "Journal view" }).getByRole("button", { name }).click();
}

// Every top-level screen and every dialog or sheet, each opened from the map.
const SCREENS: [string, (page: Page) => Promise<void>][] = [
  ["map", async () => {}],
  [
    "search results",
    async (page) => {
      // Paris is visited in the backup and its airports are not, so both chip states show.
      await page.getByLabel("Search a city or country").fill("Paris");
      await expect(page.locator("#search-results")).toBeVisible();
      await page.keyboard.press("ArrowDown");
    },
  ],
  [
    "map filter panel",
    async (page) => {
      await page.locator(".map-ctl-right").getByRole("button", { name: /Filter/ }).click();
      await expect(dialog(page, "Filters")).toBeVisible();
    },
  ],
  [
    "map layers",
    async (page) => {
      await page.getByRole("button", { name: /Layers/ }).first().click();
      await expect(page.getByRole("group", { name: "Map layers" })).toBeVisible();
    },
  ],
  [
    "map place card",
    async (page) => {
      await page.getByLabel("Search a city or country").fill("Kyoto");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await expect(page.locator(".map-popup")).toBeVisible();
    },
  ],
  [
    "places",
    async (page) => {
      await gotoTab(page, "Places");
      await expect(page.getByRole("heading", { name: "Places" })).toBeVisible();
    },
  ],
  [
    "places countries",
    async (page) => {
      await openPlaceView(page, "Countries");
      await expect(page.getByLabel("Japan visited")).toBeVisible();
    },
  ],
  [
    "places stations",
    async (page) => {
      await gotoTab(page, "Places");
      await page.getByRole("group", { name: /kind/i }).getByRole("button", { name: "Stations" }).click();
      await page.getByRole("searchbox").fill("Part-Dieu");
      await expect(page.getByText("Lyon Part-Dieu").first()).toBeVisible();
    },
  ],
  [
    "places row options",
    async (page) => {
      await gotoTab(page, "Places");
      await page.getByRole("button", { name: /More options for Paris/ }).click();
      await expect(page.locator(".row-menu")).toBeVisible();
    },
  ],
  [
    "places filter panel",
    async (page) => {
      await gotoTab(page, "Places");
      await page.locator(".filter-open-chip").click();
      await expect(dialog(page, "Filters")).toBeVisible();
    },
  ],
  [
    "passport",
    async (page) => {
      await gotoTab(page, "Passport");
      await expect(page.getByText("flags collected")).toBeVisible();
    },
  ],
  [
    "moments",
    async (page) => {
      await gotoTab(page, "Moments");
      await expect(page.getByRole("heading", { name: "Moments" })).toBeVisible();
    },
  ],
  [
    "photos",
    async (page) => {
      await openPlaceView(page, "Photos");
      await expect(page.locator(".photo-wall img").first()).toBeVisible();
    },
  ],
  [
    "city page",
    async (page) => {
      await gotoTab(page, "Places");
      await page.getByRole("button", { name: "Open Paris" }).first().click();
      await expect(page.getByRole("heading", { name: "Paris" })).toBeVisible();
    },
  ],
  [
    "country page",
    async (page) => {
      await openPlaceView(page, "Countries");
      await page.getByRole("main").getByRole("button", { name: /^Japan/ }).first().click();
      await expect(page.getByRole("heading", { name: /Japan/ })).toBeVisible();
    },
  ],
  [
    "trips",
    async (page) => {
      await gotoTab(page, "Trips");
      await expect(page.getByRole("button", { name: /Edit trip/ }).first()).toBeVisible();
    },
  ],
  [
    "trip form",
    async (page) => {
      await gotoTab(page, "Trips");
      await page.getByRole("button", { name: "New trip" }).click();
      await expect(page.getByLabel("From", { exact: true })).toBeVisible();
    },
  ],
  [
    "trip form place list",
    async (page) => {
      await gotoTab(page, "Trips");
      await page.getByRole("button", { name: "New trip" }).click();
      await page.getByLabel("From", { exact: true }).fill("Paris");
      await expect(page.getByRole("listbox", { name: "From" })).toBeVisible();
      await page.keyboard.press("ArrowDown");
    },
  ],
  [
    "trip composer",
    async (page) => {
      await gotoTab(page, "Trips");
      await page.getByRole("button", { name: /Edit trip CDG/ }).click();
      await expect(page.locator(".trip-stops li").first()).toBeVisible();
      await expect(page.locator(".trip-stop-date input").first()).toBeVisible();
    },
  ],
  [
    "boarding pass",
    async (page) => {
      await gotoTab(page, "Trips");
      await page.getByRole("button", { name: "Add from a boarding pass" }).click();
      await expect(page.getByRole("button", { name: /Read/ }).first()).toBeVisible();
    },
  ],
  [
    "journal",
    async (page) => {
      await gotoTab(page, "Journal");
      await expect(page.getByText("Temples at dawn").first()).toBeVisible();
    },
  ],
  [
    "postcard composer",
    async (page) => {
      await gotoTab(page, "Journal");
      await page.getByRole("button", { name: /Write a postcard/ }).click();
      await expect(page.locator(".story-composer")).toBeVisible();
      // Expand the optional "add details" so those controls are audited too.
      await page.getByText("Add details", { exact: true }).click();
      await expect(page.locator("#story-place")).toBeVisible();
    },
  ],
  [
    "journal by place",
    async (page) => {
      await openJournalView(page, "By place");
      await expect(page.locator(".journal-place-summary").first()).toBeVisible();
    },
  ],
  [
    "journal timeline",
    async (page) => {
      await openJournalView(page, "Timeline");
      await expect(page.getByText("Temples at dawn").first()).toBeVisible();
    },
  ],
  [
    "journal map",
    async (page) => {
      await openJournalView(page, "Map");
      await expect(page.locator(".storymap-svg")).toBeVisible();
    },
  ],
  [
    "journal calendar",
    async (page) => {
      await openJournalView(page, "Calendar");
      await expect(page.getByRole("button", { name: "Next month" })).toBeVisible();
    },
  ],
  [
    "journal photo viewer",
    async (page) => {
      await gotoTab(page, "Journal");
      await page.getByRole("button", { name: /View photo 1 of 2/ }).click();
      await expect(page.locator(".lightbox")).toBeVisible();
    },
  ],
  [
    "publish",
    async (page) => {
      await gotoTab(page, "Journal");
      await page.getByRole("button", { name: "Publish site" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
    },
  ],
  [
    "stats",
    async (page) => {
      await gotoTab(page, "Stats");
      await expect(page.getByText("Statistics")).toBeVisible();
    },
  ],
  [
    "settings",
    async (page) => {
      await page.getByRole("button", { name: "Settings" }).click();
      await expect(page.getByRole("heading", { name: "Your data" })).toBeVisible();
    },
  ],
  [
    "about",
    async (page) => {
      await page.getByRole("button", { name: "How it works" }).first().click();
      await expect(page.locator(".about-version")).toBeVisible();
    },
  ],
  [
    "shortcuts",
    async (page) => {
      await page.keyboard.press("Shift+Slash");
      await expect(page.getByRole("dialog", { name: /shortcuts/i })).toBeVisible();
    },
  ],
];

// WCAG 2.1 AA gate (SC-005): no serious or critical axe violation on any screen,
// in either colour scheme and on a phone-width window.
const MODES = [
  { mode: "light", colorScheme: "light", viewport: { width: 1280, height: 800 } },
  { mode: "dark", colorScheme: "dark", viewport: { width: 1280, height: 800 } },
  { mode: "375px", colorScheme: "light", viewport: { width: 375, height: 812 } },
] as const;

for (const { mode, colorScheme, viewport } of MODES) {
  test.describe(mode, () => {
    test.use({ colorScheme, viewport });
    for (const [screen, open] of SCREENS) {
      test(`${screen} passes the axe WCAG 2.1 AA gate`, async ({ page }) => {
        await openAppWithBackup(page);
        await open(page);
        await assertNoSeriousViolations(page, `${screen} (${mode})`);
      });
    }
  });
}

// Spec 019: the multi-stop trip composer must pass the same gate, with its place
// picker, stop list, reorder controls, and distance readout all present.
test("the trip composer passes the axe WCAG 2.1 AA gate", async ({ page }) => {
  // Seed visited places so the picker has something to tap.
  await openAppWithVisits(page, ["Paris", "Tokyo"]);
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
