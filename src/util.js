/* ============ 常量与工具（纯数学/噪声，零依赖，最可复用） ============ */
export const TILE = 16;
export const clamp = (v,a,b)=> v<a?a : v>b?b : v;
export const lerp = (a,b,t)=> a+(b-a)*t;
export const smooth = t => t*t*(3-2*t);
export function clampc(r,g,b){ r=r<0?0:r>255?255:r; g=g<0?0:g>255?255:g; b=b<0?0:b>255?255:b; return [r|0,g|0,b|0]; }
export function mix(a,b,t){ return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t]; }
export function hash2(x,y,s){ let h=(Math.imul(x,374761393)+Math.imul(y,668265263)+Math.imul(s|0,1274126177))|0; h=Math.imul(h^(h>>>13),1103515245); h^=h>>>16; return (h>>>0)/4294967296; }
export function vnoise(x,y,s){ const xi=Math.floor(x),yi=Math.floor(y); const xf=x-xi,yf=y-yi; const u=smooth(xf),v=smooth(yf); const a=hash2(xi,yi,s),b=hash2(xi+1,yi,s),c=hash2(xi,yi+1,s),d=hash2(xi+1,yi+1,s); return lerp(lerp(a,b,u),lerp(c,d,u),v); }
export function fbm(x,y,s){ let sum=0,amp=1,f=1,ns=0; for(let i=0;i<4;i++){ sum+=vnoise(x*f,y*f,s+i*101)*amp; ns+=amp; amp*=0.5; f*=2; } return sum/ns; }
/* 缝线法向偏移：vnoise 平滑插值噪声（替代原逐列白噪声 hash2 项）+ 两个低周正弦。
   相邻列跳变从 ~5px（白噪声随机游走）降到 ~1.5px，海岸线成平滑蜿蜒；pairSeed 保证相邻两格同 c/s → 边界几何对齐。 */
export function wob(c,s){ return (vnoise(c*0.15,(s%100)*0.3,5)-0.5)*6 + Math.sin(c*0.45+s)*0.9 + Math.sin(c*1.2+s*2.1)*0.5; }
