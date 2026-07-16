"""
Step 1 — Speech-to-Text (STT)
Uses faster-whisper locally — no API key needed.
Supports Arabic and English auto-detection.
In production: swap model with one fine-tuned on SADA dataset.
"""

import os
import tempfile
import wave
import math

# numpy, sounddevice, and faster-whisper (which drags in PyAV's ffmpeg
# DLLs) are imported lazily inside the functions that need them: importers
# like backend/app.py must be able to load this module without paying
# hundreds of MB of RAM up front on the 8GB target machine.

# ── Config ────────────────────────────────────────────────────────────────────

SAMPLE_RATE    = 16000   # Whisper expects 16kHz
CHANNELS       = 1       # Mono
SILENCE_SECS   = 1.5     # Stop after this many silent seconds
MAX_SECS       = 30      # Hard cap
MODEL_SIZE     = "base"  # options: tiny, base, small, medium, large-v3
                         # "small" is more accurate but its inference buffers
                         # do not fit on the 8GB demo machine under load -
                         # mkl_malloc failures made every turn deaf
                         # (2026-07-17). base fits, and is 2-3x faster.
                         # Use "small"+ only on a machine with headroom.
BEAM_SIZE      = 1       # greedy decoding. beam_size=5 was ~2-3x slower per
                         # turn on this CPU for a marginal accuracy gain the
                         # NLU's paraphrase tolerance absorbs anyway. Raise
                         # if transcripts get noticeably worse.
CPU_THREADS    = 2       # MKL allocates per-thread scratch buffers; fewer
                         # threads = smaller allocations that still succeed
                         # under memory pressure. base is fast enough on 2.

# Loaded lazily on first transcription rather than at import: the model
# costs ~500MB RAM, and importers like backend/app.py need this module's
# functions without paying that until actual audio arrives. (First run
# downloads the model, cached after.)
_model = None


def _get_model():
    global _model
    if _model is None:
        from faster_whisper import WhisperModel  # type: ignore

        print("Loading Whisper model... (first run downloads it, be patient)")
        _model = WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8",
                              cpu_threads=CPU_THREADS)
        print("Model ready\n")
    return _model


# ── Audio helpers ─────────────────────────────────────────────────────────────

def rms(chunk) -> float:
    import numpy as np  # type: ignore

    return math.sqrt(np.mean(chunk.astype(np.float32) ** 2))


def calibrate_silence(stream, chunk_size: int, duration_secs: float = 1.0) -> float:
    """
    Listens to ambient noise for ~1 second and sets threshold
    dynamically based on your mic and environment.
    """
    print("🔇  Calibrating mic — stay quiet for 1 second...")
    noise_chunks = []
    num_chunks   = int(duration_secs / 0.1)

    for _ in range(num_chunks):
        chunk, _ = stream.read(chunk_size)
        noise_chunks.append(rms(chunk))

    ambient = sum(noise_chunks) / len(noise_chunks)
    threshold = ambient * 1.5   # threshold = 3.5x ambient noise level
    print(f"Calibrated — ambient: {ambient:.5f}, threshold: {threshold:.5f}\n")
    return threshold


def record_until_silence():
    import numpy as np  # type: ignore
    import sounddevice as sd  # type: ignore

    chunks        = []
    silent_chunks = 0
    chunk_size    = int(SAMPLE_RATE * 0.1)
    silence_limit = int(SILENCE_SECS / 0.1)
    max_chunks    = int(MAX_SECS / 0.1)
    speaking_started = False

    with sd.InputStream(samplerate=SAMPLE_RATE, channels=CHANNELS,
                        dtype='int16', blocksize=chunk_size) as stream:

        # auto-calibrate threshold based on your mic
        threshold = calibrate_silence(stream, chunk_size)

        print("🎙️  Listening... (speak now, stops after silence)\n")

        while len(chunks) < max_chunks:
            chunk, _ = stream.read(chunk_size)
            chunks.append(chunk.copy())
            volume = rms(chunk)

            if volume > threshold:
                speaking_started = True
                silent_chunks = 0
            elif speaking_started:
                silent_chunks += 1
                if silent_chunks >= silence_limit:
                    break

    audio = np.concatenate(chunks, axis=0).flatten()
    print(f"Recorded {len(audio) / SAMPLE_RATE:.1f}s of audio\n")
    return audio


def save_wav(audio, path: str):
    import numpy as np  # type: ignore

    with wave.open(path, 'w') as wf:
        wf.setnchannels(CHANNELS)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(audio.astype(np.int16).tobytes())


# ── Core STT function ─────────────────────────────────────────────────────────

def transcribe(audio) -> dict:
    
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        save_wav(audio, tmp_path)

        segments, info = _get_model().transcribe(
            tmp_path,
            language          = None,
            beam_size         = BEAM_SIZE,
            vad_filter        = True,
            vad_parameters    = {"min_silence_duration_ms": 500},
            initial_prompt    = "هذا تطبيق بنكي. المستخدم يتكلم بالعربية السعودية أو الإنجليزية. كلمات شائعة: حول, تحويل، رصيد، حساب، فاتورة، ريال.",
        )
        text = " ".join(seg.text.strip() for seg in segments)

        return {
            "text":     text.strip(),
            "language": info.language,
            "duration": info.duration,
        }

    finally:
        os.unlink(tmp_path)


def transcribe_file(file_path: str) -> dict:
    """Same but takes a file path instead of recording. For testing."""
    segments, info = _get_model().transcribe(
        file_path,
        language       = None,
        beam_size      = BEAM_SIZE,
        vad_filter     = True,
        vad_parameters = {"min_silence_duration_ms": 500},
        initial_prompt = "هذا تطبيق بنكي. المستخدم يتكلم بالعربية السعودية أو الإنجليزية. كلمات شائعة: حول, تحويل، رصيد، حساب، فاتورة، ريال، أرقام.",
    )
    text = " ".join(seg.text.strip() for seg in segments)
    return {
        "text":     text.strip(),
        "language": info.language,
        "duration": info.duration,
    }


#  Main 

if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1:
        print(f"Transcribing file: {sys.argv[1]}")
        result = transcribe_file(sys.argv[1])
    else:
        audio  = record_until_silence()
        result = transcribe(audio)

    print("─" * 40)
    print(f"📝  Transcript : {result['text']}")
    print(f"🌐  Language   : {result['language']}")
    print(f"⏱️   Duration   : {result['duration']:.1f}s")
    print("─" * 40)
