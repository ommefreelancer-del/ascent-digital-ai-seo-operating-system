// No real email provider is wired in yet (this app has no SMTP/Resend/
// SendGrid credentials configured) -- sending a password-reset email that
// silently does nothing would be dishonest, so this logs the link to the
// server console instead of pretending to deliver it. Swap this
// implementation for a real provider before production use; every caller
// already awaits `sendPasswordResetEmail`, so that's a self-contained swap.

export async function sendPasswordResetEmail(email: string, resetUrl: string): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`[mailer:dev-stub] Password reset link for ${email}: ${resetUrl}`);
}
