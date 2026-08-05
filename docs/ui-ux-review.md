# tilemap-generator UI/UX 现状分析与优化清单

- 调研日期：2026-08-05
- 范围：**只读分析**，未修改任何源码。依据：`index.html`、`tilemap.html`、`src/*.{js,css}`、git 历史（`60a1c94` 模块化拆分、`73e6970` 丰富瓦片+移除前景装饰）。
- 结论标注：[事实]=代码/git 中可证实的；[推断]=基于经验的判断。每条附置信度。

---

## 0. 核心结论（TL;DR）

1. **存在两套分叉的入口页面**：[事实，high] `tilemap.html`（617 行单文件快照，首个提交加入后从未更新）是旧版独立页——12 种地形、保留「装饰物/房屋」特性、`?map` 仅 0..3；`index.html`（模块化版）是当前版本——17 种地形、完整过渡配对，但有意移除了装饰物。功能向两个方向分叉，且 `dist` 仍会复制 `tilemap.html` 静态副本。
2. **完全无响应式布局**：[事实，high] `style.css` 没有任何 `@media` 查询，`#palette` 固定 `width:400px;flex:none`，375px 手机上必然横向溢出。
3. **地图生成同步阻塞主线程且无 loading 反馈**：[事实，high] `loadMap()` 同步执行生成+缓存，`buildMapCache` 每格新建 canvas+ImageData（44×30 图 ≈1320 次分配 + ~34 万次像素循环），点「换种子」无任何 busy 反馈。
4. **渲染常驻 CPU 开销**：[事实，high] 每帧整图重绘 + 动画默认开启、遍历全部格子。
5. **基础可访问性缺失**：[事实，high] 无 focus-visible 样式、地图按钮无 `aria-pressed`、canvas 无 `role`/`aria-label`、无 `prefers-reduced-motion`。
6. **对比度普遍达标，不是首要问题**：[事实+计算，high] 正文 `#e6e9ef` on `#15171d` ≈15:1；次级文字 `--dim #9aa3b2` 在面板上 ≈6.3:1，均 ≥ WCAG AA 4.5:1。真正可读性问题是 **9–10px 小字号**。

---

## P0 · 结构性 / 移动端（优先级最高）

### P0-1 双入口页面功能分裂（index.html vs tilemap.html） — 影响：高 · 需重构（删除/合并是 quick win）
- **问题描述**：两个入口展示不同的「产品」。
  - `tilemap.html` 为旧版冻结快照：[事实，high] `git log --all -- tilemap.html` 显示该文件在 `60a1c94`（模块化拆分）加入后未被后续提交触碰；`73e6970`（标题"丰富瓦片/过渡/地图 + **移除前景装饰**"）删除了 `src/decor.js`（57 行），但未同步删除或更新 `tilemap.html`。
  - 差异量化（[事实，high]）：地形 12 vs 17（旧版缺 沙漠E/沼泽M/苔原N/焦土K/浅滩A）；过渡配对 3×16+5×4 vs 5×16+9×4；地图 4 vs 5；旧版**独有**装饰物 checkbox + 房屋 + 装饰物图鉴面板，新版**独有** 17 地形与更全过渡。
  - 用户访问 `/tilemap.html`（或 dist 中的静态副本）看到的与首页不同，且 `?map=0..4` 两页行为不一致。
- **代码位置**：`tilemap.html:1-617`（内联 `<style>` 7-44、内联 `<script>` 66-615、装饰物面板 579-586、TERRAIN 12 种 139-153、MAPS 4 个 405-423）；`index.html:1-30`；`src/palette.js:6-51`；`src/main.js:42-57`。
- **建议改法**：
  - 若装饰物是有意移除（index 说明文案明确写"画面纯净无前景装饰"，提交标题一致）→ **删除 `tilemap.html`**（删除后 `dist` 不再复制它），并把其 `?map=0..3` 能力并入 index（已支持 0..4）。quick win。
  - 若仍需保留装饰物特性 → 用 `git show 60a1c94:src/decor.js` 恢复为模块（`src/decor.js`），接入 `render.js buildMapCache` 的 `decor` 选项与 `main.js` 的 checkbox，然后删除 `tilemap.html`。中等重构。
- **置信度**：high（git 历史 + 双页代码直接比对）。

### P0-2 无响应式布局，固定 400px 侧栏，窄屏必然横向溢出 — 影响：高 · quick win（纯 CSS）
- **问题描述**：[事实，high] `style.css` 零 `@media`。`#main` 为横向 flex（`flex:1` + `#palette` `width:400px;flex:none`），375px 手机：400px 侧栏 + `#main` padding 14×2 必然超出视口产生横向滚动；header 控件（zoom 滑杆+两个 checkbox+两个按钮）在窄屏换行成很高一摞，挤压地图区。
- **代码位置**：`src/style.css:12`（`#main` flex 行）、`:15`（`#palette{width:400px;flex:none}`）、`:4`（header）、`:13`（`#mapwrap` `max-height:calc(100vh - 150px)`）。
- **建议改法**（对照设计库 375/768/1024/1440 断点规范）：
  - 加 `@media (max-width: 820px){ #main{flex-direction:column} #palette{width:100%;max-height:none} }`，侧栏折叠到地图下方。
  - header 控件在窄屏收紧间距/字号；`#mapwrap` 的 `max-height` 改为 `dvh` 或随布局调整。
  - canvas 容器保留横向滚动（地图本身可滚动查看），但页面级不出现横向滚动。
- **置信度**：high（CSS 直接可证）。

---

## P1 · 性能感知

### P1-1 地图生成同步阻塞 + 换种子无 loading 反馈 — 影响：高 · 部分 quick win
- **问题描述**：[事实，high] `loadMap()`（`main.js:25-33`）同步调用 `genWorld/genDungeon` + `buildMapCache`。`buildMapCache` 对每个格子 `createElement('canvas')` + `createImageData`（`render.js:15,25`），44×30=1320 次分配，每个格子再跑 256 像素过渡循环（`tiles.js:85-92`）。「换种子」按钮（`main.js:46`）无 busy/disabled、无 spinner，反复点击时 UI 冻结且无反馈。
- **代码位置**：`src/main.js:25-33`、`:46`；`src/render.js:13-38`；`src/tiles.js:85-92`。
- **建议改法**：
  - quick win：生成期间给按钮 `disabled` + 文案「生成中…」，用 `requestAnimationFrame`/`setTimeout(0)` 让出主线程至少先渲染一帧。
  - 中：`buildMapCache` 预分配**一个**离屏 canvas 与 ImageData，逐格写入同一 buffer，消除每格分配；`nbrs(x,y)` 在 `render.js:25` 和 `:26` 被调用两次，合并为一次。
  - 大：**瓦片结果按签名缓存**——以 `(地形 + 8 邻接地形)` 为 key 缓存 `cellTile` 产物（现只有 `baseOf` 基础瓦片缓存 `tiles.js:93-94`）。同一地图内大量格子的邻居配置相同，计算量可降到「唯一配置数」级别。
- **置信度**：high（代码路径可直接数出分配次数）。

### P1-2 每帧整图重绘 + 动画全格遍历，常驻 CPU — 影响：中-高 · 中工作量
- **问题描述**：[事实，high] `drawFrame`（`render.js:67-73`）每帧 `clearRect` 全画布 + `drawImage(cacheCanvas)`；动画默认开启（`index.html:19` `checked`），`drawAnim`（`render.js:44-66`）每帧遍历**全部 w×h 格**判断是否水/岩浆并画 2-4 个 rect，60fps 持续占用主线程，背景标签页之外无节流。
- **代码位置**：`src/render.js:44-66`、`:67-73`；`src/main.js:14-18`。
- **建议改法**：
  - quick win：尊重 `prefers-reduced-motion: reduce` 默认关闭动画（同时解决运动敏感用户问题）。
  - 中：预生成「可动格子」列表（水/岩浆格），动画只遍历该列表；或将动画独立到一个小覆盖 canvas，每帧只更新动画层，静态层零重绘。
- **置信度**：high（代码路径可证）。

### P1-3 图鉴在启动时同步构建 ~130 个 canvas，首屏卡顿 — 影响：中 · 中工作量
- **问题描述**：[事实，high] `buildPalette()`（`main.js:54` 启动调用）同步生成 17 基础 + 5×16 + 9×4 过渡 + 17 图例 ≈ **130+ 个 canvas**（`palette.js:6-51`），其中大部分位于右侧长列表初始不可见区域，全部在首帧前完成。
- **代码位置**：`src/palette.js:6-51`、`:52-57`；`src/main.js:54`。
- **建议改法**：过渡集按需渲染——用 `IntersectionObserver` 或「点击折叠」懒渲染 16 片集；图例/基础瓦片保留全量（17+17 较小）。中等工作量，收益是启动白屏缩短 + 内存下降。
- **置信度**：high（构建循环可计数）。

---

## P2 · 可访问性（对照设计库 §1 CRITICAL）

### P2-1 无 focus-visible 样式、地图按钮状态仅靠颜色 — 影响：中 · quick win
- **问题描述**：[事实，high] `style.css` 无任何 `:focus/:focus-visible` 规则，浏览器默认 focus ring 在暗底 `#12141a` 上几乎不可见；`#mapbar` 按钮 active 态仅靠 `.btn.active` 颜色/边框区分（`style.css:10`），无 `aria-pressed`。键盘用户无法感知当前地图与焦点位置。
- **代码位置**：`src/style.css:8-10`；`src/main.js:42`（地图按钮生成）。
- **建议改法**：
  - `:focus-visible{outline:2px solid var(--acc);outline-offset:2px}`（quick win）。
  - 地图按钮设 `aria-pressed` 同步 active 态（quick win，`.btn.active` 同时加深背景 + 加深字色）。
- **置信度**：high。

### P2-2 canvas 无语义标注 — 影响：中 · quick win
- **问题描述**：[事实，high] `canvas#cv`（`index.html:24`）是核心内容，但无 `role="img"`/`aria-label`，屏幕阅读器读不到地图信息；`updateStats` 更新的 `seedinfo`（`main.js:35`）文本可达，但主画布本身无语义。
- **建议改法**：canvas 加 `role="img"` + `aria-label`，并在 `loadMap/updateStats` 时同步更新为「{地图名} · 种子 {seed} · {w}×{h}」（quick win）。
- **置信度**：high。

### P2-3 动画默认开启且不尊重 reduced-motion — 影响：中 · quick win
- **问题描述**：[事实，high] 水/岩浆动画默认 `checked`（`index.html:19`），无 `prefers-reduced-motion` 分支；对前庭敏感用户是持续的闪烁刺激。
- **建议改法**：启动时检测 `matchMedia('(prefers-reduced-motion: reduce)')`，命中则 `animateEl.checked=false` 并停止动画；同时可考虑把动画默认改为关闭（工具类页面，默认静帧更省电）。
- **置信度**：high。

### P2-4 9–10px 小字号可读性差 — 影响：中 · quick win
- **问题描述**：[事实，high] 过渡瓦片方向标签 `.tw .tl` **9px**（`style.css:25`）、基础瓦片海拔标签 `.tile .l` 10px（`:22`）、图例/说明 11px（`:27`,`:33`）。字号远低于可读下限（常见 12px+），信息密集面板可读性差；次级文字对比度已达标（≈6.3:1），**问题是字号而非对比度**。
- **建议改法**：`min` 提到 11–12px（`.tl` 至少 11px），或把过渡集标签用更少更清晰的表达。
- **置信度**：high（实测字号）；「可读下限」为行业惯例[推断，medium]。

---

## P3 · 交互体验与信息架构

### P3-1 zoom 无数值反馈；换种子/切图丢失用户缩放 — 影响：中 · quick win
- **问题描述**：[事实，high] 缩放滑杆（`index.html:17`）无数值显示；`loadMap` 每次调用 `fit()`（`main.js:31,24`）把缩放重置为「适应窗口」，用户放大查看细节后一点切图/换种子即丢失缩放；且 `fit` clamp 上限 3 与滑杆 `max=4` 不一致（`main.js:24` vs `index.html:17`）。
- **建议改法**：滑杆旁加 `<span id="zoomval">` 显示当前值；把 `fit()` 从 `loadMap` 中拆出，换种子时保留用户缩放（仅首载/按钮主动触发 fit）；统一 clamp 与滑杆范围。
- **置信度**：high。

### P3-2 「换种子」「?map 深链」可发现性低 — 影响：低-中 · quick win
- **问题描述**：[事实，high] 新手不知道「种子」是什么、换种子会改变什么（按钮无 tooltip/说明）；`?map=0..4` 深链只在底部「说明」面板文字里提及（`palette.js:49`），不易发现。
- **建议改法**：给 `btnReroll` 加 `title="随机生成新地形（seed+137）"`；把 `?map=N` 用法提到 header 或说明首行；可选给滑杆/checkbox 加 `aria-describedby` 提示。
- **置信度**：high（产品判断部分为[推断，medium]）。

### P3-3 控件分组与头部两行布局 — 影响：低 · quick win
- **问题描述**：[事实，high] header 两个 `.controls`（地图切换 + 参数控制）无语义分组（无 `fieldset/legend`/`role=group`）；sticky header 按 150px 高度估算地图区 `max-height`（`style.css:13,15`），窄屏换行后头部更高，地图区与侧栏高度不同步。
- **建议改法**：合并为一行或加 `role="group"` + `aria-label` 分组；`#mapwrap`/`#palette` 的 `max-height` 改用 `dvh` 或跟随头部实际高度。
- **置信度**：high。

### P3-4 触控目标过小 + 原生控件在暗色下观感不协调 — 影响：低 · quick win
- **问题描述**：[事实，high] `label.chk` 12px 字号（`style.css:11`）命中区域仅约 12px 高，低于触屏 44px 建议；`<input type=range/checkbox>` 使用浏览器默认样式，暗底上（无 `color-scheme` meta）显亮色控件不协调。
- **建议改法**：`label.chk` 加 `padding:6px` 扩大命中区；`<meta name="color-scheme" content="dark">` 让原生控件跟随暗色（quick win）。
- **置信度**：high。

### P3-5 内联样式与硬编码色值 — 影响：低 · quick win
- **问题描述**：[事实，high] `#seedinfo` 内联 `style`（`index.html:14`）；`.btn.active` 的 `color:#ffd9a8` 未走 CSS 变量（`style.css:10`）；暗色主题 token 集中在 `:root`（`style.css:1`）方向正确，但未被完整贯彻。
- **建议改法**：内联样式移入 `style.css`；新增 `--acc-text` 等语义 token，替换硬编码色值（符合「语义 token 而非裸 hex」规范）。
- **置信度**：high。

---

## 信息架构总评

- 面板顺序（基础瓦片 → 过渡瓦片 → 图例 → 说明）合理，但 400px 宽 + 超长列表对新手认知负担高；建议过渡 16 片集默认折叠，按需展开（同时缓解 P1-3）。
- 控件分组：地图切换与参数调节视觉上已用两个 `.controls` 区隔，但无语义分组（见 P3-3）。
- 两页冗余是本项目最大的信息架构问题（P0-1）：**建议方向 = 删除 `tilemap.html`，以 `index.html` 为唯一入口**（与「移除前景装饰」的设计意图一致）；如用户希望保留装饰物，则以模块恢复后统一到 index。

## 快速落地排序（quick win 汇总）

1. 删除/重定向 `tilemap.html`（P0-1）
2. 加 `@media` 响应式断点（P0-2）
3. focus-visible + aria-pressed + canvas role/label（P2-1/2/3）
4. reduced-motion 关闭动画 + 动画默认关（P2-3 / P1-2）
5. 换种子 loading/disabled 反馈 + `nbrs` 去重（P1-1 前半）
6. 小字号提到 11–12px（P2-4）
7. zoom 数值显示 + 换种子保留缩放（P3-1）
8. `color-scheme` meta + label 命中区（P3-4）
9. 内联样式/硬编码色走 token（P3-5）

## 需要重构（非 quick win）

- 瓦片按邻居签名缓存（P1-1 后半，性能收益最大）
- 动画层独立 + 可动格列表预生成（P1-2）
- 图鉴过渡集懒渲染（P1-3）
- 装饰物以模块恢复并统一双页（P0-1 可选分支）

---

*调研依据：代码通读（全部 9 个源文件 + 两个 HTML）+ git 历史 + WCAG 对比度人工计算 + ui-ux-pro-max 设计库交叉验证。*