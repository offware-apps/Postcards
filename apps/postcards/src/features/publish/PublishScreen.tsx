import { useEffect, useMemo, useRef, useState } from "react";
import { getReferenceData } from "../../lib/reference/referenceData";
import { useStories } from "../../lib/store/useStories";
import { useTrips } from "../../lib/store/useTrips";
import { useVisits } from "../../lib/store/useVisits";
import { useToast } from "../../lib/store/useToast";
import { useModalKeys } from "../../lib/hooks/useModalKeys";
import { buildJourney, type JourneyInput, type PublishedJourney } from "../../lib/publish/bundle";
import { renderReaderHtml } from "../../lib/publish/renderReader";
import { encryptJson, MIN_PASSPHRASE_LENGTH } from "../../lib/publish/encrypt";
import { GitHubTarget } from "../../lib/publish/gitTarget";
import { GitHubConnectorFields, type GitHubConnectorValue } from "../../ui/GitHubConnectorFields";
import { coordsOf } from "../travel/distance";
import { download } from "../../lib/download";
import { countryFlag, formatDate, formatInt, formatKm } from "../../lib/format/format";
import { MODE_GLYPH } from "../travel/modes";
import { useT } from "../../lib/i18n";
import type { Trip } from "../../lib/schema/models";
import { isSyncRepo, lockedSlug, publishTravel, slugify } from "../../lib/publish/site";

type Scope = "all" | "trip" | "folder" | "range";

// Remember the target repo (owner/repo/branch) so publishing defaults to the same
// place — the TOKEN is deliberately NOT persisted (it stays in memory for the
// session only; the constitution keeps credentials off any durable store here).
const REPO_KEY = "postcards-publish-repo";
function loadRepo(): { owner: string; repo: string; branch: string } {
  try {
    const v = JSON.parse(localStorage.getItem(REPO_KEY) || "{}");
    return { owner: v.owner || "", repo: v.repo || "", branch: v.branch || "main" };
  } catch {
    return { owner: "", repo: "", branch: "main" };
  }
}
function saveRepo(g: { owner: string; repo: string; branch: string }): void {
  try {
    localStorage.setItem(REPO_KEY, JSON.stringify({ owner: g.owner, repo: g.repo, branch: g.branch }));
  } catch {
    /* private mode: not remembered */
  }
}

/** A short human label for a trip in the picker: "✈️ Paris → Rome · 2 May 2026". */
function tripLabel(t: Trip): string {
  const glyph = MODE_GLYPH[t.mode] ?? "•";
  const when = t.date ? ` · ${formatDate(t.date)}` : "";
  return `${glyph} ${t.from.name} → ${t.to.name}${when}`;
}

/**
 * Publish mode — turn a slice of the private journal into a self-contained,
 * read-only travel-blog website you can host ANYWHERE (a folder, a USB stick,
 * GitHub Pages, Netlify, Nextcloud). The app stays the editor; nothing leaves
 * the device except the single file you explicitly export.
 *
 * Everything is derived on-device: the route from your Trips, distance and
 * totals from their coordinates, stories and photos from the Journal. Photos are
 * already re-encoded (no EXIF/GPS). An optional passphrase encrypts the payload
 * so a public host still can't read it. GitHub is ONE optional target behind the
 * always-available local download — remove it and download still works fully.
 */
export function PublishScreen({ onClose }: { onClose: () => void }) {
  const t = useT();
  const ref = useMemo(() => getReferenceData(), []);
  const stories = useStories((s) => s.stories);
  const trips = useTrips((s) => s.trips);
  const visits = useVisits((s) => s.visits);
  const showToast = useToast((s) => s.show);

  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  useModalKeys(dialogRef, onClose);
  useEffect(() => {
    // Closing removes the focused control, so focus returns to the opener.
    const prev = document.activeElement as HTMLElement | null;
    firstFieldRef.current?.focus();
    return () => prev?.focus?.();
  }, []);

  const [scope, setScope] = useState<Scope>("all");
  const [tripId, setTripId] = useState<string>("");
  const [folderName, setFolderName] = useState<string>("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [title, setTitle] = useState("My travels");
  const [subtitle, setSubtitle] = useState("");
  const [passphrase, setPassphrase] = useState("");
  // Which action is in flight, so ONLY that button shows its progress label
  // (a shared boolean made Download read "Pushing…" during a push, and vice
  // versa). `busy` still gates canExport + both buttons against double-submit.
  const [busyKind, setBusyKind] = useState<null | "download" | "push">(null);
  const busy = busyKind !== null;
  const [preview, setPreview] = useState(false);
  // How the published reader presents the trip. "blog" (the living travelogue) is
  // the default; "book" keeps the original paged reader.
  const [layout, setLayout] = useState<"blog" | "book">("blog");

  // GitHub connector — one optional target. Token is kept ONLY in memory here
  // (React state) and is never written into the exported bundle.
  const [ghOpen, setGhOpen] = useState(false);
  // Owner/repo/branch default to the last-used repo (remembered); token is always
  // empty at start — it is never persisted.
  const [gh, setGh] = useState<GitHubConnectorValue>(() => ({ ...loadRepo(), token: "" }));
  // The public URL a successful push publishes to (GitHub Pages). Shown as a
  // clickable link so the user can jump straight to their live site.
  const [liveUrl, setLiveUrl] = useState<string | null>(null);

  // Ordered trips (newest first) for the "one trip" picker.
  const tripOptions = useMemo(
    () => [...trips].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")),
    [trips],
  );

  // Distinct trip names ("folders") for the "By trip" scope, sorted for a stable
  // picker. Picking one gathers every leg that shares the name.
  const folders = useMemo(() => {
    const names = new Set<string>();
    for (const tr of trips) {
      const nm = tr.name?.trim();
      if (nm) names.add(nm);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [trips]);
  const folderTripIds = useMemo(
    () => trips.filter((tr) => (tr.name?.trim() ?? "") === folderName).map((tr) => tr.tripId),
    [trips, folderName],
  );

  const resolveCoords: JourneyInput["resolveCoords"] = useMemo(
    () => (place) => coordsOf(place, ref),
    [ref],
  );

  // The live journey for the current selection — the exact "book" that ships.
  const journey: PublishedJourney = useMemo(() => {
    const sel = {
      title: title.trim() || "My travels",
      subtitle: subtitle.trim() || undefined,
      ...(scope === "trip" && tripId ? { tripIds: [tripId] } : {}),
      ...(scope === "folder" && folderName ? { tripIds: folderTripIds } : {}),
      ...(scope === "range" && dateFrom ? { dateFrom } : {}),
      ...(scope === "range" && dateTo ? { dateTo } : {}),
    };
    return buildJourney({ visits, trips, stories, resolveCoords }, sel);
  }, [
    visits,
    trips,
    stories,
    resolveCoords,
    scope,
    tripId,
    folderName,
    folderTripIds,
    dateFrom,
    dateTo,
    title,
    subtitle,
  ]);

  // Guard the narrowing scopes: picking "One trip" / "By trip" / "Date range"
  // but not actually choosing a value leaves `sel` with no tripIds/date bounds,
  // so buildJourney would publish EVERYTHING. Treat that as empty so the summary,
  // preview and export all stay disabled until a concrete selection is made — a
  // mis-step must never silently push the whole journal to a public page.
  const selectionIncomplete =
    (scope === "trip" && !tripId) ||
    (scope === "folder" && !folderName) ||
    (scope === "range" && !dateFrom && !dateTo);
  const empty = journey.steps.length === 0 || selectionIncomplete;
  const canExport = !empty && !!title.trim() && !busy;
  // A published encrypted file is a public static blob — crackable offline — so a
  // short passphrase is the likeliest real break. Warn (and the crypto layer
  // hard-refuses) below the floor.
  const passNorm = passphrase.normalize("NFC").trim();
  const passTooShort = passNorm.length > 0 && passNorm.length < MIN_PASSPHRASE_LENGTH;

  /** Build the final self-contained HTML (encrypted when a passphrase is set). */
  async function buildHtml(): Promise<string> {
    // Use the SAME normalised value (passNorm) for the encrypt decision and the
    // encryption itself. Before, the decision used passphrase.trim() but the
    // encrypt used the raw value: a spaces-only box silently published PLAINTEXT,
    // and surrounding spaces produced a file that could never be unlocked.
    const pass = passNorm;
    if (pass) {
      if (pass.length < MIN_PASSPHRASE_LENGTH) {
        throw new Error(`Use a passphrase of at least ${MIN_PASSPHRASE_LENGTH} characters.`);
      }
      const env = await encryptJson(journey, pass);
      return renderReaderHtml(null, { encrypted: env, layout });
    }
    // A box that is present but only whitespace is a mistake — refuse rather than
    // silently publish the journal in the clear. An empty box is the intended
    // open-journal path.
    if (passphrase.length > 0) {
      throw new Error("That passphrase is only spaces — clear it to publish openly, or enter a real one.");
    }
    return renderReaderHtml(journey, { layout });
  }

  async function onDownload() {
    if (!canExport) return;
    setBusyKind("download");
    try {
      const html = await buildHtml();
      download("index.html", html, "text/html");
      showToast(t("publish.toast.saved"));
    } catch (e) {
      // Surface a passphrase guard ("at least 8 characters", "only spaces")
      // instead of a generic failure, so the user can act on it.
      showToast(e instanceof Error ? e.message : t("publish.toast.buildErr"));
    } finally {
      setBusyKind(null);
    }
  }

  async function onPushGitHub() {
    if (!canExport) return;
    if (!gh.owner.trim() || !gh.repo.trim() || !gh.branch.trim() || !gh.token.trim()) {
      showToast(t("publish.toast.missingFields"));
      return;
    }
    // Pages serves the whole branch: publishing into the device-sync repo would
    // put the private sync file on a public website.
    if (isSyncRepo(gh.owner.trim(), gh.repo.trim())) {
      showToast(t("publish.toast.syncRepo"));
      return;
    }
    setBusyKind("push");
    try {
      const html = await buildHtml();
      const owner = gh.owner.trim();
      const repo = gh.repo.trim();
      const branch = gh.branch.trim();
      // Remember the repo (never the token) so the next publish defaults here.
      saveRepo({ owner, repo, branch });
      const target = new GitHubTarget({ owner, repo, branch, token: gh.token.trim() });

      // Each travel gets its OWN subdirectory on the same repo, so journeys coexist
      // (…github.io/<repo>/japan-2024/) instead of overwriting the root. The slug
      // comes from the selected trip/folder, else the site title; a passphrase-
      // locked travel gets a random folder instead, so its URL names nothing.
      const travelName =
        (scope === "folder" && folderName.trim()) ||
        (scope === "trip" && tripOptions.find((tr) => tr.tripId === tripId)?.name?.trim()) ||
        title.trim() ||
        "journey";
      const locked = passNorm.length > 0;
      const slug = locked ? lockedSlug(`${owner}/${repo}`, travelName) : slugify(travelName);
      await publishTravel(target, { html, name: travelName, slug, locked, siteTitle: repo });

      // Best-effort: switch on GitHub Pages so the site goes live without a trip to
      // the repo's Settings. Returns null when the token can't manage Pages.
      let siteUrl: string | null = null;
      try {
        siteUrl = await target.enablePages();
      } catch {
        siteUrl = null;
      }
      // Link straight to THIS travel's subdirectory.
      setLiveUrl(target.pagesSiteUrl() + slug + "/");
      showToast(
        siteUrl ? t("publish.toast.pushedLive") : t("publish.toast.pushed", { owner, repo }),
      );
    } catch (e) {
      showToast(e instanceof Error ? e.message : t("publish.toast.pushErr"));
    } finally {
      setBusyKind(null);
    }
  }

  // The plain-journey reader powers the in-modal preview (same code as the
  // export), so what you see is exactly what ships — including the chosen layout
  // (blog by default). Encrypted export still uses this journey — the preview just
  // shows it unlocked for you, the author.
  const previewHtml = useMemo(
    () => (preview ? renderReaderHtml(journey, { layout }) : ""),
    [preview, journey, layout],
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal publish-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="publish-title"
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="publish-head">
          <h2 id="publish-title">{t("settings.publish.title")}</h2>
          <button
            className="btn-ghost"
            type="button"
            onClick={onClose}
            aria-label={t("publish.closeAria")}
            title={t("publish.closeAria")}
          >
            {t("common.close")}
          </button>
        </div>

        <p className="muted small">{t("publish.intro")}</p>

        {/* Scope */}
        <fieldset className="publish-fieldset">
          <legend>{t("publish.whatToPublish")}</legend>
          <div className="btn-row" role="radiogroup" aria-label={t("publish.scopeAria")}>
            {(
              [
                ["all", t("publish.scope.all")],
                ["trip", t("publish.scope.trip")],
                ["folder", t("publish.scope.byTrip")],
                ["range", t("publish.scope.range")],
              ] as [Scope, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={scope === id}
                className={"mini-btn" + (scope === id ? " on" : "")}
                title={label}
                onClick={() => setScope(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {scope === "trip" && (
            <label className="picker-label" htmlFor="publish-trip">
              {t("publish.tripField")}
              <select
                id="publish-trip"
                className="select"
                title={t("publish.tripField")}
                value={tripId}
                onChange={(e) => setTripId(e.target.value)}
              >
                <option value="" disabled>
                  {tripOptions.length ? t("publish.pickTrip") : t("publish.noTrips")}
                </option>
                {tripOptions.map((t) => (
                  <option key={t.tripId} value={t.tripId}>
                    {tripLabel(t)}
                  </option>
                ))}
              </select>
            </label>
          )}

          {scope === "folder" && (
            <label className="picker-label" htmlFor="publish-folder">
              {t("publish.byTripLabel")}
              <select
                id="publish-folder"
                className="select"
                title={t("publish.byTripLabel")}
                value={folderName}
                onChange={(e) => {
                  const name = e.target.value;
                  setFolderName(name);
                  // The site title defaults to the trip name — but never clobber a
                  // title the author has already customised.
                  setTitle((prev) =>
                    !prev.trim() || prev.trim() === "My travels" ? name : prev,
                  );
                }}
              >
                <option value="" disabled>
                  {folders.length ? t("publish.pickFolder") : t("publish.noNamedTrips")}
                </option>
                {folders.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {scope === "range" && (
            <div className="trip-form-row">
              <label className="picker-label" htmlFor="publish-from">
                {t("travel.from")}
                <input
                  id="publish-from"
                  className="select"
                  title={t("travel.from")}
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </label>
              <label className="picker-label" htmlFor="publish-to">
                {t("travel.to")}
                <input
                  id="publish-to"
                  className="select"
                  title={t("travel.to")}
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </label>
            </div>
          )}
        </fieldset>

        {/* Details */}
        <fieldset className="publish-fieldset">
          <legend>{t("publish.cover")}</legend>
          <label className="picker-label" htmlFor="publish-name">
            {t("journal.titleField")}
            <input
              id="publish-name"
              ref={firstFieldRef}
              className="select"
              title={t("journal.titleField")}
              type="text"
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("publish.titlePlaceholder")}
            />
          </label>
          <label className="picker-label" htmlFor="publish-sub">
            {t("publish.subtitle")}
            <input
              id="publish-sub"
              className="select"
              title={t("publish.subtitle")}
              type="text"
              maxLength={160}
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              placeholder={t("publish.subtitlePlaceholder")}
            />
          </label>
        </fieldset>

        {/* Reader layout — blog (living travelogue) is the default */}
        <fieldset className="publish-fieldset">
          <legend>{t("publish.layout.legend")}</legend>
          <div className="btn-row" role="radiogroup" aria-label={t("publish.layout.aria")}>
            {(
              [
                ["blog", t("publish.layout.blog")],
                ["book", t("publish.layout.book")],
              ] as ["blog" | "book", string][]
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={layout === id}
                className={"mini-btn" + (layout === id ? " on" : "")}
                title={label}
                onClick={() => setLayout(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="muted small">
            {layout === "blog" ? t("publish.layout.blogHint") : t("publish.layout.bookHint")}
          </p>
        </fieldset>

        {/* Protection */}
        <fieldset className="publish-fieldset">
          <legend>{t("publish.protection")}</legend>
          <label className="picker-label" htmlFor="publish-pass">
            {t("publish.passphrase")}
            <input
              id="publish-pass"
              className="select"
              title={t("publish.passphrase")}
              type="password"
              autoComplete="new-password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder={t("publish.passphrasePlaceholder")}
            />
          </label>
          <p className="muted small">
            {passphrase.trim() ? t("publish.encryptedNote") : t("publish.publicNote")}
          </p>
          {passTooShort && (
            <p className="small" role="alert" style={{ color: "var(--danger, #c0392b)" }}>
              {t("publish.passphraseTooShort", { n: MIN_PASSPHRASE_LENGTH })}
            </p>
          )}
        </fieldset>

        {/* Live summary */}
        <div className="publish-summary" role="status" aria-live="polite">
          {empty ? (
            <p className="muted small">{t("publish.emptySelection")}</p>
          ) : (
            <div className="publish-totals">
              <span className="publish-total">
                <strong>{formatInt(journey.totals.places)}</strong>{" "}
                {t.plural("publish.stops", journey.totals.places)}
              </span>
              <span className="publish-total">
                <strong>{formatInt(journey.totals.countries)}</strong>{" "}
                {t.plural("publish.countries", journey.totals.countries)}
              </span>
              <span className="publish-total">
                <strong>{formatKm(journey.totals.distanceKm)}</strong> {t("stats.travel.travelled")}
              </span>
              {journey.dateRange.start && (
                <span className="publish-total publish-total-dates">
                  {formatDate(journey.dateRange.start)}
                  {journey.dateRange.end && journey.dateRange.end !== journey.dateRange.start
                    ? ` – ${formatDate(journey.dateRange.end)}`
                    : ""}
                </span>
              )}
            </div>
          )}
          {!empty && (
            <p className="publish-chips" aria-hidden>
              {journey.steps.slice(0, 8).map((s, i) => (
                <span key={i} className="publish-chip">
                  {countryFlag(s.place.countryId)} {s.place.name}
                </span>
              ))}
              {journey.steps.length > 8 && (
                <span className="publish-chip publish-chip-more">
                  +{journey.steps.length - 8}
                </span>
              )}
            </p>
          )}
        </div>

        <p className="muted small">{t("publish.photosNote")}</p>

        {/* Export */}
        <div className="publish-actions">
          <button
            className="btn"
            type="button"
            title={t("publish.download")}
            disabled={!canExport}
            onClick={onDownload}
          >
            {busyKind === "download" ? t("publish.building") : t("publish.download")}
          </button>
          <button
            className="btn-ghost"
            type="button"
            disabled={empty}
            aria-pressed={preview}
            title={preview ? t("publish.hidePreview") : t("publish.preview")}
            onClick={() => setPreview((p) => !p)}
          >
            {preview ? t("publish.hidePreview") : t("publish.preview")}
          </button>
        </div>

        {preview && !empty && (
          <div className="publish-preview">
            <iframe
              title={t("publish.previewTitle")}
              className="publish-preview-frame"
              sandbox="allow-scripts"
              srcDoc={previewHtml}
            />
          </div>
        )}

        {/* Optional GitHub connector */}
        <div className="publish-github">
          <button
            className="link"
            type="button"
            aria-expanded={ghOpen}
            title={t("publish.ghToggle")}
            onClick={() => setGhOpen((v) => !v)}
          >
            {ghOpen ? "▾" : "▸"} {t("publish.ghToggle")}
          </button>
          {ghOpen && (
            <div className="publish-github-body">
              <p className="muted small">{t("publish.ghNote")}</p>
              <GitHubConnectorFields
                idPrefix="gh"
                value={gh}
                onChange={setGh}
                repoPlaceholder="my-journey"
              />
              <div className="publish-actions">
                <button
                  className="btn"
                  type="button"
                  title={t("publish.push")}
                  disabled={!canExport}
                  onClick={onPushGitHub}
                >
                  {busyKind === "push" ? t("publish.pushing") : t("publish.push")}
                </button>
              </div>
              {liveUrl && (
                <p className="muted small publish-live">
                  {t("publish.liveSitePrefix")}{" "}
                  <a href={liveUrl} target="_blank" rel="noreferrer noopener" title={liveUrl}>
                    {liveUrl}
                  </a>
                  <br />
                  {t("publish.liveSiteNote")}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
