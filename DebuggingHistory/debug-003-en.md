# debug-003: Creating the Orange Giant Star Aldebaran & Debugging Star Rendering Issues

> **Date**: 2026-08-01  
> **Related Files**:
> - `content/planets/aldebaran.json` (created)
> - `content/planets/peony-pavilion.json` (modified)
> - `bundles/bundle.properties` (modified, added Aldebaran entries)
> - `bundles/bundle_zh_CN.properties` (modified, added 毕宿四 entries)
> **Source Files Referenced**:
> - `mindustry/type/Planet.java`
> - `mindustry/mod/ContentParser.java` (lines 804–862 planet parsing, lines 1124–1159 mesh parsing)
> - `mindustry/graphics/g3d/SunMesh.java`
> - `mindustry/graphics/g3d/PlanetRenderer.java` (lines 43, 106–144, 171–172)
> - `mindustry/game/Universe.java` (lines 40–60)
> - `mindustry/ui/dialogs/PlanetDialog.java` (lines 745–764)
> - `mindustry/content/Planets.java` (vanilla sun definition)
> - `Factory/ref/Vanilla-Expansion-Mod-2111/content/planets/sol2.json` (reference mod)
> - `Factory/ref/Vanilla-Expansion-Mod-2111/bundles/bundle.properties` (bundle key format reference)
> - `Factory/ref/Vanilla-Expansion-Mod-2111/bundles/bundle_zh_CN.properties` (bundle key format reference)

---

## 0. Background & Goals

The Peony Pavilion mod's planet `peony-pavilion` originally orbited the vanilla sun (`"parent": "sun"`). This task required:

1. **Create a new star** — Aldebaran (毕宿四, internal name `aldebaran`), an orange giant (K-type spectrum), reddish-orange in color
2. **Re-parent Peony Pavilion** to orbit Aldebaran instead of the vanilla sun
3. **Make Aldebaran a standalone solar system root** — appearing as a second solar system tab in the planet selection UI

We successfully created two independent solar systems (vanilla sun system + Aldebaran–Peony Pavilion system), but encountered two critical rendering problems (star invisible, bloom not triggering) that required deep source code investigation.

---

## 1. Key Concepts

Before diving into the details, three foundational concepts:

### 1.1 Planet Hierarchy

All celestial bodies in Mindustry form a tree:

```
sun (parent=null, system root)         aldebaran (parent=null, system root)
├── erekir (orbits sun)                └── peony-pavilion (orbits Aldebaran)
├── tantros
├── serpulo
└── ...
```

- **`parent = null`** planets are solar system roots — they orbit nothing, `position` always `(0,0,0)`
- **`solarSystem`** field: each planet traces up the parent chain via `for(solarSystem = this; solarSystem.parent != null; solarSystem = solarSystem.parent)`. Self-reference (`"solarSystem": "aldebaran"` in JSON) explicitly declares an independent solar system
- **`children`**: list of child planets, maintained automatically by `parent.children.add(this)` in the constructor

### 1.2 How SunMesh Renders a Star's Surface

`SunMesh` extends `HexMesh` using `Shaders.unlit` (no lighting shader). Its color generation logic (`SunMesh.java` lines 14–17):

```java
public void getColor(Vec3 position, Color out){
    double height = Math.pow(Simplex.noise3d(0, octaves, persistence, scl,
        position.x, position.y, position.z), pow) * mag;
    out.set(colors[Mathf.clamp((int)(height * colors.length), 0, colors.length - 1)])
        .mul(colorScale);
}
```

3D Simplex noise produces a scalar `height` (0 ~ mag) across the sphere, which selects a color from the `colors` array by proportional index. Since noise is smooth and continuous, the surface exhibits organic "mottled" texture rather than random salt-and-pepper noise.

### 1.3 Bloom Glow Trigger Condition

`PlanetRenderer.java` lines 31–32 define bloom post-processing:

```java
public final Bloom bloom = new Bloom(...){{
    setThreshold(0.8f);  // ← only pixels with brightness ≥ 0.8 trigger bloom
    blurPasses = 6;
}};
```

**Threshold 0.8** means: only colors whose maximum RGB component is ≥ 204/255 will produce a glow halo. The vanilla sun's colors are all at `ff` level (max 1.0), so its entire surface glows. If colors are too dark, the star looks like a non-luminous plain sphere.

---

## 2. Implementation Plan

### 2.1 References

| Reference | Purpose |
|-----------|---------|
| `Planets.java:29-44` vanilla sun | Understand SunMesh parameters and required star planet fields |
| `sol2.json` (VE mod) | Reference for complete JSON star: `solarSystem` self-reference, `children` array, `bloom`+`accessible` |
| `ContentParser.java:804-862` | Understand how JSON planets are parsed into Planet objects |
| `ContentParser.java:1140-1149` | Understand SunMesh JSON parameter → Java constructor mapping |

### 2.2 New File: `content/planets/aldebaran.json`

Core fields of the final version (after fixing Issues 1 & 2):

```jsonc
{
  "name": "aldebaran",            // Internal content name; display name provided via bundles
  "radius": 8,                  // Radius (vanilla sun=4, giant needs larger)
  "bloom": true,                // Trigger bloom post-processing glow
  "hasAtmosphere": false,       // Stars don't need atmospheric scattering
  "accessible": false,          // Not landable
  "solarSystem": "aldebaran",   // Self-reference = independent solar system tab
  "children": ["peony-pavilion"],
  "mesh": {
    "type": "SunMesh",
    "divisions": 5,             // Hex subdivision level
    "octaves": 5,               // Noise octaves (surface texture complexity)
    "persistence": 0.3,         // Fractal noise attenuation
    "scl": 2.0,                 // Noise spatial scale
    "pow": 1.1,
    "mag": 1.0,
    "colorScale": 1.1,          // Global brightness tweak
    "colors": [                 // Deep red-orange → warm golden-orange (all ff-level)
      "ff4a20", "ff6030", "ff7840", "ff7840", "ff9050", "ffb868"
    ]
  }
}
```

### 2.3 Modified File: `content/planets/peony-pavilion.json`

```diff
- "parent": "sun",
+ "parent": "aldebaran",
- "orbitRadius": 320,
+ "orbitRadius": 24,
- "orbitTime": 24000,
+ "orbitTime": 12000,
```

### 2.4 Modified Files: Bundle Localization (`bundles/bundle.properties` + `bundles/bundle_zh_CN.properties`)

#### Wrong Approach (Initial)

The initial version hardcoded the display name directly in JSON: `"name": "毕宿四"`. This bypasses Mindustry's localization system entirely — no English fallback, no multi-language support, and `planet.localizedName` would return the same Chinese string regardless of the player's language setting.

#### Correct Approach

Mindustry resolves display names through `.properties` bundle files. The JSON `name` field should remain the **internal content identifier** (`"aldebaran"`), while human-readable names are provided via properties files using the key format:

```
planet.<modname>-<contentname>.<property>
```

Where:
- `modname` = mod's `name` field from `mod.json`, lowercased → `thepeonypavilion`
- `contentname` = planet's `"name"` field from JSON → `aldebaran`
- `property` = `.name` (display name) or `.description` (hover tooltip)

This naming convention was confirmed against VE mod's bundles (`planet.ve-cyclant.name` etc.).

#### Added Entries

**`bundles/bundle.properties`** (English):
```properties
planet.thepeonypavilion-aldebaran.name = Aldebaran
planet.thepeonypavilion-aldebaran.description = An orange giant star, the brightest in the constellation Taurus. Host star of the Peony Pavilion system.
```

**`bundles/bundle_zh_CN.properties`** (Chinese):
```properties
planet.thepeonypavilion-aldebaran.name = 毕宿四
planet.thepeonypavilion-aldebaran.description = 一颗橙巨星，金牛座中最明亮的恒星。牡丹亭星系的宿主恒星。
```

#### How Mindustry Resolves It

At runtime, `ContentParser` assigns `Planet.localizedName` by looking up the bundle key. For mod content, the lookup key is automatically prefixed with the mod's internal name. The planet selection UI (`PlanetDialog` line 310) displays `star.localizedName` for solar system tab headers, and `planet.localizedName` (line 317) for planet buttons — both sourced from these properties files.

---

## 3. Issue Details

### Issue 1: Star Completely Invisible — Clipped by the Far Plane

#### Symptom

After launching the game, **two solar system tabs** appeared (vanilla sun system + Aldebaran system), confirming that `solarSystem` self-reference and `PlanetDialog`'s grouping logic worked correctly. However, when clicking into the Aldebaran system, only peony-pavilion floated alone in the darkness — **the star was completely absent**.

#### Source Code Trace

`PlanetRenderer.java` line 43:

```java
cam.far = 150f;  // ← far clipping plane! Objects > 150 units from camera are discarded
```

`PlanetRenderer.java` lines 106–108 (render entry point):

```java
Planet solarSystem = params.planet.solarSystem;
renderPlanet(solarSystem, params);   // render the solar system root
renderTransparent(solarSystem, params);
```

`PlanetRenderer.java` lines 132–144 (`renderPlanet`):

```java
public void renderPlanet(Planet planet, PlanetParams params){
    if(!planet.visible()) return;
    cam.update();
    if(cam.frustum.containsSphere(planet.position, planet.clipRadius)){  // ← frustum check!
        planet.draw(params, cam.combined, planet.getTransform(mat));
    }
    for(Planet child : planet.children){
        renderPlanet(child, params);
    }
}
```

`cam.frustum.containsSphere()` checks whether the sphere is within the camera view frustum — **all six clipping planes (near/far/left/right/top/bottom) must pass**. If the sphere's distance from the camera exceeds `cam.far=150`, it is discarded outright.

`PlanetRenderer.java` line 70 (camera position):

```java
cam.position.set(params.planet.position).add(params.camPos);
```

The camera is positioned near the **currently selected planet** (`params.planet`, i.e., peony-pavilion). It then calls `cam.lookAt(params.planet.position)` to face peony-pavilion.

#### Calculation Verification

At the time, peony-pavilion had `orbitRadius = 320`:

```
aldebaran.position = (0, 0, 0)              (no parent, fixed at origin)
peony-pavilion.position ≈ (320, 0, 0)        (orbiting Aldebaran)
camera position ≈ peony-pavilion.position + offset ≈ (320 + δ, 0, ε)
camera → aldebaran distance ≈ 320
cam.far = 150                                ← 320 > 150, beyond far plane!
```

**Conclusion**: `cam.frustum.containsSphere(aldebaran.position, aldebaran.clipRadius)` returned `false`. The star was never drawn. This is what caused "the second solar system has no star."

For comparison, in the vanilla system, serpulo's `orbitRadius ≈ 35` (auto-calculated by constructor: `sun.totalRadius + orbitSpacing + serpulo.totalRadius`). Distance 35 << 150, so the sun is always in the frustum.

#### Fix

Reduced `orbitRadius` from 320 to 24, keeping Aldebaran well within `cam.far=150`. Proportionally shortened `orbitTime` (Kepler's Third Law: `T ∝ r^1.5`).

```diff
- "orbitRadius": 320,
+ "orbitRadius": 24,
- "orbitTime": 24000,
+ "orbitTime": 12000,
```

> **Why 24?** The vanilla auto-calculation gives `6 + 12 + 0.7 = 18.7`. We chose 24 as a slightly roomier orbit that keeps the star prominently visible from the planet surface while staying far below the 150 clipping boundary.

#### Corresponding Commit

`0cae246`: fix: fixed Aldebaran invisibility — orbitRadius too large, clipped by frustum far plane

---

### Issue 2: Star Had No Glow — Colors Too Dark to Trigger Bloom

#### Symptom

After fixing Issue 1, Aldebaran finally appeared — but it looked like a **dull orange sphere**, completely lacking the glowing halo effect expected of a star. User feedback: "the new one isn't being rendered as a star."

#### Source Code Trace

`PlanetRenderer.java` lines 31–32:

```java
public final Bloom bloom = new Bloom(...){{
    setThreshold(0.8f);
}};
```

Bloom post-processing threshold is **0.8** (max RGB component ≥ 204/255 to trigger).

Lines 84–86 (bloom capture phase):

```java
bloom.capture();          // begin capture to off-screen buffer
// ... render all celestial bodies (stars + planets) ...
bloom.render();           // blur + composite the buffer
```

Rendering flow: normally draw all bodies to the frame buffer while bloom captures pixels with brightness ≥ 0.8 to a separate off-screen buffer. After capture, apply Gaussian blur (`blurPasses=6`) to the off-screen buffer, then composite it back onto the main view. **Only sufficiently bright pixels participate in this process.**

#### First-Version Colors vs. Vanilla Sun

| Color Index | First-Version Aldebaran | RGB(max) | Vanilla Sun | RGB(max) |
|------------|------------------------|----------|-------------|----------|
| colors[0] | `c53a14` | 0.773 ❌ | `ff7a38` | 1.000 ✓ |
| colors[1] | `d85020` | 0.847 ⚠️ | `ff9638` | 1.000 ✓ |
| colors[2] | `e86830` | 0.910 ✓ | `ffc64c` | 1.000 ✓ |
| colors[3] | `e86830` | 0.910 ✓ | `ffc64c` | 1.000 ✓ |
| colors[4] | `f09040` | 0.941 ✓ | `ffe371` | 1.000 ✓ |
| colors[5] | `f5b058` | 0.961 ✓ | `f4ee8e` | 0.957 ✓ |

- **`c53a14` (max 0.773)**: the darkest color in the first version, below the bloom threshold of 0.8. Large dark areas of the star surface emitted no glow at all.
- **`d85020` (max 0.847)**: barely above threshold, borderline.
- The vanilla sun's 6 colors are **all ≥ 0.957**, meaning the entire surface glows. This is why the vanilla sun looks radiant while Aldebaran looked dim.

#### Fix

Raised all colors to `ff` level (RGB max ≥ 0.88) while preserving the hue family (red-orange), ensuring the entire stellar surface triggers bloom:

```diff
- "c53a14", "d85020", "e86830", "e86830", "f09040", "f5b058"
+ "ff4a20", "ff6030", "ff7840", "ff7840", "ff9050", "ffb868"
```

Additional tweaks:
- `radius`: 6 → **8** (giant star more visually prominent)
- `colorScale`: 1.0 → **1.1** (slight global brightness boost)
- `hasAtmosphere`: default true → **false** (stars don't need atmospheric scattering; though `parent=null` already suppresses it, explicit is clearer)
- `iconColor`: `e86830` → **`ff7840`** (match new color scheme)
- `lightColor`: `f0904060` → **`ff905080`** (warmer orange light for child planet illumination)

#### Corresponding Commit

`0cae246` (same commit as Issue 1)

---

### Issue 3: Solar System Independence — `solarSystem` Self-Reference & PlanetDialog Filtering

#### Background

In `Planet.java` constructor (line 220):

```java
for(solarSystem = this; solarSystem.parent != null; solarSystem = solarSystem.parent);
```

`solarSystem` auto-traces up the parent chain to the root. So with just `parent: null`, `solarSystem` would be itself. However, **explicitly declaring** `"solarSystem": "aldebaran"` in JSON serves as a semantic marker that pairs with `PlanetDialog`'s filtering logic to generate an independent solar system tab.

#### Source Code Trace

`PlanetDialog.java` lines 745–764 (solar system selection panel construction):

```java
int starCount = 0;
for(Planet star : content.planets()){
    // Filter 1: must be its own solar system root (solarSystem self-reference)
    // Filter 2: must have at least one selectable child planet
    if(star.solarSystem != star
        || !content.planets().contains(p -> p.solarSystem == star && selectable(p)))
        continue;

    starCount++;
    if(starCount > 1)
        starsTable.add(star.localizedName)  // 2nd+ systems get a header label
            .padLeft(10f).padBottom(10f).padTop(10f).left().width(190f).row();

    // List all selectable planets under this solar system
    for(Planet planet : content.planets()){
        if(planet.solarSystem == star && selectable(planet)){
            // Create button for each planet
            planetTable.button(planet.localizedName, ...);
        }
    }
}
```

**Logic breakdown**:

1. Iterate all planets, only process those with `star.solarSystem == star` (i.e., solar system roots)
2. For each system, list all planets with `solarSystem == star` that are `selectable()`
3. Starting from the second system (`starCount > 1`), show `star.localizedName` as a separator header
4. Clicking a planet button calls `viewPlanet(planet, false)` (line 757), switching the camera to that planet

**Aldebaran system satisfies conditions**: `star = aldebaran`, `aldebaran.solarSystem == aldebaran` ✓; `peony-pavilion.solarSystem == aldebaran` (traced through parent chain) and `accessible = true` (selectable) ✓.

#### Verification

VE mod's `sol2.json` uses the same pattern:

```json
{
  "solarSystem": "sol2",
  "parent": "sun",
  "children": ["cyclant", "maress", ...]
}
```

Note that VE's sol2 has `parent: "sun"` — sol2 orbits the vanilla sun (visible in the vanilla solar system), but `solarSystem: "sol2"` also makes it appear as an independent system tab. This is an example of one star belonging to two solar systems simultaneously: visible as a distant bright star in the vanilla system, and as the center when clicking the sol2 tab.

Our Aldebaran chose `parent: null` — a fully independent solar system, orbiting nothing.

---

## 4. Complete Fix Comparison

### aldebaran.json Changelog

| Field | V1 (broken) | Final (fixed) | Reason |
|-------|-------------|---------------|--------|
| `name` | `"毕宿四"` | **`"aldebaran"`** | Internal identifier; display name moved to bundles |
| `radius` | 6 | **8** | Giant star more visually prominent |
| `hasAtmosphere` | (default true) | **false** | Stars don't need atmosphere, semantically clear |
| `iconColor` | `e86830` | **`ff7840`** | Match new color scheme, UI icon color |
| `lightColor` | `f0904060` | **`ff905080`** | Brighter warm orange light for child planet |
| `colorScale` | 1.0 | **1.1** | Slight global brightness boost |
| `colors[0]` | `c53a14` (0.773) | **`ff4a20`** (1.000) | |
| `colors[1]` | `d85020` (0.847) | **`ff6030`** (1.000) | |
| `colors[2]` | `e86830` (0.910) | **`ff7840`** (1.000) | All raised to ff-level, |
| `colors[3]` | `e86830` (0.910) | **`ff7840`** (1.000) | ensuring entire surface |
| `colors[4]` | `f09040` (0.941) | **`ff9050`** (1.000) | triggers bloom (threshold 0.8) |
| `colors[5]` | `f5b058` (0.961) | **`ffb868`** (1.000) | |

### peony-pavilion.json Changelog

| Field | V1 | Final | Reason |
|-------|-----|-------|--------|
| `parent` | `"sun"` | **`"aldebaran"`** | Re-parented to orbit Aldebaran |
| `orbitRadius` | 320 | **24** | Original value far exceeded `cam.far=150`, star was clipped |
| `orbitTime` | 24000 | **12000** | Proportional shortening per Kepler's law |

---

## 5. Key Lessons

1. **`cam.far = 150f` is a hard boundary for all celestial body visibility.** Any child planet's `orbitRadius` must be significantly less than 150, otherwise the star gets discarded by the far clipping plane when viewed from the planet. Vanilla serpulo's `orbitRadius ≈ 35` is a good reference value.

2. **Bloom threshold 0.8 requires star colors to be sufficiently bright.** `ff`-level hex colors (RGB ≥ 204) reliably trigger the glow effect. Note that all vanilla sun colors are at `ff` level.

3. **`solarSystem` self-reference is the key to creating independent solar system tabs.** `parent: null` alone is insufficient — `PlanetDialog`'s filter logic (line 747) uses `star.solarSystem != star` as the gating condition. Explicit JSON declaration ensures consistent behavior.

4. **Explicit JSON `orbitRadius` overrides the constructor's auto-calculation.** The Planet constructor sets `orbitRadius = parent.totalRadius + parent.orbitSpacing + totalRadius`, but `readFields` directly overwrites it with the JSON value. When designing orbital distances, the camera clipping boundary must be considered.

5. **SunMesh renders with `Shaders.unlit`, bypassing all lighting calculations.** A star's appearance is entirely determined by the colors array and noise parameters — no ambient/diffuse/specular lighting. This is correct: a star is a light source itself and should not be illuminated by other sources.

---

## 6. Commit History

| Commit | Branch | Description |
|--------|--------|-------------|
| `4359192` | `feat/aldebaran-star` | Initial creation of aldebaran.json, modify parent |
| `0cae246` | `fix/aldebaran-visibility` | Fix star invisibility (orbitRadius) + bloom color brightness |
| `a3176e2` | `master` | Add bundle localization: English "Aldebaran", Chinese "毕宿四" |
