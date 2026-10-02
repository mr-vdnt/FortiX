import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { IArtifactStorage, ArtifactMetadata, PutArtifactOptions } from './artifact-storage.js';

export interface LocalStorageOptions {
  baseDirectory?: string;
  maxSizeBytes?: number;
}

export class LocalStorageProvider implements IArtifactStorage {
  public readonly providerName = 'local';
  private baseDirectory: string;
  private maxSizeBytes: number;
  private metadataRegistry = new Map<string, ArtifactMetadata>();

  constructor(options?: LocalStorageOptions) {
    this.baseDirectory = path.resolve(
      process.cwd(),
      options?.baseDirectory || process.env.ARTIFACT_STORAGE_DIR || 'storage/artifacts'
    );
    this.maxSizeBytes = options?.maxSizeBytes || 25 * 1024 * 1024; // 25MB limit
    this.ensureBaseDirectory();
  }

  private ensureBaseDirectory(): void {
    try {
      if (!fs.existsSync(this.baseDirectory)) {
        fs.mkdirSync(this.baseDirectory, { recursive: true });
      }
    } catch (err) {
      // Handled in container environments
    }
  }

  /**
   * Sanitizes filenames and validates paths to strictly prevent path traversal attacks.
   */
  private sanitizeFilename(filename: string): string {
    const cleaned = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    return cleaned || 'artifact.pdf';
  }

  private getSafePath(objectKey: string): string {
    if (objectKey.includes('..') || objectKey.startsWith('/') || objectKey.startsWith('\\')) {
      const resolved = path.resolve(this.baseDirectory, objectKey);
      if (!resolved.startsWith(this.baseDirectory + path.sep) && resolved !== this.baseDirectory) {
        throw new Error(`Path traversal attempt blocked: ${objectKey}`);
      }
    }
    const resolvedPath = path.resolve(this.baseDirectory, objectKey);

    // Strict boundary assertion: path must be strictly inside baseDirectory
    if (!resolvedPath.startsWith(this.baseDirectory + path.sep) && resolvedPath !== this.baseDirectory) {
      throw new Error(`Path traversal attempt blocked: ${objectKey}`);
    }

    return resolvedPath;
  }

  public async put(buffer: Buffer | Uint8Array, options: PutArtifactOptions): Promise<ArtifactMetadata> {
    if (!options.projectId) {
      throw new Error('projectId is required for artifact storage.');
    }

    const nodeBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    if (nodeBuffer.length > this.maxSizeBytes) {
      throw new Error(`Artifact size (${nodeBuffer.length} bytes) exceeds limit of ${this.maxSizeBytes} bytes.`);
    }

    const artifactId = options.artifactId || uuidv4();
    const sanitizedName = this.sanitizeFilename(options.filename);
    const objectKey = `${options.projectId}/${artifactId}-${sanitizedName}`;
    const filePath = this.getSafePath(objectKey);

    // Compute SHA-256 hash
    const sha256 = crypto.createHash('sha256').update(nodeBuffer).digest('hex');

    // Ensure target directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write file to disk
    await fs.promises.writeFile(filePath, nodeBuffer);

    const metadata: ArtifactMetadata = {
      artifactId,
      verificationId: options.verificationId,
      projectId: options.projectId,
      storageProvider: 'local',
      objectKey,
      contentType: options.contentType || 'application/pdf',
      sizeBytes: nodeBuffer.length,
      sha256,
      filename: sanitizedName,
      createdAt: new Date().toISOString(),
      customMetadata: options.customMetadata,
    };

    // Save metadata in registry
    this.metadataRegistry.set(artifactId, metadata);
    this.metadataRegistry.set(objectKey, metadata);

    return metadata;
  }

  public async get(
    objectKeyOrId: string,
    projectId?: string
  ): Promise<{ data: Buffer; metadata: ArtifactMetadata } | null> {
    const metadata = await this.getMetadata(objectKeyOrId, projectId);
    if (!metadata) return null;

    // Strict tenant isolation check
    if (projectId && metadata.projectId !== projectId) {
      throw new Error(`Access Denied: Artifact does not belong to project ${projectId}`);
    }

    try {
      const filePath = this.getSafePath(metadata.objectKey);
      if (!fs.existsSync(filePath)) return null;

      const data = await fs.promises.readFile(filePath);

      // Verify SHA-256 integrity on read
      const currentHash = crypto.createHash('sha256').update(data).digest('hex');
      if (currentHash !== metadata.sha256) {
        throw new Error(`Data integrity violation: SHA-256 mismatch for artifact ${metadata.artifactId}`);
      }

      return { data, metadata };
    } catch (err) {
      if ((err as any).message?.includes('Access Denied')) throw err;
      return null;
    }
  }

  public async getMetadata(objectKeyOrId: string, projectId?: string): Promise<ArtifactMetadata | null> {
    // Assert safe path (throws if traversal detected)
    this.getSafePath(objectKeyOrId);

    let metadata = this.metadataRegistry.get(objectKeyOrId);

    // If not in memory registry, try locating file on disk
    if (!metadata) {
      try {
        const filePath = this.getSafePath(objectKeyOrId);
        if (fs.existsSync(filePath)) {
          const stats = await fs.promises.stat(filePath);
          const data = await fs.promises.readFile(filePath);
          const sha256 = crypto.createHash('sha256').update(data).digest('hex');
          const inferredProjectId = objectKeyOrId.includes('/') ? objectKeyOrId.split('/')[0] : (projectId || 'unknown');

          metadata = {
            artifactId: path.basename(filePath).split('-')[0] || uuidv4(),
            projectId: inferredProjectId,
            storageProvider: 'local',
            objectKey: objectKeyOrId,
            contentType: 'application/pdf',
            sizeBytes: stats.size,
            sha256,
            filename: path.basename(filePath),
            createdAt: stats.birthtime.toISOString(),
          };
          this.metadataRegistry.set(objectKeyOrId, metadata);
        }
      } catch {
        return null;
      }
    }

    if (!metadata) return null;

    // Tenant check
    if (projectId && metadata.projectId !== projectId) {
      throw new Error(`Access Denied: Artifact does not belong to project ${projectId}`);
    }

    return metadata;
  }

  public async exists(objectKeyOrId: string, projectId?: string): Promise<boolean> {
    try {
      const meta = await this.getMetadata(objectKeyOrId, projectId);
      return meta !== null;
    } catch {
      return false;
    }
  }

  public async delete(objectKeyOrId: string, projectId?: string): Promise<boolean> {
    const metadata = await this.getMetadata(objectKeyOrId, projectId);
    if (!metadata) return false;

    if (projectId && metadata.projectId !== projectId) {
      throw new Error(`Access Denied: Artifact does not belong to project ${projectId}`);
    }

    try {
      const filePath = this.getSafePath(metadata.objectKey);
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }
      this.metadataRegistry.delete(metadata.artifactId);
      this.metadataRegistry.delete(metadata.objectKey);
      return true;
    } catch {
      return false;
    }
  }

  public async listByProject(projectId: string, limit: number = 50): Promise<ArtifactMetadata[]> {
    const results: ArtifactMetadata[] = [];
    const seen = new Set<string>();

    for (const meta of this.metadataRegistry.values()) {
      if (meta.projectId === projectId && !seen.has(meta.artifactId)) {
        seen.add(meta.artifactId);
        results.push(meta);
        if (results.length >= limit) break;
      }
    }

    return results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
}
