import { test, expect, type Page } from "@playwright/test";

// The move off an old address (src/lib/moved). The suite's build names
// localhost:4173 as the canonical address and 127.0.0.1:4173 as an allowed old
// one (see playwright.config.ts): two origins, one server, the real handoff.
const OLD = "http://127.0.0.1:4173";
const NEW = "http://localhost:4173";

const PARIS = {
  visitId: "moved-e2e-paris",
  place: { kind: "city", id: "paris-fr", name: "Paris", countryId: "FR" },
  date: "2019-08-12",
  note: null,
  status: "visited",
  favorite: false,
  addedAt: "2024-01-01T00:00:00.000Z",
};

/** The number of places stored at the page's origin. */
function storedPlaces(page: Page) {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const req = indexedDB.open("postcards");
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("visits")) return resolve(0);
          const count = db.transaction("visits").objectStore("visits").count();
          count.onsuccess = () => resolve(count.result);
          count.onerror = () => reject(count.error);
        };
        req.onerror = () => reject(req.error);
      }),
  );
}

test("the old address hands its places to the new one", async ({ page, context }) => {
  // Seed the old origin's store and sync settings directly: served from there,
  // the app redirects straight away when it holds nothing. A static file keeps
  // the app from booting. The seed is a first-version database holding visits
  // alone; the app upgrades it to its current version, as it does for anyone who
  // installed early.
  await page.goto(`${OLD}/manifest.webmanifest`);
  await page.evaluate(
    (visit) =>
      new Promise<void>((resolve, reject) => {
        localStorage.setItem("postcards-sync-owner", "someone");
        localStorage.setItem("postcards-sync-repo", "places");
        localStorage.setItem("postcards-sync-token", "github_pat_e2e");
        const req = indexedDB.open("postcards", 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore("visits", { keyPath: "visitId" });
        };
        req.onsuccess = () => {
          const tx = req.result.transaction("visits", "readwrite");
          tx.objectStore("visits").put(visit);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      }),
    PARIS,
  );

  // The new address asks before writing anything, naming what it received.
  const prompts: string[] = [];
  context.on("page", (p) =>
    p.on("dialog", (d) => {
      prompts.push(d.message());
      void d.accept();
    }),
  );

  // Each of the next two waits spans an app boot, the move screen's here and the
  // whole app's in the new tab, so they take openApp's boot budget.
  await page.goto(`${OLD}/`);
  await expect(page.getByRole("heading", { name: "Postcards has moved" })).toBeVisible({
    timeout: 15_000,
  });
  const [tab] = await Promise.all([
    context.waitForEvent("page"),
    page.getByRole("button", { name: "Move my places" }).click(),
  ]);
  await expect(page.getByText("Done: your places are at the new address.")).toBeVisible({
    timeout: 15_000,
  });
  expect(prompts).toHaveLength(1);
  expect(prompts[0]).toContain("1 place, 0 trips and 0 stories");

  // The new tab took the file, dropped the handoff parameter, and shows the place.
  await expect(tab).toHaveURL(`${NEW}/`);
  await expect(
    tab.getByText("Moved 1 place, 0 trips and 0 stories from the old address."),
  ).toBeVisible();
  await tab.getByRole("button", { name: "Places", exact: true }).click();
  await expect(tab.getByText("Paris", { exact: true })).toBeVisible();

  // The old address kept neither the sync settings nor the places.
  expect(
    await page.evaluate(() =>
      ["owner", "repo", "branch", "token", "last"].filter((k) =>
        localStorage.getItem(`postcards-sync-${k}`),
      ),
    ),
  ).toEqual([]);
  await expect.poll(() => storedPlaces(page)).toBe(0);

  // Moved once: the old address now forwards instead of offering the move again.
  await page.goto(`${OLD}/`);
  await expect(page).toHaveURL(`${NEW}/`);
});

test("the new address asks before restoring a file it was handed", async ({ page, context }) => {
  // Any page at the old origin can open the new address with ?handoff=1 and
  // post a file; the new address restores it only once the visitor agrees.
  await page.goto(`${OLD}/manifest.webmanifest`);
  const file = JSON.stringify({
    format: "postcards",
    schemaVersion: 12,
    exportedAt: "2024-01-01T00:00:00.000Z",
    visits: [PARIS],
  });
  const answer = page.evaluate(
    ({ url, text }) =>
      new Promise<unknown>((resolve) => {
        const tab = window.open(url, "_blank");
        window.addEventListener("message", (e) => {
          if (e.source !== tab) return;
          if (e.data?.type === "postcards-handoff-ready")
            tab!.postMessage({ type: "postcards-handoff-file", text }, new URL(url).origin);
          else resolve(e.data);
        });
      }),
    { url: `${NEW}/?handoff=1`, text: file },
  );
  const tab = await context.waitForEvent("page");
  const dialog = await tab.waitForEvent("dialog");
  expect(dialog.message()).toContain("1 place, 0 trips and 0 stories");
  await dialog.dismiss();

  expect(await answer).toEqual({ type: "postcards-handoff-failed", cancelled: true });
  expect(await storedPlaces(tab)).toBe(0);
});

test("an empty old address forwards to the same page at the new one", async ({ page }) => {
  await page.goto(`${OLD}/?q=1#top`);
  await expect(page).toHaveURL(`${NEW}/?q=1#top`);
});
