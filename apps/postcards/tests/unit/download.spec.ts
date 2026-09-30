import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The native wrap is simulated: Capacitor reports a native platform, and the
// Filesystem/Share plugins record what they were handed.
const native = vi.hoisted(() => ({ on: false }));
const writeFile = vi.hoisted(() => vi.fn(async () => ({ uri: "file:///cache/out" })));
const share = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => native.on } }));
vi.mock("@capacitor/filesystem", () => ({
  Filesystem: { writeFile },
  Directory: { Cache: "CACHE" },
}));
vi.mock("@capacitor/share", () => ({ Share: { share } }));

import { download, downloadBlob } from "../../src/lib/download";

let click: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  writeFile.mockClear();
  share.mockClear();
  click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  click.mockRestore();
  native.on = false;
});

describe("download", () => {
  it("uses a browser download on the web", async () => {
    await download("journal.md", "# Hi", "text/markdown");
    expect(click).toHaveBeenCalledTimes(1);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("writes the file to the app cache and opens the share sheet in the native wrap", async () => {
    native.on = true;
    await download("journal.md", "# Héllo", "text/markdown");
    expect(click).not.toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalledTimes(1);
    const arg = (writeFile.mock.calls[0] as unknown as [{ path: string; data: string; directory: string }])[0];
    expect(arg.path).toBe("journal.md");
    expect(arg.directory).toBe("CACHE");
    // Base64 of the UTF-8 bytes, so text and binary files take the same path.
    expect(new TextDecoder().decode(Uint8Array.from(atob(arg.data), (c) => c.charCodeAt(0)))).toBe("# Héllo");
    expect(share).toHaveBeenCalledWith({ title: "journal.md", url: "file:///cache/out" });
  });

  it("hands a binary blob to the share sheet in the native wrap", async () => {
    native.on = true;
    await downloadBlob("a.zip", new Blob([new Uint8Array([0, 255, 7])]));
    const arg = (writeFile.mock.calls[0] as unknown as [{ data: string }])[0];
    expect(Array.from(atob(arg.data), (c) => c.charCodeAt(0))).toEqual([0, 255, 7]);
    expect(share).toHaveBeenCalledTimes(1);
  });
});
