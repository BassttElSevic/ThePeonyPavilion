[简体中文](debug-001-亮起来.md) | **English**

# Debugging Record #1 -- Phase 1: Planet Visibility

Date: 2026-07-21 ~ 2026-07-22
Version: v0.1.0
Issues resolved: 4


## Issue 1: SectorPreset ContentParser Error -- Missing .msav Map File

### Error Log

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

### Source Analysis

The stack trace points to `SectorPreset.initialize()` at line 84. Reading
`Factory/Mindustry/core/src/mindustry/type/SectorPreset.java` lines 81-85:

```java
public void initialize(Planet planet, int sector, boolean override){
    this.planet = planet;
    if(generator == null){
        this.generator = new FileMapGenerator(fileName == null ? this.name : fileName, this);
    }
```

When `generator` is null (not set in JSON), a `FileMapGenerator` is created
using the sector's internal name as the filename. `FileMapGenerator`'s
constructor immediately attempts `Fi.read()` on the `.msav` file -- if the
file does not exist, it throws `ArcRuntimeException` at load time, not at
play time.

The expected path pattern is:
```
maps/<planet-internal-name>/<sector-internal-name>.msav
```
For our case:
```
maps/starfield-viar/starfield-crash-site.msav
```

### Fix

For the "planet visibility" phase, the sector preset is not needed yet. Moved
`crash-site.json` from `content/sectors/` to `maps/starfield-viar/`
so that ContentParser skips it. The map file can be created later using the
in-game map editor.

Once the `.msav` file is ready, move `crash-site.json` back to `content/sectors/`.

### Commit

`947ec61`: fix: move sector JSON out of content/ -- needs .msav map file


## Issue 2: Softlink Destruction -- Game "Delete Mod" Wipes Source Directory

### Behavior

When a symlink exists in `~/.local/share/Mindustry/mods/` pointing to the
development directory `~/Factory/Starfield/`, invoking "Delete Mod"
in-game recursively deletes the symlink target. All source files including
`.git/` were lost.

### Root Cause

Mindustry's `Mods` class does not distinguish between symlinks and regular
directories when deleting. The delete operation traverses into the target.

### Fix

Restored from GitHub (`git clone`), re-applied all changes, committed and
pushed. The correct workflow is:

```
Local edit -> git commit -> git push -> in-game "Import GitHub Mod"
```

Symlinks must not be used for Mindustry mod development.


## Issue 3: mod.json Field Validation Against ModMeta Source

### Source Analysis

Reading `Factory/Mindustry/core/src/mindustry/mod/Mods.java` lines 1376-1399,
the `ModMeta` inner class defines these serializable fields:

```java
public static class ModMeta{
    public String name;
    public String internalName;        // auto-generated: lowercase, spaces -> "-"
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

Key findings against the original mod.json:

| Field in old mod.json | In ModMeta? | Action |
|---|---|---|
| `displayname` (lowercase n) | `displayName` (capital N) | Fixed casing |
| (missing) `subtitle` | `subtitle` exists | Added |
| (missing) `repo` | `repo` exists | Added `BassttElSevic/Starfield` |
| (missing) `hasScripts` | Does NOT exist | Removed from template; game auto-detects `scripts/main.js` |

The `hasScripts` field in VE's mod.json is silently ignored by the JSON
deserializer. Mindustry detects scripts by checking for `scripts/main.js`
at `Mods.loadScripts()` (line 800-830).

### Commit

`aa50418`: v0.1.0 -- corrected mod.json fields, added subtitle/repo


## Issue 4: ContentParser Field Validation -- shownPlanets and databaseTag

### Source Analysis

`shownPlanets` was used in item JSON templates, but reading
`Factory/Mindustry/core/src/mindustry/type/Item.java` (165 lines total)
shows the Item class has these fields only:

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

No `shownPlanets`, no `databaseTag`. These fields appear only in
`Block.java` (line 1324). ContentParser's `ignoreUnknownFields = true`
(line 58) causes unknown JSON fields to be silently discarded -- VE's
item JSONs with `shownPlanets` have no runtime effect on item visibility.

Planet visibility for items is determined by `Item.isOnPlanet()`, which
checks ore generation and recipe references.

### Fix

Removed `shownPlanets` and `databaseTag` from all item JSON recommendations
in the development plan. Updated pattern documentation to note that
`shownPlanets` is Block-only.


## Issue 5: planetGrid() Redundancy with Planet Constructor

### Source Analysis

Reading `Factory/Mindustry/core/src/mindustry/type/Planet.java` lines 224-237:

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

When `sectorSize > 0` is set in the planet JSON, the Planet constructor
automatically creates the sector grid. VE's `scripts/sectorSize.js` with
`planetGrid()` exists only because Tantros has `sectorSize=0` in its JSON
and needs JS to dynamically create the grid.

For the Viar planet with `"sectorSize": 2` in JSON, `planetGrid()`
is unnecessary and would double-create sectors.

### Fix

Removed `require("sectorSize")` from the `main.js` template. Added a note
explaining when `planetGrid()` is needed (JSON `sectorSize=0`) vs when it
is redundant (JSON `sectorSize > 0`).


## Working Constraints

| Item | Value |
|---|---|
| Mindustry version | v8+ (minGameVersion: 146) |
| Mod type | JS + JSON |
| Source paths | `Factory/Mindustry/`, `Factory/Arc/` |
| Reference mod | Vanilla Expansion 2.1.1.1 (`Factory/ref/Vanilla-Expansion-Mod-2111/`) |
| Mod repository | `github.com/BassttElSevic/Starfield` |
| Development directory | `Factory/Starfield/` |
| Import method | GitHub import (NOT symlink) |


## Final State After All Fixes

```
[OK] Mod loads: green enabled
[OK] main.js: "Starfield Mod loaded"
[OK] Planet viar: parsed, parent=sun, visible in campaign/sandbox
[--] Sector crash-site: deferred, waiting for .msav map creation
```
