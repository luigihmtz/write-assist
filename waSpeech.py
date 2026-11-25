# waSpeech.py
# Offline speech-to-text for Write Assist, with faster-whisper (open source,
# free, runs on the CPU). The engine is optional: it's installed with pip the
# first time someone uses the microphone, and its model is downloaded once
# and cached. The model stays loaded while it's being used and is unloaded
# after a few idle minutes to give the memory back.
#
# Author:  Luis Martinez
# Email:   16788942+luigihmtz@users.noreply.github.com
# Version: v01.00.01
# Date:    2026-11-24
#
# Usage: imported by writeAssist.pyw. Settings (settings.json or
#        user_settings.json): "speech_model" ("small" default, "base" lighter,
#        "medium" more accurate) and "speech_language" ("" = detect, or "en",
#        "es", ...).

import importlib
import importlib.util
import os
import site
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

PACKAGE = "faster-whisper"
IDLE_UNLOAD_SECONDS = 10 * 60
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

# Approximate one-time download sizes, shown before installing.
MODEL_SIZES_MB = {"tiny": 75, "base": 145, "small": 465, "medium": 1500}
ENGINE_SIZE_MB = 250


# Whisper sometimes "hears" these stock phrases in silence or room noise.
NO_SPEECH_LIMIT = 0.5
PHANTOM_PHRASES = {
    "thank you", "thank you very much", "thanks for watching", "thank you for watching",
    "thanks", "bye", "you", "gracias", "muchas gracias", "gracias por ver el video",
    "subtítulos realizados por la comunidad de amaraorg",
}


def _is_phantom(text, speech_seconds):
    normalized = "".join(c for c in text.lower() if c.isalnum() or c.isspace()).strip()
    return normalized in PHANTOM_PHRASES and speech_seconds < 3


def _ensure_user_site():
    """pip --user installs land in the user site folder, which Python only adds
    to sys.path at startup if it already existed."""
    user_site = site.getusersitepackages()
    if os.path.isdir(user_site) and user_site not in sys.path:
        site.addsitedir(user_site)
    importlib.invalidate_caches()


def is_installed():
    _ensure_user_site()
    return importlib.util.find_spec("faster_whisper") is not None


def model_is_cached(model_name):
    hub = Path(os.environ.get("HF_HOME") or Path.home() / ".cache" / "huggingface") / "hub"
    return (hub / f"models--Systran--faster-whisper-{model_name}").exists()


def download_size_mb(model_name):
    size = 0 if is_installed() else ENGINE_SIZE_MB
    if not model_is_cached(model_name):
        size += MODEL_SIZES_MB.get(model_name, 500)
    return size


def install(python):
    """pip-installs faster-whisper for this user. Returns (ok, message)."""
    proc = subprocess.run(
        [python, "-m", "pip", "install", "--user", "--upgrade", "--disable-pip-version-check", PACKAGE],
        capture_output=True, text=True, encoding="utf-8", errors="replace", creationflags=NO_WINDOW,
    )
    if proc.returncode != 0:
        return False, (proc.stderr or proc.stdout).strip()[-1200:]
    return (True, "installed") if is_installed() else (False, "Installed, but Python can't find it. Restart Write Assist.")


class Transcriber:
    def __init__(self):
        self.lock = threading.Lock()
        self.model = None
        self.model_name = None
        self.last_used = 0.0
        self._watchdog = None

    def _load(self, model_name):
        if self.model is not None and self.model_name == model_name:
            return
        _ensure_user_site()
        from faster_whisper import WhisperModel  # imported lazily: heavy, and optional
        self.model = WhisperModel(model_name, device="cpu", compute_type="int8")
        self.model_name = model_name

    def transcribe(self, audio_bytes, suffix, model_name="small", language=""):
        """Transcribes recorded audio (e.g. webm/opus from the browser). Returns text."""
        with self.lock:
            self._load(model_name)
            fd, path = tempfile.mkstemp(suffix=suffix or ".webm")
            try:
                with os.fdopen(fd, "wb") as handle:
                    handle.write(audio_bytes)
                segments, _info = self.model.transcribe(
                    path, language=language or None, vad_filter=True, beam_size=5,
                    condition_on_previous_text=False)
                kept = [s for s in segments if s.no_speech_prob < NO_SPEECH_LIMIT]
                text = " ".join(s.text.strip() for s in kept).strip()
                if _is_phantom(text, sum(s.end - s.start for s in kept)):
                    text = ""
            finally:
                try:
                    os.remove(path)
                except OSError:
                    pass
            self.last_used = time.time()
            self._schedule_unload()
            return text

    def _schedule_unload(self):
        if self._watchdog and self._watchdog.is_alive():
            return

        def watch():
            while True:
                time.sleep(30)
                with self.lock:
                    if self.model is None:
                        return
                    if time.time() - self.last_used > IDLE_UNLOAD_SECONDS:
                        self.model = None
                        self.model_name = None
                        return
        self._watchdog = threading.Thread(target=watch, daemon=True)
        self._watchdog.start()
