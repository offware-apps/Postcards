import { useMemo } from "react";
import { getReferenceData } from "../lib/reference/referenceData";
import { useT } from "../lib/i18n";

/** Surfaces reference-dataset provenance (Constitution I & Data Standards). */
export function Attribution() {
  const t = useT();
  const ref = useMemo(() => getReferenceData(), []);
  return (
    <div className="attribution">
      <strong>{t("attribution.label")}</strong>{" "}
      {ref.provenance.map((p, i) => (
        <span key={p.dataset}>
          {i > 0 ? " · " : ""}
          {p.dataset} ({p.license})
        </span>
      ))}
    </div>
  );
}
