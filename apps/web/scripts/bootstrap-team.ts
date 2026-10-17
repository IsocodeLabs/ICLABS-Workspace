/**
 * Runs after migrations on every deploy (Cloud Run job). Idempotent:
 * - BOOTSTRAP_ADMIN_EMAILS: these people are active admins on the team allow-list.
 * - BOOTSTRAP_INITIAL_PASSWORD (from Secret Manager): their starting password, set only when
 *   they don't have one yet, so a password someone changed is never overwritten.
 * - BOOTSTRAP_DEACTIVATE_EMAILS: taken off the allow-list (they can't sign in).
 * Lists accept commas or spaces. Nothing here prints a password.
 */
import { and, eq, accounts, createDb, teamMembers, users } from "@iclabs/db";
import { hashPassword } from "../src/server/auth/password-hash";

const list = (v: string | undefined) =>
  (v ?? "")
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const db = createDb(url, { max: 1 });
const admins = list(process.env.BOOTSTRAP_ADMIN_EMAILS);
const deactivate = list(process.env.BOOTSTRAP_DEACTIVATE_EMAILS).filter((e) => !admins.includes(e));
const initialPassword = process.env.BOOTSTRAP_INITIAL_PASSWORD?.trim() || null;

for (const email of admins) {
  await db
    .insert(teamMembers)
    .values({ email, role: "admin", active: true })
    .onConflictDoUpdate({ target: teamMembers.email, set: { role: "admin", active: true } });
  let [user] = await db.select({ id: users.id, kind: users.kind }).from(users).where(eq(users.email, email));
  if (!user) {
    [user] = await db
      .insert(users)
      .values({ email, name: email.split("@")[0]!, kind: "team", emailVerified: true })
      .returning({ id: users.id, kind: users.kind });
  }
  if (user!.kind !== "team") {
    console.warn(`Skipped password for ${email}: that address belongs to a candidate account.`);
    continue;
  }
  const [cred] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, user!.id), eq(accounts.providerId, "credential")));
  if (!cred && initialPassword) {
    await db.insert(accounts).values({
      userId: user!.id,
      accountId: user!.id,
      providerId: "credential",
      password: await hashPassword(initialPassword),
    });
    console.log(`Admin ready with starting password: ${email}`);
  } else {
    console.log(`Admin ready: ${email}${cred ? " (password already set)" : ""}`);
  }
}

for (const email of deactivate) {
  await db.update(teamMembers).set({ active: false }).where(eq(teamMembers.email, email));
  console.log(`Removed from team list: ${email}`);
}
process.exit(0);
