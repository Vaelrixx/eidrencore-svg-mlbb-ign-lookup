import "server-only";
import { requireUser } from "@/lib/platform";

/** The signed-in Supabase user for server components, or null. Never throws. */
export async function getSessionUser() {
  try {
    const { user } = await requireUser();
    return user;
  } catch {
    return null;
  }
}
