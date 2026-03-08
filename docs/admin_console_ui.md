# Admin Console UI

## 경로

- `GET /admin-console`

## 파일

- `public/admin-console.html`
- `src/modules/ui/routes.ts`

## 기능

- 운영 준비 상태(go-live) 확인
- 실시간 통화 목록 조회
- 통화 상세 / 전사 / 이벤트 확인
- 주문/견적 초안 확인
- 자동 요약 확인 / 재생성
- 주문/견적 후속안내 발송
- 발송 이력 확인 / 재발송
- 내부 메모 저장
- AI 지시 전달
- takeover 실행
- 실시간 모니터 WebSocket 수신

## 연결 대상 API

- `GET /api/v1/meta/go-live`
- `GET /api/v1/admin/summary`
- `GET /api/v1/admin/calls`
- `GET /api/v1/admin/calls/:id`
- `POST /api/v1/admin/calls/:id/summarize`
- `POST /api/v1/admin/calls/:id/notes`
- `POST /api/v1/admin/calls/:id/takeover`
- `POST /api/v1/admin/calls/:id/ai-instructions`
- `POST /api/v1/admin/calls/:id/drafts/:draftId/notify`
- `POST /api/v1/admin/calls/:id/notifications/:notificationId/send`
- `WS /api/v1/realtime/ws/monitor`

## 사용 방식

- 화면 상단에 `API Base`, `Admin Token`, `Realtime Token` 입력
- `연결` 버튼 클릭
- 연결 직후 상단 `운영 준비 상태` 패널에서 데이터 적재 여부와 Twilio/ERP/OpenAI 준비 상태 확인
- 통화 선택 후 우측 패널에서 메모/AI지시/takeover 실행

## 제한

- 현재는 단일 정적 HTML 페이지다.
- 사람 상담원 음성 직접 연결 UI는 아직 없다.
