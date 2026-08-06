/* 生成黄金基线（固定 seed，项目确定性，无随机漂移）。
   1) baseof.json：baseOf 纯地形瓦片 RGBA 十六进制 → T1 逐字节护栏
   2) cache.json：buildMapCache 全缓冲 SHA-256（主缓存 + 海拔着色/等高线覆盖层）→ T7 2D 逐字节护栏。
      全缓冲 hex 每图 ~3.6MB 不实用，用 SHA-256 摘要做字节级护栏（任一字节改动即哈希漂移）。
   用法：node tests/gen-golden.mjs
   当 T1/T7 因「有意」的渲染/调色改动而失败时，重新运行本脚本刷新基线，
   但请先确认改动是预期的，而非回归。 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import './shim.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const { TERRAIN } = await import('../src/terrain.js');
const { baseOf } = await import('../src/tiles.js');
const { genWorld, MAPS } = await import('../src/mapgen.js');
const { buildMapCache } = await import('../src/render.js');

const terrains = {};
for (const ch of Object.keys(TERRAIN).sort()){
  const b = baseOf(ch)._buf;
  terrains[ch] = Buffer.from(b.buffer, b.byteOffset, b.length).toString('hex');
}
const out = join(HERE, 'golden', 'baseof.json');
fs.mkdirSync(dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ note: 'baseOf 零邻居瓦片 RGBA 十六进制（固定 seed）', terrains }, null, 1) + '\n');
console.log(`golden 已写入 ${out}：${Object.keys(terrains).length} 个地形`);

/* ---- 2D buildMapCache 全缓冲黄金哈希（T7 护栏；固定 seed 高差图） ---- */
const sha = (canvas) => createHash('sha256').update(Buffer.from(canvas._buf.buffer, canvas._buf.byteOffset, canvas._buf.length)).digest('hex');
const CACHE_GOLDEN = [
  { id: 'plateau', seed: 47 },
  { id: 'doom', seed: 23 },
  { id: 'frozen', seed: 31 },
];
const caches = {};
for (const g of CACHE_GOLDEN){
  const def = MAPS.find((d) => d.id === g.id);
  if (!def){ console.warn(`跳过未知地图 ${g.id}`); continue; }
  const m = genWorld({ ...def, seed: g.seed });
  const cache = buildMapCache(m);
  caches[`${g.id}-${g.seed}`] = {
    main: sha(cache),
    tint: cache.tintCanvas ? sha(cache.tintCanvas) : null,
    contour: cache.contourCanvas ? sha(cache.contourCanvas) : null,
  };
}
const out2 = join(HERE, 'golden', 'cache.json');
fs.writeFileSync(out2, JSON.stringify({ note: 'buildMapCache 全缓冲 SHA-256（固定 seed 地图，T7 2D 逐字节护栏）', caches }, null, 1) + '\n');
console.log(`golden 已写入 ${out2}：${Object.keys(caches).length} 张地图`);
