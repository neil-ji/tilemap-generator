/* 生成 baseOf 纯地形瓦片的黄金基线（固定 seed，项目确定性，无随机漂移）。
   用法：node tests/gen-golden.mjs
   当 T1 测试因「有意」的渲染/调色改动而失败时，重新运行本脚本刷新基线，
   但请先确认改动是预期的，而非回归。 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import './shim.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const { TERRAIN } = await import('../src/terrain.js');
const { baseOf } = await import('../src/tiles.js');

const terrains = {};
for (const ch of Object.keys(TERRAIN).sort()){
  const b = baseOf(ch)._buf;
  terrains[ch] = Buffer.from(b.buffer, b.byteOffset, b.length).toString('hex');
}
const out = join(HERE, 'golden', 'baseof.json');
fs.mkdirSync(dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ note: 'baseOf 零邻居瓦片 RGBA 十六进制（固定 seed）', terrains }, null, 1) + '\n');
console.log(`golden 已写入 ${out}：${Object.keys(terrains).length} 个地形`);
