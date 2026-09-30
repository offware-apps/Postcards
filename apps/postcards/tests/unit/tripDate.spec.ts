import { describe, it, expect } from "vitest";
import { parseTripDate, formatTripDate, tripDateSpan } from "../../src/features/travel/tripDate";

describe("tripDate — approximate trip dates (spec 019)", () => {
  it("parses year, month, and full-day granularities", () => {
    expect(parseTripDate("2024")).toEqual({ year: 2024, month: null, day: null });
    expect(parseTripDate("2024-08")).toEqual({ year: 2024, month: 8, day: null });
    expect(parseTripDate("2024-08-12")).toEqual({ year: 2024, month: 8, day: 12 });
    expect(parseTripDate(null)).toBeNull();
    expect(parseTripDate("")).toBeNull();
  });

  it("rejects malformed or out-of-range dates", () => {
    expect(parseTripDate("2024-13")).toBeNull(); // no month 13
    expect(parseTripDate("2024-00")).toBeNull();
    expect(parseTripDate("2024-08-40")).toBeNull(); // no day 40
    expect(parseTripDate("2024-02-30")).toBeNull(); // no Feb 30
    expect(parseTripDate("2023-02-29")).toBeNull(); // not a leap year
    expect(parseTripDate("2024-02-29")).toEqual({ year: 2024, month: 2, day: 29 });
    expect(formatTripDate("2024-02-31", "en")).toBe(""); // never rolled into March
    expect(parseTripDate("abc")).toBeNull();
    expect(parseTripDate("24-08")).toBeNull();
  });

  it("formats each granularity (year, month, full day)", () => {
    expect(formatTripDate("2024", "en")).toBe("2024");
    expect(formatTripDate("2024-08", "en")).toBe("Aug 2024");
    // A full day reuses the app-wide medium format (matches visits/journal rows).
    expect(formatTripDate("2024-08-12", "en")).toBe("Aug 12, 2024");
    expect(formatTripDate(null, "en")).toBe("");
  });

  it("spans the days a vague date covers", () => {
    expect(tripDateSpan("2024")).toEqual({ first: "2024-01-01", last: "2024-12-31" });
    expect(tripDateSpan("2024-02")).toEqual({ first: "2024-02-01", last: "2024-02-29" });
    expect(tripDateSpan("2023-02")).toEqual({ first: "2023-02-01", last: "2023-02-28" });
    expect(tripDateSpan("2024-08-12")).toEqual({ first: "2024-08-12", last: "2024-08-12" });
    expect(tripDateSpan(null)).toBeNull();
    expect(tripDateSpan("2024-13")).toBeNull();
  });
});
