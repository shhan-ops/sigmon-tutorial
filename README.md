# sigmon-tutorial

NestJS + Prometheus + Loki + Grafana Alloy 를 활용한 **옵저버빌리티 학습 프로젝트**

Minikube 단일 노드 환경에서 메트릭 수집, 로그 집계, 분산 트레이싱 파이프라인을 직접 구성하고 실습한다.

---

## 목차

1. [아키텍처](#아키텍처)
2. [프로젝트 구조](#프로젝트-구조)
3. [NestJS 앱](#nestjs-앱)
4. [Kubernetes 설치 가이드](#kubernetes-설치-가이드)
5. [앱 배포 (Minikube)](#앱-배포-minikube)
6. [k6 부하 테스트](#k6-부하-테스트)
7. [Grafana 사용법](#grafana-사용법)
8. [디버그 가이드](#디버그-가이드)

---

## 아키텍처

```mermaid
flowchart LR
    APP["NestJS App<br/>:8080"]

    subgraph monitoring["☸ namespace: monitoring"]
        ALLOY["Grafana Alloy<br/>:4317 gRPC · :4318 HTTP"]
        LOKI[("Loki<br/>SingleBinary · :3100")]
        MINIO[("MinIO<br/>:9000")]
        PROM[("Prometheus<br/>:9090")]
        GRAFANA[["Grafana<br/>:3000 NodePort"]]

        ALLOY -->|"log push"| LOKI
        LOKI -->|"read / write"| MINIO
        PROM --> GRAFANA
        LOKI --> GRAFANA
    end

    APP -->|"OTLP<br/>traces · metrics"| ALLOY
    APP -.->|"stdout logs<br/>K8s API"| ALLOY
    APP -->|"scrape /metrics"| PROM
```

| 컴포넌트 | 역할 | 포트 |
|---|---|---|
| NestJS App | 샘플 HTTP 서버 (메트릭 / 로그 / 트레이스 생성) | 8080 |
| Grafana Alloy | Pod 로그 수집 → Loki, OTLP 수신기 | 4317 (gRPC), 4318 (HTTP) |
| Loki | 로그 집계 및 저장 (MinIO 백엔드) | 3100 |
| Prometheus | 메트릭 수집 및 저장 | 9090 |
| Grafana | 메트릭 / 로그 시각화 | 3000 (NodePort) |

---

## 프로젝트 구조

```mermaid
mindmap
  root((sigmon-tutorial))
    src
      main.ts<br/>앱 진입점 · OTel 초기화
      app.module.ts<br/>모듈 · 미들웨어 등록
      app.controller.ts<br/>/hello · /error · /slow
      metrics.controller.ts<br/>/metrics
      common
        winston.config.ts<br/>Winston 로거 설정
        logging.middleware.ts<br/>요청 로깅 · prom-client
        http-exception.filter.ts<br/>전역 예외 처리
      telemetry
        instrumentation.ts<br/>OTel SDK 초기화
    k8s
      app.yaml<br/>Deployment · Service · ServiceMonitor
      prometheus-values.yaml
      loki-values.yaml
      alloy-values.yaml
    k6
      helpers.js<br/>공통 시나리오 · 메트릭
      test-1min.js<br/>Smoke Test
      test-3min.js<br/>Load Test
      test-5min.js<br/>Stress Test
      config.env<br/>k6 환경 변수
    Dockerfile
    .env
```

---

## NestJS 앱

### 엔드포인트

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/hello` | `{ message: "hello" }` 반환, 정상 로그 출력 |
| GET | `/error` | 의도적 에러 발생, 에러 로그 + 500 응답 |
| GET | `/slow` | 300~800ms 랜덤 지연 후 응답 (레이턴시 학습용) |
| GET | `/metrics` | Prometheus 스크레이프 엔드포인트 |

### 요청 처리 흐름

```mermaid
sequenceDiagram
    participant C as Client
    participant MW as LoggingMiddleware
    participant H as Handler
    participant PC as prom-client
    participant AL as Alloy
    participant LK as Loki
    participant PR as Prometheus

    C->>MW: HTTP Request
    MW->>H: next()
    H-->>MW: Response
    MW-->>C: HTTP Response

    Note over MW: res.on('finish') 콜백

    MW->>PC: Counter.inc()
    MW->>PC: Histogram.observe()
    MW->>MW: stdout에 JSON 로그 출력

    Note over AL,LK: 비동기 수집
    AL-->>MW: K8s API pods/log 스트리밍
    AL->>LK: POST /loki/api/v1/push

    Note over PR: 15초 주기 스크레이프
    PR->>H: GET /metrics
    H-->>PR: prom-client text format
```

### Prometheus 메트릭

`GET /metrics` 에서 아래 두 메트릭이 노출된다.

```
# 전체 요청 수 (Counter)
nestjs_http_requests_total{method, route, status_code}

# 응답 시간 분포 (Histogram)
nestjs_http_request_duration_seconds{method, route, status_code}
```

**PromQL 예시:**

```promql
# 초당 요청 수 (RPS)
rate(nestjs_http_requests_total[1m])

# 에러율 (5xx 비율)
rate(nestjs_http_requests_total{status_code=~"5.."}[1m])
  / rate(nestjs_http_requests_total[1m])

# 99 퍼센타일 응답 시간
histogram_quantile(0.99, rate(nestjs_http_request_duration_seconds_bucket[5m]))
```

### 로깅 (Winston + Loki 연동)

모든 로그는 **Winston**을 통해 **JSON 구조화 포맷**으로 stdout에 출력된다.
Alloy가 Pod stdout을 수집해 Loki로 전달한다.

로그 레벨은 `.env`의 `LOG_LEVEL`로 조정한다 (기본값: `info`).

**요청 로그 (LoggingMiddleware):**
```json
{
  "level": "info",
  "message": { "method": "GET", "path": "/slow", "route": "/slow", "statusCode": 200, "durationMs": 512 },
  "context": "HTTP",
  "timestamp": "2026-01-01T00:00:00.000+0900"
}
```

**에러 로그 (HttpExceptionFilter):**
```json
{
  "level": "error",
  "message": { "message": "Intentional error for observability testing", "path": "/error", "statusCode": 500 },
  "stack": "Error: Intentional error...",
  "context": "HttpExceptionFilter",
  "timestamp": "2026-01-01T00:00:00.000+0900"
}
```

**LogQL 예시:**

```logql
# monitoring 네임스페이스 전체 로그
{namespace="monitoring"}

# NestJS 앱 에러 로그만 필터
{namespace="default", app="nestjs-sample"} |= "ERROR"

# 응답 시간 500ms 이상 요청 추출
{namespace="default"} | json | durationMs > 500
```

### OpenTelemetry (OTLP)

`src/telemetry/instrumentation.ts` 에서 SDK를 초기화한다.

- **서비스명:** `nestjs-sample`
- **트레이스 전송:** `http://alloy.monitoring.svc.cluster.local:4318/v1/traces`
- **메트릭 전송:** `http://alloy.monitoring.svc.cluster.local:4318/v1/metrics`
- **자동 계측:** HTTP, Express 요청/응답 자동 스팬 생성

> 현재 Alloy는 수신한 OTLP 데이터를 디버그 로그로 출력한다.
> Tempo 추가 후 `otelcol.exporter.otlphttp` 로 교체하면 트레이스 저장이 가능하다.

---

## Kubernetes 설치 가이드

### 사전 조건

| 도구 | 버전 |
|---|---|
| minikube | v1.32+ |
| kubectl | v1.28+ |
| helm | v3.14+ |

### 설치 순서

```mermaid
flowchart TD
    A([Minikube 시작]) --> B[namespace: monitoring 생성]
    B --> C[Helm repo 추가 · 업데이트]
    C --> D[Prometheus 설치\nkube-prometheus-stack]
    D --> E[Loki 설치\nSingleBinary + MinIO]
    E --> F[Alloy 설치\n로그 수집 + OTLP 수신]
    F --> G[NestJS 앱 빌드 · 배포\nDocker + kubectl apply]
    G --> H([검증])

    style A fill:#4a9eff,color:#fff
    style G fill:#22c55e,color:#fff
```

### 1단계 — Minikube 시작

```bash
minikube start --memory=8192 --cpus=4

kubectl create namespace monitoring
```

### 2단계 — Helm 레포지토리 추가

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo add grafana https://grafana.github.io/helm-charts
helm repo update
```

### 3단계 — Prometheus 설치

```bash
helm install prometheus prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --values k8s/prometheus-values.yaml \
  --wait
```

설치 확인:
```bash
kubectl get pods -n monitoring -l "release=prometheus"
```

### 4단계 — Loki 설치

```bash
helm install loki grafana/loki \
  --namespace monitoring \
  --values k8s/loki-values.yaml \
  --wait --timeout 5m
```

설치 확인:
```bash
# loki-0 (SingleBinary) 와 loki-minio-* 두 파드가 Running 이어야 함
kubectl get pods -n monitoring -l "app.kubernetes.io/name=loki"

# 헬스체크
kubectl exec -n monitoring loki-0 -- wget -qO- http://localhost:3100/ready
# 출력: ready
```

### 5단계 — Alloy 설치

```bash
helm install alloy grafana/alloy \
  --namespace monitoring \
  --values k8s/alloy-values.yaml \
  --wait
```

### 6단계 — 전체 상태 확인

```bash
kubectl get pods -n monitoring
kubectl get svc  -n monitoring
```

### Alloy River 파이프라인 구조

```mermaid
flowchart LR
    subgraph LOG["로그 수집 파이프라인"]
        direction LR
        D1["discovery.kubernetes\n'pods'"]
        D2["discovery.relabel\n'pod_logs'\n라벨 변환 · 필터"]
        D3["loki.source.kubernetes\n'pod_logs'"]
        D4["loki.write\n'default'"]
        D1 --> D2 --> D3 --> D4
    end

    subgraph OTLP["OTLP 수신 파이프라인"]
        direction LR
        O1["otelcol.receiver.otlp\n:4317 gRPC · :4318 HTTP"]
        O2["otelcol.exporter.debug\n'default'"]
        O1 --> O2
    end

    K8S[("K8s API\npods/log")] -->|"log stream"| D1
    D4 -->|"push"| LOKI[("Loki\n:3100")]

    APP["NestJS App"] -->|"OTLP HTTP"| O1
    O2 -->|"stdout"| LOG_OUT["Alloy 로그\n(kubectl logs)"]
```

---

## 앱 배포 (Minikube)

Prometheus 스크레이프, Loki 로그 수집, Alloy OTLP 전송이 모두 동작하려면
NestJS 앱이 Minikube 클러스터 안에서 실행되어야 한다.

### 1단계 — 환경 변수 확인

`.env` 파일로 포트와 로그 레벨을 설정한다.

```bash
# .env (기본값)
PORT=8080
LOG_LEVEL=info
```

### 2단계 — Minikube Docker 환경으로 이미지 빌드

```bash
# Minikube 내부 Docker 데몬을 사용 (이미지를 직접 클러스터에 적재)
eval $(minikube docker-env)

docker build -t nestjs-app:latest .
```

### 3단계 — k8s 매니페스트 배포

`k8s/app.yaml` 에 Deployment · Service · ServiceMonitor 가 포함되어 있다.

```bash
kubectl apply -f k8s/app.yaml

# Running 상태 확인
kubectl get pods -l app=nestjs-app -w
```

### 4단계 — 동작 확인

```bash
# 앱 로그 확인 (Winston JSON 포맷)
kubectl logs -l app=nestjs-app -f

# /metrics 엔드포인트 확인
kubectl port-forward svc/nestjs-app 8080:8080
curl http://localhost:8080/metrics | grep nestjs_http_requests
```

### 5단계 — Prometheus 스크레이프 확인

`ServiceMonitor`가 적용되면 Prometheus가 15초마다 `/metrics`를 자동으로 수집한다.

```bash
kubectl port-forward -n monitoring svc/prometheus-operated 9090:9090
# http://localhost:9090/targets → nestjs-app 항목이 UP 상태인지 확인
```

### 재배포 (코드 변경 시)

```bash
eval $(minikube docker-env)
docker build -t nestjs-app:latest .
kubectl rollout restart deployment/nestjs-app
```

---

## k6 부하 테스트

앱이 실행 중인 상태에서 k6로 부하를 가해 메트릭과 로그가 Grafana에 쌓이는 것을 확인할 수 있다.

### 설치

```bash
brew install k6
```

### 테스트 파일

| 파일 | 유형 | 기본 시간 | 기본 최대 VU |
|---|---|---|---|
| `k6/test-1min.js` | Smoke Test | ~1분 | 5 |
| `k6/test-3min.js` | Load Test | ~3분 | 20 |
| `k6/test-5min.js` | Stress Test | ~5분 | 50 |

> 단계 구조: **워밍업** → **피크 유지** → **쿨다운**

### 엔드포인트 믹스

| 엔드포인트 | 비율 | 설명 |
|---|---|---|
| `GET /hello` | 60% | 기본 응답 |
| `GET /slow` | 30% | 300~800ms 지연 |
| `GET /error` | 10% | 의도적 500 에러 |

### 실행

`k6/config.env` 에서 대상 URL과 부하를 설정한 뒤 npm 스크립트로 실행한다.

```bash
# k6/config.env 편집
BASE_URL=http://localhost:8080   # port-forward 사용 시
MAX_VUS=10
RAMP_DURATION=15s
SUSTAIN_DURATION=30s
```

```bash
# npm 스크립트로 실행
npm run k6:1min
npm run k6:3min
npm run k6:5min
```

```bash
# --env 플래그로 직접 실행
k6 run --env BASE_URL=http://localhost:8080 --env MAX_VUS=20 ./k6/test-3min.js

# Minikube 서비스 URL 자동 조회
k6 run --env BASE_URL=$(minikube service nestjs-app --url) ./k6/test-3min.js
```

---

## Grafana 사용법

### 접속

```bash
# Minikube NodePort로 브라우저 자동 열기 (권장)
minikube service prometheus-grafana -n monitoring

# 또는 포트포워드
kubectl port-forward svc/prometheus-grafana 3000:80 -n monitoring
# http://localhost:3000
```

- **ID:** `admin`
- **PW:** `admin`

### 메트릭 조회 (Prometheus)

1. 왼쪽 메뉴 **Explore** → 데이터소스 `Prometheus` 선택
2. Metric 검색창에 `nestjs_http_requests_total` 입력
3. **Run query**

### 로그 조회 (Loki)

1. **Explore** → 데이터소스 `Loki` 선택
2. Label filter: `namespace = monitoring`
3. 또는 직접 LogQL 입력: `{namespace="monitoring"} |= "ERROR"`

---

## 트러블슈팅

```mermaid
flowchart TD
    START([kubectl get pods -n monitoring]) --> Q1{파드 STATUS?}

    Q1 -->|ImagePullBackOff| A1["kubectl describe pod\nEvents 섹션 확인"]
    A1 --> A1S["minikube stop && minikube start\n네트워크 재시도"]

    Q1 -->|Pending| P1{원인?}
    P1 -->|"Insufficient memory"| P2["chunksCache / resultsCache\n비활성화 후 재설치"]
    P1 -->|"node taint"| P3["tolerations: Exists 추가\n후 재설치"]

    Q1 -->|CrashLoopBackOff| B1["kubectl logs &lt;pod&gt; --previous\n에러 메시지 확인"]
    B1 --> B1Q{에러 메시지?}
    B1Q -->|"read-only file system"| B2["persistence.enabled: true\nPVC 마운트 설정"]
    B1Q -->|"i/o timeout DNS"| B3["chunksCache / resultsCache\n비활성화 확인"]
    B1Q -->|"stability level experimental"| B4["stabilityLevel: experimental\nalloy-values.yaml 추가"]

    Q1 -->|Running| C1{기능 동작 안 됨?}
    C1 -->|"Loki 로그 없음"| D1["MinIO 버킷 수동 생성\nmc mb local/chunks ..."]
    C1 -->|"Prometheus 수집 안 됨"| D2["localhost:9090/targets\n타겟 상태 확인"]
    C1 -->|"Alloy 로그 수집 안 됨"| D3["RBAC 권한 확인\nkubectl auth can-i"]
    C1 -->|"OTLP 수신 안 됨"| D4["kubectl logs alloy -f\nResourceSpans 검색"]

    style START fill:#4a9eff,color:#fff
    style B2 fill:#f97316,color:#fff
    style B4 fill:#f97316,color:#fff
    style P2 fill:#f97316,color:#fff
```

---

### [실제 사례 1] Prometheus node-exporter DaemonSet — `--wait` timeout

#### 증상

```
Error: INSTALLATION FAILED: resource DaemonSet/monitoring/prometheus-prometheus-node-exporter
not ready. status: InProgress, message: Available: 0/1
context deadline exceeded
```

#### 원인

Minikube 노드에 `node-role.kubernetes.io/control-plane:NoSchedule` 테인트가 존재할 경우,
`tolerations` 설정이 없는 DaemonSet은 해당 노드에 스케줄되지 않는다.
`--wait` 플래그는 DaemonSet이 `Available` 상태가 될 때까지 대기하다가 타임아웃으로 실패한다.

#### 진단

```bash
# 노드 테인트 확인
kubectl describe node minikube | grep -A3 "Taints:"

# node-exporter 파드 스케줄 실패 이유 확인
kubectl describe pod -n monitoring \
  -l "app.kubernetes.io/name=prometheus-node-exporter" \
  | grep -A5 "Events:"
```

#### 해결 — `prometheus-values.yaml`에 tolerations 추가

```yaml
prometheus-node-exporter:
  tolerations:
    - operator: Exists   # 모든 테인트 허용
```

```bash
helm uninstall prometheus -n monitoring

helm install prometheus prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --values k8s/prometheus-values.yaml \
  --wait
```

---

### [실제 사례 2] Loki CrashLoopBackOff — `read-only file system`

#### 증상

```
NAME      READY   STATUS             RESTARTS
loki-0    1/2     CrashLoopBackOff   7
```

```bash
kubectl logs loki-0 -n monitoring -c loki
```

```
level=error msg="error running loki"
err="mkdir /var/loki: read-only file system
error initialising module: store"
```

#### 원인

`singleBinary.persistence.enabled: false` 로 설정하면 `/var/loki` 경로에 마운트되는 볼륨이 없다.
Loki는 시작 시 `/var/loki` 디렉토리 생성을 시도하지만, Loki 컨테이너 이미지의 루트 파일시스템은
읽기 전용이므로 디렉토리 생성에 실패하고 프로세스가 종료된다.

```
persistence.enabled: false
    └─ /var/loki 볼륨 없음
          └─ 컨테이너 루트 파일시스템에 mkdir 시도
                └─ read-only file system → exit code 1 → CrashLoop
```

#### 진단

```bash
# 크래시 직전 로그 확인
kubectl logs loki-0 -n monitoring -c loki --previous | grep -E "error|mkdir"

# 마운트된 볼륨 목록 확인 (/var/loki 가 없으면 문제)
kubectl exec -n monitoring loki-0 -- df -h | grep loki
```

#### 해결 — `loki-values.yaml`에 persistence 활성화

```yaml
singleBinary:
  persistence:
    enabled: true          # false → true 로 변경
    storageClass: standard # Minikube 기본 StorageClass (hostPath)
    size: 5Gi
```

```bash
helm uninstall loki -n monitoring
kubectl delete pvc -n monitoring -l app.kubernetes.io/instance=loki

helm install loki grafana/loki \
  --namespace monitoring \
  --values k8s/loki-values.yaml \
  --wait --timeout 5m
```

---

### [실제 사례 3] loki-chunks-cache-0 — `Insufficient memory` (Pending)

#### 증상

```
NAME                    READY   STATUS    RESTARTS
loki-chunks-cache-0     0/2     Pending   0
```

```bash
kubectl describe pod loki-chunks-cache-0 -n monitoring | grep -A3 "Events:"
```

```
Warning  FailedScheduling  0/1 nodes are available:
1 Insufficient memory.
no new claims to deallocate
```

#### 원인

`grafana/loki` 차트는 기본값으로 `chunksCache`(memcached)를 활성화한다.
이 memcached 인스턴스는 `-m 8192` (8GB) 옵션으로 실행되고,
컨테이너 리소스 요청값이 **9830Mi(약 9.8GB)** 로 설정된다.
6GB 메모리의 Minikube에서는 스케줄 자체가 불가능하다.

```
chunksCache 기본값
  └─ memcached -m 8192
        └─ requests.memory: 9830Mi
              └─ 6GB Minikube → Insufficient memory → Pending
```

같은 이유로 Loki 로그에도 DNS timeout 에러가 반복된다.
chunks-cache 파드가 뜨지 않으니 SRV 레코드 조회 자체가 실패하는 것이다.

```
level=error caller=memcached_client.go:188
msg="error setting memcache servers to host"
err="lookup _memcached-client._tcp.loki-chunks-cache.monitoring.svc.cluster.local
on 10.96.0.10:53: dial udp 10.96.0.10:53: i/o timeout"
```

#### 해결 — `loki-values.yaml`에 캐시 비활성화

```yaml
chunksCache:
  enabled: false   # 기본값 true → 9.8GB memcached 파드 생성됨

resultsCache:
  enabled: false   # 동일 이유로 비활성화
```

변경 후 재설치하면 `loki-chunks-cache-*`, `loki-results-cache-*` StatefulSet이 생성되지 않는다.

```bash
helm uninstall loki -n monitoring
kubectl delete pvc -n monitoring -l app.kubernetes.io/instance=loki

helm install loki grafana/loki \
  --namespace monitoring \
  --values k8s/loki-values.yaml \
  --wait --timeout 5m

# 정상 상태: chunks-cache 파드 없이 loki-0 와 loki-minio-* 만 Running
kubectl get pods -n monitoring | grep loki
```

---

### [실제 사례 4] Alloy CrashLoopBackOff — `stability level "experimental"`

#### 증상

```
NAME                     READY   STATUS             RESTARTS
alloy-6b7f79fc5f-mnzp6   1/2     CrashLoopBackOff   4
```

```bash
kubectl logs alloy-6b7f79fc5f-mnzp6 -n monitoring
```

```
Error: /etc/alloy/config.alloy:81:1:
component "otelcol.exporter.debug" is at stability level "experimental",
which is below the minimum allowed stability level "generally-available".
Use --stability.level command-line flag to enable "experimental" features

Error: /etc/alloy/config.alloy:74:16:
component "otelcol.exporter.debug.default.input" does not exist or is out of scope

Error: could not perform the initial load successfully
```

#### 원인

Alloy는 컴포넌트마다 안정성 등급(stability level)을 부여한다.
Alloy v1.7.0 이후 기본값이 `--stability.level=generally-available` 로 변경되어,
`experimental` 등급 컴포넌트는 명시적으로 활성화하지 않으면 로드 자체가 거부된다.

`otelcol.exporter.debug` 는 `experimental` 등급이다.
이 컴포넌트가 로드 실패하면, 그것을 output으로 참조하는
`otelcol.receiver.otlp` 의 `traces`, `metrics` 도 연쇄적으로 실패한다.

```
otelcol.exporter.debug → experimental 등급 → 로드 거부
    └─ otelcol.receiver.otlp
          └─ output.traces  = [otelcol.exporter.debug.default.input]  ← 참조 실패
          └─ output.metrics = [otelcol.exporter.debug.default.input]  ← 참조 실패
                └─ could not perform the initial load → exit code 1 → CrashLoop
```

#### 진단

```bash
# Alloy 로그에서 stability 에러 확인
kubectl logs -n monitoring -l app.kubernetes.io/name=alloy | grep "stability"

# Alloy 실행 인자에서 현재 stability 레벨 확인
kubectl describe pod -n monitoring -l app.kubernetes.io/name=alloy \
  | grep -A5 "Args:"
# --stability.level=generally-available 로 실행 중이면 문제
```

#### 해결 — `alloy-values.yaml`에 stabilityLevel 설정

```yaml
alloy:
  stabilityLevel: experimental  # 기본값 generally-available → 변경
```

```bash
helm upgrade alloy grafana/alloy \
  --namespace monitoring \
  --values k8s/alloy-values.yaml

kubectl rollout status deployment/alloy -n monitoring
```

정상 기동 확인:
```bash
kubectl logs -n monitoring -l app.kubernetes.io/name=alloy --tail=5
# ts=... level=info msg="Alloy started"
# ts=... level=info msg="config.alloy loaded successfully"
```

---

### Loki 로그 수집 안 됨 — MinIO 버킷 미생성

MinIO 버킷이 자동 생성되지 않은 경우 Loki가 S3에 쓰기를 시도하다 실패한다.

```bash
# MinIO 버킷 목록 확인
kubectl exec -n monitoring loki-minio-0 -- mc ls local/

# 버킷 수동 생성
kubectl exec -n monitoring loki-minio-0 -- \
  mc mb local/chunks local/ruler local/admin
```

---

### Prometheus 스크레이프 실패

```bash
# Prometheus UI에서 타겟 상태 확인
kubectl port-forward svc/prometheus-kube-prometheus-prometheus 9090:9090 -n monitoring
# 브라우저: http://localhost:9090/targets
# 빨간색 타겟 클릭 → Error 메시지 확인
```

---

### Alloy 로그 수집 안 됨 — RBAC

```bash
# ServiceAccount 에 pods/log 권한이 있는지 확인 (yes 가 나와야 함)
kubectl auth can-i get pods/log -n monitoring \
  --as=system:serviceaccount:monitoring:alloy

# Alloy UI에서 파이프라인 컴포넌트 상태 확인
kubectl port-forward svc/alloy 12345:12345 -n monitoring
# 브라우저: http://localhost:12345
```

---

### OTLP 수신 확인

```bash
# Alloy 로그에서 수신된 트레이스 확인 (otelcol.exporter.debug 출력)
kubectl logs -n monitoring -l "app.kubernetes.io/name=alloy" -f \
  | grep "ResourceSpans"
```
