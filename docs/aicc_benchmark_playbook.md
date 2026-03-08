# AICC Benchmark Playbook

## 목적

LANstar 음성 AICC를 실제 전화 주문/재고/견적/기술문의 환경에 맞게 고도화하기 위해, 전세계 공개 사례와 공식 운영 가이드에서 반복적으로 나오는 원칙을 정리하고 현재 코드에 반영한 항목을 기록한다.

## 조사 기준

- 최신성보다 운영 안정성이 중요한 영역이라 공식 문서와 공식 사례를 우선 참고했다.
- 벤치마킹 범위는 `음성 프롬프트`, `확인 루프`, `실시간 감독`, `정확한 전사`, `사람 이관`, `짧은 대화 설계`에 집중했다.

## 참고한 공식 자료

- OpenAI
  - [Voice Agents guide](https://developers.openai.com/api/docs/guides/voice-agents)
  - [Realtime API reference](https://platform.openai.com/docs/api-reference/realtime)
- Google Cloud
  - [Contact Center AI best practices and conversation design references](https://cloud.google.com/contact-center/ccai-platform)
  - [Speech adaptation for domain vocabulary](https://cloud.google.com/speech-to-text/docs/adaptation)
  - [Wolkvox + Google CCAI customer story](https://cloud.google.com/customers/wolkvox)
- AWS
  - [Amazon Connect administrator and contact flow guidance](https://docs.aws.amazon.com/connect/latest/adminguide/what-is-amazon-connect.html)
  - [Contact Lens / analytics / agent assist references](https://docs.aws.amazon.com/connect/latest/adminguide/analyze-conversations.html)
  - [Max blog on Amazon Connect self-service and call routing outcomes](https://aws.amazon.com/blogs/contact-center/max-is-enhancing-customer-and-employee-engagement-with-amazon-connect/)
- Twilio
  - [Media Streams](https://www.twilio.com/docs/voice/media-streams)
  - [Voice webhooks and TwiML Stream](https://www.twilio.com/docs/voice/twiml/stream)
  - [Phonely customer story](https://customers.twilio.com/314174-phonely)

## 공통 성공 패턴

### 1. 질문은 짧고 순차적으로

성공 사례들은 거의 공통적으로 `한 번에 한 가지만 묻는 흐름`을 유지한다. 고객 이름, 제품, 수량, 배송을 한 턴에 몰아 묻는 방식은 음성 오류와 이탈률을 올린다.

LANstar 적용:

- 거래처 확인 -> 품목 확인 -> 수량 -> 배송 -> 최종 복창 순으로 고정
- 한 턴에 하나의 누락 정보만 요청

### 2. 애매한 값은 추정하지 말고 복구 루프로 되돌리기

공식 음성 가이드들은 음성 AI가 `애매한 값`을 추정해서 진행하지 말고, 다시 확인하거나 더 작은 단위로 수집하라고 권장한다. 특히 회사명, 모델명, 품목코드, 숫자는 거래성 업무에서 가장 위험하다.

LANstar 적용:

- 거래처명은 후보 검색 후 다시 확인
- 모델명/품목코드는 정확 매칭 우선
- 정확 매칭이 아니면 바로 저장하지 않고 후보 확인 단계로 이동
- 영문/숫자 조합은 끊어서 다시 말해달라는 수집 규칙 반영

### 3. 음성에서는 긴 옵션 나열보다 2개 이하 후보 제시가 유리

연속 음성 인터페이스는 화면보다 기억 부담이 크다. 복수 후보가 있더라도 2개 이하만 제시하고, 더 많으면 좁히는 질문으로 돌아가는 방식이 실제 운영에 유리하다.

LANstar 적용:

- 거래처 후보는 상위 2개까지만 음성으로 제시
- 품목 후보도 상위 2개까지만 제시
- 후보가 더 많으면 제조사, 규격, 길이/색상 등 좁히는 질문 우선

### 4. 실시간 감독과 즉시 이관이 containment보다 중요

성공 사례들은 “AI가 몇 %를 혼자 처리했는가”보다 “AI가 놓친 통화를 사람이 얼마나 빨리 받아냈는가”를 더 중요하게 본다. supervisor visibility, transcript, handoff context가 공통 핵심이다.

LANstar 적용:

- 관리자 화면에 통화 상태, 전사, 요약, 후속안내, AI 지시 유지
- 추가로 품질 패널을 넣어 현재 단계, 후보 수, 복구 횟수, 다음 액션, 권장 진행 표시

### 5. 전사 정확도는 모델만이 아니라 도메인 용어 관리 문제

Google Speech adaptation과 유사한 공식 가이드는 특정 도메인의 고유 명사, 브랜드, 품목코드, 문자-숫자 혼합 토큰을 별도로 관리할수록 정확도가 오른다고 설명한다.

LANstar 적용:

- OpenAI Realtime 전사 프롬프트를 도메인 특화형으로 강화
- 브랜드, 케이블 규격, 모델 포맷, 혼합 영문/숫자 코드를 보존하도록 명시

## 이번에 반영한 코드 변경

### 1. 음성 프롬프트 강화

파일:

- [prompt.ts](/Users/lanstar/Documents/New%20project/src/modules/twilio/prompt.ts)

반영 내용:

- 한 턴 한 질문 규칙
- 거래처 -> 품목 -> 수량 -> 배송 -> 최종 복창 흐름 고정
- 영문/숫자 모델명은 chunk 단위로 다시 받는 규칙
- 후보는 2개 이하만 제시
- 여러 품목을 한 번에 말하면 한 줄씩 처리
- 사람 이관 시 요약 컨텍스트 유지

### 2. 전사 힌트 강화

파일:

- [prompt.ts](/Users/lanstar/Documents/New%20project/src/modules/twilio/prompt.ts)
- [openai-realtime-bridge.ts](/Users/lanstar/Documents/New%20project/src/modules/twilio/openai-realtime-bridge.ts)

반영 내용:

- 전사 전용 prompt builder 추가
- 브랜드, 케이블 규격, 코드 포맷, 혼합 영문/숫자 보존 규칙 추가
- 고객/AI 반복 발화를 상태에 기록해서 장기화 판단 품질 개선

### 3. 거래처/품목 매칭 보수화

파일:

- [service.ts](/Users/lanstar/Documents/New%20project/src/modules/orchestrator/service.ts)

반영 내용:

- 거래처는 전화번호와 거래처명 후보를 함께 사용
- 품목은 `품목코드/모델명 exact`만 자동 확정
- fuzzy 결과는 바로 저장하지 않고 후보 확인 단계로 이동
- 단일 후보라도 정확 매칭이 아니면 다시 확인

### 4. 관리자 품질 패널 추가

파일:

- [admin-console.html](/Users/lanstar/Documents/New%20project/public/admin-console.html)

반영 내용:

- 거래처 캡처 상태
- 품목 캡처 상태
- 현재 단계
- 복구 횟수
- 마지막 거래처/품목 힌트
- 다음 액션
- 운영자 권장 멘트

## 지금 기준 운영 권장안

### 즉시 유지

- 최종 확정 전 반드시 yes/no 확인
- 모델명 exact가 아니면 사람처럼 다시 물어보기
- 거래처 후보가 남아 있으면 ERP 저장 금지

### 1차 추가 고도화

- 거래처 별칭 사전 구축
- 품목 음성 별칭 사전 구축
- 자주 틀리는 모델명 발음 사전 구축
- 통화 로그 기준 오인식 Top 100 정리

### 2차 고도화

- 거래처별 자주 주문하는 품목 prior 반영
- 브랜드별 음성 동의어 사전
- 운영 화면에 `정확도 낮음`, `추가 확인 필요`, `즉시 takeover 권장` 배지 추가

## LANstar에 특히 중요한 실무 포인트

- 거래처명과 모델명은 `자동 확정률`보다 `오확정 방지율`이 더 중요하다.
- 주문형 AICC는 자연스러움보다 `짧고 안전한 복창`이 우선이다.
- 성공 런칭 사례들은 대부분 100% 자동화를 먼저 하지 않고, supervisor-assisted launch로 containment를 올린다.

## 다음 권장 작업

1. 실통화 30~50건을 수집해 거래처 오인식/모델명 오인식 탑패턴 정리
2. 거래처 별칭 사전, 품목 별칭 사전, 모델명 발음 사전 추가
3. 관리자 화면에 오인식 탑패턴 태깅 기능 추가
4. 주문 저장 전 `거래처 확정`, `품목 exact 여부`, `최종 yes/no`를 강제 체크
