import { Injectable, NestMiddleware, Inject, LoggerService } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Counter, Histogram } from 'prom-client';
import { trace } from '@opentelemetry/api';

/**
 * Prometheus 메트릭 — 모듈 스코프에 정의하여 한 번만 등록되도록 한다.
 *
 * nestjs_http_requests_total           → 전체 요청 수 (Counter)
 * nestjs_http_request_duration_seconds → 응답 시간 분포 (Histogram)
 *
 * 라벨: method, route, status_code
 * 카디널리티를 낮게 유지하기 위해 원시 path 대신 route 패턴을 사용한다.
 * 예) /users/1, /users/2 → /users/:id 로 집계
 */
const httpRequestsTotal = new Counter({
  name: 'nestjs_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
});

const httpRequestDurationSeconds = new Histogram({
  name: 'nestjs_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  // 일반적인 API 응답 시간 범위에 맞춰 조정된 버킷: 5ms → 5s
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

@Injectable()
export class LoggingMiddleware implements NestMiddleware {
  constructor(
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  use(req: Request, res: Response, next: NextFunction) {
    const { method } = req;
    const startMs = Date.now();

    // res.on('finish') 시점에는 OTel span이 이미 종료되어 있을 수 있다.
    // 요청이 시작되는 이 시점에 traceId를 미리 캡처해 finish 콜백에서 사용한다.
    const traceId = trace.getActiveSpan()?.spanContext().traceId;

    res.on('finish', () => {
      const statusCode = res.statusCode;
      const durationMs = Date.now() - startMs;

      // Prometheus 카디널리티를 낮추기 위해 원시 경로(/users/42) 대신
      // 라우트 패턴(/users/:id)을 사용한다.
      const route: string = (req.route?.path as string) ?? req.path;

      this.logger.log(
        { method, path: req.path, route, statusCode, durationMs, traceId },
        'HTTP',
      );

      const labels = { method, route, status_code: String(statusCode) };
      httpRequestsTotal.inc(labels);
      httpRequestDurationSeconds.observe(labels, durationMs / 1000);
    });

    next();
  }
}
