export const ANTIKYTHERA_EXHIBIT = {
  title: "The Antikythera Mechanism",
  eyebrow: "Hellenistic astronomical calculator",
  date: "Probably 150–100 BCE",
  inventory: "National Archaeological Museum, Athens · X 15087",
  caseDimensionsCm: [33, 18, 10] as const,
  frontOutputs: ["Moon", "Mercury", "Venus", "Sun", "Mars", "Jupiter", "Saturn", "Date"] as const,
  summary: "A hand-powered bronze computer that turned astronomical cycles into a working model of the sky.",
  established: [
    "A compact wooden case held interlocking bronze gears, pointers, scales, and Greek operating inscriptions.",
    "Its rear Metonic calendar and Saros eclipse dials tracked long calendar cycles and predicted solar and lunar eclipses.",
    "The front displayed the Sun and Moon, the lunar phase, the calendar, and the zodiac."
  ],
  reconstruction: [
    "This exhibit opens the case so its gearing can be inspected and restores the missing front as a flat, evidence-based planetary dial.",
    "The nested engraved scales follow the 2021 UCL model: Moon, Mercury, Venus, Sun, Mars, Jupiter, Saturn, and date around a central Earth.",
    "Only about one third of the ancient device survives. The planetary front is a leading published reconstruction, not a claim that every lost part is known."
  ],
  sources: [
    {
      label: "Scientific Reports · 2021 reconstruction",
      href: "https://www.nature.com/articles/s41598-021-84310-w"
    },
    {
      label: "Greek Ministry of Culture · museum record",
      href: "https://olympicgames.culture.gov.gr/en/texnologia/1_Mixanismos-Antikithirwn.html"
    },
    {
      label: "Kotsanas Museum · operational model",
      href: "https://www.ancientgreektechnology.gr/en/the-museum/exhibits/item/65-model-of-the-antikythera-mechanism-2017"
    }
  ] as const
} as const;

// The runtime case stands on the two east/west catalogue tablets authored into
// the Alexandria base model. Keep these measurements together so future scene
// edits cannot silently leave either the case or its plaque hovering.
export const ANTIKYTHERA_DISPLAY_LAYOUT = {
  pedestalTopY: 0.8875,
  mountingTabletTopY: 0.965,
  caseCenterY: 2.985,
  caseSupportCenterOffsetY: -1.55,
  caseSupportHeight: 0.94,
  plaqueStemCenterY: 1.29,
  plaqueStemHeight: 0.805
} as const;
