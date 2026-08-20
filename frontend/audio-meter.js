export class AudioMeter {
  constructor(element) {
    this.element = element;
    this.audioContext = undefined;
    this.analyser = undefined;
    this.levelBuffer = undefined;
    this.frame = undefined;
  }

  async start(stream, audioTrack, onLevel) {
    this.stop();
    this.audioContext = new AudioContext();
    await this.audioContext.resume();
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 2048;
    this.levelBuffer = new Uint8Array(this.analyser.fftSize);
    this.audioContext.createMediaStreamSource(stream).connect(this.analyser);

    const update = () => {
      if (!this.analyser || !this.levelBuffer) return;
      this.analyser.getByteTimeDomainData(this.levelBuffer);
      const rms = this.calculateRms();
      const silent = rms < 0.003;
      const percent = Math.min(100, Math.round(rms * 400));
      this.setDisplay(
        audioTrack.muted ? 'Микрофон отключён системой или браузером' : `Уровень микрофона: ${percent}%`,
        audioTrack.muted || silent ? 'is-silent' : 'is-active',
      );
      onLevel({ rms, muted: audioTrack.muted });
      this.frame = requestAnimationFrame(update);
    };
    update();
  }

  stop() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.analyser = undefined;
    this.levelBuffer = undefined;
    if (this.audioContext && this.audioContext.state !== 'closed') void this.audioContext.close();
    this.audioContext = undefined;
  }

  showMessage(text, state = '') {
    this.setDisplay(text, state);
  }

  calculateRms() {
    let sum = 0;
    for (const value of this.levelBuffer) {
      const normalized = (value - 128) / 128;
      sum += normalized * normalized;
    }
    return Math.sqrt(sum / this.levelBuffer.length);
  }

  setDisplay(text, state) {
    this.element.textContent = text;
    this.element.className = `input-level ${state}`;
  }
}
