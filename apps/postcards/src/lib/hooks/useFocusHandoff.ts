import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function focusIn(el: HTMLElement | null | undefined) {
  (el?.matches(FOCUSABLE) ? el : el?.querySelector<HTMLElement>(FOCUSABLE))?.focus();
}

/**
 * Keeps keyboard focus when a toggle removes the control that was clicked
 * (WCAG 2.4.3): on show it goes to the first control in `whenShown`, on hide to
 * the first in `whenHidden`, and only when the click left focus on the page body.
 */
export function useFocusHandoff(
  shown: boolean,
  whenShown: RefObject<HTMLElement | null> | null,
  whenHidden: RefObject<HTMLElement | null> | null,
) {
  const prev = useRef(shown);
  useEffect(() => {
    if (prev.current === shown) return;
    prev.current = shown;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    focusIn((shown ? whenShown : whenHidden)?.current);
  }, [shown, whenShown, whenHidden]);
}
