import { test, expect, type Page } from "@playwright/test";
import { openApp } from "./nav-helper";

// Spec 018 — Places Explore & Track. The screen is ONE unified hub with two
// independent single-select axes: a KIND (cities/monuments/airports/countries)
// and a STATUS (all/visited/wishlist/favorites/not-visited). US1 = clean, non-
// duplicated axes that compose; US2 = browse the whole world within any kind.

const KIND = "Place kind";
const STATUS = "Which places to show";

async function openPlaces(page: Page): Promise<void> {
  await openApp(page);
  await page.getByRole("button", { name: "Places", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Places" })).toBeVisible();
}

// US1 acceptance 1 + SC-001: every place kind lives in exactly ONE control.
test("each place kind is selectable in exactly one control (the kind axis)", async ({ page }) => {
  await openPlaces(page);
  const kind = page.getByRole("group", { name: KIND });
  const status = page.getByRole("group", { name: STATUS });

  // The kind axis carries every place kind…
  for (const k of ["Cities", "Monuments", "Airports", "Countries"]) {
    await expect(kind.getByRole("button", { name: k, exact: true })).toBeVisible();
  }
  // …and the status axis carries none of them — "Monuments" is not duplicated.
  for (const k of ["Cities", "Monuments", "Airports", "Countries"]) {
    await expect(status.getByRole("button", { name: k, exact: true })).toHaveCount(0);
  }
  // The status axis carries the personal-status values instead.
  for (const s of ["Visited", "Wishlist", "Favorites", "Not visited"]) {
    await expect(status.getByRole("button", { name: s, exact: true })).toBeVisible();
  }
});

// US1 acceptance 2 + FR-002: the two axes compose — changing one preserves the other.
test("kind and status compose: changing one keeps the other", async ({ page }) => {
  await openPlaces(page);
  const kind = page.getByRole("group", { name: KIND });
  const status = page.getByRole("group", { name: STATUS });

  // Pick a status, then switch kinds — the status stays selected.
  await status.getByRole("button", { name: "Visited", exact: true }).click();
  await kind.getByRole("button", { name: "Cities", exact: true }).click();
  await expect(status.getByRole("button", { name: "Visited", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(kind.getByRole("button", { name: "Cities", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await kind.getByRole("button", { name: "Monuments", exact: true }).click();
  await expect(status.getByRole("button", { name: "Visited", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // …and vice-versa: changing the status preserves the chosen kind.
  await status.getByRole("button", { name: "Wishlist", exact: true }).click();
  await expect(kind.getByRole("button", { name: "Monuments", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

// US2 + SC-002/edge "Empty personal data": a fresh profile still browses a full
// world. Cities + Not-visited shows unlogged reference cities (never a dead end).
test("a fresh profile browsing Cities + Not-visited shows the whole world", async ({ page }) => {
  await openPlaces(page); // fresh context ⇒ nothing logged
  const kind = page.getByRole("group", { name: KIND });
  const status = page.getByRole("group", { name: STATUS });

  await kind.getByRole("button", { name: "Cities", exact: true }).click();
  await status.getByRole("button", { name: "Not visited", exact: true }).click();

  const list = page.locator(".city-list").first();
  // A bounded, most-populous working set — dozens of never-logged reference cities,
  // each with a per-row "mark visited" toggle (not an empty "you've been everywhere").
  await expect.poll(() => list.locator("li").count()).toBeGreaterThan(20);
  await expect(list.getByRole("button", { name: /Mark .* visited/ }).first()).toBeVisible();
});

// US2 acceptance 4 + FR-004: marking a browsed reference place visited updates the
// row IN PLACE — no full-screen navigation away from the browse.
test("marking a browsed city visited updates in place", async ({ page }) => {
  await openPlaces(page);
  const kind = page.getByRole("group", { name: KIND });
  await kind.getByRole("button", { name: "Cities", exact: true }).click();

  // Narrow the world browse to Tokyo, then mark it visited from its row toggle.
  await page.getByLabel("Search all places").fill("Tokyo");
  const list = page.locator(".city-list").first();
  await list.getByRole("button", { name: "Mark Tokyo visited" }).first().click();

  // It now reads as visited (the toggle flips to "remove"), still in the browse —
  // the header title never changed, so no detail page was opened.
  await expect(page.getByRole("button", { name: "Remove Tokyo from visited" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Places" })).toBeVisible();
});

// US3 + FR-007/SC-005: search finds monuments & airports BY COUNTRY. Choosing the
// Monuments (or Airports) kind and typing a country name narrows the browse to
// that country's places — even though the country name matches none of their own.
test("Monuments + a country query narrows the browse to that country's monuments", async ({
  page,
}) => {
  await openPlaces(page);
  await page
    .getByRole("group", { name: KIND })
    .getByRole("button", { name: "Monuments", exact: true })
    .click();

  await page.getByLabel("Search monuments").fill("France");
  const list = page.locator(".city-list").first();
  await expect(list.locator("li").first()).toBeVisible();
  // Every surfaced monument sits in France (its sub-line names the country),
  // and none belongs to an unrelated country like Japan.
  await expect(list.getByText("France").first()).toBeVisible();
  await expect(list.getByText("Japan")).toHaveCount(0);
});

test("Airports + a country query narrows the browse to that country's airports", async ({
  page,
}) => {
  await openPlaces(page);
  await page
    .getByRole("group", { name: KIND })
    .getByRole("button", { name: "Airports", exact: true })
    .click();

  await page.getByLabel("Search all places").fill("Japan");
  const list = page.locator(".city-list").first();
  await expect(list.locator("li").first()).toBeVisible();
  await expect(list.getByText("Japan").first()).toBeVisible();
});

// US5 + SC-007: the country checklist shows every country at once — no pager —
// and its name search still narrows live.
test("Countries shows all at once with no load-more pager, still searchable", async ({ page }) => {
  await openPlaces(page);
  await page.getByRole("group", { name: KIND }).getByRole("button", { name: "Countries", exact: true }).click();

  const list = page.locator(".city-list").first();
  await expect.poll(() => list.locator("li").count()).toBeGreaterThan(50); // ~193–250 countries, all rendered
  const before = await list.locator("li").count();
  await expect(page.locator(".list-pager")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Show .* more/ })).toHaveCount(0);

  // The name search narrows the full list live.
  await page.getByLabel("Filter countries").fill("Japan");
  await expect(list.getByText("Japan", { exact: true })).toBeVisible();
  await expect.poll(() => list.locator("li").count()).toBeLessThan(before);
});
