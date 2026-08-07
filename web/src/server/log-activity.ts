import { db } from "@/server/db";

export async function logActivity(userId: string, category: string, message: string): Promise<void> {
  await db.activityEvent.create({ data: { userId, category, message } });
}
