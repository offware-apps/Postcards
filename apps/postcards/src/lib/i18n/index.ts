// Public entry point for the i18n layer. Components import { useT } from here.
//
//   const t = useT();
//   <h2>{t("nav.map")}</h2>
//   <p>{t("places.countries.count", { n: 42 })}</p>
//
// useT() subscribes to the active locale in the settings store, so switching
// language re-renders every component that reads a string.

import { useMemo } from "react";
import { useSettings } from "../store/useSettings";
import { translate, type Locale, type MessageKey, type TParams } from "./core";

export {
  LOCALES,
  LOCALE_LABELS,
  type Locale,
  type MessageKey,
  type Messages,
  type TParams,
} from "./core";

/** A locale-bound translate function: `t("key", { param })`. */
export interface TFunction {
  (key: MessageKey, params?: TParams): string;
  /**
   * Plural-aware lookup: picks `${base}_one` / `${base}_other` for the count and
   * injects it as {count}, by the locale's CLDR rule: English takes `_one` for 1
   * alone, French for 0 and 1, and Korean, which does not inflect, never.
   */
  plural(base: string, count: number, params?: TParams): string;
}

/** Subscribe to the active locale and get a bound `t()`; re-renders on change. */
export function useT(): TFunction {
  const locale = useSettings((s) => s.locale);
  return useMemo<TFunction>(() => {
    const fn = ((key, params) => translate(locale, key, params)) as TFunction;
    const rules = new Intl.PluralRules(locale);
    fn.plural = (base, count, params) => {
      const suffix = rules.select(count) === "one" ? "_one" : "_other";
      return translate(locale, `${base}${suffix}`, { count, ...params });
    };
    return fn;
  }, [locale]);
}

/** Just the active locale — for threading into Intl formatters, dates, etc. */
export function useLocale(): Locale {
  return useSettings((s) => s.locale);
}
