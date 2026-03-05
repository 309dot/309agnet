# 보안 체크리스트 (계정 통합 인증)

배포 전/후에 아래 항목을 확인하세요.

## 필수 환경 변수

- `OPENCLAW_APP_SESSION_SECRET`
- `OPENCLAW_ADMIN_ISSUER_KEY`
- `OPENCLAW_CHAT_URL`
- `OPENCLAW_CHAT_STREAM_URL`
- `OPENCLAW_CHAT_TOKEN` (권장, 업스트림 정책에 따라 필수)
- `OPENCLAW_CHAT_STREAM_TOKEN` (권장, 업스트림 정책에 따라 필수)
- `OPENCLAW_UPSTREAM_CONTEXT_SECRET` **(필수 권장)**

> `OPENCLAW_UPSTREAM_CONTEXT_SECRET`는 `X-309-User-Context` 서명(`X-309-User-Signature`)에 사용됩니다.
> 미설정 시 컨텍스트 서명 검증이 약화될 수 있습니다.
> `OPENCLAW_CHAT_TOKEN` / `OPENCLAW_CHAT_STREAM_TOKEN`을 임시 placeholder로 채운 경우, 실제 업스트림 토큰 발급 즉시 교체(rotate)하세요.

## 설정 확인 명령어

### 1) 배포 환경 변수 존재 확인 (Vercel)

```bash
vercel env ls
```

필수 키가 모두 존재하는지 확인합니다.

### 2) 런타임 health 확인

```bash
curl -sS https://<배포도메인>/api/health | jq
```

확인 포인트:
- `.security.hasUpstreamContextSecret == true`
- `.security.hasChatToken == true` (토큰 정책 사용 시)
- `.security.hasStreamToken == true` (토큰 정책 사용 시)

### 3) 업스트림 컨텍스트 서명 동작 확인

앱에 로그인한 상태에서 채팅 요청 1회를 보낸 뒤, 업스트림(브리지/서버) 로그에서 아래 헤더를 확인합니다.

- `X-309-User-Context` 존재
- `X-309-User-Signature` 존재

## 운영 체크

- [ ] 관리자 키는 운영 인원에게만 공유
- [ ] 계정 비활성화 시 필요하면 즉시 전체 세션 종료
- [ ] legacy 로그인 안내를 최소화하고 account 로그인 중심으로 운영
- [ ] `/api/health` 응답에 secret 원문이 노출되지 않는지 점검
