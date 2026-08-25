# Daily Games Server

매일 만드는 게임을 서빙하는 서버입니다. 게임 HTML은 Supabase `games` 테이블에 저장되며,
새 게임 추가는 git push 없이 DB insert만으로 반영됩니다 (자동화 목적).

- `/` — 게임 목록 허브
- `/games/{slug}/` — 게임 플레이
- `/healthz` — 헬스체크

## 환경 변수 (Render에서 설정됨)

- `SUPABASE_URL` — Supabase 프로젝트 URL
- `SUPABASE_KEY` — publishable(anon) key

실행: `node server.js`
