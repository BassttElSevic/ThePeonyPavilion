// ============================================
// 牡丹亭 Mod — 方块注册文件 (blocks.js)
// ============================================
// 和 items.js 同理：这里创建方块的"壳子"并登记进游戏，
// 数值属性由 content/blocks/*.json 填充（机制详见 debug-004）。
//
// 帮手函数说明：
// newBlock(名字, Java类) = 创建一个指定类型的方块对象并登记。
// 第二个参数是 Java 类（如 CoreBlock），它决定方块的行为类型；
// 名字决定身份。JSON 里就不用写 "type" 了。

function newBlock(name, blockType) {
	exports[name] = extend(blockType, name, {});
}

// ============================================
// 一、特殊建筑
// ============================================

// 受损核心（sp-damaged-core）
// 设计来源：设计文档"特殊"节——受损的主舰核心，已丧失大部分功能。
// 它是牡丹亭科技树的根节点（JSON 里 research.root: true），开局由地图预置。
// 为什么用 CoreBlock 而不是普通存储方块：
//   游戏强制要求"开局负载必须包含核心"（源码 Schematics.placeLoadout，
//   找不到 CoreBlock 会直接抛异常），所以它必须是 CoreBlock 的变体。
// 为什么它不能发射（configurable=false）：
//   发射入口在"核心界面"里（点击核心打开的那个界面）。把
//   configurable 设为 false 后点击核心不再打开界面 → 无法发射、
//   无法生产单位、无法查看科技——正好符合"已丧失大部分功能"。
//   物品存取靠装卸器（同仓库的设计）。
newBlock("sp-damaged-core", CoreBlock);

// I型核心（sp-core-mk1）
// 设计来源：设计文档"特殊"节——从数据库中复原的基础型核心。
// 与受损核心相反，它是"正常"的核心：有完整核心界面（可发射、可生产单位）。
// 玩法闭环：开局用受损核心 → 科技树研究出 I 型核心 →
// 在受损核心所在的核心区域（Core Zone，coreZoneOnly 机制）建造它 →
// 用 I 型核心发射到其他区域（设计文档："需要点出I型核心才能发射"）。
// 注意：单位暂用默认（alpha），等"探路者"做好后改 unitType。
newBlock("sp-core-mk1", CoreBlock);

log("blocks.js 加载完成");
