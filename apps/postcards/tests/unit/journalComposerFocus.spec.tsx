import { it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { JournalScreen } from "../../src/features/journal/JournalScreen";
import { useStories } from "../../src/lib/store/useStories";

// "New story" leaves the page while the composer is open, so opening and
// closing the composer must place focus rather than drop it on the body.

beforeEach(() => {
  localStorage.clear();
  Element.prototype.scrollIntoView = () => {};
  useStories.setState({ loaded: true, stories: [] });
});
afterEach(cleanup);

function openComposer() {
  const button = screen.getByRole("button", { name: /New story/ });
  button.focus();
  fireEvent.click(button);
}

it("New story moves focus into the composer's first field", () => {
  render(<JournalScreen />);
  openComposer();
  expect(document.activeElement).toBe(screen.getByLabelText("Place"));
});

it("Cancel gives focus back to New story", () => {
  render(<JournalScreen />);
  openComposer();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(document.activeElement).toBe(screen.getByRole("button", { name: /New story/ }));
});

it("Escape gives focus back to New story", () => {
  render(<JournalScreen />);
  openComposer();
  fireEvent.change(screen.getByLabelText("Title (optional)"), { target: { value: "Bund" } });
  fireEvent.keyDown(window, { key: "Escape" });
  expect(document.activeElement).toBe(screen.getByRole("button", { name: /New story/ }));
});
