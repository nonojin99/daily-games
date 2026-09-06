# 허브 카드 썸네일 패치 (server.js)

게임 화면을 카드 상단 16:9 배너로 보여주는 패치. **DB 작업은 이미 끝났다** — `server.js`만 아래대로
고쳐서 GitHub `nonojin99/daily-games`에 웹 업로드하면 자동 재배포된다.

## 준비된 것 (건드릴 필요 없음)

- 새 테이블 `public.game_thumbs (slug, webp, w, h, updated_at)` — anon select 허용, RLS 켬
- `webp` = 720×405 WebP의 **base64 문자열** (데이터 URI 접두어 없음). 17종 전부 채워져 있고
  각 행의 `md5(decode(webp,'base64'))`가 로컬 파일과 일치하는 것까지 확인함. 총 104KB
- `games` 테이블은 그대로다 — Dashboard가 `games`를 통째로 fetch해도 무거워지지 않게 일부러 분리했다

## 1. 썸네일 라우트 추가

경로 매칭이 있는 곳(`const m = path.match(/^\/games\/([a-z0-9-]{1,50})\/?$/);` 근처)에 아래를 추가한다.
`/games/...` 매칭 **앞**에 두면 된다.

```js
// ── 게임 화면 썸네일: /thumb/<slug>.webp ────────────────────────────
// game_thumbs에 base64로 저장된 720x405 WebP를 디코드해 이미지로 서빙한다.
const THUMB_TTL = 6 * 60 * 60 * 1000;              // 6시간 메모리 캐시
const thumbCache = new Map();                       // slug -> { buf, at }
const tm = path.match(/^\/thumb\/([a-z0-9-]{1,50})\.webp$/);
if (tm) {
  const slug = tm[1];
  try {
    const hit = thumbCache.get(slug);
    let buf = hit && Date.now() - hit.at < THUMB_TTL ? hit.buf : null;
    if (!buf) {
      const rows = await sb(`game_thumbs?slug=eq.${slug}&select=webp&limit=1`);
      if (!rows || !rows.length) { res.writeHead(404); return res.end("no thumb"); }
      buf = Buffer.from(rows[0].webp, "base64");
      thumbCache.set(slug, { buf, at: Date.now() });
    }
    res.writeHead(200, {
      "Content-Type": "image/webp",
      "Content-Length": buf.length,
      "Cache-Control": "public, max-age=86400",     // 브라우저 1일 캐시
    });
    return res.end(buf);
  } catch (e) {
    res.writeHead(502); return res.end("thumb error");
  }
}
```

> `sb()`가 JSON 배열을 반환한다는 전제다. 만약 `sb()`가 Response를 그대로 준다면
> `const rows = await (await sb(...)).json();`으로 바꿔라.

## 2. 허브에서 썸네일 있는 slug 목록 받기

허브 렌더 부분에서 games를 가져오는 줄:

```js
const games = await sb("games?select=slug,title,day,description,emoji,published_on&order=day.desc");
```

바로 아래에 추가:

```js
// 썸네일이 있는 게임만 배너를 그린다 (없으면 기존 이모지 카드 그대로)
let thumbSet = new Set();
try {
  const t = await sb("game_thumbs?select=slug");
  thumbSet = new Set((t || []).map((r) => r.slug));
} catch (e) {}
```

## 3. 카드 마크업 교체

기존:

```js
const cards = games
  .map(
    (g) => `
  <a class="card${Number(g.day) === newestDay ? ' new' : ''}" href="/games/${esc(g.slug)}/">
    <div class="day">${Number(g.day) === newestDay ? '<span class="badge">오늘의 신작</span> ' : ''}DAY ${g.day} · ${esc(g.published_on)}</div>
    <h2>${esc(g.emoji || "🎮")} ${esc(g.title)}</h2>
    <div class="desc">${esc(g.description)}</div>
  </a>`
  )
  .join("");
```

교체:

```js
const cards = games
  .map((g) => {
    const isNew = Number(g.day) === newestDay;
    const banner = thumbSet.has(g.slug)
      ? `<img class="shot" src="/thumb/${esc(g.slug)}.webp" width="720" height="405"
             alt="${esc(g.title)} 게임 화면" loading="lazy" decoding="async">`
      : `<div class="shot noshot">${esc(g.emoji || "🎮")}</div>`;
    return `
  <a class="card${isNew ? ' new' : ''}" href="/games/${esc(g.slug)}/">
    ${banner}
    <div class="body">
      <div class="day">${isNew ? '<span class="badge">오늘의 신작</span> ' : ''}DAY ${g.day} · ${esc(g.published_on)}</div>
      <h2>${esc(g.title)}</h2>
      <div class="desc">${esc(g.description)}</div>
    </div>
  </a>`;
  })
  .join("");
```

제목에서 이모지를 뺐다 — 화면 자체가 그 역할을 하고, 이모지와 스크린샷이 같이 있으면 지저분하다.
썸네일이 없는 게임은 예전처럼 이모지가 배너 자리에 크게 들어간다.

## 4. CSS 교체

기존 `a.card{...}`와 `a.card:hover{...}` 두 줄을 아래로 바꾼다. (`padding:22px`가 사라지고
`.body`가 그 역할을 하니, `.card h2` / `.card .desc` 같은 기존 규칙은 그대로 두면 된다.)

```css
a.card{display:block;background:#12152b;border:1px solid #23284a;border-radius:18px;
  overflow:hidden;text-decoration:none;color:#fff;transition:transform .12s,border-color .12s}
a.card:hover{transform:translateY(-3px);border-color:#3b9bff}
a.card .shot{display:block;width:100%;height:auto;aspect-ratio:16/9;object-fit:cover;
  background:#0b0e1c;border-bottom:1px solid #23284a}
a.card .noshot{display:flex;align-items:center;justify-content:center;font-size:54px;line-height:1}
a.card .body{padding:18px 22px 22px}
a.card.new .shot{border-bottom-color:#3b9bff}
@media (prefers-reduced-motion:reduce){a.card{transition:none}}
```

`width/height` 속성으로 이미지 로드 전에도 자리가 잡히고(레이아웃 흔들림 없음), `height:auto`가 있어야
그 `height="405"` 속성이 실제 높이를 고정하는 걸 막는다 — **이 한 줄이 빠지면 배너가 거의 정사각형으로 나온다.**

## 5. 확인

1. `https://daily-games-afim.onrender.com/thumb/brush-path.webp` → 720×405 WebP가 떠야 한다
2. 허브 첫 화면 — 카드마다 게임 화면 배너. 콜드스타트면 30~60초 기다릴 것
3. 없는 slug(`/thumb/none.webp`)는 404

## 나중에 새 게임을 배포할 때

`games` insert 후 썸네일도 한 행 넣어야 카드에 배너가 뜬다. 안 넣으면 이모지로 폴백된다.
생성 절차는 세션에서 자동화해 두었다:

```
node thumbs2.mjs <slug>     # 살아 있는 플레이 프레임을 전체 캡처
python3 pick_band.py        # 엣지 에너지로 16:9 띠를 골라 720x405 WebP로 저장
                            # (주인공을 놓치면 pick_band.py의 OVERRIDE에 y를 지정)
insert into public.game_thumbs (slug, webp) values ('<slug>', '<base64>')
  on conflict (slug) do update set webp = excluded.webp, updated_at = now();
```

## Dashboard (선택)

`nonojin99.github.io/Dashboard`도 같은 배너를 쓰려면 `game_thumbs?select=slug,webp`를 fetch해
`data:image/webp;base64,${webp}`로 그리면 된다. 다만 17종이면 105KB를 한 번에 받으므로,
Render 서버의 `/thumb/<slug>.webp`를 그대로 참조하는 편이 캐시가 먹어서 낫다.
