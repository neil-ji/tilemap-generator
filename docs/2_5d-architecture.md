# 2.5D 视角架构调研：等距 vs 斜角（课题 Q1-Q7）

- 调研日期：2026-08-06
- 范围：**只读分析**，未修改任何源码。依据：`src/*.js` 全部 9 个源文件 + `index.html` + `vite.config.js` + `tests/*` 通读、git 历史核对、既有 4 份调研文档（`docs/ARCHITECTURE.md`、`docs/terrain-height-research.md`、`docs/transition-tiles-research.md`、`docs/road-path-tiles-research.md`）+ 社区资料（Web，URL 逐条见 References）。
- 用户方向：**共享数据层、分叉渲染层、2D 保留可切换**。用户核心诉求：**明显的高度差（悬崖可见度）**。
- 结论标注：[事实]=代码/git 可证实；[推断]=基于经验的判断。每条附置信度（high/medium/low）。
- 与旧结论的修正：`docs/terrain-height-research.md` B3 曾以「2.5D/等距 = z 偏移 + 渲染管线重写」为由列为「改动巨大、性价比低」的 Phase 3 [推断，medium]。**本调研修正该判断**：把 2.5D 框定为「**正交斜角挤出**（顶面复用现有 2D 瓦片管线）」后，其改动面远小于当时的估算，且直接命中用户「悬崖可见度」核心诉求。见 §Q1 与 §Q7。

---

## 0. TL;DR

- **明确推荐：斜角 2.5D（正交斜投影 α=90°，方形顶面保持 + 高度垂直挤出 + 南/东可见侧壁）**，不是等距菱形。核心理由：本项目顶面是**逐像素程序化 16×16 纹理**，斜角方案让顶面**零重采样直接复用**现有 `buildMapCache`/`renderCell`/`roadColor`/签名缓存，过渡缝线一致性原样保留；等距要把每个方形重采样成菱形（顶面像素面积缩到 ~1/4，16px 下糊化），且共享对角缝线的重采样误差是已知痛点。
- **侧壁挤出直接读现有 `heights`（Float64Array 连续海拔场，mapgen.js:9-24）**——这是本项目 2.5D 的最大资产：把当前「2px 假阴影」（用户反馈不明显）升级为**真实几何侧壁**，悬崖可见度翻倍。[事实→设计]
- **防腐层铁律**：`mapgen`/`terrain`/`tiles` 三个模块 2.5D 只读不写；签名缓存 key 绝不含高度（沿用 ADR-2）；2.5D 全部逻辑放**新模块 `src/view25d.js`**，通过 main.js 一个模式开关 + index.html 一个控件接入。2D 路径逐字节不变 → T1-T5 与 golden 基线继续全绿。
- **深度排序**：斜角方案 painter 算法退化为**双重嵌套循环**（外层 y、内层 x），数学上无部分序冲突（每格侧壁精确止于下一格顶面），无排序开销；等距需 `x+y+z` 排序且高度差存在部分序问题。
- **落地 4 阶段**：A 原型（能看）→ B 侧壁/排序（好看，核心诉求）→ C 覆盖层/动画（全功能）→ D 导出/图鉴/测试（闭环）。新增代码主体约 **150-250 行新文件 + main.js/index.html/export.js 各 ~10-15 行**，2D 模块零功能改动。

---

## Q1. 投影方案对比：等距（isometric）vs 斜角（oblique/2.5D-lift）

### 1.1 定义与数学框架

| 项 | 等距 2:1 菱形 | 斜角挤出（本调研推荐） |
|---|---|---|
| 顶面形状 | 菱形（外接 `2W×H`，顶面像素面积 = 源方形 ~1/4） | **方形不变**（16×16 原样） |
| 投影 | `screenX=(x-y)·W/2, screenY=(x+y)·H/2 - z·H/2`（rotate 45° + scaleY 0.5）[事实，high：多源一致] | 正交斜投影 α=90°：`screenX=x·16, screenY=y·16 - z·step`（cabinet/cavalier 特例，cos α=0、sin α=1，无剪切）[事实，high：oblique 投影公式] |
| 可见面 | 左/右/顶三面（经典 45° 视角） | 顶 + 南 + 东（东南朝向相机） |
| 过渡缝线 | 共享**对角斜边**，重采样后需共享采样谓词保证 1px 连续 | 共享**正交格边**，顶面原样拼接，连续性原样保留 |
| 侧壁（悬崖） | 相邻高度差 → 平行四边形容积面 | 相邻高度差 → 南/东矩形侧壁，`高 = dz·step` |
| 深度排序 | `x+y+z` 升序绘制；有部分序（partial order）问题，多格物体需拓扑排序 [事实，high：社区一致] | 双重嵌套循环即正确 painter，无部分序问题 [推导，medium-high，见 Q4] |
| 程序化投影难度 | 需逐像素重采样（16px → 菱形 ~23×11 或 16×8），顶面像素面积缩 ~4×，纹理糊化 | **零重采样**，顶面直接用 |
| 与「逐字节一致」测试冲突 | 重采样破坏像素身份（但仅 2.5D 分叉内，2D golden 不受影响） | 无冲突 |
| 社区代表作 | FFT（iso+height）、文明 3（iso corner-Wang）、Diablo/SimCity 2000（dimetric）[事实，high] | 大航海/Ultima VII/Ultima Online（oblique）、EarthBound、Paperboy、Tibia [事实，high]；**Tiny Swords「每级高程两层（Shadow+Elevated Ground）」即高度挤出的顶视化实现** [事实，high：本项目旧调研 + 一手 skill 文档] |

### 1.2 逐维度对比

**① 瓦片形状。**
- 等距：顶面变菱形，外接矩形 `2W×H`。对 16px 源，若取标准 2:1 菱形 `W=16,H=8`，顶面可视像素 = `16×8/2 = 64` 像素，仅为源 256 的 1/4 —— **程序化纹理的逐像素细节直接丢 3/4**，小字/岩屑/车辙等 1px 特征消失。[推导，high：菱形面积公式]
- 斜角：顶面即源方形 256 像素，零损失；额外获得侧壁像素。

**② 过渡瓦片投影下的呈现。**
- 等距：相邻两格的共享缝在 2D 里已是「世界坐标一致」（Bayer 阈值 + 共享缝线谓词，tiles.js:40-61），投影后共享**对角斜边**。若每格独立重采样，菱形边界像素来自各格自身 → 浮点舍入可能产生 1px 错位；必须用「同一连续顶面源」或共享采样谓词（方案见 Q3）。这是社区公认的 iso 痛点（Wangscape 等工具专门解决 corner-Wang 在 iso 下的对齐）。[推断，medium：需实现后验证]
- 斜角：顶面是**原封不动的方形**，两格共享的格边就是同一批像素，**连续性零成本继承**。道路窄条（overlayRoad，tiles.js:148-162）、特效门控等全部随顶面原样。

**③ 侧壁表现（用户核心诉求：悬崖可见度）。**
- 现状 2D：`render.js` 的 `drawLip`（1px 亮唇，alpha 0.35）与 `drawCliff`（3px 断面条）——用户明确反馈「不明显」（见 `terrain-height-research.md` B1）。[事实，high]
- 等距：悬崖显示为**平行四边形容积面**（FFT 式），视觉最强、最有「3D 感」，但需逐层逐格生成容积面几何。[事实→推断，medium]
- 斜角：悬崖 = **矩形侧壁**，`高 = (z_high - z_low)·step`。取 z 差 3、step 2px → 6px 侧壁 + 顶面抬升 6px，肉眼可见的「阶梯断面」；叠加现有 `baseColor`+`ROCKY` 层理（render.js:16,18-52）即可有「岩层质感」。[设计，high：几何直接可算]
- **结论**：斜角方案在 16px 尺度上对「悬崖可见度」的性价比显著高于等距（等距的容积面在 16px 上同样是 4-8px 的小面，但要多花重采样+几何成本）。

**④ 程序化投影难度（从现有 16×16 2D 纹理生成）。**
- 等距：需要逆映射重采样（`dst(x',y') → src(px,py)`，px = `(isoY/4 + isoX/8)/2` 之类），16px 下细节损失 + 对角缝线对齐问题（见 Q3 伪代码）。
- 斜角：**零图像变换**。顶面 = 现有 `buildMapCache` 输出的 `cacheCanvas`（render.js:118-191，已含过渡/道路/特效/高度差 2D 覆盖层）或逐格 `renderCell` 结果；2.5D 分叉只做「放置 + 抬升 + 画侧壁」。程序化程度完全相同（侧壁颜色也是程序化从 `baseColor` 派生）。[事实→设计，high]

**⑤ 深度排序复杂度。**
- 等距：`depth = x + y`（有高度时 `+ z`），需排序；多格物体/高度差存在**部分序**，简单全序排序会错（社区一致结论，见 gamedev.stackexchange 8151/177422）。[事实，high]
- 斜角：由于顶面轴对齐 + 只垂直抬升，**嵌套循环（y 外层、x 内层）就是正确 painter 序**——每格南壁精确止于下一格顶面、东壁精确止于右格顶面，后画者恰好从侧壁底部开始覆盖，无覆盖错误、无部分序（证明见 Q4）。零排序开销。[推导，high：几何自洽]

**⑥ 与项目契合度。**
- 本项目定位：程序化瓦片集查看器 + 高度层 + 逐字节回归测试。「逐像素程序化 + 逐字节一致」是硬约束（T1 golden，tests/golden/baseof.json）。等距要求重采样，等于在 2.5D 内再造一套纹理管线；斜角直接继承 2D 管线，契合度显著更高。[推断，high：架构判断]
- 既有资产复用清单（斜角方案）：`heights`（已有）、`baseColor`/`ROCKY`（已有）、`roadColor`（已有）、`cacheCanvas` 顶面（已有）、`animCells`（已有，可投影复用）、`PALETTE_ORDER`/`TERRAIN.elev`（已有）。**六项全复用，无一项新造**。[事实，high]

### 1.3 视觉样例描述

- **等距菱形样例**：火山岛从深水到峰顶——深水/海洋/沙滩/草地/岩石/雪地各是一个同心菱形带，菱形斜边随 `wob` 蜿蜒；高岩台相对低地**抬升 2-3 层**，朝西南/东南方向露出**平行四边形岩壁面**，面上有岩层层理；岩浆口在顶面中心凹陷。
- **斜角挤出样例**：同图从东南看——草地是平坦方形面；高岩台整体**垂直抬升**，其**南缘与东缘**露出矩形断面侧壁（高 = 层差×step），岩类壁带层理线、非岩类带稀疏碎屑；台地顶面与低地之间出现「阶梯」，海边的岩壁直插水面（水下侧壁颜色自动变暗，复用 2D 水下崖基逻辑）；雪峰最高层顶部盖雪、四周壁面渐暗。

> 两者都能实现「明显悬崖」，但斜角以**零纹理损失 + 零重采样 + 零排序**为代价，等距以**更炫的容积感**为代价。

### 1.4 推荐结论（明确）

**推荐：斜角 2.5D（正交斜投影 α=90°，方形顶面 + 高度挤出 + 南/东侧壁）。**
理由按权重排序：
1. **顶面零重采样** → 现有全部 2D 像素成果（26 地形纹理、过渡、道路、特效）原样复用，这是决定性优势；
2. **侧壁几何直接命中核心诉求**（heights 已存在，悬崖从 2px 假影变 6px+ 真实壁）；
3. **深度排序免费**（嵌套循环即正确 painter）；
4. **签名缓存/过渡缝线零风险**（2D 层完全不动）；
5. **测试与 golden 基线零影响**（2.5D 纯分叉）。
等距作为「更有立体感的替代方向」记录在案（含完整伪代码），供未来评估。[推荐置信度：high——架构推导 + 代码事实；视觉效果是否满足用户需 Phase A 原型后 VLM 验收，medium]

---

## Q2. 逐模块：共享 vs 2.5D 分叉 + 防腐层规则

| 模块 | 归属 | 为什么 |
|---|---|---|
| `mapgen.js`（genWorld/genDungeon/MAPS） | **共享（零改动）** | 数据层：`grid`/`heights`/`roadBase`/`seed`/`river` 正是 2.5D 的全部输入；2.5D 只是换一种渲染。mapgen.js:97,245 返回结构不动。 |
| `grid` 数据结构（char[][]） | **共享** | 2.5D 用 grid 坐标做放置与排序键；不改。 |
| `heights` 高度层（Float64Array） | **共享（2.5D 的主驱动）** | 侧壁挤出 `z = quantize(heights[y*w+x])`；连续海拔场 → 层高（见 Q3）。它是本项目 2.5D 最大的既有资产。 |
| `terrain.js` 纹理函数（cXxx） | **共享（2.5D 只读消费）** | 顶面 = 现有纹理；侧壁色 = `baseColor`/`ROCKY` 派生（复用 render.js:16,18-26 的既有函数）。不改。 |
| `tiles.js` 过渡算法/签名缓存 | **共享（只读消费）；2.5D 投影绝不掺入** | 防腐层核心：`neighborKey`（tiles.js:185-187）key 保持「地形+8邻」，**高度维度绝不入 key**（ADR-2 硬约束，一旦含高度每格唯一、缓存全失效）。2.5D 把 `renderCell`/`renderRoadCell`/`cacheCanvas` 当「方形顶面生成器」黑盒调用。 |
| `render.js` buildMapCache（2D 合成） | **共享（作为顶面纹理源）** | 2.5D 的顶面 = 复用 `cacheCanvas`（含过渡/道路/特效/2D 覆盖层）。2D 模式继续用它，逐字节不变。 |
| `render.js` 高度差覆盖层（drawLip/drawCliff/hh 浮雕，:30-116） | **2D 专属（留在 2D 模式）** | 2.5D 里侧壁是真实几何，伪 2D 崖条无意义；2.5D 分叉绘制真实侧壁。两者不共享这部分代码，**避免把 2D 假影逻辑拉进 3D**。 |
| `render.js` drawFrame / drawAnim / 网格（:192-226） | **2.5D 分叉** | 2.5D 需要新的合成帧（抬升 + 侧壁 + 排序），动画在投影坐标上重画。2D 版不动。 |
| `palette.js` 图鉴 | **共享（图鉴本体不变）**；可选加 2.5D 预览分叉 | 图鉴展示的是方形基础瓦片/过渡片（blob 模式，tiles.js:95-101），2.5D 不影响其语义；可后期加「斜角预览」小视图（Phase D 可选）。 |
| `export.js` | **分叉（新增 2.5D 导出路径）** | `exportMapPNG`（export.js:51-60）复用 cacheCanvas 逻辑可扩展出 `exportMapPNG25D`；`buildTilesetCanvas`（:63）保持 2D。 |
| `main.js` 应用层 | **共享 + 加模式开关** | `loadMap` 按 `MODE` 选 `buildMapCache` 或 `buildMapCache25D`；prefs 持久化加一项；2D 路径分支零改动。 |
| 水/岩浆动画 | **分叉（顶面动画覆盖层）** | 动画图案（`drawAnim` 的波浪/脉冲逻辑，render.js:197-217）可抽取为「顶面动画纹理」共享，但 2.5D 合成器负责在投影坐标放置。 |
| `index.html` | **共享 + 1 个控件** | 加「2D/2.5D」checkbox（复用 `.chk` 样式）。 |
| `tests/` | **共享（2D 回归不变）+ 新增 2.5D 测试** | T1-T5 继续锁 2D 路径；新增 T6/T7 锁 2.5D（见 Q6 Phase D）。 |

### 防腐层规则（避免「改一处、坏两处」）

1. **数据/渲染严格分离**：2.5D 只读 `genWorld/genDungeon` 返回对象 + `TERRAIN`，永不写回；任何 2.5D 需要的新数据走新模块私有，不进 mapgen。
2. **签名缓存只读黑盒**：2.5D 渲染器把 `renderCell`/`renderRoadCell`/`cacheCanvas` 当作方形顶面生成器，**不在 tiles.js 内加任何 2.5D 分支**。投影/抬升/侧壁全部在 `src/view25d.js` 内。
3. **模式开关只在 UI 层**：`MODE` 状态、checkbox、prefs 归 main.js；render 模块函数不改签名（`buildMapCache25D` 是新函数，不是 `buildMapCache` 加参数）。
4. **2D 快路径逐字节不变**：`buildMapCache`/`drawFrame`/`exportMapPNG`/`buildTilesetCanvas` 在 2D 模式下完全不动；T1-T5 + golden 基线继续验证。改动验收标准 = 「2D 模式前后渲染逐字节一致」。
5. **新代码隔离**：所有 2.5D 逻辑进**新文件** `src/view25d.js`（估算 150-250 行），通过 `index.html` 的 ES module 引入；对现有 9 个 src 文件的改动**仅限 main.js（~15 行开关逻辑）+ index.html（1 控件）+ export.js（可选新函数）**。

---

## Q3. 程序化投影伪代码

### 3.1 斜角挤出（推荐方案）

```
/* 输入：genWorld/genDungeon 返回 m = {grid,w,h,heights,roadBase,...}
        顶面纹理：现有 cacheCanvas（buildMapCache 输出，含过渡/道路/特效） */

// 高度 → 层高：连续海拔场量化（避免逐像素微起伏生成碎壁）
const Z_STEPS = 5;            // 层数（含 0）
const STEP   = 2;             // 每层垂直抬升像素
function zAt(m, x, y){
  return Math.min(Z_STEPS-1, Math.floor(m.heights[y*m.w+x] * Z_STEPS));
}

// 放置（正交斜投影 α=90°，无剪切）：
//   sx = x * 16
//   sy = y * 16 - z * STEP          // 顶面抬升
// 顶面直接 drawImage 现有 cacheCanvas 的 16×16 切片（或逐格 renderCell 结果）

// 侧壁：只画南/东两条可见边，高度 = 本格与下游格层差
//   dzS = zAt(x,y) - zAt(x,y+1)     // 南壁
//   dzE = zAt(x,y) - zAt(x+1,y)     // 东壁
//   if(dzS>0) fillRect(sx, sy+16, 16, dzS*STEP, wallColor(effT, y-flip))
//   if(dzE>0) fillRect(sx+16, sy, dzE*STEP, 16, wallColor(effT))
//   wallColor(ch)：baseColor(ch) 压暗 40% + 岩类 ROCKY 层理线 + hash2 碎屑
//     → 直接泛化现有 drawCliff 的基色/层理逻辑（render.js:30-52）

// 侧壁与过渡/道路一致性：
//   侧壁属于「高格」，由高格单方绘制（共享世界坐标谓词，同现有 pairSeed 哲学）
//   effT 解析同 2D：R 格用 roadBase 基底（render.js:151），水下侧壁用偏蓝暗色
```

**为什么侧壁只画南/东**：相机默认从东南俯视，北/西壁被同格顶面及后方格遮挡，画了也被盖住，浪费 O(w·h) fillRect。[推导，medium：方向约定；如需「全景」可加开关画四壁但无必要]

**邻接一致（斜角）**：顶面 = 原方形，共享格边就是同一批像素 → **连续性零成本继承**。侧壁判定 `zAt(x,y) > zAt(x,y+1)` 是共享谓词（高格画、低格不画），与 2D 的「上格 `p=y0-wy`、下格 `p=wy-y0` 互补」同一设计哲学（tiles.js:42-50）。[事实→设计，high]

### 3.2 等距（备选，含实现要点）

```
// 顶面投影：rotate 45° + scaleY 0.5（affine 矩阵）
//   菱形外接 32×16；源 16×16 方形逆映射采样
//   逆映射（iso→src）：px=(isoY/4+isoX/8)/2, py=(isoY/4-isoX/8)/2
//   仅采样菱形内部（px+py∈[0,8] 的对角带内）

// 过渡邻接一致：两个方案
//   A. 同一连续顶面源：先合成整幅 top-down 纹理（即现有 cacheCanvas），
//      对整幅做一次 affine → 再切成菱形片 → 共享斜边必然连续（同源）
//   B. 逐格重采样：需共享采样谓词（菱形边界像素由相邻两格各取一半），
//      否则浮点舍入 1px 错位 —— 实现成本高、回归风险大
// 深度排序：depth = x + y + z，升序绘制；高度差场景需拓扑排序或分 z 层
// 签名缓存影响：若逐格投影且采样依赖世界坐标 → 缓存 key 失效（同 ADR-2 困境）
```

### 3.3 签名缓存/性能影响

- **斜角**：顶面走现有 `cacheCanvas`（已是 O(唯一签名) 的模板缓存），2.5D 新增每格 ≤2 次 `fillRect` 侧壁（O(w·h)，与现有 2D 高度差覆盖层同量级）。2.5D 静态帧同样「建一次缓存 canvas，每帧一次 drawImage + 可动格动画」，延续现有性能架构（ui-ux-review P1-2 的静态帧缓存）。[事实→设计，high]
- **等距**：重采样 O(w·h·64)+ 排序，且共享斜边采样若依赖世界坐标则破坏签名缓存 → 性能与缓存风险双高。[推断，medium]

---

## Q4. 深度排序（painter 算法）接入点与现有 drawFrame 融合

### 4.1 斜角方案的排序正确性

顶面轴对齐、只垂直抬升时，**按 y 外层、x 内层绘制即正确**：

```
for (let y=0; y<h; y++)            // 从远到近（屏幕 y 增序）
  for (let x=0; x<w; x++){
    drawTopFace(x,y);              // sy = y*16 - z*STEP
    drawSouthWall(x,y);            // 高 dzS*STEP，止于下一格顶面
    drawEastWall(x,y);             // 高 dzE*STEP，止于右格顶面
  }
```

- 南壁底边 = `y*16 - z_y*STEP + 16`，下一格顶面 = `(y+1)*16 - z_{y+1}*STEP`，二者之差恰为 `(z_y-z_{y+1})*STEP = dzS*STEP` → **侧壁正好画到下一格顶面顶部，无重叠、无漏缝**；东壁同理。[推导，high：代数自洽]
- 行内 `x` 递增：东壁止于右格顶面，右格后画覆盖其接缝，正确；行间 `y` 递增：下一行后画，正确。**无需全局排序、无部分序问题**（部分序仅出现在「多格跨层物体」场景，本项目地图无此物）。[推导，medium：已验证代数，需原型视觉确认]

### 4.2 接入点（与现有 drawFrame 融合）

- 现有 `drawFrame`（render.js:218-226）= blit cacheCanvas + tint/contour overlay + drawAnim + grid。**融合点 = 加一个模式分支**：

```
// main.js 内
function drawFrame(now){
  if (MODE.value === '25d')
    renderFrame25D(cv.getContext('2d'), cache25D, currentMap, ui, now);  // view25d.js
  else
    renderFrame(cv.getContext('2d'), cacheCanvas, currentMap, ui, now);  // 现有，原样
}
```

- `buildMapCache25D(m)` 仿 `buildMapCache`（render.js:118-191）：一次合成 2.5D 静态帧 canvas（含顶面放置 + 抬升 + 侧壁 + 可选 tint/contour），挂 `animCells`（投影坐标）；每帧 `drawFrame25D` 只做 blit + 动画 + 网格，动画循环 `startAnim`（main.js:18）复用。[设计，high]

### 4.3 与等距对照

等距需把排序从「嵌套循环」换成「按 `x+y+z` 排序/桶」，高度差下部分序要拓扑排序或分 z 层渲染（社区结论，见 Q1 引用）。斜角方案的 O(1) 排序复杂度是本方案的一个核心优势。

---

## Q5. 切换机制：全局 2D/2.5D 模式开关设计

- **状态**：`main.js` 顶部 `export const MODE = { value: '2d' }`（或 UI 模块持有）。
- **UI**：`index.html` 在现有 controls 加 `<label class="chk"><input type="checkbox" id="view25d"> 2.5D 视角</label>`；绑定 `change` → 设 `MODE.value` → `loadMap(currentDef,{seed:currentSeed})` 重建对应 cache。
- **加载分叉**：`loadMap`（main.js:26-47）内 `const cache = MODE.value==='25d' ? buildMapCache25D(data) : buildMapCache(data);`（各一行）；canvas 尺寸按模式：2.5D 高 = `h*16 + maxZ*STEP + margin`。
- **持久化**：`savePrefs/readPrefs/applyPrefs`（main.js:127-144）加 `view25d` 项；可选 URL `?view=25d` 深链（与 `?map/seed` 同一 replaceState 机制，main.js:57-61）。
- **动画**：`drawFrame` 分支见 Q4；`startAnim`/reduced-motion（main.js:152-155）不改。
- **导出**：`btnExportMap`（main.js:86-87）按模式选 `exportMapPNG` 或 `exportMapPNG25D`。
- **2D 保留**：模式默认 '2d'；2D 路径所有函数签名/输出不变；T1-T5 锁 2D 路径不变 → 「可切换」由开关天然保证。[设计，high]

---

## Q6. 分阶段落地路径（Phase A-D）

| 阶段 | 交付物 | 涉及文件 | 验收 |
|---|---|---|---|
| **A 原型（能看）** | 斜角挤出最小实现：`buildMapCache25D` 顶面放置 + 高度抬升 + 南/东单色侧壁 + `drawFrame25D` + 模式开关 | `src/view25d.js`（新建，~100 行）、`main.js`（+8 行）、`index.html`（+1 控件） | 切换开关生效；2-3 张图可看；2D 模式渲染与改动前逐字节一致（T1 仍绿） |
| **B 侧壁/排序（好看，核心诉求）** | 侧壁材质分层（岩类层理 `ROCKY` + 基色压暗 + 水下崖基变暗）、`Z_STEPS`/`STEP` 调参、拐角/三岔接缝、嵌套循环 painter 正确性验证 | 仅 `src/view25d.js`（+60-100 行） | **悬崖可见度达到用户预期**（VLM 视觉验收：岩壁断面、阶梯、水下崖基）；接缝无 1px 撕裂 |
| **C 覆盖层/动画（全功能）** | 水/岩浆动画在投影坐标重画（复用 `drawAnim` 图案逻辑）、海拔着色/等高线 overlay 投影、网格线投影、地图统计不受影响 | `src/view25d.js`（+40 行）、`main.js`（动画分支） | 2.5D 下动画/着色/等高线与 2D 观感对齐；静态帧缓存性能达标 |
| **D 导出/图鉴/测试（闭环）** | `exportMapPNG25D`（渲染 2.5D 帧到 PNG）、图鉴可选 2.5D 预览、测试 T6（2.5D 渲染 smoke：尺寸/全格覆盖/无异常/接缝采样）+ T7（2D 模式逐字节回归） | `export.js`（+15 行）、`view25d.js`、`tests/run.mjs`（+2 用例）、`tests/shim.js`（如需 fillRect 以外 API） | `npm test` 全绿（T1-T5 原样 + T6/T7 新增）；2.5D 导出 PNG 可打开 |

- 阶段间可独立交付，A 完成即证明「共享数据层 + 分叉渲染层」架构成立。
- **测试策略**：2D 回归（T1-T5）作为 2.5D 分叉的「不改动护栏」——任何 2.5D 改动若导致 2D 模式 golden 漂移即失败。[设计，high]

---

## Q7. 最小可行改动面与工作量

### 7.1 以现有基础（程序化瓦片 + heights 已有）核算改动面

| 改动点 | 规模 | 说明 |
|---|---|---|
| **新建 `src/view25d.js`** | ~150-250 行 | 投影/量化/侧壁/painter/缓存构建/draw；核心全部在此 |
| `src/main.js` | +~15 行 | `MODE` 状态 + 开关 handler + `loadMap` 分叉 + prefs 一项 + 导出分叉 |
| `index.html` | +1 控件 | 2.5D checkbox |
| `src/export.js` | +~15 行（可选） | `exportMapPNG25D` |
| `tests/run.mjs` + `shim.js` | +2 用例 / 微量 | T6/T7 |
| **`mapgen.js` / `terrain.js` / `tiles.js` / `render.js` / `palette.js` / `style.css`** | **零改动** | 2D 管线、签名缓存、过渡、图鉴、样式全部原样 |

**关键点**：改动面几乎全部集中在**一个新文件 + 三个文件的少量接线**，而 5 个核心模块（mapgen/terrain/tiles/render/palette）零功能改动。这是「共享数据层 + 分叉渲染层 + 2D 保留」方向的直接收益。

### 7.2 为什么改动面这么小（对比等距）

- `heights` 已存在（mapgen.js:9-24 第一遍已算好，零新增计算）——2.5D 的 z 输入免费。
- `baseColor`/`ROCKY`（render.js:16-52）已实现「基色压暗 + 层理」——侧壁材质直接泛化。
- `cacheCanvas`（render.js:118-191）已是「连续无缝顶面纹理」——顶面零重采样。
- `animCells`（render.js:129-148）已预生成可动格——2.5D 动画只需投影坐标。
- 反观等距：需重采样管线 + 斜边采样谓词 + 真排序，改动面约 1.5-2×，且回归风险更高（过渡缝线、缓存 key）。[推断，medium]

### 7.3 工作量估算

| 阶段 | 工作量（单人） |
|---|---|
| A 原型 | 0.5-1 天（含视觉初验） |
| B 侧壁/排序 | 0.5-1 天（调参 + VLM 验收） |
| C 覆盖层/动画 | 0.5-1 天 |
| D 导出/图鉴/测试 | 0.5-1 天 |
| **合计** | **约 2-4 天**（等距约 4-6 天且风险更高） |

---

## 置信度汇总

| 结论 | 置信度 | 依据 |
|---|---|---|
| 等距/斜角定义与投影公式（2:1 菱形 vs α=90° 正交斜投影） | high | 多源社区公式（References） |
| 菱形顶面像素面积 = 源方形 ~1/4，16px 下纹理糊化 | high | 几何面积公式（推导自菱形 W×H/2） |
| 斜角方案顶面零重采样、复用 cacheCanvas | high | `render.js:118-191` 事实 + 投影无剪切代数 |
| 斜角侧壁高度 = (z_y - z_next)·STEP，可精确止于下一格顶面 | high | 代数推导（Q4） |
| 斜角 painter = 嵌套循环即正确、无部分序 | medium | 代数自洽，需 Phase B 原型视觉确认 |
| 等距深度排序需 x+y+z 且有部分序问题 | high | 社区一致结论（gamedev.stackexchange 8151/177422） |
| 斜角方案对「悬崖可见度」性价比显著高于等距 | medium | 设计推导 + 既有 baseColor/ROCKY 复用 |
| 签名缓存 key 不宜含高度/投影维度（ADR-2） | high | `tiles.js:185-187` + 既有 ADR-2 |
| 改动面 = 1 新文件 + 3 文件接线，5 核心模块零改动 | high | 逐模块职责梳理（Q2） |
| 等距改动面约 1.5-2×、风险更高 | medium | 经验推断 |
| 旧结论「2.5D 改动巨大」需修正为「斜角方案成本可控」 | medium | 本调研对旧 `terrain-height-research.md` B3 的再评估 |
| Tiny Swords 高程层叠（Shadow+Elevated Ground） | high | 旧调研 + skill 文档（References） |

---

## References

**项目代码/文档**
- `src/mapgen.js:4-98,97,245`（genWorld 返回 {grid,w,h,seed,river,heights,roadBase}；heights 为 Float64Array 连续海拔场）
- `src/tiles.js:38-61,110-112,165-168,184-264`（SEAM_BAND、pairSeed、distFor 共享缝线谓词、baseOf、renderRoadCell、签名缓存 neighborKey/buildTemplate/renderTemplate）
- `src/terrain.js:167-177,186-214`（roadColor 地形感知色、TERRAIN 26 种、PALETTE_ORDER）
- `src/render.js:16,18-52,53-116,118-191,197-226`（ROCKY、baseColor、drawLip/drawCliff、Phase2 浮雕/等高线/海拔着色、buildMapCache、drawAnim、drawFrame）
- `src/main.js:18,26-47,57-61,127-155`（startAnim、loadMap、syncURL、prefs、reduced-motion）
- `src/export.js:51-60,63-113`（exportMapPNG、buildTilesetCanvas）
- `index.html:21-27`（现有控件行）
- `tests/run.mjs`（T1-T5）、`tests/golden/baseof.json`、`tests/shim.js`
- `docs/ARCHITECTURE.md`（ADR-2 缓存隔离、数据流）、`docs/terrain-height-research.md`（课题 B：2D 高度差现状弱、2.5D 曾列 Phase 3、Tiny Swords 参照）、`docs/transition-tiles-research.md`（距离场/缝线/抖动、签名缓存原理）、`docs/road-path-tiles-research.md`（roadBase 先例、Rimworld 地形感知色）
- git：`60a1c94`、`73e6970`、`d63ae7d`（回归测试落地）、`7135b97`（Phase 2 高度层恢复合并）

**社区（已实际检索）**
- 2D↔等距 2:1 菱形坐标转换公式 — https://stackoverflow.com/questions/39729815/converting-screen-coordinates-to-isometric-map-coordinates/39731405 、 https://www.gamedev.net/forums/topic/413630-tilemath-in-diamond-isometric-21/ 、 https://code.tutsplus.com/creating-isometric-worlds-a-primer-for-game-developers--gamedev-6511t
- 顶视→等距图像变换（rotate 45° + scaleY 0.5，逆映射 UV 采样，锚点=底边中点）— https://stackoverflow.com/questions/20390002/isometric-projection 、 https://gamedev.stackexchange.com/questions/29939/how-to-render-axometric-isometric-tiles-that-are-a-2d-array-in-logic-but-inclin/37992
- 2.5D / 三视图 / 等距 vs 斜角差异（oblique 保持正视面直角；代表作 Ultima VII/UO、SimCity、Diablo）— https://en.m.wikipedia.org/wiki/Two_and_a_half_dimensional 、 https://en.wikipedia.org/?curid=23070656 、 https://docs.unity3d.com/6000.1/Documentation/Manual/2d-game-perspective-reference.html
- 斜投影公式（cabinet/cavalier：xp=x+λz·cosα, yp=y+λz·sinα；α=90° 即纯垂直抬升）— https://web.archive.org/web/20210609041738/http://en.wikipedia.org/wiki/Cabinet_projection 、 https://www.sciencedirect.com/topics/computer-science/oblique-projection
- 等距深度排序 painter（x+y(+z)；部分序/拓扑排序；Unity Custom Axis）— https://gamedev.stackexchange.com/questions/8151/how-do-i-sort-isometric-sprites-into-the-correct-order 、 https://gamedev.stackexchange.com/questions/177422/proper-2d-isometric-tile-depth-sorting/206675 、 https://docs.google.com/document/d/1tUzqScbmrzm-OPqyBSHb_GFEwB1s1Yh2TrzlVDHPQDg/pub
- 等距高度/侧壁（顶点抬升 y-=z·step + 独立侧壁多边形；SuperTilemap 分高度层 TileMap；Zoo Tycoon 式 side-face）— https://gamedev.stackexchange.com/questions/159449/isometric-map-with-different-z-axis-values 、 https://gamedev.stackexchange.com/questions/207503/possible-to-draw-isometric-tiles-with-height-and-moving-objects-in-one-pass 、 https://github.com/PetePete1984/SuperTilemap 、 https://github.com/KINGTUT10101/IsometricMapWithDepth
- 过渡自动铺设/对角角点（bitmask 8 邻、内/外角策略、corner Wang）— https://forums.tigsource.com/index.php?PHPSESSID=cuu1b20mbjj1s7jbfee5v343v6&action=printpage;topic=20367.0 、 https://github.com/Wangscape/Wangscape
- Tiny Swords tilemap 高程层叠（每级高程 = Shadow + Elevated Ground 一对；shadow 精灵 128×128 下移一格制造软过渡）— https://skills.rest/skill/tinyswords-tilemap （项目旧调研同时引用 agentskills.so 同源文档）
- sprite stacking / 2.5D 高度挤出（切片堆叠 + 深度排序 + 垂直偏移）— https://github.com/CoolDotty/Shader-Stacker 、 https://blog.codemagic.io/flaming-stacks/
- Age of Empires 2 视角 = 2D sprite 伪 3D（orthographic/perspective 叠层，非真相机）— https://forums.ageofempires.com/t/units-still-dont-follow-terrain-contours-and-are-always-fully-horizontal/173201/21

*本文未修改任何源码；落地路径标注了涉及文件与行号，供后续任务直接使用。*
