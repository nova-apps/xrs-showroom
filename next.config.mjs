/** @type {import('next').NextConfig} */
const nextConfig = {
  // COOP/COEP headers will be applied selectively via middleware
  // to avoid blocking Firebase cross-origin requests on non-3D pages.

  // Allow Firebase Storage and CDN domains for images/assets
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'firebasestorage.googleapis.com' },
      { protocol: 'https', hostname: 'storage.googleapis.com' },
    ],
    qualities: [75, 90],
  },

  // Turbopack config (Next.js 16 default bundler)
  turbopack: {},

  // Allow HMR connections from 127.0.0.1 and LAN IPs in dev
  // (Next 16 blocks cross-origin dev resource access by default).
  allowedDevOrigins: ['127.0.0.1', '192.168.1.6'],

  // Ensure CHANGELOG.md ships with the function bundle so /api/changelog
  // can read it at runtime in the deployed Cloud Function.
  outputFileTracingIncludes: {
    '/api/changelog': ['./CHANGELOG.md'],
  },
};

export default nextConfig;
