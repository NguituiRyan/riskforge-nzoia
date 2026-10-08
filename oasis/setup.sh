#!/bin/bash
# One-off: a Python virtual environment with Oasis LMF for Risk Forge (Linux / WSL Ubuntu).
set -e
if ! python3 -m venv --help >/dev/null 2>&1 || ! python3 -c "import ensurepip" >/dev/null 2>&1; then
  echo "Installing python3-venv (needs root)"
  apt-get update -qq && apt-get install -y -qq python3-venv python3-pip
fi
python3 -m venv ~/oasis-env
~/oasis-env/bin/pip install -q --upgrade pip
~/oasis-env/bin/pip install -q oasislmf==2.5.8
~/oasis-env/bin/python -c "from importlib.metadata import version; print('oasislmf', version('oasislmf'))"
