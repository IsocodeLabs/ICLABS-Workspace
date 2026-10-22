import { Card, Page, PageHeader } from "@/components/admin";
import { requireTeam } from "@/server/auth/session";
import { ChangePasswordForm } from "./change-password-form";

export default async function TeamAccountPage() {
  const { session } = await requireTeam();
  return (
    <Page>
      <PageHeader title="Your account" subtitle={`Signed in as ${session.user.email}`} />
      <Card className="max-w-lg">
        <h2 className="font-display text-lg font-bold">Change password</h2>
        <p className="mt-1 mb-4 text-sm text-muted">
          At least 10 characters. Changing it signs you out everywhere else and emails you a
          confirmation.
        </p>
        <ChangePasswordForm />
      </Card>
    </Page>
  );
}
