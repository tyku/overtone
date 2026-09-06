export type CommandStatus =
  'pending' | 'polling' | 'succeeded' | 'failed' | 'timed_out';
export type CommandRow = {
  command_id: string;
  request_id: string;
  source_audio_key: string;
  parameters: { encounterId: string; specialty: string; llmBackend: string };
  status: CommandStatus;
  first_sent_at: Date | null;
  deadline_at: Date | null;
  next_action_at: Date | null;
  revision: number;
  remote_status: string | null;
  snapshot: ProcessSnapshot | null;
  error: { code: string; message: string } | null;
  created_at: Date;
  finished_at: Date | null;
};
export type ProcessSnapshot = {
  commandId: string;
  requestId: string;
  status: string;
  currentStage: string;
  resultKey: string;
  error?: { code: string; message: string };
  stages: {
    stageCode: string;
    status: string;
    ordinal: number;
    startedAt: string;
    finishedAt: string;
  }[];
};
export const POLL_MS = 3000;
export const PROCESS_TIMEOUT_MS = 5 * 60 * 1000;
