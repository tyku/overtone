import type { RequestPageController } from '../../hooks/use-request-page-controller';

export function RecorderPanel({ controller }: { controller: RequestPageController }) {
  const { busy, local, timerText, recording, perform } = controller;
  return (
    <section id="recorderPanel" className="panel">
      <p id="timer" className="timer">{timerText}</p>
      <p id="recordingHint" className="muted">Аудио сохраняется на этом устройстве</p>
      <label className="input-picker" htmlFor="audioInput">
        Микрофон
        <select
          id="audioInput"
          value={recording.selectedDeviceId}
          disabled={recording.recording || busy}
          onChange={(event) => recording.selectDevice(event.target.value)}
        >
          <option value="">Выберите микрофон</option>
          {recording.devices.map((device, index) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `Микрофон ${index + 1}`}
            </option>
          ))}
        </select>
      </label>
      <button
        id="permissionButton"
        className="secondary"
        disabled={recording.recording || busy}
        onClick={() => void perform(recording.requestPermission)}
      >
        Разрешить доступ к микрофону
      </button>
      <p id="inputLevel" ref={recording.inputLevelRef} className="input-level">
        Уровень сигнала появится после старта записи
      </p>
      <div className="actions">
        <button
          id="recordButton"
          className={`primary${recording.recording ? ' recording' : ''}`}
          disabled={
            busy || recording.recorderState === 'starting' || recording.recorderState === 'stopping'
          }
          onClick={() => void perform(recording.toggleRecording)}
        >
          {recording.recording
            ? 'Стоп записи'
            : local?.parts.length
              ? 'Продолжить запись'
              : 'Начать запись'}
        </button>
        <button
          id="finishButton"
          className="secondary"
          disabled={busy || !local?.parts.length}
          onClick={() => void perform(controller.save)}
        >
          Завершить приём
        </button>
      </div>
    </section>
  );
}
