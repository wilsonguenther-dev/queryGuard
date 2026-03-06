import { redirect } from "next/navigation";

/**
 * Root redirect — QueryGuard dashboard lives at /dashboard.
 */
export default function RootPage() {
  redirect("/dashboard");
}
