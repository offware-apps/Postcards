import { describe, it, expect } from "vitest";
import { serializeFile } from "../../src/features/backup/exportJson";
import { importFile } from "../../src/features/backup/importJson";
import { StorySchema, type Story } from "../../src/lib/schema/models";
import { sortStories } from "../../src/lib/store/useStories";
import { journalToMarkdown } from "../../src/features/journal/exportJournalMd";
import { getReferenceData } from "../../src/lib/reference/referenceData";

const dataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function story(): Story {
  return {
    storyId: crypto.randomUUID(),
    place: { kind: "city", id: "paris-fr", name: "Paris", countryId: "FR" },
    date: "2019-08-12",
    title: "Three days in the old town",
    text: "We got lost twice.\nWorth it.",
    addedAt: new Date().toISOString(),
  };
}

describe("journal round-trip", () => {
  it("export -> import keeps text that starts with - + = @ verbatim", () => {
    const s: Story = { ...story(), title: "-20°C in Tromsø", text: "- packed: boots\n- thermos" };
    const r = importFile(serializeFile([], [], [s]));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.stories[0]!.title).toBe("-20°C in Tromsø");
      expect(r.stories[0]!.text).toBe("- packed: boots\n- thermos");
    }
  });

  it("export -> import restores an identical story (photo included)", () => {
    const original = [{ ...story(), photos: [{ src: dataUrl, caption: "the view" }] }];
    const result = importFile(serializeFile([], [], original));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.stories).toEqual(original);
  });

  it("preserves the story's line breaks through export -> import", () => {
    const result = importFile(serializeFile([], [], [story()]));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.stories[0]!.text).toBe("We got lost twice.\nWorth it.");
  });

  it("rejects a story photo whose src is an external URL (privacy: photos must be inline)", () => {
    const text = JSON.stringify({
      format: "postcards",
      schemaVersion: 5,
      exportedAt: new Date().toISOString(),
      visits: [],
      stories: [{ ...story(), photos: [{ src: "https://evil.example/track.png" }] }],
    });
    expect(importFile(text)).toMatchObject({ ok: false });
  });

  it("imports a v4 file without a stories key (older files unchanged)", () => {
    const text = JSON.stringify({
      format: "postcards",
      schemaVersion: 4,
      exportedAt: new Date().toISOString(),
      visits: [],
    });
    const result = importFile(text);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.stories).toEqual([]);
  });

  it("round-trips a story WITH a folder label (grouping preserved)", () => {
    const original = [{ ...story(), folder: "Japan 2024" }];
    const result = importFile(serializeFile([], [], original));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.stories).toEqual(original);
  });

  it("omits the folder key when a story has none (byte-identical, back-compatible)", () => {
    const s = story();
    expect("folder" in s).toBe(false);
    // The export must not introduce a folder key for a folder-less story…
    const json = serializeFile([], [], [s]);
    expect(json).not.toContain('"folder"');
    // …and the schema parse must not inject one either (older files unchanged).
    expect(StorySchema.parse(s).folder).toBeUndefined();
    const result = importFile(json);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.stories[0]).toEqual(s);
  });

  it("merges duplicate story ids on import (last-wins, like trips)", () => {
    const dup = story();
    const text = JSON.stringify({
      format: "postcards",
      schemaVersion: 5,
      exportedAt: new Date().toISOString(),
      visits: [],
      stories: [dup, { ...dup, title: "Second telling" }],
    });
    const result = importFile(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.stories).toHaveLength(1);
      expect(result.stories[0]!.title).toBe("Second telling");
      expect(result.warnings.length).toBeGreaterThan(0);
    }
  });
});

describe("StorySchema (strict, sanitized)", () => {
  it("requires a date, and at least a title, text or photo", () => {
    const noDate = { ...story() } as Record<string, unknown>;
    delete noDate.date;
    expect(StorySchema.safeParse(noDate).success).toBe(false);
    // Title may be empty when there's text (title is optional now).
    expect(StorySchema.safeParse({ ...story(), title: "" }).success).toBe(true);
    // No title, no text, no photos → an empty story is rejected.
    expect(StorySchema.safeParse({ ...story(), title: "", text: "" }).success).toBe(false);
    // Image-only (no title, no text, but a photo) is allowed.
    expect(
      StorySchema.safeParse({
        ...story(),
        title: "",
        text: "",
        photos: [{ src: dataUrl, caption: null }],
      }).success,
    ).toBe(true);
  });

  it("rejects unknown keys (strict)", () => {
    expect(StorySchema.safeParse({ ...story(), evil: 1 }).success).toBe(false);
  });

  it("keeps formula-like title and text as inert text", () => {
    const r = StorySchema.parse({ ...story(), title: "=HYPERLINK(evil)", text: "=IMPORTXML(evil)" });
    expect(r.title).toBe("=HYPERLINK(evil)");
    expect(r.text).toBe("=IMPORTXML(evil)");
  });

  it("a title that sanitizes to empty is allowed only when there's other content", () => {
    // A lone U+200B sanitizes to "" — fine here because the story still has text.
    expect(StorySchema.safeParse({ ...story(), title: "\u200b" }).success).toBe(true);
    // With no text and no photos, that empty-sanitizing title leaves nothing → rejected.
    expect(StorySchema.safeParse({ ...story(), title: "\u200b", text: "" }).success).toBe(false);
  });

  it("caps a story's gallery at 24 photos", () => {
    const photos = Array.from({ length: 25 }, () => ({ src: dataUrl, caption: null }));
    expect(StorySchema.safeParse({ ...story(), photos }).success).toBe(false);
  });

  it("sanitizes a folder label, and drops one that sanitizes away (never stored empty)", () => {
    // Invisible characters are stripped; a leading formula char is plain text.
    expect(StorySchema.parse({ ...story(), folder: "\u200bJapan 2024" }).folder).toBe("Japan 2024");
    expect(StorySchema.parse({ ...story(), folder: "=Japan 2024" }).folder).toBe("=Japan 2024");
    // A lone U+200B sanitizes to "" → the optional folder is dropped, not stored empty.
    expect(StorySchema.parse({ ...story(), folder: "\u200b" }).folder).toBeUndefined();
  });
});

describe("journal markdown export (inert for sharing)", () => {
  it("neutralizes Markdown image/link syntax so a hostile story can't plant a tracker", () => {
    const hostile = {
      ...story(),
      title: "Nice day ![](https://tracker.example/p.png)",
      text: "See [here](https://tracker.example/x) for more.",
    };
    const out = journalToMarkdown([hostile], getReferenceData());
    // Square brackets must be escaped — `![](…)` / `[](…)` must not survive
    // as renderable syntax in the shared document.
    expect(out).not.toContain("![](https://tracker.example/p.png)");
    expect(out).not.toContain("[here](https://tracker.example/x)");
    expect(out).toContain("\\[");
    // The visible text itself is preserved (escaped, not deleted).
    expect(out).toContain("tracker.example");
  });
});

describe("journal ordering", () => {
  it("sorts newest story date first", () => {
    const a = { ...story(), date: "2020-01-01" };
    const b = { ...story(), date: "2023-05-05" };
    const c = { ...story(), date: "2021-12-31" };
    expect(sortStories([a, b, c]).map((s) => s.date)).toEqual([
      "2023-05-05",
      "2021-12-31",
      "2020-01-01",
    ]);
  });
});
