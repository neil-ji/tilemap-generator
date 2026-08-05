/* ============ 地形纹理 ============ */
import { hash2, clampc } from './util.js';

export function cOcean(x,y,s){ const v=hash2(x,y,s); const dep=(y+0.5)/16; let r=20,g=55,b=118;
  r+=v*12; g+=v*24; b+=v*30;
  r*=(1-0.16*dep); g*=(1-0.13*dep); b*=(1-0.09*dep);
  if(((x-(y>>1)+16)&3)===0 && v>0.5){ r+=9; g+=22; b+=18; }
  if(v>0.93){ r+=14; g+=28; b+=22; }
  return clampc(r,g,b); }
export function cSand(x,y,s){ const v=hash2(x,y,s); let r=228,g=208,b=162;
  if(v<0.18){ r-=24; g-=24; b-=28; } else if(v<0.34){ r-=8; g-=8; b-=10; }
  else if(v>0.8){ r+=12; g+=10; b+=6; }
  if(v>0.965){ r=255; g=251; b=238; }
  return clampc(r,g,b); }
export function cGrass(x,y,s){ const v=hash2(x,y,s); const v2=hash2(x+9,y+3,s+1); let r=88,g=162,b=68;
  if(v<0.16){ r-=20; g-=30; b-=14; } else if(v<0.3 && v2>0.5){ r-=12; g-=20; b-=8; }
  else if(v>0.82){ r+=26; g+=22; b+=12; } else if(v>0.72 && v2<0.4){ r+=10; g+=14; b+=4; }
  return clampc(r,g,b); }
export function cDirt(x,y,s){ const v=hash2(x,y,s); let r=152,g=99,b=57;
  if(v<0.2){ r-=24; g-=18; b-=12; } else if(v>0.82){ r+=20; g+=16; b+=8; }
  if(v>0.97){ r+=40; g+=52; b+=60; }
  return clampc(r,g,b); }
export function cRoad(x,y,s){ const v=hash2(x,y,s); let r=170,g=156,b=124;
  if((y&3)===0){ r-=30; g-=30; b-=28; }
  else if(((x+((y>>2)&1)*2)&3)===0){ r-=14; g-=14; b-=16; }
  if(v<0.18){ r-=16; g-=15; b-=14; } else if(v>0.82){ r+=14; g+=12; b+=10; }
  if(v>0.97){ r+=24; g+=22; b+=18; }
  return clampc(r,g,b); }
export function cStone(x,y,s){ const v=hash2(x,y,s); let r=143,g=143,b=155;
  if(v<0.2){ r-=30; g-=30; b-=28; } else if(v>0.78){ r+=22; g+=22; b+=18; }
  if(hash2(x,y,s+7)<0.05 && ((x*3+y*5)&7)<2){ r-=26; g-=26; b-=26; }
  return clampc(r,g,b); }
export function cSnow(x,y,s){ const v=hash2(x,y,s); let r=240,g=246,b=252;
  if(v<0.28){ r-=26; g-=22; b-=16; } else if(v>0.85){ r+=14; g+=9; b+=2; }
  if(v>0.97){ r+=12; g+=12; b+=16; }
  return clampc(r,g,b); }
export function cFrozen(x,y,s){ const v=hash2(x,y,s); let r=182,g=212,b=238;
  r+=v*14; g+=v*12; b+=v*8;
  if(v<0.2){ r-=22; g-=26; b-=24; } else if(v>0.86){ r+=24; g+=20; b+=10; }
  if(hash2(x>>1,y,s+5)<0.06 && ((x+y)&1)===0){ r+=30; g+=30; b+=30; }
  return clampc(r,g,b); }
export function cLava(x,y,s){ const v=hash2(x,y,s); let r,g,b;
  if(v<0.16){ r=255; g=170; b=30; } else if(v<0.46){ r=245; g=124; b=42; }
  else if(v<0.74){ r=216; g=68; b=22; } else { r=122; g=34; b=12; }
  if(v>0.9 && hash2(x,y,s+3)<0.5){ r=72; g=22; b=10; }
  return clampc(r,g,b); }
export function cFloor(x,y,s){ const bx=x&7,by=y&7;
  if(bx===0 || by===0) return [104,110,121];
  const v=hash2(x,y,s); let r=150,g=156,b=166;
  if(v<0.2){ r-=20; g-=20; b-=18; } else if(v>0.8){ r+=12; g+=12; b+=10; }
  if(v>0.97){ r-=12; g-=12; b-=10; }
  return clampc(r,g,b); }
export function cWall(x,y,s){ const row=y>>2,off=(row&1)*4;
  if((y&3)===0) return [73,70,81];
  if(((x+off)&7)===0) return [73,70,81];
  const v=hash2(x,y,s); let r=108,g=104,b=116;
  if((y&3)===1){ r+=14; g+=14; b+=12; }
  if(v<0.2){ r-=22; g-=22; b-=20; } else if(v>0.82){ r+=12; g+=12; b+=10; }
  if(v>0.98){ r-=16; g-=16; b-=14; }
  return clampc(r,g,b); }

export const TERRAIN = {
  '~':{name:'海洋', seed:3, elev:0, color:cOcean},
  'S':{name:'沙滩', seed:5, elev:1, color:cSand},
  'P':{name:'石板地板', seed:31, elev:1, color:cFloor},
  'D':{name:'泥地', seed:11, elev:2, color:cDirt},
  'G':{name:'草地', seed:7, elev:2, color:cGrass},
  'R':{name:'道路', seed:13, elev:2, color:cRoad},
  'L':{name:'岩浆', seed:29, elev:2, color:cLava},
  'F':{name:'冰原', seed:23, elev:3, color:cFrozen},
  'T':{name:'岩石', seed:17, elev:3, color:cStone},
  'C':{name:'岩壁', seed:37, elev:3, color:cWall},
  'W':{name:'雪地', seed:19, elev:4, color:cSnow},
  'B':{name:'桥', seed:13, elev:2, color:cRoad}
};
export const PALETTE_ORDER=[['~','海洋'],['S','沙滩'],['G','草地'],['D','泥地'],['R','道路'],['T','岩石'],['W','雪地'],['F','冰原'],['L','岩浆'],['P','石板地板'],['C','岩壁']];
