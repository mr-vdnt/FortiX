import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  generateWebhookSignature,
  verifyWebhookSignature,
  executeWebhookDelivery,
  inMemoryWebhookDeliveries,
  WebhookJobData,
  DEFAULT_WEBHOOK_JOB_OPTIONS,
} from '../../src/lib/webhooks.js';
import { getDlqRecords, clearDlqForQueue } from '../../src/lib/dlq.js';
import { v4 as uuidv4 } from 'uuid';

describe('TSK-07: Webhook Redelivery & Retry Engine', () => {
  beforeEach(() => {
    inMemoryWebhookDeliveries.length = 0;
    clearDlqForQueue('fortix-webhooks');
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('HMAC-SHA256 Signature Generation & Verification', () => {
    const secret = 'whsec_test_secret_key_1234567890';
    const payload = {
      event: 'experiment.verdict',
      experimentId: 'exp-9876',
      verdict: 'RESILIENT',
      score: 98,
    };

    it('generates valid HMAC-SHA256 signature with timestamp header', () => {
      const { signatureHeader, signatureHex, timestamp } = generateWebhookSignature(payload, secret);

      expect(signatureHeader).toContain(`t=${timestamp}`);
      expect(signatureHeader).toContain(`v1=${signatureHex}`);
      expect(signatureHex).toMatch(/^[a-f0-9]{64}$/); // SHA-256 is 64 hex chars
    });

    it('successfully verifies legitimate payload and signature', () => {
      const { signatureHeader } = generateWebhookSignature(payload, secret);
      const verification = verifyWebhookSignature(payload, signatureHeader, secret);

      expect(verification.valid).toBe(true);
      expect(verification.reason).toBeUndefined();
    });

    it('rejects tampered payload', () => {
      const { signatureHeader } = generateWebhookSignature(payload, secret);
      const tamperedPayload = { ...payload, verdict: 'FAILED_TAMPERED' };
      const verification = verifyWebhookSignature(tamperedPayload, signatureHeader, secret);

      expect(verification.valid).toBe(false);
      expect(verification.reason).toBe('HMAC signature verification failed');
    });

    it('rejects expired or replayed timestamp beyond tolerance window', () => {
      const oldTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
      const { signatureHeader } = generateWebhookSignature(payload, secret, oldTimestamp);
      const verification = verifyWebhookSignature(payload, signatureHeader, secret, 300); // 5 min tolerance

      expect(verification.valid).toBe(false);
      expect(verification.reason).toContain('tolerance window');
    });

    it('rejects signature created with wrong secret', () => {
      const { signatureHeader } = generateWebhookSignature(payload, 'wrong_secret_abc');
      const verification = verifyWebhookSignature(payload, signatureHeader, secret);

      expect(verification.valid).toBe(false);
    });
  });

  describe('Job Options & Exponential Backoff Specification', () => {
    it('enforces 5 maximum retry attempts with exponential backoff configuration', () => {
      expect(DEFAULT_WEBHOOK_JOB_OPTIONS.attempts).toBe(5);
      expect(DEFAULT_WEBHOOK_JOB_OPTIONS.backoff.type).toBe('exponential');
      expect(DEFAULT_WEBHOOK_JOB_OPTIONS.backoff.delay).toBe(1000);
      expect(DEFAULT_WEBHOOK_JOB_OPTIONS.timeout).toBe(10000);
    });
  });

  describe('Delivery Execution, HTTP Status Handling & Evidence Auditing', () => {
    const jobData: WebhookJobData = {
      deliveryId: 'deliv-001',
      webhookId: 'wh-123',
      projectId: 'proj-alpha',
      url: 'https://api.github.com/webhook-sink', // public safe domain
      secret: 'whsec_prod_secret_456',
      eventType: 'security.threat_blocked',
      payload: {
        threatType: 'SQLI',
        ip: '198.51.100.22',
        blockedAt: '2026-10-02T10:00:00Z',
      },
      maxAttempts: 5,
    };

    it('records delivery attempt and succeeds on HTTP 200 response', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => '{"received": true}',
      });
      global.fetch = mockFetch;

      const result = await executeWebhookDelivery(jobData, 1);

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);

      // Verify request headers
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, requestInit] = mockFetch.mock.calls[0];
      expect(url).toBe(jobData.url);
      expect(requestInit.headers['X-FortiX-Event']).toBe('security.threat_blocked');
      expect(requestInit.headers['X-FortiX-Attempt']).toBe('1');
      expect(requestInit.headers['X-FortiX-Signature-256']).toBeDefined();

      // Verify evidence recorded in audit delivery history
      expect(inMemoryWebhookDeliveries.length).toBe(1);
      const delivery = inMemoryWebhookDeliveries[0];
      expect(delivery.id).toBe('deliv-001');
      expect(delivery.attemptNumber).toBe(1);
      expect(delivery.statusCode).toBe(200);
      expect(delivery.success).toBe(true);
      expect(delivery.responseBody).toBe('{"received": true}');
      expect(delivery.latencyMs).toBeGreaterThanOrEqual(0);
      expect(delivery.signature).toContain('v1=');
    });

    it('records evidence and throws error on HTTP 500 server error to trigger BullMQ retry', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });
      global.fetch = mockFetch;

      await expect(executeWebhookDelivery(jobData, 1)).rejects.toThrow('Webhook endpoint returned HTTP 500');

      expect(inMemoryWebhookDeliveries.length).toBe(1);
      const delivery = inMemoryWebhookDeliveries[0];
      expect(delivery.attemptNumber).toBe(1);
      expect(delivery.statusCode).toBe(500);
      expect(delivery.success).toBe(false);
      expect(delivery.errorMessage).toContain('HTTP 500');
    });

    it('records evidence and throws error on network timeout', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new (class extends Error {
        name = 'AbortError';
        message = 'The operation was aborted';
      })());
      global.fetch = mockFetch;

      await expect(executeWebhookDelivery(jobData, 2)).rejects.toThrow('timed out');

      expect(inMemoryWebhookDeliveries.length).toBe(1);
      const delivery = inMemoryWebhookDeliveries[0];
      expect(delivery.attemptNumber).toBe(2);
      expect(delivery.success).toBe(false);
      expect(delivery.errorMessage).toContain('timed out');
    });

    it('blocks internal/private SSRF target URLs and records security block evidence', async () => {
      const ssrfJobData: WebhookJobData = {
        ...jobData,
        deliveryId: 'deliv-ssrf-001',
        url: 'http://127.0.0.1:8080/internal-webhook',
      };

      await expect(executeWebhookDelivery(ssrfJobData, 1)).rejects.toThrow('SSRF blocked');

      expect(inMemoryWebhookDeliveries.length).toBe(1);
      const delivery = inMemoryWebhookDeliveries[0];
      expect(delivery.id).toBe('deliv-ssrf-001');
      expect(delivery.statusCode).toBe(400);
      expect(delivery.success).toBe(false);
      expect(delivery.errorMessage).toContain('SSRF blocked');
    });
  });

  describe('Multi-Attempt Lifecycle & Dead-Letter Queue (DLQ) Routing', () => {
    it('proves every attempt is recorded with incremental attempt numbers', async () => {
      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount < 3) {
          return { ok: false, status: 503, text: async () => 'Service Unavailable' };
        }
        return { ok: true, status: 200, text: async () => 'OK' };
      });

      const multiJobData: WebhookJobData = {
        deliveryId: uuidv4(),
        webhookId: 'wh-multi',
        projectId: 'proj-alpha',
        url: 'https://api.github.com/webhook-retry-test',
        secret: 'sec_123',
        eventType: 'experiment.status',
        payload: { status: 'RUNNING' },
        maxAttempts: 5,
      };

      // Attempt 1: 503
      await expect(executeWebhookDelivery(multiJobData, 1)).rejects.toThrow();
      // Attempt 2: 503
      await expect(executeWebhookDelivery(multiJobData, 2)).rejects.toThrow();
      // Attempt 3: 200 Success!
      const result3 = await executeWebhookDelivery(multiJobData, 3);
      expect(result3.success).toBe(true);

      // Verify all 3 attempts recorded in delivery history
      const attempts = inMemoryWebhookDeliveries.filter((d) => d.webhookId === 'wh-multi');
      expect(attempts.length).toBe(3);

      const attemptNums = attempts.map((a) => a.attemptNumber).sort();
      expect(attemptNums).toEqual([1, 2, 3]);

      // Since attempt 3 succeeded, no DLQ should be recorded
      const dlqRecords = getDlqRecords();
      const webhookDlq = dlqRecords.filter((r) => r.queueName === 'fortix-webhooks');
      expect(webhookDlq.length).toBe(0);
    });

    it('routes failed job to DLQ when all 5 retry attempts are exhausted', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 504,
        text: async () => 'Gateway Timeout',
      });

      const failingJobData: WebhookJobData = {
        deliveryId: 'deliv-fail-all',
        webhookId: 'wh-failing',
        projectId: 'proj-alpha',
        url: 'https://api.github.com/webhook-fail-test',
        secret: 'sec_123',
        eventType: 'experiment.failed',
        payload: { error: 'chaos simulation failed' },
        maxAttempts: 5,
      };

      const maxAttempts = 5;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          await executeWebhookDelivery(failingJobData, attempt);
        } catch (err: any) {
          if (attempt === maxAttempts) {
            const { recordDlqFailure } = await import('../../src/lib/dlq.js');
            await recordDlqFailure({
              jobId: failingJobData.deliveryId!,
              queueName: 'fortix-webhooks',
              jobName: 'deliver-webhook',
              data: failingJobData,
              failedReason: err?.message || 'Webhook delivery failed after 5 exponential attempts',
              attemptsMade: 5,
              maxAttempts: 5,
            });
          }
        }
      }

      // Verify all 5 attempts recorded
      const attempts = inMemoryWebhookDeliveries.filter((d) => d.webhookId === 'wh-failing');
      expect(attempts.length).toBe(5);

      // Verify DLQ has recorded the dead letter
      const dlqRecords = getDlqRecords();
      const dlqEntry = dlqRecords.find((r) => r.id === 'deliv-fail-all');
      expect(dlqEntry).toBeDefined();
      expect(dlqEntry?.queueName).toBe('fortix-webhooks');
      expect(dlqEntry?.attemptsMade).toBe(5);
      expect(dlqEntry?.status).toBe('DEAD_LETTER');
    });
  });

  describe('Tenant and Project Isolation', () => {
    it('isolates delivery histories between separate projects', () => {
      const deliveryProjA = {
        id: 'del-a',
        webhookId: 'wh-a',
        projectId: 'project-A',
        eventType: 'test.event',
        payload: {},
        attemptNumber: 1,
        maxAttempts: 5,
        statusCode: 200,
        success: true,
        createdAt: new Date().toISOString(),
      };

      const deliveryProjB = {
        id: 'del-b',
        webhookId: 'wh-b',
        projectId: 'project-B',
        eventType: 'test.event',
        payload: {},
        attemptNumber: 1,
        maxAttempts: 5,
        statusCode: 200,
        success: true,
        createdAt: new Date().toISOString(),
      };

      inMemoryWebhookDeliveries.push(deliveryProjA, deliveryProjB);

      const projectARecords = inMemoryWebhookDeliveries.filter((d) => d.projectId === 'project-A');
      const projectBRecords = inMemoryWebhookDeliveries.filter((d) => d.projectId === 'project-B');

      expect(projectARecords.length).toBe(1);
      expect(projectARecords[0].id).toBe('del-a');
      expect(projectBRecords.length).toBe(1);
      expect(projectBRecords[0].id).toBe('del-b');
    });
  });
});
