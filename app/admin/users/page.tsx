import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { UserManagementList } from "@/components/UserManagementList";

export const dynamic = "force-dynamic";
export const metadata = { title: "Users · Revibe Knowledge Base" };

export default async function UsersPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  if (user.role !== "owner") {
    // Only Owner can manage roles. Admins land back on their own dashboard.
    redirect("/admin");
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="revibe-label text-[13px]">Users</h1>
        <p className="mt-1 text-[12px]" style={{ color: "var(--revibe-ink-muted)" }}>
          Promote a member to Admin so they can review feedback corrections. Demote them back to
          Member when they no longer need review access. Only the Owner can do this; the Owner
          can&apos;t be demoted.
        </p>
      </div>
      <UserManagementList />
    </div>
  );
}
