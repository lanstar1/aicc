# Twilio Console Setup

기준일: 2026-03-08

이 문서는 실제 Twilio 번호 설정과 첫 테스트콜 실행 절차를 정리한다.

## 1. 번호 전략

가장 빠른 파일럿은 `기존 02-717-3386 유지 + Twilio 임시 번호로 내부 테스트`다.

이유:

- 현재 시스템은 이미 Render + Twilio Media Streams 기준으로 준비되어 있다.
- 대표번호를 바로 포팅하면 실패 시 업무 영향이 크다.
- Twilio 문서 기준으로 국제 포팅은 국가별 제약이 있고, 비미국 번호는 지원팀 절차가 필요할 수 있다.
- 한국 로컬 번호는 사업자 기준 규제 문서가 필요하다.

권장 순서:

1. Twilio 임시 번호로 내부 테스트
2. 통화 품질/ERP 반영/관리자 개입 검증
3. 그 다음 `+8227173386` 포팅 가능 여부 확인
4. 포팅이 어렵다면 기존 LG 번호를 착신전환 또는 SIP 연동으로 우회 검토

## 2. 02-717-3386 포팅 확인

Twilio 공식 문서 기준으로 포팅 가능 여부는 Console Portability Checker에서 확인할 수 있다.

입력 번호:

```text
+8227173386
```

참고:

- 비미국 번호는 포팅 API가 아니라 지원 절차가 필요할 수 있다.
- 한국 번호는 규제 문서가 필요할 수 있다.

## 3. Twilio Console 실제 설정

Twilio Console 경로:

```text
Phone Numbers -> Manage -> Active Numbers -> 사용할 번호 클릭
```

### Voice 설정

- `A call comes in`
  - `Webhook`
- URL

```text
https://lanstar-aicc-api.onrender.com/api/v1/twilio/voice/inbound
```

- Method

```text
POST
```

### Status Callback 설정

Console에 `Call status changes`, `Status callback`, `Status Callback URL` 중 하나로 보일 수 있다.

- URL

```text
https://lanstar-aicc-api.onrender.com/api/v1/twilio/voice/status
```

- Method

```text
POST
```

이벤트 선택이 가능하면 아래를 권장한다.

- `initiated`
- `ringing`
- `answered`
- `completed`

### 보안 메모

Twilio 공식 문서 기준으로:

- Voice webhook은 HTTPS를 써야 한다.
- Twilio 서명을 검증해야 한다.
- `<Stream>` URL은 query string을 지원하지 않는다.
- 커스텀 값은 `<Parameter>`로 전달해야 한다.

현재 서버 코드는 이 조건에 맞게 반영되어 있다.

## 4. Render 환경변수 매핑

Render Web Service에 아래 값이 있어야 한다.

- `PUBLIC_BASE_URL`

```text
https://lanstar-aicc-api.onrender.com
```

- `TWILIO_AUTH_TOKEN`
  - Twilio Console의 실제 Auth Token
- `TWILIO_STREAM_TOKEN`
  - 직접 정하는 임의의 긴 랜덤 문자열
- `ADMIN_API_TOKEN`
  - 관리자 콘솔 접속용
- `REALTIME_WS_TOKEN`
  - 실시간 모니터링용

`TWILIO_AUTH_TOKEN`과 `TWILIO_STREAM_TOKEN`은 서로 다른 값이다.

## 5. 배포 후 확인

Render 최신 배포 후 아래 확인:

```bash
curl https://lanstar-aicc-api.onrender.com/api/v1/meta/go-live
curl https://lanstar-aicc-api.onrender.com/health/details
```

정상 조건:

- `readiness.dataSeeded = true`
- `readiness.ecountReady = true`
- `readiness.openAiReady = true`
- `readiness.twilioVoiceReady = true`
- `readiness.twilioMediaReady = true`

## 6. 첫 테스트콜 실행 절차

### 6-1. 테스트 전 화면 준비

브라우저에서 관리자 콘솔 열기:

```text
https://lanstar-aicc-api.onrender.com/admin-console
```

입력:

- `API Base`

```text
https://lanstar-aicc-api.onrender.com
```

- `Admin Token`
  - Render의 `ADMIN_API_TOKEN`
- `Realtime Token`
  - Render의 `REALTIME_WS_TOKEN`

### 6-2. 첫 테스트콜 순서

첫 테스트는 실제 주문 확정부터 하지 말고 아래 순서로 한다.

1. 재고 문의
2. 기술 문의
3. 견적 문의
4. 마지막에 주문 확인

이유:

- 현재 서버는 확인 응답이 오면 ERP 저장까지 갈 수 있다.
- 첫 통화에서 바로 실주문을 만들면 운영 리스크가 있다.

### 6-3. 테스트 멘트 예시

#### 재고 문의

```text
안녕하세요. 동명상사입니다. 랜스타 카테고리6 UTP 5미터 레드 10개 재고 있을까요?
```

기대 결과:

- 거래처 확인
- 품목 후보 매칭
- `가능 / 부족 / 확인필요` 응답
- 관리자 콘솔 전사 표시

#### 기술 문의

```text
안녕하세요. LS-HD2016N EDID 설정이 뭔가요?
```

기대 결과:

- 기술 KB 검색
- 짧은 전화용 답변
- 필요 시 기술 이관 가능

#### 견적 문의

```text
동명상사입니다. LS-6UTPD-5MR 10개 견적 부탁드립니다.
```

기대 결과:

- 단가
- 예상 합계
- 재고 상태
- 필요 시 사람 검토 안내

#### 주문 확인

```text
동명상사입니다. LS-6UTPD-5MR 10개 배송으로 진행해주세요.
```

주의:

- 마지막 확인 질문이 나오면 첫 테스트에서는 바로 `네 맞습니다`로 끝내지 말고 먼저 관리자 콘솔에서 초안/상태를 확인한다.
- 실제 ERP 저장 테스트를 할 때만 최종 확인 응답을 한다.

## 7. 테스트 중 확인할 항목

- 통화가 `실시간 통화` 목록에 뜨는지
- 고객 전사가 실시간으로 들어오는지
- `analysis` 결과와 의도 분류가 맞는지
- 관리자 메모가 들어가는지
- `AI 지시`가 실제 응답에 반영되는지
- `Takeover` 시 AI 응답이 멈추는지
- 통화 종료 후 요약이 생성되는지
- 주문/견적 초안이 보이는지
- 후속 안내 발송 버튼이 동작하는지

## 8. 첫 테스트콜 이후

정상이면 다음 순서로 확대한다.

1. 주문 저장 테스트
2. 사람이 개입하는 warm handoff 테스트
3. 선결제 거래처 테스트
4. 야간/주말 자동안내 테스트
5. 대표번호 포팅 또는 착신전환 검토

## 9. 운영상 주의

- DB 외부 접속 URL은 이미 노출됐으므로 작업 후 꼭 재발급
- Twilio Auth Token, Stream Token, Admin Token, Realtime Token은 외부 공유 금지
- 첫 2주는 전건 모니터링 모드 유지
