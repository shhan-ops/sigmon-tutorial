import * as winston from 'winston';

/**
 * Winston 로거 설정.
 * JSON 포맷으로 stdout 출력 → Loki 라벨 추출과 호환된다.
 */
export const winstonConfig: winston.LoggerOptions = {
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  transports: [new winston.transports.Console()],
};
