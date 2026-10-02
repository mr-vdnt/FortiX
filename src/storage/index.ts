import { IArtifactStorage } from './artifact-storage.js';
import { LocalStorageProvider } from './local-storage.js';
import { S3StorageProvider } from './s3-storage.js';

export * from './artifact-storage.js';
export * from './local-storage.js';
export * from './s3-storage.js';

export function createArtifactStorage(provider?: string): IArtifactStorage {
  const selected = provider || process.env.STORAGE_PROVIDER || 'local';
  switch (selected.toLowerCase()) {
    case 's3':
      return new S3StorageProvider();
    case 'local':
    default:
      return new LocalStorageProvider();
  }
}

// Global default singleton storage adapter
export const artifactStorage = createArtifactStorage();
