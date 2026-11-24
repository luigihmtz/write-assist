# Changelog

## v01.05.01 - 2026-11-24

- The *Update* button now downloads the installer and runs it as a file,
  which is more reliable than piping it into PowerShell.

## v01.05.00 - 2026-11-24

First shared release.

- One-line installer (`install.ps1`): installs Python and Claude Code if
  needed, sets up the Start Menu shortcut and global hotkey, lists the app in
  Settings > Apps, and helps sign in to Claude.
- Automatic update check: an *Update* button appears when a new release is out.
- Settings window: *About you* (asked on first launch) and the global hotkey.
  Per-user settings live in `%APPDATA%\WriteAssist` and survive updates.
- Default hotkey is now Win+Ctrl+W.
- Only installed AIs appear in the AI dropdown.
- Renamed from Grammar Check to Write Assist.

## v01.04.00 and earlier

Personal versions before sharing: Review and Create tasks, Claude and GitHub
Copilot support, highlighted edits, single window, Win-key hotkey.
