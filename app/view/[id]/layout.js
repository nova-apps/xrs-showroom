// Server layout para /view/[id]: genera el metadata (título / Open Graph) que leen los
// previews al compartir el link. La página es 'use client' y no puede exportar metadata,
// así que el título "nombre del proyecto" se resuelve acá, del lado del servidor.
//
// Trae el nombre desde RTDB por REST (sin SDK): prefiere el publicado, cae al borrador.

const DB_URL = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL || '';

async function fetchSceneName(id) {
  if (!DB_URL || !id) return null;
  const base = DB_URL.replace(/\/$/, '');
  for (const path of [`scenes/${id}/published/name`, `scenes/${id}/name`]) {
    try {
      const res = await fetch(`${base}/${path}.json`, { cache: 'no-store' });
      if (!res.ok) continue;
      const v = await res.json();
      if (typeof v === 'string' && v.trim()) return v.trim();
    } catch {
      /* sigue al fallback */
    }
  }
  return null;
}

export async function generateMetadata({ params }) {
  const { id } = await params;
  const name = await fetchSceneName(id);
  const title = name || 'XRS';
  // Sin descripción: el link compartido muestra solo el nombre del proyecto.
  return {
    title,
    description: null,
    openGraph: { title, description: undefined },
    twitter: { card: 'summary', title, description: undefined },
  };
}

export default function ViewLayout({ children }) {
  return children;
}
