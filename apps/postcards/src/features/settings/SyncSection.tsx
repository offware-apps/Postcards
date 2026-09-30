import { useRef, useState } from "react";
import { GitHubConnectorFields, type GitHubConnectorValue } from "../../ui/GitHubConnectorFields";
import { useT, type MessageKey } from "../../lib/i18n";
import { useSettings } from "../../lib/store/useSettings";
import { useSyncStatus } from "../../lib/store/useSyncStatus";
import { useModalKeys } from "../../lib/hooks/useModalKeys";
import { useVisits } from "../../lib/store/useVisits";
import { useTrips } from "../../lib/store/useTrips";
import { useStories } from "../../lib/store/useStories";
import { download } from "../../lib/download";
import {
  readRemoteConfig,
  writeRemoteConfig,
  clearRemoteConfig,
  isConfigured,
} from "../../lib/sync/syncConfig";
import type { SyncCounts, SyncResult } from "../../lib/sync/engine";
import type { SyncOutcome } from "../../lib/sync/runSync";

// Device sync (git mode), spec 013. ONE-TIME setup: paste the repo + token once and
// it's stored on THIS device (localStorage); the token never enters the portable
// file or any export (FR-020). Sync then runs on the "Sync now" button, and — when
// the user opts in to auto-sync — on launch/focus/edit in the background. The heavy
// codec + engine load on demand, so this section costs the boot chunk nothing.

/** "+2 · ~1 · −0"-style per-collection summary for the immediate status line. */
function summarize(label: string, c: SyncCounts): string | null {
  if (c.added === 0 && c.updated === 0 && c.removed === 0) return null;
  return `${label}: +${c.added} · ~${c.updated} · −${c.removed}`;
}

export function SyncSection() {
  const t = useT();
  const autoSync = useSettings((s) => s.autoSync);
  const setAutoSync = useSettings((s) => s.setAutoSync);
  const busy = useSyncStatus((s) => s.busy);
  const log = useSyncStatus((s) => s.log);
  const lastSynced = useSyncStatus((s) => s.lastSynced);
  const resetStatus = useSyncStatus((s) => s.reset);

  const [cfg, setCfg] = useState<GitHubConnectorValue>(() => readRemoteConfig());
  const [status, setStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  // When a pull would wipe a large share of local data, we stash the counts and
  // show a non-destructive confirm instead of applying it (the safety guard). The
  // record-level merge already converges automatically, so remediation here is
  // TRANSPARENCY (the sync log) + SAFETY (this guard) + automatic retry — a future
  // per-record "keep both / pick" review is deliberately OUT OF SCOPE for the MVP.
  const [guard, setGuard] = useState<{ local: number; removed: number } | null>(null);
  const guardRef = useRef<HTMLDivElement>(null);
  useModalKeys(guardRef, () => setGuard(null), { enabled: guard !== null });

  const connected = isConfigured({ ...cfg, branch: cfg.branch.trim() || "main" });

  function update(next: GitHubConnectorValue) {
    setCfg(next);
    writeRemoteConfig(next); // persist on-device as you type (token included)
  }

  function disconnect() {
    clearRemoteConfig();
    setCfg({ owner: "", repo: "", branch: "main", token: "" });
    setAutoSync(false); // can't auto-sync without a remote
    setStatus(null);
  }

  /** Turn a run outcome into the immediate status line + guard prompt. */
  function applyOutcome(outcome: SyncOutcome) {
    if (outcome.ok) {
      const r: SyncResult = outcome.result;
      if (r.createdRemote) {
        setStatus({ kind: "ok", text: t("sync.status.created") });
        return;
      }
      const parts = [
        summarize(t("sync.summary.places"), r.visits),
        summarize(t("sync.summary.trips"), r.trips),
        summarize(t("sync.summary.stories"), r.stories),
      ].filter((s): s is string => s !== null);
      const nothing = r.total.added === 0 && r.total.updated === 0 && r.total.removed === 0;
      setStatus({
        kind: "ok",
        text: nothing ? t("sync.status.nothing") : t("sync.status.synced", { summary: parts.join(" · ") }),
      });
    } else if (outcome.kind === "blocked") {
      setStatus(null);
      setGuard({ local: outcome.local, removed: outcome.removed });
    } else {
      setStatus({ kind: "err", text: t(`sync.log.${outcome.code}` as MessageKey) });
    }
  }

  async function runSync(force: boolean) {
    const current = readRemoteConfig();
    if (!isConfigured(current)) {
      setStatus({ kind: "err", text: t("sync.missingFields") });
      return;
    }
    setStatus(null);
    const { runDeviceSync } = await import("../../lib/sync/runSync");
    const outcome = await runDeviceSync(current, { force });
    applyOutcome(outcome);
  }

  async function onSync() {
    await runSync(false);
  }

  async function onApplyAnyway() {
    setGuard(null);
    await runSync(true);
  }

  async function onDownloadData() {
    const { serializeFile } = await import("../backup/exportJson");
    const text = serializeFile(
      useVisits.getState().visits,
      useTrips.getState().trips,
      useStories.getState().stories,
    );
    await download("places.postcards.json", text, "application/json");
    setStatus({ kind: "ok", text: t("sync.downloadDone") });
  }

  return (
    <section className="settings-section" aria-label={t("sync.title")}>
      <h3>{t("sync.title")}</h3>
      <p className="muted small">{t("sync.desc")}</p>

      <p
        className={"sync-connection " + (connected ? "is-connected" : "is-disconnected")}
        role="status"
      >
        <span className="sync-dot" aria-hidden>
          {connected ? "●" : "○"}
        </span>
        {connected
          ? t("sync.connected", { owner: cfg.owner.trim(), repo: cfg.repo.trim(), branch: cfg.branch.trim() || "main" })
          : t("sync.disconnected")}
      </p>

      <GitHubConnectorFields idPrefix="sync-gh" value={cfg} onChange={update} />

      <div className="btn-row sync-actions">
        <button className="btn" type="button" onClick={() => void onSync()} disabled={busy}>
          {busy ? t("sync.syncing") : t("sync.now")}
        </button>
        <button className="btn-ghost" type="button" onClick={() => void onDownloadData()} disabled={busy}>
          {t("sync.downloadData")}
        </button>
        {connected && (
          <button className="link-danger" type="button" onClick={disconnect} disabled={busy}>
            {t("sync.disconnect")}
          </button>
        )}
        {lastSynced && (
          <span className="muted small sync-last">
            {t("sync.lastSynced", { when: new Date(lastSynced).toLocaleString() })}
          </span>
        )}
      </div>

      {/* Opt-in auto-sync. Enabling this ONCE is the explicit consent for the app to
          reach the remote in the background (Constitution: data leaves the device
          only on explicit user action). */}
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={autoSync}
          onChange={(e) => setAutoSync(e.target.checked)}
        />
        <span>{t("sync.auto.toggle")}</span>
      </label>
      <p className="muted small">{t("sync.auto.desc")}</p>

      {status && (
        <p
          className={"notice" + (status.kind === "err" ? " notice-err" : " notice-ok")}
          role="status"
          aria-live="polite"
        >
          {status.text}
        </p>
      )}

      {/* Sync log — transparency: exactly what each recent run did. */}
      <details className="guide-full-section sync-log-wrap">
        <summary>{t("sync.log.title")}</summary>
        {log.length === 0 ? (
          <p className="muted small sync-log-empty">{t("sync.log.empty")}</p>
        ) : (
          <ul className="sync-log">
            {log.map((e, i) => (
              <li key={i} className={"sync-log-row sync-log-" + e.status}>
                <span className="sync-log-when muted small">
                  {new Date(e.at).toLocaleString()}
                </span>
                <span className="sync-log-msg">{t(`sync.log.${e.code}` as MessageKey, e.params)}</span>
              </li>
            ))}
          </ul>
        )}
        {log.length > 0 && (
          <button className="link" type="button" onClick={resetStatus}>
            {t("sync.log.clear")}
          </button>
        )}
      </details>

      <p className="muted small">{t("sync.privacy")}</p>

      {guard && (
        <div className="modal-backdrop" onClick={() => setGuard(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sync-guard-title"
            ref={guardRef}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="sync-guard-title">{t("sync.guard.title")}</h2>
            <p className="muted">
              {t("sync.guard.body", { removed: guard.removed, local: guard.local })}
            </p>
            <div className="trip-form-actions">
              <button className="btn" type="button" autoFocus onClick={() => void onApplyAnyway()}>
                {t("sync.guard.apply")}
              </button>
              <button className="btn-ghost" type="button" onClick={() => setGuard(null)}>
                {t("sync.guard.skip")}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
