export class AudioMeter {
  private audioContext?: AudioContext;
  private analyser?: AnalyserNode;
  private levelBuffer?: Uint8Array<ArrayBuffer>;
  private frame?: number;

  constructor(private readonly element: HTMLElement) {}

  async start(stream: MediaStream, audioTrack: MediaStreamTrack): Promise<void> {
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
        audioTrack.muted
          ? 'Микрофон отключён системой или браузером'
          : `Уровень микрофона: ${percent}%`,
        audioTrack.muted || silent ? 'is-silent' : 'is-active',
      );
      this.frame = requestAnimationFrame(update);
    };
    update();
  }

  stop(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.analyser = undefined;
    this.levelBuffer = undefined;
    if (this.audioContext && this.audioContext.state !== 'closed') {
      void this.audioContext.close();
    }
    this.audioContext = undefined;
  }

  private calculateRms(): number {
    if (!this.levelBuffer) return 0;
    let sum = 0;
    for (const value of this.levelBuffer) {
      const normalized = (value - 128) / 128;
      sum += normalized * normalized;
    }
    return Math.sqrt(sum / this.levelBuffer.length);
  }

  private setDisplay(text: string, state: string): void {
    this.element.textContent = text;
    this.element.className = `input-level ${state}`;
  }
}
