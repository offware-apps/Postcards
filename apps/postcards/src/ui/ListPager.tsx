import { MoreButton } from "./MoreButton";
import { useT } from "../lib/i18n";

/**
 * The "Showing X of Y / Show N more" footer shared by every paged list. The
 * caller keeps the `X.length > shown` guard so this only renders when there's
 * more to reveal; `label` replaces the "Showing X of Y" text.
 */
export function ListPager({
  shown,
  total,
  step,
  onMore,
  label,
}: {
  shown: number;
  total: number;
  step: number;
  onMore: () => void;
  label?: string;
}) {
  const t = useT();
  return (
    <div className="list-pager">
      <span className="muted small">{label ?? t("journal.showingCount", { shown, total })}</span>
      <MoreButton onMore={onMore}>{t("journal.showMore", { count: step })}</MoreButton>
    </div>
  );
}
