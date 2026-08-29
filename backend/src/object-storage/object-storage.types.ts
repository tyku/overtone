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
