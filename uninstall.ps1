# uninstall.ps1
# Removes Write Assist for the current user: stops the app and the hotkey
# listener, deletes the shortcuts, the Settings > Apps entry, the installed
# files (%LOCALAPPDATA%\WriteAssist) and the user's settings
# (%APPDATA%\WriteAssist). Python and Claude Code are left installed.
#
# Author:  Luis Martinez
# Email:   16788942+luigihmtz@users.noreply.github.com
# Version: v01.00.01
# Date:    2026-11-24
#
# Usage:   Settings > Apps > Write Assist > Uninstall, or run
#          powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\WriteAssist\uninstall.ps1"

$ErrorActionPreference = "SilentlyContinue"
Set-Location $env:TEMP   # don't hold the folder that gets deleted

Get-CimInstance Win32_Process -Filter "Name like 'python%'" |
    Where-Object { $_.CommandLine -match "writeAssist\.pyw|hotkeyListener\.pyw" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Sleep -Milliseconds 500

Remove-Item (Join-Path ([Environment]::GetFolderPath("Programs")) "Write Assist.lnk")
Remove-Item (Join-Path ([Environment]::GetFolderPath("Startup")) "Write Assist Hotkey.lnk")
Remove-Item "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\WriteAssist" -Recurse
Remove-Item (Join-Path $env:LOCALAPPDATA "WriteAssist") -Recurse -Force
Remove-Item (Join-Path $env:APPDATA "WriteAssist") -Recurse -Force

Write-Host "Write Assist was removed. If you pinned it to the taskbar, unpin the leftover icon."
