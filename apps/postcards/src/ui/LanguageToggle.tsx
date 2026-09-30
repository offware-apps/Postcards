import { useSettings } from "../lib/store/useSettings";
import { useT, LOCALES, LOCALE_LABELS } from "../lib/i18n";

/**
 * UI-language picker: a segmented control (mirrors ThemeToggle / ScopeToggle).
 * Each option is labelled in its OWN language (English / Français / 한국어) so it
 * is recognisable whatever the current locale. The choice is saved on this
 * device only (localStorage) and applied by setting <html lang> + the Intl
 * formatter locale. Keyboard-first: real <button>s in a labelled group.
 */
export function LanguageToggle() {
  const t = useT();
  const locale = useSettings((s) => s.locale);
  const setLocale = useSettings((s) => s.setLocale);
  return (
    <div className="segmented" role="group" aria-label={t("language.aria")}>
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={locale === l}
          className={locale === l ? "seg-on" : ""}
          title={LOCALE_LABELS[l]}
          onClick={() => setLocale(l)}
        >
          {LOCALE_LABELS[l]}
        </button>
      ))}
    </div>
  );
}
