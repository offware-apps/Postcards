import { it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { JournalScreen } from "../../src/features/journal/JournalScreen";
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
const wait = () => act(() => new Promise((r) => setTimeout(r, 450))); // past the draft debounce

beforeEach(() => {
  localStorage.clear();
  Element.prototype.scrollIntoView = () => {};
  useStories.setState({ loaded: true, stories: [story] });
});
afterEach(cleanup);

it("an untouched Edit, cancelled, does not reopen on the next visit", async () => {
  const first = render(<JournalScreen />);
  fireEvent.click(screen.getAllByRole("button", { name: "Edit story Bund walk" })[0]!);
  await wait();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  first.unmount();
  render(<JournalScreen />);
  expect(screen.queryByText("Editing a story")).toBeNull();
});

it("an Edit with a change is still kept as a draft", async () => {
  const first = render(<JournalScreen />);
  fireEvent.click(screen.getAllByRole("button", { name: "Edit story Bund walk" })[0]!);
  fireEvent.change(screen.getByLabelText("Title (optional)"), { target: { value: "Bund" } });
  await wait();
  first.unmount();
  expect(JSON.parse(localStorage.getItem(DRAFT_KEY)!).title).toBe("Bund");
});

it("a draft left by an untouched Edit is dropped once seen to match its story", async () => {
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
  const first = render(<JournalScreen />);
  await wait();
  first.unmount();
  expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
});
