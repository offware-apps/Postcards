import type { Trip, Visit } from "../../lib/schema/models";
import type { ReferenceData } from "../../lib/reference/types";
import { computeCoverage } from "../stats/computeStats";
import { travelTotals, tripDistanceKm } from "../travel/distance";
import { MODE_LABEL } from "../travel/modes";
import { tripChain } from "../travel/tripStops";
import { formatDate, formatInt, formatKm, formatPercent } from "../../lib/format/format";

/**
 * Escape a value for a Markdown table cell so it stays inert when shared:
 * pipe/newline can't break the table, and angle brackets / backticks are
 * neutralized so imported names can't smuggle raw HTML or code spans into a
 * downstream renderer that permits inline HTML.
 */
function cell(s: string): string {
  return s
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/`/g, "\\`")
    .trim();
}

/**
 * Human-readable, non-authoritative Markdown summary for sharing with friends
 * (FR-011). Not re-importable; contains no executable content.
 */
export function toMarkdown(visits: Visit[], trips: Trip[], ref: ReferenceData): string {
  const cov = computeCoverage(visits, ref);
  const lines: string[] = [];
  lines.push("# Places I've been");
  lines.push("");
  lines.push(
    `**${formatInt(cov.countriesVisited)} countries** (${formatPercent(cov.worldPct)} of the world) · ` +
      `**${formatInt(cov.citiesVisited)} cities**`,
  );
  lines.push("");
  lines.push("| Place | Type | Country | Date |");
  lines.push("| --- | --- | --- | --- |");
  const sorted = [...visits].sort((a, b) => a.place.name.localeCompare(b.place.name));
  for (const v of sorted) {
    const country = ref.countryByIso2(v.place.countryId)?.name ?? v.place.countryId;
    lines.push(
      `| ${cell(v.place.name)} | ${v.place.kind} | ${cell(country)} | ${cell(formatDate(v.date))} |`,
    );
  }

  if (trips.length) {
    const totals = travelTotals(trips, ref);
    lines.push("");
    lines.push("## Travel log");
    lines.push("");
    lines.push(`**${formatInt(totals.trips)} trips** · **${formatKm(totals.totalKm)}** travelled`);
    lines.push("");
    lines.push("| From | To | Mode | Date | Distance |");
    lines.push("| --- | --- | --- | --- | --- |");
    const byDate = [...trips].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
    for (const t of byDate) {
      const km = tripDistanceKm(t, ref);
      // A multi-stop trip names its intermediate stops and every leg's mode.
      const via = tripChain(t).slice(1, -1).map((p) => p.name);
      const to = via.length ? `${t.to.name} (via ${via.join(", ")})` : t.to.name;
      const modes = new Set(tripChain(t).slice(1).map((_, i) => t.legModes?.[i] ?? t.mode));
      lines.push(
        `| ${cell(t.from.name)} | ${cell(to)} | ${[...modes].map((m) => MODE_LABEL[m]).join(", ")} | ` +
          `${cell(formatDate(t.date))} | ${km == null ? "—" : cell(formatKm(km))} |`,
      );
    }
  }

  lines.push("");
  lines.push("_Exported from Postcards — local-first, private, offline._");
  return lines.join("\n");
}
