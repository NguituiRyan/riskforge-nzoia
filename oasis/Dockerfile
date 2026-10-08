# Risk Forge Oasis runner: Oasis LMF + the Risk Forge Kenya river-flood model.
# Runs on Hugging Face Spaces (Docker SDK, port 7860, as user 1000) and on Google Cloud Run (PORT=8080 set by the platform).
# Build context: this Dockerfile, oasis/*.py and web/public/data/{kenya_hazard.json,buildings_book.geojson}
# (oasis/deploy_hf_space.py and oasis/deploy_cloudrun.sh assemble it).
FROM python:3.12-slim

# ps / pgrep: Oasis's kernel script uses them to watch its processes
RUN apt-get update && apt-get install -y --no-install-recommends procps && rm -rf /var/lib/apt/lists/*

ENV PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1 \
    NUMBA_CPU_NAME=generic \
    NUMBA_CACHE_DIR=/app/numba-cache \
    RF_OASIS_RUNS=/tmp/rf-runs \
    RF_OASIS_PROCESSES=2 \
    RF_REQUIRE_ORIGIN=1 \
    HOST=0.0.0.0 \
    PORT=7860

RUN pip install oasislmf==2.5.8

WORKDIR /app
COPY web/public/data/kenya_hazard.json web/public/data/buildings_book.geojson /app/web/public/data/
COPY oasis/riskforge_oasis.py oasis/server.py oasis/warmup.py /app/oasis/

# compile the Oasis kernel into the image (a few minutes, once) so a cold start answers in seconds;
# NUMBA_CPU_NAME=generic keeps the compiled code valid on any CPU, and the cache is readable by the runtime user
RUN cd /app/oasis && python warmup.py && chmod -R a+rwX /app

WORKDIR /app/oasis
EXPOSE 7860
CMD ["python", "server.py"]
