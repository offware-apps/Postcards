/// <reference types="vitest/config" />
import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Single source of truth for the shown app version: package.json. Injected at
// build time (see `define` below) so the About screen never drifts from the
// released package version and no runtime import of package.json is bundled.
const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

// Web-first: this same build is the self-hostable website (PWA) and the payload
// Capacitor wraps into native iOS/Android. No Google, no backend.
export default defineConfig({
  // Served from the domain root by default ("/") for local dev, self-hosting and
  // the Capacitor native wrap, but under a repo subpath on GitHub Pages
  // (https://<user>.github.io/Postcards/). The Pages workflow sets
  // VITE_BASE=/Postcards/ so asset URLs, the PWA manifest scope and the service
  // worker all resolve correctly there.
  base: process.env.VITE_BASE || "/",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Isolate the heavy map libraries into their own long-lived vendor chunk,
          // so a routine app-code deploy no longer re-downloads/re-parses ~1 MB of
          // MapLibre, and the lazy map-feature chunk shrinks. NARROW on purpose:
          // maplibre-gl is imported ONLY by the lazily-loaded map screen, so this
          // chunk stays lazy — a blanket node_modules split would instead pull
          // MapLibre into the eager entry graph (via react) and parse it on first
          // paint, a real regression on low-end phones.
          if (id.includes("maplibre-gl") || id.includes("/pmtiles/")) return "maplibre";
          return undefined;
        },
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      // "prompt", not "autoUpdate": a new deploy installs and WAITS, and the app
      // surfaces a "new version — reload" banner (see UpdateBanner) rather than
      // swapping code under an open tab. This is what keeps users off stale
      // cached builds without a jarring silent reload.
      registerType: "prompt",
      // We register the SW ourselves in main.tsx (manual navigator.serviceWorker,
      // no workbox-window dep), so disable the plugin's auto-injected script to
      // avoid a duplicate registration.
      injectRegister: null,
      manifest: {
        name: "Postcards",
        short_name: "Postcards",
        description: "Remember the places you've been — local-first, private, offline.",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        display: "standalone",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Cache the app shell + bundled reference/basemap assets for offline use.
        globPatterns: ["**/*.{js,css,html,json,geojson,pmtiles,woff2}"],
        // The full 17 MB gazetteer is NOT precached: the app bundles only the
        // top-10k core and downloads the full set ON DEMAND (a one-tap Settings
        // action, like a tile pack). Runtime-cached below so it reopens offline
        // once fetched. Never bundled — that would defeat the small-install goal.
        globIgnores: ["**/reference/cities-all.json"],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        // Control the page on the very first visit, so a tile pack or the full
        // city list downloaded in that session reaches the runtime caches below
        // instead of waiting for a reload. Updates still wait for the banner:
        // no skipWaiting, so a new build only takes over on SKIP_WAITING.
        clientsClaim: true,
        // Runtime-cache OSM raster tiles the user actually views, so areas they've
        // browsed on the online basemap remain available OFFLINE (opt-in: no tile
        // is ever fetched until the user turns on the OpenStreetMap basemap).
        runtimeCaching: [
          {
            // Full world gazetteer: cached on the first (on-demand) fetch, so it
            // reopens offline. CacheFirst because the file changes only with a
            // release. No age limit: it is a download the user asked for, and
            // Settings keeps showing it downloaded, so expiry must not delete it.
            urlPattern: ({ url }) => url.pathname.endsWith("/reference/cities-all.json"),
            handler: "CacheFirst",
            options: {
              cacheName: "gazetteer-v1",
              expiration: { maxEntries: 2 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: ({ url }) => url.hostname.endsWith("tile.openstreetmap.org"),
            handler: "CacheFirst",
            options: {
              // v2: the old cache may hold opaque "Referer required" error tiles
              // (status 0) from before the Referrer-Policy fix; a new name drops them.
              cacheName: "osm-tiles-v2",
              // Must exceed the offline seam's REGION_MAX_TILES (40k) with browsing
              // headroom — a lower LRU cap would silently evict tiles the user
              // explicitly downloaded as a region pack. No age limit: a region
              // pack left unviewed for a month is still saved; the entry cap alone
              // bounds the browse cache (least recently used tiles go first).
              expiration: { maxEntries: 50_000 },
              // Only cache real successes now that tiles are fetched with CORS —
              // never poison the cache with error/opaque responses.
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/unit/**/*.spec.ts", "tests/unit/**/*.spec.tsx"],
  },
});
