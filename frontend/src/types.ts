export type RequestStatus =
  | 'created'
  | 'saving'
  | 'save_failed'
  | 'processing'
  | 'completed'
  | 'processing_failed'
  | 'abandoned';

export type RetryAction =
  | 'none'
  | 'check_status'
  | 'upload_audio'
  | 'complete_without_audio';

export interface RequestError {
  code: string;
  message: string;
  retryAction?: RetryAction;
}

export interface RequestCommand {
  commandId: string;
  status: string;
}

export interface RequestRow {
  requestId: string;
  status: RequestStatus;
  createdAt: string;
  closedAt?: string | null;
  audioStored: boolean | null;
  error?: RequestError | null;
  commands?: RequestCommand[];
  httpStatus?: number;
}

export interface RequestPage {
  items: RequestRow[];
  nextCursor: string | null;
}

export interface Report {
  requestId: string;
  format: string;
  schemaVersion: number;
  content: string;
}

export interface LocalPart {
  partNo: number;
  mimeType: string;
  startedAt: number;
  stoppedAt?: number;
  durationMs: number;
}

export interface LocalRequest {
  requestId: string;
  createdAt: string;
  status: RequestStatus;
  parts: LocalPart[];
  frozenAt: number | null;
  audioStored: boolean;
  abandonedAt: number | null;
  expiresAt: number | null;
  captureError: string | null;
  audioExpired?: boolean;
}

export interface AudioPart extends LocalPart {
  blob: Blob;
}

export interface LegacyRecording {
  id: string;
  startedAt: number;
}

export interface LegacyPart {
  number: number;
  blob: Blob;
}
