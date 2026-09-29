import { describe, it, expect } from "vitest";
import { movedTarget, readHandoff } from "../../src/lib/moved/moved";

const CANONICAL = "https://offware-apps.github.io/Postcards/";
const at = (href: string) => {
  const u = new URL(href);
  return { origin: u.origin, pathname: u.pathname, search: u.search, hash: u.hash };
};

describe("movedTarget", () => {
  it("keeps the path below the base, the query and the hash", () => {
    expect(
      movedTarget(
        at("https://davd-gzl.github.io/Postcards/stats?x=1#top"),
        "/Postcards/",
        CANONICAL,
      ),
    ).toBe("https://offware-apps.github.io/Postcards/stats?x=1#top");
  });

  it("sends the bare old address to the new root", () => {
    expect(movedTarget(at("https://davd-gzl.github.io/Postcards/"), "/Postcards/", CANONICAL)).toBe(
      CANONICAL,
    );
  });

  it("stays put on the canonical origin, or with none configured", () => {
    expect(
      movedTarget(at("https://offware-apps.github.io/Postcards/"), "/Postcards/", CANONICAL),
    ).toBeNull();
    expect(
      movedTarget(at("https://davd-gzl.github.io/Postcards/"), "/Postcards/", undefined),
    ).toBeNull();
  });
});

describe("readHandoff", () => {
  const OLD = "https://davd-gzl.github.io";
  const opener = {};

  it("accepts a known message from the expected window and origin", () => {
    const e = { origin: OLD, source: opener, data: { type: "postcards-handoff-file", text: "{}" } };
    expect(readHandoff(e as never, OLD, opener)).toEqual({
      type: "postcards-handoff-file",
      text: "{}",
    });
  });

  it("ignores another origin, another window, or no window at all", () => {
    const data = { type: "postcards-handoff-ready" };
    expect(
      readHandoff({ origin: "https://evil.example", source: opener, data } as never, OLD, opener),
    ).toBeNull();
    expect(readHandoff({ origin: OLD, source: {}, data } as never, OLD, opener)).toBeNull();
    expect(readHandoff({ origin: OLD, source: null, data } as never, OLD, null)).toBeNull();
    expect(
      readHandoff({ origin: OLD, source: opener, data } as never, undefined, opener),
    ).toBeNull();
  });

  it("ignores unknown shapes and a file without text", () => {
    const e = (data: unknown) => ({ origin: OLD, source: opener, data }) as never;
    expect(readHandoff(e("hello"), OLD, opener)).toBeNull();
    expect(readHandoff(e({ type: "other" }), OLD, opener)).toBeNull();
    expect(readHandoff(e({ type: "postcards-handoff-file", text: 1 }), OLD, opener)).toBeNull();
  });
});
