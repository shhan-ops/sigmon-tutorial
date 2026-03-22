/**
 * OTel 계측은 반드시 가장 먼저 import되어야 한다.
 *
 * TypeScript가 CommonJS로 컴파일되면 import 순서대로 require()가 실행된다.
 * 따라서 이 파일이 @nestjs/core보다 먼저 실행되어 http/express를 패치한다.
 * ESM으로 전환할 경우 node 실행 시 --import 플래그를 사용해야 한다.
 */
import './telemetry/instrumentation';

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // 모든 로그 레벨을 stdout으로 출력 (k8s에서 Loki가 stdout을 수집)
    logger: ['log', 'warn', 'error', 'debug', 'verbose'],
  });

  // 전역 예외 필터 등록 — 구조화된 JSON 로그 출력 및 적절한 HTTP 상태 코드 반환
  app.useGlobalFilters(new HttpExceptionFilter());

  await app.listen(3000);
  Logger.log('Listening on port 3000', 'Bootstrap');
}

bootstrap();
