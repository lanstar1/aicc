# Notifications

## 목적

상담 중 생성된 주문/견적 요약을 이메일, 문자, 알림톡으로 발송한다.

## 구현 파일

- `src/modules/notifications/service.ts`
- `src/modules/notifications/routes.ts`

## 엔드포인트

- `GET /api/v1/notifications`
- `POST /api/v1/notifications`
- `POST /api/v1/notifications/:id/send`
- `POST /api/v1/notifications/order-drafts/:id/summary`

## 현재 지원 채널

- `email`
- `sms`
- `alimtalk`

## 발송 방식

- `NOTIFICATION_MOCK_MODE=true`
  - 외부 발송 없이 즉시 `sent` 처리
- `email`
  - SMTP 사용
- `sms`
  - ERP SMS webhook 사용
- `alimtalk`
  - webhook 사용

## 환경변수

- `NOTIFICATION_MOCK_MODE`
- `EMAIL_FROM_NAME`
- `EMAIL_FROM_ADDRESS`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`
- `ERP_SMS_WEBHOOK_URL`
- `ERP_SMS_WEBHOOK_TOKEN`
- `ALIMTALK_WEBHOOK_URL`
- `ALIMTALK_WEBHOOK_TOKEN`

## 주문 요약 템플릿

`POST /api/v1/notifications/order-drafts/:id/summary`는 아래 내용을 자동 구성한다.

- 거래처명
- 품목명 / 수량 / 단가
- 배송방법
- 선결제 안내
- 합계 금액

## 자동 발송

- `AUTO_ORDER_NOTIFICATION_ENABLED=true` 이면
- 주문/견적 워크플로 완료 후 `order_draft` 기준 요약을 자동 발송한다
- 수신 우선순위는 `거래처 휴대폰 -> 거래처 전화 -> 발신번호`
- 기본 채널은 `AUTO_ORDER_NOTIFICATION_CHANNEL=sms`
- 알림 실패는 주문/견적 저장 자체를 실패로 만들지 않는다

## 이벤트 기록

발송 큐 적재/성공/실패 시 `call_event`에 `sms` 또는 `email` 이벤트를 남긴다.
