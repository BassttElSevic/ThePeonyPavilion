# debug-002: Planet Color Adjustment — Blue-Green Earth Appearance

> **Date**: 2026-07-27  
> **Associated File**: `content/planets/peony-pavilion.json`  
> **Source Files Involved**:
> - `mindustry/graphics/g3d/PlanetRenderer.java`
> - `mindustry/graphics/g3d/NoiseMesh.java`
> - `mindustry/graphics/g3d/MeshBuilder.java`
> - `mindustry/graphics/g3d/MultiMesh.java`
> - `mindustry/graphics/g3d/PlanetMesh.java`
> - `mindustry/mod/ContentParser.java`

---

## 1. Background and Goal

The Peony Pavilion mod's `peony-pavilion.json` originally used a **purple-gray + blue-green** "AI-themed" color scheme. This task changes it to a **blue-green Earth-like appearance** — a blue ocean base, overlaid with green forests, yellow deserts, gray mountain shadow sides, and white mountain bright sides (ice caps / snowy peaks), achieving five-layer terrain visual layering.

---

## 2. Planet Rendering Pipeline Explained in Detail

> The goal of this chapter: start from the JSON you wrote, trace all the way to how the GPU draws every pixel on the screen. Once you finish reading it, you will understand why adjusting a certain parameter up or down produces a specific visual effect.

### 2.0 Before Reading the Source: Must-Understand Foundational Concepts

The following concepts span the entire rendering pipeline. If you are already familiar with them, skip directly to 2.1.

**Mesh**: a data collection consisting of a set of 3D vertices and the connectivity relationships between them (triangle indices). The GPU renders 3D objects by drawing these triangles. In Mindustry, each NoiseMesh layer is an independent Mesh — it has its own set of vertices (positions + colors) that are not shared with other layers.

**Vertex**: a point in 3D space. Each vertex carries a set of attributes: position (x, y, z coordinates), color (RGBA), normal direction (used for lighting), etc. The color fields in your JSON ultimately become the color attribute of each vertex.

**Triangle**: the fundamental primitive (i.e., smallest drawing unit) of 3D rendering. Three vertices enclose a triangular face; thousands of triangles assemble into a sphere. Mindustry's planet is an approximate sphere formed by subdividing a hexagonal grid into triangles.

**Shader**: a small program that runs on the GPU, written in a C-like language called GLSL. There are two kinds: (1) **Vertex Shader** — runs on each vertex, transforming 3D positions into screen coordinates; (2) **Fragment Shader** — runs on each pixel, computing the final color (including lighting).

**Uniform**: a global constant in a shader shared by all vertices/pixels within a single draw call. For example, the information "which direction the sun is in" is passed in as a uniform and shared by all pixels.

**Depth Buffer**: a 2D array in GPU video memory, with dimensions equal to the screen resolution. Each element of the array stores **the depth value of the currently nearest object at that pixel position** (depth = distance from the object to the camera). It stores no color, only distance.

**Depth Test**: a hardware judgment the GPU performs before drawing each pixel. The rule is: compare the new pixel's depth value against the existing depth value at the same position in the depth buffer. If the new pixel is closer (smaller depth) → draw it; if the new pixel is farther (larger depth) → discard it. This is the **core mechanism** behind multi-layer planet mesh overlay rendering.

**Depth Mask**: controls whether successfully drawn pixels write their depth values back to the depth buffer. When enabled (`Gl.depthMask(true)`), objects rendered first will "occlude" objects rendered later that are farther away.

**Cull Face**: a performance optimization — if the front face of a triangle (determined by the normal direction) faces away from the camera, the GPU skips drawing it altogether. Mindustry's planet rendering enables culling of back faces (`Gl.back`).

**Simplex Noise**: a mathematical function that takes 3D spatial coordinates `(x, y, z)` as input and outputs a scalar value in the range `[-1, 1]`. Its key properties are: (1) outputs for adjacent coordinates are also close, so the noise is **smooth and continuous**; (2) outputs for distant coordinates are uncorrelated, so the noise has **random variation**. Mindustry uses Simplex noise to simultaneously generate terrain relief and color texture on the 3D spherical surface.

**Octaves**: a parameter in fractal noise techniques. Multiple layers of noise with different frequencies and amplitudes are superimposed — octaves=1 is a single layer of smooth noise; octaves=5 is five layers superimposed, producing more complex terrain detail.

**Persistence**: the amplitude decay factor between adjacent frequency layers in fractal noise. For example, persistence=0.5 means the amplitude of the higher-frequency layer is half that of the lower-frequency layer.

**Callback**: passing a reference to a method (function) as an argument to another method, which then calls it when needed. Mindustry uses this pattern extensively in the NoiseMesh constructor — anonymous functions are passed to `MeshBuilder`, which calls them one by one as it iterates over all vertices on the sphere.

**MVP Matrix (Model-View-Projection Matrix)**: the product of three 4×4 transformation matrices — (1) Model matrix: transforms vertices from object coordinate space to world coordinate space; (2) View matrix: transforms from world coordinate space to camera coordinate space; (3) Projection matrix: projects from camera coordinate space to screen pixel coordinates. In Mindustry's planet rendering, all child layers of a MultiMesh share the same MVP matrix (since they all belong to the same planet).

---

### 2.1 Stage One: How JSON Becomes NoiseMesh Objects

This stage answers: through what code path do the strings `"radius": 0.7` and `"color1": "1d7a28"` in `peony-pavilion.json` ultimately become a drawable NoiseMesh instance in Java memory?

#### 2.1.1 The Single Entry Point: `ContentParser.parseMesh()`

Located at `ContentParser.java` lines 1124–1159. The `mesh` and `cloudMesh` fields in the JSON file are separately extracted by the game's content loading system and handed to this method for parsing:

```java
private GenericMesh parseMesh(Planet planet, JsonValue data){
    // If data is an array → create a MultiMesh (a container holding multiple child meshes)
    if(data.isArray()){
        return new MultiMesh(parseMeshes(planet, data));
    }

    // Read the type field to decide which mesh to construct, default "NoiseMesh"
    String tname = Strings.capitalize(data.getString("type", "NoiseMesh"));

    return switch(tname){
        case "NoiseMesh" -> new NoiseMesh(planet,
            data.getInt("seed", 0),           // noise seed, default 0
            data.getInt("divisions", 1),       // sphere subdivision level, default 1
            data.getFloat("radius", 1f),       // sphere base radius, default 1.0
            data.getInt("octaves", 1),         // geometry noise octaves, default 1
            data.getFloat("persistence", 0.5f),// geometry noise persistence, default 0.5
            data.getFloat("scale", 1f),        // geometry noise spatial scale, default 1.0
            data.getFloat("mag", 0.5f),        // height deformation amplitude, default 0.5
            // —— Color fields: prefer color1, fall back to color, default white ——
            Color.valueOf(data.getString("color1",
                data.getString("color", "ffffff"))),
            Color.valueOf(data.getString("color2",
                data.getString("color", "ffffff"))),
            // —— The following four parameters control the behavior of "color noise" ——
            data.getInt("colorOct", 1),         // color noise octaves, default 1
            data.getFloat("colorPersistence", 0.5f),// color noise persistence, default 0.5
            data.getFloat("colorScale", 1f),      // spatial scale of color patches, default 1.0
            data.getFloat("colorThreshold", 0.5f) // binary color selection threshold, default 0.5
        );
        // ... other mesh types (HexSkyMesh, SunMesh, MultiMesh, MatMesh)
    };
}
```

**This code tells us 5 things:**

**① The `type` field decides which kind of Mesh to construct.** Omitting `"type"` defaults to `NoiseMesh`. Cloud layers use `HexSkyMesh` (a hex mesh where a getColor function internally checks whether the noise value exceeds a threshold), and the sun uses `SunMesh`.

**② `color1`/`color2` vs `color` is a nested fallback mechanism.** The code `data.getString("color1", data.getString("color", "ffffff"))` means:
- JSON writes `"color": "1050a0"` → color1 does not exist, falls back to color → both color slots receive `1050a0` → the single-color variant constructor is called (see 2.2.1 below)
- JSON writes `"color1": "1d7a28", "color2": "3db840"` → the two colors differ → the two-color variant constructor is called
- Neither written → default white

**③ The four color noise parameters (`colorOct`, `colorPersistence`, `colorScale`, `colorThreshold`) all fall back to defaults if omitted.** The default `colorScale=1.0` produces very small patches (like pepper-salt fine speckles); the default `colorThreshold=0.5` gives each color approximately 50%. These two defaults are the direct cause of Pitfall 1 (poor blue-green distinguishability).

**④ Every JSON field has a default value.** The second argument `1f` in `data.getFloat("radius", 1f)` is the default. This means even if the JSON writes nothing but `{}`, a usable NoiseMesh is still constructed (radius 1.0, white, mag=0.5).

**⑤ `parseMesh()` is recursive.** When the JSON has `"type": "MultiMesh"`, the code creates a new `MultiMesh` and then recursively calls `parseMeshes()` to parse each entry in the `"meshes"` array. Your JSON does exactly this: the outer layer is a MultiMesh, and the inner 5 NoiseMeshes are recursively constructed one by one.

---

### 2.2 Stage Two: How Mesh Vertices Are Generated

This stage answers: what happens inside the NoiseMesh constructor? How are the two callbacks `getHeight()` and `getColor()` defined? How is the final vertex position computed?

#### 2.2.1 NoiseMesh's Two Constructors

`NoiseMesh.java` has two constructors — a single-color variant and a two-color variant. Both use **anonymous inner classes (a Java pattern for defining callbacks inline)** to define the two methods of the `HexMesher` interface.

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
    // each hexagon further subdivided into triangles
    // grid.corners contains the 3D direction vectors (unit length) of all vertices

    float[] heights = new float[grid.corners.length];

    // Iterate over every vertex on the sphere
    for(int i = 0; i < grid.corners.length; i++){
        // Call getHeight (the callback we defined in 2.2.1) for each vertex
        // Compute the distance from this vertex to the sphere center
        heights[i] = (1f + mesher.getHeight(grid.corners[i].v) * intensity) * radius;
    }
    //         ^^^^   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^   ^^^^^^
    //      base unit    noise offset × intensity coefficient       sphere radius scale
    //      radius 1

    // ... thereafter use the heights array and the grid topology info
    //     to build GPU vertex buffers ...
}
```

**The expanded formula (substituting intensity=0.2):**

```
vertex distance from sphere center = (1 + noise3d × mag × 0.2) × radius
```

**The parts of this formula:**

| Symbol | Value Source | Meaning | Why It Exists |
|--------|-------------|---------|---------------|
| `1` | hardcoded | base unit radius | guarantees the sphere is at least a perfect sphere (noise only adds/subtracts on top) |
| `noise3d` | Simplex noise | random offset value for this vertex, [-1, 1] | produces irregular bumpy terrain |
| `mag` | JSON `"mag"` | height deformation amplitude | larger → more pronounced noise effect |
| `0.2` | hardcoded in NoiseMesh | intensity attenuation coefficient | keeps the effect of mag values in 0–1 within a suitable deformation range |
| `radius` | JSON `"radius"` | **global scaling factor for the sphere** | controls the overall size of this layer's sphere |

**The most critical fact**: `radius` is **multiplied on the outside of the entire expression**. It is not "sphere radius + noise offset", but rather "an overall scale of (base sphere + noise offset)". This means all vertices produced by `radius=0.66` — including the one that bulges outward the farthest — are smaller than those of a sphere with `radius=0.68`, even if the former has a vertex with a very high noise value.

**Numerical example (this is the mathematical root cause of Pitfall 2):**

```
Assume mag=0.45, noise extremes noise3d=±1:

Forest layer radius=0.68, mag=0.55:
   outermost vertex = 0.68 × (1 + 1×0.55×0.2) = 0.68 × 1.11 = 0.755
   innermost vertex  = 0.68 × (1 - 1×0.55×0.2) = 0.68 × 0.89 = 0.605

Desert layer radius=0.66, mag=0.45:
   outermost vertex = 0.66 × (1 + 1×0.45×0.2) = 0.66 × 1.09 = 0.719
   innermost vertex  = 0.66 × (1 - 1×0.45×0.2) = 0.66 × 0.91 = 0.601
```

The desert layer's outermost vertex 0.719 < the forest layer's outermost vertex 0.755. This means **every single vertex** of the desert layer lies inside the forest layer's sphere. The GPU's depth test (see 2.3.1) will find that all pixels of the desert layer are farther away than the already-drawn forest layer pixels — all of them are discarded.

---

### 2.3 Stage Three: How PlanetRenderer Manages the Rendering Order

This stage answers: in what order are the multiple mesh layers submitted to the GPU? How does the depth test affect the visibility of each layer?

#### 2.3.1 Rendering Entry Point: `PlanetRenderer.render()`

Located at `PlanetRenderer.java` line 47. This is the master entry point for planet rendering each frame:

```java
public void render(PlanetParams params){
    Draw.flush();                       // Flush the 2D draw buffer first
    Gl.clear(Gl.depthBufferBit);        // Clear the depth buffer (reset all pixel depths to infinity)
    Gl.enable(Gl.depthTest);            // ← Enable depth test: per-pixel near/far comparison
    Gl.depthMask(true);                 // ← Enable depth writing: pixels that pass the test write back to the depth buffer
    Gl.enable(Gl.cullFace);             // Enable back-face culling (performance optimization)
    Gl.cullFace(Gl.back);               // Cull the back face of each triangle

    // ... camera position and projection matrix computation ...

    Planet solarSystem = params.planet.solarSystem;
    renderPlanet(solarSystem, params);      // Render opaque layers (planet meshes)
    renderTransparent(solarSystem, params); // Render transparent layers (clouds, atmosphere, orbit lines)
}
```

**What are these three OpenGL state settings doing?**

- `Gl.clear(Gl.depthBufferBit)` → initializes every pixel's depth value to "infinitely far" (in practice, OpenGL uses 1.0 to represent farthest).
- `Gl.enable(Gl.depthTest)` → for every pixel drawn afterward, the GPU automatically compares its depth value against the existing depth value in the depth buffer. New pixel is closer → draw; farther → discard.
- `Gl.depthMask(true)` → successfully drawn pixels **simultaneously** write their depth values into the depth buffer. This means objects drawn first will "occlude" objects drawn later that are farther away.

**Direct impact on multi-layer planet meshes**: Because the depth test and depth write are enabled at the `render()` function level, and all planet meshes are rendered within the `renderPlanet()` call chain — every layer of the MultiMesh shares the same depth buffer. Layers rendered earlier write their depths; layers rendered later must be farther outward to be visible.

#### 2.3.2 `renderPlanet()` to `planet.draw()`

```java
// PlanetRenderer.java line 132
public void renderPlanet(Planet planet, PlanetParams params){
    if(!planet.visible()) return;
    cam.update();

    // Frustum culling: if the planet is outside the camera's view, skip it entirely
    if(cam.frustum.containsSphere(planet.position, planet.clipRadius)){
        planet.draw(params, cam.combined, planet.getTransform(mat));
    }

    // Recursively render all child planets (for solar-system hierarchy)
    for(Planet child : planet.children){
        renderPlanet(child, params);
    }
}
```

`planet.draw()` internally calls `mesh.render()`. For a `MultiMesh` (i.e., the outer structure of your JSON), it renders layer by layer in array order.

#### 2.3.3 `MultiMesh.render()`: Layer-by-Layer Overlay

```java
// MultiMesh.java line 13
public void render(PlanetParams params, Mat3D projection, Mat3D transform){
    for(var v : meshes){
        v.render(params, projection, transform);
    }
}
```

This is the entire code of the multi-layer overlay mechanism. The `meshes` array renders in the index order of the `meshes` array in the JSON — index 0 (ocean) renders first, index 4 (mountain white) renders last.

**Mathematical condition for multi-layer overlay**: Due to the depth test, layer N (array index N−1) is visible at a given pixel position if and only if:

```
depth of that vertex in layer N < the minimum depth among all already-drawn vertices of the previous N−1 layers
```

Equivalently (since all layers share the same transformation matrix and camera position):

```
distance from that vertex in layer N to the sphere center > the maximum distance among all corresponding vertices of the previous N−1 layers
```

This inequality explains the root cause of Pitfall 5 (mountains invisible) — the mountain layer needs to simultaneously exceed the ocean, forest, and desert layers; it is the **maximum of three independent noise variables**. The expected value of the maximum of three independent random variables is significantly biased toward positive values, making the actual penetration probability far lower than the single-layer-competition estimate.

#### 2.3.4 `PlanetMesh.render()`: Shader Binding for a Single Layer

```java
// PlanetMesh.java line 28
public void render(PlanetParams params, Mat3D projection, Mat3D transform){
    if(mesh.isDisposed()) return;

    preRender(params);                           // Set lighting and other shader parameters
    shader.bind();                               // Bind the shader program to the GPU
    shader.setUniformMatrix4("u_proj", projection.val);  // Projection matrix uniform
    shader.setUniformMatrix4("u_trans", transform.val);  // Transformation matrix uniform
    shader.apply();                              // Submit all uniforms to the GPU
    mesh.render(shader, Gl.triangles);           // Draw the vertex buffer in triangle mode
}
```

`shader.bind()` binds Mindustry's planet shader (`Shaders.planet`). This shader receives each vertex's color attribute, multiplies it by the lighting computation result (diffuse + ambient) in the Fragment Shader, and outputs the final pixel color.

---

### 2.4 Stage Four: How the Shader Produces the Final Pixel Color

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

The light direction determines the brightness of each pixel — pixels facing the light source are brighter; pixels facing away are darker. Therefore **the back side of the planet is always darker than the front side**; this is not controllable via JSON parameters.

#### 2.4.2 Color Computation in the Fragment Shader (Conceptual Level)

Mindustry's planet fragment shader approximately performs the following computation (simplified):

```
final pixel color = vertex color × (ambient light + diffuse lighting)
                    │              │              │
                    │              │              └─ max(0, normal direction · light direction) × light source color
                    │              └─ global ambient light (so the dark side is not completely black)
                    └─ from the noise layer's getColor() callback
```

This means the color values in your JSON appear "darkened" on the final screen — back-lit faces have their color values multiplied by an ambient light coefficient of about 0.2–0.3. So if the original color is already very dark (like `1a3a5c` in Pitfall 1), it becomes nearly black on the back-lit side.

---

### 2.5 Complete Call Chain (Summary)

```
Game starts, loads mod
  │
  └→ ContentParser parses peony-pavilion.json
       │
       └→ parseMesh() parses the "mesh" field
           ├─ type=MultiMesh → new MultiMesh()
           └─ For each entry in meshes[], recursively call parseMesh()
               └→ new NoiseMesh(planet, seed, …, radius, …, mag, …, color1, color2, …, colorScale, colorThreshold)
                   │
                   ├─ Defines getHeight() callback: noise3d × mag
                   ├─ Defines getColor() callback:
                   │    single-color → fixed color
                   │    two-color   → noise3d > colorThreshold ? color2 : color1
                   │
                   └─ MeshBuilder.buildHex(mesher, divisions, radius, 0.2)
                       ├─ Iterate over all vertices on the sphere (generated by PlanetGrid)
                       ├─ Each vertex: distance = (1 + getHeight × 0.2) × radius
                       ├─ Each vertex: color = getColor
                       └─ Output: GPU vertex buffer (VBO)

During gameplay, every frame
  │
  └→ PlanetRenderer.render()
      ├─ Gl.clear(depth buffer) + Gl.enable(depth test) + Gl.depthMask(true)
      │
      └→ renderPlanet()
          └→ planet.draw()
              └→ MultiMesh.render(projection, transform)
                  └→ for i = 0 to 4:  // in JSON array order
                      NoiseMesh[i].render()
                      ├─ preRender() → set light-direction uniform
                      ├─ shader.bind() → bind planet shader
                      └─ GPU draws triangles
                          │
                          ├─ Vertex Shader:
                          │   ├─ reads vertex position = (1+noise×mag×0.2)×radius
                          │   ├─ multiplies by MVP matrix → screen coordinates
                          │   └─ passes color and depth to Fragment Shader
                          │
                          └─ Fragment Shader:
                              ├─ reads vertex color × lighting (normal · light direction) → shaded pixel color
                              ├─ Depth Test: is this pixel's depth < the value at this position in the depth buffer?
                              │   ├─ Yes → draw pixel, write depth into depth buffer
                              │   └─ No  → discard pixel (occluded by a preceding layer)
                              └─ Output to framebuffer
```

---

### 2.6 Core Parameter Quick Reference

| JSON Field | Acts On | Controls What | Effect of Increasing | Effect of Decreasing |
|------------|---------|---------------|----------------------|----------------------|
| `radius` | entire layer sphere | sphere base radius (uniformly scales all vertices) | entire layer gets larger, more likely to cover preceding layers | entire layer gets smaller, more easily occluded by preceding layers |
| `mag` | geometry noise | vertex displacement amplitude | surface more bumpy, more likely to penetrate preceding layers | surface smoother, more easily occluded |
| `colorScale` | color noise | spatial scale of color patches | patches larger (continent-like) | patches smaller (pepper-salt-like) |
| `colorThreshold` | color noise | boundary between color1 and color2 | less color2 (usually the brighter color) | more color2 |
| `colorOct` | color noise | complexity of color boundaries | boundaries more jagged | boundaries smoother |
| `octaves` | geometry noise | number of terrain detail layers | terrain more rugged | terrain smoother |
| `scale` | geometry noise | spatial frequency of terrain relief | relief sparser | relief denser |
| `seed` | all noise | random seed for noise | different seed → different terrain shape | — |
| `divisions` | sphere mesh | hexagon subdivision level | denser vertices, rounder sphere | sparser vertices (better performance) |

---

## 3. Complete Pitfall Log

### Pitfall 1: Extremely Poor Blue-Green Distinguishability (First Attempt)

**Symptom**: The planet surface was a muddy blend of blue and green.

**Original JSON** (AI-themed color scheme):
```jsonc
{ "color1": "6b5b8a", "color2": "4a4060" }          // purple-gray
{ "color1": "4ec9a040", "color2": "2d8a6e40" }      // semi-transparent blue-green
```

**First-round modification**:
```jsonc
{ "color1": "1a3a5c", "color2": "1a4a4a" }          // deep ocean blue → dark blue-green
{ "color1": "2d6e3f", "color2": "4a8a4a" }          // forest green
```

**Root cause**:
1. Both colors are dark (RGB values in the 0x1a–0x4a range); after being darkened by the fragment shader on the back-lit side, the hue difference is barely discernible.
2. `colorScale` and `colorThreshold` were missing → defaults `colorScale=1.0` and `colorThreshold=0.5` were used. `colorScale=1.0` produces fine speckles rather than continent shapes; `colorThreshold=0.5` gives each color approximately 50%.
3. The ocean layer's `color2: "1a4a4a"` itself contains a green tint (the G channel equals the B channel in RGB), so its hue leans blue-green rather than pure blue.

**Fix**: Brighten the colors; explicitly add `colorScale=3.0` and `colorThreshold=0.48` to two-color layers.

---

### Pitfall 2: Only Green Visible; Yellow, White, and Gray All Gone (Second Attempt)

**Symptom**: The planet was completely green; the desert and mountain layers were invisible.

**JSON at this point**:
```jsonc
Ocean:       radius=0.70, mag=0.4
Forest:      radius=0.68, mag=0.55
Desert:      radius=0.66, mag=0.45
MountainGray: radius=0.64, mag=0.35
MountainWhite: radius=0.62, mag=0.25
```

**Root cause — the single most critical finding of this debugging session**:

Substituting into the formula `(1 + noise×mag×0.2) × radius`, compute the extreme distances for each layer (noise3d=±1):

| Layer | radius | mag | Max Distance | Min Distance |
|-------|--------|-----|-------------|-------------|
| Ocean | 0.70 | 0.4 | **0.756** | 0.644 |
| Forest | 0.68 | 0.55 | **0.755** | 0.605 |
| Desert | 0.66 | 0.45 | **0.719** | 0.601 |
| MountainGray | 0.64 | 0.35 | **0.685** | 0.595 |
| MountainWhite | 0.62 | 0.25 | **0.651** | 0.589 |

The desert layer's maximum distance 0.719 **<** the forest layer's maximum distance 0.755. Every vertex of the desert layer lies inside the forest layer's geometry. Because PlanetRenderer has enabled depth test + depth write, when the desert layer renders, every pixel is discarded by the depth test — completely invisible.

**Comparison**: Vanilla Expansion's `cyclant.json` has nearly identical radii across all layers (1.0/1.0/0.982), relying on different seeds so each layer competes for height at different positions.

**Our mistake**: Believing that "successively decreasing radius" could simulate terrain layering — but radius is a uniform scaling factor, not a height offset.

**Fix**: Unify all layers to `radius=0.7`; use `mag` and different seeds to produce height differences.

---

### Pitfall 3: Too Much and Too Dense Yellow, White, and Gray — "Scallion Scrambled Eggs" (Third Attempt)

**Symptom**: After unifying radii, all colors were visible, but the yellow, white, and gray fragments were excessive, like chopped scallions sprinkled on scrambled eggs.

**mag at this point**: Ocean 0.3, Forest 0.45, Desert 0.45, MountainGray 0.45, MountainWhite 0.45.

**Root cause**: All layers had the same mag → each layer had roughly a 50% probability of penetrating the preceding layers. Five layers each with roughly half their area visible → all colors mixed uniformly. The desert layer covered roughly 50% of the forest area; with colorThreshold=0.55 roughly half displayed bright yellow → ultimately about 25% of the surface was bright yellow.

**Fix**: Decrease mag successively. Make later-rendered layers penetrate preceding layers only at positions with extremely high noise.

---

### Pitfall 4: Too Much Green, Ocean Nearly Invisible (Fourth Attempt)

**Symptom**: The ocean blue disappeared.

**mag at this point**: Ocean 0.25, Forest 0.40.

**Root cause**: `noise_forest × 0.40 > noise_ocean × 0.25` held true in roughly 75% of the area; the forest layer was higher than the ocean layer across a large portion of the surface.

**Fix**: Lower the forest mag to 0.30, matching the ocean level, restoring 50/50 competition.

---

### Pitfall 5: Mountain Gray and White Completely Invisible (Fifth Attempt)

**Symptom**: The ocean-to-green ratio was correct, but mountains were invisible.

**mag at this point**: Ocean 0.30, Forest 0.30, Desert 0.18, MountainGray 0.15, MountainWhite 0.12.

**Root cause**: The mountain layers need to simultaneously penetrate three preceding layers. The expected value of the maximum of three independent noise variables is biased toward positive values, making the actual penetration probability far lower than the single-layer estimate (~10% → ~2–3%), and after filtering by colorThreshold=0.65 they became invisible.

**Fix**: MountainGray mag=0.22, MountainWhite mag=0.20; also lower colorThreshold to 0.55/0.58.

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
  { // Layer 4: Gray mountain shadow sides
    "type": "NoiseMesh", "seed": 199,
    "color1": "7a7a7a", "color2": "9a9a9a",
    "radius": 0.7, "mag": 0.22,
    "colorScale": 7.0, "colorThreshold": 0.55
  },
  { // Layer 5: White mountain bright sides / ice caps (with alpha blending for soft integration)
    "type": "NoiseMesh", "seed": 241,
    "color1": "c0c8c080", "color2": "d8e0d860",
    "radius": 0.7, "mag": 0.20,
    "colorScale": 9.0, "colorThreshold": 0.58
  }
]
```

| Layer | radius | mag | colorScale | colorThreshold | Estimated Visible Proportion |
|-------|--------|-----|------------|---------------|------------------------------|
| 🌊 Ocean | 0.70 | 0.30 | — | — | ~50% |
| 🌲 Forest | 0.70 | 0.30 | 3.0 | 0.48 | ~50% |
| 🏜️ Desert | 0.70 | 0.18 | 5.0 | 0.62 | ~18% |
| ⛰️ MountainGray | 0.70 | 0.22 | 7.0 | 0.55 | ~12% |
| 🏔️ MountainWhite | 0.70 | 0.20 | 9.0 | 0.58 | ~8% |

---

## 5. Parameter-Tuning Methodology Summary

### 5.1 Core Principles

1. **All layers must have the same `radius`** (or nearly equal). `radius` is a uniform scaling factor — successively decreasing it causes inner layers to be completely occluded by outer layers (depth test).

2. **Control terrain hierarchy through the gradient of `mag`.** `mag` determines how far outward vertices can bulge. Later-rendered layers should have smaller mag than earlier ones, so they lie below earlier layers in most regions and only penetrate at positions with extremely high noise. Decreasing principle: Ocean ≈ Forest > MountainGray ≈ MountainWhite > Desert.

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
