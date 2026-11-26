# waGrammar.py
# Live grammar and spelling check for Write Assist with LanguageTool, the
# free, open-source checker, self-hosted: its server runs on this computer on
# a portable Java, so text never leaves the PC and there are no limits. Both
# are downloaded once, after the user agrees to the size, into their own
# folder (kept across app updates). The server starts on the first check and
# stops after a while unused to free its memory.
#
# Author:  Luis Martinez
# Email:   16788942+luigihmtz@users.noreply.github.com
# Version: v01.01.00
# Date:    2026-11-25
#
# Usage: imported by writeAssist.pyw. install(progress) once; then
#        Checker().check(text, language, mother_tongue) returns the matches.

import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

import waPlatform as platform

HOME = platform.data_dir("WriteAssist-LanguageTool")
LT_URL = "https://languagetool.org/download/LanguageTool-stable.zip"
if platform.IS_MAC:   # a .tar.gz for Apple silicon or Intel
    import platform as _arch
    JRE_URL = ("https://api.adoptium.net/v3/binary/latest/21/ga/mac/"
               f"{'aarch64' if _arch.machine() == 'arm64' else 'x64'}/jre/hotspot/normal/eclipse?project=jdk")
else:
    JRE_URL = "https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jre/hotspot/normal/eclipse?project=jdk"
DOWNLOAD_MB = 300      # LanguageTool ~252 MB + Java runtime ~49 MB
DISK_MB = 500
PORT = 47615
IDLE_STOP_SECONDS = 15 * 60
NO_WINDOW = platform.NO_WINDOW

# Write Assist's text-language choices -> LanguageTool language codes.
LANGUAGES = {
    "English (US)": "en-US", "English (UK)": "en-GB", "Spanish (Mexico)": "es", "Spanish (Spain)": "es",
    "French": "fr", "Portuguese (Brazil)": "pt-BR", "German": "de-DE", "Italian": "it",
}


def java_exe():
    pattern = "*/Contents/Home/bin/java" if platform.IS_MAC else "*/bin/java.exe"
    found = sorted((HOME / "jre").glob(pattern))
    return found[-1] if found else None


def server_jar():
    found = sorted(HOME.glob("LanguageTool-*/languagetool-server.jar"))
    return found[-1] if found else None


def is_installed():
    return bool(java_exe() and server_jar())


def _download(url, dest, progress, done_before, total_mb):
    # Some download servers refuse Python's default client name; a generic one is enough.
    request = urllib.request.Request(url, headers={"User-Agent": "WriteAssist"})
    with urllib.request.urlopen(request, timeout=60) as response, open(dest, "wb") as out:
        done = 0
        while True:
            chunk = response.read(1 << 20)
            if not chunk:
                break
            out.write(chunk)
            done += len(chunk)
            progress(done_before + done / 1e6, total_mb)
    return done / 1e6


def install(progress):
    """Downloads Java and LanguageTool into HOME, calling progress(done_mb, total_mb)."""
    HOME.mkdir(parents=True, exist_ok=True)
    done_mb = 0.0
    with tempfile.TemporaryDirectory(prefix="WriteAssist-lt-") as temp:
        temp = Path(temp)
        if not java_exe():
            archive_path = temp / ("jre.tar.gz" if platform.IS_MAC else "jre.zip")
            done_mb += _download(JRE_URL, archive_path, progress, done_mb, DOWNLOAD_MB)
            shutil.rmtree(HOME / "jre", ignore_errors=True)
            if platform.IS_MAC:   # tar keeps the executables' permissions
                import tarfile
                with tarfile.open(archive_path) as archive:
                    archive.extractall(HOME / "jre", filter="data") if hasattr(tarfile, "data_filter") \
                        else archive.extractall(HOME / "jre")
            else:
                with zipfile.ZipFile(archive_path) as archive:
                    archive.extractall(HOME / "jre")
        else:
            done_mb += 49
        if not server_jar():
            zip_path = temp / "languagetool.zip"
            _download(LT_URL, zip_path, progress, done_mb, DOWNLOAD_MB)
            with zipfile.ZipFile(zip_path) as archive:
                archive.extractall(HOME)
    if not is_installed():
        raise RuntimeError("The grammar checker didn't finish installing. Check your internet connection and try again.")


def mother_tongue(profile):
    """LanguageTool also flags false friends when it knows the writer's first language."""
    return "es" if re.search(r"spanish|español|espanol|mexic", profile or "", re.I) else ""


class Checker:
    """The LanguageTool server: started on the first check, stopped when idle."""

    def __init__(self):
        self._process = None
        self._lock = threading.Lock()
        self._last_used = 0.0
        self._watchdog = None

    def _url(self, path):
        return f"http://127.0.0.1:{PORT}{path}"

    def _responding(self):
        try:
            with urllib.request.urlopen(self._url("/v2/languages"), timeout=2):
                return True
        except OSError:
            return False

    def _start(self):
        if self._responding():   # already running (e.g. left by a previous session)
            return
        java, jar = java_exe(), server_jar()
        if not (java and jar):
            raise RuntimeError("Live grammar isn't set up yet. Turn it on in Settings to download it.")
        self._process = subprocess.Popen(
            [str(java), "-Xms64m", "-Xmx1g", "-cp", str(jar), "org.languagetool.server.HTTPServer",
             "--port", str(PORT)],
            cwd=jar.parent, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=NO_WINDOW)
        for _ in range(120):
            time.sleep(0.5)
            if self._responding():
                return
            if self._process.poll() is not None:
                break
        raise RuntimeError("The grammar checker didn't start. Restart Write Assist and try again.")

    def check(self, text, language="auto", profile=""):
        """LanguageTool matches for text: [{offset, length, message, replacements, type, rule}].
        Offsets count UTF-16 code units, like JavaScript strings. With "auto",
        each paragraph is checked on its own, so a message that mixes English
        and Spanish paragraphs gets each one checked in its own language."""
        with self._lock:
            self._start()
            self._last_used = time.time()
            self._ensure_watchdog()
        code = LANGUAGES.get(language, "auto")
        tongue = mother_tongue(profile)
        if code != "auto":
            return {"matches": self._check_one(text, code, tongue)}
        matches = []
        for paragraph in re.finditer(r"(?:(?!\n[ \t]*\n)[\s\S])+", text):   # blocks between blank lines
            if not re.search(r"\w", paragraph.group(0)):
                continue
            shift = len(text[:paragraph.start()].encode("utf-16-le")) // 2
            for match in self._check_one(paragraph.group(0), "auto", tongue):
                match["offset"] += shift
                matches.append(match)
        return {"matches": matches}

    def _check_one(self, text, code, tongue):
        params = {"text": text, "language": code}
        if code == "auto":
            params["preferredVariants"] = "en-US,de-DE,pt-BR"
        if tongue:
            params["motherTongue"] = tongue
        data = urllib.parse.urlencode(params).encode()
        with urllib.request.urlopen(urllib.request.Request(self._url("/v2/check"), data), timeout=60) as response:
            result = json.load(response)
        matches = []
        for m in result.get("matches", []):
            matches.append({
                "offset": m["offset"], "length": m["length"],
                "message": m.get("shortMessage") or m.get("message", ""),
                "detail": m.get("message", ""),
                "replacements": [r["value"] for r in m.get("replacements", [])[:6]],
                "type": m.get("rule", {}).get("issueType", ""),
                "rule": m.get("rule", {}).get("id", ""),
            })
        return matches

    def _ensure_watchdog(self):
        if self._watchdog and self._watchdog.is_alive():
            return

        def watch():
            while True:
                time.sleep(60)
                with self._lock:
                    if self._process is None:
                        return
                    if time.time() - self._last_used > IDLE_STOP_SECONDS:
                        self._stop_locked()
                        return
        self._watchdog = threading.Thread(target=watch, daemon=True)
        self._watchdog.start()

    def _stop_locked(self):
        if self._process and self._process.poll() is None:
            self._process.terminate()
            try:
                self._process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._process.kill()
        self._process = None

    def stop(self):
        with self._lock:
            self._stop_locked()
