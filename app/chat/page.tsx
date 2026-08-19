import { redirect } from "next/navigation";

// Chat is now group-scoped at /groups/[groupId]/chat. This route is kept
// only so old bookmarks/home-screen shortcuts still land somewhere useful —
// /groups redirects straight into the user's single group, or shows a
// picker if they have several.
export default function ChatRedirectPage() {
  redirect("/groups");
}
