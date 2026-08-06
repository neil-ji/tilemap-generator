/* ============ 2.5D 等距视图（Phase A 原型） ============
   等距 2:1 菱形投影：顶面 = 现有 cacheCanvas（2D buildMapCache 产物，已含过渡/道路/特效）按
     菱形区域做仿射逆映射最近邻采样（等价旋转 45° + 纵压 0.5），顶面零改动复用 2D 纹理成果。
   高度层叠：heights（Float64Array 0..1）量化到 Z_STEPS 层，顶面沿屏幕 Y 抬升 z·STEP；
     相邻格高度差在南/东两条可见菱形边画侧壁平行四边形（垂直落差 = 层差·STEP）→ 真实悬崖/阶梯。
   painter：按 depth = x+y 升序逐格绘制（侧壁先、顶面后），本原型地图高度差下无部分序冲突。
   只读 mapgen/heights/terrain/tiles，不写签名缓存；2D 路径完全不动（本模块不被 2D 模式调用）。
   res>1：顶面从 2× 最近邻放大 cacheCanvas 采样（菱形 64×32），用于对比 16px 清晰度（关键验证点）。
   侧壁色：TERRAIN 基色压暗 + 每像素 hash 碎屑 + 上下亮度渐变（上亮下暗）。 */
import { TILE, hash2 } from './util.js';
import { TERRAIN } from './terrain.js';

export const ISO_W = 32;    /* 菱形外接宽（源 16px 顶面，2:1） */
export const ISO_H = 16;    /* 菱形外接高 */
export const STEP = 3;      /* 每高度层垂直抬升像素（屏幕 Y） */
export const Z_STEPS = 8;   /* 高度量化层数（heights 0..1 → 0..Z_STEPS-1） */
const ROCKY = { T:1, C:1, K:1, V:1, X:1 };   /* 与 render.js 同：岩类（侧壁纹理可强化，Phase B） */

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
   世界坐标入参（px=X、py=Y），写出时加 offX/offY。列循环：每列顶边 yTop = Y0+16S-|px-X0|·0.5。 */
function fillWall(data, outW, outH, offX, offY, X0, Y0, Δ, S, ch, xa, xb){
  const base = baseColor(ch);
  const cxa = Math.max(0, Math.ceil(offX + xa)), cxb = Math.min(outW - 1, Math.floor(offX + xb));
  for (let cx = cxa; cx <= cxb; cx++){
    const px = cx - offX;                                    /* 世界 X */
    const yTop = Y0 + 16 * S - Math.abs(px - X0) * 0.5;
    const yBot = yTop + Δ;
    const cy0 = Math.max(0, Math.ceil(offY + yTop)), cy1 = Math.min(outH - 1, Math.floor(offY + yBot));
    for (let cy = cy0; cy <= cy1; cy++){
      const fromTop = (cy - offY - yTop) / Δ;                /* 0..1：0=壁顶 1=壁底 */
      let k = 0.62 - fromTop * 0.14;                         /* 上亮下暗（顶面受光） */
      k *= 0.9 + hash2(px, cy - offY, 151) * 0.2;            /* 每像素碎屑噪声 */
      const i = (cy * outW + cx) * 4;
      data[i] = Math.min(255, base[0] * k);
      data[i+1] = Math.min(255, base[1] * k);
      data[i+2] = Math.min(255, base[2] * k);
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

  /* painter：depth = x+y 升序（同深度无横向重叠，顺序无关；高度差部分序本原型不触发） */
  const order = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) order.push(y * w + x);
  order.sort((a, b) => ((a % w) + ((a / w) | 0)) - ((b % w) + ((b / w) | 0)));

  const table = diamondTable(S);
  const srcMaxX = srcW - 1, srcMaxY = srcH - 1;
  for (const idx of order){
    const x = idx % w, y = (idx / w) | 0;
    const z = zs[idx];
    const X0 = (x - y) * 16 * S, Y0 = (x + y) * 8 * S - z * STEP * S;
    /* 侧壁（先画，顶面后画覆盖边界 → 边缘像素是顶面，壁无缝贴合） */
    const ch = effT(m, x, y);
    const dzS = (y + 1 < h) ? z - zs[idx + w] : 0;
    const dzE = (x + 1 < w) ? z - zs[idx + 1] : 0;
    if (dzS > 0) fillWall(data, outW, outH, offX, offY, X0, Y0, dzS * STEP * S, S, ch, X0 - 16 * S, X0);
    if (dzE > 0) fillWall(data, outW, outH, offX, offY, X0, Y0, dzE * STEP * S, S, ch, X0, X0 + 16 * S);
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
  octx.putImageData(img, 0, 0);
  out.meta = { offX, offY, res: S, maxZ, zs, w, h };
  return out;
}

/* 每帧：blit 静态等距帧 + 可选菱形网格（动画/覆盖层 Phase C 接入，原型不做） */
export function drawFrame25D(ctx, cache25D, map, ui, now){
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.drawImage(cache25D, 0, 0);
  if (ui.grid) drawIsoGrid(ctx, cache25D);
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
