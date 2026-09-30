import { describe, it, expect } from "vitest";
import { JSDOM, VirtualConsole } from "jsdom";
import { renderReaderHtml } from "../../src/lib/publish/renderReader";
import { encryptJson } from "../../src/lib/publish/encrypt";
import type { PublishedJourney } from "../../src/lib/publish/bundle";

const journey: PublishedJourney = {
  title: "Three weeks around the Mediterranean",
  subtitle: "Ferries, trains & a lot of gelato",
  dateRange: { start: "2026-05-02", end: "2026-05-20" },
  totals: { countries: 3, places: 3, distanceKm: 2847 },
  steps: [
    {
      place: { kind: "city", id: "par", name: "Paris", countryId: "FR", lat: 48.85, lon: 2.35 },
      lat: 48.85,
      lon: 2.35,
      date: "2026-05-02",
      arriveBy: null,
      story: { title: "Departure day", text: "We left in the rain and it felt right.", date: "2026-05-02" },
      photos: [{ src: "data:image/png;base64,AAAA", caption: "Gare de Lyon" }],
    },
    {
      place: { kind: "city", id: "rom", name: "Rome", countryId: "IT", lat: 41.9, lon: 12.5 },
      lat: 41.9,
      lon: 12.5,
      date: "2026-05-09",
      arriveBy: "train",
      story: { title: "Roman holiday", text: "Ruins, ruins, and a perfect espresso.", date: "2026-05-09" },
      photos: [],
    },
    {
      place: { kind: "city", id: "cai", name: "Cairo", countryId: "EG", lat: 30.04, lon: 31.24 },
      lat: 30.04,
      lon: 31.24,
      date: "2026-05-20",
      arriveBy: "ferry",
      photos: [{ src: "data:image/png;base64,BBBB", caption: null }],
    },
  ],
};

/** Any absolute/external URL scheme that would mean a network request. data: is inline and allowed. */
const EXTERNAL_URL = /\b(?:https?:|wss?:)\/\//i;

/** Boot the emitted reader inside a fresh JSDOM realm and wait for the runtime to render. */
async function mount(html: string): Promise<JSDOM> {
  // Swallow jsdom "not implemented" notices (e.g. window.scrollTo) — they are
  // expected and must not fail the test.
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true, virtualConsole });
  const start = Date.now();
  // The reader boots on DOMContentLoaded; poll until it has swapped in its chrome.
  while (Date.now() - start < 2000) {
    if (dom.window.document.querySelector(".pc-head, .pc-gate")) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  return dom;
}

describe("renderReaderHtml (self-containment, both layouts)", () => {
  for (const layout of ["blog", "book"] as const) {
    const html = renderReaderHtml(journey, { layout });

    it(`${layout}: is a complete self-contained HTML document`, () => {
      expect(html.startsWith("<!doctype html>")).toBe(true);
      expect(html).toContain('<html lang="en">');
      expect(html).toContain("</html>");
      // Everything inlined — the reader code and styles ship in the document.
      expect(html).toContain("<style>");
      expect(html).toContain("<script>");
      // The chosen layout rides on the body so the runtime can dispatch.
      expect(html).toContain(`data-layout="${layout}"`);
    });

    it(`${layout}: makes ZERO external references (only inline data: URLs allowed)`, () => {
      expect(EXTERNAL_URL.test(html)).toBe(false);
      expect(html).not.toContain("//cdn");
      expect(html).not.toContain("<link");
      // The inline SVG must not carry the xmlns URL (it would be a network hint).
      expect(html).not.toContain("www.w3.org");
      // Inline photo data URLs are fine and expected.
      expect(html).toContain("data:image/png;base64,AAAA");
    });

    it(`${layout}: carries the title and a step's story text (inert payload)`, () => {
      expect(html).toContain("Three weeks around the Mediterranean");
      // Story text survives into the embedded JSON payload (escaped, inert).
      expect(html).toContain("Ruins, ruins, and a perfect espresso.");
      expect(html).toContain("Paris");
      expect(html).toContain("Cairo");
    });

    it(`${layout}: escapes '<' inside the embedded payload so it cannot break the script tag`, () => {
      const evil: PublishedJourney = {
        ...journey,
        steps: [
          {
            ...journey.steps[0]!,
            story: { title: "x", text: "</script><script>alert(1)</script>", date: "2026-05-02" },
          },
        ],
      };
      const out = renderReaderHtml(evil, { layout });
      // The raw closing-script sequence must never appear verbatim in the payload.
      expect(out).not.toContain("</script><script>alert(1)");
      expect(out).toContain("\\u003c"); // the "<" is escaped
    });
  }

  it("defaults to the blog layout when no layout is given", () => {
    expect(renderReaderHtml(journey)).toContain('data-layout="blog"');
  });

  it("preserves the Natural Earth / OpenStreetMap attribution", () => {
    const html = renderReaderHtml(journey);
    expect(html).toContain("Natural Earth");
    expect(html).toContain("Published with Postcards");
  });
});

describe("renderReaderHtml (blog layout, mounted)", () => {
  it("renders a scrollable dated feed with one post per step (chronological order)", async () => {
    const dom = await mount(renderReaderHtml(journey, { layout: "blog" }));
    const doc = dom.window.document;
    // Boot succeeded into the blog chrome (no paged nav/counter).
    expect(doc.querySelector(".pc-head-blog")).toBeTruthy();
    expect(doc.querySelector(".pc-nav")).toBeNull();
    expect(doc.querySelector(".pc-counter")).toBeNull();
    // One post per step, in chronological order (the trip unfolds top→bottom).
    const posts = [...doc.querySelectorAll(".pc-feed .pc-post")];
    expect(posts.length).toBe(journey.steps.length);
    const places = posts.map((p) => p.querySelector(".pc-post-place")?.textContent ?? "");
    expect(places[0]).toContain("Paris");
    expect(places[1]).toContain("Rome");
    expect(places[2]).toContain("Cairo");
    // Tasteful dividers sit between posts (one fewer than the posts).
    expect(doc.querySelectorAll(".pc-feed .pc-divider").length).toBe(journey.steps.length - 1);
    dom.window.close();
  });

  it("gives every post a stable permalink anchor (entry-1 … entry-N)", async () => {
    const dom = await mount(renderReaderHtml(journey, { layout: "blog" }));
    const doc = dom.window.document;
    journey.steps.forEach((_, i) => {
      const post = doc.getElementById(`entry-${i + 1}`);
      expect(post).toBeTruthy();
      expect(post!.classList.contains("pc-post")).toBe(true);
      // A copy/hash permalink control that points at its own anchor.
      const link = post!.querySelector(".pc-permalink") as HTMLAnchorElement | null;
      expect(link).toBeTruthy();
      expect(link!.getAttribute("href")).toBe(`#entry-${i + 1}`);
    });
    dom.window.close();
  });

  it("stamps 'Last updated' and links 'Latest' straight to the newest entry", async () => {
    const dom = await mount(renderReaderHtml(journey, { layout: "blog" }));
    const doc = dom.window.document;
    // Recency for repeat visitors — the newest step's date.
    const updated = doc.querySelector(".pc-updated");
    expect(updated?.textContent).toContain("Last updated");
    // The "latest" link jumps to the newest post (Cairo, 2026-05-20 → entry-3).
    const latest = doc.querySelector(".pc-latest") as HTMLAnchorElement | null;
    expect(latest).toBeTruthy();
    expect(latest!.getAttribute("href")).toBe(`#entry-${journey.steps.length}`);
    expect(latest!.textContent).toContain("Cairo");
    dom.window.close();
  });

  it("dates a month- or year-dated step at its own precision, west of UTC too", async () => {
    const saved = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      const vague: PublishedJourney = {
        ...journey,
        dateRange: { start: "2024", end: "2024-03" },
        steps: [
          { ...journey.steps[0]!, date: "2024", story: undefined },
          { ...journey.steps[1]!, date: "2024-03", story: undefined },
          { ...journey.steps[2]!, date: "2024-03-05" },
        ],
      };
      const dom = await mount(renderReaderHtml(vague, { layout: "blog" }));
      const dates = [...dom.window.document.querySelectorAll(".pc-post-date")].map((e) => e.textContent);
      const fmt = (o: Intl.DateTimeFormatOptions) =>
        new Intl.DateTimeFormat(undefined, { ...o, timeZone: "UTC" }).format(Date.UTC(2024, 2, 5));
      expect(dates).toEqual(["2024", fmt({ year: "numeric", month: "short" }), fmt({ dateStyle: "medium" })]);
      dom.window.close();
    } finally {
      if (saved === undefined) delete process.env.TZ;
      else process.env.TZ = saved;
    }
  });

  it("keeps the fitted route map with a labeled marker per city", async () => {
    const dom = await mount(renderReaderHtml(journey, { layout: "blog" }));
    const doc = dom.window.document;
    expect(doc.querySelector(".pc-mapwrap")).toBeTruthy();
    const labels = [...doc.querySelectorAll(".pc-map .pc-map-label")].map((n) => n.textContent);
    expect(labels.length).toBe(journey.steps.length);
    expect(new Set(labels)).toEqual(new Set(["Paris", "Rome", "Cairo"]));
    // A dot (marker) per city, plus the curved route + compass + legend.
    expect(doc.querySelectorAll(".pc-map svg circle").length).toBeGreaterThanOrEqual(journey.steps.length);
    expect(doc.querySelectorAll(".pc-map svg path.pc-leg").length).toBeGreaterThan(0);
    expect(doc.querySelector(".pc-compass-label")).toBeTruthy();
    expect(doc.querySelector(".pc-legend")).toBeTruthy();
    dom.window.close();
  });

  it("escapes a malicious place name in the post and the map label (inert markup)", async () => {
    const evil: PublishedJourney = {
      ...journey,
      steps: [
        {
          ...journey.steps[0]!,
          place: { ...journey.steps[0]!.place, name: "<img src=x onerror=alert(1)>" },
        },
      ],
    };
    const dom = await mount(renderReaderHtml(evil, { layout: "blog" }));
    const doc = dom.window.document;
    // No injected <img> smuggled through the post heading or the SVG label.
    expect(doc.querySelector(".pc-post img[src='x']")).toBeNull();
    expect(doc.querySelector(".pc-map img")).toBeNull();
    // The raw text survives only as inert text content.
    expect(doc.querySelector(".pc-post-place")?.textContent).toContain("<img");
    expect(doc.querySelector(".pc-map .pc-map-label")?.textContent).toContain("<img");
    dom.window.close();
  });
});

describe("renderReaderHtml (book layout, mounted)", () => {
  it("still renders a cover, a map, and one photo-led page per step", async () => {
    const dom = await mount(renderReaderHtml(journey, { layout: "book" }));
    const doc = dom.window.document;
    // Boot succeeded (loading placeholder replaced by the reader chrome).
    expect(doc.querySelector(".pc-head")).toBeTruthy();
    // Cover + map + one page per step.
    expect(doc.querySelectorAll(".pc-cover").length).toBe(1);
    expect(doc.querySelectorAll(".pc-mapwrap").length).toBe(1);
    expect(doc.querySelectorAll(".pc-step").length).toBe(journey.steps.length);
    // Editorial furniture: a cover hero, kickers, and a folio on every spread.
    expect(doc.querySelector(".pc-cover-hero")).toBeTruthy();
    expect(doc.querySelectorAll(".pc-folio").length).toBe(2 + journey.steps.length);
    // The blog-only chrome is absent here.
    expect(doc.querySelector(".pc-feed")).toBeNull();
    dom.window.close();
  });

  it("draws a labeled pin for every city, plus a compass and a legend", async () => {
    const dom = await mount(renderReaderHtml(journey, { layout: "book" }));
    const doc = dom.window.document;
    const labels = [...doc.querySelectorAll(".pc-map .pc-map-label")].map((n) => n.textContent);
    // One readable label per city, carrying the place names.
    expect(labels.length).toBe(journey.steps.length);
    expect(new Set(labels)).toEqual(new Set(["Paris", "Rome", "Cairo"]));
    // A dot (marker) per city — at least one circle per stop is drawn.
    expect(doc.querySelectorAll(".pc-map svg circle").length).toBeGreaterThanOrEqual(journey.steps.length);
    // The curved route + a compass + a legend make it read like a travel map.
    expect(doc.querySelectorAll(".pc-map svg path.pc-leg").length).toBeGreaterThan(0);
    expect(doc.querySelector(".pc-compass-label")).toBeTruthy();
    expect(doc.querySelector(".pc-legend")).toBeTruthy();
    dom.window.close();
  });

  it("pages forward with the Next button", async () => {
    const dom = await mount(renderReaderHtml(journey, { layout: "book" }));
    const doc = dom.window.document;
    const cover = doc.querySelector(".pc-cover") as HTMLElement;
    const counter = doc.querySelector(".pc-counter") as HTMLElement;
    expect(cover.hidden).toBe(false);
    expect(counter.textContent).toBe("1 / 5"); // cover + map + 3 steps
    (doc.querySelector(".pc-btn-primary") as HTMLButtonElement).click();
    expect(counter.textContent).toBe("2 / 5");
    expect(cover.hidden).toBe(true);
    expect((doc.querySelector(".pc-mapwrap") as HTMLElement).hidden).toBe(false);
    dom.window.close();
  });

  it("escapes a malicious place name in the map label (inert markup)", async () => {
    const evil: PublishedJourney = {
      ...journey,
      steps: [
        {
          ...journey.steps[0]!,
          place: { ...journey.steps[0]!.place, name: "<img src=x onerror=alert(1)>" },
        },
      ],
    };
    const dom = await mount(renderReaderHtml(evil, { layout: "book" }));
    const doc = dom.window.document;
    // No injected <img> smuggled through the SVG label.
    expect(doc.querySelector(".pc-map img")).toBeNull();
    const label = doc.querySelector(".pc-map .pc-map-label");
    expect(label?.textContent).toContain("<img");
    dom.window.close();
  });
});

describe("renderReaderHtml (encrypted)", () => {
  for (const layout of ["blog", "book"] as const) {
    it(`${layout}: ships only the envelope — no plaintext of the journey leaks`, async () => {
      const env = await encryptJson(journey, "correct horse battery staple");
      const html = renderReaderHtml(null, { encrypted: env, layout });

      expect(html.startsWith("<!doctype html>")).toBe(true);
      expect(EXTERNAL_URL.test(html)).toBe(false);
      // A passphrase gate + the envelope, never the plain data.
      expect(html).toContain("locked");
      expect(html).toContain('id="pc-env"');
      expect(html).not.toContain('id="pc-data"');
      // None of the plaintext (title, subtitle, story text, place names) is present.
      expect(html).not.toContain("Three weeks around the Mediterranean");
      expect(html).not.toContain("Ruins, ruins, and a perfect espresso.");
      expect(html).not.toContain("Roman holiday");
      expect(html).not.toContain("Cairo");
      // The passphrase itself is never written to the file.
      expect(html).not.toContain("correct horse battery staple");
      // The ciphertext envelope is embedded.
      expect(html).toContain(env.ct.slice(0, 16));
    });
  }

  it("mounts to a passphrase gate, not the journey", async () => {
    const env = await encryptJson(journey, "correct horse battery staple");
    const dom = await mount(renderReaderHtml(null, { encrypted: env }));
    const doc = dom.window.document;
    expect(doc.querySelector(".pc-gate")).toBeTruthy();
    expect(doc.querySelector("input[type=password]")).toBeTruthy();
    // Neither the blog feed nor the book is rendered until unlocked.
    expect(doc.querySelector(".pc-post")).toBeNull();
    expect(doc.querySelector(".pc-cover")).toBeNull();
    expect(doc.querySelector(".pc-map-label")).toBeNull();
    dom.window.close();
  });
});
