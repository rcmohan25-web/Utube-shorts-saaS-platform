import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';

// Normalizes every error response to { error: { code, message } } per §8.1.
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const body = exception instanceof HttpException ? exception.getResponse() : null;

    const code =
      typeof body === 'object' && body && 'code' in body
        ? (body as { code: string }).code
        : HttpStatus[status] ?? 'INTERNAL_ERROR';

    const message =
      typeof body === 'object' && body && 'message' in body
        ? (body as { message: string | string[] }).message
        : exception instanceof Error
          ? exception.message
          : 'Unexpected error';

    res.status(status).json({
      error: { code, message },
    });
  }
}
