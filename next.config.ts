import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["firebase-admin", "jwks-rsa", "jose"],
  // The app is embedded into revibe.training.hub via an iframe pointed at ?embed=1.
  // Default-deny framing, then allow the hub explicitly.
  async headers() {
    const hub = process.env.EMBED_ALLOWED_ORIGIN;
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `frame-ancestors 'self'${hub ? ` ${hub}` : ""};`,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
