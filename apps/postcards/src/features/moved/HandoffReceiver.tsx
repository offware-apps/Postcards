import { useEffect } from "react";
import { usePortableLoaded } from "../../lib/store/portable";
import { useToast } from "../../lib/store/useToast";
import { useT } from "../../lib/i18n";
import {
  HANDOFF_FROM,
  HANDOFF_PARAM,
  readHandoff,
  type HandoffMessage,
} from "../../lib/moved/moved";
import { restoreFromJson } from "../backup/restore";

/**
 * The NEW address's half of the move (see lib/moved/moved.ts), mounted by App
 * only when this tab was opened with ?handoff=1. It says ready to the old
 * address, takes the portable file and restores it like a manual restore does:
 * validated, and never without the visitor's word. The old origin can host other
 * sites than Postcards (a GitHub Pages user site serves every repository of its
 * owner), so a file from it is shown by its counts and waits for a confirm even
 * when this address holds nothing yet.
 */
export default function HandoffReceiver() {
  const t = useT();
  const loaded = usePortableLoaded();

  useEffect(() => {
    if (!loaded) return;
    const url = new URL(window.location.href);
    url.searchParams.delete(HANDOFF_PARAM);
    window.history.replaceState(window.history.state, "", url.href);
    const opener = window.opener as Window | null;
    if (!opener || !HANDOFF_FROM) return;
    const from = HANDOFF_FROM;

    const reply = (m: HandoffMessage) => opener.postMessage(m, from);
    const onMessage = async (e: MessageEvent) => {
      const msg = readHandoff(e, from, opener);
      if (msg?.type !== "postcards-handoff-file") return;
      window.removeEventListener("message", onMessage);
      const outcome = await restoreFromJson(msg.text, t, (n) =>
        t("moved.confirm", { ...n, from: from.replace(/^https?:\/\//, "") }),
      );
      reply(
        outcome.ok
          ? { type: "postcards-handoff-done" }
          : { type: "postcards-handoff-failed", cancelled: outcome.reason === "cancelled" },
      );
      const toast = useToast.getState().show;
      if (outcome.ok) {
        const { places, trips, stories } = outcome;
        toast(t("moved.received", { places, trips, stories }));
      } else if (outcome.reason === "invalid") toast(outcome.error);
      else if (outcome.reason === "save") toast(t("backup.msg.saveErr"));
    };
    window.addEventListener("message", onMessage);
    reply({ type: "postcards-handoff-ready" });
    return () => window.removeEventListener("message", onMessage);
  }, [loaded, t]);

  return null;
}
