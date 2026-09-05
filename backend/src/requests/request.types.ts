import { HttpException } from '@nestjs/common';

export type RequestStatus =
  | 'created'
  | 'saving'
  | 'save_failed'
  | 'processing'
  | 'completed'
  | 'processing_failed'
  | 'abandoned';
export type RetryAction =
  'upload_audio' | 'complete_without_audio' | 'check_status' | 'none';
export type ApiError = {
  code: string;
  message: string;
  retryAction: RetryAction;
};
export class RequestError extends HttpException {
  constructor(
    status: number,
    code: string,
    message: string,
    retryAction: RetryAction = 'none',
    requestId?: string,
  ) {
    super({ requestId, error: { code, message, retryAction } }, status);
  }
}
export type AudioPart = {
  partNo: number;
  field: string;
  mimeType: string;
  bytes: number;
  sha256: string;
};
export type AudioManifest = { parts: AudioPart[] };
export type RequestRow = {
  id: string;
  owner_id: string;
  status: RequestStatus;
  created_at: Date;
  updated_at: Date;
  closed_at: Date | null;
  manifest: AudioManifest | null;
  fingerprint: string | null;
  audio_key: string | null;
  audio_stored: boolean;
  error: ApiError | null;
  abandon_reason: string | null;
  report_key: string | null;
  report_sha256: string | null;
};
export const isClosed = (r: RequestRow) => r.closed_at !== null;
