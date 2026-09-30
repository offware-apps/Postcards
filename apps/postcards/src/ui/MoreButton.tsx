import { useEffect, useRef } from "react";

/**
 * "Show more" that also AUTO-REPEATS while held down: tap for one page,
 * keep pressing and it pages continuously (~4 pages/second after a short
 * beat). Keyboard/AT users just activate it repeatedly — onClick still fires.
 */
export function MoreButton({
  onMore,
  children,
}: {
  onMore: () => void;
  children: string;
}) {
  const timer = useRef<number | null>(null);
  const repeated = useRef(false);

  function stop() {
    if (timer.current != null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }
  useEffect(() => stop, []);

  function start() {
    stop();
    repeated.current = false;
    const tick = () => {
      repeated.current = true;
      onMore();
      timer.current = window.setTimeout(tick, 240);
    };
    timer.current = window.setTimeout(tick, 400); // hold a beat, then repeat
  }

  return (
    <button
      type="button"
      className="mini-btn"
      title={children}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onClick={() => {
        // The hold already paged — don't add one more on release.
        if (repeated.current) {
          repeated.current = false;
          return;
        }
        onMore();
      }}
    >
      {children}
    </button>
  );
}
