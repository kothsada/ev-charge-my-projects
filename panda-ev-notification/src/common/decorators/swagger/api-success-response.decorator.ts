import { applyDecorators, HttpStatus } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';

export function ApiSuccessResponse(
  status: number,
  description: string,
  dataExample?: unknown,
) {
  return applyDecorators(
    ApiResponse({
      status,
      description,
      content: {
        'application/json': {
          example: {
            success: true,
            statusCode: status,
            data: (dataExample ?? null) as Record<string, unknown>,
            message: description,
            timestamp: '2026-06-16T10:00:00+07:00',
          },
        },
      },
    }),
  );
}

export function ApiCreatedResponse(description: string, dataExample?: unknown) {
  return ApiSuccessResponse(HttpStatus.CREATED, description, dataExample);
}

export function ApiMessageResponse(
  description: string,
  messageExample?: string,
) {
  return applyDecorators(
    ApiResponse({
      status: HttpStatus.OK,
      description,
      content: {
        'application/json': {
          example: {
            success: true,
            statusCode: 200,
            data: null,
            message: messageExample ?? description,
            timestamp: '2026-06-16T10:00:00+07:00',
          },
        },
      },
    }),
  );
}
