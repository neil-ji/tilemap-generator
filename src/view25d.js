/* ============ 2.5D 等距视图（Phase A 原型 + Phase B 侧壁强化 + Phase C 动画/覆盖层） ============
   等距 2:1 菱形投影：顶面 = 现有 cacheCanvas（2D buildMapCache 产物，已含过渡/道路/特效）按
     菱形区域做仿射逆映射最近邻采样（等价旋转 45° + 纵压 0.5），顶面零改动复用 2D 纹理成果。
   高度层叠：heights（Float64Array 0..1）量化到 Z_STEPS 层，顶面沿屏幕 Y 抬升 z·STEP；
     相邻格高度差在南/东两条可见菱形边画侧壁平行四边形（垂直落差 = 层差·STEP）→ 真实悬崖/阶梯。
   painter：按 depth = x+y 升序分桶逐格绘制（侧壁先、顶面后）。
     Phase B 鲁棒性：侧壁底边精确止于邻格（南 y+1 / 东 x+1）顶面顶边（几何恒等式），后画
     （更大 depth = 更近相机）的格用顶面盖住前格侧壁底边 → 极端高度差（深渊裂隙 Y ↔ 高原）
     无穿插、无漏缝；同 depth 格沿对角相接不重叠，桶内按 z 升序确定性绘制。
   Phase B 侧壁视觉：按地形材质分类切面色（岩类 T/C/K/V 灰棕切面+层理、雪 W/X 偏白、沙漠 E/S 偏黄、
     土壤/草地土色切面）+ 层理横线（每 4-6px 一道，厚壁才明显）+ hash2 碎屑 + 顶缘受光亮线（呼应 2D 唇边）
     + 高度差越大侧壁越深（悬崖更醒目）。只读 mapgen/heights/terrain/tiles，不写签名缓存；2D 路径完全不动。
   Phase C：每帧在静态帧上增量绘制——水/岩浆动画（animCells 粒子按世界→等距仿射投影成顶面
     平行四边形，图案与 render.js drawAnim 一致）、海拔着色/等高线 overlay（懒构建投影图层，开关零重建）、
     菱形网格线。绘制序与 2D drawFrame 对齐：静态 → tint → contour → anim → grid。
   res>1：顶面从 2× 最近邻放大 cacheCanvas 采样（菱形 64×32），用于对比 16px 清晰度（关键验证点）。 */
import { TILE, hash2, mix } from './util.js';
import { TERRAIN } from './terrain.js';

export const ISO_W = 32;    /* 菱形外接宽（源 16px 顶面，2:1） */
export const ISO_H = 16;    /* 菱形外接高 */
export const STEP = 3;      /* 每高度层垂直抬升像素（屏幕 Y） */
export const Z_STEPS = 8;   /* 高度量化层数（heights 0..1 → 0..Z_STEPS-1） */
const ROCKY = { T:1, C:1, K:1, V:1, X:1 };   /* 与 render.js 同：岩类（侧壁层理强化） */

/* 侧壁材质切面参数（Phase B）：blend=基色向切面色混入比、dark=基准亮度（壁顶）、
   bedding=层理间距 px（0=无，dz≥2 厚壁才启用）、beddingA=层理线暗化、debris=岩屑密度、cast=切面色。
   风格与 2D drawCliff 基色压暗+层理一致（render.js:35-52），按地形材质分类不跳色。 */
const WALL_MAT = {
  rock:     { blend:0.62, dark:0.52, bedding:6, beddingA:0.24, debris:0.10, cast:[124,118,132] },
  snowrock: { blend:0.55, dark:0.60, bedding:6, beddingA:0.16, debris:0.08, cast:[196,202,216] },
  snow:     { blend:0.45, dark:0.68, bedding:0, beddingA:0.12, debris:0.05, cast:[238,244,252] },
  desert:   { blend:0.50, dark:0.56, bedding:8, beddingA:0.16, debris:0.06, cast:[206,178,128] },
  earth:    { blend:0.65, dark:0.50, bedding:0, beddingA:0.14, debris:0.05, cast:[108,78,48] },
  stone:    { blend:0.55, dark:0.50, bedding:6, beddingA:0.18, debris:0.08, cast:[118,120,130] },
  lava:     { blend:0.45, dark:0.46, bedding:0, beddingA:0.18, debris:0.06, cast:[150,60,30] },
  water:    { blend:0.40, dark:0.46, bedding:0, beddingA:0.10, debris:0.03, cast:[44,74,124] },
};
/* 地形 → 侧壁材质（岩切面灰棕、雪地偏白、沙漠偏黄、土壤/草地土色、建材石板；R 经 effT 解析为基底） */
function wallMaterial(ch){
  if (ch === 'W') return 'snow';
  if (ch === 'X') return 'snowrock';
  if (ch === 'T' || ch === 'C' || ch === 'K' || ch === 'V') return 'rock';
  if (ch === 'E' || ch === 'S' || ch === '@') return 'desert';
  if (ch === 'P' || ch === 'O' || ch === '#') return 'stone';
  if (ch === 'L') return 'lava';
  if (ch === '~' || ch === 'U' || ch === 'A' || ch === 'Y') return 'water';
  return 'earth';   /* D/G/H/R/Z/Q/M/N/F 及兜底 */
}

/* 顶面菱形采样表（cell 无关，按 res 一次缓存）：
   每条 = 输出菱形内像素 (dx,dy) 对应源 16×16 单元内偏移 (sox,soy)（res 像素单位，最近邻取整）。
   关键：共享菱形边两侧的格子在源顶面是同一批像素（边界列），投影后连续无缝。 */
const tableCache = new Map();
export function diamondTable(res){
  let t = tableCache.get(res); if (t) return t;
  const DW = ISO_W * res, DH = ISO_H * res, cellPx = TILE * res;
  const out = [];
  for (let dy = 0; dy < DH; dy++){
    const halfW = DW / 2 * (1 - Math.abs(2 * dy / DH - 1));   /* 该行菱形半宽 */
    const UY = dy / (DH / 2);
    for (let dx = 0; dx < DW; dx++){
      const X = dx - DW / 2;
      if (Math.abs(X) > halfW) continue;                      /* 菱形外（透明） */
      const UX = X / (DW / 2);
      const u = (UX + UY) / 2, v = (UY - UX) / 2;             /* 逆映射 iso→源 0..1 */
      out.push({ dx, dy, sox: Math.round(u * cellPx), soy: Math.round(v * cellPx) });
    }
  }
  tableCache.set(res, out); return out;
}

/* 地形基色（4 采样平均，与 render.js baseColor 一致）：侧壁压暗基底 */
const _base = {};
function baseColor(ch){
  let c = _base[ch]; if (c) return c;
  const f = TERRAIN[ch].color, s = TERRAIN[ch].seed;
  const p = [[7,7],[8,8],[7,8],[8,7]];
  c = [0,0,0];
  for (let i = 0; i < 4; i++){ const q = f(p[i][0], p[i][1], s); c[0] += q[0]; c[1] += q[1]; c[2] += q[2]; }
  c[0] >>= 2; c[1] >>= 2; c[2] >>= 2;
  return _base[ch] = c;
}
/* 有效地形：R 格按 roadBase 基底取侧壁色（与 render.js effT 同哲学） */
function effT(m, x, y){
  const t = m.grid[y][x];
  if (t !== 'R') return t;
  return (m.roadBase && m.roadBase[y * m.w + x]) || 'G';
}

/* 侧壁填充：平行四边形，顶边 = 菱形可见边（南 L→B / 东 R→B），垂直落差 Δ = 层差·STEP。
   世界坐标入参（px=X、py=Y），写出时加 offX/offY。列循环：每列顶边 yTop = Y0+16S-|px-X0|·0.5。
   Phase B：材质切面色（岩/雪/沙/土分类）+ 层理横线 + 碎屑 + 顶缘受光亮线 + 高度差越深越暗。
   d = 距壁顶像素距离：d<1 行被本格顶面覆盖（顶面后画），可见顶缘从 d≈1 起。 */
function fillWall(data, outW, outH, offX, offY, X0, Y0, Δ, dz, S, ch, xa, xb){
  const base = baseColor(ch);
  const mat = WALL_MAT[wallMaterial(ch)] || WALL_MAT.earth;
  const col = mix(base, mat.cast, mat.blend);               /* 材质切面色（浮点） */
  const heightDark = Math.min(0.12, (dz - 1) * 0.020);      /* 差 1 层最亮，差多层（悬崖）越深 */
  const cxa = Math.max(0, Math.ceil(offX + xa)), cxb = Math.min(outW - 1, Math.floor(offX + xb));
  for (let cx = cxa; cx <= cxb; cx++){
    const px = cx - offX;                                    /* 世界 X */
    const yTop = Y0 + 16 * S - Math.abs(px - X0) * 0.5;
    const yBot = yTop + Δ;
    const cy0 = Math.max(0, Math.ceil(offY + yTop)), cy1 = Math.min(outH - 1, Math.floor(offY + yBot));
    for (let cy = cy0; cy <= cy1; cy++){
      const d = cy - offY - yTop;                            /* 距壁顶像素距离 */
      const fromTop = d / Δ;                                 /* 0..1：0=壁顶 1=壁底 */
      let k = mat.dark - fromTop * 0.11 - heightDark;        /* 上亮下暗 + 悬崖越深越暗 */
      /* 层理：沿壁高每 bedding px 一道淡暗横线（平行壁顶缘），厚壁（dz≥2）才明显 */
      if (mat.bedding && dz >= 2 && (Math.round(d) % mat.bedding) === 0) k *= (1 - mat.beddingA);
      k *= 0.94 + hash2(px, cy - offY, 151) * 0.12;          /* 每像素碎屑噪声 */
      if (hash2(px, cy - offY, 203) < mat.debris) k *= 0.80; /* 稀疏深色岩屑 */
      /* 顶缘受光亮线：d<1 行被顶面覆盖，d∈[1,3) 为可见壁顶缘，加法提亮成受光亮带（呼应 2D 唇边） */
      if (d < 3){
        const t = 1 - d / 3;
        k = k * (1 + 0.5 * t) + 0.18 * t;
      }
      const i = (cy * outW + cx) * 4;
      data[i]   = Math.min(255, Math.max(0, col[0] * k));
      data[i+1] = Math.min(255, Math.max(0, col[1] * k));
      data[i+2] = Math.min(255, Math.max(0, col[2] * k));
      data[i+3] = 255;
    }
  }
}

/* 等距帧合成（一次性）：返回静态 canvas（含顶面 + 抬升 + 侧壁），挂 .meta 供 drawFrame25D。
   输入 m = mapgen 返回对象，cacheCanvas = buildMapCache(m)（顶面纹理源）。 */
export function buildMapCache25D(m, cacheCanvas, opts){
  const S = (opts && opts.res) || 1;
  const { grid, w, h } = m;
  const heights = m.heights || null;
  const DW = ISO_W * S, DH = ISO_H * S, cellPx = TILE * S;
  /* 高度量化 + 最大抬升（画布高度） */
  const zs = new Int16Array(w * h);
  let maxZ = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const hh = heights ? heights[y * w + x] : 0;
    const z = Math.min(Z_STEPS - 1, Math.max(0, Math.floor(hh * Z_STEPS)));
    zs[y * w + x] = z; if (z > maxZ) maxZ = z;
  }
  /* 画布（res 单位）：世界 X∈[-h·16S, w·16S]，Y∈[-maxZ·STEP·S, (w+h-2)·8S+16S] */
  const offX = h * 16 * S, offY = maxZ * STEP * S;
  const outW = (w + h) * 16 * S + 1;
  const outH = (w + h - 2) * 8 * S + 16 * S + maxZ * STEP * S + 1;

  const out = document.createElement('canvas'); out.width = outW; out.height = outH;
  const octx = out.getContext('2d');
  const img = octx.createImageData(outW, outH);
  const data = img.data;

  /* 顶面源：res>1 时最近邻放大 cacheCanvas（手动逐像素，与浏览器/Node shim 一致），逐像素采样无平滑 */
  let srcCv = cacheCanvas;
  if (S > 1){
    const sw2 = cacheCanvas.width * S, sh2 = cacheCanvas.height * S;
    srcCv = document.createElement('canvas'); srcCv.width = sw2; srcCv.height = sh2;
    const sctx = srcCv.getContext('2d');
    const s = cacheCanvas.getContext('2d').getImageData(0, 0, cacheCanvas.width, cacheCanvas.height);
    const oi = sctx.createImageData(sw2, sh2);
    const so = s.data, oo = oi.data;
    for (let y = 0; y < sh2; y++){ const sy = (y / S) | 0, sr = sy * cacheCanvas.width;
      for (let x = 0; x < sw2; x++){ const sx = (x / S) | 0;
        const a = (sr + sx) * 4, b = (y * sw2 + x) * 4;
        oo[b] = so[a]; oo[b+1] = so[a+1]; oo[b+2] = so[a+2]; oo[b+3] = 255; } }
    sctx.putImageData(oi, 0, 0);
  }
  const srcW = srcCv.width, srcH = srcCv.height;
  const srcData = srcCv.getContext('2d').getImageData(0, 0, srcW, srcH).data;

  /* painter：depth = x+y 升序分桶（鲁棒，Phase B）。
     正确性不变量：每格侧壁底边精确止于邻格（南 y+1 / 东 x+1）顶面顶边 —— 几何恒等式
       (yTop + Δ = 邻格 T 顶点 Y)，后画（更大 depth = 更近相机）的格用顶面盖住前格侧壁底边，
       极端高度差（深渊裂隙 Y ↔ 高原，Δ 达 21px）下仍无穿插、无漏缝。
     同 depth 格沿对角排布、菱形外接宽 32S 恰相接不重叠 → 桶内顺序无关（z 升序确定性兜底）。 */
  const buckets = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const d = x + y;
    (buckets[d] || (buckets[d] = [])).push(y * w + x);
  }
  const table = diamondTable(S);
  const srcMaxX = srcW - 1, srcMaxY = srcH - 1;
  for (let d = 0; d < buckets.length; d++){
    const bk = buckets[d]; if (!bk) continue;
    if (bk.length > 1) bk.sort((a, b) => zs[a] - zs[b]);   /* 同 depth 内 z 升序，确定性 */
    for (let k = 0; k < bk.length; k++){
      const idx = bk[k];
      const x = idx % w, y = (idx / w) | 0;
      const z = zs[idx];
      const X0 = (x - y) * 16 * S, Y0 = (x + y) * 8 * S - z * STEP * S;
      /* 侧壁（先画，顶面后画覆盖边界 → 边缘像素是顶面，壁无缝贴合） */
      const ch = effT(m, x, y);
      const dzS = (y + 1 < h) ? z - zs[idx + w] : 0;
      const dzE = (x + 1 < w) ? z - zs[idx + 1] : 0;
      if (dzS > 0) fillWall(data, outW, outH, offX, offY, X0, Y0, dzS * STEP * S, dzS, S, ch, X0 - 16 * S, X0);
      if (dzE > 0) fillWall(data, outW, outH, offX, offY, X0, Y0, dzE * STEP * S, dzE, S, ch, X0, X0 + 16 * S);
      /* 顶面：菱形区域采样（最近邻） */
      const gx0 = x * cellPx, gy0 = y * cellPx;
      const cxBase = offX + X0 - DW / 2, cyBase = offY + Y0;
      for (let i = 0; i < table.length; i++){
        const e = table[i];
        let sx = gx0 + e.sox, sy = gy0 + e.soy;
        if (sx < 0) sx = 0; else if (sx > srcMaxX) sx = srcMaxX;
        if (sy < 0) sy = 0; else if (sy > srcMaxY) sy = srcMaxY;
        const si = (sy * srcW + sx) * 4;
        const di = ((cyBase + e.dy) * outW + (cxBase + e.dx)) * 4;
        data[di] = srcData[si]; data[di+1] = srcData[si+1]; data[di+2] = srcData[si+2]; data[di+3] = 255;
      }
    }
  }
  octx.putImageData(img, 0, 0);
  out.meta = { offX, offY, res: S, maxZ, zs, w, h };
  /* Phase C 依赖：可动格（水/岩浆，render.js 预生成）与 2D overlay 源（海拔着色/等高线）。
     动画深度序预排序（depth=x+y，与静态帧 painter 同序），每帧直接按序画，无需重排。 */
  out.animCells = cacheCanvas.animCells || [];
  const aOrd = out.animCells.map((_, i) => i);
  aOrd.sort((a, b) => (out.animCells[a].x + out.animCells[a].y) - (out.animCells[b].x + out.animCells[b].y));
  out.animOrder = aOrd;
  out._srcTint = cacheCanvas.tintCanvas || null;
  out._srcContour = cacheCanvas.contourCanvas || null;
  return out;
}

/* 每帧：blit 静态等距帧 + 海拔着色/等高线 overlay + 水/岩浆动画 + 菱形网格。
   Phase C：overlay 与动画均按顶面投影增量绘制，静态帧缓存零重建。
   绘制序与 2D drawFrame 对齐（静态 → tint → contour → anim → grid）。 */
export function drawFrame25D(ctx, cache25D, map, ui, now){
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.drawImage(cache25D, 0, 0);
  if (ui.tint && cache25D._srcTint) drawIsoOverlay(ctx, cache25D, cache25D._srcTint, 'tintCanvas');
  if (ui.contour && cache25D._srcContour) drawIsoOverlay(ctx, cache25D, cache25D._srcContour, 'contourCanvas');
  if (ui.anim && cache25D.animCells && cache25D.animCells.length)
    drawIsoAnim(ctx, cache25D, now || performance.now(), (typeof ui.speed === 'number') ? ui.speed : 1);
  if (ui.grid) drawIsoGrid(ctx, cache25D);
}

/* Phase C：把 2D overlay（tintCanvas/contourCanvas，w·16 × h·16）按等距投影重采样为全尺寸图层。
   与静态帧同 painter（depth=x+y 升序）：深格后写覆盖浅格，图层内遮挡关系与静态帧一致。
   懒构建（首次需要时），开关切换零重建；S>1 时按最近邻从基分辨率 overlay 采样。 */
function buildIsoOverlay(cache25D, srcOverlay){
  const meta = cache25D.meta, S = meta.res, { offX, offY, zs, w, h } = meta;
  const outW = cache25D.width, outH = cache25D.height;
  const cv = document.createElement('canvas'); cv.width = outW; cv.height = outH;
  const octx = cv.getContext('2d');
  const img = octx.createImageData(outW, outH);
  const data = img.data;
  const sw2 = srcOverlay.width, sh2 = srcOverlay.height;
  const src = srcOverlay.getContext('2d').getImageData(0, 0, sw2, sh2).data;
  const table = diamondTable(S);
  const DW = ISO_W * S;
  const order = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) order.push(y * w + x);
  order.sort((a, b) => ((a % w) + ((a / w) | 0)) - ((b % w) + ((b / w) | 0)));
  for (const idx of order){
    const x = idx % w, y = (idx / w) | 0;
    const z = zs[idx];
    const X0 = (x - y) * 16 * S, Y0 = (x + y) * 8 * S - z * STEP * S;
    const cxBase = offX + X0 - DW / 2, cyBase = offY + Y0;
    const bx0 = x * TILE, by0 = y * TILE;
    for (let i = 0; i < table.length; i++){
      const e = table[i];
      let bx = bx0 + ((e.sox / S) | 0), by = by0 + ((e.soy / S) | 0);
      if (bx >= sw2) bx = sw2 - 1;   /* 全局右/下边缘：菱形顶点采样出界时钳到源末像素（同主循环） */
      if (by >= sh2) by = sh2 - 1;
      const bi = by * sw2 + bx;
      const di = ((cyBase + e.dy) * outW + (cxBase + e.dx)) * 4;
      data[di] = src[bi * 4]; data[di + 1] = src[bi * 4 + 1]; data[di + 2] = src[bi * 4 + 2]; data[di + 3] = src[bi * 4 + 3];
    }
  }
  octx.putImageData(img, 0, 0);
  return cv;
}
function drawIsoOverlay(ctx, cache25D, srcOverlay, key){
  let layer = cache25D[key];
  if (!layer){ layer = cache25D[key] = buildIsoOverlay(cache25D, srcOverlay); }
  ctx.drawImage(layer, 0, 0);
}

/* Phase C：源 16px 单元内矩形 (fx,fy,pw,ph) → 菱形顶面仿射投影路径（canvas 坐标，含抬升 z）。
   变换：菱形局部 (DX,DY) = (DW/2 + (fx−fy)·S, (fx+fy)·S/2)，再加格原点 (offX+X0, offY+Y0)。
   源矩形四角在仿射映射下仍是平行四边形 → path fill 即精确投影（顶面零重采样）。 */
function isoRectPath(ctx, meta, x, y, z, fx, fy, pw, ph, style, alpha){
  const S = meta.res;
  const X0 = (x - y) * 16 * S, Y0 = (x + y) * 8 * S - z * STEP * S;
  const ox = meta.offX + X0, oy = meta.offY + Y0;
  ctx.fillStyle = style; ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.moveTo(Math.round(ox + (fx - fy) * S), Math.round(oy + (fx + fy) * S / 2));
  ctx.lineTo(Math.round(ox + (fx + pw - fy) * S), Math.round(oy + (fx + fy + pw) * S / 2));
  ctx.lineTo(Math.round(ox + (fx + pw - fy - ph) * S), Math.round(oy + (fx + fy + pw + ph) * S / 2));
  ctx.lineTo(Math.round(ox + (fx - fy - ph) * S), Math.round(oy + (fx + fy + ph) * S / 2));
  ctx.closePath(); ctx.fill();
}

/* Phase C：水/岩浆动画粒子投影到菱形顶面。图案逻辑与 render.js drawAnim 完全一致
   （同一 16px 单元内的波浪/脉冲位置与颜色/alpha），仅放置方式不同：2D 版在格内画平铺 rect，
   此处把该矩形仿射投影成顶面平行四边形。animOrder 已在 buildMapCache25D 预按 depth=x+y 排序，
   动画层内部遮挡关系与静态帧同序。 */
function drawIsoAnim(ctx, cache25D, now, speed){
  const meta = cache25D.meta, zs = meta.zs, w = meta.w, h = meta.h;
  const t = now / 1000 * speed;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < cache25D.animOrder.length; i++){
    const c = cache25D.animCells[cache25D.animOrder[i]];
    const x = c.x, y = c.y, z = zs[y * w + x];
    if (c.ty === '~'){
      if (c.rv){ const k = c.kr;
        const fx = Math.floor(k * 16 + t * 3.2) % 16, fy = Math.floor(k * 5 + t * 0.9) % 16;
        isoRectPath(ctx, meta, x, y, z, fx, fy, 3, 1, '#dcefff', 0.3);
        isoRectPath(ctx, meta, x, y, z, (fx + 4) % 16, (fy + 3) % 16, 2, 1, '#f0faff', 0.18);
      } else { const k = c.k;
        const dx1 = Math.floor(k * 16 + t * 2.2) % 16, dy1 = Math.floor(k * 7 + t * 1.1) % 16;
        const dx2 = Math.floor((k * 11 + t * 1.3 + 5) % 16), dy2 = Math.floor((k * 3 + t * 1.7 + 16) % 16);
        isoRectPath(ctx, meta, x, y, z, dx1, dy1, 2, 1, '#cfe8ff', 0.35);
        isoRectPath(ctx, meta, x, y, z, dx2, dy2, 2, 1, '#eaf6ff', 0.22);
      }
    } else { const k = c.k, pulse = 0.5 + 0.3 * Math.sin(t * 3 + k * 6.28);
      const dx = Math.floor(k * 16 + t) % 16, dy = Math.floor(k * 5 + t * 0.7) % 16;
      isoRectPath(ctx, meta, x, y, z, dx, dy, 2, 2, '#ffc060', pulse * 0.55);
    }
  }
  ctx.restore(); ctx.globalAlpha = 1;
}

/* 静态导出合成：静态帧 + 海拔着色/等高线 overlay（与 2D 导出一致：不含网格与动画）。 */
export function composeFrame25D(cache25D, ui){
  const cv = document.createElement('canvas'); cv.width = cache25D.width; cv.height = cache25D.height;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(cache25D, 0, 0);
  if (ui.tint && cache25D._srcTint) drawIsoOverlay(ctx, cache25D, cache25D._srcTint, 'tintCanvas');
  if (ui.contour && cache25D._srcContour) drawIsoOverlay(ctx, cache25D, cache25D._srcContour, 'contourCanvas');
  return cv;
}

function drawIsoGrid(ctx, cache25D){
  const meta = cache25D.meta, S = meta.res, { offX, offY, zs } = meta;
  const w = meta.w, h = meta.h;
  ctx.strokeStyle = 'rgba(0,0,0,0.16)'; ctx.lineWidth = 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const z = zs[y * w + x];
    const X0 = offX + (x - y) * 16 * S, Y0 = offY + (x + y) * 8 * S - z * STEP * S;
    ctx.beginPath();
    ctx.moveTo(X0, Y0);
    ctx.lineTo(X0 + 16 * S, Y0 + 8 * S);
    ctx.lineTo(X0, Y0 + 16 * S);
    ctx.lineTo(X0 - 16 * S, Y0 + 8 * S);
    ctx.closePath();
    ctx.stroke();
  }
}
