import type { ReactNode } from "react";
import { redirectIfMaintenance } from "@/server/maintenance";

/** Sign-in and password pages: closed to candidates during maintenance. */
export default async function AuthLayout({ children }: { children: ReactNode }) {
  await redirectIfMaintenance();
  return children;
}
