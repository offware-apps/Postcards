import { useUpdate } from "./store/useUpdate";
import { useSettings } from "./store/useSettings";

/** How often an always-open tab checks for a fresh deploy. */
export const UPDATE_POLL_MS = 30 * 60 * 1000;

/**
 * Keep open tabs off a stale cached build. We register the generated service
 * worker ourselves (no workbox-window dependency): when a NEW build installs and
 * waits, we surface a "new version — reload" banner (see UpdateBanner) rather
 * than swapping code under the user. Tapping Reload posts SKIP_WAITING (the SW
 * listens for it), which activates the new worker; `controllerchange` then
 * reloads the page once into the fresh build. A 30-min poll lets an always-open
 * tab discover a deploy without a manual reload. The very first install (no
 * existing controller) never prompts — it just primes the offline cache, and
 * takes control of the page (clientsClaim) without reloading it.
 */
export function registerServiceWorker(): void {
  let reloading = false;
  let controlled = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // The first install claiming an uncontrolled page is not a new build.
    if (!controlled) {
      controlled = true;
      return;
    }
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
  const offerIfWaiting = (worker: ServiceWorker | null) => {
    if (worker && worker.state === "installed" && navigator.serviceWorker.controller) {
      useUpdate.getState().announce(() => worker.postMessage({ type: "SKIP_WAITING" }));
    }
  };
  navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
    .then((reg) => {
      offerIfWaiting(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        nw?.addEventListener("statechange", () => offerIfWaiting(nw));
      });
      // Poll for a fresh deploy — but NOT in Offline mode, where the app makes
      // zero app-initiated network requests (the update check is optional egress).
      // A build dismissed earlier is still waiting and fires no new event, so each
      // poll offers it again (a newer one found by the check announces itself).
      setInterval(() => {
        if (useSettings.getState().offlineMode) return;
        void reg
          .update()
          .catch(() => {
            /* no network right now: whatever is already waiting still applies */
          })
          .then(() => offerIfWaiting(reg.waiting));
      }, UPDATE_POLL_MS);
    })
    .catch(() => {
      /* registration unavailable (insecure context / unsupported): app still works */
    });
}
