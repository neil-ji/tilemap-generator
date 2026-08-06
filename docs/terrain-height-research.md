# 2.5D 地形高低差视觉调研：固定视角 2.5D RPG 的崖壁语言 → 程序化地质侧壁方案

- 调研日期：2026-08-06
- 范围：**只读调研**，未修改任何 `src/` 与既有 `docs/` 文件；唯一交付物 = 本文。依据：`src/view25d.js` / `src/main.js` / `src/mapgen.js` / `src/terrain.js` / `src/tiles.js` / `src/render.js` / `src/util.js` / `tests/run.mjs` / `index.html` 通读 + git 历史 + 既有 4 份调研文档 + 固定视角 2.5D RPG 社区资料（Web，URL 逐条见 References）。
- 对象代码状态：2.5D 等距菱形模式 Phase A 已落地（`src/view25d.js`：32×16 菱形顶面逆映射采样 + `heights` 高度层叠 + 南/东平行四边形侧壁 + `depth=x+y` painter）。
- 结论标注：[事实]=代码/文档/git 可证实；[推断]=基于经验或社区惯例的判断。每条附置信度（high/medium/low）。调研范围外标注「超出本次调研范围」，未调研到一手资料的标注「未找到一手资料」。
- 与旧文档关系：本文**取代** `docs/terrain-height-research.md`（2026-08-05 课题 A+B：地形缺口 + 2D 高度差），旧文已入 git（commit `fd903cc`），核心结论摘要见 §0.4。

---

## 0. TL;DR

### 0.1 为什么当前侧壁「怪」——一句话诊断

`view25d.js:61-80` 的 `fillWall` 把侧壁画成 **单一基色 × 线性明度渐变（顶部 0.62 → 底部 0.48，仅压暗 14%）× 逐像素 hash 噪声**：

- **没有分带**：顶帽 / 岩层 / 碎石 / 底部阴影完全不存在，整面墙是一个"糊糊"的材质；
- **没有材质剖面**：`ROCKY`（view25d.js:17）声明了但 `fillWall` **从未引用**（[事实，high，grep 全文仅 1 处声明）——土山、石山、沙山、雪山画出来**一模一样**（只差 `baseColor` 的色调），这正是用户抱怨"泥土/石头没有土山/石山的崖壁纹理"的直接原因；
- **南/东壁同色同式**：同一 `fillWall` 以相同参数画两条壁，没有「面朝向分级光照」（南壁受光应亮、东壁背光应暗）；
- **无顶缘亮线、无底部 AO**：崖壁与顶面交界没有受光棱线，壁底与低地交界没有接触阴影 → 崖壁剪影"糊"；
- **对比度太弱**：2D 模式 `drawCliff`（render.js:38-39）把基色压暗 40% + 近黑边，而 2.5D 壁顶只有 0.62，壁身甚至比 2D 崖条还亮——"高度差效果不强"不是几何问题，是**明暗语言没做**；
- **全图层协调 bug**：`mapgen.js` 的河流/湖泊/岩浆/裂隙盖章（`carveRiverPoly`/lake/`lavaCrater`/`carveChasm`）只改 `grid` 字符、**不改 `heights`**（mapgen.js:68,71,74,81 均未写 hhField），而 2.5D 的 z 直接读 `heights`（view25d.js:92-96）→ **河道/熔岩湖/深渊裂隙会被按地形抬升成"漂浮的平台"**（详见 §1.4 与 §3.7）。

一句话：**几何画对了，但"3D 视觉语言"一层都没画。** 成品 RPG 崖壁的"协调一致"不是靠多画几根线，而是靠一套**统一的材质剖面 + 光照 + 边缘语言**（§2.7）。

### 0.2 成品 2.5D RPG 的「协调一致」来自哪 5 件事

（§2.7 展开；全部可程序化转译）

1. **统一光源 + 面朝向分级**：所有表面在同一光源模型下分级（顶面最亮、南/西壁次之、东壁最暗），壁的明暗不是随机而是"面的朝向"决定。
2. **材质剖面诚实**：壁 = 顶面材质的**横截面**——土山下是土层（草皮下有褐土带、土有分层）、石山下是岩层（水平层理 + 裂缝）、雪山下是冰岩、沙山下是沙丘层。壁色永远从顶面材质推导，绝不凭空。
3. **统一的边缘语言**：顶缘亮线 + 底部接触阴影（AO）**处处一致**，高低差"语法"相同 → 观感统一。
4. **固定的图层语义**：水/岩浆/裂隙永远低位，道路贴地随地形，植被/覆盖物在顶面，壁是地形的侧面——每类元素的"高度角色"固定不变。
5. **数据层与视觉层分离**：IE 用 height/search/shadow map 存高度与遮挡，视觉是预渲染背景——本项目 `heights` 驱动几何、字符驱动纹理，已天然分离（沿用 ADR-2）。

### 0.3 推荐方案一句话

在 `src/view25d.js` 内（**仅此一文件**）做 `fillWall v2`：**顶帽 + 岩层分带 + 碎石堆积 + 底部 AO + 方向光照 + 材质类剖面**，另加最终 pass 的**顶缘亮线/壁基 AO**、**低格 LIP 阈值**（dz≥2 才画崖壁，dz==1 只画唇边）、**水/岩浆/裂隙低位修正**。`mapgen/terrain/tiles/render` 全部零改动，2D 路径逐字节不变。

### 0.4 旧文（课题 A+B）核心结论摘要（供沿用）

- 课题 A：17 种地形缺**深渊(Y)/高原草甸(Q)/碎石坡(V)/深水(U)/雪岩(X)** 等生态位——**已全部落地**（terrain.js 现有 26 种，含 Y/Q/V/U/X/@/O/#/Z）；Y/Q/V 即 P1 三项。
- 课题 B：2D 高度差已实现「缓坡唇边 + 崖壁断面条 + 同地形高度浮雕 + 等高线/海拔着色」（render.js Phase 1/2）。本文是课题 B 在 2.5D 模式的延续：**把 2D 的"唇边 vs 崖壁"双态与 ROCKY 层理移植到 2.5D 侧壁**，并补上 2D 没解决的「水体抬升」。

---

## 1. 现状诊断：为什么当前侧壁「怪」[事实为主，high]

### 1.1 现状代码事实（逐条可 grep）

| # | 现象 | 代码位置 | 与成品惯例的差距 |
|---|---|---|---|
| 1 | 侧壁 = 单一基色线性渐变 0.62→0.48 | `view25d.js:71` `k=0.62-fromTop*0.14` | 无分带；成品崖壁是"顶帽/岩层/碎石/AO"四段 |
| 2 | 逐像素整面 hash 噪声 | `view25d.js:72` `k*=0.9+hash2(...)*0.2` | 16px 下读作"闪光砂"，不是"岩理"；成品用**结构化**层理+稀疏碎屑 |
| 3 | ROCKY 声明未用 | `view25d.js:17`（grep 全文仅此 1 处） | 岩类壁没有层理/裂缝 → 土山=石山 |
| 4 | 南/东壁同式同色 | `view25d.js:140-141` 两处 `fillWall` 同参数 | 无方向光照（光从 NW 时东壁应更暗） |
| 5 | 无顶缘亮线 | fillWall 顶行被顶面覆盖（顶面后画，`view25d.js:145-153`） | 崖壁剪影无受光棱线 |
| 6 | 无壁基 AO | fillWall 末行被低格顶面覆盖（低格 depth 更大后画） | 壁底无接触阴影 |
| 7 | 对比度弱 | 壁顶 0.62 vs 2D `drawCliff` 压暗 0.6 + 近黑边（render.js:37-38） | 壁比 2D 崖条还亮 |
| 8 | dz=1 的 3px 薄壁满地图 | `STEP=3`（view25d.js:15）、`Z_STEPS=8`（:16） | 细壁读作"波纹噪声"而非"悬崖" |
| 9 | 水/岩浆/裂隙被抬升 | `mapgen.js:68,71,74,81` 盖章不改 hhField；`view25d.js:92-96` 直接读 heights | 河道/熔岩/深渊变成漂浮平台 |

### 1.2 几何层面是对的（无需改）

顶面菱形逆映射采样连续无缝（共享边同源，view25d.js:34 共享采样谓词）；壁精确止于相邻格顶面（view25d.js:138-141 代数自洽）；painter 无部分序（:125-128）。**Phase A 的几何骨架成立，问题全在"面"上，不在"形"上。** [事实，high]

### 1.3 「怪」的三种观感来源

1. **材质不诚实**（#3、#7）：壁的颜色是顶面基色单纯压暗，观众一眼看到"这是把草地贴图涂暗"，而不是"这是土地被切开露出的剖面"——缺少土/石/草在剖面上的身份。
2. **边缘不定义**（#5、#6）：没有受光棱线与接触阴影，崖壁与平地之间只有颜色过渡，没有"形"的转折——这正是"高度差效果不强"的观感主因。
3. **层次不统一**（#2、#8）：每 3px 就一片闪光砂壁，满图"波纹"，与顶面的细腻过渡、道路窄条、水波动画放在一起，明显不是一个绘制体系——"细节不协调"。

### 1.4 水体/岩浆/裂隙抬升 bug（坐标 bug，先修）

- `genWorld`：`carveRiverPoly`（mapgen.js:114-128）、`o.lake`（:69-72）、`lavaCrater/lavaFlow`（:64-66）、`carveChasm`（:81,99-113）把 `~`/`L`/`Y` 盖进 `grid`，但 `heights` = 未改的 `hhField`（:97）。河道横穿高地时，水格的 hh 仍是高地的 hh。
- 2.5D：`z = floor(hh*Z_STEPS)`（view25d.js:92-96）→ 高地河道 z 与岸相同甚至更高 → 河面与地面齐平/高于地面。`genDungeon` 没这问题（mapgen.js:237-241 显式给 `~`/`L`/`Y`/`U` 低位）。[事实，high]
- 2D 不受影响（render.js `NO_RELIEF` 排除水/岩浆参与浮雕，:58），所以 T1-T5 全绿不代表 2.5D 正确。

---

## 2. 参考作品：固定视角 2.5D RPG 的高低差视觉特征

> 范围限定：**非旋转固定视角 2.5D RPG**。戴森球/Satisfactory/Factorio/Minecraft 等可旋转 3D 引擎游戏全部排除。每作品 2-3 个可借鉴点。未找到一手资料的作品如实标注。

### 2.1 Infinity Engine 系（博德之门 1/2、冰风谷、异域镇魂曲）—— 金标准

**技术事实**：IE 的地图是**预渲染等距背景**（原本 3D 建模渲染、再手绘修正，甚至能看到低模轮廓），高度/遮挡/光照存于独立数据层——**height map（深度）、search map（可走/遮挡）、shadow map**；角色与景物的前后遮挡按**屏幕 Y 与物件"脚部基线"比较**（对象基线在上 → 画在角色后）。背景由多层（报道称 7 层）合成，全图 16-bit 色。来源：PlanetBaldursGate 特性页、gemrb、gamedev.net、Beamdog、Unity 论坛、Wikipedia（见 References）。
**美术评价**：PoE 艺术反馈帖把 BG2 的 **Umar Hills** 列为"2D 游戏做出深度和 3D 感"的标杆——"通过景观背景纹理的设计来制造高度错觉"。

**可借鉴点**：
1. **高度是数据、视觉是剖面**：IE 的高度（walk 背后/搜路）与画面（悬崖怎么画）完全分离；画面里的悬崖是**地形材质在剖面上的延续**——草顶下面是土、土下面是岩，逐层手绘。→ 程序化等价物 = 顶帽/岩层/碎石四段分带，**每段颜色都从顶面材质推导**。
2. **统一边缘处理保证"协调"**：Umar Hills 的深度感来自**多山层 + 同一明暗体系**（远山偏淡、近山偏暖、山脊受光、谷底压暗），而非单条阴影线。→ 程序化等价物 = 顶缘亮线 + 壁基 AO **全局一致** + 壁面纵向明暗渐变。
3. **遮挡 = Y 基线规则**：IE 用"脚部 Y 基线"决定前后，视觉上就是**一切边界都对齐屏幕 Y 规则**。→ 本项目 painter（x+y）与"壁精确止于邻格顶面"就是同一原则的瓦片级版本，继续沿用。[事实→设计，high]

### 2.2 暗黑破坏神 2

**技术事实**：D2 是**假等距（trimetric）**——物件倾斜 30°、瓦片边 26.565°（atan 0.5，2:1），瓦片 180×60 菱形；用**透视缩放 hack**（屏幕下方瓦片画得更大）制造地面纵深。关卡由 **DS1 瓦片预设（lvlprest.txt）+ 房间迷宫算法**拼装，瓦片分墙/檐（ledge）/地板等类。来源：gamedev.stackexchange 47156、d2mods、median-xl、Atlas-Chart-PCG（见 References）。

**可借鉴点**：
1. **"地面 + 檐口"的地形语言**：D2 高低差用**檐口（ledge/embankment）**表达——高地在低地边缘露出一个**亮色地面唇边 + 下方压暗的立壁**，且**地面纹理越过唇边继续**（唇边不是单独材质，是同一地面材料的"边缘转折"）。→ 程序化等价物 = 顶缘亮线（用顶面基色提亮，而非新颜色）+ 壁面压暗。
2. **全图件件对齐同一菱形节奏**：墙、檐、装饰全部 snap 到 180×60 菱形节奏 → 视觉天然统一。→ 本项目：层理周期（4px）、唇边/AO 宽度（1px）、STEP（3px）都应是**固定像素节奏**，不要随机变化。
3. **地面统一材质基座**：D2 地面是"一整片可感知的平面"，高度元素都是在这片平面上的"凸起/凹陷"，不会出现与地面无关的色块。→ 本项目：壁色必须与顶面材质同族（见 §3.6 材质剖面）。[事实→推断，medium-high]

### 2.3 永恒之柱 / 神界：原罪（Unity 2.5D 固定视角）

**技术事实**：PoE 是 Unity 等距 + 预渲染/绘制型区域；Obsidian 艺术反馈帖（References）明确批评**平坦地面"有时显得怪"**、指出"2D 里没有真实 z 信息，但可以通过**景观背景纹理的设计**制造高度错觉"，并以 BG2 Umar Hills 为标杆。神界：原罪 是 Unity 3D 引擎 + 固定俯视/等距相机，地形有网格位移与强明暗。

**可借鉴点**：
1. **平地也必须读作"同一表面"**（PoE 的教训）：大面积平地纹理割裂会直接摧毁高度感。→ 本项目顶面已是连续无缝瓦片（过度 + 道路 + 特效），**侧壁不要引入与顶面无关的色系**，否则会制造"两个世界"。
2. **高度错觉来自"材质设计"而非"后处理"**：PoE/BG 的高度感是**画进材质里**的（层叠山体、暖脊冷谷），不是叠一条阴影。→ 本项目高度感应**画进壁的材质剖面**（分层/碎石/帽），方向光照只是乘性系数，不是独立阴影面。[事实→设计，medium；神界部分未找到美术一手资料，属 [推断，low]]

### 2.4 废土 2/3

**说明**：等距 Unity RPG，任务要求纳入。**本次未检索到其地形高低差美术的一手资料**（「未找到一手资料」，不臆测）。仅按共性推断：与 PoE 同为 Unity 等距、平坦地面 + 绘制型凸起，可沿用 §2.3 的借鉴点。置信度 low，不展开。

### 2.5 中文斜视角 RPG（仙剑奇侠传 98、金庸群侠传、轩辕剑）

**技术事实**：
- **仙剑 1（含 98）**：等距菱形格图块拼接，关卡师**逐图块手工标注"在角色前（遮挡）/后（被遮挡）"**，用最笨但最准的方式解决等距遮挡排序（知乎：哈里叔叔 对仙剑1制法的回答，References）。→ 这正说明**遮挡排序是"设计层"而非"渲染后处理"**；本项目 `depth=x+y` 是它的自动化版本。
- **金庸群侠传**：等距菱形地图，贴图以**图块外接矩形左下角为锚点**；**建筑/空中的"海拔"数据用于判断遮挡**而非纯装饰；支持图层合并（铁血丹心论坛美工教程，References）。
- **轩辕剑叁外传·天之痕**：最后一代 2D，**水墨风山体**（仙山岛"朱描墨染"），水墨的**强轮廓 + 层间分离**（近山实、远山淡）是其层次语言核心（sina 专访 / egameinsider / wegame 资料，References）。

**可借鉴点**：
1. **遮挡是显式的设计数据**（仙剑/金庸）：高低差视觉必须与"谁挡谁"一致。→ 本项目 painter + 壁止于邻格顶面的几何，就是显式遮挡的自动化；**壁缘亮线/AO 是对这个遮挡关系的美术确认**。
2. **锚点与像素基准固定**（金庸）：所有贴图锚同一参考点 → 不出现"差几个像素"的错位。→ 本项目壁的 yTop 公式（view25d.js:66）已是统一基准，新加的唇边/AO 必须沿用同一公式，避免 1px 漂移。
3. **强轮廓 + 层间分离**（天之痕水墨）：层次清晰 = 每个"层"有明确轮廓与分离。→ 程序化等价物 = **顶缘亮线（轮廓）+ 岩层分带线（层间分离）**，二者正是本文方案的核心线条。[事实→设计，high/medium]

### 2.6 SNES/PS 斜视角 JRPG（时空之轮、FF5/6）

**技术事实**：FF6/CT 的战斗背景/场景大量使用**预渲染 3D 图像**（SGI 工作站渲染后点绘修正），山体是层叠的 pre-rendered 岩壁，明暗用 3-4 级色阶（亮部/中间调/阴影/最暗），**前景/中景/背景有大气透视与明度分层**（neo-geo SGI 工作流帖 + Polygon FF7 口述史引用，References，medium）。

**可借鉴点**：
1. **3-4 级色阶**：崖壁不是渐变，而是**亮部/中间调/阴影/暗部几个明确的色阶**。→ 程序化等价物 = **分带（顶帽/岩层交替明暗/碎石/底部 AO）= 离散色阶**，比连续渐变更有"体积感"。[推断，medium：色阶方案为通用像素美术惯例，byond "Making rocks" 教程支持]
2. **大气透视分层**：远山淡、近山饱和。→ 对 16px 瓦片尺度有限，仅在高差大的地形（多级抬升）建议"越高越偏冷偏淡"（hypsometric 思想，见 §3.5）。

### 2.7 跨作品共识：成品 RPG「协调一致」的 5 条来源（核心交付）

| # | 共识 | 代表证据 | 程序化转译 |
|---|---|---|---|
| 1 | **统一光源 + 面朝向分级** | IE 预渲染统一照明；D2 檐口同一明暗体系；通用 iso 美术惯例 | 南壁受光、东壁 ×0.86 背光；壁整体比顶面暗一档 |
| 2 | **材质剖面诚实** | IE 手绘崖壁=草/土/岩纵剖面；RPG Maker A4 悬崖顶行=草皮+土帽 | 壁色 = `baseColor` + 材质类（土/石/雪/冰/沙）专属变换 + 分层 |
| 3 | **统一边缘语言** | IE/D2 顶缘亮、底缘暗；Roll20「越低越暗」阴影梯度；2D 本项目唇边/断面条 | 顶缘亮线 + 壁基 AO 全局一致（§3.3） |
| 4 | **固定图层语义** | IE 数据层分离；金庸"海拔用于遮挡"；仙剑手标遮挡 | 水/岩浆/裂隙低位、路贴地、植被在顶面、壁是侧面（§3.7） |
| 5 | **层间分离 = 轮廓 + 明度分层** | 天之痕水墨层间；FF6 预渲染 3-4 色阶；Umar Hills 多山层 | 岩层分带线 + 离散色阶分带（§3.2） |

**回答用户核心问题**：成品 RPG 的"协调一致"不是靠细节堆砌，而是**同一光源、同一材质剖面逻辑、同一边缘语法、同一图层语义**在每一处崖壁/山体/台阶上**一致复用**。本项目只需把 `fillWall` 从"一个公式刷所有壁"改成"一套材质剖面规则刷所有壁"，即获得同样的协调性。

---

## 3. 程序化地质侧壁完整方案

> 目标：只用 `hash2`（世界坐标，确定性）+ `heights` + `baseColor` + `TERRAIN` 类，16px 尺度，逐像素确定性，单文件 `src/view25d.js` 内实现。不改任何共享模块。

### 3.1 侧壁四段式结构（顶帽/岩层/碎石/底部阴影）

对每根壁柱（世界 x 固定），`fromTop = (cy - yTop)/Δ ∈ [0,1]`（0=壁顶、1=壁底，`view25d.js:70`）。四段：

| 段 | 纵向区间 | 作用 | 关键参数 |
|---|---|---|---|
| **顶帽 Cap** | `fromTop < 2/Δ`（2px；岩类 1px） | 草皮下"土帽"/雪影，制造顶面材料"垂下"感（RPG Maker A4 惯例） | 土：`mix(base,[86,58,38],0.72)`；雪：[210,220,232] |
| **岩层/土层 Strata** | 主体 | 水平分带 = 地质剖面（层理线）；土类对比弱、岩类对比强 | 周期 `P=4px`，每壁相位 `hash2(X0,Y0,211)*P`；带界 1px 深线 ×0.84 |
| **碎石 Scree** | `fromTop > 1 - min(4,Δ)/Δ` | 底部崩积物堆积（talus），岩石类密度大、土类稀疏 | 密度：岩 0.30 / 土 0.16 / 雪 0.10；1px 亮暗砾石 |
| **底部 AO** | 末 2px | 接触阴影（Roll20「越低越暗」） | `k *= 0.62`；另在低格顶面补 1px 深线（§3.3） |

### 3.2 材质类剖面：土山 vs 石山 vs 雪山 vs 沙山

`view25d.js` 内新增 `WALL_CLASS`（渲染侧私有，不入 terrain.js）：

```js
const CLASS = {};
'G H D M Q Z @ S E'.split(' ').forEach(c=>CLASS[c]='soil'); // 土壤/植被
'T C K V X'.split(' ').forEach(c=>CLASS[c]='rock');          // 岩体（与 render.js ROCKY 同步）
'W X'.split(' ').forEach(c=>CLASS[c]='snow');                // 雪（X 雪岩 = 岩+雪）
'F N'.split(' ').forEach(c=>CLASS[c]='ice');                 // 冰/冻土
'~ U A'.split(' ').forEach(c=>CLASS[c]='water');             // 水下壁（§3.7）
CLASS['L']='lava';
```

| 类 | 壁体基色（剖面变换） | 顶帽 | 层理 | 碎石 |
|---|---|---|---|---|
| **soil**（土山） | `mix(base, warmDesat(base,0.35), 0.55)`——去饱和 + 暖化 → 褐土 | 深褐 2px | 周期 5px、对比弱（±5%） | 稀疏泥块 0.16 |
| **rock**（石山） | `base` 原色（冷灰） | 无独立帽（岩壁直接入层理） | 周期 4px、对比强（±8%）+ 带界深线 + 稀疏竖向裂缝 | 密集 0.30 |
| **snow**（雪山） | `mix(base,[176,196,214],0.45)` → 冰蓝岩 | 雪影 1-2px [210,220,232] | 浅对比（±4%）+ 雪斑（`hash2(x>>1,y>>1)` 白点） | 雪堆白点 0.10 |
| **ice**（冰原） | `mix(base,[168,204,224],0.4)` | 亮冰缘 | 冰晶垂纹（低频） | 少 |
| **sand**（S/E） | `base` 暖沙 | 沙唇（×0.7 略深） | 沙丘横纹周期 6px、很弱 | 细沙 0.20 |
| **lava** | 橙红亮渐变（`mix` 向 [255,150,50]）| — | 黑皮斑块 | 发光点 |

> 土 vs 石的关键差异 = **材质剖面**（褐土+弱层理 vs 冷岩+强层理+裂缝），这是用户抱怨"泥土/石头没有土山/石山的崖壁纹理"的正解。

### 3.3 顶缘亮线与壁基 AO（最终 pass，全局一致）

**为什么必须放最终 pass**：painter 先画壁、后画顶面（view25d.js:140-153），顶面覆盖壁顶行；低格 depth 更大后画，覆盖壁底行。所以**壁顶/壁底 1px 都会被子格顶面重画掉**，Rim/AO 若画在壁内会被覆盖。解法：所有格子放置完成后，**对每条存在的壁单独再描一次边**（全局最终 pass，2D 的 post-blit overlay 哲学）：

```
// 伪代码（在 buildMapCache25D 全部格子画完后）
for y,x:
  z = zs[y*w+x]; dzS = z-zs[(y+1)*w+x]; dzE = z-zs[y*w+x+1]
  if dzS >= LIP:
    rimLine(南壁顶缘)   // 1px 亮线：mix(baseColor(ch), 白, 0.35)，= "顶缘亮线"
    aoLine(南壁底缘)    // 1px 深线 alpha 0.35*(1+(Δ/STEP-1)*0.12)，高度越大越深
  if dzE >= LIP: 同理东壁
```

- 亮线颜色 = **顶面基色提亮**（`+40,+34,+28`），不引入新色相（§2.2 借鉴点 1）。
- AO alpha **随落差增大**（Roll20「高度→暗度映射」+ §2.7 共识 3）。
- 几何沿用 `yTop = Y0+16S-|px-X0|*0.5`（view25d.js:66）同一基准，保证与壁无缝对齐（§2.5 借鉴点 2：锚点统一）。

### 3.4 高度连续化：缓坡唇边 vs 崖壁双态（LIP 阈值）

当前 Z_STEPS=8、STEP=3，dz=1 即 3px 壁 → 满图"波纹"。参考 2D 已落地的「diff==1 唇边 / diff≥2 崖壁」双态（render.js:175-178）与 Godot/Unity 社区共识（邻差≥2 出洞/崖，需坡化预处理）：

```
const LIP = 2;   // dz（层数）
if (dz >= LIP) → 完整崖壁（fillWall v2 四段式）
if (dz === 1)  → 仅唇边：顶缘亮线（alpha 0.3）+ 壁基 AO（alpha 0.25），不画壁体
```

- 效果：大面积缓坡读作"柔和阶梯"，少数大落差读作"悬崖"，层次分明、消除波纹噪声。
- 可选增强：dz==1 时在高格顶面近缘叠 1px 低 alpha 压暗（模拟坡面转向），16px 下性价比低，列为 P2。
- Z_STEPS/STEP 调参建议：保持 8/3 起步；若想更连续可试 Z_STEPS=10、STEP=3（壁高 3/6/9…），**不要**为了"平滑"把 STEP 降到 2——薄壁噪声多于收益（[推断，medium，需视觉验收]）。

### 3.5 方向光照与高度分级明暗

```
// fillWall v2 内
let k = 0.78 - fromTop*0.26;      // 壁顶 0.78 → 壁底 0.52（比现状 0.62→0.48 顶部更亮、跨度更大）
if (face === 'east') k *= 0.86;   // 光从西北：东壁背光（§2.7 共识 1）
// 叠加 §3.1/3.2 的分带/碎石/AO 系数
```

- **hypsometric 思想**（高度越高越偏冷偏淡）可选：对 z≥5 的高格壁，`baseColor` 向冷色偏移 8%（蓝/灰），与海拔着色（render.js tintCanvas）同一哲学，列为 P2。
- 逐像素微噪声收敛为**稀疏**（`hash2<0.16` 才 ±10%），替代现状整面 ±20% 闪光（§1.1 #2）。

### 3.6 与现有 `fillWall`/`baseColor`/`ROCKY`/`heights` 的对接

- `baseColor(ch)`（view25d.js:42-51）继续作为壁色基底——`effT` 解析（:53-57，R→roadBase）保持不变。
- `ROCKY` 声明（:17）正式启用：`CLASS['rock']` 分支使用它（与 render.js 同集合，含 V/X）。
- `heights` → `zs` 量化逻辑（:90-96）不动；**只在其后加「水/岩浆/裂隙低位修正」**（§3.7）。
- `fillWall` 签名扩展：`fillWall(data,..., ch, xa, xb, face)` 加一个 `face` 参数（'south'/'east'），不破坏调用关系。
- 2D 路径（render/tiles/terrain/mapgen）**零改动**；T1-T5 与 golden 基线不涉及 2.5D（tests/run.mjs 仅 T1-T5，2.5D 无字节回归约束，守卫是"2D 路径逐字节不变"）。[事实，high]

### 3.7 全图层协调规则（水/路/植被/道路在 2.5D 高度的定位）

| 元素 | 高度角色 | 规则 | 现状问题 | 修复 |
|---|---|---|---|---|
| **水 ~/U/A**、**岩浆 L**、**裂隙 Y**、**泥滩 @** | **低位（贴地底）** | 永远低于邻域地面 | **bug**：`mapgen.js` 盖章不改 hh → 高地河道/熔岩/裂隙被抬升（§1.4） | 渲染侧修正：`z = min(0, 邻域地面 z - 1)`，见下 |
| **道路 R** | **贴地（随地形）** | R 格 z 随地形；坡上道路=阶梯状（16px 可接受） | 正确（R 格 heights 来自地形） | 无需改；陡坡处可选把 R 归 LIP 唇边 |
| **植被 H/Z、覆盖物** | **在顶面** | 随格抬升（在顶面纹理内） | 正确 | 无需改；3D 树精灵属 Phase C/D（超出本次范围） |
| **崖壁（地形侧面）** | **侧面** | 壁=高格朝低格的横截面 | 已画但无剖面语言 | §3.1-3.5 |
| **水下壁基** | **侧面（水下段）** | 高格邻低格为水时，壁底 1-2px 换偏蓝暗色（复用 2D 水下崖基逻辑 render.js:172） | 未实现 | P2：`mix(base,[40,70,110],0.35)` |

**水/岩浆/裂隙低位修正伪代码**（放 `buildMapCache25D` 量化 `zs` 之后、painter 之前）：

```js
const LOW = { '~':1, 'U':1, 'A':1, 'L':1, 'Y':1, '@':1 };   // 低位要素
const grid2 = m.grid;
for (let y=0;y<h;y++) for (let x=0;x<w;x++){
  const c = grid2[y][x]; if (!LOW[c]) continue;
  let floorZ = 9e9, hasLand = false;
  for (const [dy,dx] of [[-1,0],[1,0],[0,-1],[0,1],[1,1],[-1,1],[1,-1],[-1,-1]]){
    const ny=y+dy,nx=x+dx; if (ny<0||ny>=h||nx<0||nx>=w) continue;
    if (!LOW[grid2[ny][nx]]) { hasLand = true; floorZ = Math.min(floorZ, zs[ny*w+nx]); }
  }
  if (hasLand) zs[y*w+x] = Math.max(0, floorZ - 1);   // 压到邻域地面之下 1 层
}
```

- 海岸线海洋：邻域无地面 → 不修正，保持自然低值；湖心/河道：压到岸线下 1 层；裂隙/熔岩沟：压到两侧地面下 1 层 → 「深渊/熔岩沟」的下凹语义成立。
- 该修正**只影响 2.5D 渲染**，不写回 mapgen、不改 grid/heights 数据（防腐层铁律：view25d 只读消费）。[设计，high]

---

## 4. 实现路径：改动文件清单 + 伪代码级算法 + 优先级

### 4.1 改动面

| 文件 | 改动 | 规模 |
|---|---|---|
| **`src/view25d.js`** | ① `fillWall` v2（材质类 + 四段式 + 方向光照）；② 最终 pass（顶缘亮线 + 壁基 AO + LIP 阈值）；③ 水/岩浆/裂隙低位修正；④ 可选 P2 项 | **+~110-140 行，全部新增/替换本文件内部** |
| `src/mapgen.js` / `terrain.js` / `tiles.js` / `render.js` / `main.js` / `index.html` | **零改动**（防腐层：2.5D 只读消费；UI 无新控件） | — |
| `tests/` | 可选新增 T6（2.5D smoke：尺寸/全格覆盖/壁色含多段/低位修正断言）；2D 回归 T1-T5 原样 | +1 用例 |

### 4.2 fillWall v2 伪代码（替换 view25d.js:61-80 的核心循环）

```js
const CLASS = {};              // §3.2 映射（soil/rock/snow/ice/water/lava）
const P = 4;                   // 层理周期（px）
function wallColorAt(ch, px, py, X0, Y0, fromTop, Δ, face){
  const base = baseColor(ch); let c = base;
  const cls = CLASS[ch] || 'soil';
  /* ① 材质剖面 */
  if (cls==='soil') c = mix(c, warmDesat(base,0.35), 0.55);
  else if (cls==='snow') c = mix(c,[176,196,214],0.45);
  else if (cls==='ice') c = mix(c,[168,204,224],0.40);
  /* ② 深度渐变 + 方向光照 */
  let k = 0.78 - fromTop*0.26;
  if (face==='east') k *= 0.86;
  /* ③ 顶帽 */
  const capW = (cls==='soil'?2:cls==='snow'?2:1) / Δ;
  if (fromTop < capW){
    if (cls==='soil') c = mix(base,[86,58,38],0.72);
    else if (cls==='snow') c = [210,220,232];
    else c = mix(c,[0,0,0],0.22);
  } else {
    /* ④ 层理分带（每壁相位=hash2(X0,Y0,211)*P，周期 P，带界深线） */
    const d = fromTop*Δ + hash2(X0,Y0,211)*P;
    const band = (d/P)|0;
    k *= (band&1) ? 1.06 : 0.94;
    if ((d%P) < 1) k *= 0.84;
  }
  /* ⑤ 底部碎石（talus，密度按类） */
  const screeTop = 1 - Math.min(4,Δ)/Δ;
  if (fromTop > screeTop && hash2(px,py,151) < (cls==='rock'?0.30:cls==='soil'?0.16:0.10))
    k *= 0.75 + hash2(px,py,71)*0.55;
  /* ⑥ 底部 AO */
  if (fromTop > 1 - 2/Δ) k *= 0.62;
  /* ⑦ 稀疏微噪声（替代现状整面噪声） */
  if (hash2(px,py,91) < 0.16) k *= 0.92 + hash2(px,py,73)*0.20;
  return [Math.min(255,c[0]*k|0), Math.min(255,c[1]*k|0), Math.min(255,c[2]*k|0)];
}
```

### 4.3 最终 pass 伪代码（Rim + AO + LIP，追加在 buildMapCache25D 末尾）

```js
/* 追加在顶面/壁全部画完、putImageData 之前（操作同一 data buffer） */
const LIP = 2;
for (let y=0;y<h;y++) for (let x=0;x<w;x++){
  const idx = y*w+x, z = zs[idx];
  const south = y+1<h ? z-zs[idx+w] : 0;
  const east  = x+1<w ? z-zs[idx+1] : 0;
  if (south>=LIP) rimAO(data,..., X0,Y0, south*STEP*S, 'south', effT(m,x,y), Δ, 1);
  if (east>=LIP)  rimAO(data,..., X0,Y0, east*STEP*S,  'east',  effT(m,x,y), Δ, 0);
}
// rimAO: 沿壁顶缘 1px 亮线（mix(base,白,0.35)）；沿壁底缘 1px 深线
//        alpha_ao = min(0.5, 0.32 + (Δ/STEP-1)*0.06)  ← 越高越深（Roll20）
```

### 4.4 优先级

| 优先级 | 项 | 理由 |
|---|---|---|
| **P0** | 水/岩浆/裂隙低位修正（§3.7） | 正确性 bug：河道/熔岩/深渊被抬升是"错"，不是"丑" |
| **P1** | `fillWall` v2 材质类 + 四段式 + 方向光照（§3.1-3.2,3.5） | 直接命中"土山/石山崖壁纹理"与"高度差效果不强" |
| **P1** | 最终 pass 顶缘亮线 + 壁基 AO + LIP 唇边阈值（§3.3-3.4） | 命中"细节不协调"——统一边缘语言 + 消除波纹噪声 |
| P2 | 水下壁基蓝调、hypsometric 冷化、雪斑/裂缝细化、Z_STEPS 调参（§3.5,3.7） | 锦上添花，视觉验收后按需 |

### 4.5 验收建议

- 视觉验收场景：翡翠大陆（山脊 chasm + 高地 bumps）、末日裂谷（熔岩沟 + 深渊裂隙）、群岛迷宫（多段海岸高低差）、极地冻原（雪峰壁）。检查：① 土山壁=褐土分带、石山壁=冷岩层理、雪壁=冰蓝；② 大落差有顶缘亮线 + 底 AO、小落差只有唇边；③ 河/湖/岩浆/裂隙不再被抬升；④ 2D 模式渲染与改动前逐字节一致（T1-T5 仍绿，golden 基线不动）。
- 工具：现有 `spark-e2e` / `ui-review` 技能可做 VLM 视觉核对（本任务只研究，不实施）。

---

## 5. 置信度汇总

| 结论 | 置信度 | 依据 |
|---|---|---|
| `fillWall` = 单一基色渐变 0.62→0.48 + 整面 hash 噪声 | high | `view25d.js:71-72` 公式直接可算 |
| `ROCKY`（view25d.js:17）声明但 fillWall 未引用 | high | grep 全文仅 1 处声明 |
| 南/东壁同式同色、无方向光照 | high | `view25d.js:140-141` 同参数调用 |
| 顶行/底行会被子格顶面覆盖 → Rim/AO 必须放最终 pass | high | painter 顺序（`view25d.js:132-154`）+ 代数推导 |
| 水/岩浆/裂隙盖章不改 hhField → 2.5D 抬升 bug | high | `mapgen.js:68,71,74,81,97` + `view25d.js:92-96` |
| IE 预渲染背景 + height/search/shadow map + Y 基线遮挡 | high | 多源（References §2.1） |
| D2 trimetric 26.565° + 180×60 瓦片 + 透视 hack + DS1 预设 | high | gamedev SE / d2mods / median-xl / Atlas-Chart-PCG |
| PoE 批评平地割裂 + BG2 Umar Hills 为深度标杆 | high | Obsidian 艺术反馈帖原文 |
| 仙剑1 手标遮挡层 / 金庸 锚点+海拔遮挡 / 天之痕水墨层间 | high/medium | 知乎 / 铁血丹心 / sina 等（中文一手帖） |
| FF6/CT 预渲染 3D 背景 + 3-4 级色阶 | medium | neo-geo SGI 工作流帖（含 Polygon 引用）；色阶惯例为通用像素美术 |
| 「顶帽/岩层/碎石/AO + 南亮东暗」能让壁"协调一致" | medium | 社区惯例 + 材质剖面推导；需实改后 VLM 视觉验收 |
| LIP 阈值（dz==1 唇边 / dz≥2 崖壁）消除波纹 | medium | 2D 已落地同款双态 + Godot/Unity 社区共识；需视觉确认 |
| 神界：原罪 / 废土 2/3 美术细节 | low / 未找到一手资料 | 无一手 URL，仅共性推断 |

---

## References

**项目代码/文档**
- `src/view25d.js:13-17,42-80,84-158`（ISO_W/H、STEP/Z_STEPS、ROCKY 未用、baseColor、effT、fillWall 单色渐变、buildMapCache25D painter 顺序）
- `src/mapgen.js:9-24,64-81,97,99-113,114-128,233-245`（hhField、盖章不改 heights、carveChasm/carveRiverPoly、genDungeon 显式低位）
- `src/render.js:16,30-52,53-116,118-191`（ROCKY、drawLip/drawCliff、Phase2 浮雕、buildMapCache 唇边/断面条先例）
- `src/terrain.js:186-214`（TERRAIN 26 种、elev、PALETTE_ORDER）
- `src/tiles.js`（签名缓存/过渡，防腐层铁律）、`tests/run.mjs`（T1-T5，2.5D 无字节回归约束）
- 既有文档：`docs/2_5d-architecture.md`（斜角推荐、逐模块分叉、防腐层）、`docs/terrain-height-research.md`（旧课题 A+B，git `fd903cc`）、`docs/transition-tiles-research.md`、`docs/road-path-tiles-research.md`、`docs/ARCHITECTURE.md`（ADR-2）

**Infinity Engine 系**
- IE 特性页（isometric view、3D height maps、luminosity/search maps、预渲染背景）— https://gamespy-archives.quaddicted.com/sites/www.planetbaldursgate.com/bg/info/features/index.html
- Infinity Engine — Wikipedia — https://en.wikipedia.org/wiki/Infinity_Engine
- IE 图形机制论坛帖（背景平铺、search map 遮挡、Y 基线、脚部基线）— https://www.gamedev.net/forums/topic.asp?topic_id=540048
- GemRB 引擎概览（Game Engine Made with preRendered Backgrounds）— https://github.com/gemrb/gemrb.github.io/blob/master/Engine-overview.md
- Beamdog Infinity Engine Maps WIP（3D→Photoshop→2D 工作流、外景实拍素材）— https://forums.beamdog.com/discussion/comment/948852/#Comment_948852
- BGEE「如何做区域」讨论（预渲染 3D + 手绘、可见低模轮廓）— https://steamcommunity.com/app/228280/discussions/0/1813170373221936814?l=schinese&ctp=2
- Unity 论坛「2D vs 3D isometric RPG 复杂度」（IE 预渲染 + heightmap/searchmap/lightmap + alpha 遮挡）— https://discussions.unity.com/t/2d-vs-3d-graphics-complexity-isometric-rpg/547127/6
- BG 地形贴图恢复讨论（背景由 3D 渲染、纹理从游戏内切取）— https://www.gibberlings3.net/forums/topic/38346-baldurs-gate-textures-for-your-3d-renders/

**暗黑破坏神 2**
- 2.5D 视角角度问答（D2 trimetric 26.565°、2:1、透视 hack）— https://gamedev.stackexchange.com/questions/47156/what-is-the-view-perspective-angle-of-most-2-5d-isometric-games
- d2mods「动画是否半等距」帖（180×60 瓦片、30° 倾斜）— https://d2mods.info/forum/viewtopic.php?p=214791&t=30105
- D2 关卡生成问答（DS1 预设、lvlprest.txt、墙/檐/地板、房间+迷宫）— https://forum.median-xl.com/viewtopic.php?p=95323
- Atlas-Chart-PCG（D2 式房间+迷宫 + 标记 + 表现层）— https://github.com/AK-Saigyouji/Atlas-Chart-PCG

**永恒之柱 / 神界 / 废土**
- PoE 艺术反馈帖（平地"怪"、Umar Hills 深度标杆、"通过背景纹理设计制造高度错觉"）— https://forums.obsidian.net/topic/70886-art-feedback-thread/page/2/#comment-1580627
- 神界：原罪 / 废土 2/3：**未检索到地形高低差美术一手资料**（不臆测，§2.4 说明）

**中文斜视角 RPG**
- 仙剑 1 等距菱形图块 + 手工标注前后遮挡（答谢谢崇辉/郑任宏/林珈汶）— https://www.zhihu.com/question/630177419/answer/3346841038
- 金庸群侠传等距地图美工教程（贴图锚点=外接矩形左下角、海拔用于遮挡判断、图层合并）— https://tiexuedanxin.net/forum.php?mod=viewthread&tid=383846&page=1&authorid=293075
- 天之痕主美专访（水墨山岛"朱描墨染"、2D 场景还原）— https://games.sina.cn/gn/we/2015-07-22/detail-ifxfaswi4189677.d.html
- 天之痕美术回顾（水墨层间、仙山岛）— https://egameinsider.com/p/6x7rm683987b/ 、 https://www.wegame.com.cn/platform/article/detail.html?feedsid=9dd62cb7a85f49e7a228114b3d9c7118

**SNES/PS JRPG**
- SGI 工作站预渲染背景工作流（FF6 3D demo、pre-rendered 背景 + 多边形角色、含 Polygon FF7 口述史）— https://neo-geo.com/forums/index.php?threads/silicon-graphics-workstations-development-workflow.253593/

**技术参照（程序化转译支撑）**
- Godot「Tilemap 第三高度维度」讨论（分层 TileMap 垂直偏移、坡片 bitmask、邻差≥2 出洞需坡化预处理）— https://forum.godotengine.org/t/tilemap-with-3rd-height-dimension/111583 、 https://github.com/godotengine/godot-proposals/discussions/8196 、 https://github.com/PetePete1984/SuperTilemap
- Unity 等距瓦片手册（Z Position Editor、分层、排序）— https://docs.unity3d.com/cn/2021.2/Manual/Tilemap-Isometric.html
- 等距 vs 斜角/二轴测定义（oblique 90° 判定、2:1、经典游戏表）— https://en.wikipedia.org/wiki/Isometric_video_game_graphics
- 高度/深度视觉：阴影梯度（每 5 英尺一档暗度、越低越暗、檐口投影）— https://app.roll20.net/forum/post/4560007/techniques-question-heights-slash-depths
- 像素岩体基础（暗角、单侧阴影、不规则高光、限色盘）— http://www.byond.com/forum/post/30339
- RPG Maker A4 悬崖/autotile 机制（cliff 归墙壁槽、顶行草皮+土帽）— 旧调研已引：https://forums.rpgmakerweb.com/threads/i-think-im-missing-something-fundamental-a4-cliffs-paths-autotile.167134/
- Hypsometric 海拔着色（蓝→绿→棕→白）— 旧调研已引：https://web.archive.org/web/20160805144338/https://en.wikipedia.org/wiki/Hypsometric_tints

*本文未修改任何源码与既有文档；唯一交付物为本调研文档。实现路径均标注文件与行号，供后续实现任务直接使用。*
