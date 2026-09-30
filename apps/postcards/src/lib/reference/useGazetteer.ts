import { useSyncExternalStore } from "react";
import {
  GAZETTEER_UPGRADED_EVENT,
  gazetteerGeneration,
  referenceExtrasPending,
} from "./referenceData";

/**
 * Re-render when the background full-gazetteer upgrade lands (core ~24k cities
 * → all 135k). Include the returned generation in any useMemo deps that
 * snapshot city data from the reference singleton — the singleton mutates in
 * place, so `ref` alone never invalidates those memos.
 * useSyncExternalStore reads the generation at subscription time, so an
 * upgrade that finished before mount is never missed.
 */
export function useGazetteerGeneration(): number {
  return useSyncExternalStore(subscribe, gazetteerGeneration, gazetteerGeneration);
}

/** True until the airports, heritage sites and stations, which follow the
 *  first paint, have landed (initReferenceData). */
export function useReferenceExtrasPending(): boolean {
  return useSyncExternalStore(subscribe, referenceExtrasPending, referenceExtrasPending);
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(GAZETTEER_UPGRADED_EVENT, onChange);
  return () => window.removeEventListener(GAZETTEER_UPGRADED_EVENT, onChange);
}
