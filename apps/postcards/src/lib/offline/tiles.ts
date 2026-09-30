// "Save this area for offline": pre-fetch the OSM raster tiles covering the
// current view (and a couple of zoom levels deeper) so the service worker's
// CacheFirst rule stores them and the area works with no network later.
// Only ever runs on an explicit user action (Constitution: data/requests leave
// the device only when the user asks).

// Self-contained seam: no imports from the app. Structurally identical to the
// map's viewport Bounds, so callers pass theirs straight through.
export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
  /** Current map zoom, when known (used to pick tile levels). */
  zoom?: number;
}

export const OSM_TILE_TEMPLATE = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const MAX_ZOOM = 19;

function lon2x(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}
function lat2y(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Tile URLs covering `bounds` from `baseZoom` for `levels` zoom levels, capped at
 * `maxTiles` (coarsest levels first, so a cap keeps the wider-area tiles). Pure
 * and deterministic — unit-tested.
 */
export function tilesForBounds(
  bounds: Bounds,
  baseZoom: number,
  levels = 3,
  maxTiles = 800,
  template = OSM_TILE_TEMPLATE,
): string[] {
  const z0 = clamp(Math.round(baseZoom), 1, MAX_ZOOM);
  const urls: string[] = [];
  for (let dz = 0; dz < levels && z0 + dz <= MAX_ZOOM; dz++) {
    const z = z0 + dz;
    const n = 2 ** z;
    const yMin = clamp(lat2y(bounds.north, z), 0, n - 1);
    const yMax = clamp(lat2y(bounds.south, z), 0, n - 1);
    // A viewport crossing the antimeridian has west > east; split it into two
    // x-spans ([west..edge] and [edge..east]) so the date line saves like anywhere
    // else (mirrors the wrap handling in viewport.ts).
    const xw = clamp(lon2x(bounds.west, z), 0, n - 1);
    const xe = clamp(lon2x(bounds.east, z), 0, n - 1);
    const spans: [number, number][] =
      bounds.west <= bounds.east ? [[xw, xe]] : [[xw, n - 1], [0, xe]];
    for (const [x0, x1] of spans) {
      for (let x = x0; x <= x1; x++) {
        for (let y = yMin; y <= yMax; y++) {
          if (urls.length >= maxTiles) return urls;
          urls.push(template.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y)));
        }
      }
    }
  }
  return urls;
}

// Tiles already requested this session — once fetched, the service worker's
// CacheFirst rule serves them instantly, so there's no point re-requesting.
// Bounded so a very long session can't grow it without limit.
const prefetched = new Set<string>();
const PREFETCH_SEEN_CAP = 6000;

// A 256px raster source (our OSM base) is DISPLAYED at covering-zoom
// round(mapZoom + 1) — so prefetch must target one level deeper than the map
// zoom, or it warms the blurry parent tiles the user never sees crisply while
// the sharp display tiles stay cold. Callers pass the map zoom; we add this.
const RASTER_ZOOM_OFFSET = 1;

// RequestInit with the (widely shipped, not-yet-in-lib.dom) fetch priority hint,
// so passive prefetch never elbows ahead of MapLibre's visible-tile requests.
type PrefetchInit = RequestInit & { priority?: "high" | "low" | "auto" };

/**
 * Skip passive prefetch on data-saver / very slow links — it's a nicety, never
 * worth spending a constrained user's bytes or contending on a 2g pipe.
 */
function connectionTooLimited(): boolean {
  if (typeof navigator === "undefined") return false;
  const c = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (!c) return false;
  return !!c.saveData || c.effectiveType === "2g" || c.effectiveType === "slow-2g";
}

/** The default network fetch used when a caller doesn't inject its own. */
const defaultFetch = (...a: Parameters<typeof fetch>) => fetch(...a);

/** Passive tile prefetch is a nicety — never run it offline, nor on a data-saver
 *  / slow link where it would contend with the visible tiles. */
function prefetchDisabled(): boolean {
  return (typeof navigator !== "undefined" && !navigator.onLine) || connectionTooLimited();
}

/** Fetch a list of tile URLs at low priority with 2 workers; a failed tile is
 *  dropped from the seen-set so a later pass can retry it. An optional abort
 *  signal stops in-flight work (used by the viewport ring). */
function runPrefetchPool(urls: string[], doFetch: typeof fetch, signal?: AbortSignal): void {
  let i = 0;
  async function worker() {
    while (i < urls.length) {
      if (signal?.aborted) return;
      const url = urls[i++]!;
      try {
        await doFetch(url, {
          mode: "cors",
          referrerPolicy: "strict-origin-when-cross-origin",
          priority: "low",
          ...(signal ? { signal } : {}),
        } as PrefetchInit);
      } catch {
        prefetched.delete(url); // offline blip / aborted — let a later pass retry it
      }
    }
  }
  // Low concurrency (2) so the pool never saturates the per-origin socket budget
  // MapLibre needs for the tiles actually on screen.
  for (let w = 0; w < 2; w++) void worker();
}

// In-flight ring prefetch, aborted when the next pan starts so stale off-screen
// requests never keep contending with the new viewport's visible tiles.
let ringAbort: AbortController | null = null;

/** Expand bounds by `factor` of their own span each side (lat clamped to the
 *  Web-Mercator limit, lon wrapped so antimeridian spans keep working). */
function padBounds(b: Bounds, factor: number): Bounds {
  const lonSpan = b.west <= b.east ? b.east - b.west : b.east + 360 - b.west;
  const latSpan = b.north - b.south;
  if (lonSpan * (1 + 2 * factor) >= 360) {
    return { west: -180, east: 180, south: Math.max(-85, b.south - latSpan * factor), north: Math.min(85, b.north + latSpan * factor) };
  }
  const wrap = (v: number) => ((((v + 180) % 360) + 360) % 360) - 180;
  return {
    west: wrap(b.west - lonSpan * factor),
    east: wrap(b.east + lonSpan * factor),
    south: Math.max(-85, b.south - latSpan * factor),
    north: Math.min(85, b.north + latSpan * factor),
  };
}

/**
 * Quietly warm the tile cache with the ring of tiles JUST OUTSIDE the current
 * viewport, so panning reveals ready tiles instead of blanks. Same zoom level
 * only, a small per-stop budget, session-deduped, and low concurrency — well
 * within the OSM tile usage policy (at most ~a viewport's worth of extra tiles
 * per pause, and only while online).
 */
export function prefetchAroundBounds(
  bounds: Bounds,
  zoom: number,
  opts: { maxTiles?: number; template?: string; fetchFn?: typeof fetch } = {},
): void {
  if (prefetchDisabled()) return;
  const maxTiles = opts.maxTiles ?? 40;
  const doFetch = opts.fetchFn ?? defaultFetch;
  // Target the DISPLAY level (round(zoom + 1) for 256px tiles), not the coarser
  // round(zoom) — otherwise we warm parent tiles and the crisp ones stay cold.
  const z = zoom + RASTER_ZOOM_OFFSET;
  const inside = new Set(tilesForBounds(bounds, z, 1, 500, opts.template));
  const ring = tilesForBounds(padBounds(bounds, 0.5), z, 1, 800, opts.template)
    .filter((u) => !inside.has(u) && !prefetched.has(u))
    .slice(0, maxTiles);
  if (ring.length === 0) return;
  if (prefetched.size > PREFETCH_SEEN_CAP) prefetched.clear();
  for (const url of ring) prefetched.add(url);
  // Cancel any still-running ring from a previous pause so it stops competing
  // with the new viewport's visible tiles.
  ringAbort?.abort();
  ringAbort = new AbortController();
  const signal = ringAbort.signal;
  runPrefetchPool(ring, doFetch, signal);
}

/**
 * Warm the block of tiles around a DESTINATION the camera is about to fly to,
 * in parallel with the animation — arriving somewhere far away used to mean
 * watching its tiles load one by one. A 5×5 block at the target zoom covers a
 * phone viewport plus a pan's worth of margin (≤25 tiles, session-deduped).
 */
export function prefetchAroundPoint(
  lon: number,
  lat: number,
  zoom: number,
  opts: { template?: string; fetchFn?: typeof fetch } = {},
): void {
  if (prefetchDisabled()) return;
  // Match the display level (round(zoom + 1) for 256px tiles) so the block we
  // warm is the one the camera actually renders on arrival.
  const z = clamp(Math.round(zoom + RASTER_ZOOM_OFFSET), 1, MAX_ZOOM);
  const n = 2 ** z;
  const cx = lon2x(lon, z);
  const cy = lat2y(lat, z);
  const template = opts.template ?? OSM_TILE_TEMPLATE;
  const doFetch = opts.fetchFn ?? defaultFetch;
  const urls: string[] = [];
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      const x = (((cx + dx) % n) + n) % n; // wrap across the antimeridian
      const y = cy + dy;
      if (y < 0 || y >= n) continue;
      const url = template.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
      if (!prefetched.has(url)) urls.push(url);
    }
  }
  if (urls.length === 0) return;
  if (prefetched.size > PREFETCH_SEEN_CAP) prefetched.clear();
  for (const url of urls) prefetched.add(url);
  runPrefetchPool(urls, doFetch);
}

export interface SaveProgress {
  done: number;
  total: number;
}

/**
 * Fetch every tile so the SW caches it. Uses CORS (OSM sends
 * Access-Control-Allow-Origin) so only real 200s are stored — no opaque error
 * tiles poison the cache — and an explicit referrerPolicy guarantees the Referer
 * OSM requires. Concurrency-limited and abortable: aborting `signal` cancels the
 * requests in flight too, and `stop` is checked before each tile (the caller's
 * Offline mode), so no request starts once it reports true.
 */
export async function saveAreaOffline(
  bounds: Bounds,
  baseZoom: number,
  opts: {
    levels?: number;
    maxTiles?: number;
    template?: string;
    concurrency?: number;
    onProgress?: (p: SaveProgress) => void;
    signal?: AbortSignal;
    stop?: () => boolean;
    fetchFn?: typeof fetch;
  } = {},
): Promise<{ saved: number; failed: number; total: number; capped: boolean }> {
  const maxTiles = opts.maxTiles ?? 800;
  const urls = [...new Set(tilesForBounds(bounds, baseZoom, opts.levels ?? 3, maxTiles, opts.template))];
  const capped = urls.length >= maxTiles;
  const doFetch = opts.fetchFn ?? defaultFetch;
  const total = urls.length;
  let done = 0;
  let failed = 0;
  let i = 0;
  async function worker() {
    while (i < urls.length) {
      if (opts.signal?.aborted || opts.stop?.()) return;
      const url = urls[i++]!;
      try {
        const res = await doFetch(url, {
          mode: "cors",
          referrerPolicy: "strict-origin-when-cross-origin",
          ...(opts.signal ? { signal: opts.signal } : {}),
        });
        if (!res.ok) failed++;
      } catch {
        failed++;
      }
      done++;
      opts.onProgress?.({ done, total });
    }
  }
  // Keep concurrency modest to respect the OSM tile usage policy (no bulk hammering).
  await Promise.all(Array.from({ length: opts.concurrency ?? 3 }, worker));
  return { saved: done - failed, failed, total, capped };
}
