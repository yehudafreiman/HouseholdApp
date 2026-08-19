import { redirect } from "next/navigation";
import { headers } from "next/headers";
import JoinGroupClient from "./join-group-client";

export default async function JoinPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const headersList = await headers();
  const userId = headersList.get("x-user-id");

  if (!userId) {
    redirect(`/login?next=${encodeURIComponent(`/join/${code}`)}`);
  }

  return <JoinGroupClient code={code} />;
}
