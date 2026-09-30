import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import config from "../../capacitor.config";

// Vitest runs from apps/postcards (jsdom rewrites import.meta.url, so cwd it is).
const STRINGS = resolve(process.cwd(), "android/app/src/main/res/values/strings.xml");

// The launcher shows the Android string resources, not capacitor.config.ts, so a
// rename has to reach both.
describe("Android project", () => {
  it("names the app in the launcher as capacitor.config.ts does", () => {
    const xml = readFileSync(STRINGS, "utf8");
    const label = (name: string) =>
      xml.match(new RegExp(`<string name="${name}">([^<]*)</string>`))?.[1];
    expect(label("app_name")).toBe(config.appName);
    expect(label("title_activity_main")).toBe(config.appName);
  });
});
