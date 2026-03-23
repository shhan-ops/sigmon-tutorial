/**
 * k6 부하 테스트 - 3분 (Load Test)
 *
 * 기본값: 최대 20 VU, 총 ~180초
 * 단계: 워밍업(30s) → 피크 유지(120s) → 쿨다운(30s)
 *
 * 실행:
 *   k6 run k6/test-3min.js
 *
 * 옵션 커스터마이징:
 *   k6 run --env MAX_VUS=30 k6/test-3min.js
 *   k6 run --env RAMP_DURATION=60s --env SUSTAIN_DURATION=180s k6/test-3min.js
 *   k6 run --env BASE_URL=http://your-host:3000 k6/test-3min.js
 *
 * 환경 변수:
 *   BASE_URL         타겟 URL          (기본: http://localhost:3000)
 *   MAX_VUS          최대 가상 유저 수  (기본: 20)
 *   RAMP_DURATION    워밍업/쿨다운 시간 (기본: 30s)
 *   SUSTAIN_DURATION 피크 유지 시간     (기본: 120s)
 */

import { runMixedScenario } from './helpers.js';

const maxVUs = parseInt(__ENV.MAX_VUS || '20');
const rampDuration = __ENV.RAMP_DURATION || '30s';
const sustainDuration = __ENV.SUSTAIN_DURATION || '120s';

export const options = {
  stages: [
    { duration: rampDuration, target: maxVUs },
    { duration: sustainDuration, target: maxVUs },
    { duration: rampDuration, target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000', 'p(99)<2000'],
    http_req_failed: ['rate<0.15'],
    slow_endpoint_duration: ['p(95)<1500'],
  },
};

export default function () {
  runMixedScenario();
}
