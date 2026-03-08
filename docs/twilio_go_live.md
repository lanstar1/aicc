# Twilio Go-Live

실제 대표번호를 붙이기 전 마지막 점검 문서다.

상세한 Twilio 번호 콘솔 입력값과 첫 테스트콜 절차는 [twilio_console_setup.md](/Users/lanstar/Documents/New%20project/docs/twilio_console_setup.md)를 따른다.

## 준비 상태 확인 API

운영 준비 상태는 아래 엔드포인트에서 한 번에 확인할 수 있다.

```bash
curl https://lanstar-aicc-api.onrender.com/api/v1/meta/go-live
```

응답에는 아래 정보가 포함된다.

- `service.publicBaseUrl`
- `service.adminConsoleUrl`
- `twilio.voiceWebhookUrl`
- `twilio.statusWebhookUrl`
- `twilio.mediaStreamPath`
- `dataCounts`
- `readiness`
- `nextSteps`

## Twilio 콘솔 입력값

- Voice webhook

```text
POST https://lanstar-aicc-api.onrender.com/api/v1/twilio/voice/inbound
```

- Call status webhook

```text
POST https://lanstar-aicc-api.onrender.com/api/v1/twilio/voice/status
```

## Render 필수 환경변수

- `PUBLIC_BASE_URL`
- `OPENAI_API_KEY`
- `ERP_COM_CODE`
- `ERP_USER_ID`
- `ERP_API_CERT_KEY`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_STREAM_TOKEN`
- `ADMIN_API_TOKEN`
- `REALTIME_WS_TOKEN`

## 첫 테스트콜 체크리스트

1. 고객이 대표번호로 전화했을 때 첫 인사가 정상인지 확인
2. 거래처명 확인 후 고객 발화가 관리자 콘솔에 실시간으로 보이는지 확인
3. 주문 1건 테스트
   - 거래처 확인
   - 품목 확인
   - 수량 확인
   - 배송방식 확인
   - ERP 초안 또는 전표 생성 확인
4. 재고 문의 1건 테스트
   - `가능 / 부족 / 확인필요` 응답 확인
5. 견적 문의 1건 테스트
   - 단가/합계/재고 상태 응답 확인
6. 기술문의 1건 테스트
   - KB 답변 또는 사람 이관 확인
7. 관리자 takeover 테스트
   - AI 응답 중지
   - 내부 메모 전송
   - AI 지시
8. 통화 종료 후 요약 생성 확인
9. 후속 문자/메일 발송 확인

## 권장 테스트 시나리오

### 주문

- 거래처명: 기존 거래처
- 품목: `LS-6UTPD-5MR`
- 수량: `10개`
- 배송: `배송`

### 재고

- 품목: `LS-6UTPD-5MR`
- 수량: `10개`

### 견적

- 품목: `LS-6UTPD-5MR`
- 수량: `10개`

### 기술문의

- 모델: `LS-HD2016N`
- 질문: `EDID 설정이 뭔가요`

## 보안 주의사항

- Render Postgres의 외부 접속 URL은 작업 후 반드시 재발급 또는 비밀번호 교체
- DB Inbound IP는 작업 후 `/32` 수준으로 최소화
- `TWILIO_AUTH_TOKEN`, `TWILIO_STREAM_TOKEN`, `ADMIN_API_TOKEN`, `REALTIME_WS_TOKEN`은 대화나 메신저에 공유하지 않음
