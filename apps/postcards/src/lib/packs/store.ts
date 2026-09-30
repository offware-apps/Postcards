import { create } from "zustand";
import { openDB } from "idb";
import type { City } from "../reference/types";
import { setPackPlaces } from "../reference/referenceData";
import { parsePack, toRawGitHubUrl, type DataPack, type InstalledPack } from "./schema";

// Installed community data packs live in their own tiny IndexedDB, separate from
// the personal journal store — a pack is REFERENCE data, not user data, and
// removing all packs never touches your visits/journal.
const DB_NAME = "postcards-packs";
const STORE = "packs";

function db() {
  return openDB(DB_NAME, 1, {
    upgrade(d) {
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: "id" });
    },
  });
}

function hasIndexedDB(): boolean {
  return typeof indexedDB !== "undefined";
}

/**
 * A pack's id, and so the namespace of its place ids: derived from its content
 * (name + licence), so the same pack gets the same place ids on every install and
 * every device, and visits to its places survive a remove/re-add or a sync.
 * FNV-1a, 32-bit, as hex.
 */
export function packNamespace(pack: DataPack): string {
  const s = `${pack.name}\u0000${pack.license}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// Packs installed before that carry a random id, and visits point at their
// pack:<random id>:<n> places. Each such id is remembered against the pack's
// namespace, outside the pack record, so re-adding the same pack after removing
// it gets the old id back.
const LEGACY_IDS_KEY = "postcards-pack-legacy-ids";

function readLegacyIds(): Record<string, string> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(LEGACY_IDS_KEY) ?? "{}");
    return v && typeof v === "object" ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function rememberLegacyIds(packs: InstalledPack[]): void {
  const ids = readLegacyIds();
  let changed = false;
  for (const p of packs) {
    const ns = packNamespace(p.pack);
    if (p.id !== ns && ids[ns] !== p.id) {
      ids[ns] = p.id;
      changed = true;
    }
  }
  if (!changed) return;
  try {
    localStorage.setItem(LEGACY_IDS_KEY, JSON.stringify(ids));
  } catch {
    /* private mode: a re-add falls back to the content-derived id */
  }
}

/** Flatten a pack's places into the reference `City` shape, with namespaced ids
 *  (pack:<packId>:<n>) so they never collide with GeoNames ids. */
function packToCities(p: InstalledPack): City[] {
  return p.pack.places.map((pl, i) => ({
    id: `pack:${p.id}:${pl.id ?? i}`,
    name: pl.name,
    countryIso2: pl.countryIso2,
    subdivisionId: null,
    lat: pl.lat,
    lon: pl.lon,
    population: null,
  }));
}

/** A pack kept under an older random id also answers to its content-derived
 *  place ids, which visits made on a device that installed it fresh carry. */
function packAliases(packs: InstalledPack[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of packs) {
    const ns = packNamespace(p.pack);
    if (p.id === ns) continue;
    p.pack.places.forEach((pl, i) => out.set(`pack:${ns}:${pl.id ?? i}`, `pack:${p.id}:${pl.id ?? i}`));
  }
  return out;
}

/** Push every installed pack's places into the reference singleton (search + map). */
function applyAll(packs: InstalledPack[]): void {
  setPackPlaces(packs.flatMap(packToCities), packAliases(packs));
}

export interface AddResult {
  ok: boolean;
  error?: string;
  name?: string;
  count?: number;
}

interface DataPacksState {
  packs: InstalledPack[];
  loaded: boolean;
  load: () => Promise<void>;
  addFromText: (text: string, sourceUrl: string | null) => Promise<AddResult>;
  addFromUrl: (url: string) => Promise<AddResult>;
  remove: (id: string) => Promise<void>;
}

export const useDataPacks = create<DataPacksState>((set, get) => ({
  packs: [],
  loaded: false,

  async load() {
    if (!hasIndexedDB()) {
      set({ loaded: true });
      return;
    }
    let packs: InstalledPack[] = [];
    try {
      packs = (await (await db()).getAll(STORE)) as InstalledPack[];
    } catch {
      /* no packs / storage unavailable */
    }
    rememberLegacyIds(packs);
    applyAll(packs);
    set({ packs, loaded: true });
  },

  async addFromText(text, sourceUrl) {
    const parsed = parsePack(text);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const ns = packNamespace(parsed.pack);
    const installed: InstalledPack = {
      id: readLegacyIds()[ns] ?? ns,
      addedAt: new Date().toISOString(),
      sourceUrl,
      pack: parsed.pack,
    };
    if (hasIndexedDB()) {
      try {
        await (await db()).put(STORE, installed);
      } catch {
        return { ok: false, error: "Couldn't save the pack on this device." };
      }
    }
    // The same pack added again replaces itself rather than doubling its places.
    const packs = [...get().packs.filter((p) => p.id !== installed.id), installed];
    applyAll(packs);
    set({ packs });
    return { ok: true, name: parsed.pack.name, count: parsed.pack.places.length };
  },

  async addFromUrl(url) {
    // Only GitHub-raw is fetched directly — the CSP connect-src allows exactly
    // those hosts, never arbitrary ones. Anything else: download + import a file.
    const raw = toRawGitHubUrl(url);
    if (!raw) {
      return {
        ok: false,
        error:
          "Only github.com / raw.githubusercontent.com / gist links are fetched directly. For any other host, download the file and use Import file.",
      };
    }
    let text: string;
    try {
      const res = await fetch(raw, { referrerPolicy: "no-referrer", credentials: "omit" });
      if (!res.ok) return { ok: false, error: `Couldn't fetch the pack (${res.status}).` };
      text = await res.text();
    } catch {
      return { ok: false, error: "Couldn't fetch the pack. Check the link and your connection." };
    }
    return get().addFromText(text, raw);
  },

  async remove(id) {
    if (hasIndexedDB()) {
      try {
        await (await db()).delete(STORE, id);
      } catch {
        /* already gone */
      }
    }
    const packs = get().packs.filter((p) => p.id !== id);
    applyAll(packs);
    set({ packs });
  },
}));
