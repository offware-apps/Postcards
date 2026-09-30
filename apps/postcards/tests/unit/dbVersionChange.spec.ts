// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// Two tabs share one database. A tab opening a newer version waits until every
// other tab's connection closes: the older tab has to let go, and the newer one
// has to say why it is waiting.

type Handlers = { blocked?: () => void; blocking?: () => void };
const opened: { handlers: Handlers; close: ReturnType<typeof vi.fn> }[] = [];
vi.mock("idb", () => ({
  openDB: async (_name: string, _version: number, handlers: Handlers) => {
    const close = vi.fn();
    opened.push({ handlers, close });
    return { close };
  },
}));
import { getDb } from "../../src/lib/db/visitsDb";
import { useToast } from "../../src/lib/store/useToast";

const reload = vi.fn();
vi.stubGlobal("location", { reload });

beforeEach(() => {
  opened.length = 0;
  reload.mockClear();
  useToast.setState({ toast: null });
});

describe("a newer version opened in another tab", () => {
  it("closes this tab's connection and reloads it into the new build", async () => {
    await getDb();
    const tab = opened.at(-1)!;
    tab.handlers.blocking?.();
    await Promise.resolve();
    expect(tab.close).toHaveBeenCalled();
    expect(reload).toHaveBeenCalled();
  });

  it("while another tab holds on, says to close it", async () => {
    // `blocking` above dropped the handle, so this open is a fresh one.
    await getDb();
    opened.at(-1)!.handlers.blocked?.();
    expect(useToast.getState().toast?.message).toMatch(/other tab/i);
  });
});
