// Semantic tracking helpers for ADASOS's own product events. Each one is a
// thin, fixed-shape call into trackEvent() -- centralized here so every call
// site uses the same event name and parameter keys instead of re-typing
// string literals ad hoc, which is how tracking silently drifts and starts
// double-counting or fragmenting the same event under different names.
//
// Deliberately excluded from every payload: message content, names, emails,
// full request URLs/query strings, and anything else that could be
// personally identifying. Only structural/aggregate data goes to GA.

import { trackEvent } from "./gtag";

export function trackLogin(method: "credentials"): void {
  trackEvent("login", { method });
}

export function trackSignUp(method: "credentials"): void {
  trackEvent("sign_up", { method });
}

export function trackLogout(): void {
  trackEvent("logout");
}

export function trackAiWorkspaceMessageSent(params: { agentId: string | null; status: string | null }): void {
  trackEvent("ai_workspace_message_sent", {
    agent_id: params.agentId ?? "unassigned",
    routing_status: params.status ?? "unknown",
  });
}

export function trackSeoAuditCompleted(params: { criticalCount: number; warningCount: number; infoCount: number }): void {
  trackEvent("seo_audit_completed", {
    critical_count: params.criticalCount,
    warning_count: params.warningCount,
    info_count: params.infoCount,
  });
}

export function trackReportGenerated(reportType: string): void {
  trackEvent("report_generated", { report_type: reportType });
}

/** Mirrors GA4's own Enhanced Measurement schema for outbound clicks (event "click", param outbound: true) so it lands in GA's standard reports rather than a bespoke event name. */
export function trackOutboundClick(params: { url: string; domain: string }): void {
  trackEvent("click", {
    link_url: params.url,
    link_domain: params.domain,
    outbound: true,
  });
}
