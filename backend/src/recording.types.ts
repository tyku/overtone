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
};
