import { create } from "zustand";

/**
 * Bridges the service-worker "a new build is waiting" event into the React tree.
 * The registration itself lives in `lib/serviceWorker.ts` (plain
 * navigator.serviceWorker, no Vite `virtual:pwa-register`). When a new version is
 * ready, it flags it here and hands over the `apply` function that activates the
 * waiting worker and reloads to the fresh build.
 */
interface UpdateState {
  /** True once a newer deployed build is installed and waiting to take over. */
  needRefresh: boolean;
  /** Activate the waiting worker and reload into the new build (set by main). */
  apply: (() => void) | null;
  announce: (apply: () => void) => void;
  dismiss: () => void;
}

export const useUpdate = create<UpdateState>((set) => ({
  needRefresh: false,
  apply: null,
  announce: (apply) => set({ needRefresh: true, apply }),
  dismiss: () => set({ needRefresh: false }),
}));
