import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { isMobileRequest } from "@/server/request";

/**
 * Wraps assessment and task pages (M4). Phones are turned away on the server; narrow
 * windows on any device get the same notice via CSS, so the content never renders cramped.
 */
export async function DesktopOnly({ children }: { children: ReactNode }) {
  const t = await getTranslations("desktopOnly");
  const notice = (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="font-display text-2xl font-bold">{t("title")}</h1>
      <p className="mt-3 text-muted">{t("body")}</p>
    </div>
  );
  if (await isMobileRequest()) return notice;
  return (
    <>
      <div className="lg:hidden">{notice}</div>
      <div className="hidden lg:block">{children}</div>
    </>
  );
}
