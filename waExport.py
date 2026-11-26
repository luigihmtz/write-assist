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
# Version: v01.02.00
# Date:    2026-11-26
#
# Usage: imported by writeAssist.pyw. write(path, fmt, text, title, author,
#        when, details, rich) where details is [[label, value], ...] already in
#        the interface language, and rich (optional) is the formatted text as
#        lines: [{"kind": "p"|"ul"|"ol"|"h1"|"h2"|"h3"|"quote"|"code"|"hr",
#        "n", "depth" (list nesting), "runs": [{"text", "b", "i", "u", "s",
#        "hl", "code", "href"}]}]; cloud_folders() lists the synced folders.

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


def plain_lines(text):
    """Unformatted text as the same line model the formatted text uses."""
    return [{"kind": "p", "n": 0, "runs": [{"text": line}] if line else []} for line in (text or "").rstrip().split("\n")]


def safe_href(href):
    return href if re.match(r"(?i)^(https?:|mailto:|tel:)", href or "") else ""


def write(path, fmt, text, title, author, when, details, rich=None):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = rich or plain_lines(text)
    if fmt == "docx":
        _write_docx(path, lines, title, author, when, details)
    elif fmt == "md":
        footer = "\n".join(f"- **{escape_md(label)}:** {escape_md(value)}" for label, value in details)
        path.write_text(f"{_markdown(lines).rstrip()}\n\n---\n\n{footer}\n", encoding="utf-8")
    else:
        footer = "\n".join(f"{label}: {value}" for label, value in details)
        path.write_text(f"{_plain(lines).rstrip()}\n\n――――――――――\n{footer}\n", encoding="utf-8-sig")   # BOM: Notepad-safe
    return path


BULLETS = "•◦▪"
HEADING_SIZES = {"h1": 32, "h2": 28, "h3": 24}   # half-points


def _text(line):
    return "".join(run.get("text", "") for run in line.get("runs", []))


def _plain(lines):
    out = []
    for line in lines:
        kind, depth = line.get("kind", "p"), line.get("depth", 0)
        if kind == "hr":
            out.append("──────────")
        elif kind in ("ul", "ol"):
            marker = f"{BULLETS[depth % 3]} " if kind == "ul" else f"{line.get('n', 1)}. "
            out.append("    " * depth + marker + _text(line))
        else:
            out.append(_text(line))
    return "\n".join(out)


def _code_span(text):
    longest = max([len(m) for m in re.findall(r"`+", text)] or [0])
    fence = "`" * (longest + 1)
    pad = " " if text.startswith("`") or text.endswith("`") else ""
    return f"{fence}{pad}{text}{pad}{fence}"


def _markdown(lines):
    out = []
    cols = []    # the indent of each list level
    fence = ""   # the open code fence
    for index, line in enumerate(lines):
        kind = line.get("kind", "p")
        following = lines[index + 1] if index + 1 < len(lines) else None
        if kind not in ("ul", "ol"):
            cols = []
        if kind == "code":
            if not fence:
                block = []
                for other in lines[index:]:
                    if other.get("kind") != "code":
                        break
                    block.append(_text(other))
                fence = "````" if any(re.match(r"\s*```", text) for text in block) else "```"
                out.append(fence)
            out.append(_text(line))
            if not following or following.get("kind") != "code":
                out.append(fence)
                fence = ""
            continue
        if kind == "hr":
            out.append("---")
            continue
        parts = []
        for run in line.get("runs", []):
            text = run.get("text", "")
            if not text.strip():
                parts.append(text)
                continue
            lead, core, trail = re.match(r"^(\s*)(.*?)(\s*)$", text, re.S).groups()   # markers hug the words
            core = _code_span(core) if run.get("code") else escape_md(core)
            if run.get("b"):
                core = f"**{core}**"
            if run.get("i"):
                core = f"*{core}*"
            if run.get("s"):
                core = f"~~{core}~~"
            if run.get("hl"):
                core = f"=={core}=="   # highlight: shown by many viewers (Obsidian, Typora...)
            if run.get("u"):
                core = f"<u>{core}</u>"   # Markdown has no underline; most viewers show this
            if safe_href(run.get("href")):
                core = f"[{core}]({run['href']})"
            parts.append(lead + core + trail)
        content = "".join(parts)
        if kind in ("ul", "ol"):
            cols = cols or [0]
            depth = min(line.get("depth", 0), len(cols) - 1)
            marker = "- " if kind == "ul" else f"{line.get('n', 1)}. "
            out.append(" " * cols[depth] + marker + content)
            cols = cols[:depth + 1] + [cols[depth] + len(marker)]
        elif kind in HEADING_SIZES:
            out.append("#" * int(kind[1]) + " " + content)
        elif kind == "quote":
            # Quote lines in a row: one quote, each line its own (a hard break).
            more = following and following.get("kind") == "quote"
            out.append(("> " + content if content else ">") + ("  " if more and content else ""))
        else:
            # A plain line followed by another plain line: a hard line break ("  ").
            hard_break = content and following and following.get("kind", "p") == "p" and following.get("runs")
            out.append(content + ("  " if hard_break else ""))
    return "\n".join(out)


def escape_md(value):
    return re.sub(r"([*_`~=\\[\]])", r"\\\1", str(value)).replace("\n", " ")


# ---------------------------------------------------------------------------
# Word (.docx): a .docx is a zip of a few XML files; no library needed.
# ---------------------------------------------------------------------------
def _run(text, gray=False, size=None, bold=False, italic=False, underline=False, strike=False, link=False,
         mono=False, highlight=False, shade=False, color=None):
    # Word wants run properties in schema order: rFonts, b, i, strike, color, sz, highlight, u, shd.
    props = ""
    if mono:
        props += '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>'
    if bold:
        props += "<w:b/>"
    if italic:
        props += "<w:i/>"
    if strike:
        props += "<w:strike/>"
    if link or gray or color:
        props += f'<w:color w:val="{"0563C1" if link else color or "767676"}"/>'
    if size:
        props += f'<w:sz w:val="{size}"/><w:szCs w:val="{size}"/>'
    if highlight:
        props += '<w:highlight w:val="yellow"/>'
    if underline or link:
        props += '<w:u w:val="single"/>'
    if shade:
        props += '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>'
    props = f"<w:rPr>{props}</w:rPr>" if props else ""
    parts = str(text).split("	")
    body = '<w:tab/>'.join(f'<w:t xml:space="preserve">{escape(part)}</w:t>' for part in parts)
    return f"<w:r>{props}{body}</w:r>"


def _paragraph(runs="", spacing_after=None, border_top=False, indent=0, border_left=False, border_bottom=False,
               shade=False, spacing_before=None, heading=None, keep_next=False):
    # Paragraph properties in schema order: keepNext, pBdr, shd, tabs, spacing, ind, outlineLvl.
    # indent: list level + 1 (0: not a list item); the bullet or number hangs in the margin.
    props = '<w:keepNext/>' if keep_next else ""
    borders = ""
    if border_top:
        borders += '<w:top w:val="single" w:sz="4" w:space="6" w:color="BFBFBF"/>'
    if border_left:
        borders += '<w:left w:val="single" w:sz="18" w:space="8" w:color="C8C8C8"/>'
    if border_bottom:
        borders += '<w:bottom w:val="single" w:sz="6" w:space="1" w:color="BFBFBF"/>'
    if borders:
        props += f"<w:pBdr>{borders}</w:pBdr>"
    if shade:
        props += '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>'
    if indent:
        props += f'<w:tabs><w:tab w:val="left" w:pos="{720 * indent}"/></w:tabs>'
    if spacing_after is not None or spacing_before is not None:
        before = f' w:before="{spacing_before}"' if spacing_before is not None else ""
        after = f' w:after="{spacing_after}"' if spacing_after is not None else ""
        props += f"<w:spacing{before}{after}/>"
    if indent:
        props += f'<w:ind w:left="{720 * indent}" w:hanging="360"/>'
    elif border_left:
        props += '<w:ind w:left="240"/>'
    if heading is not None:
        props += f'<w:outlineLvl w:val="{heading}"/>'   # shows in Word's navigation pane
    props = f"<w:pPr>{props}</w:pPr>" if props else ""
    return f"<w:p>{props}{runs}</w:p>"


def _write_docx(path, lines, title, author, when, details):
    links = []   # external hyperlinks, numbered as relationships rId100, rId101...
    body = []
    for index, line in enumerate(lines):
        runs = ""
        kind = line.get("kind", "p")
        depth = line.get("depth", 0)
        if kind == "hr":
            body.append(_paragraph(border_bottom=True, spacing_after=120))
            continue
        if kind in ("ul", "ol"):
            runs += _run((BULLETS[depth % 3] if kind == "ul" else f"{line.get('n', 1)}.") + "\t")
        size = HEADING_SIZES.get(kind)
        for run in line.get("runs", []):
            code_block = kind == "code"
            piece = _run(run.get("text", ""), bold=run.get("b") or bool(size), italic=run.get("i"), underline=run.get("u"),
                         strike=run.get("s"), link=bool(safe_href(run.get("href"))), size=size or (19 if code_block else None),
                         mono=run.get("code") or code_block, highlight=run.get("hl"), shade=run.get("code") and not code_block,
                         color="595959" if kind == "quote" else None)
            if safe_href(run.get("href")):
                links.append(run["href"])
                piece = f'<w:hyperlink r:id="rId{99 + len(links)}">{piece}</w:hyperlink>'
            runs += piece
        following = lines[index + 1] if index + 1 < len(lines) else {}
        if size:
            body.append(_paragraph(runs, spacing_before=240, spacing_after=80, heading=int(kind[1]) - 1, keep_next=True))
        elif kind == "code":   # code lines in a row: one shaded block
            body.append(_paragraph(runs, shade=True, spacing_after=0 if following.get("kind") == "code" else None))
        elif kind == "quote":
            body.append(_paragraph(runs, border_left=True, spacing_after=0 if following.get("kind") == "quote" else None))
        else:
            body.append(_paragraph(runs, indent=depth + 1 if kind in ("ul", "ol") else 0))
    body.append(_paragraph(spacing_after=0))
    for index, (label, value) in enumerate(details):
        runs = _run(f"{label}: ", gray=True, size=17, bold=True) + _run(value, gray=True, size=17)
        body.append(_paragraph(runs, spacing_after=40, border_top=index == 0))
    document = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
                'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
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
    document_rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                     '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                     + "".join(f'<Relationship Id="rId{100 + index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" '
                               f'Target="{escape(href, {chr(34): "&quot;"})}" TargetMode="External"/>' for index, href in enumerate(links))
                     + "</Relationships>")
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as package:
        package.writestr("word/_rels/document.xml.rels", document_rels)
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
