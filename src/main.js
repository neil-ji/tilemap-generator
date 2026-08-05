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
function startAnim(){ cancelAnimationFrame(raf); const loop=(t)=>{ drawFrame(t); raf=requestAnimationFrame(loop); }; raf=requestAnimationFrame(loop); }

/* ============ 控件 ============ */
const mapbar=document.getElementById('mapbar'), seedinfo=document.getElementById('seedinfo');
const zoomEl=document.getElementById('zoom'), gridEl=document.getElementById('grid'), decorEl=document.getElementById('decor'), animateEl=document.getElementById('animate'), speedEl=document.getElementById('speed');
function applyZoom(){ const z=zoomEl.value*1; cv.style.width=(cv.width*z)+'px'; cv.style.height=(cv.height*z)+'px'; }
function fit(){ if(!cacheCanvas) return; const z=clamp(Math.min((wrap.clientWidth-16)/(cacheCanvas.width),(wrap.clientHeight-16)/(cacheCanvas.height)),0.5,3); zoomEl.value=z.toFixed(1); applyZoom(); }
function loadMap(def){
  currentDef=def;
  const data=def.dungeon? genDungeon(def) : genWorld(def);
  currentMap=data;
  cacheCanvas=buildMapCache(data,{decor:decorEl.checked});
  cv.width=data.w*TILE; cv.height=data.h*TILE;
  fit(); updateStats();
  startAnim();
}
function updateStats(){
  seedinfo.textContent=currentDef.name+' · 种子 '+currentMap.seed+' · '+currentMap.w+'×'+currentMap.h;
  for(const b of statsBox.querySelectorAll('b')){ b.parentNode.removeChild(b); }
  const counts={}; for(const row of currentMap.grid) for(const c of row) counts[c]=(counts[c]||0)+1;
  for(const ch of Object.keys(counts).sort((a,b)=>counts[b]-counts[a])){ if(!TERRAIN[ch]) continue;
    const b=document.createElement('b'); const ic=document.createElement('canvas'); ic.width=12; ic.height=12; ic.getContext('2d').drawImage(baseOf(ch),0,0,16,16,0,0,12,12);
    b.appendChild(ic); const t=document.createElement('span'); t.textContent=TERRAIN[ch].name+' '+counts[ch]; b.appendChild(t); statsBox.appendChild(b); }
}
for(const m of MAPS){ const b=document.createElement('button'); b.className='btn'; b.textContent=m.name; b.onclick=()=>{ document.querySelectorAll('#mapbar .btn').forEach(x=>x.classList.remove('active')); b.classList.add('active'); loadMap(m); }; mapbar.appendChild(b); }
const statsBox=document.createElement('div'); statsBox.className='stats'; statsBox.id='statsBox';
const sp=document.createElement('div'); sp.className='panel'; const sp2=document.createElement('h2'); sp2.textContent='地图构成'; sp.appendChild(sp2); sp.appendChild(statsBox);
document.getElementById('palette').appendChild(sp);
document.getElementById('btnReroll').onclick=()=>{ currentDef.seed=(currentDef.seed+137)&0xffff; loadMap(currentDef); };
document.getElementById('btnFit').onclick=fit;
zoomEl.oninput=applyZoom;
gridEl.onchange=()=>{ if(animateEl.checked) startAnim(); else drawFrame(); };
decorEl.onchange=()=>{ cacheCanvas=buildMapCache(currentMap,{decor:decorEl.checked}); drawFrame(); };
animateEl.onchange=()=>{ if(animateEl.checked) startAnim(); else { cancelAnimationFrame(raf); drawFrame(); } };
window.addEventListener('resize',fit);

/* ============ 启动 ============ */
buildPalette();
const qm=parseInt(new URLSearchParams(location.search).get('map')||'0',10);
const first=MAPS[clamp(qm,0,MAPS.length-1)];
loadMap(first);
