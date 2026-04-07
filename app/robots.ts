import type { MetadataRoute } from "next";
import { getBaseUrl } from "@/lib/env";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = getBaseUrl();

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/dashboard", "/checkout", "/orders", "/sign-in"]
      }
    ],
    sitemap: `${baseUrl}/sitemap.xml`
  };
}
