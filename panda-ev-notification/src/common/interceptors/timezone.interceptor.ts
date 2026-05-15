import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { toBangkokIso } from '../helpers/date.helper';

function convertDates(data: unknown): unknown {
  if (data instanceof Date) return toBangkokIso(data);
  if (Array.isArray(data)) return data.map(convertDates);
  if (data !== null && typeof data === 'object') {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(data as object)) {
      result[key] = convertDates((data as Record<string, unknown>)[key]);
    }
    return result;
  }
  return data;
}

@Injectable()
export class TimezoneInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((data) => convertDates(data)));
  }
}
