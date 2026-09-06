import * as THREE from "three";
import { ARKSHIP_NAVIGATION_DESIGN, type ArkshipNavigationView } from "./arkshipNavigation";

// Fictional, authored passenger information: this display does not represent
// live telemetry, a real mission, or the contents of a visitor's library.
export function createArkshipNavigationTexture(view: ArkshipNavigationView, activeIndex: number) {
  const canvas = document.createElement("canvas");
  // Match the physical screen aspect so lettering and diagrams stay undistorted.
  canvas.width = 1872;
  canvas.height = 600;
  const c = canvas.getContext("2d");
  if (!c) return new THREE.CanvasTexture(canvas);
  const ink = "#d6e9ed", muted = "#8ca8b1", cyan = "#7bd9e6", amber = "#edbd7e";
  const text = (s: string, x: number, y: number, size = 20, color = ink, weight = 500) => {
    c.font = `${weight} ${size}px system-ui, sans-serif`; c.fillStyle = color; c.fillText(s, x, y);
  };
  const line = (x: number, y: number, x2: number, y2: number, color = "#294650", width = 1) => {
    c.beginPath(); c.moveTo(x, y); c.lineTo(x2, y2); c.strokeStyle = color; c.lineWidth = width; c.stroke();
  };
  const dot = (x: number, y: number, r: number, color = cyan) => {
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fillStyle = color; c.fill();
  };
  const panel = (x: number, y: number, w: number, h: number) => {
    c.fillStyle = "#0d202b"; c.fillRect(x, y, w, h);
    c.strokeStyle = "#294650"; c.lineWidth = 1; c.strokeRect(x, y, w, h);
  };
  const bar = (x: number, y: number, w: number, value: number, color = cyan) => {
    c.fillStyle = "#243c47"; c.fillRect(x, y, w, 5); c.fillStyle = color; c.fillRect(x, y, w * value, 5);
  };
  const background = c.createLinearGradient(0, 0, 1872, 600);
  background.addColorStop(0, "#102734"); background.addColorStop(1, "#07131d");
  c.fillStyle = background; c.fillRect(0, 0, 1872, 600);
  text("ARK  /  PASSENGER ALMANAC", 42, 48, 26, ink, 650);
  text("MEMORY GALLERY   ·   DECK 04", 42, 80, 17, muted);
  ["01  JOURNEY", "02  HABITAT", "03  COMMUNITY"].forEach((label, i) => {
    const x = 1110 + i * 238;
    text(label, x, 49, 20, i === activeIndex ? cyan : muted, 600);
    if (i === activeIndex) line(x, 64, x + 186, 64, cyan, 3);
  });
  line(42, 98, 1830, 98);
  panel(42, 122, 1134, 382);
  panel(1200, 122, 630, 382);

  if (view === "journey") {
    text("OUR NEXT CHAPTER", 72, 159, 17, muted, 600);
    text("Cygnus Archive", 72, 211, 46, ink, 600);
    text("A shared home for the knowledge we carry.", 74, 244, 21, muted);
    // An explanatory route diagram, rather than a piloting solution.
    for (let i = 0; i < 60; i++) dot(84 + ((i * 137) % 1040), 277 + ((i * 53) % 130), i % 9 ? 0.8 : 1.5, "#385765");
    c.strokeStyle = "#496570"; c.lineWidth = 2; c.setLineDash([5, 8]);
    c.beginPath(); c.moveTo(108, 367); c.bezierCurveTo(390, 367, 490, 296, 750, 320); c.bezierCurveTo(906, 334, 954, 327, 1080, 311); c.stroke(); c.setLineDash([]);
    c.strokeStyle = cyan; c.lineWidth = 3; c.beginPath(); c.moveTo(108, 367); c.bezierCurveTo(390, 367, 490, 296, 750, 320); c.stroke();
    dot(108, 367, 5); dot(750, 320, 7, amber);
    c.strokeStyle = "#977b58"; c.lineWidth = 1; c.beginPath(); c.arc(750, 320, 17, 0, Math.PI * 2); c.stroke();
    text("YOU ARE HERE", 666, 285, 17, amber, 650);
    text("LAST RELAY", 76, 412, 16, muted); text("CRUISE", 426, 412, 16, muted); text("ARRIVAL", 1000, 412, 16, muted);
    // The destination illustration is a ringed world, consistent with the view outside.
    const globe = c.createRadialGradient(1067, 290, 2, 1080, 311, 30);
    globe.addColorStop(0, "#84bccc"); globe.addColorStop(1, "#172d43");
    dot(1080, 311, 28, "#294b64"); c.fillStyle = globe; c.fill();
    c.strokeStyle = amber; c.lineWidth = 2; c.beginPath(); c.ellipse(1080, 311, 45, 12, -.25, 0, Math.PI * 2); c.stroke();
    bar(76, 457, 1066, .684); text("CURRENT LEG  68.4% COMPLETE", 76, 488, 16, muted);
    text("ROUTE 07-A  ·  SCHEMATIC", 866, 488, 15, muted);
    text("EXPECTED ARRIVAL", 1232, 164, 18, muted, 600);
    text("18 days · 6 hours", 1232, 215, 40, amber, 600);
    text("Cygnus Archive / Lyra-9 orbit", 1232, 251, 22);
    line(1232, 276, 1798, 276);
    // This page stays still with reduced motion, so it also carries a useful
    // habitat and community overview without requiring a carousel transition.
    text("TODAY IN THE LIBRARY", 1232, 312, 17, muted, 600);
    text("14:30 · Stories from home", 1232, 349, 28, cyan, 600);
    text("Memory Gallery · Everyone welcome", 1232, 383, 21);
    text("22°C   ·   1.00 g   ·   Air normal", 1232, 462, 22, muted);
  } else if (view === "habitat") {
    text("A SHIP THAT SUSTAINS US", 72, 164, 18, muted, 600);
    text("All habitats comfortable", 72, 208, 38, ink, 600);
    // Cutaway: labeled spaces, circulation spine, and a highlighted local deck.
    const decks = ["01  GARDENS", "02  LIVING", "03  COMMONS", "04  LIBRARY", "05  RESERVES"];
    c.strokeStyle = "#446572"; c.lineWidth = 2;
    c.beginPath(); c.moveTo(177, 274); c.lineTo(996, 274); c.quadraticCurveTo(1100, 354, 996, 423); c.lineTo(177, 423); c.quadraticCurveTo(93, 354, 177, 274); c.stroke();
    line(150, 356, 1060, 356, "#446572", 2);
    decks.forEach((label, i) => {
      const x = 184 + i * 160;
      c.fillStyle = i === 3 ? "#224855" : "#173541"; c.fillRect(x, 291, 140, 48); c.fillRect(x, 370, 140, 35);
      line(x + 70, 339, x + 70, 370, i === 3 ? cyan : "#446572", 3);
      text(label, x - 1, 448, 15, i === 3 ? cyan : muted, 600);
    });
    text("YOU ARE HERE", 698, 479, 15, cyan, 650);
    text("GALLERY CONDITIONS", 1232, 164, 18, muted, 600);
    const readings = [["AIR", "21.0% O₂", "101.3 kPa"], ["COMFORT", "22°C", "45% humidity"], ["GRAVITY", "1.00 g", "Stable rotation"]];
    readings.forEach(([label, value, detail], i) => {
      const y = 210 + i * 78;
      text(label, 1232, y, 16, muted, 600); text(value, 1380, y + 2, 27, cyan, 600); text(detail, 1600, y, 18);
      line(1232, y + 23, 1798, y + 23);
    });
    text("Water recovery  98.6%", 1232, 446, 22); bar(1232, 466, 566, .986);
    text("Habitat team available · Commons service desk", 1232, 490, 16, muted);
  } else {
    text("LIFE BETWEEN THE STARS", 72, 164, 18, muted, 600);
    text("There is time to belong.", 72, 208, 38, ink, 600);
    const events = [
      ["14:30", "Stories from home", "Memory Gallery · Deck 04", "OPEN TO ALL"],
      ["17:00", "A walk in the gardens", "Biosphere · Deck 01", "MEET AT LIFT A"],
      ["19:30", "Tonight's sky", "Observation Gallery · Deck 04", "QUIET SESSION"]
    ];
    events.forEach(([time, title, location, note], i) => {
      const y = 270 + i * 79;
      text(time, 76, y, 27, amber, 600); line(193, y - 25, 193, y + 30, "#3c5e6a", 2);
      text(title, 216, y, 28, ink, 600); text(location, 216, y + 28, 19, muted); text(note, 896, y + 4, 16, cyan);
      if (i < 2) line(76, y + 43, 1142, y + 43);
    });
    text("YOUR LIBRARY", 1232, 164, 18, muted, 600);
    text("Bring a story. Leave a trace.", 1232, 211, 29, cyan, 600);
    text("Read, reflect, or share a memory", 1232, 251, 23);
    text("at today's gathering.", 1232, 283, 23);
    line(1232, 308, 1798, 308);
    text("A LITTLE ROOM FOR QUIET", 1232, 346, 17, muted, 600);
    text("Quiet hours begin at 21:00", 1232, 386, 26, amber, 600);
    text("Reading lights remain available.", 1232, 423, 21);
    text("Need help? Visit the Deck 03 welcome desk.", 1232, 477, 19, muted);
  }
  // A persistent, calm status ribbon grounds every page in the same ship day.
  line(42, 526, 1830, 526);
  dot(52, 558, 4, cyan); text("SHIP DAY 039", 68, 565, 18, ink, 600);
  text("HABITATS NORMAL", 362, 565, 18, cyan, 600);
  text("QUIET HOURS  21:00—07:00", 720, 565, 18, muted);
  text("NEXT ARRIVAL  18D 06H", 1210, 565, 18, amber, 600);
  text(`${activeIndex + 1} / ${ARKSHIP_NAVIGATION_DESIGN.views.length}`, 1765, 565, 18, muted);
  const map = new THREE.CanvasTexture(canvas);
  map.name = `arkship-navigation-${view}`;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  return map;
}
