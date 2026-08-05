/* ============ 地图生成（程序化 + 手工盖章） ============ */
import { fbm, smooth, clamp, hash2, wob } from './util.js';

export function genWorld(o){
  const w=o.w,h=o.h,seed=o.seed;
  const grid=[];
  for(let y=0;y<h;y++){ const row=[];
    for(let x=0;x<w;x++){
      let hh=fbm(x*(o.freq||0.05),y*(o.freq||0.05),seed);
      for(const b of (o.bumps||[])){ const d2=(x-b.x)*(x-b.x)+(y-b.y)*(y-b.y); hh += b.amp*Math.exp(-d2/(b.r*b.r*0.5)); }
      hh=(hh-0.5)*1.35+0.5;
      if(o.island){ const nx=1-Math.abs(x/(w-1)*2-1), ny=1-Math.abs(y/(h-1)*2-1); const sh=smooth(Math.min(nx,ny)); hh *= (0.5+0.5*smooth(smooth(sh))); }
      hh=clamp(hh,0,1);
      let t;
      if(o.frozenOcean && hh<0.405) t=(hh<0.18?'~':'F');
      else if(hh<0.335) t='~';
      else if(hh<0.405) t='S';
      else if(hh<0.75) t=(fbm(x*(o.freq2||0.05)+31.7,y*(o.freq2||0.05)+7.3,seed+99)>0.62?'D':'G');
      else if(hh<0.87) t='T';
      else t='W';
      row.push(t);
    } grid.push(row); }
  if(o.lavaCrater){ const cx=o.lavaCrater.x,cy=o.lavaCrater.y,r=o.lavaCrater.r;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){ const d=Math.hypot(x-cx,y-cy); if(d<r) grid[y][x]=(d<r*0.38?'L':'T'); } }
  if(o.lavaFlow){ for(const p of o.lavaFlow){ if(grid[p.y]&&grid[p.y][p.x]!==undefined&&grid[p.y][p.x]!=='~') grid[p.y][p.x]='L'; } }
  const river=new Set();
  for(const rv of (o.rivers||[])) carveRiverPoly(grid,rv.pts,w,h,rv.seed||seed,river);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    if(grid[y][x]==='L'){ const near=[-1,0,1,0,0,-1,0,1]; let sw=0; for(let k=0;k<8;k+=2){ const ny=y+near[k],nx=x+near[k+1]; if(ny>=0&&ny<h&&nx>=0&&nx<w&&grid[ny][nx]==='~') sw=1; } if(sw) grid[y][x]='T'; } }
  for(const path of (o.roads||[])) for(let i=0;i<path.length-1;i++) stampLine(grid,path[i],path[i+1],river);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    if(grid[y][x]==='R' && river.has(x+','+y)){
      const n=y>0?grid[y-1][x]:null, s=y<h-1?grid[y+1][x]:null, wc=x>0?grid[y][x-1]:null, ec=x<w-1?grid[y][x+1]:null;
      const isR=(c)=> c==='R'||c==='B';
      const roadEW=isR(wc)||isR(ec), roadNS=isR(n)||isR(s);
      if((roadEW && n==='~'&&s==='~') || (roadNS && wc==='~'&&ec==='~')) grid[y][x]='B';
    } }
  const houses=[];
  for(const pt of (o.houses||[])){ if(grid[pt[1]]&&grid[pt[1]][pt[0]]!==undefined){ const cell=grid[pt[1]][pt[0]]; if(cell!=='~'&&cell!=='B'&&cell!=='L'){ grid[pt[1]][pt[0]]='G'; houses.push({x:pt[0],y:pt[1]}); } } }
  return {grid,w,h,houses,seed,river};
}
export function carveRiverPoly(grid,pts,w,h,seed,river){
  const mark=(x,y)=>{ if(x<0||y<0||x>=w||y>=h) return; grid[y][x]='~'; river.add(x+','+y); };
  for(let i=0;i<pts.length-1;i++){
    const a=pts[i], b=pts[i+1];
    const dx=b.x-a.x, dy=b.y-a.y;
    const n=Math.max(Math.abs(dx),Math.abs(dy));
    for(let k=0;k<=n;k++){
      const t=k/n;
      const tx=Math.round(a.x+dx*t), ty=Math.round(a.y+dy*t);
      const jx=tx+Math.round(wob(k,seed+tx)*1.0), jy=ty+Math.round(wob(k,seed+ty+3)*1.0);
      if(Math.abs(dx)>=Math.abs(dy)){ mark(jx,jy-1); mark(jx,jy); mark(jx,jy+1); }
      else { mark(jx-1,jy); mark(jx,jy); mark(jx+1,jy); }
    }
  }
}
export function stampLine(grid,a,b,river){
  const n=Math.max(Math.abs(b.x-a.x),Math.abs(b.y-a.y));
  for(let i=0;i<=n;i++){ const t=i/n; const tx=Math.round(a.x+(b.x-a.x)*t), ty=Math.round(a.y+(b.y-a.y)*t);
    if(grid[ty]&&grid[ty][tx]!==undefined){ const cur=grid[ty][tx]; if(cur!=='~' || (river&&river.has(tx+','+ty))) grid[ty][tx]='R'; } }
}
export function genDungeon(o){
  const w=o.w,h=o.h; const grid=[];
  for(let y=0;y<h;y++){ const row=[]; for(let x=0;x<w;x++) row.push('C'); grid.push(row); }
  const rooms=[
    {x:3,y:3,w:9,h:7},{x:16,y:3,w:12,h:8},{x:31,y:4,w:7,h:6},
    {x:3,y:15,w:8,h:9},{x:16,y:14,w:14,h:10},{x:33,y:16,w:6,h:8}
  ];
  for(const r of rooms) for(let yy=r.y+1;yy<r.y+r.h-1;yy++) for(let xx=r.x+1;xx<r.x+r.w-1;xx++) grid[yy][xx]='P';
  const centers=rooms.map(r=>[Math.floor(r.x+r.w/2),Math.floor(r.y+r.h/2)]);
  for(let i=0;i<centers.length-1;i++) carveL(grid,centers[i],centers[i+1]);
  for(let yy=4;yy<=10;yy++) for(let xx=31;xx<=37;xx++){ if((yy-7)*(yy-7)+(xx-34)*(xx-34)<=2.6) grid[yy][xx]='L'; }
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){ if(grid[y][x]==='P' && hash2(x,y,9)<0.04) grid[y][x]='T'; }
  return {grid,w,h,houses:[],seed:o.seed||1};
}
export function carveL(g,a,b){ const x1=a[0],y1=a[1],x2=b[0],y2=b[1];
  for(let x=Math.min(x1,x2);x<=Math.max(x1,x2);x++) if(g[y1]) g[y1][x]='P';
  for(let y=Math.min(y1,y2);y<=Math.max(y1,y2);y++) if(g[y]) g[y][x2]='P';
}

export const MAPS=[
 {id:'main',name:'翡翠大陆',seed:42,w:44,h:30,island:true,
  bumps:[{x:14,y:17,r:5,amp:-0.30},{x:28,y:6,r:7,amp:0.55},{x:36,y:13,r:6,amp:0.42},{x:24,y:13,r:5,amp:0.36}],
  rivers:[{pts:[{x:30,y:8},{x:28,y:11},{x:24,y:14},{x:22,y:18},{x:23,y:23},{x:22,y:27}]}],
  roads:[[{x:20,y:29},{x:20,y:22},{x:20,y:16},{x:27,y:13},{x:34,y:12}]],
  houses:[[20,22],[27,13],[34,12]]},
 {id:'tundra',name:'极地冻原',seed:7,w:44,h:30,island:true,frozenOcean:true,
  bumps:[{x:22,y:7,r:8,amp:0.55},{x:30,y:15,r:6,amp:0.4},{x:16,y:13,r:5,amp:0.26},{x:13,y:21,r:5,amp:0.22}],
  rivers:[{pts:[{x:24,y:6},{x:20,y:12},{x:16,y:16},{x:14,y:18},{x:12,y:22},{x:13,y:27}]}],
  roads:[[{x:13,y:21},{x:16,y:13},{x:22,y:9}]],
  houses:[[16,13],[22,9]]},
 {id:'volcano',name:'火山群岛',seed:17,w:46,h:28,island:true,
  bumps:[{x:26,y:11,r:7,amp:0.55},{x:9,y:8,r:6,amp:0.38},{x:36,y:17,r:6,amp:0.36},{x:20,y:23,r:6,amp:0.32}],
  lavaCrater:{x:26,y:11,r:7},
  lavaFlow:[{x:26,y:11},{x:27,y:15},{x:28,y:19},{x:29,y:22}],
  roads:[[{x:14,y:22},{x:18,y:15},{x:23,y:10}]],
  houses:[[18,15]]},
 {id:'dungeon',name:'熔火地牢',w:40,h:28,dungeon:true}
];
