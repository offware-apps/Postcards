/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// Self-hosted font packages are CSS side-effect imports with no type declarations.
declare module "@fontsource-variable/*";

// App version, injected at build time from package.json via Vite `define`.
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** Where the app lives now; any other origin serving this build shows the move screen. */
  readonly VITE_CANONICAL_URL?: string;
  /** Comma-separated origins allowed to hand their data to this one (lib/moved). */
  readonly VITE_HANDOFF_FROM?: string;
}
