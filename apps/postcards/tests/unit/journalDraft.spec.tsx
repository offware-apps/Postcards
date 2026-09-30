import { it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { StoryComposer } from "../../src/features/journal/StoryComposer";
import { useStories } from "../../src/lib/store/useStories";

// The composer's crash-recovery draft keeps writing, not a story merely opened
// for editing: an untouched Edit must not come back as a recovered draft.

const SH = { kind: "city", id: "1796236", name: "Shanghai", countryId: "CN" } as const;
const story = {
  storyId: "s1",
  place: SH,
  date: "2024-07-01",
  title: "Bund walk",
  text: "t",
  addedAt: "x",
  updatedAt: "x",
};
const DRAFT_KEY = "postcards-journal-draft";

beforeEach(() => {
  localStorage.clear();
  useStories.setState({ loaded: true, stories: [story] });
});
afterEach(cleanup);

it("an untouched Edit, closed, does not reopen on the next new postcard", () => {
  const first = render(<StoryComposer storyId="s1" onClose={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  first.unmount();
  expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  render(<StoryComposer storyId={null} onClose={() => {}} />);
  expect(screen.getByLabelText("Title (optional)")).toHaveProperty("value", "");
});

it("a draft an older build cached for an Edit does not fill a new postcard", () => {
  localStorage.setItem(
    DRAFT_KEY,
    JSON.stringify({
      editingId: "s1",
      place: SH,
      date: story.date,
      title: story.title,
      text: story.text,
      folder: "",
    }),
  );
  render(<StoryComposer storyId={null} onClose={() => {}} />);
  expect(screen.getByLabelText("Title (optional)")).toHaveProperty("value", "");
});
