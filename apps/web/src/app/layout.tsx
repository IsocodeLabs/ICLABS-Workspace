import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { ErrorWatcher } from "@/components/error-watcher";
import { LiquidBackground } from "@/components/liquid-background";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("appName"), robots: { index: false, follow: false } };
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="liquid-bg" aria-hidden="true">
          <LiquidBackground />
        </div>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
        <ErrorWatcher />
      </body>
    </html>
  );
}
