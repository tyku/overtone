export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

export type ObjectStorageUpload = {
  sourcePath: string;
  objectKey: string;
  contentType: string;
  metadata?: Record<string, string>;
};

export type StoredObject = {
  bucket: string;
  objectKey: string;
  bytes: number;
  etag?: string;
};

export interface ObjectStorage {
  uploadFile(upload: ObjectStorageUpload): Promise<StoredObject>;
}

export type ObjectInfo = StoredObject & { metadata: Record<string, string> };
export interface DurableObjectStorage extends ObjectStorage {
  headObject(objectKey: string): Promise<ObjectInfo | undefined>;
  uploadImmutable(upload: ObjectStorageUpload): Promise<void>;
  readText(objectKey: string, maxBytes: number): Promise<string>;
}
