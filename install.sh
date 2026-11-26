#!/bin/bash
# install.sh
# Installs or updates Write Assist on macOS for the current user, with nothing
# to configure: sets up Python in Write Assist's own environment (with uv, no
# admin password), sets up an AI (Claude Code, or a free AI that runs on this
# Mac through Ollama, the user's choice), downloads the latest release, creates
# "Write Assist.app" in ~/Applications and helps sign in to Claude.
# Run from a clone of the repo (has .git), it uses that folder in place.
# First pass: not yet tested on a Mac.
#
# Author:  Luis Martinez
# Email:   16788942+luigihmtz@users.noreply.github.com
# Version: v01.01.00
# Date:    2026-11-25
#
# Usage:   Install or update (Terminal):
#            curl -fsSL https://raw.githubusercontent.com/luigihmtz/write-assist/main/install.sh | bash
#          A specific (e.g. pre-release) version:
#            curl -fsSL .../install.sh | WA_VERSION=v02.09.00 bash
#          Development copy: bash install.sh from the repo folder.
#          macOS 12 or later, Apple silicon or Intel.

main() {
    set -u
    local REPO="luigihmtz/write-assist"
    local SUPPORT="$HOME/Library/Application Support"
    local APP_HOME="$SUPPORT/WriteAssist-App"        # the app's files and its Python environment
    local APP_DIR="$APP_HOME/app"
    local VENV="$APP_HOME/venv"
    local BUNDLE="$HOME/Applications/Write Assist.app"
    local LOCAL_MODEL="gemma3:4b"
    local OLLAMA_APP="$HOME/Applications/Ollama.app"

    step() { printf '\n\033[36m==> %s\033[0m\n' "$1"; }
    ok()   { printf '    \033[32m%s\033[0m\n' "$1"; }
    note() { printf '    \033[33m%s\033[0m\n' "$1"; }
    fail() { printf '\n\033[31mWrite Assist could not be installed: %s\033[0m\n' "$1"; }

    printf '\nWrite Assist installer\n'
    if [ "$(uname)" != "Darwin" ]; then
        fail "this installer is for macOS. On Windows, use install.ps1."
        return 1
    fi
    export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

    # Development copy: this script sits in a clone of the repo.
    local DEV_DIR=""
    if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
        local here
        here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
        if [ -d "$here/.git" ] && [ -f "$here/writeAssist.pyw" ]; then DEV_DIR="$here"; fi
    fi

    # 1. Python, in Write Assist's own environment -----------------------------
    step "Checking Python"
    if ! command -v uv >/dev/null 2>&1; then
        note "Installing uv, which sets up Python for this user (no admin password)..."
        curl -LsSf https://astral.sh/uv/install.sh | sh >/dev/null || { fail "uv could not be installed. Check your internet connection."; return 1; }
        export PATH="$HOME/.local/bin:$PATH"
    fi
    if [ ! -x "$VENV/bin/python" ]; then
        mkdir -p "$APP_HOME"
        uv venv --seed --python 3.12 "$VENV" >/dev/null || { fail "Python could not be set up."; return 1; }
    fi
    "$VENV/bin/python" -m pip install --upgrade --quiet --disable-pip-version-check pywebview \
        || { fail "the pywebview package could not be installed. Check your internet connection."; return 1; }
    "$VENV/bin/python" -c "import webview" 2>/dev/null || { fail "pywebview is installed but can't be loaded."; return 1; }
    ok "Python: $("$VENV/bin/python" --version 2>&1), with pywebview"

    # 2. The AI (asked only on a first install) ---------------------------------
    local claude="" ollama="" has_local="" choice=""
    claude="$(command -v claude 2>/dev/null || true)"
    ollama="$OLLAMA_APP/Contents/Resources/ollama"
    [ -x "$ollama" ] || ollama="$(command -v ollama 2>/dev/null || true)"
    if [ -n "$ollama" ] && [ -f "$HOME/.ollama/models/manifests/registry.ollama.ai/library/${LOCAL_MODEL%%:*}/${LOCAL_MODEL##*:}" ]; then
        has_local=1
    fi
    if [ -n "$claude" ]; then choice=1
    elif [ -n "$has_local" ]; then choice=2
    else
        step "Choosing the AI"
        echo "    Write Assist needs an AI to work with. Choose one:"
        echo ""
        echo "      1  Claude: the best results. Needs a paid Claude plan (Pro or Max)."
        echo "      2  A free AI that runs on this Mac: no account or subscription, works"
        echo "         offline, and your text never leaves your computer. Good for"
        echo "         everyday fixes; Claude is better with subtle wording."
        echo "         One-time download of about 3.5 GB (the free Ollama app and the"
        echo "         Gemma model), using about 4 GB of disk space."
        echo ""
        while [ "$choice" != "1" ] && [ "$choice" != "2" ]; do
            printf '    Type 1 or 2 and press Enter: '
            read -r choice < /dev/tty || { fail "no answer"; return 1; }
            choice="$(echo "$choice" | tr -d '[:space:]')"
        done
    fi

    if [ "$choice" = "1" ]; then
        step "Checking Claude Code"
        if [ -z "$claude" ]; then
            note "Installing Claude Code..."
            curl -fsSL https://claude.ai/install.sh | bash || { fail "Claude Code could not be installed. See https://code.claude.com/docs/en/setup"; return 1; }
            claude="$(command -v claude 2>/dev/null || echo "$HOME/.local/bin/claude")"
            [ -x "$claude" ] || { fail "Claude Code was installed but can't be found. Open a new Terminal and run this again."; return 1; }
        fi
        ok "Claude Code: $claude"
    else
        step "Setting up the free local AI"
        if [ -z "$ollama" ] || [ ! -x "$ollama" ]; then
            note "Downloading Ollama, the free local AI app (about 230 MB)..."
            local tmp_zip
            tmp_zip="$(mktemp -d)/Ollama-darwin.zip"
            curl -fL --progress-bar -o "$tmp_zip" https://ollama.com/download/Ollama-darwin.zip || { fail "Ollama could not be downloaded."; return 1; }
            mkdir -p "$HOME/Applications"
            ditto -x -k "$tmp_zip" "$HOME/Applications" || { fail "Ollama could not be unpacked."; return 1; }
            rm -f "$tmp_zip"
            ollama="$OLLAMA_APP/Contents/Resources/ollama"
        fi
        ok "Ollama: $ollama"
        # Only Ollama's engine runs (no menu-bar app, no login item).
        if ! curl -s --max-time 2 http://127.0.0.1:11434/api/version >/dev/null; then
            nohup "$ollama" serve >/dev/null 2>&1 &
            for _ in $(seq 1 40); do curl -s --max-time 1 http://127.0.0.1:11434/api/version >/dev/null && break; sleep 0.5; done
        fi
        if [ -z "$has_local" ]; then
            note "Downloading the $LOCAL_MODEL model (about 3.3 GB)..."
            "$ollama" pull "$LOCAL_MODEL" || { fail "the $LOCAL_MODEL model could not be downloaded."; return 1; }
        fi
        ok "Free local AI ready ($LOCAL_MODEL)"
    fi

    # 3. App files ----------------------------------------------------------
    pkill -f "writeAssist.pyw" 2>/dev/null || true
    local app="$APP_DIR"
    if [ -n "$DEV_DIR" ]; then
        step "Using the development copy in $DEV_DIR"
        app="$DEV_DIR"
    else
        # WA_VERSION picks a specific release, e.g. a pre-release being tested;
        # otherwise the latest regular release.
        local tag="${WA_VERSION:-}" work
        if [ -n "$tag" ]; then
            step "Downloading Write Assist $tag"
        else
            step "Downloading the latest Write Assist"
            tag="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | "$VENV/bin/python" -c 'import json,sys; print(json.load(sys.stdin)["tag_name"])')" \
                || { fail "the latest release could not be found."; return 1; }
        fi
        work="$(mktemp -d)"
        curl -fsSL -o "$work/release.tar.gz" "https://github.com/$REPO/archive/refs/tags/$tag.tar.gz" || { fail "the release could not be downloaded."; return 1; }
        tar -xzf "$work/release.tar.gz" -C "$work" || { fail "the release could not be unpacked."; return 1; }
        rm -rf "$APP_DIR"
        mv "$work"/write-assist-* "$APP_DIR"
        rm -rf "$work"
        ok "Version $tag installed in $APP_DIR"
    fi

    # 4. Write Assist.app ------------------------------------------------------
    # Built here rather than downloaded, so macOS has nothing to quarantine.
    step "Adding Write Assist to Applications"
    rm -rf "$BUNDLE"
    mkdir -p "$BUNDLE/Contents/MacOS" "$BUNDLE/Contents/Resources"
    cat > "$BUNDLE/Contents/MacOS/WriteAssist" <<LAUNCHER
#!/bin/bash
# Opens Write Assist with its own Python. Apps opened from the Finder get a
# minimal PATH, so the usual tool folders are added for the AI command lines.
export PATH="\$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:\$PATH"
exec "$VENV/bin/python" "$app/writeAssist.pyw"
LAUNCHER
    chmod +x "$BUNDLE/Contents/MacOS/WriteAssist"
    local version
    version="$("$VENV/bin/python" -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"].lstrip("v"))' "$app/release.json" 2>/dev/null || echo "1.0")"
    cat > "$BUNDLE/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key><string>Write Assist</string>
    <key>CFBundleDisplayName</key><string>Write Assist</string>
    <key>CFBundleIdentifier</key><string>com.luismartinez.writeassist</string>
    <key>CFBundleExecutable</key><string>WriteAssist</string>
    <key>CFBundleIconFile</key><string>WriteAssist</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>$version</string>
    <key>LSMinimumSystemVersion</key><string>12.0</string>
    <key>NSHighResolutionCapable</key><true/>
    <key>NSMicrophoneUsageDescription</key><string>Write Assist uses the microphone for dictation. Speech is transcribed on this Mac and never sent anywhere.</string>
</dict>
</plist>
PLIST
    local iconset
    iconset="$(mktemp -d)/WriteAssist.iconset"
    mkdir -p "$iconset"
    for size in 16 32 128 256 512; do
        sips -z "$size" "$size" "$app/assets/writeAssist.png" --out "$iconset/icon_${size}x${size}.png" >/dev/null 2>&1
        sips -z $((size * 2)) $((size * 2)) "$app/assets/writeAssist.png" --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null 2>&1
    done
    iconutil -c icns "$iconset" -o "$BUNDLE/Contents/Resources/WriteAssist.icns" 2>/dev/null || note "The app icon could not be made; the app works without it."
    rm -rf "$(dirname "$iconset")"
    touch "$BUNDLE"
    ok "Write Assist is in your Applications folder ($BUNDLE)"

    # 5. Claude sign-in (only when using Claude) ----------------------------------
    if [ "$choice" = "1" ]; then
        step "Checking your Claude sign-in"
        if ! "$claude" auth status 2>/dev/null | grep -q '"loggedIn": *true'; then
            note "Your browser will open to sign in to Claude. Use the account with your Claude subscription."
            "$claude" auth login < /dev/tty || true
        fi
        if "$claude" auth status 2>/dev/null | grep -q '"loggedIn": *true'; then
            ok "Signed in to Claude"
            if "$claude" auth status 2>/dev/null | grep -q '"subscriptionType": *"free"'; then
                note "This Claude account is on the free plan, which doesn't include Claude Code."
                note "Use a Pro or Max plan, or the free local AI: in Write Assist, choose AI > Local (free)."
            fi
        else
            note "Not signed in yet. Open Terminal and run: claude auth login"
        fi
    fi

    # 6. Done -------------------------------------------------------------------
    step "Done"
    echo "    Open Write Assist from Applications, Launchpad or Spotlight."
    echo "    To keep it in the Dock: right-click its Dock icon > Options > Keep in Dock."
    open "$BUNDLE"
}

main "$@"
