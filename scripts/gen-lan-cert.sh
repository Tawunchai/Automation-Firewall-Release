#!/usr/bin/env bash
# Generates the TLS certificate that lets the app run over HTTPS on the company LAN.
#
# WHY: browsers only expose "powerful features" — the microphone the AI Assistant's voice button
# needs among them — on a SECURE CONTEXT. `localhost` is one by spec, `http://10.0.0.50` is not, so
# voice works while developing and dies the moment the app is opened by IP. HTTPS fixes it.
#
# WHAT IT MAKES: a small private CA, then a server certificate signed by it. Two levels rather than
# one self-signed certificate, because only the CA has to be installed on the client machines — and
# once it is, you can re-issue the server certificate (new IP, expiry) without touching them again.
#
# ⚠️ THE IP MUST BE IN THE SAN. Browsers have ignored the certificate's Common Name for years; an
# address that is not in subjectAltName is simply not covered, no matter what CN says.
#
#   ./scripts/gen-lan-cert.sh 10.0.0.50
#   ./scripts/gen-lan-cert.sh 10.0.0.50 netauto.corp.local 192.168.1.50
#
# Every argument is a name the certificate should cover — IPs and hostnames may be mixed freely.
#
# PORTABILITY NOTE (learned the hard way): this script runs on the Linux VM *and* in Git Bash on
# Windows, so it avoids two things that break there —
#   · `-subj "/CN=…"`  MSYS rewrites any argument starting with "/" into a Windows path, turning the
#                      subject into "C:/Program Files/Git/CN=…". Config files are used instead.
#   · `<(…)`           the Windows openssl build cannot open /proc/<pid>/fd/NN. Temp files instead.
# Nothing here suppresses openssl's stderr either: hiding it once turned a plain error into a
# half-finished CA that looked like success.
set -euo pipefail

CERT_DIR="$(cd "$(dirname "$0")/.." && pwd)/frontend/certs"
DAYS_CA=3650   # 10 years — installing the CA on a fleet is the expensive step, do it once
DAYS_SRV=825   # 825 days is the maximum many browsers accept for a leaf certificate

if [ $# -lt 1 ]; then
  cat >&2 <<'USAGE'
usage: gen-lan-cert.sh <ip-or-hostname> [more names…]

  The FIRST argument should be the address people actually type in the browser.
  Add every other way the server is reached — each one has to be in the certificate
  or that address will show a warning.

  example: ./scripts/gen-lan-cert.sh 10.0.0.50 netauto.corp.local
USAGE
  exit 64
fi

command -v openssl >/dev/null 2>&1 || {
  echo "openssl not found. On Windows use Git Bash (it ships openssl); on the VM: apt install openssl" >&2
  exit 1
}

PRIMARY="$1"
mkdir -p "$CERT_DIR"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# ── Third Windows trap: WHICH openssl answered ───────────────────────────────
# `command -v openssl` finds whichever comes first on PATH, and on a machine with MSYS2/UCRT64 or a
# standalone OpenSSL installed that is a NATIVE Windows build. A native build cannot open the
# POSIX paths this shell hands it — `/tmp/tmp.XXXX/ca.cnf` and `/c/Network-Automation/...` are not
# paths Windows knows — and it fails on the very first file with
# "BIO_new_file:No such process", which reads like a broken CA rather than a path problem.
#
# cygpath is present in every MSYS-flavoured shell and nowhere else, so its existence IS the test
# for "this path will be handed to a program that may not speak POSIX". `-m` gives C:/style/paths,
# which BOTH openssl builds accept, and which bash itself still handles for mkdir/rm.
if command -v cygpath >/dev/null 2>&1; then
  WORK="$(cygpath -m "$WORK")"
  CERT_DIR="$(cygpath -m "$CERT_DIR")"
fi

# ── subjectAltName — IPs go in as IP:, everything else as DNS: ────────────────
ALT=""
for name in "$@"; do
  if printf '%s' "$name" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
    ALT="${ALT}IP:${name},"
  else
    ALT="${ALT}DNS:${name},"
  fi
done
# localhost is always included so the same certificate still works on the machine itself.
ALT="${ALT}DNS:localhost,IP:127.0.0.1"

echo "→ certificate will cover: $ALT"

# ── 1. the private CA (made once; reused on every re-issue) ──────────────────
if [ -f "$CERT_DIR/ca.crt" ] && [ -f "$CERT_DIR/ca.key" ]; then
  echo "→ reusing the existing CA — client machines that already trust it need NO changes"
else
  echo "→ creating a new CA (this is the file you install on the client machines)"
  cat > "$WORK/ca.cnf" <<'CACNF'
[req]
distinguished_name = dn
prompt             = no
x509_extensions    = ext

[dn]
CN = Network Automation LAN CA
O  = Network Automation

[ext]
basicConstraints = critical,CA:TRUE,pathlen:0
keyUsage         = critical,keyCertSign,cRLSign
CACNF

  openssl req -x509 -nodes -newkey rsa:4096 -sha256 -days "$DAYS_CA" \
    -config "$WORK/ca.cnf" \
    -keyout "$CERT_DIR/ca.key" -out "$CERT_DIR/ca.crt"
fi

# ── 2. the server certificate, signed by that CA ─────────────────────────────
echo "→ issuing the server certificate for $PRIMARY"
cat > "$WORK/server.cnf" <<SRVCNF
[req]
distinguished_name = dn
prompt             = no

[dn]
CN = $PRIMARY
O  = Network Automation
SRVCNF

cat > "$WORK/server.ext" <<EXTCNF
subjectAltName   = $ALT
basicConstraints = CA:FALSE
keyUsage         = digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
EXTCNF

openssl req -nodes -newkey rsa:2048 -sha256 \
  -config "$WORK/server.cnf" \
  -keyout "$CERT_DIR/server.key" -out "$WORK/server.csr"

openssl x509 -req -in "$WORK/server.csr" -sha256 -days "$DAYS_SRV" \
  -CA "$CERT_DIR/ca.crt" -CAkey "$CERT_DIR/ca.key" -CAcreateserial \
  -out "$CERT_DIR/server.crt" -extfile "$WORK/server.ext"

chmod 600 "$CERT_DIR/ca.key" "$CERT_DIR/server.key"

echo
echo "✓ done — files are in frontend/certs/"
openssl x509 -in "$CERT_DIR/server.crt" -noout -subject -enddate -ext subjectAltName | sed 's/^/   /'
cat <<EOF

Next:
  1. docker compose up -d --build frontend
     (the entrypoint sees the certificate and switches to HTTPS by itself)

  2. open  https://$PRIMARY:5443

  3. install frontend/certs/ca.crt on the client machines so the warning goes away —
     see the HTTPS section of README.md for the Windows / GPO steps.

⚠️  ca.key and server.key are PRIVATE. They are git-ignored; do not copy them anywhere else.
EOF
