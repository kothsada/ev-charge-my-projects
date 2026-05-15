import { AsyncLocalStorage } from 'async_hooks';
import { SupportedLanguage, DEFAULT_LANGUAGE } from './i18n.constants';

interface I18nStore {
  lang: SupportedLanguage;
}

export const i18nStorage = new AsyncLocalStorage<I18nStore>();

export function getCurrentLang(): SupportedLanguage {
  return i18nStorage.getStore()?.lang ?? DEFAULT_LANGUAGE;
}
