import type { ChangeEvent } from "react";
import { useT } from "../lib/i18n";

// The GitHub connector's input fields (owner / repo / branch / token), shared by
// Publish mode (push a site) and Device sync (push the data file) so the token
// form lives in ONE place. Purely presentational and controlled: it holds no
// state and never stores the token itself — the parent decides whether the value
// lives only in memory (Publish) or on-device (Sync). `idPrefix` keeps the input
// ids unique when both a Publish modal and the Sync section are on the page.
//
// GitHub is only ONE implementation of the publish/sync seam — the rest of the app
// never hard-couples to it. The disclosure below makes the token OPTIONAL and
// walks a first-timer through creating a correctly-scoped one, while making clear
// you can skip it entirely and host the downloaded file yourself (zero lock-in).

export interface GitHubConnectorValue {
  owner: string;
  repo: string;
  branch: string;
  token: string;
}

export function GitHubConnectorFields({
  idPrefix,
  value,
  onChange,
  repoPlaceholder = "my-postcards",
}: {
  idPrefix: string;
  value: GitHubConnectorValue;
  onChange: (next: GitHubConnectorValue) => void;
  repoPlaceholder?: string;
}) {
  const t = useT();
  const set =
    (key: keyof GitHubConnectorValue) => (e: ChangeEvent<HTMLInputElement>) =>
      onChange({ ...value, [key]: e.target.value });

  return (
    <>
      <div className="trip-form-row">
        <label className="picker-label" htmlFor={`${idPrefix}-owner`}>
          {t("connector.owner")}
          <input
            id={`${idPrefix}-owner`}
            className="select"
            title={t("connector.owner")}
            type="text"
            autoComplete="off"
            value={value.owner}
            onChange={set("owner")}
            placeholder="your-username"
          />
        </label>
        <label className="picker-label" htmlFor={`${idPrefix}-repo`}>
          {t("connector.repo")}
          <input
            id={`${idPrefix}-repo`}
            className="select"
            title={t("connector.repo")}
            type="text"
            autoComplete="off"
            value={value.repo}
            onChange={set("repo")}
            placeholder={repoPlaceholder}
          />
        </label>
        <label className="picker-label" htmlFor={`${idPrefix}-branch`}>
          {t("connector.branch")}
          <input
            id={`${idPrefix}-branch`}
            className="select"
            title={t("connector.branch")}
            type="text"
            autoComplete="off"
            value={value.branch}
            onChange={set("branch")}
            placeholder="main"
          />
        </label>
      </div>
      <label className="picker-label" htmlFor={`${idPrefix}-token`}>
        {t("connector.token")}
        <input
          id={`${idPrefix}-token`}
          className="select"
          title={t("connector.token")}
          type="password"
          autoComplete="off"
          value={value.token}
          onChange={set("token")}
          placeholder="github_pat_…"
        />
      </label>
      <p className="muted small connector-token-hint">{t("connector.tokenHint")}</p>

      <p className="muted small">
        <strong>{t("connector.noTokenTitle")}</strong> {t("connector.noTokenBody")}
      </p>

      <details className="guide-full-section connector-guide">
        <summary title={t("connector.guide.summary")}>{t("connector.guide.summary")}</summary>
        <ol className="connector-guide-steps">
          <li>{t("connector.guide.step1")}</li>
          <li>{t("connector.guide.step2")}</li>
          <li>{t("connector.guide.step3")}</li>
        </ol>
        <p className="muted small connector-guide-reassure">{t("connector.guide.reassure")}</p>
      </details>
    </>
  );
}
