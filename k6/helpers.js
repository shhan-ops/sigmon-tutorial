import { check, sleep } from 'k6';
import http from 'k6/http';
import { Rate, Trend, Counter } from 'k6/metrics';

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// Custom metrics
export const errorRate = new Rate('error_rate');
export const slowResponseRate = new Rate('slow_response_rate');
export const requestCount = new Counter('total_requests');
export const slowEndpointTrend = new Trend('slow_endpoint_duration');

/**
 * GET /hello - 기본 헬스체크
 */
export function callHello() {
  const res = http.get(`${BASE_URL}/hello`, {
    tags: { endpoint: 'hello' },
  });

  const ok = check(res, {
    'hello: status 200': (r) => r.status === 200,
    'hello: has message': (r) => {
      try {
        return JSON.parse(r.body).message === 'hello';
      } catch {
        return false;
      }
    },
  });

  errorRate.add(!ok);
  requestCount.add(1, { endpoint: 'hello' });
  return res;
}

/**
 * GET /slow - 느린 응답 시뮬레이션 (300~800ms)
 */
export function callSlow() {
  const res = http.get(`${BASE_URL}/slow`, {
    tags: { endpoint: 'slow' },
  });

  const ok = check(res, {
    'slow: status 200': (r) => r.status === 200,
    'slow: responded within 1.5s': (r) => r.timings.duration < 1500,
  });

  errorRate.add(!ok);
  slowResponseRate.add(res.timings.duration > 300);
  slowEndpointTrend.add(res.timings.duration);
  requestCount.add(1, { endpoint: 'slow' });
  return res;
}

/**
 * GET /error - 에러 응답 (500 expected)
 */
export function callError() {
  const res = http.get(`${BASE_URL}/error`, {
    tags: { endpoint: 'error' },
  });

  // /error 는 의도적 에러이므로 500이 정상
  const ok = check(res, {
    'error: status 500': (r) => r.status === 500,
  });

  requestCount.add(1, { endpoint: 'error' });
  return res;
}

/**
 * 엔드포인트 믹스 실행 (비율: hello 60%, slow 30%, error 10%)
 */
export function runMixedScenario() {
  const rand = Math.random();

  if (rand < 0.6) {
    callHello();
    sleep(0.3);
  } else if (rand < 0.9) {
    callSlow();
    sleep(0.5);
  } else {
    callError();
    sleep(0.2);
  }
}

/**
 * 공통 thresholds
 */
export const commonThresholds = {
  // 전체 요청의 95%가 1초 이내
  http_req_duration: ['p(95)<1000'],
  // /slow 엔드포인트는 1.5초 이내
  slow_endpoint_duration: ['p(95)<1500'],
  // HTTP 실패율 5% 이하 (/error 제외하면 0%)
  http_req_failed: ['rate<0.05'],
};
