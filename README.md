# Argus

**Type in a spot in the sky and watch it change.** Argus plays NASA SPHEREx infrared images of any patch of sky like a flipbook, so anything that moved or changed brightness stands out: asteroids, comets, nearby stars and brown dwarfs.

Team **102 Bands** (Umair Zia, team lead; Aliki Vidouri) built it for the **2026 NASA International Space Apps Challenge**, challenge *Planet X and SPHEREx*.

- Product spec: [`PRD.md`](PRD.md)
- Research notes and sources: [`docs/research-notes.md`](docs/research-notes.md)
- Logo kit: [`brand/`](brand/)

## Layout (planned)
```
app/
  api/     FastAPI backend (Python 3.12)
  web/     React + Vite + TypeScript frontend
  brand/   Argus logo kit
  docs/    research notes, decisions
  PRD.md
```

## Use of AI tools (Space Apps rule)
The rules ask teams to say where and how AI tools were used:
- **Code and documents:** we used an AI coding assistant (Claude, by Anthropic) to help write the code and documents, including this PRD. The team designs, reviews, tests and decides everything.
- **Media:** any AI-generated image or video in our demo carries a visible "AI-generated" watermark.
- **Data and results:** all scientific data comes from the archives credited below. Nothing is AI-generated.

## Data credits
- **SPHEREx:** NASA SPHEREx data from the NASA/IPAC Infrared Science Archive (IRSA). DR1 images doi:10.26131/IRSA678; QR3 doi:10.26131/IRSA662. Imagery courtesy NASA/JPL-Caltech.
- **Gaia:** data from the European Space Agency (ESA) mission Gaia, processed by the Gaia Data Processing and Analysis Consortium (DPAC). Gaia DR3; Gaia Collaboration, Vallenari et al. 2023.
- **Aladin Lite:** CDS, Strasbourg Astronomical Data Center.

Built for the 2026 NASA International Space Apps Challenge. Argus is not affiliated with or endorsed by NASA.
