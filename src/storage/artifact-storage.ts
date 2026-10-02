export interface ArtifactMetadata {
  artifactId: string;
  verificationId?: string;
  projectId: string;
  storageProvider: 'local' | 's3' | 'gcs';
  objectKey: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  filename: string;
  createdAt: string;
  customMetadata?: Record<string, any>;
}

export interface PutArtifactOptions {
  artifactId?: string;
  verificationId?: string;
  projectId: string;
  filename: string;
  contentType?: string;
  customMetadata?: Record<string, any>;
}

export interface IArtifactStorage {
  readonly providerName: 'local' | 's3' | 'gcs';

  /**
   * Stores an artifact buffer, computing its SHA-256 hash and metadata.
   */
  put(buffer: Buffer | Uint8Array, options: PutArtifactOptions): Promise<ArtifactMetadata>;

  /**
   * Retrieves an artifact by its object key or artifactId with tenant validation.
   */
  get(objectKeyOrId: string, projectId?: string): Promise<{ data: Buffer; metadata: ArtifactMetadata } | null>;

  /**
   * Retrieves artifact metadata without reading data.
   */
  getMetadata(objectKeyOrId: string, projectId?: string): Promise<ArtifactMetadata | null>;

  /**
   * Checks whether an artifact exists.
   */
  exists(objectKeyOrId: string, projectId?: string): Promise<boolean>;

  /**
   * Deletes an artifact by object key or artifactId.
   */
  delete(objectKeyOrId: string, projectId?: string): Promise<boolean>;

  /**
   * Lists all stored artifacts for a given project.
   */
  listByProject(projectId: string, limit?: number): Promise<ArtifactMetadata[]>;
}
