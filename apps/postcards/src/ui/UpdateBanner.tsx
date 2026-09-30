import { useUpdate } from "../lib/store/useUpdate";
import { useT } from "../lib/i18n";

/**
 * "A new version is available — reload." Shown once the service worker has a
 * newer deployed build waiting (wired up in lib/serviceWorker.ts). One tap
 * applies it and reloads, so an open tab never keeps serving a stale cached
 * build. Dismissible; the next poll or navigation will offer it again.
 */
export function UpdateBanner() {
  const t = useT();
  const needRefresh = useUpdate((s) => s.needRefresh);
  const apply = useUpdate((s) => s.apply);
  const dismiss = useUpdate((s) => s.dismiss);

  if (!needRefresh) return null;
  return (
    <div className="update-banner" role="status" aria-live="polite">
      <span className="update-banner-msg">🆕 {t("update.available")}</span>
      <button
        className="update-banner-reload"
        type="button"
        title={t("update.reload")}
        onClick={() => apply?.()}
      >
        {t("update.reload")}
      </button>
      <button
        className="update-banner-dismiss"
        type="button"
        aria-label={t("toast.dismiss")}
        title={t("toast.dismiss")}
        onClick={dismiss}
      >
        ×
      </button>
    </div>
  );
}
