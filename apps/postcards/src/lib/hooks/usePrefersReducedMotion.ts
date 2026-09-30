import { useEffect, useState } from "react";

/**
 * Tracks the user's `prefers-reduced-motion` setting so animated behaviours
 * (map fly/fit/globe) can be turned off — CSS alone can't reach MapLibre's
 * imperative camera moves (WCAG 2.3.3 / Constitution: accessible by default).
 */
/** The scrollIntoView behaviour to use: smooth, or a jump under reduced motion. */
export function scrollBehavior(): ScrollBehavior {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof matchMedia === "undefined" ? false : matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    if (typeof matchMedia === "undefined") return;
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}
