export const SUPPORTED_LANGUAGES = ['en', 'zh', 'lo'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: SupportedLanguage = 'en';
