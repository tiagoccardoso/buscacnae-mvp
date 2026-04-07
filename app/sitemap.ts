import type { MetadataRoute } from "next";
import { getBaseUrl } from "@/lib/env";
import { useCasePages } from "@/lib/site-content";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = getBaseUrl();
  const staticRoutes = [
    "",
    "/pricing",
    "/onboarding",
    "/faq",
    "/dados",
    "/sobre",
    "/contato",
    "/privacidade",
    "/termos"
  ];

  return [
    ...staticRoutes.map((path) => ({
      url: `${baseUrl}${path || "/"}`,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: path === "" ? 1 : 0.8
    })),
    ...useCasePages.map((page) => ({
      url: `${baseUrl}/solucoes/${page.slug}`,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: 0.75
    }))
  ];
}
