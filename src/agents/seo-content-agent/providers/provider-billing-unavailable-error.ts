// A narrow, opt-in signal that a ContentGenerationProvider call failed specifically because of the
// underlying account's own billing/credit/access state (exhausted credits, revoked/invalid API key,
// no account access to the model/plan) rather than a transient or unrelated failure (rate limit, bad
// response shape, network blip). Every provider in this codebase otherwise swallows every failure to
// `null` -- see ContentGenerationProvider's own header in content-generation-provider.types.ts -- and
// that default is preserved everywhere. This error is thrown ONLY when a provider is explicitly
// constructed with `throwOnBillingFailure: true` (see AnthropicContentGenerationProvider), which only
// FallbackContentGenerationProvider does, so it can reliably distinguish "this account can't be billed
// right now" from every other `null` result without adding shared mutable state that a real article's
// concurrent per-section calls could race on.
export class ProviderBillingUnavailableError extends Error {
  constructor(readonly providerName: string) {
    super(`"${providerName}" content-generation provider is unavailable due to a billing/credit/access failure`);
    this.name = "ProviderBillingUnavailableError";
  }
}

/**
 * True only for an error shape that genuinely indicates the ACCOUNT can't be billed/authorized right
 * now -- a 401 (invalid/revoked API key), a 403 (no account access to the model/plan), or a 400
 * invalid_request_error whose own message says the credit balance is too low. Never matches a rate
 * limit (429), a bad prompt, or a transient network/server error -- those stay on the existing "return
 * null" path so an unrelated failure never silently swaps providers.
 */
export function isBillingOrAccessFailure(error: unknown): boolean {
  const status = error && typeof error === "object" && "status" in error ? (error as { status?: unknown }).status : undefined;
  if (status === 401 || status === 403) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /credit balance is too low|insufficient_quota|billing/i.test(message);
}
