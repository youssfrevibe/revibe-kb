import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // firebase-admin is a Node-native SDK. `transpilePackages` (which we tried
  // first) makes Turbopack rebundle it, which breaks the ESM/CJS chain
  // between firebase-admin/auth → jwks-rsa → jose and produces:
  //   ERR_REQUIRE_ESM: require() of ES Module .../jose/dist/webapi/index.js
  //   from .../jwks-rsa/src/utils.js not supported
  // The correct escape hatch is `serverExternalPackages`, which tells Next
  // NOT to bundle these — Node's own resolver loads them at runtime, using
  // whatever version is on disk in node_modules. Combined with the
  // package.json `overrides` pinning jose to ^4 (CJS), jwks-rsa can require()
  // it without the ERR_REQUIRE_ESM crash.
  serverExternalPackages: [
    "firebase-admin",
    "jwks-rsa",
    "jose",
    "@grpc/grpc-js",
    "@grpc/proto-loader",
  ],

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
