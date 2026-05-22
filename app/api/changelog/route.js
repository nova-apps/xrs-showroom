import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-static';

/**
 * GET /api/changelog — returns the raw CHANGELOG.md so the staging banner
 * can render the full history client-side. The file is included in the
 * function bundle via `outputFileTracingIncludes` in next.config.mjs.
 */
export async function GET() {
  try {
    const filePath = path.join(process.cwd(), 'CHANGELOG.md');
    const text = await fs.readFile(filePath, 'utf-8');
    return new NextResponse(text, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Cache-Control': 'public, max-age=300, s-maxage=300',
      },
    });
  } catch (err) {
    console.error('[api/changelog] read failed:', err);
    return NextResponse.json({ error: 'CHANGELOG.md not found' }, { status: 404 });
  }
}
