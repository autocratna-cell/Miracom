// 회의 녹음 (MediaRecorder)
export const support = {
  record: Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder),
};

export class MeetingRecorder {
  constructor({ onTick }) {
    this.onTick = onTick; // 경과초
    this.active = false;
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((m) =>
      MediaRecorder.isTypeSupported?.(m)
    );
    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream, mime ? { mimeType: mime } : {});
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.recorder.start(1000);
    this.active = true;
    this.startedAt = Date.now();
    this.timer = setInterval(() => this.onTick?.(this.elapsed()), 1000);
  }

  elapsed() {
    return Math.floor((Date.now() - this.startedAt) / 1000);
  }

  // 녹음 종료 → { blob, mime, durationSec }
  stop() {
    this.active = false;
    clearInterval(this.timer);
    const durationSec = this.elapsed();
    return new Promise((resolve) => {
      this.recorder.onstop = () => {
        this.stream.getTracks().forEach((t) => t.stop());
        const mime = this.recorder.mimeType || "audio/webm";
        resolve({ blob: new Blob(this.chunks, { type: mime }), mime, durationSec });
        this.recorder = null;
      };
      this.recorder.stop();
    });
  }
}

export const fmtClock = (sec) =>
  `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
