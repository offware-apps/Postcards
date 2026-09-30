import { describe, it, expect, vi, afterEach } from "vitest";
import { registerServiceWorker, UPDATE_POLL_MS } from "../../src/lib/serviceWorker";
import { useUpdate } from "../../src/lib/store/useUpdate";
import { useSettings } from "../../src/lib/store/useSettings";

// A stand-in for navigator.serviceWorker: the page is already controlled and a
// newer build is installed and waiting, as after a deploy.
function fakeContainer() {
  const waiting = { state: "installed", postMessage: vi.fn() } as unknown as ServiceWorker;
  const reg = {
    waiting,
    installing: null,
    update: vi.fn(async () => undefined),
    addEventListener: vi.fn(),
  };
  const container = {
    controller: {} as ServiceWorker,
    addEventListener: vi.fn(),
    register: vi.fn(async () => reg),
  };
  return { container, reg, waiting };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  useUpdate.setState({ needRefresh: false, apply: null });
  useSettings.getState().setOfflineMode(false);
});

async function register(container: unknown) {
  vi.stubGlobal("navigator", { ...navigator, serviceWorker: container });
  registerServiceWorker();
  await vi.advanceTimersByTimeAsync(0);
}

describe("registerServiceWorker", () => {
  it("offers a waiting build found at startup", async () => {
    vi.useFakeTimers();
    const { container } = fakeContainer();
    await register(container);
    expect(useUpdate.getState().needRefresh).toBe(true);
  });

  it("offers a dismissed build again on the next poll", async () => {
    vi.useFakeTimers();
    const { container, reg, waiting } = fakeContainer();
    await register(container);
    useUpdate.getState().dismiss();
    expect(useUpdate.getState().needRefresh).toBe(false);

    await vi.advanceTimersByTimeAsync(UPDATE_POLL_MS);
    expect(reg.update).toHaveBeenCalledTimes(1);
    expect(useUpdate.getState().needRefresh).toBe(true);
    useUpdate.getState().apply?.();
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
  });

  it("neither polls nor offers in Offline mode", async () => {
    vi.useFakeTimers();
    const { container, reg } = fakeContainer();
    await register(container);
    useUpdate.getState().dismiss();
    useSettings.getState().setOfflineMode(true);

    await vi.advanceTimersByTimeAsync(UPDATE_POLL_MS);
    expect(reg.update).not.toHaveBeenCalled();
    expect(useUpdate.getState().needRefresh).toBe(false);
  });
});
