import { describe, it, expect, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import { GuideSection } from "../../src/features/guides/GuideButton";
import { useSettings } from "../../src/lib/store/useSettings";
import { getReferenceData } from "../../src/lib/reference/referenceData";
import type { PlaceRef } from "../../src/lib/schema/models";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("GuideSection", () => {
  it("shows the saved overview of the place it is given, not the previous one", () => {
    act(() => useSettings.setState({ autoLoadGuides: false, offlineMode: true }));
    const ref = getReferenceData();
    const paris = ref.searchCities("Paris")[0]!;
    const lyon = ref.searchCities("Lyon")[0]!;
    const save = (title: string, extract: string) =>
      localStorage.setItem(
        `postcards-guide:wikivoyage:FR:${title}`,
        JSON.stringify({ title, extract, url: "https://example.org", attribution: "Wikivoyage" }),
      );
    save(paris.name, "PARIS-EXTRACT");
    save(lyon.name, "LYON-EXTRACT");
    const p = (c: typeof paris): PlaceRef => ({ kind: "city", id: c.id, name: c.name, countryId: "FR" });
    const { rerender, container } = render(<GuideSection place={p(paris)} />);
    expect(container.textContent).toContain("PARIS-EXTRACT");
    // A city page stays mounted while it moves to a nearby place.
    rerender(<GuideSection place={p(lyon)} />);
    expect(container.textContent).toContain("LYON-EXTRACT");
    expect(container.textContent).not.toContain("PARIS-EXTRACT");
  });
});
