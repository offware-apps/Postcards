import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("idb", () => import("./fakeIdb"));
const remote: { content: string | null; version: number } = { content: null, version: 0 };
vi.mock("../../src/lib/publish/gitTarget", () => {
  class GitPushConflictError extends Error {}
  class GitHubTarget {
    name = "github";
    async getFile() {
      return remote.content == null
        ? null
        : { content: remote.content, version: String(remote.version) };
    }
    async putFileConditional(_path: string, content: string) {
      remote.content = content;
      remote.version++;
    }
  }
  return { GitHubTarget, GitPushConflictError };
});
import { clearDatabases } from "./fakeIdb";
import { useVisits } from "../../src/lib/store/useVisits";
import { useTrips } from "../../src/lib/store/useTrips";
import { useStories } from "../../src/lib/store/useStories";
import { putStory } from "../../src/lib/db/storiesDb";
import { importFile } from "../../src/features/backup/importJson";
import { buildFile, serializeFile } from "../../src/features/backup/exportJson";
import { buildArchive } from "../../src/features/backup/archiveZip";
import { restoreFromJson } from "../../src/features/backup/restore";
import { runDeviceSync } from "../../src/lib/sync/runSync";
import type { Story } from "../../src/lib/schema/models";
import type { TFunction } from "../../src/lib/i18n";

// A photo whose base64 payload does not decode ("@@@") renders as nothing and
// breaks every decoder. An import refuses it; a device that already holds one,
// on a story restored before imports checked, still exports, syncs and restores.

(globalThis as { indexedDB?: unknown }).indexedDB = {};
const cfg = { owner: "o", repo: "r", branch: "main", token: "t" };
const t = ((k: string) => k) as unknown as TFunction;

const GOOD =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const BAD = "data:image/png;base64,@@@";
const place = { kind: "city", id: "p", name: "P", countryId: "FR" } as const;
const at = "2026-01-01T00:00:00.000Z";

const story = (storyId: string, srcs: string[]): Story => ({
  storyId,
  place,
  date: "2026-01-01",
  title: storyId,
  text: "x",
  addedAt: at,
  updatedAt: at,
  photos: srcs.map((src) => ({ src, caption: null })),
});

const file = (visitSrcs: string[], storySrcs: string[]) =>
  JSON.stringify({
    format: "postcards",
    schemaVersion: 12,
    exportedAt: at,
    visits: [
      {
        visitId: "v1",
        place,
        date: null,
        note: null,
        status: "visited",
        favorite: false,
        addedAt: at,
        photos: visitSrcs.map((src) => ({ src, caption: null })),
      },
    ],
    trips: [],
    stories: [story("s1", storySrcs)],
  });

describe("an import refuses a photo that does not decode", () => {
  it("on a place or a story, with the normal import error", () => {
    expect(importFile(file([BAD], [])).ok).toBe(false);
    expect(importFile(file([], [BAD])).ok).toBe(false);
    expect(importFile(file([GOOD], [GOOD])).ok).toBe(true);
  });

  it("still takes base64 that atob decodes, whitespace and missing padding included", () => {
    const loose = GOOD.replace("==", "").replace("iVBOR", "iVB OR\n");
    expect(importFile(file([loose], [])).ok).toBe(true);
  });
});

describe("a device already holding one still backs up", () => {
  beforeEach(() => {
    clearDatabases();
    remote.content = null;
    useVisits.setState({ visits: [], loaded: true });
    useTrips.setState({ trips: [], loaded: true });
    useStories.setState({ stories: [], loaded: true });
  });

  it("buildFile drops the undecodable photo and keeps the rest", () => {
    const out = buildFile([], [], [story("s1", [BAD, GOOD]), story("s2", [BAD])]);
    expect(out.stories[0]!.photos).toEqual([{ src: GOOD, caption: null }]);
    expect(out.stories[1]!.photos).toBeUndefined();
    expect(() => buildArchive([], [], [story("s1", [BAD, GOOD])])).not.toThrow();
  });

  it("its export restores", async () => {
    const backup = serializeFile([], [], [story("s1", [BAD, GOOD])]);
    const r = await restoreFromJson(backup, t);
    expect(r.ok).toBe(true);
    expect(useStories.getState().stories[0]!.photos).toEqual([{ src: GOOD, caption: null }]);
  });

  it("its sync push writes a file another device can import", async () => {
    const s = story("s1", [BAD, GOOD]);
    await putStory(s);
    useStories.setState({ stories: [s], loaded: true });
    await runDeviceSync(cfg);
    expect(remote.content).not.toBeNull();
    const pulled = importFile(remote.content!);
    expect(pulled.ok).toBe(true);
    if (pulled.ok) expect(pulled.stories[0]!.photos).toEqual([{ src: GOOD, caption: null }]);
  });
});
