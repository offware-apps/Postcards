import { describe, it, expect } from "vitest";
import {
  parseTripDate,
  isValidTripDate,
  formatTripDate,
  compareTripDate,
  tripDateSpan,
} from "../../src/features/travel/tripDate";

describe("tripDate — approximate trip dates (spec 019)", () => {
  it("parses year, month, and full-day granularities", () => {
    expect(parseTripDate("2024")).toEqual({ year: 2024, month: null, day: null });
    expect(parseTripDate("2024-08")).toEqual({ year: 2024, month: 8, day: null });
    expect(parseTripDate("2024-08-12")).toEqual({ year: 2024, month: 8, day: 12 });
    expect(parseTripDate(null)).toBeNull();
    expect(parseTripDate("")).toBeNull();
  });

  it("rejects malformed or out-of-range dates", () => {
    expect(isValidTripDate("2024")).toBe(true);
    expect(isValidTripDate("2024-13")).toBe(false); // no month 13
    expect(isValidTripDate("2024-00")).toBe(false);
    expect(isValidTripDate("2024-08-40")).toBe(false); // no day 40
    expect(isValidTripDate("2024-02-30")).toBe(false); // no Feb 30
    expect(isValidTripDate("2023-02-29")).toBe(false); // not a leap year
    expect(isValidTripDate("2024-02-29")).toBe(true);
    expect(formatTripDate("2024-02-31", "en")).toBe(""); // never rolled into March
    expect(isValidTripDate("abc")).toBe(false);
    expect(isValidTripDate("24-08")).toBe(false);
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

  it("sorts ascending with undated last; year-only orders at its start", () => {
    const dates = ["2024-08-12", null, "2023", "2024", "2024-01"];
    const sorted = [...dates].sort(compareTripDate);
    expect(sorted).toEqual(["2023", "2024", "2024-01", "2024-08-12", null]);
  });
});
