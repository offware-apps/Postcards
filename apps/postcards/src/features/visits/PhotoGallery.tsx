import { useEffect, useRef, useState } from "react";
import { useModalKeys } from "../../lib/hooks/useModalKeys";
import { useVisits } from "../../lib/store/useVisits";
import { useToast } from "../../lib/store/useToast";
import { fileToPostcard } from "../../lib/image/downscale";
import { MAX_PHOTOS_PER_VISIT } from "../../lib/schema/helpers";
import { useT } from "../../lib/i18n";
import type { Photo } from "../../lib/schema/models";

/**
 * A place's photo gallery — your postcards, the monuments, the views — each with
 * an optional caption. Empty → a small "Photos" button that opens the
 * camera/library; with photos → a thumbnail (+ count) that opens a lightbox to
 * browse, caption, add, or remove. Images are downscaled on-device and stored
 * locally; they only ever leave the device inside an explicit export.
 */
export function PhotoGallery({
  visitId,
  photos,
  placeName,
}: {
  visitId: string;
  photos: Photo[];
  placeName: string;
}) {
  const t = useT();
  const addPhotos = useVisits((s) => s.addPhotos);
  const removePhoto = useVisits((s) => s.removePhoto);
  const setPhotoCaption = useVisits((s) => s.setPhotoCaption);
  const restoreVisit = useVisits((s) => s.restoreVisit);
  const showToast = useToast((s) => s.show);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [index, setIndex] = useState(0);

  const count = photos.length;
  const atCap = count >= MAX_PHOTOS_PER_VISIT;
  const safeIndex = Math.min(index, Math.max(0, count - 1));
  const current = photos[safeIndex];

  // Caption editing uses a local draft (committed on blur/Enter) so spaces aren't
  // eaten by store-side trimming and we don't rewrite the whole (multi-MB) visit
  // to IndexedDB on every keystroke.
  const [draft, setDraft] = useState<string | null>(null);
  const captionValue = draft ?? current?.caption ?? "";
  function commitCaption() {
    if (draft !== null) {
      void setPhotoCaption(visitId, safeIndex, draft);
      setDraft(null);
    }
  }

  // Page between photos — the arrow buttons AND the touch swipe share this, so
  // they can't drift: commit any caption edit, then wrap-advance by delta.
  function page(delta: number) {
    commitCaption();
    setIndex((i) => (i + delta + count) % count);
  }

  // Keep the viewer index valid as photos are added/removed.
  useEffect(() => {
    if (index > count - 1) setIndex(Math.max(0, count - 1));
  }, [count, index]);

  // Discard any uncommitted caption draft when the viewed photo changes.
  useEffect(() => {
    setDraft(null);
  }, [safeIndex, visitId]);

  // Modal focus contract: focus into the dialog on open, restore to the row
  // control on close (Constitution: keyboard-first, WCAG 2.4.3).
  useEffect(() => {
    if (open) closeRef.current?.focus();
    else if (wasOpen.current) triggerRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  // Closing keeps a caption being typed: Escape takes the field away with no blur.
  function close() {
    commitCaption();
    setOpen(false);
  }

  // Escape closes; arrows page; Tab is trapped within the dialog.
  useModalKeys(dialogRef, close, {
    enabled: open,
    selector: "button:not([disabled]), input, textarea",
    onKey: (e) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA");
      // Arrows page between photos — but not while the caption field has focus,
      // where they must move the text cursor.
      if (!typing && e.key === "ArrowLeft" && count > 1) {
        setIndex((i) => (i - 1 + count) % count);
        return true;
      }
      if (!typing && e.key === "ArrowRight" && count > 1) {
        setIndex((i) => (i + 1) % count);
        return true;
      }
    },
  });

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = ""; // let the user re-pick the same file later
    if (!picked.length) return;
    const room = MAX_PHOTOS_PER_VISIT - count;
    if (room <= 0) {
      showToast(t("photo.toast.full", { max: MAX_PHOTOS_PER_VISIT }));
      return;
    }
    const files = picked.slice(0, room);
    setBusy(true);
    try {
      // Downscale everything first, then land the whole pick in ONE store write —
      // per-photo writes re-put the entire (multi-MB) record once per photo.
      const added: Photo[] = [];
      for (const file of files) {
        added.push({ src: await fileToPostcard(file), caption: null });
      }
      await addPhotos(visitId, added);
      setIndex(count + files.length - 1); // jump to the newest
      setOpen(true);
      if (picked.length > room) showToast(t("photo.toast.addedRoom", { count: room }));
    } catch {
      showToast(t("journal.toast.readImgErr"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={onPick}
        aria-hidden
        tabIndex={-1}
      />
      {count > 0 ? (
        <button
          ref={triggerRef}
          type="button"
          className="postcard-thumb"
          onClick={() => setOpen(true)}
          title={t.plural("photo.viewAria", count, { place: placeName })}
          aria-label={t.plural("photo.viewAria", count, { place: placeName })}
        >
          {/* Row thumbnails decode the full downscaled data URL — lazy + async
              decode keeps off-screen rows off the main thread while scrolling. */}
          <img src={photos[0]!.src} alt="" loading="lazy" decoding="async" />
          {count > 1 && <span className="postcard-count" aria-hidden>{count}</span>}
        </button>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          className="mini-btn"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          title={t("photo.addAria", { place: placeName })}
          aria-label={t("photo.addAria", { place: placeName })}
        >
          {busy ? "…" : <>📷 <span className="row-btn-label">{t("photo.photos")}</span></>}
        </button>
      )}

      {open && current && (
        <div
          className="lightbox"
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={t("photo.dialogAria", { place: placeName })}
          onClick={() => setOpen(false)}
        >
          <div
            className="lightbox-stage"
            onClick={(e) => e.stopPropagation()}
            onTouchStart={
              count > 1
                ? (e) => {
                    const p = e.changedTouches[0];
                    swipeStart.current = p ? { x: p.clientX, y: p.clientY } : null;
                  }
                : undefined
            }
            onTouchEnd={
              count > 1
                ? (e) => {
                    const s = swipeStart.current;
                    swipeStart.current = null;
                    const p = e.changedTouches[0];
                    if (!s || !p) return;
                    const dx = p.clientX - s.x;
                    const dy = p.clientY - s.y;
                    // A horizontal swipe over ~48px pages; ignore mostly-vertical
                    // drags (matches the exported reader's swipe threshold).
                    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy)) page(dx < 0 ? 1 : -1);
                  }
                : undefined
            }
          >
            {count > 1 && (
              <button
                type="button"
                className="lightbox-nav prev"
                title={t("journal.prevPhoto")}
                aria-label={t("journal.prevPhoto")}
                onClick={() => page(-1)}
              >
                ‹
              </button>
            )}
            <img className="lightbox-img" src={current.src} alt={current.caption ?? t("photo.altOf", { place: placeName })} />
            {count > 1 && (
              <button
                type="button"
                className="lightbox-nav next"
                title={t("journal.nextPhoto")}
                aria-label={t("journal.nextPhoto")}
                onClick={() => page(1)}
              >
                ›
              </button>
            )}
          </div>

          <div className="lightbox-panel" onClick={(e) => e.stopPropagation()}>
            <div className="lightbox-meta">
              <input
                className="caption-input"
                type="text"
                value={captionValue}
                maxLength={300}
                placeholder={t("photo.captionPlaceholder")}
                title={t("photo.captionAria", { n: safeIndex + 1, place: placeName })}
                aria-label={t("photo.captionAria", { n: safeIndex + 1, place: placeName })}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitCaption}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitCaption();
                  }
                }}
              />
              {count > 1 && (
                <span className="lightbox-count" aria-hidden>
                  {safeIndex + 1} / {count}
                </span>
              )}
            </div>
            <div className="lightbox-actions">
              <button
                type="button"
                className="mini-btn"
                disabled={busy || atCap}
                title={
                  atCap
                    ? t("photo.fullTitle", { max: MAX_PHOTOS_PER_VISIT })
                    : t("photo.addAria", { place: placeName })
                }
                onClick={() => inputRef.current?.click()}
              >
                ＋ {t("photo.add")}
              </button>
              <button
                type="button"
                className="link-danger"
                disabled={busy}
                title={t("common.remove")}
                onClick={async () => {
                  // Photos exist nowhere but in-app — snapshot this record first
                  // so the toast can undo what would otherwise be an
                  // unrecoverable tap (one record back, not a full-table rewrite).
                  const prev = useVisits.getState().visits.find((v) => v.visitId === visitId);
                  await removePhoto(visitId, safeIndex);
                  if (count <= 1) setOpen(false);
                  if (prev) showToast(t("photo.toast.removed"), () => restoreVisit(prev));
                }}
              >
                {t("common.remove")}
              </button>
              <button
                ref={closeRef}
                type="button"
                className="btn-ghost"
                title={t("common.close")}
                onClick={() => setOpen(false)}
              >
                {t("common.close")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
