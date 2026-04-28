# Registro de cambios

Todos los cambios importantes de XRS Showroom se documentan en este archivo.

Formato: [Versionado Semántico](https://semver.org/lang/es/) · Fechas en AAAA-MM-DD.

---

## [0.9.11] — 2026-04-28

### 📦 Chores
- v0.9.10

---

## [0.11.0] — 2026-04-28

### ✨ Features
- Full-height side panel replaces floating panel — flush left, always visible on desktop
- Tab navigation system (Unidades / Amenities) replaces accordion panels
- File uploader for project logo (Firebase Storage) replaces URL input
- Right-side floating drawer for unit details replaces fullscreen modal
- Unit drawer is non-blocking — rest of the page remains interactive
- Click-outside-to-close and toggle behavior for unit drawer
- Unit drawer opens instantly on click (camera animation runs in parallel)
- 3D canvas offset by panel width (340px) on desktop for proper centering
- Orbit crosshair centered within canvas area

### 🎨 Styles
- Global font changed to Segoe UI
- Accordion titles increased to 15px
- Emojis removed from Unidades and Amenities section titles
- Logo header padding increased for better breathing room
- Presets section hidden from editor sidebar

### 🧪 Tests
- Add `side-panel.spec.js` E2E tests: panel visibility, tab switching, drawer open/close, click-outside behavior, canvas offset verification

### 📦 Chores
- Bump version to 0.11.0

---

## [0.10.0] — 2026-04-27

### 🔒 Security
- Remove insecure `/api/proxy` endpoint (SSRF vulnerability)
- Implement HMAC-SHA256 signed session tokens (`lib/session.js`)
- Migrate `map2tex` from `exec()` to `execFile()` with input sanitization
- Strip 13 debug `console.log` statements from auth/login flows
- Remove redundant `.env` file (use `.env.local` only)

### ♻️ Refactor
- Extract `setWithTimestamp` atomic helper in `lib/scenes.js`
- Create `makeDebouncedUpdate` factory in `useScene.js` (−87 lines)
- Create shared `useSceneLoader` hook (−200 lines duplicated code)
- Decompose `SceneEditorPanel` into `TransformRow`, `AssetAccordion`, `ModelChecker`
- Extract Viewer3D animations → `components/viewer/animations.js` (363 lines)
- Extract Viewer3D quality system → `components/viewer/quality.js` (109 lines)
- Extract Viewer3D helpers → `components/viewer/helpers.js` (91 lines)
- Split `globals.css` (5,417 → 546 lines) into 7 component CSS files

### ✨ Features
- Add ESLint 9 with `eslint-config-next/core-web-vitals`
- Add `yarn lint` and `yarn lint:fix` scripts

### 📦 Chores
- Bump version to 0.10.0

---

## [0.9.10] — 2026-04-28

### ✨ Features
- implement comprehensive end-to-end testing suite using Playwright for authentication, API routes, and viewer functionality.

### 🔧 Refactors
- replace floating side panel with a full-height sidebar featuring tabbed navigation and logo support
- abstract scene loading logic into useSceneLoader hook and implement adaptive viewer quality system

### 📦 Chores
- bump version to 0.10.0, remediate security vulnerabilities, and refactor viewer architecture
- v0.9.9

---

## [0.9.8] — 2026-04-27

### ✨ Features
- add responsive styles for unidad-modal on mobile devices
- add CSS styles for splat setting control components

### 🐛 Fixes
- prevent overlay close on drag by validating mouse target on mousedown and mouseup

### 📦 Chores
- v0.9.7

---

## [0.9.7] — 2026-04-24

### 📦 Chores
- v0.9.6

---

## [0.9.6] — 2026-04-24

### 🐛 Fixes
- rename session cookie to __session (Firebase Hosting requirement)

### 📦 Chores
- v0.9.5

---

## [0.9.5] — 2026-04-24

### 📦 Chores
- v0.9.4

---

## [0.9.4] — 2026-04-24

### 🐛 Fixes
- use hard navigation after login to ensure cookie is sent

---

## [0.9.3] — 2026-04-24

### 🐛 Fixes
- set Node.js 20 runtime for Firebase Cloud Functions

### 📦 Chores
- v0.9.2

---

## [0.9.2] — 2026-04-24

### 📦 Chores
- v0.9.1

---

## [0.9.1] — 2026-04-24

### ✨ Features
- add interactive 360° panorama viewer and support for panoramic images in unit data configuration

### 🐛 Fixes
- debug login auth in production

### 🔧 Refactors
- wrap login form in Suspense to support useSearchParams in Next.js 15+

### 📦 Chores
- v0.9.0

---

## [0.9.0] — 2026-04-23

### ✨ Funcionalidades
- Animaciones de entrada para GLB: Clipping Plane (revelado de abajo hacia arriba) y Dissolve (shader de ruido)
- Animaciones de entrada para Splat SOG: morphing punto→splat con Dyno uniforms + máscara de recorte radial
- Configuración por escena de animaciones (tipo, duración, easing) persistida en Firebase
- Toggle de fondo HDR al cambiar visibilidad del skybox
- Controles UI en SceneEditorPanel para todos los ajustes de animación (GLB y Splat)
- Layout responsive tipo bottom sheet para panel lateral izquierdo en mobile
- Subida de archivos a Firebase Storage para planos de unidades
- Integración de WhatsApp con número de contacto configurable por proyecto
- Autenticación por contraseña con cookies de sesión, página de login y middleware de protección

### 🔧 Refactors
- Encapsulamiento de secciones de transformación en SubAccordion en SceneEditorPanel
- Eliminación del overlay de carga bloqueante, renderizado condicional de componentes de escena
- Panel izquierdo inicia colapsado por defecto

---


## [0.8.0] — 2026-04-22

### ✨ Funcionalidades
- Animación de salida tipo split-screen reemplazando el overlay de carga en las páginas de visor y escena
- Carga e inicialización de colliders de escena en segundo plano
- Animación de entrada diferida para LeftPanelStack con transiciones suaves de acordeón
- Estilos y layout inspirados en Nomada para el panel lateral izquierdo
- Componente SubAccordion y reorganización de controles gizmo en SceneEditorPanel
- Sistema de gestión de amenities con panel de listado, modal y base de datos Firebase
- UnidadesCargaModal para importación masiva de unidades por CSV
- Captura de posición inicial de cámara con auto-aplicación al cargar la escena
- Controles de posición de skybox con escalado parallax dinámico basado en zoom

---

## [0.7.0] — 2026-04-21

### ✨ Funcionalidades
- Seguimiento y visualización en tiempo real del conteo de triángulos para assets 3D en paneles de Rendimiento y Editor de Escena
- Renderizado de UnidadModal mediante React portal para montaje correcto en el DOM
- Panel de Unidades integrado en el modo visor (view)

### 🐛 Correcciones
- N/A

---

## [0.6.0] — 2026-04-20

### ✨ Funcionalidades
- Carga priorizada de assets: GLB y piso se cargan primero, assets secundarios se difieren al segundo plano
- Panel lateral derecho para configuración de escena con funcionalidad de toggle
- Carga progresiva de GLB con seguimiento de progreso de descarga en tiempo real
- Eliminación de límites mín/máx en inputs numéricos de transformación para mayor flexibilidad
- Merge de la rama `improvements-test` a main

### 🐛 Correcciones
- Limitación de valores de escala para prevenir crash por escala cero en Gaussian Splats
- Mover `onActiveSectionChange` fuera del updater de setState para evitar errores de ciclo de renderizado
- Expandir escala escalar a objeto `{x,y,z}` antes de asignar valores por eje

---

## [0.5.0] — 2026-04-19

### ✨ Funcionalidades
- Mejoras en el Editor de Escena: panel de transformación, visualización de info de cámara, controles de skybox, máscara esférica, barra de gizmos y sistema de presets
- Generador de piso satelital con posicionamiento basado en mapa
- Controles de rotación de piso
- Reestructuración de UI para paridad entre editor y visor

---

## [0.4.0] — 2026-04-17

### ✨ Funcionalidades
- Carga y gestión de modelos collider con funcionalidad de enfoque de cámara en unidad
- Persistencia del estado de visibilidad de colliders en el editor de escena
- Rediseño de UnidadesListPanel con secciones de filtro colapsables
- Visualización de métricas de GPU y VRAM en PerformancePanel
- Perfiles de calidad adaptativa basados en capacidades del dispositivo/GPU
- Carga de assets específica para móviles, optimizaciones de VRAM y recuperación por pérdida de contexto WebGL
- Botón de descarga en FileUploader con estilos de botón secundario
- Filtrado multi-selección por cantidad de ambientes en UnidadesListPanel

### 🔧 Refactorizaciones
- Renderizado de material de vidrio actualizado a reflexiones basadas en opacidad; mapas de entorno habilitados para iOS

---

## [0.3.0] — 2026-04-16

### ✨ Funcionalidades
- Seguimiento del centro de bounding-box del GLB y estado de órbita persistente
- Máquina de estados de animación pitch-snap con controles de configuración en OrbitPanel
- Zoom de cámara al mantener presionado con intensidad ajustable
- Componentes de filtrado, listado y modal de detalle de unidades con soporte de API proxy

### 🔧 Refactorizaciones
- MaterialPanel integrado en RightPanelStack; PerformancePanel reubicado abajo a la derecha

### 💅 Estilos
- Mejoras de estabilidad de layout en acordeón de assets y controles de transformación

---

## [0.2.0] — 2026-04-15

### ✨ Funcionalidades
- Detección automática de transparencia y configuración de materiales para mallas de vidrio
- MaterialPanel para edición de materiales 3D en tiempo real integrado al visor
- Sobreescrituras persistentes de propiedades de material y generación de mapas de entorno PBR

### 🐛 Correcciones
- Orden de renderizado correcto para mallas GLB y splat (corrección de composición)

### 📦 Mantenimiento
- Actualización de dependencias en yarn.lock

---

## [0.1.0] — 2026-04-14

### ✨ Funcionalidades
- Configuración de Firebase hosting y sincronización de ajustes de órbita en la página del visor
- Controles colapsables de transformación de assets en SceneEditorPanel
- Control de pixel ratio en OrbitPanel con escalado del renderer
- Componente HelpTooltip con tooltips descriptivos en paneles de Órbita y Editor de Escena
- Actualización de `@sparkjsdev/spark` a 2.0.0 y `three.js` a 0.180.0 con SparkRenderer y soporte de LoD

---

## [0.0.1] — 2026-04-10

### 🎉 Lanzamiento inicial
- Primer commit — aplicación base con Next.js + Three.js + Firebase
- Visor 3D (Viewer3D) con carga de GLB, Gaussian Splat (SOG) y skybox
- Gestión de escenas con Firestore (crear, editar, listar escenas)
- SceneEditorPanel con carga y configuración de assets
- Integración de OrbitControls con ajustes persistentes
- PerformancePanel mostrando FPS en vivo, tamaños de assets y tiempos de carga simulados por red
- Renombrado de escenas inline con soporte de doble clic
