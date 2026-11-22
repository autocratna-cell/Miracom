// 녹음 파일 → 16kHz 모노 음성으로 바꾼 뒤 워커에서 텍스트로 변환
export const STT_MODELS = {
  "onnx-community/whisper-small": "정확 (권장, 처음 한 번 약 300MB 내려받기)",
  "onnx-community/whisper-base": "빠름 (정확도 낮음, 처음 한 번 약 150MB 내려받기)",
};
export const DEFAULT_STT_MODEL = "onnx-community/whisper-small";

export async function decodeAudio(blob) {
  const buf = await blob.arrayBuffer();
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx({ sampleRate: 16000 });
  try {
    const decoded = await ctx.decodeAudioData(buf);
    if (decoded.numberOfChannels === 1) return decoded.getChannelData(0).slice();
    const out = new Float32Array(decoded.length);
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      const ch = decoded.getChannelData(c);
      for (let i = 0; i < ch.length; i++) out[i] += ch[i] / decoded.numberOfChannels;
    }
    return out;
  } finally {
    ctx.close?.();
  }
}

let worker = null;
function getWorker() {
  if (!worker) worker = new Worker(new URL("./stt-worker.js", import.meta.url), { type: "module" });
  return worker;
}

// handlers: onStatus(stage, info), onDownload(loaded, total), onChunk({index,total,startSec,text})
export function transcribe(audio, model, handlers) {
  const w = getWorker();
  const done = new Promise((resolve, reject) => {
    w.onmessage = ({ data }) => {
      if (data.type === "status") handlers.onStatus?.(data.stage, data);
      else if (data.type === "download") handlers.onDownload?.(data.loaded, data.total);
      else if (data.type === "chunk") handlers.onChunk?.(data);
      else if (data.type === "done") resolve({ cancelled: false });
      else if (data.type === "cancelled") resolve({ cancelled: true });
      else if (data.type === "error") reject(new Error(data.message));
    };
    w.onerror = (e) => reject(new Error(e.message || "음성 인식 엔진을 불러오지 못했습니다."));
  });
  w.postMessage({ type: "transcribe", audio, model }, [audio.buffer]);
  return { done, cancel: () => w.postMessage({ type: "cancel" }) };
}
