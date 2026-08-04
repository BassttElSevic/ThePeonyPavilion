# debug-003: 毕宿四橙巨星创建与恒星渲染问题排查

> **日期**: 2026-08-01  
> **关联文件**:
> - `content/planets/aldebaran.json`（新建）
> - `content/planets/viar.json`（修改）
> - `bundles/bundle.properties`（修改，新增 Aldebaran 条目）
> - `bundles/bundle_zh_CN.properties`（修改，新增毕宿四条目）
> **涉及源码**:
> - `mindustry/type/Planet.java`
> - `mindustry/mod/ContentParser.java`（第 804–862 行星解析、第 1124–1159 mesh 解析）
> - `mindustry/graphics/g3d/SunMesh.java`
> - `mindustry/graphics/g3d/PlanetRenderer.java`（第 43、106–144、171–172 行）
> - `mindustry/game/Universe.java`（第 40–60 行）
> - `mindustry/ui/dialogs/PlanetDialog.java`（第 745–764 行）
> - `mindustry/content/Planets.java`（原版太阳定义）
> - `Factory/ref/Vanilla-Expansion-Mod-2111/content/planets/sol2.json`（参考 mod）
> - `Factory/ref/Vanilla-Expansion-Mod-2111/bundles/bundle.properties`（bundle 键名格式参考）
> - `Factory/ref/Vanilla-Expansion-Mod-2111/bundles/bundle_zh_CN.properties`（bundle 键名格式参考）

---

## 〇、背景与目标

繁星 mod 的行星 `viar` 原本绕原版太阳（`"parent": "sun"`）公转。本次任务：

1. **创建一个新的太阳**——毕宿四（内部名 `aldebaran`），一颗橙巨星（K 型光谱），颜色偏红橙色
2. **让维亚尔行星绕毕宿四公转**，而非原版太阳
3. **毕宿四作为独立太阳系的根节点**——在游戏星球选择界面中作为第二个太阳系出现

最终实现了两个独立的太阳系（原版太阳系 + 毕宿四-繁星星系），但过程中遇到了两个关键渲染问题（恒星不可见、bloom 不触发），需要深入源码逐一排查。

---

## 一、关键概念速览

在开始详细分析之前，回顾三个核心概念：

### 1.1 Planet 的层级结构

Mindustry 中所有的天体都是一棵树的节点：

```
sun (parent=null, 太阳系根)            aldebaran (parent=null, 太阳系根)
├── erekir (绕日)                      └── viar (绕毕宿四)
├── tantros
├── serpulo
└── ...
```

- **`parent = null`** 的行星是太阳系根节点——它不绕任何天体公转，`position` 始终为 `(0,0,0)`
- **`solarSystem`** 字段：每个行星通过 `for(solarSystem = this; solarSystem.parent != null; solarSystem = solarSystem.parent)` 自动向上追溯到根节点。自引用（JSON 中 `"solarSystem": "aldebaran"`）可显式声明为独立太阳系
- **`children`**：子行星列表。构造函数中 `parent.children.add(this)` 自动维护

### 1.2 SunMesh 如何渲染恒星表面

`SunMesh` 继承 `HexMesh`，使用 `Shaders.unlit`（无光照着色器）。其颜色生成逻辑（`SunMesh.java` 第 14-17 行）：

```java
public void getColor(Vec3 position, Color out){
    double height = Math.pow(Simplex.noise3d(0, octaves, persistence, scl,
        position.x, position.y, position.z), pow) * mag;
    out.set(colors[Mathf.clamp((int)(height * colors.length), 0, colors.length - 1)])
        .mul(colorScale);
}
```

用 3D Simplex 噪声在球面上产生一个标量 `height`（0 ~ mag），按比例从 `colors` 数组挑选颜色。噪声平滑连续，所以表面呈现有机的"斑驳"纹理，而非随机胡椒盐噪点。

### 1.3 Bloom（光晕）的触发条件

`PlanetRenderer.java` 第 31-32 行定义 bloom 后处理：

```java
public final Bloom bloom = new Bloom(...){{
    setThreshold(0.8f);  // ← 只有亮度 ≥ 0.8 的像素才触发 bloom
    blurPasses = 6;
}};
```

**阈值 0.8** 意味着：只有 RGB 分量最大值 ≥ 204/255 的颜色才会产生光晕。原版太阳的颜色全部在 `ff` 级别（max 1.0），所以整个表面都在发光。如果颜色太暗，恒星看起来就是一颗不发光的普通球体。

---

## 二、实现方案

### 2.1 参考来源

| 参考 | 用途 |
|------|------|
| `Planets.java:29-44` 原版太阳 | 理解 SunMesh 参数含义和恒星应有的行星字段 |
| `sol2.json`（VE mod） | 参考 JSON 太阳的完整写法：`solarSystem` 自引用、`children` 数组、`bloom`+`accessible` |
| `ContentParser.java:804-862` | 理解 JSON 行星如何被解析为 Planet 对象 |
| `ContentParser.java:1140-1149` | 理解 SunMesh JSON 参数到 Java 构造函数的映射 |

### 2.2 新建文件：`content/planets/aldebaran.json`

最终版本的核心字段（经过问题 1、问题 2 两轮修复后）：

```jsonc
{
  "name": "aldebaran",            // 内部内容名；显示名称通过 bundles 提供
  "radius": 8,                  // 半径（原版太阳=4，巨星需要更大）
  "bloom": true,                // 触发 bloom 后处理光晕
  "hasAtmosphere": false,       // 恒星不需要大气散射
  "accessible": false,          // 不可登陆
  "solarSystem": "aldebaran",   // 自引用 = 独立的太阳系选项卡
  "children": ["viar"],
  "mesh": {
    "type": "SunMesh",
    "divisions": 5,             // 六边形细分等级
    "octaves": 5,               // 噪声倍频（表面纹理的复杂度）
    "persistence": 0.3,         // 分形噪声衰减
    "scl": 2.0,                 // 噪声空间缩放
    "pow": 1.1,
    "mag": 1.0,
    "colorScale": 1.1,          // 全局亮度微调
    "colors": [                 // 深红橙 → 暖金橙（全部 ff 级亮度）
      "ff4a20", "ff6030", "ff7840", "ff7840", "ff9050", "ffb868"
    ]
  }
}
```

### 2.3 修改文件：`content/planets/viar.json`

```diff
- "parent": "sun",
+ "parent": "aldebaran",
- "orbitRadius": 320,
+ "orbitRadius": 24,
- "orbitTime": 24000,
+ "orbitTime": 12000,
```

### 2.4 修改文件：Bundle 本地化 (`bundles/bundle.properties` + `bundles/bundle_zh_CN.properties`)

#### 错误做法（初始版本）

初始版本将显示名称直接硬编码在 JSON 中：`"name": "毕宿四"`。这绕过了 Mindustry 的本地化系统——没有英文回退、不支持多语言，无论玩家语言设置如何，`planet.localizedName` 都返回同一个中文字符串。

#### 正确做法

Mindustry 通过 `.properties` bundle 文件来解析显示名称。JSON 的 `name` 字段应保持为**内部内容标识符**（`"aldebaran"`），而人类可读的名称通过 properties 文件提供，键名格式为：

```
planet.<mod名>-<内容名>.<属性>
```

其中：
- `mod名` = `mod.json` 中 `name` 字段的小写 → `starfield`
- `内容名` = JSON 中 planet 的 `"name"` 字段 → `aldebaran`
- `属性` = `.name`（显示名称）或 `.description`（悬停提示）

此命名规范参考了 VE mod 的 bundles（`planet.ve-cyclant.name` 等）。

#### 新增条目

**`bundles/bundle.properties`**（英文）：
```properties
planet.starfield-aldebaran.name = Aldebaran
planet.starfield-aldebaran.description = An orange giant star, the brightest in the constellation Taurus. Host star of the Starfield system.
```

**`bundles/bundle_zh_CN.properties`**（中文）：
```properties
planet.starfield-aldebaran.name = 毕宿四
planet.starfield-aldebaran.description = 一颗橙巨星，金牛座中最明亮的恒星。繁星星系的宿主恒星。
```

#### Mindustry 如何解析

运行时，`ContentParser` 通过查找 bundle 键来赋值 `Planet.localizedName`。对于 mod 内容，查找键会自动加上 mod 的内部名前缀。星球选择 UI（`PlanetDialog` 第 310 行）用 `star.localizedName` 显示太阳系选项卡标题，用 `planet.localizedName`（第 317 行）显示行星按钮——两者都来源于这些 properties 文件。

### 问题 1：恒星完全不可见 —— 被视锥体的远裁剪面裁掉了

#### 现象

启动游戏后，可以看到**两个太阳系选项卡**（原版太阳系 + 毕宿四星系），说明 `solarSystem` 自引用和 `PlanetDialog` 的星系分组逻辑工作正常。但点击毕宿四星系后，画面中只有 viar 一颗行星孤零零地漂浮在黑暗中——**恒星完全不显示**。

#### 源码定位

`PlanetRenderer.java` 第 43 行：

```java
cam.far = 150f;  // ← 远裁剪面！任何距离摄像机 > 150 的物体不被绘制
```

`PlanetRenderer.java` 第 106–108 行（渲染入口）：

```java
Planet solarSystem = params.planet.solarSystem;
renderPlanet(solarSystem, params);   // 渲染太阳系根节点
renderTransparent(solarSystem, params);
```

`PlanetRenderer.java` 第 132–144 行（`renderPlanet`）：

```java
public void renderPlanet(Planet planet, PlanetParams params){
    if(!planet.visible()) return;
    cam.update();
    if(cam.frustum.containsSphere(planet.position, planet.clipRadius)){  // ← 视锥体检查！
        planet.draw(params, cam.combined, planet.getTransform(mat));
    }
    for(Planet child : planet.children){
        renderPlanet(child, params);
    }
}
```

`cam.frustum.containsSphere()` 检查球体是否在摄像机视锥体内——**六个裁剪面（近/远/左/右/上/下）必须全部通过**。如果球体到摄像机的距离超过 `cam.far=150`，直接丢弃。

`PlanetRenderer.java` 第 70 行（摄像机位置）：

```java
cam.position.set(params.planet.position).add(params.camPos);
```

摄像机定位在**当前选中的行星**（`params.planet`，即 viar）附近。然后调用 `cam.lookAt(params.planet.position)` 让摄像机朝向 viar。

#### 计算验证

当时 viar 的 `orbitRadius = 320`：

```
aldebaran.position = (0, 0, 0)     （无父天体，固定在原点）
viar.position ≈ (320, 0, 0)   （绕毕宿四公转）
摄像机位置 ≈ viar.position + offset ≈ (320 + δ, 0, ε)
摄像机 → aldebaran 距离 ≈ 320
cam.far = 150                     ← 320 > 150, 在远裁剪面之外！
```

**结论**：`cam.frustum.containsSphere(aldebaran.position, aldebaran.clipRadius)` 返回 `false`，恒星从未被绘制。这就是用户看到的"第二个星系没有恒星"。

对比原版太阳系中 serpulo 的 `orbitRadius ≈ 35`（由构造函数自动计算：`sun.totalRadius + orbitSpacing + serpulo.totalRadius`），距离 35 << 150，太阳始终在视锥体内。

#### 修复

将 `orbitRadius` 从 320 降到 24，使毕宿四始终在 `cam.far=150` 范围内。对应缩短 `orbitTime`（按开普勒第三定律 `T ∝ r^1.5` 等比）。

```diff
- "orbitRadius": 320,
+ "orbitRadius": 24,
- "orbitTime": 24000,
+ "orbitTime": 12000,
```

> **为什么选 24？** 原版自动计算为 `6 + 12 + 0.7 = 18.7`。24 稍微宽松，确保恒星在从行星表面看向太空时足够醒目，同时远小于 150 的裁剪边界。

#### 对应 Commit

`0cae246`: fix: 修复毕宿四不可见问题 - orbitRadius过大导致被视锥体裁剪

---

### 问题 2：恒星没有光晕 —— 颜色太暗不触发 Bloom

#### 现象

问题 1 修复后，毕宿四终于出现了，但它看起来只是一颗**暗橙色的球体**，完全没有恒星该有的光晕/发光效果。用户反馈："新加的没有被正确渲染成一颗恒星"。

#### 源码定位

`PlanetRenderer.java` 第 31–32 行：

```java
public final Bloom bloom = new Bloom(...){{
    setThreshold(0.8f);
}};
```

Bloom 后处理的阈值是 **0.8**（RGB 通道最大值 ≥ 204/255 才触发）。

第 84–86 行（bloom 捕获阶段）：

```java
bloom.capture();          // 开始捕获到离屏缓冲
// ... 渲染所有天体（恒星 + 行星）...
bloom.render();           // 对缓冲做模糊 + 叠加
```

渲染流程：先正常绘制所有天体到帧缓冲，同时 bloom 捕获亮度 ≥ 0.8 的像素到一个离屏缓冲。捕获结束后，对离屏缓冲做高斯模糊（`blurPasses=6`），然后叠加回主画面。**只有足够亮的像素才参与这个过程。**

#### 第一版颜色 vs 原版太阳

| 颜色索引 | 第一版 aldebaran | RGB(max) | 原版 sun | RGB(max) |
|---------|-----------------|----------|---------|----------|
| colors[0] | `c53a14` | 0.773 ❌ | `ff7a38` | 1.000 ✓ |
| colors[1] | `d85020` | 0.847 ⚠️ | `ff9638` | 1.000 ✓ |
| colors[2] | `e86830` | 0.910 ✓ | `ffc64c` | 1.000 ✓ |
| colors[3] | `e86830` | 0.910 ✓ | `ffc64c` | 1.000 ✓ |
| colors[4] | `f09040` | 0.941 ✓ | `ffe371` | 1.000 ✓ |
| colors[5] | `f5b058` | 0.961 ✓ | `f4ee8e` | 0.957 ✓ |

- **`c53a14` (max 0.773)**：第一版最暗的颜色，低于 bloom 阈值 0.8。恒星表面的大片暗区完全不发光。
- **`d85020` (max 0.847)**：仅略微超过阈值，处于临界状态。
- 原版太阳的 6 个颜色**全部 ≥ 0.957**，整个表面都在发光。这就是原版太阳看起来光芒四射而毕宿四暗淡无光的根本原因。

#### 修复

将所有颜色提升到 `ff` 级别（RGB max ≥ 0.88），保持色相不变（红橙系），确保整个恒星表面都触发 bloom：

```diff
- "c53a14", "d85020", "e86830", "e86830", "f09040", "f5b058"
+ "ff4a20", "ff6030", "ff7840", "ff7840", "ff9050", "ffb868"
```

同时微调：
- `radius`: 6 → **8**（巨星更醒目）
- `colorScale`: 1.0 → **1.1**（全局亮度微调）
- `hasAtmosphere`: 默认 true → **false**（恒星不需要大气散射，虽然 `parent=null` 时不会渲染大气，显式设为 false 更清晰）
- `iconColor`: `e86830` → **`ff7840`**（匹配新色系）
- `lightColor`: `f0904060` → **`ff905080`**（子行星接收的暖橙色光照）

#### 对应 Commit

`0cae246`（与问题 1 同一 commit）

---

### 问题 3：太阳系独立性 —— solarSystem 自引用与 PlanetDialog 的过滤逻辑

#### 背景

在 `Planet.java` 构造函数（第 220 行）中：

```java
for(solarSystem = this; solarSystem.parent != null; solarSystem = solarSystem.parent);
```

`solarSystem` 自动从父链向上追溯到根节点。因此，如果仅设置 `parent: null`，`solarSystem` 就是自己。但在 JSON 中**显式声明** `"solarSystem": "aldebaran"` 有额外作用——它作为语义标记，配合 `PlanetDialog` 的过滤逻辑生成独立的太阳系选项卡。

#### 源码定位

`PlanetDialog.java` 第 745–764 行（星系选择面板的构建逻辑）：

```java
int starCount = 0;
for(Planet star : content.planets()){
    // 过滤条件 1：必须是自己的太阳系根节点（solarSystem 自引用）
    // 过滤条件 2：必须有至少一个可选中的子行星
    if(star.solarSystem != star
        || !content.planets().contains(p -> p.solarSystem == star && selectable(p)))
        continue;

    starCount++;
    if(starCount > 1)
        starsTable.add(star.localizedName)  // 第二个及之后的太阳系显示标题
            .padLeft(10f).padBottom(10f).padTop(10f).left().width(190f).row();

    // 遍历该太阳系下所有可选中的行星
    for(Planet planet : content.planets()){
        if(planet.solarSystem == star && selectable(planet)){
            // 为每个行星创建按钮
            planetTable.button(planet.localizedName, ...);
        }
    }
}
```

**逻辑解读**：

1. 遍历所有行星，只处理 `star.solarSystem == star` 的（即太阳系根节点）
2. 对于每个太阳系，列出其下所有 `solarSystem == star` 且 `selectable()` 的行星
3. 第二个及之后的太阳系（`starCount > 1`）显示 `star.localizedName` 作为分隔标题
4. 点击行星按钮调用 `viewPlanet(planet, false)`（第 757 行），切换摄像机到该行星

**毕宿四星系满足条件**：`star = aldebaran`，`aldebaran.solarSystem == aldebaran` ✓；`viar.solarSystem == aldebaran`（通过父链追溯）并且 `accessible = true`（可选中）✓。

#### 验证

VE mod 的 `sol2.json` 使用了相同的模式：

```json
{
  "solarSystem": "sol2",
  "parent": "sun",
  "children": ["cyclant", "maress", ...]
}
```

注意 VE 中 sol2 的 `parent: "sun"`——sol2 绕原版太阳公转（在原版太阳系中可见），但 `solarSystem: "sol2"` 使其同时作为独立星系选项卡出现。这是一个恒星同时属于两个太阳系的例子：在原版太阳系中作为远距离亮星可见，点击 sol2 选项卡后进入以 sol2 为中心的视图。

我们的毕宿四选择了 `parent: null`——作为完全独立的太阳系，不绕任何天体公转。

---

## 四、完整修复对比

### aldebaran.json 变更总结

| 字段 | 第一版（问题状态） | 最终版（修复后） | 原因 |
|------|-------------------|-----------------|------|
| `name` | `"毕宿四"` | **`"aldebaran"`** | 内部标识符；显示名称移至 bundles |
| `radius` | 6 | **8** | 巨星更醒目，增大可见面积 |
| `hasAtmosphere` | (默认 true) | **false** | 恒星不需要大气，语义清晰 |
| `iconColor` | `e86830` | **`ff7840`** | 匹配新色系，UI 图标颜色 |
| `lightColor` | `f0904060` | **`ff905080`** | 子行星接收更亮的暖橙光 |
| `colorScale` | 1.0 | **1.1** | 微增全局亮度 |
| `colors[0]` | `c53a14` (0.773) | **`ff4a20`** (1.000) | |
| `colors[1]` | `d85020` (0.847) | **`ff6030`** (1.000) | |
| `colors[2]` | `e86830` (0.910) | **`ff7840`** (1.000) | 全部提升至 ff 级， |
| `colors[3]` | `e86830` (0.910) | **`ff7840`** (1.000) | 确保整个表面触发 |
| `colors[4]` | `f09040` (0.941) | **`ff9050`** (1.000) | bloom（阈值 0.8） |
| `colors[5]` | `f5b058` (0.961) | **`ffb868`** (1.000) | |

### viar.json 变更总结

| 字段 | 第一版 | 最终版 | 原因 |
|------|--------|--------|------|
| `parent` | `"sun"` | **`"aldebaran"`** | 改绕毕宿四公转 |
| `orbitRadius` | 320 | **24** | 原值远超 `cam.far=150` 导致恒星被裁剪 |
| `orbitTime` | 24000 | **12000** | 按开普勒定律等比缩短 |

---

## 五、关键经验

1. **`cam.far = 150f` 是所有天体可见性的硬边界。** 任何子行星的 `orbitRadius` 必须远小于 150，否则恒星会在行星视角中被远裁剪面丢弃。原版 serpulo 的 `orbitRadius ≈ 35` 是一个很好的参考值。

2. **Bloom 阈值 0.8 要求恒星颜色必须足够亮。** `"ff"` 级（RGB ≥ 204）的十六进制颜色才能可靠触发光晕效果。参考原版太阳的全部颜色都在 `ff` 级别。

3. **`solarSystem` 自引用是创建独立太阳系选项卡的关键。** 仅有 `parent: null` 不够——`PlanetDialog` 的过滤逻辑（第 747 行）用 `star.solarSystem != star` 作为判断条件。JSON 中显式声明可以确保行为符合预期。

4. **`orbitRadius` 的显式 JSON 值覆盖构造函数的自动计算。** Planet 构造函数中 `orbitRadius = parent.totalRadius + parent.orbitSpacing + totalRadius`，但 `readFields` 会直接用 JSON 值覆盖。设计轨道距离时需要考虑摄像机裁剪边界。

5. **SunMesh 用 `Shaders.unlit` 渲染，不参与光照计算。** 恒星的外观完全由 colors 数组和噪声参数决定，没有环境光/漫反射/镜面反射的影响。这是正确的——恒星是光源本身，不应该被其他光源照亮。

---

## 六、Commit 历史

| Commit | 分支 | 说明 |
|--------|------|------|
| `4359192` | `feat/aldebaran-star` | 初始创建 aldebaran.json，修改 parent |
| `0cae246` | `fix/aldebaran-visibility` | 修复恒星不可见（orbitRadius）+ bloom 颜色亮度 |
| `a3176e2` | `master` | 添加 bundle 本地化：英文 "Aldebaran"，中文 "毕宿四" |
