export type TransactionalEmail = { to: string; subject: string; text: string };
export interface EmailSender {
  send(email: TransactionalEmail): Promise<void>;
}

export type ResendConfig = { resendApiKey: string | null; resendFromEmail: string | null };

export class ResendEmailSender implements EmailSender {
  constructor(
    private readonly config: ResendConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async send(email: TransactionalEmail): Promise<void> {
    if (!this.config.resendApiKey || !this.config.resendFromEmail) throw new Error("Email delivery is not configured");
    let response: Response;
    try {
      response = await this.fetcher("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${this.config.resendApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: this.config.resendFromEmail, to: [email.to], subject: email.subject, text: email.text }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new Error("Email delivery failed");
    }
    if (!response.ok) throw new Error("Email delivery failed");
  }
}
