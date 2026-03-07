# Realtime Streaming

## 목적

실시간 음성/전사 스트림을 받아 `call_event`에 적재하고, 관리자 콘솔로 즉시 브로드캐스트한다.

## 구현 파일

- `src/modules/realtime/hub.ts`
- `src/modules/realtime/routes.ts`
- `src/plugins/realtime.ts`

## 엔드포인트

- `POST /api/v1/realtime/bootstrap`
- `GET /api/v1/realtime/sessions/:id/runtime`
- `WS /api/v1/realtime/ws/calls/:id?role=provider|manager|monitor`
- `WS /api/v1/realtime/ws/monitor?role=manager|monitor`

## 인증

- `REALTIME_WS_TOKEN`이 비어 있으면 토큰 없이 접속 가능
- 값이 있으면 아래 둘 중 하나로 인증
  - 헤더 `x-realtime-token`
  - 쿼리 `token`

## 부트스트랩

`POST /bootstrap`는 `call_session`을 만들고 WebSocket 경로를 반환한다.

입력:

- `providerCallId`
- `callerNumber`
- `customerId`
- `intentType`
- `status`

출력:

- `id`
- `providerCallId`
- `callerNumber`
- `status`
- `ws.providerPath`
- `ws.managerPath`
- `ws.monitorPath`

## WebSocket 메시지

### 공급자 -> 서버

#### 1. 세션 시작

```json
{
  "type": "session.start",
  "callerNumber": "02-717-3386",
  "providerCallId": "twilio-call-123",
  "intentType": "order"
}
```

#### 2. 부분 전사

```json
{
  "type": "transcript.partial",
  "speaker": "customer",
  "text": "랜스타 캣식스..."
}
```

#### 3. 최종 전사

```json
{
  "type": "transcript.final",
  "speaker": "customer",
  "text": "랜스타 cat6 5미터 레드 10개 주문할게요",
  "hints": {
    "customerName": "예시상사"
  }
}
```

#### 4. 일반 이벤트

```json
{
  "type": "event",
  "eventType": "erp_call",
  "speaker": "system",
  "content": "inventory lookup"
}
```

#### 5. 관리자 명령

```json
{
  "type": "manager.command",
  "action": "takeover",
  "target": "sales",
  "content": "영업 직접 연결"
}
```

#### 6. 세션 종료

```json
{
  "type": "session.end",
  "status": "completed",
  "handoffRequired": false,
  "handoffTarget": "none",
  "transcriptSummary": {
    "result": "order_saved"
  }
}
```

### 서버 -> 구독자

- `connected`
- `session.started`
- `transcript.partial`
- `transcript.final`
- `analysis`
- `event`
- `manager.command`
- `session.completed`
- `error`

## 현재 동작

- `transcript.final`의 `speaker=customer`가 들어오면 오케스트레이터를 호출한다.
- 오케스트레이터 결과는 `analysis` 메시지로 다시 브로드캐스트된다.
- `manager.command action=takeover`가 들어오면 `call_session`의 handoff 상태를 갱신한다.
- `session.end`가 들어오면 transcript 원문과 summary를 `call_session`에 저장한다.

## 제한

- 현재는 텍스트 전사 스트림 기준이다.
- 실제 오디오 프레임 저장/재생은 아직 없다.
- WebSocket 허브 상태는 메모리 기반이라 서버 재시작 시 초기화된다.
