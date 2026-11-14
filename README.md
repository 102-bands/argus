# Argus

**Type in a spot in the sky and watch it change.** Argus plays NASA SPHEREx infrared images of any patch of sky like a flipbook, so anything that moved or changed brightness stands out: asteroids, comets, nearby stars and brown dwarfs.

Team **102 Bands** (Umair Zia, team lead; Aliki Vidouri) built it for the **2026 NASA International Space Apps Challenge**, challenge *Planet X and SPHEREx*.

- Logo kit: [`brand/`](brand/)

## Layout
```
app/
  api/     FastAPI backend (Python 3.12, uv): SIA coverage, S3 partial reads, stacking, SSE jobs
  web/     React + Vite + TypeScript frontend; public/presets/ holds the five precomputed targets
  brand/   Argus logo kit
```

## Quick start
```
cd api && uv sync && uv run uvicorn argus.main:app --port 8000     # backend
cd web && npm install && npm run dev                                # http://localhost:5173
```
Tests: `uv run pytest` (add `-m network` for live archive checks) and `npm test`.
Benchmark the archive reader or a full live job: `uv run python scripts/bench_fetch.py --help`.

## Deploy
One Docker image from the repo root ([`Dockerfile`](Dockerfile)): it builds the web app and serves it and the API from one uvicorn process. Railway picks up [`railway.json`](railway.json) with no extra settings. Optional: a volume at `/data` for the cache (then set `RAILWAY_RUN_UID=0`), and `VITE_UMAMI_WEBSITE_ID` / `VITE_SITE_DOMAIN` for analytics. Pick a US-East region: the SPHEREx bucket is in us-east-1.

Section numbers (§) in code comments refer to the team's internal product spec.

## Use of AI tools (Space Apps rule)
The rules ask teams to say where and how AI tools were used:
- **Code and documents:** we used an AI coding assistant (Claude, by Anthropic) to help write the code and documents. The team designs, reviews, tests and decides everything.
- **Media:** any AI-generated image or video in our demo carries a visible "AI-generated" watermark.
- **Data and results:** all scientific data comes from the archives credited below. Nothing is AI-generated.

## Data credits
- **SPHEREx:** NASA SPHEREx data from the NASA/IPAC Infrared Science Archive (IRSA). DR1 images doi:10.26131/IRSA678; QR3 doi:10.26131/IRSA662. Imagery courtesy NASA/JPL-Caltech.
- **Gaia:** data from the European Space Agency (ESA) mission Gaia, processed by the Gaia Data Processing and Analysis Consortium (DPAC). Gaia DR3; Gaia Collaboration, Vallenari et al. 2023.
- **Aladin Lite:** CDS, Strasbourg Astronomical Data Center.

Built for the 2026 NASA International Space Apps Challenge. Argus is not affiliated with or endorsed by NASA.
