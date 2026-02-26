# Cloudflare Tunnel 안정화 점검 Runbook

## 현재 구성
- 앱: `127.0.0.1:3090` (`com.309agent.app3090` launchd)
- 터널: `com.309agent.cloudflared` launchd (`--url http://127.0.0.1:3090`)
- 도메인: `app.309designlab.com`

## 점검 결과 (2026-02-26)
- 로컬 앱: `200` 정상
- launchd 상태: 앱/터널 모두 running
- 외부 DNS(1.1.1.1): `app.309designlab.com` 정상 resolve
- 관측 이슈: 특정 시점에 로컬 resolver 기준 `Could not resolve host` 발생

## 원인 분류
1. DNS/리졸버 이슈
   - 증상: `curl: (6) Could not resolve host`
   - 확인: `dig app.309designlab.com @1.1.1.1`
2. 터널 프로세스 중복 이슈
   - 증상: 간헐 라우팅 실패, websocket/stream 실패
   - 확인: `ps -ax | grep '[c]loudflared tunnel'`
3. 앱 업스트림 미설정 이슈
   - 증상: `/api/chat/stream 503 upstream_not_configured`
   - 조치: launchd 환경변수 `OPENCLAW_CHAT_*` 설정

## 즉시 진단 커맨드
```bash
curl -sS -o /dev/null -w 'local:%{http_code}\n' http://127.0.0.1:3090
curl -sS -o /dev/null -w 'public:%{http_code}\n' https://app.309designlab.com

launchctl print gui/$(id -u)/com.309agent.app3090 | sed -n '1,20p'
launchctl print gui/$(id -u)/com.309agent.cloudflared | sed -n '1,20p'

ps -ax | grep '[c]loudflared tunnel'
dig app.309designlab.com +short @1.1.1.1
```

## 복구 절차
1. 앱/터널 재기동
```bash
launchctl kickstart -k gui/$(id -u)/com.309agent.app3090
launchctl kickstart -k gui/$(id -u)/com.309agent.cloudflared
```
2. 중복 cloudflared 정리(있을 때만)
```bash
sudo launchctl bootout system /Library/LaunchDaemons/com.cloudflare.cloudflared.plist
```
3. DNS 전파/해결 확인
```bash
dig NS 309designlab.com +short
dig app.309designlab.com +short @1.1.1.1
```
