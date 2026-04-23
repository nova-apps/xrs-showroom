import { NextResponse } from 'next/server';

const SESSION_COOKIE = 'xrs_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

/**
 * POST /api/auth — validate password, set session cookie.
 */
export async function POST(request) {
  try {
    const { password } = await request.json();
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminPassword) {
      return NextResponse.json(
        { error: 'Server misconfigured — ADMIN_PASSWORD not set' },
        { status: 500 }
      );
    }

    if (password !== adminPassword) {
      return NextResponse.json({ error: 'Contraseña incorrecta' }, { status: 401 });
    }

    // Generate a simple session token (timestamp + random hex)
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE,
    });

    return response;
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
}

/**
 * DELETE /api/auth — clear session cookie (logout).
 */
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return response;
}
