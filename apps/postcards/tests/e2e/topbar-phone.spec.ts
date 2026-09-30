import { test, expect } from "@playwright/test";

// A phone top bar holds the brand, the search and four action buttons. At 375px
// the search used to be 85px wide and clipped its placeholder to "Sea".
test.use({ viewport: { width: 375, height: 740 } });

test("the phone search field shows its whole placeholder", async ({ page }) => {
  await page.goto("/");
  const input = page.getByLabel("Search a city or country");
  await expect(input).toBeVisible();
  const fit = await input.evaluate((el: HTMLInputElement) => {
    const cs = getComputedStyle(el);
    const ctx = document.createElement("canvas").getContext("2d")!;
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const room = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    return { room, text: ctx.measureText(el.placeholder).width };
  });
  expect(fit.room).toBeGreaterThanOrEqual(fit.text);
  // The brand keeps its accessible name while only its mark shows.
  await expect(page.getByRole("button", { name: "Postcards" })).toBeVisible();
});

// Emoji used as control icons drew as nothing without a colour emoji font
// (every Windows browser): the controls carry drawn icons instead.
test("control icons are drawn, not emoji", async ({ page }) => {
  await page.goto("/");
  for (const name of ["Cities", "Monuments", "Airports"]) {
    const b = page.locator(".map-mode").getByRole("button", { name, exact: true });
    await expect(b.locator("svg")).toBeVisible();
    expect(await b.textContent()).not.toMatch(/\p{Extended_Pictographic}/u);
  }
  await expect(page.locator(".search-icon svg")).toBeVisible();
  await expect(page.locator(".topbar-star .star-glyph svg")).toBeVisible();
});
