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
  const cards = games
    .map(
      (g) => `
    <a class="card" href="/games/${esc(g.slug)}/">
      <div class="day">DAY ${g.day} · ${esc(g.published_on)}</div>
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
      const games = await sb("games?select=slug,title,day,description,emoji,published_on&order=day.asc");
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
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=60" });
        return res.end(rows[0].html);
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
