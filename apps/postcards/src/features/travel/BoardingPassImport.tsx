import { useRef, useState } from "react";
import { useFocusHandoff } from "../../lib/hooks/useFocusHandoff";
import { parseBcbp, type BcbpResult } from "../../lib/bcbp/parse";
import { useT } from "../../lib/i18n";

// Read a boarding pass: scan its barcode from a photo (where the browser's
// BarcodeDetector supports PDF417/Aztec/QR) or paste the code. Everything is
// parsed on-device — the ticket never leaves the phone.

interface BarcodeDetectorLike {
  detect(source: ImageBitmapSource): Promise<{ rawValue: string }[]>;
}
interface BarcodeDetectorCtor {
  new (opts?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}
function getDetectorCtor(): BarcodeDetectorCtor | null {
  const w = window as unknown as { BarcodeDetector?: BarcodeDetectorCtor };
  return typeof window !== "undefined" && w.BarcodeDetector ? w.BarcodeDetector : null;
}

// The panel's open state is the parent's (controlled), so the Trips screen can
// close it from its own keyboard handling (Escape).
export function BoardingPassImport({
  open,
  onOpenChange,
  onResult,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onResult: (r: BcbpResult) => void;
}) {
  const t = useT();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // The open button and the panel replace each other, so focus follows.
  const openRef = useRef<HTMLButtonElement>(null);
  const codeRef = useRef<HTMLTextAreaElement>(null);
  useFocusHandoff(open, codeRef, openRef);
  const canScan = getDetectorCtor() !== null;

  function apply(raw: string) {
    const result = parseBcbp(raw);
    if (!result) {
      setError(t("boardingPass.errInvalid"));
      return;
    }
    setError(null);
    setText("");
    onOpenChange(false);
    onResult(result);
  }

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const Ctor = getDetectorCtor();
    if (!Ctor) return;
    try {
      const formats = (await Ctor.getSupportedFormats?.()) ?? [];
      const want = ["pdf417", "aztec", "qr_code"].filter((f) => formats.includes(f));
      const detector = new Ctor(want.length ? { formats: want } : undefined);
      const bitmap = await createImageBitmap(file);
      const codes = await detector.detect(bitmap);
      const raw = codes[0]?.rawValue;
      if (!raw) {
        setError(t("boardingPass.errNoBarcode"));
        return;
      }
      apply(raw);
    } catch {
      setError(t("boardingPass.errScanFailed"));
    }
  }

  if (!open) {
    return (
      <button
        ref={openRef}
        className="btn-ghost pass-open"
        type="button"
        title={t("boardingPass.open")}
        onClick={() => onOpenChange(true)}
      >
        ✈ {t("boardingPass.open")}
      </button>
    );
  }

  return (
    <div className="pass-panel">
      <div className="pass-panel-head">
        <strong>{t("boardingPass.heading")}</strong>
        <button
          className="link"
          type="button"
          title={t("common.close")}
          onClick={() => onOpenChange(false)}
        >
          {t("common.close")}
        </button>
      </div>
      {canScan && (
        <>
          <button
            className="btn-ghost"
            type="button"
            title={t("boardingPass.scan")}
            onClick={() => fileRef.current?.click()}
          >
            📷 {t("boardingPass.scan")}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            title={t("boardingPass.scan")}
            onChange={onPhoto}
            style={{ display: "none" }}
            aria-hidden="true"
          />
          <p className="muted small">{t("boardingPass.orPaste")}</p>
        </>
      )}
      <label className="picker-label" htmlFor="pass-code">
        {t("boardingPass.codeLabel")}
        <textarea
          ref={codeRef}
          id="pass-code"
          className="pass-textarea"
          title={t("boardingPass.codeLabel")}
          rows={2}
          placeholder="M1DESMARAIS/LUC       EABC123 YULFRAAC 0834 226F001A0025 100"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <button
        className="btn"
        type="button"
        title={t("boardingPass.read")}
        disabled={!text.trim()}
        onClick={() => apply(text)}
      >
        {t("boardingPass.read")}
      </button>
      {error && (
        <p className="notice notice-err" role="status">
          {error}
        </p>
      )}
      <p className="muted small">
        {t("boardingPass.privacy")}
      </p>
    </div>
  );
}
