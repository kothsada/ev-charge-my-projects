import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { nowBangkokIso } from '../helpers/date.helper';

interface ResponseShape {
  success: boolean;
  statusCode: number;
  data: unknown;
  message: string;
  timestamp: string;
}

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<ResponseShape> {
    const statusCode = context.switchToHttp().getResponse().statusCode ?? 200;

    return next.handle().pipe(
      map((data) => {
        // Pass through if already wrapped
        if (
          data &&
          typeof data === 'object' &&
          'success' in data &&
          'data' in data &&
          'message' in data
        ) {
          return data as ResponseShape;
        }

        return {
          success: true,
          statusCode,
          data: data ?? null,
          message: 'Success',
          timestamp: nowBangkokIso(),
        };
      }),
    );
  }
}
