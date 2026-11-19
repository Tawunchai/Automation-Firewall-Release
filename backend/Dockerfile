# ── Stage 1: Build ──────────────────────────────────────────────
# Pinned to the SAME major.minor that CI tests on (go-version in .github/workflows/ci.yml).
# The toolchain-drift job compares these two and fails when they part company: a Go version
# difference between what the test suite runs on and what the container runs is a difference
# nobody sees until this console is behaving differently against a live firewall.
# go.mod's `go` directive is the module's MINIMUM, and is deliberately NOT bumped every time this
# pin moves. It was raised to 1.26.0 once, on purpose, on 2026-11-19: golang.org/x/net and
# golang.org/x/crypto both declare `go 1.26.0` in EVERY version that carries the fixes for seven
# advisories govulncheck reports as reachable from this code (HTTP/2 framing and CPU exhaustion,
# and two ssh.Dial deadlocks). There was no patched version that kept the old floor, so the floor
# was the price of the patches, and the owner chose the patches.
#
# It cost nothing measurable: CI already runs 1.26.1, this image is golang:1.26-alpine, and nothing
# in this project builds with 1.25. Raise it again only for a reason like that one — a dependency
# that cannot be fixed otherwise — and never as a side effect of bumping the line below.
FROM golang:1.26-alpine AS builder

# ให้ Go ดาวน์โหลด toolchain ที่ถูก version อัตโนมัติ
ENV GOTOOLCHAIN=auto

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o server .

# ── Stage 2: Run ────────────────────────────────────────────────
# Pinned, like every other base in this repo. `alpine:latest` was the one FROM line that floated,
# which means two builds a month apart ship different C libraries and nothing records which one a
# given container is running — and when a CVE lands, "which Alpine is in production?" has no answer.
# Trivy flags it as DS-0001. 3.24 is what `latest` resolved to here and reports zero HIGH/CRITICAL.
# Bump this deliberately when Alpine 3.24 goes end-of-life; that is a decision, not a side effect.
FROM alpine:3.24

RUN apk --no-cache add ca-certificates tzdata

WORKDIR /app

COPY --from=builder /app/server .


EXPOSE 9000

CMD ["./server"]
