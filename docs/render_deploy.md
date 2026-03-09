# Render 배포

## 포함 항목

- [render.yaml](/Users/lanstar/Documents/New%20project/render.yaml)
- Web Service: `lanstar-aicc-api`
- Cron Job: `lanstar-aicc-retention`
- Postgres: `lanstar-aicc-db`

## Web Service 설정

- Runtime: `node`
- Build: `npm ci --include=dev && npm run build`
- Start: `NODE_ENV=production npm start`
- Health check: `GET /ready`
- Auto deploy: `main` 브랜치 커밋 시 자동 배포
- 기본 포트: `10000`
- Node: `22.x`
- `NODE_ENV=production`은 빌드 환경변수가 아니라 `startCommand`에서만 적용

## Cron Job 설정

- 이름: `lanstar-aicc-retention`
- 실행 커맨드: `npm run purge:retention`
- 실행 시각: 매일 `UTC 18:00`
- 한국 시간 기준: 매일 `03:00`

## 배포 순서

1. Render에서 Blueprint 또는 기존 서비스에 [render.yaml](/Users/lanstar/Documents/New%20project/render.yaml)을 연결한다.
2. Blueprint sync 시 `lanstar-aicc-db` Postgres가 함께 생성되도록 승인한다.
3. Web/Cron의 `DATABASE_URL`은 수동 입력하지 않는다.
   - 현재 [render.yaml](/Users/lanstar/Documents/New%20project/render.yaml)은 `fromDatabase -> connectionString`으로 자동 연결되게 되어 있다.
4. `PUBLIC_BASE_URL`, `OPENAI_API_KEY`, `ERP_COM_CODE`, `ERP_USER_ID`, `ERP_API_CERT_KEY`를 채운다.
5. 첫 배포 완료 후 Shell 또는 One-off Job에서 `npm run db:apply-schema`를 1회 실행한다.
6. 이어서 동일한 방식으로 `npm run import:data`를 1회 실행한다.
7. Twilio를 쓸 경우 `TWILIO_STREAM_TOKEN`과 Twilio Voice webhook URL을 설정한다.
8. 가능하면 `TWILIO_AUTH_TOKEN`도 채워서 Twilio POST 웹훅 서명 검증을 켠다.
9. 메일/SMS/알림톡을 실발송하려면 `NOTIFICATION_MOCK_MODE=false` 상태에서 관련 webhook/SMTP 값을 채운다.
10. 배포 후 `npm run smoke:test -- --base-url https://<service>.onrender.com`으로 확인한다.

## 자동 배포

- 현재 [render.yaml](/Users/lanstar/Documents/New%20project/render.yaml)은 `autoDeployTrigger: commit`으로 설정되어 있다.
- Blueprint sync 후부터는 `main` 브랜치에 push 되는 새 커밋이 `lanstar-aicc-api`에 자동 배포된다.
- 이미 만들어진 서비스가 예전 수동 설정을 들고 있으면, Render Dashboard의 Web Service 설정에서도 Auto-Deploy가 `On Commit`인지 한 번 확인한다.

## Render Postgres 생성 방법

현재 프로젝트는 `Blueprint-managed Postgres` 방식으로 맞춰 두었다.

### 가장 쉬운 방법

1. Render Dashboard에서 `New +` -> `Blueprint`를 선택한다.
2. 현재 저장소를 연결한다.
3. Preview 화면에서 아래 3개 리소스가 보이는지 확인한다.
   - `lanstar-aicc-db`
   - `lanstar-aicc-api`
   - `lanstar-aicc-retention`
4. DB 리전은 가능하면 Web Service와 같은 리전으로 둔다.
5. 생성 후 DB 상세 화면에서 실제 생성 상태가 `Available`인지 확인한다.
6. Web Service 환경변수에 `DATABASE_URL`이 자동 연결되었는지 확인한다.

### 이미 Web Service만 먼저 만든 경우

1. Render Dashboard에서 `New +` -> `PostgreSQL`을 선택한다.
2. 이름은 `lanstar-aicc-db`로 맞춘다.
3. DB 이름은 `lanstar_aicc`, 사용자명은 `lanstar_aicc`로 맞춘다.
4. Web Service와 같은 리전으로 만든다.
5. 생성 후 DB 상세의 `Connections`에서 `Internal Database URL`을 확인한다.
6. Web Service와 Cron Job의 `DATABASE_URL`에 그 값을 넣는다.
7. 이 경우에도 첫 배포 후 `npm run db:apply-schema`, `npm run import:data`를 각각 1회 실행한다.

## Render에서 초기 명령 실행 방법

### 방법 1: Shell

- Web Service 상세 화면에서 `Shell`을 연다.
- 아래 순서로 실행한다.

```bash
npm run db:apply-schema
npm run import:data
```

### 방법 2: One-off Job

- Render Dashboard에서 `New +` -> `One-off Job`
- 같은 저장소/브랜치 선택
- Build: `npm ci && npm run build`
- Start:

```bash
npm run db:apply-schema
```

- 스키마 반영 후 한 번 더 같은 방식으로:

```bash
npm run import:data
```

## 권장 환경변수

- 필수
  - `PUBLIC_BASE_URL`
  - `OPENAI_API_KEY`
  - `ERP_COM_CODE`
  - `ERP_USER_ID`
  - `ERP_API_CERT_KEY`
- 운영 권장
  - `ADMIN_API_TOKEN`
  - `REALTIME_WS_TOKEN`
  - `TWILIO_STREAM_TOKEN`
  - `TWILIO_AUTH_TOKEN`
  - `EMAIL_FROM_ADDRESS`
  - `SMTP_HOST`
  - `SMTP_PORT`
  - `SMTP_USER`
  - `SMTP_PASS`
  - `ERP_SMS_WEBHOOK_URL`
  - `ERP_SMS_WEBHOOK_TOKEN`

## 확인 포인트

- `/health`
- `/ready`
- `/health/details`
- `/admin-console`
- `/api/v1/admin/summary`

## 배포 직후 최소 점검 순서

1. `/ready`
2. `/health/details`
3. `npm run smoke:test -- --base-url https://<service>.onrender.com`
4. 관리자 화면 접속
5. `npm run simulate:call -- --scenario quote-lanstar`
6. `curl https://<service>.onrender.com/api/v1/meta/go-live`

## Twilio 콘솔 입력값

- Voice webhook:
  - `POST https://lanstar-aicc-api.onrender.com/api/v1/twilio/voice/inbound`
- Call status webhook:
  - `POST https://lanstar-aicc-api.onrender.com/api/v1/twilio/voice/status`

실제 Twilio 번호 콘솔 설정과 첫 테스트콜 순서는 [twilio_console_setup.md](/Users/lanstar/Documents/New%20project/docs/twilio_console_setup.md) 참고.

참고: Render 공식 문서상 `render.yaml`은 `runtime`, `buildCommand`, `startCommand`, `healthCheckPath`, `schedule`, `envVars`를 지원합니다. Cron schedule은 UTC 기준입니다. 출처: [Render Blueprint spec](https://render.com/docs/blueprint-spec), [Render Cron Jobs](https://render.com/docs/cronjobs)
