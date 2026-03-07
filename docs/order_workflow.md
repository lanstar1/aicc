# Order Workflow

## 목적

주문/견적 자동화의 핵심 경로를 한 API로 묶는다.

- 품목/가격/재고 프리뷰
- 주문 초안 저장
- 조건 통과 시 ERP 전표 자동 저장

## 구현 파일

- `src/modules/workflows/routes.ts`
- `src/modules/workflows/order-auto-service.ts`
- `src/modules/orders/service.ts`
- `src/modules/erp/draft-service.ts`

## 엔드포인트

- `POST /api/v1/workflows/order-auto`

## 입력

- `callSessionId`
- `customerId`
- `customerType`
- `draftKind`
- `shippingMethod`
- `warehouseCode`
- `prepaymentNoticeSent`
- `persistDraft`
- `autoSaveToErp`
- `lines[]`

## 처리 순서

1. 오케스트레이터 `order-preview` 규칙으로 가격/재고/사람검토 필요 여부를 계산
2. `persistDraft=true` 이면 `order_draft`, `order_draft_line` 저장
3. `persistDraft=true` 이고 `autoSaveToErp=true` 이며 사람검토 불필요하면 ERP 전표 저장
4. 자동 후속안내가 켜져 있으면 주문/견적 요약을 문자 또는 알림톡으로 발송
5. 결과를 `preview + draft + erp + notification` 형태로 반환

## 음성 연동

1. 실시간 통화에서 오케스트레이터가 `confirm_order`를 만든다.
2. 고객이 확인 응답을 하면 상태가 `save_order` 또는 `save_quote`로 전환된다.
3. Twilio/OpenAI 브리지가 `runOrderAutoWorkflow`를 호출한다.
4. 저장 결과에 따라 고객에게 접수 완료 또는 사람 확인 안내 멘트를 다시 읽어준다.

## 현재 자동저장 차단 조건

- 재고 부족 또는 재고 확인 필요
- 가격 누락
- 공급가 합계 1,000만원 이상
- 거래처 코드 없이 판매전표 생성 시도

## 결과 상태

- `erp_saved`
- `human_review_required`
- `draft_saved`
- `preview_only`
