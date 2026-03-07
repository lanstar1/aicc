# Admin Console API

## 목적

관리자 화면에서 실시간 통화 상태를 조회하고 즉시 개입할 수 있도록 하는 HTTP API다.

## 인증

- `ADMIN_API_TOKEN`이 비어 있으면 토큰 없이 접근 가능
- 값이 있으면 아래 둘 중 하나 필요
  - 헤더 `x-admin-token`
  - 헤더 `Authorization: Bearer <token>`

## 엔드포인트

- `GET /api/v1/admin/summary`
- `GET /api/v1/admin/calls`
- `GET /api/v1/admin/calls/:id`
- `POST /api/v1/admin/calls/:id/summarize`
- `POST /api/v1/admin/calls/:id/notes`
- `POST /api/v1/admin/calls/:id/takeover`
- `POST /api/v1/admin/calls/:id/ai-instructions`
- `POST /api/v1/admin/calls/:id/drafts/:draftId/notify`
- `POST /api/v1/admin/calls/:id/notifications/:notificationId/send`

## 기능

### 1. 요약

- 상태별 통화 건수
- 메모리 기준 실시간 runtime 개수

### 2. 통화 목록

- 기본값은 `ringing/live/handoff`만 조회
- 실시간 runtime 스냅샷과 bridge 활성 여부 포함

### 3. 통화 상세

- 세션 기본 정보
- 실시간 runtime
- 이벤트 로그
- 연결된 주문/견적 초안
- 발송 이력

### 4. 내부 메모

- `call_event`에 `human_note` 저장
- 활성 세션이면 실시간 허브로 즉시 브로드캐스트

### 5. Takeover

- 활성 브리지가 있으면 즉시 AI 응답을 끊고 handoff 상태로 전환
- 비활성 세션이면 DB 상태만 갱신

### 6. AI 지시

- 활성 브리지가 있으면 OpenAI Realtime에 즉시 지시문 주입
- 비활성 세션이면 대기 메모로 저장

### 7. 후속안내 발송

- 선택한 주문/견적 초안 기준 요약 발송
- 채널은 `sms`, `alimtalk`, `email` 중 선택
- 실제 수신자는 서버가 `휴대폰 -> 전화 -> 발신번호` 순으로 자동 결정

### 8. 재발송

- 기존 `notification_delivery` 건을 다시 발송
- 발송 결과는 통화 상세와 이벤트에 다시 반영

## 제한

- 사람 상담원 음성 브리지 자체는 아직 없다.
- takeover는 현재 AI 중지 및 handoff 상태 반영까지 구현되어 있다.
