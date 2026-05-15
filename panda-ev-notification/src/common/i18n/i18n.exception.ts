const I18N_PREFIX = 'i18n:';

export function i18nMessage(
  key: string,
  params?: Record<string, string | number>,
): string {
  if (!params || Object.keys(params).length === 0) {
    return `${I18N_PREFIX}${key}`;
  }
  const paramStr = Object.entries(params)
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  return `${I18N_PREFIX}${key}|${paramStr}`;
}

export function isI18nMessage(message: string): boolean {
  return message.startsWith(I18N_PREFIX);
}

export function parseI18nMessage(
  message: string,
): { key: string; params?: Record<string, string> } | null {
  if (!isI18nMessage(message)) return null;

  const body = message.slice(I18N_PREFIX.length);
  const [key, paramStr] = body.split('|');

  if (!paramStr) return { key };

  const params: Record<string, string> = {};
  for (const pair of paramStr.split('&')) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx > 0) {
      params[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1);
    }
  }

  return { key, params };
}
