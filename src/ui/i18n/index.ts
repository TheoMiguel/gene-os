import { type Language, settings } from '../../state/settings';
import { type Dictionary, en, type MessageKey } from './en';
import { es } from './es';
import { pt } from './pt';

export type { MessageKey };

export const DICTIONARIES: Readonly<Record<Language, Dictionary>> = { en, es, pt };

/** Language names in their own language, so a user can find theirs whatever the current language. */
export const LANGUAGE_NAMES: Readonly<Record<Language, string>> = {
  es: 'Español',
  en: 'English',
  pt: 'Português',
};

/** Fills `{name}` placeholders in a message. */
export function format(message: string, params?: Readonly<Record<string, string | number>>): string {
  return params
    ? message.replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match))
    : message;
}

/** Translates `key` into the current language. Called during render, it re-renders on a language change. */
export function t(key: MessageKey, params?: Readonly<Record<string, string | number>>): string {
  return format(DICTIONARIES[settings.value.language][key], params);
}
