/** @type {import('next').NextConfig} */
const nextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Root has no page of its own; proxy.js sends signed-out visitors on to /giris.
  // /panel was the first placeholder page and is kept as an alias for old bookmarks.
  async redirects() {
    return [
      { source: "/", destination: "/anasayfa", permanent: false },
      { source: "/panel", destination: "/anasayfa", permanent: false },
    ];
  },
};

export default nextConfig;
