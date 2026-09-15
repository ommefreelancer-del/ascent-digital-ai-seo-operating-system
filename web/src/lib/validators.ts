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
  // WORKSPACE FILE ATTACHMENT CAPABILITY: a real, already-uploaded Attachment's id (see
  // server/backend/attachments.ts) -- ownership is re-verified server-side in
  // workspace/messages/route.ts before it is ever linked to a task; this schema only checks shape.
  attachmentId: z.string().optional(),
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

export const urlInspectionSchema = z.object({
  url: z.string().trim().url("Enter a valid URL, including https://"),
  siteUrl: z.string().trim().optional(),
});
export type UrlInspectionInput = z.infer<typeof urlInspectionSchema>;

export const googleSheetsValuesSchema = z.object({
  spreadsheetId: z.string().trim().min(1, "Choose a spreadsheet."),
  range: z.string().trim().min(1, "Enter a range, e.g. \"Sheet1!A1:D10\"."),
});
export type GoogleSheetsValuesInput = z.infer<typeof googleSheetsValuesSchema>;

export const googleSheetsWriteDestinationSchema = z.object({
  spreadsheetId: z.string().trim().min(1, "Choose a spreadsheet."),
});
export type GoogleSheetsWriteDestinationInput = z.infer<typeof googleSheetsWriteDestinationSchema>;

export const prospectSchema = z.object({
  domain: z.string().trim().min(1, "Enter a domain."),
  companyName: z.string().trim().max(200).optional().or(z.literal("")),
  contactName: z.string().trim().max(200).optional().or(z.literal("")),
  email: z.string().trim().email("Enter a valid email address.").optional().or(z.literal("")),
  source: z.string().trim().max(80).optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});
export type ProspectInput = z.infer<typeof prospectSchema>;

export const campaignTrackingSchema = z.object({
  campaignName: z.string().trim().min(1, "Enter a campaign name."),
  campaignUpdates: z
    .array(
      z.object({
        date: z.string().trim().min(1, "Enter a date."),
        description: z.string().trim().min(1, "Enter a description."),
      }),
    )
    .max(50)
    .optional(),
});
export type CampaignTrackingInput = z.infer<typeof campaignTrackingSchema>;

export const prospectUpdateSchema = z.object({
  qualificationStatus: z.enum(["pending", "qualified", "rejected"]).optional(),
  outreachStatus: z.enum(["not-contacted", "drafted", "sent", "replied", "follow-up-due", "closed"]).optional(),
  nextFollowUpAt: z.string().trim().optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
  outcome: z.string().trim().max(120).optional().or(z.literal("")),
});
export type ProspectUpdateInput = z.infer<typeof prospectUpdateSchema>;

export const gmailDraftSchema = z.object({
  to: z.string().trim().email("Enter a valid recipient email address."),
  subject: z.string().trim().min(1, "Enter a subject."),
  body: z.string().trim().min(1, "Enter the email body."),
});
export type GmailDraftInput = z.infer<typeof gmailDraftSchema>;

const pixabaySharedSearchFields = {
  query: z.string().trim().max(100).optional().or(z.literal("")),
  language: z.string().trim().max(10).optional().or(z.literal("")),
  category: z.string().trim().max(40).optional().or(z.literal("")),
  minWidth: z.coerce.number().int().min(0).max(10000).optional(),
  minHeight: z.coerce.number().int().min(0).max(10000).optional(),
  safeSearch: z.coerce.boolean().optional(),
  order: z.enum(["popular", "latest"]).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  perPage: z.coerce.number().int().min(3).max(200).default(20),
};

export const pixabayImageSearchSchema = z.object({
  ...pixabaySharedSearchFields,
  imageType: z.enum(["all", "photo", "illustration", "vector"]).optional(),
  orientation: z.enum(["all", "horizontal", "vertical"]).optional(),
});
export type PixabayImageSearchInput = z.infer<typeof pixabayImageSearchSchema>;

export const pixabayVideoSearchSchema = z.object({
  ...pixabaySharedSearchFields,
  videoType: z.enum(["all", "film", "animation"]).optional(),
});
export type PixabayVideoSearchInput = z.infer<typeof pixabayVideoSearchSchema>;

export const pixabayDownloadSchema = z.object({
  id: z.coerce.number().int().positive(),
  url: z.string().trim().url("Enter a valid asset URL."),
  type: z.enum(["image", "video"]),
});
export type PixabayDownloadInput = z.infer<typeof pixabayDownloadSchema>;

export const wordPressConnectSchema = z.object({
  siteUrl: z.string().trim().min(3, "Enter your WordPress site URL."),
});
export type WordPressConnectInput = z.infer<typeof wordPressConnectSchema>;

export const wordPressSelectSiteSchema = z.object({
  siteId: z.string().trim().min(1, "Choose a site."),
});
export type WordPressSelectSiteInput = z.infer<typeof wordPressSelectSiteSchema>;

export const wordPressManualConnectSchema = z.object({
  siteUrl: z.string().trim().min(3, "Enter your WordPress site URL."),
  username: z.string().trim().min(1, "Enter the WordPress username."),
  appPassword: z.string().trim().min(1, "Enter the generated Application Password."),
});
export type WordPressManualConnectInput = z.infer<typeof wordPressManualConnectSchema>;

const wordPressContentTypeSchema = z.enum(["post", "page"]).default("post");

export const wordPressDraftCreateSchema = z.object({
  title: z.string().trim().min(1, "Enter a title."),
  content: z.string().trim().min(1, "Enter the content."),
  excerpt: z.string().trim().max(2000).optional().or(z.literal("")),
  type: wordPressContentTypeSchema,
});
export type WordPressDraftCreateInput = z.infer<typeof wordPressDraftCreateSchema>;

export const wordPressContentUpdateSchema = z.object({
  title: z.string().trim().min(1).optional(),
  content: z.string().trim().min(1).optional(),
  excerpt: z.string().trim().max(2000).optional().or(z.literal("")),
  featuredMediaId: z.coerce.number().int().positive().optional(),
  type: wordPressContentTypeSchema,
  confirm: z.boolean().optional(),
});
export type WordPressContentUpdateInput = z.infer<typeof wordPressContentUpdateSchema>;

export const wordPressPublishSchema = z.object({
  type: wordPressContentTypeSchema,
  confirm: z.literal(true, { message: "Explicit confirmation is required to publish (confirm: true)." }),
});
export type WordPressPublishInput = z.infer<typeof wordPressPublishSchema>;

/** Requires an explicit `{ confirm: true }` body on BOTH approve and reject -- this is never inferred from conversational text or any other implicit signal (a real production-affecting decision must be a real, deliberate client action). */
export const remediationApprovalDecisionSchema = z.object({
  confirm: z.literal(true, { message: "Explicit confirmation is required (confirm: true)." }),
});
export type RemediationApprovalDecisionInput = z.infer<typeof remediationApprovalDecisionSchema>;

export const wordPressListContentSchema = z.object({
  type: wordPressContentTypeSchema,
  status: z.string().trim().max(40).optional(),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(10),
});
export type WordPressListContentInput = z.infer<typeof wordPressListContentSchema>;

export const googleAnalyticsSelectPropertySchema = z.object({
  propertyId: z.string().trim().min(1, "Choose a property."),
  displayName: z.string().trim().max(200).optional().or(z.literal("")),
});
export type GoogleAnalyticsSelectPropertyInput = z.infer<typeof googleAnalyticsSelectPropertySchema>;

export const googleAnalyticsReportSchema = z.object({
  propertyId: z.string().trim().min(1, "Choose a property."),
  startDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD."),
  endDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD."),
});
export type GoogleAnalyticsReportInput = z.infer<typeof googleAnalyticsReportSchema>;

export const seoPerformanceReportSchema = z.object({
  projectId: z.string().optional(),
  clientName: z.string().trim().min(2, "Enter a client name."),
  reportingPeriodLabel: z.string().trim().min(2, "Enter a reporting period label, e.g. \"July 2026\"."),
  url: z.string().trim().url("Enter a valid URL, including https://"),
});
export type SeoPerformanceReportInput = z.infer<typeof seoPerformanceReportSchema>;
