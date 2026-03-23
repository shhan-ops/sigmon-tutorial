/**
 * OTel 계측은 반드시 가장 먼저 import되어야 한다.
 *
 * TypeScript가 CommonJS로 컴파일되면 import 순서대로 require()가 실행된다.
 * 따라서 이 파일이 @nestjs/core보다 먼저 실행되어 http/express를 패치한다.
 * ESM으로 전환할 경우 node 실행 시 --import 플래그를 사용해야 한다.
 */
import './telemetry/instrumentation';

import { NestFactory } from '@nestjs/core';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // 부트스트랩 전 NestJS 기본 로거를 비활성화 (Winston이 대체)
    bufferLogs: true,
  });

  // NestJS 전체 로거를 Winston으로 교체
  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));

  const port = process.env.PORT ?? 8080;
  await app.listen(port);
}

bootstrap();
