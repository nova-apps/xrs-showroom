# Hauzd-like Real Estate 3D Platform — Full Architecture

## Context
After reverse-engineering Hauzd's proprietary engine (WASM, IBF/IBM binary formats, LOD streaming, instancing), we want to build a similar platform from scratch using open standards. The goal: a real estate sales platform with interactive 3D visualization, unit selection, CRM, and fast loading — deployed on Firebase.

## Stack Summary

| Layer | Technology |
|-------|-----------|
| 3D Engine | Three.js + custom LOD/streaming |
| Frontend | Next.js (App Router) + React Three Fiber (R3F) |
| Backend API | Firebase Functions (Node.js) |
| Database | Firestore |
| Auth | Firebase Auth |
| Storage | Firebase Storage (models) + Cloud CDN |
| Asset Pipeline | Cloud Functions + Cloud Run (processing) |
| Real-time | Firestore real-time listeners |
| CRM | Custom on Firestore |
| Payments | Stripe / MercadoPago |

---

## 1. Asset Pipeline (the most critical piece)

### 1.1 Upload Flow
```
User uploads GLB/glTF/FBX/OBJ
        ↓
  Firebase Storage (raw/)
        ↓
  Cloud Function trigger → Cloud Run job
        ↓
  Processing Pipeline:
    1. Parse & validate (gltf-transform)
    2. Mesh optimization (meshoptimizer via WASM)
       - Vertex cache optimization
       - Overdraw optimization
       - Vertex quantization (position: 16-bit, normal: oct8, UV: 16-bit)
    3. Mesh simplification → generate LODs (3 levels: 100%, 50%, 10%)
    4. Draco compression on each LOD
    5. Split scene into spatial chunks (octree/grid)
    6. Texture processing:
       - Resize to power-of-2
       - Generate mipmaps
       - Convert to KTX2 (Basis Universal) — 5-10x smaller than PNG
       - Generate thumbnail JPEGs for preview
    7. Lightmap baking (optional, via headless renderer)
    8. Generate manifest.json (scene graph, LOD metadata, chunk bounds)
        ↓
  Firebase Storage (processed/{projectId}/)
    ├── manifest.json
    ├── chunks/
    │   ├── chunk_0_lod0.glb  (Draco compressed)
    │   ├── chunk_0_lod1.glb
    │   ├── chunk_0_lod2.glb
    │   ├── chunk_1_lod0.glb
    │   └── ...
    ├── textures/
    │   ├── mat_0_albedo.ktx2
    │   ├── mat_0_normal.ktx2
    │   └── ...
    └── meta/
        ├── thumbnail.jpg
        └── units.json  (clickable unit definitions)
```

### 1.2 Blender Plugin
- Export addon that marks:
  - Clickable units (with metadata: unit ID, type, floor)
  - LOD groups
  - Lightmap UVs
  - Collision meshes (for raycasting)
- Exports to optimized glTF with custom extensions
- Can pre-split into chunks and generate LODs locally
- Plugin communicates with API to upload directly to the project

### 1.3 Key Libraries for Pipeline
- **gltf-transform** — glTF manipulation (merge, split, optimize, compress)
- **meshoptimizer** (WASM build) — vertex/index optimization, simplification
- **KTX-Software** — texture compression to KTX2/Basis Universal
- **draco3dgltf** — geometry compression

### 1.4 Format Strategy
Use standard glTF/GLB with extensions, NOT proprietary formats:
- `KHR_draco_mesh_compression` — geometry compression
- `KHR_texture_basisu` — KTX2 textures
- `EXT_mesh_gpu_instancing` — hardware instancing for repeated objects
- `KHR_mesh_quantization` — reduced precision vertex data
- Custom extension for unit metadata: `EXT_realstate_unit`

---

## 2. 3D Viewer (Frontend)

### 2.1 Architecture
```
Next.js App
├── pages/
│   ├── / (landing)
│   ├── /projects/[id] (project page + 3D viewer)
│   ├── /admin (broker dashboard)
│   └── /api/ (Next.js API routes → Firebase)
├── components/
│   ├── viewer/
│   │   ├── SceneManager.tsx      — R3F canvas, camera, controls
│   │   ├── StreamingManager.tsx  — chunk loading/unloading
│   │   ├── LODManager.tsx        — LOD switching per chunk
│   │   ├── UnitSelector.tsx      — raycasting + unit highlighting
│   │   ├── MaterialManager.tsx   — texture streaming, KTX2 loading
│   │   └── PerformanceMonitor.tsx — FPS tracking, quality auto-adjust
│   ├── ui/
│   │   ├── UnitPanel.tsx         — unit details sidebar
│   │   ├── FloorSelector.tsx     — floor plan navigation
│   │   ├── FilterBar.tsx         — price/size/status filters
│   │   └── ContactForm.tsx       — lead capture
│   └── admin/
│       ├── ProjectEditor.tsx     — upload/configure projects
│       ├── UnitManager.tsx       — set prices, availability
│       └── LeadsDashboard.tsx    — CRM view
```

### 2.2 Streaming Strategy (key to fast loading)

**Phase 1 — Instant preview (<1s)**
- Load manifest.json (tiny, <10KB)
- Show low-poly proxy from LOD2 chunks (10% geometry, Draco compressed)
- Total download: ~200KB for the whole scene

**Phase 2 — Progressive refinement (1-5s)**
- Load LOD1 for chunks near camera (50% geometry)
- Start loading KTX2 textures for visible objects
- Replace proxy meshes with medium detail

**Phase 3 — Full quality (5-15s, on demand)**
- Load LOD0 only for chunks the user is actively looking at
- Load high-res textures only for nearby objects
- Frustum culling: never load what's behind the camera

**Implementation:**
```
StreamingManager:
  - Maintains octree/grid of chunk bounding boxes
  - Every frame: check camera frustum + distance
  - Priority queue: closer + in-view = higher priority
  - Max concurrent downloads: 4-6
  - Cache: LRU with ~200MB budget (GPU memory aware)
  - Dispose: unload chunks that leave view + distance threshold
```

### 2.3 Performance Targets
- First meaningful paint: <1.5s (proxy geometry visible)
- Interactive: <3s (user can orbit/click)
- Full quality: <15s (depending on scene size)
- 60fps on mid-range mobile (GPU budget: 500K triangles visible)
- Memory budget: 300MB GPU, 500MB system

### 2.4 Instancing
For repeated elements (windows, balconies, trees):
- Detect at pipeline stage (same mesh hash → instance group)
- Use Three.js `InstancedMesh` — one draw call for 1000 trees
- Store per-instance transforms in `InstancedBufferAttribute`
- Dramatic performance win: 1000 draw calls → 1

---

## 3. Backend & Data Model

### 3.1 Firestore Collections

```
/developers/{devId}
  name, logo, plan, createdAt

/projects/{projectId}
  developerId, name, location, status
  assetPath (Firebase Storage path to processed assets)
  manifest (cached from manifest.json)
  settings: { autoRotate, defaultCamera, skybox }

/projects/{projectId}/units/{unitId}
  name, floor, type (studio/1br/2br/3br)
  area, price, status (available/reserved/sold)
  meshIds[] (which 3D meshes represent this unit)
  floorPlanUrl, gallery[]

/projects/{projectId}/leads/{leadId}
  name, email, phone
  unitId, source, status (new/contacted/qualified/closed)
  notes[], scheduledVisit, assignedBroker
  createdAt, updatedAt

/developers/{devId}/brokers/{brokerId}
  name, email, phone, role (admin/broker)
  assignedProjects[]

/analytics/{projectId}/events/{eventId}
  type (view/click_unit/submit_lead/schedule_visit)
  unitId, sessionId, timestamp, duration
```

### 3.2 Firebase Functions

```
functions/
├── onModelUpload      — trigger on Storage upload, starts processing
├── processModel       — Cloud Run: optimize, chunk, compress
├── createProject      — CRUD with validation
├── updateUnit         — update availability/pricing
├── submitLead         — lead capture + email notification
├── getAnalytics       — aggregate view/click stats
├── webhookStripe      — payment processing
└── scheduledCleanup   — remove orphaned assets
```

### 3.3 Real-time Updates
- Firestore onSnapshot on units collection → live availability on 3D viewer
- When a unit is reserved/sold, all connected viewers see the color change instantly
- No websocket server needed — Firestore handles this

---

## 4. Infrastructure (Firebase)

```
Firebase Project
├── Hosting          — Next.js app (via Firebase Hosting + Cloud Run)
├── Storage          — 3D assets (raw + processed)
│   └── CDN          — Firebase Storage uses Google Cloud CDN automatically
├── Firestore        — all structured data
├── Auth             — email/password + Google for brokers, anonymous for viewers
├── Functions        — API endpoints, triggers
├── Cloud Run        — heavy asset processing (more memory/CPU than Functions)
├── Analytics        — viewer behavior tracking
└── Remote Config    — feature flags, A/B testing
```

### 4.1 CDN & Caching Strategy
- Processed assets: `Cache-Control: public, max-age=31536000, immutable`
  - Content-addressed paths: `processed/{projectId}/{contentHash}/chunk_0.glb`
  - When model is re-processed, hash changes → cache busts automatically
- manifest.json: `Cache-Control: public, max-age=300` (5 min, so updates propagate)
- API responses: no-cache (real-time data)

### 4.2 Storage Costs Estimate (per project)
- Raw upload: ~50-200MB (GLB)
- Processed: ~30-100MB (compressed chunks + KTX2 textures)
- Monthly serving: depends on traffic. CDN egress is the main cost.
- Firebase Blaze plan needed for Cloud Run processing

---

## 5. Security

- Firebase Auth for all API access
- Storage Security Rules: processed assets are public-read, raw is dev-only
- Firestore rules: developers can only edit their own projects/units
- Anonymous auth for viewers (track sessions, rate-limit leads)
- CORS on storage for 3D asset loading
- Input sanitization on lead forms

---

## 6. Development Phases

### Phase 1 — MVP (4-6 weeks)
- [ ] Asset pipeline: GLB upload → optimize → chunk → LOD → Draco → KTX2
- [ ] Three.js viewer: streaming chunks, LOD switching, orbit controls
- [ ] Basic project page: 3D viewer + unit list
- [ ] Firestore: projects, units CRUD
- [ ] Deploy on Firebase

### Phase 2 — Interactive (2-3 weeks)
- [ ] Unit clicking (raycasting) + highlighting
- [ ] Unit detail panel (price, area, floor plan, gallery)
- [ ] Real-time availability (Firestore onSnapshot)
- [ ] Lead capture form

### Phase 3 — CRM (3-4 weeks)
- [ ] Broker dashboard (admin panel)
- [ ] Lead management (pipeline view)
- [ ] Email notifications
- [ ] Analytics dashboard (views, clicks, conversions)

### Phase 4 — Polish (2-3 weeks)
- [ ] Blender export plugin
- [ ] Instancing support
- [ ] Lightmap baking
- [ ] Mobile optimization
- [ ] Performance auto-adjustment

### Phase 5 — Business (ongoing)
- [ ] Payment integration (unit reservations)
- [ ] Multi-language support
- [ ] Embeddable widget (iframe for broker websites)
- [ ] White-label theming

---

## 7. Key Differentiators vs Hauzd

| Aspect | Hauzd | Our Platform |
|--------|-------|-------------|
| Format | Proprietary IBF/IBM (lock-in) | Standard glTF + extensions (open) |
| Engine | Custom WASM C++ (hard to maintain) | Three.js (huge community, easy to hire) |
| Compression | Custom binary packing | Draco + KTX2 (industry standard, similar compression) |
| LOD | Custom screen-size system | Standard LOD with octree streaming |
| Textures | HBasis proprietary | KTX2/Basis Universal (same underlying codec) |
| Loading | Fast but opaque | Equally fast with proper pipeline, transparent |
| Extensibility | Closed, hard to customize | Open, plugin-friendly |
| Cost to build | Millions (C++ WASM engine) | Fraction (leveraging Three.js ecosystem) |

---

## 8. Verification / How to Test

1. **Asset Pipeline**: Upload a test GLB → verify chunks/LODs/KTX2 generated in Storage
2. **Viewer**: Load processed project → verify streaming (Network tab shows progressive chunk loading)
3. **Performance**: Lighthouse score >90 for initial load, 60fps on mobile
4. **Units**: Click unit in 3D → verify panel shows correct data from Firestore
5. **Real-time**: Change unit status in admin → verify 3D viewer updates live
6. **CRM**: Submit lead form → verify lead appears in broker dashboard
