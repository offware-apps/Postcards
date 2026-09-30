import { test, expect } from "@playwright/test";

// The move off an old address (src/lib/moved). The suite's build names
// localhost:4173 as the canonical address and 127.0.0.1:4173 as an allowed old
// one (see playwright.config.ts): two origins, one server, the real handoff.
const OLD = "http://127.0.0.1:4173";
const NEW = "http://localhost:4173";

test("the old address hands its places to the new one", async ({ page, context }) => {
  // Seed the old origin's store directly: served from there, the app redirects
  // straight away when it holds nothing. A static file keeps the app from booting.
  await page.goto(`${OLD}/manifest.webmanifest`);
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open("postcards", 5);
        req.onupgradeneeded = () => {
          const db = req.result;
          db.createObjectStore("visits", { keyPath: "visitId" });
          db.createObjectStore("trips", { keyPath: "tripId" });
          db.createObjectStore("stories", { keyPath: "storyId" });
          db.createObjectStore("tombstones", { keyPath: "key" });
          db.createObjectStore("photos", { keyPath: "id" });
        };
        req.onsuccess = () => {
          const tx = req.result.transaction("visits", "readwrite");
          tx.objectStore("visits").put({
            visitId: "moved-e2e-paris",
            place: { kind: "city", id: "paris-fr", name: "Paris", countryId: "FR" },
            date: "2019-08-12",
            note: null,
            status: "visited",
            favorite: false,
            addedAt: "2024-01-01T00:00:00.000Z",
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      }),
  );

  await page.goto(`${OLD}/`);
  await expect(page.getByRole("heading", { name: "Postcards has moved" })).toBeVisible();
  const [tab] = await Promise.all([
    context.waitForEvent("page"),
    page.getByRole("button", { name: "Move my places" }).click(),
  ]);
  await expect(page.getByText("Done: your places are at the new address.")).toBeVisible();

  // The new tab took the file, dropped the handoff parameter, and shows the place.
  await expect(tab).toHaveURL(`${NEW}/`);
  await expect(
    tab.getByText("Moved 1 place, 0 trips and 0 stories from the old address."),
  ).toBeVisible();
  await tab.getByRole("button", { name: "Places", exact: true }).click();
  await expect(tab.getByText("Paris", { exact: true })).toBeVisible();

  // Moved once: the old address now forwards instead of offering the move again.
  await page.goto(`${OLD}/`);
  await expect(page).toHaveURL(`${NEW}/`);
});

test("an empty old address forwards to the same page at the new one", async ({ page }) => {
  await page.goto(`${OLD}/?q=1#top`);
  await expect(page).toHaveURL(`${NEW}/?q=1#top`);
});
