/**
 * OpenTelemetry 계측 초기화 — NestJS 부트스트랩보다 반드시 먼저 로드되어야 한다.
 *
 * 트레이스와 메트릭을 클러스터 내 Alloy OTLP 수집기로 전송한다.
 * main.ts의 첫 번째 구문으로 import해야 http, express 등의 라이브러리가
 * NestJS에 의해 require되기 전에 패치된다.
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { Resource } from '@opentelemetry/resources';

const OTLP_ENDPOINT = 'http://alloy.monitoring.svc.cluster.local:4318';

const sdk = new NodeSDK({
  resource: new Resource({
    'service.name': 'nestjs-sample',
  }),

  // 트레이스 익스포터: 스팬을 Alloy → Tempo로 전송
  traceExporter: new OTLPTraceExporter({
    url: `${OTLP_ENDPOINT}/v1/traces`,
  }),

  // 메트릭 익스포터: OTLP 메트릭을 Alloy → Prometheus(또는 Mimir)로 전송
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: `${OTLP_ENDPOINT}/v1/metrics`,
    }),
    exportIntervalMillis: 15_000,
  }),

  // 자동 계측: http, express, dns 등 주요 라이브러리를 자동으로 패치
  instrumentations: [
    getNodeAutoInstrumentations({
      // NestJS 내부 파일시스템 폴링으로 인한 불필요한 스팬 생성 방지
      '@opentelemetry/instrumentation-fs': { enabled: false },
    }),
  ],
});

sdk.start();

// 그레이스풀 셧다운 — 프로세스 종료 전 대기 중인 스팬/메트릭을 모두 전송
process.on('SIGTERM', () => {
  sdk.shutdown().finally(() => process.exit(0));
});
