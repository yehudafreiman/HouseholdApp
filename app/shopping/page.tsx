import { redirect } from "next/navigation";

// Shopping is now group-scoped at /groups/[groupId]/shopping. This route is
// kept only so old bookmarks/home-screen shortcuts still land somewhere
// useful — /groups redirects straight into the user's single group, or
// shows a picker if they have several.
export default function ShoppingRedirectPage() {
  redirect("/groups");
}
