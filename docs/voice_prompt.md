# Voice Prompt

## 구현 파일

- [prompt.ts](/Users/lanstar/Documents/New%20project/src/modules/twilio/prompt.ts)
- [openai-realtime-bridge.ts](/Users/lanstar/Documents/New%20project/src/modules/twilio/openai-realtime-bridge.ts)

## 반영한 운영 규칙

- 평일 10:00~17:00에는 AI/봇 언급 금지
- 야간/주말에는 자동상담임을 1회만 짧게 고지
- 거래처명 우선 확인, 애매하면 전화번호 뒷자리 재확인
- 제조사 -> 품명 -> 규격 -> 모델 순서로 질문
- 브랜드 미지정 시 LANstar 우선
- 주문/견적 확정 전 `거래처명 / 품명 / 수량 / 배송방법` 복창
- 배송 규칙과 컷오프 시간 반영
- 캐비넷은 경동 고정, 지점수령/도착지배송 구분
- 선결제 문구 고정
- 기술문의는 근거 없는 답변 금지
- 장기화, 반복, 감정 악화, 할인/환불/불량판정/고액건은 사람 이관

## 커스터마이즈

- `OPENAI_REALTIME_INSTRUCTIONS`
  - 값이 있으면 기본 프롬프트 대신 우선 적용
- `OPENAI_REALTIME_GREETING`
  - 값이 있으면 기본 인사 대신 우선 적용
