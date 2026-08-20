# debug-005: 科技树机制详解——"JSON 一个字段，游戏一棵树"

> **日期**: 2026-08-20
> **背景**: 参考 VE 模组与游戏源码，分析科技树（Tech Tree）的开发写法，为繁星规划科技树布局。
> **关联文件**:
>
> - `content/blocks/special/sp-damaged-core.json`（繁星，树根节点，已就位）
> - `content/blocks/special/sp-core-mk1.json`（繁星，I 型核心，已挂 sp-silicon）
> - `content/items/*.json`、`content/liquids/*.json`（繁星，变种资源挂树已完成）
> - `scripts/items.js`（繁星，26 个新物品 + 4 个新液体**只有 JS 壳子，尚无 research**）
> - `mod.json`（繁星，`contentOrder` 是时序坑的修复）
> - `Factory/ref/Vanilla-Expansion-Mod-2111/content/`（参考：650 个 JSON 文件带 `research` 字段）
> - `Factory/ref/Vanilla-Expansion-Mod-2111/content/blocks/tech-tree-only/core-nucleus-root.json`（参考：root 写法范例）
> - `Factory/ref/Vanilla-Expansion-Mod-2111/content/blocks/distribution/warp-driver.json`（参考：objectives 写法范例）
> **涉及源码**（Mindustry master 分支）:
> - `core/src/mindustry/content/TechTree.java`（全文 204 行，节点树结构）
> - `core/src/mindustry/content/SerpuloTechTree.java`（原版代码式建树范例，768 行）
> - `core/src/mindustry/mod/ContentParser.java`（第 1268–1423 行，JSON `research` 字段解析）
> - `core/src/mindustry/type/Planet.java`（第 452–458 行，行星自动关联树根）
> - `core/src/mindustry/world/Block.java`（第 1271–1282 行，默认研究成本公式）
> - `core/src/mindustry/ctype/UnlockableContent.java`（第 109–118 行 `loadIcon` 图标 fallback 链；第 205–207 行，物品/液体默认研究成本为空）
> - `core/src/mindustry/mod/Mods.java`（第 382–426 行 `packSprites`，模组贴图打包命名）
> - `core/src/mindustry/game/Objectives.java`（全文，5 种研究目标类型）
> - `core/assets/bundles/bundle_zh_CN.properties`（第 236–238 行，`techtree.<名字>` 本地化 key）
> - `Factory/Starfield/DebuggingHistory/debug-004-模组内容加载机制详解.md`（前作，JS+JSON 双轨制）

---

## 〇、背景与目标

繁星的星球亮了、物品注册了、核心也有了。下一个大问题是：**这些东西在游戏里以什么顺序、什么条件被玩家"解锁"？**

这个问题的答案就是**科技树（Tech Tree）**——Mindustry 战役里唯一的内容解锁体系。玩家在行星界面点开"科技树"，从上到下把节点一个个研究出来，才能解锁建造菜单里的方块、单位，以及发射到新区域的资格。

动手写之前，必须先搞清楚三件事：

1. **VE 参考模组（650 个文件带 research）是怎么写的？**
2. **游戏源码里，科技树到底是怎么从 JSON 长成一棵树的？**
3. **繁星的科技树，照着什么结构写最好？**

本文档的目标：读完它之后，你能**自己看懂** VE 里任何一个 `"research"` 字段在干什么、游戏每一步做了什么，然后照着给繁星的新物品、方块、单位挂上正确的科技树节点。

> 读者水平假设：与 debug-004 相同——了解基本编程概念，**不熟悉 JS/Java 源码**。所有专有名词第一次出现会用**加粗**标出并解释。前作 debug-004 讲的"JS 注册壳子 + JSON 填属性"双轨制是本文档的前置知识。

---

## 一、心智模型：科技树是什么

游戏里有一个看不见的"**科技树登记处**"（源码里叫 `TechTree`）。它维护两样东西：

- **`TechTree.all`**：所有科技节点的总清单（一个节点 = 一个可研究内容 + 它的消耗 + 它的前置条件）。
- **`TechTree.roots`**：所有"树根"的清单。**一棵树 = 一个行星的科技树入口**。点开某颗行星的科技树界面，看到的就是从它的树根往下长出来的整棵子树。

每个节点（源码里叫 `TechNode`）长这样：

```text
TechNode
 ├─ content        → 这个节点代表什么内容（物品/液体/方块/单位）
 ├─ parent/children→ 父亲和孩子们（决定树的分支形状）
 ├─ depth          → 在第几层（根是 0）
 ├─ requirements   → 研究消耗（要交多少材料）
 ├─ objectives     → 额外条件（如"必须先到达某区块"）
 └─ planet         → 属于哪颗行星（子节点自动继承父亲的）
```

**一句话心智模型**：给 JSON 加一行 `"research"` = 告诉游戏"把这份内容挂到科技树上某处"；写 `"root": true` = "从这里新开一棵树，绑到某颗行星上"。

---

## 二、参考模组 VE 是怎么写的

VE 全模组 **650 个 JSON 内容文件**都有 `"research"` 字段——**纯 JSON 声明式，scripts/ 里 grep 不到任何 `TechTree` 代码**。只有两种写法：

### 写法 1：字符串简写（最常见）

parent 指向哪个节点，就挂到哪个节点下面：

```json
// content/units/new-types-sitrullus/zenith-small-sharded.json
"research": "small-unit-constructor-sharded"
```

### 写法 2：对象（功能全）

**树根范例**（`content/blocks/tech-tree-only/core-nucleus-root.json`）：

```json
{
  "requirements": [ "copper/8000", "lead/8000", "thorium/4000", "silicon/5000" ],
  "category": "effect",
  "size": 5,
  "research": {
    "root": true,               // 成为一棵独立树的根
    "planet": "ve-cyclant",     // 绑定行星（该行星的科技树入口）
    "alwaysUnlocked": true,     // 开局即解锁
    "researchCostMultiplier": 0 // 研究免费
  }
}
```

**普通节点**（`content/blocks/turrets/bake.json`）：

```json
"research": { "parent": "rise" }
```

**带区块目标的高级节点**（`content/blocks/distribution/warp-driver.json`）：

```json
"research": {
  "parent": "mass-railgun",
  "objectives": [ { "type": "OnSector", "preset": "warp-tech-base" } ]
}
```

> **单位挂树同理**：`content/units/*.json` 里直接写 `"research": "前置单位名"`，没有别的花样。VE 建"一棵树"全靠 root 节点 + parent 链，**没有任何 JS 建树代码**。

---

## 三、完整例子：一条链从树根走到 I 型核心（Starfield 实况 + VE 对照）

前两节讲了"是什么"和"有哪几种写法"，但比较分散。这一节把它们**串成一个完整例子**：用繁星自己**真实的文件**，一步一步实现下面这条科技链，并在每步对照 VE 的原始文件。

```text
[root] sp-damaged-core（受损核心，开局就有）
 ├─ sp-lead（铅）                ← 第 2 步：物品挂树根
 └─ sp-sand（沙）
      └─ sp-silicon（硅）            ← 第 3 步：物品挂物品
           └─ sp-core-mk1（I 型核心）  ← 第 4 步：方块挂物品
```

> **先消除一个常见误解**：科技树**不是"在一个文件夹里集中建的"**。树根声明确实只有一个（在 `content/blocks/special/` 里，因为它恰好是个 CoreBlock、属于 blocks 类型），但**其他所有内容——物品、液体、方块、单位——都是在自己类型文件夹的 JSON 里写一行 `research` 挂上去的**。文件放哪个文件夹由内容类型决定，跟科技树无关。special 文件夹里只有 root，是因为 root 恰好是"特殊方块"。

### 第 1 步：建树根（唯一需要"开新树"的地方）

`content/blocks/special/sp-damaged-core.json`（现有文件，只看 research 字段）：

```json
"research": {
  "root": true,       // ① 声明"从这里新开一棵树"
  "name": "繁星",      // ② 行星科技树界面显示的树名
  "planet": "viar"    // ③ 把树绑到 viar 行星
}
```

三行的作用：

- ① `root: true`：这棵树**没有父亲**，自己进 `TechTree.roots`。
- ② `name`：行星选择器/科技树界面显示的标题（可被 bundle 的 `techtree.繁星` 覆盖，见 4.7）。
- ③ `planet`：**树与行星绑定的唯一机制**（见 4.4）。viar 初始化时自动执行 `TechTree.roots.find(n -> n.planet == viar)`，找到这棵树作为自己的科技树入口。

VE 对照（`content/blocks/tech-tree-only/core-nucleus-root.json`）——同样的三件套，只是 planet 换成 VE 的行星，另加两行：

```json
"research": {
  "root": true,
  "planet": "ve-cyclant",
  "alwaysUnlocked": true,      // 开局自动解锁（不需要研究）
  "researchCostMultiplier": 0  // 研究费乘 0（免费）
}
```

> 为什么 VE 多这两行？VE 的树根是玩家"已有"的（游戏开局就带着它），不该出现在研究列表里，所以 `alwaysUnlocked` + 免费。繁星的受损核心开局由地图放置、`configurable: false` 不在建造菜单，天然不会被研究，所以没写这两行；以后想让它"可被研究解锁"再调整。

### 第 2 步：挂第一个物品（物品 → 树根）

`content/items/sp-lead.json`（现有文件）：

```json
{
  "color": "8c7fa9",
  "hardness": 1,
  "cost": 0.7,
  "research": {
    "parent": "sp-damaged-core"   // 挂到"受损核心"节点下面
  }
}
```

关键理解：

- **parent 写的是"内容名"（content name），不是文件名、不是文件夹名**。解析器在 `TechTree.all` 里找名字叫 `sp-damaged-core` 的节点（还会自动试带模组前缀的 `Starfield-sp-damaged-core`），找到就把铅挂到它下面。
- 因为 blocks 类型**先于** items 解析，root（方块）天然比铅（物品）先存在——**物品挂方块不会踩时序坑**。
- 研究消耗：物品默认 0 成本 + 自动"产出它"目标（见 4.5、4.6）——所以研究铅 = 弄到一块铅。

VE 对照（`content/items/sitrullus/melon-dirt.json`）：同一件事的**字符串简写**版：

```json
"research": "core-nucleus-root-sitrullus"
```

字符串 = 只写 parent 的简写，效果与 `{ "parent": "..." }` 完全一样。**两种写法随意混用**，VE 两种都有。

### 第 3 步：链式挂载（物品 → 物品）

`content/items/sp-silicon.json`（现有文件）：

```json
{
  "color": "53565c",
  "cost": 0.8,
  "research": {
    "parent": "sp-sand"   // 硅的配方是"沙+煤→硅"，所以挂在沙下面
  }
}
```

挂谁不挂谁，**由玩法逻辑决定，不是技术限制**：硅由沙炼出 → 挂沙（`sp-sand`）；玩家先研究沙、再研究硅，科技树就有"递进感"。如果全挂 root，研究界面就是一层平铺，没有层级。

顺带说明这里的字母序：`sp-sand`（sand）在 `sp-silicon`（silicon）前面（s-a < s-i），parent 先解析，**这条链不踩坑**。反过来 `sp-metaglass → sp-sand` 就会踩（m < s，child 先解析），详见第五节。

### 第 4 步：方块挂物品 + 时序坑实战

`content/blocks/special/sp-core-mk1.json`（现有文件）：

```json
"research": {
  "parent": "sp-silicon"   // I 型核心由"数据链/计算"科技解锁
}
```

这是**方块挂物品**：blocks 类型最先解析，items 在后——`sp-core-mk1` 解析时 `sp-silicon` 还不存在，直接触发第五节说的"isn't in the tech tree"警告。修复 = `mod.json` 的 `contentOrder`，把被引用的物品**提到最前面解析**：

```json
"contentOrder": ["sp-sand", "sp-coal", "sp-water", "sp-silicon"]
```

`contentOrder` 里的四个物品不参与字母序排序、直接最先加载（Mods.java:882），于是 I 型核心挂硅时，硅已经在树里了。

VE 对照：`content/blocks/turrets/bake.json` → `"research": { "parent": "rise" }`——bake 和 rise 都是**方块**，类型相同，bake(b) < rise(r) 也满足"parent 先解析"，VE 不需要 contentOrder。**只有"方块挂物品"这类类型倒挂，才必须借助 contentOrder**。

### 第 5 步：研究成本怎么来的

这条链里：

- 三个物品（铅、沙、硅）——**0 成本** + 自动"产出"目标（默认）。
- I 型核心（方块）——默认按建造需求算（见 4.5 公式）：`requirements` 是 `iron/1000 + sp-lead/1000`，研究费大致 = 每个材料 `60 + 数量^1.11 × 20`，再乘 `researchCostMultiplier`（默认 1）。
- 想改：`"researchCostMultiplier": 0.35`（乘系数）或 `"research": { "requirements": ["iron/500", "sp-silicon/200"] }`（完全自定义）。

### 第 6 步：游戏里实际看到的效果

启动游戏 → 行星界面选 viar → 点"科技树"：

1. 左上角树名显示"繁星"（第 1 步的 `name`）；
2. 根节点是受损核心，下面直接挂着铅和沙——**开局即可研究**；
3. 点硅：显示"需要先研究沙"（因为挂载关系）+ "需要 1 块沙"（Produce 目标）——研究完沙才能研究硅；
4. 点 I 型核心：显示"需要先研究硅" + 材料消耗（第 5 步算出来的）——研究完硅、交完材料，解锁 I 型核心的建造权限；
5. 回到 viar 星球，就能在受损核心周围的核心区域建造 I 型核心了。

**一句话总结全流程**：root 声明"开树+绑行星"（只做一次）→ 每个内容在自己 JSON 里写 `research`，parent 指向"想让它挂在谁下面" → 内容名写对、parent 解析够早，树就长对了。

---

## 四、游戏源码机制拆解

### 4.1 节点树本体（`TechTree.java`，204 行）

这是科技树的"数据结构"文件。要点：

- `TechTree.all` / `TechTree.roots` 两个全局清单。
- `nodeRoot(name, content, children)`：创建树根，`name` 用于行星选择器显示。
- `node(content, requirements, objectives, children)`：创建节点并挂到**当前上下文**（`context` 变量）下——原版代码建树就是靠这个上下文指针递归嵌套的。
- 每个节点构造时会自动做两件事：
  1. 从内容往父亲方向回溯，**继承** `planet`、`researchCostMultipliers`（成本倍率）。
  2. 把内容的**依赖**（`content.getDependencies`）自动变成 `Research` 目标——比如一个方块依赖某种物品，研究它时自动要求先研究该物品。

### 4.2 原版怎么建树（`SerpuloTechTree.java` / `ErekirTechTree.java`）

原版（非模组）的科技树是**代码**写的，格式是嵌套 lambda：

```java
Planets.serpulo.techTree = nodeRoot("serpulo", coreShard, () -> {
    node(conveyor, () -> {
        node(junction, () -> {
            node(router, () -> { ... });
        });
    });
    node(coreFoundation, () -> { ... });
    ...
});
```

括号嵌套 = 树的层级。**这是给游戏本体用的方式，模组不需要这么做**——模组走 3.3 的 JSON 解析器即可。知道它的存在只是为了理解"树最终长什么样"。

### 4.3 JSON 解析器（`ContentParser.java:1268–1423`）——核心中的核心

这是模组科技树的真正入口。`readFields` 一进来就把 `research` 从 JSON 里 **remove 出来单独处理**，完整流程：

1. **取 parent 名**：字符串 → 直接当 parent；对象 → 取 `parent` 字段；都没有且非 root → 警告"不是根节点也没有 parent，忽略"。
2. **取自定义消耗**：`research.requirements` 有则用，没有则留空（后面用内容的默认成本）。
3. **删旧节点**：如果这份内容之前挂过树（比如 patch 原版内容），先把旧节点摘掉。
4. **建节点**：`new TechNode(null, content, requirements)`——注意此时 parent 是 null，是孤儿。
5. **延迟挂接（postreads）**：节点构建排进队列，**按解析顺序**逐一出队执行：
   - 加自定义 objectives；**物品/液体自动补 `Produce`（产出它）目标**；
   - 没有自定义 requirements → 用 `content.researchRequirements()`；
   - 有 `planet` 字段 → 指定行星（root 用）；
   - `root: true` → 加进 `TechTree.roots`，`name` / `requiresUnlock` 生效；
   - 否则 → 在 `TechTree.all` 里找 parent 节点：匹配 `原名` / `模组名-原名` / `SaveVersion.mapFallback(原名)` **三种写法**（所以 JSON 里写简写也行），找到就把节点塞进 parent 的 children、继承 parent 的 planet；找不到就警告"内容不在科技树里，但它要求研究 XXX"。

> **从流程可以看出两个关键点**：
>
> 1. parent 匹配支持简写，但**必须已存在**——这直接导致第五节那个时序坑。
> 2. `root: true` 的节点 `"name"` 字段就是行星科技树界面的标题（配合 bundle 本地化，见 4.7）。

### 4.4 行星自动关联（`Planet.java:452–458`）

行星 `init()` 时执行：

```java
if(techTree == null){
    techTree = TechTree.roots.find(n -> n.planet == this);   // 找 planet 字段等于自己的树根
}
if(techTree != null && autoAssignPlanet){
    techTree.addDatabaseTab(this);   // 把整棵树的内容加进数据库这个行星的标签页
    techTree.addPlanet(this);        // 标记这些内容属于该行星
}
```

**所以 root 节点的 `"planet"` 字段，就是把这棵树挂到行星上的唯一机制**。viar 行星会在 init 时自己找到"繁星"树——这就是为什么 `sp-damaged-core.json` 里那句 `"planet": "viar"` 如此关键。子节点的 planet 是从父亲一路继承下来的，不需要每个都写。

### 4.5 研究成本公式（`Block.java:1271–1282`）

方块（可建造建筑）的默认研究消耗按**建造需求**计算：

```text
每项消耗 = round( 60 × mult + 建造需求数量^1.11 × 20 × mult , 10 )
```

- `mult` = `researchCostMultiplier` 字段（VE 常用 `0.35` 压低后期大件的研究费）。
- 想完全自定义 → `"research": { "requirements": ["iron/500", "sp-silicon/200"] }`。
- 物品/液体**没有默认消耗**（`UnlockableContent.researchRequirements()` 返回空数组）→ 研究它们只需满足 `Produce` 目标（造出它）。
- 树根想开局免费 → `"alwaysUnlocked": true` + `"researchCostMultiplier": 0`（VE 的 root 就是这么写的）。

### 4.6 研究目标类型（`Objectives.java`，全文只有 5 种）

| 类型 | 含义 | 典型用途 |
| --- | --- | --- |
| `Research` | 研究某内容 | 自动从内容依赖生成（4.1 第 2 点） |
| `Produce` | 产出某内容 | 物品/液体自动添加 |
| `SectorComplete` | 通关某区块 | 把科技锁在战役后期 |
| `OnSector` | **到达**某区块 | VE 的主力：`{"type":"OnSector","preset":"warp-tech-base"}` |
| `OnPlanet` | 到达某行星 | 跨行星科技 |

### 4.7 bundle 本地化（`techtree.<名字>` key）

原版示例（`bundle_zh_CN.properties` 第 236–238 行）：

```properties
techtree.select = 切换科技树
techtree.serpulo = 塞普罗
techtree.erekir = 埃里克尔
```

节点显示名规则（`TechTree.java` 的 `localizedName()`）：`Core.bundle.get("techtree." + name, name)` —— **bundle 里有 `techtree.<name>` 就用它，没有就 fallback 到 name 本身**。所以 root 的 `name` 用中文（如"繁星"）也能正常显示，不写 bundle key 也不会崩；想用英文内部名 + 中文显示名，就加一条 `techtree.<内部名> = 繁星`。

### 4.8 节点图标（icon）——默认就是内容贴图，零配置

科技树界面每个节点上的图标（`ResearchDialog` 里 `node.icon()` 画出来的），**默认就是内容自己的贴图**。不需要任何 icon 代码、不需要建任何图标文件：只要内容的贴图存在，节点图标自动就有。VE 的 tech-tree-only 就是证据——scripts 里 grep 不到任何 icon 代码。

机制链路（3 跳，全部自动）：

1. **节点 → 内容**（`TechTree.java:159-161`）：节点没手动设过 `icon` 字段，就返回 `new TextureRegionDrawable(content.uiIcon)`。
2. **uiIcon → 贴图**（`UnlockableContent.java:117-118`）：优先找 `<类型>-<内容名>-ui`（如 `item-sp-lead-ui`），没有就退回 fullIcon。
3. **fullIcon 的 fallback 链**（`UnlockableContent.java:110-116`），从最优先到最次：`fullOverride`（JSON 手动指定）→ `<类型>-<内容名>-full` → `<内容名>-full` → **`<内容名>`** → `<类型>-<内容名>` → `<内容名>1`。

为什么模组"自动命中"：模组贴图打包时（`Mods.java:382-426` 的 `packSprites`），`sprites/` 下所有 png **递归收集**（子目录无所谓，只看文件名），atlas 名 = **`模组名-文件名`**（如 `sprites/items/iron.png` → `Starfield-iron`）；而模组内容名（transformName 处理过）也是 `Starfield-iron`。**两者一致 → 第 4 条 `<内容名>` 直接命中。** 子目录（blocks/items/tech-tree-only/…）纯属组织习惯，不影响加载。

VE 案例：`content/blocks/tech-tree-only/core-nucleus-root.json` 是个"假方块"（`buildVisibility: editorOnly`，不在建造菜单、只活在科技树里）——它的节点图标 = 它自己的贴图 `sprites/blocks/tech-tree-only/core-nucleus-root.png`，自动生效。另注意：`sprites/items/tech-tree-only/lead-node.png` 这类是 `content/unused/` 里**废弃内容**的贴图残留（unused 文件夹不加载），不是当前机制的一部分，别被误导。

想自定义图标（跟建造贴图区分）时：

- 放一张 `<内容名>-ui.png`（如 `sprites/items/sp-lead-ui.png`）→ UI（含科技树节点）用这张，建造/实体仍用原贴图；
- JSON 写 `"fullOverride": "另一张atlas名"` → 强制整条链用指定贴图；
- JS 手动 `node.icon = ...`（JSON 路线不建议混用）。

> ⚠️ **Starfield 现状**：`sprites/` 下 37 张贴图齐全，但 **`blocks/` 目录是空的**——`sp-damaged-core` 和 `sp-core-mk1` 两个 CoreBlock 没有贴图 → fallback 链全落空 → 显示 Arc 的 **error 纹理**（洋红色的错误图）。**科技树根节点图标（受损核心）现在就是 error 纹理**。要修只需补两张图：`sprites/blocks/special/sp-damaged-core.png` 和 `sprites/blocks/special/sp-core-mk1.png`（3×3 方块 = 96×96px，1×1 格 = 32px）。

---

## 五、时序坑：`contentOrder` 规则（务必遵守）

科技树节点在 `ContentParser.finishParsing()` 里**按解析顺序**批量挂接（4.3 的 postreads），而解析顺序 = **ContentType 类型序（block 最先，item/liquid 在后）+ 文件名字母序**（见 debug-004 第五节）。

**规则：parent 的解析必须早于 child**，否则 `ContentParser.java:1405` 报 `"Content 'XXX' isn't in the tech tree"` 警告，节点成孤儿、从科技树消失。

繁星已踩过的 5 个反例（debug-004 第 489 行）：

- `sp-metaglass → sp-sand`、`sp-blast-compound → sp-coal`、`sp-cryofluid → sp-water`、`sp-hydrogen → sp-water`（同类型字母序在后）、`sp-core-mk1 → sp-silicon`（block 先于 item）。

修复 = `mod.json` 的 `contentOrder` 把被引用的 parent 提前解析（`Mods.java:882` 按列表顺序先加载）。当前 `contentOrder`：

```json
"contentOrder": ["sp-sand", "sp-coal", "sp-water", "sp-silicon"]
```

**以后新增内容，parent 若字母序或类型序晚于 child，必须加进 contentOrder。** 这是本项目科技树开发的头号易错点。

---

## 六、Starfield 现状盘点

### ✅ 已有（挂树完成）

| 内容 | 位置 | 备注 |
| --- | --- | --- |
| `sp-damaged-core` | **树根**，`"root": true`、`"name": "繁星"`、`"planet": "viar"` | viar 行星自动挂上这棵树 |
| 11 个变种物品 | 大多直接挂 root；`sp-silicon → sp-sand` 有层级 | 研究 0 成本 + 自动 Produce |
| 5 个变种液体 | 大多挂 root；`sp-hydrogen → sp-water` 有层级 | 同上 |
| `sp-core-mk1` | 挂 `sp-silicon` | 注释已规划：数据链 JSON 补上后改挂 `data-unit` |

### ⚠️ 关键缺口

`scripts/items.js` 里注册的 **26 个新物品 + 4 个新液体**（iron、cobalt、gold、uranium、steel、computer-chip、data-unit、lead-capacitor、nuclear-capacitor、super-capacitor、uranium-fuelrod、thorium-fuelrod、autocannon-ammo、artillery-ammo、missile-ammobox、salt、wood、sulfide、crystal、ice、refined-oil、ethanol、oxygen、natural-gas…）**只有 JS 壳子，没有 JSON 文件，也就没有 research**——它们目前不在任何科技树里，研究界面看不到、战役里无法解锁。

另外：bundle 里还没有 `techtree.繁星` 相关 key（不写也能显示，见 4.7）。

---

## 七、Starfield 科技树该怎么写（建议）

### 7.1 路线选择：继续纯 JSON 声明式

与 VE、与繁星现有代码风格完全一致。**不要混用 JS `TechTree.node()`**——两套体系混用会让 parent 时序更难判断，也违背"壳子归 JS、属性归 JSON"的双轨制。

### 7.2 建议的树结构（分层示意，具体以设计文档为准）

```text
[root] sp-damaged-core（viar，开局免费）
 ├─ 基础资源层：sp-lead / sp-coal / sp-sand / sp-water / iron / salt / wood
 ├─ 中间资源层：
 │   ├─ sp-graphite ← sp-coal
 │   ├─ sp-silicon  ← sp-sand
 │   ├─ steel       ← iron
 │   └─ sp-metaglass / sp-titanium / sp-thorium / sp-plastanium / sp-blast-compound（挂各自原料）
 ├─ 稀有矿层：cobalt / gold / uranium（挂 root 或经挖掘机方块）
 ├─ 电子链（模块化，方便以后插入）：
 │   computer-chip ← sp-silicon → data-unit → advanced-data-unit
 │   └─ 以后 sp-core-mk1 从 sp-silicon 改挂到这里（注释已规划）
 ├─ 能量链：lead-capacitor → nuclear-capacitor → super-capacitor；uranium-fuelrod / thorium-fuelrod
 ├─ 弹药链：autocannon-ammo / artillery-ammo / missile-ammobox
 └─ 新液体层：refined-oil / ethanol / oxygen / natural-gas（挂对应原料或 root）
```

### 7.3 每个新内容只需一行对象

```json
// content/items/steel.json
"research": { "parent": "iron" }

// content/items/computer-chip.json
"research": { "parent": "sp-silicon" }

// content/items/data-unit.json
"research": { "parent": "computer-chip" }
```

注意：如果 `data-unit` 的 JSON 字母序比 `sp-core-mk1` 晚（d < s，实际早），而未来 `sp-core-mk1` 改挂它，要检查双方解析顺序并同步更新 `contentOrder`。

### 7.4 成本策略

- **物品/液体：留默认**（0 成本 + 自动 Produce 目标）——研究物品只需造出它，手感最顺，与 VE 一致。
- **生产方块：** 用 `researchCostMultiplier`（0.3~1.0）微调；要精确控制就写 `"research": { "requirements": [...] }`。
- **核心/特殊方块：** 抄 VE root 写法（`alwaysUnlocked: true` + `researchCostMultiplier: 0`）。

### 7.5 战役锁科技（后续做区块时）

高级科技加 objectives，玩家必须先到达/占领某区块才能研究：

```json
"research": {
  "parent": "mass-driver",
  "objectives": [ { "type": "OnSector", "preset": "你的区块名" } ]
}
```

区块预设要先定义好（`content/sectors/` + 区块地图），VE 的 `warp-tech-base` 是完整范例。

### 7.6 收尾

- bundle 补 `techtree.繁星 = 繁星`（可选，4.7 讲过 fallback）。
- 每新增一个带 research 的 JSON，过一遍第七节的检查清单。

---

## 八、速查清单（新增科技树节点时逐条核对）

1. □ 内容是 UnlockableContent（物品/液体/方块/单位/区块）——只有这些能上科技树。
2. □ `research` 写了：字符串简写 或 对象里的 `parent`。
3. □ parent 存在且**解析早于本内容**（类型序 + 字母序都检查）；不满足 → 加 `contentOrder`。
4. □ 树根（root）节点带了 `"planet"`（写行星内部名，如 `viar`），`alwaysUnlocked: true` + `researchCostMultiplier: 0`。
5. □ 消耗策略选好：默认（靠 `researchCostMultiplier`）/ 自定义（`research.requirements`）/ 免费（root 写法）。
6. □ 需要战役锁的科技加了 objectives（`OnSector` / `SectorComplete` / `OnPlanet`），区块预设已存在。
7. □ bundle 需要的话补了 `techtree.<name>`。
8. □ 物品/液体不需要写 `requirements`（默认 0 成本 + 自动 Produce）。

---

## 附：源码速查索引

| 想查什么 | 去哪看 |
| --- | --- |
| 节点数据结构、继承逻辑 | `content/TechTree.java` |
| 原版代码式建树范例 | `content/SerpuloTechTree.java` |
| JSON research 解析全流程 | `mod/ContentParser.java:1268-1423` |
| 行星 ↔ 树根关联 | `type/Planet.java:452-458` |
| 方块默认研究成本 | `world/Block.java:1271-1282` |
| 物品/液体默认成本 | `ctype/UnlockableContent.java:205-207` |
| 节点图标默认来源 | `TechTree.java` 的 `icon()`、`ctype/UnlockableContent.java` 的 `loadIcon()` |
| 模组贴图打包命名 | `mod/Mods.java:382-426`（`packSprites`） |
| 目标类型清单 | `game/Objectives.java` |
| 树名本地化 | `TechTree.java` 的 `localizedName()`、bundle 的 `techtree.*` |
