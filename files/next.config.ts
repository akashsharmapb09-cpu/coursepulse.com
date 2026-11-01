import type { NextConfig } from "next";
import {
  HSTS_HEADER,
  STATIC_SECURITY_HEADERS,
} from "./src/lib/security/headers";

const isProduction = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false, // do not advertise the framework
  productionBrowserSourceMaps: false,
  async headers() {
    const headers = STATIC_SECURITY_HEADERS.map(([key, value]) => ({
      key,
      value,
    }));
    // HSTS only in production, and only once HTTPS is verified end-to-end (security.md §11, §14).
    if (isProduction)
      headers.push({ key: HSTS_HEADER[0], value: HSTS_HEADER[1] });
    return [{ source: "/:path*", headers }];
  },
};

export default nextConfig;
