export function About() {
  return (
    <main className="prose" id="main">
      <h1>About Argus</h1>
      <p>
        <strong>Type in a spot in the sky and watch it change.</strong> Argus plays NASA SPHEREx infrared images of any
        patch of sky like a flipbook, so anything that moved or changed brightness stands out: asteroids, comets,
        nearby stars and brown dwarfs.
      </p>
      <p>
        Team <strong>102 Bands</strong> (Umair Zia, team lead; Aliki Vidouri) built it for the 2026 NASA International
        Space Apps Challenge, challenge <em>Planet X and SPHEREx</em>.
      </p>

      <h2>How to read it</h2>
      <ul>
        <li><strong>Frames.</strong> SPHEREx photographs the whole sky every six months. Each frame is one visit to this spot, with every exposure from that visit stacked (inverse-variance weighted) so faint things show up.</li>
        <li><strong>Bands.</strong> SPHEREx sees 102 colours with six detectors: D1 (0.75 µm) to D6 (5 µm). Cold brown dwarfs such as WISE 0855 only appear in D5 and D6.</li>
        <li><strong>Blink.</strong> A star with high proper motion jumps between frames. Barnard's Star moves about 2.5 pixels north in 1.5 years.</li>
        <li><strong>Difference.</strong> Each frame minus a reference frame. Cyan (▲) is brighter now; magenta (▼) brighter before. A mover becomes a magenta/cyan pair.</li>
        <li><strong>Gaia.</strong> Cyan circles and arrows show where ESA's Gaia catalogue predicts each star should be on that date. If the image agrees, the motion is real.</li>
        <li><strong>Flags.</strong> Amber pixels were saturated in at least one exposure. Hatched pixels had no good data. Bright stars saturate, so their brightness is a lower limit.</li>
        <li><strong>Light curve.</strong> Brightness of the source at the centre in every exposure, coloured by detector. Hollow points are saturated.</li>
      </ul>
      <p>
        Argus helps people <em>see</em> the sky change. It does not announce discoveries. If you think you found
        something, check it against known objects first.
      </p>

      <h2>How it works</h2>
      <p>
        Argus asks the NASA/IPAC Infrared Science Archive which SPHEREx images cover your position, groups the
        exposures into visits, reads only the needed pixels from the open AWS copy of the archive, subtracts the
        zodiacal light, lines everything up on a common grid, and stacks each visit. Frames stream to your browser as
        they finish. The five test targets are precomputed so they load instantly, even if the archive is busy.
      </p>

      <h2>Data credits</h2>
      <ul>
        <li>
          <strong>SPHEREx.</strong> This publication makes use of data products from the Spectro-Photometer for the
          History of the Universe, Epoch of Reionization and Ices Explorer (SPHEREx), which is a joint project of the
          Jet Propulsion Laboratory and the California Institute of Technology, and is funded by the National
          Aeronautics and Space Administration. Data from the NASA/IPAC Infrared Science Archive (IRSA). DR1 images{" "}
          <a href="https://doi.org/10.26131/IRSA678">doi:10.26131/IRSA678</a>; QR3{" "}
          <a href="https://doi.org/10.26131/IRSA662">doi:10.26131/IRSA662</a>. Imagery courtesy NASA/JPL-Caltech.
          Bock et al. 2026, ApJ 999, 139; Akeson et al. 2026, ApJS 285, 67.
        </li>
        <li>
          <strong>Gaia.</strong> This work has made use of data from the European Space Agency (ESA) mission Gaia
          (<a href="https://www.cosmos.esa.int/gaia">cosmos.esa.int/gaia</a>), processed by the Gaia Data Processing
          and Analysis Consortium (DPAC). Gaia DR3: Gaia Collaboration, Vallenari et al. 2023, A&amp;A 674, A1.
          Licence CC BY-NC 3.0 IGO.
        </li>
        <li><strong>Aladin Lite</strong> and HiPS maps: CDS, Strasbourg Astronomical Data Center (GPL-3).</li>
        <li><strong>Software:</strong> Python, FastAPI, astropy, reproject, NumPy, React, Vite, TypeScript.</li>
        <li><strong>Inspiration:</strong> WiseView, the blink tool behind Backyard Worlds, for its URL parameters and keyboard style.</li>
        <li><strong>WISE 0855−0714 motion:</strong> Luhman &amp; Esplin 2016. <strong>R Dra ephemeris:</strong> AAVSO VSX.</li>
      </ul>

      <h2>Use of AI tools</h2>
      <p>
        We used an AI coding assistant (Claude, by Anthropic) to help write the code and documents. The team came up
        with the idea and designs, reviews, tests and decides everything. Any AI-generated image or video in our demo
        carries a visible “AI-generated” watermark. All scientific data comes from the archives credited above;
        nothing in the data is AI-generated.
      </p>

      <h2>Privacy</h2>
      <p>
        Argus counts visits and button clicks with Umami, which uses no cookies and collects no personal data. Do Not
        Track is respected. There are no accounts, uploads or cookies. Server logs keep only the request path, status
        and duration, never IP addresses.
      </p>

      <h2>Disclaimer</h2>
      <p>
        Built for the 2026 NASA International Space Apps Challenge. Not affiliated with or endorsed by NASA.
      </p>
      <p><a href="/">← Back to the explorer</a></p>
    </main>
  );
}
