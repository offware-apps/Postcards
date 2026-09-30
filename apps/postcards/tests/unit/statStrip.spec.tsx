import { describe, it, expect, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { StatStrip } from "../../src/features/stats/StatStrip";
import { useVisits } from "../../src/lib/store/useVisits";
import type { Visit } from "../../src/lib/schema/models";

afterEach(() => {
  cleanup();
  useVisits.setState({ visits: [] });
});

const wish = (id: string): Visit => ({
  visitId: `v-${id}`,
  place: { kind: "country", id, name: id, countryId: id },
  date: null,
  note: null,
  status: "wishlist",
  favorite: false,
  addedAt: new Date().toISOString(),
});

describe("StatStrip", () => {
  it("keeps its counter buttons (and focus) across a store update", () => {
    render(<StatStrip />);
    const before = screen.getAllByRole("button")[0]!;
    before.focus();
    act(() => useVisits.setState({ visits: [wish("FR")] }));
    const after = screen.getAllByRole("button")[0]!;
    expect(after).toBe(before);
    expect(document.activeElement).toBe(before);
  });
});
