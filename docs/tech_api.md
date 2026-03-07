# Tech API

## 목적

기술문의 DB에서 모델/상품/증상 기준으로 내부 자료를 검색하고, 상담 전 미리 검토할 답변 초안을 만든다.

## 엔드포인트

- `GET /api/v1/tech/search`
- `POST /api/v1/tech/answer-preview`

## `GET /search`

쿼리:

- `q`
- `limit`

응답:

- 모델/상품/질문/답변 snippet
- 내부 검색 점수

## `POST /answer-preview`

입력:

- `query`
- `modelName`
- `productName`
- `limit`

응답:

- `confidence`
- `requiresHumanReview`
- `reasons`
- `modelCandidates`
- `answerCandidates`
- `recommendedAnswer`

## 현재 규칙

- 검색 대상은 `tech_model`, `tech_qa_chunk`
- 내부 자료만 사용
- `불량 / 교환 / 환불 / 회수 / 고장 / AS` 계열 단어가 있으면 사람 검토 플래그를 올린다.
- 추천 답변은 상위 검색 결과를 LLM 없이 압축한 초안이다.

## 제한

- 아직 외부 웹검색은 연결하지 않았다.
- 이미지/매뉴얼 OCR 자료는 별도 적재 전까지 포함되지 않는다.
