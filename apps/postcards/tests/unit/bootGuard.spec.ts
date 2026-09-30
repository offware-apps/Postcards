import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { translate, LOCALES } from "../../src/lib/i18n/core";

// public/boot-guard.js runs before the app's code, so it carries its own copy of
// the loadFailure.* strings; this keeps the copy equal to the catalogs.
const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "boot-guard.js"),
  "utf8",
);

type Guarded = Window & { __postcardsBootGuard?: { cancel(): void } };

/** Run the guard, then fail a script's download the way the browser reports it. */
function failEntry(): HTMLElement | null {
  new Function(SRC)();
  const script = document.createElement("script");
  document.head.appendChild(script);
  script.dispatchEvent(new Event("error"));
  script.remove();
  return document.getElementById("boot-failure");
}

afterEach(() => {
  (window as Guarded).__postcardsBootGuard?.cancel();
  localStorage.clear();
});

describe("boot guard", () => {
  it.each(LOCALES)("shows the loadFailure message in %s when the entry fails", (locale) => {
    localStorage.setItem("postcards-locale", locale);
    const shown = failEntry();
    expect(shown).toHaveAttribute("role", "alert");
    expect(shown?.querySelector("p")).toHaveTextContent(translate(locale, "loadFailure.text"));
    const button = shown?.querySelector("button");
    expect(button).toHaveTextContent(translate(locale, "loadFailure.reload"));
    expect(button).toHaveAttribute("title", translate(locale, "loadFailure.reloadTitle"));
  });

  it("is removed, and stays away, once the app runs", () => {
    expect(failEntry()).not.toBeNull();
    (window as Guarded).__postcardsBootGuard?.cancel();
    expect(document.getElementById("boot-failure")).toBeNull();

    const script = document.createElement("script");
    document.head.appendChild(script);
    script.dispatchEvent(new Event("error"));
    script.remove();
    expect(document.getElementById("boot-failure")).toBeNull();
  });
});
