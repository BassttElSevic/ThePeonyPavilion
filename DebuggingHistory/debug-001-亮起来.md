# 🐛 调试记录 #1 — 阶段一：星球亮起来

> 日期: 2026-07-21 ~ 2026-07-22  
> 版本: v0.1.0  
> 问题数: 3 | 已解决: 3

---

## 问题一：星球在战役模式看不到

### 现象
启动游戏 → 战役模式 → 只看到 Serpulo 和 Erekir 两颗原版星球，牡丹亭没有出现。

### 排查过程
1. F8 控制台 `mods` → Mod 状态：**红色 contentErrors**
2. 控制台输出错误日志

### 根因
Mod 是通过 **GitHub 导入**拉取的（`BassttElSevicThePeonyPavilion.zip` 在 `~/.local/share/Mindustry/mods/`）。游戏从 GitHub 拉取时只会打包仓库里的文件——如果代码没 push 到 GitHub，游戏拿到的就是旧版本。

### 解决方案
**不用软链接**。Mindustry 的 Mod 管理机制是基于 zip 导入的——游戏删除 Mod 时会清空整个 Mod 目录包括软链接目标，极其危险。

正确的工作流：
```
本地修改 → git commit → git push → 游戏内 "导入 GitHub Mod" 重新拉取
```

---

## 问题二：软链接导致文件丢失（⚠️ 严重）

### 现象
AI 误操作：删除了 `~/.local/share/Mindustry/mods/BassttElSevicThePeonyPavilion.zip`，替换为软链接指向 `~/Factory/ThePeonyPavilion`。用户在游戏里点了"删除 Mod"后，`Factory/ThePeonyPavilion/` 被清空。

### 根因
Mindustry 的"删除 Mod"功能会递归删除 Mod 目录（包括软链接目标）。软链接在这种场景下是灾难性的。

### 教训
- **永远不要对 Mindustry mods 目录使用软链接**
- 工作流必须是：本地仓库 → GitHub → 游戏导入
- 用户正确的工作流：`Factory/ThePeonyPavilion/` 是 git 仓库，修改完 commit+push，游戏里重新导入

---

## 问题三：SectorPreset 加载失败 — 缺少 .msav 地图文件

### 错误日志
```
[E] Error loading content: content/sectors/crash-site.json
arc.util.ArcRuntimeException: File not found:
maps/thepeonypavilion-peony-pavilion/thepeonypavilion-crash-site.msav
```

### 根因
`SectorPreset` 默认使用 `FileMapGenerator`，它需要在 `maps/<星球内部名>/<星区内部名>.msav` 路径存在一个有效的地图文件。

源码依据（`SectorPreset.java:83-84`）：
```java
if(generator == null){
    this.generator = new FileMapGenerator(fileName == null ? this.name : fileName, this);
}
```
`FileMapGenerator` 构造时立刻尝试 `Fi.read()` 读取 `.msav` 文件——不存在就抛异常。

### 解决方案
"亮起来"阶段只需星球可见——先移除 sector JSON，让玩家在**沙盒模式**下探索星球。`.msav` 地图文件需要后续用游戏内置地图编辑器创建后再加回。

### 后续步骤（创建地图）
1. 游戏内 → 编辑器 → 新建地图
2. 设置星球为 "牡丹亭"（peony-pavilion）
3. 生成 → 保存为 `thepeonypavilion-crash-site.msav`
4. 放到 `maps/thepeonypavilion-peony-pavilion/`
5. 把 `crash-site.json` 移回 `content/sectors/`
6. commit + push + 重新导入

---

## 环境约束记录

| 项目 | 值 |
|------|-----|
| Mindustry 版本 | v8+ (minGameVersion: 146) |
| Mod 类型 | JS + JSON 混合 |
| 源码路径 | `~/Factory/Mindustry/`, `~/Factory/Arc/` |
| Mod 仓库 | `github.com/BassttElSevic/ThePeonyPavilion` |
| 开发目录 | `~/Factory/ThePeonyPavilion/` |
| 导入方式 | **GitHub 导入**（不是软链接） |

---

## 最终成功状态

```
✅ Mod 加载: 绿色 enabled
✅ main.js: "牡丹亭 Mod 已加载 ✓"
✅ 星球 peony-pavilion: 解析成功，挂在原版太阳下
✅ 战役模式/沙盒模式: 星球可见
⚠️  sector crash-site: 暂不可用（等待 .msav 地图文件）
```
