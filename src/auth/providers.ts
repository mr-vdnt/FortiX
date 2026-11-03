import { logger } from '../lib/logger.js';

export type DeliveryChannel = 'EMAIL' | 'SMS';

export interface NotificationDeliveryResult {
  delivered: boolean;
  channel: DeliveryChannel;
  provider: 'webhook-email' | 'webhook-sms' | 'dev-sandbox-outbox' | 'unconfigured';
  statusCode?: number;
  errorCode?: string;
}

export interface EmailMessagePayload {
  to: string;
  purpose: string;
  subject: string;
  codeOrToken: string;
  expiresAt: Date;
}

export interface SmsMessagePayload {
  toPhoneE164: string;
  purpose: string;
  otpCode: string;
  expiresAt: Date;
}

export interface EmailDeliveryProvider {
  send(message: EmailMessagePayload): Promise<NotificationDeliveryResult>;
}

export interface SmsDeliveryProvider {
  send(message: SmsMessagePayload): Promise<NotificationDeliveryResult>;
}

interface DevSandboxOutboxRecord {
  channel: DeliveryChannel;
  destination: string;
  purpose: string;
  secretValue: string;
  expiresAt: string;
  createdAt: string;
}

const MAX_DEV_OUTBOX_RECORDS = 200;
const devSandboxOutbox: DevSandboxOutboxRecord[] = [];

function recordInDevOutbox(record: DevSandboxOutboxRecord): void {
  if (process.env.NODE_ENV === 'production') return;
  devSandboxOutbox.push(record);
  if (devSandboxOutbox.length > MAX_DEV_OUTBOX_RECORDS) {
    devSandboxOutbox.splice(0, devSandboxOutbox.length - MAX_DEV_OUTBOX_RECORDS);
  }
}

export function getLatestDevSandboxSecret(
  destination: string,
  purpose: string,
  channel?: DeliveryChannel
): string | undefined {
  if (process.env.NODE_ENV === 'production') return undefined;
  const normalized = destination.trim().toLowerCase();
  for (let i = devSandboxOutbox.length - 1; i >= 0; i--) {
    const item = devSandboxOutbox[i];
    if (
      item.destination === normalized &&
      item.purpose === purpose &&
      (!channel || item.channel === channel)
    ) {
      return item.secretValue;
    }
  }
  return undefined;
}

export function __clearDevSandboxOutboxForTests(): void {
  devSandboxOutbox.length = 0;
}

const WEBHOOK_TIMEOUT_MS = 8000;

export class WebhookEmailDeliveryProvider implements EmailDeliveryProvider {
  constructor(
    private readonly webhookUrl: string,
    private readonly webhookSecret?: string
  ) {}

  async send(message: EmailMessagePayload): Promise<NotificationDeliveryResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
    try {
      const resp = await fetch(this.webhookUrl, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(this.webhookSecret ? { Authorization: `Bearer ${this.webhookSecret}` } : {}),
        },
        body: JSON.stringify({
          channel: 'EMAIL',
          to: message.to,
          purpose: message.purpose,
          subject: message.subject,
          token: message.codeOrToken,
          expiresAt: message.expiresAt.toISOString(),
        }),
      });

      if (!resp.ok) {
        logger.error(
          { purpose: message.purpose, statusCode: resp.status },
          '[AuthDelivery] Transactional email webhook returned non-2xx HTTP status'
        );
        return {
          delivered: false,
          channel: 'EMAIL',
          provider: 'webhook-email',
          statusCode: resp.status,
          errorCode: `WEBHOOK_HTTP_${resp.status}`,
        };
      }

      logger.info(
        { purpose: message.purpose, statusCode: resp.status },
        '[AuthDelivery] Transactional email notification delivered'
      );
      return {
        delivered: true,
        channel: 'EMAIL',
        provider: 'webhook-email',
        statusCode: resp.status,
      };
    } catch (err: any) {
      logger.error(
        { purpose: message.purpose, errorName: err?.name || 'FetchError' },
        '[AuthDelivery] Transactional email webhook transport error'
      );
      return {
        delivered: false,
        channel: 'EMAIL',
        provider: 'webhook-email',
        errorCode: err?.name === 'AbortError' ? 'WEBHOOK_TIMEOUT' : 'WEBHOOK_TRANSPORT_ERROR',
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

export class WebhookSmsDeliveryProvider implements SmsDeliveryProvider {
  constructor(
    private readonly webhookUrl: string,
    private readonly webhookSecret?: string
  ) {}

  async send(message: SmsMessagePayload): Promise<NotificationDeliveryResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
    try {
      const resp = await fetch(this.webhookUrl, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(this.webhookSecret ? { Authorization: `Bearer ${this.webhookSecret}` } : {}),
        },
        body: JSON.stringify({
          channel: 'SMS',
          to: message.toPhoneE164,
          purpose: message.purpose,
          code: message.otpCode,
          expiresAt: message.expiresAt.toISOString(),
        }),
      });

      if (!resp.ok) {
        logger.error(
          { purpose: message.purpose, statusCode: resp.status },
          '[AuthDelivery] Transactional SMS webhook returned non-2xx HTTP status'
        );
        return {
          delivered: false,
          channel: 'SMS',
          provider: 'webhook-sms',
          statusCode: resp.status,
          errorCode: `WEBHOOK_HTTP_${resp.status}`,
        };
      }

      logger.info(
        { purpose: message.purpose, statusCode: resp.status },
        '[AuthDelivery] Transactional SMS notification delivered'
      );
      return {
        delivered: true,
        channel: 'SMS',
        provider: 'webhook-sms',
        statusCode: resp.status,
      };
    } catch (err: any) {
      logger.error(
        { purpose: message.purpose, errorName: err?.name || 'FetchError' },
        '[AuthDelivery] Transactional SMS webhook transport error'
      );
      return {
        delivered: false,
        channel: 'SMS',
        provider: 'webhook-sms',
        errorCode: err?.name === 'AbortError' ? 'WEBHOOK_TIMEOUT' : 'WEBHOOK_TRANSPORT_ERROR',
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

class DevSandboxEmailProvider implements EmailDeliveryProvider {
  async send(message: EmailMessagePayload): Promise<NotificationDeliveryResult> {
    if (process.env.NODE_ENV === 'production') {
      logger.error(
        { purpose: message.purpose },
        '[AuthDelivery] AUTH_MAIL_WEBHOOK_URL is not configured in production'
      );
      return {
        delivered: false,
        channel: 'EMAIL',
        provider: 'unconfigured',
        errorCode: 'EMAIL_PROVIDER_NOT_CONFIGURED',
      };
    }

    recordInDevOutbox({
      channel: 'EMAIL',
      destination: message.to.trim().toLowerCase(),
      purpose: message.purpose,
      secretValue: message.codeOrToken,
      expiresAt: message.expiresAt.toISOString(),
      createdAt: new Date().toISOString(),
    });

    return {
      delivered: true,
      channel: 'EMAIL',
      provider: 'dev-sandbox-outbox',
    };
  }
}

class DevSandboxSmsProvider implements SmsDeliveryProvider {
  async send(message: SmsMessagePayload): Promise<NotificationDeliveryResult> {
    if (process.env.NODE_ENV === 'production') {
      logger.error(
        { purpose: message.purpose },
        '[AuthDelivery] AUTH_SMS_WEBHOOK_URL is not configured in production'
      );
      return {
        delivered: false,
        channel: 'SMS',
        provider: 'unconfigured',
        errorCode: 'SMS_PROVIDER_NOT_CONFIGURED',
      };
    }

    recordInDevOutbox({
      channel: 'SMS',
      destination: message.toPhoneE164.trim().toLowerCase(),
      purpose: message.purpose,
      secretValue: message.otpCode,
      expiresAt: message.expiresAt.toISOString(),
      createdAt: new Date().toISOString(),
    });

    return {
      delivered: true,
      channel: 'SMS',
      provider: 'dev-sandbox-outbox',
    };
  }
}

let customEmailProviderOverride: EmailDeliveryProvider | null = null;
let customSmsProviderOverride: SmsDeliveryProvider | null = null;

export function setAuthDeliveryProviderOverridesForTests(overrides: {
  email?: EmailDeliveryProvider | null;
  sms?: SmsDeliveryProvider | null;
}): void {
  if ('email' in overrides) customEmailProviderOverride = overrides.email ?? null;
  if ('sms' in overrides) customSmsProviderOverride = overrides.sms ?? null;
}

export function resolveEmailDeliveryProvider(): EmailDeliveryProvider {
  if (customEmailProviderOverride) return customEmailProviderOverride;
  const mailWebhookUrl = (process.env.AUTH_MAIL_WEBHOOK_URL || '').trim();
  if (mailWebhookUrl) {
    return new WebhookEmailDeliveryProvider(mailWebhookUrl, process.env.AUTH_MAIL_WEBHOOK_SECRET);
  }
  return new DevSandboxEmailProvider();
}

export function resolveSmsDeliveryProvider(): SmsDeliveryProvider {
  if (customSmsProviderOverride) return customSmsProviderOverride;
  const smsWebhookUrl = (process.env.AUTH_SMS_WEBHOOK_URL || '').trim();
  if (smsWebhookUrl) {
    return new WebhookSmsDeliveryProvider(smsWebhookUrl, process.env.AUTH_SMS_WEBHOOK_SECRET);
  }
  return new DevSandboxSmsProvider();
}
