// 녹음 → 텍스트 변환 워커 (Whisper 음성 인식, 휴대폰 안에서 실행, API 키 불필요)
// 모델은 처음 한 번만 내려받고 이후에는 브라우저에 저장된 것을 씁니다.
import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";

env.allowLocalModels = false;

const CHUNK_SEC = 30;
const SAMPLE_RATE = 16000;

let asr = null;
let loadedModel = null;
let device = "wasm";
let cancelled = false;

// 모델 파일별 내려받기 진행률을 모아서 전체 %로 알림
const files = new Map();
function onProgress(p) {
  if (p.status === "progress" && p.total) {
    files.set(p.file, { loaded: p.loaded, total: p.total });
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) {
      loaded += f.loaded;
      total += f.total;
    }
    self.postMessage({ type: "download", loaded, total });
  }
}

async function pickDevice() {
  try {
    const adapter = await navigator.gpu?.requestAdapter();
    if (adapter) {
      return {
        device: "webgpu",
        dtype: { encoder_model: adapter.features.has("shader-f16") ? "fp16" : "fp32", decoder_model_merged: "q4" },
      };
    }
  } catch {
    /* WebGPU 미지원 */
  }
  return { device: "wasm", dtype: "q8" };
}

async function load(model) {
  if (asr && loadedModel === model) return;
  files.clear();
  const opt = await pickDevice();
  try {
    asr = await pipeline("automatic-speech-recognition", model, { ...opt, progress_callback: onProgress });
    device = opt.device;
  } catch (err) {
    if (opt.device !== "webgpu") throw err;
    // GPU로 못 돌리면 CPU(WASM)로 다시 시도
    files.clear();
    asr = await pipeline("automatic-speech-recognition", model, { device: "wasm", dtype: "q8", progress_callback: onProgress });
    device = "wasm";
  }
  loadedModel = model;
}

// Whisper가 소리 없는 구간에서 지어내는 흔한 문장 걸러내기
const NOISE = /^(\s|\.|,|!|\?|…|음+|어+|아+|시청해 주셔서 감사합니다\.?|MBC 뉴스.*|구독과 좋아요.*)*$/;

self.onmessage = async ({ data }) => {
  if (data.type === "cancel") {
    cancelled = true;
    return;
  }
  if (data.type !== "transcribe") return;
  cancelled = false;
  try {
    self.postMessage({ type: "status", stage: "loading" });
    await load(data.model);
    self.postMessage({ type: "status", stage: "ready", device });

    const audio = data.audio; // Float32Array, 16kHz 모노
    const step = CHUNK_SEC * SAMPLE_RATE;
    const total = Math.max(1, Math.ceil(audio.length / step));
    for (let i = 0; i < total; i++) {
      if (cancelled) {
        self.postMessage({ type: "cancelled", index: i, total });
        return;
      }
      const chunk = audio.subarray(i * step, Math.min(audio.length, (i + 1) * step));
      let text = "";
      if (chunk.length > SAMPLE_RATE / 2) {
        const out = await asr(chunk, { language: "korean", task: "transcribe" });
        text = (Array.isArray(out) ? out[0]?.text : out?.text)?.trim() || "";
        if (NOISE.test(text)) text = "";
      }
      self.postMessage({ type: "chunk", index: i, total, startSec: i * CHUNK_SEC, text });
    }
    self.postMessage({ type: "done" });
  } catch (err) {
    self.postMessage({ type: "error", message: String(err?.message || err) });
  }
};
