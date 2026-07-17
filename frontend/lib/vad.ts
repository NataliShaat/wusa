// Voice activity detection - wraps @ricky0123/vad-web (Silero VAD via
// ONNX/WASM), chosen over a simple energy-threshold VAD specifically
// because it distinguishes real speech from background noise, which
// matters for a noisy hackathon-hall demo.
//
// onSpeechEnd hands us the isolated utterance as raw Float32 samples
// directly - encoding that to WAV client-side is simpler than using
// MediaRecorder+webm and avoids needing ffmpeg on the backend to decode it.
//
// The VAD model, audio worklet, and onnxruntime wasm are served from
// /public/vad (copied out of node_modules) and pointed at via
// baseAssetPath/onnxWASMBasePath. This version of vad-web (0.0.30) has no
// CDN fallback - under a bundler its default asset path is the site root,
// which 404s in Next.js and makes MicVAD.new() reject, so self-hosting
// these files is required for the mic to work at all (and keeps the demo
// independent of conference wifi).

import { MicVAD } from "@ricky0123/vad-web";

const VAD_SAMPLE_RATE = 16000;

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Blob([buffer], { type: "audio/wav" });
}

export type VoiceDetector = {
  start: () => void;
  pause: () => void;
  destroy: () => void;
};

export async function createVoiceDetector(handlers: {
  onSpeechStart: () => void;
  onSpeechEnd: (audioBlob: Blob) => void;
}): Promise<VoiceDetector> {
  // Preflight the self-hosted assets first so a hosting problem (404,
  // auth-protected deployment, missing files) produces a precise error
  // instead of a generic "microphone can't be accessed".
  const probe = await fetch("/vad/vad.worklet.bundle.min.js", { method: "HEAD" }).catch((e) => {
    throw new Error(`VAD asset fetch failed: ${String(e)}`);
  });
  if (!probe.ok) {
    throw new Error(`VAD assets unreachable: /vad/ returned ${probe.status}`);
  }

  const vad = await MicVAD.new({
    baseAssetPath: "/vad/",
    onnxWASMBasePath: "/vad/",
    onSpeechStart: handlers.onSpeechStart,
    onSpeechEnd: (audio: Float32Array) => {
      handlers.onSpeechEnd(encodeWav(audio, VAD_SAMPLE_RATE));
    },
  });

  return {
    start: () => vad.start(),
    pause: () => vad.pause(),
    destroy: () => vad.destroy(),
  };
}
