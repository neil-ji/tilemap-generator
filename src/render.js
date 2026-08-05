/* ============ 渲染：地图缓存合成 + 网格/动画/整帧 ============ */
import { TILE, hash2 } from './util.js';
import { TERRAIN } from './terrain.js';
import { renderCell } from './tiles.js';

/* ============ 高度差覆盖层（post-blit） ============
   Phase 1：纯渲染增强，复用邻格 elev，零数据改动、不影响签名缓存。
   diff==1 缓坡 = 低格投影加深 + 高格 1px 亮唇边（受光）；
   diff>=2 崖壁 = 高格 3px 岩壁断面条（1px 近黑边 + 2px 压暗基色 + 岩类层理）+ 低格投影加深；
   低格为海洋 ~ 时投影减弱（水下崖基）。拐角/交界各自 fillRect 自然重叠成 L/T 形。 */
const ROCKY={ T:1,C:1,K:1 };
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

export function buildMapCache(m){
  const {grid,w,h}=m;
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
    /* 高度差覆盖层（post-blit，复用邻格 elev，零数据改动、不影响签名缓存）：
       dh>0 邻格更高 → 本格为低格，画朝向高格的投影（diff==1 缓坡 0.28 / diff>=2 崖壁 0.42，海洋中减弱）；
       dh<0 邻格更低 → 本格为高格，画朝向低格的 1px 亮唇边（缓坡）或 3px 岩壁断面条（崖壁）；
       拐角/交界各自 fillRect 自然重叠成 L/T 形。 */
    for(const d of ['n','s','w','e']){
      const v=nb[d]; if(!v || !TERRAIN[v]) continue;
      const dh=TERRAIN[v].elev-TERRAIN[t].elev;
      if(dh>0){
        let a=dh===1?0.28:0.42, a2=a*0.35;
        if(t==='~'){ a*=0.3; a2*=0.3; } /* 水下崖基：海洋中投影减弱 */
        let r=edgeOuter(d,px,py,1); ctx.fillStyle='rgba(0,0,0,'+a+')'; ctx.fillRect(r[0],r[1],r[2],r[3]);
        r=edgeInner(d,px,py,1); ctx.fillStyle='rgba(0,0,0,'+a2+')'; ctx.fillRect(r[0],r[1],r[2],r[3]);
      } else if(dh===-1){
        drawLip(ctx,px,py,d,t);
      } else if(dh<=-2){
        drawCliff(ctx,px,py,d,t);
      }
    }
  }
  cache.animCells=animCells;
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
  if(ui.anim && cacheCanvas.animCells && cacheCanvas.animCells.length) drawAnim(ctx, cacheCanvas.animCells, now||performance.now(), ui.speed);
  if(ui.grid) drawGridOverlay(ctx, map.w, map.h);
}
