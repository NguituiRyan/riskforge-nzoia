"""Deploy the Oasis runner to a Hugging Face Space (Docker SDK, free CPU hardware).

    hf auth login                                   # once, with a Write token
    python oasis/deploy_hf_space.py [space-name]    # default: riskforge-oasis

Creates <user>/<space-name> if needed, uploads only what the image needs, waits for the build and prints the URL.
"""
import shutil
import sys
import tempfile
import time
from pathlib import Path

from huggingface_hub import HfApi

ROOT = Path(__file__).resolve().parents[1]
NAME = sys.argv[1] if len(sys.argv) > 1 else "riskforge-oasis"

README = """---
title: Risk Forge Oasis
emoji: 🌊
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
short_description: Oasis LMF loss runner for the Risk Forge Kenya flood model
---

# Risk Forge · Oasis LMF runner

The loss calculation behind [Risk Forge](https://riskforge-nzoia.vercel.app), a river-flood catastrophe model for Kenya
(Kenya Re AI Hackathon). The web app sends a portfolio and its insurance and reinsurance terms; this Space runs them through
the [Oasis Loss Modelling Framework](https://oasislmf.org) with the Risk Forge model (JRC flood maps, class damage curves) and
returns ground-up, insured and reinsured losses, AAL and the EP curve.

- `GET /health` - status
- `POST /run` - `{"name", "buildings": [...], "programme": {...}}` (accepted from the Risk Forge site only)

Code: [github.com/NguituiRyan/riskforge-nzoia](https://github.com/NguituiRyan/riskforge-nzoia), folder `oasis/`.
"""

FILES = {
    "Dockerfile": ROOT / "oasis" / "Dockerfile",
    "oasis/riskforge_oasis.py": ROOT / "oasis" / "riskforge_oasis.py",
    "oasis/server.py": ROOT / "oasis" / "server.py",
    "oasis/warmup.py": ROOT / "oasis" / "warmup.py",
    "web/public/data/kenya_hazard.json": ROOT / "web" / "public" / "data" / "kenya_hazard.json",
    "web/public/data/buildings_book.geojson": ROOT / "web" / "public" / "data" / "buildings_book.geojson",
}


def main():
    api = HfApi()
    user = api.whoami()["name"]
    repo_id = f"{user}/{NAME}"
    api.create_repo(repo_id=repo_id, repo_type="space", space_sdk="docker", exist_ok=True, private=False)

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        (tmp / "README.md").write_text(README, encoding="utf-8", newline="\n")
        for dest, src in FILES.items():
            (tmp / dest).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, tmp / dest)
        api.upload_folder(folder_path=str(tmp), repo_id=repo_id, repo_type="space", commit_message="Deploy the Risk Forge Oasis runner")

    info = api.space_info(repo_id)
    host = getattr(info, "host", None) or f"https://{user.lower()}-{NAME}.hf.space"
    print(f"space: https://huggingface.co/spaces/{repo_id}", flush=True)
    print(f"url:   {host}", flush=True)

    last, t0 = None, time.time()
    while time.time() - t0 < 45 * 60:
        stage = api.get_space_runtime(repo_id).stage
        if stage != last:
            print(f"{int(time.time() - t0):>5} s  {stage}", flush=True)
            last = stage
        if stage == "RUNNING":
            return
        if stage in ("BUILD_ERROR", "RUNTIME_ERROR", "CONFIG_ERROR", "NO_APP_FILE", "DELETING"):
            sys.exit(f"Space failed: {stage}. See the build logs at https://huggingface.co/spaces/{repo_id}?logs=build")
        time.sleep(20)
    sys.exit("timed out waiting for the Space to start")


if __name__ == "__main__":
    main()
