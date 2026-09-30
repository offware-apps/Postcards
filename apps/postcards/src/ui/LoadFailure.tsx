import { Component, type ReactNode } from "react";
import { useT } from "../lib/i18n";

/** Shown in place of app code that failed to download: says so, offers a reload. */
export function LoadFailure() {
  const t = useT();
  return (
    <div className="load-failure" role="alert">
      <p>{t("loadFailure.text")}</p>
      <button
        className="btn"
        type="button"
        title={t("loadFailure.reloadTitle")}
        onClick={() => window.location.reload()}
      >
        {t("loadFailure.reload")}
      </button>
    </div>
  );
}

/**
 * Wraps a lazily loaded screen so a failed download shows LoadFailure there
 * instead of unmounting the whole app. The browser keeps a failed import failed
 * for the page's lifetime, so the retry is a reload.
 */
export class LoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? <LoadFailure /> : this.props.children;
  }
}
