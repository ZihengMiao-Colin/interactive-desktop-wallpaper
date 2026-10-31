# Interactive 3D Wallpaper — Project Status & Development Plan

[简体中文](PROJECT_NOTES.md) | **English**

> Last updated: 2026-10-30 (parallax switched to ray marching, edge smoothing default 5, not committed, see §9 Phase 8; before that a batch of user-requested improvements, see Phase 7)
> Purpose: the "map" for future development. Please update this file (and the Chinese version) after changing code.
> The Chinese version, `PROJECT_NOTES.md`, is the primary one; if the two disagree, trust the Chinese version.

**Current scope**
- **Desktop only**. The Android version is a separate repository, [interactive-phone-wallpaper](https://github.com/ZihengMiao-Colin/interactive-phone-wallpaper) (locally `C:\Users\24418\Desktop\2\Wallpaper3D phone`), brought to 1.1.0 on 2026-10-29. It ports this project's parallax shader (`renderer/shaders.js`), parallax math, idle-frame logic, throttled config saving and depth-map post-processing (`src/depth/processing.js`); keep both sides in sync when changing these files (the mapping is in the Android project's `PROJECT_NOTES.md`).
- 2026-10-27: the existing feature set was declared **v1** and packaged (replacing the 10-25 decision of "no packaging for now"): `npm run build` produces an NSIS installer, the installed build was tested, and it was published the same day as v1.0.0 on GitHub Releases. The process and future release steps are in §9 Phase 6.
- Effect video assets (`overlay/`, `elements/`) are committed to git.

---

## 1. One-line summary

An Electron desktop app: the user picks an image → Depth Anything V2 (ONNX, run with `onnxruntime-node`) generates a grayscale depth map → the renderer draws it full-screen with a custom Pixi.js 2.5D parallax shader → the main process polls the global mouse position and the image shifts with pseudo-3D parallax. The window is injected into the Windows desktop WorkerW layer via PowerShell + C#, so it sits below the desktop icons.

On top of that you can layer:
- **Custom elements**: user-imported images / GIFs / videos (including green screen), plus bundled default elements (two explosions). Elements are rendered in the Pixi scene, follow the mouse parallax like the background, and are occluded by closer background objects.
- Vinyl record player (local music), full-screen video effects (screen blend / green screen), Canvas weather particles.

---

## 2. Tech stack & runtime environment

| Item | Status |
|---|---|
| Desktop framework | Electron ^28.3.3 (Chromium 120), electron-builder ^24.9.1 |
| Rendering | Pixi.js 7.4.2 (local npm dependency, version pinned), custom Filter / Mesh shaders |
| Animated image decoding | Chromium's built-in WebCodecs `ImageDecoder` (no `@pixi/gif`) |
| Depth model | Depth Anything V2 Small. The app runs it with `onnxruntime-node` (1.31.1, pinned) in a utilityProcess child process (`src/depth/`); pre/post-processing is ported from `generate_depth_map.py` and the results match the Python version pixel for pixel. ONNX input is fixed at 518×518 (aspect ratio cannot be kept); the output depth map's longest side is 1920 |
| Python | In-project `venv/` (3.11.9) with only onnxruntime / numpy / pillow. The app no longer uses Python; it is only for the asset scripts under `tools/` and the Python tests |
| ONNX models | Project root (ignored by `.gitignore`): `_ir9.onnx` 100MB (the largest is picked; this is the one actually used), `_int8.onnx` 28MB, and a 2MB empty shell. Packaging copies `_ir9.onnx` to `resources/models/depth_anything_v2_small.onnx` |
| Packaging | electron-builder, NSIS installer only (`npm run build` → `dist/Interactive3DWallpaper-Setup-<version>.exe`, ~334MB; ~560MB installed). Assets and the model live under `resources/` (outside asar); onnxruntime's DLLs are unpacked to `app.asar.unpacked` |
| Tests | Node's built-in `node --test` (`npm test`); preprocessing scripts use Python `unittest` |
| Platform | Windows only, primary monitor only |

- Start: `npm start`; `npm run dev` opens DevTools.
- Package: `npm run build`. Logs are in `logs/main.log` in the data folder (output from the main process and every window's console; check this when debugging the packaged build).
- Tests: `npm test`; Python: `venv/Scripts/python.exe -m unittest tools/test_<name>.py` (`test_generate_depth_map`, `test_prepare_wallpapers`, `test_prepare_builtin_element`).
- Browser preview (see the rendering without starting Electron): `venv/Scripts/python.exe -m http.server 8765`, open `http://localhost:8765/index.html`; add `?mode=edit` for placement mode. Data comes from `dev/dev-config.json`.

---

## 3. File map

```
壁纸/
├── main.js                  Main process: windows, WorkerW injection, mouse polling, IPC, tray, full-screen/power listeners, placement window
├── preload.js               contextBridge exposes window.electronAPI (incl. elements / placement namespaces)
├── index.html               Wallpaper page (also the placement window, ?mode=edit)
├── style.css                Wallpaper page styles (incl. placement mode UI)
├── ui/                      UI foundations shared by the settings window and wallpaper page
│   ├── tokens.css           Color / font / radius variables + buttons, toggles, segmented buttons, sliders (incl. depth gradient), tags, keycaps, frosted glass
│   └── icons.js             Lucide icon sprite (Icons.svg) + slider fill (UIControls.paintRange)
├── settings.html            Settings window: structure only (left nav + six pages + status toast)
├── settings/
│   ├── settings.css         Settings window layout
│   ├── main.js              Entry: assembles the shell and pages, reads config once and hands it to each page
│   ├── shell.js             Page switching, bottom-right toast (setStatus), "In use" card, nav badges
│   ├── controls.js          Small helpers shared by pages: node builders, sliders, segmented buttons, toggles, buttons, help popovers (open up / down)
│   ├── depth-preview.js     Live parallax preview (WebGL, same formula as the wallpaper) + image / depth map toggle
│   ├── wallpaper-page.js    "Wallpaper" page: pick image, generate depth map (progress in the action bar), apply, images sent from the tray
│   ├── gallery-panel.js     Default wallpaper gallery below the "Wallpaper" page (tiled, "Choose from computer" as the first tile)
│   ├── parallax-page.js     "Parallax" page: strength, responsiveness, focus depth, restore recommended values
│   ├── elements-tab.js      "Elements" page: asset library + two columns (element list / adjustment panel)
│   ├── effects-page.js      "Effects" page: weather + video effects
│   ├── music-page.js        "Record player" page: playback controls, playlist (add / delete / drag to reorder / click to play), play order, appearance
│   ├── system-page.js       "Settings" page: launch at startup, depth map cache
│   └── thumbnail.js         Generates thumbnails when importing assets
├── renderer/                Wallpaper page scripts (plain global scripts, loaded in index.html order)
│   ├── shaders.js           Background + element shaders, sharing the PARALLAX_GLSL parallax formula
│   ├── ui.js                Loading overlay / Toast / error messages
│   ├── host.js              Runtime abstraction: electronAPI under Electron, fake data from dev/ in the browser
│   ├── parallax-scene.js    Scene: Pixi app, background parallax filter, wallpaper / depth map textures
│   ├── weather.js           Weather manager: canvas, switches effects by config, computes wind and parallax per frame
│   ├── weather/             Five weather types: kit.js (offscreen textures, texture matrices, particle base class) + rain / snow / sakura / leaves / sunlight
│   ├── vinyl.js             Record player: tonearm lift / swing / lower, record spin-up and spin-down (Web Animations), music fade in/out, position and size
│   ├── video-overlay.js     Full-screen video effects
│   ├── elements/
│   │   ├── sources.js       Asset sources: image / animated image (ImageDecoder) / video → Pixi texture
│   │   ├── element-shader.js Element shader instance
│   │   ├── elements-layer.js Element layer: parallax offset, depth occlusion, rotation / perspective warp / recolor, interval playback, click playback, sorting
│   │   └── depth-sampler.js Reads the depth map on the CPU (auto ground placement)
│   ├── edit-mode.js         Placement mode: drag, corner resize, edge stretch, rotate handle, free warp, flip, depth slider, Enter / Esc
│   ├── vinyl-edit-mode.js   Placing the record player (same placement window): drag, corner resize, reset
│   └── main.js              Entry: config, mouse, animation loop, IPC
├── shared/                  Pure logic (UMD, shared by Node tests and the renderer, attached to window.Shared)
│   ├── parallax-math.js     Cover mapping, parallax offset, ray marching (JS version of the shader, for tests), element screen offset
│   ├── elements-model.js    Custom element data structures and pure functions
│   ├── playback.js          Animated frame lookup, interval playback scheduling, click playback state machine
│   ├── frame-pacing.js      Idle frame-stop decision
│   ├── config-sync.js       Throttled config saving, apply only changed config sections
│   ├── vinyl-player.js      Record player logic: uniform spin-up/down, tonearm angle by progress, desktop click hit test, position and size (normalizeLayout / clampCenter)
│   ├── playlist.js          Playlist logic: old-config migration, add / remove, reorder, previous / next, what plays after a track ends
│   └── placement-math.js    Placement geometry: box ↔ screen coords, drag, resize, stretch, rotate, free warp, perspective weights, hit testing, depth sampling
├── src/
│   ├── elements/
│   │   ├── library.js       Asset library: format detection, reading the manifest, import/copy, thumbnails, file URLs
│   │   ├── ipc.js           elements:* / placement:* IPC
│   │   ├── placement-controller.js Placement session (guarantees a single window, treats errors as cancel)
│   │   └── migrate.js       Migration of the old "custom sticker" config
│   ├── wallpaper-native.js  WorkerW injection
│   ├── ps-helper.js         Long-running PowerShell helper (line-based output, restarts on failure), shared by the two below
│   ├── fullscreen-detector.js Full-screen detection
│   ├── desktop-click-watcher.js Desktop click detection (only on when there are "click to play" elements)
│   ├── depth/
│   │   ├── generator.js     Depth map entry point: find the model, start the inference child process, collect results
│   │   ├── inference-process.js Inference child process (utilityProcess): resize → ONNX → post-process → PNG
│   │   ├── processing.js    Numeric processing (Pillow-compatible bicubic, dilation, triple box blur, quantization)
│   │   └── png.js           8-bit grayscale PNG encoder
│   ├── store.js             config.json / depth cache / custom_elements folder
│   ├── gallery.js           Default wallpaper gallery: read manifest, look up by path, migrate old paths
│   └── tray-manager.js      Tray menu
├── elements/                Default elements: manifest.json + cropped *_cut.mp4 + thumbnails (original bomb*.mp4 kept)
├── wallpapers/              Default wallpaper gallery: manifest.json + images + depth/ + thumbs/
├── overlay/                 Full-screen video effect assets
├── tools/prepare_builtin_element.py  Default green-screen element preprocessing (crop / scale / thumbnail)
├── tools/prepare_wallpapers.py       Default wallpaper gallery asset generation (downscale / thumbnail / depth map; `--depth-only` recomputes depth maps only)
├── dev/                     Fake config and sample GIF for browser preview
├── test/                    Node unit tests
├── generate_depth_map.py / export_onnx.py / 生成深度图.bat   Python depth-map generation (used by tools/prepare_wallpapers.py; the app now uses src/depth/)
├── background.png / background2.png / depth_map.png   Default assets
└── default wallpaper/       (in .gitignore) Original images of the default wallpapers; the gallery assets are generated from it; can be deleted
```

---

## 4. Core flows

### 4.1 Startup
1. `app.whenReady` → `new AppStore()` → **migrate old sticker config** → register IPC → create wallpaper window → tray → full-screen detection → power listeners → open the settings window (not when started at login with `--autostart`).
2. Wallpaper window `ready-to-show`: send `config:load`, start 30fps mouse polling, inject into WorkerW asynchronously.
3. Renderer `start()`: read config → if there is a previous wallpaper, use it and its cached depth map (placeholder depth map if not cached) → `Scene.load` → load custom elements → start the ticker.

### 4.2 Changing the wallpaper (settings window)
`Choose wallpaper` → `Generate depth map` (preload decodes to RGBA with Chromium → main process starts the inference child process → saved to the depth cache) → `Apply wallpaper` (saves `currentImage`, sends `image:new`) → the wallpaper window's `Scene.load` swaps textures and frees the old ones.

### 4.3 Parallax rendering
- Shift formula: content at depth t moves by `−parallaxUV(t)`, `parallaxUV = mouse × (t − focus) × strength` (soft clamp).
- Background: screen UV is cover-mapped to image UV → **ray marching** (`rayMarchUV`) finds which image position this pixel actually shows: try layers from nearest to farthest, the first surface hit is the one in front, then refine by bisection → sample the color. Previously it was "sample the depth here and offset once", which stretched the image and folded it into ghost copies when the foreground moved (see Phase 8).
- Custom elements: translated as a whole by `−parallaxUV / coverScale` at their own depth, matching the movement of background at the same depth exactly.
- Occlusion: each element pixel is compared against the depth of the background content actually shown at that pixel (find the shown position with the same ray march, then sample depth); if the scene is closer it covers the element, with a `smoothstep` edge.
- `rayMarchUV` exists in `renderer/shaders.js` (GLSL) and `shared/parallax-math.js` (JS, unit-tested); the algorithm and step parameters must match. The settings preview (`settings/depth-preview.js`) uses it too.

### 4.4 Custom elements
- Click an asset in settings → `elements:startPlacement` → the main process opens a full-screen, always-on-top placement window (`index.html?mode=edit`) and silently pauses the wallpaper.
- Drag / resize / adjust depth in the placement window (new elements default to "auto ground") → Enter or "Confirm" → `placement:commit` → write config → close window → resume the wallpaper and broadcast config.
- Esc, cancel, closing the window, renderer crash and unresponsiveness are all treated as cancel, so no always-on-top window is left behind.

### 4.5 Config sync
Any change → main process writes `config.json` → `broadcastConfig()` pushes it to both the wallpaper window and the settings window.

---

## 5. IPC overview

| Channel | Direction | Purpose |
|---|---|---|
| `dialog:selectImage` / `selectAudioFiles` (multi-select) / `selectCover` / `selectOverlayVideo` | R→M | File dialogs, return paths only |
| `settings:prepareImage` | M→R | The tray picked an image with no depth map: the settings window generates it and then applies automatically |
| `overlay:getPresets` | R→M | Full-screen video effect list |
| `gallery:list` | R→M | Default wallpaper gallery list |
| `depth:generate` / `depth:progress` | R→M / M→R | Generate depth map (with `{ imagePath, blurRadius, width, height, rgba }`) / progress |
| `cache:*`, `depth:*CacheDir` | R→M | Depth map cache and folder (`cache:getDepthMap` returns the bundled depth map for default wallpapers) |
| `config:save` / `config:get` / `config:load` | R→M / M→R | Config read/write + broadcast (wallpaper and settings windows) |
| `wallpaper:apply` / `image:new` | R→M / M→R | Apply wallpaper |
| `mouse:move` | M→R | Global mouse coordinates |
| `desktop:click` | M→R | The desktop was clicked (coords relative to the primary monitor): hitting the record player toggles play / pause, otherwise triggers "click to play" elements; not sent while the wallpaper is paused or placing |
| `renderer:pause` / `renderer:resume` | M→R | Pause / resume; with `{ silent: true }` no toast is shown |
| `elements:getBuiltin` / `import` / `removeAsset` / `saveThumb` / `updateInstance` / `removeInstance` / `startPlacement` | R→M | Custom elements |
| `placement:getDraft` / `commit` / `cancel` | R→M | Placement window (the draft is an element `{ instance, asset }` or the record player `{ kind: 'vinyl', vinyl }`) |
| `vinyl:startPlacement` | R→M | Open the placement window to drag the record player |
| `renderer:ready`, `app:*` | R→M | Ready notification, app control |

---

## 6. Config structure (`src/store.js`, `shared/elements-model.js`)

```js
{
  parallaxMultiplier: 10, smoothness: 0.08, focusDepth: 0.5, blurRadius: 5,   // parallax strength 5 ~ 30 (older configs above 30 read as 30)
  blurRadiusVersion: 2,   // marks the edge smoothing default change from 8 to 5: older configs without it read blurRadius 8 as 5
  autoLaunch, currentImage, depthCacheDir, hideDebugPanel: true,
  vinyl:        { enabled, position, x, y, scale, volume, playing, coverPath,
                  playlist: [{ path, name }], current, playMode: 'list'|'one'|'shuffle'|'once' },
                // older audioPath / audioName / loop become a one-track playlist when the config is read (normalizeVinyl in shared/playlist.js)
                // position: one of the four corners or 'custom' (x / y = platter center as a fraction of the screen); scale 0.5 ~ 2
  weather:      { type, density, speed, parallax },
  videoOverlay: { enabled, presetId, customPath, customName, blendMode, opacity, speed },
  customElements: {
    library:   [{ id: 'user:<uuid>', name, type: 'image'|'animated'|'video', file, thumb, builtin: false, importedAt }],
    instances: [{ id, assetId, visible,
                  transform: { x, y, width, rotation, stretch, flipX, flipY, warp },   // warp: corner offsets for free warp, null = no warp
                  depth, depthAuto, opacity,
                  playback: { mode: 'static'|'loop'|'interval'|'click', intervalSec, jitterSec, followClick },
                  chroma: { enabled, strength },
                  effects: { hue, saturation, brightness, tint, tintAmount } }],      // missing fields on old instances are filled by transformOf / effectsOf
  },
}
```
- Storage location: `%APPDATA%/interactive-desktop-wallpaper/` (`config.json`, `cache_index.json`, `depth_cache/`, `custom_elements/`).
- Default elements are not in the config; they come from `elements/manifest.json` with id `builtin:<id>`.

---

## 7. Feature status

| Feature | Status | Notes |
|---|---|---|
| Depth parallax rendering | ✅ | Background shader switched to highp, formula shared with elements |
| WorkerW injection | ✅ | |
| Depth map generation (ONNX) | ✅ | onnxruntime-node, works in both dev and installed builds |
| Depth map cache / moving the folder | ✅ | |
| Pause on full screen / lock | ✅ | Custom element videos and interval timers pause too |
| Tray, launch at startup | ✅ | Tray "Change wallpaper": applies directly if cached, otherwise generates in the settings window and then applies |
| Vinyl player / video effects / weather particles | ✅ | Weather rewritten on 2026-10-26 (pre-rendered textures, depth of field, realistic shapes and falling motion) |
| **Custom element system** | ✅ | Image / GIF / animated webp / apng / mp4 / webm; two default explosions; placement mode (resize, stretch, rotate, flip, free warp); depth occlusion; interval playback; click playback; green-screen keying; recolor |
| Custom stickers | ♻️ Removed | Replaced by custom elements; old config migrates automatically |
| Default wallpaper gallery (`wallpapers/`) | ✅ | |
| Settings window / wallpaper page UI | ✅ redesigned 2026-10-26 | Six pages in a left nav, unified controls and Lucide icons, live parallax preview; placement mode, Toast and debug panel share the same style |
| Standalone packaged build | ✅ v1 | NSIS installer, see §9 Phase 6 |
| Multiple monitors | ❌ Not supported | |

---

## 8. Known issues / risks

### 🔴 P0
1. ~~Packaged build cannot generate depth maps or play bundled assets~~ ✅ Fixed 2026-10-27 (§9 Phase 6)
2. ~~Pixi.js loaded from a CDN~~ ✅ Now a local npm dependency
3. ~~"Choose" meant "apply"~~ ✅ Choosing only returns a path; only "Apply wallpaper" changes the wallpaper and saves `currentImage`
4. ~~Tray "Change wallpaper" flow incomplete~~ ✅ Applies directly if cached; otherwise generates in the settings window and then applies

### 🟠 P1
5. ~~preload's `getUserDataPath` always threw~~ ✅ Removed
6. ~~Old textures not freed on wallpaper change~~ ✅ `Scene.load` calls `destroy(true)` on old textures
7. ~~Always rendering at full frame rate~~ ✅ Idle frame stop: the ticker stops when the mouse is still, parallax has settled, and there are no weather particles or playing videos / animated images (measured 0 frames in 3 idle seconds); with animation the frame rate is capped at 60 (this machine's display is ~240Hz; snow measured 481 → 118 frames in 2 seconds)
8. ~~Every slider input wrote to disk and broadcast~~ ✅ Settings page and debug panel save throttled (first change sent immediately, then at most once per 100ms; 30 drags measured → 5 broadcasts); the wallpaper only re-applies changed config sections
9. The fallback mode when injection fails, `moveTop()`, raises the full-screen window above every program.
10. ~~Single-instance lock taken after `whenReady`~~ ✅ If the lock is not obtained, the startup flow is not registered
11. ~~Depth cache keyed only on file size~~ ✅ Now size + modification time (old index entries without a modification time still compare size only)
12. Only the small model is used (user decision). The `modelSize` parameter was removed from `generateDepthMap`.

### 🟡 P2
13. ~~Dead code~~ ✅ Cleaned up when `app.js` was split
14. ~~README out of date~~ ✅ Rewritten
15. `hideDebugPanel` defaults to hidden when unset (as expected under Electron; browser preview unaffected).
16. ~~Weather canvas not scaled for DPR~~ ✅
17. ~~mediump precision~~ ✅ Switched to highp
18. All video assets are in git: `overlay/` is 139MB (`old1.mp4` at 53.7MB triggers a warning when pushed to GitHub). Consider Git LFS if assets keep growing.
19. `生成深度图.bat` and `requirements.txt` are still written for the torch route.
22. Depth map post-processing now has two implementations: the app's `src/depth/processing.js` and `generate_depth_map.py` (used by `tools/prepare_wallpapers.py` to generate default wallpaper depth maps). Algorithm changes must be made in both; `test/depth-processing.test.js` has reference data generated by Pillow.
20. Custom elements: placement mode only handles the primary monitor; animated images decode at most 600 frames; no warning when the number of elements grows large.
21. Weather particles are drawn on a separate Canvas 2D layer on top of the whole wallpaper, so they are not occluded by near objects (for "snow falling behind the tree", weather would have to move into the Pixi scene with depth occlusion). The sunlight effect's light source is fixed at the top left and may not match the actual light direction in the wallpaper.

---

## 9. Development plan

### ✅ Phase 0 — Landing the WIP (done)
### ✅ Phase 2 — Custom element system (done)
- Design: [docs/superpowers/specs/2026-10-25-custom-elements-design.md](docs/superpowers/specs/2026-10-25-custom-elements-design.md)
- Plan: [docs/superpowers/plans/2026-10-25-custom-elements.md](docs/superpowers/plans/2026-10-25-custom-elements.md)

### ✅ Phase 1 — Fixing core flows (done)
- [x] Pixi as a local dependency, no CDN.
- [x] Separate "choose image" from "apply wallpaper".
- [x] Tray "Change wallpaper" runs the full flow.
- [x] Fix `getUserDataPath`.
- [x] Destroy old textures when swapping.
- [x] Cache validation by size + modification time.

### ✅ Phase 3 — Performance (done)
- [x] Idle frame stop: stop the ticker when the mouse is still, parallax has settled, and there are no weather particles or playing videos / animated images; wake on mouse move, config change or window resize; interval-playback elements also stop frames while waiting and are woken by a timer (`shared/frame-pacing.js`, `ElementsLayer.needsFrames / nextWakeMs`).
- [x] Throttled saving in the settings page and debug panel (`createConfigSaver` in `shared/config-sync.js`); the main process still broadcasts the full config, and the wallpaper uses `changedSections` to re-apply only changed sections.
- [x] Weather canvas scaled for DPR.
- [x] Parallax shader uses highp.
- [x] Frame rate cap of 60 (`MAX_FPS` in `renderer/parallax-scene.js`), so animation no longer renders at the full refresh rate on high-refresh displays.

### Phase 4 — Other new features (scope fixed 2026-10-26, done in this order)
1. [x] Default wallpaper gallery: `wallpapers/` (17 images with depth maps and thumbnails; `manifest.json` records the Chinese name, source and original file name), a collapsible "Default wallpapers" panel in the settings "Wallpaper management" (collapsed by default; after the UI redesign it became a tiled grid below the "Wallpaper" page). Assets are generated from the originals by `tools/prepare_wallpapers.py`; just rerun it after improving the depth algorithm. The originals folder `default wallpaper/` is untouched and uncommitted and can be deleted; once deleted, an old current-wallpaper path is automatically switched at startup to the same image in the gallery.
2. [x] Depth map quality + depth map preview in settings.
   - No edge-preserving filter: the wallpaper moves pixels by depth, and the sharper the depth edges, the more easily the image tears when moving; an image-guided edge-preserving filter was tried and also left speckles in the depth map.
   - Current post-processing (`postprocess_depth` in `generate_depth_map.py`): upscale the model output to the output size in floating point → dilate near contours outward by the "blur influence radius" → Gaussian smoothing (approximated with a triple box filter). The whole transition band falls on the background side, so subject outlines stay intact when moving and the stretching lands on the background. The "Edge smoothing" slider is the Gaussian σ (in output depth map pixels); the dilation distance is derived from it (`blur_support`).
   - Output depth map longest side 1920 (previously the original image size); the whole pipeline takes ~1.2 seconds for a 6000px image.
   - "Image | Depth map" toggle at the top right of the settings preview; only shown when a depth map exists, and switches to the depth map automatically right after generation.
   - The 17 default wallpapers' depth maps were recomputed with the new algorithm (`prepare_wallpapers.py --depth-only`). Old caches for the user's own images remain valid; clicking "Generate depth map" again switches them to the new algorithm.
3. [x] Advanced custom elements.
   - Recolor (in the settings "Adjust" panel): hue, saturation, brightness, tint (color + strength, multiplies the tint color by luminance so even white elements can be tinted), reset color. Done in the element shader, after keying.
   - Rotation (the dot above the placement box; hold Shift for 15° steps), one-way stretch (edge midpoints; `transform.stretch` is the height multiplier relative to the original ratio), horizontal / vertical flip.
   - Free warp: after "Free warp" in the toolbar, drag the four corners individually and the texture is laid out in perspective (vertices carry a homogeneous weight q, see `projectiveWeights`); concave quads are rejected. "Reset" clears rotation, stretch, flip and warp.
   - Click to play (third playback mode): normally stays on the first frame and plays once when the element is clicked; with "Appear at click position" on, it is normally hidden and plays once wherever the desktop is clicked (with auto depth it takes the depth at the click point).
   - Desktop click detection: the long-running helper reads the left button state every 15ms; a click counts only if press-to-release ≤500ms, movement ≤6px, and the release point is the desktop (root window class Progman / WorkerW). It is only on when there is a visible click-to-play element (or the record player has music, see item 6). Shares `src/ps-helper.js` with full-screen detection.
   - Tested: rendering in Electron, placement handles, recoloring in settings, and the main process forwarding clicks were all verified; the real-mouse desktop click step needs manual testing (automated tests cannot click the user's desktop).
4. [x] Front-end UI redesign (2026-10-26; the user left the design to the assistant and confirmed after seeing mockups).
   - Design: [docs/superpowers/specs/2026-10-26-ui-redesign-design.md](docs/superpowers/specs/2026-10-26-ui-redesign-design.md); plan: [docs/superpowers/plans/2026-10-26-ui-redesign.md](docs/superpowers/plans/2026-10-26-ui-redesign.md).
   - Settings window 960×660 (minimum 820×560), dark title bar (`titleBarStyle: 'hidden'` + `titleBarOverlay`). Left nav: Wallpaper, Parallax, Elements (badge = number of elements on the wallpaper), Effects, Record player, with an "In use" card and "Settings" at the bottom. Operation results became a bottom-right toast (the `setStatus` signature is unchanged).
   - Live parallax preview: the Wallpaper and Parallax pages share one WebGL preview (`mount` moves it to the current page); the shader uses `PARALLAX_GLSL` from `renderer/shaders.js` directly and parameter conversion uses `Shared.parallax`, so it matches the desktop; textures are first downscaled to a 2048 longest side; frames stop once the mouse is still and the image has settled; falls back to `<img>` without WebGL.
   - Depth gradient: every slider that adjusts "depth" draws its track as a far-left / near-right depth map gradient (focus depth, element depth, placement toolbar, debug panel).
   - Wording: 阻尼平滑度 (damping smoothness) → 跟手程度 (responsiveness); shorter weather names (细雨 / 落雪 / 落樱 / 枫叶 / 光斑 — drizzle / snow / sakura / maple leaves / light spots). Features, IPC and config fields are unchanged.
   - The gallery cannot be clicked while a depth map is generating (previously only the "Choose wallpaper" button was disabled, and switching images mid-generation recorded the result against the wrong image); after clearing the cache, default wallpapers can still be applied directly (their depth maps are not in the cache).
   - Placement mode: the hint reads "摆放「name」" (Placing "name"); the depth value and the "Auto" tag are shown separately; flip is icon-only; while free warp is on, the button and warp points are amber (`--warp`).
   - Tested (Electron + CDP): all six pages, choosing and applying from the gallery, tray-sent images generating a depth map and auto-applying, preview parallax and depth map toggle, Elements page (dragging sliders without redrawing, switching selection, playback mode, hide, selecting the first one after delete), placement window, wallpaper page Toast and debug panel, shrinking the window to 820×560 with no horizontal scrollbar. Not tested: the "Clear cache" button (it deletes the user's depth map cache; left for manual testing); CDP screenshots cannot see the system title bar buttons.
   - In testing, when the window is covered by another window the page becomes hidden and CDP screenshots hang; launch with `--disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows`.
5. [x] Weather effects rewrite (2026-10-26; the user found the shapes too simple and left it to the assistant's judgment).
   - Config fields, the settings page and the `WeatherParticleManager` interface (`setConfig` / `isActive` / `update`) are unchanged.
   - All shapes are drawn in code (no image assets from the web, so no copyright issues), rendered once into cached offscreen textures on first use, then only `drawImage` per frame.
   - Each particle has a depth z: closer means bigger, faster falling and more parallax; the nearest layer uses a blurred texture (depth of field). Sorted by z; z is kept on respawn.
   - Drizzle: vertical gradient rain streaks (bright head, fading tail), one shared wind direction per frame. No splashes on the ground (we don't know where the ground is in the wallpaper).
   - Snow: soft-edged snow grains + slowly rotating hexagonal crystals in the mid/near range + out-of-focus snow clumps in the nearest layer; sway from two superimposed frequencies.
   - Sakura: realistic petal shape (narrow base, V-shaped notch at the tip), pink-to-white gradient and veins, switches to a back-side texture when flipped; keeps 30% width when edge-on instead of collapsing to a thin line.
   - Maple leaves: seven-/five-lobed maple outlines generated per lobe (with serrations), five color schemes, veins, stem, dry edges, spots; two falling styles, "swinging" and "tumbling".
   - Light spots: light shafts from the top left (drawn on a 1/4-resolution offscreen canvas and scaled up) + dust lit inside the shafts + out-of-focus bokeh fading in and out in place; the layer uses `mix-blend-mode: screen`.
   - Wind = slow gusts + the mouse's horizontal position (`env.wind`); each weather type takes wind in its own proportion.
   - Tested (Electron, 1708×1068 @1.5): all five weather types at "Moderate" and "Dense" run at the 60fps cap, with 0.1–0.55ms per frame for weather. Compared with the old version in the browser, maple leaves, sakura and light spots are cheaper; rain and snow doubled their particle counts and cost a few hundred extra microseconds per frame.
6. [x] Record player animation (2026-10-26; user request: on play the tonearm moves onto the record first and then it starts spinning; on stop the record stops and the tonearm may stay on the record).
   - Play: lift the needle → swing the tonearm onto the record (1.1 s) → lower the needle → the record spins up uniformly to 33⅓ rpm (1.3 s) while the music fades in. The record does not spin before the needle drops.
   - Pause: the music fades out (0.3 s), the record spins down uniformly, the tonearm stays on the record; playing again skips the lift and just spins up. The tonearm only lifts and re-aligns if it is more than 3° from the progress position (when changing tracks). (Changed on 2026-10-30: the tonearm now returns to rest on pause, see Phase 7)
   - During playback the tonearm moves with progress from the outermost groove (4°) to the innermost (26°); on single-track loop it lifts back to the outer edge when the track restarts; without loop it returns to the rest position (-32°) when finished. If paused mid-swing it turns around immediately back to rest.
   - Record rotation now uses Web Animations (runs on the compositor thread, no per-frame wallpaper redraw needed): each spin-up/down segment continues from the current angle and speed, so changing your mind mid-way does not stutter (`shared/vinyl-player.js`, with unit tests). The tonearm uses a CSS transition.
   - The tonearm is now positioned inside the platter (it was relative to the whole component, so long track names pushed it right and it could not reach the record); the highlight moved outside the record so it does not rotate (on a real record the reflection stays still while spinning); faint groove lines added.
   - The status text and waveform bars reflect whether music is actually playing; "放下唱针…" (Lowering needle…) is shown while the tonearm swings.
   - Tested (Electron + CDP, silent test audio): full play / pause / resume / loop / long track name / pause mid-swing / hide while playing / rapid clicking all verified; config was not modified.
   - Click the record player on the desktop to play / pause (user request, hooked into the existing desktop click detection):
     - When the record player is visible and music has been imported, the main process also turns on desktop click detection (`Shared.vinylPlayer.isClickable`).
     - When the wallpaper page receives `desktop:click` it first checks whether the record disc or the track-name pill was hit (`hitTest`, circular, the corners of the bounding square don't count); if so the record player handles it and it is not passed on to click-to-play elements.
     - On a hit the platter presses down slightly, `vinyl.playing` is toggled and saved to config, and the config broadcast then carries out play / pause, so the settings page play button follows along (the music page now listens to config broadcasts, syncing only the play state). A second click within 450ms is ignored so a double-click doesn't play and then stop; if loop is off and the track has finished, a click plays from the start.
     - A sentence was added to the record player page description in settings: "直接点桌面上的唱片也能播放 / 暂停" (you can also click the record on the desktop to play / pause).
     - Tested: launched Electron with a separate data folder (`--user-data-dir`) and sent `desktop:click` from the main process; verified clicking the record, the pill, a corner, elsewhere, double-click, and settings button sync. The real-mouse desktop click step was not tested automatically (cannot click the user's desktop).
     - Limitation: when a desktop icon overlaps the record player, clicking that icon also toggles playback (we can't tell whether the click was on the icon).
- ~~Model selection in settings~~: not doing it; only the small model (user decision).
- ~~Multiple monitors~~: not doing it (user decision).

### Phase 7 — User-requested improvements (2026-10-30)
The user sent 7 items at once, said they need not all be done together and left the order to the assistant.
1. [x] **Settings window opens on launch**: before, launching only showed a tray icon (Windows 11 hides new tray icons in the overflow area by default), so users could not find a way in. Now launching the app yourself opens the settings window (with a taskbar icon; in development the window icon is `assets/icon.png`). The login-item command carries `--autostart` and only shows the wallpaper. Login items registered by older versions lack the argument; on startup `migrateAutoLaunch` rewrites them to the new command (same registry value). Launching again while the settings window is minimized restores it.
   - Tested (Electron, separate data directory): a normal launch shows the settings and wallpaper windows; with `--autostart` only the wallpaper window. Not tested: a real login-time start (it writes the registry Run key).
2. [x] **"Choose from computer" is the first gallery tile** (it used to be last and was invisible without scrolling).
3. [x] **Help icon next to edge smoothing**: hovering it (or tabbing to it) immediately shows an explanation — what a depth map is, what too small / too large does, the recommended value, and that the depth map must be regenerated. It opens upward over the preview, and downward only when there is no room above (`Controls.initHelpTips`). The long `title` on the old label was removed.
4. [x] **Parallax strength max is 30** (was 100): settings page and debug panel sliders; `AppStore.getConfig` reads older values above 30 as 30.
5. [x] **Drag-to-place record player** ("like the element edit feature"): the record player page's "Position" row has "拖动摆放…" (Drag to place…), which opens the same placement window as elements (the `PlacementController` draft carries `kind: 'vinyl'`) with only the corner handles and "size / reset / cancel / confirm".
   - Drag to move; drag a corner to scale around the platter center (0.5 ~ 2; the settings "Size" slider was widened to 50% ~ 200% too); it cannot be dragged off-screen (`clampCenter`); the selection box includes the protruding tonearm; "Reset" goes back to bottom-right at 100%. Confirming saves `position: 'custom'`, `x`, `y`, `scale` and also turns the record player on.
   - The position is stored as the platter center's fraction of the screen, so it stays roughly in place after a resolution change; it is pushed back on-screen when the track name gets longer or the screen changes. Custom positions use `left/top = 0` plus a transform (with `left` positioning the available width shrinks near the right edge and squashes the track-name capsule).
   - Clicking one of the four corners on the settings page puts it back in that corner; corner positions now scale from that corner (they used to scale from the center and stuck out of the screen when enlarged). The settings page syncs the toggle, position and size from config broadcasts (except the size slider while it is being dragged).
   - The record player in the placement window is display-only and does not read the music file; music on the desktop keeps playing during placement.
   - Tested: browser preview (`index.html?mode=edit&draft=vinyl`) drag, corner scaling, dragging into a screen corner, reset, confirm; in Electron, opening the placement window from settings, and after committing the wallpaper position / click hit test / settings sync, plus 36px corner margins at 200%. Element placement mode regression-checked.
6. [x] **Tonearm returns to rest on pause** (changes the 10-26 decision "the tonearm stays on the record"): pause = music fades out + tonearm lifts back to rest + record coasts to a stop; playing again swings the tonearm to the groove for the current progress and lowers it. Tested (Electron, silent test audio): pausing after 1 s returns the tonearm to -32°; playing again swings it to 7.9° (1.4 s into an 8 s track) before it starts.
7. [x] **Playlist** (the user confirmed "both play modes and manual ordering").
   - Config: `vinyl.playlist: [{ path, name }]` (each file appears once, the path doubles as the id), `current` (path of the current track), `playMode`: list loop `list` / repeat one `one` / shuffle `shuffle` / play in order `once` (stops after the last track). An older `audioPath` becomes a one-track playlist in `AppStore.getConfig`, `loop: false` becomes play-in-order, and the old fields disappear from disk on the next save. The playlist fields are not in the defaults (whether `playlist` exists tells an old config apart). The pure logic is in `shared/playlist.js`, with unit tests.
   - Settings page: the player gained previous / next (switching while paused only changes the track, it does not start playing); a "歌单" (Playlist) group: add tracks (the file dialog allows multi-select, tracks already in the list are skipped; if the list was empty the record player is shown and starts playing), click a track to play it, a delete button on hover, drag to reorder (a line marks the insertion point), missing files marked in red; a "播放顺序" (Play order) row with the four options and a description. The settings page refreshes the playlist from config broadcasts (the highlight follows when the wallpaper changes track) but not while a drag is in progress.
   - Wallpaper: when a track ends the next one is chosen by play mode — `current` is saved to the config, and when the broadcast comes back the tonearm lifts back to the outer groove and lowers again (the record keeps spinning); in play-in-order mode, after the last track the tonearm returns to rest, `playing` becomes false and `current` goes back to the first track. Repeat-one, or a single track in any mode other than play-in-order, uses `<audio loop>`. Unreadable files (deleted, moved) or unsupported formats show "放不了「name」，跳到下一首" (can't play "name", skipping to the next) and are skipped; once as many consecutive failures as the playlist length have happened it stops.
   - Removed the "导入音乐…" (Import music…) button and the `dialog:selectAudio` IPC, replaced by `dialog:selectAudioFiles` (returns an array of paths). Desktop click detection is now enabled when the playlist has tracks.
   - Tested (Electron, separate data directory, 3-second silent test audio): old-config migration; list loop track 2 → skip the missing file → track 3 → back to the first; play-in-order stops after the last track with the tonearm at rest and the first track current; repeat one; shuffle never picks the same track twice in a row; previous / next wrap around; the saved order is correct after delete and drag-reorder; emptying the playlist while playing stops the wallpaper with "请添加歌曲" (Please add tracks); no horizontal scroll bar at 820×560. Not tested: multi-select in the file dialog (needs a human), dragging with a real mouse (tested with synthetic drag-and-drop events).

8. [x] Removed the white spindle dot at the record center (`.vinyl-spindle`): it covered the middle of the cover image.

All of the above ships as **v1.1.0** (user request, 2026-10-30): `package.json` version set to 1.1.0, all 157 `npm test` tests pass; after packaging, the extracted `app.asar` matches the source file by file (only `package.json`, which electron-builder trims, differs, and its version is 1.1.0); the app in `dist/win-unpacked` was run with a fresh data directory: the settings window opens on launch, the first gallery tile is "Choose from computer", the playlist advances to the next track when one ends, the record player placement window opens, and it quits cleanly with no errors in the log. The release still follows the Phase 6 steps: create a draft first, publish after the user confirms the release notes. Published and marked latest on 2026-10-30: https://github.com/ZihengMiao-Colin/interactive-desktop-wallpaper/releases/tag/v1.1.0 . Tag `v1.1.0` points at `e0c1920`, with the asset `Interactive3DWallpaper-Setup-1.1.0.exe` (SHA-256 matches the locally checked installer). The release notes build on v1.0.0's with a "What's new in v1.1.0" section and "Upgrading from v1.0.0" (install over the old version; settings and tracks are kept), Chinese first, then English.

### Phase 8 — Parallax algorithm: ray marching + edge smoothing default 5 (2026-10-30, not committed)
User feedback: where the image splits, large movements feel like the picture is being stretched. Cause: the old algorithm looks up the depth only at each pixel's own position and offsets once. The depth transition band (30–40 px at σ=8) has to absorb the shift difference between foreground and background (about 50 px at strength 30 with the mouse at the screen edge), so one side stretches and the other is squeezed or even folds into ghost copies; blurring the depth map more only spreads the stretch out.
- References: [depthy](https://github.com/panrafal/depthy) (MIT, also a Pixi filter) and [DepthFlow](https://github.com/BrokenSource/DepthFlow) (AGPL-3.0, ideas only, no code copied) both use ray marching; Lively's depth wallpaper works like our old one.
- Approach: `rayMarchUV`. Step count follows how many depth-map pixels the shift spans (at most 2.5 px per step, at most 48 steps, then 5 bisection steps). Mipmaps are off for the depth texture (mip levels can't be computed for texture reads inside the loop).
- Comparison (browser preview, strength 30, mouse at the left/right screen edge; images in `out/raymarch/`, ignored by .gitignore):
  - With the current depth maps (σ=8) the two algorithms look similar: ray marching removes the folding, but the ring of background pulled out with the dilated foreground leaves a thin seam as it slides over other background.
  - With sharper depth maps (σ=3) the old algorithm folds the horse's ear and legs into obvious ghost copies; ray marching has no ghosts, foreground edges are clean, and the background on the covered side no longer bends into waves.
  - Not solved: (1) where the foreground moves away and reveals what it was covering, edge pixels are still drawn as horizontal streaks (there is no image there; it needs the background filled in, i.e. step 2); (2) thin things missing from the depth map (cat whiskers, hair) get cut at small σ — the part inside the head moves with the head, the rest stays with the background; at σ=8 they bend like with the old algorithm. σ=5 is in between.
  - Performance: on this machine (RTX 5070 Laptop) both algorithms take about 0.19 ms per frame, no visible difference; worst case is about 47 depth reads per pixel (was 2). Not tested on integrated GPUs.
- After seeing the comparison images the user decided: use ray marching and change the default edge smoothing from 8 to 5 (σ=3 cut too many whiskers). The trial comparison switch has been removed.
  - The default changed in: `DEFAULT_BLUR` in `src/depth/processing.js` (the main process fallback uses it too), `generate_depth_map.py`, `tools/prepare_wallpapers.py`, the default config in `src/store.js`, and the settings slider and "Restore recommended". The help popup now says "too small: hair, whiskers and thin branches get cut at the edge; too large: a ring of background moves with the object and gets stretched".
  - Old config migration: `saveConfig` writes the full config to disk, so existing users' config.json all contain `blurRadius: 8`. When the config has no `blurRadiusVersion: 2`, `AppStore.getConfig` reads 8 as 5 (treated as untouched), and the marker is written on the next save, so a user who later sets 8 again keeps it; other values are left alone. Unit-tested.
  - The 17 gallery depth maps were regenerated at 5 (`prepare_wallpapers.py --depth-only`) and are pixel-identical to ones generated separately with `--blur 5`. Old caches of users' own images were generated with the old value and only change after clicking "Generate depth map" again.
  - Verification: all 166 `npm test` tests and the three Python suites pass; in the browser preview the wallpaper page renders correctly (including custom elements), the settings slider defaults to 5 with the new help text, and the preview shader compiles under WebGL1. Not run in Electron (the main process was only syntax-checked).
- Open: (1) sync the Android version (shader, `parallax-math.js`, depth map default); (2) whether to do step 2: split foreground/background layers and fill in the hidden background (see [3D Photo Inpainting](https://github.com/vt-vl-lab/3d-photo-inpainting) and the soft layering in [SLIDE](https://arxiv.org/abs/2109.01068); [MI-GAN](https://github.com/Picsart-AI-Research/MI-GAN) has an ONNX model for the fill), which would fix both the streaks and the cut whiskers.

### Phase 5 — Wrap-up
- [ ] Delete or update `生成深度图.bat` and `requirements.txt`.

### ✅ Phase 6 — v1 packaging (done 2026-10-27)
Pre-release check: `npm test` all 121 passing, all three Python test groups passing; launching with a fresh data folder (simulating a new user), opening the settings window, going through all six pages and quitting normally produced no errors and left no PowerShell processes behind. Feature-wise it was ready to call v1, but the packaging config at the time could not produce a working program, so the following was done.

Packaging blockers:
- [x] Added `ui/`, `settings/`, `shared/` to `build.files`; NSIS installer only (portable extracts to a temp folder on every launch, so the launch-at-startup path would change). onnxruntime-node ships win32/x64 only, and the unused DirectML.dll / dxcompiler.dll were removed (CPU only; inference still works without them), saving 36MB.
- [x] Depth maps switched to `onnxruntime-node`, removing Python (`src/depth/`):
  - Pre- and post-processing ported from `generate_depth_map.py`, with resizing replicating Pillow's bicubic algorithm. Images are decoded by the settings window's preload with Chromium (no color management, same as what Pillow reads; rotated by EXIF orientation to match how the wallpaper is displayed — the old Python version ignored EXIF).
  - Tested 3 images (a 1920 image, a 7952×5304 large image, a PNG): dev and installed builds match the Python version **pixel for pixel**, taking 0.7–2.5 seconds (the large image spends most of it passing pixels to the main process). webp and paths containing `#` were also tested.
  - Inference runs in an Electron `utilityProcess` child process, not a worker thread: if native code fails, only the child process exits. This actually happened: with `onnxruntime.dll` missing, the loader found Windows 11's built-in `C:\Windows\System32\onnxruntime.dll` (1.17), which aborted natively during inference; in a worker thread this would crash the whole wallpaper app. Now, with the dll hidden in testing, it only reports "generation failed" and the wallpaper keeps running.
- [x] Assets (the runtime-used files in `overlay/` and `elements/`, plus `wallpapers/`) and the model go into `extraResources`; the main process uses `ASSET_DIR` / `MODEL_DIR` (`process.resourcesPath` when packaged). `renderer/video-overlay.js` used to hard-code the relative path `overlay/xxx.mp4`, which pointed into the asar when packaged; it now gets the presets from the main process (`Host.getOverlayPresets`).
- [x] Absolute paths in config: `migrateLegacyImagePath` replaces "the same image in another copy of the gallery" with the current gallery's (using that gallery's `manifest.json` if it still exists, otherwise matching by the `wallpapers` folder name and file name), so switching back and forth between dev and installed builds lines up. Same-named images in the user's own `wallpapers` folders are unaffected.

Fixed along the way before release:
- [x] Single-instance lock: if the lock is not obtained, the startup flow is not registered (measured: a second instance exits in 0.4 s without creating windows or injecting into the desktop).
- [x] Exiting a full-screen app, waking and unlocking all go through `resumeWallpaper()`: rendering does not resume while a full-screen app is still open or an element is being placed.
- [x] Launch at startup: during development it includes the project folder (previously it opened Electron's default page at boot); query and set use the same arguments.
- [x] Logging: `electron-log` writes to `logs/main.log` in the data folder, including every window's console output. Removed the unused `electron-store`.
- [x] A new user's first launch defaults to the first gallery image (湖光山色, a lake-and-mountain scene) instead of the 1366×768 `background.png`.
- [x] File URLs for custom videos use `Host.fileUrl` (paths containing `#` open too).
- [x] `author` changed to ZihengMiao; old builds in `dist/` cleaned out.

Installed build testing (copied a real config into a separate data folder and launched with `--user-data-dir`, leaving the real config untouched):
- Silent install of 166 files to `%LOCALAPPDATA%\Programs\interactive-desktop-wallpaper`, with desktop and Start menu shortcuts, visible in "Apps & features". Installing over an existing install (upgrade) also works.
- The current wallpaper path switches from the dev folder to the same image in the install folder; desktop injection succeeds; depth map generation matches the Python version pixel for pixel; video effects play and loop from `resources/overlay`; the default elements (explosions) load and play from `resources/elements`; all 21 thumbnails from `resources` load in settings; preventing multiple instances and normal quitting work.
- Not tested: the launch-at-startup toggle (it writes a registry Run entry), tray icon display and menu (needs a human to look), real mouse clicks on the desktop.

Packaging environment pitfalls (you will hit these again when packaging on another machine):
- electron-builder needs to create macOS symlinks when extracting `winCodeSign`, which fails without elevated rights. Fix: manually extract the cached 7z to `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0`, skipping the `darwin` folder (or turn on Windows Developer Mode).
- nsis / nsis-resources downloaded in a restricted shell fail to rename ("cannot move the file to a different disk drive"); manually rename the temp folders to `nsis-3.0.4.1` and `nsis-resources-3.4.1`.
- Passing `/D=path` to the installer from Git Bash eats the backslashes and installs to a strange relative path; pass arguments with PowerShell's `Start-Process`.

Publishing to GitHub Releases (v1.0.0, 2026-10-27):
- URL: https://github.com/ZihengMiao-Colin/interactive-desktop-wallpaper/releases/tag/v1.0.0 . Tag `v1.0.0` points at `c0b2be4`, with the asset `Interactive3DWallpaper-Setup-1.0.0.exe` (SHA-256 matches the locally tested installer).
- The original file name `互动3D壁纸 Setup 1.0.0.exe` contained Chinese characters and spaces, which GitHub replaces; v1.0.0 was copied, renamed by hand and then uploaded. Afterwards the file name was set to `Interactive3DWallpaper-Setup-${version}.${ext}` in `nsis.artifactName`, so builds produce the English name directly. The installed program name is still `productName` (互动3D壁纸).
- Only the exe is uploaded. `latest.yml` and `.blockmap` are for auto-update, which the app doesn't have, so they are not uploaded.
- The release notes cover features, installation, how to get past the SmartScreen prompt ("More info" → "Run anyway") and system requirements, in Chinese with an English version below. The system requirement is Windows 10 / 11 x64, because Electron 28 doesn't support Win7/8 and onnxruntime only ships x64.
- `gh` is logged in as the ZihengMiao-Colin account (`gh auth login`, credentials stored in the system keychain).

Steps for future releases:
1. Bump `version` in `package.json`, run `npm test`, then `npm run build`.
2. Confirm the installer contains the latest code: `node node_modules/@electron/asar/bin/asar.js extract dist/win-unpacked/resources/app.asar <temp folder>`, then compare the extracted files with the source one by one (`diff --strip-trailing-cr`). If code changed after packaging, rebuild.
3. Commit and push.
4. Create a draft first: `gh release create v<version> dist/Interactive3DWallpaper-Setup-<version>.exe --draft --target <full SHA of the commit> --title "互动3D壁纸 v<version>" --notes-file <notes file>`. Drafts are visible only to you. Check the asset's size and SHA-256 with `gh release view v<version> --json assets`, and have the user confirm the release notes (Chinese + English).
5. Make it public: `gh release edit v<version> --draft=false --latest`. The tag doesn't exist during the draft stage; GitHub creates it on publish. Then `git fetch --tags` to sync it locally.

Public distribution notes (v1.0.0 is public; these still hold):
- Of the default wallpapers, 10 are from Pixabay and 7 from Pexels. Both licenses restrict redistribution on "wallpaper-type platforms"; whether bundling them in a free wallpaper app counts is a grey area. Consider replacing them with your own images or more permissively licensed ones before promoting it seriously. The `overlay/` and `elements/` videos have no recorded source.
- No code signing, so others will see a SmartScreen prompt.
- Electron 28 no longer receives security updates. It only loads local pages, so the risk is low and v1 can leave it.
- `package.json` says `"license": "MIT"`, but the repo has no `LICENSE` file.
- The record player cover `coverPath` points to an image in `default wallpaper/` (now in `.gitignore`); change the cover before deleting that folder.

---

## 10. Confirmed decisions (2026-10-25)

| Question | Decision |
|---|---|
| Purpose of the `elements/` explosion videos | Make them custom elements users can add to the wallpaper individually |
| Personal use or distribution | Personal development for now; from 2026-10-27 the existing features are v1 and packaged (depth maps via onnxruntime-node, fp32 model, NSIS installer only), and v1.0.0 was published publicly on GitHub Releases the same day |
| Android version | A separate repository, [interactive-phone-wallpaper](https://github.com/ZihengMiao-Colin/interactive-phone-wallpaper), brought to 1.1.0 on 2026-10-29 (see "Current scope") |
| Video assets in git | Yes |
| Default playback for video elements | One-shot assets use interval playback (wait 10±3 seconds after finishing), others loop |
| Multiple elements at once | Yes, including several copies of the same asset |
| Depth occlusion | Yes (done) |
| Custom element formats | Images, GIF, video, etc.; flow "add → element panel → click → drag → confirm" |
| Future extensions | Recolor, move, rotate, warp; this version only does the basics |
