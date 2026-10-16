/**
 * Local/staging seed: the three Cycle 1 roles, an admin allow-list entry, and two test
 * candidates. Prints the candidates' temporary passwords, which is why it refuses to run
 * in production.
 *
 *   SEED_ADMIN_EMAIL=you@isocodelabs.com pnpm db:seed
 */
import { createDb, cycles, roles, teamMembers, workflows, applications } from "@iclabs/db";
import { createCandidateAccount } from "../src/server/auth/candidate-auth";

if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed production");
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? "admin@isocodelabs.com").toLowerCase();

const db = createDb(url);

const ROLES = [
  { slug: "bdi", title: "Business Development Intern", seats: 10 },
  { slug: "sde", title: "SDE Intern", seats: 5 },
  { slug: "pm", title: "PM Intern", seats: 5 },
];

const tracks: Record<string, string> = {};
for (const r of ROLES) {
  const [role] = await db.insert(roles).values(r).onConflictDoNothing().returning();
  if (!role) continue;
  const [cycle] = await db
    .insert(cycles)
    .values({ roleId: role.id, name: "Cycle 1", status: "open" })
    .returning();
  const [wf] = await db
    .insert(workflows)
    .values({ cycleId: cycle!.id, name: "Main", isDefault: true })
    .returning();
  tracks[r.slug] = `${role.id}|${wf!.id}`;
}

await db.insert(teamMembers).values({ email: adminEmail, role: "admin" }).onConflictDoNothing();
console.log(`Admin allow-listed: ${adminEmail} (sign in with Google at /team/login)`);

const testCandidates = [
  { email: "test.candidate1@example.com", name: "Test Candidate One", roles: ["sde", "pm"] },
  { email: "test.candidate2@example.com", name: "Test Candidate Two", roles: ["bdi"] },
];
for (const c of testCandidates) {
  try {
    const { candidateId, tempPassword } = await createCandidateAccount(db, c);
    for (const slug of c.roles) {
      const track = tracks[slug];
      if (!track) continue;
      const [roleId, workflowId] = track.split("|") as [string, string];
      await db.insert(applications).values({ candidateId, roleId, workflowId, testMode: true });
    }
    console.log(
      `Candidate ${c.email} → temp password ${tempPassword} (roles: ${c.roles.join(", ")})`,
    );
  } catch {
    console.log(`Candidate ${c.email} already exists; skipped`);
  }
}

process.exit(0);
