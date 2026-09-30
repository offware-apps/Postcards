import { useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { useVisits } from "../../lib/store/useVisits";
import { useTrips } from "../../lib/store/useTrips";
import { useStories } from "../../lib/store/useStories";
import { getReferenceData } from "../../lib/reference/referenceData";
import { replaceAllPortable } from "../../lib/db/visitsDb";
import { countPhrases, restoreFromJson as restoreJson } from "./restore";
import { toMarkdown } from "./exportMarkdown";
import { download, downloadBlob } from "../../lib/download";
import { DurabilityNote } from "../../ui/DurabilityNote";
import {
  markBackedUp,
  isBackupDue,
  daysSinceBackup,
  snoozeReminder,
} from "../../lib/backupReminder";
import { useT } from "../../lib/i18n";
import type { Story, Trip, Visit } from "../../lib/schema/models";

/**
 * Get the file to the user, wherever they want it. Inside the native wrap
 * (iOS/Android) the file is written to the app cache and handed to the system
 * share sheet — Files, Drive, Nextcloud, AirDrop, mail, whatever is installed.
 * On the web we try the same OS share sheet via the Web Share API (mobile
 * browsers), falling back to a plain download on desktop. No proprietary cloud
 * SDK: the OS routes the file to the destination the user picks (zero lock-in).
 * Still strictly explicit — this only ever runs from an Export button.
 */
export async function deliver(filename: string, text: string, type: string): Promise<void> {
  // Native: lib/download writes the file and opens the system share sheet.
  if (Capacitor.isNativePlatform()) return download(filename, text, type);
  if (typeof navigator !== "undefined" && typeof navigator.canShare === "function") {
    const file = new File([text], filename, { type });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename });
        return;
      } catch (err) {
        // The user cancelled the share sheet — done, don't also download.
        if (err instanceof DOMException && err.name === "AbortError") return;
        // Anything else (share not really supported): fall through to download.
      }
    }
  }
  await download(filename, text, type);
}

/** Same delivery, but for a BINARY file (the .zip archive). */
async function deliverBlob(filename: string, blob: Blob, type: string): Promise<void> {
  if (Capacitor.isNativePlatform()) return downloadBlob(filename, blob);
  if (typeof navigator !== "undefined" && typeof navigator.canShare === "function") {
    const file = new File([blob], filename, { type });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }
  }
  await downloadBlob(filename, blob);
}

/** The full .json backup, delivered, and the reminder clock reset: a places-
 *  only .csv/.md export is a share, not a backup. */
export async function backUpNow(visits: Visit[], trips: Trip[], stories: Story[]): Promise<void> {
  // Loaded on click: the codec pulls in the Zod schemas (~65 KB min), which
  // nothing on the startup path needs — keep them out of the boot chunk.
  const { serializeFile, EXPORT_FILENAME } = await import("./exportJson");
  await deliver(EXPORT_FILENAME, serializeFile(visits, trips, stories), "application/json");
  markBackedUp(Date.now());
}

/** "It's been N days since your last backup": the nudge Settings and Places
 *  both show once a backup is due (lib/backupReminder decides when). */
export function BackupReminder({
  onBackUp,
  onLater,
  compact = false,
}: {
  onBackUp: () => void;
  onLater: () => void;
  /** One slim line, for a screen that is about something else. */
  compact?: boolean;
}) {
  const t = useT();
  const daysSince = daysSinceBackup(Date.now());
  return (
    <div className={"backup-reminder" + (compact ? " backup-reminder-line" : "")} role="status">
      <span aria-hidden>🛟</span>
      <span className="backup-reminder-text">
        {daysSince == null
          ? t("backup.reminder.never")
          : t.plural("backup.reminder.days", daysSince)}{" "}
        {t("backup.reminder.suffix")}
      </span>
      <span className="backup-reminder-actions">
        <button className={compact ? "mini-btn" : "btn"} type="button" onClick={onBackUp}>
          {t("backup.reminder.backupNow")}
        </button>
        <button
          className="link"
          type="button"
          onClick={() => {
            snoozeReminder(Date.now());
            onLater();
          }}
        >
          {t("backup.reminder.later")}
        </button>
      </span>
    </div>
  );
}

export function Backup() {
  const t = useT();
  const ref = useMemo(() => getReferenceData(), []);
  const visits = useVisits((s) => s.visits);
  const trips = useTrips((s) => s.trips);
  const stories = useStories((s) => s.stories);
  const fileInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  // The reset flow asks you to TYPE a word — a click alone can't wipe everything.
  const [resetOpen, setResetOpen] = useState(false);
  const [resetText, setResetText] = useState("");
  const RESET_WORD = "RESET";
  const hasData = visits.length > 0 || trips.length > 0 || stories.length > 0;
  // Whether to nudge a backup right now (computed once on open, editable by the
  // export/snooze actions).
  const [reminderDue, setReminderDue] = useState(() => isBackupDue(hasData, Date.now()));

  async function exportJson() {
    try {
      await backUpNow(visits, trips, stories);
      setReminderDue(false);
    } catch {
      setMessage({ kind: "err", text: t("backup.msg.exportJsonErr") });
    }
  }
  async function exportArchive() {
    try {
      const { buildArchive, ARCHIVE_FILENAME } = await import("./archiveZip");
      const bytes = buildArchive(visits, trips, stories);
      // Copy into a fresh ArrayBuffer so the Blob owns exactly these bytes.
      await deliverBlob(ARCHIVE_FILENAME, new Blob([bytes.slice()], { type: "application/zip" }), "application/zip");
      // A full archive (data + photos) is a real backup — reset the reminder clock.
      markBackedUp(Date.now());
      setReminderDue(false);
    } catch {
      setMessage({ kind: "err", text: t("backup.msg.exportZipErr") });
    }
  }
  async function exportMd() {
    try {
      await deliver("places.md", toMarkdown(visits, trips, ref), "text/markdown");
    } catch {
      setMessage({ kind: "err", text: t("backup.msg.exportMdErr") });
    }
  }
  async function exportCsv() {
    try {
      const { serializePlacesCsv, PLACES_CSV_FILENAME } = await import("./exportCsv");
      await deliver(PLACES_CSV_FILENAME, serializePlacesCsv(visits, ref), "text/csv");
    } catch {
      setMessage({ kind: "err", text: t("backup.msg.exportCsvErr") });
    }
  }

  /** Wipe everything on this device — places, trips, stories and their photos —
   *  in one transaction, then clear it from memory. There is no undo, which is
   *  why it takes a typed word to get here. */
  async function resetAll() {
    try {
      await replaceAllPortable([], [], []);
    } catch {
      setMessage({ kind: "err", text: t("backup.msg.eraseErr") });
      return;
    }
    useVisits.setState({ visits: [] });
    useTrips.setState({ trips: [] });
    useStories.setState({ stories: [] });
    setResetOpen(false);
    setResetText("");
    setReminderDue(false);
    setMessage({ kind: "ok", text: t("backup.msg.erased") });
  }

  async function onImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const buf = new Uint8Array(await file.arrayBuffer());
    // A .zip "Save everything" archive is a FULL RESTORE — unpack it back into the
    // standard JSON (re-inlining the photo files) and restore that. Detected by the
    // ZIP magic bytes, not the extension, so a mislabelled file still works.
    const { looksLikeZip } = await import("../../lib/backup/zip");
    if (looksLikeZip(buf)) {
      try {
        const { archiveToJson } = await import("./archiveZip");
        await restoreFromJson(archiveToJson(buf));
      } catch {
        setMessage({ kind: "err", text: t("backup.msg.zipUnreadable") });
      }
      return;
    }
    const text = new TextDecoder().decode(buf);
    // A JSON backup ({…}) is a FULL RESTORE (replaces everything); anything else
    // is treated as a places table (CSV/TSV) and MERGED in. The format is picked
    // from the content, not the extension, so a mislabelled file still works.
    if (text.trimStart().startsWith("{")) {
      await restoreFromJson(text);
    } else {
      await mergeFromCsv(text);
    }
  }

  /** Full restore from a Postcards JSON backup (replaces everything; asks first). */
  async function restoreFromJson(text: string) {
    const outcome = await restoreJson(text, t);
    if (outcome.ok) {
      setMessage({ kind: "ok", text: t("backup.msg.restored", countPhrases(t, outcome)) });
    } else if (outcome.reason === "invalid") setMessage({ kind: "err", text: outcome.error });
    else if (outcome.reason === "save") setMessage({ kind: "err", text: t("backup.msg.saveErr") });
  }

  /** Merge a places CSV/TSV — NON-destructive: it adds places and updates ones
   *  you already have; trips, stories and untouched places stay put. */
  async function mergeFromCsv(text: string) {
    const { parsePlacesCsv } = await import("./importCsv");
    const { places, total, skipped } = parsePlacesCsv(text, ref);
    if (places.length === 0) {
      setMessage({
        kind: "err",
        text: total === 0 ? t("backup.msg.csvNoPlaces") : t("backup.msg.csvUnreadable"),
      });
      return;
    }
    try {
      const { added, updated } = await useVisits.getState().mergeVisits(places);
      const skip = skipped ? t("backup.msg.skipped", { count: skipped }) : "";
      setMessage({
        kind: "ok",
        text: t.plural("backup.msg.merged", added, { updated, skip }),
      });
    } catch {
      setMessage({ kind: "err", text: t("backup.msg.saveErr") });
    }
  }

  return (
    <section aria-label={t("backup.aria")}>
      <div className="section-head">
        <h2>{t("backup.title")}</h2>
      </div>

      <DurabilityNote />

      {reminderDue && (
        <BackupReminder onBackUp={() => void exportJson()} onLater={() => setReminderDue(false)} />
      )}

      <p className="muted">{t("backup.intro")}</p>

      <div className="btn-row">
        <button className="btn" type="button" onClick={() => void exportArchive()}>
          {t("backup.export.all")}
        </button>
        <button className="btn-ghost" type="button" onClick={() => void exportJson()}>
          {t("backup.export.data")}
        </button>
        <button className="btn-ghost" type="button" onClick={() => void exportCsv()}>
          {t("backup.export.csv")}
        </button>
        <button className="btn-ghost" type="button" onClick={() => void exportMd()}>
          {t("backup.export.md")}
        </button>
        <button className="btn-ghost" type="button" onClick={() => fileInput.current?.click()}>
          {t("backup.import")}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/zip,.zip,application/json,.json,text/csv,.csv,.tsv,text/plain"
          onChange={onImport}
          style={{ display: "none" }}
          aria-hidden="true"
        />
      </div>

      {message && (
        <p
          className={
            "notice" + (message.kind === "err" ? " notice-err" : " notice-ok")
          }
          role="status"
        >
          {message.text}
        </p>
      )}
      <p className="muted small">
        <strong>Save everything</strong> writes a <strong>.zip</strong> holding your data plus every
        photo as a real image file — the most complete, portable backup. Import understands three
        things. A <strong>.zip archive</strong> or a <strong>.json backup</strong> is a full restore —
        it <strong>⚠ replaces everything on this device</strong> (you'll be asked to confirm). A{" "}
        <strong>.csv places list</strong> (columns like <code>lat, lon, country, city, been</code>,
        where <code>been</code> tags are <code>been</code> / <code>want</code> / <code>fave</code>){" "}
        is merged in — it only adds and updates places, never erasing your trips or stories. Files
        are validated and sanitized on import — never executed.
      </p>

      {hasData && (
        <div className="danger-zone">
          {!resetOpen ? (
            <>
              <button
                className="btn-danger"
                type="button"
                onClick={() => {
                  setResetText("");
                  setResetOpen(true);
                }}
              >
                {t("backup.reset.button")}
              </button>
              <p className="muted small">{t("backup.reset.note")}</p>
            </>
          ) : (
            <div className="reset-confirm" role="alertdialog" aria-label={t("backup.reset.confirmAria")}>
              <p className="reset-warn">
                {t("backup.reset.warn", {
                  places: visits.length,
                  trips: trips.length,
                  stories: stories.length,
                })}
              </p>
              <label className="reset-label" htmlFor="reset-confirm-input">
                {t("backup.reset.typeWord", { word: RESET_WORD })}
              </label>
              <input
                id="reset-confirm-input"
                className="reset-input"
                type="text"
                value={resetText}
                onChange={(e) => setResetText(e.target.value)}
                autoComplete="off"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                aria-label={t("backup.reset.inputAria", { word: RESET_WORD })}
              />
              <div className="btn-row">
                <button
                  className="btn-danger"
                  type="button"
                  disabled={resetText.trim().toUpperCase() !== RESET_WORD}
                  onClick={() => void resetAll()}
                >
                  {t("backup.reset.erase")}
                </button>
                <button
                  className="btn-ghost"
                  type="button"
                  onClick={() => {
                    setResetOpen(false);
                    setResetText("");
                  }}
                >
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
