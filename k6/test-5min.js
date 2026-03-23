/**
 * k6 부하 테스트 - 5분 (Stress Test)
 *
 * 기본값: 최대 50 VU, 총 ~300초
 * 단계: 워밍업(60s) → 피크 유지(180s) → 쿨다운(60s)
 *
 * 실행:
 *   k6 run k6/test-5min.js
 *
 * 옵션 커스터마이징:
 *   k6 run --env MAX_VUS=100 k6/test-5min.js
 *   k6 run --env RAMP_DURATION=120s --env SUSTAIN_DURATION=300s k6/test-5min.js
 *   k6 run --env BASE_URL=http://your-host:3000 k6/test-5min.js
 *
 * 환경 변수:
 *   BASE_URL         타겟 URL          (기본: http://localhost:3000)
 *   MAX_VUS          최대 가상 유저 수  (기본: 50)
 *   RAMP_DURATION    워밍업/쿨다운 시간 (기본: 60s)
 *   SUSTAIN_DURATION 피크 유지 시간     (기본: 180s)
 */

import { runMixedScenario } from './helpers.js';

const maxVUs = parseInt(__ENV.MAX_VUS || '50');
const rampDuration = __ENV.RAMP_DURATION || '60s';
const sustainDuration = __ENV.SUSTAIN_DURATION || '180s';

export const options = {
  stages: [
    { duration: rampDuration, target: maxVUs },
    { duration: sustainDuration, target: maxVUs },
    { duration: rampDuration, target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(90)<2000', 'p(95)<3000'],
    http_req_failed: ['rate<0.20'],
    slow_endpoint_duration: ['p(95)<1500'],
    slow_response_rate: ['rate<1.0'],
  },
};

export default function () {
  runMixedScenario();
}
