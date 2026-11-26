# waExport.py
# Exports a text from Write Assist as Word (.docx), plain text or Markdown,
# with a short "side-text" block at the end (author, date, prompt, language,
# AI, "Made with Write Assist"). Word files also get the author, title and date
# in their document properties. Also finds the cloud folders synced on this
# computer (OneDrive, Google Drive, Dropbox), so an export can be saved there.
# PDF is made by the window itself (see writeAssist.pyw).
#
# Author:  Luis Martinez
# Email:   16788942+luigihmtz@users.noreply.github.com
# Version: v01.00.00
# Date:    2026-11-25
#
# Usage: imported by writeAssist.pyw. write(path, fmt, text, title, author,
#        when, details) where details is [[label, value], ...] already in the
#        interface language; cloud_folders() lists the synced folders.

import json
import os
import re
import string
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from xml.sax.saxutils import escape

import waPlatform as platform

FORMATS = {"docx": "Word document", "pdf": "PDF", "txt": "Text", "md": "Markdown"}


def suggested_name(text, fmt, when=None):
    """A file name from the text's first words and the date, e.g.
    "Nuit-Absolue-est-le-nouveau 2026-11-25 1432.docx"."""
    words = re.findall(r"[\w'’-]+", text or "", re.UNICODE)[:5] or ["Write Assist"]
    stem = "-".join(words)[:48].strip("-") or "Write-Assist"
    stamp = (when or datetime.now()).strftime("%Y-%m-%d %H%M")
    return f"{stem} {stamp}.{fmt}"


def title_of(text):
    first = next((line.strip() for line in (text or "").splitlines() if line.strip()), "Write Assist")
    return first if len(first) <= 80 else first[:77].rstrip() + "..."


def write(path, fmt, text, title, author, when, details):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if fmt == "docx":
        _write_docx(path, text, title, author, when, details)
    elif fmt == "md":
        footer = "\n".join(f"- **{escape_md(label)}:** {escape_md(value)}" for label, value in details)
        path.write_text(f"{text.rstrip()}\n\n---\n\n{footer}\n", encoding="utf-8")
    else:
        footer = "\n".join(f"{label}: {value}" for label, value in details)
        path.write_text(f"{text.rstrip()}\n\n――――――――――\n{footer}\n", encoding="utf-8-sig")   # BOM: Notepad-safe
    return path


def escape_md(value):
    return re.sub(r"([*_`\\[\]])", r"\\\1", str(value)).replace("\n", " ")


# ---------------------------------------------------------------------------
# Word (.docx): a .docx is a zip of a few XML files; no library needed.
# ---------------------------------------------------------------------------
def _run(text, gray=False, size=None, bold=False):
    props = ""
    if bold:
        props += "<w:b/>"
    if gray:
        props += '<w:color w:val="767676"/>'
    if size:
        props += f'<w:sz w:val="{size}"/><w:szCs w:val="{size}"/>'
    props = f"<w:rPr>{props}</w:rPr>" if props else ""
    parts = str(text).split("\t")
    body = '<w:tab/>'.join(f'<w:t xml:space="preserve">{escape(part)}</w:t>' for part in parts)
    return f"<w:r>{props}{body}</w:r>"


def _paragraph(runs="", spacing_after=None, border_top=False):
    props = ""
    if border_top:
        props += '<w:pBdr><w:top w:val="single" w:sz="4" w:space="6" w:color="BFBFBF"/></w:pBdr>'
    if spacing_after is not None:
        props += f'<w:spacing w:after="{spacing_after}"/>'
    props = f"<w:pPr>{props}</w:pPr>" if props else ""
    return f"<w:p>{props}{runs}</w:p>"


def _write_docx(path, text, title, author, when, details):
    body = [_paragraph(_run(line) if line else "") for line in text.rstrip().split("\n")]
    body.append(_paragraph(spacing_after=0))
    for index, (label, value) in enumerate(details):
        runs = _run(f"{label}: ", gray=True, size=17, bold=True) + _run(value, gray=True, size=17)
        body.append(_paragraph(runs, spacing_after=40, border_top=index == 0))
    document = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                f'<w:body>{"".join(body)}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>'
                '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>'
                '</w:sectPr></w:body></w:document>')
    # Document properties store UTC ("Z"); Word shows them in local time.
    stamp = (when if when.tzinfo else when.astimezone()).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    core = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
            'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" '
            'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
            f"<dc:title>{escape(title)}</dc:title><dc:creator>{escape(author)}</dc:creator>"
            f"<cp:lastModifiedBy>{escape(author)}</cp:lastModifiedBy>"
            f'<dcterms:created xsi:type="dcterms:W3CDTF">{stamp}</dcterms:created>'
            f'<dcterms:modified xsi:type="dcterms:W3CDTF">{stamp}</dcterms:modified>'
            f"<dc:description>{escape('; '.join(f'{label}: {value}' for label, value in details))}</dc:description>"
            "</cp:coreProperties>")
    app = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
           '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">'
           "<Application>Write Assist</Application></Properties>")
    content_types = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                     '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                     '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                     '<Default Extension="xml" ContentType="application/xml"/>'
                     '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
                     '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
                     '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
                     "</Types>")
    rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
            '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>'
            "</Relationships>")
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as package:
        package.writestr("[Content_Types].xml", content_types)
        package.writestr("_rels/.rels", rels)
        package.writestr("docProps/core.xml", core)
        package.writestr("docProps/app.xml", app)
        package.writestr("word/document.xml", document)


# ---------------------------------------------------------------------------
# Synced cloud folders: saving there puts the file in the cloud through the
# sync app the person already uses (no sign-in in Write Assist).
# ---------------------------------------------------------------------------
def cloud_folders():
    """[{"key", "name", "path"}] for OneDrive, Google Drive and Dropbox folders on this computer."""
    found = []

    def add(key, name, folder):
        folder = Path(folder)
        if folder.is_dir() and all(str(folder) != f["path"] for f in found):
            found.append({"key": key, "name": name, "path": str(folder)})

    home = Path.home()
    if platform.IS_WINDOWS:
        for variable, name in (("OneDriveCommercial", "OneDrive (work)"), ("OneDriveConsumer", "OneDrive"),
                               ("OneDrive", "OneDrive")):
            if os.environ.get(variable):
                add(variable.lower(), name, os.environ[variable])
        for letter in string.ascii_uppercase:   # Google Drive for desktop mounts a drive
            add(f"gdrive-{letter}", f"Google Drive ({letter}:)", f"{letter}:\\My Drive")
        add("gdrive-home", "Google Drive", home / "Google Drive" / "My Drive")
        add("gdrive-home2", "Google Drive", home / "My Drive")
        info_files = [Path(os.environ.get("APPDATA", "")) / "Dropbox" / "info.json",
                      Path(os.environ.get("LOCALAPPDATA", "")) / "Dropbox" / "info.json"]
    else:
        cloud = home / "Library" / "CloudStorage"
        for folder in sorted(cloud.glob("OneDrive*")) if cloud.is_dir() else []:
            add(folder.name.lower(), "OneDrive" + (" (work)" if "-" in folder.name.replace("OneDrive-Personal", "") else ""), folder)
        for folder in sorted(cloud.glob("GoogleDrive*")) if cloud.is_dir() else []:
            add(folder.name.lower(), "Google Drive", folder / "My Drive")
        info_files = [home / ".dropbox" / "info.json"]
    for info in info_files:
        try:
            data = json.loads(info.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        for kind, name in (("personal", "Dropbox"), ("business", "Dropbox (work)")):
            if data.get(kind, {}).get("path"):
                add(f"dropbox-{kind}", name, data[kind]["path"])
    return found


def account_name():
    """The person's name on this computer, for the Author field when Settings has none."""
    if platform.IS_WINDOWS:
        try:
            import ctypes
            size = ctypes.c_ulong(256)
            buffer = ctypes.create_unicode_buffer(256)
            if ctypes.windll.secur32.GetUserNameExW(3, buffer, ctypes.byref(size)) and buffer.value:   # NameDisplay
                return buffer.value
        except Exception:
            pass
    elif platform.IS_MAC:
        try:
            import subprocess
            name = subprocess.run(["id", "-F"], capture_output=True, text=True, timeout=5).stdout.strip()
            if name:
                return name
        except Exception:
            pass
    return os.environ.get("USERNAME") or os.environ.get("USER") or ""
