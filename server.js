// Daily Games server — Supabase DB에 저장된 게임 HTML을 서빙 + /stats 통계 대시보드
// 게임 추가는 git push 없이 games 테이블 insert만으로 반영됩니다.
const http = require("http");

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_KEY;
const SB_B_URL = process.env.SUPABASE_B_URL; // 짝수일 랭킹 프로젝트 (없어도 동작)
const SB_B_KEY = process.env.SUPABASE_B_KEY;
const STATS_KEY = process.env.STATS_KEY; // 설정 시 /stats는 관리자 전용
const PORT = process.env.PORT || 10000;
const TTL_MS = 60 * 1000; // 60초 캐시

const cache = new Map();
async function sbFetch(base, key, path, opts = {}) {
  const cacheKey = base + path;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.t < TTL_MS) return hit.v;
  const r = await fetch(`${base}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error(`supabase ${r.status}`);
  const v = await r.json();
  cache.set(cacheKey, { t: Date.now(), v });
  return v;
}
const sb = (path) => sbFetch(SB_URL, SB_KEY, path);

/** 가장 최근 게임 하나 (허브 NEW 배지 · 게임 내 신작 배너용) */
async function newestGame() {
  const rows = await sb("games?select=slug,title,emoji,day&order=day.desc&limit=1");
  return rows[0] || null;
}

/**
 * 게임 페이지에 '오늘의 신작' 배너를 주입한다.
 * 게임 코드는 건드리지 않는다 — 독립 IIFE + 자체 DOM + 캡처 단계 이벤트 격리라
 * 어떤 게임에서도 조작을 가로채거나 깨뜨리지 않는다.
 */
function injectPromo(html, promo) {
  if (!promo) return html;
  const data = JSON.stringify({ slug: promo.slug, title: promo.title, emoji: promo.emoji || "\ud83c\udfae" });
  const tag = `
<script>
(function () {
  var G = ${data};
  var KEY = 'dg_promo_' + G.slug + '_' + new Date().toISOString().slice(0, 10);
  try { if (localStorage.getItem(KEY)) return; } catch (e) {}

  // iframe 안에 띄운다 — 배너 위의 터치가 게임에 절대 전달되지 않는다.
  // (부모 window에 리스너를 걸어 막는 방식은 게임이 먼저 등록한 캡처 리스너를 못 막는다)
  var f = document.createElement('iframe');
  f.id = 'dg-promo';
  f.setAttribute('scrolling', 'no');
  f.setAttribute('title', '오늘의 신작');
  f.style.cssText = [
    'position:fixed', 'left:50%', 'transform:translateX(-50%) translateY(140%)',
    'bottom:calc(14px + env(safe-area-inset-bottom))', 'z-index:2147483000',
    'width:min(92vw,340px)', 'height:52px', 'border:0', 'background:transparent',
    'color-scheme:normal', 'transition:transform .35s cubic-bezier(.2,.9,.3,1.2)'
  ].join(';');

  function hide() {
    f.style.transform = 'translateX(-50%) translateY(140%)';
    setTimeout(function () { f.remove(); }, 400);
  }
  function dismiss() { try { localStorage.setItem(KEY, '1'); } catch (e) {} hide(); }

  function mount() {
    if (!document.body) return;
    document.body.appendChild(f);
    var d = f.contentDocument;
    if (!d) return;
    var safeTitle = String(G.title).replace(/[&<>"]/g, '');
    d.open();
    d.write(
      '<meta charset="utf-8">' +
      '<style>html,body{margin:0;height:100%;background:transparent;overflow:hidden;' +
      '-webkit-tap-highlight-color:transparent}' +
      '#p{height:100%;box-sizing:border-box;display:flex;align-items:center;gap:10px;' +
      'padding:0 10px 0 14px;border-radius:999px;background:rgba(13,15,30,.95);' +
      'border:1px solid rgba(255,255,255,.22);box-shadow:0 8px 28px rgba(0,0,0,.5);' +
      'font:600 13px/1.2 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;' +
      'color:#fff;cursor:pointer}' +
      '#n{font-size:10px;letter-spacing:.06em;color:#0d0f1e;' +
      'background:linear-gradient(90deg,#3bff8a,#3b9bff);padding:3px 7px;border-radius:999px;' +
      'font-weight:800;flex:none}' +
      '#t{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '#a{opacity:.55;flex:none}' +
      '#x{all:unset;flex:none;width:28px;height:28px;display:grid;place-items:center;' +
      'border-radius:50%;color:#9aa0c0;font-size:16px;cursor:pointer}</style>' +
      '<div id="p"><span id="n">NEW</span><span id="t">' + G.emoji + ' ' + safeTitle +
      '</span><span id="a">→</span><button id="x" type="button" aria-label="닫기">×</button></div>'
    );
    d.close();
    d.getElementById('x').addEventListener('click', function (e) { e.stopPropagation(); dismiss(); });
    d.getElementById('p').addEventListener('click', function () {
      try { localStorage.setItem(KEY, '1'); } catch (e) {}
      parent.location.href = '/games/' + G.slug + '/';
    });
    requestAnimationFrame(function () { f.style.transform = 'translateX(-50%) translateY(0)'; });
    setTimeout(function () { if (f.isConnected) hide(); }, 15000);
  }
  setTimeout(mount, 45000);
})();
</script>`;
  return html.includes('</body>') ? html.replace('</body>', tag + '\n</body>') : html + tag;
}

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const SHELL_CSS = `
*{margin:0;padding:0;box-sizing:border-box}
body{min-height:100vh;background:#0d0f1e;color:#fff;font-family:'Segoe UI','Apple SD Gothic Neo','Noto Sans KR',sans-serif;display:flex;flex-direction:column;align-items:center;padding:48px 20px}
h1{font-size:40px;font-weight:900;letter-spacing:1px;background:linear-gradient(90deg,#ff3b6b,#ffd93b,#3bff8a,#3b9bff);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
p.sub{color:#9aa0c0;margin:10px 0 36px;font-size:14px;text-align:center}
a.nav{color:#3b9bff;text-decoration:none;font-size:13px}
footer{margin-top:40px;font-size:12px;color:#4a5078}`;

function hubPage(games) {
  const newestDay = Math.max(...games.map((g) => Number(g.day) || 0));
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
  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Daily Games</title>
<style>${SHELL_CSS}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;width:min(920px,100%)}
a.card{display:block;background:#12152b;border:1px solid #23284a;border-radius:18px;padding:22px;text-decoration:none;color:#fff;transition:transform .12s,border-color .12s}
a.card:hover{transform:translateY(-3px);border-color:#3b9bff}
.card .day{font-size:12px;color:#6f76a8;letter-spacing:1px}
.card h2{font-size:22px;margin:6px 0 8px}
.card .desc{font-size:13px;color:#9aa0c0;line-height:1.5}
a.card.new{border-color:#3bff8a55;box-shadow:0 0 0 1px #3bff8a22,0 6px 24px rgba(59,255,138,.10)}
.badge{display:inline-block;font-size:10px;font-weight:800;letter-spacing:.04em;color:#0d0f1e;
  background:linear-gradient(90deg,#3bff8a,#3b9bff);padding:2px 7px;border-radius:999px;margin-right:2px}
</style></head>
<body><h1>DAILY GAMES</h1><p class="sub">매일 하나씩, Claude와 함께 만드는 게임</p>
<div class="grid">${cards || '<p class="sub">아직 게임이 없어요</p>'}</div>
<footer>nonojin · Daily Game Project</footer></body></html>`;
}

async function statsData() {
  const [games, stats] = await Promise.all([
    sb("games?select=slug,title,day,emoji,published_on&order=day.asc"),
    sbFetch(SB_URL, SB_KEY, "rpc/game_stats", { method: "POST", body: "{}" }),
  ]);
  // 랭킹 참여자 수 (프로젝트 A + B)
  const counts = {};
  const tally = (rows) => rows.forEach((r) => { counts[r.game_id] = (counts[r.game_id] || 0) + 1; });
  try { tally(await sbFetch(SB_URL, SB_KEY, "daily_rankings?select=game_id&limit=10000")); } catch (e) {}
  if (SB_B_URL && SB_B_KEY) {
    try { tally(await sbFetch(SB_B_URL, SB_B_KEY, "daily_rankings?select=game_id&limit=10000")); } catch (e) {}
  }
  const statMap = Object.fromEntries(stats.map((s) => [s.game_id, s]));
  return games.map((g) => ({
    ...g,
    stat: statMap[g.slug] || { loads: 0, starts: 0, overs: 0, avg_score: null, best_score: null },
    players: counts[g.slug] || 0,
  }));
}

function statsPage(rows) {
  const maxStarts = Math.max(1, ...rows.map((r) => Number(r.stat.starts)));
  const trs = rows
    .map(
      (r) => `
    <tr>
      <td class="g"><span class="d">DAY ${r.day}</span><br>${esc(r.emoji)} <a href="/games/${esc(r.slug)}/">${esc(r.title)}</a></td>
      <td class="bar-cell"><div class="bar" style="width:${(Number(r.stat.starts) / maxStarts) * 100}%"></div><span>${r.stat.starts}</span></td>
      <td>${r.stat.loads}</td>
      <td>${r.stat.overs}</td>
      <td>${r.stat.avg_score ?? "—"}</td>
      <td>${r.stat.best_score ?? "—"}</td>
      <td>${r.players}</td>
    </tr>`
    )
    .join("");
  const totals = rows.reduce(
    (a, r) => ({ loads: a.loads + Number(r.stat.loads), starts: a.starts + Number(r.stat.starts), players: a.players + r.players }),
    { loads: 0, starts: 0, players: 0 }
  );
  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Daily Games 통계</title>
<style>${SHELL_CSS}
.kpis{display:flex;gap:14px;flex-wrap:wrap;justify-content:center;margin-bottom:28px}
.kpi{background:#12152b;border:1px solid #23284a;border-radius:16px;padding:16px 24px;text-align:center;min-width:120px}
.kpi b{display:block;font-size:28px;font-weight:900}
.kpi span{font-size:12px;color:#9aa0c0}
.tblwrap{width:min(920px,100%);overflow-x:auto;background:#12152b;border:1px solid #23284a;border-radius:18px;padding:8px}
table{width:100%;border-collapse:collapse;font-size:14px;min-width:640px}
th{font-size:11px;color:#6f76a8;text-transform:uppercase;letter-spacing:1px;text-align:left;padding:12px 10px;border-bottom:1px solid #23284a}
td{padding:12px 10px;border-bottom:1px solid #1a1e3a;color:#e8eaff}
tr:last-child td{border-bottom:none}
td.g a{color:#fff;text-decoration:none;font-weight:700}
td.g a:hover{color:#3b9bff}
td.g .d{font-size:11px;color:#6f76a8}
.bar-cell{min-width:140px;position:relative}
.bar{height:18px;background:linear-gradient(90deg,#3bff8a,#3b9bff);border-radius:6px;display:inline-block;vertical-align:middle;min-width:2px}
.bar-cell span{margin-left:8px;font-weight:700}
</style></head>
<body><h1>📊 STATS</h1><p class="sub">플레이 데이터 (실시간, 60초 캐시) · <a class="nav" href="/">← 게임 목록</a></p>
<div class="kpis">
  <div class="kpi"><b>${rows.length}</b><span>게임 수</span></div>
  <div class="kpi"><b>${totals.starts}</b><span>총 플레이</span></div>
  <div class="kpi"><b>${totals.loads}</b><span>총 방문</span></div>
  <div class="kpi"><b>${totals.players}</b><span>랭킹 참여</span></div>
</div>
<div class="tblwrap"><table>
<thead><tr><th>게임</th><th>플레이</th><th>방문</th><th>완주</th><th>평균점수</th><th>최고점수</th><th>랭킹 참여</th></tr></thead>
<tbody>${trs}</tbody>
</table></div>
<footer>플레이 = 게임 시작 횟수 · 방문 = 페이지 로드 · 완주 = 게임오버 도달</footer></body></html>`;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    const path = url.pathname;

    if (path === "/healthz") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      return res.end("ok");
    }
    if (path === "/") {
      const games = await sb("games?select=slug,title,day,description,emoji,published_on&order=day.desc");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(hubPage(games));
    }
    if (path === "/stats") {
      // 관리자 전용: ?key=... 로 최초 접속하면 쿠키가 심어져 이후엔 /stats만으로 접근 가능
      if (STATS_KEY) {
        const cookies = req.headers.cookie || "";
        const hasCookie = cookies.split(";").some((c) => c.trim() === `stats_auth=${STATS_KEY}`);
        const keyParam = url.searchParams.get("key");
        if (keyParam === STATS_KEY) {
          const rows = await statsData();
          res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Set-Cookie": `stats_auth=${STATS_KEY}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`,
          });
          return res.end(statsPage(rows));
        }
        if (!hasCookie) {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          return res.end("Not Found");
        }
      }
      const rows = await statsData();
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(statsPage(rows));
    }
    const m = path.match(/^\/games\/([a-z0-9-]{1,50})\/?$/);
    if (m) {
      const rows = await sb(`games?slug=eq.${m[1]}&select=html`);
      if (rows.length) {
        // 지금 보는 게임이 최신작이 아니면 '오늘의 신작' 배너를 붙인다
        let promo = null;
        try { const n = await newestGame(); if (n && n.slug !== m[1]) promo = n; } catch (e) {}
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=60" });
        return res.end(injectPromo(rows[0].html, promo));
      }
    }
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end('<meta charset="utf-8"><body style="background:#0d0f1e;color:#9aa0c0;font-family:sans-serif;text-align:center;padding-top:30vh">404 — 게임을 찾을 수 없어요 · <a href="/" style="color:#3b9bff">홈으로</a></body>');
  } catch (e) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("server error");
  }
});

server.listen(PORT, () => console.log(`daily-games server on :${PORT}`));
