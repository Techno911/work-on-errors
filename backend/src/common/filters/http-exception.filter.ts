import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number;
    let message: string | string[];
    let error: string;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
        error = exception.name;
      } else if (typeof exceptionResponse === 'object') {
        const responseObj = exceptionResponse as Record<string, unknown>;
        message = (responseObj.message as string | string[]) || exception.message;
        error = (responseObj.error as string) || exception.name;
      } else {
        message = exception.message;
        error = exception.name;
      }

    } else {
      // AUDIT-0710 (M4): body-parser бросает PayloadTooLargeError, который не HttpException —
      // раньше улетал в 500 «ошибка сервера». Это клиентская ошибка: тело больше лимита.
      const errType = (exception as { type?: string; name?: string })?.type
        ?? (exception as { name?: string })?.name;
      if (errType === 'entity.too.large' || errType === 'PayloadTooLargeError') {
        status = HttpStatus.PAYLOAD_TOO_LARGE;
        message = 'Запрос слишком большой: уменьшите объём текста или файла';
        error = 'PayloadTooLargeError';
      } else {
        status = HttpStatus.INTERNAL_SERVER_ERROR;
        message = 'Internal server error';
        error = 'InternalServerError';
        this.logger.error('Unhandled exception:', exception);
      }
    }

    const correlationId = request.headers['x-correlation-id'] as string | undefined;

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} → ${status} [correlationId=${correlationId ?? 'n/a'}]`,
      );
    }

    response.status(status).json({
      statusCode: status,
      message,
      error,
      timestamp: new Date().toISOString(),
      path: request.url,
      ...(correlationId ? { correlationId } : {}),
    });
  }
}
