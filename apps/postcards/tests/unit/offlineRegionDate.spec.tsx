import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

vi.mock("../../src/features/map/offlineTiles", () => ({
  saveAreaOffline: async () => ({ saved: 1, failed: 0 }),
}));
import { SettingsScreen } from "../../src/features/settings/SettingsScreen";
import { OFFLINE_REGIONS } from "../../src/lib/offline/regions";

describe("offline region download date", () => {
  const saved = process.env.TZ;
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    localStorage.clear();
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  });

  it("records the local day, not UTC's", async () => {
    // 08:30 on 30 Sep in Tokyo is still 29 Sep in UTC.
    process.env.TZ = "Asia/Tokyo";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-29T23:30:00Z"));
    render(<SettingsScreen />);
    fireEvent.click(screen.getAllByRole("button", { name: /Download$/ })[0]!);
    const key = `postcards-region-saved:${OFFLINE_REGIONS[0]!.id}`;
    await waitFor(() => expect(localStorage.getItem(key)).not.toBeNull());
    expect(localStorage.getItem(key)).toBe("2026-09-30");
  });
});
