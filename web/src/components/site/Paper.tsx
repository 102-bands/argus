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

/** A displayed equation with its number on the right. */
function Eq({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="peq" role="math">
      <span className="peq-body">{children}</span>
      <span className="peq-n">({n})</span>
    </div>
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
              changed, and read the brightness and spectrum of the source at the centre. Argus also finds every source
              in the field on its own, fits its motion across visits, tests its brightness for variability and its
              colour for brown-dwarf-like redness, and matches it to the ESA Gaia catalogue, so unexplained objects
              stand out. For our five test targets the measured positions agree with Gaia to within half a SPHEREx
              pixel (≤ 2.5″); the finder recovers the proper motions of Barnard's Star and ε Indi B within 1σ of Gaia,
              flags the coldest known brown dwarf as a red mover absent from Gaia, and raises no false movers in five
              8′ fields. We also show, honestly, how a search for a distant "Planet X" would work and why a single
              SPHEREx visit could not detect one.
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
            <h3>3.1 Positions and the common grid</h3>
            <p>
              Positions may be typed in decimal degrees or sexagesimal form. A value written <var>a</var>° <var>b</var>′{" "}
              <var>c</var>″ (or <var>a</var>h <var>b</var>m <var>c</var>s for right ascension) becomes
            </p>
            <Eq n={1}><var>θ</var> = ±(<var>a</var> + <var>b</var>/60 + <var>c</var>/3600), &nbsp; <var>α</var><sub>deg</sub> = 15 <var>α</var><sub>h</sub>,</Eq>
            <p>
              with the sign taken from the leading character. Every image is resampled onto one gnomonic (TAN) tangent
              plane centred on the field (<var>α</var><sub>0</sub>, <var>δ</var><sub>0</sub>), with standard coordinates
            </p>
            <Eq n={2}><var>ξ</var> = cos <var>δ</var> sin(<var>α</var> − <var>α</var><sub>0</sub>) / cos <var>c</var>, &nbsp;
              <var>η</var> = [cos <var>δ</var><sub>0</sub> sin <var>δ</var> − sin <var>δ</var><sub>0</sub> cos <var>δ</var> cos(<var>α</var> − <var>α</var><sub>0</sub>)] / cos <var>c</var>,</Eq>
            <Eq n={3}>cos <var>c</var> = sin <var>δ</var><sub>0</sub> sin <var>δ</var> + cos <var>δ</var><sub>0</sub> cos <var>δ</var> cos(<var>α</var> − <var>α</var><sub>0</sub>),</Eq>
            <p>
              and pixel (<var>x</var>, <var>y</var>) = (<var>x</var><sub>0</sub> + <var>ξ</var>/Δ<sub><var>x</var></sub>, <var>y</var><sub>0</sub> + <var>η</var>/Δ<sub><var>y</var></sub>)
              with |Δ| = 6.15″, north up and east left (Δ<sub><var>x</var></sub> &lt; 0). A field of <var>s</var> arcminutes
              is <var>N</var> = max(5, round(60 <var>s</var> / 6.15)) pixels on a side.
            </p>

            <h3>3.2 Finding and reading the images</h3>
            <p>
              Argus queries IRSA's image-search service (SIA2) for every exposure covering the position and groups
              exposures into <em>visits</em>, runs separated by more than 20 days. A live search keeps up to 120
              exposures spread evenly over the visits; precomputed targets keep them all. Instead of downloading 65 MB
              files, Argus reads small byte ranges from the open copy of the archive on Amazon S3: a prefetching reader
              works out where each layer's rows sit and fetches them in three parallel rounds (ten requests instead of
              about 190 sequential ones), while astropy still parses the data, so a wrong guess costs one extra request,
              never a wrong pixel. A live search of 120 exposures takes 15–25 s on our server.
            </p>

            <h3>3.3 Calibration and stacking</h3>
            <p>For each exposure we subtract the zodiacal-light model supplied with the image,</p>
            <Eq n={4}><var>I</var>′ = <var>I</var> − <var>Z</var>,</Eq>
            <p>
              and mask bad pixels in two tiers: hard flags (hot pixels, cosmic rays, missing data) always, softer flags
              only where no real source is present, so saturated cores stay visible and are marked. The exposures of a
              visit are reprojected to the grid and combined with inverse-variance weights,
            </p>
            <Eq n={5}><var>S</var> = Σ<sub><var>i</var></sub> <var>w</var><sub><var>i</var></sub> <var>I</var>′<sub><var>i</var></sub> / Σ<sub><var>i</var></sub> <var>w</var><sub><var>i</var></sub>, &nbsp;
              <var>w</var><sub><var>i</var></sub> = 1/<var>σ</var><sub><var>i</var></sub><sup>2</sup>, &nbsp;
              <var>σ</var><sub><var>S</var></sub> = (Σ<sub><var>i</var></sub> <var>w</var><sub><var>i</var></sub>)<sup>−1/2</sup>,</Eq>
            <p>
              per detector and for all detectors together. Frames reach the browser as 16-bit floats with a flag layer,
              and all visits share one brightness scale (asinh by default). Difference images subtract a reference
              visit after removing each frame's median sky <var>B</var>,
            </p>
            <Eq n={6}><var>D</var><sub><var>t</var></sub> = (<var>S</var><sub><var>t</var></sub> − <var>B</var><sub><var>t</var></sub>) − (<var>S</var><sub>ref</sub> − <var>B</var><sub>ref</sub>),</Eq>
            <p>
              drawn cyan where <var>D</var> &gt; 0 (brighter now) and magenta where <var>D</var> &lt; 0 (brighter before),
              so a moving star becomes a magenta-to-cyan pair (Figure 1).
            </p>

            <h3>3.4 Photometry</h3>
            <p>
              One pixel subtends <var>Ω</var><sub>pix</sub> = (6.15″ / 206 265″)<sup>2</sup> = 8.89 × 10<sup>−10</sup> sr, so a
              surface brightness of 1 MJy sr<sup>−1</sup> in one pixel carries 8.89 × 10<sup>−4</sup> Jy = 889 µJy. The flux in
              an aperture of radius 2 px, with the background <var>B</var> taken as the median of an annulus from 4 to 7 px, is
            </p>
            <Eq n={7}><var>F</var> = <var>C</var> Σ<sub><var>r</var> ≤ 2</sub> (<var>I</var><sub><var>p</var></sub> − <var>B</var>), &nbsp;
              <var>C</var> = <var>Ω</var><sub>pix</sub> × 10<sup>12</sup> ≈ 889 µJy per MJy sr<sup>−1</sup>,</Eq>
            <Eq n={8}><var>σ</var><sub><var>F</var></sub> = <var>C</var> (Σ<sub><var>p</var></sub> <var>σ</var><sub><var>p</var></sub><sup>2</sup>)<sup>1/2</sup> (server), &nbsp;
              <var>σ</var><sub><var>F</var></sub> = <var>C</var> <var>σ</var><sub>ann</sub> [<var>N</var><sub>ap</sub>(1 + <var>N</var><sub>ap</sub>/<var>N</var><sub>ann</sub>)]<sup>1/2</sup> (browser),</Eq>
            <p>
              where <var>σ</var><sub><var>p</var></sub><sup>2</sup> is the pipeline variance of each pixel, <var>σ</var><sub>ann</sub> =
              IQR/1.349 is a robust standard deviation of the annulus, and the second term carries the uncertainty of
              <var> B</var>. Magnitudes are on the AB system,
            </p>
            <Eq n={9}><var>m</var><sub>AB</sub> = 23.9 − 2.5 log<sub>10</sub>(<var>F</var> / µJy).</Eq>
            <p>
              Because the linear variable filter gives every exposure its own wavelength, one visit samples the whole
              0.75–5 µm range, giving a low-resolution spectrum (Figure 2). Saturated measurements are drawn hollow and are
              lower limits. For the Mira variable R Dra the light curve can be folded on its period,
            </p>
            <Eq n={10}><var>φ</var> = [(JD − JD<sub>0</sub>) / <var>P</var>] mod 1, &nbsp; <var>P</var> = 246.12 d, &nbsp; JD<sub>0</sub> = 2 457 370.</Eq>

            <h3>3.5 Proper motion and position measurement</h3>
            <p>
              A catalogue star with proper motion (<var>μ</var><sub><var>α</var>*</sub>, <var>μ</var><sub><var>δ</var></sub>) in mas yr<sup>−1</sup>,
              where <var>μ</var><sub><var>α</var>*</sub> = <var>μ</var><sub><var>α</var></sub> cos <var>δ</var>, is moved from the Gaia epoch
              (2016.0) to a date Δ<var>t</var> years later by
            </p>
            <Eq n={11}><var>δ</var>′ = <var>δ</var> + <var>μ</var><sub><var>δ</var></sub> Δ<var>t</var> / (3.6 × 10<sup>6</sup>), &nbsp;
              <var>α</var>′ = <var>α</var> + <var>μ</var><sub><var>α</var>*</sub> Δ<var>t</var> / (3.6 × 10<sup>6</sup> cos <var>δ</var><sub>m</sub>),</Eq>
            <p>
              with <var>δ</var><sub>m</sub> the mean of <var>δ</var> and <var>δ</var>′ and 3.6 × 10<sup>6</sup> converting mas to degrees. A
              measured position is the background-subtracted, flux-weighted centroid in a small box,
            </p>
            <Eq n={12}><var>x</var><sub>c</sub> = Σ<sub><var>p</var></sub> <var>w</var><sub><var>p</var></sub> <var>x</var><sub><var>p</var></sub> / Σ<sub><var>p</var></sub> <var>w</var><sub><var>p</var></sub>, &nbsp;
              <var>w</var><sub><var>p</var></sub> = max(<var>I</var><sub><var>p</var></sub> − <var>B</var>, 0),</Eq>
            <p>
              and likewise for <var>y</var><sub>c</sub>, with SNR = max<sub><var>p</var></sub>(<var>I</var><sub><var>p</var></sub> − <var>B</var>)/<var>σ</var> for the
              frame's robust standard deviation <var>σ</var>. For a point source of width <var>σ</var><sub>psf</sub> ≈ 1 px the
              centroid error is
            </p>
            <Eq n={13}><var>σ</var><sub><var>x</var></sub> = <var>σ</var><sub><var>y</var></sub> ≈ <var>k</var> · max(<var>σ</var><sub>psf</sub> / SNR, 0.1 px),</Eq>
            <p>
              where the floor covers reprojection systematics and the scale <var>k</var> ≥ 1 is set from the data
              (Section 3.6). The offset between a measured and a predicted position is (Δ<var>x</var><sup>2</sup> + Δ<var>y</var><sup>2</sup>)<sup>1/2</sup>.
            </p>

            <h3>3.6 Finding candidates automatically</h3>
            <p>
              <b>Detection.</b> The visit images are averaged with weights equal to their exposure counts, the median is
              subtracted, and every local maximum at least 5<var>σ</var> above it (<var>σ</var> = IQR/1.349), 3 px from the
              edge and 2.5 px from a brighter peak, is a source; the 40 brightest are kept. The same is done on the mean
              of detectors D5 and D6 alone, because the coldest brown dwarfs are invisible in the combined image; a source
              found only there is itself evidence of a very red colour.
            </p>
            <p>
              <b>Astrometry.</b> Each source is centroided (eq. 12) on every visit with at least five exposures, the box
              re-centred on the previous visit so a mover is followed; <var>t</var><sub>m</sub> below is the weighted mean epoch. The shift shared by the whole field on each visit,
              the median residual of all sources, is subtracted (differential astrometry), which removes alignment jitter
              between visits. In tangent-plane offsets (<var>ξ</var><sub><var>i</var></sub>, <var>η</var><sub><var>i</var></sub>) at times
              <var> t</var><sub><var>i</var></sub>, each axis is fitted by weighted least squares,
            </p>
            <Eq n={14}><var>ξ</var>(<var>t</var>) = <var>ξ</var><sub>0</sub> + <var>μ</var><sub><var>α</var>*</sub> (<var>t</var> − <var>t</var><sub>m</sub>), &nbsp;
              <var>η</var>(<var>t</var>) = <var>η</var><sub>0</sub> + <var>μ</var><sub><var>δ</var></sub> (<var>t</var> − <var>t</var><sub>m</sub>), &nbsp;
              <var>w</var><sub><var>i</var></sub> = 1/<var>σ</var><sub><var>i</var></sub><sup>2</sup>,</Eq>
            <Eq n={15}><var>σ</var><sub><var>μ</var></sub> = [Σ<sub><var>i</var></sub> <var>w</var><sub><var>i</var></sub> (<var>t</var><sub><var>i</var></sub> − <var>t</var><sub>m</sub>)<sup>2</sup>]<sup>−1/2</sup>, &nbsp;
              <var>t</var><sub>m</sub> = Σ<sub><var>i</var></sub> <var>w</var><sub><var>i</var></sub> <var>t</var><sub><var>i</var></sub> / Σ<sub><var>i</var></sub> <var>w</var><sub><var>i</var></sub>.</Eq>
            <p>The evidence for motion is a score that compares the moving model with a fixed one,</p>
            <Eq n={16}><var>S</var> = (<var>χ</var><sup>2</sup><sub>fixed</sub> − <var>χ</var><sup>2</sup><sub>moving</sub>)<sup>1/2</sup>,</Eq>
            <p>
              and the position angle is PA = atan2(<var>μ</var><sub><var>α</var>*</sub>, <var>μ</var><sub><var>δ</var></sub>), east of north.
              Δ<var>χ</var><sup>2</sup> has two degrees of freedom (one per axis), so <var>S</var> is a score, not a Gaussian
              significance: <var>S</var> = 5 corresponds to <var>p</var> ≈ 4 × 10<sup>−6</sup> under the fixed model. Most
              sources do not move, so their fixed-model <var>χ</var><sup>2</sup> per degree of freedom should be about one;
              its median over the field sets <var>k</var><sup>2</sup> in eq. (13), so a field with larger systematics does
              not produce false movers. A source is <b>moving</b> if <var>S</var> ≥ 5, its displacement over the span is at
              least 0.5 px (3.1″) and the straight line fits (<var>χ</var><sup>2</sup><sub>ν</sub> ≤ 4; with three visits this test
              has only two degrees of freedom and catches only gross jumps). A saturated core or a
              neighbour within 3 px can drag a centroid, so such sources count as moving only when Gaia confirms the
              motion, and a Gaia star whose catalogued motion differs from ours by more than 3<var>σ</var> is reported as a
              measurement artefact, not a mover.
            </p>
            <p>With five or more visits Argus also fits a parallax <var>ϖ</var> shared by both axes,</p>
            <Eq n={17}><var>ξ</var>(<var>t</var>) = <var>ξ</var><sub>0</sub> + <var>μ</var><sub><var>α</var>*</sub>(<var>t</var> − <var>t</var><sub>m</sub>) + <var>ϖ</var> <var>f</var><sub><var>α</var></sub>(<var>t</var>), &nbsp;
              <var>η</var>(<var>t</var>) = <var>η</var><sub>0</sub> + <var>μ</var><sub><var>δ</var></sub>(<var>t</var> − <var>t</var><sub>m</sub>) + <var>ϖ</var> <var>f</var><sub><var>δ</var></sub>(<var>t</var>),</Eq>
            <Eq n={18}><var>f</var><sub><var>α</var></sub> = <var>X</var> sin <var>α</var> − <var>Y</var> cos <var>α</var>, &nbsp;
              <var>f</var><sub><var>δ</var></sub> = <var>X</var> cos <var>α</var> sin <var>δ</var> + <var>Y</var> sin <var>α</var> sin <var>δ</var> − <var>Z</var> cos <var>δ</var>,</Eq>
            <p>
              where (<var>X</var>, <var>Y</var>, <var>Z</var>) is Earth's heliocentric position in AU from a low-precision solar
              ephemeris, good to 0.01°. The estimate is shown only when <var>ϖ</var>/<var>σ</var><sub><var>ϖ</var></sub> ≥ 3: with
              visits about six months apart, parallax and proper motion are strongly correlated.
            </p>
            <p>
              <b>Photometry and variability.</b> Each source is measured with eq. (7) on every visit in every detector.
              A zero point per detector and visit, the median of <var>F</var>/⟨<var>F</var>⟩ over well-measured sources, is
              divided out (ensemble differential photometry), and each detector's errors are scaled by the median
              <var> χ</var><sup>2</sup><sub>ν</sub> of all its sources. For a detector with <var>N</var> visits,
            </p>
            <Eq n={19}><var>χ</var><sup>2</sup><sub>ν</sub> = Σ<sub><var>i</var></sub> (<var>F</var><sub><var>i</var></sub> − ⟨<var>F</var>⟩)<sup>2</sup> / <var>σ</var><sub><var>i</var></sub><sup>2</sup> / (<var>N</var> − 1), &nbsp;
              ⟨<var>F</var>⟩ = Σ<sub><var>i</var></sub> (<var>F</var><sub><var>i</var></sub>/<var>σ</var><sub><var>i</var></sub><sup>2</sup>) / Σ<sub><var>i</var></sub> (1/<var>σ</var><sub><var>i</var></sub><sup>2</sup>).</Eq>
            <p>
              A source is <b>variable</b> if <var>χ</var><sup>2</sup><sub>ν</sub> ≥ 5 and its peak-to-peak change is at least 15 %
              in two or more detectors that agree on which visit was brightest. The two-detector rule matters for
              SPHEREx: the filter puts a source at a different wavelength on each visit, so its spectrum alone can make
              one detector's measurements disagree.
            </p>
            <p>
              <b>Colour and Gaia.</b> The colour <var>m</var><sub>D1</sub> − <var>m</var><sub>D6</sub> (eq. 9; 0.75–1.1 µm minus
              4.4–5 µm) is negative for ordinary stars, whose light falls off toward long wavelengths. A source is
              <b> very red</b> if this colour is at least 2.5 mag, or if it is seen in D5–D6 but not above 3<var>σ</var> in
              D1–D2. Each Gaia DR3 star, moved to the mean epoch with eq. (11), is assigned to the nearest source within
              1.5 px (9″), one to one, so a faint neighbour of a catalogued star is not mistaken for it. A mover, or a red
              or variable source, with no Gaia counterpart is marked <b>needs follow-up</b>. When the Gaia query returns
              its 2000-row limit, absence from Gaia is not claimed.
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
              <caption>Table 1. Measured position minus Gaia prediction, worst counted visit. Visits: those with five or more exposures in that band.</caption>
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
            <p>
              Table 2 shows what the automatic finder (Section 3.6) reports for the same targets on the precomputed 3′
              fields. The finder never sees the target list, but its thresholds were chosen while developing on these
              fields, so the table shows its behaviour rather than an independent test.
            </p>
            <table className="p-table">
              <caption>Table 2. The automatic finder against Gaia DR3 (WISE 0855: Luhman &amp; Esplin 2016).</caption>
              <thead><tr><th>Target</th><th>Finder (motion score <var>S</var>)</th><th>Measured motion</th><th>Reference</th></tr></thead>
              <tbody>
                <tr><td>Barnard's Star</td><td>moving, <var>S</var> = 14.8</td><td>11.0 ± 0.7″/yr, PA 356°</td><td>10.4″/yr, PA 356°</td></tr>
                <tr><td>ε Indi B</td><td>moving, very red, <var>S</var> = 8.3</td><td>4.8 ± 0.6″/yr, PA 116°</td><td>4.7″/yr, PA 122°</td></tr>
                <tr><td>WISE 0855−0714</td><td>moving, very red, not in Gaia, <var>S</var> = 5.0</td><td>4.4 ± 0.9″/yr, PA 276°</td><td>8.1″/yr, PA 275°</td></tr>
                <tr><td>RW Aur</td><td>variable in D1–D3, D5, D6</td><td>none (<var>S</var> = 0.4)</td><td>known variable</td></tr>
                <tr><td>R Dra</td><td>not measurable: saturated</td><td>–</td><td>known Mira variable</td></tr>
              </tbody>
            </table>
            <p>
              Barnard's Star and ε Indi B agree with Gaia within their 1<var>σ</var> errors. WISE 0855−0714 is found as a
              red mover that Gaia cannot see, in the right direction, but its speed is underestimated: a background star
              about 6″ away pulls the centroid. Its quoted error of 0.9″/yr is therefore too small; the true motion lies
              about 4<var>σ</var> away, because eq. (13) does not model blending. The finder measures it on four visits of
              the summed D5 + D6 image, while Table 1 counts only the two D6 visits with five or more exposures. R Dra
              saturates every detector, so no honest flux can be measured. On the five 8′ fields (up to 40 sources each) the finder reports no false movers; at
              that size WISE 0855's D5–D6 visits have only 3–8 exposures and it is not recovered.
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
              planet barely moves on its own, but Earth does. If it lies at distance <var>d</var> in direction <var>û</var>
              from Earth's position <b>r</b><sub>⊕</sub>(<var>t</var><sub>1</sub>), it sits at <b>P</b> = <b>r</b><sub>⊕</sub>(<var>t</var><sub>1</sub>) + <var>d</var> <var>û</var>,
              and on a later visit it is seen along
            </p>
            <Eq n={20}><b>v</b> = <b>P</b> − <b>r</b><sub>⊕</sub>(<var>t</var><sub>2</sub>) = <var>d</var> <var>û</var> + <b>r</b><sub>⊕</sub>(<var>t</var><sub>1</sub>) − <b>r</b><sub>⊕</sub>(<var>t</var><sub>2</sub>),</Eq>
            <p>which Argus converts back to right ascension and declination exactly. For <var>d</var> ≫ 1 AU the jump is</p>
            <Eq n={21}>Δ<var>θ</var> ≈ |Δ<b>r</b><sub>⊕,⊥</sub>| / <var>d</var> rad = 206 265″ × |Δ<b>r</b><sub>⊕,⊥</sub>| / <var>d</var>,</Eq>
            <p>
              where |Δ<b>r</b><sub>⊕,⊥</sub>| is the change in Earth's position across the line of sight, up to 2 AU over six
              months. At 500 AU that is 2/500 rad = 13.8′, well outside one 8′ field (Figure 4). Argus draws this track for
              any distance from 200 to 3000 AU.
            </p>
            <p>
              We state the limit plainly. Such a planet is predicted to be fainter than about V ≈ 21 (Batygin et al.
              2019), while SPHEREx's point-source depth is about 19 AB per spectral channel for the full survey
              (Doré et al. 2014), and a single visit is shallower still. The overlay teaches the method; it is not a
              detection.
            </p>
            <Fig src="/site/fig-planetx.png" n={4} alt="The Planet X overlay: a magenta track leaving the field, labelled 13.2 arcminutes.">
              How far a planet at 500 AU, sitting at the field centre on the first visit, would appear to jump by a
              later visit: 13.2′ for these two dates, against the 13.8′ maximum when Earth has moved a full 2 AU across
              the line of sight.
            </Fig>
          </section>

          <section>
            <h2>6. Using Argus</h2>
            <ul>
              <li><b>Blink, diff and stack</b> show the visits one by one, their differences, or all of them combined.</li>
              <li><b>Bands</b> D1–D6 isolate one wavelength range; the cold brown dwarf WISE 0855 appears only in D5–D6.</li>
              <li><b>Overlays</b>: Gaia predictions, pixel flags (saturation, bad data), the automatic finds and the Planet X track.</li>
              <li><b>Candidates</b>: every source in the field labelled moving, variable or very red, with its fitted motion, brightness trend and Gaia match.</li>
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
              The finder is deliberately simple and transparent. It uses centroids and aperture photometry rather than
              fitting a point-spread function, so close pairs and saturated stars are flagged rather than measured, and
              its local-annulus background does not model large-scale gradients or scattered light. With three to five
              visits about six months apart, parallax is rarely constrained and no period search is meaningful. A
              point-spread-function fit, a smooth two-dimensional background model and more visits as SPHEREx continues
              its survey would each sharpen it.
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
              <li>Doré, O. et al. (2014). Cosmology with the SPHEREx all-sky spectral survey. arXiv:1412.4872.</li>
              <li>Crill, B. P. et al. (2020). SPHEREx: NASA's near-infrared spectrophotometric all-sky survey. Proc. SPIE 11443, 114430I.</li>
              <li>Gaia Collaboration, Vallenari, A. et al. (2023). Gaia Data Release 3. A&amp;A 674, A1.</li>
              <li>Luhman, K. L. &amp; Esplin, T. L. (2016). The distance and motion of WISE 0855−0714. AJ 152, 78.</li>
              <li>Kuchner, M. J. et al. (2017). Backyard Worlds: Planet 9. ApJL 841, L19.</li>
              <li>Batygin, K. &amp; Brown, M. E. (2016). Evidence for a distant giant planet in the Solar System. AJ 151, 22.</li>
              <li>Batygin, K., Adams, F. C., Brown, M. E. &amp; Becker, J. C. (2019). The planet nine hypothesis. Phys. Rep. 805, 1.</li>
              <li>Boch, T. &amp; Fernique, P. (2014). Aladin Lite. ASP Conf. Ser. 485, 277.</li>
            </ol>
          </section>
        </article>
      </main>
    </SiteLayout>
  );
}
