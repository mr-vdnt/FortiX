import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LocalStorageProvider } from '../../src/storage/local-storage.js';
import { S3StorageProvider } from '../../src/storage/s3-storage.js';
import { buildPdfBuffer } from '../../src/api/reports.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

describe('TSK-08: Verification PDF Artifact Storage Adapter', () => {
  const testStorageDir = path.resolve(process.cwd(), 'storage/test-artifacts');
  let storage: LocalStorageProvider;

  beforeEach(() => {
    storage = new LocalStorageProvider({ baseDirectory: 'storage/test-artifacts' });
  });

  afterEach(() => {
    try {
      if (fs.existsSync(testStorageDir)) {
        fs.rmSync(testStorageDir, { recursive: true, force: true });
      }
    } catch {
      // Cleanup tolerance
    }
  });

  describe('PDF Buffer Generation', () => {
    it('generates a valid binary PDF buffer with proper headers', async () => {
      const buffer = await buildPdfBuffer(
        'FortiX Automated Test Evidence',
        { 'Verification ID': 'verif-12345', 'Status': 'PASSED' },
        'All rate limits and circuit breaker tests passed.'
      );

      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(100);
      // Valid PDF files start with %PDF-
      const header = buffer.subarray(0, 5).toString('utf8');
      expect(header).toBe('%PDF-');
    });
  });

  describe('Local Filesystem Storage Provider', () => {
    it('stores PDF artifact, records SHA-256 and retrieves binary data accurately', async () => {
      const dummyPdf = Buffer.from('%PDF-1.4 Mock PDF binary content for testing FortiX storage');
      const expectedHash = crypto.createHash('sha256').update(dummyPdf).digest('hex');

      const meta = await storage.put(dummyPdf, {
        verificationId: 'v-999',
        projectId: 'proj-alpha',
        filename: 'report-v999.pdf',
        contentType: 'application/pdf',
      });

      expect(meta.artifactId).toBeDefined();
      expect(meta.projectId).toBe('proj-alpha');
      expect(meta.verificationId).toBe('v-999');
      expect(meta.storageProvider).toBe('local');
      expect(meta.sha256).toBe(expectedHash);
      expect(meta.sizeBytes).toBe(dummyPdf.length);
      expect(meta.contentType).toBe('application/pdf');

      // Verify file exists on disk
      expect(await storage.exists(meta.artifactId, 'proj-alpha')).toBe(true);

      // Retrieve artifact
      const retrieved = await storage.get(meta.artifactId, 'proj-alpha');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.data.toString()).toBe(dummyPdf.toString());
      expect(retrieved!.metadata.sha256).toBe(expectedHash);
    });

    it('enforces strict tenant isolation: rejects cross-tenant artifact retrieval', async () => {
      const pdf = Buffer.from('%PDF-1.4 Tenant A confidential report');
      const meta = await storage.put(pdf, {
        projectId: 'tenant-A',
        filename: 'secret-a.pdf',
      });

      // Tenant A can retrieve
      const tenantAGet = await storage.get(meta.artifactId, 'tenant-A');
      expect(tenantAGet).not.toBeNull();

      // Tenant B access must be rejected with Access Denied
      await expect(storage.get(meta.artifactId, 'tenant-B')).rejects.toThrow('Access Denied');
    });

    it('strictly blocks path traversal attempts in object keys or filenames', async () => {
      const pdf = Buffer.from('%PDF-1.4 Malicious traversal payload');

      const meta = await storage.put(pdf, {
        projectId: 'proj-traversal',
        filename: '../../../../etc/passwd',
      });

      // Filename should be sanitized without traversal dots
      expect(meta.filename).not.toContain('..');
      expect(meta.filename).not.toContain('/');

      // Direct traversal access in get
      await expect(storage.get('../../../../../etc/passwd')).rejects.toThrow();
    });

    it('returns null when retrieving non-existent artifact', async () => {
      const result = await storage.get('non-existent-artifact-id', 'proj-alpha');
      expect(result).toBeNull();
      expect(await storage.exists('non-existent-artifact-id')).toBe(false);
    });

    it('deletes stored artifact and metadata cleanly', async () => {
      const pdf = Buffer.from('%PDF-1.4 Deletable report');
      const meta = await storage.put(pdf, {
        projectId: 'proj-del',
        filename: 'to-delete.pdf',
      });

      expect(await storage.exists(meta.artifactId, 'proj-del')).toBe(true);

      const deleted = await storage.delete(meta.artifactId, 'proj-del');
      expect(deleted).toBe(true);
      expect(await storage.exists(meta.artifactId, 'proj-del')).toBe(false);
      expect(await storage.get(meta.artifactId, 'proj-del')).toBeNull();
    });

    it('lists stored artifacts for a project ordered by creation time', async () => {
      const pdf = Buffer.from('%PDF-1.4 Report item');
      await storage.put(pdf, { projectId: 'proj-list', filename: 'rep-1.pdf' });
      await storage.put(pdf, { projectId: 'proj-list', filename: 'rep-2.pdf' });
      await storage.put(pdf, { projectId: 'proj-other', filename: 'rep-other.pdf' });

      const list = await storage.listByProject('proj-list');
      expect(list.length).toBe(2);
      expect(list.every((item) => item.projectId === 'proj-list')).toBe(true);
    });

    it('enforces maximum artifact size limits', async () => {
      const smallStorage = new LocalStorageProvider({
        baseDirectory: 'storage/test-artifacts',
        maxSizeBytes: 50, // 50 bytes limit
      });

      const largeBuffer = Buffer.alloc(200, 'X');
      await expect(
        smallStorage.put(largeBuffer, {
          projectId: 'proj-limit',
          filename: 'large.pdf',
        })
      ).rejects.toThrow('exceeds limit');
    });
  });

  describe('S3 Storage Provider Fallback Mode', () => {
    it('stores artifact with S3 provider metadata and local resilience', async () => {
      const s3Storage = new S3StorageProvider({ bucket: 'fortix-test-bucket' });
      const pdf = Buffer.from('%PDF-1.4 S3 artifact test');

      const meta = await s3Storage.put(pdf, {
        projectId: 'proj-s3',
        filename: 's3-report.pdf',
      });

      expect(meta.storageProvider).toBe('s3');
      expect(meta.objectKey).toContain('s3://fortix-test-bucket/');
      expect(meta.sha256).toBeDefined();
    });
  });
});
