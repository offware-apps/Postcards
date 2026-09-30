import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { CANONICAL_URL, MOVED_FLAG, movedTarget } from "./lib/moved/moved";
import { initReferenceData } from "./lib/reference/referenceData";
import { registerServiceWorker } from "./lib/serviceWorker";
import { initDurability } from "./lib/db/initDurability";
import { LoadBoundary, LoadFailure } from "./ui/LoadFailure";
import "@fontsource-variable/inter"; // self-hosted (OFL) — no font CDN
import "@fontsource-variable/space-grotesk"; // display face for the wordmark, headings & figures (OFL)
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";

// Keep open tabs off a stale cached build: the service worker, its update banner
// and the deploy poll are wired in lib/serviceWorker.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", registerServiceWorker);
}

// The module graph ran, so the boot guard (public/boot-guard.js) stands down;
// from here a failed load shows LoadFailure.
(window as { __postcardsBootGuard?: { cancel(): void } }).__postcardsBootGuard?.cancel();

const el = document.getElementById("root");
if (!el) throw new Error("Root element not found");

// Served from an address the app has left (lib/moved): none of the app boots.
// A visitor who moved before goes straight to the new address; anyone else gets
// the move screen, which forwards on at once when this address holds nothing.
const redirect = movedTarget(window.location, import.meta.env.BASE_URL, CANONICAL_URL);
let movedBefore = false;
try {
  movedBefore = !!localStorage.getItem(MOVED_FLAG);
} catch {
  /* storage unavailable: the move screen decides from the data alone */
}
if (redirect && CANONICAL_URL && movedBefore) {
  window.location.replace(redirect);
} else if (redirect && CANONICAL_URL) {
  const MovedScreen = lazy(() => import("./features/moved/MovedScreen"));
  createRoot(el).render(
    <StrictMode>
      <LoadBoundary>
        <Suspense fallback={null}>
          <MovedScreen canonical={CANONICAL_URL} redirect={redirect} />
        </Suspense>
      </LoadBoundary>
    </StrictMode>,
  );
} else {
  bootApp(el);
}

function bootApp(el: HTMLElement) {
  // Durable "long-term memory": subscribe to the data stores BEFORE they hydrate so
  // we can request persistent storage on first real data and track backup freshness.
  initDurability();

  // Load the app's code and the bundled reference gazetteer (local, SW-cached)
  // before first render so every screen can read it synchronously. The app is
  // imported here, not statically, so a chunk that fails to download shows a
  // reload screen rather than a blank page.
  const root = createRoot(el);
  Promise.all([import("./app/App"), initReferenceData()])
    .then(([{ App }]) => {
      root.render(
        <StrictMode>
          <App />
        </StrictMode>,
      );
      // Merge any installed community data packs into the reference set (off the
      // critical path; fires the gazetteer event so screens refresh when it lands).
      void import("./lib/packs/store").then((m) => m.useDataPacks.getState().load());
      // Whole guides saved in localStorage by earlier builds filled it until
      // settings stopped saving; move them to their IndexedDB store.
      void import("./features/guides/guideCache").then((m) => m.moveLocalGuides());
    })
    .catch(() => {
      root.render(
        <StrictMode>
          <LoadFailure />
        </StrictMode>,
      );
    });

  // Warm the code-split MapScreen chunk (~1 MB, mostly MapLibre) — the map is the
  // default tab, so it's needed next. Deferred to idle so its ~1 MB fetch+parse
  // doesn't compete with first paint and the reference-data download on a low-end
  // phone; App's React.lazy is still the real loader (Vite dedupes by URL), so if
  // the map mounts before idle fires it simply loads then — no behaviour change.
  const warmMap = () => void import("./features/map/MapScreen");
  if (typeof requestIdleCallback === "function") requestIdleCallback(warmMap, { timeout: 2000 });
  else setTimeout(warmMap, 300);
}
