import { describe, it, expect, vi } from "vitest";
import { lazy, Suspense } from "react";
import { render, screen } from "@testing-library/react";
import { LoadBoundary } from "../../src/ui/LoadFailure";

describe("LoadBoundary", () => {
  it("shows a reload in place of a lazy screen whose code failed to download", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const Broken = lazy(() => Promise.reject(new TypeError("Failed to fetch dynamically imported module")));
    render(
      <div>
        <p>still here</p>
        <LoadBoundary>
          <Suspense fallback={null}>
            <Broken />
          </Suspense>
        </LoadBoundary>
      </div>,
    );
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Part of Postcards did not load");
    expect(screen.getByRole("button", { name: "Reload" })).toHaveAttribute(
      "title",
      "Reload Postcards and try again",
    );
    // Only the failed screen is replaced; the rest of the app stays up.
    expect(screen.getByText("still here")).toBeInTheDocument();
    quiet.mockRestore();
  });

  it("renders the screen when it loads", async () => {
    const Fine = lazy(() => Promise.resolve({ default: () => <p>loaded</p> }));
    render(
      <LoadBoundary>
        <Suspense fallback={null}>
          <Fine />
        </Suspense>
      </LoadBoundary>,
    );
    expect(await screen.findByText("loaded")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
