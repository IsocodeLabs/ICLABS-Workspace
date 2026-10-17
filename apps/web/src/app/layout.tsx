import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
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
          <svg width="0" height="0" style={{ position: "absolute" }}>
            <defs>
              <filter id="goo" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="22" result="blur" />
                <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 26 -11" />
              </filter>
            </defs>
          </svg>
          <div className="goo">
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
        </div>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
