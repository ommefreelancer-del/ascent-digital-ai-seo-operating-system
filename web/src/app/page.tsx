import { redirect } from "next/navigation";
import { getServerAuthSession } from "@/server/auth";

export default async function RootPage() {
  const session = await getServerAuthSession();
  redirect(session ? "/dashboard" : "/login");
}
