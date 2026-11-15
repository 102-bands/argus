// 102 Bands: who built Argus. Public profile facts only (no phone numbers or personal emails).
import { SiteLayout } from "./SiteLayout";

interface Props {
  navigate: (path: string) => void;
}

interface Person {
  name: string;
  bio: string;
  highlights: string[];
}

const TEAM: Person[] = [
  {
    name: "Umair Zia",
    bio: "Umair is a computer science student who works across machine learning, data engineering and research. He "
       + "enjoys problems that need all three, and he likes turning large open datasets into tools people can actually "
       + "use. On Argus he led the technical side. He shaped the pipeline that processes the SPHEREx survey data, the "
       + "live server that runs it and the web app that lets anyone explore the results.",
    highlights: [
      "Kaggle Datasets Expert, ranked in the top 2.2% worldwide, with 6 silver and 10 bronze medals",
      "AI research engineering internship: cut LLM coding agents' token use by 28–54% with no loss of accuracy, and brought response time down from 61.5s to 5.7s",
      "CANOPY: a satellite deforestation pipeline that combines Sentinel-1 radar, Sentinel-2 imagery and a vision model, built for the Gemma 4 Good Hackathon",
    ],
  },
  {
    name: "Aliki Vidouri",
    bio: "Aliki is an astrophysics student with a background in space engineering. She's interested in how galaxies "
       + "form and what large sky surveys can reveal about the universe. On Argus she brought the physics perspective. "
       + "She checked that the science held up and that the data was explained accurately. She also tested the app "
       + "and flagged anything that felt unclear.",
    highlights: [
      "Space plasma research program at the Academy of Athens' Center for Space Research & Technology, chosen for a personal mentorship track on how magnetospheres and the heliosphere interact",
      "OrbitTrack: a 2-axis ground antenna that follows satellites in real time using orbital (TLE) data, built on a Raspberry Pi",
      "Harvard ASTR S-80: a course on planets, moons and the search for life, with a final project on exoplanet detection and orbital dynamics",
    ],
  },
];

export function Team({ navigate }: Props) {
  return (
    <SiteLayout page="team" navigate={navigate}>
      <main id="main" className="team-page">
        <header className="page-head">
          <h1>102 Bands</h1>
          <p className="lede">
            Named after SPHEREx's 102 infrared colours. Two students from Pakistan and Greece who built Argus for the
            2026 NASA International Space Apps Challenge.
          </p>
        </header>
        <div className="people">
          {TEAM.map((p) => (
            <article key={p.name} className="person">
              <h2>{p.name}</h2>
              <p>{p.bio}</p>
              <ul>{p.highlights.map((h) => <li key={h}>{h}</li>)}</ul>
            </article>
          ))}
        </div>
        <p className="team-contact">
          <a className="btn btn-primary btn-lg" href="https://www.linkedin.com/in/yuozhe" target="_blank" rel="noopener">
            Contact team lead ↗
          </a>
        </p>
      </main>
    </SiteLayout>
  );
}
