# Call Summary

## 구현 파일

- [summary-service.ts](/Users/lanstar/Documents/New%20project/src/modules/calls/summary-service.ts)
- [finalize-service.ts](/Users/lanstar/Documents/New%20project/src/modules/calls/finalize-service.ts)

## 동작

- 통화 종료 시 자동으로 전사와 주문초안, 이관 상태를 읽어 구조화 요약을 생성
- `OPENAI_API_KEY`가 있으면 Responses API 기반 JSON 요약 시도
- 실패하거나 키가 없으면 휴리스틱 요약으로 대체
- 결과는 `call_session.transcript_summary.summary`에 저장
- `call_event`에 `summary.generated` 시스템 이벤트 기록

## 요약 항목

- `summaryText`
- `inquiryType`
- `sentiment`
- `resolved`
- `humanFollowupNeeded`
- `handoffTarget`
- `handoffReason`
- `customerName`
- `keyPoints`
- `actionItems`
- `products`
- `riskFlags`

## 관리자 API

- `POST /api/v1/admin/calls/:id/summarize`

## 환경변수

- `OPENAI_SUMMARY_MODEL`
