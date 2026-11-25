# install.ps1
# Installs or updates Write Assist for the current Windows user, with nothing
# to configure: makes sure Python (plus the pywebview package), the WebView2
# runtime and Claude Code are installed, downloads the latest GitHub release,
# creates the Start Menu shortcut and the global-hotkey listener, registers it
# in Settings > Apps, and helps sign in to Claude. The optional speech engine
# is installed later by the app, the first time the microphone is used.
# Run from a clone of the repo (has .git), it sets up that folder in place
# instead of downloading (development copy).
#
# Author:  Luis Martinez
# Email:   16788942+luigihmtz@users.noreply.github.com
# Version: v01.01.02
# Date:    2026-11-24
#
# Usage:   Install or update (PowerShell):
#            irm https://raw.githubusercontent.com/luigihmtz/write-assist/main/install.ps1 | iex
#          Development copy: run .\install.ps1 from the repo folder.
#          No admin rights needed. Windows 10 1809+ or Windows 11.

function Install-WriteAssist {
    $ErrorActionPreference = "Stop"
    $ProgressPreference = "SilentlyContinue"   # PowerShell 5.1 downloads crawl with the progress bar
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

    $repo        = "luigihmtz/write-assist"
    $installDir  = Join-Path $env:LOCALAPPDATA "WriteAssist"
    $appId       = "LuisMartinez.WriteAssist"   # must match APP_ID in writeAssist.pyw
    $appLink     = Join-Path ([Environment]::GetFolderPath("Programs")) "Write Assist.lnk"
    $hotkeyLink  = Join-Path ([Environment]::GetFolderPath("Startup")) "Write Assist Hotkey.lnk"
    $uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\WriteAssist"

    function Write-Step($text) { Write-Host ""; Write-Host "==> $text" -ForegroundColor Cyan }
    function Write-Ok($text)   { Write-Host "    $text" -ForegroundColor Green }
    function Write-Note($text) { Write-Host "    $text" -ForegroundColor Yellow }

    function Update-SessionPath {
        $env:Path = [Environment]::GetEnvironmentVariable("Path", "User") + ";" +
                    [Environment]::GetEnvironmentVariable("Path", "Machine")
    }

    # pythonw.exe of a Python 3.10+, or $null.
    function Find-Pythonw {
        $candidates = @()
        $py = Get-Command py.exe -ErrorAction SilentlyContinue
        if ($py) {
            try { $candidates += (& $py.Source -3 -c "import sys; print(sys.executable)" 2>$null) } catch {}
        }
        foreach ($name in "python.exe", "pythonw.exe") {
            # Skip the Microsoft Store placeholders in WindowsApps.
            Get-Command $name -All -ErrorAction SilentlyContinue |
                Where-Object { $_.Source -notlike "*WindowsApps*" } |
                ForEach-Object { $candidates += $_.Source }
        }
        $candidates += Get-ChildItem "$env:LOCALAPPDATA\Programs\Python\Python3*\python.exe",
                                     "$env:ProgramFiles\Python3*\python.exe", "C:\Python3*\python.exe" `
                                     -ErrorAction SilentlyContinue |
                       Sort-Object FullName -Descending | ForEach-Object { $_.FullName }
        foreach ($candidate in ($candidates | Where-Object { $_ } | Select-Object -Unique)) {
            $python = ($candidate -replace "pythonw\.exe$", "python.exe").Trim()
            if (-not (Test-Path $python)) { continue }
            & $python -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" 2>$null
            if ($LASTEXITCODE -eq 0) {
                $pythonw = Join-Path (Split-Path $python) "pythonw.exe"
                if (Test-Path $pythonw) { return $pythonw }
            }
        }
        return $null
    }

    function Test-WebView2 {
        $client = "Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
        foreach ($root in "HKLM:\SOFTWARE\WOW6432Node", "HKLM:\SOFTWARE", "HKCU:\SOFTWARE") {
            $version = (Get-ItemProperty "$root\$client" -ErrorAction SilentlyContinue).pv
            if ($version -and $version -ne "0.0.0.0") { return $true }
        }
        return $false
    }

    function Find-Claude {
        $cmd = Get-Command claude.exe -ErrorAction SilentlyContinue
        if ($cmd) { return $cmd.Source }
        $local = Join-Path $env:USERPROFILE ".local\bin\claude.exe"
        if (Test-Path $local) { return $local }
        return $null
    }

    function Stop-WriteAssist {
        Get-CimInstance Win32_Process -Filter "Name like 'python%'" |
            Where-Object { $_.CommandLine -match "writeAssist\.pyw|hotkeyListener\.pyw" } |
            ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    }

    # Deletes the installed copy, retrying while closing programs release it.
    function Remove-InstallDir {
        for ($try = 1; $try -le 10; $try++) {
            if (-not (Test-Path $installDir)) { return }
            try {
                Remove-Item $installDir -Recurse -Force -ErrorAction Stop
                return
            } catch {
                if ($try -eq 10) {
                    throw "Close Write Assist and any window open in $installDir, then run the installer again. ($($_.Exception.Message))"
                }
                Start-Sleep -Seconds 1
            }
        }
    }

    function New-Shortcut($path, $target, $arguments, $workDir, $icon, $description) {
        $shell = New-Object -ComObject WScript.Shell
        $link = $shell.CreateShortcut($path)
        $link.TargetPath = $target
        $link.Arguments = $arguments
        $link.WorkingDirectory = $workDir
        $link.IconLocation = "$icon,0"
        $link.Description = $description
        $link.Save()
    }

    # Stamps a shortcut with an AppUserModelID, so the pinned taskbar icon and
    # the running window share one taskbar button.
    function Set-ShortcutAppId($path, $id) {
        if (-not ("WriteAssistLinkAppId" -as [type])) {
            Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class WriteAssistLinkAppId {
    [StructLayout(LayoutKind.Sequential)]
    struct PropertyKey { public Guid fmtid; public uint pid; }

    [StructLayout(LayoutKind.Sequential)]
    struct PropVariant { public ushort vt; ushort r1, r2, r3; public IntPtr p; IntPtr p2; }

    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPropertyStore {
        void GetCount(out uint count);
        void GetAt(uint index, out PropertyKey key);
        void GetValue(ref PropertyKey key, out PropVariant value);
        void SetValue(ref PropertyKey key, ref PropVariant value);
        void Commit();
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    static extern void SHGetPropertyStoreFromParsingName(string path, IntPtr bindCtx,
        int flags, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore store);

    public static void Set(string linkPath, string appId) {
        Guid iid = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");
        IPropertyStore store;
        SHGetPropertyStoreFromParsingName(linkPath, IntPtr.Zero, 2 /* GPS_READWRITE */, ref iid, out store);
        PropertyKey key = new PropertyKey {
            fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = 5 };  // System.AppUserModel.ID
        PropVariant value = new PropVariant { vt = 31 /* VT_LPWSTR */, p = Marshal.StringToCoTaskMemUni(appId) };
        try {
            store.SetValue(ref key, ref value);
            store.Commit();
        } finally {
            Marshal.FreeCoTaskMem(value.p);
            Marshal.ReleaseComObject(store);
        }
    }
}
"@
        }
        [WriteAssistLinkAppId]::Set($path, $id)
    }

    Write-Host ""
    Write-Host "Write Assist installer" -ForegroundColor White

    # Development copy: this script sits in a clone of the repo.
    $devDir = $null
    if ($PSScriptRoot -and (Test-Path (Join-Path $PSScriptRoot ".git")) -and
        (Test-Path (Join-Path $PSScriptRoot "writeAssist.pyw"))) {
        $devDir = $PSScriptRoot
    }

    # 1. Python ---------------------------------------------------------------
    Write-Step "Checking Python"
    $pythonw = Find-Pythonw
    if (-not $pythonw) {
        if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
            throw "Python isn't installed and winget isn't available. Install Python 3 from https://www.python.org/downloads/ and run this installer again."
        }
        Write-Note "Installing Python (a few minutes)..."
        winget install --exact --id Python.Python.3.13 --scope user --silent `
            --accept-package-agreements --accept-source-agreements --disable-interactivity | Out-Host
        Update-SessionPath
        $pythonw = Find-Pythonw
        if (-not $pythonw) { throw "Python was installed but couldn't be found. Restart the computer and run this installer again." }
    }
    Write-Ok "Python: $pythonw"

    Write-Step "Checking the window components"
    $python = Join-Path (Split-Path $pythonw) "python.exe"
    # Windows PowerShell turns any stderr line (pip warnings) into an error under "Stop".
    $ErrorActionPreference = "Continue"
    & $python -m pip install --user --upgrade --quiet --disable-pip-version-check --no-warn-script-location pywebview 2>&1 |
        ForEach-Object { "    $_" } | Out-Host
    & $python -c "import webview" 2>$null
    $ErrorActionPreference = "Stop"
    if ($LASTEXITCODE -ne 0) { throw "The pywebview package couldn't be installed. Check your internet connection and run this installer again." }
    Write-Ok "pywebview installed"
    if (-not (Test-WebView2)) {
        Write-Note "Installing Microsoft Edge WebView2 Runtime..."
        winget install --exact --id Microsoft.EdgeWebView2Runtime --silent `
            --accept-package-agreements --accept-source-agreements --disable-interactivity | Out-Host
        if (-not (Test-WebView2)) { throw "WebView2 couldn't be installed. Get it from https://developer.microsoft.com/microsoft-edge/webview2/ and run this installer again." }
    }
    Write-Ok "WebView2 runtime present"

    # 2. Claude Code -----------------------------------------------------------
    Write-Step "Checking Claude Code"
    $claude = Find-Claude
    if (-not $claude) {
        Write-Note "Installing Claude Code..."
        # Anthropic's official installer, in its own process so it can't end this one.
        powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://claude.ai/install.ps1 | iex" | Out-Host
        Update-SessionPath
        $claude = Find-Claude
        if (-not $claude) { throw "Claude Code couldn't be installed. See https://code.claude.com/docs/en/setup and run this installer again." }
    }
    Write-Ok "Claude Code: $claude"

    # 3. App files -----------------------------------------------------------
    Stop-WriteAssist
    if ($devDir) {
        Write-Step "Using the development copy in $devDir"
        $appDir = $devDir
    } else {
        Write-Step "Downloading the latest Write Assist"
        $release = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest"
        $tag = $release.tag_name
        $temp = Join-Path $env:TEMP "WriteAssist-$tag-$(Get-Random)"
        New-Item -ItemType Directory -Path $temp | Out-Null
        try {
            $zip = Join-Path $temp "release.zip"
            Invoke-WebRequest "https://github.com/$repo/archive/refs/tags/$tag.zip" -OutFile $zip -UseBasicParsing
            Expand-Archive $zip -DestinationPath $temp
            $source = Get-ChildItem $temp -Directory | Select-Object -First 1
            Remove-InstallDir
            Copy-Item $source.FullName $installDir -Recurse
        } finally {
            Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
        }
        $appDir = $installDir
        Write-Ok "Version $tag installed in $appDir"
    }
    $appScript = Join-Path $appDir "writeAssist.pyw"
    $listener  = Join-Path $appDir "hotkeyListener.pyw"
    $icon      = Join-Path $appDir "assets\writeAssist.ico"

    # 4. Shortcuts, hotkey, Settings > Apps -----------------------------------
    Write-Step "Adding Write Assist to Windows"
    New-Shortcut $appLink $pythonw "`"$appScript`"" $appDir $icon "Review or write text with AI"
    Set-ShortcutAppId $appLink $appId
    New-Shortcut $hotkeyLink $pythonw "`"$listener`"" $appDir $icon "Global hotkey for Write Assist"
    Write-Ok "Start Menu shortcut: Write Assist"

    if (-not $devDir) {
        $version = (Get-Content (Join-Path $appDir "release.json") -Raw | ConvertFrom-Json).version
        New-Item -Path $uninstallKey -Force | Out-Null
        $uninstall = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$appDir\uninstall.ps1`""
        $values = @{
            DisplayName = "Write Assist"; DisplayVersion = $version; Publisher = "Luis Martinez"
            DisplayIcon = $icon; InstallLocation = $appDir; UninstallString = $uninstall
        }
        foreach ($name in $values.Keys) { Set-ItemProperty -Path $uninstallKey -Name $name -Value $values[$name] }
        Set-ItemProperty -Path $uninstallKey -Name NoModify -Value 1 -Type DWord
        Set-ItemProperty -Path $uninstallKey -Name NoRepair -Value 1 -Type DWord
        Write-Ok "Listed in Settings > Apps (uninstall from there)"
    }

    Start-Process -FilePath $pythonw -ArgumentList "`"$listener`"" -WorkingDirectory $appDir
    Write-Ok "Global hotkey running (default Win+Ctrl+W, change it in Write Assist > Settings)"

    # 5. Claude sign-in --------------------------------------------------------
    Write-Step "Checking your Claude sign-in"
    $status = $null
    try { $status = (& $claude auth status 2>$null | Out-String) | ConvertFrom-Json } catch {}
    if (-not ($status -and $status.loggedIn)) {
        Write-Note "Your browser will open to sign in to Claude. Use the account with your Claude subscription."
        & $claude auth login
        try { $status = (& $claude auth status 2>$null | Out-String) | ConvertFrom-Json } catch {}
    }
    if ($status -and $status.loggedIn) {
        Write-Ok "Signed in to Claude"
        if ($status.subscriptionType -eq "free") {
            Write-Note "This Claude account is on the free plan, which doesn't include Claude Code."
            Write-Note "Write Assist needs a Pro or Max plan (or a Team/Enterprise seat)."
        }
    } else {
        Write-Note "Not signed in yet. Open a terminal, run: claude auth login"
    }

    # 6. Done -----------------------------------------------------------------
    Write-Step "Done"
    Write-Host "    Open Write Assist from the Start Menu or with Win+Ctrl+W."
    Write-Host "    To pin it: Start > right-click Write Assist > Pin to taskbar."
    Start-Process -FilePath $pythonw -ArgumentList "`"$appScript`"" -WorkingDirectory $appDir
}

# Never stand in the folder being replaced: Windows won't delete a folder that
# is a process's working folder (the Update button used to start us there).
# Set-Location only moves PowerShell's own location, so the process's working
# folder is moved too; both are restored at the end.
$previousCwd = [Environment]::CurrentDirectory
Push-Location $env:TEMP
[Environment]::CurrentDirectory = $env:TEMP
try {
    Install-WriteAssist
} catch {
    Write-Host ""
    Write-Host "Write Assist couldn't be installed: $($_.Exception.Message)" -ForegroundColor Red
} finally {
    Pop-Location
    [Environment]::CurrentDirectory = $previousCwd
}
Write-Host ""
Read-Host "Press Enter to close" | Out-Null
