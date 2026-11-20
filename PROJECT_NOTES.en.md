# Interactive 3D Wallpaper — Project Status & Development Plan

[简体中文](PROJECT_NOTES.md) | **English**

> Last updated: 2026-11-20 (imported files keep working after being moved or renamed: the app remembers each file's NTFS file ID and finds it again when it is moved or renamed on the same drive; files it cannot find can be relinked with one click, and other missing files from the same folder come along, see 4.9 and Phase 22); 2026-11-20 (the adjustment panel on the right of the Elements page is now split into tabs: Position / Color / Playback / Chroma key, one group at a time; the left list no longer runs under the panel, see Phase 21); 2026-11-19 (Phases 18–20 packaged as v1.4.0; the installer now carries the model's Apache-2.0 license, see the end of Phase 20); 2026-11-18 (diagnostic report and feedback: one-click txt report from the settings page or tray, feedback on GitHub, a Chinese prompt when the main process throws, window and GPU process crashes now logged, see Phase 20); 2026-11-14 (UI redone with the updated `ark-style-ui`: square panels, neutral grays with a cyan accent, a color bar plus a thin frame, no more cut corners or frosted glass, see Phase 19); 2026-11-13 (deleted built-in assets with unclear licensing: only the 2 CC0 default wallpapers remain, and all built-in video effects and explosion elements are gone, see Phase 18; the license check is under "Public distribution notes" in §9); 2026-11-10 (wrap-up: added `LICENSE` and cleaned up the Python dependencies, see §9 Phase 5; before that, v1.3.1: the wallpaper no longer covers other programs when it can't attach to the desktop layer, see Phase 17; cropping on import, see Phase 16)
> Purpose: the "map" for future development. Please update this file (and the Chinese version) after changing code.
> The Chinese version, `PROJECT_NOTES.md`, is the primary one; if the two disagree, trust the Chinese version.

**Current scope**
- **Desktop only**. The Android version is a separate repository, [interactive-phone-wallpaper](https://github.com/ZihengMiao-Colin/interactive-phone-wallpaper) (locally `C:\Users\24418\Desktop\2\Wallpaper3D phone`), brought to 1.1.0 on 2026-10-29. It ports this project's parallax shader (`renderer/shaders.js`), parallax math, idle-frame logic, throttled config saving and depth-map post-processing (`src/depth/processing.js`); keep both sides in sync when changing these files (the mapping is in the Android project's `PROJECT_NOTES.md`).
- 2026-10-27: the existing feature set was declared **v1** and packaged (replacing the 10-25 decision of "no packaging for now"): `npm run build` produces an NSIS installer, the installed build was tested, and it was published the same day as v1.0.0 on GitHub Releases. The process and future release steps are in §9 Phase 6.
- Effect video assets (`overlay/`, `elements/`) are committed to git. (On 2026-11-13 all these videos were deleted because their sources could not be established; see Phase 18.)

---

## 1. One-line summary

An Electron desktop app: the user picks an image → Depth Anything V2 (ONNX, run with `onnxruntime-node`) generates a grayscale depth map → the renderer draws it full-screen with a custom Pixi.js 2.5D parallax shader → the main process polls the global mouse position and the image shifts with pseudo-3D parallax. The window is injected into the Windows desktop WorkerW layer by calling user32 directly through `koffi`, so it sits below the desktop icons.

A local video can also be set as the wallpaper (2026-11-03), with three effects: still / 3D parallax (one depth map shared by the whole video) / whole-picture pan, and optional sound. Images and videos the user picked themselves stay in "My wallpapers" on the Wallpaper page. Only paths are stored; files moved or renamed on the same drive are found again automatically (2026-11-20, see 4.9).

After each unlock a video of your own can also play full screen (2026-11-05): it covers the taskbar, fades in and out, and ends on the desktop, see 4.6.

On top of that you can layer:
- **Custom elements**: user-imported images / GIFs / videos (including green screen). There used to be two bundled explosion elements; they were deleted on 2026-11-13, so there are no built-in elements now. Elements are rendered in the Pixi scene, follow the mouse parallax like the background, and are occluded by closer background objects.
- Vinyl record player (local music), full-screen video effects (screen blend / green screen), Canvas weather particles.

---

## 2. Tech stack & runtime environment

| Item | Status |
|---|---|
| Desktop framework | Electron ^28.3.3 (Chromium 120), electron-builder ^24.9.1 |
| Rendering | Pixi.js 7.4.2 (local npm dependency, version pinned), custom Filter / Mesh shaders |
| Animated image decoding | Chromium's built-in WebCodecs `ImageDecoder` (no `@pixi/gif`) |
| Depth model | Depth Anything V2 Small. The app runs it with `onnxruntime-node` (1.31.1, pinned) in a utilityProcess child process (`src/depth/`); pre/post-processing is ported from `generate_depth_map.py` and the results match the Python version pixel for pixel. ONNX input is fixed at 518×518 (aspect ratio cannot be kept); the output depth map's longest side is 1920 |
| Win32 calls | `koffi` (3.3.6, pinned) calls user32.dll directly in the main process (`src/win32.js`). The app does not launch PowerShell at runtime; see §9 Phase 12 for why |
| Python | In-project `venv/` (3.11.9) with only onnxruntime / numpy / pillow. The app no longer uses Python; it is only for the asset scripts under `tools/` and the Python tests |
| ONNX models | Project root (ignored by `.gitignore`): `_ir9.onnx` 100MB (the largest is picked; this is the one actually used), `_int8.onnx` 28MB, and a 2MB empty shell. Packaging copies `_ir9.onnx` to `resources/models/depth_anything_v2_small.onnx` |
| Packaging | electron-builder, NSIS installer only (`npm run build` → `dist/Interactive3DWallpaper-Setup-<version>.exe`, ~334MB; ~560MB installed). Assets and the model live under `resources/` (outside asar); onnxruntime's DLLs are unpacked to `app.asar.unpacked` |
| UI fonts | Bundled in `ui/fonts/` (SIL OFL, about 6.3MB): Noto Serif SC (Chinese headings, split into 101 slices loaded on demand), Saira (small English labels and numbers). Body text uses the system's Noto Sans SC / Microsoft YaHei |
| Tests | Node's built-in `node --test` (`npm test`); preprocessing scripts use Python `unittest` |
| Platform | Windows only, primary monitor only |

- Start: `npm start`; `npm run dev` opens DevTools.
- Package: `npm run build`. Logs are in `logs/main.log` in the data folder (output from the main process and every window's console, with file and line for page errors; check this when debugging the packaged build). When the app fails on someone else's computer, ask them to click settings page "设置" → "问题反馈" → "生成报告" and send the txt from their Desktop (see Phase 20).
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
│   ├── tokens.css           Color (dark / light) / font variables + .panel, .float (panels floating over the wallpaper), buttons, toggles, segmented buttons, sliders (incl. depth gradient), status tags, keycaps, .hz caution stripes, .halftone dots
│   ├── fonts/               Bundled fonts and OFL licenses (noto-serif-sc.css is imported by tokens.css)
│   └── icons.js             Lucide icon sprite (Icons.svg) + slider fill (UIControls.paintRange)
├── settings.html            Settings window: structure only (left nav + six pages + status toast + the notice shown when the wallpaper cannot attach to the desktop)
├── settings/
│   ├── settings.css         Settings window layout
│   ├── main.js              Entry: assembles the shell and pages, reads config once and hands it to each page; shows the notice when the wallpaper is not on the desktop layer
│   ├── shell.js             Page switching, bottom-right toast (setStatus), "In use" card, nav badges
│   ├── controls.js          Small helpers shared by pages: node builders, sliders, segmented buttons, toggles, buttons, help popovers (open up / down)
│   ├── depth-preview.js     Live parallax preview (WebGL, same formula as the wallpaper) + image / depth map toggle; can also play videos and show the three effects
│   ├── wallpaper-page.js    "Wallpaper" page: pick an image or video, video effect and sound, generate depth map (progress in the action bar), apply, images sent from the tray
│   ├── my-wallpapers-panel.js "My wallpapers" on the Wallpaper page: first tile "Choose from computer…" (image or video) + the user's own images and videos, remove, file-not-found (click to pick where it is now), thumbnail backfill
│   ├── gallery-panel.js     Default wallpaper gallery below the "Wallpaper" page (tiled)
│   ├── parallax-page.js     "Parallax" page: strength, responsiveness, focus depth, restore recommended values; notes which settings apply when the current wallpaper is a video
│   ├── elements-tab.js      "Elements" page: asset library + two columns (element list / tabbed adjustment panel)
│   ├── effects-page.js      "Effects" page: weather + video effects
│   ├── music-page.js        "Record player" page: playback controls, playlist (add / delete / drag to reorder / click to play), play order, appearance
│   ├── unlock-page.js       "Unlock animation" page: pick a video, on / off, fade in and out times, sound, preview
│   ├── crop-dialog.js       Crop dialog: opens when importing a wallpaper or unlock video, only lets the user pick the area; the calling page decides where to store it
│   ├── system-page.js       "Settings" page: launch at startup, depth map cache, uninstall (the confirmation dialog asks whether to delete data)
│   └── thumbnail.js         Generates thumbnails when importing assets and picking wallpapers (also checks the file is readable and reads video duration)
├── renderer/                Wallpaper page scripts (plain global scripts, loaded in index.html order)
│   ├── shaders.js           Background + element shaders, sharing the PARALLAX_GLSL parallax formula
│   ├── ui.js                Loading overlay / Toast / error messages
│   ├── host.js              Runtime abstraction: electronAPI under Electron, fake data from dev/ in the browser
│   ├── parallax-scene.js    Scene: Pixi app, background parallax filter, wallpaper / depth map textures; video wallpapers and the three effects (still and pan use a 1×1 white depth map)
│   ├── video-wallpaper.js   Video wallpaper: a hidden <video> as the texture; every new video frame updates the texture and wakes rendering (requestVideoFrameCallback)
│   ├── weather.js           Weather manager: canvas, switches effects by config, computes wind and parallax per frame
│   ├── weather/             Five weather types: kit.js (offscreen textures, texture matrices, particle base class) + rain / snow / sakura / leaves / sunlight
│   ├── vinyl.js             Record player: tonearm lift / swing / lower, record spin-up and spin-down (Web Animations), music fade in/out, position and size
│   ├── video-overlay.js     Full-screen video effects
│   ├── unlock-player.html / unlock-player.js Full-screen player for the unlock animation: plays the video and reports progress and input to the main process
│   ├── elements/
│   │   ├── sources.js       Asset sources: image / animated image (ImageDecoder) / video → Pixi texture
│   │   ├── element-shader.js Element shader instance
│   │   ├── elements-layer.js Element layer: parallax offset, depth occlusion, rotation / perspective warp / recolor, interval playback, click playback, sorting
│   │   └── depth-sampler.js Reads the depth map on the CPU (auto ground placement)
│   ├── edit-mode.js         Placement mode: drag, corner resize, edge stretch, rotate handle, free warp, flip, depth slider, Enter / Esc
│   ├── vinyl-edit-mode.js   Placing the record player (same placement window): drag, corner resize, reset
│   └── main.js              Entry: config, mouse, animation loop, IPC
├── shared/                  Pure logic (UMD, shared by Node tests and the renderer, attached to window.Shared)
│   ├── parallax-math.js     Cover mapping, parallax offset, ray marching (JS version of the shader, for tests), element screen offset, pan zoom (panCover) and per-effect parameters (motionParams)
│   ├── elements-model.js    Custom element data structures and pure functions
│   ├── playback.js          Animated frame lookup, interval playback scheduling, click playback state machine
│   ├── frame-pacing.js      Idle frame-stop decision; whether a video wallpaper keeps playing while paused (keepVideoPlaying)
│   ├── config-sync.js       Throttled config saving, apply only changed config sections, latest-only serial queue for wallpaper switches
│   ├── vinyl-player.js      Record player logic: uniform spin-up/down, tonearm angle by progress, desktop click hit test, position and size (normalizeLayout / clampCenter)
│   ├── playlist.js          Playlist logic: old-config migration, add / remove, reorder, previous / next, what plays after a track ends
│   ├── my-wallpapers.js     My wallpapers list (add, dedupe, sort, remove, migrate) and whether the current wallpaper is an image or a video (resolveCurrent)
│   ├── crop.js              Crop area logic: normalizing config values, default position, move, resize, changing ratio, ratio label, blur check, CSS and URL formats
│   ├── unlock-animation.js  Unlock animation logic: config normalizing, time math, state table (transition)
│   └── placement-math.js    Placement geometry: box ↔ screen coords, drag, resize, stretch, rotate, free warp, perspective weights, hit testing, depth sampling
├── src/
│   ├── elements/
│   │   ├── library.js       Asset library: format detection, reading the manifest, import/copy, thumbnails, file URLs
│   │   ├── ipc.js           elements:* / placement:* IPC
│   │   ├── placement-controller.js Placement session (guarantees a single window, treats errors as cancel)
│   │   ├── placement-window.js Creates a window that fills the whole screen (constructor size gets clipped to the work area, so it calls setBounds afterwards)
│   │   └── migrate.js       Migration of the old "custom sticker" config
│   ├── unlock-animation/
│   │   ├── controller.js    Controller: full-screen window lifecycle, timers, skipping, every failure case
│   │   ├── player-window.js Full-screen window setup (all tested on a real unlock)
│   │   ├── files.js         Importing the video, working out what to play, cleanup
│   │   ├── ipc.js           unlock:* IPC
│   │   └── preload.js       Preload for the full-screen window
│   ├── wallpaper-native.js  WorkerW injection; the fallback mode when it fails (behind all programs, pushed back on a timer)
│   ├── win32.js             Calls user32.dll through koffi, shared by injection, full-screen detection and desktop clicks
│   ├── fullscreen-detector.js Full-screen detection
│   ├── desktop-click-watcher.js Desktop click detection (only on when there are "click to play" elements)
│   ├── depth/
│   │   ├── generator.js     Depth map entry point: find the model, start the inference child process, collect results
│   │   ├── inference-process.js Inference child process (utilityProcess): resize → ONNX → post-process → PNG
│   │   ├── processing.js    Numeric processing (Pillow-compatible bicubic, dilation, triple box blur, quantization)
│   │   └── png.js           8-bit grayscale PNG encoder
│   ├── diagnostics/         Diagnostic report and feedback (Phase 20)
│   │   ├── index.js         Generate a report (collect → build txt → remove user name → save to Desktop → select it), GitHub feedback
│   │   ├── collect.js       Collects each part, each in its own try
│   │   ├── report.js        Builds the report, the GitHub summary, the file name; saves it (BOM + CRLF, another folder if the Desktop is not writable)
│   │   ├── redact.js        Removes the Windows user name from paths
│   │   ├── logs.js          Reads the end of the log, picks recent errors / warnings
│   │   ├── software.js      Recognizes security software and other wallpaper tools by process name
│   │   ├── github.js        The new-issue URL (length kept in check)
│   │   ├── error-prompt.js  The Chinese prompt when the main process throws (rate-limited)
│   │   └── crash-log.js     Logs window / child process crashes, unresponsive windows, page console output (with line numbers)
│   ├── file-tracking/       find imported files again after they are moved or renamed (4.9, Phase 22)
│   │   ├── index.js         when to check (startup / settings window gains focus / every 60 s), path replacement, manual relink, files:* IPC
│   │   ├── tracker.js       remember file IDs (userData/file_ids.json), find files by ID and confirm it is the same file
│   │   ├── file-id.js       read the NTFS file ID; look up the current path by ID with kernel32's OpenFileById
│   │   └── paths.js         pure logic: collect user file paths from the config, replace paths in bulk, relink the rest of a folder, same kind of file
│   ├── store.js             config.json / depth cache (re-keyed when a file moves) / custom_elements folder / My wallpapers thumbnails (wallpaper_thumbs) / uninstall list
│   ├── uninstaller.js       Uninstall from the settings page: find the uninstaller in the install folder and launch it with the delete-data choice
│   ├── gallery.js           Default wallpaper gallery: read manifest, look up by path, migrate old paths (including deleted default wallpapers)
│   ├── removed-assets.js    Deleted built-in video effects and explosion elements: clean up references in old configs at startup
│   └── tray-manager.js      Tray menu (including the "问题反馈" feedback submenu)
├── elements/                Default elements: only manifest.json, with an empty list (the explosion videos were deleted on 2026-11-13)
├── wallpapers/              Default wallpaper gallery: manifest.json + images + depth/ + thumbs/
├── tools/prepare_builtin_element.py  Default green-screen element preprocessing (crop / scale / thumbnail)
├── tools/desktop-diagnose.bat       Collects troubleshooting info (system, window hierarchy, before/after "Show desktop", log) into a txt on the Desktop when the wallpaper will not attach to the desktop layer. Not in the installer; the in-app diagnostic report is usually enough (Phase 20)
├── tools/prepare_wallpapers.py       Default wallpaper gallery asset generation (downscale / thumbnail / depth map; `--depth-only` recomputes depth maps only)
├── dev/                     Fake config and sample GIF for browser preview
├── build/installer.nsh      NSIS custom script: "Also delete my data" checkbox in the uninstall wizard, deleting data, removing the startup entry
├── test/                    Node unit tests
├── generate_depth_map.py / export_onnx.py   Python depth-map generation (used by tools/prepare_wallpapers.py; the app now uses src/depth/)
├── requirements.txt         Python dependencies of the venv (pinned; don't remove the encoding line at the top, see §9 Phase 5)
├── LICENSE                  MIT, code only; licenses for assets, fonts and the model are in the README "License" section
├── licenses/                Third-party licenses shipped with the installer (the depth model's Apache-2.0, packaged into resources/models/)
├── background.png / background2.png / depth_map.png   Default assets
└── default wallpaper/       (in .gitignore) Original images of the default wallpapers; the gallery assets are generated from it; can be deleted
```

---

## 4. Core flows

### 4.1 Startup
1. `app.whenReady` → `new AppStore()` → **migrate old sticker config** → register IPC → create wallpaper window → tray → full-screen detection → power listeners → open the settings window (not when started at login with `--autostart`).
2. Wallpaper window `ready-to-show`: send `config:load`, start 30fps mouse polling, inject into WorkerW asynchronously; if that fails, use the fallback mode (see 4.8).
3. Renderer `start()`: read config → if there is a previous wallpaper, use it (images use their cached depth map, placeholder if not cached; videos see 4.2.1; a missing file falls back to `background.png` with a notice) → `Scene.load` / `Scene.loadVideo` → load custom elements → start the ticker.

### 4.2 Changing the wallpaper (settings window)
`Choose wallpaper` (a default wallpaper, or an image / video in "My wallpapers"; "Choose from computer…" first builds a thumbnail to confirm the file is readable, then adds it to "My wallpapers") → `Generate depth map` (preload decodes to RGBA with Chromium, for videos one frame at 30% of the duration → main process starts the inference child process → saved to the depth cache) → `Apply wallpaper` (the main process stores the current wallpaper from `{ type, path, effect?, sound? }` and sends `wallpaper:show`) → the wallpaper window switches in order (latest request wins): images via `Scene.load`, videos via `createVideoWallpaper` + `Scene.loadVideo`; old textures / videos are freed.

### 4.2.1 Video wallpapers
- Three effects: still (strength 0), 3D parallax (one depth map for the whole video, ray marched like images), whole-picture pan (1×1 white depth map + focus 0, so the whole picture sits at depth 1 and moves by mouse × strength; the picture is zoomed with `panCover` so no edge shows at the extremes). The parameters come from `Shared.parallax.motionParams`, shared by the wallpaper and the settings preview.
- Elements: still / pan have no depth map, so no occlusion (the element shader's `uOcclusion`) and auto ground placement does nothing; in pan mode elements also sit at depth 1 and move with the picture.
- Frame pacing: Pixi does not update the video texture itself; `requestVideoFrameCallback` updates it on every new frame. While the ticker is stopped only that frame is drawn, so an idle video wallpaper redraws at the video's frame rate, and mouse movement still runs at 60 fps.
- Pausing: `renderer:pause` carries a reason (`covered` by a window / `system` lock or sleep / `placement`). The video keeps playing only when covered and sound is on (so the sound continues); otherwise it stops. This split is needed because fullscreen detection also counts maximized windows. On unlock while still covered, the main process re-sends `covered`.

### 4.3 Parallax rendering
- Shift formula: content at depth t moves by `−parallaxUV(t)`, `parallaxUV = mouse × (t − focus) × strength` (soft clamp).
- Background: screen UV is cover-mapped to image UV → **ray marching** (`rayMarchUV`) finds which image position this pixel actually shows: try layers from nearest to farthest, the first surface hit is the one in front, then refine by bisection → sample the color. Previously it was "sample the depth here and offset once", which stretched the image and folded it into ghost copies when the foreground moved (see Phase 8).
- Custom elements: translated as a whole by `−parallaxUV / coverScale` at their own depth, matching the movement of background at the same depth exactly.
- Occlusion: each element pixel is compared against the depth of the background content actually shown at that pixel (find the shown position with the same ray march, then sample depth); if the scene is closer it covers the element, with a `smoothstep` edge.
- `rayMarchUV` exists in `renderer/shaders.js` (GLSL) and `shared/parallax-math.js` (JS, unit-tested); the algorithm and step parameters must match. The settings preview (`settings/depth-preview.js`) uses it too.

### 4.4 Custom elements
- Click an asset in settings → `elements:startPlacement` → the main process opens a full-screen, always-on-top placement window (`index.html?mode=edit`, the same size as the wallpaper, covering the taskbar) and silently pauses the wallpaper.
- Drag / resize / adjust depth in the placement window (new elements default to "auto ground") → Enter or "Confirm" → `placement:commit` → write config → close window → resume the wallpaper and broadcast config.
- Esc, cancel, closing the window, renderer crash and unresponsiveness are all treated as cancel, so no always-on-top window is left behind.

### 4.5 Config sync
Any change → main process writes `config.json` → `broadcastConfig()` pushes it to both the wallpaper window and the settings window.

### 4.6 Unlock animation
- Lock (`lock-screen`): if the feature is on and the video file exists, the full-screen window is created with a black background, the video preloads and waits at its start, and the window sits under the lock screen. It has to happen now: the lock screen was measured to get out of the way 11 to 32 ms before `unlock-screen`, so a window created after the unlock always shows the desktop first.
- Unlock (`unlock-screen`): the video fades in from transparent (from black, on the black background) and Esc is registered. The wallpaper stays paused. The vinyl player never stops on lock, so when the animation has sound it steps aside separately: its volume fades to 0, touching only the volume, not the playback state (`vinyl:duck`).
- Near the end, or on skip: the main process fades the window opacity, revealing the real desktop directly, the animation sound fades with it, and the wallpaper and vinyl player come back. The window is destroyed when the fade ends.
- Window notes: the size in the `BrowserWindow` constructor is clipped to the work area, so `setBounds` has to run after creation to cover the taskbar; `focusable: false` plus `showInactive()` keeps focus where it was; `moveTop()` at unlock, otherwise the taskbar sits on top when it is the foreground window; Esc uses `globalShortcut` and is registered only after the unlock (Esc can also be pressed on the lock screen); mouse skip listens for `mouseup`, because `mousedown` can be swallowed on a window that cannot activate.
- State transitions live in `transition` in `shared/unlock-animation.js`; the window and timers in `src/unlock-animation/controller.js`. Safety nets: a click closes the window in any state, a video that has not loaded 3 seconds after the unlock closes it, a watchdog, window crash or hang handling, and `powerMonitor.getSystemIdleState` when the unlock event is lost (only after `locked` has been seen; it also clears the main process lock state, otherwise the wallpaper stays paused). The unlock checks again whether to play at all: the session may have been unlocked by connecting over Remote Desktop.
- The video is copied to `userData/unlock_animation/`: unlike My wallpapers, which only keep paths (and find moved files by ID, see 4.9), nobody can deal with a missing file at the moment of unlocking (for example one on an unplugged USB drive).

### 4.7 Cropping on import
- The crop area `{ x, y, w, h }` is a fraction of the original image. No new file is written, and changing the crop does not need a new depth map. The box ratio is always the screen ratio, and it starts where automatic cropping would put it.
- Entry points: "Choose from computer…" on the Wallpaper page (Cancel means nothing is imported), the crop button on a My wallpapers card, and picking a video or "Crop again" on the Unlock animation page. All three share `settings/crop-dialog.js`.
- Wallpapers: `Shared.parallax.cropCover` does the Cover mapping inside the area. Changing the mapping alone is not enough, because parallax samples content outside the screen, so the background, element and settings preview shaders all limit sampling to the area (`uCropMin` / `uCropMax`, the old 0.001 to 0.999 when there is no crop). Strength is multiplied by `cropZoom`, so the on-screen shift matches the uncropped one. `panCover` leaves its margin inside the area.
- "OK" always stores the box, even if it did not move. Otherwise a watermark just outside the automatic crop looks cut off and then slides in when the mouse moves.
- The current wallpaper keeps its own copy of the crop (`currentVideo.crop`, `currentImageCrop`): after the wallpaper is removed from My wallpapers, the crop on the desktop stays, including after a restart or pressing "Apply wallpaper" again. `applyWallpaper` in the main process gets the crop through `withCrop`: My wallpapers first, then the current wallpaper, so changing the wallpaper from the tray uses it too.
- Changing the crop of the wallpaper in use updates the desktop at once, without "Apply wallpaper". This is an exception: seeing the watermark still there would look like a failure.
- Unlock video: the player page uses CSS `object-view-box` with the existing `object-fit: cover` (Chromium 104 and later; measured working on `<video>` in Electron 28).
- A thumbnail needs a new file name after cropping again: with the same address, the settings window keeps showing the cached old image.

### 4.8 When the wallpaper cannot attach to the desktop layer (fallback mode)
- When injection fails (blocked by 360, for example), `showBehindOtherWindows` (`src/wallpaper-native.js`) shows the wallpaper as a normal window: set the size, let the mouse pass through, `HWND_BOTTOM`, then `showInactive()`. It goes to the bottom before it is shown, so it never flashes over programs. If it cannot reach the bottom it stays hidden: no wallpaper is better than blocking the user.
- The system pins Progman to the bottom and `HWND_BOTTOM` lands right above it, so the wallpaper sits behind all programs and only covers the desktop icons (which can still be clicked).
- Once a second it checks what is directly below the wallpaper and pushes it back unless that is a desktop window. Minimized windows sink below the wallpaper, and "Show desktop" restores them without activating them, so without this they would all stay covered.
- The window is 1 DIP shorter than the screen: Windows treats a borderless window that fills the monitor as a full-screen program, and the taskbar sinks below the wallpaper.
- The wallpaper window must not be a file dialog's parent (`dialogParent`): the system raises the parent along with the dialog.
- The settings window reads the result through `app:isOnDesktopLayer` and shows a notice at the top of the content area if the wallpaper is not attached. The call only returns once injection has finished, so it does not matter if the settings window opens first, and no separate push is needed.

### 4.9 After an imported file is moved (2026-11-20)
- Paths covered: My wallpapers, `currentImage` / `currentImageCrop.path` / `currentVideo.path` / `currentVideo.imageAtTime`, the playlist (`vinyl.playlist[].path`, `vinyl.current`), the record cover, the user's own video effect, and the depth cache. Elements and the unlock animation are copied on import and need nothing. The field list is `collectPaths` in `src/file-tracking/paths.js`.
- File IDs: `dev` (volume serial) + `ino` (NTFS file ID) from `fs.stat` (`bigint: true`) plus the size, stored in `userData/file_ids.json`. New files are recorded 2 seconds after a config change. Network paths, default wallpapers, and files in the install or data folder are not tracked.
- When to check: at startup (before the windows are created, so the wallpaper window already gets the new path), when the settings window gains focus, and every 60 seconds. Existence checks use the async `fs.promises.access`.
- Finding a file: open the volume from the old path's drive letter, then `OpenFileById` + `GetFinalPathNameByHandleW` give the current path. All of these must hold: not inside `$Recycle.Bin` (tested: a file sent to the Recycle Bin keeps its ID), same kind of file (`sameKind`: image / video / audio match, and whether it can be a wallpaper matches too, since My wallpapers does not accept gif), same size, same ID.
- After finding it: every reference in the config is replaced at once (track names and the video effect name follow the new file name when they were the old file name), the depth map file is renamed to the new key (no regeneration), both windows get `files:relocated` first and then the config broadcast. The record player and the video effect only swap the path they hold, without restarting; the settings page moves its selection. No prompt, only a log line `[FileTracking] 找回`.
- When the record player's next track is missing it first asks `files:locate`; if the file is found it keeps playing, otherwise it skips to the next track as before.
- Cannot be found automatically: moved to another drive (copy + delete gives a new ID), FAT32 / exFAT USB drives, ReFS (Dev Drive), network paths, a USB drive with a new letter, files that were already missing before this update. Clicking the tile in My wallpapers or the track in the playlist opens a file dialog (`files:relink`, opened by the main process, same kind only); after relinking, other missing files under the old folder (including subfolders) are relinked by relative path; wallpapers get a fresh thumbnail; if it was the current wallpaper it is applied again right away. For the video effect, pick it again with "导入视频…".
- If files go missing while the settings page is open and are not found, the config does not change, so nothing would redraw. The main process sends `files:checked` (with `{ checked, missing }`) after every check; the settings page only compares that with what it last drew and redraws when it changed. The settings page no longer checks files on a timer itself (a synchronous check on a dead network drive would freeze the window).
- An external drive that is unplugged, or not mounted yet at login (so it cannot be checked right now): records for paths the config still references are kept, so files are still found once it is plugged back in.
- Extensions outside the lists (the playlist and video effect dialogs accept any file, e.g. `.opus`): the same extension counts as the same kind, and the relink dialog filters by that extension. Files at a drive root (music at the root of a USB stick) also relink the rest of the folder.
- Windows does not allow renaming a large video while it plays (tested with 40MB: file in use); small videos and songs are read into memory, can be renamed, and keep playing.

---

## 5. IPC overview

| Channel | Direction | Purpose |
|---|---|---|
| `dialog:selectWallpaper` / `selectAudioFiles` (multi-select) / `selectCover` / `selectOverlayVideo` | R→M | File dialogs, return paths only (`selectWallpaper` returns `{ path, type: 'image'\|'video' }`; the old `selectImage` was removed, the tray opens its dialog in the main process) |
| `settings:prepareImage` | M→R | The tray picked an image with no depth map: the settings window generates it and then applies automatically |
| `overlay:getPresets` | R→M | Full-screen video effect list |
| `gallery:list` | R→M | Default wallpaper gallery list |
| `depth:generate` / `depth:progress` | R→M / M→R | Generate depth map (with `{ imagePath, blurRadius, width, height, rgba }`) / progress |
| `cache:*`, `depth:*CacheDir` | R→M | Depth map cache and folder (`cache:getDepthMap` returns the bundled depth map for default wallpapers) |
| `config:save` / `config:get` / `config:load` | R→M / M→R | Config read/write + broadcast (wallpaper and settings windows) |
| `wallpaper:apply` / `wallpaper:show` | R→M / M→R | Apply wallpaper: `{ type: 'image', path }` or `{ type: 'video', path, effect, sound }` (`apply` treats a string as an image). The old `image:new` became `wallpaper:show` |
| `myWallpapers:add` / `remove` / `update` / `setThumb` | R→M | My wallpapers: add (with thumbnail Data URL and duration) / remove (deletes the thumbnail, not the original file) / change a video's effect and sound / backfill a thumbnail; each broadcasts the config |
| `myWallpapers:setCrop` | R→M | Change the crop and replace the thumbnail. `myWallpapers:add` also takes `crop` |
| `mouse:move` | M→R | Global mouse coordinates |
| `desktop:click` | M→R | The desktop was clicked (coords relative to the primary monitor): hitting the record player toggles play / pause, otherwise triggers "click to play" elements; not sent while the wallpaper is paused or placing |
| `renderer:pause` / `renderer:resume` | M→R | Pause / resume; with `{ silent: true }` no toast is shown. Pause carries a `reason`: `covered` by a window / `system` lock or sleep / `placement` (decides whether a video wallpaper stops) |
| `elements:getBuiltin` / `import` / `removeAsset` / `saveThumb` / `updateInstance` / `removeInstance` / `startPlacement` | R→M | Custom elements |
| `placement:getDraft` / `commit` / `cancel` | R→M | Placement window (the draft is an element `{ instance, asset }` or the record player `{ kind: 'vinyl', vinyl }`) |
| `vinyl:startPlacement` | R→M | Open the placement window to drag the record player |
| `unlock:selectVideo` / `setVideo` / `remove` / `getInfo` / `preview` | R→M | Unlock animation: pick a video / import (copy the file, turn the feature on) / remove / whether the file exists and the thumbnail URL / preview. On / off, fades and sound go through `config:save` |
| `unlock:setCrop` | R→M | Crop the unlock video again. `unlock:setVideo` also takes `crop`; `unlock:getInfo` also returns the video address |
| `unlock:player-event` / `unlock:start` / `unlock:fade-out` | R→M / M→R / M→R | The full-screen player reports `ready`, `near-end`, `skip`, `error` / the main process starts playback / the fade-out begins (with its duration, the sound follows) |
| `vinyl:duck` | M→R | While the unlock animation has sound, the vinyl volume drops to 0 / comes back |
| `app:getUninstallInfo` / `app:uninstall` | R→M | Whether uninstalling is possible (not in the dev build or without an uninstaller) / launch the uninstaller (with `{ deleteData }`) and quit |
| `app:getScreenInfo` | R→M | Primary display size and scale factor (for the crop box ratio and the "may look blurry" hint) |
| `app:isOnDesktopLayer` | R→M | Whether the wallpaper is attached to the desktop layer; returns once injection has finished (the settings window shows a notice if not) |
| `diagnostics:generateReport` / `openGitHubFeedback` / `openLogDir` | R→M | Feedback: generate a diagnostic report (`{ success, path, fileName }` or `{ success: false, error }`) / generate a report, then open the GitHub feedback page (opens even if the report failed) / open the log folder |
| `files:locate` / `files:relink` | R→M | After an imported file moved: find one file by ID (and replace it in the config if found) / open a dialog for the user to pick where it is now, relinking the rest of the old folder (`{ to, count }`, `{ canceled: true }` or `{ error }`) |
| `files:relocated` / `files:checked` | M→R | Some files changed path `[{ from, to }]` (arrives before the new config) / one round of file checks finished (the settings page re-checks which files are missing) |
| `renderer:ready`, `app:*` | R→M | Ready notification, app control |

---

## 6. Config structure (`src/store.js`, `shared/elements-model.js`)

```js
{
  parallaxMultiplier: 10, smoothness: 0.08, focusDepth: 0.5, blurRadius: 5,   // parallax strength 5 ~ 30 (older configs above 30 read as 30)
  blurRadiusVersion: 2,   // marks the edge smoothing default change from 8 to 5: older configs without it read blurRadius 8 as 5
  autoLaunch, currentImage, depthCacheDir,   // hideDebugPanel was removed with the debug panel; older configs may still contain it, it is ignored
  currentImageCrop: { path, x, y, w, h } | null,   // crop of the current image; stored separately because currentImage must stay a string; ignored when path does not match currentImage
  // currentImage only holds images (v1.1.0 reads the file it points to into base64; a video would hang it). The current video is separate:
  currentVideo: { path, effect: 'none'|'depth'|'pan', sound, imageAtTime } | null,
                // imageAtTime: currentImage when the video was applied. If it no longer matches currentImage, an older version changed
                // the image since, so the image wins (currentVideo is cleared at startup). Rule: resolveCurrent in shared/my-wallpapers.js
  myWallpapers: [{ path, type: 'image'|'video', addedAt, lastUsedAt, thumb, duration, effect?, sound? }],
                // My wallpapers, newest lastUsedAt first; paths only; thumb lives in wallpaper_thumbs/; effect / sound only for videos
  myWallpapersVersion: 1, // migration marker (no default): when missing, the current user image is added to My wallpapers, once
  // myWallpapers entries, currentVideo and unlockAnimation also have crop: { x, y, w, h } as fractions of the original.
  // Entries and currentVideo have no crop key when uncropped; unlockAnimation.crop is null
  theme: 'dark',          // settings window theme 'dark'|'light'|'system' (unknown values read as dark); main process writes it to nativeTheme.themeSource
  vinyl:        { enabled, position, x, y, scale, volume, playing, coverPath,
                  playlist: [{ path, name }], current, playMode: 'list'|'one'|'shuffle'|'once' },
                // older audioPath / audioName / loop become a one-track playlist when the config is read (normalizeVinyl in shared/playlist.js)
                // position: one of the four corners or 'custom' (x / y = platter center as a fraction of the screen); scale 0.5 ~ 2
  weather:      { type, density, speed, parallax },
  videoOverlay: { enabled, presetId, customPath, customName, blendMode, opacity, speed },
  unlockAnimation: { enabled, file, name, thumb, duration, fadeInMs, fadeOutMs, sound },   // times 0 to 3000 ms, default 500 / 700; file / thumb are names in unlock_animation/; enabled reads as false without a video
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
- Storage location: `%APPDATA%/interactive-desktop-wallpaper/` (`config.json`, `cache_index.json`, `depth_cache/`, `custom_elements/`, `unlock_animation/` (unlock animation video and thumbnail), `wallpaper_thumbs/` (My wallpapers thumbnails), `file_ids.json` (file IDs of imported files, see 4.9); when depth maps are moved to another folder there is also an uninstall list `uninstall_extra_files.txt`, see §9 Phase 9).
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
| **Custom element system** | ✅ | Image / GIF / animated webp / apng / mp4 / webm (the two bundled explosions were deleted on 2026-11-13); placement mode (resize, stretch, rotate, flip, free warp); depth occlusion; interval playback; click playback; green-screen keying; recolor |
| Custom stickers | ♻️ Removed | Replaced by custom elements; old config migrates automatically |
| Default wallpaper gallery (`wallpapers/`) | ✅ | |
| Video wallpapers + My wallpapers | ✅ 2026-11-03 | Still / 3D parallax / whole-picture pan, optional sound; My wallpapers keeps the user's own images and videos, see §9 Phase 11 |
| Unlock animation | ✅ 2026-11-05 | Your own video plays full screen after unlocking, with adjustable fades, see §9 Phase 14 |
| Finding moved imported files | ✅ 2026-11-20 | My wallpapers, the playlist and cover, the video effect: moved or renamed on the same drive are found automatically; the rest can be relinked with one click, see 4.9 and §9 Phase 22 |
| Cropping on import | ✅ 2026-11-05 | Your own image wallpapers, video wallpapers and unlock videos can be cropped by hand; the ratio is locked to the screen and cropped-out parts never slide into view, see §9 Phase 16 |
| Settings window / wallpaper page UI | ✅ redesigned 2026-10-26, restyled as a tactical terminal 10-31, redone with the updated skill 11-14 | Six pages in a left nav, unified controls and Lucide icons, live parallax preview; placement mode and Toast share the same style. Current look (11-14): square panels, neutral grays with a cyan accent, a color bar plus a thin frame, serif Chinese page titles with a small English label, see §9 Phase 19; for the dark / light / follow-system theme see Phase 10 |
| Standalone packaged build | ✅ v1 | NSIS installer, see §9 Phase 6 |
| Uninstall | ✅ 2026-10-31 | Settings page "卸载软件…" or Windows Settings → Apps; both let you choose whether to delete data, see §9 Phase 9 |
| Diagnostic report / feedback | ✅ 2026-11-18 | One-click txt report (user name removed) from the settings page and tray, feedback on GitHub; a Chinese prompt when the main process throws; window and GPU process crashes logged, see §9 Phase 20 |
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
9. ~~The fallback mode when injection fails, `moveTop()`, raises the full-screen window above every program~~ ✅ 2026-11-05 The wallpaper now goes behind all programs and stays there, and the settings window shows a notice (see 4.8 and Phase 17)
10. ~~Single-instance lock taken after `whenReady`~~ ✅ If the lock is not obtained, the startup flow is not registered
11. ~~Depth cache keyed only on file size~~ ✅ Now size + modification time (old index entries without a modification time still compare size only)
12. Only the small model is used (user decision). The `modelSize` parameter was removed from `generateDepthMap`.
26. ~~With a 3D parallax video selected, the action bar does not fit the default 960-wide window and "应用壁纸" (Apply wallpaper) ends up outside the window~~ ✅ 2026-11-04 it now wraps to a second row when it does not fit (see Phase 13)

### 🟡 P2
13. ~~Dead code~~ ✅ Cleaned up when `app.js` was split
14. ~~README out of date~~ ✅ Rewritten
15. ~~`hideDebugPanel` defaults to hidden when unset~~ ✅ 2026-11-03 the debug panel was removed entirely (`index.html`, `style.css`, `renderer/main.js`, default config). Reason: on the wallpaper page it was shown by default and only hidden once the main process sent the config, so it flashed in the top-right of the desktop right after launch. Parallax settings are on the settings window's "Parallax" page; the browser preview no longer has the panel either.
16. ~~Weather canvas not scaled for DPR~~ ✅
17. ~~mediump precision~~ ✅ Switched to highp
18. ~~All video assets are in git: `overlay/` is 139MB (`old1.mp4` at 53.7MB triggers a warning when pushed to GitHub). Consider Git LFS if assets keep growing.~~ All video assets were deleted on 2026-11-13, but they are still in the git history, so the repository does not get smaller.
19. ~~`生成深度图.bat` and `requirements.txt` are still written for the torch route~~ ✅ 2026-11-10 the bat is deleted and `requirements.txt` now lists what the venv actually uses (see Phase 5).
22. Depth map post-processing now has two implementations: the app's `src/depth/processing.js` and `generate_depth_map.py` (used by `tools/prepare_wallpapers.py` to generate default wallpaper depth maps). Algorithm changes must be made in both; `test/depth-processing.test.js` has reference data generated by Pillow.
20. Custom elements: placement mode only handles the primary monitor; animated images decode at most 600 frames; no warning when the number of elements grows large.
21. Weather particles are drawn on a separate Canvas 2D layer on top of the whole wallpaper, so they are not occluded by near objects (for "snow falling behind the tree", weather would have to move into the Pixi scene with depth occlusion). The sunlight effect's light source is fixed at the top left and may not match the actual light direction in the wallpaper.
23. The 3D parallax of a video wallpaper uses a single depth map for the whole video (the frame at 30% of the duration): camera moves and large moving objects won't match it and warp a little when moving. Best for fixed-camera videos; whole-picture pan suits other videos.
24. "My wallpapers" does not collapse when it grows past one row, so with many entries the default gallery gets pushed far down (the design left this to implementation; not done in this version).
25. A video wallpaper keeps decoding (also when covered with sound on), so it uses more power than an image wallpaper; more so with 4K video, and there is no transcoding.
27. ~~The fallback mode for a failed injection does not call `setBounds`~~ ✅ 2026-11-05 Measured: it really did stay 1708×1020 in fallback mode. It now fills the screen, just 1 DIP shorter (1708×1066, see Phase 17 for why), so it differs from the placement window by at most 1 pixel.
28. The placement window covers the taskbar, so you can't see where the taskbar is while placing. Anything dragged into the bottom strip of the screen (72 physical pixels high on this computer) ends up behind the taskbar on the desktop. The vinyl player's default bottom-right spot is 36px from the bottom of the screen, which by the work area puts its bottom 13px under the taskbar; that has always been its position on the wallpaper, the old placement window just didn't show it.
29. With a crop, parallax can stretch the four edges of the area a little: content outside the area cannot be used, so edge pixels repeat. The left and right edges of an image already did this; now all four can. At most a dozen or so pixels at the default strength; at strength 30 with the mouse at the screen edge, vertical streaks are visible. This puts "the watermark must not slide in" ahead of clean edges. If it looks too obvious, zoom in a little inside the area instead.
30. The depth map is still generated from the whole image. With a very small crop, less depth map resolution reaches the screen and parallax detail drops a little.
31. The settings preview is wider than the screen, so it shows less than the real desktop (same as before cropping); the crop box is what counts. The no-WebGL preview ignores the crop.
32. A WebM with no duration in its header (for example from the browser's MediaRecorder) has no time slider in the crop box, only a frame near the start. Cropping itself still works.
33. With 360 Total Security running, packaged builds cannot attach to the desktop layer (found 2026-11-05, confirmed). `SetParent` returns 0 with error code 0, so the fallback mode runs (in 1.3.0 and earlier the wallpaper sits above all windows and the mouse passes through it; since Phase 17 it sits behind all programs and the settings window shows a notice, see item 34). 1.3.0 did not cause this: `dist/test-build`, which passed on November 4, fails now too. Controlled runs (development machine, 360 running, fresh data folder, each at least once):

    | Executable | Result |
    |---|---|
    | `electron.exe` (with `.` and with the packaged content) | works |
    | `electron.exe` plus 1 byte at the end | works |
    | `electron.exe` with only the icon changed by rcedit | fails |
    | `electron.exe` with only the version info changed by rcedit | fails |
    | Packaged exe with an ASCII file name | fails |
    | `dist/test-build`, `dist/unlock-test`, `dist/win-unpacked` | all fail |

    So it has nothing to do with the app code or file name, and it is not DPI (both sides are per-monitor v2 with hosting behavior 0; switching to mixed does not help) or signing (`electron.exe` is unsigned too). It only depends on rcedit having rewritten the exe. After the user closed 360, with nothing else changed (the `ZhuDongFangYu` service and 360's drivers were still there), `dist/win-unpacked` and `dist/test-build` both worked at once, which confirms 360 was blocking it. The guess: it recognizes the original `electron.exe` (trailing bytes do not change the PE image) and stops unknown programs from parenting a window to Explorer's desktop window. It only blocks `SetParent`, not `SetWindowPos` (measured in Phase 17). The release notes explain what to do and the settings window shows a notice; adding the app to the trusted list has not been tested. Why it passed on November 4 is unknown; 360's rules or state may have been different then.
34. Limits of the fallback mode (item 33):
    - The desktop icons are covered by the wallpaper: not visible, but still clickable.
    - While "Show desktop" is on, the system raises the desktop above the wallpaper, so you see the original desktop until it is turned off.
    - If a window is restored after being minimized but before the wallpaper is pushed back (1 second at most), it can be covered briefly. This did not happen when "Show desktop" was toggled 2.5 seconds apart.
    - Only measured on this computer's desktop structure (Windows 11, icon layer inside Progman). On Windows 10 and older Windows 11 the icon layer is in a separate WorkerW, so `HWND_BOTTOM` may land below that WorkerW; the wallpaper would then be invisible (without blocking programs). The `[WorkerW] Fallback:` log line says what is directly below the wallpaper.
    - Not tested: restarting Explorer, changing the resolution, multiple monitors.
35. Limits of the diagnostic report (Phase 20):
    - Wallpaper and music file names are not removed (the report reminds the user at the top).
    - "到 GitHub 反馈" (feedback on GitHub) needs a GitHub account and may not load on networks in mainland China, which is why sending the txt directly is still offered.
    - The first report in each run takes about 5 s (collecting full GPU info), up to 15 s on slow computers.
    - Page errors only have the file name and line, no stack (the `console-message` event does not carry one).
    - Useless when the app cannot start at all (before any JS runs); the user then has to send `%APPDATA%\interactive-desktop-wallpaper\logs\main.log` by hand.

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
1. [x] Default wallpaper gallery: `wallpapers/` (17 images, cut down to 2 on 2026-11-13 because of licensing, see Phase 18; with depth maps and thumbnails; `manifest.json` records the Chinese name, source and original file name), a collapsible "Default wallpapers" panel in the settings "Wallpaper management" (collapsed by default; after the UI redesign it became a tiled grid below the "Wallpaper" page). Assets are generated from the originals by `tools/prepare_wallpapers.py`; just rerun it after improving the depth algorithm. The originals folder `default wallpaper/` is untouched and uncommitted and can be deleted; once deleted, an old current-wallpaper path is automatically switched at startup to the same image in the gallery.
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
   - Desktop click detection: the main process reads the left button state every 15ms; a click counts only if press-to-release ≤500ms, movement ≤6px, and the release point is the desktop (root window class Progman / WorkerW). It is only on when there is a visible click-to-play element (or the record player has music, see item 6). Shares `src/win32.js` with full-screen detection.
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

### Phase 8 — Parallax algorithm: ray marching + edge smoothing default 5 (2026-10-30)
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
- Android version synced (2026-10-30): shader, `parallax-math.js`, edge smoothing default 5 and the old-config migration; see §5.2 of the Android `PROJECT_NOTES.md`. Unit tests and the browser preview pass; not yet tested on a real phone (frame rate there needs checking).
- Step 2 (layering with background fill): after seeing the experiment results the user decided not to bring it into the app for now (2026-10-30). If it is wanted later, the middle ground is to generate background layers offline only for the gallery wallpapers and check each one by hand, without shipping the model in the app.

#### Step 2 experiment: foreground/background layers with the hidden background filled in (2026-10-30, experiment only, not in the app)
Based on [3D Photo Inpainting](https://github.com/vt-vl-lab/3d-photo-inpainting) and [SLIDE](https://arxiv.org/abs/2109.01068). The experiment script and comparison images are in `out/layered/` (ignored by .gitignore, not in the repo); the MI-GAN model is `out/models/migan_pipeline_v2.onnx` (26.8 MB, MIT, from the HuggingFace link in MI-GAN's official README, SHA-256 `6f1f3530…c40b`).
- Building the background layer (`out/layered/make_bg_layer.py`, Python + numpy):
  - Area to fill: if pixel p is nearer than a pixel at distance d by Δ, and Δ × the maximum shift (mouse at a screen corner, strength 30) ≥ d, what's behind it can be revealed. Computed on a quarter-size depth map with iterated min filters in 0.1 s. For the horse image that's 8.7% of the area, about 30–40 px on each side of the foreground's depth outline.
  - Background depth: the area to fill gets the depth of "the deepest layer that can be revealed behind it". The first version always used the farthest background, which filled the cheek behind the cat's muzzle with green background.
  - Background color, two ways: smooth fill (push-pull, only borrowing pixels of similar depth); MI-GAN (official ONNX pipeline in 512 tiles; filled per depth band, erasing nearer content first so it doesn't copy the foreground).
- Shader (`out/layered/layered.js`, swaps the background filter in the browser preview): the foreground layer is ray-marched as usual; the more it is stretched at a pixel (mouse shift × depth gradient), the more it is replaced by the background layer (which is ray-marched again with its own depth). With the mouse still the stretch is 0 and the image is pixel-identical to before (measured: 0 differing pixels).
- Results (strength 30, mouse at the left/right screen edge):
  - Textured backgrounds like flowers / grass (white horse): MI-GAN fills the revealed strip with flowers and grass, far more natural than the single layer's wavy streaks; a clear improvement. But it occasionally paints things that aren't there (a white-blue blob above the mane, a few small dark spots), and tiles occasionally leave seams.
  - Smooth fill: the streaks become a blurry yellow-green band that is just as noticeable; not useful.
  - Blurred backgrounds (cat, macaw) and landscapes without clear foreground/background (stone bridge): the single layer shows no visible streaks anyway, so two layers bring no improvement; near the cat's whiskers they add broken whisker fragments and small smudges.
  - This approach doesn't fix cut whiskers (that needs matting; SLIDE uses U2Net + FBA matting).
- Cost: generation time goes from about 1 s to 10 s (MI-GAN without depth bands) or 70 s (with bands, this machine's CPU); the installer gains a 27 MB model; each wallpaper stores an extra background color image and background depth map; the shader ray-marches a second time where it switches to the background layer; the Android version would need to run MI-GAN on the phone.

### ✅ Phase 9 — Uninstall (2026-10-31)
User request: add an uninstall option to the settings page; when uninstalling, let the user choose whether to also delete their own data (everything that didn't ship with the app); uninstalling from Windows "Settings → Apps" should ask too.
- Settings page "设置" (Settings) → "卸载" (Uninstall) → "卸载软件…": the confirmation dialog has an "同时删除我的数据" (Also delete my data) checkbox, unchecked by default → the main process finds `Uninstall 互动3D壁纸.exe` in the install folder, launches it with `--delete-user-data` / `--keep-user-data` (`src/uninstaller.js`) and quits. In the dev build, or when no uninstaller is found, the button is greyed out and the description says why.
- The actual deleting is done by the uninstaller (`build/installer.nsh`, included by electron-builder automatically):
  - A checkbox on the uninstall wizard's welcome page (Simplified Chinese on Simplified systems, Traditional on Traditional systems, English otherwise), pre-checked with the choice passed from the settings page. NSIS's own Simplified Chinese language file calls uninstalling "解除安装".
  - Checked: delete the whole `%APPDATA%\interactive-desktop-wallpaper` folder, plus depth maps stored elsewhere as listed in the uninstall list (only `depth_*.png`; a folder is removed only if it ends up empty). The user's own images, music and cover are only referenced by path and are never deleted. electron-builder's built-in `--delete-app-data` isn't used: with it, data is deleted no matter what the wizard checkbox says.
  - Either way: remove startup entries whose command points into the install folder (`Run` and `StartupApproved\Run`). Electron names the entry `electron.app.互动3D壁纸` and writes the command without quotes; the script matches on the command, not the name. Cancelling the wizard changes nothing, which is why the app doesn't turn off launch-at-startup beforehand.
  - Also fixed electron-builder leaving an empty install folder behind (its `un.onInit` sets the current directory to the install folder, so its `RMDir /r` can't remove that last level).
  - On upgrade (the new installer runs the old uninstaller in the background with `--updated`) none of the above happens.
- Uninstall list `uninstall_extra_files.txt` (in the data folder; UTF-16LE with BOM, one path per line, so NSIS can read Chinese paths): `AppStore` rewrites it whenever it saves the cache index, listing only depth maps outside the data folder, and deletes it when there are none; it is also written once at startup (for users of older versions who moved the folder).
- Verification: `npm test` 176 passing (6 new for the uninstall list, 4 for finding the uninstaller). Tested the packaged build on this machine (backed up the data folder first; afterwards restored the data and the previously installed 1.0.0):
  - Wizard opened the way Windows does it: checkbox unchecked; opened through the settings-page code: pre-checked; cancelling either one left the install, data and startup entries untouched.
  - Install over the existing version (upgrade): data and startup entries kept.
  - Through the debugging port (`--remote-debugging-port`), in the installed app's settings page: turned on launch at startup, ticked delete data, clicked "继续卸载" (Continue) → the app quit and the wizard opened pre-checked → finished the wizard: install, data folder, depth map in the external folder, both startup entries (the app's own and a test one), shortcuts and the uninstall registration were all removed; the extra `keep-me.txt`, `photo.png` and the external folder itself were kept; Steam and other startup entries untouched.
  - Windows path, unchecked → finished the wizard: install folder removed completely, data byte-identical to the backup, startup entry removed.
  - Checked screenshots: checkbox position in the wizard, the settings page "卸载" section, the confirmation dialog.
- Existing bug fixed the same day: when the depth map location was set to a folder that already held other files (e.g. Pictures), "清除缓存" (Clear cache) deleted every file in that folder (and stopped with an error at the first subfolder, leaving the index uncleared), and "更改位置" (Change location) moved every `.png` in it along. Both now only touch `depth_*.png` (depth maps have used that name since the first version); the user's own files and subfolders are left alone. Covered by unit tests (`npm test` 179 passing); only unit-tested, not clicked through in the app.
- Pitfalls hit while testing (will come up again when testing installers):
  - Running the installer from a restricted shell (sandbox) hangs (it can't write to `%LOCALAPPDATA%\Programs` and the error box is on an invisible desktop); run it outside the sandbox.
  - Outside the sandbox, one silent install also stalled at the "is the app running" check (no CPU, no child process); killing it and reinstalling worked. Cause not found; unrelated to this change (the uninstall script hadn't run yet).
  - With 150% display scaling, PowerShell must call `SetProcessDPIAware` before capturing a window or the capture is offset; PowerShell 5.1 garbles Chinese in UTF-8 scripts without a BOM.
  - The local `dist/Interactive3DWallpaper-Setup-1.1.0.exe` is now a test build with the uninstall feature (version unchanged), not the same file as the released v1.1.0. Bump the version before building a release.

### ✅ Phase 10 — UI restyled as a tactical terminal (2026-10-31)
The user asked the assistant to redo the frontend with their own personal skill `ark-style-ui` (based on the "tactical terminal / industrial sci-fi" design language of the Arknights UI). After seeing the screenshots they said "keep it, keep polishing". Design: [docs/superpowers/specs/2026-10-31-tactical-ui-design.md](docs/superpowers/specs/2026-10-31-tactical-ui-design.md).
> 2026-11-14: the appearance rules below (cut corners, frosted glass, grain, monospace numbers, an English label on every heading) were replaced by Phase 19; the UI theme and the bundled-font approach are still in use.
- Appearance only: page structure, class names, page scripts and IPC are the same as the 10-26 redesign, and the variable names in `tokens.css` did not change (only their values), so `style.css` did not need rewriting.
- Rules: cards cut at the top-left and bottom-right corners, buttons cut only at the bottom-right, no rounded corners (except the record itself and the round rotate handle); Chinese headings in Noto Serif SC next to small uppercase English labels in wide Saira (`.en`, only meaningful words: module names, weather names, eyebrows); numbers and paths in a monospace font; the sky-blue accent only for primary buttons, selected states, toggles and values; yellow only in the hazard stripe at the top of the uninstall dialog; a very faint noise texture on cards and primary buttons.
- Settings window: two-line (Chinese / English) sidebar items with an accent bar on the selected one; group headings followed by a thin rule to the right, counts as boxed monospace numbers; segmented buttons invert the selected item; vertical-bar slider thumbs; status tags with a colored left bar; segmented progress bar; L-shaped corner brackets around the preview and the wallpaper name in large serif type; selected weather tile gets an accent triangle in its top-right corner; the toast is an inverted bar; the uninstall dialog is a cut-corner frosted panel.
- Wallpaper page overlays (placement hint, toolbar, toast, loading, debug panel): `.glass` became a cut-corner frosted panel (blur on a pseudo-element; the panel itself must not get filter / opacity / isolation or the blur cannot see the wallpaper, and no box-shadow, because a rectangular shadow shows a bright triangle at the cut corners); loading is a rotating diamond; the toast has an accent bar on the left; scale / stretch handles are squares, warp points became amber diamonds, the rotate handle stays a round dot (the hint text calls it a "dot"); the toolbar's confirm button is an accent button cut at the bottom-right. The vinyl widget, weather and elements themselves look the same.
- Interface theme (new feature): first row of the "设置" page, "界面主题": dark (default) / light / follow system, saved as `theme`. The main process `applyTheme` writes it to `nativeTheme.themeSource` and the settings page follows `prefers-color-scheme`; the system button strip (`titleBarOverlay`) and the window background follow in `nativeTheme`'s `updated` event (`updateSettingsChrome`). The wallpaper page hard-codes `data-theme="dark"` on `<html>`, so the placement toolbar always stays dark.
- Fonts: `ui/fonts/` bundles Noto Serif SC (`@fontsource-variable/noto-serif-sc` 5.3.1, variable weight, 101 slices loaded on demand), the width-axis Saira and JetBrains Mono (Fontsource), about 6.3MB in total, with three OFL licenses in the same folder. Noto Sans SC for body text is not bundled (too large); machines without it use Microsoft YaHei.
- Verified: in Electron (real config copied into a separate data directory, screenshots over the debug port) the six pages, the elements page with elements, the help popup, the uninstall dialog, the toast, the gallery's selected state, dark / light, and the 820×560 minimum window (no horizontal scrollbar); when switching themes, a real screen capture showed the system button strip changing color too while the wallpaper window stayed dark, and follow-system read this machine's dark setting; the bundled serif font really loads. In the browser preview: placement mode, loading, debug panel, toast, with no console errors. `npm test`: all 180 pass (new test for the theme default).
- Not tested: a machine without Noto fonts; actually dragging an element in Electron's placement window (only looked at it in the browser preview); the packaged installer (the fonts are under `ui/**/*`, so they should be included).

### ✅ Phase 11 — Video wallpapers + My wallpapers (2026-11-03, built on the `feature/video-wallpaper` branch, then merged into main)
The user wanted to set a video directly as the wallpaper (previously videos could only be added as "elements"). Design: [docs/superpowers/specs/2026-11-02-video-wallpaper-design.md](docs/superpowers/specs/2026-11-02-video-wallpaper-design.md); plan: [docs/superpowers/plans/2026-11-03-video-wallpaper.md](docs/superpowers/plans/2026-11-03-video-wallpaper.md).
- Positioning: a standalone addition whose point is "use a video as the wallpaper"; the mouse-following effects are an extra experiment. Each video has three effects: still (default), 3D parallax, whole-picture pan; the sound switch defaults to off. Effect and sound are saved to the video's record immediately but only reach the desktop after "Apply wallpaper".
- Entry point (chosen by the user after five mockups): "My wallpapers" on the Wallpaper page is always shown, its first tile is "Choose from computer… / image or video", followed by the user's own images and videos (most recently used first, videos show ▶ duration, hover × removes from the list without deleting the file; missing files show "file not found"). The default gallery no longer has an add tile.
- Sound continues while covered by a window (the user's call): the existing fullscreen detection also counts maximized windows, so pauses carry a reason and the video keeps playing only when "covered + sound on"; lock, sleep and placement stop it. Same as the vinyl player.
- Config shared with older versions: `currentImage` only holds images, the video goes in `currentVideo` (with `imageAtTime`); if an older version changed the image since, the image wins. Dev and installed builds have different gallery paths, so `imageAtTime` is migrated together with `currentImage`. The first-run default wallpaper is only set when there is no current video either.
- Decided during implementation (left open by the design): 3D parallax uses the frame at 30% of the duration (no multi-frame composite); the maximum pan offset equals the parallax strength, with the picture zoomed by `panCover`; My wallpapers does not collapse; with still / pan the placement window hides "auto" and leaves depth alone; a 3D-parallax video without a depth map (e.g. after clearing the cache) plays as still.
- Found and fixed during testing: when switching videos quickly, a slow older request finished last and overrode the newer one (added the latest-only serial queue `createLatestQueue`); destroying a video cleared `src`, which fired an error and logged a spurious "playback error"; the My wallpapers add tile sat 15px lower than the other tiles.
- Verification: `npm test` 200 passing (new: 9 for My wallpapers logic, 3 for pan, 5 for storage, 1 for the pause rule, 2 for the serial queue). Electron tests (separate data directory + debug port; the file dialog was temporarily replaced in the main process to return a chosen file): screenshots of the three effects; an idle video wallpaper redraws at the video frame rate (30/s) while the ticker stays stopped; a video with sound keeps playing while covered and stops during placement; 10 quick switches leave one video alive and the last one wins; switching back to an image frees the video and image frame-stopping still works; element movement and occlusion under the three effects; weather / video overlay / vinyl on top; mp4, webm, a path with Chinese, spaces, # and %; an audio-only mp4 and a renamed text file are rejected; a 3D-parallax video plays as still after clearing the cache; a deleted file shows a notice on restart; the preview video pauses on page switch and minimize; My wallpapers add / remove / file not found / kept across restarts / old-config migration; parallax page notes; no horizontal scroll at 820×560; browser preview without errors.
- Fixed after the whole-branch review (2026-11-03): (1) on wake and unlock, powerMonitor passes Electron's event object as the first argument, which used to be forwarded straight into IPC and fails to serialize (image wallpapers affected too); (2) fullscreen detection keeps running while locked, so `covered` could override the lock and a video with sound could play on the lock screen. The main process now tracks placement / lock-or-sleep / covered separately and `nextWallpaperSignal` in `shared/frame-pacing.js` combines them into one pause reason (unit-tested over event orders); a reloaded wallpaper page gets the current state again; (3) "My wallpapers" re-rendered and re-checked every file on every config broadcast (several times a second while dragging a slider; slow on an offline network drive), now it only re-renders when the list or the current wallpaper changes. Tested after the fix: simulated lock → sleep and wake while locked does not resume → unlock resumes; a maximized window opened while locked sends nothing, after unlock it becomes `covered` (silently), closing the window resumes.
- Not tested: a real lock / sleep (events simulated through the main-process debug port; the maximized window was real); real audible sound (the test videos had no audio track, only checked unmuted and playing); the tray "Change wallpaper" (needs the native dialog); the packaged installer; power use on integrated graphics.

### ✅ Phase 12 — The app no longer launches PowerShell (2026-11-04)

User report: on another computer (Windows Enterprise 25H2, 150% scaling) the wallpaper became a separate window that covered the desktop icons and vanished after clicking "Show desktop". Neither the dev version nor the packaged 1.1.0 reproduced it on the dev machine, so `tools/desktop-diagnose.bat` was written (double-click to collect system info, the desktop window hierarchy, the before/after of "Show desktop", and the log into one txt on the Desktop; read-only) and run on that computer.

- Symptom: the wallpaper window was top-level (`parent` is the desktop root) with `WS_EX_TRANSPARENT`, which is the fallback mode after a failed injection; the WorkerW had no children.
- Root cause: the app could not launch `powershell.exe` (`spawn EPERM` / `spawn UNKNOWN`), so not one line of the injection script ran. The full-screen and desktop click helpers failed along with it.
- Timeline: on 10-31 at 14:07:19 both helpers exited within 74ms while the app kept running (not a shutdown), and every PowerShell launch failed after that, across restarts, a reinstall and 4 days. The diagnostic `.bat` could launch PowerShell normally, so only this app launching PowerShell was blocked.
- Not introduced by 1.1.0: 1.1.0 ran fine on that computer for over an hour (from 10-31 13:05 audio loaded every three to four minutes, which is playlist auto-advance; 1.0.0 only had single-track loop), and the injection code is identical in both versions. The user felt 1.0.0 was fine because the block happened to start right after upgrading.
- What blocked it is unconfirmed: blocking only a specific program from launching PowerShell looks most like security software, and hidden PowerShell with `-ExecutionPolicy Bypass` polling `GetAsyncKeyState` does look like malware. The fix does not depend on which product it was.

The fix:
- New `src/win32.js` uses `koffi` (3.3.6, pinned) to call user32 directly in the main process; injection, full-screen detection and desktop click detection are all in-process now, `src/ps-helper.js` is gone, and the app no longer launches PowerShell at runtime. Injection went from 3-4 seconds to about 0.4 seconds.
- Calls that send messages to windows (SetParent, SendMessage, RedrawWindow, etc.) go through koffi's `.async`, run on a worker thread with a time limit, so a hung explorer does not hang the main process and the main thread can still handle messages sent to the wallpaper window. Read-only calls are synchronous.
- Removed `restoreFromWallpaperLayer`: on quit the window simply closes. The old PowerShell took over a second to start, by which time the window was already gone, so it never did anything; running it immediately would make the wallpaper flash as a top-level window.
- The 6-pixel desktop click limit now scales with system DPI: the old helper was DPI-unaware and read scaled coordinates, while the main process reads physical pixels.
- Packaging: `asarUnpack` now includes `node_modules/@koromix/koffi-win32-x64/**`.

Verification: `npm test` all 230 passing (14 new for injection, 9 for desktop clicks, full-screen tests moved to a fake win32 interface). On the dev machine a shim made launching `powershell.exe` throw EPERM: the old code logged exactly what that computer logged; the new code made 0 launch attempts, attached the window under WorkerW, kept the wallpaper with icons on top after "Show desktop", and paused and resumed full-screen detection correctly. Desktop click detection was tested with a real mouse click, and quitting through the tray menu (exit code 0). The packaged build in `dist/test-build` was run with a fresh data folder: `koffi.node` is outside the asar, no child processes other than the app's own, and "Show desktop" works.

The user installed the test installer `Interactive3DWallpaper-Setup-1.1.1-test.exe` (same code as this commit; the version is only overridden at build time) on the affected computer and confirmed it works (2026-11-04).

Limitation: if injection really fails (say Windows changes the desktop structure again) it still falls back to the mode where the wallpaper covers the icons.

Phases 8 to 12 together become the **v1.2.0** release (2026-11-04): the `package.json` version is now 1.2.0 (it has new features such as video wallpapers, so it is not 1.1.1), `npm test` all 230 passing; after packaging, `app.asar` was extracted and compared with the source with no differences, and compared with the test build the user tried on the affected computer only `package.json` differs; `dist/win-unpacked` was run with a fresh data folder: injection succeeded, no child processes other than the app's own.

### ✅ Phase 13 — Default wallpapers visible without scrolling (2026-11-04)

User feedback: when the settings window opens, the "默认壁纸" (Default wallpapers) title sits just below the bottom edge (at 960×660 it starts at 661px), so you cannot tell the default wallpapers exist without scrolling. Making the window taller (960×840) was tried first, but the user found the proportions ugly, so the window went back to 960×660 and the proportions inside the page changed instead.

- Preview: still 16:7.4, but capped at `100vh - 400px` (at least 180px), so in the default window it goes from 318 to 260. The preview grows with the window, and the first row always stays in view. `#preview-slot-wallpaper` needs `width: 100%`, otherwise `aspect-ratio` shrinks the width along with `max-height`.
- Thumbnails (Wallpaper page only): minimum width 124 → 100px, so the default window shows 6 per row instead of 5, and cards go from 106 to 92 high. "从电脑选择…" (Choose from computer) stays in the first slot (the user's decision in Phase 11); its icon and spacing are slightly smaller.
- Spacing (Wallpaper page only): page top 26 → 18, action bar vertical padding 12 → 8 and top margin 18 → 12, between groups 34 → 18, under group titles 14 → 10.
- In "我的壁纸" (My wallpapers) the "使用中" (In use) chip moves 30px instead of 34px on hover to clear the ×, otherwise it sticks out past the left edge of the smaller card.

Verification: measured in Electron (separate data folder + debug port) at 960×660: the title is at 531–550 and the first row of 6 at 560–653, the same with a fresh config and with 4 entries in My wallpapers, and no horizontal scroll. Other sizes (viewport emulation): the first row is complete at 1100×760 (7 per row) and 1707×1019 (13 per row); at the 820×560 minimum the preview is 180 high, most of the first row's thumbnails show, and there is no horizontal scroll. The Parallax page preview is still 16:6. `npm test`: all 230 pass.

Limitation: once My wallpapers wraps to a second row (more than 5 entries), the default wallpapers are pushed out of view (see §8 item 24).

An older problem found during testing (present since video wallpapers were added): with a video set to 3D parallax selected, the action bar does not fit on one row, and it used to wrap only below 900px, so in the default 960-wide window "生成深度图" (Generate depth map) was cut off, "应用壁纸" (Apply wallpaper) ended up outside the window, and the status text overlapped "边缘平滑" (Edge smoothing). That state now has a `video-depth` class (`settings/wallpaper-page.js`) and wraps when it does not fit: effect, sound and depth map status on the first row, edge smoothing and the buttons on the second, with the buttons on the right. Images and the "不动" (Still) and "整体平移" (Pan) effects stay on one row.

Verification: in Electron, went through selecting a video → switching the three effects → clicking "生成深度图" → clicking "应用壁纸" (the toast confirmed it and `currentVideo` was written to `config.json`) → switching back to an image. The center points of both buttons are clickable, nothing extends past the action bar, and the status text no longer overlaps. The bar is 85 high on two rows, and in the default window 62 of the 66px of the first row's thumbnails show. It wraps at 820×560, 1100×760 and 1300×760, and stays on one row at 1707×1019 where there is enough width, with no horizontal scroll at any size. No errors in the main process log. `npm test`: all 230 pass.

### ✅ Phase 14 — Unlock animation (2026-11-05, on the `feat/unlock-animation` branch)
Design: `docs/superpowers/specs/2026-11-05-unlock-animation-design.md`, plan: `docs/superpowers/plans/2026-11-05-unlock-animation.md`.

- Decided by the user: unlock only (at the first login after a restart the app is not running yet, so nothing plays), fully covers the taskbar, adjustable fades.
- A throwaway experiment came before the design (real lock and unlock): creating the window after the unlock shows the desktop first (first frame after 271 ms); preparing it at lock time does not flash (37 to 44 ms); turning off `CalculateNativeWinOcclusion` adds nothing; the window needs `setBounds` to cover the taskbar; unlocking after a 25-second sleep also works.
- No existing project turned up on GitHub. The closest, AutoBloom, only plays at login.
- Fixed after code review: (1) the vinyl player never stops on lock, so it overlapped the animation sound; its volume now fades to 0 (volume only, playback state untouched, and music keeps playing when the animation is muted); (2) the wallpaper stayed paused when the unlock event was lost; (3) the animation played when unlocking by connecting over Remote Desktop; (4) the animation sound did not fade with the window; (5) the fade-out got a timer fallback so a system clock jump cannot hold it.
- Found in real testing: (1) clicking did nothing. Synthetic `sendInputEvent` cannot show this; it takes an OS-level click (`mouse_event`). The window answers `WM_MOUSEACTIVATE` with 4 (no activate, eat). Normally clicks land on the Chromium child window and are fine; when that child is hidden `mousedown` is swallowed and only `mouseup` arrives, so skipping now listens for the release. Hiding the child by hand reproduces it reliably; that this is what happens on a real unlock is inferred, and it tested fine after the change. (2) The taskbar sits on top of the full-screen window when it is the foreground window; `moveTop()` at unlock fixes it.
- Passed real testing by the user (2026-11-05): Win+L unlock, unlock after closing the lid or sleeping, skipping with Esc and with a click, clicking the taskbar before locking, fades of 0 and 3 seconds, sound with the vinyl player playing. The fallback check read `locked` on every lock.
- Not tested: PIN, fingerprint and face unlock; external monitors; exclusive full-screen games; the installed build got no real lock test (win-unpacked was tested with simulated events).
- Known small issues (noted in review, not fixed): locking again mid-animation resumes the wallpaper and pauses it again, so a video wallpaper with sound may blip; hand-edited config turns `true` or arrays into valid but non-default values, and `duration` has no upper limit; if the player page fails to load, the screen stays black for 3 seconds after unlocking; only `createWindow` has a try/catch.

### ✅ Phase 15 — The placement window fills the whole screen (2026-11-05)

While experimenting with the unlock animation we found that the size passed to the `BrowserWindow` constructor gets clipped to the work area (the screen minus the taskbar). The placement window was created this way, and measuring confirmed it was too short; the wallpaper fills the whole screen because `nudgeWallpaperRepaint` calls `setBounds` after injection. Element and vinyl player positions are stored as fractions of the window size, so the same fraction landed in different places in the two windows, and the background was cropped differently too (a different `cover`).

Fix: new `src/elements/placement-window.js`; `createFullScreenWindow` calls `setBounds` right after creating the window, before the page loads, so the first layout is already full-screen. `createPlacementWindow` now uses it. `resizable: false` does not affect `setBounds`.

Measured (2560×1600, 150% scaling, taskbar at the bottom; real app + separate data directory + debugging port, dragging with real mouse events and confirming):

| | Before | After |
|---|---|---|
| Wallpaper page size | 1708×1068 | 1708×1068 |
| Placement window page size | 1708×1020 | 1708×1068 |
| Placement window `cover.scaleY` (wallpaper: 0.93794) | 0.89578 | 0.93794 |
| Element dragged to 85% of the window height: lower on the wallpaper than when placed | 61 physical pixels | 0.02 |
| The same element's offset relative to the background | about 25 physical pixels | 0 |
| Vinyl player dragged to a custom position: lower on the wallpaper than when placed | 51 physical pixels | 0 |
| Bottom edge of the vinyl player's default bottom-right spot (wallpaper: 1032) | 984 | 1032 |

The offset depends on position: relative to the screen it grows toward the bottom, reaching about 72 physical pixels at the bottom edge; relative to the background it is largest at the top and bottom (about 36 physical pixels on this 3840×2560 wallpaper) and zero in the middle. Checked against screenshots of the wallpaper and the placement window: the top edge of the element's box was 41 DIP off before and lines up after; the vinyl player's position in the wallpaper screenshot matches what the saved fractions give.

- No migration needed: things placed earlier stay where they are on the wallpaper. The placement window just shows them where they really are now (they used to look too high).
- Fullscreen detection is unaffected: this window already covered 95.7% of the screen, above the 90% threshold, and `ignorePid` excludes this app anyway.
- The placement window now covers the taskbar (`WindowFromPoint` on the taskbar strip returns the placement window), see §8 item 28.

`npm test`: all 233 pass (3 new, using a fake window that clips to the work area, with the taskbar at the bottom and at the top). Not measured: a real window with the taskbar at the top or left, other resolutions and scaling, the packaged installer.

### ✅ Phase 16 — Cropping on import (2026-11-05)

Design: [docs/superpowers/specs/2026-11-05-import-crop-design.md](docs/superpowers/specs/2026-11-05-import-crop-design.md), plan: [docs/superpowers/plans/2026-11-05-import-crop.md](docs/superpowers/plans/2026-11-05-import-crop.md). How it works: see 4.7.

Why: images from the web often have a watermark in a corner. Cropping in another program means knowing the screen ratio, and the app would crop again anyway. The crop window was chosen after trying two draggable mockups: a dialog in the settings window, not a full-screen drag.

Measured (2560×1600, 150% scaling; real app, separate data folder, debug port, real mouse events. The test image has a solid magenta block in the bottom right as the watermark, counted from the pixels the shader outputs; parallax strength 30, mouse at the four corners and four edges, worst case):

| Case | Watermark pixels on screen |
|---|---|
| Image, no crop (control) | 10991 |
| Image, bottom of the box right against the watermark | 0 |
| Same box, sampling limit put back to the whole image (control: only the Cover mapping changed) | 6030 to 14610 |
| Video, no crop (control) | 45672 |
| Video, box right against the watermark, still / pan | 0 |
| Video, 3D parallax (box some distance from the watermark) | 0 |
| Unlock preview, no crop (control, screenshot of the full-screen window) | 45195 |
| Unlock preview, cropped | 0 |

Also measured: Cancel and Esc leave the list unchanged; the video time slider; importing the same file again opens the box at its old crop; reset to default; cropping the wallpaper in use updates the desktop at once, the thumbnail gets a new file and the old one is deleted; the placement window's `cover` matches the wallpaper exactly; the element shader gets the crop area; the crop survives a restart; a default wallpaper keeps the original `cover` formula, zoom 1 and bounds 0.001 to 0.999; with all crop data in the config corrupted the app starts normally and treats it as uncropped.

Found and fixed while measuring: removing the wallpaper in use from My wallpapers and pressing "Apply wallpaper" again lost the crop, and the watermark came back. `withCrop` only looked at the list; now it falls back to the current wallpaper.

The shaders and `parallax-math.js` only gained the crop; the parallax algorithm did not change, so the Android version does not need to follow.

`npm test`: all 357 pass (44 new). Not measured: a real lock and unlock (the preview uses the same window and page), the real system file dialog (replaced via `dialog.showOpenDialog` in the test; everything after it is real), a copy installed by the installer, actually changing displays (ratio changes only have unit tests).

Phases 13 to 16 and the never-published v1.2.0 (Phases 8 to 12) were built together as **v1.3.0** (2026-11-05), which only ever existed as a draft and was not made public (see the end of Phase 17). `package.json` is now 1.3.0 and all 357 `npm test` tests pass; `app.asar` matches the source; `dist/win-unpacked` with a fresh data folder: crop on import, depth generation with the packaged ONNX, apply and the unlock preview all work, with 0 watermark pixels. With 360 running, packaged builds do not attach to the desktop layer; with 360 closed they do, see §8 item 33.

### ✅ Phase 17 — No longer blocking programs when the wallpaper cannot attach to the desktop (2026-11-05)

With 360 running, packaged builds cannot attach to the desktop layer (§8 item 33). The old fallback mode, `moveTop()`, put the wallpaper above every program: the mouse passed through it, but the windows below could not be seen.

Research: the packaged build really running in fallback mode, calling `SetWindowPos` in its main process through `--inspect`, with a plain Electron app as the "other windows".
- 360 does not block `SetWindowPos`. `HWND_BOTTOM` works: the window lands right above Progman and does not end up behind the desktop.
- Activating, creating, maximizing and closing other windows leaves the Z order alone.
- But pushing it down once is not enough. Three situations blocked programs in real testing:
  1. Minimized windows sink to just above Progman, which is below the wallpaper. "Show desktop" restores them without activating them, so they all stayed covered (confirmed by screenshot). Now it checks once a second what is directly below the wallpaper and pushes it back unless that is a desktop window. While "Show desktop" is on, Progman is raised and the wallpaper lands at the true bottom, so when it is turned off all windows are above the wallpaper, with no flash.
  2. When a file dialog's parent is the wallpaper (changing the wallpaper from the tray with the settings window closed), the system raises the wallpaper along with it, and it stays up after the dialog closes. Now `dialogParent()` passes no parent in fallback mode.
  3. The settings window and the wallpaper share a thread. With the settings window in the foreground and no other window behind it, the system treats the screen-filling wallpaper as a full-screen program: `SHQueryUserNotificationState` becomes `QUNS_BUSY`, and the taskbar stops being topmost and sinks below the wallpaper. A window 1 DIP shorter than the screen does not count as full screen (controlled run: same steps, 2 became 5 and the taskbar stayed topmost). The taskbar usually covers that bottom strip anyway.
- Also found: the `WS_CHILD` added by the retry stayed on the top-level window after a failed injection (style `0x54000000`). The original style is now restored on failure.

Changes: `src/win32.js` gains `getWindowBelow` and `sendToBottom`; `src/wallpaper-native.js` gains `showBehindOtherWindows` (see 4.8); `main.js` drops `moveTop()` and gains `dialogParent()` and `app:isOnDesktopLayer`; a notice at the top of the settings content area is visible on every page. It says a security program may have blocked this step, that the computer and files are not affected, and how to recover.

Verification: all 371 `npm test` tests pass (14 new). `dist/win-unpacked` with 360 running (fresh data folder, without the flags that turn off occlusion detection, packaged content compared with the source and identical):
- Startup: sampling every 5 ms, about 2300 samples over two runs, the wallpaper never covered another window. The window is 1708×1066 with style `0x14000000`, no `WS_CHILD`. The settings window shows the notice, other pages lay out normally, and the notice is still there after closing and reopening the window.
- Activating other windows and the settings window with real mouse clicks on the title bar, creating, maximizing, restoring after minimizing without activating, closing: the wallpaper stayed right above Progman with all visible windows above it.
- Minimize all: the wallpaper fills the screen with the taskbar above it; `WindowFromPoint` returns Progman (the mouse passes through); clicking the desktop does not change the Z order.
- Toggling "Show desktop": the Z order is already right 0.3 seconds after turning it off.
- Opening a file dialog with the settings window closed no longer raises the wallpaper.
- While covered by windows, the wallpaper page's `visibilityState` is `hidden`: Chromium stops rendering by itself and resumes when it is exposed. This only happens in fallback mode, where the wallpaper is a top-level window.

Development build (`electron.exe`, not blocked by 360): injection succeeds and no notice is shown.

After the user closed 360 from the tray (the `ZhuDongFangYu` service was still running), same packaged build, fresh data folder: the window attached under WorkerW (whose parent is Progman), `app:isOnDesktopLayer` returned `true`, no notice was shown (confirmed by screenshot), the window was 1708×1068, the file dialog opened and closed normally with the settings window closed, and the log had 0 errors.

Not tested: whether the trusted list helps (360's settings are left alone); see §8 item 34 for the rest.

Phase 17 ships as **v1.3.1** (2026-11-05). The v1.3.0 draft was never made public and is skipped like v1.2.0, so v1.3.1 is the first public release since v1.1.0: its notes cover everything since then, and the 360 section describes the new behaviour. `package.json` is now 1.3.1 and all 371 `npm test` tests pass. Extracting `app.asar` and comparing it with the source shows only `package.json` differs, which electron-builder rewrites. Running `dist/win-unpacked` with a fresh data folder and 360 on, the version, fallback mode, notice and Z order are all right.

This build was made in a worktree (`npm ci` first, then `depth_anything_v2_small_ir9.onnx` copied in). Compared file by file with the previous build in the main folder: apart from the code above, only line endings differ. `resources/app-update.yml` is gone because a worktree's `.git` is a file, so electron-builder cannot find the repository address; the app has no auto-updater and does not use it. `app.asar` also holds 940KB of unreferenced `node_modules` content (Pixi's license, `punycode` and other open-source code, written twice by electron-builder), which has no effect at runtime.

### ✅ Phase 18 — Deleted built-in assets with unclear licensing (2026-11-13)
Background: the user noticed that the image sites' licenses do not allow their images to be used in wallpaper software. A photo-by-photo check (see "Public distribution notes" in §9) found only 2 of the 17 default wallpapers are CC0, and the sources of the 10 bundled videos could not be traced. The user decided to delete the non-compliant wallpapers and all the videos, and not add replacements for now.

Default wallpapers:
- [x] Deleted 15 images from `wallpapers/` along with their depth maps and thumbnails; `manifest.json` now lists only 雪山镜湖 (snowy peaks over a lake) and 银河 (Milky Way). A new user's first launch defaults to 雪山镜湖.
- [x] After an upgrade, if the current wallpaper is one of the deleted ones (the file is gone), startup switches it to the first gallery image instead of falling back to `background.png` with a "file not found" notice. The deleted file names are listed in `REMOVED_FILES` in `src/gallery.js`; this only applies under a `wallpapers` folder and only when the file is gone, so same-named images in the user's own folders are unaffected.
- [x] `tools/prepare_wallpapers.py` already works from the manifest and needed no change; only the example ids in its usage text were updated.

Videos:
- [x] Deleted the 8 video effects in `overlay/` (light rain, heavy rain, three snow effects, old film grain, projector scratches, vintage light leaks) and the two explosions in `elements/` (original videos, `*_cut.mp4`, thumbnails). The `overlay/` folder is gone, so it was removed from `extraResources` in `package.json`; `elements/manifest.json` stays with an empty list, for adding assets later with `tools/prepare_builtin_element.py`.
- [x] The main process `overlay:getPresets` returns an empty list (a comment explains how to add presets back). Video effects now only offer "Your own video": the `videoOverlay.presetId` default changed from `snow2` to `custom`; the settings page hides the whole preset area when there are no presets, and turning the switch on without an imported video prompts the user to import one first.
- [x] `renderer/video-overlay.js` no longer falls back to `snow2` when a preset is missing (that would now be `undefined`, and the old code would throw); it treats it as having nothing to play. `_applyPlaybackProps` and `resume` handle this case too.
- [x] Upgrading users: `cleanupRemovedBuiltins` in `src/removed-assets.js` checks the config at startup. If the video effect uses a deleted preset, it switches to the user's own video if one was imported, otherwise it turns the video effect off. Elements placed on the wallpaper from `builtin:bomb1` / `builtin:bomb2` are removed, so the list doesn't keep "asset missing" entries.
- [x] `dev/dev-config.json` (the fake config for the browser preview) no longer has the explosion element; the placement draft uses the sample GIF instead.

Verification: all 377 `npm test` tests pass. Ran the dev build with fresh data directories:
- For a new user the gallery shows 2 images and the current wallpaper is 雪山镜湖.
- With the deleted `wallpapers/lake-forest.jpg` written into the config beforehand, startup switched it to 雪山镜湖, and the log shows no fallback to `background.png`.
- With `snow2` turned on and a `builtin:bomb1` element placed in the config beforehand: after startup the video effect is `custom` and off, and the element is gone; the effects page hides the preset area (`display: none`), and the elements page shows only "Add asset"; in the wallpaper window, turning the video effect on, pausing, resuming, changing the opacity and switching to a missing preset all ran without errors and set no video source.

Not done: the git history still contains the deleted images and videos (so do the "Source code" archives of the old tags on GitHub); no replacement assets were added. The v1.3.1 and earlier installers were taken down from GitHub Releases on 2026-11-19 (see "Public distribution notes" in §9).

### ✅ Phase 19 — UI redone with the updated ark-style-ui (2026-11-14)
The user updated their own skill `ark-style-ui` (it now follows the in-game and official-site colors collected by PRTS Design) and asked the assistant to improve the UI with the new version. It differs a lot from the version used in Phase 10: every box is square, with no cut corners, frosted glass, glow, stacked shadows or grain; black, white and gray carry the content, and cyan is only for selected states, primary actions and accent bars; small English labels are decoration and must not be attached to every heading. The appearance rules in the Phase 10 design doc no longer apply.
- Appearance only: page structure, page scripts and IPC did not change. Three class names changed: the cut-corner frame `.cf` → `.panel`, the frosted panel `.glass` → `.float`, the dialog `.confirm` → `.dlg`.
- Colors (`ui/tokens.css`): variable names are kept, values now come from the skill. Dark is neutral gray (background `#0f0f10`, panels `#1a1b1c`, controls `#232425`) with cyan `#18d1ff`; light is near-white with blue `#0075a9`. Added `--inv` (inverted block), `--hover`, `--stripe`, `--halftone`, `--danger-solid`, `--bar` / `--bar-lg` (bar widths 4px / 8px); removed `--grain`, `--cut` and the like. The system-button strip and window background in the main process (`settingsChromeColors`) were updated to match.
- Shape and hierarchy: a panel is a solid fill plus a 1px frame. Emphasis uses only four devices: a color bar on the left, black/white inversion, a small triangle in the top-left corner (selected), and a solid accent fill. Shadows are only for things that float (dialogs, the toast, the help popover, toolbars over the wallpaper). The color bar and the thin frame are joined at right angles with `border-image` (writing `border-left: 4px` plus `border: 1px` directly makes the browser miter a small diagonal at the corners).
- Buttons: `.contrast` is black/white inverted, for "Apply wallpaper", "OK" in the crop dialog and "Confirm" on the placement toolbar; `.primary` is a solid accent fill, one per area ("Add asset", "Preview" on the unlock page, play on the vinyl page); `.danger` is deep red with white text ("Clear…", "Uninstall…", "Continue uninstall"); disabled buttons are dimmed and no longer striped.
- Text: a page title has an 8px bar on the left, 24px serif and one small English label; a group title has a 4px bar and 15px sans. The English labels on the nav, group titles and weather buttons were removed; they remain in four places only: the title bar, page titles, the vinyl card and the uninstall dialog. English labels are gray (cyan would read as clickable). Numbers and paths moved from JetBrains Mono to Saira; JetBrains Mono and its license were deleted from `ui/fonts/`.
- How things look: the selected nav item has a bar on the left and a lighter background; the selected segment is a solid accent fill (it used to be inverted); status tags are a tinted background, same-color text and a small square dot (an icon replaces the dot when there is one); selected thumbnails and weather buttons get an accent frame and a top-left triangle; the playlist and the element list are one card with one row each, separated by thin lines; the toast is a panel with a bar on the left (cyan normally, green for success, red for errors); dialogs have three parts (header / body / footer) and a solid translucent backdrop; the uninstall dialog's header and the "wallpaper could not attach to the desktop" notice have yellow-black caution stripes on the left; the right half of the vinyl card has halftone dots; the loading hint is a diamond ripple.
- Things drawn over images (the hint, the mode switch and the tags on the preview, "In use" and duration on thumbnails, the crop box) always use the dark-theme colors on a solid dark fill and do not follow the theme.
- Where the skill was not followed (the assistant's call, not yet confirmed by the user): (1) Spacing. The skill is written for web pages (72px between sections, 14px body text); the settings window is only 960×660 by default and the wallpaper page has to fit the preview, My wallpapers and the first row of default wallpapers on one screen (Phase 13), so the old density is kept: 13px body text, 32 / 28px buttons, 34px between groups; line height is now 1.7. (2) The English display font Montserrat was not added: the settings window has no large English title to use it on. (3) The vinyl widget on the desktop, the weather and the elements themselves are unchanged; the rotate handle is still a round dot and the free-transform points are still diamonds (to tell them apart from the square scale handles).
- Found during implementation: in Electron 28 (Chromium 120) `::backdrop` cannot read variables set on `:root`, so the backdrop color has to be written literally, otherwise it is transparent (with the old frosted backdrop only the blur was actually working); the crop stage width used to be computed from the dialog's padding, and now that the padding is on the dialog body, `fitStage` computes it from the stage's parent; the emoji was removed from the title of the init-failure message.
- Verification: all 377 `npm test` tests pass. Real Electron run (real config copied into a separate data directory, screenshots through the debugging port): in dark, the six pages, the preview with a wallpaper selected, the help popover, the uninstall dialog, the crop dialog (file dialog replaced in the main process to return a given file), a full "place → confirm" run after importing the sample GIF, and the adjust panel on the elements page; in light, the wallpaper, effects and vinyl pages and the uninstall dialog; the Toast and loading hint in the wallpaper window; no horizontal scrolling at 820×560; at the default size the first row of default wallpapers fits on one screen including the names; with "reduce motion" emulated the page-switch animation and button transitions are gone; Noto Serif SC and Saira really loaded. The browser preview was checked for placement mode with no console errors.
- Not tested: the new colors of the system-button strip (debug screenshots do not capture the window frame); the action bar with a video selected (no video wallpaper in the test config); preset thumbnails for video effects (there are no built-in presets now); a machine without Noto Sans installed; the packaged installer.
- Noticed and left alone: the help popover opens downward at the default window size and its last few lines fall outside the window, so you have to scroll to read them (going by the sizes it opened downward before this change too; not checked against the old version).

### ✅ Phase 20 — Diagnostic report and feedback (2026-11-18)
The user's problem: when the app fails on someone else's computer, there is no way to get the error. Design: `docs/superpowers/specs/2026-11-18-diagnostics-design.md` (the user said "go with your judgment", so the decisions there are the assistant's).
- Entry points: settings page "设置" (Settings) → "问题反馈" (Feedback) (generate report / open feedback page… / open log folder); a "问题反馈" submenu in the tray (for when the settings window will not open); a Chinese prompt when the main process throws.
- The report (`src/diagnostics/`): one txt (UTF-8 with BOM, CRLF, so old Notepad shows it too), saved on the Desktop, falling back to Downloads and then the data folder if the Desktop is not writable, then selected in Explorer. Contents: version, OS (the Windows 11 registry still says Windows 10, so it is corrected by build number), CPU and memory, install and data folders; each display's physical resolution, scaling and refresh rate (the primary display asks the system, because Electron's conversion turns 2560 into 2561); GPU (`getGPUInfo('complete')`, about 5 s the first time in each run and cached after that, falling back to basic after 15 s); desktop layer state and the wallpaper window's parent chain (`describeWallpaperWindow`), pause reasons, whether the current wallpaper file exists; security software and wallpaper / desktop tools that match a known list (processes listed with koffi through `CreateToolhelp32Snapshot`, no external program started); the last 30 error / warn entries (minus the security warnings DevTools prints); `config.json`; the last 1500 log lines. Each part has its own try; a failure only adds one line with the reason.
- Removing the user name: only inside paths like `Users\<name>` (backslashes, forward slashes, JSON escapes, URL encoding and 8.3 short names are all handled), never a global replace: a numeric user name like 24418 would also hit timestamps. Wallpaper and music file names are kept, and the report says so at the top.
- GitHub feedback: generate the report first, then open `issues/new?title=…&body=…`. The body has a place to describe the problem, "drag xxx.txt in here", the basic info filled in automatically, and the last 5 errors; the whole URL stays under 6000 characters (one Chinese character is 9 characters once encoded). If the report cannot be saved the page still opens, just without the drag hint.
- Error prompt (`error-prompt.js`): replaces electron-log's default English box (`showDialog: false`). Only uncaught exceptions show it; one at a time, not again within 10 minutes of closing, and "本次运行不再提示" (don't show again this run) can be ticked. A failure in `startApp` is a rejection and used to show nothing at all; it now has its own `.catch`, with only "generate report" / "quit".
- New log entries (`crash-log.js`): window process exits (`render-process-gone`), GPU and other child process exits (`child-process-gone`), unresponsive windows. Clean exits, exits while quitting, and the depth-map process being killed after use are info only. Page console output is now logged by our own `watchRendererConsole` (instead of electron-log's `spyRendererConsole`), and errors and warnings end with "(file:line)". The first startup log line now includes the version, OS and Electron version.
- Fixed along the way: the tray's "打开深度图文件夹..." (open depth map folder) did nothing (`createTray` passed only some callbacks to the menu and missed this one); the tray's "关于" (About) showed a hard-coded v1.0.0 instead of the real version.
- Tried and dropped: listening to `window` `error` events in the preload to get line numbers. With contextIsolation on, exceptions from page scripts are only dispatched to the page's own world, so the preload never sees them.
- Verification: `npm test` all 457 pass (80 new). Real Electron run (separate data folder + debugging port; the Desktop path pointed at a temp folder, and "select in folder", opening the browser and system message boxes replaced with recorders): the three buttons on the settings page, buttons disabled while generating, the toast text; the report contents (real GPU, 2560×1600 240Hz, WorkerW → Progman once attached, 360's `ZhuDongFangYu.exe` recognized, the user name nowhere in the report); the GitHub URL (1597 characters, title and body correct); an exception thrown on purpose in the main process: the Chinese box appeared, choosing "生成诊断报告" really generated a report, and a second exception 3 s later was only logged; `forcefullyCrashRenderer` on the wallpaper window and `chrome://gpucrash` were both logged as errors; a script that throws, loaded into the settings page, was logged with "(boom.js:3)"; no horizontal scrolling at 820 wide.
- Not tested: real clicks on the tray menu; real system message boxes, Explorer and browser (all replaced with recorders); whether GitHub fills in the page correctly (the URL format is from GitHub's docs); the startup-failure prompt (unit tests only); the light theme; the installed packaged build.

Phases 18–20 packaged as **v1.4.0** (2026-11-19). Since v1.3.1 there is a new feature (feedback) and a UI redo, so the minor version goes up.
- `package.json` version set to 1.4.0. Added the model license still owed under "Public distribution notes" in §9: `licenses/depth-anything-v2-small.txt` (source, a note on the changes, and the full Apache-2.0 text, whose MD5 matches apache.org's), which `extraResources` puts at `resources/models/LICENSE-depth-anything-v2-small.txt`. `findDepthModel` only matches `depth_anything_v2_small*.onnx`, so it never picks this file. The IR 9, opset 18 and PyTorch export in the change note were checked against the model file's header.
- Installer: 190,251,699 bytes (v1.3.1 was 357,361,544; the difference is the deleted videos and wallpapers), SHA-256 `fb690f2e430398689f3f32a38b4c394637bffef77fe89e550a49d6a045486bbc`.
- `npm test`: all 457 pass. Extracted `app.asar` and compared it with the source: of 198 files only `package.json`, rewritten by electron-builder, differs.
- Ran `dist/win-unpacked` (separate data folder + debugging ports; the desktop path, "show in folder" and opening the browser replaced with recorders):
  - New user: version 1.4.0, packaged; gallery shows 2, default is the snowy peaks lake; generating a depth map for the bundled Milky Way image succeeded in 0.95 s; report generation works (UTF-8 with BOM, CRLF, no user name found), GitHub URL 1753 characters; no horizontal scrolling in the default window; 0 error / warn lines in the log.
  - Simulated v1.3.1 user (config pointing at the deleted `lake-forest.jpg`, the `snow2` video effect on, a `builtin:bomb1` element placed): after startup the wallpaper is the snowy peaks lake, the video effect is `custom` and off, the explosion element is gone, the log has two migration lines and 0 errors.
  - 360 was running this time (`360tray.exe` and `ZhuDongFangYu.exe` both present), yet the packaged build attached to WorkerW both times (`app:isOnDesktopLayer` was `true`, no notice). This differs from 11-05; the cause was not investigated. The fallback-mode code is unchanged.
- Not tested: a real install or install-over-upgrade (the copy installed on this machine was left alone); real clicks on the tray menu; the light theme.
- Published (2026-11-19, the user confirmed going public): https://github.com/ZihengMiao-Colin/interactive-desktop-wallpaper/releases/tag/v1.4.0 , tag `v1.4.0` points to `0d3bac5` and is Latest. The asset's size and SHA-256 match the above; the page and the download open without signing in. The release notes keep v1.3.1's structure and add "v1.4.0 更新内容", what happens to removed assets when upgrading, and a short "License" section.
- Old installers taken down (2026-11-19, at the user's request): the installer assets of v1.0.0, v1.1.0 and v1.3.1 were deleted (download counts before deletion: 4, 5, 4). The release pages and notes remain, with two paragraphs (Chinese and English) added at the top: the installer was removed because some bundled assets had unclear licensing, please download the latest release. The old notes were backed up and are unchanged below the notice. The local v1.3.1 installer in `dist/` has the same SHA-256 as the deleted asset; the local v1.0.0 and v1.1.0 files are not the ones that were uploaded (different sizes). The "Source code" archives of the old tags are generated by GitHub from git history, cannot be removed, and still contain the deleted assets.

### ✅ Phase 21 — Element adjustment panel split into tabs (2026-11-20, on the `feat/elements-panel-tabs` branch)
User feedback: the adjustment panel on the right of the Elements page could not be seen in full in a small window, took up a large area in full screen, and overlapped the element list on the left. Of "tabs / tighter with two columns on wide screens / collapsible groups", the user picked tabs. Design: `docs/superpowers/specs/2026-11-20-elements-panel-tabs-design.md`; plan: `docs/superpowers/plans/2026-11-20-elements-panel-tabs.md`.
- The panel title bar (name, type, re-place, show / hide, delete) is unchanged. Below it is a row of tabs: Position / Color / Playback / Chroma key, one group at a time; image elements only have Position / Color. The selected tab has an accent bar underneath; Left / Right arrows and Home / End switch tabs (`role=tablist / tab / tabpanel`).
- Size: the panel is at most 520px wide (second column of `.md` is `minmax(0, 520px)`), rows went from 36px to 30px. The tab content area has a minimum height matching the tallest group (Color, 4 rows), so the panel height does not change when switching tabs. For GIF / video elements the panel went from about 566px to 220px.
- The current tab lives in `activeTab` in `elements-tab.js`: it is kept when switching elements and when a config broadcast re-renders the panel; switching to an image element while on Playback or Chroma key falls back to Position. Not saved to disk; the settings window starts on Position again after it is closed.
- "Reset color" moved to the right end of the tab bar and only shows under Color; the chroma key switch moved from the section title to the first row of the Chroma key tab. The Color tab gets a small accent dot when the color has been adjusted (`Shared.elements.effectsAdjusted`: hue, saturation or brightness differ from the default, or tint strength > 0; changing only the tint color does not count), and the Chroma key tab gets one when chroma keying is on.
- Cause of the overlap: the left list is a one-column grid whose column width follows its content; the longest name (no wrapping) stretched it to 266px, 16px wider than the list itself (250px), so it ran under the panel. Fixed with `grid-template-columns: minmax(0, 1fr)`.
- Remembering the tab, where "Reset color" goes, the dots and the minimum height were the assistant's calls; the user approved the design doc.
- Verification: `npm test` 458 passing (1 new). Electron (separate data directory + debugging port; test data with GIF, image, long-name, hidden and missing-file elements): at 960×660 the panel's bottom edge is at 642px, fully visible without scrolling; at full screen 1920×1080 the panel is 520px wide; at 820×560 there is no horizontal scrolling and the title bar buttons stay inside the panel; list rows are 249px and no longer overflow; the panel stays 220px tall across all four tabs; after picking Color, switching elements stays on Color; a real drag of the saturation slider stays on Color both during the drag and after the re-render on release, and the value is kept; the dot disappears after "Reset color"; switching to an image element while on Chroma key falls back to Position; a missing-file element shows no tab bar; arrows / Home / End switch tabs; the chroma key switch updates its dot right away; light theme screenshot. No errors in the log.
- Not tested: the packaged installer; video elements (the test data only had GIFs; video and GIF use the same tabs).
- Noticed but not changed: at 820×560 the asset library's "Add asset" tile wraps to a second row and the panel starts at 559px, so one scroll is needed (after that it fits entirely); at that width the panel is only about 300px and the element name in the title bar is cut to two or three characters (same as before the change).

### ✅ Phase 22 — Imported files keep working after being moved or renamed (2026-11-20, on the `feat/file-relocation` branch)
User feedback: once an imported file is moved or renamed, the app can no longer find it. Of "remember file IDs and find files again" and "copy the file on import", the user picked the first (no extra disk space). Design in `docs/superpowers/specs/2026-11-20-file-relocation-design.md`, plan in `docs/superpowers/plans/2026-11-20-file-relocation.md`, behavior in 4.9.
- New module `src/file-tracking/` (`paths.js`, `file-id.js`, `tracker.js`, `index.js`); `store.moveDepthCache`; `startApp` in `main.js` is now `async` and checks once before creating windows; preload gains `files.locate / relink / onRelocated / onChecked`; the record player and video effect gain `applyRelocations`; missing entries in My wallpapers and the playlist can be relinked with a click; the Effects page shows "file not found"; `myWallpapers:setThumb` deletes the old thumbnail when it replaces one.
- Assistant's calls: no prompt for automatic finds; better to show "not found" than relink the wrong file (Recycle Bin, kind, size and ID must all match); track names / the video effect name follow the new file name when they were the old file name; the dialog opens in the old folder; `sameKind` also requires "can be a wallpaper" to match (a wallpaper relinked to a gif would be dropped as bad data); real-app testing showed that missing files did not redraw while the settings page was open, so `files:checked` was added.
- A fresh reviewer then checked the whole branch; four more fixes followed, each with a failing test first: records deleted while an external drive was unplugged, no relinking of the rest of a folder at a drive root, the settings page checking files synchronously every minute (freezes on a dead network drive), and tracks with extensions outside the lists that could neither be found nor relinked. The small issues left unchanged are listed under "Not tested / not changed" below.
- Verification: `npm test` 505 all pass (47 new, in the four test files `file-paths` / `file-id` / `file-tracker` / `file-tracking` and 3 in `store`). Electron (separate data folder + debugging port, all test files in a temp folder): renaming the playing track while running keeps it playing (30.6 → 34.6 s) and updates the name; renaming the video effect does not reload it; moving the second (not playing) track and switching to it plays it directly with no skip prompt; renaming the current wallpaper and moving a video while the app was closed, then restarting: found before the windows opened, no "找不到上次的壁纸", the depth map file renamed and "深度图已就绪" shown; copying a folder and deleting the original (simulating another drive) shows "找不到文件", clicking one tile relinks it, regenerates the thumbnail and deletes the old one; clicking one track relinks the other track from the same folder ("另外还找回了 1 个"); a file sent to the Recycle Bin is not relinked (tested: its ID stays the same in the Recycle Bin, the check blocks it), and the test file was removed from the Recycle Bin afterwards; the Effects page shows a hint when its video is missing. No errors in the log.
- Tested again after the review: with the settings page open, missing files show up in My wallpapers and the playlist right away; a `.opus` track can be relinked with one click, and the dialog only offers OPUS files.
- Not tested: the packaged installer; actually moving to another drive / USB drive (simulated with copy + delete, which also gives a new ID); ReFS Dev Drive.
- Small issues not changed (raised in review, low impact): after an automatic find the thumbnail file name is still based on the old path (if someone later puts a different image at the old path and imports it, it overwrites that thumbnail); switching to an unreadable track while paused, then having it found, skips it once as broken when played; launching the app a second time during the startup check may open the settings window before its IPC handlers exist; manual relink checks old-folder paths one by one (slow on a dead network drive); the record player / video effect compare paths with `===` (one reload if the same file is spelled two ways); manual relink says "已找回" even when nothing in the config changed; concurrent `record()` runs can drop a just-renamed record, restored 2 seconds later.

### ✅ Phase 5 — Wrap-up (2026-11-10)
- [x] Deleted `生成深度图.bat` (the "generate depth map" batch file): the app generates depth maps itself, and the bat still offered base / large models that have long been gone.
- [x] `requirements.txt` now lists what the venv actually has installed — onnxruntime / numpy / pillow — pinned to the venv's versions (checked with `pip install --dry-run --no-index -r requirements.txt`). Don't remove the `# -*- coding: utf-8 -*-` first line: on Chinese Windows pip reads the file as GBK by default and fails with `UnicodeDecodeError` on the Chinese comments (the old file had the same problem). ffmpeg and the torch needed by `export_onnx.py` are mentioned in comments.
- [x] Added `LICENSE` (MIT, matching `package.json`). The README has a new "License" section: the default wallpapers, video assets, fonts and depth model are not covered by MIT.

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
- [x] A new user's first launch defaults to the first gallery image (湖光山色, a lake-and-mountain scene, at the time; 雪山镜湖, snowy peaks over a lake, since 2026-11-13) instead of the 1366×768 `background.png`.
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
- Default wallpaper licenses (each photo page checked on 2026-11-12, against both sites' terms dated 2026-10-20): originally 9 were from Pixabay and 8 from Pexels. Both sites' terms prohibit distributing images "as is" as wallpapers (only resizing, cropping or recoloring still counts as "as is"), and the Pexels license page also says not to redistribute on other wallpaper platforms, so it is not a grey area. On 2026-11-13 the other 15 were deleted (Phase 18), leaving only the 2 CC0 ones:
  - `milky-way` (Pixabay 2695569): published 2017-08-30. Section 4 of the Pixabay terms says works published before 2019-01-09 are CC0.
  - `snowy-peaks-lake` (Pexels 459225): uploaded in 2017 by the Pexels account named Pixabay. The page data lists the license as CC0, but the page itself only shows "Free".
  - The 15 deleted ones (8 from Pixabay published 2020–2025, 7 under the Pexels license) are still in the git history; the v1.3.1 and earlier installers were taken down on 2026-11-19.
- The video assets (8 in `overlay/`, 2 in `elements/`) had no recorded source and were all deleted on 2026-11-13 (Phase 18); they are still in the git history (the v1.3.1 and earlier installers were taken down on 2026-11-19). When adding videos in future, record the download URL and confirm the license allows distribution with the app. What was found before deleting them (the user remembered they may have come from wallhaven or Mixkit):
  - wallhaven only has still images, no videos. Its images are user-uploaded, and the site itself says copyright stays with the original owners.
  - Mixkit's Stock Video Free License allows downloading, modifying and distributing, with no attribution required; the limits are in its User Terms (no selling items without altering them, no using them to build a stock library or a similar service). Videos confirmed to be Mixkit free videos can ship with the app.
  - Nothing in the file metadata proves any of them came from Mixkit. `snow2` and `snow3` were transcoded by Vimeo (Vimeo Artax), so they may be from Pexels or Pixabay (both used to host videos on Vimeo), which would make them the same problem as the deleted images. `old1`, `old3`, `rain2` and `bomb2` are 2560×1440 and were re-encoded with ffmpeg 5.1, which does not look like Mixkit's original files.
- No code signing, so others will see a SmartScreen prompt.
- Electron 28 no longer receives security updates. It only loads local pages, so the risk is low and v1 can leave it.
- ~~`package.json` says `"license": "MIT"`, but the repo has no `LICENSE` file~~ ✅ 2026-11-10 added; the README says what is not covered by MIT.
- ~~The Depth Anything V2 Small model bundled in the installer is Apache-2.0, which requires a copy of its license text when redistributing; the installer doesn't include one yet~~ ✅ 2026-11-19 from v1.4.0 on it is at `resources/models/LICENSE-depth-anything-v2-small.txt` (source file `licenses/depth-anything-v2-small.txt`). v1.3.1 and older installers don't have it.
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
