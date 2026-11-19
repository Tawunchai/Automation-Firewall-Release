# Phase 0, step 3 — add the next device-credential encryption key to .env.
#
# Windows has no `openssl`, and this edit is the one place in the rotation where a slip is
# unrecoverable: CRED_ENC_KEY_V<current> must stay in the file until every row has been
# re-encrypted, because it is the only thing that can still read them. So the edit is scripted
# rather than typed — the script only ADDS the new key and bumps the version, and refuses to run
# if it would overwrite a key that is still in use.
#
# The generated secret is never printed. It goes straight into .env, which is where it has to end
# up anyway, and keeping it off the screen keeps it out of the terminal scrollback.
#
#   cd Project
#   powershell -ExecutionPolicy Bypass -File scripts\rotate-cred-key.ps1
#
# Afterwards: docker compose up -d backend, then POST /admin/rotate-cred-key.
#
# This file is saved WITH a UTF-8 BOM, like scripts\gen-lan-cert.ps1. Windows PowerShell 5.1 reads
# a .ps1 as the system ANSI codepage unless a BOM says otherwise, so a BOM-less script is a parse
# error waiting for the first non-ASCII byte. Text here stays English for the same reason.

$ErrorActionPreference = "Stop"

$envPath = Join-Path $PSScriptRoot "..\.env"
if (-not (Test-Path $envPath)) {
    Write-Host "ERROR: no .env found at $envPath" -ForegroundColor Red
    exit 1
}
$envPath = (Resolve-Path $envPath).Path

# ── read current state ───────────────────────────────────────────────────────
#
# -Encoding UTF8 is not optional. Windows PowerShell 5.1 defaults to the system ANSI codepage, and
# .env is UTF-8 with Thai and box-drawing characters in its comments: read as ANSI and written back
# out, every one of them is replaced by mojibake. The KEY=VALUE lines are ASCII and keep working,
# so the damage is invisible until somebody opens the file.
$lines = Get-Content $envPath -Encoding UTF8

$versionLine = $lines | Where-Object { $_ -match '^\s*CRED_ENC_KEY_VERSION\s*=' } | Select-Object -First 1
if (-not $versionLine) {
    Write-Host "ERROR: no CRED_ENC_KEY_VERSION line in .env" -ForegroundColor Red
    exit 1
}
$current = [int](($versionLine -split '=', 2)[1].Trim())
$next    = $current + 1

$nextName = "CRED_ENC_KEY_V$next"
if ($lines | Where-Object { $_ -match "^\s*$nextName\s*=" }) {
    Write-Host "ERROR: $nextName already exists in .env" -ForegroundColor Red
    Write-Host "       This script looks like it has already run. To start over, remove that line first." -ForegroundColor Red
    exit 1
}

# The new key must also be passed through to the container, or it is simply absent inside it and
# the rotation fails on every row. Checked here because the symptom otherwise appears three steps
# later, as a rotation that reports failures for no visible reason.
$composePath = Join-Path (Split-Path $envPath) "docker-compose.yml"
if (Test-Path $composePath) {
    if (-not (Select-String -Path $composePath -Pattern "^\s*$nextName\s*:" -Quiet)) {
        Write-Host "ERROR: docker-compose.yml does not pass $nextName to the backend." -ForegroundColor Red
        Write-Host "       Add this line next to the other CRED_ENC_KEY_* entries, then re-run:" -ForegroundColor Red
        Write-Host "         ${nextName}: `"`${${nextName}:-}`"" -ForegroundColor Yellow
        exit 1
    }
}

# ── back up before touching anything ─────────────────────────────────────────
$stamp  = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = "$envPath.bak-$stamp"
Copy-Item $envPath $backup
Write-Host ""
Write-Host "Backed up current .env to: $(Split-Path -Leaf $backup)" -ForegroundColor DarkGray
Write-Host "  (that backup holds secrets - delete it once the rotation is done, and keep it out of git)" -ForegroundColor DarkGray

# ── generate ─────────────────────────────────────────────────────────────────
# RandomNumberGenerator, not Get-Random: the latter is a deterministic PRNG and must never
# produce a key that protects a firewall password.
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$secret = ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""

# ── write: add the new key next to the old one, bump the version ─────────────
$out = New-Object System.Collections.Generic.List[string]
foreach ($line in $lines) {
    if ($line -match "^\s*CRED_ENC_KEY_V$current\s*=") {
        $out.Add($line)                       # the old key STAYS - it decrypts the existing rows
        $out.Add("$nextName=$secret")
        continue
    }
    if ($line -match '^\s*CRED_ENC_KEY_VERSION\s*=') {
        $out.Add("CRED_ENC_KEY_VERSION=$next")
        continue
    }
    $out.Add($line)
}

# If the old key had no line of its own (version 1 uses the bare CRED_ENC_KEY name), append rather
# than lose the new key silently.
if (-not ($out | Where-Object { $_ -match "^\s*$nextName\s*=" })) {
    $out.Add("$nextName=$secret")
}

# Written through .NET rather than Set-Content, to preserve the file EXACTLY as it was: LF endings
# and no BOM. Set-Content -Encoding UTF8 on Windows PowerShell 5.1 emits a BOM and CRLF, and both
# are quietly damaging here - a trailing "\r" becomes part of the secret's VALUE in some readers,
# so the key in the file and the key the process uses stop being the same string.
$text = ($out -join "`n") + "`n"
[System.IO.File]::WriteAllText($envPath, $text, (New-Object System.Text.UTF8Encoding($false)))

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "  added   $nextName            (value deliberately not shown)"
Write-Host "  set     CRED_ENC_KEY_VERSION = $next"
Write-Host "  kept    CRED_ENC_KEY_V$current            <-- do NOT delete until the rotation is verified"
Write-Host ""
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "  docker compose up -d backend"
Write-Host "  then POST /admin/rotate-cred-key and check every table reports failed=0"
Write-Host ""
