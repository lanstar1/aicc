# Operations

## 헬스체크

- `GET /health`
  - 기본 생존 확인
- `GET /ready`
  - DB 연결 가능 여부 확인
- `GET /health/details`
  - DB 지연시간
  - 실시간 런타임 수
  - 활성 브리지 수
  - ERP/OpenAI/Twilio 기본 설정 여부
  - 알림 mock 모드 여부

## 스모크 테스트

스크립트:

- [smoke-test.ts](/Users/lanstar/Documents/New%20project/src/scripts/smoke-test.ts)

## 상담 시나리오 시뮬레이션

스크립트:

- [simulate-call.ts](/Users/lanstar/Documents/New%20project/src/scripts/simulate-call.ts)

문서:

- [scenario_runner.md](/Users/lanstar/Documents/New%20project/docs/scenario_runner.md)

실행:

```bash
npm run simulate:call -- --list
npm run simulate:call -- --scenario quote-lanstar
```

기본값:

- `persistDraft=false`
- `saveToErp=false`
- 운영 연동 없이 오케스트레이터와 워크플로 응답만 검증

## 스키마 적용

스크립트:

- [apply-schema.ts](/Users/lanstar/Documents/New%20project/src/scripts/apply-schema.ts)

실행:

```bash
npm run db:apply-schema
```

동작:

- `aicc.schema_migration` 테이블 생성
- `001_aicc_schema.sql` 최초 1회 적용
- 이미 적용된 경우 skip

실행 예시:

```bash
npm run smoke:test -- --base-url https://your-service.onrender.com
```

관리자 토큰과 실시간 토큰을 함께 검증하려면:

```bash
npm run smoke:test -- \
  --base-url https://your-service.onrender.com \
  --admin-token "$ADMIN_API_TOKEN" \
  --realtime-token "$REALTIME_WS_TOKEN"
```

## 3개월 보관 정책 정리

스크립트:

- [purge-retention.ts](/Users/lanstar/Documents/New%20project/src/scripts/purge-retention.ts)

동작:

- `retention_until < now()` 인 통화 세션의 `transcript_full` 제거
- `transcript_summary`를 purge 표시 객체로 교체
- 연결된 `call_event` 삭제
- 연결된 `notification_delivery.body`와 `subject` 마스킹

드라이런:

```bash
npm run purge:retention -- --dry-run
```

실행:

```bash
npm run purge:retention
```
