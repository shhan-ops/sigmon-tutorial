/**
 * k6 부하 테스트 - 1분 (Smoke Test)
 *
 * 기본값: 최대 5 VU, 총 ~60초
 * 단계: 워밍업(15s) → 피크 유지(30s) → 쿨다운(15s)
 *
 * 실행:
 *   k6 run k6/test-1min.js
 *
 * 옵션 커스터마이징:
 *   k6 run --env MAX_VUS=10 k6/test-1min.js
 *   k6 run --env RAMP_DURATION=20s --env SUSTAIN_DURATION=40s k6/test-1min.js
 *   k6 run --env BASE_URL=http://your-host:3000 k6/test-1min.js
 *
 * 환경 변수:
 *   BASE_URL         타겟 URL          (기본: http://localhost:3000)
 *   MAX_VUS          최대 가상 유저 수  (기본: 5)
 *   RAMP_DURATION    워밍업/쿨다운 시간 (기본: 15s)
 *   SUSTAIN_DURATION 피크 유지 시간     (기본: 30s)
 */

import { runMixedScenario } from './helpers.js';

const maxVUs = parseInt(__ENV.MAX_VUS || '5');
const rampDuration = __ENV.RAMP_DURATION || '15s';
const sustainDuration = __ENV.SUSTAIN_DURATION || '30s';

export const options = {
  stages: [
    { duration: rampDuration, target: maxVUs },
    { duration: sustainDuration, target: maxVUs },
    { duration: rampDuration, target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000', 'p(99)<3000'],
    http_req_failed: ['rate<0.15'],
  },
};

export default function () {
  runMixedScenario();
}
