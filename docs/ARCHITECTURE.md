# tilemap-generator 架构文档

> 汇总项目各阶段（UI/UX 优化、性能重构、过渡算法修复、高度层、道路窄条调研、9 种新地形）的调研与决策，供后续开发与协作参考。
> 本文基于当前代码（`src/*.js`、`index.html`、`vite.config.js`）与 git 历史撰写，**以代码为准**；行号引用截至 2026-08-05 的 `main` 分支。
> 配套调研文档：`docs/ui-ux-review.md`、`docs/transition-tiles-research.md`、`docs/terrain-height-research.md`、`docs/road-path-tiles-research.md`。

---

## 0. 项目定位

零美术资产的**程序化像素地形瓦片集 + 多地图查看器**：所有瓦片由值噪声 + 色带逐像素生成，任意地形配对自动支持过渡，多邻居交界取主导地形。设计方向是「纯净」——无前景装饰、无功能性物件（木桥等已移除）。

技术栈：原生 ES Modules + [Vite](vite.config.js)（`base:'./'`，构建产物可本地直接打开）。无任何运行时依赖。入口唯一为 `index.html`，`?map=0..4` 深链直达对应地图（`main.js:71-75`）。

---

## 1. 数据流

```
index.html ──<script type=module>──> src/main.js（应用层 glue：控件/动画/启动）
                                        │
  ┌─────────────────────────────────────┴─────────────────────────────────────┐
  │  loadMap(def)（main.js:25-41）                                              │
  │    def.dungeon ? genDungeon(def) : genWorld(def)      【mapgen.js】          │
  │      │  →  { grid: char[][], w, h, seed, river:Set, heights:Float64Array }  │
  │      ▼                                                                      │
  │  buildMapCache(m)（render.js:118-165）                 【render.js】         │
  │      │  每格 renderCell(t, nbs, img, cx, cy)           【tiles.js】          │
  │      │      └─ neighborKey 签名缓存（地形+8邻）                              │
  │      │         buildTemplate / renderTemplate / baseOf                       │
  │      ├─ Phase1 高度差覆盖层（邻格 elev：投影/亮唇/崖壁断面）                 │
  │      ├─ Phase2 高度层浮雕（heights 邻差）+ tint/contour 可选覆盖层           │
  │      └─ animCells 预生成（水/岩浆可动格列表，动画只遍历它）                  │
  │      │  →  cacheCanvas（含 .animCells / .tintCanvas / .contourCanvas）        │
  │      ▼                                                                      │
  │  drawFrame(ctx, cacheCanvas, map, ui, now)（render.js:192-200，main.js:15-18）│
  │      ├─ blit cacheCanvas（静态帧，一次 drawImage）                           │
  │      ├─ 叠加 tintCanvas / contourCanvas（可选，checkbox 开关）               │
  │      ├─ drawAnim（水/岩浆动画，'lighter' 合成，render.js:171-191）           │
  │      └─ drawGridOverlay（网格，render.js:166-170）                           │
  └────────────────────────────────────────────────────────────────────────────┘

palette.js buildPalette()（palette.js:6-51） → 图鉴面板
   ├─ baseOf(t)  基础瓦片（tiles.js:110-112，零邻居纯地形，缓存 Map）
   └─ tileCanvas(A,B,dirs)  blob 模式过渡片（tiles.js:95-101，Wang 16 片集展示）
```

**关键约定**：
- `mapgen`（数据层）产出字符 `grid` + 并行 `heights`；`tiles`（瓦片层）只认字符；`render`（合成层）blit 字符瓦片后叠加高度差覆盖层；`main` 管应用状态与控件；`palette` 读同一套瓦片函数做图鉴。
- 静态帧缓存：地图只生成一次 `cacheCanvas`，动画帧每帧仅 `drawImage` 静态帧 + 画可动格，不做整图重算（性能重构产物，见 ADR 与 `docs/ui-ux-review.md` P1-2）。

---

## 2. 地形体系：26 种单字符地形

定义于 `src/terrain.js`：每个地形 `cXxx(x,y,s)` 逐像素纹理函数（`terrain.js:4-171`）+ `TERRAIN` 表（`terrain.js:173-200`，字段 `name/seed/elev/color`）+ `PALETTE_ORDER`（`terrain.js:201`，图鉴顺序）。

| 字符 | 名称 | elev | 生成来源 | 生态位 |
|---|---|---|---|---|
| `Y` | 深渊裂隙 | -2 | 地貌盖章 `carveChasm`（mapgen.js:96-110，`genWorld` 调用 :78）；地牢房间深坑（:159） | 不可通行深坑 |
| `U` | 深水 | -1 | genWorld 主流程最低海拔（hh<0.22/0.13/0.12，mapgen.js:35,44,52） | 海洋景深 |
| `~` | 海洋 | 0 | genWorld 主流程（mapgen.js:36,45,53）；河/湖 `carveRiverPoly`（:67-68）、`lake`（:69-72） | 海/湖/河 |
| `A` | 浅滩 | 0 | genWorld 海岸浅水（:37,46,54）；`lake` 外环（:72） | 滩 |
| `@` | 泥滩 | 0 | 地貌盖章 `mudflat`（:85-91：S/E/M 邻水时 40% 概率） | 湿泥过渡 |
| `S` | 沙滩 | 1 | genWorld 海岸线（:38,47,55） | 滩 |
| `E` | 沙漠 | 1 | genWorld desert 图主流程（:48-50） | 旱地低地 |
| `M` | 沼泽 | 1 | 地貌盖章 `swamp`（:79-84：G/D 邻水） | 湿地 |
| `P` | 石板地板 | 1 | genDungeon 房间地面（房间定义 :144-147，盖章 :148） | 建筑地面 |
| `O` | 洞窟地面 | 1 | genDungeon 房间变体（P 的 22%，:154-157） | 地牢地面 |
| `#` | 木地板 | 1 | genDungeon 房间变体（P 的 8%，:154-157） | 建筑地面 |
| `D` | 泥地 | 2 | genWorld 主流程湿草地带（wv<-1.0，:56） | 低地 |
| `G` | 草地 | 2 | genWorld 主流程主体（:56） | 低地/平地 |
| `H` | 森林 | 2 | genWorld 主流程湿地带（wv>0.8，:56） | 覆盖物 |
| `R` | 道路 | 2 | 盖章直线 `stampLine`（:126-140，调用 :75） | 交通 |
| `L` | 岩浆 | 2 | 地貌盖章 `lavaCrater` 内核（:65）、`lavaFlow`（:66）；地牢岩浆池（:151） | 危害 |
| `Z` | 草原灌木 | 2 | genWorld 主流程旱草地（-1.0≤wv<-0.5，:56） | 旱地草原 |
| `F` | 冰原 | 3 | genWorld frozenOcean 海冰（:37） | 冻海 |
| `N` | 苔原 | 3 | genWorld frozenOcean 陆（:39） | 寒地 |
| `T` | 岩石 | 3 | genWorld 高地带（:57,50,39）；`lava` 邻水转 `T`（:73-74）；地牢零星（:152） | 高地 |
| `K` | 焦土 | 3 | 地貌盖章 `lavaCrater` 外环（:65）、`scorch`（:77：T 邻 L） | 灼烧 |
| `C` | 岩壁 | 3 | genDungeon 墙体（:143） | 障碍 |
| `Q` | 高原草甸 | 3 | genWorld 下高地湿侧（wv>-0.6，:57） | 高山草地 |
| `V` | 碎石坡 | 3 | genWorld 上高地/山腰（:58；各模式 :41,49） | 高地过渡崩积带 |
| `W` | 雪地 | 4 | genWorld 峰顶（:60） | 极高山顶 |
| `X` | 雪岩 | 4 | genWorld 雪线过渡带（:59；冻原峰顶 :42） | 雪线中间态 |

**生成来源分类**（对应 `genWorld`，mapgen.js:4-95）：
- **主流程（海拔 `hh` + 湿度 `wv` 分带）**：第一遍 fbm 计算连续海拔场 `hhField` 与湿度场（:9-24），湿度在陆地带统计均值方差归一（`wet`，:25-27），第二遍按分带阈值选地形（:28-63）。三套分带：普通（:52-60）、`frozenOcean` 冻原（:34-42）、`desert` 荒漠（:43-50）。
- **地貌特征盖章（在整图之后按邻接/几何覆盖）**：`lavaCrater`/`lavaFlow`（L/K）、`carveRiverPoly`（河流 ~）、`lake`（~ + A 环）、岩浆邻水转 T、`roads`（R）、`scorch`（K）、`carveChasm`（Y）、`swamp`（M）、`mudflat`（@）。
- **genDungeon**（:141-173）：C 墙体 + P 房间 + O/# 变体 + L 岩浆池 + Y 深坑 + 零星 T。
- 5 张地图配置见 `MAPS`（mapgen.js:179-202）：main 翡翠大陆 / tundra 极地冻原 / volcano 火山群岛 / dungeon 熔火地牢 / desert 流沙荒漠。

**elev 分布**（供高度差 Phase 1 使用，以 `terrain.js:173-200` 实际值为准）：-2 级 1 种（Y）· -1 级 1 种（U）· 0 级 3 种（~、A、@）· 1 级 6 种（S、E、M、P、O、#）· 2 级 6 种（D、G、H、R、L、Z）· 3 级 7 种（F、N、T、K、C、Q、V）· 4 级 2 种（W、X）。

---

## 3. 过渡机制：程序化距离场 + 签名缓存

### 3.1 距离场过渡原理（`tiles.js`）

- 每个过渡参与方是「A 格 + 若干邻居地形」：`renderTilePixels(A, dirNeighbors, mode, ...)`（tiles.js:64-94）逐像素对每个 dir 算**到缝线的有符号距离** `p = distFor(dir,x,y,ps,mode)`（tiles.js:45-61），`bl = smooth(clamp(0.5 + p/band, 0, 1))`，取 `bl` 最大的邻居为「主导者」（`pixelColor`，tiles.js:9-25）。
- **seam 模式（地图）**：正交边（n/s/w/e）沿格缝随 `wob` 摆动，对角（nw/ne/sw/se）用半径 R=3 的圆角鼓包；带半宽 `SEAM_BAND=2.0`（tiles.js:38）。
- **blob 模式（图鉴）**：B 从指定边入侵瓦片中部，2×2 Bayer 抖动，经典 Wang 观感（`tileCanvas`，tiles.js:95-101）。

### 3.2 世界坐标无缝缝线

- 缝线几何由 `wob(c,s)`（util.js:13，`vnoise` 平滑插值噪声 + 两个低周正弦）偏移。
- `pairSeed(a,b)`（tiles.js:40）= `lo*4096+hi`（seed 对称配对）：相邻两格对**同一条缝**共享同一 wob 参数 → 边界几何对齐。
- seam 的 n/s/w/e 用**共享世界坐标谓词**（tiles.js:46-50）：上格 `p = wob(x,ps)-wy-0.5`、下格 `p = wy-15.5-wob(x,ps)`，两格互补判定；叠加世界坐标 Bayer 抖动后，共享缝线逐像素一致（0 冲突，见 §7）。
- `cornerRule`（tiles.js:27-37）：对角 dir **仅在两个相邻正交 dir 都存在时**才参与过渡——纯对角接触不渲染鼓包（消除旧版 R=3 固定小圆角，与社区 bitmask corner rule 一致）。

### 3.3 二值抖动

- 过渡带内不渐变，用**世界坐标 Bayer 4×4 有序抖动**二值选择 A/主导色（`BAYER4`，tiles.js:7-8；`bayerTh(wx,wy)` 用世界像素坐标）→ 结构化无盐椒散点、相邻格共享缝线取同一阈值。
- 6 种「特效门控」在过渡带边缘混入水花/岩浆辉光/浅滩沫花/沼泽苇秆等（tiles.js:86-91，`renderTilePixels`；模板化后为 `fx` 位掩码，tiles.js:150-157）。

### 3.4 签名缓存（性能重构核心，`tiles.js:120-195`）

- **key = 地形 + 8 邻字符**：`neighborKey(t,nbs)` = `t + '|' + n/s/w/e/nw/ne/sw/se`（tiles.js:121-123）。同一「地形+8邻接」配置的格子共享一次昂贵的逐像素过渡计算。
- 缓存的是**「抖动前」模板**（A色/主导色/bl + 特效门控位 `fx`，均与格位置无关，`buildTemplate`，tiles.js:124-161），渲染时按该格真实世界坐标补一次 Bayer 抖动并按原顺序/公式应用特效 mix（`renderTemplate`，tiles.js:163-185），输出与逐格直算**逐字节一致**。
- 无过渡的纯地形格退化为 `baseOf(t)` 直接 blit（tiles.js:110-112）。
- **硬约束：key 不能掺高度/基底等额外数据**——一旦含高度维度每格唯一、缓存全失效；高度差渲染必须走 post-blit 覆盖层（见 §4）。

### 3.5 过渡修复要点（git `da6396a`，源自 `docs/transition-tiles-research.md`）

| # | 问题（旧版） | 修复 | 代码位置 |
|---|---|---|---|
| ① | `wob` 含逐列白噪声项 → 相邻列跳变最大 5.27px，海岸线锯齿 | 换 `vnoise` 平滑插值噪声 + 双正弦，幅度收窄 | `util.js:13` |
| ② | seam 白噪声抖动阈值 → 盐椒散点边 | 世界坐标 Bayer 4×4 有序抖动 | `tiles.js:7-8,16-18` |
| ③ | 共享缝线 ~12% 列两格判定不一致（1px 撕裂） | 缝线判定改共享世界坐标谓词（上格 `p=y0-wy`、下格 `p=wy-y0` 互补） | `tiles.js:45-50` |
| ④ | 对角纯接触渲染 R=3 固定鼓包 | `cornerRule`：对角仅在相邻正交边都存在时参与 | `tiles.js:27-37` |
| ⑤ | 带半宽 3.0 软硬交替 | 收紧到 `SEAM_BAND=2.0` + `smooth()` 平滑 | `tiles.js:38,75` |

---

## 4. 高度层：heights 并行数据层 + Phase 1/2 渲染覆盖层

**架构决策**：高度差是**独立数据维度**，不污染字符 `grid`。地图生成已用 fbm 算好每格连续海拔场，直接随返回对象输出——零新增计算。

### 4.1 数据层（`mapgen.js`）

- `genWorld` 返回 `{grid, w, h, seed, river, heights: hhField}`（mapgen.js:92-94）——`hhField` 是第一遍已算好的连续海拔场（Float64Array，mapgen.js:9-24）。
- `genDungeon` 构造 `heights`：房间/通道 fbm 微起伏，岩壁 C 高起（0.72）、岩浆 L 下陷（0.28）、裂隙 Y 最深（0.05）（mapgen.js:161-172）。

### 4.2 Phase 1：邻格 elev 差覆盖层（`render.js:141-158`，`buildMapCache` 内 post-blit）

逐边按 `TERRAIN[v].elev - TERRAIN[t].elev` 差分绘制：
- **diff==1（缓坡）**：低格投影加深 + 高格 1px 受光亮唇（`drawLip`，render.js:30-34）。
- **diff>=2（崖壁）**：高格 3px 岩壁断面条（1px 近黑边 + 2px 压暗基色 + 岩类层理 `ROCKY`，`drawCliff`，render.js:35-52）+ 低格投影。
- 低格为 `~` 时投影减弱（水下崖基）；拐角由各边独立 fillRect 自然重叠成 L/T 形。
- 零数据改动、不影响签名缓存。

### 4.3 Phase 2：heights 真实高度差浮雕 + 可选覆盖层（`render.js:53-116`）

- **同地形内高度浮雕**（`render.js:153-157`）：同地形相邻格 `|Δhh|>HH_TH(0.04)` 时低格投影（alpha 随 `|Δhh|` 到 0.30）+ 高格亮唇（到 0.20）；水体/岩浆排除（`NO_RELIEF`，render.js:58）——河流盖章会伪造 hh 阶跃。
- **海拔着色**（hypsometric 罩，`buildTintCanvas`，render.js:79-96）：低→蓝、中→绿/暖、高→白，`TINT_STOPS`（render.js:69），默认关。
- **等高线**（`buildContourCanvas`，render.js:101-116）：固定 hh 阈值（`HH_LEVELS`，render.js:99）处画 1px 淡线，只查北/西边避免重复，邻差 <0.02 跳过（避免平地碎线）。
- 叠加由 `drawFrame` 完成（render.js:196-197），开关控件在 `main.js:22,59-60`（tint/contour checkbox）。

---

## 5. 道路窄条：基底 + 窄路带 + 地形感知色（方案 A）

### 5.1 现状（代码为准）

- `R` 是**独立地形**（terrain.js:188，`cRoad` 暖棕土色带车辙，terrain.js:23-29），`stampLine` 4-connected 铺路（mapgen.js:126-140，不覆盖 `~`、防对角间隙、河岸自然终止）；连续道路 = 16px 满格实心土带，替换基底地形，参与 seam 过渡与 Phase 1 高度差。

### 5.2 调研决策（`docs/road-path-tiles-research.md`，方案 A 推荐）

用户反馈道路「太粗」，根因四项：满格 16px、替换基底、边缘复用 wob 摆动带宽起伏、单一固定土色在沙漠/苔原对比度不足。

- **方案 A（推荐）**：grid 仍存 `R`（统计/图鉴/盖章零改动），`stampLine` 盖章前把基底写入并行数组 `roadBase`（仿 `heights` 先例，mapgen.js:94），渲染时把 R 画成 **6px 心带 + 1px 深色描边**的窄路径叠加在基底上；道路色 = 基底**去饱和 + 压暗 + 按亮度掺土色**（地形感知，自动覆盖 26 基底）；骨架用「过格心折线的距离场」直算（与 `distFor` 同构），恒定带宽、无 wob。其他格中 R 邻居解析为基底，消除高熵签名碎片。
- **方案 B（拒绝）**：grid 存基底 + 独立路径叠加层——数据模型最干净但侵入大（统计/图鉴/河流盖章/签名缓存全改），道路仅占地图 ~1.5%。
- **方案 C（拒绝）**：仅 `cRoad` 按邻居自适应——不解决「太粗」与「替换基底」。
- **关键硬约束**：基底**不可从邻居多数推导**——路贴海岸走，按邻居多数会把海洋当基底（main/tundra 各 10/15 个 R 格），必须在 `stampLine` 时精确保存。

> **落地状态**：方案 A 为调研决策，**尚未在代码中实现**（当前 `src/` 无 `roadBase`，道路仍为 16px 满格 `R`）。实施时参考调研 §4.6 的文件改动清单。

---

## 6. 关键决策记录（ADR）

### ADR-1 单字符地形约束
grid 每格一个**单字符**地形代号（`terrain.js:173-200` 以字符为键）。统计（main.js:46-49）、图鉴顺序（`PALETTE_ORDER`）、签名缓存 key（tiles.js:121-123）、河流盖章/`carveChasm` 判断全部依赖字符级语义。新地形必须占用未使用的单字符，且同步加 `TERRAIN` 表 + 纹理函数 + `PALETTE_ORDER`。9 种新地形（深渊/高原草甸/碎石坡/深水/雪岩/洞窟/木地板/泥滩/灌木）即按此落地（git `67acf6e`）。

### ADR-2 缓存隔离：签名 key 不掺高度/基底
`neighborKey` = 地形 + 8 邻（tiles.js:121-123），**严禁**加入高度/基底等额外维度——否则每格唯一、模板缓存全失效。高度差渲染因此强制走 post-blit 覆盖层读 `heights`/`elev`（render.js:141-158），不进入瓦片过渡计算。同理，方案 A 的 `roadBase` 若落地也应**独立于签名**（key 用 `'R'+base+8邻`，base 不参与 key）。

### ADR-3 道路窄条方案选型
见 §5.2：方案 A（grid 存 R + roadBase 并行数组 + 6px 窄带 + 地形感知色）为推荐决策；拒绝方案 B（数据模型侵入大）、方案 C（仅调色治标）。

### ADR-4 mesh 分支与内容恢复方法
- **分支约定**：spark 任务系统为每个任务创建独立 worktree + 分支（`mesh/<taskId>`、`gatekeeper/...`），任务经 gatekeeper 合并到 `main` 后残留。清理方法见记忆 `worktree-branch-cleanup`：沙箱禁止写 `.spark-worktrees/*`、`git worktree remove/detach` 不可用时，**手动把该 worktree 的 `.git/worktrees/<name>/HEAD` 从 `ref: refs/heads/<branch>` 改写为提交哈希**（detach），随后 `git branch -d` 删除分支 ref。
- **内容恢复**：`7135b97`「restore Phase 2 heightmap layer」——合并冲突时**取任务分支的集成版 superset**（含崖壁覆盖层 + 高度浮雕 + hypsometric 着色 + 等高线），而非仅取本地版本，避免丢失完整功能。

### ADR-5 「纯净」设计方向：移除桥/装饰
- `73e6970`：移除前景装饰（`src/decor.js` 57 行删除）——产品定位为纯程序化地形瓦片集，无前景装饰/功能性物件。
- `2491e3ff`：移除木桥（mapgen.js:76 注释明示）；`b6be58c2` 道路重做不再跨河建桥，道路在河岸自然终止。
- `da255f8`：删除旧分叉页 `tilemap.html`，统一到 `index.html` 唯一入口（`docs/ui-ux-review.md` P0-1），`?map=0..4` 深链完整。
- 当前 `index.html`/图鉴说明文案即承诺「画面纯净无前景装饰」（palette.js:49）。

---

## 7. 测试与验证

### 7.1 现状（如实说明）

- **无 `tests/` 目录、无 `npm test` 脚本**（package.json 仅 `dev/build/preview`）。「npm test」在本项目不存在。
- 唯一可运行的校验是 **`npm run build`**（Vite 构建，验证语法/模块/产物）。

### 7.2 实际采用的验证套路

各阶段验证均为**临时脚本 + 浏览器/VLM**，未固化为常驻套件（脚本位于任务临时目录，未提交）：

1. **Node 直调纯函数模块做像素级断言**：`tiles.js`/`mapgen.js`/`terrain.js` 的纯函数不触 `document`（`renderTilePixels` 只写传入 `ImageData.data`），可直接 `import` 后逐格渲染，用「与格内 A/B 基色距离最近」稳健分类量化。曾验证：
   - 签名缓存输出与逐格直算**逐字节一致**（6337 格 0 差异）；
   - 过渡修复后 seam 缝线**0 冲突**、抖动态结构化、对角无鼓包、L/T 交界干净。
2. **浏览器截图 + VLM 视觉验收**：chromium `--single-process` 截图送 VLM 检查海岸线平滑度、崖壁断面、道路、图鉴等（见记忆 `browser-e2e-in-sandbox`、`canvas-shim-verification`）。
3. **curl 模块校验**：dev server 起后逐模块拉取比对内容一致性。

### 7.3 建议（后续落地时）

把 §7.2 的 Node 直调脚本固化为 `tests/` + `vitest`（或 Node 内置 `node:test`），作为瓦片算法改动的回归基线——尤其是签名缓存逐字节一致、缝线零冲突、过渡形态这三条硬指标。

---

## 8. 代码地图（快速定位）

| 模块 | 职责 | 关键函数 |
|---|---|---|
| `src/util.js` | 纯数学/噪声（零依赖） | `TILE=16`、`fbm`、`vnoise`、`wob`（缝线蜿蜒）、`hash2` |
| `src/terrain.js` | 26 种地形纹理 + 元数据 | `cXxx(x,y,s)`、`TERRAIN`、`PALETTE_ORDER` |
| `src/mapgen.js` | 程序化世界 + 手工盖章 + 高度层 | `genWorld`、`genDungeon`、`carveChasm/RiverPoly`、`stampLine`、`MAPS` |
| `src/tiles.js` | 瓦片生成（过渡 + 签名缓存） | `renderCell`、`distFor`、`pixelColor`、`buildTemplate/renderTemplate`、`baseOf` |
| `src/render.js` | 地图缓存合成 + 高度差覆盖层 + 动画 | `buildMapCache`、`drawFrame`、`drawAnim`、`drawCliff/Lip`、`buildTintCanvas/ContourCanvas` |
| `src/main.js` | 应用状态、控件、启动 | `loadMap`、`updateStats`、`fit`、reduced-motion 处理 |
| `src/palette.js` | 图鉴面板 | `buildPalette`、`tileEl` |
| `index.html` | 唯一入口 | `?map=0..4` 深链、控件 checkbox |
| `vite.config.js` | Vite 构建 | `base:'./'`（dist 可本地直接打开） |
