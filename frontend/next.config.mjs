/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    // Proxy API calls to the FastAPI backend so the app works on your phone
    // (same origin, no CORS / mixed-host issues on the LAN).
    const api = process.env.API_BASE || "http://127.0.0.1:8000";
    return [
      { source: "/api/:path*", destination: `${api}/api/:path*` },
      { source: "/webhook", destination: `${api}/webhook` },
    ];
  },
};

export default nextConfig;
