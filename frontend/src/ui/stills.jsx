// Concept stills from the Assay design file. They illustrate the walkthrough and the public
// page only. Connected services never show them: there, only bytes fetched through the
// delivery route appear, so a still can never stand in as proof of a delivered clip.
import lighthouse from "../assets/clips/lighthouse.webp";
import surf from "../assets/clips/surf.webp";
import coastRoad from "../assets/clips/coast-road.webp";
import harbour from "../assets/clips/harbour.webp";
import seaStacks from "../assets/clips/sea-stacks.webp";
import duneGrass from "../assets/clips/dune-grass.webp";
import darkroom from "../assets/clips/darkroom.webp";
import { isDemoMode } from "../api.js";

export const DARKROOM = darkroom;
export const STILLS = [
  { src: lighthouse, title: "Lighthouse, blue hour" },
  { src: surf, title: "Volcanic surf, aerial" },
  { src: coastRoad, title: "Cliff road, sunrise" },
  { src: harbour, title: "Harbour in fog" },
  { src: seaStacks, title: "Sea stacks, golden hour" },
  { src: duneGrass, title: "Dune grass, overcast" },
  { src: lighthouse, title: "Headland, night beam" },
  { src: surf, title: "Tide over basalt" },
  { src: coastRoad, title: "Coast road, haze" },
  { src: harbour, title: "Boats at first light" },
];

/** The illustrative still for a clip, or null when real services are connected. */
export const stillFor = (index) => (isDemoMode() ? STILLS[index % STILLS.length] : null);

/** Small frame for lists. Falls back to a numbered dark tile when there is no still. */
export function Thumb({ index, exists, dim = false }) {
  const still = exists ? stillFor(index) : null;
  return (
    <span className="thumb" data-exists={exists || undefined} data-dim={dim || undefined} aria-hidden="true">
      {still && <img src={still.src} alt="" decoding="async" />}
    </span>
  );
}
