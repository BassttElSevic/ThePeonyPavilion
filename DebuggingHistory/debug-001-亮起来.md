**简体中文** | [English](debug-001-en.md)

# 调试记录 #1 -- 阶段一：星球亮起来

日期: 2026-07-21 ~ 2026-07-22
版本: v0.1.0
解决问题数: 5


## 问题 1：SectorPreset ContentParser 报错 -- 缺少 .msav 地图文件

### 错误日志

```
[E] Error loading content: content/sectors/crash-site.json
arc.util.ArcRuntimeException: File not found:
maps/starfield-viar/starfield-crash-site.msav (internal)
    at arc.files.Fi.read(Fi.java:215)
    at arc.files.Fi.read(Fi.java:232)
    at mindustry.io.MapIO.createMap(MapIO.java:38)
    at mindustry.maps.Maps.loadInternalMap(Maps.java:125)
    at mindustry.maps.generators.FileMapGenerator.<init>(FileMapGenerator.java:48)
    at mindustry.type.SectorPreset.initialize(SectorPreset.java:84)
    at mindustry.mod.ContentParser.lambda$new$16(ContentParser.java:781)
    at mindustry.mod.ContentParser.lambda$read$27(ContentParser.java:972)
```

### 源码定位

堆栈指向 `SectorPreset.initialize()` 第 84 行。阅读
`Factory/Mindustry/core/src/mindustry/type/SectorPreset.java` 第 81-85 行：

```java
public void initialize(Planet planet, int sector, boolean override){
    this.planet = planet;
    if(generator == null){
        this.generator = new FileMapGenerator(fileName == null ? this.name : fileName, this);
    }
```

当 `generator` 为 null（JSON 中未设置）时，会创建一个 `FileMapGenerator`，
使用星区的内部名作为文件名。`FileMapGenerator` 的构造函数立即调用
`Fi.read()` 读取 `.msav` 文件——文件不存在则在加载阶段直接抛出
`ArcRuntimeException`，而非等到游戏运行时。

期望的文件路径为：
```
maps/<星球内部名>/<星区内部名>.msav
```
本项目的实际路径：
```
maps/starfield-viar/starfield-crash-site.msav
```

### 修复

"亮起来"阶段不需要星区预设。将 `crash-site.json` 从 `content/sectors/`
移至 `maps/starfield-viar/`，让 ContentParser 跳过它。
`.msav` 地图文件后续使用游戏内置地图编辑器创建后，再将 JSON 移回。

### 对应 Commit

`947ec61`: fix: move sector JSON out of content/ -- needs .msav map file


## 问题 2：软链接破坏 -- 游戏"删除 Mod"清空开发目录

### 现象

当 `~/.local/share/Mindustry/mods/` 中存在指向开发目录
`~/Factory/Starfield/` 的软链接时，在游戏内点击"删除 Mod"
会递归删除软链接目标。包括 `.git/` 在内的全部源码丢失。

### 根因

Mindustry 的 `Mods` 类在删除时不区分软链接和普通目录，直接遍历目标删除。

### 修复

从 GitHub 恢复（`git clone`），重新应用所有修改，commit 并 push。
正确的工作流为：

```
本地编辑 -> git commit -> git push -> 游戏内 "导入 GitHub Mod"
```

Mindustry Mod 开发中禁止使用软链接。


## 问题 3：mod.json 字段与 ModMeta 源码对照验证

### 源码定位

阅读 `Factory/Mindustry/core/src/mindustry/mod/Mods.java` 第 1376-1399 行，
`ModMeta` 内部类定义了以下可序列化字段：

```java
public static class ModMeta{
    public String name;
    public String internalName;        // 自动生成：小写，空格替换为 "-"
    public String minGameVersion = "0";
    public @Nullable String displayName, author, description, subtitle, version, main, repo;
    public Seq<String> dependencies = Seq.with();
    public Seq<String> softDependencies = Seq.with();
    public boolean hidden;
    public boolean java;
    public boolean iosCompatible;
    public float texturescale = 1.0f;
    public boolean pregenerated;
    public String[] contentOrder;
    public boolean legacyCompatible;
}
```

对照原始 mod.json 的关键发现：

| 原 mod.json 中的字段 | ModMeta 中是否存在 | 处理 |
|---|---|---|
| `displayname`（小写 n） | `displayName`（大写 N） | 修正大小写 |
| （缺失）`subtitle` | `subtitle` 存在 | 添加 |
| （缺失）`repo` | `repo` 存在 | 添加 `BassttElSevic/Starfield` |
| （缺失）`hasScripts` | **不存在** | 从模板中移除；游戏自动检测 `scripts/main.js` |

VE 的 mod.json 中写的 `hasScripts` 字段被 JSON 反序列化器静默忽略。
Mindustry 在 `Mods.loadScripts()`（第 800-830 行）中通过检查
`scripts/main.js` 是否存在来判断是否加载脚本。

### 对应 Commit

`aa50418`: v0.1.0 -- corrected mod.json fields, added subtitle/repo


## 问题 4：ContentParser 字段验证 -- shownPlanets 和 databaseTag

### 源码定位

物品 JSON 模板中使用了 `shownPlanets` 字段，但阅读
`Factory/Mindustry/core/src/mindustry/type/Item.java`（共 165 行），
Item 类仅有以下字段：

```java
public class Item extends UnlockableContent implements Senseable{
    public Color color;
    public float explosiveness = 0f;
    public float flammability = 0f;
    public float radioactivity;
    public float charge = 0f;
    public int hardness = 0;
    public float cost = 1f;
    public float healthScaling = 0f;
    public boolean lowPriority;
    public int frames = 0;
    public int transitionFrames = 0;
    public float frameTime = 5f;
    public boolean buildable = true;
    public boolean hidden = false;
}
```

没有 `shownPlanets`，也没有 `databaseTag`。这两个字段仅存在于
`Block.java`（第 1324 行）。ContentParser 的 `ignoreUnknownFields = true`
（第 58 行）导致未知 JSON 字段被静默丢弃——VE 物品 JSON 中的
`shownPlanets` 在运行时对物品可见性没有任何实际影响。

物品的星球可见性由 `Item.isOnPlanet()` 方法通过检查矿石生成和配方引用来决定。

### 修复

从开发计划的所有物品 JSON 推荐中移除 `shownPlanets` 和 `databaseTag`。
更新模式文档注明 `shownPlanets` 仅 Block 类有效。


## 问题 5：planetGrid() 与 Planet 构造函数的冗余

### 源码定位

阅读 `Factory/Mindustry/core/src/mindustry/type/Planet.java` 第 224-237 行：

```java
public Planet(String name, Planet parent, float radius, int sectorSize){
    this(name, parent, radius);
    if(sectorSize > 0){
        grid = PlanetGrid.create(sectorSize);
        sectors.ensureCapacity(grid.tiles.length);
        for(int i = 0; i < grid.tiles.length; i++){
            sectors.add(new Sector(this, grid.tiles[i]));
        }
        sectorApproxRadius = sectors.first().tile.v.dst(
            sectors.first().tile.corners[0].v
        );
    }
}
```

当星球 JSON 中设置 `sectorSize > 0` 时，Planet 构造函数自动创建星区网格。
VE 的 `scripts/sectorSize.js` 中使用 `planetGrid()` 仅仅是因为 Tantros
在 JSON 中 `sectorSize=0`，需要通过 JS 动态创建。

对于维亚尔星球（JSON 中 `"sectorSize": 2`），`planetGrid()` 完全不必要，
且会造成重复创建。

### 修复

从 `main.js` 模板中移除 `require("sectorSize")`。添加注释说明
`planetGrid()` 的使用场景（JSON `sectorSize=0`）与冗余场景（JSON `sectorSize > 0`）。


## 工作约束

| 项目 | 值 |
|---|---|
| Mindustry 版本 | v8+ (minGameVersion: 146) |
| Mod 类型 | JS + JSON |
| 源码路径 | `Factory/Mindustry/`, `Factory/Arc/` |
| 参考模组 | Vanilla Expansion 2.1.1.1 (`Factory/ref/Vanilla-Expansion-Mod-2111/`) |
| Mod 仓库 | `github.com/BassttElSevic/Starfield` |
| 开发目录 | `Factory/Starfield/` |
| 导入方式 | GitHub 导入（禁止软链接） |


## 最终状态

```
[OK] Mod 加载: 绿色 enabled
[OK] main.js: "繁星 Mod 已加载"
[OK] 星球 viar: 解析成功，挂在原版 sun 下，战役/沙盒模式可见
[--] 星区 crash-site: 暂缓，等待 .msav 地图文件创建
```
