# release.ps1
# Publishes a new Write Assist version: checks the working tree is committed
# and pushed, tags the commit with the version in release.json, and creates
# the GitHub release that installed copies offer as an update.
#
# Author:  Luis Martinez
# Email:   luis@luigi.mx
# Version: v01.00.00
# Date:    2026-11-24
#
# Usage:   1. Bump "version" (and "date") in release.json, add a CHANGELOG.md entry.
#          2. Commit and push to main.
#          3. Run .\release.ps1 from the repo folder (needs git and gh, signed in).

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$version = (Get-Content release.json -Raw | ConvertFrom-Json).version
if (-not ($version -match '^v\d{2}\.\d{2}\.\d{2}$')) { throw "release.json version '$version' isn't vXX.XX.XX" }

if (git status --porcelain) { throw "Commit your changes first (git status isn't clean)." }
git fetch origin main --quiet
if ((git rev-parse HEAD) -ne (git rev-parse origin/main)) { throw "Push main first (HEAD differs from origin/main)." }
if (git tag --list $version) { throw "Tag $version already exists. Bump the version in release.json." }

# Notes: this version's section of CHANGELOG.md, if there is one.
$notes = ""
if (Test-Path CHANGELOG.md) {
    $changelog = Get-Content CHANGELOG.md -Raw
    $pattern = "(?ms)^## $([regex]::Escape($version))[^\n]*\n(.*?)(?=^## |\z)"
    if ($changelog -match $pattern) { $notes = $Matches[1].Trim() }
}
if (-not $notes) { $notes = "Write Assist $version" }

git tag -a $version -m "Write Assist $version"
git push origin $version
gh release create $version --title "Write Assist $version" --notes $notes
Write-Host "Released $version. Installed copies will offer the update next time they open."
