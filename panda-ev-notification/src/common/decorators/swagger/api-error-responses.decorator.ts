import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';

export function ApiValidationResponse() {
  return applyDecorators(
    ApiResponse({
      status: 400,
      description: 'Validation failed',
      content: {
        'application/json': {
          example: {
            success: false,
            statusCode: 400,
            data: null,
            message: 'Validation failed',
            errorCode: 'VALIDATION_ERROR',
            errors: [{ field: 'userId', message: 'userId must be a UUID' }],
            timestamp: '2026-06-16T10:00:00+07:00',
          },
        },
      },
    }),
  );
}

export function ApiUnauthorizedResponse() {
  return applyDecorators(
    ApiResponse({
      status: 401,
      description: 'Unauthorized',
      content: {
        'application/json': {
          example: {
            success: false,
            statusCode: 401,
            data: null,
            message: 'Authentication required',
            errorCode: 'AUTH_UNAUTHORIZED',
            timestamp: '2026-06-16T10:00:00+07:00',
          },
        },
      },
    }),
  );
}

export function ApiNotFoundResponse(message = 'Resource not found') {
  return applyDecorators(
    ApiResponse({
      status: 404,
      description: message,
      content: {
        'application/json': {
          example: {
            success: false,
            statusCode: 404,
            data: null,
            message,
            errorCode: 'RESOURCE_NOT_FOUND',
            timestamp: '2026-06-16T10:00:00+07:00',
          },
        },
      },
    }),
  );
}

export function ApiInternalErrorResponse() {
  return applyDecorators(
    ApiResponse({
      status: 500,
      description: 'Internal server error',
      content: {
        'application/json': {
          example: {
            success: false,
            statusCode: 500,
            data: null,
            message: 'Internal server error',
            errorCode: 'INTERNAL_ERROR',
            timestamp: '2026-06-16T10:00:00+07:00',
          },
        },
      },
    }),
  );
}

export function ApiAuthErrors() {
  return applyDecorators(ApiUnauthorizedResponse(), ApiInternalErrorResponse());
}

export function ApiCrudReadErrors(notFoundMessage?: string) {
  return applyDecorators(
    ApiUnauthorizedResponse(),
    ApiNotFoundResponse(notFoundMessage),
    ApiInternalErrorResponse(),
  );
}
