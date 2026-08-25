// Daily Games server — Supabase DB에 저장된 게임 HTML을 서빙
// 게임 추가는 git push 없이 games 테이블 insert만으로 반영됩니다.
const http = require("http");

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_KEY;
const PORT = process.env.PORT || 10000;
const TTL_MS = 60 * 1000; // 60초 캐시

const cache = new Map();
async function sb(path) {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.t < TTL_MS) return hit.v;
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!r.ok) throw new Error(`supabase ${r.status}`);
  const v = await r.json();
  cache.set(path, { t: Date.now(), v });
  return v;
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function hubPage(games) {
  const cards = games
    .map(
      (g) => `
    <a class="card" href="/games/${esc(g.slug)}/">
      <div class="day">DAY ${g.day} · ${esc(g.published_on)}</div>
      <h2>${esc(g.title)}</h2>
      <div class="desc">${esc(g.description)}</div>
    </a>`
    )
    .join("");
  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Daily Games</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{min-height:100vh;background:#0d0f1e;color:#fff;font-family:'Segoe UI','Apple SD Gothic Neo','Noto Sans KR',sans-serif;display:flex;flex-direction:column;align-items:center;padding:48px 20px}
h1{font-size:40px;font-weight:900;letter-spacing:1px;background:linear-gradient(90deg,#ff3b6b,#ffd93b,#3bff8a,#3b9bff);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
p.sub{color:#9aa0c0;margin:10px 0 36px;font-size:14px;text-align:center}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;width:min(920px,100%)}
a.card{display:block;background:#12152b;border:1px solid #23284a;border-radius:18px;padding:22px;text-decoration:none;color:#fff;transition:transform .12s,border-color .12s}
a.card:hover{transform:translateY(-3px);border-color:#3b9bff}
.card .day{font-size:12px;color:#6f76a8;letter-spacing:1px}
.card h2{font-size:22px;margin:6px 0 8px}
.card .desc{font-size:13px;color:#9aa0c0;line-height:1.5}
</style></head>
<body><h1>DAILY GAMES</h1><p class="sub">매일 하나씩, Claude와 함께 만드는 게임</p>
<div class="grid">${cards || '<p class="sub">아직 게임이 없어요</p>'}</div></body></html>`;
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
      const games = await sb("games?select=slug,title,day,description,published_on&order=day.asc");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(hubPage(games));
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
