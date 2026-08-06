/* ============ 导出：地图 PNG + 瓦片集 sprite sheet ============
   「导出地图 PNG」复用 buildMapCache 的 cacheCanvas（已含过渡瓦片 + 高度差覆盖层），
   再把海拔着色/等高线 overlay canvas 按当前开关状态 drawImage 合成到目标 canvas，
   渲染核心零改动；网格线、水/岩浆动画属于 UI 动态覆盖层，不导出。
   「导出地图 PNG（2.5D）」复用 buildMapCache25D 的静态等距帧快照（顶面 + 抬升 + 侧壁），
   同样不含网格/动画——与 2D 一致，网格属 UI 动态覆盖层；文件名为 tilemap-<mapId>-<seed>-25d.png。
   「导出瓦片集」遍历 PALETTE_ORDER 基础瓦片 + 代表过渡对（2×2 块）绘制为带标注图集，
   供外部复用；块布局 = A 基色｜A←上B｜A←左B｜B 基色。 */
import { TILE } from './util.js';
import { TERRAIN, PALETTE_ORDER } from './terrain.js';
import { baseOf, tileCanvas } from './tiles.js';

/* 代表过渡对：覆盖水陆 / 湿地 / 森林 / 高地 / 雪线 / 建筑 / 岩浆等主要视觉过渡（非全量 26×26） */
export const EXPORT_PAIRS = [
  ['~','S'],   /* 海洋 ↔ 沙滩 */
  ['~','A'],   /* 海洋 ↔ 浅滩 */
  ['U','~'],   /* 深水 ↔ 海洋 */
  ['A','S'],   /* 浅滩 ↔ 沙滩 */
  ['S','@'],   /* 沙滩 ↔ 泥滩 */
  ['G','H'],   /* 草地 ↔ 森林 */
  ['G','M'],   /* 草地 ↔ 沼泽 */
  ['Z','G'],   /* 草原灌木 ↔ 草地 */
  ['D','M'],   /* 泥地 ↔ 沼泽 */
  ['G','Q'],   /* 草地 ↔ 高原草甸 */
  ['E','G'],   /* 沙漠 ↔ 草地 */
  ['T','V'],   /* 岩石 ↔ 碎石坡 */
  ['T','X'],   /* 岩石 ↔ 雪岩 */
  ['W','X'],   /* 雪地 ↔ 雪岩 */
  ['F','N'],   /* 冰原 ↔ 苔原 */
  ['C','P'],   /* 岩壁 ↔ 石板地板 */
  ['P','#'],   /* 石板地板 ↔ 木地板 */
  ['L','K'],   /* 岩浆 ↔ 焦土 */
];

/* 触发浏览器下载。toBlob 在沙箱 headless 环境可能缺失或永不回调：
   优先 toBlob（内存友好），2s 超时或回调 null 时回退 toDataURL。 */
export function downloadCanvas(canvas, filename){
  const a=document.createElement('a');
  a.download=filename;
  let called=false;
  const fire=(url)=>{ if(called) return; called=true; a.href=url; document.body.appendChild(a); a.click(); setTimeout(()=>a.remove(),0); };
  if(typeof canvas.toBlob==='function' && typeof Blob!=='undefined'){
    let timer=setTimeout(()=>{ clearTimeout(timer); fire(canvas.toDataURL('image/png')); }, 2000);
    canvas.toBlob((blob)=>{ clearTimeout(timer);
      if(blob){ fire(URL.createObjectURL(blob)); } else { fire(canvas.toDataURL('image/png')); }
    }, 'image/png');
  } else {
    fire(canvas.toDataURL('image/png'));
  }
}

/* 地图 PNG：cacheCanvas + 海拔着色/等高线 overlay（按当前开关），无网格/动画 */
export function exportMapPNG(map, cacheCanvas, ui){
  const w=map.w*TILE, h=map.h*TILE;
  const cv=document.createElement('canvas'); cv.width=w; cv.height=h;
  const ctx=cv.getContext('2d');
  ctx.imageSmoothingEnabled=false;
  ctx.drawImage(cacheCanvas,0,0);
  if(ui.tint && cacheCanvas.tintCanvas) ctx.drawImage(cacheCanvas.tintCanvas,0,0);
  if(ui.contour && cacheCanvas.contourCanvas) ctx.drawImage(cacheCanvas.contourCanvas,0,0);
  return cv;
}

/* 地图 PNG（2.5D）：导出 buildMapCache25D 的静态等距帧（顶面 + 抬升 + 侧壁）快照。
   返回 { canvas, filename }：canvas 为该帧像素拷贝（与页面所见一致，但剔除网格——网格属 UI
   动态覆盖层，与 2D 导出同理），filename = tilemap-<mapId>-<seed>-25d.png。 */
export function exportMapPNG25D(cache25D, mapId, seed){
  const cv = document.createElement('canvas'); cv.width = cache25D.width; cv.height = cache25D.height;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(cache25D, 0, 0);
  return { canvas: cv, filename: 'tilemap-' + (mapId || 'map') + '-' + seed + '-25d.png' };
}

/* 瓦片集 sprite sheet：26 基础瓦片（PALETTE_ORDER 顺序，2 行）+ 代表过渡对 2×2 块 */
export function buildTilesetCanvas(){
  const PAD=12, TITLE_H=24, BASE_COLS=13, BASE_COLW=44, BASE_CELLH=32;
  const n=PALETTE_ORDER.length;
  const baseRows=Math.ceil(n/BASE_COLS);
  const baseW=BASE_COLS*BASE_COLW, baseH=baseRows*BASE_CELLH;
  const SLOT_W=66, SLOT_H=50;
  const pairPerRow=Math.max(1, Math.floor(baseW/SLOT_W));
  const pairRows=Math.ceil(EXPORT_PAIRS.length/pairPerRow);
  const W=PAD*2+Math.max(baseW, pairPerRow*SLOT_W);
  /* 高度与绘制 y 递进一致：基础标题 + 基础瓦片 + 过渡标题 + 过渡标题行 + 过渡瓦片行，
     标题行与瓦片间的一行 TITLE_H 不能漏算，否则末行瓦片被裁掉 */
  const H=PAD+TITLE_H+baseH+TITLE_H+TITLE_H+pairRows*SLOT_H+PAD;

  const cv=document.createElement('canvas'); cv.width=W; cv.height=H;
  const ctx=cv.getContext('2d');
  ctx.fillStyle='#17171c'; ctx.fillRect(0,0,W,H);
  ctx.textAlign='center'; ctx.textBaseline='top';
  ctx.font="10px 'PingFang SC','Microsoft YaHei',system-ui,sans-serif";

  /* ---- 基础瓦片 ---- */
  ctx.fillStyle='#cfd3dc'; ctx.font='bold 12px '+"'PingFang SC','Microsoft YaHei',system-ui,sans-serif";
  ctx.fillText('基础瓦片（'+n+' 地形 · '+TILE+'×'+TILE+'）', W/2, PAD);
  let y=PAD+TITLE_H;
  ctx.font="10px 'PingFang SC','Microsoft YaHei',system-ui,sans-serif";
  for(let i=0;i<n;i++){
    const [ch]=PALETTE_ORDER[i];
    const col=i%BASE_COLS, row=(i/BASE_COLS)|0;
    const cx=PAD+col*BASE_COLW+BASE_COLW/2, cy=y+row*BASE_CELLH;
    ctx.drawImage(baseOf(ch), cx-TILE/2, cy);
    ctx.fillStyle='#9aa3b2'; ctx.fillText(TERRAIN[ch].name, cx, cy+TILE+2);
  }
  y+=baseH+TITLE_H;

  /* ---- 过渡对 2×2 块：A基色 ｜ A←上B ｜ A←左B ｜ B基色 ---- */
  ctx.fillStyle='#cfd3dc'; ctx.font='bold 12px '+"'PingFang SC','Microsoft YaHei',system-ui,sans-serif";
  ctx.fillText('过渡瓦片（代表 '+EXPORT_PAIRS.length+' 对 · A基色｜A←上B｜A←左B｜B基色）', W/2, y);
  y+=TITLE_H;
  ctx.font="10px 'PingFang SC','Microsoft YaHei',system-ui,sans-serif";
  for(let i=0;i<EXPORT_PAIRS.length;i++){
    const [a,b]=EXPORT_PAIRS[i];
    const col=i%pairPerRow, row=(i/pairPerRow)|0;
    const bx=PAD+col*SLOT_W, by=y+row*SLOT_H;
    ctx.fillStyle='#9aa3b2'; ctx.fillText(TERRAIN[a].name+'↔'+TERRAIN[b].name, bx+SLOT_W/2, by);
    const ox=bx+(SLOT_W-32)/2, oy=by+14;
    ctx.drawImage(baseOf(a), ox, oy);
    ctx.drawImage(tileCanvas(a,b,['n']), ox+TILE, oy);
    ctx.drawImage(tileCanvas(a,b,['w']), ox, oy+TILE);
    ctx.drawImage(baseOf(b), ox+TILE, oy+TILE);
  }
  return cv;
}
