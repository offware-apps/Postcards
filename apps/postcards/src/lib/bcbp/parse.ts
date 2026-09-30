// Parse an IATA BCBP (Bar-Coded Boarding Pass, Resolution 792) string into its
// flight legs. This is the raw text encoded in the PDF417/Aztec/QR barcode on a
// boarding pass. Parsing is 100% on-device — the ticket never leaves the phone
// (Constitution: privacy by default; data is inert — we read, never execute).
//
// Mandatory layout (per leg), positions are into the string:
//   0      format code 'M'
//   1      number of legs (digit)
//   2..22  passenger name (20)
//   22     electronic-ticket indicator
//   then per leg, a repeated 37-char mandatory block:
//     PNR(7) From(3) To(3) Carrier(3) Flight(5) JulianDate(3) Compartment(1)
//     Seat(4) CheckIn(5) Status(1) VarFieldSize(2 hex)
//   followed by a variable field of VarFieldSize bytes (conditional + airline).

export interface BcbpLeg {
  from: string; // 3-letter IATA departure
  to: string; // 3-letter IATA arrival
  carrier: string; // operating carrier (may be empty)
  flightNumber: string; // trimmed, no leading zeros (may be empty)
  julianDay: number; // day of year 1..366 (year is not encoded)
}

export interface BcbpResult {
  passengerName: string;
  legs: BcbpLeg[];
}

const IATA3 = /^[A-Z]{3}$/;

/** Parse a BCBP string, or return null if it isn't a recognisable boarding pass. */
export function parseBcbp(raw: string): BcbpResult | null {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/\r?\n/g, "").trimEnd();
  if (s.length < 60 || s[0] !== "M") return null;
  const legCount = Number(s[1]);
  if (!Number.isInteger(legCount) || legCount < 1 || legCount > 4) return null;

  const passengerName = s.slice(2, 22).trim();
  const legs: BcbpLeg[] = [];
  let i = 23; // first repeated mandatory block

  for (let n = 0; n < legCount; n++) {
    if (i + 37 > s.length) break;
    // i..i+7 PNR (skip)
    const from = s.slice(i + 7, i + 10).trim().toUpperCase();
    const to = s.slice(i + 10, i + 13).trim().toUpperCase();
    const carrier = s.slice(i + 13, i + 16).trim().toUpperCase();
    const flightRaw = s.slice(i + 16, i + 21).trim();
    const julianDay = parseInt(s.slice(i + 21, i + 24), 10);
    const varSize = parseInt(s.slice(i + 35, i + 37), 16);

    if (!IATA3.test(from) || !IATA3.test(to)) return null; // not a real boarding pass
    if (!(julianDay >= 1 && julianDay <= 366)) return null;

    legs.push({
      from,
      to,
      carrier,
      flightNumber: flightRaw.replace(/^0+/, ""),
      julianDay,
    });
    i += 37 + (Number.isFinite(varSize) ? varSize : 0);
  }

  return legs.length ? { passengerName, legs } : null;
}

/**
 * Resolve a BCBP Julian day-of-year to a YYYY-MM-DD date. The year isn't encoded
 * on the pass, so assume the most recent occurrence: this year, unless that lands
 * more than a week in the future (then it was last year) — boarding passes you
 * scan are for trips already taken.
 */
export function julianToDate(julianDay: number, now: Date): string {
  // Build the day-of-year for a given year; if it overflows that year's length
  // (day 366 in a non-leap year), clamp to Dec 31 rather than rolling into January.
  const build = (year: number): Date => {
    const d = new Date(Date.UTC(year, 0, julianDay));
    return d.getUTCFullYear() === year ? d : new Date(Date.UTC(year, 11, 31));
  };
  // The pass's day is the traveller's local calendar day, so "this year" is too.
  const year = now.getFullYear();
  let d = build(year);
  // Passes are often obtained weeks ahead of departure, so only assume "last year"
  // when the date is well beyond a plausible booking window (~3 months out).
  if (d.getTime() - now.getTime() > 92 * 24 * 60 * 60 * 1000) {
    d = build(year - 1);
  }
  return d.toISOString().slice(0, 10);
}
