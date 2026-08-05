# tilemap-generator 架构文档

> 汇总项目各阶段（模块化拆分、过渡算法修复、高度层、道路窄条、9 种新地形、图鉴/导出/持久化、回归测试）的调研与决策，供后续开发与协作参考。
> 本文基于当前代码（`src/*.js`、`tests/*`、`index.html`、`vite.config.js`）与 git 历史撰写，**以代码为准**；行号引用截至 2026-08-06 的 `main` 分支。
> 配套调研文档：`docs/ui-ux-review.md`、`docs/transition-tiles-research.md`、`docs/terrain-height-research.md`、`docs/road-path-tiles-research.md`。

---

## 0. 项目定位

零美术资产的**程序化像素地形瓦片集 + 多地图查看器**：所有瓦片由值噪声 + 色带逐像素生成，任意地形配对自动支持过渡，多邻居交界取主导地形。设计方向是「纯净」——无前景装饰、无功能性物件（木桥等已移除，ADR-5）。

技术栈：原生 ES Modules + [Vite](vite.config.js)（`base:'./'`，构建产物可本地直接打开）。无任何运行时依赖。入口唯一为 `index.html`，`?map=0..N` 深链直达对应地图（main.js:157-168）。

当前规模：26 种单字符地形、9 张地图（`MAPS`，mapgen.js:252-301）、逐像素过渡 + 签名缓存、并行高度层 + 高度差覆盖层、道路窄小径叠加、PNG 导出/图鉴/回归测试完备。

---

## 1. 数据流

```
index.html ──<script type=module>──> src/main.js（应用层 glue：控件/动画/启动）
                                        │
  ┌─────────────────────────────────────┴─────────────────────────────────────┐
  │  loadMap(def)（main.js:26-47）                                              │
  │    def.dungeon ? genDungeon(def) : genWorld(def)      【mapgen.js】          │
  │      │  →  { grid: char[][], w, h, seed, river:Set,                        │
  │      │        heights:Float64Array, roadBase:Array }  （mapgen.js:97,245）  │
  │      ▼                                                                      │
  │  buildMapCache(m)（render.js:118-191）                 【render.js】         │
  │      │  非 R 格：renderCell(t, nbs, img, x, y)          【tiles.js】         │
  │      │      └─ neighborKey 签名缓存（地形+8邻）                              │
  │      │         buildTemplate / renderTemplate / baseOf                       │
  │      │  R 格：renderRoadCell(base, nb, arms, img, x, y)                     │
  │      │      └─ 基底瓦片渲染（force）+ 6px 窄路条叠加（tiles.js:165-168）      │
  │      │  邻接解析：R→roadBase 基底（res/fallbackBase，render.js:133-144）     │
  │      ├─ Phase1 高度差覆盖层（邻格 elev：投影/亮唇/崖壁断面）                 │
  │      ├─ Phase2 高度层浮雕（heights 邻差）+ tint/contour 可选覆盖层           │
  │      └─ animCells 预生成（水/岩浆可动格列表，动画只遍历它）                  │
  │      │  →  cacheCanvas（含 .animCells / .tintCanvas / .contourCanvas）        │
  │      ▼                                                                      │
  │  drawFrame(ctx, cacheCanvas, map, ui, now)（render.js:218-226，main.js:15-18）│
  │      ├─ blit cacheCanvas（静态帧，一次 drawImage）                           │
  │      ├─ 叠加 tintCanvas / contourCanvas（可选，checkbox 开关）               │
  │      ├─ drawAnim（水/岩浆动画，'lighter' 合成，render.js:197-217）           │
  │      └─ drawGridOverlay（网格，render.js:192-196）                           │
  └────────────────────────────────────────────────────────────────────────────┘

palette.js buildPalette()（palette.js:6-46） → 图鉴面板
   ├─ baseOf(t)  基础瓦片（tiles.js:110-112，零邻居纯地形，缓存 Map）
   └─ tileCanvas(A,B,dirs)  blob 模式过渡片（tiles.js:95-101，Wang 16 片集展示）

export.js  buildTilesetCanvas()/exportMapPNG()（export.js:51-113） → 瓦片集/地图 PNG
```

**关键约定**：
- `mapgen`（数据层）产出字符 `grid` + 并行 `heights` + `roadBase`；`tiles`（瓦片层）只认字符 + 额外处理 R 窄条；`render`（合成层）blit 字符瓦片后叠加高度差覆盖层；`main` 管应用状态与控件；`palette` 读同一套瓦片函数做图鉴；`export` 复用 cacheCanvas 合成导出。
- 静态帧缓存：地图只生成一次 `cacheCanvas`，动画帧每帧仅 `drawImage` 静态帧 + 画可动格，不做整图重算（性能重构产物，见 ADR 与 `docs/ui-ux-review.md` P1-2）。
- 单一 ImageData buffer 复用（render.js:126）：逐格覆盖写入，消除每格分配；`nbrs` 邻接计算与高度差投影共用一次（render.js:149）。

---

## 2. 地形体系：26 种单字符地形

定义于 `src/terrain.js`：每个地形 `cXxx(x,y,s)` 逐像素纹理函数 + `TERRAIN` 表（`terrain.js:186-213`，字段 `name/seed/elev/color`）+ `PALETTE_ORDER`（`terrain.js:214`，图鉴顺序）+ `roadColor(base,x,y,s)`（`terrain.js:167-177`，窄路地形感知色）。

| 字符 | 名称 | elev | 生成来源 | 生态位 |
|---|---|---|---|---|
| `Y` | 深渊裂隙 | -2 | 地貌盖章 `carveChasm`（mapgen.js:99-113，`genWorld` 调用 :81）；地牢 R8 深坑（mapgen.js:221） | 不可通行深坑 |
| `U` | 深水 | -1 | genWorld 主流程最低海拔（hh<0.22/0.13/0.12，mapgen.js:35,44,52） | 海洋景深 |
| `~` | 海洋 | 0 | genWorld 主流程（mapgen.js:36,45,53）；河/湖 `carveRiverPoly`（:67-68）、`lake`（:69-72） | 海/湖/河 |
| `A` | 浅滩 | 0 | genWorld 海岸浅水（:37,46,54）；`lake` 外环（:72） | 滩 |
| `@` | 泥滩 | 0 | 地貌盖章 `mudflat`（:89-94：S/E/M 邻水时 40% 概率） | 湿泥过渡 |
| `S` | 沙滩 | 1 | genWorld 海岸线（:38,47,55） | 滩 |
| `E` | 沙漠 | 1 | genWorld desert 图主流程（:48-50） | 旱地低地 |
| `M` | 沼泽 | 1 | 地貌盖章 `swamp`（:82-87：G/D 邻水，desert 图为 E 邻水） | 湿地 |
| `P` | 石板地板 | 1 | genDungeon 房间地面（fillRect 等 :183-204） | 建筑地面 |
| `O` | 洞窟地面 | 1 | genDungeon 房间变体（P 的 22%，:227-230） | 地牢地面 |
| `#` | 木地板 | 1 | genDungeon 房间变体（P 的 8%，:227-230） | 建筑地面 |
| `D` | 泥地 | 2 | genWorld 主流程湿草地带（wv<-1.0，:56） | 低地 |
| `G` | 草地 | 2 | genWorld 主流程主体（:56） | 低地/平地 |
| `H` | 森林 | 2 | genWorld 主流程湿地带（wv>0.8，:56） | 覆盖物 |
| `R` | 道路 | 2 | 盖章直线 `stampLine`（:129-149，调用 :78） | 交通 |
| `L` | 岩浆 | 2 | 地貌盖章 `lavaCrater` 内核（:65）、`lavaFlow`（:66）；地牢岩浆池（:217-219） | 危害 |
| `Z` | 草原灌木 | 2 | genWorld 主流程旱草地（-1.0≤wv<-0.5，:56） | 旱地草原 |
| `F` | 冰原 | 3 | genWorld frozenOcean 海冰（:37） | 冻海 |
| `N` | 苔原 | 3 | genWorld frozenOcean 陆（:39） | 寒地 |
| `T` | 岩石 | 3 | genWorld 高地带（:57,50,39）；`lava` 邻水转 `T`（:73-74）；地牢零星 | 高地 |
| `K` | 焦土 | 3 | 地貌盖章 `lavaCrater` 外环（:65）、`scorch`（:80：T 邻 L） | 灼烧 |
| `C` | 岩壁 | 3 | genDungeon 墙体（:178 初始化） | 障碍 |
| `Q` | 高原草甸 | 3 | genWorld 下高地湿侧（wv>-0.6，:57） | 高山草地 |
| `V` | 碎石坡 | 3 | genWorld 上高地/山腰（:58；各模式 :41,49） | 高地过渡崩积带 |
| `W` | 雪地 | 4 | genWorld 峰顶（:60） | 极高山顶 |
| `X` | 雪岩 | 4 | genWorld 雪线过渡带（:59；冻原峰顶 :42） | 雪线中间态 |

**生成来源分类**（对应 `genWorld`，mapgen.js:4-98）：
- **主流程（海拔 `hh` + 湿度 `wv` 分带）**：第一遍 fbm 计算连续海拔场 `hhField` 与湿度场（:9-24，fbm+增益 bumps+island 衰减+clamp），湿度在陆地带统计均值方差归一（`wet`，:25-27），第二遍按分带阈值选地形（:28-63）。三套分带：普通（:52-60）、`frozenOcean` 冻原（:34-42）、`desert` 荒漠（:43-50）。
- **地貌特征盖章（在整图之后按邻接/几何覆盖）**：`lavaCrater`/`lavaFlow`（L/K）、`carveRiverPoly`（河流 ~）、`lake`（~ + A 环）、岩浆邻水转 T、`roads`（R + roadBase）、`scorch`（K）、`carveChasm`（Y）、`swamp`（M）、`mudflat`（@）。
- **genDungeon**（:174-246）：C 墙体 + P 房间 + O/# 变体 + L 岩浆池 + Y 深坑 + 零星 T/V + 高度层。
- 9 张地图配置见 `MAPS`（mapgen.js:252-301）：main 翡翠大陆 / tundra 极地冻原 / volcano 火山群岛 / dungeon 熔火地牢 / desert 流沙荒漠（历史任务）+ plateau 遗忘高原 / archipelago 群岛迷宫 / frozen 冻土苔原 / doom 末日裂谷（后 4 张，mapgen.js:275 注释 task `e4978f4d`，git merge `7b84cfd`）。

**elev 分布**（供高度差 Phase 1 使用，以 `terrain.js:186-213` 实际值为准）：-2 级 1 种（Y）· -1 级 1 种（U）· 0 级 3 种（~、A、@）· 1 级 6 种（S、E、M、P、O、#）· 2 级 6 种（D、G、H、R、L、Z）· 3 级 7 种（F、N、T、K、C、Q、V）· 4 级 2 种（W、X）。合计 26。

> 9 种新地形（深渊 Y / 深水 U / 泥滩 @ / 洞窟 O / 木地板 # / 灌木 Z / 高原草甸 Q / 碎石坡 V / 雪岩 X）由 task `67acf6e` 补入，生态位缺口分析见 `docs/terrain-height-research.md` §A。

---

## 3. 过渡机制：程序化距离场 + 签名缓存

### 3.1 距离场过渡原理（`tiles.js`）

- 每个过渡参与方是「A 格 + 若干邻居地形」：`renderTilePixels(A, dirNeighbors, mode, img, cx, cy)`（tiles.js:64-94）逐像素对每个 dir 算**到缝线的有符号距离** `p = distFor(dir,x,y,ps,mode)`（tiles.js:45-61），`bl = smooth(clamp(0.5 + p/band, 0, 1))`，取 `bl` 最大的邻居为「主导者」（`pixelColor`，tiles.js:9-25）。
- **seam 模式（地图）**：正交边（n/s/w/e）沿格缝随 `wob` 摆动，对角（nw/ne/sw/se）用半径 R=3 的圆角鼓包；带半宽 `SEAM_BAND=2.0`（tiles.js:38）。
- **blob 模式（图鉴）**：B 从指定边入侵瓦片中部，2×2 Bayer 抖动，经典 Wang 观感（`tileCanvas`，tiles.js:95-101；`cellTile` 是带世界坐标的 seam 版本，tiles.js:102-109）。

### 3.2 世界坐标无缝缝线

- 缝线几何由 `wob(c,s)`（util.js:13，`vnoise` 平滑插值噪声 + 两个低周正弦）偏移。
- `pairSeed(a,b)`（tiles.js:40）= `lo*4096+hi`（seed 对称配对）：相邻两格对**同一条缝**共享同一 wob 参数 → 边界几何对齐。
- seam 的 n/s/w/e 用**共享缝线谓词**（tiles.js:46-50，局部坐标）：上格 `p = wob(x,ps)-y-0.5`、下格 `p = y-15.5-wob(x,ps)`（w/e 对称同理）——两格对同一条世界缝线（同一 `wob(x,ps)` 边界）在共享像素行上互补判定（`15.5` 使像素中心对齐），消除 wob 落在两格间空隙时的 1px 判定冲突；叠加世界坐标 Bayer 抖动后共享缝线逐像素一致（0 冲突，见 §3.3/§7）。
- `cornerRule`（tiles.js:27-37）：对角 dir **仅在两个相邻正交 dir 都存在时**才参与过渡——纯对角接触不渲染鼓包（与社区 bitmask corner rule 一致）。

### 3.3 二值抖动

- 过渡带内不渐变，用**世界坐标 Bayer 4×4 有序抖动**二值选择 A/主导色（`BAYER4`，tiles.js:7-8；`bayerTh(wx,wy)` 用世界像素坐标）→ 结构化无盐椒散点、相邻格共享缝线取同一阈值。
- 6 种「特效门控」在过渡带边缘混入水花/岩浆辉光/浅滩沫花/沼泽苇秆/焦土裂纹（tiles.js:86-91，`renderTilePixels`；模板化后为 `fx` 位掩码，tiles.js:214-221、238-244）。

### 3.4 签名缓存（性能重构核心，`tiles.js:184-264`）

- **key = 地形 + 8 邻字符**：`neighborKey(t,nbs)` = `t + '|' + n/s/w/e/nw/ne/sw/se`（tiles.js:185-187）。同一「地形+8邻接」配置的格子共享一次昂贵的逐像素过渡计算。
- 缓存的是**「抖动前」模板**（A色/主导色/bl + 特效门控位 `fx`，均与格位置无关，`buildTemplate`，tiles.js:188-225），渲染时按该格真实世界坐标补一次 Bayer 抖动并按原顺序/公式应用特效 mix（`renderTemplate`，tiles.js:227-249），输出与逐格直算**逐字节一致**（T2 验证）。
- 无过渡的纯地形格退化为 `baseOf(t)` 直接 blit（tiles.js:110-112）。
- **硬约束：key 不能掺高度/基底等额外数据**——一旦含高度维度每格唯一、缓存全失效；高度差渲染必须走 post-blit 覆盖层（见 §4），道路基底走 R 专用分支（见 §5）。

### 3.5 过渡修复要点（git `da6396a`，源自 `docs/transition-tiles-research.md`）

| # | 问题（旧版） | 修复 | 代码位置 |
|---|---|---|---|
| ① | `wob` 含逐列白噪声项 → 相邻列跳变最大 5.27px，海岸线锯齿 | 换 `vnoise` 平滑插值噪声 + 双正弦，幅度收窄 | `util.js:13` |
| ② | seam 白噪声抖动阈值 → 盐椒散点边 | 世界坐标 Bayer 4×4 有序抖动 | `tiles.js:7-8,16-18` |
| ③ | 共享缝线 ~12% 列两格判定不一致（1px 撕裂） | 缝线判定改共享缝线谓词（上格 `p=wob(x,ps)-y-0.5`、下格 `p=y-15.5-wob(x,ps)` 互补） | `tiles.js:46-50` |
| ④ | 对角纯接触渲染 R=3 固定鼓包 | `cornerRule`：对角仅在相邻正交边都存在时参与 | `tiles.js:27-37` |
| ⑤ | 带半宽 3.0 软硬交替 | 收紧到 `SEAM_BAND=2.0` + `smooth()` 平滑 | `tiles.js:38,75` |

---

## 4. 高度层：heights 并行数据层 + Phase 1/2 渲染覆盖层

**架构决策**：高度差是**独立数据维度**，不污染字符 `grid`。地图生成已用 fbm 算好每格连续海拔场，直接随返回对象输出——零新增计算（同 `roadBase` 先例）。

### 4.1 数据层（`mapgen.js`）

- `genWorld` 返回 `{grid, w, h, seed, river, heights:hhField, roadBase}`（mapgen.js:97）——`hhField` 是第一遍已算好的连续海拔场（Float64Array，mapgen.js:9-24）。
- `genDungeon` 构造 `heights`（mapgen.js:233-244）：房间/通道 fbm 微起伏，岩壁 C 高起（0.72）、水体 `~` 下陷（0.30）、岩浆 L（0.26）、深水 U（0.20）、裂隙 Y 最深（0.05），其余 `0.56+fbm*0.08`；返回同样带 `heights` 与空 `roadBase`（mapgen.js:245）。

### 4.2 Phase 1：邻格 elev 差覆盖层（`render.js:166-184`，`buildMapCache` 内 post-blit）

逐边按 `TERRAIN[v].elev - TERRAIN[effT].elev` 差分绘制（`effT`：R 格取其 `roadBase` 基底）：
- **diff>0（邻格更高）**：低格投影加深（alpha 0.28/0.42，`~` 水下减弱到 0.3 倍）。
- **diff==-1（缓坡）**：高格 1px 受光亮唇（`drawLip`，render.js:30-34）。
- **diff<=-2（崖壁）**：高格 3px 岩壁断面条（1px 近黑边 + 2px 压暗基色 + 岩类层理 `ROCKY`，`drawCliff`，render.js:35-52）+ 低格投影。
- 拐角由各边独立 fillRect 自然重叠成 L/T 形；零数据改动、不影响签名缓存。

### 4.3 Phase 2：heights 真实高度差浮雕 + 可选覆盖层（`render.js:53-116`）

- **同地形内高度浮雕**（render.js:179-183）：同地形相邻格 `|Δhh|>HH_TH(0.04)` 时低格投影（alpha 随 `|Δhh|` 到 0.30）+ 高格亮唇（到 0.20）；水体/岩浆排除（`NO_RELIEF={'~','U','A','L'}`，render.js:58）——河流盖章会伪造 hh 阶跃。
- **海拔着色**（hypsometric 罩，`buildTintCanvas`，render.js:79-96）：低→蓝、中→绿/暖、高→白，`TINT_STOPS`（render.js:69），水体单独 bathymetric 色，岩浆不罩；默认关。
- **等高线**（`buildContourCanvas`，render.js:101-116）：固定 hh 阈值（`HH_LEVELS`，render.js:99）处画 1px 淡线，只查北/西边避免重复，邻差 <0.02 跳过（避免平地碎线）。
- 叠加由 `drawFrame` 完成（render.js:222-223），开关控件在 index.html（海拔着色/等高线 checkbox），状态持久化（main.js:131-135）。

---

## 5. 道路窄条：基底 + 窄路带 + 地形感知色（方案 A，**已实现**）

### 5.1 现状（代码为准，task `771af21b` 道路改造已合入，merge `fa5c811`）

`R` 仍是独立地形（terrain.js:201，elev 2），grid 语义不变（统计/图鉴/盖章零改动），但**渲染时把 R 画成叠加在盖章前基底上的窄小径**，而非满格土路：

1. **数据：`roadBase` 并行数组**（mapgen.js:77-78）——`stampLine`（mapgen.js:129-149）在 `grid[y][x]='R'` 前把盖章前地形写入 `roadBase[y*w+x]`（已有 R 格不覆盖已存基底，跨路交点保留首次；`put` 内 `old!=='R'` 判断，:141）；`genWorld` 返回对象携带（:97）。**基底不可从邻居多数推导**——路贴海岸走，按邻居多数会把海洋当基底（调研实测 main/tundra 各 10/15 个 R 格），必须在盖章时精确保存。
2. **渲染：窄路条叠加**（tiles.js:148-176）——`renderRoadCell(base,nb,arms,img,cx,cy)`（:165-168）先把基底瓦片渲染进 buffer（force=true，flat 也写入），再按**正交 R 邻居方向**构造过格心 (8,8) 的骨架折线（`roadSegments`，:123-135：端点收圆帽/对向直段/相邻 L 形/3-4 臂 T 与十字），用「到折线距离场」画恒定带宽窄条（`distToSegments`，:143-147）：
   - `d ≤ ROAD_HALF`（ROAD_W=6 → 半宽 3px）：路心色；
   - `ROAD_HALF < d ≤ ROAD_HALF+ROAD_OUT`（1px 描边）：路心压暗 ~40%（低对比基底上「弹出来」的关键）；
   - 其余：保留基底像素。
3. **地形感知色**：`roadColor(base,x,y,s)`（terrain.js:167-177）= 基底**去饱和 45% + 压暗 12%**，再按基底亮度掺 0~55% `cRoad` 暖棕 → 草地→土橄榄、雪地→压实雪、沙漠→淡沙，自动覆盖 26 基底。
4. **邻居解析**：`buildMapCache` 的 `nbrs` 把每个 R 邻居解析为其 `roadBase`（`res`，render.js:139-141；缺失时兜底「非水体正交邻居多数」`fallbackBase`，:133-138）→ 道路两侧基底与被覆盖基底同材质，无缝连续；邻 R 的格归入普通基底格缓存。
5. **高度差**：R 格的唇边/崖壁基色读基底 `effT` 而非 cRoad（render.js:151,169）。
6. **图鉴/导出兜底**：无 roadBase 上下文时用固定草地基底 + 水平窄条示意（`ROAD_FALLBACK_BASE='G'` + `roadTileDefault`，tiles.js:170-176，`baseOf('R')` 即此，:110）；`pairs4` 中 R↔G 片标注为「窄小径叠固定草地基底」（palette.js:22,27-29）。

> 选型论证（A 推荐 / B 拒绝 / C 拒绝）与像素级实测见 `docs/road-path-tiles-research.md` §3-4：A 改动最小且兼容签名缓存/统计/盖章；B 数据模型最干净但侵入大（道路仅占地图 ~1.5%）；C 不解决「太粗」。6px 心带 + 1px 描边为 16px 格内「窄而有存在感」的甜点值（调研 §5）。

---

## 6. 关键决策记录（ADR）

### ADR-1 单字符地形约束
grid 每格一个**单字符**地形代号（`terrain.js:186-213` 以字符为键）。统计（main.js:48-56）、图鉴顺序（`PALETTE_ORDER`）、签名缓存 key（tiles.js:185-187）、河流盖章/`carveChasm` 判断全部依赖字符级语义。新地形必须占用未使用的单字符，且同步加 `TERRAIN` 表 + 纹理函数 + `PALETTE_ORDER`。9 种新地形（深渊/高原草甸/碎石坡/深水/雪岩/洞窟/木地板/泥滩/灌木）即按此落地（git `67acf6e`）。

### ADR-2 缓存隔离：签名 key 不掺高度/基底
`neighborKey` = 地形 + 8 邻（tiles.js:185-187），**严禁**加入高度/基底等额外维度——否则每格唯一、模板缓存全失效。高度差渲染因此强制走 post-blit 覆盖层读 `heights`/`elev`（render.js:166-184），不进入瓦片过渡计算；道路基底走 R 专用 `renderRoadCell` 分支（tiles.js:165-168），不走普通模板缓存（R 格占图 ~1.5%，逐格直算可接受）。

### ADR-3 道路窄条方案选型（已落地）
见 §5：方案 A（grid 存 R + roadBase 并行数组 + 6px 窄带 + 地形感知色）为推荐决策并已实现（task `771af21b`）；拒绝方案 B（数据模型侵入大）、方案 C（仅调色治标）。论证见 `docs/road-path-tiles-research.md`。

### ADR-4 mesh 分支与内容恢复方法
- **分支约定**：spark 任务系统为每个任务创建独立 worktree + 分支（`mesh/<taskId>`、`gatekeeper/...`），任务经 gatekeeper 合并到 `main` 后残留。
- **内容恢复**：`7135b97`「restore Phase 2 heightmap layer」——合并冲突时**取任务分支的集成版 superset**（含崖壁覆盖层 + 高度浮雕 + hypsometric 着色 + 等高线），而非仅取本地版本，避免丢失完整功能。

### ADR-5 「纯净」设计方向：移除桥/装饰
- `73e6970`：移除前景装饰（`src/decor.js`）——产品定位为纯程序化地形瓦片集，无前景装饰/功能性物件。
- `2491e3ff`：移除木桥；`b6be58c2` 道路重做不再跨河建桥，道路在河岸自然终止（`stampLine` 不覆盖 `~`）。
- `da255f8`：删除旧分叉页 `tilemap.html`，统一到 `index.html` 唯一入口（`docs/ui-ux-review.md` P0-1），`?map=0..N` 深链完整。
- 当前 `index.html`/图鉴说明文案即承诺「画面纯净无前景装饰」（palette.js:44）。

---

## 7. 测试与验证

### 7.1 回归测试套件（task `06c60c30` 已落地）

`npm test` = `node tests/run.mjs`（package.json）。纯 Node + 极简 Canvas2D shim（`tests/shim.js`，零依赖，`_buf` 闭包 getter + source-over 混合 alpha 两个必踩坑已注释），直调 `src` 纯函数模块。5 项测试全绿：

| # | 测试 | 覆盖内容 | 位置 |
|---|---|---|---|
| T1 | 纯地形瓦片逐字节 vs 黄金基线 | 26 地形 `baseOf` 与固定 seed 黄金基线（`tests/golden/baseof.json`）+ 原始地形色函数逐字节一致；差异自动分类「管线漂移 vs 调色改动」 | run.mjs:63-107 |
| T2 | 过渡签名缓存一致性 | 真实地图签名 + 合成签名（含 R↔G、水陆）在 7 组世界坐标下逐字节一致；缓存命中 == 全新构建（fresh 模块实例） | run.mjs:110-174 |
| T3 | 地图生成 smoke | 9 张地图 grid 尺寸 / 无未定义地形 / 统计和 = w×h | run.mjs:177-206 |
| T4 | 道路窄条验证 | `roadBase` 结构（尺寸/基底非水体/非 R）+ R 格非基底像素占比在 (5%,90%)（窄条而非满格） | run.mjs:209-267 |
| T5 | 高度层数据 | 9 张地图 `heights` 尺寸 w×h、全部落在 [0,1]、无 NaN | run.mjs:270-291 |

- **黄金基线生成**：`node tests/gen-golden.mjs` → `tests/golden/baseof.json`（26 地形 RGBA hex）。当 T1 因**有意**的渲染/调色改动失败时重新生成，但先确认改动是预期的而非回归。
- **gatekeeper 自检联动**：测试失败会阻断 gatekeeper 合并（历史修复见 `82e36e9` shim 补 `getImageData`、`3b1005c` T4 用 `renderRoadCell`、`787198e` 道路改动后重生成 golden、`ec909ee` T4 水集对齐 stampLine）。

### 7.2 历史验证套路（tests/ 落地前各阶段所用）

1. **Node 直调纯函数模块做像素级断言**：`tiles.js`/`mapgen.js`/`terrain.js` 的纯函数不触 `document`，可直接 import 渲染后量化——曾验证签名缓存逐字节一致（6337 格 0 差异）、过渡修复后 seam 缝线 0 冲突、道路窄条形态/对比度。
2. **浏览器截图 + VLM 视觉验收**：chromium `--single-process` 截图送 VLM 检查海岸线平滑度、崖壁断面、窄路、图鉴等。
3. **curl 模块校验**：dev server 起后逐模块拉取比对内容一致性。

---

## 8. 代码地图（快速定位）

| 模块 | 职责 | 关键函数 |
|---|---|---|
| `src/util.js` | 纯数学/噪声（零依赖） | `TILE=16`、`fbm`、`vnoise`、`wob`（缝线蜿蜒）、`hash2`、`mix/clamp/smooth/clampc` |
| `src/terrain.js` | 26 种地形纹理 + 元数据 | `cXxx(x,y,s)`、`roadColor`、`TERRAIN`、`PALETTE_ORDER` |
| `src/mapgen.js` | 程序化世界 + 手工盖章 + 高度层 + roadBase | `genWorld`、`genDungeon`、`carveChasm/RiverPoly`、`stampLine`、`carveL`、`MAPS`（9 张） |
| `src/tiles.js` | 瓦片生成（过渡 + 签名缓存 + 道路窄条） | `renderCell`、`renderTilePixels`、`distFor`、`pixelColor`、`cornerRule`、`buildTemplate/renderTemplate`、`baseOf`、`renderRoadCell`、`overlayRoad` |
| `src/render.js` | 地图缓存合成 + 高度差覆盖层 + 动画 + 可选覆盖层 | `buildMapCache`、`drawFrame`、`drawAnim`、`drawGridOverlay`、`drawCliff/Lip`、`drawHHShadow/Lip`、`buildTintCanvas/ContourCanvas` |
| `src/main.js` | 应用状态、控件、启动、持久化 | `loadMap`、`selectMap`、`updateStats`、`syncURL`、`applySeedInput`、keyboard、`readPrefs/savePrefs`、reduced-motion 处理 |
| `src/palette.js` | 图鉴面板 | `buildPalette`、`makePairRow`（懒渲染）、`tileEl`、`bitsLabel` |
| `src/export.js` | 地图 PNG + 瓦片集 sprite sheet | `exportMapPNG`、`buildTilesetCanvas`、`downloadCanvas`、`EXPORT_PAIRS`（18 对） |
| `tests/` | 回归测试套件 | `run.mjs`（T1-T5）、`shim.js`（Canvas2D shim）、`gen-golden.mjs`、`golden/baseof.json` |
| `index.html` | 唯一入口 | `?map=0..N` 深链、控件 checkbox（网格/海拔着色/等高线/动画/速度） |
| `vite.config.js` | Vite 构建 | `base:'./'`（dist 可本地直接打开） |

**依赖方向（防腐层）**：`util` ← `terrain` ← `tiles` ← `render` ← `main`/`palette`/`export`；`mapgen` 独立于渲染层。字符 grid 是瓦片层唯一输入，`heights`/`roadBase` 是渲染层并行只读数据——任何新数据维度都按此「并行数组 + post-blit 覆盖层」模式接入，不污染签名缓存 key。
