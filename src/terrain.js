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
export function cRoad(x,y,s){ const v=hash2(x,y,s); let r=186,g=140,b=88;
  // 土路：暖棕压实土面（比泥地 D 更亮更暖），两道横向碾痕车辙 + 稀疏沙砾点
  if((y&3)===1 || (y&3)===3){ r-=16; g-=13; b-=9; }
  else if((y&3)===0){ r+=9; g+=8; b+=5; }
  if(v<0.15){ r-=18; g-=15; b-=10; } else if(v>0.85){ r+=16; g+=13; b+=9; }
  if(v>0.97){ r+=26; g+=22; b+=16; }
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
export function cShallow(x,y,s){ const v=hash2(x,y,s); const dep=(y+0.5)/16; let r=50,g=115,b=158;
  r+=v*16; g+=v*26; b+=v*30;
  r*=(1-0.14*dep); g*=(1-0.11*dep); b*=(1-0.08*dep);
  if((y&3)===1){ r+=10; g+=13; b+=10; }
  const coral=hash2(x,y,s+2);
  if(coral>0.92){ r=232; g=128; b=96; }
  else if(coral>0.87){ r=248; g=180; b=110; }
  if(hash2(x,y,s+3)>0.965){ r=236; g=246; b=252; }
  if(((x+y)&3)===0 && v>0.45){ r+=8; g+=10; b+=8; }
  return clampc(r,g,b); }
export function cSwamp(x,y,s){ const v=hash2(x,y,s); let r=74,g=78,b=44;
  r+=v*14; g+=v*16; b+=v*10;
  if(v<0.18){ r-=18; g-=14; b-=10; } else if(v>0.88){ r+=14; g+=16; b+=10; }
  if(hash2(x>>1,y>>1,s+4)>0.90){ r=48; g=66; b=40; }
  else if(hash2(x,y,s+6)>0.985){ r=52; g=72; b=42; }
  if(hash2(x,y,s+5)>0.965){ r=34; g=48; b=28; }
  return clampc(r,g,b); }
export function cForest(x,y,s){ const v=hash2(x,y,s); let r=58,g=118,b=50;
  if(v<0.15){ r-=14; g-=18; b-=10; } else if(v>0.85){ r+=14; g+=16; b+=8; }
  const canopy=hash2(x>>1,y>>1,s+2);
  if(canopy>0.9){ r-=24; g-=26; b-=16; }
  else if(canopy>0.72){ r+=10; g+=14; b+=6; }
  if(hash2(x,y,s+6)>0.985){ r=92; g=62; b=42; }
  return clampc(r,g,b); }
export function cDesert(x,y,s){ const v=hash2(x,y,s); let r=205,g=174,b=120;
  const band=(y+((hash2(x,0,s)*3)|0))&3;
  if(band===0){ r+=24; g+=18; b+=12; } else if(band===2){ r-=18; g-=15; b-=12; }
  if(v<0.12){ r+=18; g+=14; b+=8; } else if(v>0.9){ r-=16; g-=14; b-=12; }
  if(v>0.975){ r-=30; g-=26; b-=20; }
  return clampc(r,g,b); }
export function cTundra(x,y,s){ const v=hash2(x,y,s); let r=108,g=124,b=104;
  if(v<0.2){ r-=16; g-=16; b-=12; } else if(v>0.82){ r+=14; g+=14; b+=10; }
  const snow=hash2(x>>1,y>>1,s+2);
  if(snow>0.86){ r=236; g=242; b=246; }
  else if(hash2(x,y,s+3)>0.95){ r=72; g=82; b=62; }
  return clampc(r,g,b); }
export function cScorch(x,y,s){ const v=hash2(x,y,s); let r=48,g=44,b=50;
  r+=v*12; g+=v*10; b+=v*14;
  if(hash2(x>>1,y>>1,s+4)>0.9){ r+=20; g+=18; b+=20; }
  if(v>0.88 && hash2(x,y,s+2)<0.5){ r=100; g=38; b=22; }
  const cr=hash2(x,y,s+3);
  if(cr>0.985){ r=255; g=152; b=40; }
  else if(cr>0.97){ r=205; g=95; b=32; }
  return clampc(r,g,b); }

export const TERRAIN = {
  '~':{name:'海洋', seed:3, elev:0, color:cOcean},
  'A':{name:'浅滩', seed:41, elev:0, color:cShallow},
  'S':{name:'沙滩', seed:5, elev:1, color:cSand},
  'E':{name:'沙漠', seed:47, elev:1, color:cDesert},
  'M':{name:'沼泽', seed:25, elev:1, color:cSwamp},
  'P':{name:'石板地板', seed:31, elev:1, color:cFloor},
  'D':{name:'泥地', seed:11, elev:2, color:cDirt},
  'G':{name:'草地', seed:7, elev:2, color:cGrass},
  'H':{name:'森林', seed:43, elev:2, color:cForest},
  'R':{name:'道路', seed:13, elev:2, color:cRoad},
  'L':{name:'岩浆', seed:29, elev:2, color:cLava},
  'F':{name:'冰原', seed:23, elev:3, color:cFrozen},
  'N':{name:'苔原', seed:53, elev:3, color:cTundra},
  'T':{name:'岩石', seed:17, elev:3, color:cStone},
  'K':{name:'焦土', seed:59, elev:3, color:cScorch},
  'C':{name:'岩壁', seed:37, elev:3, color:cWall},
  'W':{name:'雪地', seed:19, elev:4, color:cSnow},
  'B':{name:'桥', seed:13, elev:2, color:cRoad}
};
export const PALETTE_ORDER=[['~','海洋'],['A','浅滩'],['S','沙滩'],['E','沙漠'],['G','草地'],['H','森林'],['D','泥地'],['M','沼泽'],['R','道路'],['T','岩石'],['C','岩壁'],['F','冰原'],['N','苔原'],['W','雪地'],['L','岩浆'],['K','焦土'],['P','石板地板']];
