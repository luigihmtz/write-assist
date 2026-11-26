#!/bin/bash
# uninstall.sh
# Removes Write Assist from macOS for the current user: stops the app and its
# grammar checker, and deletes Write Assist.app, the app's files and Python
# environment, the grammar checker, and the user's settings. Claude Code,
# Ollama (and its models) and uv are left installed for other uses.
#
# Author:  Luis Martinez
# Email:   16788942+luigihmtz@users.noreply.github.com
# Version: v01.00.00
# Date:    2026-11-25
#
# Usage:   bash "$HOME/Library/Application Support/WriteAssist-App/app/uninstall.sh"

SUPPORT="$HOME/Library/Application Support"
pkill -f "writeAssist.pyw" 2>/dev/null
pkill -f "WriteAssist-LanguageTool" 2>/dev/null
sleep 1
rm -rf "$HOME/Applications/Write Assist.app" \
       "$SUPPORT/WriteAssist-App" \
       "$SUPPORT/WriteAssist-LanguageTool" \
       "$SUPPORT/WriteAssist-WebView" \
       "$SUPPORT/WriteAssist"
echo "Write Assist was removed. If you kept it in the Dock, remove the leftover icon."
echo "Claude Code and Ollama are still installed; remove Ollama from ~/Applications if you don't need it."
