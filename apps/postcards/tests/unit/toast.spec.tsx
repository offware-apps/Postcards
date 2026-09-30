import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { Toast } from "../../src/ui/Toast";
import { useToast } from "../../src/lib/store/useToast";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useToast.setState({ toast: null });
});

describe("Toast auto-dismiss", () => {
  it("holds while hovered", () => {
    vi.useFakeTimers();
    render(<Toast />);
    act(() => useToast.getState().show("first"));
    fireEvent.mouseEnter(screen.getByRole("status"));
    act(() => vi.advanceTimersByTime(10_000));
    expect(useToast.getState().toast?.message).toBe("first");
  });

  it("resumes for the next toast after a hovered one is closed", () => {
    vi.useFakeTimers();
    render(<Toast />);
    act(() => useToast.getState().show("first"));
    fireEvent.mouseEnter(screen.getByRole("status"));
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    act(() => useToast.getState().show("second"));
    act(() => vi.advanceTimersByTime(10_000));
    expect(useToast.getState().toast).toBeNull();
  });
});
