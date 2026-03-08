# API 서버 구조

## 스택

- Runtime: Node.js + TypeScript
- Framework: Fastify
- DB: PostgreSQL
- 배포 기준: Render Web Service + Render Postgres

## 디렉터리

- `src/config`: 환경변수 로딩
- `src/lib`: 공통 유틸
- `src/plugins`: Fastify 플러그인
- `src/modules`: 도메인별 라우트
- `sql`: DB 스키마
- `docs`: 설계 문서

## 현재 엔드포인트

### 헬스체크

- `GET /health`
- `GET /ready`
- `GET /health/details`

### 메타

- `GET /api/v1/meta/sources`
- `GET /api/v1/meta/go-live`

### 거래처

- `GET /api/v1/customers/search?q=...`
- `GET /api/v1/customers/search?phone=...`

### 품목

- `GET /api/v1/products/search?q=...`
- 옵션:
  - `brand`
  - `customerType=existing|new`
  - `preferLanstar=true|false`

### 통화

- `POST /api/v1/calls/sessions`
- `GET /api/v1/calls/sessions/:id`
- `POST /api/v1/calls/sessions/:id/events`
- `POST /api/v1/calls/sessions/:id/complete`

### 오케스트레이터

- `POST /api/v1/orchestrator/turns`
- `POST /api/v1/orchestrator/order-preview`

### 실시간 수집

- `POST /api/v1/realtime/bootstrap`
- `GET /api/v1/realtime/sessions/:id/runtime`
- `WS /api/v1/realtime/ws/calls/:id`
- `WS /api/v1/realtime/ws/monitor`

### Twilio / OpenAI

- `POST /api/v1/twilio/voice/inbound`
- `POST /api/v1/twilio/voice/status`
- `WS /api/v1/twilio/media-stream`

### 관리자 콘솔

- `GET /api/v1/admin/summary`
- `GET /api/v1/admin/calls`
- `GET /api/v1/admin/calls/:id`
- `POST /api/v1/admin/calls/:id/summarize`
- `POST /api/v1/admin/calls/:id/notes`
- `POST /api/v1/admin/calls/:id/takeover`
- `POST /api/v1/admin/calls/:id/ai-instructions`

### 기술문의

- `GET /api/v1/tech/search`
- `POST /api/v1/tech/answer-preview`

### 워크플로

- `POST /api/v1/workflows/order-auto`

### 알림

- `GET /api/v1/notifications`
- `POST /api/v1/notifications`
- `POST /api/v1/notifications/:id/send`
- `POST /api/v1/notifications/order-drafts/:id/summary`

### 운영 UI

- `GET /admin-console`

### 주문/견적 초안

- `GET /api/v1/orders/drafts`
- `GET /api/v1/orders/drafts/:id`
- `POST /api/v1/orders/drafts`

## 환경변수

필수:

- `DATABASE_URL`

기본 제공:

- `HOST`
- `PORT`
- `LOG_LEVEL`
- `DATABASE_SSL`
- `ERP_BASE_URL`
- `ERP_COM_CODE`
- `ERP_USER_ID`
- `ERP_API_CERT_KEY`
- `OPENAI_API_KEY`
- `OPENAI_REALTIME_MODEL`
- `SMS_PROVIDER`

샘플은 `.env.example` 참고.

## 다음 구현 우선순위

1. Render 실배포
2. Twilio/OpenAI/ECOUNT 실계정 종단 테스트
3. 실제 ERP SMS webhook 연결
4. 관리자 UI를 Next.js 기반으로 전환
