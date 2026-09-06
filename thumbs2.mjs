/** 살아 있는 플레이 프레임을 전체(390x844)로 남긴다 → thumbs/full/<slug>.png */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const W = 390, H = 844, OUT = '/home/claude/quality-audit/thumbs/full';
mkdirSync(OUT, { recursive: true });
const PLAY_MS = { 'brick-orbit': 5000, 'dot-atelier': 5000, 'brush-path': 4500, 'star-well': 5000, 'dasi-soop': 5000 };
const START_RE_SRC = /(시작|스타트|start|play|플레이|하기|입장|고고|출발|도전|들다|띄우기|오르기|잔치)/i;
const START_RE = /(시작|스타트|start|play|플레이|하기|입장|고고|출발|도전|들다|띄우기|오르기|잔치)/i;
const OVER_RE = /(게임\s*오버|game\s*over|다시|재도전|리트라이|retry|기록|최고 기록|결과|클리어|완성|닉네임)/i;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const slugs = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const slug of slugs) {
  const playMs = PLAY_MS[slug] || 4000;
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR' });
  const page = await ctx.newPage();
  await page.route('**://*.supabase.co/**', r => r.abort());
  await page.route(/(fonts\.googleapis|fonts\.gstatic|google\.com|gstatic\.com)/, r => r.abort());
  await page.goto(`file:///home/claude/quality-audit/games/${slug}/index.html?test=1`, { waitUntil: 'load', timeout: 20000 });
  await sleep(1400);
  const click = async (re) => { for (const el of await page.$$('button,[role="button"],.btn,a,.modebtn,.tile,.mapbtn')) {
      try { if (!(await el.isVisible())) continue; const t = ((await el.innerText()) || '').trim();
        if (t && re.test(t)) { await el.click({ timeout: 1200 }); return t; } } catch {} } return null; };
  // 게임 자체 상태 훅으로 '진짜 플레이 중'인지 본다 (훅이 없으면 null → 오버레이 검사로 대체)
  const inPlay = () => page.evaluate(() => {
    const g = window.GAME || window.__test || window.__game || null; if (!g) return null;
    const s = g.S || g.state || g;
    const v = (s && (s.screen ?? s.mode)) ?? (typeof g.state === 'string' ? g.state : null);
    return typeof v === 'string' ? /play/i.test(v) : null; });
  const overlayUp = () => page.evaluate((src) => { const rx = new RegExp(src, 'i');
      const vis = (e) => { const s = getComputedStyle(e); const r = e.getBoundingClientRect();
        return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > .05 && r.width > 120 && r.height > 60; };
      for (const e of document.querySelectorAll('div,section')) if (vis(e) && rx.test(e.innerText || '')) return true;
      return false; }, OVER_RE.source);

  if (slug === 'dot-atelier') { await click(/연습/); await sleep(500);
    const t = await page.$('#mapList .mapbtn'); if (t) await t.click().catch(()=>{}); await sleep(2800);
    await page.screenshot({ path: `${OUT}/${slug}.png` }); await ctx.close(); console.log(slug, 'ok(map)'); continue; }

  if (slug === 'brush-path') { await click(START_RE); await sleep(500);
    for (let n = 0; n < 4; n++) {
      const pl = await page.evaluate(() => { const S = window.GAME.S, i = S.islands.findIndex(a => a.x + a.w > S.tiger.x);
        const a = S.islands[i], b = S.islands[i + 1]; if (!a || !b) return null;
        return { x1: a.x + a.w - 8 - S.camX, y1: a.y - 1, x2: b.x + 16 - S.camX, y2: b.y - 1 }; });
      if (!pl) break;
      await page.mouse.move(pl.x1, pl.y1); await page.mouse.down();
      for (let i = 1; i <= 12; i++) await page.mouse.move(pl.x1 + (pl.x2 - pl.x1) * i / 12, pl.y1 + (pl.y2 - pl.y1) * i / 12);
      await page.mouse.up(); await sleep(900);
      if (!(await overlayUp())) await page.screenshot({ path: `${OUT}/${slug}.png` });
    }
    await ctx.close(); console.log(slug, 'ok(draw)'); continue; }

  const a = await click(START_RE); await sleep(500);
  if (!a) { await page.mouse.click(W / 2, H / 2); await sleep(400); } else await click(START_RE);
  await sleep(700);
  const t0 = Date.now(); let i = 0, saved = 0;
  while (Date.now() - t0 < playMs) {
    const x = 60 + ((i * 97) % (W - 120)), y = 220 + ((i * 137) % (H - 380));
    if (i % 3 === 2) { await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(W - x, y - 90, { steps: 6 }); await page.mouse.up(); }
    else await page.mouse.click(x, y);
    i++; await sleep(150);
    const live = i % 3 === 0 ? (await inPlay()) : undefined;
    if (i % 3 === 0 && (live === true || (live === null && !(await overlayUp())))) { await page.screenshot({ path: `${OUT}/${slug}.png` }); saved++; }
  }
  console.log(slug, saved ? `ok(${saved} live frames)` : 'NO LIVE FRAME');
  if (!saved) await page.screenshot({ path: `${OUT}/${slug}.png` });
  await ctx.close();
}
await browser.close();
