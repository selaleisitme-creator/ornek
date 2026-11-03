/** @type {import('next').NextConfig} */
const nextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Root has no page of its own; the panel sends signed-out visitors on to /giris.
  async redirects() {
    return [{ source: "/", destination: "/panel", permanent: false }];
  },
};

export default nextConfig;
