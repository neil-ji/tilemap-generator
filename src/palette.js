/* ============ 图鉴面板 ============ */
import { TILE } from './util.js';
import { TERRAIN, PALETTE_ORDER } from './terrain.js';
import { baseOf, tileCanvas } from './tiles.js';

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
  const pairs16=[['~','S'],['~','A'],['G','S'],['G','H'],['G','M'],['~','U'],['G','Q'],['T','V']];
  const pairs4=[['~','F'],['T','W'],['T','L'],['R','G'],['P','C'],['T','K'],['F','N'],['A','S'],['E','G'],['T','Q'],['W','X'],['T','X'],['P','O'],['P','#'],['S','@'],['G','Z'],['E','Z'],['T','Y']];
	  /* 过渡对默认折叠 + 首次展开时懒渲染：启动只建按钮，过渡 canvas 点击展开才生成。
	     道路 R 不再参与地形过渡（窄小径叠基底），pairs4 中 R↔G 改为固定草地基底的窄路示意。 */
	  for(const [a,b] of pairs16) p2.appendChild(makePairRow(a,b,TERRAIN[a].name+' ↔ '+TERRAIN[b].name+' · 16片完整过渡',true));
	  for(const [a,b] of pairs4){
	    const isRoad=a==='R'||b==='R';
	    const label= isRoad? '道路 · 窄小径叠固定草地基底（非过渡）' : (TERRAIN[a].name+' ↔ '+TERRAIN[b].name+' · 4边缘过渡');
	    p2.appendChild(makePairRow(a,b,label,false,isRoad));
	  }
  pal.appendChild(p2);

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
  n5.innerHTML='通过 URL 参数 ?map=0..4 可直达对应地图（如 index.html?map=2），点「换种子」可重新生成世界。所有瓦片均为逐像素程序化生成（值噪声 + 色带 + 四邻位掩码过渡 + 2×2 Bayer 抖动混合）。26 种地形瓦片（深水/海洋/浅滩/泥滩/沙滩/沙漠/草原灌木/草地/森林/泥地/沼泽/道路/碎石坡/岩石/高原草甸/岩壁/冰原/苔原/雪地/雪岩/岩浆/焦土/石板地板/洞窟地面/木地板/深渊裂隙），任意配对自动支持 Wang 完整过渡，多邻居交界处取主导地形。河流自动切割陆地、道路在河岸自然终止，河流连贯完整。道路是叠加在盖章前基底地形上的 6px 窄小径，颜色随基底自适应（草地土径/沙漠淡沙/雪地压实雪）并带 1px 深色描边，不参与地形过渡（图鉴中道路片以固定草地基底示意）。浪花泡沫、浅滩沫花、沼泽苇秆、岩浆辉光、焦土裂纹与海拔阴影/悬崖棱线用于强化自然过渡与高低地形差。画面纯净无前景装饰。';
  p5.appendChild(n5); pal.appendChild(p5);
}
/* 过渡对分组（P1-3）：默认折叠，仅建一个「▸ 标题」按钮；首次展开才懒渲染 wset 内的过渡 canvas。
   折叠状态面板高度 = 标题 + 26 个紧凑按钮行，不再被 200 个过渡 canvas 撑满侧栏；展开后内容缓存，反复开合无重建、无闪烁。 */
function makePairRow(a,b,label,is16,isRoad){
  const row=document.createElement('div'); row.className='pair-row';
  const btn=document.createElement('button'); btn.type='button'; btn.className='pair-toggle';
  btn.setAttribute('aria-expanded','false'); btn.title='展开/收起该地形过渡对';
  const tri=document.createElement('span'); tri.className='tri'; tri.textContent='▸'; tri.setAttribute('aria-hidden','true');
  btn.appendChild(tri); btn.appendChild(document.createTextNode(label));
  const set=document.createElement('div'); set.className=is16?'wset':'wset t4'; set.hidden=true;
  row.appendChild(btn); row.appendChild(set);
  let built=false;
  const fillSet=()=>{
    if(isRoad){
      for(const d of ['n','s','w','e']){ const w=document.createElement('div'); w.className='tw';
        const cn=document.createElement('canvas'); cn.width=cn.height=TILE; cn.getContext('2d').drawImage(baseOf('R'),0,0);
        w.appendChild(cn); set.appendChild(w); }
    } else if(is16){
      for(let bits=0;bits<16;bits++){ const dirs=[]; if(bits&1)dirs.push('n'); if(bits&2)dirs.push('e'); if(bits&4)dirs.push('s'); if(bits&8)dirs.push('w'); set.appendChild(tileEl(a,b,dirs,8,bitsLabel(bits))); }
    } else {
      const nm={n:'上',s:'下',w:'左',e:'右'}; for(const d of ['n','s','w','e']) set.appendChild(tileEl(a,b,[d],8,nm[d]));
    }
  };
  btn.addEventListener('click',()=>{
    if(set.hidden){ if(!built){ fillSet(); built=true; } set.hidden=false; btn.setAttribute('aria-expanded','true'); }
    else { set.hidden=true; btn.setAttribute('aria-expanded','false'); }
  });
  return row;
}
export function tileEl(A,B,dirs,bnd,label){
  const w=document.createElement('div'); w.className='tw';
  const cn=document.createElement('canvas'); cn.width=cn.height=TILE; cn.getContext('2d').drawImage(tileCanvas(A,B,dirs),0,0);
  w.appendChild(cn); if(label){ const t=document.createElement('div'); t.className='tl'; t.textContent=label; w.appendChild(t); }
  return w;
}
export function bitsLabel(bits){ const n=[]; if(bits&1)n.push('上'); if(bits&2)n.push('右'); if(bits&4)n.push('下'); if(bits&8)n.push('左'); return n.length?n.join(''):'纯'; }
