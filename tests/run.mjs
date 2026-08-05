/* tilemap-generator 基础回归测试（纯 Node + canvas shim，零依赖）。
   运行：node tests/run.mjs   （或 npm test）
   覆盖：
     T1  无过渡格逐字节一致：26 地形 baseOf 瓦片 vs 固定 seed 黄金基线 + 原始地形色函数
     T2  过渡签名缓存一致性：同签名不同世界坐标逐字节一致（验证模板缓存 key 不掺位置）
     T3  5 张地图生成 smoke：grid 尺寸 / 无未定义地形 / 地形统计和 = w×h
     T4  道路窄条验证（roadBase 特征检测；依赖道路改造合入，未合入则 SKIP）
     T5  高度层数据：heights 尺寸 w×h、范围 [0,1]
   退出码：有 FAIL 时 1，否则 0。 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import './shim.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');
const { TILE } = await import('../src/util.js');
const { TERRAIN } = await import('../src/terrain.js');
const { renderCell, baseOf } = await import('../src/tiles.js');
const { genWorld, genDungeon, MAPS } = await import('../src/mapgen.js');

/* ============ 小工具 ============ */
const neighbors = (grid, w, h, x, y) => {
  const g = (xx, yy) => (yy >= 0 && yy < h && xx >= 0 && xx < w) ? grid[yy][xx] : null;
  return { n: g(x, y - 1), s: g(x, y + 1), w: g(x - 1, y), e: g(x + 1, y),
    nw: g(x - 1, y - 1), ne: g(x + 1, y - 1), sw: g(x - 1, y + 1), se: g(x + 1, y + 1) };
};
const neighborKey = (t, nbs) => t + '|' + (nbs.n || '.') + (nbs.s || '.') + (nbs.w || '.') + (nbs.e || '.')
  + (nbs.nw || '.') + (nbs.ne || '.') + (nbs.sw || '.') + (nbs.se || '.');
const newImg = () => document.createElement('canvas').getContext('2d').createImageData(TILE, TILE);
function cellPixels(t, nbs, cx, cy){
  const img = newImg();
  const flat = renderCell(t, nbs, img, cx || 0, cy || 0);
  return new Uint8ClampedArray(flat ? flat._buf : img.data); /* 拷贝，防后续渲染覆盖 */
}
const bufEq = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
function firstByteDiff(a, b){
  for (let i = 0; i < Math.min(a.length, b.length); i += 4){
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]){
      return { x: (i / 4) % TILE, y: Math.floor(i / 4 / TILE), got: Array.from(a.slice(i, i + 4)), want: Array.from(b.slice(i, i + 4)) };
    }
  }
  return { x: -1, y: -1, got: null, want: null };
}

/* ============ 极简 harness ============ */
const results = [];
async function test(name, fn){
  const t0 = performance.now();
  try {
    const r = await fn(); /* 支持 async 用例（T2 动态 import），await 保证顺序与异常捕获 */
    results.push({ name, status: (r && r.status) || 'PASS', detail: (r && r.detail) || '', ms: (performance.now() - t0).toFixed(1) });
  } catch (e){
    results.push({ name, status: 'FAIL', detail: (e && e.message) ? e.message : String(e), ms: (performance.now() - t0).toFixed(1) });
  }
}
const ok = (detail) => ({ status: 'PASS', detail });
const skip = (detail) => ({ status: 'SKIP', detail });
const fail = (detail) => ({ status: 'FAIL', detail });

/* ============ T1 无过渡格逐字节一致 ============ */
await test('T1 纯地形瓦片逐字节 vs 黄金基线 + 原始地形色函数（26 地形）', () => {
  const goldenPath = join(HERE, 'golden', 'baseof.json');
  if (!fs.existsSync(goldenPath)) return fail(`缺少黄金基线 ${goldenPath}——请先运行 node tests/gen-golden.mjs`);
  const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8')).terrains;
  const missing = Object.keys(TERRAIN).filter((ch) => !(ch in golden));
  if (missing.length) return fail('golden 缺失地形 ' + missing.join(',') + '（运行 node tests/gen-golden.mjs 重新生成）');
  const extra = Object.keys(golden).filter((ch) => !(ch in TERRAIN));
  if (extra.length) return fail('golden 含已移除地形 ' + extra.join(',') + '（运行 node tests/gen-golden.mjs 重新生成）');

  let diffCount = 0, pipelineDrift = 0, colorChange = 0, firstDiff = null;
  for (const ch of Object.keys(TERRAIN)){
    const want = Buffer.from(golden[ch], 'hex');
    const got = baseOf(ch)._buf;
    if (want.length !== got.length){
      diffCount++;
      if (!firstDiff) firstDiff = { ch, kind: '长度', x: -1, y: -1, got: got.length, want: want.length };
      continue;
    }
    for (let i = 0; i < got.length; i += 4){
      const same = got[i] === want[i] && got[i + 1] === want[i + 1] && got[i + 2] === want[i + 2] && got[i + 3] === want[i + 3];
      if (!same){
        diffCount++;
        const x = (i / 4) % TILE, y = Math.floor(i / 4 / TILE);
        if (!firstDiff) firstDiff = { ch, x, y, got: Array.from(got.slice(i, i + 4)), want: Array.from(want.slice(i, i + 4)) };
        /* 分类：该像素当前地形色函数输出 == 基线 → 渲染管线漂移；== 渲染结果 → 地形色函数被改 */
        const c = TERRAIN[ch].color(x, y, TERRAIN[ch].seed);
        const rawMatchesBaseline = c[0] === want[i] && c[1] === want[i + 1] && c[2] === want[i + 2];
        const rawMatchesRender = c[0] === got[i] && c[1] === got[i + 1] && c[2] === got[i + 2];
        if (rawMatchesBaseline && !rawMatchesRender) pipelineDrift++;
        else if (rawMatchesRender && !rawMatchesBaseline) colorChange++;
      }
    }
  }
  if (diffCount){
    const kind = firstDiff.kind
      ? `地形=${firstDiff.ch} 长度差异 got=${firstDiff.got} want=${firstDiff.want}`
      : `地形=${firstDiff.ch} 像素(${firstDiff.x},${firstDiff.y}) got=[${firstDiff.got}] want=[${firstDiff.want}]`;
    let hint;
    if (pipelineDrift > colorChange) hint = '（地形色函数未变但渲染输出漂移 → 渲染管线改动）';
    else if (colorChange > 0) hint = '（地形色函数相对基线已变 → 调色/纹理改动；若为有意改动请 node tests/gen-golden.mjs 重新生成基线）';
    else hint = '（无法分类的差异，请人工核对）';
    return fail(`${diffCount} 像素字节不一致，首个差异 ${kind}${hint}`);
  }
  return ok('26 个地形零邻居瓦片与固定 seed 黄金基线逐字节一致，且与原始地形色函数一致');
});

/* ============ T2 过渡签名缓存一致性 ============ */
await test('T2 过渡签名缓存一致性（同签名不同坐标逐字节一致）', async () => {
  const sigs = [];
  const seen = new Set();
  const push = (label, t, nbs) => {
    const k = label + '|' + neighborKey(t, nbs);
    if (!seen.has(k)){ seen.add(k); sigs.push({ label, t, nbs }); }
  };
  /* 真实签名：每张地图取一个 R 格、一个正交过渡格、一个多邻居角格 */
  for (const def of MAPS){
    const m = def.dungeon ? genDungeon(def) : genWorld(def);
    const { grid, w, h } = m;
    let foundR = false, foundTrans = false, foundCorner = false;
    outer:
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
      const t = grid[y][x];
      const nb = neighbors(grid, w, h, x, y);
      const orth = [nb.n, nb.s, nb.w, nb.e].filter(Boolean);
      const orthSet = new Set(orth);
      const diagDiffers = [nb.nw, nb.ne, nb.sw, nb.se].some((d) => d && d !== t);
      if (!foundR && t === 'R'){ push(def.id + '-R', 'R', nb); foundR = true; }
      if (!foundTrans && orth.some((o) => o !== t)){ push(def.id + '-trans', t, nb); foundTrans = true; }
      if (!foundCorner && orthSet.size >= 2 && orth.some((o) => o !== t) && diagDiffers){ push(def.id + '-corner', t, nb); foundCorner = true; }
      if (foundR && foundTrans && foundCorner) break outer;
    }
  }
  /* 合成签名兜底（保证覆盖 R↔G 与 水陆过渡） */
  push('synth-R-G', 'R', { n: 'R', s: 'R', w: 'G', e: 'G', nw: 'G', ne: 'G', sw: 'G', se: 'G' });
  push('synth-water-land', 'G', { n: '~', s: 'G', w: 'G', e: 'G', nw: '~', ne: 'G', sw: '~', se: 'G' });

  /* 至少要有非 flat（真实过渡）签名，否则测试空转 */
  const nonFlat = sigs.filter((s) => renderCell(s.t, s.nbs, newImg(), 0, 0) === null);
  if (!nonFlat.length) return fail('未收集到任何非 flat 过渡签名，缓存一致性无法验证');

  const COORDS = [[0, 0], [4, 0], [0, 4], [7, 3], [1, 5], [-2, 9], [13, 20]];
  let bad = 0, firstBad = '', checked = 0;
  for (const s of sigs){
    checked++;
    const ref = cellPixels(s.t, s.nbs, COORDS[0][0], COORDS[0][1]);
    for (const [cx, cy] of COORDS.slice(1)){
      const p = cellPixels(s.t, s.nbs, cx, cy);
      if (!bufEq(ref, p)){
        const d = firstByteDiff(ref, p);
        bad++;
        if (!firstBad) firstBad = `${s.label} 签名=${neighborKey(s.t, s.nbs)} 坐标(${COORDS[0]}) vs (${cx},${cy}) 像素(${d.x},${d.y}) got=[${d.got}] want=[${d.want}]`;
      }
    }
  }
  /* 缓存命中（primary）== 全新构建（fresh 模块实例，空 templateCache） */
  const fresh = await import('../src/tiles.js?fresh=' + performance.now());
  let freshBad = 0, firstFresh = '';
  for (const s of nonFlat.slice(0, 6)){
    const cached = cellPixels(s.t, s.nbs, 0, 0);          /* primary：首次 build 后为缓存命中 */
    const img2 = newImg();
    const flat2 = fresh.renderCell(s.t, s.nbs, img2, 0, 0);
    const built = new Uint8ClampedArray(flat2 ? flat2._buf : img2.data);
    if (!bufEq(cached, built)){
      const d = firstByteDiff(cached, built);
      freshBad++;
      if (!firstFresh) firstFresh = `${s.label} 缓存命中 vs 全新构建 像素(${d.x},${d.y}) got=[${d.got}] want=[${d.want}]`;
    }
  }
  if (bad) return fail(`${bad}/${checked} 个签名出现坐标相关漂移，首个 ${firstBad}`);
  if (freshBad) return fail(`${freshBad} 个签名「缓存命中 ≠ 全新构建」，首个 ${firstFresh}`);
  return ok(`${checked} 个过渡签名（含 ${nonFlat.length} 个非 flat）在 ${COORDS.length} 组坐标下逐字节一致；缓存命中==全新构建`);
});

/* ============ T3 五张地图生成 smoke ============ */
await test('T3 五张地图生成 smoke（尺寸 / 未定义地形 / 统计和）', () => {
  const problems = [];
  let passed = 0;
  for (const def of MAPS){
    const m = def.dungeon ? genDungeon(def) : genWorld(def);
    const { grid, w, h } = m;
    if (!Array.isArray(grid) || grid.length !== h){ problems.push(`${def.id}: grid 行数 ${grid ? grid.length : '(无)'} != ${h}`); continue; }
    let rowsBad = 0, sum = 0;
    const badChars = {};
    for (let y = 0; y < h; y++){
      const row = grid[y];
      if (!Array.isArray(row) || row.length !== w){ rowsBad++; continue; }
      for (let x = 0; x < w; x++){
        const c = row[x];
        sum++;
        if (typeof c !== 'string' || !TERRAIN[c]) badChars[c] = (badChars[c] || 0) + 1;
      }
    }
    if (rowsBad) problems.push(`${def.id}: ${rowsBad} 行宽度 != ${w}`);
    const badKeys = Object.keys(badChars);
    if (badKeys.length){
      const total = Object.values(badChars).reduce((a, b) => a + b, 0);
      problems.push(`${def.id}: ${total} 个未定义地形字符 ${badKeys.map((k) => (k === '' ? '(空)' : k)).join(',')}`);
    }
    if (sum !== w * h) problems.push(`${def.id}: 地形统计和 ${sum} != ${w}×${h}=${w * h}`);
    else passed++;
  }
  if (problems.length) return fail(problems.join('；'));
  return ok(`${passed}/${MAPS.length} 张地图生成通过（grid 尺寸正确、无未定义地形、统计和=w×h）`);
});

/* ============ T4 道路窄条验证（依赖道路改造） ============ */
await test('T4 道路窄条验证（roadBase 特征检测，依赖道路改造合入）', () => {
  let hasBase = false;
  for (const def of MAPS){
    if (def.dungeon) continue;
    const m = genWorld(def);
    if (m.roadBase != null){ hasBase = true; break; }
  }
  if (!hasBase) return skip('roadBase 特性未合入当前分支（道路改造未落地）——跳过道路窄条断言；合入后本测试自动启用');

  const WATER = { '~': 1, 'U': 1, 'A': 1, 'L': 1, 'Y': 1 };
  const problems = [];
  let roadCells = 0, coastalOk = 0;
  for (const def of MAPS){
    if (def.dungeon) continue;
    const m = genWorld(def);
    const { grid, w, h, roadBase } = m;
    if (!roadBase || roadBase.length !== w * h){ problems.push(`${def.id}: roadBase 缺失或尺寸 != ${w}×${h}`); continue; }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
      if (grid[y][x] !== 'R') continue;
      roadCells++;
      const base = roadBase[y * w + x];
      if (typeof base !== 'string' || !TERRAIN[base]){ problems.push(`${def.id}(${x},${y}): roadBase=${String(base)} 非有效地形`); continue; }
      if (base === 'R'){ problems.push(`${def.id}(${x},${y}): roadBase 仍是 R（盖章前未保存基底）`); continue; }
      const nb = neighbors(grid, w, h, x, y);
      const coastal = [nb.n, nb.s, nb.w, nb.e].some((d) => d === '~' || d === 'U');
      if (coastal && WATER[base]){ problems.push(`${def.id}(${x},${y}): 靠海 R 格 roadBase=${base} 是水体`); }
      else if (coastal) coastalOk++;
      /* 窄路条：R 格像素中「非基底色」占比应在 (0.05, 0.9)——即叠加窄条而非满格替换 */
      const px = cellPixels('R', nb, x, y);
      const baseBuf = baseOf(base)._buf;
      let diff = 0;
      for (let i = 0; i < px.length; i += 4){
        if (Math.abs(px[i] - baseBuf[i]) > 24 || Math.abs(px[i + 1] - baseBuf[i + 1]) > 24 || Math.abs(px[i + 2] - baseBuf[i + 2]) > 24) diff++;
      }
      const frac = diff / (TILE * TILE);
      if (frac >= 0.9) problems.push(`${def.id}(${x},${y}): R 格非基底像素占比 ${(frac * 100).toFixed(0)}% ≥ 90%——疑似满格道路，无窄条`);
      else if (frac <= 0.05) problems.push(`${def.id}(${x},${y}): R 格非基底像素占比 ${(frac * 100).toFixed(0)}% ≤ 5%——窄条缺失`);
    }
  }
  if (problems.length) return fail(problems.join('；'));
  return ok(`roadBase 结构正确（${roadCells} 个 R 格，靠海基底非水体），窄路条占比正常`);
});

/* ============ T5 高度层数据 ============ */
await test('T5 高度层数据（heights 尺寸 w×h、范围 [0,1]）', () => {
  const problems = [];
  let passed = 0;
  for (const def of MAPS){
    const m = def.dungeon ? genDungeon(def) : genWorld(def);
    const hh = m.heights;
    if (hh == null){ problems.push(`${def.id}: 无 heights`); continue; }
    if (!hh.length || hh.length !== m.w * m.h){ problems.push(`${def.id}: heights 长度 ${hh.length} != ${m.w}×${m.h}`); continue; }
    let nan = 0, outLow = 0, outHigh = 0, first = -1;
    for (let i = 0; i < hh.length; i++){
      const v = hh[i];
      if (!Number.isFinite(v)) nan++;
      else if (v < 0) outLow++;
      else if (v > 1){ outHigh++; if (first < 0) first = i; }
    }
    if (nan) problems.push(`${def.id}: ${nan} 个 NaN/Infinity`);
    if (outLow || outHigh) problems.push(`${def.id}: ${outLow} 个<0、${outHigh} 个>1（首个越界索引 ${first}，值 ${hh[first]}` + '）');
    if (!nan && !outLow && !outHigh) passed++;
  }
  if (problems.length) return fail(problems.join('；'));
  return ok(`${passed}/${MAPS.length} 张地图 heights 均为 w×h 尺寸且全部落在 [0,1]`);
});

/* ============ 输出 ============ */
let passed = 0, failed = 0, skipped = 0;
console.log('======== tilemap-generator 基础回归测试 ========');
for (const r of results){
  const icon = r.status === 'PASS' ? '✔' : r.status === 'SKIP' ? '⊘' : '✘';
  console.log(`${icon} [${r.status}] ${r.name} (${r.ms}ms)${r.detail ? ' — ' + r.detail : ''}`);
  if (r.status === 'FAIL') failed++; else if (r.status === 'SKIP') skipped++; else passed++;
}
console.log('==============================================');
console.log(`摘要：PASS ${passed} / FAIL ${failed} / SKIP ${skipped}  （共 ${results.length} 项）`);
process.exit(failed ? 1 : 0);
