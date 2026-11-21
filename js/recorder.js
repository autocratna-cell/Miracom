// 회의 녹음(MediaRecorder) + 실시간 받아쓰기(Web Speech API, 한국어)
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export const support = {
  record: Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder),
  speech: Boolean(SpeechRecognition),
};

export class MeetingRecorder {
  constructor({ onText, onInterim, onTick, onError }) {
    this.onText = onText; // (확정된 문장, 경과초)
    this.onInterim = onInterim; // 인식 중인 문장
    this.onTick = onTick; // 경과초
    this.onError = onError;
    this.active = false;
  }

  async start({ record = true, transcribe = true } = {}) {
    this.active = true;
    this.chunks = [];
    this.startedAt = Date.now();
    this.timer = setInterval(() => this.onTick?.(this.elapsed()), 1000);

    if (record && support.record) {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((m) =>
        MediaRecorder.isTypeSupported?.(m)
      );
      this.recorder = new MediaRecorder(this.stream, mime ? { mimeType: mime } : {});
      this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
      this.recorder.start(1000);
    }
    if (transcribe && support.speech) this.startSpeech();
  }

  startSpeech() {
    const rec = new SpeechRecognition();
    rec.lang = "ko-KR";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) this.onText?.(r[0].transcript.trim(), this.elapsed());
        else interim += r[0].transcript;
      }
      this.onInterim?.(interim);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        this.onError?.("음성 인식 권한이 없습니다. 브라우저 마이크 권한을 확인해 주세요.");
        this.speechBlocked = true;
      }
    };
    // 휴대폰 브라우저는 조용하면 인식을 멈추므로, 회의 중에는 자동으로 다시 시작
    rec.onend = () => {
      if (this.active && !this.speechBlocked) {
        try {
          rec.start();
        } catch {
          /* 이미 시작됨 */
        }
      }
    };
    this.speech = rec;
    rec.start();
  }

  elapsed() {
    return Math.floor((Date.now() - this.startedAt) / 1000);
  }

  // 녹음 종료 → { blob, mime, durationSec } (녹음 안 했으면 blob=null)
  stop() {
    this.active = false;
    clearInterval(this.timer);
    this.speech?.stop();
    this.onInterim?.("");
    const durationSec = this.elapsed();
    if (!this.recorder) return Promise.resolve({ blob: null, durationSec });
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
