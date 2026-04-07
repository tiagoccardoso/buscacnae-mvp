import type { Metadata } from "next";
import { getAppName, getBaseUrl } from "@/lib/env";

type BuildPageMetadataArgs = {
  title: string;
  description: string;
  path?: string;
  keywords?: string[];
  robots?: Metadata["robots"];
};

export function buildPageMetadata({
  title,
  description,
  path = "/",
  keywords = [],
  robots
}: BuildPageMetadataArgs): Metadata {
  const appName = getAppName();
  const baseUrl = new URL(getBaseUrl());
  const canonical = new URL(path, baseUrl).toString();
  const fullTitle = `${title} | ${appName}`;

  return {
    metadataBase: baseUrl,
    title: fullTitle,
    description,
    keywords,
    alternates: {
      canonical
    },
    openGraph: {
      title: fullTitle,
      description,
      url: canonical,
      siteName: appName,
      locale: "pt_BR",
      type: "website"
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description
    },
    robots
  };
}
