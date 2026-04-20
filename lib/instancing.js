/**
 * Instancing module — detects repeated geometries in a model and
 * converts them to InstancedMesh for dramatically fewer draw calls.
 *
 * Algorithm:
 *   1. Traverse all meshes, generate a geometry hash (vertex count + index count + attribute layout)
 *   2. Group meshes with identical hashes
 *   3. For groups with >= minInstances members (and single material), create InstancedMesh
 *   4. Remove original meshes from scene graph
 *
 * Safety: Only instances meshes with a single material (no multi-material).
 * Preserves the material of the first mesh in each group.
 */

/**
 * Detect repeated geometries and convert to InstancedMesh.
 * @param {THREE.Object3D} model - The model to process
 * @param {object} THREE - Three.js module
 * @param {object} [options]
 * @param {number} [options.minInstances=3] - Minimum copies to trigger instancing
 * @returns {{ groupsCreated: number, meshesInstanced: number, drawCallsSaved: number }}
 */
export function applyInstancing(model, THREE, options = {}) {
  const minInstances = options.minInstances || 3;

  // Step 1: Collect all meshes and hash their geometries
  const meshGroups = new Map(); // hash → [{ mesh, parent }]

  model.traverse((child) => {
    if (!child.isMesh || !child.geometry) return;

    // Skip multi-material meshes (too complex to instance)
    if (Array.isArray(child.material)) return;

    // Skip transparent/glass meshes (they have special render order handling)
    if (child.material.transparent && child.material.transmission > 0) return;

    const geo = child.geometry;
    const hash = computeGeometryHash(geo);

    if (!meshGroups.has(hash)) {
      meshGroups.set(hash, []);
    }
    meshGroups.get(hash).push(child);
  });

  // Step 2: Create InstancedMesh for qualifying groups
  let groupsCreated = 0;
  let meshesInstanced = 0;
  let drawCallsSaved = 0;

  for (const [hash, meshes] of meshGroups) {
    if (meshes.length < minInstances) continue;

    // Verify all meshes use compatible materials (same type)
    const firstMat = meshes[0].material;
    const allCompatible = meshes.every(
      (m) => m.material.type === firstMat.type
    );
    if (!allCompatible) continue;

    try {
      // Create InstancedMesh with the geometry and material of the first mesh
      const instancedMesh = new THREE.InstancedMesh(
        meshes[0].geometry,
        firstMat.clone(), // Clone to avoid shared material issues
        meshes.length
      );

      instancedMesh.name = `__instanced_${hash.substring(0, 8)}_x${meshes.length}`;
      instancedMesh.frustumCulled = true;
      instancedMesh.castShadow = false;
      instancedMesh.receiveShadow = false;
      instancedMesh.renderOrder = meshes[0].renderOrder;

      // Copy each mesh's world transform into the instance buffer
      const matrix = new THREE.Matrix4();
      for (let i = 0; i < meshes.length; i++) {
        meshes[i].updateWorldMatrix(true, false);
        matrix.copy(meshes[i].matrixWorld);

        // If the model has a parent (wrapper), we need transforms relative to wrapper
        if (model.matrixWorld) {
          const inverseParent = new THREE.Matrix4().copy(model.matrixWorld).invert();
          matrix.premultiply(inverseParent);
        }

        instancedMesh.setMatrixAt(i, matrix);
      }

      instancedMesh.instanceMatrix.needsUpdate = true;

      // Compute bounding sphere for frustum culling
      instancedMesh.computeBoundingBox();
      instancedMesh.computeBoundingSphere();

      // Remove original meshes from scene graph
      for (const mesh of meshes) {
        if (mesh.parent) {
          mesh.parent.remove(mesh);
          // Dispose geometry only if it's not shared (it is shared here, so skip)
          // The material was cloned, so the originals on the removed meshes are unused
          mesh.material.dispose();
        }
      }

      // Add InstancedMesh to the model
      model.add(instancedMesh);

      groupsCreated++;
      meshesInstanced += meshes.length;
      drawCallsSaved += meshes.length - 1; // 1 draw call instead of N
    } catch (err) {
      console.warn(`[Instancing] Failed to instance group ${hash}:`, err);
    }
  }

  if (groupsCreated > 0) {
    console.log(
      `[Instancing] Created ${groupsCreated} instanced groups from ${meshesInstanced} meshes ` +
      `(saved ${drawCallsSaved} draw calls)`
    );
  } else {
    console.log('[Instancing] No repeated geometries found for instancing');
  }

  return { groupsCreated, meshesInstanced, drawCallsSaved };
}

/**
 * Generate a hash for a geometry based on its structure.
 * Uses vertex count, index count, and attribute layout for fast comparison.
 * For higher accuracy, samples the first few vertices.
 */
function computeGeometryHash(geometry) {
  const pos = geometry.attributes.position;
  const idx = geometry.getIndex();
  const posCount = pos ? pos.count : 0;
  const idxCount = idx ? idx.count : 0;

  // Attribute layout signature
  const attrKeys = Object.keys(geometry.attributes).sort().join(',');

  // Sample first 3 vertices for extra precision (avoids false matches
  // between different meshes that happen to have the same vertex count)
  let sample = '';
  if (pos && posCount >= 3) {
    for (let i = 0; i < Math.min(3, posCount); i++) {
      // Round to 3 decimal places to handle floating point noise
      const x = Math.round(pos.getX(i) * 1000);
      const y = Math.round(pos.getY(i) * 1000);
      const z = Math.round(pos.getZ(i) * 1000);
      sample += `${x},${y},${z}|`;
    }
  }

  return `${posCount}_${idxCount}_${attrKeys}_${sample}`;
}
