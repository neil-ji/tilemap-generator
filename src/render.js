/* ============ 渲染：地图缓存合成 + 网格/动画/整帧 ============ */
import { TILE, hash2 } from './util.js';
import { TERRAIN } from './terrain.js';
import { cellTile, bridgeTileCached } from './tiles.js';

export function bridgeAxis(x,y,grid,w,h){
  const n=y>0?grid[y-1][x]:null, s=y<h-1?grid[y+1][x]:null, wc=x>0?grid[y][x-1]:null, ec=x<w-1?grid[y][x+1]:null;
  const isW=(c)=> c==='~';
  if(isW(n)&&isW(s)) return 'h';
  if(isW(wc)&&isW(ec)) return 'v';
  return 'h';
}
export function buildMapCache(m){
  const {grid,w,h}=m;
  const cache=document.createElement('canvas'); cache.width=w*TILE; cache.height=h*TILE;
  const ctx=cache.getContext('2d');
  const nmap=(c)=> c==='B'?'R':c;
  const nbrs=(x,y)=>({ n:y>0?nmap(grid[y-1][x]):null, s:y<h-1?nmap(grid[y+1][x]):null, w:x>0?nmap(grid[y][x-1]):null, e:x<w-1?nmap(grid[y][x+1]):null,
    nw:(y>0&&x>0)?nmap(grid[y-1][x-1]):null, ne:(y>0&&x<w-1)?nmap(grid[y-1][x+1]):null,
    sw:(y<h-1&&x>0)?nmap(grid[y+1][x-1]):null, se:(y<h-1&&x<w-1)?nmap(grid[y+1][x+1]):null });
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const t=grid[y][x], px=x*TILE, py=y*TILE;
    if(t==='B'){ ctx.drawImage(bridgeTileCached(bridgeAxis(x,y,grid,w,h)),px,py); }
    else {
      ctx.drawImage(cellTile(t,nbrs(x,y),x,y),px,py);
      const nb=nbrs(x,y);
      for(const d of ['n','s','w','e']){ const v=nb[d]; if(v && TERRAIN[v] && TERRAIN[v].elev>TERRAIN[t].elev){ const diff=TERRAIN[v].elev-TERRAIN[t].elev; const a=Math.min(0.32,0.09+diff*0.07), a2=a*0.3;
        if(d==='n'){ ctx.fillStyle='rgba(0,0,0,'+a+')'; ctx.fillRect(px,py,TILE,1); ctx.fillStyle='rgba(0,0,0,'+a2+')'; ctx.fillRect(px,py+1,TILE,1); }
        else if(d==='s'){ ctx.fillStyle='rgba(0,0,0,'+a+')'; ctx.fillRect(px,py+TILE-1,TILE,1); ctx.fillStyle='rgba(0,0,0,'+a2+')'; ctx.fillRect(px,py+TILE-2,TILE,1); }
        else if(d==='w'){ ctx.fillStyle='rgba(0,0,0,'+a+')'; ctx.fillRect(px,py,1,TILE); ctx.fillStyle='rgba(0,0,0,'+a2+')'; ctx.fillRect(px+1,py,1,TILE); }
        else { ctx.fillStyle='rgba(0,0,0,'+a+')'; ctx.fillRect(px+TILE-1,py,1,TILE); ctx.fillStyle='rgba(0,0,0,'+a2+')'; ctx.fillRect(px+TILE-2,py,1,TILE); } } }
      for(const d of ['n','s','w','e']){ const v=nb[d]; if(v && TERRAIN[v] && TERRAIN[t].elev-TERRAIN[v].elev>=2){ ctx.fillStyle='rgba(0,0,0,0.2)';
        if(d==='n')ctx.fillRect(px,py,TILE,1); else if(d==='s')ctx.fillRect(px,py+TILE-1,TILE,1);
        else if(d==='w')ctx.fillRect(px,py,1,TILE); else ctx.fillRect(px+TILE-1,py,1,TILE); } }
    }
  }
  return cache;
}
export function drawGridOverlay(ctx,w,h){
  ctx.strokeStyle='rgba(0,0,0,0.14)'; ctx.lineWidth=1;
  for(let x=0;x<=w;x++){ ctx.beginPath(); ctx.moveTo(x*TILE+0.5,0); ctx.lineTo(x*TILE+0.5,h*TILE); ctx.stroke(); }
  for(let y=0;y<=h;y++){ ctx.beginPath(); ctx.moveTo(0,y*TILE+0.5); ctx.lineTo(w*TILE,y*TILE+0.5); ctx.stroke(); }
}
export function drawAnim(ctx,map,now,speed){
  const g=map.grid, w=map.w, h=map.h; const sp=speed;
  const river=map.river||new Set();
  const t=now/1000*sp;
  ctx.save(); ctx.globalCompositeOperation='lighter';
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){ const c=g[y][x]; const px=x*TILE, py=y*TILE;
    if(c==='~'){
      if(river.has(x+','+y)){ const k=hash2(x,y,5);
        const fx=Math.floor(k*16+t*3.2)%16, fy=Math.floor((k*5+t*0.9))%16;
        ctx.globalAlpha=0.3; ctx.fillStyle='#dcefff'; ctx.fillRect(px+fx,py+fy,3,1);
        ctx.globalAlpha=0.18; ctx.fillStyle='#f0faff'; ctx.fillRect(px+((fx+4)%16),py+((fy+3)%16),2,1);
      } else { const k=hash2(x,y,1);
        const dx1=Math.floor(k*16+t*2.2)%16, dy1=Math.floor((k*7+t*1.1))%16;
        const dx2=Math.floor((k*11+t*1.3+5)%16), dy2=Math.floor((k*3+t*1.7+16)%16);
        ctx.globalAlpha=0.35; ctx.fillStyle='#cfe8ff'; ctx.fillRect(px+dx1,py+dy1,2,1);
        ctx.globalAlpha=0.22; ctx.fillStyle='#eaf6ff'; ctx.fillRect(px+dx2,py+dy2,2,1);
      }
    } else if(c==='L'){ const k=hash2(x,y,3); const pulse=0.5+0.3*Math.sin(t*3+k*6.28);
      ctx.globalAlpha=pulse*0.55; ctx.fillStyle='#ffc060';
      const dx=Math.floor(k*16+t)%16, dy=Math.floor((k*5+t*0.7)%16); ctx.fillRect(px+dx,py+dy,2,2);
    } }
  ctx.restore(); ctx.globalAlpha=1;
}
export function drawFrame(ctx, cacheCanvas, map, ui, now){
  ctx.imageSmoothingEnabled=false;
  ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height);
  ctx.drawImage(cacheCanvas,0,0);
  if(ui.anim) drawAnim(ctx, map, now||performance.now(), ui.speed);
  if(ui.grid) drawGridOverlay(ctx, map.w, map.h);
}
