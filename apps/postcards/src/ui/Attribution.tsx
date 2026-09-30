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
      {/* A bundled asset, not a reference dataset, so it stays out of the
          provenance an export records (public/fonts/PROVENANCE.md). */}
      <span> · Country flags: Twemoji (CC-BY-4.0)</span>
    </div>
  );
}
