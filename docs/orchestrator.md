# Orchestrator

## 목적

음성/채팅 레이어와 ERP/DB 사이에서 상담 상태를 판단하는 서버 계층이다.

- 의도 분류
- 거래처 추정
- 품목 후보 검색
- 기술문의 후보 검색
- 사람 이관 판단
- 주문 초안 직전 프리뷰 생성

## 엔드포인트

- `POST /api/v1/orchestrator/turns`
- `POST /api/v1/orchestrator/order-preview`

## `POST /turns`

한 턴의 고객 발화를 분석한다.

입력:

- `callSessionId`
- `callerNumber`
- `utterance`
- `hints.customerName`
- `hints.brand`
- `hints.productQuery`
- `hints.qty`
- `hints.shippingMethod`
- `state`

출력:

- `intent`
- `confidence`
- `nextAction`
- `handoffRequired`
- `handoffTarget`
- `handoffReasons`
- `assistantPrompt`
- `customerCandidates`
- `productCandidates`
- `techCandidates`
- `statePatch`

## `POST /order-preview`

주문/견적 초안 저장 직전의 계산 결과를 만든다.

입력:

- `callSessionId`
- `customerId`
- `customerType`
- `draftKind`
- `shippingMethod`
- `warehouseCode`
- `prepaymentNoticeSent`
- `lines[]`

출력:

- `customer`
- `customerType`
- `warehouseCode`
- `shippingMethod`
- `prepaymentRequired`
- `requiresHumanReview`
- `humanReviewReasons`
- `totalSupplyAmount`
- `totalVatAmount`
- `totalAmount`
- `lines`
- `draftPayload`

## 현재 규칙

- 고객 발화에서 `주문 / 재고 / 견적 / 기술문의`를 키워드 기반으로 우선 분류한다.
- 거래처는 `callerNumber`와 `customerName` 힌트로 검색한다.
- 브랜드 미지정 시 `LANstar` 우선 검색 점수를 준다.
- 기술문의는 `tech_model`, `tech_qa_chunk`에서 내부 자료 우선 검색한다.
- 사람 이관 조건은 아래를 우선 반영한다.
  - 고객이 사람 연결을 직접 요청
  - 화난 표현 감지
  - 같은 질문 반복
  - 90초 이상 장기화
  - AI 반복 응답 2회 이상
  - 기술자료 근거 부족
- 주문 프리뷰는 ERP 재고조회 결과를 합쳐 `draftPayload`를 반환한다.
- 공급가 합계 `1,000만원 이상`이면 사람 검토 대상으로 표시한다.

## 제한

- 현재 의도 분류와 엔티티 추출은 규칙 기반이다.
- 실시간 음성 스트리밍 연결은 아직 없다.
- ERP 운영 API 실호출 검증은 아직 하지 않았다.
