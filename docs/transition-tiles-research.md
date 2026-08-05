# 地形过渡瓦片调研：当前距离场方案诊断 + 社区方案对比 + 改进建议

- 调研日期：2026-08-05
- 范围：**只读分析**，未修改任何源码。依据：`src/tiles.js` / `src/util.js` / `src/render.js` / `src/mapgen.js` / `src/palette.js` / `src/terrain.js` 通读 + git 历史（`60a1c94` 起过渡算法未改）+ 社区资料（Web）+ 像素级实测（Node 直接驱动项目纯函数模块渲染并量化）。
- 结论标注：[事实]=代码/实测可证实；[推断]=基于经验判断。每条附置信度（high/medium/low）。
- 用户反馈：「过渡瓦片的铺设算法有点问题」。本调研判断问题根源、给出社区对照与可落地改法。

---

## 0. TL;DR

当前实现是「**程序化距离场 + 世界坐标二值抖动**」的原创方案，架构框架是合理的（任意地形配对、多邻居主导、签名缓存、零美术资产），**问题不在框架，而在三处具体实现选择**：

1. **[事实，high] `wob()` 的蜿蜒边界实际是逐列白噪声随机游走**——`util.js:11` 的 `(hash2(c,...)-0.5)*4.6` 项使相邻列边界跳变最大 **5.27px**、平均 1.72px（平滑噪声 vnoise 仅 0.49px）。海岸线是锯齿/随机跳动，不是平滑蜿蜒。这是「过渡看起来不对」的最大来源。
2. **[事实，high] seam 抖动用白噪声阈值**（`tiles.js:15` `hash2(wx,wy,9911)`）→ 过渡带呈盐椒噪声（散点），非结构化的干净边；blob 模式用 2×2 Bayer（`tiles.js:18-20`）→ 最粗棋盘格。两者都不是好的像素风过渡抖动。
3. **[事实，high] 对角仅接触渲染一个 R=3 的固定小鼓包**（`tiles.js:35-39`，实测 9 像素、半径 3.2px），与正交边 ±4px 摆动视觉尺度不一致，且违反社区 bitmask 的「corner rule」（纯对角不产生过渡）。

另有真实正确性缺陷：**共享缝线上 ~12% 列（实测 2/16）两格对同一世界像素的地形判定不一致**（`tiles.js:29-45` + `:14-16`），违背代码注释声称的「无缝隙」；以及**图鉴 blob 模式与地图 seam 模式视觉不一致**，与产品文案「Wang 完整过渡」的承诺相悖（`palette.js:19` vs `render.js`）。

**推荐方案（主推）**：保留距离场框架，修复四处缺陷——① wob 白噪声项改平滑插值噪声（`util.js:11`）；② 白噪声抖动改世界坐标 Bayer 4×4/8×8（`tiles.js:14-20`）；③ 缝线判定改共享世界坐标谓词（`tiles.js:29-45`）；④ 对角圆角改 corner rule 或放大到与摆动一致（`tiles.js:35-39`）。改造幅度小、不破坏任意配对/多邻居交界/签名缓存三个既有保证，契合「程序化逐像素生成」的产品定位。

**备选方案 B**：改为预渲染 16/47 片 bitmask/Wang 瓦片集（匹配图鉴承诺），但会牺牲「多邻居任意交界」与「世界连续边界」，且与签名缓存架构重叠；仅在明确想要经典瓦片集观感时考虑。

---

## 1. 当前实现导读（代码定位）

| 职责 | 位置 | 说明 |
|---|---|---|
| 基础纹理 | `terrain.js` 各 `cXxx(x,y,s)` | 纯局部坐标纹理（格内 x,y），跨格逐像素重复（实测 256/256 相同，tile-perfect） |
| 蜿蜒边界函数 | `util.js:11` `wob(c,s)` | 返回格缝法向偏移量，**含逐列白噪声项 + 两个 sin 波** |
| 缝线对称种子 | `tiles.js:25` `pairSeed(a,b)` | 相邻两格对同一条缝共享同一 wob 参数 → 边界几何对齐 |
| 距离场 | `tiles.js:29-45` `distFor(dir,x,y,ps,mode)` | seam：正交边沿格缝摆动、对角 R=3 圆角；blob：边界在瓦片中部（图鉴经典 Wang 表现） |
| 二值抖动 | `tiles.js:7-23` `pixelColor` | seam 用世界坐标白噪声阈值；blob 用 2×2 Bayer；取主导邻居（max bl） |
| 逐像素渲染 | `tiles.js:48-77` `renderTilePixels` | band=3.0(seam)/2.2(blob)，特效门控 6 种 |
| 图鉴瓦片 | `tiles.js:78-84` `tileCanvas` | blob 模式，供 `palette.js:19-27`「Wang 16 片集」展示 |
| 签名缓存 | `tiles.js:103-177` `buildTemplate`/`renderTemplate`/`renderCell` | 缓存「抖动前模板」（与格位置无关），渲染时按世界坐标补抖动，逐字节一致（历史任务 P1-1 验证） |
| 地图渲染 | `render.js:13-45` `buildMapCache` | 每格 `renderCell` + 海拔阴影/悬崖棱线 + 水/岩浆动画 |

两条渲染路径：
- **地图 seam 模式**：`cellTile`/`renderCell`，过渡带在格缝两侧（±band），边界随 `wob` 摆动。
- **图鉴 blob 模式**：`tileCanvas`，过渡带在瓦片中部（B 从指定边入侵，经典 Wang 表现）。

**产品文案承诺**（`palette.js:49`）：「四邻位掩码过渡 + 2×2 Bayer 抖动混合……任意配对自动支持 Wang 完整过渡，多邻居交界处取主导地形。」——地图实际用 seam 风格，并非文案与图鉴展示的 blob/Wang 风格，存在承诺落差。

---

## 2. 诊断：问题 / 代码位置 / 根因 / 实测证据 / 影响

### P1. 边界是白噪声随机游走，非平滑蜿蜒 — 影响：高（用户最大感知）[事实，high]
- **代码**：`util.js:11` `wob` 的 `(hash2(c,(s&1023)+13,5)-0.5)*4.6` 项对相邻列 c 是完全不相关的白噪声。
- **实测**：相邻列边界跳变 max **5.27px**、avg 1.72px（`vnoise` 平滑噪声 max 仅 0.49px）；`wob(x)` 前 16 列序列 `-1.0 1.0 -0.2 0.9 1.4 2.1 -2.3 -2.2 0.5 ...`。
- **影响**：16px 瓦片上海岸线相邻列可跳 5px，叠加抖动后呈现锯齿/碎线，而非注释声称的「沿格缝蜿蜒」。

### P2. 过渡带白噪声二值抖动 → 盐椒噪声边 [事实，high]
- **代码**：`tiles.js:14-16` `th=hash2(wx,wy,9911)`，带内像素按 `bl>th` 独立随机选 A/B 色；blob 用 `tiles.js:18-20` 2×2 Bayer（最粗棋盘）。
- **实测**：草地格 s=水，过渡带（行 13-15）仅行 15 出现 3/16 水色散点；32 列海岸线仅 7 列过渡带内含水色散点，其余 25 列直接硬切 → **边带软/硬交替 + 散点**。
- **依据**：社区抖动知识（见来源）——白噪声阈值无过渡色调、硬边；Bayer 越大越平滑。

### P3. 对角仅接触 → R=3 固定小鼓包 [事实，high]
- **代码**：`tiles.js:35-39` 对角用 `R - Math.hypot(...)`，R=3。
- **实测**：仅 nw 对角水邻居 → 水色 9 像素、最远 3.2px 半径。
- **影响**：与正交边 ±4px 摆动尺度不一致；对角接触处出现「水点渗漏」式小鼓包。社区 bitmask 惯例（corner rule）是**纯对角不产生过渡**（对角位仅在两个相邻正交位都存在时生效）。

### P4. 多邻居 L/T 拐角碎片化 [事实，medium]
- **代码**：`tiles.js:54-67` 逐像素 max-bl 主导 + P2 抖动。
- **实测**：n+w+nw 水邻居的 L 拐角渲染出散布的孤立水像素（含 8 邻全无水的孤立散点），非干净直角。
- **影响**：交界处过渡最乱；max-bl 方案在交界带内颜色会沿两邻居 band 的角平分线突变。

### P5. 共享缝线 ~12% 列两格判定不一致（违背「无缝隙」）[事实，high]
- **代码**：`tiles.js:29-45` + `:14-16`。两格对共享缝用**不同的世界行**（上格 y=15 vs 下格 y=16）+ 独立白噪声哈希。
- **实测**（稳健分类）：水在上/草在下 16 列中 **2 列冲突**（上格底行渲染为水、下格顶行渲染为草）→ seam 处出现 1px「撕裂」。根因：wob∈(-1,0) 时边界落在两行之间的空隙，两格各自的 bl 都落在 (0.167, 0.5)，独立哈希导致可判为相反地形。
- **影响**：违背代码注释「世界坐标阈值保证相邻两格在共享缝线上逐像素一致、无缝隙」。

### P6. 图鉴 blob 与地图 seam 视觉不一致，与文案承诺相悖 [事实，high]
- **代码**：`palette.js:19-27`（blob 模式 16 片集）vs `render.js:33`（seam 模式地图）。
- **实测**：同一 G↔水 配对，blob 模式过渡在瓦片中部（B 从顶边入侵），seam 模式只在格缝边。用户对照图鉴看地图会看到不同形态。

### 正向结论（避免误判）
- **缝线抖动「大体对齐」**：世界坐标阈值的对齐策略基本有效，冲突仅 ~12% 列（P5），且只是 1px 级；不是「大面积错位」。
- **签名缓存（P1-1 历史优化）输出与改前逐字节一致**，实测 6337 格 0 差异——性能架构健全，不在此次问题范围内。
- **基础纹理 tile-perfect**（实测 256/256 相同）：大面区域无缝，但跨格重复明显（纹理局部化设计，属既有选择非本次缺陷）。

---

## 3. 社区方案横向对比表

| 方案 | 瓦片数/地形对 | 邻居感知 | 过渡质量 | 对角支持 | 多地形混合 | 实现复杂度 | 运行时开销 | 与本项目（程序化 16px 逐像素）契合度 |
|---|---|---|---|---|---|---|---|---|
| **Bitmask Autotile（blob/47 片）** | 47（8 邻位，含内外角） | 8 邻 | 高（平滑、对角好） | ✓ | ✗（仅 A↔B） | 高（查表映射繁琐） | O(1) blit | 中：与签名缓存重叠；多地形交界需退化 |
| **Marching Squares（16 片）** | 16（4 邻位） | 4 邻 | 中（无对角） | 需加片 | ✗ | 低 | O(1) blit | 中：与图鉴「16 片集」形态一致，但对角/三岔退化 |
| **Corner Wang tiles（16 片）** | 16（4 角匹配） | 4 角 | 高（弯曲线可，Civ3 式） | ✓ | ✗ | 低-中 | O(1) blit | 中：Wangscape 可程序化生成 |
| **Edge Wang（2/4 边）** | 2/4 边 | 边匹配 | 适合路径/迷宫，不适合有机地形 | — | ✗ | 中 | O(1) blit | 低：与地形斑块目标不符 |
| **Dual Tilemap（Excalibur，5 片+1 底）** | 6 | 4 角采样 | 高（两态干净边） | ✓（旋转） | ✗（仅二态） | 中（双网格半格偏移） | O(1) blit | 中：仅适合二态海岸；本项目 17 地形多态 |
| **RPG Maker minitile（半格象限）** | 每象限 5 片 | 每象限 3 邻 | 高 | ✓ | ✗ | 中 | O(1) | 低：需手工/半格美术，与程序化逐像素相悖 |
| **程序化距离场 + 抖动（当前）** | 0（无限配对） | 8 邻（含对角） | **噪声函数决定**：当前白噪声=碎；改平滑噪声+Bayer=可到高 | ✓（当前 R=3 鼓包，可修） | ✓（max-bl 主导） | 低 | 逐像素（签名缓存已摊销） | **最高**：零资产、任意配对、多地形交界、世界连续边界 |
| **Brogue 风格（无过渡瓦片，靠光照/动画/装饰）** | 0 | 无 | 硬格边 + 氛围 | — | — | — | 低 | 中：对 ASCII/硬边美学成立；本项目目标是像素过渡瓦片集，仅作参照 |

> 注：bitmask 47 片的「corner rule」关键点——对角位仅当两个相邻正交位同时存在才有效（否则不可见），这是 P3 中纯对角鼓包应被去除的社区依据。另注：Tiled/Godot 生态中 blob（47 片）与 Wang/terrain 工具互相不兼容（blob 由中心定义，Wang 由边/角定义），选型时二者取其一。

来源见文末 references（对应 URL 已逐条列出，未读不列）。

---

## 4. 推荐方案与理由

### 主推：保留距离场框架，修复四处缺陷（改造幅度小 · 收益大 · 不破坏既有保证）

理由：本项目的核心价值是「程序化逐像素生成、任意 17 地形自动配对、多邻居交界取主导、世界坐标连续边界」。这三条保证恰好是预渲染瓦片集方案**做不到**的（见方案 B）。P1-P6 的问题全部局限在 `util.js`/`tiles.js` 的几个噪声/抖动/距离函数内，框架（签名缓存、max-bl、双模式）无需动。

**Fix ① 平滑蜿蜒边界（收益最大，改动最小）** — `util.js:11`
- 把白噪声项换成平滑插值噪声（`vnoise` 已存在于 `util.js:9`）：
  `wob(c,s) = (vnoise(c*0.35, (s%100)*0.13, 5)-0.5)*7 + Math.sin(c*0.5+s)*1.1 + Math.sin(c*1.7+s*2.3)*0.6`
  （幅度调到 ~±3-4px，与 band 匹配；`pairSeed` 保证两格共享同一 c 与 s → 边界仍几何对齐）。
- 效果：相邻列跳变从 5.27px → <1px，海岸线成平滑蜿蜒。

**Fix ② 过渡带抖动改世界坐标 Bayer 4×4/8×8** — `tiles.js:14-20`
- 用 `th = bayer[(wy&3)][(wx&3)]`（世界坐标 → 共享缝线像素取同一阈值，连续性保留），4×4=16 级 / 8×8=64 级。
- 效果：盐椒散点 → 结构化有序抖动；同时可将 `band` 从 3.0 收紧到 ~2.0、把 `clamp(0.5+p/band)` 换为 `smooth()` 平滑化，进一步减少过渡带宽度与软硬交替。

**Fix ③ 缝线判定改共享世界坐标谓词（消除 ~12% 冲突）** — `tiles.js:29-45` + `renderTemplate`
- 把 s/n/w/e 的距离场改为对**同一边界线 y0(wx)** 求世界坐标距离：上格底行 `p = y0 - wy`、下格顶行 `p = wy - y0`（wy 为真实世界行），两格对同一条缝得到互补判定，wob∈(-1,0) 时干净地「上行陆、下行水」。
- 注意保持 `buildTemplate`（门控位预计算）与 `renderTemplate`（世界坐标抖动补算）同步——改动只涉及 distFor 公式与抖动阈值，签名缓存机制不受影响。

**Fix ④ 对角采用 corner rule 或放大圆角到与摆动一致** — `tiles.js:35-39`
- 首选（社区惯例）：纯对角接触（正交无同地形）不渲染过渡（与 bitmask corner rule 一致，消除 3px 鼓包）；只有相邻正交存在时才在共享角渲染圆角。
- 备选：R 从 3 放大到 4-5，并让圆角沿正交边的 wobble 伸展。

**Fix ⑤ 图鉴/地图视觉统一（可选，顺带）** — `palette.js:19-27` / `tiles.js:78-84`
- 图鉴增加「seam / blob」模式切换（两行按钮），或文案改为明确区分「格缝过渡（地图）」与「经典 Wang 形态（图鉴）」，消除 P6 的承诺落差。

**改动文件清单（主推）**：`src/util.js`（wob）、`src/tiles.js`（pixelColor/distFor/renderTilePixels）、可选 `src/palette.js`。不改 `render.js`/`mapgen.js`。预计不破坏任何输出兼容性（无外部调用方）。

### 备选方案 B：改预渲染 16/47 片 bitmask/Wang 瓦片集
仅当明确想要「经典瓦片集观感」且接受下列退化时考虑。**实现路径**：
1. 数据结构：`pairCache[a][b]`（或 `Map`），每对预渲染 `16`（4 邻位，图鉴一致）或 `47`（8 邻位）个 16×16 canvas/ImageData，位掩码 `bits = (n?1:0)|(e?2:0)|(s?4:0)|(w?8:0)`（16 片）或 8 邻位 256→47 折叠（含内角，查表）。
2. 瓦片生成：直接复用现有 `renderTilePixels`（blob 风格 + Fix ①②④ 的平滑噪声与 Bayer），把每个 mask 的过渡固化为一张瓦片 → 图鉴「Wang 16 片集」与地图查表共用同一来源，P6 自动解决。
3. 选择逻辑：`render.js buildMapCache` 内 `renderCell` 改为按 `pairSeed` 查 `pairCache[t][nb]` 的 bits 下标 blit；`bits=0` 即 `baseOf(t)`，与现有 baseOf 共用。
4. 多邻居交界退化：三岔/四岔处按地形优先级（如 `elev` 或显式优先级表）选最高优先级配对渲染，其余忽略；或引入 47 片内角瓦片表达角部第二地形。**这是本方案最大代价**——当前 max-bl 能任意处理三岔，bitmask 不能。
5. 世界连续性退化：每 mask 只有一种固定边形状，蜿蜒海岸只能靠「同 mask 多变体随机选择」近似，不再是跨格无缝几何连续。
6. 文件清单：`src/tiles.js`（新增 `buildPairSet`/位掩码查表，弃用 seam 分支）、`src/render.js:33`（renderCell 调用方不动，内部改查表）、`src/palette.js`（改从 pairCache 取）、`src/util.js`（同上 Fix ①）。签名缓存 `buildTemplate/renderTemplate` 可整体退役（改由瓦片集缓存替代），或保留给基础纹理。
7. 启动开销：仅对地图实际出现的配对按需预渲染（如 5 张图实测配对数），避免 136 对全量。

**不首选 B 的理由**：多地形交界、世界连续边界、签名缓存三者为项目既有卖点，B 全部牺牲；且图鉴已用 blob 展示 16 片集，若地图也改查表，则与「程序化逐像素」的产品叙事相悖（过渡变成预烘焙瓦片）。若产品方向就是「输出可复用瓦片集供其他工具用」，B 才是正解——建议以用户意图为准（见决策）。

---

## 5. 置信度汇总与验证方法

| 结论 | 置信度 | 依据 |
|---|---|---|
| wob 为白噪声随机游走（P1） | high | 代码 + 实测（跳变 5.27px vs vnoise 0.49px） |
| seam 白噪声抖动 → 盐椒边（P2） | high | 代码 + 实测（过渡带散点/软硬交替） |
| 对角 R=3 鼓包（P3） | high | 代码 + 实测（9 像素/3.2px 半径）+ corner rule 惯例 |
| L 拐角碎片化（P4） | medium | 实测定性 + 代码推导 |
| 缝线 12% 冲突（P5） | high | 代码 + 实测（2/16 列稳健分类冲突） |
| 图鉴/地图模式不一致（P6） | high | 代码 + 实测（blob vs seam 形态对照） |
| 主推 Fix ①②③④ 可消除上述问题 | medium | 社区抖动/噪声知识 + 方案推导，需改后视觉回归验证 |
| bitmask 无法处理多地形交界 | high | 社区资料（Tiled/Godot 生态一致结论） |
| Brogue 用硬边+光照而非过渡瓦片 | medium | Web 资料（RPS/Wikipedia），未源码验证 |

---

## 6. 下一步（建议）
1. 按主推 Fix ①②③④ 改 `src/util.js`+`src/tiles.js`，用本调研的 Node 直调脚本做回归（复用历史 P1-1 的「逐字节一致」验证方式对无过渡格保持，过渡格做视觉采样对比）。
2. 视觉验收：本地 `vite preview` 打开 5 张图 + 图鉴，重点看海岸线平滑度、对角接触、L/T 交界。
3. 若产品意图是「产出可复用瓦片集」，再评估方案 B（本文已给实现路径）。

---

## References

**项目代码**
- `tilemap-generator/src/util.js:9,11`（vnoise/wob）、`src/tiles.js:7-77,78-84,103-177`、`src/palette.js:19-27,49`、`src/render.js:13-45`、`src/mapgen.js`
- git：`60a1c94`（模块化拆分，过渡算法原点）、`73e6970`（特效门控，算法本体未动）、历史 P1-1 提交（签名缓存逐字节一致）

**社区（已实际检索/读取）**
- Elegant autotiling（bitmask 16/47 综述）— https://gamedev.stackexchange.com/questions/46594/elegant-autotiling/46597#46597
- Godot autotiling / minitiles 讨论（bitmask 与 3×3 两种模式）— https://github.com/godotengine/godot/issues/19059
- Tiled Forum：blob tileset 无法被 Wang/terrain 工具表达 — https://discourse.mapeditor.org/t/neither-terrain-nor-wang-can-handle-a-blob-tileset/4671
- Excalibur Dual Tilemap（5 片两态过渡）— https://beta.excaliburjs.com/blog/Dual%20Tilemap%20Autotiling%20Technique/
- Wangscape（程序化 corner-Wang 瓦片集生成）— https://github.com/Wangscape/Wangscape
- roguetemple：Marching Squares 16 片 vs bitmask 讨论 — https://forums.roguetemple.com/index.php?PHPSESSID=vpktr98lsqblajh7k6p2vja7k0&topic=4682.10
- 抖动理论（白噪声 vs Bayer 矩阵 vs 误差扩散）— https://devutl.com/dither-pattern-generator/
- Brogue 视觉风格（ASCII + 动态光照/流体动画，无过渡瓦片）— https://www.rockpapershotgun.com/have-you-played-brogue 、 https://en.wikipedia.org/wiki/Brogue_(video_game)
- Brogue 式滑动房间生成库 — https://github.com/khrome/procedural-layouts

> 注：`redblobgames.com/articles/autotile/` 主 URL 现为 AI 实验占位页（作者声明非其所写），未作为依据引用。

*验证方法补充：像素级实测通过 Node v24 ESM 直接 import 项目 `src/tiles.js` 纯函数模块（`renderTilePixels` 仅写传入的 `ImageData.data`，不触 `document`），逐格渲染后用「与格内 A/B 基色距离最近」稳健分类，量化缝线冲突/抖动散点/对角 blob/交界碎片度；wob 与 vnoise 平滑性直接对 `util.js` 函数采样。全部脚本位于任务临时目录，未写入项目。*
