export type RecordingUploadMetadata = {
  sessionId: string;
  recordingId: string;
  segmentNo: number;
  mimeType: string;
  recordingComplete: boolean;
};

export type RecordingSegmentSaved = {
  sessionId: string;
  recordingId: string;
  segmentNo: number;
  bytes: number;
  fileName: string;
  alreadyExisted: boolean;
};

export type RecordingSaved = RecordingSegmentSaved & {
  finalFileName?: string;
  finalBytes?: number;
  s3Bucket?: string;
  s3ObjectKey?: string;
};

export type RecordingFinalized = {
  fileName: string;
  localPath: string;
  extension: string;
  mimeType: string;
  bytes: number;
  alreadyExisted: boolean;
};

export type RecordingLocallySaved = RecordingSegmentSaved & {
  finalized?: RecordingFinalized;
};
