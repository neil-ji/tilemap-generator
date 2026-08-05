/* ============ 瓦片生成（含过渡） ============ */
import { TILE, clamp, hash2, mix, wob } from './util.js';
import { TERRAIN } from './terrain.js';

/* 像素风过渡：过渡带内逐像素在 A/主导邻居间按世界坐标哈希阈值抖动选择（纯色块，无平滑渐变）。
   世界坐标阈值保证相邻两格在共享缝线上逐像素一致、无缝隙；图鉴 blob 模式沿用 2×2 Bayer。 */
export function pixelColor(Acolor, contribs, x, y, mode, wx, wy){
  if(!contribs.length) return {color:Acolor,p:-99,nb:null};
  let best=contribs[0];
  for(let i=1;i<contribs.length;i++) if(contribs[i].bl>best.bl) best=contribs[i];
  if(best.bl<=0.001) return {color:Acolor,p:-99,nb:null};
  if(best.bl>=0.999) return {color:best.color,p:best.p,nb:best.nb};
  let dithered;
  if(mode==='seam'){
    const th=hash2(wx,wy,9911);
    dithered= best.bl>th ? best.color : Acolor;
  } else {
    const bayer=((best.u&1)?(best.v&1?1:3):(best.v&1?2:0));
    const th=(bayer+0.5)/4;
    dithered= best.bl>th ? best.color : Acolor;
  }
  return {color:dithered, p:best.p, nb:best.nb};
}
/* 对称配对种子：相邻两格对同一条格缝使用同一波浪边界，保证过渡对齐无缝隙 */
export function pairSeed(a,b){ const sa=TERRAIN[a].seed, sb=TERRAIN[b].seed; const lo=Math.min(sa,sb), hi=Math.max(sa,sb); return lo*4096+hi; }
/* seam=地图模式：边界沿格缝随噪声蜿蜒，相邻两格各出半条抖动过渡（缝线处逐像素一致）；
   blob=图鉴模式：边界在瓦片中部，B 从指定边缘侵占（经典 Wang 表现）。
   对角 dir 用"到共享角像素距离"做圆角鼓包，两格在同一世界角上结果一致。 */
export function distFor(dir,x,y,ps,mode){
  if(mode==='seam'){
    if(dir==='n') return wob(x,ps)-y;
    if(dir==='s') return y-16-wob(x,ps);
    if(dir==='w') return wob(y,ps)-x;
    if(dir==='e') return x-16-wob(y,ps);
    const R=3; // 对角圆角半径（像素）
    if(dir==='nw') return R - Math.hypot(x,y);
    if(dir==='ne') return R - Math.hypot(16-x,y);
    if(dir==='sw') return R - Math.hypot(x,16-y);
    return R - Math.hypot(16-x,16-y);
  }
  if(dir==='n') return 8+wob(x,ps)-y;
  if(dir==='s') return y-(8+wob(x,ps+7));
  if(dir==='w') return 8+wob(y,ps+13)-x;
  return x-(8+wob(y,ps+19));
}
/* 复合瓦片：同一格内多邻居同时影响时取主导者，天然处理三岔/四岔角落；
   对角邻居在共享角处圆角鼓包 */
export function renderTilePixels(A, dirNeighbors, mode, img, cx, cy){
  const sa=TERRAIN[A].seed;
  const band = mode==='seam' ? 3.0 : 2.2;
  for(let y=0;y<TILE;y++){ for(let x=0;x<TILE;x++){
    const Acolor=TERRAIN[A].color(x,y,sa);
    const wx=(cx||0)*TILE+x, wy=(cy||0)*TILE+y;
    const contribs=[];
    for(let i=0;i<dirNeighbors.length;i++){ const {dir,nb}=dirNeighbors[i];
      const p=distFor(dir,x,y,pairSeed(A,nb),mode);
      if(p>-band){
        const bl=clamp(0.5+p/band,0,1);
        if(bl>0.001){
          let u,v;
          if(mode==='seam'){ if(dir==='n'){u=y;v=x;} else if(dir==='s'){u=15-y;v=x;} else if(dir==='w'){u=x;v=y;} else if(dir==='e'){u=15-x;v=y;} else {u=y;v=x;} }
          else { u=y; v=x; }
          contribs.push({bl,color:TERRAIN[nb].color(x,y,TERRAIN[nb].seed),p,nb,u,v});
        }
      }
    }
    const r=pixelColor(Acolor,contribs,x,y,mode,wx,wy);
    let c=r.color;
    if(A==='~' && Math.abs(r.p)<band && hash2(x,y,11)>0.25) c=mix(c,[235,245,252],0.9);
    if(r.nb==='~' && Math.abs(r.p)<band && hash2(x,y,12)>0.72) c=mix(c,[235,245,252],0.7);
    if((A==='L'||r.nb==='L') && Math.abs(r.p)<band*0.7) c=mix(c,[255,190,80],0.55);
    if((A==='A'||r.nb==='A') && Math.abs(r.p)<band && hash2(x,y,13)>0.55) c=mix(c,[236,246,252],0.85);
    if((A==='M'||r.nb==='M') && Math.abs(r.p)<band && hash2(x,y,14)>0.94) c=[34,56,34];
    if((A==='K'||r.nb==='K') && (A==='L'||r.nb==='L') && Math.abs(r.p)<band*0.7) c=mix(c,[255,150,50],0.5);
    const i=(y*TILE+x)*4; img.data[i]=c[0]; img.data[i+1]=c[1]; img.data[i+2]=c[2]; img.data[i+3]=255;
  } }
}
export function tileCanvas(A,B,dirs){
  const cv=document.createElement('canvas'); cv.width=cv.height=TILE;
  const ctx=cv.getContext('2d'); const img=ctx.createImageData(TILE,TILE);
  const dirNeighbors=[]; for(const d of dirs) dirNeighbors.push({dir:d,nb:B});
  renderTilePixels(A,dirNeighbors,'blob',img);
  ctx.putImageData(img,0,0); return cv;
}
export function cellTile(t,nbs,cx,cy){
  const cv=document.createElement('canvas'); cv.width=cv.height=TILE;
  const ctx=cv.getContext('2d'); const img=ctx.createImageData(TILE,TILE);
  const dirNeighbors=[];
  for(const dir of ['n','s','w','e','nw','ne','sw','se']){ const nb=nbs[dir]; if(nb && nb!==t) dirNeighbors.push({dir,nb}); }
  renderTilePixels(t,dirNeighbors,'seam',img,cx,cy);
  ctx.putImageData(img,0,0); return cv;
}
const baseOf = (t)=> baseOf.cache[t] || (baseOf.cache[t]=tileCanvas(t,t,[]));
baseOf.cache={};
export { baseOf };
/* 木桥瓦片：中间木板桥面 + 上下/左右水面，带桥下阴影与桥栏 */
export function bridgeTile(axis){
  const cv=document.createElement('canvas'); cv.width=cv.height=TILE;
  const ctx=cv.getContext('2d'); const img=ctx.createImageData(TILE,TILE);
  for(let y=0;y<TILE;y++){ for(let x=0;x<TILE;x++){
    const inDeck = axis==='h' ? (y>=4&&y<12) : (x>=4&&x<12);
    let c;
    if(inDeck){
      const v=hash2(x,y,21); let r=152,g=104,b=64;
      const seam = axis==='h' ? (y&3)===0 : (x&3)===0;
      if(seam){ r-=42; g-=34; b-=26; }
      if(v<0.15){ r-=16; g-=13; b-=10; } else if(v>0.8){ r+=14; g+=11; b+=6; }
      const edge = axis==='h' ? (y===4||y===11) : (x===4||x===11);
      if(edge){ r-=24; g-=19; b-=15; }
      c=[r,g,b];
    } else {
      let cw=TERRAIN['~'].color(x,y,TERRAIN['~'].seed);
      const shade = axis==='h' ? (y===3||y===12) : (x===3||x===12);
      if(shade) cw=mix(cw,[8,14,34],0.4);
      c=cw;
    }
    const i=(y*TILE+x)*4; img.data[i]=c[0]; img.data[i+1]=c[1]; img.data[i+2]=c[2]; img.data[i+3]=255;
  } }
  ctx.putImageData(img,0,0); return cv;
}
const bridgeCache={};
export const bridgeTileCached=(axis)=> bridgeCache[axis] || (bridgeCache[axis]=bridgeTile(axis));
