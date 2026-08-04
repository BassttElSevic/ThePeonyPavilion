# debug-004: 模组内容加载机制详解——"JS 注册 + JSON 填属性"双轨制

> **日期**: 2026-08-04  
> **关联文件**:
> - `scripts/main.js`（繁星，当前只有一行 log，后续将扩展）
> - `scripts/items.js`（繁星，**尚未创建**，本次任务目标）
> - `content/items/`（繁星，**尚未创建**，本次任务目标）
> - `sprites/items/`（繁星，33 张物品贴图已就绪，已规范重命名为 kebab-case）
> **涉及源码**（Mindustry master 分支）:
> - `core/src/mindustry/ClientLauncher.java`（第 168–172 行，启动加载顺序）
> - `core/src/mindustry/ctype/Content.java`（构造方法约第 20–23 行，自动注册）
> - `core/src/mindustry/core/ContentLoader.java`（第 175–181 行 `handleContent`、第 179–181 行 `transformName`）
> - `core/src/mindustry/mod/Mods.java`（第 800–830 行 `loadScripts`、第 833–914 行 `loadContent`）
> - `core/src/mindustry/mod/ContentParser.java`（第 578–616 行 block 解析、第 584–593 行 patch 逻辑、第 1270–1337 行 `readFields`）
> - `core/src/mindustry/mod/Scripts.java`（Rhino JS 引擎与 require 模块系统）
> - `core/assets/scripts/global.js`（第 27–43 行 `extend` 函数定义）
> - `Factory/ref/Vanilla-Expansion-Mod-2111/scripts/items.js`（参考，逐行讲解用）
> - `Factory/ref/Vanilla-Expansion-Mod-2111/scripts/blocks.js`（参考，逐行讲解用）
> - `Factory/ref/Vanilla-Expansion-Mod-2111/scripts/main.js`（参考，入口结构）

---

## 〇、背景与目标

繁星的星球已经亮起来了。下一步要写 `scripts/items.js` 和 `content/items/`，把设计文档里的资源真正做进游戏。

但动手之前，必须先搞清楚一个问题：**VE 参考模组为什么要把内容定义拆成"JS 脚本 + JSON 文件"两份？它们之间是什么关系？游戏又是怎么把这两份东西拼成一个物品的？**

本文档的目标是：读完它之后，你能**自己看懂** VE 的 `items.js` / `blocks.js` / `main.js` 每一行在干什么，知道每个名词、每个符号的意思，然后照着写出繁星自己的版本。

> 读者水平假设：了解"程序按顺序执行、变量存值、函数可以调用"这些最基本的概念，但**不熟悉 JS 语法**，也没读过多少 Java 源码。文档里所有专有名词第一次出现都会用**加粗**标出并解释。

---

## 一、心智模型：先把"造对象"和"填属性"分开想

Mindustry 游戏里有一个看不见的"**内容登记处**"（源码里叫 `ContentLoader`）。游戏里所有的物品、方块、液体、单位、行星……都必须先在登记处**登记**，游戏才知道它们存在，玩家才能在建造菜单、科技树、存档里见到它们。

登记处干两件事：

1. **登记（注册）**：把一个"内容对象"放进名单。对象是什么类型（物品还是方块？）、叫什么名字，在这一步定死。
2. **填表（配置）**：给这个对象填各种数值——颜色、硬度、血量、大小……这些数值**之后随时可以再填**。

VE 的写法就是把这个过程拆成了两个文件：

- **`scripts/items.js`（JS 文件）负责第 1 件事**：把对象造出来，并登记进游戏。
- **`content/items/iron.json`（JSON 文件）负责第 2 件事**：给已登记的对象填数值。

用一个比喻：**入住酒店**。
- JS 脚本 = 在前台办理入住：报上姓名（`iron`）、房间类型（`Item`——物品房），拿到房卡。**人先住进去，登记就算完成了**。
- JSON 文件 = 入住后往房间里搬家具：这个房间要有红色地毯（`color`）、硬度 3 的门（`hardness`）……家具清单什么时候填都行，但**房间必须已经存在**（已经登记过）才能往里搬。

所以顺序必须是：**JS 先执行 → 对象登记 → JSON 再执行 → 填数值**。游戏源码保证了这个顺序（见第六节）。

为什么 VE 要这么拆，而不是全部写进 JSON？三个原因：

1. **历史原因**：Mindustry 早年（v6 之前）的 mod 主要用 JS 写内容，JSON 内容系统是后来逐步完善的。VE 是老牌模组，延续了老写法。
2. **能力原因**：JS 的 `extend` 能创建 Java 类的**匿名子类**（后面解释），可以**覆盖方法、改行为**；纯 JSON 只能填**数据字段**，改不了行为。复杂内容（自定义炮塔逻辑、新阵营）必须靠 JS。
3. **便利原因**：JS 可以写循环、批量创建几十个内容壳子，比手写几十个带 `"type"` 的 JSON 文件紧凑；JSON 则负责把数值写得清楚易读。

**关键认知**：这两种方式不是"两套内容"，而是**先后操作同一个对象**。后面第六节的源码会证明这一点。

---

## 二、JS 新手急救包（本文档会用到的全部 JS 概念）

如果你完全没写过 JS，先把这一节当字典看，遇到不懂的词回来查。每个概念都用一个生活比喻解释。

### 2.1 函数（function）——一段有名字、可反复调用的代码

```javascript
function 名字(参数1, 参数2) {
    // 函数体：每次调用都会执行的代码
}
```

- **函数**就像一本菜谱：写一次，之后想用随时"照着做"。
- 定义函数用 `function` 关键字开头，后面是函数名。
- **调用**一个函数就是执行它：`名字(值1, 值2)`。调用时括号里传的东西叫**参数**（parameter），函数体里用参数名来引用它们。

### 2.2 参数（parameter / argument）——调用时递给函数的值

```javascript
function newItem(name) {   // name 是参数：一个"代称"，具体是什么值，由调用时决定
    // 函数体
}
newItem("iron");            // 这次调用，函数体里的 name 就是字符串 "iron"
newItem("cobalt");          // 这次调用，函数体里的 name 就是字符串 "cobalt"
```

参数让同一个函数能处理不同的值——"代称"本身不是数据，数据是调用时给进去的。

### 2.3 对象（object）与对象字面量 `{}`——一个装"键:值"的袋子

```javascript
{ color: "ff0000", hardness: 3 }
```

- **对象**是 JS 里装数据的袋子，里面是一个个"**键: 值**"对（键也叫**属性名**）。
- 上面这个对象有 2 个**属性**：`color`（值是字符串 `"ff0000"`）和 `hardness`（值是数字 `3`）。
- 空袋子写成 `{}`——**属性一个都没有，但袋子本身是真实存在的**。VE 代码里的 `{}` 就是这个意思："先给个空袋子，属性以后（由 JSON）再填"。

### 2.4 属性（property）——对象里的一个键值对

- 访问属性用"点号"：`对象.属性名`，例如 `item.color`。
- 给属性赋值：`item.color = "ff0000"`（把右边的值装进左边这个属性里）。

### 2.5 赋值 `=`——把右边的值装进左边

```javascript
let a = 5;      // 声明一个变量 a，并把 5 装进去
a = 10;         // 重新装：a 现在是 10
```

`=` 不是"等于"（那是 `==`），而是"**把右边的东西放进左边的容器**"。

### 2.6 变量声明：const / let / var

```javascript
const x = 1;    // const：声明后不能再重新赋值（"恒定"）
let y = 2;      // let：可以重新赋值
var z = 3;      // var：老写法，功能类似 let，但作用域规则不同（现在基本不用）
```

Mindustry 的脚本里两种都见得到。记住 `const` 装进去就不能换，`let` 可以换，就够了。

### 2.7 exports 与 require——文件之间"交货"和"取货"

每个 `.js` 文件是一个**模块**（module）。两个模块要共享东西，靠两个关键字：

- **`exports`**：本文件对外交出去的"货"。`exports["iron"] = 某个对象` 意思是"我这文件提供一样东西，名字叫 iron"。
- **`require("模块名")`**：去加载另一个 `.js` 文件（执行它），并**返回那个文件的 exports**。`require("items")` 就是"执行 `scripts/items.js`，并把它交出来的所有货都拿回来"。

可以这样想：exports 是"出口清单"，require 是"进口"。

### 2.8 extend——游戏提供的"造 Java 对象"函数（重点！）

**`extend` 不是 JS 自带的**，是 Mindustry 在游戏启动时注入到 JS 环境里的**全局函数**（定义在 `core/assets/scripts/global.js` 第 27–43 行，第六节会展开讲它的实现）。

它的作用一句话：**创建一个 Java 类的对象**。

```javascript
extend(Item, "iron", {})
```

三个参数：
- 第 1 个：**Java 类**（这里是 `Item`，游戏里物品的类型）；
- 第 2 个：**内容名**（字符串，这里是 `"iron"`，作为构造参数传给 Item 的构造函数）；
- 第 3 个：**属性包**（`{}` 或填了内容的袋子，里面的键值会直接赋到新对象上）。

**注意**：`Item` 这个名字在 JS 里能直接用，是因为 `global.js` 里有一大串 `importPackage(Packages.mindustry.xxx)` 语句——它们把 Java 包里的类"翻译"成 JS 可以直接写的名字（这相当于把整座图书馆的索引目录摆在你面前，你报书名它就能找到）。

### 2.9 箭头函数（arrow function）——函数的简写（后面会遇到，先认识）

```javascript
const f = (x) => x * 2;   // 等价于 function f(x) { return x * 2; }
```

`(参数) => 表达式` 是函数的简写，`=>` 读作"变成"。Mindustry 的 JS 事件监听（`Events.on(事件, () => {...})`）常用它。

---

## 三、逐行拆解 VE 的 `scripts/items.js`

这是 VE 文件的**完整原文**（39 行）：

```javascript
function newItem(name) {
	exports[name] = extend(Item, name, {});
}
function newLiquid(name) {
	exports[name] = extend(Liquid, name, {});
}
function newCellLiquid(name) {
	exports[name] = extend(CellLiquid, name, {});
}

newItem("aluminium");
newItem("quartz");
// ……（中间省略，都是同样的调用）
newLiquid("lava");
newLiquid("chlorine");
newCellLiquid("melon-water-corrupted");
```

逐行解释：

### 第 1–3 行：定义一个"帮手函数" newItem

```javascript
function newItem(name) {
	exports[name] = extend(Item, name, {});
}
```

从左往右拆：

| 代码片段 | 含义 |
|---|---|
| `function newItem(name)` | 定义一个名叫 `newItem` 的函数，它接收一个参数 `name`（内容名） |
| `extend(Item, name, {})` | 调用全局函数 `extend`：**创建**一个 `Item` 类的对象，名字叫 `name`（此刻就被游戏登记了！），属性包暂时为空 |
| `exports[name] = ...` | 把创建出来的对象**登记到本文件的出口清单**上，键是 `name`。注意这里是 `[name]` 中括号而不是 `.name` 点号——中括号语法允许"用变量的值当键"，即 `exports["iron"]` |
| 整行合起来 | "创建一个叫 name 的物品对象（自动登记进游戏），然后把它放进本文件的出口清单，好让别的 JS 文件能引用它" |

这里有一个**极其重要**的点：`extend(Item, name, {})` 执行的那一刻，**游戏就已经知道有一个叫 `iron` 的物品了**——不需要任何额外的"注册"动作。为什么？因为 `Item` 的父类 `Content` 的构造函数里就写了自动登记（第六节第 6.2 条）。**造出来 = 登记完**。

### 第 4–7 行：同款函数，不同类型

```javascript
function newLiquid(name) {
	exports[name] = extend(Liquid, name, {});
}
```

和 `newItem` 结构一模一样，只是第 1 个参数从 `Item`（物品类）换成了 `Liquid`（液体类）。这就是"帮手函数"的意义：**把"创建 + 登记 + 导出"这三步固定动作打包成一个函数，以后每次只需要一行调用**。

`newCellLiquid` 同理，用的是 `CellLiquid`（可生长的液体，比如腐蚀性液体蔓延的那种）。

### 第 11 行起：真正的"登记动作"

```javascript
newItem("aluminium");
```

这就是**调用**帮手函数：执行 `newItem` 的函数体，把 `"aluminium"` 传给参数 `name`。函数体执行完后，游戏内容登记处里就多了一个名叫 `aluminium` 的物品对象。

### 到这里，JS 部分完成了什么？

- 16 个物品对象（aluminium、quartz、cobalt……）已被创建并登记进游戏；
- 4 个液体对象（lava、chlorine、melon-water、melon-water-corrupted、dysharmony-fluid——5 个）已被创建并登记；
- 它们目前是"空壳"：只有类型和名字，颜色、硬度这些数值全是默认值。

数值谁来填？`content/items/aluminium.json` 们。

### 对比：`content/items/` 里的 JSON 长什么样

看 VE 的 `content/items/copper.json`：

```json
{
  "shownPlanets": [...],
  "databaseTag": "basic-item"
}
```

这个 JSON 里**没有** `"type"` 字段、没有名字字段——因为**对象已经存在了**（JS 建的，或者原版就有）。游戏解析 JSON 时先按文件名找同名对象，找到了就直接把 JSON 里的字段填进去（第六节第 6.5 条）。

---

## 四、逐行拆解 VE 的 `scripts/blocks.js`——newBlock 与 Java 类

`blocks.js` 前 4 行定义了帮手函数，后面全是调用：

```javascript
function newBlock(name, blockType) {
	exports[name] = extend(blockType, name, {});
}

newBlock("duct-junction", DuctJunction);
newBlock("armored-bridge-conveyor", DuctBridge);
newBlock("armored-router", DuctRouter);
```

和 `newItem` 只差一个地方：**第 1 个参数从写死的 `Item` 变成了参数 `blockType`**。

- `newItem("iron")` 内部固定用 `Item` 类 → 只能造物品；
- `newBlock("duct-junction", DuctJunction)` 把"用什么类"也变成参数 → 同一个函数能造任何方块类型。

**`DuctJunction`、`DuctBridge`、`Conveyor` 这些名字是什么？** 是 Java 类。它们来自 `global.js` 的 `importPackage` 导入（`mindustry.world.blocks.distribution` 等包）。`DuctJunction` 就是游戏里"管道节点"方块的 Java 类，`Conveyor` 是传送带类。

**为什么传类而不是字符串？** 因为 JSON 里的 `"type": "GenericCrafter"` 本质上也是一样的东西——一个类名。游戏解析 JSON 时要用字符串去查一个"类名 → 类"的映射表（`ClassMap`）才能找到类。而在 JS 里，类本身就是对象，**直接传递类对象更直接，连查表都省了**。这也是为什么 VE 的方块 JSON 里 `"type"` 字段基本都被注释掉了——类型在 JS 里已经定死，JSON 里再写反而会触发"重复声明类型"警告（见第六节第 6.5 条）。

还有一个细节：`newBlock("armored-overflow-gate", OverflowDuct);` 和 `newBlock("armored-underflow-gate", OverflowDuct);` 用了**同一个类** `OverflowDuct`——类决定"行为"，名字决定"身份"，两者是解耦的。你完全可以给同一个类起两个名字（比如"小型/大型"两个不同名字的方块共享一个类），再用 JSON 给它们填不同的数值。

---

## 五、`main.js`——脚本入口与 require 顺序

### 5.1 游戏只自动执行 main.js

游戏加载一个 mod 的脚本时（`Mods.java` 第 800–830 行 `loadScripts`），逻辑是：

```java
Seq<Fi> allScripts = mod.root.child("scripts").findAll(f -> f.extEquals("js"));
Fi main = allScripts.size == 1 ? allScripts.first() : mod.root.child("scripts").child("main.js");
```

翻译成大白话：如果 `scripts/` 目录里**只有一个** `.js` 文件，就执行它；否则执行 `main.js`。**其他所有 .js 文件都不会被自动执行**——它们必须被 main.js（或间接）`require` 到才会运行。这就是为什么 VE 的 main.js 里有一长串 `require(...)`。

### 5.2 逐行看 VE 的 main.js

```javascript
MapResizeDialog.minSize = 5          // 修改游戏的全局设置：地图尺寸下限
MapResizeDialog.maxSize = 1000       // 地图尺寸上限
Vars.maxSchematicSize = 600          // 蓝图最大格子数
require("sectorSize");               // ① 先加载星区网格工具
require("units");                    // ② 创建所有单位对象
require("items");                    // ③ 创建所有物品/液体对象
Vars.renderer.maxZoom = 25;          // 相机最大缩放
require("blocks");                   // ④ 创建所有方块对象
log("endblocks");                    // 打日志：标记 blocks 加载完成
require("sectors");                  // ⑤ 创建所有星区
require("team2");                    // ⑥ 创建新阵营（高级技巧）
```

几个概念：

- **`Vars`**：Mindustry 的**全局状态入口**（一个巨大的 Java 静态类）。`Vars.maxSchematicSize` 就是"游戏全局的蓝图上限"这个值。JS 里能直接写 `Vars.xxx`，因为 `global.js` 导入了 `mindustry` 包。**注意**：`Vars` 是"游戏运行时的全局状态"，只有游戏运行时才有意义；改它等于在游戏启动时改游戏设置。
- **`require("items")`**：加载并执行 `scripts/items.js`。执行完，`items.js` 里的所有 `newItem(...)` 都跑过了，物品对象全部登记完毕。
- **`log("endblocks")`**：在游戏控制台打一行日志，用来**确认加载进度**。如果游戏卡死或报错，看日志打到哪一行就知道是哪一步出了问题——这是调试利器。
- **`require` 顺序为什么重要**：JS 里对象先创建，JSON 后填属性（游戏保证）。但 JS 内部也有依赖：比如 `sectors.js` 里可能引用 `units.js` 创建的单位类型，所以必须先 `require("units")` 再 `require("sectors")`。**顺序 = 依赖顺序：被依赖的先进**。

### 5.3 require 是怎么找到文件的？

`Scripts.java` 里的 `ScriptModuleProvider`：`require("items")` → 去**当前 mod 的 `scripts/` 目录**找 `items.js`。`require("a/b")` 会先尝试找名为 `a` 的 mod 的 `b.js`，找不到就当子目录处理（`scripts/a/b.js`）。这也是为什么可以 `require("base/library")` 跨文件按目录组织。

---

## 六、游戏源码侧：机制真相

这一节把前面所有"为什么"钉死。每一条都给出真实文件与行号，你可以自己打开 `~/Factory/Mindustry` 对照看。

### 6.1 启动时的加载顺序（ClientLauncher.java 第 168–172 行）

```java
content.createBaseContent();   // ① 加载原版内容（Items.load()、Blocks.load() 等 Java 硬编码）
mods.loadScripts();            // ② 执行每个 mod 的 scripts/main.js（即 JS 阶段）
content.createModContent();    // ③ 解析每个 mod 的 content/ 目录 JSON（即 JSON 阶段）
```

**② 在 ③ 之前**——这就是"JS 先登记、JSON 后填属性"成立的根。原版内容（①）也在 JS 之前，所以 VE 的 JSON 里可以直接 patch 原版物品（比如 `content/items/copper.json` 补丁原版铜）。

### 6.2 "造出来 = 登记完"：Content 构造函数自动注册（Content.java 约第 20–23 行）

```java
public Content(){
    this.id = (short)Vars.content.getBy(getContentType()).size;  // 分配一个编号
    Vars.content.handleContent(this);                            // 登记进内容表
}
```

`Item`、`Liquid`、`Block`……所有内容类的老祖宗都是 `Content`。**Java 里每次 `new` 一个内容对象，构造函数自动执行这两行**：拿一个编号（id），然后登记。JS 的 `extend` 本质就是 `new`，所以 `newItem("iron")` 一执行，登记就完成了。**这就是整个双轨制最核心的一个机制，务必记住。**

### 6.3 handleContent：登记到哪去了（ContentLoader.java 第 175–181 行）

```java
public void handleContent(Content content){
    this.lastAdded = content;
    contentMap[content.getContentType().ordinal()].add(content);
}
```

游戏内部按类型（物品、方块、液体……）各维护一张**名单**（`contentMap`），`handleContent` 就是把对象加进对应类型的名单尾部。后面所有系统（建造菜单、科技树、存档）都是查这些名单。

### 6.4 名字加前缀：transformName（ContentLoader.java 第 179–181 行）

```java
public String transformName(String name){
    return currentMod == null ? name : currentMod.name + "-" + name;
}
```

内容在游戏里的**真实注册名** = `mod名-内容名`。所以你的 iron 在游戏里真名叫 `starfield-iron`。这个前缀是为了**防止不同 mod 的内容互相撞名**。但**写 JSON 引用时不用带前缀**（游戏会按"当前 mod 上下文"自动补），只有跨 mod 引用才需要写全名。

### 6.5 JSON 解析：找到同名 → 填属性；找不到 → 新建（ContentParser.java 第 584–593 行，block 为例）

```java
if(allowPatching && locate(ContentType.block, name) != null){
    if(value.has("type")){
        warn("... re-declares a type. This will be interpreted as a new block ...");
        block = make(resolve(...), mod + "-" + name);   // 情况B：有 type → 警告并新建
    }else{
        block = locate(ContentType.block, name);        // 情况A：无 type → 拿已存在的对象
    }
}else{
    block = make(resolve(value.getString("type", "Block"), ...), mod + "-" + name);  // 情况C：不存在 → 按 type 新建
}
```

三种情况：

- **情况 A（VE 的常态）**：JSON 文件名对应的对象**已经存在**（JS 建的或原版就有），且 JSON **没写** `"type"` → 直接拿那个对象，接着把 JSON 里所有字段反射填进去（`readFields`）。**这就是"patch"**。
- **情况 B**：对象已存在，但 JSON 写了 `"type"` → 游戏警告"你重复声明了类型，我把这当成新内容"，然后**新建一个**（会跟原来的同名对象冲突，基本是 bug）。VE 把 JSON 里的 `"type"` 注释掉就是为了避开它。
- **情况 C**：对象不存在（纯 JSON 模组）→ 按 `"type"` 字段去 `ClassMap` 查类，新建对象。所以**纯 JSON 完全可行**，只要写对 `"type"`。

### 6.6 readFields：JSON 字段是怎么"填"进去的（ContentParser.java 第 1270–1337 行）

游戏用 Arc 引擎的 JSON 反射库：**JSON 里的字段名直接去匹配 Java 对象的公有字段名**。比如 JSON 写 `"color": "ff0000"`，它就去对象上找 `color` 这个字段并赋值。

两个暗坑：

1. **字段名必须等于 Java 字段名**（去源码里查，比如 `Item.java` 里有 `color`、`hardness`、`cost`……）。拼错了**不会报错**，只会打一条 warning，字段静默无效——游戏看起来一切正常，但数值没生效。这是新手最容易踩的坑。
2. `research` 字段会被特殊处理：从 JSON 里剥出来，用于构建**科技树**（父节点、解锁条件），不直接进对象。

### 6.7 生命周期：init → postInit → load（ContentLoader.java 第 103–130 行附近）

所有内容解析完（JSON 阶段结束）后，游戏统一调用每个内容的生命周期方法：

- `init()`：初始化（此时所有内容都已存在，可以互相引用）；
- `postInit()`：二次初始化；
- `load()` / `loadIcon()`：**只有客户端（有画面的版本）才执行**，加载贴图（region）。这一步才把 `sprites/items/iron.png` 和对象关联起来——这就是**贴图文件名必须等于内容名**的原因：游戏按 `内容名.png` 去 `sprites/items/` 目录找贴图。

---

## 七、专有名词小词典（速查表）

| 名词 | 一句话解释 |
|---|---|
| **Content** | 游戏里所有内容的父类（物品/方块/液体/单位/行星……都继承它） |
| **ContentLoader** | "内容登记处"：维护所有内容的名单，驱动生命周期 |
| **ContentParser** | "JSON 填表员"：解析 content/ 下的 JSON 并填进对象 |
| **ClassMap** | "类名查表"：JSON 的 `"type": "GenericCrafter"` 字符串 → Java 类的映射表 |
| **extend** | 游戏注入的全局 JS 函数：创建 Java 类对象（= Java 的 `new` + 匿名子类） |
| **JavaAdapter** | Rhino（JS 引擎）提供的机制，extend 的底层实现 |
| **Rhino** | Mozilla 的 Java 版 JS 引擎，Mindustry 用它执行 mod 脚本 |
| **global.js** | 游戏内置脚本：定义 extend、log、importPackage 等 JS 全局环境 |
| **importPackage** | Rhino 函数：把 Java 包里的类变成 JS 可直接写的名字 |
| **require / exports** | 模块系统："取货" / "交货" |
| **模块（module）** | 一个 .js 文件就是一个模块 |
| **对象字面量 `{}`** | JS 装"键:值"的袋子 |
| **属性（property）** | 对象里的一个键值对，用 `对象.属性名` 访问 |
| **参数（parameter）** | 函数调用时传进去的值，函数体内用参数名引用 |
| **赋值 `=`** | 把右边的东西装进左边（不是"等于"） |
| **const / let / var** | 变量声明：const 装完不能换，let 可以换，var 是老写法 |
| **patch（补丁）** | 游戏里"给已存在对象填属性/改数值"的机制：同名 + 不写 type |
| **Vars** | 游戏全局状态入口（Java 静态类），JS 里可直接访问 |
| **region（贴图区域）** | 游戏从 PNG 加载的纹理区域，`load()` 阶段按"内容名.png"查找 |
| **kebab-case** | 全小写 + 连字符的命名风格（`shinstar-alloy`），官方推荐的文件命名规范 |
| **反射（reflection）** | 程序在运行时"按名字找到字段/方法并操作"的能力，readFields 靠它实现 |

---

## 八、这对繁星意味着什么（下一步怎么动手）

理解机制后，写繁星的资源体系就很机械了：

1. **创建 `scripts/items.js`**，照 VE 抄帮手函数（一个字都不用改）：

   ```javascript
   function newItem(name) {
       exports[name] = extend(Item, name, {});
   }
   ```

   然后按设计文档把物品名逐个写进去：`newItem("iron");` `newItem("cobalt");` ……
   注意：**名字用 kebab-case，且必须等于贴图文件名**（`sprites/items/iron.png` ↔ `content/items/iron.json` ↔ `newItem("iron")` 三处一致）。

2. **创建 `content/items/iron.json`** 等文件，填设计文档里的数值（颜色、开采等级→`hardness`、`cost`）。字段名以 `Item.java` 为准：`color`、`hardness`、`cost`、`flammability`、`explosiveness`、`radioactivity`……

3. **创建 `scripts/main.js`**：保留现有 `log`，加一行 `require("items");`。

4. **每加一个物品，同步在 `bundles/bundle_zh_CN.properties` 加一条** `item.starfield-iron.name = 铁`（键格式：`item.mod名-内容名.name`）。

5. **验证**：`./gradlew desktop:run` 或游戏内导入 mod → 沙盒里看物品是否出现在核心、贴图是否正常显示。每次只加几个，验证通过再加下一批（"焚诀"：先让它出现，再让它好看）。

> 本文档是"机制入门"第一部分。后续写方块（blocks.js + content/blocks/）、科技树（research）、贴图加载细节时，会在 debug-004 的基础上继续补充（或开 debug-005）。

---

# 附录 A：debug-004 之后的实施记录（2026-08-04）

> 读完 debug-004 的机制后，按它落地了繁星的资源体系与核心链。本附录记录：做了什么、为什么这么做、过程中修正了哪些认知、还有哪些待办。

## A.1 本次实施内容总览

| 内容 | 文件 | 说明 |
|---|---|---|
| 物品/液体注册 | `scripts/items.js`（新） | 46 个内容注册（16 变种 + 26 新增物品 + 4 新增液体），逐行注释 |
| 变种数值 | `content/items/` 11 个 JSON、`content/liquids/` 5 个 JSON（新） | 数值全部抄原版 `Items.java` / `Liquids.java` |
| 本地化 | `bundles/bundle.properties` + `bundle_zh_CN.properties`（改） | 46 个内容 + 2 个核心方块，中英双语 name/description |
| 入口 | `scripts/main.js`（改） | `require("items")` → `require("blocks")` |
| 方块注册 | `scripts/blocks.js`（新） | `newBlock` helper + 2 个核心方块 |
| 受损核心 | `content/blocks/special/sp-damaged-core.json`（新） | 科技树根节点，开局预置 |
| I 型核心 | `content/blocks/special/sp-core-mk1.json`（新） | 可发射的正常核心 |
| 贴图 | 15 个原版同名贴图重命名/归位 | 消除重复，统一 sp- 前缀 |

## A.2 实施中修正的关键认知

1. **"变种"数量是 16 不是 17**：用户原以为乙醇是原版资源（变种），但搜遍 `core/src/mindustry/content/` **没有 ethanol**——它是**新增液体**（设计文档里乙醇在"液体"节，原版无此物）。

2. **JS 创建的内容名也带 mod 前缀**（重要修正）：`MappableContent.java:11` 构造函数统一执行 `this.name = Vars.content.transformName(name)`——**不管内容是 JS 建的还是 JSON 建的，名字都会变成 `mod名-内容名`**（如 `starfield-sp-lead`）。所以：
   - bundle 键永远是 `item.starfield-xxx.name`（与 VE 的 `item.ve-aluminium.name` 一致）
   - 这也意味着 `newItem("lead")` 不会与原版 lead 撞名（注册名带前缀）——但为避免"两个铅"的混乱，仍用 sp- 变种方案

3. **科技树信息在文档里是"隐含"的**：docx 里没有显式的"科技树"章节。科技顺序藏在两处：① 资源的**开采等级**（铁1/铅1 → 石墨2/钴2/金2/钛2 → 铀3/钍3）；② 工厂配方的**进料→出料**（如"碳压缩机：煤炭→石墨"）。research 就是按这些合成链设计的。

4. **解锁状态按内容名独立存储**：`UnlockableContent.java:94/250`——每个内容用 `Core.settings` 里的 `名字-unlocked` 键记录解锁。变种名字不同 → 解锁状态独立 → **打过原版战役的存档不会在繁星"白嫖"解锁**（用户设计目标的机制保证）。

5. **research 的 parent 有时序坑（重要，踩过）**：科技树节点在 `ContentParser.finishParsing()`（第 1006–1014 行）里按**解析顺序**批量构建（postreads），而解析顺序 = **ContentType 类型序（block 最先，item/liquid 在后）+ 文件名字母序**。所以 research.parent 必须满足：**parent 的解析早于 child**，否则 `ContentParser.java:1405` 报 "isn't in the tech tree" 警告，节点成孤儿、从科技树消失。踩到的 5 个反例：`sp-metaglass→sp-sand`、`sp-blast-compound→sp-coal`、`sp-cryofluid→sp-water`、`sp-hydrogen→sp-water`（同类型字母序在后）、`sp-core-mk1→sp-silicon`（block 先于 item）。**修复**：`mod.json` 的 `contentOrder` 把 4 个被引用的 parent（`sp-sand`/`sp-coal`/`sp-water`/`sp-silicon`）提前解析（Mods.java:882 按列表顺序先加载）。**规则：以后新增内容，parent 若字母序或类型序晚于 child，必须加进 contentOrder。**

## A.3 受损核心的技术方案（两个源码约束推导出来的）

设计需求：开局就有、不可建造、不能发射、+4 单位、2000 容量。

两个约束决定了实现：
1. **必须是 CoreBlock**：`Schematics.java:480`（placeLoadout）强制"开局负载必须含 CoreBlock"，否则抛异常。所以受损核心不能做成普通存储方块。
2. **没有"可发射"开关**：源码里任何 CoreBlock 都能发射（发射是 UI 层流程）。最干净的禁法 = `configurable: false`——点击核心不打开核心界面 → 没有发射入口，同时"无法生产单位/查看科技"，正好贴合"已丧失大部分功能"。物品存取靠装卸器（与文档仓库设计一致）。

```
sp-damaged-core.json 要点：
health 800 | size 3 | itemCapacity 2000 | unitCapModifier +4
buildVisibility: "hidden"（不可建造，只能地图预置）
configurable: false（禁核心界面 = 禁发射）
research: root + planet viar（科技树根）
```

## A.4 I 型核心的技术方案（核心替换机制的实现）

设计需求：科技树解锁、可发射、能"替换"受损核心。

- `category: "effect"` + `buildVisibility: "coreZoneOnly"`：coreZoneOnly = 只能在**核心区域**建造。受损核心（CoreBlock）周围会自动形成核心区域 → 玩家在受损核心的位置直接重建出 I 型核心 = "替换"。
- `isFirstTier: true`：标记为核心链第一级（II 型核心在其上升级）。
- 材料 `iron/1000 + sp-lead/1000`（文档数值，用繁星自己的资源）。
- `research.parent: "sp-silicon"`：**过渡选择**——等数据链（computer-chip/data-unit）JSON 落地后改挂数据链（文档：数据单元"用于复原数据库内的科技"）。

## A.5 当前科技树（2026-08-04 状态）

```
sp-damaged-core（root，维亚尔行星）—— 开局即有
├── sp-lead / sp-coal / sp-sand / sp-titanium / sp-thorium / sp-scrap / sp-water / sp-oil
│   （8 个基础资源，parent = 受损核心）
├── sp-coal → sp-graphite → sp-blast-compound*
├── sp-sand → sp-silicon → sp-core-mk1（I 型核心，过渡挂法）
│          └→ sp-metaglass
├── sp-titanium → sp-plastanium
├── sp-scrap → sp-slag
└── sp-water → sp-hydrogen / sp-cryofluid

* sp-blast-compound 先挂 sp-coal 过渡（真正的配方前置是 sulfide，待新增 JSON）
```

## A.6 待办清单

- [ ] **第二批新增物品 JSON**：iron/cobalt/gold/uranium/steel/salt 等 26 个壳子的数值（I 型核心材料依赖 iron）
- [ ] **探路者单位**：做好后改 `sp-core-mk1` 的 `unitType`
- [ ] **II 型核心**（sp-core-mk2，4x4/2500血/12000容量/+16）
- [ ] **地图预置**：受损核心 `hidden` 后不会自动出现，需在坠毁点星区地图（.msav）里放置
- [ ] **pyratite.png 处置**：原版火石贴图，设计文档无火石——删除/保留/做变种待用户定
- [ ] **弹药箱贴图对应**：light-ammobox / heavy-ammobox 是否对应 autocannon-ammo / artillery-ammo 待确认
- [ ] **新增长途细节**：铱（文档未写完）、木材/硫化物/水晶/冰/永磁体等缺贴图
