/* ============ 渲染：地图缓存合成 + 网格/动画/整帧 ============ */
import { TILE, hash2 } from './util.js';
import { TERRAIN } from './terrain.js';
import { renderCell } from './tiles.js';

/* ============ 高度差覆盖层（post-blit，Phase 1 + Phase 2） ============
   Phase 1：复用邻格 elev（地形类型属性），零数据改动、不影响签名缓存。
     diff==1 缓坡 = 低格投影加深 + 高格 1px 亮唇边（受光）；
     diff>=2 崖壁 = 高格 3px 岩壁断面条（1px 近黑边 + 2px 压暗基色 + 岩类层理）+ 低格投影加深；
     低格为海洋 ~ 时投影减弱（水下崖基）。拐角/交界各自 fillRect 自然重叠成 L/T 形。
   Phase 2：新增并行高度层 heights（mapgen 返回的连续海拔场，Float64Array w*h，零新增计算）。
     同地形内相邻格 |Δhh|>阈值 → 真实高度差浮雕：低格投影 + 高格亮唇，alpha 随 |Δhh| 缩放，
     让大面积草地/泥地等原本同材质无起伏的区域出现连续起伏阴影。
     另有可选覆盖层：海拔着色（hypsometric 罩）与等高线（固定 hh 阈值淡线），默认关、可切换，
     绘制在独立 overlay canvas 上由 drawFrame 叠加，不改动字符层与签名缓存。 */
const ROCKY={ T:1,C:1,K:1,V:1,X:1 };   /* 岩类：断面条加层理 */
const _base={};
function baseColor(ch){ /* 该地形 4 采样平均基色，供唇边/断面条提亮与压暗 */
  let c=_base[ch]; if(c) return c;
  const f=TERRAIN[ch].color,s=TERRAIN[ch].seed;
  const p=[[7,7],[8,8],[7,8],[8,7]];
  c=[0,0,0];
  for(let i=0;i<4;i++){ const q=f(p[i][0],p[i][1],s); c[0]+=q[0]; c[1]+=q[1]; c[2]+=q[2]; }
  c[0]>>=2; c[1]>>=2; c[2]>>=2;
  return _base[ch]=c;
}
/* 与格边齐平的 th-px 条 / 距格边 1px 起的 th-px 条（按方向） */
function edgeOuter(d,px,py,th){ if(d==='n')return [px,py,TILE,th]; if(d==='s')return [px,py+TILE-th,TILE,th]; if(d==='w')return [px,py,th,TILE]; return [px+TILE-th,py,th,TILE]; }
function edgeInner(d,px,py,th){ if(d==='n')return [px,py+1,TILE,th]; if(d==='s')return [px,py+TILE-1-th,TILE,th]; if(d==='w')return [px+1,py,th,TILE]; return [px+TILE-1-th,py,th,TILE]; }
function drawLip(ctx,px,py,d,ch){ /* 缓坡亮唇：高格朝低格 1px 受光窄边（基色暖提亮） */
  const b=baseColor(ch);
  ctx.fillStyle='rgba('+Math.min(255,b[0]+58)+','+Math.min(255,b[1]+48)+','+Math.min(255,b[2]+36)+',0.35)';
  const r=edgeOuter(d,px,py,1); ctx.fillRect(r[0],r[1],r[2],r[3]);
}
function drawCliff(ctx,px,py,d,ch){ /* 崖壁断面条：高格朝低格 3px（近黑边 + 压暗 40% 基色） */
  const b=baseColor(ch);
  const r=edgeOuter(d,px,py,1); ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(r[0],r[1],r[2],r[3]);
  const q=edgeInner(d,px,py,2);
  ctx.fillStyle='rgb('+(b[0]*0.6|0)+','+(b[1]*0.6|0)+','+(b[2]*0.6|0)+')'; ctx.fillRect(q[0],q[1],q[2],q[3]);
  const horiz=(d==='n'||d==='s');
  if(ROCKY[ch]){ /* 岩类：弱层理（每 4px 淡暗线）+ hash2 岩屑，保持断面整体感 */
    ctx.fillStyle='rgba(0,0,0,0.2)';
    for(let k=0;k<4;k++){ if(horiz)ctx.fillRect(q[0]+k*4,q[1],1,q[3]); else ctx.fillRect(q[0],q[1]+k*4,q[2],1); }
    ctx.fillStyle='rgba(0,0,0,0.15)';
    for(let k=0;k<2;k++){ const u=(hash2(px,py,k+37)*TILE)|0, o=(hash2(px,py,k+91)*2)|0;
      if(horiz)ctx.fillRect(q[0]+u,q[1]+o,1,1); else ctx.fillRect(q[0]+o,q[1]+u,1,1); }
  } else { /* 非岩类：少量碎屑 */
    ctx.fillStyle='rgba(0,0,0,0.15)';
    for(let k=0;k<2;k++){ const u=(hash2(px,py,k+73)*TILE)|0, o=(hash2(px,py,k+13)*2)|0;
      if(horiz)ctx.fillRect(q[0]+u,q[1]+o,1,1); else ctx.fillRect(q[0]+o,q[1]+u,1,1); }
  }
}
/* ---- Phase 2 高度层浮雕参数 ---- */
const DIRXY={ n:[-1,0], s:[1,0], w:[0,-1], e:[0,1] };
const HH_TH=0.04;             /* 邻差 |Δhh| 低于此忽略（fbm 天然高频，避免碎影） */
const HH_SHADOW=0.30;         /* 高度投影最大 alpha */
const HH_LIP=0.20;            /* 高度亮唇最大 alpha */
const NO_RELIEF={ '~':1,'U':1,'A':1,'L':1 };  /* 水体/岩浆不参与高度浮雕（河流盖章会伪造 hh 阶跃） */
function drawHHShadow(ctx,px,py,d,a){
  let r=edgeOuter(d,px,py,1); ctx.fillStyle='rgba(0,0,0,'+a.toFixed(3)+')'; ctx.fillRect(r[0],r[1],r[2],r[3]);
  r=edgeInner(d,px,py,1); ctx.fillStyle='rgba(0,0,0,'+(a*0.35).toFixed(3)+')'; ctx.fillRect(r[0],r[1],r[2],r[3]);
}
function drawHHLip(ctx,px,py,d,ch,a){
  const b=baseColor(ch);
  ctx.fillStyle='rgba('+Math.min(255,b[0]+42)+','+Math.min(255,b[1]+34)+','+Math.min(255,b[2]+24)+','+a.toFixed(3)+')';
  const r=edgeOuter(d,px,py,1); ctx.fillRect(r[0],r[1],r[2],r[3]);
}
/* ---- Phase 2 海拔着色（hypsometric 罩）：低→蓝、中→绿/暖、高→白，默认关 ---- */
const TINT_STOPS=[ [0.00,[30,80,170]],[0.30,[64,128,200]],[0.42,[122,176,118]],[0.60,[226,202,142]],[0.80,[250,240,214]],[1.00,[255,255,252]] ];
function tintColor(hh){
  const s=TINT_STOPS;
  if(hh<=s[0][0]) return s[0][1];
  for(let i=1;i<s.length;i++){
    if(hh<=s[i][0]){ const h0=s[i-1][0],c0=s[i-1][1],h1=s[i][0],c1=s[i][1]; const t=(hh-h0)/(h1-h0);
      return [(c0[0]+(c1[0]-c0[0])*t)|0,(c0[1]+(c1[1]-c0[1])*t)|0,(c0[2]+(c1[2]-c0[2])*t)|0]; }
  }
  return s[s.length-1][1];
}
function buildTintCanvas(m){
  const {grid,w,h,heights}=m; if(!heights) return null;
  const cv=document.createElement('canvas'); cv.width=w*TILE; cv.height=h*TILE;
  const ctx=cv.getContext('2d');
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const ch=grid[y][x];
    let col,a;
    if(ch==='U'){ col=[24,64,150]; a=0.16; }        /* 深水 bathymetric */
    else if(ch==='~'){ col=[44,100,180]; a=0.08; }
    else if(ch==='A'){ col=[90,150,210]; a=0.05; }
    else if(ch==='@'){ col=[150,130,90]; a=0.05; }
    else if(ch==='L') continue;                     /* 岩浆不罩 */
    else { const hh=heights[y*w+x]; col=tintColor(hh); a=Math.min(0.20,0.07+Math.max(0,hh-0.42)*0.18); }
    ctx.fillStyle='rgba('+col[0]+','+col[1]+','+col[2]+','+a.toFixed(3)+')';
    ctx.fillRect(x*TILE,y*TILE,TILE,TILE);
  }
  return cv;
}
/* ---- Phase 2 等高线：固定 hh 阈值处画 1px 淡线（每格只看北/西边避免重复） ----
   邻差 < HH_CONT_MIN 视为近平坦噪声（fbm 微扰），跳过以避免平地碎线段。 */
const HH_LEVELS=[0.40,0.52,0.64,0.76,0.88];
const HH_CONT_MIN=0.02;
function buildContourCanvas(m){
  const {w,h,heights}=m; if(!heights) return null;
  const cv=document.createElement('canvas'); cv.width=w*TILE; cv.height=h*TILE;
  const ctx=cv.getContext('2d');
  ctx.strokeStyle='rgba(110,88,60,0.4)'; ctx.lineWidth=1;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const v=heights[y*w+x];
    if(y>0){ const nv=heights[(y-1)*w+x];
      if(Math.abs(v-nv)>HH_CONT_MIN){ for(let k=0;k<HH_LEVELS.length;k++){ const lv=HH_LEVELS[k];
        if((v>=lv)!==(nv>=lv)){ ctx.beginPath(); ctx.moveTo(x*TILE,y*TILE+0.5); ctx.lineTo(x*TILE+TILE,y*TILE+0.5); ctx.stroke(); break; } } } }
    if(x>0){ const wv=heights[y*w+x-1];
      if(Math.abs(v-wv)>HH_CONT_MIN){ for(let k=0;k<HH_LEVELS.length;k++){ const lv=HH_LEVELS[k];
        if((v>=lv)!==(wv>=lv)){ ctx.beginPath(); ctx.moveTo(x*TILE+0.5,y*TILE); ctx.lineTo(x*TILE+0.5,y*TILE+TILE); ctx.stroke(); break; } } } }
  }
  return cv;
}

export function buildMapCache(m){
  const {grid,w,h}=m;
  const heights=m.heights||null;
  const cache=document.createElement('canvas'); cache.width=w*TILE; cache.height=h*TILE;
  const ctx=cache.getContext('2d');
  const nmap=(c)=> c;
  /* 单个 ImageData buffer 复用：逐格覆盖写入，消除每格 createImageData/putImageData 分配 */
  const img=ctx.createImageData(TILE,TILE);
  /* 预生成可动格列表（水/岩浆）与每格的静态哈希，动画只遍历该列表 */
  const river=m.river||new Set();
  const animCells=[];
  const nbrs=(x,y)=>({ n:y>0?nmap(grid[y-1][x]):null, s:y<h-1?nmap(grid[y+1][x]):null, w:x>0?nmap(grid[y][x-1]):null, e:x<w-1?nmap(grid[y][x+1]):null,
    nw:(y>0&&x>0)?nmap(grid[y-1][x-1]):null, ne:(y>0&&x<w-1)?nmap(grid[y-1][x+1]):null,
    sw:(y<h-1&&x>0)?nmap(grid[y+1][x-1]):null, se:(y<h-1&&x<w-1)?nmap(grid[y+1][x+1]):null });
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const t=grid[y][x], px=x*TILE, py=y*TILE;
    if(t==='~'){ const rv=river.has(x+','+y)?1:0; animCells.push({x,y,ty:'~',rv,k:hash2(x,y,1),kr:rv?hash2(x,y,5):0}); }
    else if(t==='L') animCells.push({x,y,ty:'L',k:hash2(x,y,3)});
    const nb=nbrs(x,y); /* 与下方海拔阴影/悬崖棱线共用一次邻接计算 */
    const flatTile=renderCell(t,nb,img,x,y);
    if(flatTile) ctx.drawImage(flatTile,px,py); else ctx.putImageData(img,px,py);
    const hh0=heights?heights[y*w+x]:0;
    /* 高度差覆盖层（post-blit）：Phase 1 邻格 elev + Phase 2 同地形高度层，各边独立 fillRect 自然构成 L/T 拐角 */
    for(const d of ['n','s','w','e']){
      const v=nb[d]; if(!v || !TERRAIN[v]) continue;
      const dh=TERRAIN[v].elev-TERRAIN[t].elev;
      if(dh>0){ /* 邻格更高 → 低格投影 */
        let a=dh===1?0.28:0.42, a2=a*0.35;
        if(t==='~'){ a*=0.3; a2*=0.3; } /* 水下崖基：海洋中投影减弱 */
        let r=edgeOuter(d,px,py,1); ctx.fillStyle='rgba(0,0,0,'+a+')'; ctx.fillRect(r[0],r[1],r[2],r[3]);
        r=edgeInner(d,px,py,1); ctx.fillStyle='rgba(0,0,0,'+a2+')'; ctx.fillRect(r[0],r[1],r[2],r[3]);
      } else if(dh===-1){ /* 高格朝低格 1px 亮唇 */
        drawLip(ctx,px,py,d,t);
      } else if(dh<=-2){ /* 高格朝低格 3px 崖壁断面条 */
        drawCliff(ctx,px,py,d,t);
      } else if(v===t && heights && !NO_RELIEF[t]){ /* Phase 2：同地形内真实高度差浮雕 */
        const dd=DIRXY[d], dhh=heights[(y+dd[0])*w+(x+dd[1])]-hh0;
        if(dhh>HH_TH){ drawHHShadow(ctx,px,py,d,Math.min(HH_SHADOW,0.09+dhh*0.5)); }
        else if(dhh<-HH_TH){ drawHHLip(ctx,px,py,d,t,Math.min(HH_LIP,0.05-dhh*0.35)); }
      }
    }
  }
  cache.animCells=animCells;
  /* Phase 2 可选覆盖层（海拔着色 / 等高线），默认关、由 drawFrame 叠加；不参与签名缓存 */
  cache.tintCanvas=buildTintCanvas(m);
  cache.contourCanvas=buildContourCanvas(m);
  return cache;
}
export function drawGridOverlay(ctx,w,h){
  ctx.strokeStyle='rgba(0,0,0,0.14)'; ctx.lineWidth=1;
  for(let x=0;x<=w;x++){ ctx.beginPath(); ctx.moveTo(x*TILE+0.5,0); ctx.lineTo(x*TILE+0.5,h*TILE); ctx.stroke(); }
  for(let y=0;y<=h;y++){ ctx.beginPath(); ctx.moveTo(0,y*TILE+0.5); ctx.lineTo(w*TILE,y*TILE+0.5); ctx.stroke(); }
}
export function drawAnim(ctx,cells,now,speed){
  const t=now/1000*speed;
  ctx.save(); ctx.globalCompositeOperation='lighter';
  for(let i=0;i<cells.length;i++){ const c=cells[i], px=c.x*TILE, py=c.y*TILE;
    if(c.ty==='~'){
      if(c.rv){ const k=c.kr;
        const fx=Math.floor(k*16+t*3.2)%16, fy=Math.floor((k*5+t*0.9))%16;
        ctx.globalAlpha=0.3; ctx.fillStyle='#dcefff'; ctx.fillRect(px+fx,py+fy,3,1);
        ctx.globalAlpha=0.18; ctx.fillStyle='#f0faff'; ctx.fillRect(px+((fx+4)%16),py+((fy+3)%16),2,1);
      } else { const k=c.k;
        const dx1=Math.floor(k*16+t*2.2)%16, dy1=Math.floor((k*7+t*1.1))%16;
        const dx2=Math.floor((k*11+t*1.3+5)%16), dy2=Math.floor((k*3+t*1.7+16)%16);
        ctx.globalAlpha=0.35; ctx.fillStyle='#cfe8ff'; ctx.fillRect(px+dx1,py+dy1,2,1);
        ctx.globalAlpha=0.22; ctx.fillStyle='#eaf6ff'; ctx.fillRect(px+dx2,py+dy2,2,1);
      }
    } else { const k=c.k; const pulse=0.5+0.3*Math.sin(t*3+k*6.28);
      ctx.globalAlpha=pulse*0.55; ctx.fillStyle='#ffc060';
      const dx=Math.floor(k*16+t)%16, dy=Math.floor((k*5+t*0.7)%16); ctx.fillRect(px+dx,py+dy,2,2);
    } }
  ctx.restore(); ctx.globalAlpha=1;
}
export function drawFrame(ctx, cacheCanvas, map, ui, now){
  ctx.imageSmoothingEnabled=false;
  ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height);
  ctx.drawImage(cacheCanvas,0,0);
  if(ui.tint && cacheCanvas.tintCanvas) ctx.drawImage(cacheCanvas.tintCanvas,0,0);
  if(ui.contour && cacheCanvas.contourCanvas) ctx.drawImage(cacheCanvas.contourCanvas,0,0);
  if(ui.anim && cacheCanvas.animCells && cacheCanvas.animCells.length) drawAnim(ctx, cacheCanvas.animCells, now||performance.now(), ui.speed);
  if(ui.grid) drawGridOverlay(ctx, map.w, map.h);
}
