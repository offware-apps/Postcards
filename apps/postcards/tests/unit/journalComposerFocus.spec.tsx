import { it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { JournalScreen } from "../../src/features/journal/JournalScreen";
import { StoryComposer } from "../../src/features/journal/StoryComposer";
import { useStories } from "../../src/lib/store/useStories";
import { useUi } from "../../src/lib/store/useUi";

// Write a postcard swaps the Journal for the composer page and back, so opening
// and closing the composer must place focus rather than drop it on the body.

const STORY = {
  storyId: "s1",
  place: { kind: "city", id: "2988507", name: "Paris", countryId: "FR" },
  date: "2024-05-01",
  title: "Bund",
  text: "",
  photos: [],
  addedAt: "x",
  updatedAt: "x",
} as const;

beforeEach(() => {
  localStorage.clear();
  Element.prototype.scrollIntoView = () => {};
  useStories.setState({ loaded: true, stories: [] });
  useUi.setState({ storyEditId: null, storyDraftPlace: null });
});
afterEach(cleanup);

/** The page switch App makes between the Journal and the composer. */
function Journal() {
  const id = useUi((s) => s.storyEditId);
  return id ? (
    <StoryComposer
      storyId={id === "new" ? null : id}
      onClose={() => useUi.getState().closeStoryComposer()}
    />
  ) : (
    <JournalScreen />
  );
}

function click(name: RegExp | string) {
  const button = screen.getByRole("button", { name });
  button.focus();
  fireEvent.click(button);
}

it("Write a postcard moves focus into the composer", () => {
  render(<Journal />);
  click(/Write a postcard/);
  expect(document.activeElement).toBe(document.getElementById("story-text"));
});

it("Cancel gives focus back to Write a postcard", () => {
  render(<Journal />);
  click(/Write a postcard/);
  click("Cancel");
  expect(document.activeElement).toBe(screen.getByRole("button", { name: /Write a postcard/ }));
});

it("Back gives focus back to Write a postcard", () => {
  render(<Journal />);
  click(/Write a postcard/);
  fireEvent.change(document.getElementById("story-title")!, { target: { value: "Bund" } });
  click("Back");
  expect(document.activeElement).toBe(screen.getByRole("button", { name: /Write a postcard/ }));
});

it("Edit moves focus into the composer and back out on Cancel", () => {
  useStories.setState({ stories: [STORY] as never });
  render(<Journal />);
  click(/^Edit/);
  expect(document.activeElement).toBe(document.getElementById("story-date"));
  click("Cancel");
  expect(document.activeElement).toBe(screen.getByRole("button", { name: /Write a postcard/ }));
});
