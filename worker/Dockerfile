# Python automation worker — netmiko + redis + git
# Pinned to the SAME minor that CI tests on (python-version in .github/workflows/ci.yml),
# enforced by the toolchain-drift job.
FROM python:3.15-slim

# git จำเป็นสำหรับ commit config backup
RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# log ออกทันที ไม่ buffer (เห็น progress ใน docker logs)
ENV PYTHONUNBUFFERED=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# git identity สำหรับ commit ภายใน container
RUN git config --global user.email "worker@network-automation.local" \
    && git config --global user.name "automation-worker" \
    && git config --global --add safe.directory '*'

CMD ["python", "worker.py"]
