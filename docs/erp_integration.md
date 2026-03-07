# ERP Integration

## 목적

ECOUNT ERP 연동을 서버 내부 래퍼로 통합한다. 음성 AI, 관리자 콘솔, 주문 초안 저장 로직은 이 래퍼만 호출한다.

## 환경변수

- `ERP_BASE_URL`
- `ERP_COM_CODE`
- `ERP_USER_ID`
- `ERP_API_CERT_KEY`
- `ERP_LAN_TYPE`
- `ERP_SESSION_TTL_SECONDS`
- `ERP_EMP_CD`
- `ERP_SITE`
- `ERP_IO_TYPE`
- `ERP_PJT_CD`

기본 운영값:

- 용산 창고 `WH_CD=10`
- 김포 창고 `WH_CD=30`
- 담당자 코드 `EMP_CD=01`

## 구현 파일

- `src/integrations/ecount/client.ts`
- `src/integrations/ecount/types.ts`
- `src/plugins/ecount.ts`
- `src/modules/erp/routes.ts`

## 제공 기능

- Zone 조회
- 로그인 세션 캐시
- 품목 조회
- 창고별 재고 조회
- 판매입력 저장
- 견적서입력 저장
- 주문 초안에서 ERP 전표 직접 생성

## API 엔드포인트

- `GET /api/v1/erp/health`
- `GET /api/v1/erp/products`
- `GET /api/v1/erp/inventory`
- `POST /api/v1/erp/sales`
- `POST /api/v1/erp/quotations`
- `POST /api/v1/erp/sales/from-draft/:id`
- `POST /api/v1/erp/quotations/from-draft/:id`

## 주문 초안 반영 규칙

- `order_draft.customer_id`로 거래처를 찾고 `master_customer.customer_code`를 ERP `CUST`로 전달한다.
- `order_draft.warehouse_code`를 ERP `WH_CD`로 전달한다.
- `order_draft_line.product_code`를 ERP `PROD_CD`로 전달한다.
- `remark_text`가 없으면 `shipping_method` 기반 배송 비고를 생성한다.
- 선결제 대상이면 `P_REMARKS1='선결제 안내 완료'`를 넣는다.
- 전표 저장 성공 시 `order_draft.status='erp_saved'`, `erp_slip_no`, `erp_saved_at`를 갱신한다.

## 배송 비고 규칙

- `배송`
- `방문수령`
- `택배-로젠`
- `택배-경동택배`
- `택배-경동화물`
- `퀵`

## 현재 제한

- 실제 ECOUNT 운영 계정으로 API 호출 검증은 아직 하지 않았다.
- 인증값은 `.env` 또는 Render 시크릿로만 주입해야 한다.
- 세션 만료 시 1회 재로그인 후 재시도한다.
