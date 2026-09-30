import { describe, it, expect } from "vitest";
import {
  articleUrl,
  guidesFor,
  phrasebookTitle,
  titleToPath,
  fetchSummary,
  fetchFullText,
  splitSections,
} from "../../src/lib/wikivoyage";

describe("wikivoyage URL builders", () => {
  it("encodes titles the MediaWiki way (spaces -> underscores)", () => {
    expect(titleToPath("New York City")).toBe("New_York_City");
    expect(articleUrl("Paris")).toBe("https://en.wikivoyage.org/wiki/Paris");
    expect(articleUrl("São Paulo")).toBe("https://en.wikivoyage.org/wiki/S%C3%A3o_Paulo");
  });

  it("links to a section anchor", () => {
    expect(articleUrl("France", "en", "Understand")).toBe(
      "https://en.wikivoyage.org/wiki/France#Understand",
    );
  });

  it("supports other language editions", () => {
    expect(articleUrl("Paris", "fr")).toBe("https://fr.wikivoyage.org/wiki/Paris");
  });

  it("names phrasebooks the Wikivoyage way", () => {
    expect(phrasebookTitle("French")).toBe("French phrasebook");
  });
});

describe("guidesFor", () => {
  it("builds city + country + understand + phrasebook links", () => {
    const links = guidesFor({
      cityName: "Kyoto",
      countryName: "Japan",
      countryIso2: "JP",
      languages: [{ code: "jpn", name: "Japanese" }],
    });
    const kinds = links.map((l) => l.kind);
    expect(kinds).toEqual(["place", "country", "understand", "phrasebook"]);
    expect(links.find((l) => l.kind === "phrasebook")!.url).toContain("Japanese_phrasebook");
  });

  it("omits the city link for a country-only guide and dedupes languages", () => {
    const links = guidesFor({
      countryName: "Switzerland",
      countryIso2: "CH",
      languages: [
        { code: "fra", name: "French" },
        { code: "fra", name: "French" },
        { code: "ita", name: "Italian" },
      ],
    });
    expect(links.some((l) => l.kind === "place")).toBe(false);
    expect(links.filter((l) => l.kind === "phrasebook")).toHaveLength(2);
  });
});

describe("fetchSummary (opt-in, degrades gracefully)", () => {
  it("returns null when the network fails (offline)", async () => {
    const s = await fetchSummary("Paris", { fetchFn: async () => { throw new Error("offline"); } });
    expect(s).toBeNull();
  });

  it("returns a plain-text, attributed summary and strips markup", async () => {
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({
          type: "standard",
          title: "Paris",
          extract: "Paris is the <b>capital</b> of France.",
          content_urls: { desktop: { page: "https://en.wikivoyage.org/wiki/Paris" } },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const s = await fetchSummary("Paris", { fetchFn });
    expect(s?.extract).toBe("Paris is the capital of France.");
    expect(s?.attribution).toContain("CC BY-SA");
  });

  it("ignores disambiguation pages", async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ type: "disambiguation", extract: "many things" }), {
        status: 200,
      })) as unknown as typeof fetch;
    expect(await fetchSummary("Springfield", { fetchFn })).toBeNull();
  });

  it("links a Wikipedia summary to Wikipedia, not Wikivoyage", async () => {
    // No content_urls in the reply, so the link is built from the title.
    const fetchFn = (async () =>
      new Response(JSON.stringify({ type: "standard", title: "Lyon", extract: "Lyon is a city." }), {
        status: 200,
      })) as unknown as typeof fetch;
    const s = await fetchSummary("Lyon", { project: "wikipedia", lang: "fr", fetchFn });
    expect(s?.url).toBe("https://fr.wikipedia.org/wiki/Lyon");
    expect(s?.attribution).toContain("Wikipedia");
  });
});

describe("splitSections (full-guide plain text)", () => {
  it("splits the lead and top-level sections, keeps sub-headings readable", () => {
    const text = [
      "Kyoto is a city in Japan.",
      "",
      "== See ==",
      "Temples everywhere.",
      "===Fushimi Inari===",
      "Thousands of torii gates.",
      "",
      "== References ==",
      "ignored boilerplate",
    ].join("\n");
    const sections = splitSections(text);
    expect(sections.map((s) => s.heading)).toEqual(["", "See"]);
    expect(sections[0]!.text).toBe("Kyoto is a city in Japan.");
    expect(sections[1]!.text).toContain("Fushimi Inari");
    expect(sections[1]!.text).toContain("Thousands of torii gates.");
  });

  it("drops empty and housekeeping sections", () => {
    const sections = splitSections("== External links ==\nlink farm\n== Do ==\n\n");
    expect(sections).toEqual([]);
  });
});

describe("fetchFullText (opt-in, degrades gracefully)", () => {
  it("returns null when the network fails (offline)", async () => {
    const full = await fetchFullText("Paris", {
      fetchFn: async () => {
        throw new Error("offline");
      },
    });
    expect(full).toBeNull();
  });

  it("returns attributed, sectioned plain text and strips markup", async () => {
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({
          query: {
            pages: [
              {
                title: "Paris",
                extract: "Paris is the <b>capital</b>.\n== Eat ==\nCroissants.",
              },
            ],
          },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const full = await fetchFullText("Paris", { fetchFn });
    expect(full?.sections.map((s) => s.heading)).toEqual(["", "Eat"]);
    expect(full?.sections[0]!.text).toBe("Paris is the capital.");
    expect(full?.attribution).toContain("CC BY-SA");
    expect(full?.url).toBe("https://en.wikivoyage.org/wiki/Paris");
  });

  it("returns null for missing pages", async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ query: { pages: [{ title: "Nope", missing: true }] } }), {
        status: 200,
      })) as unknown as typeof fetch;
    expect(await fetchFullText("Nope", { fetchFn })).toBeNull();
  });

  it("links the Wikipedia fallback to Wikipedia, not Wikivoyage", async () => {
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({ query: { pages: [{ title: "Lyon", extract: "Lyon is a city.\n== History ==\nOld." }] } }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const full = await fetchFullText("Lyon", { project: "wikipedia", fetchFn });
    expect(full?.url).toBe("https://en.wikipedia.org/wiki/Lyon");
    expect(full?.attribution).toContain("Wikipedia");
  });
});
