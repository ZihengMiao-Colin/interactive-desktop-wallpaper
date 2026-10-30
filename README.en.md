# Interactive 3D Wallpaper

[简体中文](README.md) | **English**

A pseudo-3D parallax live wallpaper for the Windows desktop: pick an image, an AI model generates its depth map, and as you move the mouse the scene shifts by distance, like looking at a 3D scene through a window. You can also place your own images, GIFs and videos on the wallpaper; they move with the scene and are naturally occluded by foreground objects.

The Android version is at [interactive-phone-wallpaper](https://github.com/ZihengMiao-Colin/interactive-phone-wallpaper): the same parallax effect, driven by tilting the phone, with depth maps generated on the phone.

## Features

- **Depth parallax wallpaper**: Depth Anything V2 generates the depth map and a custom shader offsets the image by depth; parallax strength, smoothing and focus depth are adjustable.
- **Custom elements**: import images / GIF / animated WebP / APNG / MP4 / WebM, or use the bundled default elements (explosions).
  - Click an element to enter placement mode: drag to move, drag a corner to resize, adjust depth; Enter to confirm, Esc to cancel.
  - Elements move with the mouse together with background at the same depth and are hidden behind closer objects; new elements "stick to the ground" for their depth by default.
  - Green-screen keying, loop / interval playback, opacity, show / hide; multiple elements at once.
- **Other decorations**: vinyl record player (a playlist of local music with list loop / repeat one / shuffle / play in order; drag it anywhere), full-screen video effects (rain, snow, old film), weather particles.
- **Desktop integration**: injected into the WorkerW layer below the desktop icons; pauses automatically for full-screen apps, lock screen and sleep; tray menu, launch at startup.

## Running

Requires Windows, Node.js, and the Depth Anything V2 Small ONNX model in the project root (`depth_anything_v2_small*.onnx`, not in the repo; export it with `export_onnx.py`; if there are several, the largest one is used). Depth maps are generated with `onnxruntime-node`, so the app itself does not need Python.

```bash
npm install
```

```bash
npm start
```

- `npm run dev`: also opens DevTools.
- The settings window opens on launch: choose a wallpaper, generate depth maps, tweak parameters, manage custom elements. After you close it the app stays in the tray; launch the app again or click the tray icon (right-click → "打开设置", Open settings) to bring it back. When started at login it only shows the wallpaper, without the settings window.
- Logs are in `%APPDATA%/interactive-desktop-wallpaper/logs/main.log`.

## Packaging

```bash
npm run build
```

Produces `dist/Interactive3DWallpaper-Setup-<version>.exe` (an NSIS installer; the file name has no Chinese characters so it uploads cleanly to GitHub Releases). Packaging requires `depth_anything_v2_small_ir9.onnx` in the project root; it is copied into the installer. If the first build fails extracting `winCodeSign` with "Cannot create symbolic link", see [PROJECT_NOTES.en.md](PROJECT_NOTES.en.md) §9 Phase 6.

## Development

```bash
npm test
```

Asset preprocessing scripts (`tools/`) and the Python depth-map generator (`generate_depth_map.py`) use the in-project `venv/` (with onnxruntime / numpy / pillow):

```bash
venv/Scripts/python.exe -m unittest tools/test_prepare_builtin_element.py
```

**Browser preview**: see the rendering and placement mode without starting Electron; data comes from `dev/dev-config.json`.

```bash
venv/Scripts/python.exe -m http.server 8765
```

Then open `http://localhost:8765/index.html`; add `?mode=edit` for placement mode.

**Adding a default element**: first run the script to crop the green-screen video to the subject and generate a thumbnail, then add the entry it prints to `elements/manifest.json`.

```bash
venv/Scripts/python.exe tools/prepare_builtin_element.py elements/xxx.mp4 --id xxx --name "Name"
```

## Project layout

| Path | Contents |
|---|---|
| `main.js`, `preload.js`, `src/` | Electron main process, IPC, WorkerW injection, full-screen detection, config storage, depth-map generation (`src/depth/`), custom element library and placement window |
| `index.html`, `renderer/` | Wallpaper page (also the placement window): Pixi scene, shaders, custom element layer, placement mode |
| `settings.html`, `settings/` | Settings window |
| `shared/` | Pure logic shared by the main process, renderer and tests |
| `elements/` | Default element assets and `manifest.json` |
| `overlay/` | Full-screen video effect assets |
| `generate_depth_map.py` | Python depth-map generator (used by `tools/prepare_wallpapers.py`; the app uses `src/depth/`, with identical results) |
| `test/`, `tools/`, `dev/` | Tests, asset preprocessing scripts, browser preview data |

For architecture details, known issues and the development plan, see [PROJECT_NOTES.en.md](PROJECT_NOTES.en.md).

## Technical notes

- **Parallax formula**: `offset = mouse × (depth − focus) × strength`, with a soft clamp; the background and elements share the same GLSL (`renderer/shaders.js`) and JS version (`shared/parallax-math.js`).
- **Depth occlusion**: each element pixel is compared against the depth of the background content actually shown at that pixel, so occlusion edges follow foreground objects as the mouse moves.
- **Animated images**: decoded with Chromium's built-in WebCodecs `ImageDecoder`, no third-party library.
- **Data**: config lives in `%APPDATA%/interactive-desktop-wallpaper/config.json`; imported assets are copied into `custom_elements/` in the same folder, so moving the original files does not break anything.
