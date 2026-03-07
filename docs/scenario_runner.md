# Scenario Runner

`simulate:call` 스크립트는 실제 Twilio/OpenAI/ECOUNT 운영 연결 없이도 오케스트레이터, 재고/견적 응답, 주문 확정 워크플로를 로컬에서 반복 검증하기 위한 도구입니다.

기본 동작은 `미리보기 전용`입니다. 즉, 주문/견적 확인 턴이 와도 기본값으로는 `order_draft`를 저장하지 않고, ERP 저장도 하지 않습니다.

## 사전 조건

- PostgreSQL 스키마 적용 완료
- 기준 데이터 적재 완료
- `DATABASE_URL` 설정

권장 순서:

```bash
npm run db:apply-schema
npm run import:data
```

## 빠른 실행

내장 시나리오 목록:

```bash
npm run simulate:call -- --list
```

기본 시나리오 실행:

```bash
npm run simulate:call
```

특정 시나리오 실행:

```bash
npm run simulate:call -- --scenario quote-lanstar
```

JSON 출력:

```bash
npm run simulate:call -- --scenario tech-hdmi-splitter --json
```

초안 저장까지 포함:

```bash
npm run simulate:call -- --scenario order-confirm-lanstar --persist-draft
```

초안 저장 후 ERP 저장까지 포함:

```bash
npm run simulate:call -- --scenario order-confirm-lanstar --persist-draft --save-to-erp
```

## 내장 시나리오

- `order-confirm-lanstar`
  - 품목코드가 이미 확정된 상태에서 주문 확인 응답 후 저장 흐름 검증
- `inventory-lanstar`
  - 품목코드가 확정된 상태에서 재고 응답 검증
- `quote-lanstar`
  - 랜스타 견적 응답 검증
- `tech-hdmi-splitter`
  - 기술문의 KB 검색과 전화용 요약 응답 검증

## 사용자 정의 시나리오

`--scenario-file`로 JSON 파일을 넘기면 됩니다.

예시:

```json
{
  "name": "custom-order",
  "description": "기존 거래처 주문 확인 테스트",
  "callerNumber": "027173386",
  "initialState": {
    "intentType": "order",
    "customerType": "existing",
    "productCode": "LS-6UTPD-5MR",
    "qty": 10,
    "shippingMethod": "delivery",
    "pendingConfirmation": "order"
  },
  "turns": [
    {
      "utterance": "네 맞습니다"
    }
  ]
}
```

## 지원 필드

시나리오 루트:

- `name`
- `description`
- `callerNumber`
- `initialState`
- `turns`

턴 필드:

- `utterance`
- `hints.customerName`
- `hints.brand`
- `hints.productQuery`
- `hints.qty`
- `hints.shippingMethod`
- `statePatch`

`statePatch`에는 아래 상태값을 강제로 주입할 수 있습니다.

- `intentType`
- `customerId`
- `customerConfirmed`
- `orderConfirmed`
- `pendingConfirmation`
- `customerType`
- `brand`
- `productQuery`
- `productId`
- `productCode`
- `productName`
- `qty`
- `shippingMethod`
- `warehouseCode`
- `assistantRepeatCount`
- `repeatedQuestionCount`
- `elapsedSeconds`

## 출력 내용

기본 텍스트 출력에는 아래가 포함됩니다.

- 턴별 고객 발화
- 의도 분류, 다음 액션, confidence
- 상위 거래처/품목/기술근거
- 실제 응답에 사용될 승인 문구
- 재고/견적 미리보기
- 워크플로 상태
- 턴 종료 후 상태값

`--json` 옵션을 쓰면 전체 분석 결과와 상태 변화가 그대로 출력됩니다.

## 운영 주의사항

- 기본값은 `persistDraft=false`, `saveToErp=false`입니다.
- `--save-to-erp`를 켜면 자동으로 초안 저장도 같이 활성화됩니다.
- `persistDraft=true`일 때만 `order_draft`, `notification_delivery` 같은 쓰기 동작이 발생할 수 있습니다.
- ERP 인증정보가 없으면 재고 조회는 `check_needed`로 떨어질 수 있습니다.
