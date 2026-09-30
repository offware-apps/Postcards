import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { useState } from "react";
import { FilterPanel } from "../../src/ui/FilterPanel";
import { useFilters, DEFAULT_FILTERS } from "../../src/lib/store/useFilters";

afterEach(() => {
  cleanup();
  useFilters.setState({ ...DEFAULT_FILTERS });
});

// The screens that host the panel subscribe to the filter store and pass an inline
// onClose, so every filter tap re-renders the host with a new callback.
function Host() {
  useFilters();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>opener</button>
      <FilterPanel open={open} onClose={() => setOpen(false)} folders={[]} years={{ list: [], undated: false }} />
    </>
  );
}

describe("FilterPanel focus", () => {
  it("keeps focus on the pressed filter while the panel stays open", () => {
    render(<Host />);
    const opener = screen.getByText("opener");
    opener.focus();
    fireEvent.click(opener);
    const btn = screen.getByRole("button", { name: /^visited$/i });
    btn.focus();
    fireEvent.click(btn);
    expect(document.activeElement).toBe(btn);
  });

  it("returns focus to the opener on Escape", () => {
    render(<Host />);
    const opener = screen.getByText("opener");
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole("button", { name: /^visited$/i }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
