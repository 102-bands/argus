// "About Argus", written as a short paper: what it does, how, how we checked it, and its limits.
import { SiteLayout } from "./SiteLayout";

interface Props {
  navigate: (path: string) => void;
}

function Fig({ src, n, alt, children }: { src: string; n: number; alt: string; children: React.ReactNode }) {
  return (
    <figure className="pfig">
      <img src={src} alt={alt} loading="lazy" />
      <figcaption><b>Figure {n}.</b> {children}</figcaption>
    </figure>
  );
}

export function Paper({ navigate }: Props) {
  return (
    <SiteLayout page="about" navigate={navigate}>
      <main id="main" className="paper-wrap">
        <article className="paper">
          <header className="p-head">
            <p className="p-venue">NASA International Space Apps Challenge 2026 · Challenge: Planet X and SPHEREx</p>
            <h1>Argus: a public blink comparator for NASA SPHEREx all-sky infrared images</h1>
            <p className="p-authors">Umair Zia and Aliki Vidouri <span>· Team 102 Bands</span></p>
            <p className="p-date">November 2026 · <a href="https://argus102.space">argus102.space</a> · <a href="https://github.com/102-bands/argus">github.com/102-bands/argus</a></p>
          </header>

          <section className="abstract">
            <h2>Abstract</h2>
            <p>
              Since 2025 NASA's SPHEREx telescope has imaged the entire sky every six months in 102 infrared colours
              between 0.75 and 5 µm. Comparing those visits shows what moves and what changes, but the data are far too
              large for people to search by hand. Argus is a free web tool that turns the SPHEREx images of any patch
              of sky into an aligned flipbook in about twenty seconds: blink between visits, subtract them to see what
              changed, and read the brightness and spectrum of the source at the centre. Every visible motion is
              checked against the ESA Gaia catalogue. For our five test targets the measured positions agree with
              Gaia to within half a SPHEREx pixel (≤ 2.5″). We also show, honestly, how a search for a distant
              "Planet X" would work and why a single SPHEREx visit could not detect one.
            </p>
          </section>

          <section>
            <h2>1. Introduction</h2>
            <p>
              Things that move against the background stars reveal themselves when two pictures of the same sky taken
              at different times are flipped back and forth: the method Clyde Tombaugh used to find Pluto in 1930,
              and the one thousands of volunteers use today in projects such as Backyard Worlds: Planet 9. SPHEREx
              makes this possible across the whole infrared sky, but its public data are tens of thousands of
              separate, rotated, 65 MB exposures in an archive built for scientists.
            </p>
            <p>
              The 2026 Space Apps challenge asks for “a public-facing web tool to display images of the sky from
              SPHEREx, making it easy for anyone to quickly see how they change over time.” Argus is our answer:
              type a position or a star's name, and within seconds you are watching the sky change.
            </p>
          </section>

          <section>
            <h2>2. Data</h2>
            <p>
              We use the SPHEREx Level-2 calibrated images from the NASA/IPAC Infrared Science Archive (IRSA), Data
              Release 1 and Quick Release 3 (collections <code>spherex_dr1</code> and <code>spherex_qr3</code>). Each
              exposure has six layers we use: the image in MJy/sr, its variance, a bit-mask of pixel flags, and a model
              of the zodiacal light. SPHEREx has six detectors, D1 (0.75 µm) to D6 (5 µm), each covering 3.5° × 3.5°
              with 6.15″ pixels; a linear variable filter means every pixel row sees a slightly different wavelength,
              which is how 102 colours come from six detectors. Most of the sky has been visited about three times by
              November 2026.
            </p>
            <p>
              Star positions and motions come from Gaia Data Release 3 (ESA), queried by cone search and moved to the
              date of each image with its proper motion.
            </p>
          </section>

          <section>
            <h2>3. Method</h2>
            <h3>3.1 Finding the images</h3>
            <p>
              Argus queries IRSA's image-search service (SIA2) for every exposure covering the position, then groups
              exposures into <em>visits</em>: runs separated by more than 20 days. A live search keeps up to 120
              exposures spread evenly over the visits; precomputed targets keep them all.
            </p>
            <h3>3.2 Reading only the pixels we need</h3>
            <p>
              Instead of downloading 65 MB files, Argus reads small byte ranges from the open copy of the archive on
              Amazon S3. A naive reader made about 190 small requests per exposure, one after another. Our prefetching
              reader works out where each layer's rows sit in the file and fetches everything in three parallel
              rounds (ten requests), while astropy still parses the data, so a wrong guess costs one extra request,
              never a wrong pixel. Over a slow connection this cut six exposures from 126 s to 28 s with identical
              arrays; on our server a whole live search of 120 exposures takes 15–25 s.
            </p>
            <h3>3.3 Cleaning and aligning</h3>
            <p>
              For each exposure we subtract the zodiacal-light model, <span className="eq">I′ = IMAGE − ZODI</span>,
              and mask pixels flagged as bad. The mask has two tiers: hard flags (hot pixels, cosmic rays, missing
              data) always, softer flags only where no real source is present, so saturated star cores stay visible
              and are marked instead. Each exposure is reprojected onto one common tangent-plane grid centred on the
              target (6.15″ pixels, north up, east left), and the exposures of a visit are combined with
              inverse-variance weights, <span className="eq">S = Σ wᵢ Iᵢ / Σ wᵢ</span> with <span className="eq">wᵢ = 1/σᵢ²</span>,
              per detector and for all detectors together.
            </p>
            <h3>3.4 Showing change</h3>
            <p>
              Frames are sent to the browser as 16-bit floats with a flag layer and decoded off the main thread. All
              visits share one brightness scale (asinh by default), so brightness never flickers for no reason. In
              difference mode each frame's sky level is removed and the reference visit subtracted: cyan is brighter
              now, magenta brighter before, and a moving star becomes a magenta-to-cyan pair (Figure 1).
            </p>
            <h3>3.5 Brightness and spectrum</h3>
            <p>
              The source at the centre is measured on every exposure by aperture photometry, re-centred within three
              pixels, in microjanskys. Because each exposure sees the source through a different part of the filter,
              one visit samples the whole 0.75–5 µm range, giving a low-resolution spectrum (Figure 2). Saturated
              measurements are drawn hollow and are lower limits.
            </p>
            <Fig src="/site/fig-dashboard.png" n={1} alt="The Argus dashboard showing Barnard's Star in difference mode with Gaia overlays.">
              The Argus dashboard on Barnard's Star in difference mode: controls on the left, the visits as a strip
              above the image, Gaia predictions as circles and arrows, and the measured position check on the right.
            </Fig>
            <Fig src="/site/fig-plots.png" n={2} alt="Light curve and spectrum charts with labelled log-scale axes.">
              The Plots view: brightness on every exposure over time (left) and against wavelength for one visit
              (right), both on logarithmic brightness scales.
            </Fig>
          </section>

          <section id="validation">
            <h2>4. Validation against Gaia</h2>
            <p>
              A blink tool is only useful if what moves is real. For each target we predict its position on every
              visit from Gaia DR3 and its proper motion, then measure the flux-weighted centre of light in a small box
              around the prediction after removing the sky level. Visits stacked from fewer than five exposures are
              too noisy to judge and are listed but not counted. A target passes if every counted visit agrees to
              within half a pixel (3.1″). The same check runs live in the tool for every target (Figure 3).
            </p>
            <table className="p-table">
              <caption>Table 1. Measured position minus Gaia prediction, worst counted visit.</caption>
              <thead><tr><th>Target</th><th>Field, band</th><th>Visits</th><th>Predicted motion</th><th>Worst offset</th></tr></thead>
              <tbody>
                <tr><td>Barnard's Star</td><td>8′, all</td><td>5</td><td>11.2″</td><td>2.5″ (0.41 px)</td></tr>
                <tr><td>ε Indi B</td><td>8′, all</td><td>4</td><td>6.5″</td><td>0.9″ (0.15 px)</td></tr>
                <tr><td>WISE 0855−0714</td><td>3′, D6</td><td>2</td><td>8.0″</td><td>2.2″ (0.35 px)</td></tr>
                <tr><td>RW Aur</td><td>8′, all</td><td>3</td><td>none expected</td><td>1.2″ (0.19 px)</td></tr>
                <tr><td>R Dra</td><td>8′, all</td><td>3</td><td>none expected</td><td>2.3″ (0.38 px)</td></tr>
              </tbody>
            </table>
            <p>
              The browser check reproduces our offline script (<code>scripts/validate_motion.py</code>) to within
              0.01 px on the same data. WISE 0855−0714, the coldest known brown dwarf, is invisible below about 3.5 µm
              and is measured in detector D6 only.
            </p>
            <Fig src="/site/fig-gaia.png" n={3} alt="The Checked against Gaia panel reading Matches Gaia, worst 2.5 arcseconds.">
              The live check for Barnard's Star.
            </Fig>
          </section>

          <section>
            <h2>5. The Planet X question</h2>
            <p>
              Planet X, often called Planet Nine, is a hypothetical planet several hundred astronomical units from the
              Sun, proposed to explain the clustered orbits of some distant objects; it has not been found. Such a
              planet barely moves on its own, but Earth does: between two visits the apparent jump is about
              <span className="eq"> Δθ ≈ 206 265″ × |Δr⊕,⊥| / d</span>, where |Δr⊕,⊥| is the change in Earth's position
              across the line of sight (up to 2 AU over six months) and d the planet's distance. At 500 AU that is
              about 14′, well outside one field (Figure 4). Argus draws this track for any distance from 200 to
              3000 AU using a low-precision solar ephemeris.
            </p>
            <p>
              We state the limit plainly: models put such a planet near 22.8 AB magnitudes, about three magnitudes
              fainter than one SPHEREx visit reaches (~19.5). The overlay teaches the method; it is not a detection.
            </p>
            <Fig src="/site/fig-planetx.png" n={4} alt="The Planet X overlay: a magenta track leaving the field, labelled 13.2 arcminutes.">
              How far a planet at 500 AU, sitting at the field centre on the first visit, would appear to jump by a
              later visit.
            </Fig>
          </section>

          <section>
            <h2>6. Using Argus</h2>
            <ul>
              <li><b>Blink, diff and stack</b> show the visits one by one, their differences, or all of them combined.</li>
              <li><b>Bands</b> D1–D6 isolate one wavelength range; the cold brown dwarf WISE 0855 appears only in D5–D6.</li>
              <li><b>Overlays</b>: Gaia predictions, pixel flags (saturation, bad data) and the Planet X track.</li>
              <li><b>Plots</b>: light curve and spectrum of the centre source, with labelled axes and scales.</li>
              <li><b>Sharing</b>: every view has a link; a page can embed the viewer; a PDF report and a GIF can be downloaded.</li>
              <li><b>A guided tour</b> explains every control the first time you open the tool.</li>
            </ul>
          </section>

          <section>
            <h2>7. Limitations and future work</h2>
            <p>
              SPHEREx pixels are large (6.15″), so only fast movers shift visibly in a year: nearby stars, brown
              dwarfs and Solar System objects. Bright stars saturate, so their brightness is a lower limit. Live
              searches use at most 120 exposures, which leaves some visits thin; the validation counts only visits
              with five or more.
            </p>
            <p>
              Asteroids are the most common movers, but they cross a small field in hours, while a visit stacks
              exposures from several days. We tested this with the asteroid (511) Davida: SPHEREx observed its
              position on four dates, yet it does not survive in the visit stack. The next step is an exposure-level
              view that shows single exposures and marks known asteroids from the IMCCE SkyBoT service, followed by a
              way for users to flag unexplained movers for others to check.
            </p>
          </section>

          <section>
            <h2>8. Acknowledgements and use of AI</h2>
            <p>
              This work makes use of data products from SPHEREx, a joint project of the Jet Propulsion Laboratory and
              the California Institute of Technology funded by NASA, and from the NASA/IPAC Infrared Science Archive.
              It has made use of data from the ESA mission Gaia, processed by the Gaia Data Processing and Analysis
              Consortium (DPAC). Sky maps use Aladin Lite (CDS, Strasbourg). WiseView inspired the blink controls.
            </p>
            <p>
              We used an AI coding assistant (Claude, by Anthropic) to help write code and documents. The team came up
              with the idea and designs, and reviewed, tested and decided everything. All scientific data come from
              the archives credited here; nothing in the data is AI-generated.
            </p>
            <p className="p-small">
              <b>Privacy.</b> Argus counts visits with Umami (no cookies, no personal data, Do Not Track respected) and
              keeps anonymous usage counters. The contact form stores the name, email and message you send, only to
              reply. Server logs keep the request path, status and duration, never IP addresses. Argus is not
              affiliated with or endorsed by NASA.
            </p>
          </section>

          <section className="refs">
            <h2>References</h2>
            <ol>
              <li>SPHEREx Science Team (2026). SPHEREx Data Release 1. NASA/IPAC IRSA. <a href="https://doi.org/10.26131/IRSA678">doi:10.26131/IRSA678</a></li>
              <li>SPHEREx Science Team (2026). SPHEREx Quick Release 3. NASA/IPAC IRSA. <a href="https://doi.org/10.26131/IRSA662">doi:10.26131/IRSA662</a></li>
              <li>Bock, J. et al. (2026). SPHEREx mission overview. ApJ 999, 139.</li>
              <li>Akeson, R. et al. (2026). SPHEREx data processing. ApJS 285, 67.</li>
              <li>Gaia Collaboration, Vallenari, A. et al. (2023). Gaia Data Release 3. A&amp;A 674, A1.</li>
              <li>Luhman, K. L. &amp; Esplin, T. L. (2016). The distance and motion of WISE 0855−0714. AJ 152, 78.</li>
              <li>Kuchner, M. J. et al. (2017). Backyard Worlds: Planet 9. ApJL 841, L19.</li>
              <li>Batygin, K. &amp; Brown, M. E. (2016). Evidence for a distant giant planet in the Solar System. AJ 151, 22.</li>
              <li>Boch, T. &amp; Fernique, P. (2014). Aladin Lite. ASP Conf. Ser. 485, 277.</li>
            </ol>
          </section>
        </article>
      </main>
    </SiteLayout>
  );
}
