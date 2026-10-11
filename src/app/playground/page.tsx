import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";

/**
 * The public site has no tool UI of its own: tools live in the console.
 * This stable entry point sends visitors to the right place.
 */
export const dynamic = "force-dynamic";

export default async function PlaygroundEntry() {
  const user = await getSessionUser();
  redirect(user ? "/dashboard/playground" : "/login?mode=signup&next=/dashboard/playground");
}
