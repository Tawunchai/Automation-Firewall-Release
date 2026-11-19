# ── Stage 1: Build ──────────────────────────────────────────────
# Pinned to the SAME major that CI tests on (node-version in .github/workflows/ci.yml), enforced
# by the toolchain-drift job. This one mattered most of the three: the bundle that ships is built
# HERE, so while this said 20 and CI said 24, the artifact served to users was produced by a Node
# major that nothing in CI had ever run.
FROM node:24-alpine AS builder

WORKDIR /app

# VITE_BACKEND_URL ถูก bake ตอน build (Vite เป็น static)
# ค่า default "/api" = เรียก backend แบบ same-origin ผ่าน nginx reverse proxy
# (nginx/common.conf proxy /api → backend) → เปิดจาก host ไหนก็เร็ว ไม่ต้อง forward 9000
# same-origin ยังแปลว่าเปิด HTTPS ที่ nginx อย่างเดียวจบ — API วิ่งตามไปเองไม่ต้องแก้อะไร
ARG VITE_BACKEND_URL=/api
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Stage 2: Serve (nginx) ──────────────────────────────────────
# nginx's EVEN minor numbers are the stable line and the odd ones are mainline, so 1.30 is the
# supported counterpart of the 1.27 this used to pin. The pin itself is not the problem — the
# problem was that 1.27 went end-of-life upstream, which freezes the tag's base layer at Alpine
# 3.21.3 forever. It never gets another security update, so the image drifted to 70 HIGH/CRITICAL
# OS CVEs (openssl, curl, expat, libxml2, zlib, musl …) while nothing in this repo changed.
# 1.30-alpine is Alpine 3.24.4 — the same base the backend runs, which Trivy reports clean.
#
# So: keep pinning, but to a line that is still maintained, and re-check it when the line retires.
# `docker run --rm nginx:1.30-alpine cat /etc/alpine-release` is the one-line way to see which
# Alpine a tag carries before trusting it.
FROM nginx:1.30-alpine

# Both configs ship in the image; entrypoint.sh copies the right one into conf.d at start,
# depending on whether a certificate is mounted at /etc/nginx/certs. One image serves the laptop
# (localhost, no cert) and the company VM (HTTPS by IP) — nothing to rebuild to turn TLS on.
COPY nginx/common.conf /etc/nginx/snippets/common.conf
COPY nginx/http.conf   /etc/nginx/templates/http.conf
COPY nginx/https.conf  /etc/nginx/templates/https.conf
COPY docker-entrypoint.sh /entrypoint.sh
# Strip CR as well as chmod: a script checked out on Windows arrives with CRLF, and the container
# then fails with the very unhelpful "exec /entrypoint.sh: no such file or directory" — the kernel
# is looking for an interpreter literally named "/bin/sh\r". .gitattributes pins eol=lf too; this
# line makes the image build correctly even from a working copy that predates it.
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh

COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80 443

ENTRYPOINT ["/entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
