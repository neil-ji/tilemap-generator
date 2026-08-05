/* ============ 地图生成（程序化 + 手工盖章） ============ */
import { fbm, smooth, clamp, hash2, wob } from './util.js';

export function genWorld(o){
  const w=o.w,h=o.h,seed=o.seed;
  const freq=o.freq||0.05, freq2=o.freq2||0.05;
  /* 第一遍：算海拔 hh 与湿度 m；湿度仅在"草地带/陆地带"上统计均值方差，
     保证 G/H/D（或 N/T）占比稳定，不受种子/岛屿布局偏移影响 */
  const hhField=new Float64Array(w*h);
  const moistField=new Float64Array(w*h);
  let lmSum=0,lmSum2=0,lmCnt=0;
  for(let y=0;y<h;y++){ const row=y*w;
    for(let x=0;x<w;x++){
      let hh=fbm(x*freq,y*freq,seed);
      for(const b of (o.bumps||[])){ const d2=(x-b.x)*(x-b.x)+(y-b.y)*(y-b.y); hh += b.amp*Math.exp(-d2/(b.r*b.r*0.5)); }
      hh=(hh-0.5)*1.35+0.5;
      if(o.island){ const nx=1-Math.abs(x/(w-1)*2-1), ny=1-Math.abs(y/(h-1)*2-1); const sh=smooth(Math.min(nx,ny)); hh *= (0.5+0.5*smooth(smooth(sh))); }
      hh=clamp(hh,0,1);
      hhField[row+x]=hh;
      const m=fbm(x*freq2+31.7,y*freq2+7.3,seed+99);
      moistField[row+x]=m;
      const inLand=o.frozenOcean? (hh>=0.42&&hh<0.87) : (o.desert? false : (hh>=0.42&&hh<0.78));
      if(inLand){ lmSum+=m; lmSum2+=m*m; lmCnt++; }
    } }
  const lmMean=lmCnt? lmSum/lmCnt : 0.5;
  const lmStd=Math.sqrt(Math.max(0.001, lmCnt? lmSum2/lmCnt-lmMean*lmMean : 0.25));
  const wet=(m)=> (m-lmMean)/lmStd;
  const grid=[];
  for(let y=0;y<h;y++){ const row=[];
    for(let x=0;x<w;x++){
      const hh=hhField[y*w+x];
      const wv=wet(moistField[y*w+x]);
      let t;
      if(o.frozenOcean){
        if(hh<0.13) t='U';                       /* 深海（冻原极地深水） */
        else if(hh<0.18) t='~';
        else if(hh<0.405) t='F';
        else if(hh<0.42) t='S';
        else if(hh<0.75) t=(wv>0.9?'T':'N');
        else if(hh<0.78) t='T';
        else if(hh<0.83) t='V';                  /* 山腰碎石坡 */
        else t='X';                              /* 雪岩峰顶（冻原山最高为雪覆岩石） */
      } else if(o.desert){
        if(hh<0.12) t='U';
        else if(hh<0.16) t='~';
        else if(hh<0.32) t='A';
        else if(hh<0.42) t='S';
        else if(hh<0.82) t='E';
        else if(hh<0.87) t='V';                  /* 荒漠石质台地：碎石坡 */
        else t='T';
      } else {
        if(hh<0.22) t='U';                       /* 深海：海洋景深 */
        else if(hh<0.33) t='~';
        else if(hh<0.36) t='A';
        else if(hh<0.42) t='S';
        else if(hh<0.78) t=(wv<-1.0?'D':(wv<-0.5?'Z':(wv>0.8?'H':'G')));   /* 旱草地：灌木 Z */
        else if(hh<0.82) t=(wv>-0.6?'Q':'T');    /* 下高地：湿→高原草甸 Q，干→岩石 */
        else if(hh<0.87) t='V';                  /* 上高地：碎石坡 */
        else if(hh<0.92) t='X';                  /* 雪线过渡：雪岩 */
        else t='W';
      }
      row.push(t);
    } grid.push(row); }
  if(o.lavaCrater){ const cx=o.lavaCrater.x,cy=o.lavaCrater.y,r=o.lavaCrater.r;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){ const d=Math.hypot(x-cx,y-cy); if(d<r) grid[y][x]=(d<r*0.38?'L':'K'); } }
  if(o.lavaFlow){ for(const p of o.lavaFlow){ if(grid[p.y]&&grid[p.y][p.x]!==undefined&&grid[p.y][p.x]!=='~') grid[p.y][p.x]='L'; } }
  const river=new Set();
  for(const rv of (o.rivers||[])) carveRiverPoly(grid,rv.pts,w,h,rv.seed||seed,river);
  if(o.lake){ const {x,y,r}=o.lake;
    for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){ const d=Math.hypot(xx-x,yy-y);
      if(d<r){ grid[yy][xx]='~'; river.add(xx+','+yy); }
      else if(d<r+1 && grid[yy][xx]!=='~') grid[yy][xx]='A'; } }
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    if(grid[y][x]==='L'){ const near=[-1,0,1,0,0,-1,0,1]; let sw=0; for(let k=0;k<8;k+=2){ const ny=y+near[k],nx=x+near[k+1]; if(ny>=0&&ny<h&&nx>=0&&nx<w&&grid[ny][nx]==='~') sw=1; } if(sw) grid[y][x]='T'; } }
  /* roadBase：盖章前保存每个道路格的原地形（窄小径渲染的基底，不能在渲染时靠邻居推导——
     实测靠海 R 格会把海洋当基底）。仿 heights 先例，零新增计算成本。 */
  const roadBase=new Array(w*h);
  for(const path of (o.roads||[])) for(let i=0;i<path.length-1;i++) stampLine(grid,path[i],path[i+1],roadBase);
  /* 桥代码已由 task 2491e3ff 移除，b6be58c2 ChangeIntent 声明此转换循环已失效 */
  if(o.scorch){ for(let y=0;y<h;y++)for(let x=0;x<w;x++){ if(grid[y][x]==='T'){ const near=[-1,0,1,0,0,-1,0,1]; let sw=0; for(let k=0;k<8;k+=2){ const ny=y+near[k],nx=x+near[k+1]; if(ny>=0&&ny<h&&nx>=0&&nx<w&&grid[ny][nx]==='L') sw=1; } if(sw) grid[y][x]='K'; } } }
  for(const ch of (o.chasm||[])) carveChasm(grid,ch.pts,w,h,seed);
  if(o.swamp){ const sb=(o.desert?['E']:['G','D']);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){ if(sb.indexOf(grid[y][x])>=0){
      let wc=false;
      for(const d of [[-1,0],[1,0],[0,-1],[0,1]]){ const ny=y+d[0],nx=x+d[1]; if(ny>=0&&ny<h&&nx>=0&&nx<w&&(grid[ny][nx]==='~'||grid[ny][nx]==='A')) wc=true; }
      if(wc) grid[y][x]='M';
    } } }
  /* 泥滩：沙滩/沙漠/沼泽与水体相邻处部分转为湿润反光的泥滩 @ */
  if(o.mudflat && !o.frozenOcean){ const mf=['S','E','M'];
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){ if(mf.indexOf(grid[y][x])>=0){
      let wc=false;
      for(const d of [[-1,0],[1,0],[0,-1],[0,1]]){ const ny=y+d[0],nx=x+d[1]; if(ny>=0&&ny<h&&nx>=0&&nx<w&&(grid[ny][nx]==='~'||grid[ny][nx]==='A')) wc=true; }
      if(wc && hash2(x,y,seed+77)<0.4) grid[y][x]='@';
    } } }
  /* Phase 2：返回并行高度层 heights（第一遍已算好的连续海拔场 hhField，零新增计算）。
     高度层只驱动渲染侧浮雕/阴影/等高线，不掺入字符 grid（保持 tiles.js 签名缓存 key 纯净）。 */
  return {grid,w,h,seed,river,heights:hhField,roadBase};
}
export function carveChasm(grid,pts,w,h,seed){
  /* 深渊裂隙：沿折线盖章不可通行深坑 Y（2 格宽，方向随机偏），不覆盖水/道路/岩浆 */
  const put=(x,y)=>{ if(x<0||y<0||x>=w||y>=h) return; const c=grid[y][x]; if(c==='~'||c==='A'||c==='R'||c==='L') return; grid[y][x]='Y'; };
  for(let i=0;i<pts.length-1;i++){
    const a=pts[i], b=pts[i+1];
    const dx=b.x-a.x, dy=b.y-a.y;
    const n=Math.max(Math.abs(dx),Math.abs(dy));
    for(let k=0;k<=n;k++){
      const t=k/n;
      const tx=Math.round(a.x+dx*t), ty=Math.round(a.y+dy*t);
      put(tx,ty);
      if(hash2(tx,ty,seed+91)<0.5) put(tx+1,ty); else put(tx,ty+1);
    }
  }
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
export function stampLine(grid,a,b,roadBase){
  /* 4-connected 铺路：线性插值逐点取整，相邻点发生对角跳变时补填一个正交格（优先 px,ty，被水/斜角阻挡则 tx,py），
     放置前检查不会与已有道路格形成纯对角接触（否则宁可不补，道路在河岸自然终止）；道路不覆盖河流。
     roadBase（可选并行数组）：盖章前保存旧地形，供窄小径渲染读基底；已有 R 格不覆盖已存基底（跨路交点保留首次）。 */
  const n=Math.max(Math.abs(b.x-a.x),Math.abs(b.y-a.y));
  const gw=grid[0].length;
  const isR=(x,y)=> grid[y]&&grid[y][x]==='R';
  const diagGap=(x,y)=>{ for(const [dx,dy] of [[1,1],[1,-1],[-1,1],[-1,-1]])
    if(isR(x+dx,y+dy) && !isR(x+dx,y) && !isR(x,y+dy)) return true; return false; };
  const put=(x,y)=>{ if(!grid[y]||grid[y][x]===undefined||grid[y][x]==='~'||diagGap(x,y)) return false;
    const old=grid[y][x];
    grid[y][x]='R';
    if(old!=='R'&&roadBase) roadBase[y*gw+x]=old;
    return true; };
  let px=0,py=0;
  for(let i=0;i<=n;i++){ const t=i/n; const tx=Math.round(a.x+(b.x-a.x)*t), ty=Math.round(a.y+(b.y-a.y)*t);
    if(i>0 && tx!==px && ty!==py && !put(px,ty)) put(tx,py);
    put(tx,ty);
    px=tx; py=ty;
  }
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
  /* 房间内地形变体：石板 P 部分替换为洞窟地面 O / 木地板 # */
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){ if(grid[y][x]==='P'){ const v=hash2(x,y,(o.seed||1)+51);
    if(v<0.22) grid[y][x]='O';
    else if(v<0.30) grid[y][x]='#';
  } }
  /* 房间 6 内深坑：3×2 深渊裂隙 */
  for(let yy=21;yy<=22;yy++) for(let xx=35;xx<=37;xx++) grid[yy][xx]='Y';
  /* Phase 2 高度层：房间/通道微起伏（fbm），岩壁 C 高起、岩浆 L 下陷、裂隙 Y 最深 */
  const hs=o.seed||1;
  const heights=new Float64Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const c=grid[y][x];
    let hh;
    if(c==='Y') hh=0.05;
    else if(c==='L') hh=0.28;
    else if(c==='C') hh=0.72;
    else hh=0.56+fbm(x*0.07,y*0.07,hs+5)*0.08;
    heights[y*w+x]=hh;
  }
  return {grid,w,h,seed:hs,heights,roadBase:new Array(w*h)};
}
export function carveL(g,a,b){ const x1=a[0],y1=a[1],x2=b[0],y2=b[1];
  for(let x=Math.min(x1,x2);x<=Math.max(x1,x2);x++) if(g[y1]) g[y1][x]='P';
  for(let y=Math.min(y1,y2);y<=Math.max(y1,y2);y++) if(g[y]) g[y][x2]='P';
}

export const MAPS=[
 {id:'main',name:'翡翠大陆',seed:42,w:44,h:30,island:true,swamp:true,mudflat:true,
  bumps:[{x:14,y:17,r:5,amp:-0.30},{x:28,y:6,r:7,amp:0.55},{x:36,y:13,r:6,amp:0.42},{x:24,y:13,r:5,amp:0.36}],
  rivers:[{pts:[{x:30,y:8},{x:28,y:11},{x:24,y:14},{x:22,y:18},{x:23,y:23},{x:22,y:27}]}],
  roads:[[{x:20,y:29},{x:20,y:22},{x:20,y:16},{x:27,y:13},{x:34,y:12}]],
  chasm:[{pts:[{x:24,y:8},{x:25,y:9},{x:27,y:9},{x:29,y:9},{x:31,y:8}]}]},
 {id:'tundra',name:'极地冻原',seed:7,w:44,h:30,island:true,frozenOcean:true,
  bumps:[{x:22,y:7,r:8,amp:0.55},{x:30,y:15,r:6,amp:0.4},{x:16,y:13,r:5,amp:0.26},{x:13,y:21,r:5,amp:0.22}],
  rivers:[{pts:[{x:24,y:6},{x:20,y:12},{x:16,y:16},{x:14,y:18},{x:12,y:22},{x:13,y:27}]}],
  roads:[[{x:13,y:21},{x:16,y:13},{x:22,y:9}]],
  chasm:[{pts:[{x:28,y:14},{x:29,y:15},{x:31,y:15},{x:32,y:14}]}]},
 {id:'volcano',name:'火山群岛',seed:17,w:46,h:28,island:true,scorch:true,
  bumps:[{x:26,y:11,r:7,amp:0.55},{x:9,y:8,r:6,amp:0.38},{x:36,y:17,r:6,amp:0.36},{x:20,y:23,r:6,amp:0.32}],
  lavaCrater:{x:26,y:11,r:7},
  lavaFlow:[{x:26,y:11},{x:27,y:15},{x:28,y:19},{x:29,y:22}],
  roads:[[{x:14,y:22},{x:18,y:15},{x:23,y:10}]],
  chasm:[{pts:[{x:20,y:11},{x:20,y:12},{x:21,y:13},{x:21,y:15},{x:20,y:16}]}]},
 {id:'dungeon',name:'熔火地牢',w:40,h:28,dungeon:true},
 {id:'desert',name:'流沙荒漠',seed:23,w:46,h:28,desert:true,swamp:true,mudflat:true,
  bumps:[{x:16,y:14,r:7,amp:0.5},{x:32,y:9,r:6,amp:0.38},{x:34,y:19,r:5,amp:0.3},{x:10,y:8,r:5,amp:0.26}],
  lake:{x:23,y:14,r:5},
  roads:[[{x:10,y:23},{x:19,y:15},{x:32,y:12}]],
  chasm:[{pts:[{x:32,y:18},{x:33,y:19},{x:34,y:20},{x:36,y:21},{x:37,y:20}]}]},
 /* ============ 四张新地图（task e4978f4d 扩展） ============ */
 {id:'plateau',name:'遗忘高原',seed:47,w:52,h:34,island:true,
  /* 高原：中央宽缓台地（大 r 低 amp）+ 数座雪峰；顶部天湖、融雪河下泄、脊线深渊裂隙 */
  bumps:[{x:25,y:16,r:15,amp:0.3},{x:19,y:11,r:4,amp:0.3},{x:31,y:20,r:4,amp:0.28},{x:20,y:24,r:5,amp:0.18},{x:36,y:13,r:4,amp:0.2}],
  lake:{x:20,y:17,r:4},
  rivers:[{pts:[{x:20,y:13},{x:21,y:16},{x:22,y:20},{x:23,y:24},{x:24,y:28},{x:26,y:31}]}],
  chasm:[{pts:[{x:26,y:7},{x:27,y:10},{x:28,y:13},{x:28,y:16},{x:27,y:19}]}],
  roads:[[{x:8,y:29},{x:12,y:25},{x:15,y:21},{x:17,y:17}]]},
 {id:'archipelago',name:'群岛迷宫',seed:5,w:48,h:40,island:true,mudflat:true,
  /* 迷宫：负 bumps 在陆地雕出纵横水道，把大陆切成多岛；多河流切割 + 泥滩沙洲，道路止于河岸 */
  bumps:[{x:24,y:22,r:11,amp:0.38},{x:9,y:11,r:4,amp:0.24},{x:39,y:11,r:4,amp:0.24},{x:9,y:31,r:4,amp:0.24},{x:39,y:31,r:4,amp:0.24},{x:24,y:10,r:4,amp:0.2},{x:24,y:34,r:4,amp:0.2},{x:8,y:22,r:5,amp:-0.5},{x:19,y:22,r:5,amp:-0.5},{x:30,y:22,r:5,amp:-0.5},{x:41,y:22,r:5,amp:-0.5},{x:13,y:13,r:4,amp:-0.45},{x:35,y:13,r:4,amp:-0.45},{x:13,y:31,r:4,amp:-0.45},{x:35,y:31,r:4,amp:-0.45}],
  rivers:[{pts:[{x:16,y:8},{x:15,y:12},{x:14,y:16},{x:14,y:20}]},{pts:[{x:31,y:7},{x:30,y:11},{x:29,y:15},{x:27,y:18}]},{pts:[{x:22,y:27},{x:23,y:31},{x:24,y:35}]}],
  roads:[[{x:10,y:16},{x:13,y:19},{x:16,y:22}],[{x:26,y:20},{x:29,y:17},{x:32,y:14}],[{x:17,y:31},{x:20,y:30},{x:23,y:29}]]},
 {id:'frozen',name:'冻土苔原',seed:31,w:52,h:36,island:true,frozenOcean:true,
  /* 苔原：西北雪峰山弧提供 N→T→V→X 雪线过渡；南部苔原平原 + 融雪河，山间冰川裂隙 */
  bumps:[{x:24,y:22,r:13,amp:0.28},{x:18,y:12,r:6,amp:0.42},{x:28,y:16,r:6,amp:0.36},{x:36,y:11,r:5,amp:0.3},{x:12,y:18,r:5,amp:0.28},{x:40,y:19,r:5,amp:0.24},{x:24,y:6,r:5,amp:0.2},{x:26,y:9,r:4,amp:0.18}],
  rivers:[{pts:[{x:17,y:25},{x:20,y:27},{x:23,y:29},{x:26,y:31},{x:29,y:32}]}],
  chasm:[{pts:[{x:10,y:14},{x:12,y:16},{x:14,y:18},{x:16,y:19}]}],
  roads:[[{x:27,y:27},{x:29,y:23},{x:31,y:19},{x:33,y:15}]]},
 {id:'doom',name:'末日裂谷',seed:23,w:50,h:34,desert:true,scorch:true,
  /* 裂谷：焦土荒漠 + 巨型岩浆火山口，熔岩河向东南漫流，两侧深渊裂隙为"裂谷"主题 */
  bumps:[{x:25,y:17,r:12,amp:0.4},{x:16,y:11,r:6,amp:0.35},{x:35,y:21,r:6,amp:0.32},{x:13,y:23,r:5,amp:0.28},{x:36,y:9,r:5,amp:0.26}],
  lavaCrater:{x:25,y:17,r:10},
  lavaFlow:[{x:20,y:20},{x:23,y:22},{x:26,y:24},{x:29,y:27},{x:33,y:29},{x:38,y:30},{x:43,y:30}],
  chasm:[{pts:[{x:40,y:5},{x:41,y:9},{x:42,y:13},{x:42,y:17},{x:41,y:21},{x:40,y:25}]},{pts:[{x:13,y:10},{x:15,y:14},{x:17,y:18},{x:18,y:22},{x:19,y:26}]}],
  roads:[[{x:6,y:14},{x:11,y:15},{x:16,y:16},{x:20,y:17}]]}
];
