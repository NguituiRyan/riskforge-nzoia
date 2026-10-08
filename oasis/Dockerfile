# Risk Forge Oasis runner: Oasis LMF + the Risk Forge Kenya river-flood model, for Google Cloud Run.
# Build context: a folder holding this Dockerfile, oasis/*.py and web/public/data/{kenya_hazard.json,buildings_book.geojson}
# (oasis/deploy_cloudrun.sh assembles it).
FROM python:3.12-slim

# ps / pgrep: Oasis's kernel script uses them to watch its processes
RUN apt-get update && apt-get install -y --no-install-recommends procps && rm -rf /var/lib/apt/lists/*

ENV PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1 \
    NUMBA_CPU_NAME=generic \
    RF_OASIS_RUNS=/tmp/rf-runs \
    RF_OASIS_PROCESSES=2 \
    RF_REQUIRE_ORIGIN=1 \
    HOST=0.0.0.0 \
    PORT=8080

RUN pip install oasislmf==2.5.8

WORKDIR /app
COPY web/public/data/kenya_hazard.json web/public/data/buildings_book.geojson /app/web/public/data/
COPY oasis/riskforge_oasis.py oasis/server.py oasis/warmup.py /app/oasis/

# compile the Oasis kernel into the image (minutes, once) so a cold start answers in seconds
RUN cd /app/oasis && python warmup.py

WORKDIR /app/oasis
EXPOSE 8080
CMD ["python", "server.py"]
