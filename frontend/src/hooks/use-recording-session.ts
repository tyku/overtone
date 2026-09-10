import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { requestApi, requestStore } from '../app/services';
import { AudioMeter } from '../audio-meter';
import type { LocalRequest, RequestRow, RequestStatus } from '../types';
import { VisitRecorder } from '../visit-recorder';

const AUDIO_INPUT_KEY = 'overtone.audioInputId';

interface RecordingSessionOptions {
  requestId: string;
  status?: RequestStatus;
  local: LocalRequest | null;
  busy: boolean;
  setLastError: (message: string | null) => void;
  applyServer: (row: RequestRow) => Promise<LocalRequest>;
}

export function useRecordingSession({
  requestId,
  status,
  local,
  busy,
  setLastError,
  applyServer,
}: RecordingSessionOptions) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState(
    () => localStorage.getItem(AUDIO_INPUT_KEY) ?? '',
  );
  const [elapsedMs, setElapsedMs] = useState(0);
  const [revision, refreshRecorderState] = useReducer((value: number) => value + 1, 0);
  const inputLevelRef = useRef<HTMLParagraphElement>(null);
  const meterRef = useRef<AudioMeter | undefined>(undefined);
  const recorderRef = useRef<VisitRecorder | undefined>(undefined);

  if (!recorderRef.current) {
    recorderRef.current = new VisitRecorder(requestStore, (error) => {
      setLastError(error.message);
      refreshRecorderState();
    });
  }
  const recorder = recorderRef.current;

  const refreshDevices = useCallback(async () => {
    const inputs = (await navigator.mediaDevices.enumerateDevices()).filter(
      (device) => device.kind === 'audioinput',
    );
    setDevices(inputs);
    const remembered = localStorage.getItem(AUDIO_INPUT_KEY) ?? '';
    if (inputs.some((input) => input.deviceId === selectedDeviceId)) return;
    setSelectedDeviceId(inputs.some((input) => input.deviceId === remembered) ? remembered : '');
  }, [selectedDeviceId]);

  const requestPermission = useCallback(async () => {
    const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    permissionStream.getTracks().forEach((track) => track.stop());
    await refreshDevices();
  }, [refreshDevices]);

  const selectDevice = useCallback((deviceId: string) => {
    setSelectedDeviceId(deviceId);
    if (deviceId) localStorage.setItem(AUDIO_INPUT_KEY, deviceId);
    else localStorage.removeItem(AUDIO_INPUT_KEY);
  }, []);

  const toggleRecording = useCallback(async () => {
    setLastError(null);
    if (recorder.state === 'recording') {
      await recorder.stop();
      meterRef.current?.stop();
      refreshRecorderState();
      return;
    }

    let deviceId = selectedDeviceId;
    if (!deviceId) {
      await requestPermission();
      const inputs = (await navigator.mediaDevices.enumerateDevices()).filter(
        (device) => device.kind === 'audioinput',
      );
      deviceId = inputs[0]?.deviceId ?? '';
      if (deviceId) selectDevice(deviceId);
      if (!deviceId) throw new Error('Выберите микрофон в списке');
    }

    const row = await requestApi.get(requestId);
    await applyServer(row);
    if (row.status !== 'created') throw new Error('Запись этого приёма уже завершена');
    const capture = await recorder.start(requestId, deviceId);
    refreshRecorderState();
    if (capture && inputLevelRef.current) {
      meterRef.current ??= new AudioMeter(inputLevelRef.current);
      await meterRef.current.start(capture.stream, capture.track);
    }
  }, [applyServer, recorder, requestId, requestPermission, selectDevice, selectedDeviceId, setLastError]);

  useEffect(() => {
    if (status === 'created') void refreshDevices().catch(() => undefined);
  }, [refreshDevices, status]);

  useEffect(() => {
    if (recorder.state !== 'recording') {
      setElapsedMs(local?.parts.reduce((sum, part) => sum + part.durationMs, 0) ?? 0);
      return;
    }
    const update = () => setElapsedMs(recorder.previousMs + Date.now() - recorder.startedAt);
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [local, recorder, revision]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (recorder.state === 'recording' || busy) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [busy, recorder, revision]);

  useEffect(
    () => () => {
      meterRef.current?.stop();
      if (recorder.state === 'recording') void recorder.stop();
    },
    [recorder],
  );

  return {
    devices,
    selectedDeviceId,
    selectDevice,
    requestPermission,
    toggleRecording,
    inputLevelRef,
    elapsedMs,
    recording: recorder.state === 'recording',
    recorderState: recorder.state,
    finalize: () => recorder.finalize(requestId),
    stopMeter: () => meterRef.current?.stop(),
    refreshRecorderState,
  };
}
