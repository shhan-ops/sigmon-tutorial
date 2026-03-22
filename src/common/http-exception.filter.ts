import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * 전역 예외 필터.
 * 처리되지 않은 모든 예외를 잡아 구조화된 JSON 로그를 출력한다.
 * Loki에서 path, statusCode, message 등의 필드로 필터링할 수 있다.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof Error ? exception.message : 'Internal server error';

    const stack = exception instanceof Error ? exception.stack : undefined;

    // 구조화된 에러 로그 — 모든 필드를 최상위에 두어 Loki에서 라벨로 필터링 가능
    this.logger.error(
      JSON.stringify({
        message,
        stack,
        path: req.url,
        statusCode: status,
        timestamp: new Date().toISOString(),
      }),
    );

    res.status(status).json({
      statusCode: status,
      message,
      path: req.url,
      timestamp: new Date().toISOString(),
    });
  }
}
