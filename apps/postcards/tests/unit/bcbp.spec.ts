import { describe, it, expect } from "vitest";
import { parseBcbp, julianToDate } from "../../src/lib/bcbp/parse";

// A valid single-leg boarding pass (IATA BCBP): Luc Desmarais, YUL→FRA, AF/AC834, day 226.
const ONE_LEG = "M1DESMARAIS/LUC       EABC123 YULFRAAC 0834 226F001A0025 100";
// Two legs: YUL→FRA then FRA→NRT (a connection).
const TWO_LEGS =
  "M2DESMARAIS/LUC       E" +
  "ABC123 YULFRAAC 0834 226F001A0025 100" +
  "ABC123 FRANRTAF 0290 228Y012C0031 100";

describe("parseBcbp", () => {
  it("parses a single-leg pass into from/to/carrier/flight/day", () => {
    const r = parseBcbp(ONE_LEG)!;
    expect(r).not.toBeNull();
    expect(r.passengerName).toBe("DESMARAIS/LUC");
    expect(r.legs).toHaveLength(1);
    expect(r.legs[0]).toMatchObject({
      from: "YUL",
      to: "FRA",
      carrier: "AC",
      flightNumber: "834", // leading zeros stripped
      julianDay: 226,
    });
  });

  it("walks the variable-length fields to parse every leg of a connection", () => {
    const r = parseBcbp(TWO_LEGS)!;
    expect(r.legs.map((l) => `${l.from}-${l.to}`)).toEqual(["YUL-FRA", "FRA-NRT"]);
    expect(r.legs[1]!.julianDay).toBe(228);
  });

  it("rejects things that aren't boarding passes (never invents a trip)", () => {
    expect(parseBcbp("")).toBeNull();
    expect(parseBcbp("hello world")).toBeNull();
    expect(parseBcbp("https://example.com/some/qr/url")).toBeNull();
    // Right shape but non-IATA airport codes → rejected.
    expect(parseBcbp("M1TEST/A             E1234567 99988877712 226F001A0025 100")).toBeNull();
  });

  it("tolerates a trailing newline from a scanner", () => {
    expect(parseBcbp(ONE_LEG + "\r\n")?.legs[0]?.from).toBe("YUL");
  });
});

describe("julianToDate", () => {
  it("resolves the day-of-year within the current year when it's in the past", () => {
    // Day 226 = 14 Aug; scanning on 1 Sep 2026 → 2026-08-14.
    expect(julianToDate(226, new Date("2026-09-01T00:00:00Z"))).toBe("2026-08-14");
  });

  it("keeps this year for a pass obtained weeks ahead of departure", () => {
    // Scanning on 7 Jul 2026 a day-226 (14 Aug) pass — ~5 weeks out — stays 2026.
    expect(julianToDate(226, new Date("2026-07-07T00:00:00Z"))).toBe("2026-08-14");
  });

  it("assumes last year only when the date is far in the future (>~3 months)", () => {
    // Scanning on 2 Jan 2026 a day-360 (26 Dec) pass is a flight already taken → 2025.
    expect(julianToDate(360, new Date("2026-01-02T00:00:00Z"))).toBe("2025-12-26");
  });

  it("reads 'this year' on the local calendar, not UTC's", () => {
    const saved = process.env.TZ;
    // 08:00 on 1 Jan 2026 in Tokyo is still 31 Dec 2025 in UTC; a day-1 pass
    // scanned then is today's flight, not one a year ago.
    process.env.TZ = "Asia/Tokyo";
    try {
      expect(julianToDate(1, new Date("2025-12-31T23:00:00Z"))).toBe("2026-01-01");
    } finally {
      if (saved === undefined) delete process.env.TZ;
      else process.env.TZ = saved;
    }
  });

  it("clamps day 366 in a non-leap year to Dec 31 instead of rolling into January", () => {
    // 2025 is not a leap year; day 366 must not become 2026-01-01.
    expect(julianToDate(366, new Date("2025-12-30T00:00:00Z"))).toBe("2025-12-31");
  });
});
