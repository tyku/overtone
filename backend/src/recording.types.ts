export type RecordingUploadMetadata = {
  sessionId: string;
  recordingId: string;
  segmentNo: number;
  mimeType: string;
  recordingComplete: boolean;
};

export type RecordingSaved = {
  sessionId: string;
  recordingId: string;
  segmentNo: number;
  bytes: number;
  fileName: string;
  alreadyExisted: boolean;
  finalFileName?: string;
  finalBytes?: number;
};

export type RecordingFinalized = {
  fileName: string;
  bytes: number;
  alreadyExisted: boolean;
};
