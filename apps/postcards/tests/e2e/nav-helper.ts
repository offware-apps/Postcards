import { expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Passport and Moments are views inside the Places screen now; every other
// section is a direct button in the bar (the "More" sheet is gone).
const PLACES_VIEWS = new Set(["Passport", "Moments"]);

/** Navigate to a section by name, going through Places for its inner views. */
export async function gotoTab(page: Page, name: string): Promise<void> {
  if (PLACES_VIEWS.has(name)) {
    await page.getByRole("button", { name: "Places", exact: true }).click();
    // The Places view switcher carries the view name.
    await page.getByRole("button", { name, exact: true }).click();
  } else {
    await page.getByRole("button", { name, exact: true }).click();
  }
}

/** Open the app and wait until the map screen, the last code to load, is up. */
export async function openApp(page: Page): Promise<void> {
  await page.goto("/");
  // Booting parses MapLibre and starts WebGL, the heaviest step of any test
  // when workers run side by side.
  await expect(page.getByText("Cities in view")).toBeVisible({ timeout: 15_000 });
}

/**
 * Mark a place visited from the top-bar search, then empty the search and wait
 * for its results list to close, so a leftover dropdown never covers what the
 * test clicks next. `name` is the place's label where it differs from the
 * query, as for an airport found by its code.
 */
export async function markVisited(page: Page, query: string, name = query): Promise<void> {
  const search = page.getByLabel("Search a city or country");
  await search.fill(query);
  await page.getByRole("button", { name: `Mark ${name} visited` }).first().click();
  await expect(page.getByRole("button", { name: `Remove ${name} from visited` }).first()).toBeVisible();
  await search.fill("");
  await expect(page.getByRole("listbox", { name: "Search results" })).toHaveCount(0);
}

/** Log a single-leg trip with the Trips screen's quick form, from IATA codes. */
export async function addTrip(page: Page, from: string, to: string, date?: string): Promise<void> {
  await page.getByRole("button", { name: "New trip" }).click();
  // Filter the option by its code so the picker's listbox row is targeted,
  // never the mode <select>'s native "Flight" option (both expose role=option).
  await page.getByLabel("From", { exact: true }).fill(from);
  await page.getByRole("option").filter({ hasText: from }).first().click();
  await page.getByLabel("To", { exact: true }).fill(to);
  await page.getByRole("option").filter({ hasText: to }).first().click();
  if (date) await page.locator("#trip-date").fill(date);
  await page.getByRole("button", { name: "Add trip" }).click();
  // The undo toast names this trip, so an earlier trip's toast cannot pass it.
  await expect(page.getByText(`Added ${from} → ${to}`)).toBeVisible();
}

/** WCAG 2.1 AA gate (SC-005): no serious or critical axe violation on the page. */
export async function assertNoSeriousViolations(page: Page, screen: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const serious = results.violations.filter((v) => ["serious", "critical"].includes(v.impact ?? ""));
  expect(
    serious,
    `${screen}: ${serious.map((v) => `${v.id} (${v.nodes.length} nodes)`).join(", ")}`,
  ).toEqual([]);
}
