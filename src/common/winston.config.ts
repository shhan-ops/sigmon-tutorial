import * as winston from 'winston';
import { trace } from '@opentelemetry/api';

/**
 * 활성 OTel span에서 traceId / spanId를 읽어 로그 최상위 필드로 추가하는 포맷.
 *
 * 컨트롤러 · 필터 등 요청 처리 중 동기적으로 호출되는 로그에 자동 적용된다.
 * res.on('finish') 콜백처럼 span이 이미 종료된 시점의 로그는
 * LoggingMiddleware에서 직접 traceId를 캡처해 전달한다.
 */
const otelFormat = winston.format((info) => {
  const span = trace.getActiveSpan();
  if (span?.isRecording()) {
    const ctx = span.spanContext();
    info.traceId = ctx.traceId;
    info.spanId = ctx.spanId;
  }
  return info;
});

/**
 * Winston 로거 설정.
 * JSON 포맷으로 stdout 출력 → Loki 라벨 추출과 호환된다.
 */
export const winstonConfig: winston.LoggerOptions = {
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
    winston.format.errors({ stack: true }),
    otelFormat(),
    winston.format.json(),
  ),
  transports: [new winston.transports.Console()],
};
