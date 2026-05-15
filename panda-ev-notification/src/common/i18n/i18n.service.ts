import { Injectable } from '@nestjs/common';
import { getCurrentLang } from './i18n.context';
import { SupportedLanguage, DEFAULT_LANGUAGE } from './i18n.constants';
import * as en from './translations/en.json';
import * as zh from './translations/zh.json';
import * as lo from './translations/lo.json';

const translations: Record<SupportedLanguage, Record<string, string>> = {
  en: flatten(en),
  zh: flatten(zh),
  lo: flatten(lo),
};

type NestedRecord = { [key: string]: string | NestedRecord };

function flatten(obj: NestedRecord, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    const value = obj[key];
    if (typeof value === 'object' && value !== null) {
      Object.assign(result, flatten(value, fullKey));
    } else {
      result[fullKey] = String(value);
    }
  }
  return result;
}

export function t(
  key: string,
  params?: Record<string, string | number>,
): string {
  const lang = getCurrentLang();
  let message =
    translations[lang]?.[key] ?? translations[DEFAULT_LANGUAGE]?.[key] ?? key;

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      message = message.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }

  return message;
}

@Injectable()
export class I18nService {
  t(key: string, params?: Record<string, string | number>): string {
    return t(key, params);
  }
}
