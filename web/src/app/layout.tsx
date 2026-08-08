import type { Metadata } from "next";
import { Inter } from "next/font/google";
import * as React from "react";
import { Providers } from "@/components/providers";
import { GoogleAnalyticsScripts } from "@/components/analytics/google-analytics-scripts";
import { AnalyticsListener } from "@/components/analytics/analytics-listener";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: {
    default: "ADASOS -- Ascent Digital AI SEO Operating System",
    template: "%s · ADASOS",
  },
  description: "The AI-powered SEO operating system: orchestrated specialist agents for SEO, content, outreach, and client operations.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans`}>
        <GoogleAnalyticsScripts />
        <React.Suspense fallback={null}>
          <AnalyticsListener />
        </React.Suspense>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
