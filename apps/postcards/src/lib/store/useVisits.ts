import { create } from "zustand";
import { backfillUpdatedAt, MAX_PHOTOS_PER_VISIT, normalizeVisitPhotos, placeKey, stampNow } from "../schema/helpers";
import type { Photo, PlaceRef, Visit } from "../schema/models";
import { sanitizeText } from "../schema/sanitize";
import * as db from "../db/visitsDb";
import { stampPlaceCoords } from "../reference/placeCoords";
import { uuid } from "./uuid";

/** Now, as the ISO stamp written to `updatedAt` on every mutating path (spec 013). */

/**
 * Pure dedupe/upsert: at most one visit per (kind, id) (FR-015).
 * Re-logging a place updates the existing record instead of duplicating.
 * Exported for unit testing without IndexedDB.
 */
export function dedupeUpsert(list: Visit[], visit: Visit): Visit[] {
  const key = placeKey(visit.place);
  const idx = list.findIndex((v) => placeKey(v.place) === key);
  if (idx === -1) return [...list, visit];
  const next = list.slice();
  next[idx] = { ...visit, visitId: list[idx]!.visitId, addedAt: list[idx]!.addedAt };
  return next;
}

export function findByPlace(list: Visit[], place: Pick<PlaceRef, "kind" | "id">): Visit | undefined {
  const key = placeKey(place);
  return list.find((v) => placeKey(v.place) === key);
}

/**
 * O(1) placeKey → Visit lookups for hot paths that would otherwise scan the
 * whole list per row (Zustand re-runs every subscribed selector on every
 * set(), so hundreds of mounted per-place selectors each paid a linear scan).
 * Cached by array identity: the store replaces `visits` immutably on every
 * set(), so the array reference is a valid cache key, and the WeakMap lets
 * superseded indexes be collected with their arrays.
 */
const idxCache = new WeakMap<Visit[], Map<string, Visit>>();
export function visitIndex(list: Visit[]): Map<string, Visit> {
  let m = idxCache.get(list);
  if (!m) {
    m = new Map(list.map((v) => [placeKey(v.place), v]));
    idxCache.set(list, m);
  }
  return m;
}

/** Today as a local YYYY-MM-DD — the default "visited on" for a new visit. */
export function todayISO(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

interface VisitsState {
  visits: Visit[];
  loaded: boolean;
  load: () => Promise<void>;
  addVisit: (input: {
    place: PlaceRef;
    date?: string | null;
    note?: string | null;
    status?: Visit["status"];
    favorite?: boolean;
  }) => Promise<Visit>;
  removeVisit: (visitId: string) => Promise<void>;
  /** "+" semantics: none -> visited; wishlist -> becomes visited; visited -> removed. */
  toggleVisit: (place: PlaceRef) => Promise<void>;
  /** "⚑" semantics: none -> wishlist; wishlist -> removed; visited -> untouched. */
  toggleWish: (place: PlaceRef) => Promise<void>;
  /** "★" on an existing record (visited or wishlist). */
  toggleFavorite: (place: PlaceRef) => Promise<void>;
  /** Append a photo to a visit's gallery. */
  addPhoto: (visitId: string, photo: Photo) => Promise<void>;
  /** Append several photos in ONE write — a multi-photo pick must not re-put
   *  the whole (multi-MB) record once per photo. */
  addPhotos: (visitId: string, photos: Photo[]) => Promise<void>;
  /** Remove the photo at `index` from a visit's gallery. */
  removePhoto: (visitId: string, index: number) => Promise<void>;
  /** Set (or clear, with null) the caption on the photo at `index`. */
  setPhotoCaption: (visitId: string, index: number, caption: string | null) => Promise<void>;
  /** Set or clear the visit's own date and/or note (FR-002). */
  setDetails: (
    visitId: string,
    details: { date?: string | null; note?: string | null; folder?: string | null },
  ) => Promise<void>;
  /** Put ONE visit back (single-record undo): upsert by visitId, one write —
   *  setAll would clear and rewrite the entire visits table. */
  restoreVisit: (visit: Visit) => Promise<void>;
  /** Merge imported places into the existing visits, upserting by (kind,id):
   *  a NON-destructive add (trips, stories, and any place not in the file are
   *  untouched; an existing place keeps its photos/note/addedAt). Returns how
   *  many were added vs updated. */
  mergeVisits: (
    incoming: { place: PlaceRef; status: Visit["status"]; favorite?: boolean; date?: string | null }[],
  ) => Promise<{ added: number; updated: number }>;
  setAll: (visits: Visit[]) => Promise<void>;
}

export const useVisits = create<VisitsState>((set, get) => ({
  visits: [],
  loaded: false,
  async load() {
    // Migrate any legacy single-photo records into the `photos` gallery, and
    // backfill `updatedAt` from `addedAt` for records made before sync existed.
    const dbVisits = (await db.getAllVisits()).map(normalizeVisitPhotos).map(backfillUpdatedAt);
    // Don't clobber optimistic writes that landed DURING this async read: marking a
    // place and immediately opening a list would otherwise blank it (the snapshot
    // predated the in-flight putVisit). Merge by id, newest `updatedAt` winning —
    // a no-op on the normal path where nothing was written yet (in-memory empty).
    const inMem = get().visits;
    if (inMem.length === 0) {
      set({ visits: dbVisits, loaded: true });
      return;
    }
    const byId = new Map(dbVisits.map((v) => [v.visitId, v]));
    for (const v of inMem) {
      const prior = byId.get(v.visitId);
      if (!prior || (v.updatedAt ?? "") >= (prior.updatedAt ?? "")) byId.set(v.visitId, v);
    }
    set({ visits: [...byId.values()], loaded: true });
  },
  async addVisit({ place, date = null, note = null, status = "visited", favorite = false }) {
    const existing = findByPlace(get().visits, place);
    // Stamp coordinates onto the record now, while the place is fresh from the
    // in-memory gazetteer — so it can be mapped later without it (published
    // sites, the portable file, a device on the top-10k bundle only).
    place = stampPlaceCoords(place);
    const visit: Visit = {
      visitId: existing?.visitId ?? uuid(),
      place,
      status,
      favorite: existing?.favorite ?? favorite,
      // A place marked visited defaults to visited TODAY — usually true, one
      // less thing to fill in, and editable on the place page.
      date: date ?? existing?.date ?? (status === "visited" ? todayISO() : null),
      note: note ?? existing?.note ?? null,
      photos: existing?.photos ?? [], // keep the gallery across re-logs/status changes
      addedAt: existing?.addedAt ?? new Date().toISOString(),
      updatedAt: stampNow(), // addedAt is immutable; updatedAt moves on every write
    };
    set({ visits: dedupeUpsert(get().visits, visit) });
    await db.putVisit(visit);
    return visit;
  },
  async removeVisit(visitId) {
    set({ visits: get().visits.filter((v) => v.visitId !== visitId) });
    await db.deleteVisit(visitId);
    // Record a tombstone so the deletion propagates on sync instead of the record
    // being re-added by a device that still holds it (spec 013, FR-009).
    await db.putTombstone("visit", visitId, stampNow());
  },
  async toggleVisit(place) {
    const existing = findByPlace(get().visits, place);
    if (existing && existing.status === "visited") await get().removeVisit(existing.visitId);
    else await get().addVisit({ place, status: "visited" });
  },
  async toggleWish(place) {
    const existing = findByPlace(get().visits, place);
    if (!existing) {
      await get().addVisit({ place, status: "wishlist" });
    } else if (existing.status === "wishlist") {
      await get().removeVisit(existing.visitId);
    }
    // Already visited: wishing is a no-op — you've been there.
  },
  async toggleFavorite(place) {
    const existing = findByPlace(get().visits, place);
    if (!existing) return;
    const updated: Visit = { ...existing, favorite: !existing.favorite, updatedAt: stampNow() };
    set({ visits: get().visits.map((v) => (v.visitId === updated.visitId ? updated : v)) });
    await db.putVisit(updated);
  },
  async addPhoto(visitId, photo) {
    await get().addPhotos(visitId, [photo]);
  },
  async addPhotos(visitId, photos) {
    const existing = get().visits.find((v) => v.visitId === visitId);
    if (!existing || photos.length === 0) return;
    // Bound the gallery so an export can never exceed the schema's photos cap (which
    // would make buildFile's self-validation throw and block backup entirely).
    const room = MAX_PHOTOS_PER_VISIT - (existing.photos?.length ?? 0);
    if (room <= 0) return;
    const updated: Visit = {
      ...existing,
      photos: [...(existing.photos ?? []), ...photos.slice(0, room)],
      updatedAt: stampNow(),
    };
    set({ visits: get().visits.map((v) => (v.visitId === visitId ? updated : v)) });
    await db.putVisit(updated);
  },
  async removePhoto(visitId, index) {
    const existing = get().visits.find((v) => v.visitId === visitId);
    if (!existing?.photos) return;
    const updated: Visit = {
      ...existing,
      photos: existing.photos.filter((_, i) => i !== index),
      updatedAt: stampNow(),
    };
    set({ visits: get().visits.map((v) => (v.visitId === visitId ? updated : v)) });
    await db.putVisit(updated);
  },
  async setPhotoCaption(visitId, index, caption) {
    const existing = get().visits.find((v) => v.visitId === visitId);
    if (!existing?.photos?.[index]) return;
    const photos = existing.photos.map((p, i) =>
      i === index ? { ...p, caption: caption?.trim() ? caption.trim() : null } : p,
    );
    const updated: Visit = { ...existing, photos, updatedAt: stampNow() };
    set({ visits: get().visits.map((v) => (v.visitId === visitId ? updated : v)) });
    await db.putVisit(updated);
  },
  async setDetails(visitId, details) {
    const existing = get().visits.find((v) => v.visitId === visitId);
    if (!existing) return;
    const updated: Visit = {
      ...existing,
      // Only the fields the caller passed change; text is sanitized like the
      // portable file would on import (inert data, same caps).
      ...(details.date !== undefined ? { date: details.date || null } : {}),
      ...(details.note !== undefined
        ? { note: details.note?.trim() ? sanitizeText(details.note, 2000) : null }
        : {}),
      // Folder: a sanitized value groups the place; an empty one clears the key
      // (undefined) so the record round-trips like a folder-less one.
      ...(details.folder !== undefined
        ? { folder: details.folder?.trim() ? sanitizeText(details.folder, 80) : undefined }
        : {}),
      updatedAt: stampNow(),
    };
    set({ visits: get().visits.map((v) => (v.visitId === visitId ? updated : v)) });
    await db.putVisit(updated);
  },
  async restoreVisit(visit) {
    // Undo of a delete/photo-remove: bump `updatedAt` so the revived record wins
    // over its own tombstone on the next merge (an edit newer than a delete
    // revives), and clear that tombstone so the restore is clean.
    const restored: Visit = { ...visit, updatedAt: stampNow() };
    const exists = get().visits.some((v) => v.visitId === restored.visitId);
    set({
      visits: exists
        ? get().visits.map((v) => (v.visitId === restored.visitId ? restored : v))
        : [...get().visits, restored],
    });
    await db.putVisit(restored);
    await db.deleteTombstone("visit", restored.visitId);
  },
  async mergeVisits(incoming) {
    const byKey = new Map(get().visits.map((v) => [placeKey(v.place), v]));
    let added = 0;
    let updated = 0;
    for (const item of incoming) {
      const key = placeKey(item.place);
      const existing = byKey.get(key);
      if (existing) {
        byKey.set(key, {
          ...existing,
          place: item.place, // refresh coords/name if the import carries better
          status: item.status,
          favorite: item.favorite ?? existing.favorite,
          date: item.date ?? existing.date,
          updatedAt: stampNow(),
        });
        updated++;
      } else {
        const at = new Date().toISOString();
        byKey.set(key, {
          visitId: uuid(),
          place: item.place,
          status: item.status,
          favorite: item.favorite ?? false,
          date: item.date ?? null,
          note: null,
          photos: [],
          addedAt: at,
          updatedAt: at,
        });
        added++;
      }
    }
    const merged = [...byKey.values()];
    set({ visits: merged });
    await db.replaceAllVisits(merged);
    return { added, updated };
  },
  async setAll(visits) {
    // Bulk load (restore/import): normalize photos and backfill `updatedAt` from
    // `addedAt` for records that predate the field; never stamp "now" here, so an
    // imported old record keeps its real age for newest-wins.
    const normalized = visits.map(normalizeVisitPhotos).map(backfillUpdatedAt);
    set({ visits: normalized });
    await db.replaceAllVisits(normalized);
  },
}));
