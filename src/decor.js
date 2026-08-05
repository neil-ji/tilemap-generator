/* ============ 装饰与房屋 ============ */
import { hash2 } from './util.js';

export function drawShadow(ctx,px,py,rx,ry){ ctx.fillStyle='rgba(0,0,0,0.22)'; ctx.beginPath(); ctx.ellipse(px+8,py+ry, rx,ry*0.45,0,0,Math.PI*2); ctx.fill(); }
export function drawTree(ctx,px,py,type){
  drawShadow(ctx,px,py,5,2);
  if(type==='pine'){
    ctx.fillStyle='#5d3a20'; ctx.fillRect(px+7,py+9,2,5);
    const layers=[[8,1,6],[8,4,8],[8,7,10]];
    ctx.fillStyle='#2a5a34';
    for(const l of layers){ ctx.beginPath(); ctx.moveTo(px+l[0]-l[2],py+l[1]+l[2]); ctx.lineTo(px+l[0],py+l[1]-l[2]); ctx.lineTo(px+l[0]+l[2],py+l[1]+l[2]); ctx.closePath(); ctx.fill(); }
    ctx.fillStyle='#3f7a46';
    for(const l of layers){ ctx.beginPath(); ctx.moveTo(px+l[0]-l[2]*0.5,py+l[1]+l[2]*0.4); ctx.lineTo(px+l[0],py+l[1]-l[2]*0.6); ctx.lineTo(px+l[0]+l[2]*0.5,py+l[1]+l[2]*0.4); ctx.closePath(); ctx.fill(); }
  } else {
    ctx.fillStyle='#5d3a20'; ctx.fillRect(px+7,py+8,3,6);
    ctx.fillStyle='#3a7d2e'; ctx.beginPath(); ctx.arc(px+9,py+6,5.5,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#4c9a3a'; ctx.beginPath(); ctx.arc(px+7,py+5,3.2,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#61b34c'; ctx.beginPath(); ctx.arc(px+8,py+5,1.6,0,Math.PI*2); ctx.fill();
  }
}
export function drawRock(ctx,px,py){
  drawShadow(ctx,px,py,4.5,1.6);
  ctx.fillStyle='#8f8f99'; ctx.beginPath(); ctx.ellipse(px+8,py+10,4.6,3.6,0,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#a8a8b4'; ctx.beginPath(); ctx.ellipse(px+6.4,py+9,2,1.3,0,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#6f6f7c'; ctx.beginPath(); ctx.ellipse(px+10,py+12,2.4,1.4,0,0,Math.PI*2); ctx.fill();
}
export function drawBush(ctx,px,py){
  ctx.fillStyle='#3a7d2e'; ctx.beginPath(); ctx.ellipse(px+8,py+12,4.2,2.6,0,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#4c9a3a'; ctx.beginPath(); ctx.arc(px+6.5,py+11,2.4,0,Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.arc(px+9.5,py+11,2.2,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#61b34c'; ctx.beginPath(); ctx.arc(px+7,py+10.5,1.1,0,Math.PI*2); ctx.fill();
}
export function drawFlower(ctx,px,py){
  const cols=['#e84a4a','#f2c14e','#ffffff','#c770e8']; const col=cols[(hash2(px,py,4)*4)|0];
  ctx.fillStyle=col; ctx.fillRect(px+6,py+11,2,2); ctx.fillRect(px+8,py+9,2,2); ctx.fillRect(px+10,py+11,2,2); ctx.fillRect(px+8,py+13,2,2);
  ctx.fillStyle='#e8d23a'; ctx.fillRect(px+8,py+11,2,2);
}
export function drawHouse(ctx,px,py){
  ctx.save();
  ctx.fillStyle='rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(px+8,py+14.5,6,2,0,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#d8c39a'; ctx.fillRect(px+3,py+7,10,7);
  ctx.fillStyle='#c2ab7e'; ctx.fillRect(px+3,py+12,10,2);
  ctx.fillStyle='#6b4a2f'; ctx.fillRect(px+7,py+10,3,4);
  ctx.fillStyle='#bfe0ee'; ctx.fillRect(px+5,py+9,2,2); ctx.fillRect(px+10,py+9,2,2);
  ctx.fillStyle='#a3432c'; ctx.beginPath(); ctx.moveTo(px+2,py+7); ctx.lineTo(px+8,py+1); ctx.lineTo(px+14,py+7); ctx.closePath(); ctx.fill();
  ctx.fillStyle='#b8553a'; ctx.beginPath(); ctx.moveTo(px+3,py+7); ctx.lineTo(px+8,py+2); ctx.lineTo(px+13,py+7); ctx.closePath(); ctx.fill();
  ctx.fillStyle='#5c5c64'; ctx.fillRect(px+7,py+1,2,2);
  ctx.restore();
}
export function decorFor(t,x,y,seed){
  const r=hash2(x,y,seed*7+13);
  if(t==='G'){ if(r<0.14) return r<0.04?'flower':(r<0.08?'bush':'tree'); if(r<0.19) return 'rock'; }
  if(t==='D'){ if(r<0.22) return 'tree'; if(r<0.26) return 'rock'; }
  if(t==='T'){ if(r<0.09) return 'rock'; if(r<0.12) return 'pine'; }
  if(t==='W'){ if(r<0.14) return 'pine'; if(r<0.17) return 'rock'; }
  if(t==='F'){ if(r<0.05) return 'rock'; }
  return null;
}
