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
let cacheCanvas=null, currentMap=null, currentDef=null, raf=null, currentSeed=0, currentMapIdx=0;

/* ============ 渲染循环 ============ */
function drawFrame(now){
  renderFrame(cv.getContext('2d'), cacheCanvas, currentMap, {anim:animateEl.checked, grid:gridEl.checked, speed:speedEl.value*1, tint:tintEl.checked, contour:contourEl.checked}, now);
}
function startAnim(){ if(!animateEl.checked) return; cancelAnimationFrame(raf); const loop=(t)=>{ drawFrame(t); raf=requestAnimationFrame(loop); }; raf=requestAnimationFrame(loop); }

/* ============ 控件 ============ */
const mapbar=document.getElementById('mapbar'), seedinfo=document.getElementById('seedinfo'), seedInput=document.getElementById('seedInput');
const zoomEl=document.getElementById('zoom'), gridEl=document.getElementById('grid'), tintEl=document.getElementById('tint'), contourEl=document.getElementById('contour'), animateEl=document.getElementById('animate'), speedEl=document.getElementById('speed'), zoomvalEl=document.getElementById('zoomval');
function applyZoom(){ const z=zoomEl.value*1; cv.style.width=(cv.width*z)+'px'; cv.style.height=(cv.height*z)+'px'; zoomvalEl.textContent=z.toFixed(1); }
function fit(){ if(!cacheCanvas) return; /* 可用高度取 #mapwrap 计算样式 max-height（桌面 calc(100dvh-150px)），避免初始加载时 clientHeight 被 canvas 内容高度拉低；移动端 max-height:none 回退视口高度 */ const mh=parseFloat(getComputedStyle(wrap).maxHeight); const availH=(Number.isFinite(mh)&&mh>0)?mh:(window.innerHeight-150); const z=clamp(Math.min((wrap.clientWidth-16)/(cacheCanvas.width),(availH-16)/(cacheCanvas.height)),0.5,4); zoomEl.value=z.toFixed(1); applyZoom(); }
function loadMap(def, opts){
  currentDef=def;
  /* 生成期间禁用全部切图按钮 + 「生成中…」反馈；setTimeout(0) 让出主线程先渲染一帧再开始同步生成 */
  const o=(opts&&opts.seed!=null)?{...def,seed:opts.seed}:def;
  const genBtns=[document.getElementById('btnReroll'),...document.querySelectorAll('#mapbar .btn')];
  const labels=genBtns.map(b=>b.textContent);
  genBtns.forEach(b=>{ b.disabled=true; b.textContent='生成中…'; });
  setTimeout(()=>{
    const data=o.dungeon? genDungeon(o) : genWorld(o);
    currentMap=data;
    currentSeed=data.seed;                 /* 以实际生效种子为准（genDungeon 对 seed 0 映射为 1） */
    currentMapIdx=MAPS.indexOf(currentDef);
    cacheCanvas=buildMapCache(data);
    cv.width=data.w*TILE; cv.height=data.h*TILE;
    if(opts && opts.fit) fit(); else applyZoom();
    updateStats();
    seedInput.value=String(currentSeed);
    syncURL(currentMapIdx,currentSeed);   /* history.replaceState，不刷新 */
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
/* ============ URL 深链分享 / 地图选择 / 种子输入 ============ */
function syncURL(idx,seed){
  const p=new URLSearchParams(location.search);
  p.set('map',String(idx)); p.set('seed',String(seed));
  history.replaceState(null,'',location.pathname+'?'+p.toString());
}
function selectMap(idx,opts){
  currentMapIdx=clamp(idx,0,MAPS.length-1);
  const m=MAPS[currentMapIdx];
  currentDef=m;
  [...mapbar.children].forEach((x,i)=>{ x.classList.toggle('active',i===currentMapIdx); x.setAttribute('aria-pressed',i===currentMapIdx?'true':'false'); });
  currentSeed=(opts&&opts.seed!=null)?opts.seed:(m.seed!=null?m.seed:(m.dungeon?1:0));
  loadMap(m,{seed:currentSeed,fit:opts&&opts.fit});
}
function applySeedInput(){
  const v=parseInt(seedInput.value,10);
  if(Number.isNaN(v)){ seedInput.value=String(currentSeed); return; }
  const s=clamp(v,0,65535);
  if(s===currentSeed && currentMap && currentMap.seed===s){ seedInput.value=String(currentSeed); return; }
  currentSeed=s;
  loadMap(currentDef,{seed:s});
}
for(const m of MAPS){ const b=document.createElement('button'); b.className='btn'; b.setAttribute('aria-pressed','false'); b.textContent=m.name; b.onclick=()=>selectMap(MAPS.indexOf(m)); mapbar.appendChild(b); }
const statsBox=document.createElement('div'); statsBox.className='stats'; statsBox.id='statsBox';
const sp=document.createElement('div'); sp.className='panel'; const sp2=document.createElement('h2'); sp2.textContent='地图构成'; sp.appendChild(sp2); sp.appendChild(statsBox);
document.getElementById('palette').appendChild(sp);
document.getElementById('btnReroll').onclick=()=>{ currentSeed=Math.floor(Math.random()*65536); loadMap(currentDef,{seed:currentSeed}); };
document.getElementById('btnFit').onclick=fit;
zoomEl.oninput=applyZoom;
gridEl.onchange=()=>{ if(animateEl.checked) startAnim(); else drawFrame(); };
tintEl.onchange=()=>{ if(animateEl.checked) startAnim(); else drawFrame(); };
contourEl.onchange=()=>{ if(animateEl.checked) startAnim(); else drawFrame(); };
animateEl.onchange=()=>{ if(animateEl.checked) startAnim(); else { cancelAnimationFrame(raf); drawFrame(); } };
seedInput.addEventListener('keydown',(e)=>{ if(e.key==='Enter'){ e.preventDefault(); seedInput.blur(); } });
seedInput.addEventListener('change',applySeedInput);
/* ============ 键盘快捷键：1-9 切图 / R 换种子 / F 适应窗口 / G 网格 / A 动画 ============ */
document.addEventListener('keydown',(e)=>{
  const t=e.target;
  /* 修饰键组合或聚焦输入控件时让位（不抢输入框、不破坏复选框焦点） */
  if(e.ctrlKey||e.metaKey||e.altKey||e.shiftKey) return;
  if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.tagName==='SELECT'||t.isContentEditable)) return;
  /* 已聚焦按钮时用方向键在按钮间移动焦点（可访问性） */
  if(t&&t.tagName==='BUTTON'&&(e.key==='ArrowLeft'||e.key==='ArrowRight'||e.key==='ArrowUp'||e.key==='ArrowDown')){
    const btns=[...document.querySelectorAll('button')];
    const i=btns.indexOf(t);
    if(i>=0){ e.preventDefault();
      const j=e.key==='ArrowRight'||e.key==='ArrowDown' ? (i+1)%btns.length : (i-1+btns.length)%btns.length;
      btns[j].focus();
    }
    return;
  }
  if(e.key>='1'&&e.key<='9'){ const b=mapbar.children[e.key.charCodeAt(0)-49];
    if(b&&b.tagName==='BUTTON'){ e.preventDefault(); b.click(); }
    return;
  }
  const k=e.key.toLowerCase();
  if(k==='r'){ e.preventDefault(); document.getElementById('btnReroll').click(); }
  else if(k==='f'){ e.preventDefault(); document.getElementById('btnFit').click(); }
  else if(k==='g'){ e.preventDefault(); gridEl.checked=!gridEl.checked; gridEl.dispatchEvent(new Event('change')); }
  else if(k==='a'){ e.preventDefault(); animateEl.checked=!animateEl.checked; animateEl.dispatchEvent(new Event('change')); }
});
window.addEventListener('resize',fit);

/* ============ 启动 ============ */
buildPalette();
/* 尊重 prefers-reduced-motion：命中则默认关闭动画，静态帧更省电且对运动敏感用户友好（P1-2/P2-3） */
const mq=window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
if(mq && mq.matches) animateEl.checked=false;
if(mq){ const onMq=()=>{ if(mq.matches && animateEl.checked){ animateEl.checked=false; cancelAnimationFrame(raf); drawFrame(); } };
  if(mq.addEventListener) mq.addEventListener('change',onMq); else if(mq.addListener) mq.addListener(onMq); }
const qp=new URLSearchParams(location.search);
const qm=parseInt(qp.get('map')||'0',10);
const qs=parseInt(qp.get('seed'),10);
const validSeed=Number.isInteger(qs)&&qs>=0&&qs<=65535;
selectMap(qm,{seed:validSeed?qs:undefined,fit:true});
