import { useEffect, useRef, useState } from "react";
import { useVisits } from "../../lib/store/useVisits";
import { useTrips } from "../../lib/store/useTrips";
import { useStories } from "../../lib/store/useStories";
import { loadPortable, usePortableLoaded } from "../../lib/store/portable";
import { initReferenceData } from "../../lib/reference/referenceData";
import { useT } from "../../lib/i18n";
import { deliver } from "../backup/Backup";
import { HANDOFF_PARAM, MOVED_FLAG, readHandoff } from "../../lib/moved/moved";

/**
 * What the OLD address shows once the app has moved (see lib/moved/moved.ts);
 * main.tsx has already redirected a visitor who moved before. Nothing stored
 * here: straight to the same page at the new address. Places stored here: one
 * button hands them to the new address, and a download is the way out when the
 * browser will not open it.
 */
export default function MovedScreen({
  canonical,
  redirect,
}: {
  canonical: string;
  redirect: string;
}) {
  const t = useT();
  const visits = useVisits((s) => s.visits);
  const trips = useTrips((s) => s.trips);
  const stories = useStories((s) => s.stories);
  const loaded = usePortableLoaded();
  const empty = visits.length === 0 && trips.length === 0 && stories.length === 0;
  const [status, setStatus] = useState<{ kind: "moving" | "ok" | "err"; text: string } | null>(
    null,
  );
  // One controller per move attempt: aborting it drops that attempt's listener.
  const attempt = useRef<AbortController | null>(null);

  useEffect(() => {
    loadPortable();
    return () => attempt.current?.abort();
  }, []);

  const leave = loaded && empty;
  useEffect(() => {
    if (leave) window.location.replace(redirect);
  }, [leave, redirect]);

  async function buildFile() {
    // The file records the reference datasets' provenance; the gazetteer is not
    // otherwise needed on this screen, so it loads on first use only.
    await initReferenceData();
    return (await import("../backup/exportJson")).buildFile(visits, trips, stories);
  }

  function move() {
    attempt.current?.abort();
    const home = new URL(canonical);
    home.searchParams.set(HANDOFF_PARAM, "1");
    const tab = window.open(home.href, "_blank");
    if (!tab) {
      setStatus({ kind: "err", text: t("moved.blocked") });
      return;
    }
    setStatus({ kind: "moving", text: t("moved.moving") });
    const ctl = new AbortController();
    attempt.current = ctl;
    let sent = false;
    const onMessage = async (e: MessageEvent) => {
      const msg = readHandoff(e, home.origin, tab);
      if (!msg) return;
      if (msg.type === "postcards-handoff-ready") {
        if (sent) return;
        sent = true;
        // Compact: the file can carry megabytes of inline photos.
        tab.postMessage(
          { type: "postcards-handoff-file", text: JSON.stringify(await buildFile()) },
          home.origin,
        );
        return;
      }
      ctl.abort();
      if (msg.type === "postcards-handoff-done") {
        try {
          localStorage.setItem(MOVED_FLAG, new Date().toISOString());
        } catch {
          /* storage unavailable: the screen simply shows again next visit */
        }
        setStatus({ kind: "ok", text: t("moved.done") });
      } else if (msg.type === "postcards-handoff-failed") {
        setStatus({ kind: "err", text: msg.cancelled ? t("moved.cancelled") : t("moved.failed") });
      }
    };
    window.addEventListener("message", onMessage, { signal: ctl.signal });
  }

  async function downloadBackup() {
    const { EXPORT_FILENAME } = await import("../backup/exportJson");
    await deliver(EXPORT_FILENAME, JSON.stringify(await buildFile(), null, 2), "application/json");
  }

  if (!loaded || leave) return null;
  return (
    <div className="intro" role="dialog" aria-modal="true" aria-labelledby="moved-title">
      <h1 id="moved-title" className="intro-title">
        {t("moved.title")}
      </h1>
      <p className="intro-lede">
        {t("moved.lede", { url: canonical.replace(/^https?:\/\//, "") })}
      </p>
      <div className="btn-row">
        <button className="btn" type="button" title={t("moved.move")} onClick={move}>
          {t("moved.move")}
        </button>
        <button
          className="btn-ghost"
          type="button"
          title={t("moved.download")}
          onClick={() => void downloadBackup()}
        >
          {t("moved.download")}
        </button>
      </div>
      {status && (
        <p
          className={"notice" + (status.kind === "err" ? " notice-err" : " notice-ok")}
          role={status.kind === "err" ? "alert" : "status"}
        >
          {status.text}
          {status.kind === "ok" && (
            <>
              {" "}
              <a href={canonical}>{t("moved.open")}</a>
            </>
          )}
        </p>
      )}
    </div>
  );
}
