/** Runs once when a server instance starts (Next.js instrumentation hook). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production") return;
  // In the background: the server starts taking requests straight away.
  const { ensureCareersRoles } = await import("./server/hiring/ensure-roles");
  void ensureCareersRoles();
}
