# Changelog

All notable changes to XRS Showroom are documented in this file.

Format: [Semantic Versioning](https://semver.org/) · Dates in YYYY-MM-DD.

---

## [0.7.0] — 2026-04-21

### ✨ Features
- Real-time triangle count tracking and display for 3D assets in Performance and Scene Editor panels
- Render UnidadModal using React portal for proper DOM mounting
- Unidades panel integrated into viewer (view) mode

### 🐛 Fixes
- N/A

---

## [0.6.0] — 2026-04-20

### ✨ Features
- Prioritized asset loading: GLB and floor load first, secondary assets defer to background
- Right panel stack for scene settings with toggle functionality
- Progressive GLB loading with real-time download progress tracking
- Remove min/max limits on transform number inputs for full flexibility
- Merge `improvements-test` branch into main

### 🐛 Fixes
- Clamp scale values to prevent zero-scale crash on Gaussian Splats
- Move `onActiveSectionChange` out of setState updater to avoid render-cycle errors
- Expand scalar scale to `{x,y,z}` object before setting per-axis values

---

## [0.5.0] — 2026-04-19

### ✨ Features
- Scene Editor enhancements: transform panel, camera info display, skybox controls, spherical mask, gizmo toolbar, and presets system
- Satellite floor generator with map-based positioning
- Floor rotation controls
- UI restructuring for editor and viewer parity

---

## [0.4.0] — 2026-04-17

### ✨ Features
- Collider model loading, management, and camera-focus-on-unit functionality
- Collider visibility state persistence in scene editor
- Redesigned UnidadesListPanel with collapsible filter sections
- GPU and VRAM metrics display in PerformancePanel
- Adaptive quality profiles based on device/GPU capabilities
- Mobile-specific asset loading, VRAM optimizations, and WebGL context loss recovery
- Download button in FileUploader with secondary button styles
- Multi-select filtering for room counts in UnidadesListPanel

### 🔧 Refactors
- Glass material rendering updated to opacity-based reflections; environment maps enabled for iOS

---

## [0.3.0] — 2026-04-16

### ✨ Features
- GLB bounding-box center tracking and persistent orbit state
- Pitch snap animation state machine with OrbitPanel configuration controls
- Press-and-hold camera zoom functionality with adjustable intensity
- Unit filtering, listing, and detail modal components with proxy API support

### 🔧 Refactors
- MaterialPanel integrated into RightPanelStack; PerformancePanel relocated to bottom-right

### 💅 Style
- Layout stability improvements in asset accordion and transform controls

---

## [0.2.0] — 2026-04-15

### ✨ Features
- Automatic transparency detection and material configuration for glass meshes
- MaterialPanel for real-time 3D material editing integrated into viewer
- Persistent material property overrides and PBR environment map generation

### 🐛 Fixes
- Correct render order for GLB and splat meshes (compositing fix)

### 📦 Chores
- Dependency updates in yarn.lock

---

## [0.1.0] — 2026-04-14

### ✨ Features
- Firebase hosting configuration and orbit settings sync in viewer page
- Collapsible asset transform controls in SceneEditorPanel
- Pixel ratio control in OrbitPanel with renderer scaling
- HelpTooltip component with descriptive tooltips in Orbit and SceneEditor panels
- Upgrade `@sparkjsdev/spark` to 2.0.0 and `three.js` to 0.180.0 with SparkRenderer and LoD support

---

## [0.0.1] — 2026-04-10

### 🎉 Initial Release
- First commit — base Next.js + Three.js + Firebase application
- 3D Viewer (Viewer3D) with GLB, Gaussian Splat (SOG), and skybox loading
- Scene management with Firestore (create, edit, list scenes)
- SceneEditorPanel with asset upload and configuration
- OrbitControls integration with persistent settings
- PerformancePanel displaying live FPS, asset sizes, and network-simulated load times
- Inline scene renaming with double-click support
