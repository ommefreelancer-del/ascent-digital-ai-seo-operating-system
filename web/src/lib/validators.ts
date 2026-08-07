import { z } from "zod";

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Enter your full name.").max(120),
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters.").max(200),
  companyName: z.string().trim().max(160).optional().or(z.literal("")),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1),
    password: z.string().min(8, "Password must be at least 8 characters.").max(200),
    confirmPassword: z.string().min(1),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const projectSchema = z.object({
  name: z.string().trim().min(2, "Project name is required.").max(160),
  domain: z.string().trim().max(200).optional().or(z.literal("")),
  niche: z.string().trim().max(120).optional().or(z.literal("")),
  status: z.enum(["active", "paused", "completed"]).default("active"),
});
export type ProjectInput = z.infer<typeof projectSchema>;

export const keywordResearchSchema = z.object({
  businessObjective: z.string().trim().min(5, "Describe your business objective."),
  seedKeywords: z.array(z.string().trim().min(1)).min(1, "Add at least one seed keyword.").max(20),
  targetAudience: z.string().trim().max(300).optional().or(z.literal("")),
});
export type KeywordResearchInput = z.infer<typeof keywordResearchSchema>;

export const seoAuditSchema = z.object({
  projectId: z.string().optional(),
  url: z.string().trim().url("Enter a valid URL, including https://"),
  targetKeyword: z.string().trim().min(1, "Enter a target keyword."),
});
export type SeoAuditInput = z.infer<typeof seoAuditSchema>;

export const contentGeneratorSchema = z.object({
  type: z.enum(["blog", "landing-page", "meta", "social"]),
  topic: z.string().trim().min(2, "Enter a topic or seed keyword."),
  businessObjective: z.string().trim().min(5, "Describe your business objective."),
  brandGuidelines: z.string().trim().max(1000).optional().or(z.literal("")),
});
export type ContentGeneratorInput = z.infer<typeof contentGeneratorSchema>;

export const chatMessageSchema = z.object({
  sessionId: z.string().optional(),
  message: z.string().trim().min(1, "Type a message."),
});
export type ChatMessageInput = z.infer<typeof chatMessageSchema>;

export const profileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  companyName: z.string().trim().max(160).optional().or(z.literal("")),
  jobTitle: z.string().trim().max(160).optional().or(z.literal("")),
});
export type ProfileInput = z.infer<typeof profileSchema>;

export const apiKeySchema = z.object({
  label: z.string().trim().min(2, "Give this key a label.").max(80),
});
export type ApiKeyInput = z.infer<typeof apiKeySchema>;

export const aiUsageReportSchema = z.object({
  periodDays: z.coerce.number().int().min(1).max(365).default(30),
});
export type AiUsageReportInput = z.infer<typeof aiUsageReportSchema>;

export const seoPerformanceReportSchema = z.object({
  projectId: z.string().optional(),
  clientName: z.string().trim().min(2, "Enter a client name."),
  reportingPeriodLabel: z.string().trim().min(2, "Enter a reporting period label, e.g. \"July 2026\"."),
  url: z.string().trim().url("Enter a valid URL, including https://"),
});
export type SeoPerformanceReportInput = z.infer<typeof seoPerformanceReportSchema>;
