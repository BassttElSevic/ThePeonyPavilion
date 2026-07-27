# debug-002: 星球配色调整——蓝绿地球外观

> **日期**: 2026-07-27  
> **关联文件**: `content/planets/peony-pavilion.json`  
> **涉及源码**:
> - `mindustry/graphics/g3d/PlanetRenderer.java`
> - `mindustry/graphics/g3d/NoiseMesh.java`
> - `mindustry/graphics/g3d/MeshBuilder.java`
> - `mindustry/graphics/g3d/MultiMesh.java`
> - `mindustry/graphics/g3d/PlanetMesh.java`
> - `mindustry/mod/ContentParser.java`

---

## 一、背景与目标

牡丹亭 mod 的 `peony-pavilion.json` 原本采用**紫灰+蓝绿**的"AI 主题色"配色方案。本次任务将其改为**类似地球的蓝绿色外观**——蓝色海洋为基底，叠加绿色森林、黄色沙漠、灰色山脉暗面和白色山脉亮面（冰盖/雪峰），实现五层地形的视觉分层。

---

## 二、星球渲染管线详解

> 这一章的目标：从你写的 JSON 出发，追踪到 GPU 如何画出屏幕上的每一个像素。读完它，你就能理解为什么某个参数调大或调小会产生特定的视觉效果。

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

---

### 2.1 第一阶段：JSON 如何变成 NoiseMesh 对象

这一阶段回答：`peony-pavilion.json` 中的 `"radius": 0.7`、`"color1": "1d7a28"` 这些字符串，经过什么代码路径，最终变成 Java 内存中一个可以绘制的 NoiseMesh 实例。

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

**这段代码告诉我们 5 件事：**

**① `type` 字段决定构造哪种 Mesh。** 不写 `"type"` 默认就是 `NoiseMesh`。云层用 `HexSkyMesh`（一个 getColor 函数内判断噪声值是否超过阈值的六边形 mesh），太阳用 `SunMesh`。

**② `color1`/`color2` vs `color` 是一个嵌套回退机制。** 代码 `data.getString("color1", data.getString("color", "ffffff"))` 意味着：
- JSON 写 `"color": "1050a0"` → color1 不存在，回退到 color → 两个颜色位置都拿到 `1050a0` → 调用单色变体构造函数（下文 2.2.1）
- JSON 写 `"color1": "1d7a28", "color2": "3db840"` → 两个颜色不同 → 调用两色变体构造函数
- 两个都不写 → 默认白色

**③ 四个颜色噪声参数 (`colorOct`, `colorPersistence`, `colorScale`, `colorThreshold`) 如果不写，全部走默认值。** 默认 `colorScale=1.0` 导致色块很小（像胡椒盐细碎斑点），默认 `colorThreshold=0.5` 导致两种颜色各约 50%。这两个默认值是导致坑 1（蓝绿区分度低）的直接原因。

**④ 每个 JSON 字段都有默认值。** `data.getFloat("radius", 1f)` 中的第二个参数 `1f` 就是默认值。这意味着哪怕 JSON 只写 `{}`，也会构造出一个可用的 NoiseMesh（半径 1.0，白色，mag=0.5）。

**⑤ `parseMesh()` 是递归的。** 当 JSON 中 `"type": "MultiMesh"` 时，代码会新建 `MultiMesh`，然后递归调用 `parseMeshes()` 解析 `"meshes"` 数组中的每一项。你的 JSON 正是这样：外层是一个 MultiMesh，内层 5 个 NoiseMesh 逐个递归构造。

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

#### 2.4.2 Fragment Shader 中的颜色计算（概念层面）

Mindustry 的星球 fragment shader 大致做以下计算（简化）：

```
最终像素颜色 = 顶点颜色 × (环境光 + 漫反射光照)
              │            │         │
              │            │         └─ max(0, 法线方向 · 光照方向) × 光源颜色
              │            └─ 全局环境光（暗面也不是全黑的）
              └─ 来自噪声层的 getColor() 回调
```

这意味着你 JSON 中的颜色值在最终屏幕上会被"压暗"——背光面颜色值乘以约 0.2-0.3 的环境光系数。所以如果原始颜色本身就很暗（如坑 1 中的 `1a3a5c`），在背光面几乎变成黑色。

---

### 2.5 完整调用链（总结）

```
游戏启动，加载 mod
  │
  └→ ContentParser 解析 peony-pavilion.json
       │
       └→ parseMesh() 解析 "mesh" 字段
           ├─ type=MultiMesh → new MultiMesh()
           └─ 对 meshes[] 中每一项递归调用 parseMesh()
               └→ new NoiseMesh(planet, seed, …, radius, …, mag, …, color1, color2, …, colorScale, colorThreshold)
                   │
                   ├─ 定义 getHeight() 回调：noise3d × mag
                   ├─ 定义 getColor() 回调：
                   │   单色 → 固定颜色
                   │   两色 → noise3d > colorThreshold ? color2 : color1
                   │
                   └─ MeshBuilder.buildHex(mesher, divisions, radius, 0.2)
                       ├─ 遍历球面所有顶点 (PlanetGrid 生成)
                       ├─ 每个顶点：距离 = (1 + getHeight × 0.2) × radius
                       ├─ 每个顶点：颜色 = getColor
                       └─ 输出：GPU 顶点缓冲 (VBO)

游戏运行时，每帧
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
                          ├─ Vertex Shader:
                          │   ├─ 读取顶点位置 = (1+noise×mag×0.2)×radius
                          │   ├─ 乘以 MVP 矩阵 → 屏幕坐标
                          │   └─ 传递颜色和深度给 Fragment Shader
                          │
                          └─ Fragment Shader:
                              ├─ 读取顶点颜色 × 光照(法线·光方向) → 有明暗的像素色
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
