"""전체 세로 스크린샷에서 '가장 볼거리 많은' 16:9 띠를 골라 배너로 자른다.
   기준: 세로 방향 엣지 에너지의 슬라이딩 합 (하늘·단색 여백은 점수가 낮다)."""
import sys, pathlib
from PIL import Image, ImageFilter, ImageStat
SRC = pathlib.Path('/home/claude/quality-audit/thumbs/full')
DST = pathlib.Path('/home/claude/quality-audit/thumbs'); DST.mkdir(exist_ok=True)
BANNER_W, BANNER_H = 720, 405            # 16:9 최종 크기

OVERRIDE = {       # slug: y(device px) — 자동 선택이 주인공을 놓친 게임만 손으로 지정
    'brick-orbit': 40,    # 숫자 벽돌 무리
    'deep-diver': 0,      # 잠수정 + 첫 관문
    'moon-mill': 1249,    # 토끼와 절구 (화면 하단)
    'blizzard-sled': 700, # 개썰매 + 별
    'star-well': 500,     # 몬스터·별 칸이 보이는 구간
    'moon-stairs': 820,   # 아기 고양이와 계단
    'cosmo-pin': 470,     # 행성 중앙
    'dot-atelier': 400,   # 도트 판 (카운트다운 숫자 아래로)
}
for f in sorted(SRC.glob('*.png')):
    im = Image.open(f).convert('RGB')
    W, H = im.size                        # 780 x 1688 (DPR2)
    bh = round(W * 9 / 16)                # 439
    g = im.convert('L').filter(ImageFilter.FIND_EDGES)
    sat = im.convert('HSV').getchannel('S')          # 캐릭터는 배경보다 채도가 높다
    import numpy as np
    ge = np.asarray(g, dtype=float).sum(axis=1)
    se = np.asarray(sat, dtype=float).sum(axis=1)
    rows = list(ge + 0.12 * se)
    # 상단 HUD(점수)만 잡히는 자리를 피하려고 맨 위 8%는 가중치를 낮춘다
    wgt = [0.45 if y < H * 0.08 else 1.0 for y in range(H)]
    rows = [r * w for r, w in zip(rows, wgt)]
    pre = [0]
    for r in rows: pre.append(pre[-1] + r)
    best_y, best = 0, -1
    for y in range(0, H - bh + 1, 4):
        s = pre[y + bh] - pre[y]
        if s > best: best, best_y = s, y
    if f.stem in OVERRIDE: best_y = OVERRIDE[f.stem]
    band = im.crop((0, best_y, W, best_y + bh)).resize((BANNER_W, BANNER_H), Image.LANCZOS)
    band.save(DST / (f.stem + '.webp'), 'WEBP', quality=76, method=6)
    band.save(DST / (f.stem + '.png'))
    kb = (DST / (f.stem + '.webp')).stat().st_size / 1024
    print(f'{f.stem:14s} y={best_y:4d}/{H}  {kb:5.1f}KB')
