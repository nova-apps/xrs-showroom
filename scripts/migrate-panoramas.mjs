#!/usr/bin/env node

/**
 * Migration script: Upload panorama images to Firebase Storage and link them to units.
 *
 * Uses the CSV mapping from Nomada_Unidades_Panoramas.xlsx to:
 *   1. Map unit IDs (Nombre column) to panorama filenames (Imagen Panorámica column)
 *   2. Upload unique panorama JPGs to Firebase Storage
 *   3. Update each unit's `imagen_panoramica` field in RTDB
 *
 * Usage:
 *   node scripts/migrate-panoramas.mjs
 *
 * Requires: FIREBASE env vars in .env.local
 */

import { initializeApp } from 'firebase/app';
import { getDatabase, ref, get, set } from 'firebase/database';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ─── Load .env.local ───────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env.local');
const envContent = readFileSync(envPath, 'utf-8');
const env = {};
envContent.split('\n').forEach((line) => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return;
  const eqIndex = trimmed.indexOf('=');
  if (eqIndex === -1) return;
  env[trimmed.slice(0, eqIndex)] = trimmed.slice(eqIndex + 1);
});

// ─── Firebase Init ─────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain:        env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL:       env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  projectId:         env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket:     env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId:             env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);
const storage = getStorage(app);

// ─── Panorama mapping from XLSX (embedded as CSV) ──────────────
// Extracted from Nomada_Unidades_Panoramas.xlsx
// Format: Nombre (unit ID) → Imagen Panorámica (filename)
const PANORAMA_CSV = `A-1001,1-10.jpg
A-1002,2-10.jpg
A-1003,3-10.jpg
A-1004,3-10.jpg
A-1005,4-10.jpg
A-1006,4-10.jpg
A-1007,5-10.jpg
A-1008,5-10.jpg
A-1101,1-11.jpg
A-1102,2-11.jpg
A-1103,3-11.jpg
A-1104,3-11.jpg
A-1105,4-11.jpg
A-1106,4-11.jpg
A-1107,5-11.jpg
A-1108,5-11.jpg
A-1201,1-12.jpg
A-1202,2-12.jpg
A-1203,3-12.jpg
A-1204,3-12.jpg
A-1205,4-12.jpg
A-1206,4-12.jpg
A-1207,5-12.jpg
A-1208,5-12.jpg
A-1301,1-13.jpg
A-1302,2-13.jpg
A-1303,3-13.jpg
A-1304,3-13.jpg
A-1305,4-12.jpg
A-1306,4-12.jpg
A-1307,5-13.jpg
A-1308,5-13.jpg
A-1401,1-13.jpg
A-1402,2-13.jpg
A-1403,3-13.jpg
A-1404,3-13.jpg
A-1405,4-12.jpg
A-1406,4-12.jpg
A-1407,5-13.jpg
A-1408,5-13.jpg
A-206,4-3.jpg
A-207,5-3.jpg
A-208,5-3.jpg
A-301,1-3.jpg
A-302,2-3.jpg
A-306,4-3.jpg
A-307,5-3.jpg
A-308,5-3.jpg
A-401,1-4.jpg
A-402,2-4.jpg
A-403,3-4.jpg
A-404,3-4.jpg
A-405,4-4.jpg
A-406,4-4.jpg
A-407,5-4.jpg
A-408,5-4.jpg
A-501,1-5.jpg
A-502,2-5.jpg
A-503,3-5.jpg
A-504,3-5.jpg
A-505,4-5.jpg
A-506,4-5.jpg
A-507,5-5.jpg
A-508,5-5.jpg
A-601,1-6.jpg
A-602,2-6.jpg
A-603,3-6.jpg
A-604,3-6.jpg
A-605,4-6.jpg
A-606,4-6.jpg
A-607,5-6.jpg
A-608,5-6.jpg
A-701,1-7.jpg
A-702,2-7.jpg
A-703,3-7.jpg
A-704,3-7.jpg
A-705,4-7.jpg
A-706,4-7.jpg
A-707,5-7.jpg
A-708,5-7.jpg
A-801,1-8.jpg
A-802,2-8.jpg
A-803,3-8.jpg
A-804,3-8.jpg
A-805,4-8.jpg
A-806,4-8.jpg
A-807,5-8.jpg
A-808,5-8.jpg
A-901,1-9.jpg
A-902,2-9.jpg
A-903,3-9.jpg
A-904,3-9.jpg
A-905,4-9.jpg
A-906,4-9.jpg
A-907,5-9.jpg
A-908,5-9.jpg
B-1001,6-10.jpg
B-1002,6-10.jpg
B-1003,7-10.jpg
B-1004,7-10.jpg
B-1005,8-10.jpg
B-1006,9-10.jpg
B-1007,10-10.jpg
B-1101,6-11.jpg
B-1102,6-11.jpg
B-1103,7-11.jpg
B-1104,7-11.jpg
B-1105,8-11.jpg
B-1106,9-11.jpg
B-1107,10-11.jpg
B-1201,6-12.jpg
B-1202,6-12.jpg
B-1203,7-12.jpg
B-1204,7-12.jpg
B-1205,8-12.jpg
B-1206,9-12.jpg
B-1207,10-12.jpg
B-1301,6-13.jpg
B-1302,6-13.jpg
B-1303,7-13.jpg
B-1304,7-13.jpg
B-1305,8-13.jpg
B-1306,9-13.jpg
B-1307,10-13.jpg
B-1401,6-13.jpg
B-1402,6-13.jpg
B-1403,7-13.jpg
B-1404,7-13.jpg
B-1405,8-13.jpg
B-1406,9-13.jpg
B-1407,10-13.jpg
B-205,8-3.jpg
B-206,9-3.jpg
B-207,10-3.jpg
B-301,6-3.jpg
B-302,6-3.jpg
B-303,7-3.jpg
B-304,7-3.jpg
B-305,8-3.jpg
B-306,9-3.jpg
B-307,10-3.jpg
B-401,6-4.jpg
B-402,6-4.jpg
B-403,7-4.jpg
B-404,7-4.jpg
B-405,8-4.jpg
B-406,9-4.jpg
B-407,10-4.jpg
B-501,6-5.jpg
B-502,6-5.jpg
B-503,7-5.jpg
B-504,7-5.jpg
B-505,8-5.jpg
B-506,9-5.jpg
B-507,10-5.jpg
B-601,6-6.jpg
B-602,6-6.jpg
B-603,7-6.jpg
B-604,7-6.jpg
B-605,8-6.jpg
B-606,9-6.jpg
B-607,10-6.jpg
B-701,6-7.jpg
B-702,6-7.jpg
B-703,7-7.jpg
B-704,7-7.jpg
B-705,8-7.jpg
B-706,9-7.jpg
B-707,10-7.jpg
B-801,6-8.jpg
B-802,6-8.jpg
B-803,7-8.jpg
B-804,7-8.jpg
B-805,8-8.jpg
B-806,9-8.jpg
B-807,10-8.jpg
B-901,6-9.jpg
B-902,6-9.jpg
B-903,7-9.jpg
B-904,7-9.jpg
B-905,8-9.jpg
B-906,9-9.jpg
B-907,10-9.jpg`;

// Build the mapping: unitId → panoramaFilename
const UNIT_PANORAMA_MAP = new Map();
PANORAMA_CSV.split('\n').forEach((line) => {
  const [unitId, filename] = line.split(',').map((s) => s.trim());
  if (unitId && filename) {
    UNIT_PANORAMA_MAP.set(unitId, filename);
  }
});

console.log(`📋 Loaded ${UNIT_PANORAMA_MAP.size} unit→panorama mappings`);

// Panorama images folder
const PANORAMAS_DIR = '/Users/martin/Downloads/panoramas';

// ─── Main ──────────────────────────────────────────────────────
async function main() {
  console.log(`📂 Panoramas directory: ${PANORAMAS_DIR}`);
  console.log('🔍 Fetching all scenes from RTDB...\n');

  const scenesSnap = await get(ref(db, 'scenes'));
  if (!scenesSnap.exists()) {
    console.log('⚠️  No scenes found. Nothing to migrate.');
    process.exit(0);
  }

  const scenes = scenesSnap.val();
  let totalMigrated = 0;
  let totalSkipped  = 0;
  let totalErrors   = 0;
  let totalNoMatch  = 0;

  // Cache: filename → Firebase Storage URL (avoid re-uploading same file)
  const uploadCache = new Map();

  for (const [sceneId, scene] of Object.entries(scenes)) {
    const items = scene?.unidades?.items;
    if (!items || !Array.isArray(items)) continue;

    console.log(`\n🏗  Scene: "${scene.name}" (${sceneId})`);
    console.log(`   ${items.length} units found`);

    let sceneUpdated = false;

    for (let i = 0; i < items.length; i++) {
      const unit = items[i];
      const unitId = unit?.id;

      if (!unitId) continue;

      // Check if already has a Firebase panorama URL
      if (unit.imagen_panoramica && (
        unit.imagen_panoramica.includes('firebasestorage.googleapis.com') ||
        unit.imagen_panoramica.includes('firebasestorage.app')
      )) {
        console.log(`   ⏭  Unit "${unitId}" — already has Firebase panorama, skipping.`);
        totalSkipped++;
        continue;
      }

      // Look up panorama filename
      const panoramaFilename = UNIT_PANORAMA_MAP.get(unitId);
      if (!panoramaFilename) {
        totalNoMatch++;
        continue;
      }

      // Check cache first
      if (uploadCache.has(panoramaFilename)) {
        const cachedUrl = uploadCache.get(panoramaFilename);
        items[i] = { ...unit, imagen_panoramica: cachedUrl };
        sceneUpdated = true;
        totalMigrated++;
        console.log(`   ✅ Unit "${unitId}" → cached "${panoramaFilename}"`);
        continue;
      }

      // Read and upload the file
      const filePath = resolve(PANORAMAS_DIR, panoramaFilename);
      try {
        const fileData = readFileSync(filePath);
        const storagePath = `scenes/${sceneId}/panoramas/${panoramaFilename}`;
        const fileRef = storageRef(storage, storagePath);

        console.log(`   ⬆️  Uploading "${panoramaFilename}" (${(fileData.length / 1024).toFixed(0)} KB)...`);
        await uploadBytes(fileRef, fileData, { contentType: 'image/jpeg' });
        const downloadUrl = await getDownloadURL(fileRef);

        // Cache the URL
        uploadCache.set(panoramaFilename, downloadUrl);

        // Update unit
        items[i] = { ...unit, imagen_panoramica: downloadUrl };
        sceneUpdated = true;
        totalMigrated++;
        console.log(`   ✅ Unit "${unitId}" → "${panoramaFilename}" uploaded`);
      } catch (err) {
        console.error(`   ❌ Error for unit "${unitId}" / file "${panoramaFilename}":`, err.message);
        totalErrors++;
      }
    }

    if (sceneUpdated) {
      console.log(`   💾 Saving updated items for scene "${scene.name}"...`);
      await set(ref(db, `scenes/${sceneId}/unidades/items`), items);
      console.log(`   ✅ Scene "${scene.name}" saved.`);
    }
  }

  console.log('\n═══════════════════════════════════════');
  console.log(`✅ Migrated:   ${totalMigrated}`);
  console.log(`⏭  Skipped:    ${totalSkipped}`);
  console.log(`🔍 No match:   ${totalNoMatch}`);
  console.log(`📦 Uploaded:   ${uploadCache.size} unique files`);
  console.log(`❌ Errors:     ${totalErrors}`);
  console.log('═══════════════════════════════════════\n');

  process.exit(totalErrors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('💥 Fatal error:', err);
  process.exit(1);
});
