import { describe, it, expect, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import { StatsView } from "../../src/features/stats/StatsView";
import { ShortcutsHelp } from "../../src/ui/ShortcutsHelp";
import { Attribution } from "../../src/ui/Attribution";
import { useSettings } from "../../src/lib/store/useSettings";
import { useTrips } from "../../src/lib/store/useTrips";
import { useVisits } from "../../src/lib/store/useVisits";
import type { Locale } from "../../src/lib/i18n";

const PARIS = { kind: "city", id: "2988507", name: "Paris", countryId: "FR" } as const;
const TOKYO = { kind: "city", id: "1850147", name: "Tokyo", countryId: "JP" } as const;

afterEach(() => {
  cleanup();
  act(() => useSettings.getState().setLocale("en"));
  useTrips.setState({ trips: [] });
  useVisits.setState({ visits: [] });
});

const inLocale = (locale: Locale) => act(() => useSettings.getState().setLocale(locale));

describe("strings follow the language", () => {
  it.each([
    ["fr", "Avion"],
    ["ko", "비행기"],
  ] as const)("the Stats travel mode title names the mode in %s", (locale, mode) => {
    inLocale(locale);
    useTrips.setState({
      trips: [{ tripId: "t1", from: PARIS, to: TOKYO, mode: "flight", date: null, addedAt: "x", updatedAt: "x" }] as never,
    });
    const { container } = render(<StatsView />);
    const title = container.querySelector(".tt-mode")?.getAttribute("title") ?? "";
    expect(title).toContain(mode);
    expect(title).not.toContain("flight");
  });

  it("the Stats dataset note is translated", () => {
    inLocale("fr");
    const { container } = render(<StatsView />);
    expect(container.textContent).not.toContain("Computed against");
  });

  it("the shortcuts help is translated", () => {
    inLocale("fr");
    const { getByRole } = render(<ShortcutsHelp onClose={() => {}} />);
    const dialog = getByRole("dialog");
    expect(dialog.getAttribute("aria-label")).toBe("Raccourcis clavier");
    for (const en of [
      "Keyboard shortcuts",
      "Search",
      "switch sections",
      "Write today's postcard",
      "starts another",
      "This help",
      "Close",
    ])
      expect(dialog.textContent).not.toContain(en);
  });

  it("the attribution label is translated", () => {
    inLocale("ko");
    const { container } = render(<Attribution />);
    expect(container.textContent).not.toContain("Data sources");
  });
});
