# Twilio OpenAI Adapter

## 목적

Twilio 전화 인입을 OpenAI Realtime 세션에 연결하고, 생성된 전사/응답을 기존 실시간 허브와 오케스트레이터에 연결한다.

## 구현 파일

- `src/modules/twilio/routes.ts`
- `src/modules/twilio/openai-realtime-bridge.ts`
- `src/modules/twilio/prompt.ts`

## 엔드포인트

- `POST /api/v1/twilio/voice/inbound`
- `POST /api/v1/twilio/voice/status`
- `WS /api/v1/twilio/media-stream`

## 동작 흐름

1. Twilio가 `voice/inbound`를 호출한다.
2. 서버는 `call_session`을 upsert하고 TwiML `<Connect><Stream>`을 반환한다.
3. Twilio Media Stream이 `media-stream` WebSocket에 연결한다.
4. 브리지 클래스가 OpenAI Realtime WebSocket을 연다.
5. Twilio inbound 오디오를 OpenAI `input_audio_buffer.append`로 전달한다.
6. OpenAI 고객 전사 완료 이벤트를 받으면 오케스트레이터를 호출한다.
7. 서버가 오케스트레이터 분석 결과를 기준으로 `response.create`를 직접 제어한다.
8. 주문/견적 확인 완료 시 워크플로를 호출해 초안 생성과 ERP 저장을 시도한다.
9. OpenAI 출력 오디오는 다시 Twilio media event로 전달한다.
10. AI 답변 전사와 오케스트레이터 결과는 관리자 실시간 허브로 브로드캐스트된다.

## 필수 환경변수

- `OPENAI_API_KEY`
- `OPENAI_REALTIME_MODEL`
- `OPENAI_REALTIME_VOICE`
- `OPENAI_REALTIME_TRANSCRIBE_MODEL`
- `OPENAI_REALTIME_LANGUAGE`
- `OPENAI_REALTIME_GREETING`
- `PUBLIC_BASE_URL`

## 선택 환경변수

- `OPENAI_REALTIME_INSTRUCTIONS`
- `TWILIO_STREAM_TOKEN`

## 현재 설정

- 입력 포맷: `audio/pcmu`
- 출력 포맷: `audio/pcmu`
- 언어 기본값: `ko`
- 기본 음성: `cedar`
- 기본 인사: `안녕하세요. LANstar입니다. 거래처명 먼저 말씀 부탁드립니다.`

## 제한

- 실제 Twilio 계정과 OpenAI 운영 키로 종단 테스트는 아직 하지 않았다.
- WebSocket 업그레이드의 Twilio 서명 검증은 아직 구현하지 않았다.
- 현재는 Media Streams 기반이며 SIP/ConversationRelay는 아직 아니다.
- 자동 주문/견적 저장은 `확인 응답 -> 상태 확인 -> workflow` 경로까지만 연결되어 있으며, 복수 품목/수정 응답 튜닝은 추가 고도화가 필요하다.
