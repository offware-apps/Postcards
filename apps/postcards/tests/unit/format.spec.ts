import { describe, it, expect, afterEach } from "vitest";
import { countryFlag, formatDate } from "../../src/lib/format/format";

describe("countryFlag", () => {
  it("builds the regional-indicator pair for a country", () => {
    expect(countryFlag("FR")).toBe("🇫🇷");
    expect(countryFlag("jp")).toBe("🇯🇵");
  });
  it("works for territories too", () => {
    expect(countryFlag("GP")).toBe("🇬🇵"); // Guadeloupe
    expect(countryFlag("RE")).toBe("🇷🇪"); // Réunion
  });
});

describe("formatDate", () => {
  const saved = process.env.TZ;
  afterEach(() => {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  });

  it("keeps the precision a vague date carries (never invents a day)", () => {
    expect(formatDate("2024-08-12", "en")).toBe("Aug 12, 2024");
    expect(formatDate("2024-03", "en")).toBe("Mar 2024");
    expect(formatDate("2024", "en")).toBe("2024");
    expect(formatDate(null, "en")).toBe("");
  });

  it("shows an impossible or malformed date as typed rather than rolling it", () => {
    expect(formatDate("2024-02-31", "en")).toBe("2024-02-31");
    expect(formatDate("2024-13-45", "en")).toBe("2024-13-45");
    expect(formatDate("soon", "en")).toBe("soon");
  });

  // Node applies a TZ change at runtime, so each zone runs in this one process.
  it.each(["UTC", "America/New_York", "Asia/Tokyo"])("labels the same day in %s", (zone) => {
    process.env.TZ = zone;
    expect(formatDate("2024-01-01", "en")).toBe("Jan 1, 2024");
    expect(formatDate("2024-01", "en")).toBe("Jan 2024");
  });
});
