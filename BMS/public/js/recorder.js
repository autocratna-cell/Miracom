// 회의 녹음(MediaRecorder) + 실시간 받아쓰기(Web Speech API, 한국어)
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

// 안드로이드는 마이크를 한 기능만 쓸 수 있어 녹음과 받아쓰기를 동시에 못 함
export const isAndroid = /Android/i.test(navigator.userAgent);

const SPEECH_ERRORS = {
  "not-allowed": "마이크 권한이 없습니다. 주소창 왼쪽 자물쇠(또는 앱 정보) → 권한 → 마이크를 허용해 주세요.",
  "service-not-allowed": "이 브라우저에서 음성 인식을 쓸 수 없습니다. 크롬을 사용해 주세요.",
  "audio-capture": "마이크를 쓸 수 없습니다. 다른 앱(음성 녹음, 통화 등)이 마이크를 쓰고 있는지 확인해 주세요.",
  network: "받아쓰기는 인터넷 연결이 필요합니다. 연결 상태를 확인해 주세요.",
  "language-not-supported": "이 기기에서 한국어 음성 인식을 지원하지 않습니다.",
};

export const support = {
  record: Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder),
  speech: Boolean(SpeechRecognition),
};

export class MeetingRecorder {
  constructor({ onText, onInterim, onTick, onError, onInfo }) {
    this.onText = onText; // (확정된 문장, 경과초)
    this.onInterim = onInterim; // 인식 중인 문장
    this.onTick = onTick; // 경과초
    this.onError = onError;
    this.onInfo = onInfo;
    this.active = false;
  }

  async start({ record = true, transcribe = true } = {}) {
    this.active = true;
    this.chunks = [];
    this.startedAt = Date.now();
    this.timer = setInterval(() => this.onTick?.(this.elapsed()), 1000);

    if (record && transcribe && isAndroid && support.speech) {
      record = false; // 받아쓰기를 우선
      this.onInfo?.("안드로이드에서는 녹음과 받아쓰기를 동시에 할 수 없어 받아쓰기만 합니다. 녹음 파일은 갤럭시 음성 녹음 앱을 이용해 주세요.");
    }
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
    rec.onstart = () => this.onInterim?.("🎧 듣는 중… 말씀하시면 여기에 표시됩니다.");
    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return; // 조용함 → 자동 재시작
      this.onError?.(SPEECH_ERRORS[e.error] || `받아쓰기 오류: ${e.error}`);
      if (e.error !== "network") this.speechBlocked = true;
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
