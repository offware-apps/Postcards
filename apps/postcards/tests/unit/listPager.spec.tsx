import { it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ListPager } from "../../src/ui/ListPager";
import { JournalScreen } from "../../src/features/journal/JournalScreen";
import { useStories } from "../../src/lib/store/useStories";

beforeEach(() => {
  localStorage.clear();
  Element.prototype.scrollIntoView = () => {};
});
afterEach(cleanup);

it("a label replaces the Showing X of Y text", () => {
  render(<ListPager shown={50} total={1200} step={50} onMore={() => {}} label="Top 50 of 1,200" />);
  expect(screen.getByText("Top 50 of 1,200")).toBeTruthy();
  expect(screen.queryByText(/Showing/)).toBeNull();
  expect(screen.getByRole("button", { name: "Show 50 more" })).toBeTruthy();
});

it("the journal feed pages through the shared pager", () => {
  const stories = Array.from({ length: 25 }, (_, i) => ({
    storyId: `s${i}`,
    place: { kind: "city", id: "1796236", name: "Shanghai", countryId: "CN" } as const,
    date: `2024-07-${String(i + 1).padStart(2, "0")}`,
    title: `Story ${i}`,
    text: "t",
    addedAt: "x",
    updatedAt: "x",
  }));
  useStories.setState({ loaded: true, stories });
  render(<JournalScreen />);
  expect(screen.getByText("Showing 20 of 25")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Show 5 more" }));
  expect(screen.queryByText(/Showing \d+ of 25/)).toBeNull();
  expect(screen.getByText("Story 0")).toBeTruthy();
});
