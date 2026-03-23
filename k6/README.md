# k6 부하 테스트

## 설치

```bash
# macOS
brew install k6
```

## 테스트 파일

| 파일 | 유형 | 기본 시간 | 기본 최대 VU |
|------|------|-----------|-------------|
| `test-1min.js` | Smoke Test | ~1분 | 5 |
| `test-3min.js` | Load Test | ~3분 | 20 |
| `test-5min.js` | Stress Test | ~5분 | 50 |

> 시간 구조: **워밍업** → **피크 유지** → **쿨다운**

---

## 실행

### 기본 실행 (기본값 사용)
#### 1분 테스트
```bash
k6 run ./k6/test-1min.js
```

#### 3분 테스트
```bash
k6 run ./k6/test-3min.js
```
#### 5분 테스트
```bash
k6 run ./k6/test-5min.js
```

### 환경 변수로 커스터마이징

| 변수 | 설명 | 예시 |
|------|------|------|
| `BASE_URL` | 타겟 URL | `http://localhost:3000` |
| `MAX_VUS` | 최대 가상 유저 수 | `50` |
| `RAMP_DURATION` | 워밍업/쿨다운 시간 | `30s`, `1m` |
| `SUSTAIN_DURATION` | 피크 유지 시간 | `120s`, `2m` |

```bash
# VU 수 변경
k6 run --env MAX_VUS=30 ./k6/test-3min.js

# 시간 변경 (총 10분: 2m 워밍업 + 6m 유지 + 2m 쿨다운)
k6 run --env RAMP_DURATION=2m --env SUSTAIN_DURATION=6m ./k6/test-5min.js

# URL + VU + 시간 모두 변경
k6 run \
  --env BASE_URL=http://your-host:3000 \
  --env MAX_VUS=100 \
  --env RAMP_DURATION=1m \
  --env SUSTAIN_DURATION=3m \
  ./k6/test-5min.js
```

---

## 엔드포인트 믹스 (helpers.js)

| 엔드포인트 | 비율 | 설명 |
|-----------|------|------|
| `GET /hello` | 60% | 기본 응답 |
| `GET /slow` | 30% | 느린 응답 (300~800ms) |
| `GET /error` | 10% | 의도적 500 에러 |

## 커스텀 메트릭

- `error_rate` — 예상치 못한 에러 비율
- `slow_response_rate` — 300ms 초과 응답 비율
- `total_requests` — 엔드포인트별 총 요청 수
- `slow_endpoint_duration` — /slow 응답시간 분포
