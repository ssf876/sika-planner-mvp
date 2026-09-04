import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The hosted demo sits behind a platform proxy whose x-forwarded-host
  // differs from the browser origin, which otherwise makes Next 15 abort
  // every Server Action (login/signup/transactions) with digest 3928600931.
  experimental: {
    serverActions: {
      allowedOrigins: ["1gvhztfrh0-4310.hosted.obvious.ai", "localhost:4310"],
    },
  },
};

export default nextConfig;
