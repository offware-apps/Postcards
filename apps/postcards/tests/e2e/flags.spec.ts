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
      stack: getComputedStyle(document.body).fontFamily,
    };
  });
  expect(face.status).toBe("loaded");
  expect(face.range).toBe("U+1F1E6-1F1FF");
  expect(face.stack.replace(/"/g, "")).toMatch(/^Twemoji Country Flags,/);
  expect(fontLoads).toContain(200);
});
