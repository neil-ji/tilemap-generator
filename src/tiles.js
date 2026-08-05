/* ============ 瓦片生成（含过渡） ============ */
import { TILE, clamp, smooth, hash2, mix, wob } from './util.js';
import { TERRAIN, roadColor } from './terrain.js';

/* 像素风过渡：seam 用世界坐标 Bayer 4×4 有序抖动（过渡带内逐像素在 A/主导邻居间按阈值选择，纯色块无平滑渐变）。
   世界坐标阈值保证相邻两格在共享缝线上逐像素一致、无缝隙，且抖动结构化无盐椒散点；图鉴 blob 模式沿用 2×2 Bayer。 */
const BAYER4=[[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]];
function bayerTh(wx,wy){ return (BAYER4[wy&3][wx&3]+0.5)/16; }
export function pixelColor(Acolor, contribs, x, y, mode, wx, wy){
  if(!contribs.length) return {color:Acolor,p:-99,nb:null};
  let best=contribs[0];
  for(let i=1;i<contribs.length;i++) if(contribs[i].bl>best.bl) best=contribs[i];
  if(best.bl<=0.001) return {color:Acolor,p:-99,nb:null};
  if(best.bl>=0.999) return {color:best.color,p:best.p,nb:best.nb};
  let dithered;
  if(mode==='seam'){
    const th=bayerTh(wx,wy);
    dithered= best.bl>th ? best.color : Acolor;
  } else {
    const bayer=((best.u&1)?(best.v&1?1:3):(best.v&1?2:0));
    const th=(bayer+0.5)/4;
    dithered= best.bl>th ? best.color : Acolor;
  }
  return {color:dithered, p:best.p, nb:best.nb};
}
/* bitmask corner rule：对角 dir 仅在相邻两个正交 dir 都存在过渡时参与（纯对角接触不渲染过渡鼓包） */
function cornerRule(dirNeighbors){
  const has={}; for(const e of dirNeighbors) has[e.dir]=true;
  return dirNeighbors.filter(e=>{
    const d=e.dir;
    if(d==='nw') return has.n&&has.w;
    if(d==='ne') return has.n&&has.e;
    if(d==='sw') return has.s&&has.w;
    if(d==='se') return has.s&&has.e;
    return true;
  });
}
const SEAM_BAND=2.0; /* seam 过渡带半宽（px），buildTemplate 与 renderTilePixels 必须同步 */
/* 对称配对种子：相邻两格对同一条格缝使用同一波浪边界，保证过渡对齐无缝隙 */
export function pairSeed(a,b){ const sa=TERRAIN[a].seed, sb=TERRAIN[b].seed; const lo=Math.min(sa,sb), hi=Math.max(sa,sb); return lo*4096+hi; }
/* seam=地图模式：边界沿格缝随噪声蜿蜒，相邻两格各出半条抖动过渡（缝线处逐像素一致）。
   n/s/w/e 用共享世界坐标谓词（像素中心到边界距离，上格 p=y0-wy、下格 p=wy-y0 对称互补），
   消除 wob 落在两格间空隙时上下行同时「夹在过渡带」造成的 1px 判定冲突，真正无缝隙。
   对角 dir 用"到共享角像素距离"做圆角鼓包，两格在同一世界角上结果一致（配合 cornerRule 仅在有正交边时生效）。 */
export function distFor(dir,x,y,ps,mode){
  if(mode==='seam'){
    if(dir==='n') return wob(x,ps)-y-0.5;
    if(dir==='s') return y-15.5-wob(x,ps);
    if(dir==='w') return wob(y,ps)-x-0.5;
    if(dir==='e') return x-15.5-wob(y,ps);
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
   对角邻居在共享角处圆角鼓包（seam 模式经 cornerRule 过滤，纯对角接触不渲染过渡） */
export function renderTilePixels(A, dirNeighbors, mode, img, cx, cy){
  const sa=TERRAIN[A].seed;
  const band = mode==='seam' ? SEAM_BAND : 2.2;
  if(mode==='seam') dirNeighbors=cornerRule(dirNeighbors);
  for(let y=0;y<TILE;y++){ for(let x=0;x<TILE;x++){
    const Acolor=TERRAIN[A].color(x,y,sa);
    const wx=(cx||0)*TILE+x, wy=(cy||0)*TILE+y;
    const contribs=[];
    for(let i=0;i<dirNeighbors.length;i++){ const {dir,nb}=dirNeighbors[i];
      const p=distFor(dir,x,y,pairSeed(A,nb),mode);
      if(p>-band){
        const bl=smooth(clamp(0.5+p/band,0,1));
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
const baseOf = (t)=> baseOf.cache[t] || (baseOf.cache[t]= (t==='R'? roadTileDefault() : tileCanvas(t,t,[])));
baseOf.cache={};
export { baseOf };

/* ---- 窄小径叠加（Option A）：R 格 = 基底瓦片渲染 + 6px 窄路条 ----
   道路不再作为满格地形：grid 仍存 R（统计/盖章语义不变），渲染时先按基底地形走现有过渡，
   再按正交 R 邻居方向构造过格心(8,8)的骨架折线，用「到折线距离场」画恒定带宽窄条（无 wob 锯齿），
   d<=w/2 路心色 / d<=w/2+1 深色描边 / 其余保留基底。R 格依赖 roadBase（超出「地形+8邻」签名），
   不走模板缓存（占图 ~1.5%，逐格直算可接受），其余地形缓存机制不动。 */
const ROAD_W=6;            /* 心带宽（px）：16px 格内 38%，直线/L/T/十字实测清晰，甜点值 */
const ROAD_HALF=ROAD_W/2;
const ROAD_OUT=1;          /* 1px 深色描边：低对比基底（沙漠/碎石）上路径「弹出来」的关键 */
const ROAD_EM={ n:[8,0], s:[8,15], w:[0,8], e:[15,8] };  /* 正交 R 邻居方向的格边中点 */
function roadSegments(arms){
  /* 由正交 R 邻居方向构造骨架线段集（过格心折线）：端点=短臂收圆帽、对向=直段、相邻=L、3/4 臂=T/十字 */
  if(!arms.length) return null;   /* 孤立道路格：退化为格心点（圆帽小点） */
  const segs=[];
  if(arms.length===1){ const m=ROAD_EM[arms[0]]; segs.push([m[0],m[1],8,8]); }
  else if(arms.length===2){
    const a=arms[0], b=arms[1];
    if((a==='n'&&b==='s')||(a==='s'&&b==='n')) segs.push([8,0,8,15]);
    else if((a==='w'&&b==='e')||(a==='e'&&b==='w')) segs.push([0,8,15,8]);
    else { const m=ROAD_EM[a]; segs.push([m[0],m[1],8,8]); const n=ROAD_EM[b]; segs.push([8,8,n[0],n[1]]); }
  } else { for(const d of arms){ const m=ROAD_EM[d]; segs.push([8,8,m[0],m[1]]); } }
  return segs;
}
function segDist(px,py,x1,y1,x2,y2){
  const dx=x2-x1, dy=y2-y1, len2=dx*dx+dy*dy;
  if(len2===0) return Math.hypot(px-x1,py-y1);
  let t=((px-x1)*dx+(py-y1)*dy)/len2;
  t=t<0?0:t>1?1:t;
  return Math.hypot(px-(x1+dx*t), py-(y1+dy*t));
}
function distToSegments(segs,px,py){
  let m=Infinity;
  for(let i=0;i<segs.length;i++){ const d=segDist(px,py,segs[i][0],segs[i][1],segs[i][2],segs[i][3]); if(d<m) m=d; }
  return m;
}
function overlayRoad(img,arms,ox,oy){
  const segs=roadSegments(arms);
  const data=img.data, seed=TERRAIN['R'].seed;
  for(let y=0;y<TILE;y++){ for(let x=0;x<TILE;x++){
    const d=segs? distToSegments(segs,x,y) : Math.hypot(x-8,y-8);
    if(d<=ROAD_HALF+ROAD_OUT){
      const j=(y*TILE+x)*4;
      const rc=roadColor([data[j],data[j+1],data[j+2]], ox+x, oy+y, seed);
      let c;
      if(d<=ROAD_HALF) c=rc;
      else c=[rc[0]*0.6|0, rc[1]*0.6|0, rc[2]*0.6|0];   /* 描边：路心压暗 ~40% */
      data[j]=c[0]; data[j+1]=c[1]; data[j+2]=c[2]; data[j+3]=255;
    }
  } }
}
/* R 格渲染主入口：先把基底瓦片渲染进 img（force 确保 flat 也写入 buffer），再叠加窄路条。
   nb 已是「R→基底 解析后」的邻居（render.js 侧解析）。 */
export function renderRoadCell(base,nb,arms,img,cx,cy){
  renderCell(base,nb,img,cx,cy,true);
  overlayRoad(img,arms,(cx||0)*TILE,(cy||0)*TILE);
}
/* 无 roadBase 上下文（图鉴/统计图标）的默认道路瓦片：固定草地基底 + 水平窄路条示意 */
const ROAD_FALLBACK_BASE='G';
function roadTileDefault(){
  const cv=document.createElement('canvas'); cv.width=cv.height=TILE;
  const ctx=cv.getContext('2d'); const img=ctx.createImageData(TILE,TILE);
  renderRoadCell(ROAD_FALLBACK_BASE,{},['w','e'],img,0,0);
  ctx.putImageData(img,0,0); return cv;
}

/* ---- 邻居签名缓存（P1-1 后半）：同一「地形+8邻接」配置的格子共享一次昂贵的逐像素过渡计算 ----
   seam 抖动阈值依赖格的世界坐标 Bayer 4×4（保证相邻格共享缝线逐像素对齐、无盐椒散点），
   因此缓存的是「抖动前」模板（A色/best色/bl + 特效门控位，均与格位置无关），
   渲染时按该格真实世界坐标补一次廉价抖动，并按与原实现相同的顺序/公式应用特效 mix，
   输出与逐格直算逐字节一致（mix 用 a+(b-a)*t 原位复合，保证浮点位级一致）；
   无过渡的纯地形格退化为 baseOf(t) 直接 blit（本就是零邻居的基础瓦片，逐字节一致）。 */
const templateCache=new Map();
function neighborKey(t,nbs){
  return t+'|'+(nbs.n||'.')+(nbs.s||'.')+(nbs.w||'.')+(nbs.e||'.')+(nbs.nw||'.')+(nbs.ne||'.')+(nbs.sw||'.')+(nbs.se||'.');
}
function buildTemplate(t,nbs){
  const dirNeighbors=[];
  for(const dir of ['n','s','w','e','nw','ne','sw','se']){ const nb=nbs[dir]; if(nb && nb!==t) dirNeighbors.push({dir,nb}); }
  const dirs=cornerRule(dirNeighbors);
  if(!dirs.length) return {flat:baseOf(t)};
  const sa=TERRAIN[t].seed, band=SEAM_BAND;
  const aR=new Float32Array(256),aG=new Float32Array(256),aB=new Float32Array(256);
  const bR=new Float32Array(256),bG=new Float32Array(256),bB=new Float32Array(256);
  const bl=new Float32Array(256), fx=new Uint8Array(256);
  const aIs=t==='~';
  let i=0;
  for(let y=0;y<TILE;y++){ for(let x=0;x<TILE;x++){
    const Acolor=TERRAIN[t].color(x,y,sa);
    let best=null;
    for(let j=0;j<dirs.length;j++){ const {dir,nb}=dirs[j];
      const p=distFor(dir,x,y,pairSeed(t,nb),'seam');
      if(p>-band){ const b=smooth(clamp(0.5+p/band,0,1));
        if(b>0.001){ const bc=TERRAIN[nb].color(x,y,TERRAIN[nb].seed);
          if(!best||b>best.bl) best={bl:b,color:bc,p,nb}; } } }
    const A=Acolor, B=best?best.color:Acolor, bb=best?best.bl:0;
    const rp=best?best.p:-99, rnb=best?best.nb:null, absp=Math.abs(rp);
    aR[i]=A[0]; aG[i]=A[1]; aB[i]=A[2];
    bR[i]=B[0]; bG[i]=B[1]; bB[i]=B[2];
    bl[i]=bb;
    /* 特效门控只依赖格内局部坐标与签名（与格位置无关）→ 预计算门控位。
       位：1/2/4/8=特效1..4，16=特效6（K↔L 边），32=特效5（沼泽深色，整体赋值且与特效6 互斥） */
    let m=0;
    if(aIs && absp<band && hash2(x,y,11)>0.25) m|=1;
    if(rnb==='~' && absp<band && hash2(x,y,12)>0.72) m|=2;
    if((t==='L'||rnb==='L') && absp<band*0.7) m|=4;
    if((t==='A'||rnb==='A') && absp<band && hash2(x,y,13)>0.55) m|=8;
    if((t==='M'||rnb==='M') && absp<band && hash2(x,y,14)>0.94) m|=32;
    if((t==='K'||rnb==='K') && (t==='L'||rnb==='L') && absp<band*0.7) m|=16;
    fx[i]=m;
    i++;
  } }
  return {flat:false,aR,aG,aB,bR,bG,bB,bl,fx};
}
/* 缓存命中时的抖动渲染：按该格世界坐标补 seam 抖动 + 顺序特效 mix（与原实现逐字节一致） */
function renderTemplate(tpl,img,cx,cy){
  const {aR,aG,aB,bR,bG,bB,bl,fx}=tpl;
  const data=img.data, ox=(cx||0)*TILE, oy=(cy||0)*TILE;
  let i=0;
  for(let y=0;y<TILE;y++){ const wy=oy+y;
    for(let x=0;x<TILE;x++){ const wx=ox+x;
      const th=bayerTh(wx,wy);
      const j=(y*TILE+x)*4, f=fx[i], bb=bl[i];
      let cr,cg,cb;
      if(bb<=0.001 || (bb<0.999 && bb<=th)){ cr=aR[i]; cg=aG[i]; cb=aB[i]; }
      else { cr=bR[i]; cg=bG[i]; cb=bB[i]; }
      if(f&32){ cr=34; cg=56; cb=34; }
      else {
        if(f&1){ const T=[235,245,252]; cr=cr+(T[0]-cr)*0.9; cg=cg+(T[1]-cg)*0.9; cb=cb+(T[2]-cb)*0.9; }
        if(f&2){ const T=[235,245,252]; cr=cr+(T[0]-cr)*0.7; cg=cg+(T[1]-cg)*0.7; cb=cb+(T[2]-cb)*0.7; }
        if(f&4){ const T=[255,190,80]; cr=cr+(T[0]-cr)*0.55; cg=cg+(T[1]-cg)*0.55; cb=cb+(T[2]-cb)*0.55; }
        if(f&8){ const T=[236,246,252]; cr=cr+(T[0]-cr)*0.85; cg=cg+(T[1]-cg)*0.85; cb=cb+(T[2]-cb)*0.85; }
        if(f&16){ const T=[255,150,50]; cr=cr+(T[0]-cr)*0.5; cg=cg+(T[1]-cg)*0.5; cb=cb+(T[2]-cb)*0.5; }
      }
      data[j]=cr; data[j+1]=cg; data[j+2]=cb; data[j+3]=255;
      i++;
    } }
}
/* 主入口：返回 flat 瓦片 canvas（调用方直接 blit）或 null（像素已写入 img，调用方 putImageData）。
   force=true 时即使 flat 也把像素写入 img（供 R 格基底渲染叠加窄路条），非 R 地形不带 force，行为逐字节不变。 */
function blitFlatToImg(flatCv,img){
  const t=document.createElement('canvas'); t.width=t.height=TILE;
  const tc=t.getContext('2d'); tc.drawImage(flatCv,0,0);
  img.data.set(tc.getImageData(0,0,TILE,TILE).data);
}
export function renderCell(t,nbs,img,cx,cy,force){
  const key=neighborKey(t,nbs);
  let tpl=templateCache.get(key);
  if(!tpl){ tpl=buildTemplate(t,nbs); templateCache.set(key,tpl); }
  if(tpl.flat){ if(force) blitFlatToImg(tpl.flat,img); else return tpl.flat; }
  else renderTemplate(tpl,img,cx,cy);
  return null;
}
