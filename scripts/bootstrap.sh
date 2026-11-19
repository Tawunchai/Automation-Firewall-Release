#!/usr/bin/env sh
# First-run setup — write a .env this stack will actually boot with.
#
#   ./scripts/bootstrap.sh && docker compose up -d --build
#
# Why this exists: five values in .env.example ship EMPTY on purpose, and four of them are `:?`
# guards in docker-compose.yml, so `cp .env.example .env && docker compose up` refuses to create a
# single container. Filling them with placeholders is not an option either — backend/main.go calls
# platform.ValidateCredKeyConfig() and platform.ValidateWorkerSecret(), both of which exit on a
# missing or well-known value, because each used to fall back to a hard-coded default and that put
# a real firewall's admin password in the database under a key published in docker-compose.yml.
#
# So the fix is to GENERATE real secrets. That is all this script does.
#
# Deliberately a POSIX `sh` script, not bash: it is the one thing a fresh clone runs before
# anything is installed, and it has to work on an alpine container and a Debian CI runner as well
# as on Git Bash under Windows. The PowerShell twin is scripts/bootstrap.ps1.
#
# Flags:
#   --force    overwrite an existing .env (the previous file is backed up next to it first)
#   --print    also echo the generated secrets to stdout (off by default — they belong in the file,
#              not in the terminal scrollback, which is the same reasoning as rotate-cred-key.ps1)

set -eu

FORCE=0
PRINT=0
for arg in "$@"; do
    case "$arg" in
        --force) FORCE=1 ;;
        --print) PRINT=1 ;;
        -h|--help)
            sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *)
            echo "bootstrap: unknown option '$arg' (try --help)" >&2
            exit 2
            ;;
    esac
done

# Resolve the repo root from this script's location, so it works from any cwd.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
EXAMPLE="$ROOT/.env.example"
TARGET="$ROOT/.env"

[ -f "$EXAMPLE" ] || { echo "bootstrap: $EXAMPLE not found — is this the repo root?" >&2; exit 1; }

if [ -f "$TARGET" ] && [ "$FORCE" -eq 0 ]; then
    cat >&2 <<EOF
bootstrap: .env already exists — refusing to overwrite it.

  It holds the only copy of CRED_ENC_KEY, and every device password in the database is encrypted
  with it. Overwriting that key does not fail loudly: the rows stay, and become unreadable.

  Re-run with --force if you are sure (the current file is backed up first), or edit .env by hand.
EOF
    exit 1
fi

# ── secret generation ────────────────────────────────────────────────────────
# 32 bytes as 64 hex characters. Hex, not base64, for two reasons that are both live here:
# POSTGRES_PASSWORD is interpolated into a libpq DSN and REDIS_PASSWORD into a redis:// URL, where
# a raw : @ / # or + would have to be escaped. 64 chars clears both minimum-length guards
# (minCredKeyLen and minWorkerSecretLen are 16).
gen_secret() {
    if command -v openssl >/dev/null 2>&1; then
        openssl rand -hex 32
    elif command -v od >/dev/null 2>&1; then
        od -An -vtx1 -N32 /dev/urandom | tr -d ' \t\n'
    else
        echo "bootstrap: need openssl or od to generate a secret" >&2
        exit 1
    fi
}

POSTGRES_PASSWORD=$(gen_secret)
JWT_SECRET=$(gen_secret)
CRED_ENC_KEY=$(gen_secret)
REDIS_PASSWORD=$(gen_secret)
WORKER_SHARED_SECRET=$(gen_secret)

for s in "$POSTGRES_PASSWORD" "$JWT_SECRET" "$CRED_ENC_KEY" "$REDIS_PASSWORD" "$WORKER_SHARED_SECRET"; do
    case "$s" in
        [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]*) ;;
        *) echo "bootstrap: generated secret does not look like hex — refusing to write .env" >&2; exit 1 ;;
    esac
done

if [ -f "$TARGET" ]; then
    BACKUP="$TARGET.bak-$(date +%Y%m%d-%H%M%S)"
    cp "$TARGET" "$BACKUP"
    echo "  backed up existing .env to $(basename "$BACKUP")  (it holds secrets — keep it out of git, delete it when done)"
fi

# ── write .env ───────────────────────────────────────────────────────────────
# .env.example is the single source of truth for the comments and the key order, so the generated
# file is that example with five values filled in. awk, not sed -i, because the latter is not
# portable (BSD sed wants an argument) and because the secrets must never be part of a shell
# pattern — they go in through -v.
#
# DATABASE_URL in the example carries a literal <POSTGRES_PASSWORD> placeholder, which is the other
# half of why `cp .env.example .env` cannot work; it is substituted here.
awk -v pg="$POSTGRES_PASSWORD" \
    -v jwt="$JWT_SECRET" \
    -v cred="$CRED_ENC_KEY" \
    -v redis="$REDIS_PASSWORD" \
    -v worker="$WORKER_SHARED_SECRET" '
    /^POSTGRES_PASSWORD=$/     { print "POSTGRES_PASSWORD=" pg;     next }
    /^JWT_SECRET=$/            { print "JWT_SECRET=" jwt;           next }
    /^CRED_ENC_KEY=$/          { print "CRED_ENC_KEY=" cred;        next }
    /^REDIS_PASSWORD=$/        { print "REDIS_PASSWORD=" redis;     next }
    /^WORKER_SHARED_SECRET=$/  { print "WORKER_SHARED_SECRET=" worker; next }
    /^DATABASE_URL=/           { sub(/<POSTGRES_PASSWORD>/, pg); print; next }
    { print }
' "$EXAMPLE" > "$TARGET.tmp"

# Every one of the five must have landed. An .env.example whose key order or spelling changed
# would otherwise produce a file that looks fine and fails at `docker compose up` instead.
for key in POSTGRES_PASSWORD JWT_SECRET CRED_ENC_KEY REDIS_PASSWORD WORKER_SHARED_SECRET; do
    if ! grep -q "^$key=[0-9a-f][0-9a-f]*$" "$TARGET.tmp"; then
        rm -f "$TARGET.tmp"
        echo "bootstrap: $key was not filled in — .env.example may have changed shape. Nothing written." >&2
        exit 1
    fi
done
if grep -q '<POSTGRES_PASSWORD>' "$TARGET.tmp"; then
    rm -f "$TARGET.tmp"
    echo "bootstrap: DATABASE_URL still has its placeholder — nothing written." >&2
    exit 1
fi

mv "$TARGET.tmp" "$TARGET"
chmod 600 "$TARGET" 2>/dev/null || true

# ── report ───────────────────────────────────────────────────────────────────
echo ""
echo "Wrote .env with five generated secrets (32 bytes of hex each):"
echo "    POSTGRES_PASSWORD      also substituted into DATABASE_URL"
echo "    JWT_SECRET             signs the login session"
echo "    CRED_ENC_KEY           AES-256-GCM over every stored device password  <-- back this up"
echo "    REDIS_PASSWORD         the job queue"
echo "    WORKER_SHARED_SECRET   the only guard on /internal/*"
if [ "$PRINT" -eq 1 ]; then
    echo ""
    echo "  POSTGRES_PASSWORD=$POSTGRES_PASSWORD"
    echo "  JWT_SECRET=$JWT_SECRET"
    echo "  CRED_ENC_KEY=$CRED_ENC_KEY"
    echo "  REDIS_PASSWORD=$REDIS_PASSWORD"
    echo "  WORKER_SHARED_SECRET=$WORKER_SHARED_SECRET"
fi
echo ""
echo "⚠️  CRED_ENC_KEY is not recoverable. Lose it and every device password in the database stays"
echo "    there, encrypted, with nothing able to read it. Rotate it with scripts/rotate-cred-key.ps1."
echo ""
echo "Still blank, by hand, and the stack boots fine without them — each one only leaves a feature"
echo "dark: ANTHROPIC_API_KEY (the AI Assistant answers 'not configured'), GOOGLE_/GITHUB_/LINE_"
echo "CLIENT_ID+SECRET (those three sign-in buttons stay hidden; email+password still works),"
echo "SEED_SMTP_EMAIL+SEED_SMTP_APP_PASSWORD (no OTP mail, no report delivery)."
echo ""
echo "Next:  docker compose up -d --build"
echo "       docker compose logs backend | grep -i password    # the seeded admin password, printed ONCE"
echo ""
