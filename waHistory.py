# waHistory.py
# Version history for Write Assist: every Review or Create saves the text sent
# and the result, and the user can save the draft by hand (with a label). The
# last 200 versions are kept in a JSON file on this computer only. Versions are
# grouped by piece of writing: Clear starts a new group.
#
# Author:  Luis Martinez
# Email:   16788942+luigihmtz@users.noreply.github.com
# Version: v01.00.00
# Date:    2026-11-25
#
# Usage: imported by writeAssist.pyw. History(path).add(...), .list(), .get(id),
#        .delete(id), .clear(), .new_group(); compare(a, b) for the diff view.

import difflib
import json
import re
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path

MAX_VERSIONS = 200


class History:
    def __init__(self, path):
        self.path = Path(path)
        self._lock = threading.Lock()

    def _load(self):
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            data = {}
        data.setdefault("group", uuid.uuid4().hex[:8])
        data.setdefault("versions", [])
        return data

    def _save(self, data):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temp = self.path.with_suffix(".tmp")
        temp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
        temp.replace(self.path)   # never leaves a half-written file

    def add(self, text, source, label="", **details):
        """Saves a version (newest first); skips it if it's the same text as the
        group's latest version. details: prompt, task, mode, tone, language,
        provider, model. Returns the version, or None when skipped."""
        if not (text or "").strip():
            return None
        with self._lock:
            data = self._load()
            latest = next((v for v in data["versions"] if v["group"] == data["group"]), None)
            if latest and latest["text"] == text and not label:
                return None
            version = {
                "id": uuid.uuid4().hex[:12],
                "group": data["group"],
                "time": datetime.now().isoformat(timespec="seconds"),
                "source": source,          # "draft", "result" or "saved"
                "label": label.strip(),
                "text": text,
                **{key: value for key, value in details.items() if value},
            }
            data["versions"].insert(0, version)
            del data["versions"][MAX_VERSIONS:]
            self._save(data)
            return version

    def list(self):
        data = self._load()
        return {"group": data["group"], "versions": data["versions"]}

    def get(self, version_id):
        return next((v for v in self._load()["versions"] if v["id"] == version_id), None)

    def delete(self, version_id):
        with self._lock:
            data = self._load()
            data["versions"] = [v for v in data["versions"] if v["id"] != version_id]
            self._save(data)

    def clear(self):
        with self._lock:
            self._save({"group": uuid.uuid4().hex[:8], "versions": []})

    def new_group(self):
        with self._lock:
            data = self._load()
            data["group"] = uuid.uuid4().hex[:8]
            self._save(data)
            return data["group"]


_TOKENS = re.compile(r"\s+|\w+|[^\w\s]", re.UNICODE)


def compare(old, new):
    """Word-level differences from old to new: [{"type": "equal"|"insert"|"delete", "text"}]."""
    a, b = _TOKENS.findall(old or ""), _TOKENS.findall(new or "")
    parts = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if op == "equal":
            parts.append({"type": "equal", "text": "".join(a[i1:i2])})
        else:
            if i2 > i1:
                parts.append({"type": "delete", "text": "".join(a[i1:i2])})
            if j2 > j1:
                parts.append({"type": "insert", "text": "".join(b[j1:j2])})
    return parts
