# PowerShell wrapper for gen-lan-cert.sh.
#
# WHY THIS EXISTS: the generator is a bash script, and running it from PowerShell does nothing at
# all - no output, no error, no certificate. The frontend container then falls back to plain HTTP
# and the AI Assistant's microphone stays dead, with nothing on screen explaining why.
#
# There is deliberately NO second copy of the certificate logic here. This only finds something
# that can run the tested script:
#   1. bash on PATH / Git for Windows - fastest
#   2. a throw-away Alpine container   - needs nothing installed but Docker, which is already
#                                        required to run this project at all
#
#   .\scripts\gen-lan-cert.ps1 192.168.105.14
#   .\scripts\gen-lan-cert.ps1 192.168.105.14 netauto.corp.local
#
# Every argument is a name the certificate should cover. The FIRST one should be the address
# people actually type in the browser - and it MUST be one of them, or the browser rejects the
# certificate no matter what else is right.
#
# NOTE FOR EDITORS: keep this file ASCII and save it with a BOM. Windows PowerShell 5.1 reads a
# BOM-less file in the system codepage, and on a Thai-locale machine the bytes of characters like
# an arrow or an em dash decode into stray quote marks that break the parser.

param(
  [Parameter(Mandatory = $true, ValueFromRemainingArguments = $true)]
  [string[]]$Names
)

$ErrorActionPreference = 'Stop'

$projectDir = Split-Path -Parent $PSScriptRoot
$scriptRel  = 'scripts/gen-lan-cert.sh'

# -- 1. a bash we can use ------------------------------------------------------
# Git for Windows is tried BEFORE whatever "bash" is on PATH, because on Windows that is usually
# C:\Windows\System32\bash.exe - the WSL launcher, not a bash at all. With no distro installed it
# fails with "execvpe(/bin/bash) failed", which looks like a problem with this script.
$candidates = @(
  (Join-Path $env:ProgramFiles 'Git/bin/bash.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Git/bin/bash.exe'),
  (Join-Path $env:LOCALAPPDATA 'Programs/Git/bin/bash.exe')
)
$onPath = Get-Command bash -ErrorAction SilentlyContinue
if ($onPath) { $candidates += $onPath.Source }

# Each one is PROBED rather than trusted: a bash that cannot run a trivial command is no use, and
# finding that out here gives a clear message instead of a confusing failure mid-way through
# generating a certificate.
$bash = $null
foreach ($candidate in $candidates) {
  if (-not $candidate -or -not (Test-Path $candidate)) { continue }
  & $candidate -c 'exit 0' 2>$null
  if ($LASTEXITCODE -eq 0) { $bash = $candidate; break }
}

if ($bash) {
  Write-Host "Running $scriptRel with $bash" -ForegroundColor DarkGray
  Push-Location $projectDir
  try {
    & $bash $scriptRel @Names
    if ($LASTEXITCODE -ne 0) { throw "gen-lan-cert.sh exited with code $LASTEXITCODE" }
  } finally {
    Pop-Location
  }
  exit 0
}

# -- 2. no bash - borrow one from a container ---------------------------------
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Error 'Neither bash nor docker was found. Install Git for Windows (it ships bash and openssl): https://git-scm.com/download/win'
  exit 1
}

Write-Host "No bash found - running $scriptRel inside a temporary Alpine container" -ForegroundColor DarkGray

# The whole Project directory is mounted because the script resolves its output folder relative to
# its own location, as $0/../frontend/certs; -w keeps that relative path working.
$mount = $projectDir + ':/work'
$inner = 'apk add --no-cache --quiet bash openssl >/dev/null && ./' + $scriptRel + ' ' + ($Names -join ' ')

docker run --rm -v $mount -w /work alpine:3 sh -c $inner
if ($LASTEXITCODE -ne 0) {
  Write-Error ('certificate generation failed (exit ' + $LASTEXITCODE + ')')
  exit 1
}
