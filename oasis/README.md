# Risk Forge on Oasis LMF

The loss calculation (ground-up → insurance terms → reinsurance → AAL and EP curves) runs in the
[Oasis Loss Modelling Framework](https://oasislmf.org) (`oasislmf`, open source, Python kernel: `gulmc`, `fmpy`,
`aalpy`, `lecpy`). Risk Forge supplies the model and the exposure; Oasis computes the losses.

| Oasis piece | What Risk Forge puts in it |
|---|---|
| Peril | `ORF` river / fluvial flood |
| Area perils | The 30″ JRC flood-map cells of Kenya (`row × 1020 + col + 1` on the grid of `scripts/prepare_kenya_hazard.py`). A broker site whose hazard comes from its own flood history gets its own area peril. |
| Event set | A stratified annual-maximum set: 2,000 years; in year *p* the year's largest flood is the 1-in-(2000/*p*) flood (1,000 events, from 1-in-2,000 down to 1-in-2). Footprints are the six JRC maps interpolated in log(return period), exactly as the browser engine does. Oasis's return-period ranking then lands on 1-in-10 … 1-in-500 exactly. |
| Intensity | Flood depth, 1 cm bins (0–15 m) |
| Vulnerability | Huizinga et al. (2017) JRC Africa curve, adapted per construction class; raised floors and site calibration as separate functions; contents by mix of stock / machinery / other. Damage bins every 0.1 %. |
| Exposure | OED `location.csv` (BuildingTIV, ContentsTIV), `account.csv` (per-risk deductible and limit), `ri_info.csv` / `ri_scope.csv` (quota share, then a cat XL inuring on the retained loss) |
| Lookup | Oasis built-in lookup: perils covered → area peril → coverage (buildings, contents) → vulnerability |

Book sample weights are applied by scaling a building's values and its policy terms by its weight, which scales
every loss by exactly that weight.

## Live site: Oasis on the Risk Forge laptop (no account, no card)

Double-click **`oasis/start_oasis_public.cmd`** (or run `bash oasis/start_public.sh` in WSL) and keep the window open.
It starts the Oasis runner, opens a free Cloudflare quick tunnel to it and registers the tunnel's address with the
site every 5 minutes. The site's `/api/oasis` relay forwards visitors' runs to it with a shared secret
(`OASIS_RELAY_SECRET`, in the repo-root `.env` and on Vercel), limits each visitor to 20 runs an hour, and the tunnel
refuses anything that does not come through the site. While the laptop is off, the site says "Oasis offline" and
shows the precomputed Oasis run and the instant preview. The tunnel address changes on every start; the heartbeat
keeps the site pointed at the new one.

For an always-on host, the same container deploys to Google Cloud Run (`oasis/deploy_cloudrun.sh`) or a Hugging Face
Docker Space (`oasis/deploy_hf_space.py`); both need a billing method on the account.

## Run it

Oasis needs Linux (WSL on Windows). Its install is about 740 MB, too big for a Vercel function, so it runs on a
worker and the web app calls it.

```bash
bash oasis/setup.sh                 # once: Python venv with oasislmf 2.5.8 in ~/oasis-env
~/oasis-env/bin/python oasis/riskforge_oasis.py book    # the Risk Forge book -> web/public/data/oasis_book.json
~/oasis-env/bin/python oasis/server.py                  # runner for the web app on http://127.0.0.1:8765
```

With the runner up, **Run on Oasis LMF** in the app (Summary → financial engine, AI analyst → reinsurer view,
offer → financial engine) sends that portfolio and terms to Oasis and shows what it returns, next to the instant
in-browser preview it reconciles to. The site looks for the runner at `VITE_OASIS_URL`, else `http://localhost:8765`.

Each run writes its full Oasis working directory (OED files, keys, model files, `run/` with the Oasis outputs)
to `~/riskforge-oasis/runs/`.
