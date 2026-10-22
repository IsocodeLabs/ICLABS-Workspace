import { Bot, Check, ShieldCheck, X } from "lucide-react";
import { Alert, AuthShell } from "@/components/ui";
import { db } from "@/server/db";
import { requireTeam } from "@/server/auth/session";
import { checkAuthorizeRequest, mcpEnabled } from "@/server/mcp/oauth";
import { Consent } from "./consent";

const CAN = [
  "Read pipelines, submissions, scores, metrics and the question bank",
  "Save drafts: questions, process changes, suggested review scores",
  "Prepare bulk decisions and interview lists for you to confirm here",
];
const CANNOT = [
  "Advance, reject, email or schedule anyone without your confirmation",
  "Publish a process",
];

/** OAuth consent for connecting Claude to the admin MCP server. */
export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { actor, session } = await requireTeam();
  const raw = await searchParams;
  const params = Object.fromEntries(
    Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === "string"),
  );
  if (actor.role !== "admin")
    return (
      <AuthShell title="Admins only">
        <Alert>Only workspace admins can connect Claude to the workspace.</Alert>
      </AuthShell>
    );
  if (!(await mcpEnabled(db())))
    return (
      <AuthShell title="Claude access is turned off">
        <Alert>An admin has turned off the workspace MCP server in Settings.</Alert>
      </AuthShell>
    );
  const req = await checkAuthorizeRequest(db(), params);
  if (!req.ok)
    return (
      <AuthShell title="Can't connect">
        <Alert>{req.error}</Alert>
      </AuthShell>
    );
  return (
    <AuthShell
      title={`Connect ${req.client.name}?`}
      subtitle={`Signed in as ${session.user.email}. It will act as you, and every call is logged.`}
    >
      <p className="mb-2 flex items-center gap-2 font-semibold">
        <Bot size={18} aria-hidden /> Claude will be able to
      </p>
      <ul className="space-y-1.5 text-sm">
        {CAN.map((c) => (
          <li key={c} className="flex gap-2">
            <Check size={16} className="mt-0.5 shrink-0 text-success-fg" aria-hidden />
            {c}
          </li>
        ))}
      </ul>
      <p className="mt-4 mb-2 flex items-center gap-2 font-semibold">
        <ShieldCheck size={18} aria-hidden /> It can&apos;t
      </p>
      <ul className="space-y-1.5 text-sm">
        {CANNOT.map((c) => (
          <li key={c} className="flex gap-2">
            <X size={16} className="mt-0.5 shrink-0 text-danger-fg" aria-hidden />
            {c}
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-muted">
        Returns to {new URL(req.redirectUri).host}. Revoke any time in Settings → Claude access.
      </p>
      <Consent params={params} />
    </AuthShell>
  );
}
