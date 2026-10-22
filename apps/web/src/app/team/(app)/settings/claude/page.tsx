import { eq, users } from "@iclabs/db";
import { formatIst } from "@iclabs/core";
import { Card, Page, PageHeader } from "@/components/admin";
import { StatusPill } from "@/components/ui";
import { db } from "@/server/db";
import { requireTeam } from "@/server/auth/session";
import { appUrl } from "@/server/email";
import { listGrants, mcpEnabled } from "@/server/mcp/oauth";
import { KillSwitch, RevokeGrant } from "./controls";

export default async function ClaudeAccessPage() {
  const { actor } = await requireTeam(["admin"]);
  const [enabled, grants, people] = await Promise.all([
    mcpEnabled(db()),
    listGrants(db(), actor),
    db().select({ id: users.id, email: users.email }).from(users).where(eq(users.kind, "team")),
  ]);
  const url = appUrl("/mcp");
  return (
    <Page>
      <PageHeader
        title="Claude access"
        subtitle="Admins can connect Claude to the workspace (MCP). Claude reads and drafts; anything that affects a candidate waits for your confirmation here."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="font-display text-lg font-bold">Connect</h2>
          <p className="mt-1 text-sm text-muted">
            Add a custom connector in Claude (claude.ai, Claude Desktop or Claude Code) with this
            URL, then sign in with Google:
          </p>
          <code className="mt-3 block break-all rounded-xl bg-neutral-bg px-3 py-2 text-sm">
            {url}
          </code>
          <p className="mt-3 text-sm text-muted">Claude Code:</p>
          <code className="mt-1 block break-all rounded-xl bg-neutral-bg px-3 py-2 text-sm">
            claude mcp add --transport http isocode {url}
          </code>
        </Card>
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-bold">Workspace switch</h2>
              <p className="mt-1 text-sm text-muted">
                Turning this off stops every connected Claude client at once.
              </p>
            </div>
            <StatusPill tone={enabled ? "success" : "danger"}>{enabled ? "On" : "Off"}</StatusPill>
          </div>
          <div className="mt-4">
            <KillSwitch enabled={enabled} />
          </div>
        </Card>
      </div>
      <h2 className="on-liquid mt-8 mb-3 font-display text-xl font-bold">Connected clients</h2>
      {grants.length === 0 ? (
        <p className="on-liquid">Nothing connected yet.</p>
      ) : (
        <Card className="divide-y divide-border p-0">
          {grants.map((g) => (
            <div key={g.id} className="flex flex-wrap items-center gap-4 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{g.clientName}</p>
                <p className="text-sm text-muted">
                  {people.find((p) => p.id === g.userId)?.email ?? "?"} · connected{" "}
                  {formatIst(g.createdAt)} · last used{" "}
                  {g.lastUsedAt ? formatIst(g.lastUsedAt) : "never"}
                </p>
              </div>
              <RevokeGrant grantId={g.id} label={g.clientName} />
            </div>
          ))}
        </Card>
      )}
    </Page>
  );
}
