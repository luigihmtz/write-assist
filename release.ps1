# release.ps1
# Publishes a new Write Assist version: checks the working tree is committed
# and pushed, tags the commit with the version in release.json, and creates
# the GitHub release that installed copies offer as an update. If the tag is
# already pushed but its release is missing (a failed run), it creates just
# the release.
#
# Author:  Luis Martinez
# Email:   16788942+luigihmtz@users.noreply.github.com
# Version: v01.01.00
# Date:    2026-11-24
#
# Usage:   1. Bump "version" (and "date") in release.json, add a CHANGELOG.md entry.
#          2. Commit and push to main.
#          3. Run .\release.ps1 from the repo folder (needs git and gh, signed in).

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

# Native commands (git, gh) don't throw on failure; check their exit code.
function Invoke-Checked([string]$what, [scriptblock]$command) {
    & $command
    if ($LASTEXITCODE -ne 0) { throw "$what failed (exit $LASTEXITCODE)." }
}

$utf8 = New-Object System.Text.UTF8Encoding $false   # PowerShell 5.1 reads files as ANSI by default
$version = ([IO.File]::ReadAllText((Join-Path $PSScriptRoot "release.json"), $utf8) | ConvertFrom-Json).version
if (-not ($version -match '^v\d{2}\.\d{2}\.\d{2}$')) { throw "release.json version '$version' isn't vXX.XX.XX" }

if (git status --porcelain) { throw "Commit your changes first (git status isn't clean)." }
Invoke-Checked "git fetch" { git fetch origin main --quiet }
if ((git rev-parse HEAD) -ne (git rev-parse origin/main)) { throw "Push main first (HEAD differs from origin/main)." }

$tagExists = [bool](git tag --list $version)
if ($tagExists) {
    # gh writes "release not found" to stderr, which PowerShell 5.1 turns into
    # an error under "Stop"; here it's the expected answer.
    $ErrorActionPreference = "Continue"
    gh release view $version *> $null
    $released = $LASTEXITCODE -eq 0
    $ErrorActionPreference = "Stop"
    if ($released) { throw "$version is already released. Bump the version in release.json." }
    Write-Host "Tag $version exists without a release; creating the release from that tag."
}

# Notes: this version's section of CHANGELOG.md, if there is one. Passed to gh
# through a file: PowerShell 5.1 mangles quotes in arguments to programs.
$notes = ""
$changelogPath = Join-Path $PSScriptRoot "CHANGELOG.md"
if (Test-Path $changelogPath) {
    $changelog = [IO.File]::ReadAllText($changelogPath, $utf8) -replace "`r`n", "`n"
    $pattern = "(?ms)^## $([regex]::Escape($version))[^\n]*\n(.*?)(?=^## |\z)"
    if ($changelog -match $pattern) { $notes = $Matches[1].Trim() }
}
if (-not $notes) { $notes = "Write Assist $version" }
$notesFile = Join-Path $env:TEMP "WriteAssist-release-notes.md"
[IO.File]::WriteAllText($notesFile, $notes, $utf8)

try {
    if (-not $tagExists) {
        Invoke-Checked "git tag" { git tag -a $version -m "Write Assist $version" }
        Invoke-Checked "git push of the tag" { git push origin $version }
    }
    Invoke-Checked "gh release create" { gh release create $version --title "Write Assist $version" --notes-file $notesFile }
} finally {
    Remove-Item $notesFile -ErrorAction SilentlyContinue
}
Write-Host "Released $version. Installed copies will offer the update next time they open."
