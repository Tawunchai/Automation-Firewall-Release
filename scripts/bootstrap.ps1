# First-run setup on Windows - write a .env this stack will actually boot with.
#
#   powershell -ExecutionPolicy Bypass -File scripts\bootstrap.ps1
#   docker compose up -d --build
#
# The POSIX twin is scripts\bootstrap.sh and the two must stay in step: same five secrets, same
# length, same refusal to overwrite. Both exist because this project is developed on Windows and
# shipped on Linux.
#
# Why this exists: five values in .env.example ship EMPTY on purpose, and four of them are ":?"
# guards in docker-compose.yml, so "cp .env.example .env && docker compose up" refuses to create a
# single container. Filling them with placeholders is not an option either - backend/main.go calls
# platform.ValidateCredKeyConfig() and platform.ValidateWorkerSecret(), both of which exit on a
# missing or well-known value, because each used to fall back to a hard-coded default and that put
# a real firewall's admin password in the database under a key published in docker-compose.yml.
#
# Flags:
#   -Force    overwrite an existing .env (the previous file is backed up next to it first)
#   -Print    also echo the generated secrets (off by default - they belong in the file, not in the
#             terminal scrollback, which is the same reasoning as rotate-cred-key.ps1)
#
# This file is saved WITH a UTF-8 BOM, like scripts\gen-lan-cert.ps1 and scripts\rotate-cred-key.ps1.
# Windows PowerShell 5.1 reads a .ps1 as the system ANSI codepage unless a BOM says otherwise, so a
# BOM-less script is a parse error waiting for the first non-ASCII byte. Text stays English here for
# the same reason.

[CmdletBinding()]
param(
    [switch]$Force,
    [switch]$Print
)

$ErrorActionPreference = "Stop"

$root     = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$example  = Join-Path $root ".env.example"
$target   = Join-Path $root ".env"

if (-not (Test-Path $example)) {
    Write-Host "ERROR: $example not found - is this the repo root?" -ForegroundColor Red
    exit 1
}

if ((Test-Path $target) -and (-not $Force)) {
    Write-Host ""
    Write-Host "ERROR: .env already exists - refusing to overwrite it." -ForegroundColor Red
    Write-Host "       It holds the only copy of CRED_ENC_KEY, and every device password in the database" -ForegroundColor Red
    Write-Host "       is encrypted with it. Overwriting that key does not fail loudly: the rows stay," -ForegroundColor Red
    Write-Host "       and become unreadable." -ForegroundColor Red
    Write-Host ""
    Write-Host "       Re-run with -Force if you are sure (the current file is backed up first)." -ForegroundColor Yellow
    exit 1
}

# -- secret generation --------------------------------------------------------
# RandomNumberGenerator, not Get-Random: the latter is a deterministic PRNG and must never produce
# a key that protects a firewall password. Same call as rotate-cred-key.ps1.
#
# 32 bytes as 64 hex characters. Hex, not base64, for two reasons that are both live here:
# POSTGRES_PASSWORD is interpolated into a libpq DSN and REDIS_PASSWORD into a redis:// URL, where
# a raw : @ / # or + would have to be escaped. 64 chars clears both minimum-length guards
# (minCredKeyLen and minWorkerSecretLen are 16).
function New-BootstrapSecret {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return (($bytes | ForEach-Object { $_.ToString("x2") }) -join "")
}

$secrets = [ordered]@{
    POSTGRES_PASSWORD    = New-BootstrapSecret
    JWT_SECRET           = New-BootstrapSecret
    CRED_ENC_KEY         = New-BootstrapSecret
    REDIS_PASSWORD       = New-BootstrapSecret
    WORKER_SHARED_SECRET = New-BootstrapSecret
}

foreach ($name in $secrets.Keys) {
    if ($secrets[$name] -notmatch '^[0-9a-f]{64}$') {
        Write-Host "ERROR: generated $name does not look like 32 bytes of hex - nothing written." -ForegroundColor Red
        exit 1
    }
}

if (Test-Path $target) {
    $stamp  = Get-Date -Format "yyyyMMdd-HHmmss"
    $backup = "$target.bak-$stamp"
    Copy-Item $target $backup
    Write-Host "  backed up existing .env to $(Split-Path -Leaf $backup)" -ForegroundColor DarkGray
    Write-Host "  (it holds secrets - keep it out of git, delete it when done)" -ForegroundColor DarkGray
}

# -- write .env ---------------------------------------------------------------
# .env.example is the single source of truth for the comments and the key order, so the generated
# file is that example with five values filled in.
#
# -Encoding UTF8 on the READ is not optional: .env.example is UTF-8 with Thai and box-drawing
# characters in its comments, and Windows PowerShell 5.1 would otherwise read it as the system ANSI
# codepage and write every one of them back out as mojibake. The KEY=VALUE lines are ASCII and keep
# working, so the damage is invisible until somebody opens the file.
$lines = Get-Content $example -Encoding UTF8

$out    = New-Object System.Collections.Generic.List[string]
$filled = @{}
foreach ($line in $lines) {
    $matched = $false
    foreach ($name in $secrets.Keys) {
        if ($line -eq "$name=") {
            $out.Add("$name=$($secrets[$name])")
            $filled[$name] = $true
            $matched = $true
            break
        }
    }
    if ($matched) { continue }

    # DATABASE_URL in the example carries a literal <POSTGRES_PASSWORD> placeholder, which is the
    # other half of why "cp .env.example .env" cannot work.
    if ($line -like "DATABASE_URL=*") {
        $out.Add($line.Replace("<POSTGRES_PASSWORD>", $secrets["POSTGRES_PASSWORD"]))
        continue
    }
    $out.Add($line)
}

# Every one of the five must have landed. An .env.example whose key order or spelling changed would
# otherwise produce a file that looks fine and fails at "docker compose up" instead.
foreach ($name in $secrets.Keys) {
    if (-not $filled.ContainsKey($name)) {
        Write-Host "ERROR: $name was not filled in - .env.example may have changed shape. Nothing written." -ForegroundColor Red
        exit 1
    }
}
if ($out -match '<POSTGRES_PASSWORD>') {
    Write-Host "ERROR: DATABASE_URL still has its placeholder - nothing written." -ForegroundColor Red
    exit 1
}

# Written through .NET rather than Set-Content, to produce the file EXACTLY as the stack wants it:
# LF endings and no BOM. Set-Content -Encoding UTF8 on Windows PowerShell 5.1 emits a BOM and CRLF,
# and both are quietly damaging here - a trailing "\r" becomes part of the secret's VALUE in some
# readers, so the key in the file and the key the process uses stop being the same string.
$text = ($out -join "`n") + "`n"
[System.IO.File]::WriteAllText($target, $text, (New-Object System.Text.UTF8Encoding($false)))

# -- report -------------------------------------------------------------------
Write-Host ""
Write-Host "Wrote .env with five generated secrets (32 bytes of hex each):" -ForegroundColor Green
Write-Host "    POSTGRES_PASSWORD      also substituted into DATABASE_URL"
Write-Host "    JWT_SECRET             signs the login session"
Write-Host "    CRED_ENC_KEY           AES-256-GCM over every stored device password  <-- back this up"
Write-Host "    REDIS_PASSWORD         the job queue"
Write-Host "    WORKER_SHARED_SECRET   the only guard on /internal/*"
if ($Print) {
    Write-Host ""
    foreach ($name in $secrets.Keys) { Write-Host "  $name=$($secrets[$name])" }
}
Write-Host ""
Write-Host "WARNING: CRED_ENC_KEY is not recoverable. Lose it and every device password in the" -ForegroundColor Yellow
Write-Host "         database stays there, encrypted, with nothing able to read it." -ForegroundColor Yellow
Write-Host "         Rotate it with scripts\rotate-cred-key.ps1." -ForegroundColor Yellow
Write-Host ""
Write-Host "Still blank, by hand, and the stack boots fine without them - each one only leaves a"
Write-Host "feature dark: ANTHROPIC_API_KEY (the AI Assistant answers 'not configured'),"
Write-Host "GOOGLE_/GITHUB_/LINE_CLIENT_ID+SECRET (those three sign-in buttons stay hidden;"
Write-Host "email+password still works), SEED_SMTP_EMAIL+SEED_SMTP_APP_PASSWORD (no OTP mail,"
Write-Host "no report delivery)."
Write-Host ""
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "  docker compose up -d --build"
Write-Host "  docker compose logs backend | Select-String password    # the seeded admin password, printed ONCE"
Write-Host ""
