# 데이터 적재 파이프라인

## 목적

- 거래처, 품목, 브랜드 단가표, 기술문의 원본을 PostgreSQL에 정규화 적재
- 재실행 시 최신 원본 기준으로 갱신
- 실제 적재 전 `dry-run`으로 건수 검증 가능

## 실행 명령

```bash
npm run import:data -- --dry-run
```

실제 적재:

```bash
npm run import:data
```

## 환경변수

- `DATABASE_URL`
- `DATABASE_SSL`
- `IMPORT_CUSTOMERS_XLSX`
- `IMPORT_LANSTAR_PRODUCTS_XLSX`
- `IMPORT_DOMESTIC_PRODUCTS_XLSX`
- `IMPORT_MERGED_TECH_JSON`
- `IMPORT_RAW_QNA_JSON`
- `IMPORT_TALK_ORDER_JSON`
- `IMPORT_NEXI_XLSX`
- `IMPORT_IPTIME_URL`
- `IMPORT_NEXT_URL`

기본값은 현재 작업 환경 기준 경로/URL로 설정되어 있고, `.env.example`에서 확인 가능.

## 적재 순서

1. 거래처 `거래처.xlsx`
2. 자사 품목 `품목_LANstar.xlsx`
3. 내수 품목 `품목_내수.xlsx`
4. 브랜드 단가표
   - ipTIME Google Sheet
   - NEXT Google Sheet
   - NEXI Excel
5. 기술문의
   - 통합 `기술문의.json`
   - 원본 `lanstar_qna_result_20260211_1113.json`
   - 원본 `talk_order_data_20260209_1645.json`

## 적재 대상 테이블

- `aicc.master_customer`
- `aicc.master_product`
- `aicc.product_alias`
- `aicc.vendor_sheet_catalog`
- `aicc.tech_model`
- `aicc.tech_qa_chunk`

## 현재 dry-run 기준 건수

- 거래처: `9,244`
- 품목 전체: `23,201`
- 브랜드 시트 카탈로그: `6`
- 기술 모델: `714`
- 기술 청크: `9,554`

## 파서 규칙

### 거래처

- `선입금업체` 값 존재 시 `deposit_required=true`
- 주소에 `서울 용산` 또는 `용산구` 포함 시 용산권 배송 후보
- 전화번호/휴대폰 모두 숫자-only 컬럼 생성

### 품목

- 브랜드 미지정 기본 검색은 LANstar 우선
- LANstar는 `딜러가`, `온라인노출가` 둘 다 저장
- 타사 브랜드 견적가는 `노출지도가/온라인등록가/무료배송 기준` 우선
- alias는 품명, 모델명, 품목코드, 정규화 텍스트로 생성

### 브랜드 시트

- ipTIME: `G열`
- NEXT: `무료배송 기준`
- NEXI: `온라인등록가`

### 기술문의

- 통합본은 모델 단위 `tech_model` + `tech_qa_chunk`로 적재
- 원본 Q&A와 talk 데이터는 추가 근거 청크로 적재
- talk 데이터는 질문/답변 분리 후 해결 여부를 휴리스틱으로 추정

## 주의사항

- `xlsx` 패키지 audit 경고가 1건 있음
- 현재 적재기는 신뢰 가능한 내부 파일을 전제로 작성됨
- 실제 Render DB에 넣기 전 `001_aicc_schema.sql`을 먼저 적용해야 함
