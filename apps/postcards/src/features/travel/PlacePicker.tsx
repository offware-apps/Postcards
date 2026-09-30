import { useDeferredValue, useId, useMemo, useRef, useState } from "react";
import { getReferenceData } from "../../lib/reference/referenceData";
import { searchPlaces } from "../visits/search";
import { countryFlag } from "../../lib/format/format";
import type { PlaceRef } from "../../lib/schema/models";
import { useT } from "../../lib/i18n";

/**
 * Keyboard-operable autocomplete that resolves to a single PlaceRef (a city,
 * airport, or country). Reused for both endpoints of a trip. Aggregator-only:
 * only reference places can be chosen — nothing is invented.
 */
export function PlacePicker({
  label,
  value,
  onPick,
  include,
  placeholder,
}: {
  label: string;
  value: PlaceRef | null;
  onPick: (place: PlaceRef | null) => void;
  /** Restrict results to these place kinds (e.g. ["airport","city"] for trip stops). */
  include?: Array<PlaceRef["kind"]>;
  placeholder?: string;
}) {
  const t = useT();
  const ref = useMemo(() => getReferenceData(), []);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  // Defer the scan off the keystroke render (see PlaceSearch): typing paints
  // immediately; the search runs in an interruptible follow-up render.
  const dq = useDeferredValue(q);
  const results = useMemo(() => {
    const all = searchPlaces(ref, dq);
    return include ? all.filter((r) => include.includes(r.place.kind)) : all;
  }, [ref, dq, include]);
  const open = q.trim().length >= 1 && !value && results.length > 0;

  function choose(place: PlaceRef) {
    onPick(place);
    setQ("");
    setActive(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      setActive((a) => (a + 1) % results.length);
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      setActive((a) => (a <= 0 ? results.length - 1 : a - 1));
      e.preventDefault();
    } else if (e.key === "Enter") {
      // Deferred results can lag a fast typist by a keystroke — recompute
      // synchronously for the action so Enter never picks stale or nothing.
      const fresh = searchPlaces(ref, q);
      const list = q === dq ? results : include ? fresh.filter((r) => include.includes(r.place.kind)) : fresh;
      const r = list[active >= 0 && active < list.length ? active : 0];
      if (r) choose(r.place);
      e.preventDefault();
    } else if (e.key === "Escape") {
      // Closing the list spends this Escape: the trip form around the picker
      // must not also take it as "discard the form".
      setQ("");
      setActive(-1);
      e.stopPropagation();
    }
  }

  if (value) {
    return (
      <div className="picker">
        <span className="picker-label">{label}</span>
        <div className="picker-chip">
          <span className="flag" aria-hidden>
            {countryFlag(value.countryId)}
          </span>
          <span className="picker-chip-name" title={value.name}>
            {value.name}
          </span>
          <button
            type="button"
            className="picker-clear"
            aria-label={t("placePicker.clearAria", { label })}
            onClick={() => {
              onPick(null);
              setTimeout(() => inputRef.current?.focus(), 0);
            }}
          >
            ✕
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="picker">
      <label className="picker-label" htmlFor={`${listId}-input`}>
        {label}
      </label>
      <div className="picker-field">
        <input
          id={`${listId}-input`}
          ref={inputRef}
          type="search"
          className="search-input"
          placeholder={placeholder ?? t("placePicker.placeholder")}
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-opt-${active}` : undefined}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(-1);
          }}
          onKeyDown={onKeyDown}
          // Dismiss the listbox when focus leaves the combobox (option clicks use
          // onMouseDown/preventDefault below, so they don't trigger this).
          onBlur={() => {
            setQ("");
            setActive(-1);
          }}
        />
        {open && (
          <ul className="results" id={listId} role="listbox" aria-label={label}>
            {results.map((r, i) => (
              <li
                key={`${r.place.kind}:${r.place.id}`}
                id={`${listId}-opt-${i}`}
                role="option"
                aria-selected={i === active}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  className={i === active ? "opt-active" : undefined}
                  // Keep focus on the input so onBlur doesn't close the list before this fires.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(r.place)}
                >
                  <span className="result-main">
                    <span className="result-name">{r.place.name}</span>
                    <span className="result-detail">{r.detail}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
