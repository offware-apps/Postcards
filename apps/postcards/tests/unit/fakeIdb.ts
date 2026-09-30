// An in-memory stand-in for the slice of the `idb` API the on-device stores use,
// so a spec can drive the real store → IndexedDB write paths (vitest has no
// IndexedDB). Swap it in with `vi.mock("idb", () => import("./fakeIdb"))`, and
// define `globalThis.indexedDB` so `hasIndexedDB()` holds. Values are copied on
// put and get, as IndexedDB's structured clone would.

type Rows = Map<unknown, unknown>;

export const databases = new Map<string, Map<string, Rows>>();

/** Empty every store, keeping the stores (an open handle stays valid). */
export function clearDatabases(): void {
  for (const stores of databases.values()) for (const rows of stores.values()) rows.clear();
}

const KEY_PATH: Record<string, string> = {
  visits: "visitId",
  trips: "tripId",
  stories: "storyId",
  tombstones: "key",
  photos: "id",
};

const copy = <T>(v: T): T => (v && typeof v === "object" ? ({ ...v } as T) : v);

function storeApi(rows: Rows, name: string) {
  return {
    async clear() {
      rows.clear();
    },
    async put(v: Record<string, unknown>) {
      rows.set(v[KEY_PATH[name]!], copy(v));
    },
    async get(k: unknown) {
      return copy(rows.get(k));
    },
    async getKey(k: unknown) {
      return rows.has(k) ? k : undefined;
    },
    async getAll() {
      return [...rows.values()].map(copy);
    },
    async getAllKeys() {
      return [...rows.keys()];
    },
    async delete(k: unknown) {
      rows.delete(k);
    },
  };
}

export async function openDB(
  name: string,
  _version?: number,
  opts?: { upgrade?: (db: unknown) => void },
) {
  let stores = databases.get(name);
  const fresh = !stores;
  if (!stores) {
    stores = new Map();
    databases.set(name, stores);
  }
  const st = stores;
  const api = (n: string) => storeApi(st.get(n)!, n);
  const database = {
    objectStoreNames: { contains: (n: string) => st.has(n) },
    createObjectStore: (n: string) => void st.set(n, new Map()),
    count: async (n: string) => st.get(n)?.size ?? 0,
    getAll: (n: string) => api(n).getAll(),
    getAllKeys: (n: string) => api(n).getAllKeys(),
    put: (n: string, v: Record<string, unknown>) => api(n).put(v),
    delete: (n: string, k: unknown) => api(n).delete(k),
    close() {},
    transaction(names: string | string[]) {
      const list = Array.isArray(names) ? names : [names];
      return { objectStore: api, store: api(list[0]!), done: Promise.resolve() };
    },
  };
  if (fresh) opts?.upgrade?.(database);
  return database;
}
