# 地形体系缺口与高度差视觉调研（课题 A + 课题 B）

- 调研日期：2026-08-05
- 范围：**只读分析**，未修改任何源码。依据：`src/terrain.js` / `src/tiles.js` / `src/render.js` / `src/mapgen.js` / `src/palette.js` / `src/main.js` / `src/style.css` / `index.html` 通读 + git 历史 + 社区资料（Web）。
- 结论标注：[事实]=代码/git 可证实；[推断]=基于经验的判断。每条附置信度（high/medium/low）。
- 用户问题：① 现有地形体系有何缺口、该补哪些瓦片；② 明显的高度差（上坡/下坡/崖壁）如何通过瓦片实现。只研究，不改代码。

---

## 0. TL;DR

- **课题 A**：17 种地形覆盖了「水→滩→低地→高地→雪」的主链，但存在三个生态位缺口：**不可通行的深坑**（深渊）、**高地过渡材质**（碎石坡）、**「高 ≠ 岩石」的高原草甸**；另有地牢变体（洞窟地面/木地板）、雪线过渡（雪岩）、海洋景深（深水）等次级缺口。建议补充 8-9 种，其中 **3 种 P1 与课题 B 强联动**。
- **课题 B**：当前高度差只靠 `render.js:26-33` 的 1-2px 边缘细线（diff=1 仅 alpha 0.16），视觉很弱。**结论：不引入新数据结构也能做到「明显」**——推荐 Phase 1 用「崖壁断面条 + 浮雕唇边 + 低格投影」纯渲染覆盖层（只改 `render.js`，复用现有邻格 elev 数据）；若要「同一地形内的连续起伏」，Phase 2 再加**并行高度图层**（`mapgen.js` 已算好的 `hhField` 现成可存，零额外计算），驱动阴影强度/等高线/海拔着色。2.5D z 偏移属 Phase 3 可选大改，不推荐近期做。
- 关键架构判断：**地形字符驱动「纹理+过渡+签名缓存」、独立高度层驱动「浮雕+阴影+等高线」**，两层分离。这保证 `tiles.js` 的签名缓存 key（`地形+8邻字符`）不被高度维度污染，改动面最小、与现有「程序化逐像素」产品叙事兼容。

---

## 课题 A：现有地形体系缺口与瓦片扩展建议

### A1. 现状盘点（[事实，high]）

| 字符 | 名称 | elev | 主要出现场景 | 生态位 |
|---|---|---|---|---|
| ~ | 海洋 | 0 | 世界地图海/湖/河 | 深水 |
| A | 浅滩 | 0 | 海岸浅水 | 滩 |
| S | 沙滩 | 1 | 海岸线 | 滩 |
| E | 沙漠 | 1 | 沙漠图 | 旱地低地 |
| M | 沼泽 | 1 | 水滨 | 湿地 |
| P | 石板地板 | 1 | 地牢 | 建筑地面 |
| D | 泥地 | 2 | 湿草地带 | 低地 |
| G | 草地 | 2 | 全图主体 | 低地/平地 |
| H | 森林 | 2 | 湿草地带 | 覆盖物 |
| R | 道路 | 2 | 盖章直线 | 交通 |
| L | 岩浆 | 2 | 火山/地牢 | 危害 |
| F | 冰原 | 3 | 冻原图海冰 | 冻海 |
| N | 苔原 | 3 | 冻原图陆 | 寒地 |
| T | 岩石 | 3 | 所有图的高地带 | **高地（唯一）** |
| K | 焦土 | 3 | 岩浆邻格 | 灼烧 |
| C | 岩壁 | 3 | 地牢墙体 | 障碍 |
| W | 雪地 | 4 | 所有图山顶 | 极高山顶 |

**elev 分布**：0 级 2 种（~、A）· 1 级 4 种（S、E、M、P）· 2 级 5 种（D、G、H、R、L）· 3 级 5 种（F、N、T、K、C）· 4 级 1 种（W）。

**世界生成的高度带映射**（`mapgen.js:48-54` 默认）：`hh<0.33→~`、`0.33-0.36→A`、`0.36-0.42→S`、`0.42-0.78→G/H/D`、`0.78-0.87→T`、`>0.87→W`。冻原/沙漠图各有独立映射（`mapgen.js:36-47`）。地牢图：全 `C` 墙体 + `P` 房间地面 + `L` 岩浆 + 零星 `T`（`mapgen.js:98-111`）。

**过渡机制**（`tiles.js`）：任意地形配对自动生成 Wang 风格过渡（距离场 + 世界坐标抖动 + 签名缓存，key=`地形+8邻字符`，不含高度）。新地形**只要加 color 函数 + TERRAIN 条目即自动获得全部过渡**；图鉴过渡片集是硬编码配对（`palette.js:21-22`），新配对需手动加入展示（不影响地图渲染）。

### A2. 缺口分析

对照 roguelike / RPG Maker / 程序化地图的常见地形清单（见 References），本项目缺以下生态位：

1. **不可通行的深坑（chasm / pit / hole）**：roguelike 标配（Universal Fantasy Tileset 的 Hole、CavernForge 的 Chasm 单元格）。本项目从低到高只有「水→滩→地→岩→雪」，**没有比海洋更低的「深渊」**，也没有「不可通行」的语义。这是视觉与玩法双重缺口。
2. **高地过渡材质**：草地(elev2) 直接跳到 岩石(elev3)，**没有「碎石/砾石坡」这类过渡材质**——现实中高山腰是崩积物/碎屑坡。缺口在中海拔过渡带。
3. **「高 = 岩石」绑定**：所有 hh>0.78 都是 T，山顶都是 W。**没有高海拔草甸/高原变体**，导致高度只能通过「材质变岩石」来表现，与课题 B 直接冲突（我们想表现"同一材质里的高低"，但材质本身就是高度信号）。TerraWorld / MapGenerator 等程序化生成都用 height+moisture+temp 多轴，海拔不绑定单一材质。
4. **海洋景深缺失**：只有一层 `~`，无深/浅海区分（地图学 bathymetric tint 深水更蓝）。
5. **雪线过渡突兀**：T(elev3)→W(elev4) 直接硬过渡，缺「雪岩」中间态。
6. **地牢变体太少**：只有 P 石板 + C 岩壁 + 零星 T/L，缺洞窟裸岩地面、木地板等常用地牢材质。
7. **泥滩/滩涂缺失**：浅水与陆地之间缺泥泞过渡（FFHacktics 有 Mud）。
8. **旱地草原缺失**：沙漠与草地之间缺 savanna/灌木（TerraWorld 的 Savanna 即此生态位）。

### A3. 建议补充清单（按优先级，≥5 种）

> 实现成本口径：每种 = 1 个 color 函数（沿用现有模板 ~10-20 行）+ TERRAIN 条目 + PALETTE_ORDER 条目 + 可选 genWorld 选型分支（1-3 行）+ 可选图鉴过渡对。因 tiles.js 自动过渡，**无需任何过渡美术**。预估每种 0.5-1 人时。

| # | 类型名 | 建议字符 | 用途 | 视觉特征 | 与现有地形过渡关系 | 建议 elev | 成本 | 优先级 |
|---|---|---|---|---|---|---|---|---|
| 1 | 深渊/裂隙 | CH | 不可通行深坑；山脊/裂谷边界 | 近黑深谷底 + 极稀疏冷色颗粒，视觉"无底" | 与 ~/A/S/T/K/G/P 全自动过渡（作为低格）；课题 B 的崖壁断面天然被触发 | -2 | 中 | **P1** |
| 2 | 高原草甸 | AM | 高海拔草地，打破"高=岩石" | 草地色偏冷/偏黄，偶见浅色石点、雪斑 | 与 G(缓坡)/T/SC/W/N 自动；图鉴加 AM↔T、AM↔G | 3 | 低 | **P1** |
| 3 | 碎石坡 | SC | 高地过渡崩积物带 | 灰褐色大小砾石（高频斑块），比 T 更碎更浅 | 与 G/D/AM/T/W/K/S 自动；图鉴加 SC↔T、SC↔G | 3 | 低 | **P1** |
| 4 | 深水 | DW | 深海/海沟，给海洋景深 | 比 ~ 更暗更蓝，少量深色波纹 | 与 ~（同一水域内渐深）/A 自动 | -1 | 低-中 | P2 |
| 5 | 雪岩 | SR | 雪线过渡带 | 岩石基色 + 随机雪覆斑块 | 与 T/W/N/AM 自动；图鉴加 SR↔T、SR↔W | 4 | 低 | P2 |
| 6 | 洞窟地面 | CA | 地牢裸岩地面 | 深灰岩面 + 裂缝/碎石 | 与 C/P/T/K 自动 | 1 | 低 | P2 |
| 7 | 木地板 | WD | 地牢/建筑木质地面 | 木板横纹 + 钉/隙缝 | 与 P/R/C 自动 | 1 | 低 | P2 |
| 8 | 泥滩 | MF | 浅水-陆地泥泞过渡 | 湿褐 + 反光斑 | 与 ~/A/S/M/D 自动 | 0 | 低 | P3 |
| 9 | 草原/灌木 | SB | savanna 旱草原 | 枯黄草色 + 稀疏深色灌丛点 | 与 G/D/E/AM 自动 | 2 | 低 | P3 |

> P1 三项与课题 B 联动逻辑：**深渊**是最极端高度差，是崖壁方案的最佳演示场景；**高原草甸/碎石坡**为高度差提供"同材质不同高"的素材，避免"所有高地都是岩石"的单调。

**落地要点**：P1 三项加进 `TERRAIN` 后，`genWorld` 需给每个新增地形 1 个选型分支（如默认带 `hh 0.78-0.87 && wv>0.6 → AM`、`hh 0.72-0.78 && 距 T 近 → SC`、地形低点插 CH）。`PALETTE_ORDER` 加条目即出现在图鉴/图例。`mapgen.js` 的海拔-地形映射表改 3-4 行即可。

---

## 课题 B：明显高度差的视觉实现

### B1. 现状事实（[事实，high]，代码可证）

- **当前高度差渲染只有两遍细线**（`render.js:26-33`，均在格瓦片 blit 之后、纯 overlay）：
  - Pass 1（阴影）：遍历 n/s/w/e 邻格，邻格 `TERRAIN[v].elev > TERRAIN[t].elev`（邻更高）时，在当前（低）格朝向它的边缘画 **1px 黑线 alpha=`min(0.32, 0.09+diff*0.07)`** + 1px 浅线 alpha=`0.3a`。即 diff=1→0.16、diff=2→0.23、diff=3→0.30、diff=4→0.32。
  - Pass 2（悬崖棱线）：当前格比邻格高 ≥2 时，在当前（高）格边缘画 **1px alpha=0.2 线**。
  - 合计最重也只是一条 alpha≈0.3 的 1px 细线 → 视觉非常弱（用户反馈"不明显"）。
- **高度数据模型**：`grid[y][x]` 单层存地形字符；**elev 是地形类型属性**（`terrain.js:107-124`），不是格子独立高度。因此**同一地形的相邻两格永远无高度差**（两格都是 G 草地 → 无任何阴影，即便底层 hh 一高一低）。
- **连续海拔场被丢弃**：`mapgen.js:9-24` 第一遍已用 fbm 算出每格 `hhField`（Float64Array），第二遍（`mapgen.js:31-56`）只用来选地形，**返回对象只有 `{grid,w,h,seed,river}`（`mapgen.js:76`），hhField 被丢弃**。这是 Phase 2 的关键事实：高度层数据现成、零额外计算。

### B2. 社区方案横向对比

| 方案 | 代表 | 原理 | 视觉强度 | 数据改动 | 渲染改动 | 与本项目契合度 |
|---|---|---|---|---|---|---|
| ① 边缘阴影线（现状） | 本项目 `render.js:26-33` | 低格贴边 1-2px 细线 | 弱 | 无 | 无 | 已有，用户嫌弱 |
| ② 强化浮雕 + 投影 | 经典 2D 顶视 | 低格 2px 深投影（受高格遮挡）+ 高格 1px 受光亮唇 | 中 | 无 | `render.js` 改 fillRect 参数 | ★ 便宜 |
| ③ 崖壁断面条（cliff-face） | RPG Maker A4 悬崖、Zelda 式山体、Top-Down Mountain Edge Tileset | diff≥2 时高格朝低格画 2-3px 岩壁断面（暗色 + 层理）+ 低格投影 | **强** | 无（仍由邻格 elev 推导） | `render.js` post-blit 覆盖层 | ★★ 推荐 Phase 1 |
| ④ 斜坡/坡面（ramp/slope） | RPG Maker path、DF 斜坡 | diff==1 用斜向条带/阶梯标记"缓坡可通行"，与崖壁(diff≥2)区分 | 中-强 | 无 | 覆盖层或独立斜坡地形 | ★ 与③搭配 |
| ⑤ 独立高度图层 + 等高线/海拔着色 | DF z-level、MapLibre terrain-RGB、地图学 hypsometric tints | 每格存 hh；阴影/等高线/海拔色罩由 hh 驱动 | 强（地图级） | `mapgen.js` 返回 hh（≈1 行） | `render.js` 读新层 | ★★ 推荐 Phase 2 |
| ⑥ z 偏移 2.5D / 等距 | DF z-level、Tiny Swords shadow 层叠 | 高格按高度上移并遮挡低格，深度排序 | 最强 | 每格高度 + z 排序 | 渲染管线重写 | ✗ 改动大，超短期范围 |

**关键社区佐证**：
- **RPG Maker 把悬崖放在 A4（墙壁）槽而非 A2（地面）槽**——高度差的本质是"墙"类效果，独立于地面材质。这直接支持"高度层与地形材质分离"的架构判断。[事实，high]
- **Zelda 式顶视山体 = 画崖壁面（cliff face）而非真高度**；Top-Down Mountain Edge Tileset 的完整边集 = 直线边 + 内外角 + 过渡片，且"可旋转互连、干净剪影"。[事实，high]
- **Tiny Swords tilemap 用"每级高程两层（Shadow + Elevated Ground）"层叠**，阴影精灵比格大半格并下移一格，靠重叠制造软过渡。[事实，high]
- **DF 用多 z-level 正交切面 + 海拔指示条**，靠"上下切面叠加"而非单层阴影表现高度。[事实，high]
- **hypsometric 海拔着色（蓝→绿→棕→白）**是地图学成熟做法（自达芬奇 1503 年起），MapLibre terrain-RGB 可直接着色；但纯海拔着色会掩盖材质真实感（业界有 cross-blended 混合法），在本项目宜作**可选开关图层**而非主渲染。[事实，high]

### B3. 回答用户核心问题

**Q1：表现"明显"高度差是否需要引入新技术？**

- **不需要**。Phase 1 的「崖壁断面条 + 浮雕唇边 + 低格投影」（方案 ③+②+④ 的 subset）纯渲染覆盖层即可达到"一眼看出高低"的效果，全部复用现有邻格 elev 数据，**零数据结构改动**。这是性价比最高路径。[推断，medium：方案选择基于社区惯例与代码结构，视觉强度需实改后 VLM 验收]
- 若目标是**同一地形内的连续起伏**（草地的坡谷、坡度连续变化）→ 需要高度图层（Phase 2）。当前 elev 是离散地形属性，同地形格无起伏，只有独立 hh 层能表达。
- 2.5D/等距属于"需要且改动巨大"，对 16px 顶视程序化瓦片工具性价比低，列为可选 Phase 3。[推断，medium]

**Q2：高度与地形是否应放在不同图层/数据结构？**

- **引擎惯例：分离**。DF 用 z-level 独立维度；Tiled 支持多图层叠合；Unity 顶视做法是 `byte-array 地形数据 + 独立 z`。[事实，high]
- **本项目建议：渐进分离**。
  - Phase 1 保持字符单层（高度差从邻格地形 elev 推导，零数据改动）；
  - Phase 2 加**并行** `heights`（Float32Array，直接存 `hhField`）或量化 `elevMap`（Uint8Array），渲染阴影/崖壁/等高线读它，地形纹理仍读字符。
  - **不要**把高度并进网格字符、也不要改 `tiles.js` 签名缓存 key（`地形+8邻字符`）——一旦 key 含高度维度，每格高度唯一 → 缓存全失效、失去 P1-1 性能收益；且 tileCanvas/renderCell 都是字符驱动。[事实+推断，high]
- **影响评估（Phase 2）**：图鉴/统计/签名缓存**零影响**（字符未变）；`buildMapCache` 阴影 diff 从 `TERRAIN[nb].elev` 换为 `elevAt(nb)`；`main.js` 加"等高线/海拔着色"开关；内存 `w*h*4` 字节，可忽略。

### B4. 推荐方案与实现路径

#### Phase 1（quick win · 纯 `render.js` · 不改数据结构 · 建议先行）

在 `buildMapCache` 现有两遍 pass 基础上增强，保留 pass 1（低格投影）但拉高强度：

1. **diff==1（缓坡）**：低格贴边投影 1px 提到 alpha≈0.28（现在 0.16）；高格朝低格加 1px **亮唇**（浅色 alpha≈0.18，用该高格地形 baseOf 提亮色或固定浅色）→ 读作"平缓坡地"。
2. **diff≥2（崖壁）**：在高格朝低格边缘画 **2-3px 断面条**：1px 近黑轮廓 + 2px 用该高格地形基色压暗 35-40%（`baseOf` 采样 1px 或静态色）；若高格为岩类（T/C/K/SC/SR），每 4px 叠 1px 更暗横线仿岩石层理。低格再加 1px alpha≈0.35 投影。
3. **拐角处理**：相邻两崖边各自 fillRect，拐角 1px 自然重叠成 L 形即可；内凹角在 16px 下可接受。完整 4 象限内/外角片集是 RPG Maker 复杂度，本项目 16px 不必要。
4. **与水互动**：低格为 `~`/`A` 时断面条 alpha 降到 ~0.6 或换偏蓝暗色，模拟水下崖基，避免割裂。
5. **性能**：全部在静态缓存帧完成，与现有动画层无关；签名缓存不变，每格额外 O(1) 次 fillRect。`drawGridOverlay`/动画/缩放逻辑均无需动。

#### Phase 2（中改 · 数据层 + 渲染 · 可选）

1. `mapgen.js`：`genWorld` 返回对象加 `heights: hhField`（局部变量现成，1 行）；`genDungeon` 构造平坦 elevMap（全 1，岩浆/裂隙处 0）。
2. `render.js`：阴影/崖壁 diff 改用 `heights` 邻差（`|Δhh|`）；新增可选**等高线**（每 Δhh≈0.12 画 1px 深色线，需阈值过滤相邻格噪声）与**海拔着色**覆盖层（hypsometric 蓝→绿→棕→白低饱和罩，半透明叠加，仿 MapLibre terrain-RGB）。
3. `main.js`：加"等高线"/"海拔着色"两个 checkbox（默认关）；高度阴影默认开。
4. 阈值：邻差 `|Δhh|<0.04` 忽略，避免相邻同地形格全出现碎影（fbm 天然高频）。
5. 图鉴/统计/签名缓存：无改动。

#### Phase 3（可选大改 · 不建议近期）

2.5D z 偏移：高格按 hh 差上移 2-4px/级并遮挡低格。需要深度排序（行序渲染）+ 过渡带遮罩 + 动画/网格坐标平移；且与"程序化逐像素平铺瓦片"产品定位冲突。除非用户明确要"伪 3D 山体"，否则**不做**。[推断，medium]

---

## 两课题衔接：高度类地形瓦片 × 高度差视觉

- **新地形自动丰富 diff 组合**：高原草甸(elev3)↔草地(elev2)=缓坡、深渊(elev-2)↔周围=强崖壁、雪岩(elev4)↔岩石(elev3)=缓坡。Phase 1 渲染按邻格 elev 差自动适配，**无需为每种新地形写额外逻辑**。
- **悬崖/坡地不需要做成新地形**：坡地与崖壁是"边界几何状态"，不是"地表材质"，用渲染覆盖层表达最干净（与 RPG Maker 把 cliff 归 A4 墙壁槽同理）；把它们做成地形反而会污染材质语义、拉高图鉴规模。**课题 B 的坡地/崖壁 = 渲染层；课题 A 的高度类地形（高原草甸/碎石坡/深渊） = 为渲染层提供 diff 素材。**
- **建议落地顺序**：① Phase 1 渲染增强（纯 `render.js`，~1-2h）→ ② 课题 A 加 P1 三地形（高原草甸/碎石坡/深渊，每 ~0.5-1h）→ ③ Phase 2 高度层（含等高线/海拔着色，~1h）→ ④ 视觉验收后评估 Phase 3 必要性。
- **验收场景**：深渊裂隙是"极端高度差"的最佳演示与验收场景——建议先在地牢或火山图手工盖一条 CH 裂隙，验证 Phase 1 崖壁断面在多重邻接（L 拐角、T 交界）下的效果。

---

## 置信度汇总

| 结论 | 置信度 | 依据 |
|---|---|---|
| elev 是地形属性、grid 单层字符、同地形格无高度差 | high | `terrain.js:107-124` / `mapgen.js:76` |
| 当前高度差仅 1-2px 细线（diff=1→alpha0.16）| high | `render.js:26-33` 公式直接可算 |
| `hhField` 已计算但被丢弃，Phase 2 零新增计算 | high | `mapgen.js:9-24` vs `:76` |
| 缺深渊/碎石坡/高原草甸/深水/雪岩/地牢变体等生态位 | high | 社区地形清单比对（References）|
| 新地形自动获得全部过渡，无需过渡美术 | high | `tiles.js` 任意配对 + `pairSeed` 机制 |
| Phase 1 崖壁断面覆盖层可达"明显" | medium | 社区惯例推导，需实改后 VLM 视觉验收 |
| 签名缓存 key 不宜含高度维度 | high | `tiles.js:104-106` neighborKey 定义 + P1-1 缓存机制 |
| 2.5D z 偏移不建议近期做 | medium | 改动面 + 与产品定位冲突（推断）|
| 优先级排序（P1/P2/P3） | medium | 生态位缺口的经验判断（推断）|

---

## References

**项目代码**
- `src/terrain.js:106-125`（TERRAIN 17 种 + elev）、`src/mapgen.js:9-56,76,98-111`（hh 场、选型、丢弃、地牢）、`src/render.js:26-33`（阴影/崖棱）、`src/tiles.js:7-23,25,29-45,103-177`（过渡与缓存）、`src/palette.js:19-22`（图鉴过渡对）、`src/main.js:42-57`（统计）
- git：`60a1c94`（模块化拆分）、`73e6970`（丰富瓦片/过渡 + 移除装饰物）；docs 已有 `transition-tiles-research.md`（距离场诊断，本文不重复）

**社区（已实际检索）**
- RPG Maker A4 悬崖/autotile 机制（cliff 归墙壁槽、四象限 mini-tile）— https://forums.rpgmakerweb.com/threads/i-think-im-missing-something-fundamental-a4-cliffs-paths-autotile.167134/#post-1432485 、 https://rmrk.net/index.php?topic=49159.msg562438#msg562438
- 通用 roguelike 地形清单（Universal Fantasy Roguelike Tileset 16x16：Hole/Stairs/Gravel/Wood Floor 等）— https://opengameart.org/content/universal-fantasy-roguelike-tileset-16x16
- FFHacktics 地形表面类型表（Gravel/Mud/Soil/Salt 等）— https://w.ffhacktics.com/w/index.php?title=Terrain_Surface_Types
- Tiny Swords tilemap：每级高程两层（Shadow + Elevated Ground）层叠法 — https://agentskills.so/skills/chongdashu-phaserjs-tinyswords-tinyswords-tilemap
- Zelda 式顶视山体=画崖壁面 + 地形图风格（gamedev.stackexchange）— https://gamedev.stackexchange.com/questions/38798/hills-in-a-topdown-game
- Top-Down Mountain Edge Tileset（边集结构：直线边/内外角/过渡）— https://www.gamedevmarket.net/asset/top-down-mountain-edge-tileset
- Dwarf Fortress z-level 呈现（正交切面 + 海拔指示条）— https://new.dwarffortresswiki.org/index.php?title=40d:Z-level&oldid=8810
- Hypsometric tints（蓝→绿→棕→白，达芬奇 1503 起；含 bathymetric）— https://web.archive.org/web/20160805144338/https://en.wikipedia.org/wiki/Hypsometric_tints
- MapLibre terrain-RGB hypsometric tint 着色实现 — https://github.com/maplibre/maplibre-gl-js/pull/5913
- CavernForge（Ground/Lava/Chasm/Rock Wall/Cliff 单元格类型 + sculpt height）— https://assetstore.unity.com/packages/tools/terrain/cavernforge-procedural-grid-terrain-366030
- DTL（Godot，Perlin/Diamond-Square 高度图生成器）— https://store.godotengine.org/asset/jake-cattrall/dtl/
- roguelike 高程/地形类设计（plain/hill/cliff/steep/basin）— https://github.com/henneberger/rogue/issues/31
- Unity 顶视 2D 高度图 + 16x16 sprite 示例 — https://github.com/cr0ssVtW/Unity3D-Top-Down-2D-Procedural-Terrain
- MapGenerator / TerraWorld biome 清单（swamp/savanna 等）— https://github.com/YegorCherov/MapGenerator 、 https://forums.unrealengine.com/t/mynameisvoo-terraworld-procedural-land-generator/2527086

*本文未修改任何源码；落地路径均标注了涉及文件与行号，供后续任务直接使用。*
