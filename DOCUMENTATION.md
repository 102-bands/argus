# Argus documentation

Argus is a free web tool that turns NASA SPHEREx all-sky infrared images of any patch of sky into an aligned flipbook. You can blink between visits, subtract them to see what changed, read the brightness and spectrum of a source, and let an automatic finder flag everything that moves, varies or is unusually red, each one checked against ESA's Gaia catalogue.

- Live site: <https://argus102.space> · the tool: <https://argus102.space/app>
- Method paper (every equation, validation, limits): <https://argus102.space/about>
- Demo video (30 seconds): <https://youtu.be/6nosbx6FoFc>
- Team 102 Bands (Umair Zia, team lead; Aliki Vidouri), 2026 NASA International Space Apps Challenge, challenge *Planet X and SPHEREx*

Argus is not affiliated with or endorsed by NASA.

---

## 1. Using the tool

### Opening a field
- **Search box:**
  - Type a position in decimal degrees (`269.45 4.69`) or sexagesimal (`17h57m48s +04d41m`, `08:55:10.8 -07:14:42`).
  - Or type a preset name ("Barnard").
  - Positions on the five presets open instantly. Any other spot is built live from the NASA archive in about 15–25 s.
- **Presets** (right rail):

  | Preset | What to look for |
  |---|---|
  | Barnard's Star | The fastest-moving star in the sky |
  | ε Indi B | A brown-dwarf pair |
  | WISE 0855−0714 | The coldest known brown dwarf; opens at 3′ in D6 |
  | RW Aur | A variable star |
  | R Dra | A Mira variable |

### Controls (left rail)
| Control | What it does | Key |
|---|---|---|
| View: Image / Plots | The blink image, or the light curve and spectrum of the centre source | `P` |
| Playback | Play / pause, step one visit, speed slider | `Space`, `←` `→`, `+` `−` |
| Mode | **blink** flips visits; **diff** subtracts a reference visit (cyan brighter now, magenta brighter before); **stack** adds all visits | `D` toggles diff |
| Band | `all` or one detector D1 (0.75 µm) … D6 (5 µm) | `0`–`6` |
| Brightness | Stretch (asinh, linear, log, zscale) and softness; one scale for every visit | |
| Field of view | 1′–15′ (default 8′); a new size on a new position starts a live build | |
| Overlays | **Gaia**: predicted positions and motion arrows. **Flags**: saturated and bad pixels. **Finds**: the automatic candidates. **Planet X**: the parallax jump of a distant planet, with a distance slider | `G`, `F`, `C`, `X` |
| `?` | All keyboard shortcuts | `?` |

**Timeline:** click a visit to jump to it. In diff mode, shift-click sets the reference visit.

### Right rail
- **Inspector:** the pixel under the cursor (RA/Dec, MJy/sr, flags) and the frame's date, wavelength range and exposure count.
- **Checked against Gaia** (presets): the target measured on every visit against Gaia's prediction, passing within 0.5 px.
- **Candidates:** see section 2.
- **Sky context:** a wider SPHEREx all-sky map; the cyan box is the field.

### Sharing
- **Share → Copy link:** the URL holds the whole view.
- **Embed:** an iframe snippet; `/embed/...` hides the site chrome.
- **Download PDF:**
  - a technical report: stacked image, every visit and its difference, light curve, spectrum, the candidates table, and method;
  - or **Download GIF** of the blink.

### URL parameters
Applies to `/app` and `/t/<preset>`. Defaults are omitted from the URL.

| Parameter | Values | Default |
|---|---|---|
| `ra`, `dec` | decimal or sexagesimal | preset centre |
| `size` | 1–15 (arcmin) | 8 |
| `band` | `all`, `D1`…`D6` | `all` |
| `speed` | 50–5000 (ms per frame) | 500 |
| `stretch` | `asinh`, `linear`, `log`, `zscale` | `asinh` |
| `mode` | `blink`, `diff`, `stack` | `blink` |
| `epoch` | reference visit index | 0 |
| `gaia`, `flags` | `1` to turn on | off |
| `cand` | `0` to hide the finds | on |
| `view` | `image`, `plots` | `image` |
| `px` | Planet X distance, 200–3000 AU (0 = off) | 0 |

Example: `https://argus102.space/t/barnard?mode=diff&gaia=1&px=500`

### Guided tour
- **First visit:** the tool asks "This is Argus. Take a walkthrough?" once per browser.
- **Tour button:** replays the 19-step tour at any time.

---

## 2. The candidate finder

When every visit of a field has loaded, Argus measures every source in it, in your browser, in a few milliseconds. Equations are numbered as in the paper (§3.6 at /about).

### Labels
| Label | Marker | Meaning |
|---|---|---|
| **Moving** | magenta square plus the measured track | Proper-motion score S ≥ 5, a shift of at least 0.5 px (3.1″) over the visits, and a straight-line fit. Saturated or blended sources count only if Gaia confirms the motion. |
| **Variable** | amber diamond | χ²_ν ≥ 5 and at least a 15% change in two or more detectors that agree on the brightest visit |
| **Very red** | orange circle | D1 − D6 ≥ 2.5 mag (AB), or found only in the D5 + D6 image: brown-dwarf-like colours |
| **Not in Gaia** | dashed outline | No Gaia DR3 star within 9″ (one-to-one matching) |
| **Needs follow-up** | — | A mover Gaia does not confirm, or a red or variable source Gaia does not know |
| Saturated core / Blended | — | The measurement is less reliable |

- **Panel:** shows a summary and the top three finds. Click a row (or a marker on the image) for its position, motion (″/yr, position angle, score), detectors seen, colour, Gaia match and a brightness sparkline.
- **"Centre here":** opens a new field on that source, so Plots shows its own light curve and spectrum.
- **PDF report:** includes the candidates table.

### Method in brief
1. **Detection:** local maxima at least 5σ above the median of the exposure-weighted visit stack, and separately of the D5 + D6 stack. The 40 brightest are kept.
2. **Astrometry:**
   - Flux-weighted centroids (eq. 12) on each visit with at least 5 exposures.
   - The per-visit shift common to the whole field is removed (differential astrometry).
3. **Motion:**
   - Weighted least squares per axis (eq. 14–15), with score S = √Δχ² (eq. 16).
   - Errors are scaled so the field's median fixed-model χ²_ν is 1.
   - Parallax (eq. 17–18) is fitted with 5 or more visits and shown only at 3σ.
4. **Photometry:**
   - Aperture photometry (eq. 7–8) per detector and visit.
   - A per-visit zero point from the ensemble of sources, and error scaling.
   - Variability from eq. 19.
5. **Gaia:** DR3 positions moved to the mean epoch (eq. 11), one-to-one match within 1.5 px.

### Results on the presets (3′ fields)
| Target | Finder | Reference |
|---|---|---|
| Barnard's Star | moving, 11.0 ± 0.7″/yr, PA 356°, S = 14.8 | Gaia 10.4″/yr, PA 356° |
| ε Indi B | moving, very red, 4.8 ± 0.6″/yr, PA 116°, S = 8.3 | Gaia 4.7″/yr, PA 122° |
| WISE 0855−0714 | moving, very red, not in Gaia, 4.4 ± 0.9″/yr, PA 276°, S = 5.0 | 8.1″/yr, PA 275° (Luhman & Esplin 2016) |
| RW Aur | variable in D1–D3, D5, D6 | known variable |
| R Dra | not measurable (saturated) | known Mira |

On the five 8′ fields (up to 40 sources each) the finder reports no false movers.

**Honest limits:**
- WISE 0855's speed is underestimated, and its quoted error is too small, because a star about 6″ away blends with it.
- The thresholds were tuned on these fields.
- S has two degrees of freedom, so it is a score, not a Gaussian σ.

---

## 3. Architecture

```
Browser (React + Vite + TypeScript)
  ├─ static presets: web/public/presets/<id>/manifest[-8].json + frames/*.bin
  ├─ Web Worker: decodes float16 frames, stretches, colours
  ├─ lib/candidates.ts: the finder (pure functions, unit-tested)
  └─ /api/*  ──────────►  FastAPI (api/argus, one uvicorn process; also serves the built site)
                            ├─ sia.py      IRSA SIA2 image search  → exposures covering the position
                            ├─ pixels.py   byte-range reads from the IRSA S3 copy (3 parallel prefetch rounds)
                            ├─ pipeline.py zodi subtraction, masks, TAN reprojection, inverse-variance stacks,
                            │              float16 frames, centre-source photometry
                            ├─ jobs.py     job queue (2 running, 20 queued), SSE progress, stall/abandon timeouts
                            ├─ gaia.py     Gaia DR3 cone search (ESA TAP, ≤ 2000 rows)
                            ├─ cache.py    disk cache (manifests, frames, cutouts, Gaia) under CACHE_DIR
                            ├─ store.py    SQLite: public counters and contact messages (CACHE_DIR/argus.db)
                            └─ security.py CSP, body-size limit; slowapi rate limits per route
Deployment: one Docker image (Dockerfile) on Railway, volume at /data, region US-East (the SPHEREx bucket is in us-east-1)
```

### Data pipeline, step by step
1. **Coverage:** SIA2 query for `spherex_dr1` and `spherex_qr3` exposures covering the position. Exposures more than 20 days apart start a new **visit**.
2. **Selection:** a live job keeps up to 120 exposures spread evenly over the visits; presets keep all of them.
3. **Read:** only the pixel rows needed, from the open S3 copy. Layers used: image (MJy/sr), variance, flags, zodiacal model.
4. **Calibrate:**
   - I′ = I − Z (eq. 4).
   - Two-tier mask: hard flags always, soft flags only off sources.
5. **Align:** reproject onto one TAN grid (eq. 2–3), with 6.15″ pixels, north up and east left.
6. **Stack:** inverse-variance per visit (eq. 5), per detector and for all detectors.
7. **Encode:** float16 frames plus a flag layer, brotli-compressed, cached for a year (immutable keys).
8. **Photometry:** aperture photometry of the centre source on every exposure (eq. 7–9). This gives the light curve and, because each exposure has its own wavelength, a spectrum.

---

## 4. API reference

Base path: `/api`. Errors use RFC 7807 problem JSON. Rate limits are per IP.

| Method and path | Purpose | Limit |
|---|---|---|
| `GET /health` | Status, version, pixel source, collections, memory (`rss_mb`), job counts | — |
| `GET /targets` | The five preset targets | 120/min |
| `GET /releases` | Collections in use and the latest release date | 60/min |
| `GET /coverage?ra=&dec=[&collections=]` | Exposure count and visits for a position | 30/min |
| `POST /blink` | Start (or reuse) a build. Returns `200` + manifest if cached; `202 {job_id, manifest_key, frames_expected}` if started; `404` if no coverage; `503` if busy | 10/min |
| `GET /blink/{job_id}/events` | Server-sent events: `progress`, `frame`, `done`, `error` | 30/min |
| `GET /manifest/{key}` | Field manifest: grid, visits, frames, photometry | 120/min |
| `GET /frame/{key}` | One encoded frame (brotli if accepted) | 600/min |
| `GET /gaia?ra=&dec=&radius_arcmin=` | Gaia DR3 sources at epoch 2016.0 (radius ≤ 15′) | 30/min |
| `GET /lightcurve?key=[&detector=]` | Photometry of a finished build | 30/min |
| `GET /stats` | Public counters: fields analysed, live searches, exposures processed, shares and downloads | 120/min |
| `POST /count {"event": "field"\|"download"}` | Count a client event (204) | 60/min |
| `POST /contact {name, email, topic, message, website}` | Contact form; `website` is a honeypot | 5/hour |
| `GET /admin/messages` | Contact messages (needs `Authorization: Bearer <ADMIN_TOKEN>`; 404 when unset) | 30/min |
| `POST /admin/messages/{id}/handled?handled=true` | Mark a message handled | 60/min |

`POST /blink` body: `{ "ra": 269.45 | "17h57m48s", "dec": …, "size_arcmin": 1–15 (default 3), "detectors": ["all"], "products": ["broadband", "per_detector"], "collections": [...] }`

---

## 5. Configuration

All settings are environment variables (also read from `api/.env`).

| Variable | Default | Meaning |
|---|---|---|
| `COLLECTIONS` | `spherex_dr1,spherex_qr3` | SPHEREx collections searched |
| `PIXEL_SOURCE` | `s3` | `s3` (byte ranges) or `cutout` (IRSA cutout service) |
| `S3_PREFETCH` | `true` | Three parallel prefetch rounds per exposure |
| `PIPELINE_VERSION` | `2` | Part of every cache key; bump to invalidate |
| `CACHE_DIR` | `./data` (`/data` in Docker) | Disk cache and `argus.db`. **Must be the volume mount on Railway** |
| `CACHE_MAX_GB` | `4.0` | Disk cache budget |
| `RAM_CACHE_MB` | `64` | In-memory cache |
| `MAX_CONCURRENT_FETCH` | `24` | Parallel archive requests |
| `MAX_RUNNING_JOBS` / `MAX_QUEUED_JOBS` | `2` / `20` | Job queue |
| `MAX_EXPOSURES_PER_JOB` | `120` | Exposures in a live build |
| `JOB_TIMEOUT_S` / `JOB_MAX_S` | `600` / `3600` | Stall timeout / hard limit |
| `ABANDON_GRACE_S` | `30` | Cancel a job this long after its last viewer leaves |
| `RSS_LIMIT_MB` | `1500` | Memory guard |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | CORS for local development |
| `ADMIN_TOKEN` | empty | Unlocks `/admin`; keep it secret |
| `WEB_DIR` | unset (`/srv/web` in Docker) | Built site served by the API |
| `PORT` | `8000` (Railway sets 8080) | Listen port |

**Build arguments** (Dockerfile) are for privacy-friendly analytics; leave them empty to disable:
- `VITE_UMAMI_WEBSITE_ID`
- `VITE_SITE_DOMAIN`

**Railway:**
- A volume mounted at **`/data`** keeps the counters, contact messages and cache across deploys.
- Set `RAILWAY_RUN_UID=0` so the app can write to it.
- Do **not** set `CACHE_DIR` to anything else.

---

## 6. Running, testing, deploying

```bash
# backend (Python 3.12, uv)
cd api && uv sync && uv run uvicorn argus.main:app --port 8000
# frontend
cd web && npm install && npm run dev            # http://localhost:5173 (proxies /api to :8000)

# tests
cd api && uv run pytest                          # add -m network for live archive checks
cd web && npx vitest run && npx tsc --noEmit && npm run build
```

### Scripts in `api/scripts/`
| Script | What it does |
|---|---|
| `bench_fetch.py` | Benchmark the archive reader or a full job |
| `validate_motion.py` | The Gaia motion check, offline |
| `precompute_presets.py`, `presets_from_api.py` | Build the static presets |
| `refresh.py` | Rebuild after a new data release |

**Deploy:** push to `main`. Railway builds the root `Dockerfile`: node builds the site, then a Python image serves the API and the site. Health check: `/api/health`.

---

## 7. Limitations and roadmap

**Limitations:**
- **Pixel size:** pixels are 6.15″, so only fast movers (nearby stars, brown dwarfs) shift visibly in a year.
- **Saturation:** bright stars saturate, giving lower limits only.
- **Asteroids:** they cross a field in hours while a visit stacks several days, so they do not survive in visit stacks. We tested this on (511) Davida.
- **Finder:**
  - It uses centroids and apertures, with no PSF fitting.
  - Its background is a local annulus.
  - Parallax is rarely constrained, and no period search is possible with 3–5 visits.
- **Planet X:** the overlay teaches the parallax method. A Planet Nine would be far fainter than a single SPHEREx visit reaches.

**Roadmap:**
- An exposure-level view with known asteroids marked (IMCCE SkyBoT).
- PSF fitting.
- Letting users flag finds for others to check.
- More visits as SPHEREx continues its survey.

---

## 8. Credits, licences, AI use

**Data:**
- SPHEREx data from the NASA/IPAC Infrared Science Archive: DR1 doi:10.26131/IRSA678, QR3 doi:10.26131/IRSA662.
- Gaia DR3 (ESA/Gaia/DPAC).

**Sky maps:** Aladin Lite (CDS, Strasbourg).

**Inspiration:** WiseView inspired the blink controls.

**Privacy:**
- Umami analytics, with no cookies and no personal data.
- Anonymous counters.
- Contact messages are stored only to reply.

**AI use:** an AI coding assistant (Claude, by Anthropic) helped write code and documents. The team came up with the idea and designs, and reviewed, tested and decided everything. All scientific data come from the archives credited above; nothing in the data is AI-generated.
