import nodemailer, { type Transporter } from 'nodemailer';
import type { AppConfig } from '../config/env.js';
import type { Logger } from '../config/logger.js';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailProvider {
  readonly name: 'none' | 'smtp' | 'log';
  /** True when messages are actually delivered (or, for `log`, written to the dev log). */
  readonly configured: boolean;
  send(message: EmailMessage): Promise<{ messageId: string }>;
}

export class EmailNotConfiguredError extends Error {
  constructor() {
    super('Email delivery is not configured (EMAIL_PROVIDER=none).');
  }
}

class NoEmailProvider implements EmailProvider {
  readonly name = 'none' as const;
  readonly configured = false;
  send(): Promise<{ messageId: string }> {
    return Promise.reject(new EmailNotConfiguredError());
  }
}

/**
 * DEVELOPMENT ONLY: writes emails to the application log instead of sending
 * them. The configuration loader rejects this provider in production.
 */
export class LogEmailProvider implements EmailProvider {
  readonly name = 'log' as const;
  readonly configured = true;
  readonly outbox: EmailMessage[] = [];
  constructor(private readonly logger: Logger) {}
  send(message: EmailMessage): Promise<{ messageId: string }> {
    this.outbox.push(message);
    this.logger.info({ devEmail: { to: message.to, subject: message.subject, text: message.text } }, '[DEV EMAIL — not sent]');
    return Promise.resolve({ messageId: `dev-log-${this.outbox.length}` });
  }
}

class SmtpEmailProvider implements EmailProvider {
  readonly name = 'smtp' as const;
  readonly configured = true;
  private readonly transport: Transporter;
  constructor(private readonly config: AppConfig['email']) {
    this.transport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.password } : undefined,
      connectionTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }
  async send(message: EmailMessage): Promise<{ messageId: string }> {
    const info = await this.transport.sendMail({ from: this.config.from, to: message.to, subject: message.subject, text: message.text });
    return { messageId: String(info.messageId) };
  }
}

export function createEmailProvider(config: AppConfig['email'], logger: Logger): EmailProvider {
  switch (config.provider) {
    case 'smtp':
      return new SmtpEmailProvider(config);
    case 'log':
      return new LogEmailProvider(logger);
    default:
      return new NoEmailProvider();
  }
}
