# 관리자 운영 가이드 (계정 통합 인증)

이 문서는 운영자가 계정 기반 로그인(account auth)을 관리할 때 필요한 최소 절차만 정리합니다.

## 1) 계정 발급

관리자 다이얼로그에서 아래 순서로 진행합니다.

1. 관리자 키 입력 (`OPENCLAW_ADMIN_ISSUER_KEY` 값)
2. 발급할 이메일/비밀번호 입력
3. 필요 시 이름/권한(member/admin) 선택
4. **계정 발급** 클릭

API 기준:
- `POST /api/admin/users`
- Header: `x-admin-key: <OPENCLAW_ADMIN_ISSUER_KEY>`

운영 주의(프로덕션):
- 프로덕션에서 계정 발급은 **영구 쓰기 가능한 사용자 저장소**가 있어야 합니다.
- `OPENCLAW_AUTH_USERS_JSON`은 부트스트랩/조회용 소스이며 런타임 쓰기 대상이 아닙니다.
- 저장소가 미구성 상태면 발급 API는 `user_store_not_configured`(HTTP 503)으로 실패-종료됩니다.

## 2) 계정 비활성/활성

관리자 다이얼로그 → **계정 목록 불러오기** 후 사용자별 상태를 전환합니다.

- 활성 계정: `비활성화` 버튼
- 비활성 계정: `활성화` 버튼

비활성화 시 새 로그인은 차단됩니다. 기존 세션은 필요 시 아래 "전체 세션 종료"를 추가로 수행하세요.

API 기준:
- `PATCH /api/admin/users/:id`
- Body 예시: `{ "active": false }` 또는 `{ "active": true }`

## 3) 계정 전체 세션 종료

사용자별 **전체 세션 종료** 버튼을 실행합니다.

권장 시점:
- 계정 탈취 의심
- 비밀번호 재설정 직후
- 계정 권한 변경 직후

API 기준:
- `POST /api/admin/users/:id/revoke-all`

## 4) legacy 로그인 병행 운영 주의

현재 시스템은 `account`와 `legacy` 로그인을 함께 지원할 수 있습니다.

운영 시 주의사항:
- 신규 사용자에는 **account 로그인만** 안내
- 운영 공지/매뉴얼에서 legacy 코드 로그인 안내를 점진 제거
- 문제 대응 시 세션의 `authType`(account/legacy)을 확인해 원인 분리
- 보안 감사 시 account 전환율과 legacy 사용 잔량을 함께 추적

---

필수 보안 점검은 `docs/security-checklist-ko.md`를 함께 확인하세요.
