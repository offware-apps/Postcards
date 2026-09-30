import { describe, it, expect } from "vitest";
import { parsePack, toRawGitHubUrl, DataPackSchema } from "../../src/lib/packs/schema";

function pack(over: Record<string, unknown> = {}) {
  return {
    format: "postcards-pack",
    version: 1,
    name: "Tokyo Metro",
    license: "ODbL",
    attribution: "© OpenStreetMap contributors",
    places: [{ name: "Shinjuku", lat: 35.69, lon: 139.7, countryIso2: "jp" }],
    ...over,
  };
}

describe("data pack schema", () => {
  it("accepts a valid pack and uppercases the country", () => {
    const r = parsePack(JSON.stringify(pack()));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.pack.name).toBe("Tokyo Metro");
      expect(r.pack.places[0]!.countryIso2).toBe("JP");
    }
  });

  it("REQUIRES a licence (provenance is non-negotiable)", () => {
    const noLicense = pack();
    delete (noLicense as Record<string, unknown>).license;
    expect(parsePack(JSON.stringify(noLicense)).ok).toBe(false);
  });

  it("rejects non-JSON and the wrong format marker", () => {
    expect(parsePack("not json").ok).toBe(false);
    expect(parsePack(JSON.stringify(pack({ format: "nope" }))).ok).toBe(false);
  });

  it("bounds coordinates and needs at least one place", () => {
    expect(parsePack(JSON.stringify(pack({ places: [] }))).ok).toBe(false);
    expect(
      parsePack(JSON.stringify(pack({ places: [{ name: "x", lat: 999, lon: 0, countryIso2: "JP" }] }))).ok,
    ).toBe(false);
  });

  it("keeps a formula-like place name as inert text", () => {
    const r = DataPackSchema.parse(pack({ places: [{ name: "=HYPERLINK(x)", lat: 0, lon: 0, countryIso2: "FR" }] }));
    expect(r.places[0]!.name).toBe("=HYPERLINK(x)");
  });

  it("rejects unknown top-level keys (strict)", () => {
    expect(parsePack(JSON.stringify(pack({ evil: 1 }))).ok).toBe(false);
  });
});

describe("toRawGitHubUrl", () => {
  it("passes a raw.githubusercontent / gist URL through", () => {
    expect(toRawGitHubUrl("https://raw.githubusercontent.com/a/b/main/p.json")).toBe(
      "https://raw.githubusercontent.com/a/b/main/p.json",
    );
    expect(toRawGitHubUrl("https://gist.githubusercontent.com/a/b/raw/p.json")).toContain("gist.githubusercontent.com");
  });

  it("rewrites a github.com blob URL to raw", () => {
    expect(toRawGitHubUrl("https://github.com/owner/repo/blob/main/data/pack.json")).toBe(
      "https://raw.githubusercontent.com/owner/repo/main/data/pack.json",
    );
  });

  it("returns null for a non-GitHub host or non-https (never widens the CSP)", () => {
    expect(toRawGitHubUrl("https://evil.example.com/pack.json")).toBeNull();
    expect(toRawGitHubUrl("http://github.com/a/b/blob/main/p.json")).toBeNull();
    expect(toRawGitHubUrl("not a url")).toBeNull();
  });
});
