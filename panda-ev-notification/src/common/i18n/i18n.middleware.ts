import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { i18nStorage } from './i18n.context';
import {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  SupportedLanguage,
} from './i18n.constants';

@Injectable()
export class I18nMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    const header = req.headers['accept-language'] ?? '';
    const requested = header.split(',')[0]?.trim().split('-')[0]?.toLowerCase();
    const lang: SupportedLanguage = (
      SUPPORTED_LANGUAGES as readonly string[]
    ).includes(requested)
      ? (requested as SupportedLanguage)
      : DEFAULT_LANGUAGE;

    i18nStorage.run({ lang }, next);
  }
}
