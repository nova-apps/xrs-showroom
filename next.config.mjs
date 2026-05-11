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
};

export default nextConfig;
