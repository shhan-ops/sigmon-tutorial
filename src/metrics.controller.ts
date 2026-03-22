import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { register } from 'prom-client';

/**
 * GET /metrics 엔드포인트에서 Prometheus 기본 레지스트리를 노출한다.
 * Prometheus 또는 에이전트 모드의 Alloy가 이 엔드포인트를 스크레이프한다.
 *
 * Content-Type은 레지스트리에서 자동으로 설정되므로
 * text/plain(기본값)과 application/openmetrics-text 모두 지원된다.
 */
@Controller()
export class MetricsController {
  @Get('metrics')
  async metrics(@Res() res: Response) {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  }
}
