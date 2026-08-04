# debug-002: 星球配色调整——蓝绿地球外观

> **日期**: 2026-07-27  
> **关联文件**: `content/planets/viar.json`  
> **涉及源码**:
> - `mindustry/graphics/g3d/PlanetRenderer.java`
> - `mindustry/graphics/g3d/NoiseMesh.java`
> - `mindustry/graphics/g3d/HexMesh.java`
> - `mindustry/graphics/g3d/HexMesher.java`
> - `mindustry/graphics/g3d/MeshBuilder.java`
> - `mindustry/graphics/g3d/MultiMesh.java`
> - `mindustry/graphics/g3d/PlanetMesh.java`
> - `mindustry/mod/ContentParser.java`
> - `core/assets/shaders/planet.vert`
> - `core/assets/shaders/planet.frag`

---

## 〇、星球为什么不是单色的——多层 Mesh 复合渲染的本质

> 这一章回答四个最根本的问题，它们恰好是上一版文档"看似都讲了、实则没讲透"的部分：
> 1. 星球是如何看上去有不同色彩的，而不是单色的？
> 2. 为什么渲染不同的 mesh 可以实现这个效果？
> 3. 这和我们 JSON 的关系又是什么？
> 4. 为什么我们的 JSON 这么写，可以实现？
>
> 读完这一章再看后面的管线详解，你就知道每一段代码在整个方案中的位置。

### 0.1 问题：如何让一个 3D 球体看起来像一颗星球？

给你一个光秃秃的 3D 球体。你想要它看起来像地球——有蓝色的海洋、绿色的大陆、黄色的沙漠、白色的雪山。你能怎么做？

**方案 A：纹理贴图（Texture Mapping）。** 找一位美术画一张地球的 2D 图片，像包橘子皮一样包在球体表面上。这是大多数 3D 游戏的做法。问题是：Mindustry 是一个 **mod 驱动的游戏**，modder 通过 JSON 配置文件定义星球外观，没有美术资源。而且纹理贴图需要做 UV 展开（把 3D 球面摊平成 2D 平面），对程序化生成极不友好。

**方案 B：多层 Mesh 叠加（Multi-Layer Mesh Compositing）。** 把"地球"拆成 5 个独立的球体——一个纯蓝的海洋球、一个绿斑块的大陆球、一个黄斑块的沙漠球、一个灰斑块的山脉球、一个白斑块的雪峰球。把它们叠在一起同时渲染，用 GPU 的深度测试自动决定每个像素显示哪一层的颜色。这就是 Mindustry 的选择。

方案的 B 的核心优势：
- **纯 JSON 可配置**：不需要任何图片资源，modder 只需写 JSON 字段
- **程序化生成**：每个"斑块"的形状由 Simplex 噪声在运行时计算——无限变化，零存储成本
- **逐层独立可控**：海洋覆盖多少、沙漠稀疏程度、山脉高度……每层单独调参

### 0.2 Mindustry 的选择：多层 Mesh 叠加渲染

在 Mindustry 中，一个星球的视觉外观由 **N 个独立的 3D Mesh** 叠加而成。每个 Mesh 本身是一个**完整的球体**（经过噪声变形），拥有自己的顶点和顶点颜色。GPU 在渲染时按顺序绘制这些球体，深度测试（Depth Test）自动决定每个屏幕像素最终显示哪一层的颜色。

把每一层想象成一张有洞的"壳"：

```
          摄像机
            ↓
    ╔═══════════════╗  ← 第5层：山脉白（大部分区域凹陷，只有噪声极值处凸出）
    ║ ╔═══════════╗ ║  ← 第4层：山脉灰
    ║ ║ ╔═══════╗ ║ ║  ← 第3层：沙漠
    ║ ║ ║ ╔═══╗ ║ ║ ║  ← 第2层：森林
    ║ ║ ║ ║   ║ ║ ║ ║  ← 第1层：海洋（完整球体，最内层）
    ║ ║ ║ ╚═══╝ ║ ║ ║
    ║ ║ ╚═══════╝ ║ ║
    ║ ╚═══════════╝ ║
    ╚═══════════════╝
```

图中每一条竖线代表屏幕上的一个像素列。摄像机从上方看下来：
- 最左边的像素列穿过了所有 5 层 → GPU 显示第 5 层（山脉白）的颜色（它最靠近摄像机）
- 中间的像素列穿过了第 1-4 层但第 5 层在那里凹陷了 → 显示第 4 层（山脉灰）
- 右边的像素列穿过了第 1-2 层但第 3-5 层都凹陷了 → 显示第 2 层（森林）
- 最右边的像素列只穿过了第 1 层 → 显示第 1 层（海洋）

**GPU 端的具体机制**：深度测试（Depth Test）。渲染第 1 层（海洋）时，GPU 把所有海洋顶点的深度值写入深度缓冲。渲染第 2 层（森林）时，GPU 逐个像素比较：森林的这个像素比深度缓冲中已有的海洋像素更近（距离摄像机更近）吗？是 → 绘制并更新深度缓冲。否 → 丢弃。这个机制在硬件层面执行，不需要任何额外的代码逻辑。

### 0.3 每一层的颜色从哪来？

每一层是一个 NoiseMesh。NoiseMesh 在被构造时遍历球面上的每一个顶点，对每个顶点调用 `getColor()` 回调：

- **单色模式**（只写了 `"color"` 字段）：所有顶点同一种颜色。海洋层用这个——整层纯蓝。
- **双色模式**（写了 `"color1"` 和 `"color2"`）：对每个顶点，用 **另一组独立噪声** 计算一个标量值。若大于 `colorThreshold` → 用 `color2`（亮色）。否则 → 用 `color1`（暗色）。

因为噪声值在空间上是**平滑连续**的（相邻顶点的噪声值相近），所以产生的颜色斑块不是随机的胡椒盐噪点，而是**有机形状的色块**——像地球上蜿蜒的大陆和散落的岛屿。

这就是为什么 `colorScale`（控制色块尺寸）和 `colorThreshold`（控制亮暗比例）这两个参数如此重要：它们直接决定了每一层"大陆的形状"。

### 0.4 这与我们的 JSON 有什么关系？

看我们的 `viar.json` 的 `"mesh"` 字段：

```jsonc
"mesh": {
    "type": "MultiMesh",          // ← 这是容器：告诉游戏"我要叠多层"
    "meshes": [                   // ← 这个数组定义了叠加的每一层
        { "type": "NoiseMesh", "seed": 42,  "color": "1050a0",     "radius": 0.7, "mag": 0.30 },
        { "type": "NoiseMesh", "seed": 77,  "color1": "1d7a28", …, "radius": 0.7, "mag": 0.30 },
        { "type": "NoiseMesh", "seed": 131, "color1": "b8a050", …, "radius": 0.7, "mag": 0.18 },
        { "type": "NoiseMesh", "seed": 199, "color1": "7a7a7a", …, "radius": 0.7, "mag": 0.22 },
        { "type": "NoiseMesh", "seed": 241, "color1": "c0c8c080",…, "radius": 0.7, "mag": 0.20 }
    ]
}
```

这个 JSON 结构直接映射到 Mindustry 的对象模型：

| JSON 路径 | Java 对象 | 职责 |
|-----------|----------|------|
| `mesh.type = "MultiMesh"` | `new MultiMesh(…)` | 容器，持有子 mesh 列表，渲染时逐层遍历 |
| `mesh.meshes[i]` | `new NoiseMesh(…)` | 第 i 层地形——一个独立的 3D 球体 mesh |
| `seed` | 噪声种子 | 决定该层地形和颜色的空间分布 |
| `radius` | 球体半径 | 所有层必须相同（否则内层被完全遮挡，见坑 2） |
| `mag` | 地形变形幅度 | 决定该层顶点能凸出多远——**后渲染的层 mag 递减** |
| `color1`/`color2` | 暗色/亮色 | 同一层内部的颜色变体 |
| `colorScale` | 色块空间尺度 | 越大色块越大（大陆状 vs 胡椒盐状） |
| `colorThreshold` | 亮暗分界阈值 | 控制亮色（color2）占比 |

### 0.5 所以，为什么 JSON 这样写就可以实现？

把上面的所有机制串起来，就是我们 JSON 的设计逻辑：

1. **外包装是 `MultiMesh`** → 因为星球需要多个视觉层叠加。`MultiMesh.render()` 只是 for 循环逐层渲染（见 2.3.3），没有任何魔法。

2. **每层是 `NoiseMesh`** → 因为每个地形层需要独立的地形起伏和颜色纹理。`NoiseMesh` 用 Simplex 噪声同时驱动几何变形（`getHeight()`）和颜色选择（`getColor()`），产生有机、不规则的外观。

3. **所有层 `radius` 相同（0.7）** → 这是坑 2 血泪教训的核心结论。`radius` 是等比缩放因子，逐层递减会导致内层顶点全部小于外层，深度测试把内层完全丢弃。相同 radius 意味着每层的基础球体一样大，只有噪声推动的局部凹凸决定谁在谁之上。

4. **`mag` 值总体递减** → `mag` 控制噪声能推多远。海洋 `mag=0.30`、森林 `mag=0.30`（同级竞争 50/50），沙漠 `mag=0.18`（只在噪声极高处穿透）、山脉 `mag=0.22/0.20`。后渲染的层 mag 较小 → 大部分区域它们在前层几何体之内（被遮挡）→ 只在噪声峰值处"刺穿"前层。这创造了稀疏可见的高地地形，就像地球上沙漠和雪山只覆盖少部分区域一样。

5. **`seed` 各不相同** → 如果两层 seed 相同，它们的噪声分布完全重合，凸起和凹陷的地理位置一模一样，等于两层完美对齐——后渲染的层会均匀覆盖前层，失去"斑块穿透"的效果。不同 seed 意味着每层的地形特征在不同的地理位置出现。

6. **`colorScale` 递增（3→5→7→9）** → 海洋到雪山，色块从碎到整。低层（森林）用小块色斑模拟破碎的海岸线和零散植被，高层（雪峰）用大块色斑模拟成片的高原积雪。

7. **`color1`/`color2` 始终是同一色系的亮暗变体** → 森林的 `"1d7a28"`（深绿）→ `"3db840"`（亮绿），沙漠的 `"b8a050"`（土黄）→ `"d0c068"`（亮黄）。同一层内颜色只在亮度/饱和度上变化，色相不变，所以视觉上"这一层是一种地形"的感知统一。

8. **渲染顺序就是 JSON 数组顺序** → 索引 0（海洋）最先渲染 → 写入深度缓冲。索引 1（森林）其次 → 在噪声高处覆盖海洋。索引 4（山脉白）最后渲染 → 只在所有前层都凹陷的位置可见（三层独立噪声的联合最大值，概率极低，所以雪山最稀有）。

**一句话总结**：我们通过 JSON 定义了一个"5 层球壳"的配置——每层有独立的地形起伏（`seed` + `mag`）和颜色纹理（`color1`/`color2` + `colorScale` + `colorThreshold`）。Mindustry 在启动时把 JSON 解析为 5 个 NoiseMesh 对象，包在一个 MultiMesh 容器里。运行时每一帧，MultiMesh 逐层提交给 GPU，深度测试自动完成"哪些像素显示哪层颜色"的判断——产生地球般的多层地形视觉效果。

---

## 一、背景与目标

繁星 mod 的 `viar.json` 原本采用**紫灰+蓝绿**的"AI 主题色"配色方案。本次任务将其改为**类似地球的蓝绿色外观**——蓝色海洋为基底，叠加绿色森林、黄色沙漠、灰色山脉暗面和白色山脉亮面（冰盖/雪峰），实现五层地形的视觉分层。

---

## 二、星球渲染管线详解

> 这一章从你写的 JSON 出发，追踪到 GPU 如何画出屏幕上的每一个像素。前面第〇章给出了全景图；这一章是对全景图每一帧的显微放大。

### 2.0 在开始读源码之前：必须理解的基础概念

以下概念贯穿整个渲染管线。如果你已熟悉，可直接跳到 2.1。

**Mesh（网格）**：一组三维顶点和它们之间连接关系（三角形索引）的数据集合。GPU 通过绘制这些三角形来显示 3D 物体。Mindustry 中每个 NoiseMesh 层都是一块独立的 Mesh——它有自己的一套顶点（位置 + 颜色），互不共享。

**顶点（Vertex）**：3D 空间中的一个点。每个顶点携带一组属性：位置（x,y,z 坐标）、颜色（RGBA）、法线方向（用于光照）等。你的 JSON 中的颜色字段最终会变成每个顶点的颜色属性。

**三角形（Triangle）**：3D 渲染的基本图元（即最小绘制单元）。三个顶点围成一个三角面，成千上万个三角形拼成一个球体。Mindustry 的星球是一个由六边形网格细分为三角形的近似球体。

**Shader（着色器）**：一段运行在 GPU 上的小程序，用一种叫 GLSL 的类 C 语言编写。分为两种：(1) **Vertex Shader（顶点着色器）**——对每个顶点运行，把 3D 位置变换到屏幕坐标；(2) **Fragment Shader（片段着色器）**——对每个像素运行，计算最终颜色（含光照）。

**Uniform（统一变量）**：shader 中一次绘制调用内所有顶点/像素共享的全局常量。例如"太阳在哪个方向"这个信息作为一个 uniform 传入，所有像素共享。

**深度缓冲（Depth Buffer）**：GPU 显存中的一块二维数组，大小等于屏幕分辨率。数组的每个元素存储**该像素位置当前最近物体的深度值**（深度 = 物体到摄像机的距离）。不保存颜色，只保存距离。

**深度测试（Depth Test）**：GPU 在绘制每个像素前执行的硬件判断。规则是：比较新像素的深度值和深度缓冲中同一个位置的已有深度值。如果新像素更近（深度更小）→ 绘制；如果新像素更远（深度更大）→ 丢弃。这是星球多层 mesh 叠加渲染的**核心机制**。

**深度写入（Depth Mask）**：控制绘制成功的像素是否将其深度值写回深度缓冲。开启时（`Gl.depthMask(true)`），先渲染的物体会"挡住"后渲染的、更远的物体。

**背面剔除（Cull Face）**：一种性能优化——如果一个三角形的正面（由法线方向决定）背对摄像机，GPU 直接跳过它的绘制。Mindustry 星球渲染开启了对背面（`Gl.back`）的剔除。

**Simplex 噪声（Simplex Noise）**：一种数学函数，输入 3D 空间坐标 `(x, y, z)`，输出 `[-1, 1]` 范围内的一个标量值。它的关键性质是：(1) 相邻坐标的输出值也相近，因此噪声是**平滑连续**的；(2) 远距离坐标的输出值不相关，因此噪声有**随机变化**。Mindustry 使用 Simplex 噪声同时在 3D 球面上产生地形起伏和颜色纹理。

**Octaves（倍频程）**：分形噪声技术中的一个参数。将多层不同频率、不同振幅的噪声叠加在一起——octaves=1 是单层平滑噪声；octaves=5 是五层叠加，产生更复杂的地形细节。

**Persistence（持续性）**：分形噪声中相邻频率层之间的振幅衰减因子。例如 persistence=0.5 意味着高频层的振幅是低频层的一半。

**回调（Callback）**：把一个方法（函数）的引用作为参数传给另一个方法，后者在需要时调用前者。Mindustry 在 NoiseMesh 的构造函数中大量使用这种模式——把匿名函数传给 `MeshBuilder`，后者遍历球面所有顶点时逐个调用这些函数。

**MVP 矩阵（Model-View-Projection Matrix）**：三个 4×4 变换矩阵的乘积——(1) Model 矩阵：把顶点从物体坐标系变换到世界坐标系；(2) View 矩阵：从世界坐标系变换到摄像机坐标系；(3) Projection 矩阵：从摄像机坐标系投影到屏幕像素坐标。在 Mindustry 星球渲染中，MultiMesh 的所有子层共享同一个 MVP 矩阵（因为它们同属一个星球）。

**HexMesher 接口**：`MeshBuilder` 与星球噪声层之间的**契约**。它定义了四个回调方法——`getHeight()`（顶点几何高度）、`getColor()`（顶点颜色）、`getEmissiveColor()`（自发光颜色）、`skip()`（跳过该顶点）。NoiseMesh 通过匿名内部类实现这个接口，把 Simplex 噪声注入到 `MeshBuilder` 的网格构建流程中。

---

### 2.1 第一阶段：JSON 如何变成 NoiseMesh 对象

这一阶段回答：`viar.json` 中的 `"radius": 0.7`、`"color1": "1d7a28"` 这些字符串，经过什么代码路径，最终变成 Java 内存中一个可以绘制的 NoiseMesh 实例。

#### 2.1.1 唯一入口：`ContentParser.parseMesh()`

在 `ContentParser.java` 第 1124-1159 行。JSON 文件中的 `mesh` 和 `cloudMesh` 字段被游戏内容加载系统单独提取出来，交给这个方法解析：

```java
private GenericMesh parseMesh(Planet planet, JsonValue data){
    // 如果 data 是数组 → 创建 MultiMesh（一个包含多个子 mesh 的容器）
    if(data.isArray()){
        return new MultiMesh(parseMeshes(planet, data));
    }

    // 读取 type 字段决定构造哪种 mesh，默认值 "NoiseMesh"
    String tname = Strings.capitalize(data.getString("type", "NoiseMesh"));

    return switch(tname){
        case "NoiseMesh" -> new NoiseMesh(planet,
            data.getInt("seed", 0),           // 噪声种子，默认 0
            data.getInt("divisions", 1),       // 球面细分等级，默认 1
            data.getFloat("radius", 1f),       // 球体基础半径，默认 1.0
            data.getInt("octaves", 1),         // 几何噪声 octaves，默认 1
            data.getFloat("persistence", 0.5f),// 几何噪声 persistence，默认 0.5
            data.getFloat("scale", 1f),        // 几何噪声空间尺度，默认 1.0
            data.getFloat("mag", 0.5f),        // 高度变形幅度，默认 0.5
            // —— 颜色字段：优先读 color1，没有则回退到 color，都没有则默认白色 ——
            Color.valueOf(data.getString("color1",
                data.getString("color", "ffffff"))),
            Color.valueOf(data.getString("color2",
                data.getString("color", "ffffff"))),
            // —— 以下四个参数控制"颜色噪声"的行为 ——
            data.getInt("colorOct", 1),         // 颜色噪声 octaves，默认 1
            data.getFloat("colorPersistence", 0.5f),// 颜色噪声 persistence，默认 0.5
            data.getFloat("colorScale", 1f),      // 颜色色块的空间尺度，默认 1.0
            data.getFloat("colorThreshold", 0.5f) // 颜色二值选择阈值，默认 0.5
        );
        // ... 其他 mesh 类型（HexSkyMesh, SunMesh, MultiMesh, MatMesh）
    };
}
```

**这段代码告诉我们 6 件事：**

**① `type` 字段决定构造哪种 Mesh。** 不写 `"type"` 默认就是 `NoiseMesh`。云层用 `HexSkyMesh`（一个 getColor 函数内判断噪声值是否超过阈值的六边形 mesh），太阳用 `SunMesh`。

**② `color1`/`color2` vs `color` 是一个嵌套回退机制。** 代码 `data.getString("color1", data.getString("color", "ffffff"))` 意味着：
- JSON 写 `"color": "1050a0"` → color1 不存在，回退到 color → 两个颜色位置都拿到 `1050a0` → 调用单色变体构造函数（下文 2.2.1）
- JSON 写 `"color1": "1d7a28", "color2": "3db840"` → 两个颜色不同 → 调用两色变体构造函数
- 两个都不写 → 默认白色

**③ 四个颜色噪声参数 (`colorOct`, `colorPersistence`, `colorScale`, `colorThreshold`) 如果不写，全部走默认值。** 默认 `colorScale=1.0` 导致色块很小（像胡椒盐细碎斑点），默认 `colorThreshold=0.5` 导致两种颜色各约 50%。这两个默认值是导致坑 1（蓝绿区分度低）的直接原因。

**④ 每个 JSON 字段都有默认值。** `data.getFloat("radius", 1f)` 中的第二个参数 `1f` 就是默认值。这意味着哪怕 JSON 只写 `{}`，也会构造出一个可用的 NoiseMesh（半径 1.0，白色，mag=0.5）。

**⑤ `parseMesh()` 是递归的。** 当 JSON 中 `"type": "MultiMesh"` 时，代码会新建 `MultiMesh`，然后递归调用 `parseMeshes()` 解析 `"meshes"` 数组中的每一项。你的 JSON 正是这样：外层是一个 MultiMesh，内层 5 个 NoiseMesh 逐个递归构造。

**⑥ 两个 `parseMesh` 签名通过重载自动切换。** 当 `data.isArray()` 为 true 时走数组分支（直接返回 MultiMesh），否则走单对象分支（按 `type` 字段分发）。这意味着 `"mesh"` 也可以是单层 NoiseMesh（对于简单星球），但你选择了数组写法——因为我们需要 5 层地形。

---

### 2.2 第二阶段：Mesh 的顶点如何生成

这一阶段回答：NoiseMesh 构造函数内部做了什么？`getHeight()` 和 `getColor()` 这两个回调如何定义？最终的顶点位置如何计算？

#### 2.2.1 NoiseMesh 的两个构造函数

`NoiseMesh.java` 有两个构造函数——单色版和两色版。两者都使用**匿名内部类（一种 Java 内联定义回调的方式）**来定义 `HexMesher` 接口的两个方法。

**单色变体**（第 11-14 行）：

```java
public NoiseMesh(Planet planet, int seed, int divisions, Color color,
    float radius, int octaves, float persistence, float scale, float mag){

    this.mesh = MeshBuilder.buildHex(new HexMesher(){
        @Override
        public float getHeight(Vec3 position){
            return Simplex.noise3d(7 + seed, octaves, persistence, scale,
                5f + position.x, 5f + position.y, 5f + position.z) * mag;
        }

        @Override
        public void getColor(Vec3 position, Color out){
            out.set(color);          // 所有顶点同一颜色，无噪声
        }
    }, divisions, radius, 0.2f);   // ← 最后一个 0.2 是 intensity（硬编码）
}
```

**两色变体**（第 28-39 行）：

```java
public NoiseMesh(Planet planet, int seed, int divisions, float radius,
    int octaves, float persistence, float scale, float mag,
    Color color1, Color color2,
    int coct, float cper, float cscl, float cthresh){

    this.mesh = MeshBuilder.buildHex(new HexMesher(){
        @Override
        public float getHeight(Vec3 position){
            return Simplex.noise3d(7 + seed, octaves, persistence, scale,
                5f + position.x, 5f + position.y, 5f + position.z) * mag;
        }

        @Override
        public void getColor(Vec3 position, Color out){
            out.set(
                Simplex.noise3d(8 + seed, coct, cper, cscl,
                    5f + position.x, 5f + position.y, 5f + position.z)
                > cthresh ? color2 : color1
            );
            //      ^^^^^^^^   ^^^^^^^  ^^^^^^^
            //      硬阈值判断   true    false
        }
    }, divisions, radius, 0.2f);
}
```

**这里有三个关键设计决策，每个都影响了我们后来的调试：**

**决策 1：几何噪声和颜色噪声使用不同的种子。** `getHeight` 用 `7 + seed`，`getColor` 用 `8 + seed`。两者种子不同 → 噪声值不同 → 同一层的几何形状和颜色纹理是**独立不相关**的。一个顶点可能很高但显示暗色，也可能很低但显示亮色。这意味着**不能通过颜色来推断高度**——我们在坑 3 中最初忽略了这一点。

**决策 2：颜色选择是硬阈值，不是渐变。** `> cthresh ? color2 : color1` 是 Java 的三元运算符（即 if-else 表达式）。对每个顶点，颜色噪声值要么大于阈值（选 color2），要么不大于（选 color1），没有中间状态。所以你看到的是**斑块**而非**渐变**。

**决策 3：强度系数 `0.2` 被硬编码。** 两个构造函数都调用 `MeshBuilder.buildHex(..., 0.2f)`。这个值不能通过 JSON 修改。它把 mag（高度变形幅度）的效果缩小到 1/5，使得球面变形量控制在合理范围内。

#### 2.2.2 几何噪声值 `getHeight()` 的输出范围

`Simplex.noise3d()` 返回值的范围约为 **[-1, 1]**。乘以 `mag` 后：

```
getHeight 范围 ≈ [-mag, +mag]

mag=0.45 时：getHeight 范围 ≈ [-0.45, 0.45]
mag=0.30 时：getHeight 范围 ≈ [-0.30, 0.30]
```

`getHeight` 的正值表示顶点向外凸出球面，负值表示顶点向内凹陷。

#### 2.2.3 顶点位置计算：`MeshBuilder.buildHex()`

这是**整个文档最重要的源码片段**——它直接解释了为什么坑 2（只有绿色）会发生。位于 `MeshBuilder.java` 第 84-108 行：

```java
public static synchronized Mesh buildHex(
    HexMesher mesher, int divisions, float radius, float intensity){

    PlanetGrid grid = PlanetGrid.create(divisions);
    // PlanetGrid 在球面上生成了一个六边形网格，每个六边形再细分为三角形
    // grid.corners 包含所有顶点的 3D 方向向量（单位长度）

    float[] heights = new float[grid.corners.length];

    // 遍历球面的每一个顶点
    for(int i = 0; i < grid.corners.length; i++){
        // 对每个顶点调用 getHeight（即我们在 2.2.1 中定义的回调）
        // 计算该顶点到球心的距离
        heights[i] = (1f + mesher.getHeight(grid.corners[i].v) * intensity) * radius;
    }
    //         ^^^^   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^   ^^^^^^
    //      基础单位   噪声偏移 × 强度系数                         球体半径缩放
    //      半径 1                                      

    // ... 之后用 heights 数组和 grid 的拓扑信息构建 GPU 顶点缓冲 ...
}
```

**展开后的公式（代入 intensity=0.2）：**

```
顶点到球心的距离 = (1 + noise3d × mag × 0.2) × radius
```

**这个公式有一个极易被误读的关键性质**：`1` 是加法项（噪声在此之上增减），但 `radius` 是乘法项（等比缩放整体）。这意味着**两个不同 radius 的球体无法通过噪声的凹凸来"相互穿透"**——radius 较小的层的噪声极值顶点仍然小于 radius 较大的层的噪声极小值顶点（当 mag 差距不大时）。

**这个公式的各个部分：**

| 符号 | 值来源 | 含义 | 为什么存在 |
|------|--------|------|-----------|
| `1` | 硬编码 | 基础单位半径 | 保证球体至少是完美的球形（噪声只在此之上增减） |
| `noise3d` | Simplex 噪声 | 该顶点的随机偏移值，[-1, 1] | 产生不规则的凹凸地形 |
| `mag` | JSON `"mag"` | 高度变形幅度 | 越大噪声效果越显著 |
| `0.2` | NoiseMesh 硬编码 | 强度衰减系数 | 让 mag 值在 0-1 之间产生合适的变形量 |
| `radius` | JSON `"radius"` | **球体整体缩放因子** | 控制整层球体的大小 |

**最关键的事实**：`radius` 是**乘在整个表达式外面的**。它不是"球体半径 + 噪声偏移"，而是"（基础球体 + 噪声偏移）的整体缩放"。这意味着 `radius=0.66` 产生的所有顶点——包括向外凸出最远的那一个——都比 `radius=0.68` 的球体要小，即使前者的某个顶点噪声值很高。

**数值实例（这是坑 2 的数学根源）：**

```
设 mag=0.45，噪声极值 noise3d=±1：

森林层 radius=0.68, mag=0.55:
  最外顶点 = 0.68 × (1 + 1×0.55×0.2) = 0.68 × 1.11 = 0.755
  最内顶点 = 0.68 × (1 - 1×0.55×0.2) = 0.68 × 0.89 = 0.605

沙漠层 radius=0.66, mag=0.45:
  最外顶点 = 0.66 × (1 + 1×0.45×0.2) = 0.66 × 1.09 = 0.719
  最内顶点 = 0.66 × (1 - 1×0.45×0.2) = 0.66 × 0.91 = 0.601
```

沙漠层最外顶点 0.719 < 森林层最外顶点 0.755。意味着沙漠层的**每一个顶点**都在森林层的球体内。GPU 的深度测试（见 2.3.1）会发现沙漠层的所有像素都比已绘制的森林层像素更远——全部丢弃。

#### 2.2.4 顶点颜色的计算：`getColor()` 的回调在何处被调用

回到 `MeshBuilder.buildHex()` 的后续代码。当所有 heights 计算完毕，代码遍历每个六边形 tile（由 PlanetGrid 生成），提取它的 corner 顶点：

```java
for(Ptile tile : grid.tiles){
    Corner[] c = tile.corners;

    // ...计算三角形法线...

    tmpCol.set(1f, 1f, 1f, 1f);
    mesher.getColor(tile.v, tmpCol);   // ← 在这里调用 getColor 回调
    float color = tmpCol.toFloatBits();

    // 把 corner 顶点位置（heights[corner.id] × corner.v）和颜色写入 GPU 缓冲
    for(var corner : c){
        float height = heights[corner.id];
        vert(mesh, floats,
             corner.v.x * height,      // 顶点 X = 方向向量 X × 距离
             corner.v.y * height,      // 顶点 Y = 方向向量 Y × 距离
             corner.v.z * height,      // 顶点 Z = 方向向量 Z × 距离
             nor, color, emissive);
    }
}
```

注意：`getColor()` 以 tile 的**中心方向向量** `tile.v` 为参数，但同一个 tile 的所有 corner 顶点共享同一个颜色。这是性能折中——减少颜色采样次数（一个六边形 tile 一次 vs 每个顶点一次）。

---

### 2.3 第三阶段：PlanetRenderer 如何管理渲染顺序

这一阶段回答：多层 mesh 以什么顺序提交给 GPU？深度测试如何影响每一层的可见性？

#### 2.3.1 渲染入口：`PlanetRenderer.render()`

在 `PlanetRenderer.java` 第 47 行。这是每帧星球渲染的总入口：

```java
public void render(PlanetParams params){
    Draw.flush();                       // 先清空 2D 绘制的缓冲
    Gl.clear(Gl.depthBufferBit);        // 清空深度缓冲（重置所有像素深度为无穷远）
    Gl.enable(Gl.depthTest);            // ← 开启深度测试：逐像素比较远近
    Gl.depthMask(true);                 // ← 开启深度写入：通过测试的像素写回深度缓冲
    Gl.enable(Gl.cullFace);             // 开启背面剔除（性能优化）
    Gl.cullFace(Gl.back);               // 剔除每个三角形的背面

    // ... 摄像机位置和投影矩阵的计算 ...

    Planet solarSystem = params.planet.solarSystem;
    renderPlanet(solarSystem, params);      // 渲染不透明层（星球 mesh）
    renderTransparent(solarSystem, params); // 渲染透明层（云、大气、轨道线）
}
```

**这三行 OpenGL 状态设置在做什么？**

- `Gl.clear(Gl.depthBufferBit)` → 把所有像素的深度值初始化为"无穷远"（实际上 OpenGL 用 1.0 表示最远）。
- `Gl.enable(Gl.depthTest)` → 之后绘制的每个像素，GPU 会自动比较它的深度值和深度缓冲中已有的深度值。新像素更近 → 绘制；更远 → 丢弃。
- `Gl.depthMask(true)` → 绘制成功的像素**同时**将其深度值写入深度缓冲。这意味着先绘制的物体会"挡住"后绘制的、更远的物体。

**对多层星球 mesh 的直接影响**：因为深度测试和深度写入在 `render()` 函数级别就开启了，而所有的星球 mesh 在 `renderPlanet()` 调用链中渲染——所以 MultiMesh 的每一层共享同一个深度缓冲。先渲染的层写入深度，后渲染的层必须更靠外才能覆盖。

#### 2.3.2 `renderPlanet()` 到 `planet.draw()`

```java
// PlanetRenderer.java 第 132 行
public void renderPlanet(Planet planet, PlanetParams params){
    if(!planet.visible()) return;
    cam.update();

    // 视锥体裁剪：如果星球不在摄像机视野内，直接跳过
    if(cam.frustum.containsSphere(planet.position, planet.clipRadius)){
        planet.draw(params, cam.combined, planet.getTransform(mat));
    }

    // 递归渲染所有子星球（对太阳系层级结构）
    for(Planet child : planet.children){
        renderPlanet(child, params);
    }
}
```

`planet.draw()` 内部调用 `mesh.render()`。对于 `MultiMesh`（即你的 JSON 的外层结构），它按数组顺序逐层渲染。

#### 2.3.3 `MultiMesh.render()`：逐层叠加

```java
// MultiMesh.java 第 13 行
public void render(PlanetParams params, Mat3D projection, Mat3D transform){
    for(var v : meshes){
        v.render(params, projection, transform);
    }
}
```

这就是整个多层叠加机制的全部代码。`meshes` 数组按 JSON 中 `meshes` 数组的索引顺序渲染——索引 0（海洋）先渲染，索引 4（山脉白）最后渲染。

**多层叠加的数学条件**：由于深度测试的存在，第 N 层（数组索引 N-1）在某像素位置可见，当且仅当：

```
第 N 层的该顶点深度 < 前 N-1 层中所有已绘制顶点的最小深度
```

等价于（因为所有层共享相同的变换矩阵和摄像机位置）：

```
第 N 层的该顶点到球心的距离 > 前 N-1 层中所有对应顶点的最大距离
```

这个不等式解释了坑 5（山脉不可见）的根因——山脉层需要同时超过海洋、森林、沙漠三层，是**三层独立噪声的最大值**。三个独立随机变量的最大值期望显著偏向正值，导致实际穿透概率远低于单层竞争的估算。

#### 2.3.4 `PlanetMesh.render()`：单层的 shader 绑定

```java
// PlanetMesh.java 第 28 行
public void render(PlanetParams params, Mat3D projection, Mat3D transform){
    if(mesh.isDisposed()) return;

    preRender(params);                           // 设置光照等 shader 参数
    shader.bind();                               // 绑定 shader 程序到 GPU
    shader.setUniformMatrix4("u_proj", projection.val);  // 投影矩阵 uniform
    shader.setUniformMatrix4("u_trans", transform.val);  // 变换矩阵 uniform
    shader.apply();                              // 提交所有 uniform 到 GPU
    mesh.render(shader, Gl.triangles);           // 以三角形模式绘制顶点缓冲
}
```

`shader.bind()` 绑定 Mindustry 的星球着色器（`Shaders.planet`）。这个着色器接收每个顶点的颜色属性，在 Fragment Shader 中乘以光照计算结果（漫反射 + 环境光），输出最终像素颜色。

---

### 2.4 第四阶段：Shader 如何产生最终的像素颜色

#### 2.4.1 `HexMesh.preRender()`：光照参数设置

```java
// HexMesh.java 第 22 行
public void preRender(PlanetParams params){
    Shaders.planet.planet = planet;
    Shaders.planet.emissive = planet.generator != null && planet.generator.isEmissive();

    // 计算光源方向 = (太阳位置 - 星球位置) 归一化后应用星球自转
    Shaders.planet.lightDir
        .set(planet.solarSystem.position)           // 太阳在绝对空间中的位置
        .sub(planet.position)                       // 减去星球位置，得到"太阳相对星球"的方向
        .rotate(Vec3.Y, planet.getRotation())       // 应用星球自转
        .nor();                                     // 归一化为单位向量

    // 环境光颜色（来自太阳的 ambientColor）
    Shaders.planet.ambientColor.set(planet.solarSystem.lightColor);
}
```

光照方向决定了每个像素的明暗——面向光源的像素更亮，背向光源的更暗。因此**星球的背面总是比正面暗**，这不是 JSON 参数能控制的。

#### 2.4.2 Vertex Shader 中的实际计算（`planet.vert`）

以下是 Mindustry 星球 vertex shader 的完整源码（`core/assets/shaders/planet.vert`）：

```glsl
attribute vec4 a_position;      // 顶点位置 → 来自 MeshBuilder 的 heights × corner.v
attribute vec3 a_normal;        // 顶点法线 → 来自 MeshBuilder 的 normal() 计算
attribute vec4 a_color;         // 顶点颜色 → 来自 NoiseMesh 的 getColor() 回调
attribute vec4 a_emissive;      // 自发光颜色 → 来自 getEmissiveColor()，默认 (0,0,0,0)

uniform mat4 u_proj;            // 投影矩阵 → PlanetMesh.render() 设置
uniform mat4 u_trans;           // 变换矩阵 → PlanetMesh.render() 设置
uniform vec3 u_lightdir;        // 光照方向 → HexMesh.preRender() 计算
uniform vec3 u_camdir;
uniform vec3 u_campos;
uniform vec3 u_ambientColor;    // 环境光颜色 → 来自太阳
uniform float u_emissive;

varying vec4 v_col;             // 输出给 fragment shader 的最终颜色

const vec3 diffuse = vec3(0.01);

void main(){
    vec3 specular = vec3(0.0, 0.0, 0.0);

    vec3 lightReflect = normalize(reflect(a_normal, u_lightdir));
    vec3 vertexEye = normalize(u_campos - (u_trans * a_position).xyz);

    float albedo = 1.0 - a_color.a;

    float specularFactor = dot(vertexEye, lightReflect);
    if(specularFactor > 0.0){
        specular = vec3(1.0 * pow(specularFactor, 40.0)) * albedo;
    }

    vec3 norc = (u_ambientColor + specular) *
                (diffuse + vec3(clamp((dot(a_normal, u_lightdir) + 1.0) / 2.0, 0.0, 1.0)));

    float emissive = a_emissive.a * u_emissive *
                     min(pow(max(0.0, (1.0 - norc.r) * 1.2), 3.0), 1.1);

    v_col = vec4(mix(a_color.rgb, a_emissive.rgb, emissive), 1.0) *
            vec4(mix(norc, vec3(1.0), emissive), 1.0);

    gl_Position = u_proj * u_trans * a_position;
}
```

**这个 shader 的逐行解读：**

1. `albedo = 1.0 - a_color.a` — 颜色 alpha 通道越大，albedo（反照率）越小。我们 JSON 中的半透明颜色（如 `"c0c8c080"` 的 alpha=0x80≈0.5）会降低镜面高光，让该层更柔和。
2. `specular` — 镜面高光。反射方向与视线方向越接近，高光越强。`pow(..., 40.0)` 的指数 40 产生了非常集中的高光点（闪亮的海洋表面）。
3. `dot(a_normal, u_lightdir)` — 漫反射的核心：法线与光照方向的点积。面向光源 → 接近 1（亮）；背向光源 → 接近 -1（暗）。`(dot + 1.0) / 2.0` 把它映射到 [0, 1]。
4. `norc`（normalized color）— 环境光 + 高光 乘以 漫反射。这是光照对颜色的整体调制。背光面 norc 很小 → 颜色被压暗。
5. `v_col` — 最终输出到 fragment shader 的颜色。如果该层有自发光（`emissive > 0`），会在暗部产生发光效果（比如火山熔岩）。

#### 2.4.3 Fragment Shader：直通

```glsl
// planet.frag
varying vec4 v_col;

void main(){
    gl_FragColor = v_col;
}
```

Fragment shader 极其简单——只做直通。所有光照计算都在 vertex shader 完成，这是性能优化（顶点数远少于像素数）。

**这意味着你 JSON 中的颜色值在最终屏幕上会被"压暗"**——背光面颜色值乘以 norc 系数（约 0.2-0.3 的环境光系数）。所以如果原始颜色本身就很暗（如坑 1 中的 `1a3a5c`），在背光面几乎变成黑色。

---

### 2.5 完整调用链（总结）

```
游戏启动，加载 mod
  │
  └→ ContentParser 解析 viar.json
       │
       └→ parseMesh() 解析 "mesh" 字段
           ├─ data.isArray() → 不是数组（是对象，有 type 字段）
           ├─ type="MultiMesh" → new MultiMesh(parseMeshes(data.get("meshes")))
           │      └─ parseMeshes() 遍历 meshes 数组，每项递归调用 parseMesh()
           │          └→ new NoiseMesh(planet, seed, …, radius, …, mag, …,
           │                           color1, color2, …, colorScale, colorThreshold)
           │              │
           │              ├─ 选择构造函数：
           │              │   color1==color2? → 单色变体（getColor 返回固定颜色）
           │              │   color1!=color2? → 两色变体（getColor 用噪声阈值选择）
           │              │
           │              ├─ 定义 getHeight() 回调：noise3d × mag
           │              ├─ 定义 getColor() 回调：
           │              │   单色 → 固定颜色
           │              │   两色 → noise3d > colorThreshold ? color2 : color1
           │              │
           │              └─ MeshBuilder.buildHex(mesher, divisions, radius, 0.2)
           │                  ├─ PlanetGrid.create(divisions) → 生成六边形网格
           │                  ├─ 遍历所有 corner 顶点：
           │                  │   heights[i] = (1 + getHeight × 0.2) × radius
           │                  ├─ 遍历所有 tile 六边形：
           │                  │   ├─ getColor(tile.center) → 该 tile 的颜色
           │                  │   ├─ 计算三角形法线
           │                  │   └─ 把每个 corner 的 (位置, 法线, 颜色) 写入 VBO
           │                  └─ 输出：GPU 顶点缓冲 (VBO)

游戏运行时，每帧（~60fps）
  │
  └→ PlanetRenderer.render()
      ├─ Gl.clear(深度缓冲) + Gl.enable(深度测试) + Gl.depthMask(true)
      │
      └→ renderPlanet()
          └→ planet.draw()
              └→ MultiMesh.render(projection, transform)
                  └→ for i = 0 to 4:  // 按 JSON 数组顺序
                      NoiseMesh[i].render()
                      ├─ preRender() → 设置光照方向 uniform
                      ├─ shader.bind() → 绑定 planet shader
                      └─ GPU 绘制三角形
                          │
                          ├─ Vertex Shader (planet.vert):
                          │   ├─ 读取顶点位置 = (1+noise×mag×0.2)×radius
                          │   ├─ 读取顶点颜色 = getColor() 回调的输出
                          │   ├─ 乘以 MVP 矩阵 → 屏幕坐标
                          │   ├─ 光照计算：漫反射 × (环境光 + 镜面高光)
                          │   ├─ 颜色调制：a_color × 光照
                          │   └─ 传递 v_col 给 Fragment Shader
                          │
                          └─ Fragment Shader (planet.frag):
                              ├─ 直通 v_col → gl_FragColor
                              ├─ 深度测试：该像素深度 < 深度缓冲当前位置的值？
                              │   ├─ 是 → 绘制像素，写入深度缓冲
                              │   └─ 否 → 丢弃像素（被前面的层遮挡）
                              └─ 输出到帧缓冲
```

---

### 2.6 核心参数速查

| JSON 字段 | 作用对象 | 控制什么 | 增大效果 | 减小效果 |
|-----------|---------|---------|----------|----------|
| `radius` | 整层球体 | 球体基础半径（等比缩放所有顶点） | 整层变大，更容易覆盖前层 | 整层变小，容易被前层遮挡 |
| `mag` | 几何噪声 | 顶点位移幅度 | 球面更凹凸，更容易穿透前层 | 球面更平滑，更容易被遮挡 |
| `colorScale` | 颜色噪声 | 色块的空间尺度 | 色块更大（大陆状） | 色块更小（胡椒盐状） |
| `colorThreshold` | 颜色噪声 | color1 与 color2 的分界 | color2（通常亮色）更少 | color2 更多 |
| `colorOct` | 颜色噪声 | 颜色边界的复杂度 | 边界更锯齿 | 边界更平滑 |
| `octaves` | 几何噪声 | 地形细节层数 | 地形更崎岖 | 地形更平滑 |
| `scale` | 几何噪声 | 地形起伏的空间频率 | 起伏更稀疏 | 起伏更密集 |
| `seed` | 所有噪声 | 噪声的随机种子 | 不同 seed → 不同地形形状 | — |
| `divisions` | 球面网格 | 六边形细分等级 | 顶点更密、球面更圆滑 | 顶点更疏（性能更好） |

---

## 三、踩坑全记录

### 坑 1：蓝绿色区分度极低（第一轮尝试）

**现象**：星球表面蓝绿混成一团。

**原始 JSON**（AI 主题配色）：
```jsonc
{ "color1": "6b5b8a", "color2": "4a4060" }          // 紫灰色
{ "color1": "4ec9a040", "color2": "2d8a6e40" }      // 半透明蓝绿
```

**第一轮修改**：
```jsonc
{ "color1": "1a3a5c", "color2": "1a4a4a" }          // 深海蓝 → 深蓝绿
{ "color1": "2d6e3f", "color2": "4a8a4a" }          // 森林绿
```

**根因**：
1. 两种颜色都是暗色（RGB 值在 0x1a-0x4a 范围），在背光面经 fragment shader 压暗后几乎不可分辨色相差异。
2. 缺少 `colorScale` 和 `colorThreshold` → 使用默认值 `colorScale=1.0`、`colorThreshold=0.5`。`colorScale=1.0` 产生细碎斑点而非大陆形状；`colorThreshold=0.5` 让两种颜色约各 50%。
3. 海洋层的 `color2: "1a4a4a"` 本身含绿色调（RGB 的 G 通道与 B 通道相等），色相偏蓝绿而非纯蓝。

**修复**：提亮颜色；给两色层显式添加 `colorScale=3.0` 和 `colorThreshold=0.48`。

---

### 坑 2：只有绿色，黄白灰全部消失（第二轮尝试）

**现象**：星球完全绿色，沙漠和山脉层不可见。

**此时 JSON**：
```jsonc
海洋:   radius=0.70, mag=0.4
森林:   radius=0.68, mag=0.55
沙漠:   radius=0.66, mag=0.45
山脉灰: radius=0.64, mag=0.35
山脉白: radius=0.62, mag=0.25
```

**根因——这是本次调试最核心的发现**：

代入公式 `(1 + noise×mag×0.2) × radius`，计算各层的极端距离（noise3d=±1）：

| 层 | radius | mag | 最大距离 | 最小距离 |
|----|--------|-----|---------|---------|
| 海洋 | 0.70 | 0.4 | **0.756** | 0.644 |
| 森林 | 0.68 | 0.55 | **0.755** | 0.605 |
| 沙漠 | 0.66 | 0.45 | **0.719** | 0.601 |
| 山脉灰 | 0.64 | 0.35 | **0.685** | 0.595 |
| 山脉白 | 0.62 | 0.25 | **0.651** | 0.589 |

沙漠层最大距离 0.719 **<** 森林层最大距离 0.755。沙漠层的所有顶点都在森林层几何体内部。由于 PlanetRenderer 开启了深度测试 + 深度写入，沙漠层在渲染时每个像素都被深度测试丢弃——完全不可见。

**对比**：Vanilla Expansion 的 `cyclant.json` 所有层 radius 几乎相同（1.0/1.0/0.982），依靠不同 seed 让每层在不同位置竞争高低。

**我们的错误**：认为"逐层递减 radius"可以模拟地形分层，但 radius 是等比缩放而非高度偏移。

**修复**：所有层统一 `radius=0.7`，通过 `mag` 和不同 seed 产生高度差异。

---

### 坑 3：黄白灰过多过密——"葱花鸡蛋"（第三轮尝试）

**现象**：统一 radius 后所有颜色可见，但黄白灰碎块过多，像葱花撒在鸡蛋上。

**此时 mag**：海洋 0.3, 森林 0.45, 沙漠 0.45, 山脉灰 0.45, 山脉白 0.45。

**根因**：所有层 mag 相同 → 每层穿透前层的概率约 50%。五层各约一半区域可见 → 所有颜色均匀混合。沙漠 layer 约 50% 区域覆盖森林，colorThreshold=0.55 下约一半显示亮黄 → 最终约 25% 表面是亮黄色。

**修复**：递减 mag。使后渲染的层只在噪声极高的位置穿透前层。

---

### 坑 4：绿色过多，海洋几乎不可见（第四轮尝试）

**现象**：海洋蓝色消失。

**此时 mag**：海洋 0.25, 森林 0.40。

**根因**：`noise_forest × 0.40 > noise_ocean × 0.25` 在约 75% 的区域成立，森林层大面积高于海洋层。

**修复**：森林 mag 降至 0.30，与海洋同级，恢复 50/50 竞争。

---

### 坑 5：山脉灰白完全不可见（第五轮尝试）

**现象**：海洋和绿色比例正常，山脉不可见。

**此时 mag**：海洋 0.30, 森林 0.30, 沙漠 0.18, 山脉灰 0.15, 山脉白 0.12。

**根因**：山脉层需要同时穿透前三层。三层独立噪声的联合最大值期望偏向正值，使实际穿透概率远低于单层估算（~10% → ~2-3%），再加 colorThreshold=0.65 过滤后不可见。

**修复**：山脉灰 mag=0.22、山脉白 mag=0.20，同时 colorThreshold 降至 0.55/0.58。

---

## 四、最终参数方案

```jsonc
[
  { // 第1层：纯蓝海洋基底（单色，不混合）
    "type": "NoiseMesh", "seed": 42,
    "color": "1050a0",
    "radius": 0.7, "mag": 0.30
  },
  { // 第2层：绿色森林大陆
    "type": "NoiseMesh", "seed": 77,
    "color1": "1d7a28", "color2": "3db840",
    "radius": 0.7, "mag": 0.30,
    "colorScale": 3.0, "colorThreshold": 0.48
  },
  { // 第3层：黄色沙漠斑块
    "type": "NoiseMesh", "seed": 131,
    "color1": "b8a050", "color2": "d0c068",
    "radius": 0.7, "mag": 0.18,
    "colorScale": 5.0, "colorThreshold": 0.62
  },
  { // 第4层：灰色山脉暗面
    "type": "NoiseMesh", "seed": 199,
    "color1": "7a7a7a", "color2": "9a9a9a",
    "radius": 0.7, "mag": 0.22,
    "colorScale": 7.0, "colorThreshold": 0.55
  },
  { // 第5层：白色山脉亮面/冰盖（带 alpha 柔和融入）
    "type": "NoiseMesh", "seed": 241,
    "color1": "c0c8c080", "color2": "d8e0d860",
    "radius": 0.7, "mag": 0.20,
    "colorScale": 9.0, "colorThreshold": 0.58
  }
]
```

| 层 | radius | mag | colorScale | colorThreshold | 估计可见比例 |
|----|--------|-----|------------|---------------|-------------|
| 🌊 海洋 | 0.70 | 0.30 | — | — | ~50% |
| 🌲 森林 | 0.70 | 0.30 | 3.0 | 0.48 | ~50% |
| 🏜️ 沙漠 | 0.70 | 0.18 | 5.0 | 0.62 | ~18% |
| ⛰️ 山脉灰 | 0.70 | 0.22 | 7.0 | 0.55 | ~12% |
| 🏔️ 山脉白 | 0.70 | 0.20 | 9.0 | 0.58 | ~8% |

---

## 五、调参方法论总结

### 5.1 核心法则

1. **所有层的 `radius` 必须相同**（或接近相等）。radius 是等比缩放因子——逐层递减会导致内层完全被外层遮挡（深度测试）。

2. **通过 `mag` 的梯度控制地形层级。** mag 决定顶点能向外凸出多远。后渲染的层 mag 应小于前层，使它们在多数区域低于前层，仅在噪声值极高处穿透。递减原则：海洋≈森林 > 山脉灰≈山脉白 > 沙漠。

3. **`colorScale` 控制色块尺寸。** 值越大色块越大。从低到高递增（3→5→7→9）。

4. **`colorThreshold` 控制亮色（color2）占比。** < 0.5 亮色多，> 0.5 暗色多。通常 0.48-0.65。

5. **不同层的 `seed` 必须不同。** 否则两层噪声完全相同，失去多层叠加的意义。

### 5.2 调参顺序

```
① 调海洋基底（单色，固定）
② 加森林层，调 mag 使海/绿 ≈ 50/50
③ 加沙漠层，调 mag 稀疏可见（~15-20%）
④ 加山脉灰/白层，调 mag 更稀疏（~8-12%）
⑤ 微调 colorScale 和 colorThreshold
```

### 5.3 常见错误速查

| 错误现象 | 原因 |
|---------|------|
| 只有最外层颜色 | radius 逐层递减 |
| 胡椒盐混合 | colorScale 太小（默认 1.0） |
| 某色过多 | 该层 mag 过大 |
| 某色完全不可见 | 该层 mag 过小，或被多层联合竞争压制 |
| 亮色碎块多 | colorThreshold 太低 |

---

## 六、附：完整 JSON 与逐层参数讲解

> 下面是 `viar.json` 中 `"mesh"` 字段的完整内容。读完它，你应该能准确说出"这个 JSON 定义了多少层 mesh、每一层是什么、为什么参数这么写"。

### 6.0 完整 JSON

```jsonc
"mesh": {
    "type": "MultiMesh",
    "meshes": [
        // ═══════════════════════════════════════════
        // 第1层：海洋基底 🌊
        // ═══════════════════════════════════════════
        {
            "type": "NoiseMesh",
            "planet": "viar",
            "seed": 42,
            "color": "1050a0",
            "divisions": 5,
            "radius": 0.7,
            "octaves": 7,
            "persistence": 0.5,
            "scale": 1.5,
            "mag": 0.3
        },
        // ═══════════════════════════════════════════
        // 第2层：绿色森林大陆 🌲
        // ═══════════════════════════════════════════
        {
            "type": "NoiseMesh",
            "planet": "viar",
            "seed": 77,
            "color1": "1d7a28",
            "color2": "3db840",
            "divisions": 5,
            "radius": 0.7,
            "octaves": 6,
            "persistence": 0.5,
            "scale": 1.8,
            "mag": 0.30,
            "colorOct": 3,
            "colorPersistence": 0.5,
            "colorScale": 3.0,
            "colorThreshold": 0.48
        },
        // ═══════════════════════════════════════════
        // 第3层：黄色沙漠斑块 🏜️
        // ═══════════════════════════════════════════
        {
            "type": "NoiseMesh",
            "planet": "viar",
            "seed": 131,
            "color1": "b8a050",
            "color2": "d0c068",
            "divisions": 5,
            "radius": 0.7,
            "octaves": 5,
            "persistence": 0.5,
            "scale": 2.2,
            "mag": 0.18,
            "colorOct": 2,
            "colorPersistence": 0.5,
            "colorScale": 5.0,
            "colorThreshold": 0.62
        },
        // ═══════════════════════════════════════════
        // 第4层：灰色山脉暗面 ⛰️
        // ═══════════════════════════════════════════
        {
            "type": "NoiseMesh",
            "planet": "viar",
            "seed": 199,
            "color1": "7a7a7a",
            "color2": "9a9a9a",
            "divisions": 4,
            "radius": 0.7,
            "octaves": 4,
            "persistence": 0.5,
            "scale": 2.5,
            "mag": 0.22,
            "colorOct": 2,
            "colorPersistence": 0.5,
            "colorScale": 7.0,
            "colorThreshold": 0.55
        },
        // ═══════════════════════════════════════════
        // 第5层：白色山脉亮面/冰盖 🏔️
        // ═══════════════════════════════════════════
        {
            "type": "NoiseMesh",
            "planet": "viar",
            "seed": 241,
            "color1": "c0c8c080",
            "color2": "d8e0d860",
            "divisions": 4,
            "radius": 0.7,
            "octaves": 3,
            "persistence": 0.5,
            "scale": 3.0,
            "mag": 0.20,
            "colorOct": 2,
            "colorPersistence": 0.5,
            "colorScale": 9.0,
            "colorThreshold": 0.58
        }
    ]
}
```

**一眼看出的结论**：`type: "MultiMesh"` 包裹了一个 `meshes` 数组，数组里有 **5 个元素**。每个元素 `type: "NoiseMesh"` → ContentParser 会为每个元素调用 `new NoiseMesh(...)` → 产生 5 个独立的 GPU Mesh → 运行时 MultiMesh 按 0→1→2→3→4 的顺序逐层渲染。这就是"五层 mesh"的来由。

---

### 6.1 逐层参数精讲

> 对所有层通用的字段先说清楚：
> - `"planet": "viar"` — 关联到哪个星球（用于获取位置、自转等运行时数据）
> - `"persistence": 0.5` — 分形噪声中相邻频率层的振幅衰减。0.5 是 Mindustry 标准值，不需调整
> - `"colorPersistence": 0.5` — 颜色噪声的振幅衰减，同上

---

#### 第1层：海洋基底 🌊

```jsonc
{ "type": "NoiseMesh", "seed": 42, "color": "1050a0",
  "divisions": 5, "radius": 0.7, "octaves": 7,
  "persistence": 0.5, "scale": 1.5, "mag": 0.3 }
```

| 参数 | 值 | 为什么这么写 |
|------|----|------------|
| `type` | `NoiseMesh` | 需要程序化地形 + 顶点颜色 |
| `seed` | `42` | 与其他层不同即可。42 是海洋专用种子——如果和森林 seed 相同，海洋和森林的凹凸地形完全重合，森林会均匀覆盖海洋，失去"大陆漂浮在海上"的效果 |
| `color` | `1050a0` | **单色模式**。只写 `color` 不写 `color1`/`color2` → ContentParser 把 `color1` 和 `color2` 都设为同一个值 → 触发单色变体构造函数（`getColor()` 直接返回这个颜色，不经过噪声选择）。`#1050a0` 是中等饱和度的深蓝色——不偏绿（避免和森林混淆）、不偏紫（避免和原 AI 主题色混淆）、亮度适中（背光面也不会变全黑） |
| `divisions` | `5` | 六边形细分等级。5 产生约 10,000+ 顶点，球面足够圆滑。海洋是最里层，顶点密度应该最高（它为后续所有层提供"基准球面"） |
| `radius` | `0.7` | **所有层必须相同**（坑 2 的核心教训） |
| `octaves` | `7` | 地形细节层数。7 层 octave 意味着海洋地形有丰富的波浪状起伏。海洋不需要太崎岖（那是山脉的工作），但也不能太平滑（否则森林层无处可"穿透"） |
| `scale` | `1.5` | 噪声空间频率。1.5 比默认 1.0 略大 → 起伏更稀疏、更大块。让海洋的"盆地"和"脊线"尺度与森林层协调 |
| `mag` | `0.3` | 顶点位移幅度。与森林层 **相同**（`mag=0.30`）→ 两个球体的噪声凹凸范围相同 → 在约 50% 的区域海洋高于森林、50% 的区域森林高于海洋 → 海绿各半（坑 4 纠正后的值） |

**渲染时发生了什么**：第1层最先渲染。GPU 把整个海洋网格的深度值写满深度缓冲。之后每一层只有噪声值高于海洋对应位置噪声值的顶点才能穿透——那些位置显示后层颜色，其余位置保持海洋蓝色。

---

#### 第2层：绿色森林大陆 🌲

```jsonc
{ "type": "NoiseMesh", "seed": 77,
  "color1": "1d7a28", "color2": "3db840",
  "divisions": 5, "radius": 0.7, "octaves": 6,
  "persistence": 0.5, "scale": 1.8, "mag": 0.30,
  "colorOct": 3, "colorPersistence": 0.5,
  "colorScale": 3.0, "colorThreshold": 0.48 }
```

| 参数 | 值 | 为什么这么写 |
|------|----|------------|
| `seed` | `77` | 不同于海洋的 42——两层噪声分布独立 → 森林的凸起和海洋的凸起在不同位置 → 产生"大陆嵌在海洋中"的镶嵌效果 |
| `color1` | `1d7a28` | 深森林绿。RGB(29,122,40)——低亮度、中等饱和度的绿色，模拟茂密植被的暗面 |
| `color2` | `3db840` | 亮森林绿。RGB(61,184,64)——比 color1 亮约 50%，模拟阳光下的植被。两色色相相同（绿色），只在亮度上变化 → 同一层内视觉统一 |
| `mag` | `0.30` | **与海洋相同**。这是经过坑 4 校正后的值。最初 `mag=0.40` 导致绿色覆盖 ~75% 表面（森林噪声 ×0.40 > 海洋噪声 ×0.30 的概率太高）。降至 0.30 → 50/50 竞争 |
| `colorScale` | `3.0` | 色块空间尺度。3.0 比默认 1.0 大三倍 → 色块从"胡椒盐碎点"变为"小型大陆"，产生可辨认的绿色陆地块。不宜更大——森林应该是破碎的（零散林地），不需要沙漠那样的整片色块 |
| `colorThreshold` | `0.48` | 亮暗分界。0.48 < 0.5 → 约 52% 顶点用 `color2`（亮绿）、48% 用 `color1`（暗绿）。亮色略多使森林整体不显得阴沉 |
| `colorOct` | `3` | 颜色噪声的 octaves。3 层叠加使亮暗边界有适度的锯齿状——模拟森林边缘的不规则形状 |
| `octaves` | `6` | 地形 octaves 比海洋少 1 层，比沙漠多 1 层——地形复杂度在中位 |
| `scale` | `1.8` | 比海洋 1.5 略大 → 森林的地形起伏稍稀疏、更大块，和海洋形成差异 |

**渲染时发生了什么**：第2层在第1层之后渲染。深度缓冲已有海洋的所有深度值。森林的 `mag=0.30` 与海洋相同 → 在噪声值更高的位置（约 50%）覆盖海洋。在噪声值更低的位置海洋顶点更靠外 → 森林像素被深度测试丢弃 → 露出海洋蓝色。第0章的 ASCII 图中，第2层（森林）有时凸出覆盖海洋、有时凹陷露出海洋。

---

#### 第3层：黄色沙漠斑块 🏜️

```jsonc
{ "type": "NoiseMesh", "seed": 131,
  "color1": "b8a050", "color2": "d0c068",
  "divisions": 5, "radius": 0.7, "octaves": 5,
  "persistence": 0.5, "scale": 2.2, "mag": 0.18,
  "colorOct": 2, "colorPersistence": 0.5,
  "colorScale": 5.0, "colorThreshold": 0.62 }
```

| 参数 | 值 | 为什么这么写 |
|------|----|------------|
| `seed` | `131` | 不同于前两层——沙漠只出现在地球上特定的地理位置，噪声分布必须独立 |
| `color1` | `b8a050` | 土黄色。RGB(184,160,80)——中等亮度的暖黄色，模拟干旱荒漠 |
| `color2` | `d0c068` | 亮沙色。RGB(208,192,104)——比 color1 更亮更黄，模拟阳光直射的沙丘亮面 |
| `mag` | `0.18` | **远小于海洋/森林的 0.30**。这是沙漠层最关键的参数。mag=0.18 意味着沙漠噪声极值（±0.18）远小于海洋/森林（±0.30）。对任意一个球面位置，沙漠顶点高度超过海/绿顶点高度的概率约 15-20%（坑 3/4 校正后）。这恰好模拟了地球上沙漠只覆盖少部分陆地的事实 |
| `colorScale` | `5.0` | 比森林的 3.0 更大 → 沙漠色块更大更连续，形成"撒哈拉式"的整片沙漠，而非零散斑点 |
| `colorThreshold` | `0.62` | > 0.5 → 暗色（`color1`，土黄）占 62%，亮色（`color2`，亮沙）占 38%。沙漠整体偏暗黄色调，亮沙作为点缀 |
| `octaves` | `5` | 比森林少 1 层——沙漠地形不需要太崎岖 |
| `scale` | `2.2` | 比海洋/森林都大——沙漠起伏更稀疏、更平坦 |

**为什么 mag=0.18 而不是 0.22？** 沙漠是"中间层"——它需要同时穿透海洋和森林才能被看到。如果 mag 过大（如坑 3 的 0.45），沙漠会像葱花一样撒满球面，不像地球。0.18 刚好让沙漠在 ~18% 的表面可见——稀疏但不消失。

**渲染时发生了什么**：第3层渲染时需同时竞争第1、第2层的深度值。在某个像素位置，只有当沙漠噪声值 > max(海洋噪声值, 森林噪声值) 时沙漠才可见。这个概率远小于 50%（因为 max 是两个随机变量的最大值，期望偏向正值），所以 mag 设在 0.18。可见区域约 18% → 其中有 colorThreshold=0.62，约 62% 显示暗土黄、38% 显示亮沙 → 最终约 7% 表面是亮沙色。

---

#### 第4层：灰色山脉暗面 ⛰️

```jsonc
{ "type": "NoiseMesh", "seed": 199,
  "color1": "7a7a7a", "color2": "9a9a9a",
  "divisions": 4, "radius": 0.7, "octaves": 4,
  "persistence": 0.5, "scale": 2.5, "mag": 0.22,
  "colorOct": 2, "colorPersistence": 0.5,
  "colorScale": 7.0, "colorThreshold": 0.55 }
```

| 参数 | 值 | 为什么这么写 |
|------|----|------------|
| `seed` | `199` | 独立噪声分布 |
| `color1` | `7a7a7a` | 中性灰。RGB(122,122,122)——模拟岩石的暗面，无色彩倾向 |
| `color2` | `9a9a9a` | 浅灰。RGB(154,154,154)——比 color1 亮约 25%，模拟被光照亮的岩石面。两色完全相同色相（灰色），仅亮度有别 |
| `mag` | `0.22` | **比沙漠的 0.18 大、比森林的 0.30 小**。这个看似反常的设定（山脉不该比沙漠更靠外吗？）是坑 5 纠正的结果。山脉需要同时穿透前 3 层（海洋 + 森林 + 沙漠），三层独立随机变量的联合最大值在统计学上比单层噪声显著偏高。mag=0.15 时山脉几乎不可见（实际穿透概率 ~2-3%），加大到 0.22 才恢复到约 12% 可见比例 |
| `colorScale` | `7.0` | 比沙漠更大 → 山脉是大块连续的，模拟真实的安第斯/喜马拉雅尺度 |
| `colorThreshold` | `0.55` | 略偏暗色（`color1` 占 55%），让山脉整体呈灰色调。如果阈值太低（如 0.3），亮灰色块过多，会和雪峰层混淆 |
| `divisions` | `4` | 比前三层少一级（4 vs 5）。山脉在最外层，距摄像机最近，不需要最密的网格。降低 divisions 可节省约 40% 的顶点数而不影响视觉质量 |
| `octaves` | `4` | 山脉地形比沙漠更平滑——山脉是大型地质构造，不需要 6-7 层高频细节 |

**为什么 mag=0.22 > 沙漠的 0.18？** 这不是错误。沙漠虽然在"地形顺序"上高于海洋/森林，但它的 mag 设得很小（0.18）来保证稀疏。山脉 mag=0.22 比沙漠大——因为山脉需要同时竞争海洋、森林、沙漠三层。如果 mag 太小，三层的联合最大值会完全压制山脉。0.22 是经过坑 5 调校后的平衡点。

---

#### 第5层：白色山脉亮面 / 冰盖 🏔️

```jsonc
{ "type": "NoiseMesh", "seed": 241,
  "color1": "c0c8c080", "color2": "d8e0d860",
  "divisions": 4, "radius": 0.7, "octaves": 3,
  "persistence": 0.5, "scale": 3.0, "mag": 0.20,
  "colorOct": 2, "colorPersistence": 0.5,
  "colorScale": 9.0, "colorThreshold": 0.58 }
```

| 参数 | 值 | 为什么这么写 |
|------|----|------------|
| `seed` | `241` | 独立噪声分布。与山脉灰层 seed 不同 → 雪峰不完全覆盖在灰色山脉的正上方（否则看起来像"给山脉戴白帽子"，太人工），而是与灰色山脉有偏移的重叠 |
| `color1` | `c0c8c080` | 半透明白色。RGB(192,200,128)，alpha=0x80≈0.5。alpha 通道在这里的作用是降低镜面高光（shader 中 `albedo = 1.0 - a_color.a`），让雪峰的反射更柔和、不会闪瞎眼。RGB 各通道偏高（192-200），略带蓝绿底色（模拟冰的冷色调） |
| `color2` | `d8e0d860` | 更亮的半透明白。alpha=0x60≈0.375，比 color1 更透明 → 亮面上反光更柔和 |
| `mag` | `0.20` | 比山脉灰的 0.22 略小——雪峰是山脉的"冠冕"，应该只出现在山脉灰已经凸出的位置中噪声最高的子集。同一地理位置，山脉灰高出三层后，雪峰还需要比山脉灰更高 → 需要叠加概率。mag=0.20 在联合竞争下产生约 8% 的可见比例（稀有） |
| `colorScale` | `9.0` | 五层中最大。雪峰/冰盖是地球上最大尺度的地形特征（南极冰盖、喜马拉雅雪顶），用最大的色块尺度模拟 |
| `colorThreshold` | `0.58` | > 0.5 → 约 58% 用暗白、42% 用亮白。暗白略多，整体不会过于刺眼 |
| `octaves` | `3` | 五层中最少。雪峰的地形是最平滑的——冰川和积雪覆盖会抚平地形细节 |
| `scale` | `3.0` | 五层中最大。雪峰的起伏非常稀疏，对应现实中冰盖覆盖广袤平坦区域的特征 |
| `divisions` | `4` | 与山脉灰同级别 |

**为什么 alpha 通道不是 0xFF？** `color1: "c0c8c080"` 的 alpha=0x80（半透明）、`color2: "d8e0d860"` 的 alpha=0x60（更透明）。这里 alpha 不是用来做透明度混合的（glBlend 没有开启），而是通过 shader 中的 `albedo = 1.0 - a_color.a` 来抑制镜面高光的强度。alpha 越小 → albedo 越大 → 高光越弱 → 雪峰看起来是哑光的（像真实的雪），而不是塑料般的反光表面。

**渲染时发生了什么**：第5层是最后渲染的层。它在所有前四层之后提交给 GPU。要可见，雪峰的噪声值必须同时超过海洋、森林、沙漠、山脉灰四层的噪声值——四层独立随机变量的联合最大值。mag=0.20 下实际穿透概率约 8%。在那些位置，雪峰的半透明白色覆盖在山脉之上，alpha 通道使高光柔和——最终效果像雪或冰盖覆盖在山脊之上。

---

### 6.2 五层叠加的完整视觉模型

```
你可以把每一帧的渲染想象成以下过程（按时间顺序）：

GPU 清空深度缓冲（所有像素深度 = ∞）

第1层 海洋渲染：
  → 海洋的每个顶点深度写入深度缓冲
  → 屏幕显示：纯蓝球体（有噪声凹凸）

第2层 森林渲染：
  → 每个像素：森林深度 vs 深度缓冲（海洋深度）
  → 森林更近 → 显示绿色，更新深度缓冲
  → 海洋更近 → 保持蓝色，不更新
  → 屏幕显示：蓝底上叠加绿色大陆（约 50% 区域）

第3层 沙漠渲染：
  → 每个像素：沙漠深度 vs 深度缓冲[min(海洋深度, 森林深度)]
  → 沙漠更近 → 显示黄/亮沙色，更新
  → 前两层更近 → 保持原色
  → 屏幕显示：蓝绿底上散落黄色斑块（约 18% 区域）

第4层 山脉灰渲染：
  → 竞争前三层的联合深度
  → 山脉灰更近 → 显示灰色，更新
  → 屏幕显示：灰色山脊隐约出现（约 12% 区域）

第5层 山脉白渲染：
  → 竞争前四层的联合深度
  → 山脉白更近 → 显示白色冰盖，更新
  → 屏幕显示：白色雪峰点缀在山脉和最高处（约 8% 区域）

最终帧缓冲 → 输出到屏幕
```

**为什么各层的可见比例加起来远超 100% 但不冲突？** 因为"可见比例"指的是独立概率（该层单独渲染时可见的顶点占比），但实际像素的最终归属是互斥的——一个像素只能显示一层颜色。最终画面中海洋约 50%、森林约 30%（剩下 20% 被沙漠+山脉覆盖）、沙漠约 10%、山脉灰约 7%、山脉白约 3%——总和 100%，由深度测试的**逐像素仲裁**保证。
