// ============================================
// 牡丹亭 Mod — 物品/液体注册文件 (items.js)
// ============================================
// 这个文件只做一件事：创建所有物品/液体的"壳子"并登记进游戏。
// 壳子 = 只有类型和名字的对象。数值属性（颜色、硬度、价格…）
// 由 content/items/*.json 和 content/liquids/*.json 负责填（见 debug-004）。
//
// 两个关键设计（都来自游戏源码机制，详见 debug-004）：
// 1. extend(类, 名字, {}) 执行的一瞬间，内容就自动登记进游戏了
//    （Content 构造函数自动调 handleContent）。造出来 = 登记完。
// 2. 原版已有的资源（铅、石墨、钛…）不能 newItem("lead")——
//    会与原版 lead 撞名直接崩溃。所以这里统一建"变种"：
//    内部名加 sp- 前缀（sp-lead），数值抄原版，但解锁状态/科技树
//    完全独立（打过原版战役的存档不会在牡丹亭"白嫖"解锁）。
//
// 命名规范：全小写 + 连字符（kebab-case），与贴图文件名、JSON 文件名三处一致。

// ---------- 帮手函数（从 VE 参考模组抄的，一行没改） ----------
// 函数 = 一段可重复使用的代码。这里把"创建+登记+导出"打包成 helper，
// 每次注册内容只需要一行 newItem("名字")。
function newItem(name) {            // 参数 name：内容名（字符串）
	exports[name] = extend(Item, name, {});   // 创建 Item 对象，放进本文件的出口清单
}
function newLiquid(name) {          // 液体版 helper，类换成 Liquid
	exports[name] = extend(Liquid, name, {});
}

// ============================================
// 一、变种物品（sp- 前缀，11 个）
// 原版就有的资源，在牡丹亭里做成独立版本。
// 数值抄原版（Items.java），显示名/描述用牡丹亭的（bundles 里写）。
// 科技树全部挂牡丹亭独立树（research 见各 JSON 文件）。
// ============================================

newItem("sp-lead");             // 铅（原版 lead 变种）—— 牡丹亭科技树根节点
newItem("sp-graphite");         // 石墨（原版 graphite 变种）
newItem("sp-titanium");         // 钛（原版 titanium 变种）
newItem("sp-thorium");          // 钍（原版 thorium 变种）
newItem("sp-silicon");          // 硅（原版 silicon 变种）
newItem("sp-metaglass");        // 钢化玻璃（原版 metaglass 变种）
newItem("sp-plastanium");       // 塑钢（原版 plastanium 变种）
newItem("sp-blast-compound");   // 爆炸混合物（原版 blast-compound 变种）
newItem("sp-coal");             // 煤炭（原版 coal 变种）
newItem("sp-sand");             // 沙子（原版 sand 变种）
newItem("sp-scrap");            // 废料（原版 scrap 变种）

// ============================================
// 二、变种液体（sp- 前缀，5 个）
// 同上，但类是 Liquid。原版液体数值抄 Liquids.java。
// 注意：Mindustry 里"气体"也是液体，只是 gas: true（见各 JSON）。
// ============================================

newLiquid("sp-water");          // 水（原版 water 变种）
newLiquid("sp-cryofluid");      // 冷却液（原版 cryofluid 变种）
newLiquid("sp-slag");           // 矿渣（原版 slag 变种）
newLiquid("sp-oil");            // 石油（原版 oil 变种）
newLiquid("sp-hydrogen");       // 氢气（原版 hydrogen 变种，原版就是气体）

// ============================================
// 三、新增物品（26 个）—— 原版没有，牡丹亭独有
// 设计文档：基础 / 合成 / 自然
// 贴图已画的直接可用；没画/待定的在注释里标注 TODO，JSON 后续补。
// ============================================

// —— 基础（5）——
newItem("iron");                // 铁（贴图✓ iron.png）
newItem("cobalt");              // 钴（贴图✓ cobalt.png）
newItem("gold");                // 金（贴图✓ gold.png）
newItem("uranium");             // 铀（贴图✓ uranium.png）
newItem("iridium");             // 铱（TODO: 设计文档未写完，无贴图）

// —— 合成（16）——
newItem("steel");               // 钢（贴图✓ steel.png）
newItem("magnet");              // 永磁体（TODO: 无贴图）
newItem("computer-chip");       // 计算芯片（贴图✓ computer-chip.png）
newItem("shinstar-alloy");      // 耀星合金（贴图✓ shinstar-alloy.png）
newItem("raindawn-salt");       // 虹霞盐（贴图✓ raindawn-salt.png）
newItem("sunshine-crystal-lattice"); // 灿阳晶格（贴图✓ sunshine-crystal-lattice.png）
newItem("autocannon-ammo");     // 机炮弹药箱（TODO: 贴图 light-ammobox.png 是否对应？待确认）
newItem("artillery-ammo");      // 炮弹弹药箱（TODO: 贴图 heavy-ammobox.png 是否对应？待确认）
newItem("missile-ammobox");     // 导弹弹药箱（贴图✓ missile-ammobox.png）
newItem("uranium-fuelrod");     // 铀燃料棒（贴图✓ uranium-fuelrod.png）
newItem("thorium-fuelrod");     // 钍燃料棒（贴图✓ thorium-fuelrod.png）
newItem("lead-capacitor");      // 铅电容（贴图✓ lead-capacitor.png）
newItem("nuclear-capacitor");   // 核能电容（TODO: 无贴图）
newItem("super-capacitor");     // 超级电容（TODO: 无贴图）
newItem("data-unit");           // 数据单元（贴图✓ data-unit.png）
newItem("advanced-data-unit");  // 高级数据单元（TODO: 无贴图）

// —— 自然（5）——
newItem("salt");                // 盐（贴图✓ salt.png）
newItem("wood");                // 木材（TODO: 无贴图）
newItem("sulfide");             // 硫化物（TODO: 无贴图）
newItem("crystal");             // 水晶（TODO: 无贴图）
newItem("ice");                 // 冰（TODO: 无贴图）

// ============================================
// 四、新增液体（4 个）—— 原版没有
// ============================================

newLiquid("refined-oil");       // 精炼燃油（贴图✓ refined-oil.png）
newLiquid("ethanol");           // 乙醇（贴图✓ ethanol.png。注意：原版没有乙醇！）
newLiquid("oxygen");            // 氧气（贴图✓ oxygen.png。原版只有臭氧 ozone，没有氧气）
newLiquid("natural-gas");       // 天然气（贴图✓ natural-gas.png）

// ============================================
// 注册完成。下一行 log 只在游戏控制台打日志，方便确认加载到这。
// ============================================
log("items.js 加载完成");
