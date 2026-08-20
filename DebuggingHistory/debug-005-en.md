# debug-005: Tech Tree Mechanics Deep-Dive — "One JSON Field, One In-Game Tree"

> **Date**: 2026-08-20
> **Background**: Analyzing how tech trees are written in mods, using the VE reference mod and the game source code, to plan the Starfield tech tree layout.
> **Related Files**:
>
> - `content/blocks/special/sp-damaged-core.json` (Starfield, tree root node, already in place)
> - `content/blocks/special/sp-core-mk1.json` (Starfield, Type-I Core, currently hangs under `sp-silicon`)
> - `content/items/*.json`, `content/liquids/*.json` (Starfield, variant resources already on the tree)
> - `scripts/items.js` (Starfield, 26 new items + 4 new liquids have **only JS shells, no research yet**)
> - `mod.json` (Starfield, `contentOrder` is the fix for the parse-order pitfall)
> - `Factory/ref/Vanilla-Expansion-Mod-2111/content/` (reference: 650 JSON files carry a `research` field)
> - `Factory/ref/Vanilla-Expansion-Mod-2111/content/blocks/tech-tree-only/core-nucleus-root.json` (reference: root-node example)
> - `Factory/ref/Vanilla-Expansion-Mod-2111/content/blocks/distribution/warp-driver.json` (reference: objectives example)
> **Source Files Referenced** (Mindustry master branch):
> - `core/src/mindustry/content/TechTree.java` (entire file, 204 lines, node tree structure)
> - `core/src/mindustry/content/SerpuloTechTree.java` (vanilla code-based tree building example, 768 lines)
> - `core/src/mindustry/mod/ContentParser.java` (lines 1268–1423, JSON `research` field parsing)
> - `core/src/mindustry/type/Planet.java` (lines 452–458, planets auto-link to tree roots)
> - `core/src/mindustry/world/Block.java` (lines 1271–1282, default research cost formula)
> - `core/src/mindustry/ctype/UnlockableContent.java` (lines 109–118 `loadIcon` icon fallback chain; lines 205–207, items/liquids have no default research cost)
> - `core/src/mindustry/mod/Mods.java` (lines 382–426 `packSprites`, mod sprite packing/naming)
> - `core/src/mindustry/game/Objectives.java` (entire file, 5 research objective types)
> - `core/assets/bundles/bundle_zh_CN.properties` (lines 236–238, `techtree.<name>` localization keys)
> - `Factory/Starfield/DebuggingHistory/debug-004-模组内容加载机制详解.md` (previous entry, JS+JSON dual-track system)

---

## 0. Background & Goals

The Starfield planets are lit, items are registered, and the cores exist. The next big question is: **in what order, and under what conditions, does the player "unlock" all of this in-game?**

The answer is the **tech tree (Tech Tree)** — the only content-unlock system in Mindustry's campaign. From the planet screen the player opens the "Tech Tree," researches nodes top to bottom, and only then unlocks the blocks, units, and the ability to launch into new sectors.

Before writing anything, three things need to be clear:

1. **How does the VE reference mod (650 files with research) write it?**
2. **In the game source, how does a JSON field actually grow into a tree?**
3. **What structure should the Starfield tech tree follow?**

The goal of this document: after reading it, you can **understand on your own** what any `"research"` field in VE does and what the game does at each step — then attach correct tech-tree nodes to Starfield's new items, blocks, and units.

> Reader level: same as debug-004 — you understand basic programming concepts but are **not familiar with JS/Java source**. Every proper noun is **bolded** and explained at first use. The "JS registers shells + JSON fills properties" dual-track system from debug-004 is prerequisite knowledge.

---

## 1. Mental Model: What a Tech Tree Is

The game has an invisible "**tech tree registry**" (in source: `TechTree`). It maintains two things:

- **`TechTree.all`**: the master list of every tech node (one node = one researchable content + its cost + its prerequisites).
- **`TechTree.roots`**: the list of all "tree roots." **One tree = one planet's tech tree entry point.** When you open a planet's tech tree screen, you see the whole subtree growing down from its root.

Each node (in source: `TechNode`) looks like this:

```text
TechNode
 ├─ content        → which content this node represents (item/liquid/block/unit)
 ├─ parent/children→ parents and children (shape of the tree's branches)
 ├─ depth          → which layer it is on (root is 0)
 ├─ requirements   → research cost (how many materials to pay)
 ├─ objectives     → extra conditions (e.g. "must first reach a certain sector")
 └─ planet         → which planet it belongs to (children auto-inherit from parent)
```

**One-sentence mental model**: adding a `"research"` line to JSON = telling the game "hang this content somewhere on the tech tree"; writing `"root": true` = "start a new tree here, bound to a certain planet."

---

## 2. How the VE Reference Mod Writes It

All **650 JSON content files** in VE carry a `"research"` field — **pure JSON declaration; grep finds no `TechTree` code in scripts/ at all**. Only two forms:

### Form 1: String shorthand (most common)

The parent points at a node; this content hangs under it:

```json
// content/units/new-types-sitrullus/zenith-small-sharded.json
"research": "small-unit-constructor-sharded"
```

### Form 2: Object (full feature set)

**Tree root example** (`content/blocks/tech-tree-only/core-nucleus-root.json`):

```json
{
  "requirements": [ "copper/8000", "lead/8000", "thorium/4000", "silicon/5000" ],
  "category": "effect",
  "size": 5,
  "research": {
    "root": true,               // become the root of an independent tree
    "planet": "ve-cyclant",     // bind to a planet (that planet's tech tree entry)
    "alwaysUnlocked": true,     // unlocked from the start
    "researchCostMultiplier": 0 // free to research
  }
}
```

**Ordinary node** (`content/blocks/turrets/bake.json`):

```json
"research": { "parent": "rise" }
```

**High-tier node gated behind a sector** (`content/blocks/distribution/warp-driver.json`):

```json
"research": {
  "parent": "mass-railgun",
  "objectives": [ { "type": "OnSector", "preset": "warp-tech-base" } ]
}
```

> **Units work the same way**: `content/units/*.json` simply write `"research": "previous-unit-name"`, nothing fancy. VE builds "a tree" purely from a root node + parent chains — **no JS tree-building code whatsoever**.

---

## 3. A Complete Example: One Chain from the Root to the Type-I Core (Starfield in Action + VE Side-by-Side)

The first two sections covered "what it is" and "the two forms," but that can feel scattered. This section ties them together into **one complete example** using Starfield's own **real files**, building the chain below step by step, with VE's original files alongside at every step.

```text
[root] sp-damaged-core (Damaged Core, present from the start)
 ├─ sp-lead (Lead)                    ← Step 2: item hangs under the root
 └─ sp-sand (Sand)
      └─ sp-silicon (Silicon)             ← Step 3: item hangs under item
           └─ sp-core-mk1 (Type-I Core)    ← Step 4: block hangs under item
```

> **First, clear up a common misconception**: the tech tree is **not "built centrally in one folder."** The root declaration is indeed singular (it lives in `content/blocks/special/` because it happens to be a CoreBlock, i.e. a blocks-type content), but **every other content — items, liquids, blocks, units — attaches itself with a single `research` line in a JSON file inside its own type's folder**. Which folder a file lives in is decided by content type, not by the tech tree. The special folder only holds the root because the root happens to be a "special block."

### Step 1: Create the tree root (the only place you "open a new tree")

`content/blocks/special/sp-damaged-core.json` (existing file — look at the research field only):

```json
"research": {
  "root": true,       // ① declare "start a new tree from here"
  "name": "繁星",      // ② tree name shown in the planet tech-tree screen
  "planet": "viar"    // ③ bind the tree to planet viar
}
```

What each line does:

- ① `root: true`: this tree has **no parent**; the node enters `TechTree.roots` by itself.
- ② `name`: the title shown in the planet selector / tech-tree screen (overridable by the bundle key `techtree.繁星`, see 4.7).
- ③ `planet`: **the only mechanism that binds a tree to a planet** (see 4.4). During init, viar runs `TechTree.roots.find(n -> n.planet == viar)` and finds this tree as its tech-tree entry.

VE side-by-side (`content/blocks/tech-tree-only/core-nucleus-root.json`) — the same trio, just with VE's planet, plus two extra lines:

```json
"research": {
  "root": true,
  "planet": "ve-cyclant",
  "alwaysUnlocked": true,      // unlocked from the start (no research needed)
  "researchCostMultiplier": 0  // research cost × 0 (free)
}
```

> Why does VE have those two extra lines? VE's root is something the player already "has" (they start the game with it), so it must not show up in the research list — hence `alwaysUnlocked` + free. Starfield's Damaged Core is placed by the map at start and has `configurable: false` (not in the build menu), so it can't be researched anyway; those two lines were omitted. Add them later if you want it to become researchable.

### Step 2: Hang the first item (item → root)

`content/items/sp-lead.json` (existing file):

```json
{
  "color": "8c7fa9",
  "hardness": 1,
  "cost": 0.7,
  "research": {
    "parent": "sp-damaged-core"   // hang under the "Damaged Core" node
  }
}
```

Key points:

- **`parent` is written as the "content name," not the file name, not the folder name.** The parser looks up a node named `sp-damaged-core` in `TechTree.all` (it also tries the mod-prefixed form `Starfield-sp-damaged-core` automatically), then hangs Lead under it.
- Because blocks parse **before** items, the root (a block) naturally exists before Lead (an item) — **an item hanging under a block never hits the parse-order pitfall**.
- Research cost: items default to 0 cost + an automatic "produce it" objective (see 4.5, 4.6) — so researching Lead = getting hold of one Lead.

VE side-by-side (`content/items/sitrullus/melon-dirt.json`): the same thing in **string shorthand**:

```json
"research": "core-nucleus-root-sitrullus"
```

A string is just shorthand for writing only the parent; it behaves exactly like `{ "parent": "..." }`. **You can mix the two forms freely** — VE uses both.

### Step 3: Chained attachment (item → item)

`content/items/sp-silicon.json` (existing file):

```json
{
  "color": "53565c",
  "cost": 0.8,
  "research": {
    "parent": "sp-sand"   // Silicon's recipe is "sand + coal → silicon", so it hangs under sand
  }
}
```

What hangs where is **decided by gameplay logic, not by any technical constraint**: Silicon is refined from sand → hang it under `sp-sand`; the player researches Sand first, then Silicon, giving the tree a sense of progression. If everything hung under the root, the research screen would be one flat layer with no depth.

Note the alphabetical order here: `sp-sand` (sand) sorts before `sp-silicon` (silicon) (s-a < s-i), so the parent parses first — **this chain is safe**. The reverse case `sp-metaglass → sp-sand` would trip the pitfall (m < s, child parses first); see Section 5.

### Step 4: A block hanging under an item + the parse-order pitfall in practice

`content/blocks/special/sp-core-mk1.json` (existing file):

```json
"research": {
  "parent": "sp-silicon"   // Type-I Core unlocked via the "data-chain/computing" tech
}
```

This is a **block hanging under an item**: blocks parse first, items later — so when `sp-core-mk1` parses, `sp-silicon` doesn't exist yet, triggering the "isn't in the tech tree" warning from Section 5. The fix is `mod.json`'s `contentOrder`, which forces the referenced items to parse **first**:

```json
"contentOrder": ["sp-sand", "sp-coal", "sp-water", "sp-silicon"]
```

The four items in `contentOrder` skip alphabetical ordering and load first (Mods.java:882), so by the time the Type-I Core attaches to Silicon, Silicon is already in the tree.

VE side-by-side: `content/blocks/turrets/bake.json` → `"research": { "parent": "rise" }` — bake and rise are both **blocks**, same type, and bake(b) < rise(r) also satisfies "parent parses first," so VE needs no contentOrder. **Only type-inverted cases like "block under item" require contentOrder.**

### Step 5: Where the research cost comes from

On this chain:

- The three items (Lead, Sand, Silicon) — **0 cost** + automatic "produce" objective (default).
- The Type-I Core (a block) — cost defaults to the formula over its build requirements (see 4.5): `requirements` is `iron/1000 + sp-lead/1000`, so each material costs roughly `60 + amount^1.11 × 20`, times `researchCostMultiplier` (default 1).
- To change it: `"researchCostMultiplier": 0.35` (scale by factor) or `"research": { "requirements": ["iron/500", "sp-silicon/200"] }` (fully custom).

### Step 6: What you actually see in-game

Launch the game → planet screen → select viar → open the "Tech Tree":

1. The tree title in the top-left reads "繁星" (the `name` from Step 1);
2. The root node is the Damaged Core, with Lead and Sand hanging directly under it — **researchable from the start**;
3. Click Silicon: it shows "requires Sand to be researched first" (from the attachment) + "need 1 Sand" (Produce objective) — you must research Sand before Silicon;
4. Click the Type-I Core: it shows "requires Silicon" + the material cost (computed in Step 5) — research Silicon, pay the materials, and the Type-I Core's build permission unlocks;
5. Back on viar, you can now build the Type-I Core in the core zone around the Damaged Core.

**One-sentence summary of the whole flow**: the root declares "open a tree + bind a planet" (done once) → every content writes `research` in its own JSON, with `parent` pointing at "whoever it should hang under" → get the content name right and parse the parent early enough, and the tree grows correctly.

---

## 4. Game Source Mechanics, Piece by Piece

### 4.1 The Node Tree Itself (`TechTree.java`, 204 lines)

This is the tech tree's "data structure" file. Key points:

- Two global lists: `TechTree.all` / `TechTree.roots`.
- `nodeRoot(name, content, children)`: creates a tree root; `name` is used for the planet selector display.
- `node(content, requirements, objectives, children)`: creates a node and hangs it under the **current context** (the `context` variable) — vanilla code builds trees through this context pointer via recursive nesting.
- Every node constructor automatically does two things:
  1. Walks back toward the root and **inherits** `planet` and `researchCostMultipliers` (cost multipliers).
  2. Turns the content's **dependencies** (`content.getDependencies`) into automatic `Research` objectives — e.g. if a block depends on an item, researching the block automatically requires researching that item first.

### 4.2 How Vanilla Builds Trees (`SerpuloTechTree.java` / `ErekirTechTree.java`)

Vanilla (non-mod) tech trees are **written in code**, as nested lambdas:

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

Parenthesis nesting = tree depth. **This is for the game itself; mods don't need to do this** — mods use the JSON parser from 3.3. Knowing it exists is only to understand "what the final tree looks like."

### 4.3 The JSON Parser (`ContentParser.java:1268–1423`) — the Heart of It All

This is the real entry point for mod tech trees. `readFields` **removes** `research` from the JSON up front and handles it separately. Full flow:

1. **Read the parent name**: string → used directly; object → take the `parent` field; neither and not a root → warning "not a root node and has no `parent:` property. Ignoring."
2. **Read custom cost**: `research.requirements` if present, otherwise leave empty (the content's default cost is used later).
3. **Remove the old node**: if this content was already on a tree before (e.g. patching vanilla content), detach the old node first.
4. **Create the node**: `new TechNode(null, content, requirements)` — note the parent is null here; it's an orphan.
5. **Deferred attachment (postreads)**: node creation is queued and executed **in parse order** one by one:
   - Add custom objectives; **items/liquids automatically get a `Produce` (produce it) objective**;
   - No custom requirements → use `content.researchRequirements()`;
   - Has a `planet` field → assign that planet (used for roots);
   - `root: true` → add to `TechTree.roots`; `name` / `requiresUnlock` take effect;
   - Otherwise → search `TechTree.all` for the parent node, matching **three spellings**: the bare name / `modname-name` / `SaveVersion.mapFallback(name)` (so shorthand works in JSON). If found, push the node into the parent's children and inherit the parent's planet; if not found, warn "Content 'X' isn't in the tech tree, but 'Y' requires it to be researched."

> **Two key takeaways from this flow**:
>
> 1. Parent matching supports shorthand, but the parent **must already exist** — which directly causes the parse-order pitfall in Section 5.
> 2. The root node's `"name"` field is the title of the planet's tech tree screen (with bundle localization, see 4.7).

### 4.4 Planet Auto-Linking (`Planet.java:452–458`)

A planet's `init()` runs:

```java
if(techTree == null){
    techTree = TechTree.roots.find(n -> n.planet == this);   // find the root whose planet field equals this planet
}
if(techTree != null && autoAssignPlanet){
    techTree.addDatabaseTab(this);   // add all tree content to this planet's database tab
    techTree.addPlanet(this);        // mark this content as belonging to the planet
}
```

**So the root node's `"planet"` field is the only mechanism that attaches a tree to a planet.** Viar finds the "Starfield" tree by itself during init — that's why `"planet": "viar"` in `sp-damaged-core.json` is so critical. Child nodes inherit their planet from the parent all the way down; you don't write it on every node.

### 4.5 The Research Cost Formula (`Block.java:1271–1282`)

A block's (buildable building's) default research cost is computed from its **build requirements**:

```text
per-item cost = round( 60 × mult + buildReqAmount^1.11 × 20 × mult , 10 )
```

- `mult` = the `researchCostMultiplier` field (VE commonly uses `0.35` to keep late-game big builds cheap to research).
- Want full control → `"research": { "requirements": ["iron/500", "sp-silicon/200"] }`.
- Items/liquids have **no default cost** (`UnlockableContent.researchRequirements()` returns an empty array) → researching them only requires the `Produce` objective (build/produce it).
- Want a tree root free from the start → `"alwaysUnlocked": true` + `"researchCostMultiplier": 0` (that's exactly how VE's roots are written).

### 4.6 Research Objective Types (`Objectives.java` — exactly 5 in the whole file)

| Type | Meaning | Typical use |
| --- | --- | --- |
| `Research` | Research some content | Auto-generated from content dependencies (4.1 point 2) |
| `Produce` | Produce some content | Auto-added to items/liquids |
| `SectorComplete` | Complete a sector | Lock tech behind late-campaign progress |
| `OnSector` | **Reach** a sector | VE's workhorse: `{"type":"OnSector","preset":"warp-tech-base"}` |
| `OnPlanet` | Reach a planet | Cross-planet tech |

### 4.7 Bundle Localization (`techtree.<name>` key)

Vanilla example (`bundle_zh_CN.properties` lines 236–238):

```properties
techtree.select = 切换科技树
techtree.serpulo = 塞普罗
techtree.erekir = 埃里克尔
```

Node display name rule (`TechTree.java`'s `localizedName()`): `Core.bundle.get("techtree." + name, name)` — **if the bundle has `techtree.<name>` it's used, otherwise it falls back to the name itself**. So a Chinese `name` (like "繁星") displays fine with no bundle key and won't crash; if you want an ASCII internal name with a localized display name, add a `techtree.<internal-name> = 繁星` entry.

### 4.8 Node Icons (`icon`) — by Default, Just the Content's Own Sprite, Zero Config

The icon on every tech-tree node (drawn by `node.icon()` in `ResearchDialog`) is **by default the content's own sprite**. No icon code, no icon files needed: as long as the content's sprite exists, the node icon appears automatically. VE's tech-tree-only folder is the proof — grep finds no icon code in its scripts at all.

The mechanism chain (3 hops, all automatic):

1. **Node → content** (`TechTree.java:159-161`): if the node's `icon` field was never set manually, `icon()` returns `new TextureRegionDrawable(content.uiIcon)`.
2. **uiIcon → sprite** (`UnlockableContent.java:117-118`): it first looks for `<type>-<contentName>-ui` (e.g. `item-sp-lead-ui`), falling back to fullIcon.
3. **fullIcon's fallback chain** (`UnlockableContent.java:110-116`), from most preferred to least: `fullOverride` (manually set in JSON) → `<type>-<contentName>-full` → `<contentName>-full` → **`<contentName>`** → `<type>-<contentName>` → `<contentName>1`.

Why mods "auto-hit": when mod sprites are packed (`Mods.java:382-426`, `packSprites`), every png under `sprites/` is **collected recursively** (subfolders don't matter, only the file name), and the atlas name is **`modname-filename`** (e.g. `sprites/items/iron.png` → `Starfield-iron`); a mod content's name (after transformName) is also `Starfield-iron`. **The two match → entry 4 (`<contentName>`) hits directly.** Subfolders (blocks/items/tech-tree-only/…) are purely organizational; they don't affect loading.

VE case study: `content/blocks/tech-tree-only/core-nucleus-root.json` is a "fake block" (`buildVisibility: editorOnly` — not in the build menu, alive only in the tech tree) — its node icon is its own sprite `sprites/blocks/tech-tree-only/core-nucleus-root.png`, working automatically. Also note: sprites like `sprites/items/tech-tree-only/lead-node.png` are leftovers of **discarded content** in `content/unused/` (the unused folder is not loaded); they are not part of the current mechanism — don't be misled by them.

To customize an icon (distinct from the build sprite):

- Drop a `<contentName>-ui.png` (e.g. `sprites/items/sp-lead-ui.png`) → UI (including the tech-tree node) uses it, while the build/entity keeps the original sprite;
- Write `"fullOverride": "some-other-atlas-name"` in JSON → force the whole chain to use that sprite;
- Set `node.icon = ...` manually in JS (not recommended when on the JSON route).

> ⚠️ **Starfield current state**: all 37 sprites under `sprites/` are present, but the **`blocks/` folder is empty** — `sp-damaged-core` and `sp-core-mk1` have no sprites, so the whole fallback chain misses and they show Arc's **error texture** (a magenta error image). **The tech-tree root node icon (Damaged Core) is currently that error texture.** Fixing it just needs two sprites: `sprites/blocks/special/sp-damaged-core.png` and `sprites/blocks/special/sp-core-mk1.png` (a 3×3 block = 96×96 px; a 1×1 tile = 32 px).

---

## 5. The Parse-Order Pitfall: the `contentOrder` Rule (must follow)

Tech nodes are attached in **parse order** during `ContentParser.finishParsing()` (the postreads from 4.3), and parse order = **ContentType order (blocks first, items/liquids later) + file-name alphabetical order** (see debug-004 Section 5).

**Rule: the parent must parse before the child**, otherwise `ContentParser.java:1405` warns `"Content 'XXX' isn't in the tech tree"`, and the node becomes an orphan — gone from the tree.

The 5 counterexamples Starfield already hit (debug-004, line 489):

- `sp-metaglass → sp-sand`, `sp-blast-compound → sp-coal`, `sp-cryofluid → sp-water`, `sp-hydrogen → sp-water` (same type, alphabetically later), `sp-core-mk1 → sp-silicon` (blocks parse before items).

The fix = `mod.json`'s `contentOrder`, which forces the referenced parents to parse early (`Mods.java:882` loads them in list order first). Current `contentOrder`:

```json
"contentOrder": ["sp-sand", "sp-coal", "sp-water", "sp-silicon"]
```

**From now on, whenever new content's parent parses later than the child (alphabetically or by type), the parent must be added to `contentOrder`.** This is the #1 pitfall in tech-tree development for this project.

---

## 6. Starfield Current State

### ✅ Already done (on the tree)

| Content | Position | Notes |
| --- | --- | --- |
| `sp-damaged-core` | **Tree root**, `"root": true`, `"name": "繁星"`, `"planet": "viar"` | Viar auto-attaches this tree |
| 11 variant items | Mostly hang directly under the root; `sp-silicon → sp-sand` has depth | 0 research cost + auto Produce |
| 5 variant liquids | Mostly under the root; `sp-hydrogen → sp-water` has depth | Same as above |
| `sp-core-mk1` | Under `sp-silicon` | Comment already plans: re-parent under `data-unit` once the data-chain JSON exists |

### ⚠️ Key gap

The **26 new items + 4 new liquids** registered in `scripts/items.js` (iron, cobalt, gold, uranium, steel, computer-chip, data-unit, lead-capacitor, nuclear-capacitor, super-capacitor, uranium-fuelrod, thorium-fuelrod, autocannon-ammo, artillery-ammo, missile-ammobox, salt, wood, sulfide, crystal, ice, refined-oil, ethanol, oxygen, natural-gas…) have **only JS shells — no JSON files, therefore no research**. They're on no tech tree right now: invisible in the research screen, unlockable nowhere in the campaign.

Also: the bundle has no `techtree.繁星`-style key yet (not required to display, see 4.7).

---

## 7. How the Starfield Tech Tree Should Be Written (recommendations)

### 7.1 Route: keep it pure JSON declaration

Consistent with VE and with Starfield's existing code style. **Don't mix in JS `TechTree.node()`** — mixing the two systems makes parent ordering much harder to reason about, and violates the "shells in JS, properties in JSON" dual-track principle.

### 7.2 Suggested tree structure (layered sketch; defer to the design doc)

```text
[root] sp-damaged-core (viar, free at start)
 ├─ Basic resources: sp-lead / sp-coal / sp-sand / sp-water / iron / salt / wood
 ├─ Intermediate resources:
 │   ├─ sp-graphite ← sp-coal
 │   ├─ sp-silicon  ← sp-sand
 │   ├─ steel       ← iron
 │   └─ sp-metaglass / sp-titanium / sp-thorium / sp-plastanium / sp-blast-compound (under their own feedstocks)
 ├─ Rare ores: cobalt / gold / uranium (under the root or under a drill block)
 ├─ Electronics chain (modular, easy to insert into later):
 │   computer-chip ← sp-silicon → data-unit → advanced-data-unit
 │   └─ later, re-parent sp-core-mk1 from sp-silicon to here (as the comment plans)
 ├─ Power chain: lead-capacitor → nuclear-capacitor → super-capacitor; uranium-fuelrod / thorium-fuelrod
 ├─ Ammo chain: autocannon-ammo / artillery-ammo / missile-ammobox
 └─ New liquids: refined-oil / ethanol / oxygen / natural-gas (under their feedstock or the root)
```

### 7.3 One line per new content

```json
// content/items/steel.json
"research": { "parent": "iron" }

// content/items/computer-chip.json
"research": { "parent": "sp-silicon" }

// content/items/data-unit.json
"research": { "parent": "computer-chip" }
```

Note: if `data-unit`'s JSON alphabetically sorts before `sp-core-mk1` (d < s, so it does), and `sp-core-mk1` is later re-parented under it, check both parse orders and update `contentOrder` accordingly.

### 7.4 Cost strategy

- **Items/liquids: keep the default** (0 cost + auto Produce) — researching an item just requires producing it; feels best, consistent with VE.
- **Production blocks:** tune with `researchCostMultiplier` (0.3–1.0); for exact control write `"research": { "requirements": [...] }`.
- **Cores/special blocks:** copy VE's root style (`alwaysUnlocked: true` + `researchCostMultiplier: 0`).

### 7.5 Campaign-gated tech (when sectors exist later)

Add objectives so the player must first reach/occupy a sector to research:

```json
"research": {
  "parent": "mass-driver",
  "objectives": [ { "type": "OnSector", "preset": "your-sector-name" } ]
}
```

The sector preset must be defined first (`content/sectors/` + a sector map); VE's `warp-tech-base` is a complete example.

### 7.6 Wrap-up

- Optionally add `techtree.繁星 = 繁星` to the bundle (3.7 covers the fallback).
- Run every new research-bearing JSON through the checklist in Section 7.

---

## 8. Quick Checklist (verify each item when adding a tech-tree node)

1. □ The content is an UnlockableContent (item/liquid/block/unit/sector preset) — only these can go on the tree.
2. □ `research` is written: string shorthand, or an object with `parent`.
3. □ The parent exists and **parses before this content** (check both type order and alphabetical order); if not → add it to `contentOrder`.
4. □ The root node carries `"planet"` (internal name, e.g. `viar`), plus `alwaysUnlocked: true` + `researchCostMultiplier: 0`.
5. □ Cost strategy chosen: default (via `researchCostMultiplier`) / custom (`research.requirements`) / free (root style).
6. □ Campaign-gated tech has objectives (`OnSector` / `SectorComplete` / `OnPlanet`), and the sector preset exists.
7. □ Added `techtree.<name>` to the bundle if needed.
8. □ Items/liquids don't need `requirements` (default 0 cost + auto Produce).

---

## Appendix: Source Quick Reference

| What to look up | Where to look |
| --- | --- |
| Node data structure, inheritance logic | `content/TechTree.java` |
| Vanilla code-based tree building example | `content/SerpuloTechTree.java` |
| Full JSON research parsing flow | `mod/ContentParser.java:1268-1423` |
| Planet ↔ tree-root linking | `type/Planet.java:452-458` |
| Default block research cost | `world/Block.java:1271-1282` |
| Default item/liquid cost | `ctype/UnlockableContent.java:205-207` |
| Node icon default source | `TechTree.java`'s `icon()`, `ctype/UnlockableContent.java`'s `loadIcon()` |
| Mod sprite packing/naming | `mod/Mods.java:382-426` (`packSprites`) |
| Objective types list | `game/Objectives.java` |
| Tree-name localization | `TechTree.java`'s `localizedName()`, bundle `techtree.*` |
