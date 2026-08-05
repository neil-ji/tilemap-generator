/* ============ 入口：应用状态、控件绑定、启动（应用层 glue） ============ */
import './style.css';
import { TILE, clamp } from './util.js';
import { TERRAIN } from './terrain.js';
import { baseOf } from './tiles.js';
import { genWorld, genDungeon, MAPS } from './mapgen.js';
import { buildMapCache, drawFrame as renderFrame } from './render.js';
import { buildPalette } from './palette.js';

const cv=document.getElementById('cv');
const wrap=document.getElementById('mapwrap');
let cacheCanvas=null, currentMap=null, currentDef=null, raf=null;

/* ============ 渲染循环 ============ */
function drawFrame(now){
  renderFrame(cv.getContext('2d'), cacheCanvas, currentMap, {anim:animateEl.checked, grid:gridEl.checked, speed:speedEl.value*1}, now);
}
function startAnim(){ if(!animateEl.checked) return; cancelAnimationFrame(raf); const loop=(t)=>{ drawFrame(t); raf=requestAnimationFrame(loop); }; raf=requestAnimationFrame(loop); }

/* ============ 控件 ============ */
const mapbar=document.getElementById('mapbar'), seedinfo=document.getElementById('seedinfo');
const zoomEl=document.getElementById('zoom'), gridEl=document.getElementById('grid'), animateEl=document.getElementById('animate'), speedEl=document.getElementById('speed'), zoomvalEl=document.getElementById('zoomval');
function applyZoom(){ const z=zoomEl.value*1; cv.style.width=(cv.width*z)+'px'; cv.style.height=(cv.height*z)+'px'; zoomvalEl.textContent=z.toFixed(1); }
function fit(){ if(!cacheCanvas) return; /* 可用高度取 #mapwrap 计算样式 max-height（桌面 calc(100dvh-150px)），避免初始加载时 clientHeight 被 canvas 内容高度拉低；移动端 max-height:none 回退视口高度 */ const mh=parseFloat(getComputedStyle(wrap).maxHeight); const availH=(Number.isFinite(mh)&&mh>0)?mh:(window.innerHeight-150); const z=clamp(Math.min((wrap.clientWidth-16)/(cacheCanvas.width),(availH-16)/(cacheCanvas.height)),0.5,4); zoomEl.value=z.toFixed(1); applyZoom(); }
function loadMap(def, opts){
  currentDef=def;
  /* 生成期间禁用全部切图按钮 + 「生成中…」反馈；setTimeout(0) 让出主线程先渲染一帧再开始同步生成 */
  const genBtns=[document.getElementById('btnReroll'),...document.querySelectorAll('#mapbar .btn')];
  const labels=genBtns.map(b=>b.textContent);
  genBtns.forEach(b=>{ b.disabled=true; b.textContent='生成中…'; });
  setTimeout(()=>{
    const data=def.dungeon? genDungeon(def) : genWorld(def);
    currentMap=data;
    cacheCanvas=buildMapCache(data);
    cv.width=data.w*TILE; cv.height=data.h*TILE;
    if(opts && opts.fit) fit(); else applyZoom();
    updateStats();
    genBtns.forEach((b,i)=>{ b.disabled=false; b.textContent=labels[i]; });
    if(animateEl.checked) startAnim(); else drawFrame();
  },0);
}
function updateStats(){
  const label=currentDef.name+' · 种子 '+currentMap.seed+' · '+currentMap.w+'×'+currentMap.h;
  seedinfo.textContent=label; cv.setAttribute('aria-label',label);
  for(const b of statsBox.querySelectorAll('b')){ b.parentNode.removeChild(b); }
  const counts={}; for(const row of currentMap.grid) for(const c of row) counts[c]=(counts[c]||0)+1;
  for(const ch of Object.keys(counts).sort((a,b)=>counts[b]-counts[a])){ if(!TERRAIN[ch]) continue;
    const b=document.createElement('b'); const ic=document.createElement('canvas'); ic.width=12; ic.height=12; ic.getContext('2d').drawImage(baseOf(ch),0,0,16,16,0,0,12,12);
    b.appendChild(ic); const t=document.createElement('span'); t.textContent=TERRAIN[ch].name+' '+counts[ch]; b.appendChild(t); statsBox.appendChild(b); }
}
for(const m of MAPS){ const b=document.createElement('button'); b.className='btn'; b.setAttribute('aria-pressed','false'); b.textContent=m.name; b.onclick=()=>{ document.querySelectorAll('#mapbar .btn').forEach(x=>{ x.classList.remove('active'); x.setAttribute('aria-pressed','false'); }); b.classList.add('active'); b.setAttribute('aria-pressed','true'); loadMap(m); }; mapbar.appendChild(b); }
const statsBox=document.createElement('div'); statsBox.className='stats'; statsBox.id='statsBox';
const sp=document.createElement('div'); sp.className='panel'; const sp2=document.createElement('h2'); sp2.textContent='地图构成'; sp.appendChild(sp2); sp.appendChild(statsBox);
document.getElementById('palette').appendChild(sp);
document.getElementById('btnReroll').onclick=()=>{ currentDef.seed=(currentDef.seed+137)&0xffff; loadMap(currentDef); };
document.getElementById('btnFit').onclick=fit;
zoomEl.oninput=applyZoom;
gridEl.onchange=()=>{ if(animateEl.checked) startAnim(); else drawFrame(); };
animateEl.onchange=()=>{ if(animateEl.checked) startAnim(); else { cancelAnimationFrame(raf); drawFrame(); } };
window.addEventListener('resize',fit);

/* ============ 启动 ============ */
buildPalette();
/* 尊重 prefers-reduced-motion：命中则默认关闭动画，静态帧更省电且对运动敏感用户友好（P1-2/P2-3） */
const mq=window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
if(mq && mq.matches) animateEl.checked=false;
if(mq){ const onMq=()=>{ if(mq.matches && animateEl.checked){ animateEl.checked=false; cancelAnimationFrame(raf); drawFrame(); } };
  if(mq.addEventListener) mq.addEventListener('change',onMq); else if(mq.addListener) mq.addListener(onMq); }
const qm=parseInt(new URLSearchParams(location.search).get('map')||'0',10);
const first=MAPS[clamp(qm,0,MAPS.length-1)];
loadMap(first,{fit:true});
const firstBtn=mapbar.children[clamp(qm,0,MAPS.length-1)];
if(firstBtn){ firstBtn.classList.add('active'); firstBtn.setAttribute('aria-pressed','true'); }
