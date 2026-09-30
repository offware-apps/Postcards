import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import config from "../../capacitor.config";

// Vitest runs from apps/postcards (jsdom rewrites import.meta.url, so cwd it is).
const RES = resolve(process.cwd(), "android/app/src/main/res");
const STRINGS = resolve(RES, "values/strings.xml");

// SHA-256 of the adaptive-icon foregrounds `cap add android` ships (the
// Capacitor logo), mdpi to xxxhdpi.
const PLACEHOLDER_FOREGROUNDS = new Set([
  "58e78a618778926b1f6d9472a6468de878de8530970934e94aab5ba4ba08cc00",
  "32baa10d2632a4417454a579f992bd640e0a3cec79321423559b2c9940de58a9",
  "6f88083b8166cc559102f7044688de7525287632ebe09ac45d001ac8bf4b3eae",
  "4a82bc1e9923576275869998925ce0ae021a79aa18b24a0dd87ad6b61ca85053",
  "bd24fd383253bf8d43f0a81f11c071d76d1d555114376dd647cd9fb38fa0a9da",
]);

describe("Android project", () => {
  // The launcher shows the Android string resources, not capacitor.config.ts, so
  // a rename has to reach both.
  it("names the app in the launcher as capacitor.config.ts does", () => {
    const xml = readFileSync(STRINGS, "utf8");
    const label = (name: string) =>
      xml.match(new RegExp(`<string name="${name}">([^<]*)</string>`))?.[1];
    expect(label("app_name")).toBe(config.appName);
    expect(label("title_activity_main")).toBe(config.appName);
  });

  it("shows the app's own icon, not the Capacitor placeholder", () => {
    const densities = readdirSync(RES).filter((d) => /^mipmap-[a-z]*dpi$/.test(d));
    expect(densities).toHaveLength(5);
    for (const d of densities) {
      const png = readFileSync(resolve(RES, d, "ic_launcher_foreground.png"));
      const hash = createHash("sha256").update(png).digest("hex");
      expect(PLACEHOLDER_FOREGROUNDS.has(hash), `${d} foreground is the placeholder`).toBe(false);
    }
  });
});
