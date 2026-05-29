import type { Metadata, Viewport } from "next";
import { Montserrat, Inter } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { AnalyticsIntentListener } from "@/components/analytics-intent-listener";
import { getAppName, getBaseUrl } from "@/lib/env";
import { getBusinessShortDescription } from "@/lib/site-content";

const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-montserrat",
  display: "swap",
  weight: ["600", "700", "800", "900"],
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};

export const metadata: Metadata = {
  metadataBase: new URL(getBaseUrl()),
  title: {
    default: `${getAppName()} | Listas B2B por CNAE e região`,
    template: `%s | ${getAppName()}`
  },
  description: getBusinessShortDescription(),
  openGraph: {
    title: `${getAppName()} | Listas B2B por CNAE e região`,
    description: getBusinessShortDescription(),
    siteName: getAppName(),
    locale: "pt_BR",
    type: "website"
  },
  twitter: {
    card: "summary_large_image",
    title: `${getAppName()} | Listas B2B por CNAE e região`,
    description: getBusinessShortDescription()
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className={`${montserrat.variable} ${inter.variable}`}>
      <body>
        <AnalyticsIntentListener />
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
