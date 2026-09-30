import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const downscale = vi.hoisted(() => ({ fileToPostcard: vi.fn() }));
vi.mock("../../src/lib/image/downscale", () => downscale);

import { StoryComposer } from "../../src/features/journal/StoryComposer";
import { useStories } from "../../src/lib/store/useStories";
import { useToast } from "../../src/lib/store/useToast";
import { MAX_PHOTOS_PER_STORY } from "../../src/lib/schema/helpers";
import { serializeFile } from "../../src/features/backup/exportJson";
import { importFile } from "../../src/features/backup/importJson";

const JPEG = "data:image/jpeg;base64,AAAA";
const RLO = "‮"; // bidi override
const NUL = "\u0000";

function pickFiles(container: HTMLElement, n: number): void {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const files = Array.from({ length: n }, (_, i) => new File(["x"], `p${i}.jpg`, { type: "image/jpeg" }));
  fireEvent.change(input, { target: { files } });
}

function roundTrip() {
  const result = importFile(serializeFile([], [], useStories.getState().stories));
  if (!result.ok) throw new Error(result.error);
  return result.stories;
}

beforeEach(() => {
  localStorage.clear();
  useStories.setState({ stories: [], loaded: true });
  useToast.setState({ toast: null });
  downscale.fileToPostcard.mockReset();
  downscale.fileToPostcard.mockResolvedValue(JPEG);
});

describe("StoryComposer save", () => {
  it("stores the text an export and import give back unchanged", async () => {
    render(<StoryComposer storyId={null} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Title (optional)"), { target: { value: `=Lyon${RLO} trip` } });
    fireEvent.change(document.getElementById("story-text")!, { target: { value: `Rain${NUL} all day ` } });
    fireEvent.change(document.getElementById("story-folder")!, { target: { value: ` ${RLO}Spring ` } });
    fireEvent.click(screen.getByRole("button", { name: "Save postcard" }));
    await waitFor(() => expect(useStories.getState().stories).toHaveLength(1));

    const stored = useStories.getState().stories[0]!;
    expect(stored.title).toBe("=Lyon trip");
    expect(stored.text).toBe("Rain all day");
    expect(stored.folder).toBe("Spring");
    expect(roundTrip()).toEqual([stored]);
  });

  it("stores tags and captions as the schema cleans them, and a tag that cleans away is not kept", async () => {
    const { container } = render(<StoryComposer storyId={null} onClose={() => {}} />);
    const tagInput = screen.getByPlaceholderText("Add a tag and press Enter…");
    for (const tag of [`${RLO}sunny`, RLO, "+beach"]) {
      fireEvent.change(tagInput, { target: { value: tag } });
      fireEvent.keyDown(tagInput, { key: "Enter" });
    }
    pickFiles(container, 2);
    await screen.findByLabelText("Caption for photo 2");
    fireEvent.change(screen.getByLabelText("Caption for photo 1"), { target: { value: `@the${RLO} view` } });
    fireEvent.change(screen.getByLabelText("Caption for photo 2"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save postcard" }));
    await waitFor(() => expect(useStories.getState().stories).toHaveLength(1));

    const stored = useStories.getState().stories[0]!;
    expect(stored.tags).toEqual(["sunny", "+beach"]);
    expect(stored.photos?.map((p) => p.caption)).toEqual(["@the view", null]);
    expect(roundTrip()).toEqual([stored]);
  });
});

describe("StoryComposer photos", () => {
  it("says so when an image cannot be read", async () => {
    downscale.fileToPostcard.mockRejectedValue(new Error("decode failed"));
    const { container } = render(<StoryComposer storyId={null} onClose={() => {}} />);
    pickFiles(container, 1);
    await waitFor(() => expect(useToast.getState().toast?.message).toBe("Couldn't read that image."));
  });

  it("says how many fit when more photos are picked than the postcard holds", async () => {
    const { container } = render(<StoryComposer storyId={null} onClose={() => {}} />);
    pickFiles(container, MAX_PHOTOS_PER_STORY + 3);
    await waitFor(() =>
      expect(useToast.getState().toast?.message).toBe(`Added ${MAX_PHOTOS_PER_STORY} — the story is now full.`),
    );
    expect(downscale.fileToPostcard).toHaveBeenCalledTimes(MAX_PHOTOS_PER_STORY);
  });
});
