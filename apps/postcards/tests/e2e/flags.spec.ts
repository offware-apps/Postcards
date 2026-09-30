import { test, expect } from "@playwright/test";

// Flags are Unicode regional-indicator pairs. Windows and minimal Linux have no
// glyphs for them, so the app bundles a flag-only font that leads its font
// stacks; these checks hold whatever fonts the machine running them has.
test("country flags draw from the bundled flag font", async ({ page }) => {
  const fontLoads: number[] = [];
  page.on("response", (r) => {
    if (r.url().endsWith("/fonts/TwemojiCountryFlags.woff2")) fontLoads.push(r.status());
  });
  await page.goto("/");
  await page.getByLabel("Search a city or country").fill("Paris");
  await page.getByRole("button", { name: "Mark Paris visited" }).first().click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Places", exact: true }).click();
  await expect(page.getByText("Paris", { exact: true })).toBeVisible();

  const face = await page.evaluate(async () => {
    await document.fonts.ready;
    const f = [...document.fonts].find((x) => x.family.replace(/"/g, "") === "Twemoji Country Flags");
    return {
      status: f?.status,
      range: f?.unicodeRange,
      // Its glyphs fill less of the em than colour-emoji flags: scaled to match.
      sizeAdjust: (f as (FontFace & { sizeAdjust?: string }) | undefined)?.sizeAdjust,
      stack: getComputedStyle(document.body).fontFamily,
    };
  });
  expect(face.status).toBe("loaded");
  expect(face.range).toBe("U+1F1E6-1F1FF");
  expect(face.sizeAdjust).toBe("118%");
  expect(face.stack.replace(/"/g, "")).toMatch(/^Twemoji Country Flags,/);
  expect(fontLoads).toContain(200);
});

// A country named without its flag read as a gap next to every list that shows
// one: search results and the map's place card lead with it too.
test("search results and the map's place card lead with the country's flag", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Cities in view")).toBeVisible();
  await page.getByLabel("Search a city or country").fill("Istanbul");
  const first = page.locator("#search-results [role=row]").first();
  await expect(first.locator(".result-flag")).toHaveText("🇹🇷");
  // The flag is decoration: the result's name stays the place's name.
  await expect(first.locator(".result-open")).toHaveAccessibleName(/^Istanbul/);

  await first.locator(".result-open").click();
  await expect(page.locator(".map-popup-flag")).toHaveText("🇹🇷");
  await expect(page.locator(".map-popup-main strong")).toHaveText("🇹🇷Istanbul");
});
