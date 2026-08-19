import { WriteStream } from 'node:fs';

export type RecordingSession = {
  id: string;
  temporaryPath: string;
  finalPath: string;
  stream: WriteStream;
  chunks: number;
  closed: boolean;
};

export type RecordingCompleted = {
  chunks: number;
  bytes: number;
  fileName: string | undefined;
};

export type RecordingCommand = {
  type?: string;
  recordingSessionId?: string;
  mimeType?: string;
  inputLabel?: string;
  trackSettings?: Record<string, unknown>;
  rms?: number;
  muted?: boolean;
  state?: string;
};
