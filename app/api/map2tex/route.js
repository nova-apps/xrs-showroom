/**
 * API Route — Generate satellite floor texture using Map2Tex.
 *
 * POST /api/map2tex
 * Body: { url | lat+lng, zoom?, size?, ratio? }
 * Returns: WebP image blob (lossy q90)
 *
 * POST /api/map2tex?preview=1
 * Returns: low-res JPEG preview (512px, zoom-2)
 */

import { exec } from 'child_process';
import { readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const MAP2TEX_SCRIPT = 'C:/Users/seba/OneDrive/Documentos/ClaudeCode/Map2Tex/map2tex.py';

export async function POST(request) {
  let outputPath = null;

  try {
    const { searchParams } = new URL(request.url);
    const isPreview = searchParams.get('preview') === '1';

    const body = await request.json();
    const { url, lat, lng, zoom = 19, size = 4096, ratio = '1:1' } = body;

    // Accept either url or lat+lng
    const location = url || (lat != null && lng != null ? `${lat},${lng}` : null);
    if (!location) {
      return Response.json({ error: 'Missing location (url or lat+lng)' }, { status: 400 });
    }

    const ts = Date.now();
    const actualZoom = isPreview ? Math.max(1, parseInt(zoom) - 2) : Math.max(1, Math.min(21, parseInt(zoom)));
    const actualSize = isPreview ? 512 : parseInt(size);
    const ext = isPreview ? 'jpg' : 'webp';

    outputPath = join(tmpdir(), `map2tex_${ts}.${ext}`);

    const cmd = [
      'python',
      `"${MAP2TEX_SCRIPT}"`,
      `--ratio ${ratio}`,
      `--zoom ${actualZoom}`,
      `--size ${actualSize}`,
      `--output "${outputPath}"`,
      `--`,
      `"${location}"`,
    ].join(' ');

    console.log(`[Map2Tex] ${isPreview ? 'Preview' : 'Generate'}:`, cmd);

    await new Promise((resolve, reject) => {
      exec(cmd, { timeout: 180_000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (stdout) console.log('[Map2Tex]', stdout);
        if (stderr) console.error('[Map2Tex stderr]', stderr);
        if (error) reject(error);
        else resolve(stdout);
      });
    });

    const imageBuffer = await readFile(outputPath);
    unlink(outputPath).catch(() => {});

    const contentType = isPreview ? 'image/jpeg' : 'image/webp';
    const filename = `satellite_floor_${ts}.${ext}`;

    return new Response(imageBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    if (outputPath) unlink(outputPath).catch(() => {});
    console.error('[Map2Tex] Error:', err);
    return Response.json(
      { error: err.message || 'Map2Tex generation failed' },
      { status: 500 }
    );
  }
}
