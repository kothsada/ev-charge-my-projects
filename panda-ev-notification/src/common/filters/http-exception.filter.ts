import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { nowBangkokIso } from '../helpers/date.helper';
import { t, isI18nMessage, parseI18nMessage } from '../i18n';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = t('common.internal_error');

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      let raw: string;
      if (typeof exceptionResponse === 'string') {
        raw = exceptionResponse;
      } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const resp = exceptionResponse as Record<string, unknown>;
        raw = (resp.message as string) ?? exception.message;
      } else {
        raw = exception.message;
      }

      if (isI18nMessage(raw)) {
        const parsed = parseI18nMessage(raw);
        message = parsed ? t(parsed.key, parsed.params) : raw;
      } else {
        message = raw;
      }
    } else if (exception instanceof Error) {
      this.logger.error(`Unhandled error: ${exception.message}`, exception.stack);
      message = exception.message;
    }

    this.logger.warn(`${statusCode} — ${message}`);

    response.status(statusCode).json({
      success: false,
      statusCode,
      data: null,
      message,
      timestamp: nowBangkokIso(),
    });
  }
}
