/* ============ 图鉴面板 ============ */
import { TILE } from './util.js';
import { TERRAIN, PALETTE_ORDER } from './terrain.js';
import { baseOf, tileCanvas, bridgeTileCached } from './tiles.js';
import { drawTree, drawRock, drawBush, drawFlower, drawHouse } from './decor.js';

export function buildPalette(){
  const pal=document.getElementById('palette');
  const p1=document.createElement('div'); p1.className='panel';
  const h1=document.createElement('h2'); h1.textContent='基础瓦片（16×16 程序化生成）';
  p1.appendChild(h1); const g1=document.createElement('div'); g1.className='tiles';
  for(const [ch] of PALETTE_ORDER){ const t=document.createElement('div'); t.className='tile';
    const cvn=document.createElement('canvas'); cvn.width=cvn.height=TILE; cvn.getContext('2d').drawImage(baseOf(ch),0,0);
    t.appendChild(cvn); const n=document.createElement('div'); n.className='n'; n.textContent=TERRAIN[ch].name;
    const l=document.createElement('div'); l.className='l'; l.textContent=ch+' · 海拔'+TERRAIN[ch].elev;
    t.appendChild(n); t.appendChild(l); g1.appendChild(t); }
  p1.appendChild(g1); pal.appendChild(p1);

  const p2=document.createElement('div'); p2.className='panel';
  const h2=document.createElement('h2'); h2.textContent='过渡瓦片 · 完整16片集（Wang 四邻位掩码）';
  p2.appendChild(h2);
  const pairs16=[['~','S'],['G','S'],['G','T']];
  const pairs4=[['~','F'],['T','W'],['T','L'],['R','G'],['P','C']];
  for(const [a,b] of pairs16){
    const lab=document.createElement('div'); lab.className='pair'; lab.textContent=TERRAIN[a].name+' ↔ '+TERRAIN[b].name+' · 16片完整过渡';
    p2.appendChild(lab); const set=document.createElement('div'); set.className='wset';
    for(let bits=0;bits<16;bits++){ const dirs=[]; if(bits&1)dirs.push('n'); if(bits&2)dirs.push('e'); if(bits&4)dirs.push('s'); if(bits&8)dirs.push('w'); set.appendChild(tileEl(a,b,dirs,8,bitsLabel(bits))); }
    p2.appendChild(set);
  }
  for(const [a,b] of pairs4){
    const lab=document.createElement('div'); lab.className='pair'; lab.textContent=TERRAIN[a].name+' ↔ '+TERRAIN[b].name+' · 4边缘过渡';
    p2.appendChild(lab); const set=document.createElement('div'); set.className='wset t4';
    const nm={n:'上',s:'下',w:'左',e:'右'};
    for(const d of ['n','s','w','e']) set.appendChild(tileEl(a,b,[d],8,nm[d]));
    p2.appendChild(set);
  }
  pal.appendChild(p2);

  const p3=document.createElement('div'); p3.className='panel';
  const h3=document.createElement('h2'); h3.textContent='装饰物（自动散布 + 房屋）';
  p3.appendChild(h3); const d3=document.createElement('div'); d3.className='decors';
  const sprites=[['落叶树',(c)=>{c.clearRect(0,0,16,16);drawTree(c,0,0,'tree');}],['针叶树',(c)=>{c.clearRect(0,0,16,16);drawTree(c,0,0,'pine');}],['岩石',(c)=>{c.clearRect(0,0,16,16);drawRock(c,0,0);}],['灌木',(c)=>{c.clearRect(0,0,16,16);drawBush(c,0,0);}],['花朵',(c)=>{c.clearRect(0,0,16,16);drawFlower(c,0,0);}],['房屋',(c)=>{c.clearRect(0,0,16,16);drawHouse(c,0,0);}],['木桥·横',(c)=>{c.clearRect(0,0,16,16);c.drawImage(bridgeTileCached('h'),0,0);}],['木桥·纵',(c)=>{c.clearRect(0,0,16,16);c.drawImage(bridgeTileCached('v'),0,0);}]];
  for(const [name,fn] of sprites){ const w=document.createElement('div'); w.className='tile';
    const cn=document.createElement('canvas'); cn.width=cn.height=TILE; fn(cn.getContext('2d'),0,0); w.appendChild(cn);
    const n=document.createElement('div'); n.className='n'; n.textContent=name; w.appendChild(n); d3.appendChild(w); }
  p3.appendChild(d3); pal.appendChild(p3);

  const p4=document.createElement('div'); p4.className='panel';
  const h4=document.createElement('h2'); h4.textContent='图例 · 海拔（高低地形差）';
  p4.appendChild(h4); const leg=document.createElement('div'); leg.className='legend';
  for(const [ch] of PALETTE_ORDER){ const s=document.createElement('span');
    const cn=document.createElement('canvas'); cn.width=cn.height=TILE; cn.getContext('2d').drawImage(baseOf(ch),0,0);
    s.appendChild(cn); const t=document.createElement('span'); t.textContent=TERRAIN[ch].name+' · 海拔'+TERRAIN[ch].elev; s.appendChild(t); leg.appendChild(s); }
  p4.appendChild(leg); pal.appendChild(p4);

  const p5=document.createElement('div'); p5.className='panel';
  const h5=document.createElement('h2'); h5.textContent='说明';
  p5.appendChild(h5); const n5=document.createElement('div'); n5.className='note';
  n5.innerHTML='所有瓦片均为逐像素程序化生成（值噪声 + 色带 + 四邻位掩码过渡 + 2×2 Bayer 抖动混合）。每格瓦片按 4 邻位掩码合成，多邻居交界处取主导地形，三岔/四岔角落过渡自然。河流自动切割陆地、道路跨河处自动生成木桥并带方向性流水动画。浪花泡沫、岩浆辉光、海拔阴影与悬崖棱线用于强化自然过渡与高低地形差。支持 ?map=0..3 直接打开对应地图，点「换种子」可重新生成世界。';
  p5.appendChild(n5); pal.appendChild(p5);
}
export function tileEl(A,B,dirs,bnd,label){
  const w=document.createElement('div'); w.className='tw';
  const cn=document.createElement('canvas'); cn.width=cn.height=TILE; cn.getContext('2d').drawImage(tileCanvas(A,B,dirs),0,0);
  w.appendChild(cn); if(label){ const t=document.createElement('div'); t.className='tl'; t.textContent=label; w.appendChild(t); }
  return w;
}
export function bitsLabel(bits){ const n=[]; if(bits&1)n.push('上'); if(bits&2)n.push('右'); if(bits&4)n.push('下'); if(bits&8)n.push('左'); return n.length?n.join(''):'纯'; }
