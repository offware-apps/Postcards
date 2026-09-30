import { useEffect, useRef } from "react";
import { useModalKeys } from "../lib/hooks/useModalKeys";
import { useT } from "../lib/i18n";

/** Minimal keyboard-shortcuts overlay (opened with "?"). */
export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  const t = useT();
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Opened by a keypress (no trigger button to remember), so capture whatever
    // had focus and restore it on close — focus must not drop to the page top.
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => prev?.focus?.();
  }, []);
  // Trap Tab within the dialog and close on Escape (parity with AboutModal).
  useModalKeys(dialogRef, onClose);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("shortcuts.title")}
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{t("shortcuts.title")}</h2>
        <ul className="shortcuts">
          <li>
            <kbd>/</kbd> {t("shortcuts.search")} — <kbd>Enter</kbd> {t("shortcuts.searchShow")},{" "}
            <kbd>Shift</kbd>+<kbd>Enter</kbd> {t("shortcuts.searchMark")}
          </li>
          <li>
            <kbd>1</kbd>–<kbd>5</kbd> · <kbd>M</kbd> <kbd>P</kbd> <kbd>T</kbd> <kbd>J</kbd>{" "}
            <kbd>S</kbd> — {t("shortcuts.sections")} (
            {[t("nav.map"), t("nav.places"), t("nav.trips"), t("nav.journal"), t("nav.stats")].join(", ")})
          </li>
          <li>
            <kbd>F</kbd> {t("places.collection.passport")} · <kbd>X</kbd> {t("places.collection.moments")}{" "}
            {t("shortcuts.inPlaces")}
          </li>
          <li>
            <kbd>W</kbd> {t("shortcuts.write")} — <kbd>Ctrl/⌘</kbd>+<kbd>Enter</kbd> {t("shortcuts.writeSave")},{" "}
            <kbd>Ctrl/⌘</kbd>+<kbd>Shift</kbd>+<kbd>Enter</kbd> {t("shortcuts.writeSaveNew")}
          </li>
          <li>
            <kbd>?</kbd> {t("shortcuts.help")}
          </li>
          <li>
            <kbd>Esc</kbd> {t("shortcuts.escape")}
          </li>
        </ul>
        <button ref={closeRef} className="btn" type="button" onClick={onClose}>
          {t("common.close")}
        </button>
      </div>
    </div>
  );
}
