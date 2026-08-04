# debug-002: Planet Color Adjustment — Blue-Green Earth Appearance

> **Date**: 2026-07-27  
> **Associated File**: `content/planets/viar.json`  
> **Source Files Involved**:
> - `mindustry/graphics/g3d/PlanetRenderer.java`
> - `mindustry/graphics/g3d/NoiseMesh.java`
> - `mindustry/graphics/g3d/HexMesh.java`
> - `mindustry/graphics/g3d/HexMesher.java`
> - `mindustry/graphics/g3d/MeshBuilder.java`
> - `mindustry/graphics/g3d/MultiMesh.java`
> - `mindustry/graphics/g3d/PlanetMesh.java`
> - `mindustry/mod/ContentParser.java`
> - `core/assets/shaders/planet.vert`
> - `core/assets/shaders/planet.frag`

---

## 0. Why Isn't the Planet Monochrome — The Essence of Multi-Layer Mesh Compositing

> This chapter answers the four most fundamental questions — precisely the parts the previous version "seemed to cover but didn't really explain":
> 1. How does a planet appear to have different colors instead of being monochrome?
> 2. Why does rendering different meshes achieve this effect?
> 3. What's the relationship between this and our JSON?
> 4. Why does writing our JSON this way make it work?
>
> Read this chapter first, then the pipeline details that follow — you'll know where every piece of code fits in the overall scheme.

### 0.1 The Problem: How Do You Make a 3D Sphere Look Like a Planet?

You're given a bare 3D sphere. You want it to look like Earth — with blue oceans, green continents, yellow deserts, and white snowy mountains. How?

**Approach A: Texture Mapping.** Have an artist paint a 2D image of Earth and wrap it around the sphere like orange peel. This is what most 3D games do. The problem: Mindustry is a **mod-driven game** — modders define planet appearance through JSON config files, with no art assets. Texture mapping also requires UV unwrapping (flattening a 3D sphere into a 2D plane), which is extremely unfriendly to procedural generation.

**Approach B: Multi-Layer Mesh Compositing.** Split "Earth" into 5 independent spheres — a pure blue ocean sphere, a green-patched continent sphere, a yellow-patched desert sphere, a gray-patched mountain sphere, and a white-patched snowcap sphere. Stack them together and render them simultaneously, using the GPU's depth test to automatically decide which layer's color each pixel displays. This is Mindustry's choice.

The core advantages of Approach B:
- **Pure JSON configurable**: No image assets needed — the modder just writes JSON fields
- **Procedurally generated**: The shape of each "patch" is computed at runtime by Simplex noise — infinite variation, zero storage cost
- **Independently controllable per layer**: Ocean coverage, desert sparseness, mountain height… each layer tuned individually

### 0.2 Mindustry's Choice: Multi-Layer Mesh Overlay Rendering

In Mindustry, a planet's visual appearance is composed of **N independent 3D Meshes** overlaid on each other. Each Mesh is itself a **complete sphere** (deformed by noise), with its own vertices and vertex colors. The GPU renders these spheres in order, and the Depth Test automatically decides which layer's color each screen pixel ultimately displays.

Think of each layer as a "shell" with holes:

```
          Camera
            ↓
    ╔═══════════════╗  ← Layer 5: Mountain White (mostly recessed, only pokes through at noise peaks)
    ║ ╔═══════════╗ ║  ← Layer 4: Mountain Gray
    ║ ║ ╔═══════╗ ║ ║  ← Layer 3: Desert
    ║ ║ ║ ╔═══╗ ║ ║ ║  ← Layer 2: Forest
    ║ ║ ║ ║   ║ ║ ║ ║  ← Layer 1: Ocean (complete sphere, innermost)
    ║ ║ ║ ╚═══╝ ║ ║ ║
    ║ ║ ╚═══════╝ ║ ║
    ║ ╚═══════════╝ ║
    ╚═══════════════╝
```

Each vertical line represents a pixel column on screen. The camera looks down from above:
- Leftmost column passes through all 5 layers → GPU displays Layer 5 (Mountain White), closest to camera
- Middle column passes through Layers 1-4 but Layer 5 is recessed there → displays Layer 4 (Mountain Gray)
- Right column passes through Layers 1-2 but Layers 3-5 are all recessed → displays Layer 2 (Forest)
- Rightmost column only passes through Layer 1 → displays Layer 1 (Ocean)

**The GPU-side mechanism**: Depth Test. When rendering Layer 1 (Ocean), the GPU writes all ocean vertex depth values into the depth buffer. When rendering Layer 2 (Forest), the GPU compares pixel by pixel: is this forest pixel closer (nearer to the camera) than the existing ocean pixel in the depth buffer? Yes → draw and update depth buffer. No → discard. This mechanism executes at the hardware level — no additional code logic needed.

### 0.3 Where Does Each Layer's Color Come From?

Each layer is a NoiseMesh. When constructed, NoiseMesh iterates over every vertex on the sphere and calls the `getColor()` callback for each vertex:

- **Single-color mode** (only `"color"` field in JSON): All vertices share the same color. The Ocean layer uses this — pure blue across the entire layer.
- **Two-color mode** (`"color1"` and `"color2"` in JSON): For each vertex, a **separate independent noise** computes a scalar value. If it exceeds `colorThreshold` → use `color2` (bright). Otherwise → use `color1` (dark).

Because noise values are **spatially smooth and continuous** (neighboring vertices have similar noise values), the resulting color patches aren't random salt-and-pepper noise, but **organically-shaped regions** — like the winding continents and scattered islands on Earth.

This is why `colorScale` (controls patch size) and `colorThreshold` (controls bright/dark ratio) are so important: they directly determine the "continent shape" of each layer.

### 0.4 How Does This Relate to Our JSON?

Look at the `"mesh"` field in our `viar.json`:

```jsonc
"mesh": {
    "type": "MultiMesh",          // ← The container: tells the game "I want multiple layers"
    "meshes": [                   // ← This array defines each overlaid layer
        { "type": "NoiseMesh", "seed": 42,  "color": "1050a0",     "radius": 0.7, "mag": 0.30 },
        { "type": "NoiseMesh", "seed": 77,  "color1": "1d7a28", …, "radius": 0.7, "mag": 0.30 },
        { "type": "NoiseMesh", "seed": 131, "color1": "b8a050", …, "radius": 0.7, "mag": 0.18 },
        { "type": "NoiseMesh", "seed": 199, "color1": "7a7a7a", …, "radius": 0.7, "mag": 0.22 },
        { "type": "NoiseMesh", "seed": 241, "color1": "c0c8c080",…, "radius": 0.7, "mag": 0.20 }
    ]
}
```

This JSON structure maps directly to Mindustry's object model:

| JSON Path | Java Object | Responsibility |
|-----------|-------------|----------------|
| `mesh.type = "MultiMesh"` | `new MultiMesh(…)` | Container, holds child mesh list, iterates through layers during rendering |
| `mesh.meshes[i]` | `new NoiseMesh(…)` | The i-th terrain layer — an independent 3D sphere mesh |
| `seed` | Noise seed | Determines the spatial distribution of that layer's terrain and color |
| `radius` | Sphere radius | Must be identical across all layers (or inner layers are completely occluded — see Pitfall 2) |
| `mag` | Terrain deformation amplitude | Determines how far outward vertices can bulge — **mag decreases for later-rendered layers** |
| `color1`/`color2` | Dark/bright color | Color variation within a single layer |
| `colorScale` | Color patch spatial scale | Larger → bigger patches (continental vs. salt-and-pepper) |
| `colorThreshold` | Bright/dark cutoff threshold | Controls the proportion of bright color (color2) |

### 0.5 So, Why Does Writing JSON This Way Make It Work?

Stringing all the above mechanisms together gives us the design logic behind our JSON:

1. **The outer wrapper is `MultiMesh`** — because a planet needs multiple visual layers overlaid. `MultiMesh.render()` is just a for-loop rendering layers in sequence (see 2.3.3); no magic involved.

2. **Each inner element is a `NoiseMesh`** — because each terrain layer needs independent terrain起伏 and color texture. `NoiseMesh` uses Simplex noise to simultaneously drive geometric deformation (`getHeight()`) and color selection (`getColor()`), producing organic, irregular appearance.

3. **All layers share the same `radius` (0.7)** — this is the core lesson from Pitfall 2, learned through painful trial-and-error. `radius` is a uniform scaling factor; decreasing it layer by layer causes all inner vertices to be smaller than the outer layer, and the depth test discards the inner layer entirely. Same radius means each layer's base sphere is identically sized — only the local bumps and dips driven by noise decide which layer is on top at each location.

4. **`mag` values generally decrease** — `mag` controls how far noise can push outward. Ocean `mag=0.30`, Forest `mag=0.30` (peer competition at 50/50), Desert `mag=0.18` (only pierces through at extreme noise values), Mountains `mag=0.22/0.20`. Later-rendered layers have smaller mag → in most regions they sit inside the geometry of earlier layers (occluded) → only "stab through" at noise peaks. This creates sparsely visible high-terrain features, just as deserts and snowy mountains cover only a small fraction of Earth's surface.

5. **`seed` values are all different** — if two layers share the same seed, their noise distributions are perfectly aligned, bumps and dips occur at the same geographic locations, and the later-rendered layer uniformly covers the earlier one, destroying the "patch piercing through" effect. Different seeds mean each layer's terrain features appear at different geographic positions.

6. **`colorScale` increases (3→5→7→9)** — ocean to snowcap, patches go from fragmented to unified. Lower layers (forest) use smaller patches to simulate broken coastlines and scattered vegetation; higher layers (snowcaps) use larger patches to simulate vast plateau glaciers.

7. **`color1`/`color2` are always light/dark variants within the same hue family** — forest `"1d7a28"` (dark green) → `"3db840"` (bright green), desert `"b8a050"` (earthy yellow) → `"d0c068"` (bright sand). Within a layer, colors only vary in brightness/saturation, not hue, so visually the perception of "this layer is one terrain type" stays unified.

8. **Render order equals JSON array order** — index 0 (Ocean) renders first → writes to depth buffer. Index 1 (Forest) renders second → covers ocean where noise is high. Index 4 (Mountain White) renders last → only visible where all previous layers are recessed (joint maximum of three independent noise layers — extremely low probability, making snowcaps the rarest).

**One-sentence summary**: Through JSON we define a "5-layer spherical shell" configuration — each layer with independent terrain起伏 (`seed` + `mag`) and color texture (`color1`/`color2` + `colorScale` + `colorThreshold`). At startup, Mindustry parses the JSON into 5 NoiseMesh objects, wrapped in a MultiMesh container. At runtime every frame, MultiMesh submits each layer to the GPU in sequence, and the depth test automatically decides "which layer's color goes to which pixel" — producing an Earth-like multi-layer terrain visual effect.

---

## 1. Background and Goal

The Starfield mod's `viar.json` originally used a **purple-gray + blue-green** "AI-themed" color scheme. This task changes it to a **blue-green Earth-like appearance** — a blue ocean base, overlaid with green forests, yellow deserts, gray mountain shadow sides, and white mountain bright sides (ice caps / snowy peaks), achieving five-layer terrain visual layering.

---

## 2. Planet Rendering Pipeline Explained in Detail

> This chapter traces from the JSON you wrote all the way to how the GPU draws every pixel on screen. Chapter 0 gave the big picture; this chapter is the microscopic magnification of every frame of that picture.

### 2.0 Before Reading the Source: Must-Understand Foundational Concepts

The following concepts span the entire rendering pipeline. If you are already familiar with them, skip directly to 2.1.

**Mesh**: a data collection consisting of a set of 3D vertices and the connectivity relationships between them (triangle indices). The GPU renders 3D objects by drawing these triangles. In Mindustry, each NoiseMesh layer is an independent Mesh — it has its own set of vertices (positions + colors) that are not shared with other layers.

**Vertex**: a point in 3D space. Each vertex carries a set of attributes: position (x, y, z coordinates), color (RGBA), normal direction (used for lighting), etc. The color fields in your JSON ultimately become the color attribute of each vertex.

**Triangle**: the fundamental primitive (i.e., smallest drawing unit) of 3D rendering. Three vertices enclose a triangular face; thousands of triangles assemble into a sphere. Mindustry's planet is an approximate sphere formed by subdividing a hexagonal grid into triangles.

**Shader**: a small program that runs on the GPU, written in a C-like language called GLSL. There are two kinds: (1) **Vertex Shader** — runs on each vertex, transforming 3D positions into screen coordinates; (2) **Fragment Shader** — runs on each pixel, computing the final color (including lighting).

**Uniform**: a global constant in a shader shared by all vertices/pixels within a single draw call. For example, the information "which direction the sun is in" is passed in as a uniform and shared by all pixels.

**Depth Buffer**: a 2D array in GPU video memory, with dimensions equal to the screen resolution. Each element of the array stores **the depth value of the currently nearest object at that pixel position** (depth = distance from the object to the camera). It stores no color, only distance.

**Depth Test**: a hardware judgment the GPU performs before drawing each pixel. The rule is: compare the new pixel's depth value against the existing depth value at the same position in the depth buffer. If the new pixel is closer (smaller depth) → draw it; if the new pixel is farther (larger depth) → discard it. This is the **core mechanism** behind multi-layer planet mesh overlay rendering.

**Depth Mask**: controls whether successfully drawn pixels write their depth values back into the depth buffer. When enabled (`Gl.depthMask(true)`), objects rendered first will "block" objects rendered later that are farther away.

**Cull Face**: a performance optimization — if the front face of a triangle (determined by its normal direction) faces away from the camera, the GPU skips drawing it entirely. Mindustry's planet rendering enables culling of back faces (`Gl.back`).

**Simplex Noise**: a mathematical function that takes 3D spatial coordinates `(x, y, z)` as input and outputs a scalar value in the range `[-1, 1]`. Its key properties: (1) outputs for neighboring coordinates are similar, so the noise is **smooth and continuous**; (2) outputs for distant coordinates are uncorrelated, so the noise has **random variation**. Mindustry uses Simplex noise to simultaneously generate terrain起伏 and color texture across the 3D sphere surface.

**Octaves**: a parameter in fractal noise techniques. Multiple layers of noise at different frequencies and amplitudes are superimposed — octaves=1 is a single smooth noise layer; octaves=5 is five layers superimposed, producing more complex terrain detail.

**Persistence**: the amplitude decay factor between adjacent frequency layers in fractal noise. For example, persistence=0.5 means the high-frequency layer has half the amplitude of the low-frequency layer.

**Callback**: passing a reference to a method (function) as an argument to another method, which calls it when needed. Mindustry extensively uses this pattern in the NoiseMesh constructor — passing anonymous functions to `MeshBuilder`, which calls them one by one while iterating over all sphere vertices.

**MVP Matrix (Model-View-Projection Matrix)**: the product of three 4×4 transformation matrices — (1) Model matrix: transforms vertices from object space to world space; (2) View matrix: from world space to camera space; (3) Projection matrix: from camera space to screen pixel coordinates. In Mindustry planet rendering, all child layers of a MultiMesh share the same MVP matrix (because they belong to the same planet).

**HexMesher Interface**: the **contract** between `MeshBuilder` and the planet noise layers. It defines four callback methods — `getHeight()` (vertex geometry height), `getColor()` (vertex color), `getEmissiveColor()` (emissive color), `skip()` (skip this vertex). NoiseMesh implements this interface through anonymous inner classes, injecting Simplex noise into `MeshBuilder`'s grid construction pipeline.

---

### 2.1 Phase 1: How JSON Becomes NoiseMesh Objects

This phase answers: what code path do strings like `"radius": 0.7` and `"color1": "1d7a28"` in `viar.json` take to ultimately become a drawable NoiseMesh instance in Java memory?

#### 2.1.1 The Single Entry Point: `ContentParser.parseMesh()`

At `ContentParser.java` lines 1124–1159. The `mesh` and `cloudMesh` fields in the JSON file are extracted independently by the game's content loading system and handed to this method for parsing:

```java
private GenericMesh parseMesh(Planet planet, JsonValue data){
    // If data is an array → create MultiMesh (a container holding multiple child meshes)
    if(data.isArray()){
        return new MultiMesh(parseMeshes(planet, data));
    }

    // Read the type field to decide which mesh to construct; default is "NoiseMesh"
    String tname = Strings.capitalize(data.getString("type", "NoiseMesh"));

    return switch(tname){
        case "NoiseMesh" -> new NoiseMesh(planet,
            data.getInt("seed", 0),           // noise seed, default 0
            data.getInt("divisions", 1),       // sphere subdivision level, default 1
            data.getFloat("radius", 1f),       // base sphere radius, default 1.0
            data.getInt("octaves", 1),         // geometry noise octaves, default 1
            data.getFloat("persistence", 0.5f),// geometry noise persistence, default 0.5
            data.getFloat("scale", 1f),        // geometry noise spatial scale, default 1.0
            data.getFloat("mag", 0.5f),        // height deformation amplitude, default 0.5
            // —— color fields: prefer color1, fall back to color, default white ——
            Color.valueOf(data.getString("color1",
                data.getString("color", "ffffff"))),
            Color.valueOf(data.getString("color2",
                data.getString("color", "ffffff"))),
            // —— the following four parameters control "color noise" behavior ——
            data.getInt("colorOct", 1),         // color noise octaves, default 1
            data.getFloat("colorPersistence", 0.5f),// color noise persistence, default 0.5
            data.getFloat("colorScale", 1f),      // color patch spatial scale, default 1.0
            data.getFloat("colorThreshold", 0.5f) // color binary selection threshold, default 0.5
        );
        // ... other mesh types (HexSkyMesh, SunMesh, MultiMesh, MatMesh)
    };
}
```

**This code tells us 6 things:**

**① The `type` field decides which Mesh to construct.** Omitting `"type"` defaults to `NoiseMesh`. Clouds use `HexSkyMesh` (a hexagonal mesh whose getColor function checks if the noise value exceeds a threshold), the sun uses `SunMesh`.

**② `color1`/`color2` vs `color` is a nested fallback mechanism.** The code `data.getString("color1", data.getString("color", "ffffff"))` means:
- JSON writes `"color": "1050a0"` → color1 doesn't exist, falls back to color → both color positions get `1050a0` → calls the single-color variant constructor (section 2.2.1 below)
- JSON writes `"color1": "1d7a28", "color2": "3db840"` → the two colors differ → calls the two-color variant constructor
- Neither is written → defaults to white

**③ The four color noise parameters (`colorOct`, `colorPersistence`, `colorScale`, `colorThreshold`) all take default values if omitted.** Default `colorScale=1.0` produces tiny fragments instead of continental shapes; default `colorThreshold=0.5` gives ~50% of each color. These two defaults are the direct cause of Pitfall 1 (low blue-green distinction).

**④ Every JSON field has a default value.** The second argument `1f` in `data.getFloat("radius", 1f)` is the default. This means even a JSON of just `{}` would produce a usable NoiseMesh (radius 1.0, white, mag=0.5).

**⑤ `parseMesh()` is recursive.** When the JSON has `"type": "MultiMesh"`, the code creates a `MultiMesh`, then recursively calls `parseMeshes()` to parse each item in the `"meshes"` array. Your JSON is exactly this: an outer MultiMesh, with 5 inner NoiseMeshes each recursively constructed.

**⑥ Two `parseMesh` signatures auto-switch via overloading.** When `data.isArray()` is true, the array branch fires (directly returns MultiMesh); otherwise, the single-object branch fires (dispatches by `type` field). This means `"mesh"` could also be a single NoiseMesh (for simple planets), but you chose the array form — because we need 5 terrain layers.

---

### 2.2 Phase 2: How Mesh Vertices Are Generated

This phase answers: what happens inside the NoiseMesh constructor? How are the `getHeight()` and `getColor()` callbacks defined? How are the final vertex positions computed?

#### 2.2.1 NoiseMesh's Two Constructors

`NoiseMesh.java` has two constructors — the single-color variant and the two-color variant. Both use **anonymous inner classes (a Java pattern for defining callbacks inline)** to define the two methods of the `HexMesher` interface.

**Single-color variant** (lines 11–14):

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
            out.set(color);          // All vertices same color, no noise
        }
    }, divisions, radius, 0.2f);   // ← the last 0.2 is intensity (hardcoded)
}
```

**Two-color variant** (lines 28–39):

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
            //      hard threshold    true     false
        }
    }, divisions, radius, 0.2f);
}
```

**There are three key design decisions here, each of which affected our later debugging:**

**Decision 1: Geometry noise and color noise use different seeds.** `getHeight` uses `7 + seed`; `getColor` uses `8 + seed`. Different seeds → different noise values → the geometry shape and color texture of the same layer are **independent and uncorrelated**. A vertex may be very high but display a dark color, or very low but display a bright color. This means **you cannot infer height from color** — we initially overlooked this in Pitfall 3.

**Decision 2: Color selection is a hard threshold, not a gradient.** `> cthresh ? color2 : color1` is Java's ternary operator (i.e., an if-else expression). For each vertex, the color noise value either exceeds the threshold (pick color2) or does not (pick color1); there is no intermediate state. So what you see are **patches**, not **gradients**.

**Decision 3: The intensity coefficient `0.2` is hardcoded.** Both constructors call `MeshBuilder.buildHex(..., 0.2f)`. This value cannot be changed through JSON. It scales down the effect of mag (height deformation amplitude) to 1/5, keeping the spherical surface deformation within a reasonable range.

#### 2.2.2 Output Range of the Geometry Noise `getHeight()`

The return value of `Simplex.noise3d()` ranges approximately **[-1, 1]**. After multiplying by `mag`:

```
getHeight range ≈ [-mag, +mag]

When mag=0.45: getHeight range ≈ [-0.45, 0.45]
When mag=0.30: getHeight range ≈ [-0.30, 0.30]
```

Positive `getHeight` values mean the vertex bulges outward from the sphere surface; negative values mean the vertex sinks inward.

#### 2.2.3 Vertex Position Computation: `MeshBuilder.buildHex()`

This is **the single most important source fragment in the entire document** — it directly explains why Pitfall 2 (only green visible) occurred. Located at `MeshBuilder.java` lines 84–108:

```java
public static synchronized Mesh buildHex(
    HexMesher mesher, int divisions, float radius, float intensity){

    PlanetGrid grid = PlanetGrid.create(divisions);
    // PlanetGrid generates a hexagonal grid on the sphere surface,
    // each hexagon further subdivided into triangles.
    // grid.corners contains the 3D direction vectors (unit length) of all vertices.

    float[] heights = new float[grid.corners.length];

    // Iterate over every vertex of the sphere
    for(int i = 0; i < grid.corners.length; i++){
        // Call getHeight for each vertex (the callback we defined in 2.2.1)
        // Compute the distance from this vertex to the sphere center
        heights[i] = (1f + mesher.getHeight(grid.corners[i].v) * intensity) * radius;
    }
    //         ^^^^   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^   ^^^^^^
    //      base unit   noise offset × intensity coefficient      sphere radius scale

    // ... later uses heights array and grid topology to build GPU vertex buffer ...
}
```

**The expanded formula (substituting intensity=0.2):**

```
Vertex distance to sphere center = (1 + noise3d × mag × 0.2) × radius
```

**This formula has a critically easy-to-misread property**: `1` is an additive term (noise adds/subtracts on top of it), but `radius` is a multiplicative term (uniformly scales the whole thing). This means **two spheres with different radii cannot "pierce through" each other via noise bumps** — the noise-peak vertex of the smaller-radius sphere is still smaller than the noise-trough vertex of the larger-radius sphere (when mag differences aren't drastic).

**The parts of this formula:**

| Symbol | Source | Meaning | Why it exists |
|--------|--------|---------|---------------|
| `1` | Hardcoded | Base unit radius | Ensures the sphere is at least a perfect sphere (noise only adds/subtracts on top) |
| `noise3d` | Simplex noise | Random offset for this vertex, [-1, 1] | Produces irregular bumpy terrain |
| `mag` | JSON `"mag"` | Height deformation amplitude | Larger → more pronounced noise effect |
| `0.2` | NoiseMesh hardcoded | Intensity decay coefficient | Keeps mag values in 0–1 producing appropriate deformation |
| `radius` | JSON `"radius"` | **Uniform sphere scaling factor** | Controls the size of the entire layer sphere |

**The most critical fact**: `radius` is **multiplied on the outside of the entire expression**. It is not "sphere radius + noise offset", but rather "(base sphere + noise offset) uniformly scaled". This means all vertices produced by `radius=0.66` — including the one that bulges furthest outward — are smaller than a sphere with `radius=0.68`, even if the former has a very high noise value at some vertex.

**Numerical example (the mathematical root of Pitfall 2):**

```
Assume mag=0.45, noise extremes noise3d=±1:

Forest layer radius=0.68, mag=0.55:
  Outermost vertex = 0.68 × (1 + 1×0.55×0.2) = 0.68 × 1.11 = 0.755
  Innermost vertex = 0.68 × (1 - 1×0.55×0.2) = 0.68 × 0.89 = 0.605

Desert layer radius=0.66, mag=0.45:
  Outermost vertex = 0.66 × (1 + 1×0.45×0.2) = 0.66 × 1.09 = 0.719
  Innermost vertex = 0.66 × (1 - 1×0.45×0.2) = 0.66 × 0.91 = 0.601
```

Desert's outermost vertex 0.719 < Forest's outermost vertex 0.755. This means **every single vertex** of the desert layer lies inside the forest sphere. GPU depth testing (see 2.3.1) finds all desert pixels farther than already-drawn forest pixels — all discarded.

#### 2.2.4 Vertex Color Computation: Where `getColor()` Is Called

Back in `MeshBuilder.buildHex()`'s subsequent code. After all heights are computed, the code iterates over each hexagonal tile (generated by PlanetGrid), extracting its corner vertices:

```java
for(Ptile tile : grid.tiles){
    Corner[] c = tile.corners;

    // ... compute triangle normals ...

    tmpCol.set(1f, 1f, 1f, 1f);
    mesher.getColor(tile.v, tmpCol);   // ← getColor callback is called HERE
    float color = tmpCol.toFloatBits();

    // Write corner vertex positions (heights[corner.id] × corner.v) and color to GPU buffer
    for(var corner : c){
        float height = heights[corner.id];
        vert(mesh, floats,
             corner.v.x * height,      // Vertex X = direction vector X × distance
             corner.v.y * height,      // Vertex Y = direction vector Y × distance
             corner.v.z * height,      // Vertex Z = direction vector Z × distance
             nor, color, emissive);
    }
}
```

Note: `getColor()` takes the tile's **center direction vector** `tile.v` as its argument, but all corner vertices of the same tile share the same color. This is a performance trade-off — reducing the number of color samples (once per hexagonal tile vs. once per vertex).

---

### 2.3 Phase 3: How PlanetRenderer Manages Render Order

This phase answers: in what order are multiple mesh layers submitted to the GPU? How does the depth test affect the visibility of each layer?

#### 2.3.1 Render Entry Point: `PlanetRenderer.render()`

At `PlanetRenderer.java` line 47. This is the master entry point for every frame's planet rendering:

```java
public void render(PlanetParams params){
    Draw.flush();                       // First flush the 2D draw buffer
    Gl.clear(Gl.depthBufferBit);        // Clear depth buffer (reset all pixel depths to infinity)
    Gl.enable(Gl.depthTest);            // ← Enable depth test: per-pixel near/far comparison
    Gl.depthMask(true);                 // ← Enable depth write: passing pixels write back to depth buffer
    Gl.enable(Gl.cullFace);             // Enable back-face culling (performance optimization)
    Gl.cullFace(Gl.back);               // Cull the back face of each triangle

    // ... camera position and projection matrix computation ...

    Planet solarSystem = params.planet.solarSystem;
    renderPlanet(solarSystem, params);      // Render opaque layers (planet mesh)
    renderTransparent(solarSystem, params); // Render transparent layers (clouds, atmosphere, orbit lines)
}
```

**What are these three OpenGL state settings doing?**

- `Gl.clear(Gl.depthBufferBit)` → initializes all pixel depth values to "infinitely far" (in practice OpenGL uses 1.0 to represent farthest).
- `Gl.enable(Gl.depthTest)` → for every pixel drawn thereafter, the GPU automatically compares its depth value against the existing depth value at that position in the depth buffer. New pixel closer → draw; farther → discard.
- `Gl.depthMask(true)` → successfully drawn pixels **simultaneously** write their depth values into the depth buffer. This means objects drawn first will "block" objects drawn later that are farther away.

**Direct impact on multi-layer planet meshes**: Because depth test and depth write are enabled at the `render()` function level, and all planet meshes are rendered within the `renderPlanet()` call chain — every layer of the MultiMesh shares the same depth buffer. Earlier-rendered layers write depth; later-rendered layers must be more outward to cover.

#### 2.3.2 `renderPlanet()` to `planet.draw()`

```java
// PlanetRenderer.java line 132
public void renderPlanet(Planet planet, PlanetParams params){
    if(!planet.visible()) return;
    cam.update();

    // Frustum culling: if the planet is outside the camera's field of view, skip entirely
    if(cam.frustum.containsSphere(planet.position, planet.clipRadius)){
        planet.draw(params, cam.combined, planet.getTransform(mat));
    }

    // Recursively render all child planets (for solar system hierarchy)
    for(Planet child : planet.children){
        renderPlanet(child, params);
    }
}
```

`planet.draw()` internally calls `mesh.render()`. For `MultiMesh` (i.e., the outer structure of your JSON), it renders layers sequentially in array order.

#### 2.3.3 `MultiMesh.render()`: Layer-by-Layer Overlay

```java
// MultiMesh.java line 13
public void render(PlanetParams params, Mat3D projection, Mat3D transform){
    for(var v : meshes){
        v.render(params, projection, transform);
    }
}
```

This is the entire code of the multi-layer overlay mechanism. The `meshes` array renders in the index order of the `meshes` array in the JSON — index 0 (Ocean) renders first, index 4 (Mountain White) renders last.

**The mathematical condition for multi-layer overlay**: Due to the depth test, layer N (array index N-1) is visible at a given pixel position if and only if:

```
Layer N's vertex depth at that pixel < the minimum depth among all previously drawn vertices
                                       from layers 1 through N-1
```

Equivalently (because all layers share the same transformation matrix and camera position):

```
Layer N's vertex distance to sphere center > the maximum distance among all corresponding
                                            vertices from layers 1 through N-1
```

This inequality explains the root cause of Pitfall 5 (mountains invisible) — the mountain layer needs to simultaneously exceed three layers: ocean, forest, and desert. The expected value of the maximum of three independent random variables is significantly biased toward positive values, making the actual piercing probability much lower than the estimate from single-layer competition.

#### 2.3.4 `PlanetMesh.render()`: Single-Layer Shader Binding

```java
// PlanetMesh.java line 28
public void render(PlanetParams params, Mat3D projection, Mat3D transform){
    if(mesh.isDisposed()) return;

    preRender(params);                           // Set lighting and other shader parameters
    shader.bind();                               // Bind the shader program to the GPU
    shader.setUniformMatrix4("u_proj", projection.val);  // Projection matrix uniform
    shader.setUniformMatrix4("u_trans", transform.val);  // Transformation matrix uniform
    shader.apply();                              // Submit all uniforms to GPU
    mesh.render(shader, Gl.triangles);           // Draw the vertex buffer in triangle mode
}
```

`shader.bind()` binds Mindustry's planet shader (`Shaders.planet`). This shader receives each vertex's color attribute, multiplies it by the lighting calculation result (diffuse + ambient) in the Fragment Shader, and outputs the final pixel color.

---

### 2.4 Phase 4: How the Shader Produces the Final Pixel Color

#### 2.4.1 `HexMesh.preRender()`: Lighting Parameter Setup

```java
// HexMesh.java line 22
public void preRender(PlanetParams params){
    Shaders.planet.planet = planet;
    Shaders.planet.emissive = planet.generator != null && planet.generator.isEmissive();

    // Compute light direction = (sun position - planet position) normalized, then apply planet rotation
    Shaders.planet.lightDir
        .set(planet.solarSystem.position)           // Sun's position in absolute space
        .sub(planet.position)                       // Subtract planet position → "sun relative to planet" direction
        .rotate(Vec3.Y, planet.getRotation())       // Apply planet rotation
        .nor();                                     // Normalize to unit vector

    // Ambient light color (from the sun's ambientColor)
    Shaders.planet.ambientColor.set(planet.solarSystem.lightColor);
}
```

The light direction determines the brightness of every pixel — pixels facing the light source are brighter, those facing away are darker. Therefore **the back side of the planet is always darker than the front side**; this cannot be controlled via JSON parameters.

#### 2.4.2 The Actual Computation in the Vertex Shader (`planet.vert`)

Below is the complete source of Mindustry's planet vertex shader (`core/assets/shaders/planet.vert`):

```glsl
attribute vec4 a_position;      // Vertex position → from MeshBuilder's heights × corner.v
attribute vec3 a_normal;        // Vertex normal → from MeshBuilder's normal() computation
attribute vec4 a_color;         // Vertex color → from NoiseMesh's getColor() callback
attribute vec4 a_emissive;      // Emissive color → from getEmissiveColor(), default (0,0,0,0)

uniform mat4 u_proj;            // Projection matrix → set by PlanetMesh.render()
uniform mat4 u_trans;           // Transformation matrix → set by PlanetMesh.render()
uniform vec3 u_lightdir;        // Light direction → computed by HexMesh.preRender()
uniform vec3 u_camdir;
uniform vec3 u_campos;
uniform vec3 u_ambientColor;    // Ambient light color → from the sun
uniform float u_emissive;

varying vec4 v_col;             // Final color output to fragment shader

const vec3 diffuse = vec3(0.01);

void main(){
    vec3 specular = vec3(0.0, 0.0, 0.0);

    vec3 lightReflect = normalize(reflect(a_normal, u_lightdir));
    vec3 vertexEye = normalize(u_campos - (u_trans * a_position).xyz);

    float albedo = 1.0 - a_color.a;

    float specularFactor = dot(vertexEye, lightReflect);
    if(specularFactor > 0.0){
        specular = vec3(1.0 * pow(specularFactor, 40.0)) * albedo;
    }

    vec3 norc = (u_ambientColor + specular) *
                (diffuse + vec3(clamp((dot(a_normal, u_lightdir) + 1.0) / 2.0, 0.0, 1.0)));

    float emissive = a_emissive.a * u_emissive *
                     min(pow(max(0.0, (1.0 - norc.r) * 1.2), 3.0), 1.1);

    v_col = vec4(mix(a_color.rgb, a_emissive.rgb, emissive), 1.0) *
            vec4(mix(norc, vec3(1.0), emissive), 1.0);

    gl_Position = u_proj * u_trans * a_position;
}
```

**Line-by-line reading of this shader:**

1. `albedo = 1.0 - a_color.a` — the larger the color's alpha channel, the smaller the albedo (reflectivity). The semi-transparent colors in our JSON (e.g., `"c0c8c080"` with alpha=0x80≈0.5) reduce specular highlights, making that layer look softer.
2. `specular` — specular highlight. The closer the reflection direction is to the view direction, the stronger the highlight. The exponent 40 in `pow(..., 40.0)` produces an extremely concentrated highlight point (shiny ocean surface).
3. `dot(a_normal, u_lightdir)` — the core of diffuse lighting: dot product of the normal and light direction. Facing the light → close to 1 (bright); facing away → close to -1 (dark). `(dot + 1.0) / 2.0` maps it to [0, 1].
4. `norc` (normalized color) — ambient + specular multiplied by diffuse. This is the overall modulation of color by lighting. On the dark side, norc is very small → colors are crushed.
5. `v_col` — the final color output to the fragment shader. If the layer has emissive (e.g., volcanic lava), it produces a glow effect in dark areas.

#### 2.4.3 Fragment Shader: Pass-Through

```glsl
// planet.frag
varying vec4 v_col;

void main(){
    gl_FragColor = v_col;
}
```

The fragment shader is extremely simple — just a pass-through. All lighting computation is done in the vertex shader, which is a performance optimization (vertex count is far smaller than pixel count).

**This means the color values in your JSON will be "darkened" on screen** — back-face color values get multiplied by the norc coefficient (approximately 0.2–0.3 ambient light coefficient). So if the original color is already very dark (like Pitfall 1's `1a3a5c`), it becomes almost black on the dark side.

---

### 2.5 Complete Call Chain (Summary)

```
Game start, loading mod
  │
  └→ ContentParser parses viar.json
       │
       └→ parseMesh() parses the "mesh" field
           ├─ data.isArray() → not an array (it's an object, has a type field)
           ├─ type="MultiMesh" → new MultiMesh(parseMeshes(data.get("meshes")))
           │      └─ parseMeshes() iterates the meshes array, each item recursively calls parseMesh()
           │          └→ new NoiseMesh(planet, seed, …, radius, …, mag, …,
           │                           color1, color2, …, colorScale, colorThreshold)
           │              │
           │              ├─ Choose constructor:
           │              │   color1==color2? → single-color variant (getColor returns fixed color)
           │              │   color1!=color2? → two-color variant (getColor uses noise threshold choice)
           │              │
           │              ├─ Define getHeight() callback: noise3d × mag
           │              ├─ Define getColor() callback:
           │              │   single-color → fixed color
           │              │   two-color → noise3d > colorThreshold ? color2 : color1
           │              │
           │              └─ MeshBuilder.buildHex(mesher, divisions, radius, 0.2)
           │                  ├─ PlanetGrid.create(divisions) → generate hexagonal grid
           │                  ├─ Iterate all corner vertices:
           │                  │   heights[i] = (1 + getHeight × 0.2) × radius
           │                  ├─ Iterate all hexagonal tiles:
           │                  │   ├─ getColor(tile.center) → color of this tile
           │                  │   ├─ Compute triangle normals
           │                  │   └─ Write each corner's (position, normal, color) to VBO
           │                  └─ Output: GPU Vertex Buffer (VBO)

Game runtime, every frame (~60fps)
  │
  └→ PlanetRenderer.render()
      ├─ Gl.clear(depth buffer) + Gl.enable(depth test) + Gl.depthMask(true)
      │
      └→ renderPlanet()
          └→ planet.draw()
              └→ MultiMesh.render(projection, transform)
                  └→ for i = 0 to 4:  // In JSON array order
                      NoiseMesh[i].render()
                      ├─ preRender() → set lighting direction uniform
                      ├─ shader.bind() → bind planet shader
                      └─ GPU draws triangles
                          │
                          ├─ Vertex Shader (planet.vert):
                          │   ├─ Read vertex position = (1+noise×mag×0.2)×radius
                          │   ├─ Read vertex color = output of getColor() callback
                          │   ├─ Multiply by MVP matrix → screen coordinates
                          │   ├─ Lighting computation: diffuse × (ambient + specular)
                          │   ├─ Color modulation: a_color × lighting
                          │   └─ Pass v_col to Fragment Shader
                          │
                          └─ Fragment Shader (planet.frag):
                              ├─ Pass-through v_col → gl_FragColor
                              ├─ Depth test: pixel depth < existing value at this depth buffer position?
                              │   ├─ Yes → draw pixel, write to depth buffer
                              │   └─ No → discard pixel (occluded by earlier layers)
                              └─ Output to framebuffer
```

---

### 2.6 Core Parameter Quick Reference

| JSON Field | Affects | Controls | Increasing effect | Decreasing effect |
|------------|---------|----------|-------------------|-------------------|
| `radius` | Entire layer sphere | Base sphere radius (uniformly scales all vertices) | Layer larger, more easily covers previous layers | Layer smaller, easily occluded |
| `mag` | Geometry noise | Vertex displacement amplitude | Sphere bumpier, more easily pierces previous layers | Sphere smoother, more easily occluded |
| `colorScale` | Color noise | Color patch spatial scale | Patches larger (continental) | Patches smaller (salt-and-pepper) |
| `colorThreshold` | Color noise | Cutoff between color1 and color2 | color2 (typically bright) appears less | color2 appears more |
| `colorOct` | Color noise | Color boundary complexity | More jagged boundaries | Smoother boundaries |
| `octaves` | Geometry noise | Terrain detail layer count | Terrain more rugged | Terrain smoother |
| `scale` | Geometry noise | Spatial frequency of terrain起伏 |起伏 sparser |起伏 denser |
| `seed` | All noise | Noise random seed | Different seed → different terrain shape | — |
| `divisions` | Sphere grid | Hexagonal subdivision level | Denser vertices, sphere rounder | Sparser vertices (better performance) |

---

## 3. Complete Pitfall Log

### Pitfall 1: Blue-Green Distinction Extremely Low (First Attempt)

**Symptom**: The planet surface was a washed-out blue-green mush.

**Original JSON** (AI-themed colors):
```jsonc
{ "color1": "6b5b8a", "color2": "4a4060" }          // Purple-gray
{ "color1": "4ec9a040", "color2": "2d8a6e40" }      // Semi-transparent blue-green
```

**First modification**:
```jsonc
{ "color1": "1a3a5c", "color2": "1a4a4a" }          // Deep ocean blue → dark blue-green
{ "color1": "2d6e3f", "color2": "4a8a4a" }          // Forest green
```

**Root cause**:
1. Both colors were dark (RGB values in the 0x1a–0x4a range), and after being crushed by the fragment shader on the dark side, their hue differences were nearly indistinguishable.
2. Missing `colorScale` and `colorThreshold` → falling back to defaults `colorScale=1.0`, `colorThreshold=0.5`. `colorScale=1.0` produces tiny fragments instead of continental shapes; `colorThreshold=0.5` gives ~50% of each color.
3. The ocean layer's `color2: "1a4a4a"` itself contained a green tint (G channel equals B channel), making its hue blue-green rather than pure blue.

**Fix**: Brighten colors; explicitly add `colorScale=3.0` and `colorThreshold=0.48` to two-color layers.

---

### Pitfall 2: Only Green Visible, Yellow/White/Gray All Gone (Second Attempt)

**Symptom**: The planet was entirely green; desert and mountain layers invisible.

**JSON at this point**:
```jsonc
Ocean:      radius=0.70, mag=0.4
Forest:     radius=0.68, mag=0.55
Desert:     radius=0.66, mag=0.45
Mtn Gray:   radius=0.64, mag=0.35
Mtn White:  radius=0.62, mag=0.25
```

**Root cause — the most critical discovery of this debugging session**:

Plugging into the formula `(1 + noise×mag×0.2) × radius`, computing each layer's extreme distances (noise3d=±1):

| Layer | radius | mag | Max Distance | Min Distance |
|-------|--------|-----|-------------|-------------|
| Ocean | 0.70 | 0.4 | **0.756** | 0.644 |
| Forest | 0.68 | 0.55 | **0.755** | 0.605 |
| Desert | 0.66 | 0.45 | **0.719** | 0.601 |
| Mtn Gray | 0.64 | 0.35 | **0.685** | 0.595 |
| Mtn White | 0.62 | 0.25 | **0.651** | 0.589 |

Desert max distance 0.719 **<** Forest max distance 0.755. All vertices of the desert layer lie inside the forest geometry. Because PlanetRenderer has enabled depth test + depth write, every pixel of the desert layer is discarded by the depth test at render time — completely invisible.

**Comparison**: Vanilla Expansion's `cyclant.json` has all layer radii nearly identical (1.0/1.0/0.982), relying on different seeds so each layer competes for height at different positions.

**Our mistake**: thinking "successively decreasing radius" could simulate terrain layering, but radius is uniform scaling, not height offset.

**Fix**: Unify all layers to `radius=0.7`, producing height differences through `mag` and different seeds.

---

### Pitfall 3: Too Much Yellow/White/Gray, Too Dense — "Scrambled Eggs with Scallions" (Third Attempt)

**Symptom**: After unifying radius, all colors were visible, but yellow/white/gray fragments were excessive, like scallions sprinkled on scrambled eggs.

**mag values at this point**: Ocean 0.3, Forest 0.45, Desert 0.45, Mtn Gray 0.45, Mtn White 0.45.

**Root cause**: All layers had the same mag → each layer had ~50% probability of piercing the previous layer. All five layers each had about half their area visible → all colors uniformly mixed. The desert layer covered about 50% of the forest area, and with colorThreshold=0.55, about half showed bright yellow → ultimately ~25% of the surface was bright yellow.

**Fix**: Decreasing mag, so later-rendered layers only pierce through at positions with extremely high noise.

---

### Pitfall 4: Too Much Green, Ocean Nearly Invisible (Fourth Attempt)

**Symptom**: The ocean blue disappeared.

**mag values at this point**: Ocean 0.25, Forest 0.40.

**Root cause**: `noise_forest × 0.40 > noise_ocean × 0.25` held true in about 75% of the region; the forest layer was higher than the ocean layer over a large area.

**Fix**: Lower forest mag to 0.30, matching the ocean level, restoring 50/50 competition.

---

### Pitfall 5: Mountain Gray/White Completely Invisible (Fifth Attempt)

**Symptom**: Ocean and green proportions were fine, but mountains were invisible.

**mag values at this point**: Ocean 0.30, Forest 0.30, Desert 0.18, Mtn Gray 0.15, Mtn White 0.12.

**Root cause**: The mountain layers needed to simultaneously pierce through three previous layers. The expected value of the joint maximum of three independent noise variables is biased toward positive values, making the actual piercing probability far lower than the single-layer estimate (~10% → ~2–3%), and with colorThreshold=0.65 filtering further, they became invisible.

**Fix**: Mtn Gray mag=0.22, Mtn White mag=0.20, while lowering colorThreshold to 0.55/0.58.

---

## 4. Final Parameter Scheme

```jsonc
[
  { // Layer 1: Pure blue ocean base (single color, no mixing)
    "type": "NoiseMesh", "seed": 42,
    "color": "1050a0",
    "radius": 0.7, "mag": 0.30
  },
  { // Layer 2: Green forest continents
    "type": "NoiseMesh", "seed": 77,
    "color1": "1d7a28", "color2": "3db840",
    "radius": 0.7, "mag": 0.30,
    "colorScale": 3.0, "colorThreshold": 0.48
  },
  { // Layer 3: Yellow desert patches
    "type": "NoiseMesh", "seed": 131,
    "color1": "b8a050", "color2": "d0c068",
    "radius": 0.7, "mag": 0.18,
    "colorScale": 5.0, "colorThreshold": 0.62
  },
  { // Layer 4: Gray mountain shadow side
    "type": "NoiseMesh", "seed": 199,
    "color1": "7a7a7a", "color2": "9a9a9a",
    "radius": 0.7, "mag": 0.22,
    "colorScale": 7.0, "colorThreshold": 0.55
  },
  { // Layer 5: White mountain bright side / ice caps (with alpha for soft blending)
    "type": "NoiseMesh", "seed": 241,
    "color1": "c0c8c080", "color2": "d8e0d860",
    "radius": 0.7, "mag": 0.20,
    "colorScale": 9.0, "colorThreshold": 0.58
  }
]
```

| Layer | radius | mag | colorScale | colorThreshold | Est. visible fraction |
|-------|--------|-----|------------|---------------|----------------------|
| 🌊 Ocean | 0.70 | 0.30 | — | — | ~50% |
| 🌲 Forest | 0.70 | 0.30 | 3.0 | 0.48 | ~50% |
| 🏜️ Desert | 0.70 | 0.18 | 5.0 | 0.62 | ~18% |
| ⛰️ Mtn Gray | 0.70 | 0.22 | 7.0 | 0.55 | ~12% |
| 🏔️ Mtn White | 0.70 | 0.20 | 9.0 | 0.58 | ~8% |

---

## 5. Parameter Tuning Methodology Summary

### 5.1 Core Principles

1. **All layers must have the same `radius`** (or nearly equal). `radius` is a uniform scaling factor — successively decreasing it causes inner layers to be completely occluded by outer layers (depth test).

2. **Control terrain hierarchy through the gradient of `mag`.** `mag` determines how far outward vertices can bulge. Later-rendered layers should have smaller mag than earlier ones, so they lie below earlier layers in most regions and only penetrate at positions with extremely high noise. Decreasing principle: Ocean ≈ Forest > MtnGray ≈ MtnWhite > Desert.

3. **`colorScale` controls color patch size.** Larger values produce larger patches. Increase from low to high (3→5→7→9).

4. **`colorThreshold` controls the proportion of the bright color (color2).** < 0.5 more bright color, > 0.5 more dark color. Typically 0.48–0.65.

5. **Different layers must have different `seed` values.** Otherwise the two layers' noise would be identical, defeating the purpose of multi-layer overlay.

### 5.2 Tuning Order

```
① Tune the ocean base (single color, fixed)
② Add the forest layer; tune mag so ocean/green ≈ 50/50
③ Add the desert layer; tune mag for sparse visibility (~15–20%)
④ Add mountain gray/white layers; tune mag for even sparser visibility (~8–12%)
⑤ Fine-tune colorScale and colorThreshold
```

### 5.3 Common Error Quick Reference

| Error Symptom | Cause |
|---------------|-------|
| Only the outermost color visible | radius decreased layer by layer |
| Pepper-salt mixture | colorScale too small (default 1.0) |
| A certain color excessive | that layer's mag too large |
| A certain color completely invisible | that layer's mag too small, or suppressed by joint multi-layer competition |
| Bright-color fragments too dense | colorThreshold too low |

---

## 6. Appendix: Complete JSON with Layer-by-Layer Parameter Walkthrough

> Below is the complete content of the `"mesh"` field in `viar.json`. After reading it, you should be able to precisely state: "this JSON defines how many mesh layers, what each layer is, and why each parameter is written as it is."

### 6.0 Complete JSON

```jsonc
"mesh": {
    "type": "MultiMesh",
    "meshes": [
        // ═══════════════════════════════════════════
        // Layer 1: Ocean Base 🌊
        // ═══════════════════════════════════════════
        {
            "type": "NoiseMesh",
            "planet": "viar",
            "seed": 42,
            "color": "1050a0",
            "divisions": 5,
            "radius": 0.7,
            "octaves": 7,
            "persistence": 0.5,
            "scale": 1.5,
            "mag": 0.3
        },
        // ═══════════════════════════════════════════
        // Layer 2: Green Forest Continents 🌲
        // ═══════════════════════════════════════════
        {
            "type": "NoiseMesh",
            "planet": "viar",
            "seed": 77,
            "color1": "1d7a28",
            "color2": "3db840",
            "divisions": 5,
            "radius": 0.7,
            "octaves": 6,
            "persistence": 0.5,
            "scale": 1.8,
            "mag": 0.30,
            "colorOct": 3,
            "colorPersistence": 0.5,
            "colorScale": 3.0,
            "colorThreshold": 0.48
        },
        // ═══════════════════════════════════════════
        // Layer 3: Yellow Desert Patches 🏜️
        // ═══════════════════════════════════════════
        {
            "type": "NoiseMesh",
            "planet": "viar",
            "seed": 131,
            "color1": "b8a050",
            "color2": "d0c068",
            "divisions": 5,
            "radius": 0.7,
            "octaves": 5,
            "persistence": 0.5,
            "scale": 2.2,
            "mag": 0.18,
            "colorOct": 2,
            "colorPersistence": 0.5,
            "colorScale": 5.0,
            "colorThreshold": 0.62
        },
        // ═══════════════════════════════════════════
        // Layer 4: Gray Mountain Shadow Side ⛰️
        // ═══════════════════════════════════════════
        {
            "type": "NoiseMesh",
            "planet": "viar",
            "seed": 199,
            "color1": "7a7a7a",
            "color2": "9a9a9a",
            "divisions": 4,
            "radius": 0.7,
            "octaves": 4,
            "persistence": 0.5,
            "scale": 2.5,
            "mag": 0.22,
            "colorOct": 2,
            "colorPersistence": 0.5,
            "colorScale": 7.0,
            "colorThreshold": 0.55
        },
        // ═══════════════════════════════════════════
        // Layer 5: White Mountain Bright Side / Ice Caps 🏔️
        // ═══════════════════════════════════════════
        {
            "type": "NoiseMesh",
            "planet": "viar",
            "seed": 241,
            "color1": "c0c8c080",
            "color2": "d8e0d860",
            "divisions": 4,
            "radius": 0.7,
            "octaves": 3,
            "persistence": 0.5,
            "scale": 3.0,
            "mag": 0.20,
            "colorOct": 2,
            "colorPersistence": 0.5,
            "colorScale": 9.0,
            "colorThreshold": 0.58
        }
    ]
}
```

**At-a-glance conclusion**: `type: "MultiMesh"` wraps a `meshes` array containing **5 elements**. Each element has `type: "NoiseMesh"` → ContentParser calls `new NoiseMesh(...)` for each → produces 5 independent GPU Meshes → at runtime MultiMesh renders them in order 0→1→2→3→4. That's where "five mesh layers" comes from.

---

### 6.1 Layer-by-Layer Parameter Deep-Dive

> First, fields common to all layers:
> - `"planet": "viar"` — which planet this layer belongs to (used for obtaining position, rotation, etc. at runtime)
> - `"persistence": 0.5` — amplitude decay between adjacent frequency layers in fractal noise. 0.5 is the Mindustry standard; no need to adjust
> - `"colorPersistence": 0.5` — amplitude decay for color noise, same as above

---

#### Layer 1: Ocean Base 🌊

```jsonc
{ "type": "NoiseMesh", "seed": 42, "color": "1050a0",
  "divisions": 5, "radius": 0.7, "octaves": 7,
  "persistence": 0.5, "scale": 1.5, "mag": 0.3 }
```

| Param | Value | Why it's written this way |
|-------|-------|--------------------------|
| `type` | `NoiseMesh` | Needs procedural terrain + vertex colors |
| `seed` | `42` | Just needs to differ from other layers. 42 is the ocean's dedicated seed — if it matched the forest seed, ocean and forest terrain起伏 would perfectly align, and the forest would uniformly cover the ocean, losing the "continents floating on the sea" effect |
| `color` | `1050a0` | **Single-color mode**. Writing only `color` without `color1`/`color2` → ContentParser sets both color1 and color2 to the same value → triggers the single-color variant constructor (`getColor()` directly returns this color, no noise selection). `#1050a0` is a moderately saturated deep blue — not green-tinted (avoids confusion with forest), not purple-tinted (avoids the original AI theme), with moderate brightness (won't go completely black on the dark side) |
| `divisions` | `5` | Hexagonal subdivision level. 5 produces ~10,000+ vertices; sphere is sufficiently round. Ocean is the innermost layer and should have the highest vertex density (it provides the "baseline sphere" for all subsequent layers) |
| `radius` | `0.7` | **Must be identical across all layers** (the core lesson of Pitfall 2) |
| `octaves` | `7` | Terrain detail layer count. 7 octaves means the ocean terrain has richly varied wave-like起伏. The ocean doesn't need to be too rugged (that's the mountains' job), but can't be too smooth (otherwise the forest layer has nowhere to "pierce through") |
| `scale` | `1.5` | Noise spatial frequency. 1.5 is slightly larger than the default 1.0 →起伏 is sparser and in larger blocks. Makes the ocean's "basins" and "ridges" scale-coordinate with the forest layer |
| `mag` | `0.3` | Vertex displacement amplitude. **Same as forest** (`mag=0.30`) → both spheres have the same range of noise bumps → in ~50% of areas the ocean is higher than forest, ~50% forest higher than ocean → ocean/green split roughly 50/50 (value corrected after Pitfall 4) |

**What happens at render time**: Layer 1 renders first. The GPU fills the depth buffer with the entire ocean mesh's depth values. Every subsequent layer can only pierce through at vertices where its noise value exceeds the ocean's noise value at that position — those locations display the later layer's color; everywhere else keeps the ocean blue.

---

#### Layer 2: Green Forest Continents 🌲

```jsonc
{ "type": "NoiseMesh", "seed": 77,
  "color1": "1d7a28", "color2": "3db840",
  "divisions": 5, "radius": 0.7, "octaves": 6,
  "persistence": 0.5, "scale": 1.8, "mag": 0.30,
  "colorOct": 3, "colorPersistence": 0.5,
  "colorScale": 3.0, "colorThreshold": 0.48 }
```

| Param | Value | Why it's written this way |
|-------|-------|--------------------------|
| `seed` | `77` | Different from ocean's 42 — the two layers' noise distributions are independent → forest bumps occur at different positions than ocean bumps → produces an "continents embedded in ocean" mosaic effect |
| `color1` | `1d7a28` | Deep forest green. RGB(29,122,40) — low brightness, moderate saturation green, simulating the dark side of dense vegetation |
| `color2` | `3db840` | Bright forest green. RGB(61,184,64) — ~50% brighter than color1, simulating sunlit vegetation. Both colors share the same hue (green), varying only in brightness → visual unity within the layer |
| `mag` | `0.30` | **Same as ocean**. Corrected after Pitfall 4. Originally `mag=0.40` caused green to cover ~75% of the surface (forest noise ×0.40 > ocean noise ×0.30 had too high a probability). Lowered to 0.30 → 50/50 competition |
| `colorScale` | `3.0` | Color patch spatial scale. 3.0 is three times the default 1.0 → patches go from "salt-and-pepper fragments" to "small continents", producing recognizable green landmasses. Shouldn't be larger — forests should be fragmented (scattered woodlands), not the monolithic patches suited for deserts |
| `colorThreshold` | `0.48` | Bright/dark cutoff. 0.48 < 0.5 → ~52% of vertices use `color2` (bright green), 48% use `color1` (dark green). Slightly more bright keeps the forest from looking gloomy |
| `colorOct` | `3` | Color noise octaves. 3-layer superposition produces moderately jagged bright/dark boundaries — simulating the irregular shape of forest edges |
| `octaves` | `6` | Terrain octaves: 1 fewer than ocean, 1 more than desert — terrain complexity at the middle level |
| `scale` | `1.8` | Slightly larger than ocean's 1.5 → forest地形起伏 is slightly sparser and in larger blocks, creating difference from the ocean |

**What happens at render time**: Layer 2 renders after Layer 1. The depth buffer already holds all ocean depth values. Forest's `mag=0.30` matches ocean → at positions where noise is higher (about 50%), it covers the ocean. At positions where noise is lower, the ocean vertex is more outward → forest pixels are discarded by the depth test → ocean blue shows through. In Chapter 0's ASCII diagram, Layer 2 (Forest) sometimes bulges out to cover the ocean, sometimes recesses to reveal it.

---

#### Layer 3: Yellow Desert Patches 🏜️

```jsonc
{ "type": "NoiseMesh", "seed": 131,
  "color1": "b8a050", "color2": "d0c068",
  "divisions": 5, "radius": 0.7, "octaves": 5,
  "persistence": 0.5, "scale": 2.2, "mag": 0.18,
  "colorOct": 2, "colorPersistence": 0.5,
  "colorScale": 5.0, "colorThreshold": 0.62 }
```

| Param | Value | Why it's written this way |
|-------|-------|--------------------------|
| `seed` | `131` | Different from the preceding two layers — deserts only appear at specific geographic locations on Earth; the noise distribution must be independent |
| `color1` | `b8a050` | Earthy yellow. RGB(184,160,80) — medium-brightness warm yellow, simulating arid desert |
| `color2` | `d0c068` | Bright sand. RGB(208,192,104) — brighter and yellower than color1, simulating sunlit dune bright faces |
| `mag` | `0.18` | **Far smaller than ocean/forest's 0.30**. This is the desert layer's most critical parameter. mag=0.18 means desert noise extremes (±0.18) are much smaller than ocean/forest (±0.30). For any sphere position, the probability that the desert vertex height exceeds both ocean and forest vertex heights is about 15–20% (corrected after Pitfalls 3/4). This happens to simulate the fact that deserts cover only a small fraction of Earth's land surface |
| `colorScale` | `5.0` | Larger than forest's 3.0 → desert patches are larger and more continuous, forming Sahara-style monolithic deserts rather than scattered speckles |
| `colorThreshold` | `0.62` | > 0.5 → dark color (`color1`, earthy yellow) takes 62%, bright (`color2`, bright sand) takes 38%. The desert layer overall appears dark yellow with bright sand as accents |
| `octaves` | `5` | 1 fewer than forest — desert terrain doesn't need to be very rugged |
| `scale` | `2.2` | Larger than both ocean and forest — desert起伏 is sparser and flatter |

**Why mag=0.18 and not 0.22?** The desert is a "middle layer" — it needs to pierce through both ocean and forest to be seen. If mag were too large (like Pitfall 3's 0.45), the desert would scatter across the sphere like scallions, not resembling Earth. 0.18 makes the desert visible on ~18% of the surface — sparse but not vanishing.

**What happens at render time**: Layer 3 must simultaneously compete against Layers 1 and 2's depth values. At any pixel position, the desert is only visible when its noise value > max(ocean noise value, forest noise value). This probability is far below 50% (because max of two random variables has an expected value biased positive), hence mag is set to 0.18. Visible area ≈ 18% → of which colorThreshold=0.62 → ~62% display dark earthy yellow, 38% bright sand → ultimately ~7% of the surface is bright sand color.

---

#### Layer 4: Gray Mountain Shadow Side ⛰️

```jsonc
{ "type": "NoiseMesh", "seed": 199,
  "color1": "7a7a7a", "color2": "9a9a9a",
  "divisions": 4, "radius": 0.7, "octaves": 4,
  "persistence": 0.5, "scale": 2.5, "mag": 0.22,
  "colorOct": 2, "colorPersistence": 0.5,
  "colorScale": 7.0, "colorThreshold": 0.55 }
```

| Param | Value | Why it's written this way |
|-------|-------|--------------------------|
| `seed` | `199` | Independent noise distribution |
| `color1` | `7a7a7a` | Neutral gray. RGB(122,122,122) — simulates the dark face of rock, no color cast |
| `color2` | `9a9a9a` | Light gray. RGB(154,154,154) — ~25% brighter than color1, simulating sunlit rock faces. Both colors share identical hue (gray), varying only in brightness |
| `mag` | `0.22` | **Larger than desert's 0.18, smaller than forest's 0.30**. This seemingly counterintuitive setting (shouldn't mountains be more outward than desert?) is the result of correcting Pitfall 5. Mountains need to pierce through 3 preceding layers (ocean + forest + desert); the joint maximum of three independent random variables is statistically significantly higher than single-layer noise. At mag=0.15 mountains were nearly invisible (actual piercing probability ~2–3%); increasing to 0.22 restored ~12% visible proportion |
| `colorScale` | `7.0` | Larger than desert → mountains are large and continuous, simulating real Andes/Himalaya-scale features |
| `colorThreshold` | `0.55` | Slightly biased toward dark (`color1` takes 55%), keeping the mountain layer overall gray-toned. If threshold were too low (e.g., 0.3), bright gray patches would be excessive and confused with the snowcap layer |
| `divisions` | `4` | One level lower than the first three layers (4 vs 5). Mountains are at the outermost layer, closest to the camera, and don't need the densest grid. Reducing divisions saves ~40% of vertex count without affecting visual quality |
| `octaves` | `4` | Mountain terrain is smoother than desert — mountains are large-scale geological structures, not needing 6–7 layers of high-frequency detail |

**Why mag=0.22 > desert's 0.18?** This is not an error. Although the desert is "higher" than ocean/forest in terrain order, its mag was deliberately set small (0.18) to ensure sparseness. Mountains' mag=0.22 is larger than desert — because mountains must simultaneously compete against ocean, forest, and desert (three layers). If mag were too small, the joint maximum of three layers would completely suppress the mountains. 0.22 is the balance point found through Pitfall 5 tuning.

---

#### Layer 5: White Mountain Bright Side / Ice Caps 🏔️

```jsonc
{ "type": "NoiseMesh", "seed": 241,
  "color1": "c0c8c080", "color2": "d8e0d860",
  "divisions": 4, "radius": 0.7, "octaves": 3,
  "persistence": 0.5, "scale": 3.0, "mag": 0.20,
  "colorOct": 2, "colorPersistence": 0.5,
  "colorScale": 9.0, "colorThreshold": 0.58 }
```

| Param | Value | Why it's written this way |
|-------|-------|--------------------------|
| `seed` | `241` | Independent noise distribution. Different from the mountain gray layer's seed → snowcaps don't perfectly overlay on top of gray mountains (which would look artificially like "putting a white hat on mountains"), but overlap with a spatial offset |
| `color1` | `c0c8c080` | Semi-transparent white. RGB(192,200,128), alpha=0x80≈0.5. The alpha channel's role here is to reduce specular highlights (shader computes `albedo = 1.0 - a_color.a`), making snow reflections softer and less blinding. RGB channels are all high (192–200), with a slight blue-green undertone (simulating ice's cool color temperature) |
| `color2` | `d8e0d860` | Even brighter semi-transparent white. alpha=0x60≈0.375, more transparent than color1 → softer reflections on bright faces |
| `mag` | `0.20` | Slightly smaller than mountain gray's 0.22 — snowcaps are the "crown" of the mountains, and should only appear in the subset of gray mountain protrusions with the highest noise. At the same geographic position, after mountain gray has pierced through three layers, the snowcap must be even higher → probability compounds. mag=0.20 yields ~8% visible proportion under joint competition (rare) |
| `colorScale` | `9.0` | The largest of all five layers. Snowcaps/ice caps are the largest-scale terrain features on Earth (Antarctic ice sheet, Himalayan snow peaks), simulated with the largest patch scale |
| `colorThreshold` | `0.58` | > 0.5 → ~58% use dark white, 42% use bright white. Slightly more dark white keeps the overall appearance from being overly blinding |
| `octaves` | `3` | The fewest of all five layers. Snowcap terrain is the smoothest — glaciers and snow cover smooth out terrain detail |
| `scale` | `3.0` | The largest of all five layers. Snowcap起伏 is extremely sparse, corresponding to the real-world characteristic of ice sheets covering vast flat regions |
| `divisions` | `4` | Same level as mountain gray |

**Why isn't the alpha channel 0xFF?** `color1: "c0c8c080"` has alpha=0x80 (semi-transparent), `color2: "d8e0d860"` has alpha=0x60 (more transparent). The alpha here is NOT used for transparency blending (glBlend is not enabled), but rather through the shader's `albedo = 1.0 - a_color.a` to suppress specular highlight intensity. Smaller alpha → larger albedo → weaker highlights → the snowcaps look matte (like real snow), not like a plastic reflective surface.

**What happens at render time**: Layer 5 is the last rendered layer. It submits to the GPU after all four preceding layers. To be visible, the snowcap's noise value must simultaneously exceed the noise values of ocean, forest, desert, and mountain gray — the joint maximum of four independent random variables. At mag=0.20, the actual piercing probability is ~8%. At those positions, the snowcap's semi-transparent white sits atop the mountains, with the alpha channel softening the highlights — the final effect looks like snow or ice caps draped over mountain ridges.

---

### 6.2 Complete Visual Model of Five-Layer Compositing

```
You can think of each frame's rendering as the following process (in time order):

GPU clears depth buffer (all pixel depths = ∞)

Layer 1 Ocean renders:
  → Ocean's every vertex depth written to depth buffer
  → Screen: pure blue sphere (with noise bumps)

Layer 2 Forest renders:
  → Each pixel: forest depth vs depth buffer (ocean depth)
  → Forest closer → display green, update depth buffer
  → Ocean closer → keep blue, don't update
  → Screen: green continents overlaid on blue base (~50% area)

Layer 3 Desert renders:
  → Each pixel: desert depth vs depth buffer[min(ocean depth, forest depth)]
  → Desert closer → display yellow/bright sand, update
  → Previous two layers closer → keep original color
  → Screen: yellow patches scattered on blue-green base (~18% area)

Layer 4 Mountain Gray renders:
  → Competes against joint depth of previous three layers
  → Mountain gray closer → display gray, update
  → Screen: gray ridges faintly appear (~12% area)

Layer 5 Mountain White renders:
  → Competes against joint depth of previous four layers
  → Mountain white closer → display white ice caps, update
  → Screen: white snow peaks dotted on mountains and highest points (~8% area)

Final framebuffer → output to screen
```

**Why do the layers' individual visible fractions sum to far more than 100% without conflict?** Because "visible fraction" refers to the independent probability (the proportion of vertices visible if that layer rendered alone), but actual pixel ownership is mutually exclusive — a pixel can only display one layer's color. In the final image: ocean ~50%, forest ~30% (the remaining 20% covered by desert+mountains), desert ~10%, mountain gray ~7%, mountain white ~3% — total 100%, guaranteed by the depth test's **per-pixel arbitration**.
