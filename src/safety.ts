/**
 * Deterministic hazard detection — a second line of defence beside the model.
 *
 * `applySafetyRules` reacts to the model's own classification (professional
 * type, urgency). If the model misfiles a scorched outlet under "general
 * contractor", that rule never fires. This module scans the user's words and the
 * model's prose for hazard language and adds conservative, category-specific
 * instructions regardless of how the result was classified.
 *
 * It is intentionally simple and auditable: phrase patterns with a short
 * negation window ("no exposed wiring" does not trigger). It cannot see the
 * photo, so it supplements rather than replaces the model and a professional.
 */

export const HAZARD_CATEGORIES = [
  "gas",
  "carbon_monoxide",
  "electrical",
  "water_electrical",
  "fire",
  "structural",
  "hazardous_material",
] as const;

export type HazardCategory = (typeof HAZARD_CATEGORIES)[number];

interface HazardRule {
  category: HazardCategory;
  /** Matched against the user's own words (description and answers). */
  patterns: RegExp[];
  /**
   * Matched against the model's observations and diagnosis. Defaults to
   * `patterns`; an empty list means the category is not scanned there. Stricter
   * because a false positive here downgrades safe DIY advice to pro-only.
   */
  outputPatterns?: RegExp[];
  /** Shown to the user whenever the hazard appears in their own description. */
  notice: string;
  /** Added to a diagnosis whose own text describes the hazard. */
  warning: string;
  /** Whether the hazard forces professional-only handling. */
  forcesProfessional: boolean;
}

const RULES: HazardRule[] = [
  {
    category: "gas",
    patterns: [
      /\bsmell(?:s|ed|ing)?\s+(?:of\s+|like\s+)?(?:natural\s+|propane\s+)?gas\b/,
      /\bgas\s+(?:smell|odou?r|leak(?:s|ing)?|hiss(?:ing)?)\b/,
      /\brotten[-\s]egg(?:s)?\b/,
      /\bpropane\s+(?:smell|odou?r|leak(?:s|ing)?)\b/,
      /\bleak(?:ing)?\s+gas\b/,
    ],
    notice:
      "If you smell gas now, leave the building immediately. Do not operate switches, appliances, or phones inside; call the gas utility or 911 from outside.",
    warning:
      "Possible gas involvement: do not attempt repairs. Leave the area if you smell gas and contact the gas utility or emergency services.",
    forcesProfessional: true,
  },
  {
    category: "carbon_monoxide",
    patterns: [
      /\bcarbon\s+monoxide\b/,
      /\b(?:co|carbon\s+monoxide)\s+(?:alarm|detector)s?\s+(?:is\s+|are\s+|was\s+|keeps\s+)?(?:going\s+off|sounding|beeping|chirping|alarming)\b/,
      /\bback[-\s]?drafting\b/,
    ],
    notice:
      "If a carbon-monoxide alarm is sounding or anyone feels dizzy, nauseated, or unusually tired, get everyone outside to fresh air and call 911.",
    warning:
      "Possible combustion or carbon-monoxide concern: have a qualified gas or HVAC technician inspect venting before using the appliance.",
    forcesProfessional: true,
  },
  {
    category: "electrical",
    patterns: [
      /\bexposed\s+(?:electrical\s+)?(?:wire|wires|wiring|conductors?)\b/,
      /\blive\s+wires?\b/,
      /\bspark(?:s|ing|ed)?\b/,
      /\barcing\b/,
      /\barc\s+(?:marks?|flash|fault)\b/,
      /\b(?:scorch(?:ed|ing|marks?)?|burn(?:t|ed|ing)?\s+marks?|melted|charred|blackened)\b[^.;!?]{0,40}\b(?:outlet|socket|receptacle|switch|plug|panel|breaker|wire|wiring|cord|fixture)s?\b/,
      /\b(?:outlet|socket|receptacle|switch|plug|panel|breaker|wire|wiring|cord|fixture)s?\b[^.;!?]{0,40}\b(?:scorch(?:ed|ing)?|melted|charred|blackened|hot\s+to\s+the\s+touch|buzz(?:es|ing)?)\b/,
      /\bburning\s+(?:plastic\s+)?smell\b/,
      /\b(?:got|getting|received)\s+(?:a\s+)?(?:an\s+)?(?:electric(?:al)?\s+)?shock(?:ed)?\b/,
    ],
    notice:
      "Keep away from sparking, scorched, buzzing, or exposed wiring. Switch off the circuit at the panel only if you can do so without touching water; otherwise call an electrician, or 911 if there is smoke or fire.",
    warning:
      "Electrical hazard indicated: do not touch or open the equipment. Use a licensed electrician.",
    forcesProfessional: true,
  },
  {
    category: "water_electrical",
    patterns: [
      /\bwater\b[^.;!?]{0,50}\b(?:(?<!(?:drain|pipe|faucet|sink|hose|vent|air|tub|shower|water)\s)outlet|socket|receptacle|electrical\s+panel|breaker|light\s+fixture|wiring|electrical)s?\b/,
      /\b(?:(?<!(?:drain|pipe|faucet|sink|hose|vent|air|tub|shower|water)\s)outlet|socket|receptacle|electrical\s+panel|breaker|light\s+fixture|wiring|electrical)s?\b[^.;!?]{0,50}\b(?:wet|water|dripping|flooded|submerged)\b/,
    ],
    outputPatterns: [
      /\bwater\b[^.;!?]{0,50}\b(?:receptacle|electrical\s+outlet|electrical\s+panel|breaker\s+panel|light\s+fixture|wiring|junction\s+box)s?\b/,
      /\b(?:receptacle|electrical\s+outlet|electrical\s+panel|breaker\s+panel|light\s+fixture|wiring|junction\s+box)s?\b[^.;!?]{0,50}\b(?:wet|water[-\s]?(?:damaged|stained|soaked)|dripping|flooded|submerged)\b/,
    ],
    notice:
      "Water and electricity together are dangerous. Do not touch outlets, switches, fixtures, or appliances that are wet or near standing water; have an electrician make the area safe.",
    warning:
      "Water near electrical components: keep clear and have an electrician de-energize and inspect the area before any repair.",
    forcesProfessional: true,
  },
  {
    category: "fire",
    patterns: [
      /\b(?:active\s+)?fire\b(?!\s*(?:place|places|pit|pits|wood|works|fighter|alarm|alarms|extinguisher|rated|stop|blocking|wall|proof|brick|bricks|box|door|doors))/,
      /\bsmok(?:e|ing|ey)\b(?!\s*(?:detector|detectors|alarm|alarms))/,
    ],
    // Model prose mentions smoke staining or old fire damage too often for a
    // reliable signal; the prompt handles those. Users' words still trigger it.
    outputPatterns: [],
    notice:
      "If there is smoke or fire, get everyone out and call 911. Do not return to inspect or photograph it.",
    warning:
      "Fire or smoke involvement: have the area inspected by the appropriate licensed professional before reuse.",
    forcesProfessional: true,
  },
  {
    category: "structural",
    patterns: [
      /\bsag(?:s|ging|ged)\b[^.;!?]{0,30}\b(?:ceiling|beam|joist|roof|floor|header|rafter)s?\b/,
      /\b(?:ceiling|beam|joist|roof|floor|header|rafter)s?\b[^.;!?]{0,30}\b(?:sag(?:s|ging|ged)?|bulg(?:e|es|ing)|bowing|collaps(?:e|ing|ed))\b/,
      /\bcollaps(?:e|ing|ed)\b/,
      /\b(?:crack|cracks|gap|gaps)\b[^.;!?]{0,40}\b(?:widening|getting\s+(?:wider|bigger)|growing)\b/,
      /\b(?:leaning|bowing|buckling)\s+(?:wall|walls|foundation|chimney|beam|column)s?\b/,
    ],
    notice:
      "Keep people and belongings out from under or beside any sagging, bulging, or moving structure until a qualified professional has assessed it.",
    warning:
      "Possible structural movement cannot be cleared from a photo. Avoid loading or altering the area until a qualified professional evaluates it.",
    forcesProfessional: true,
  },
  {
    category: "hazardous_material",
    patterns: [
      /\basbestos\b/,
      /\bvermiculite\b/,
      /\bpopcorn\s+ceiling\b/,
      /\blead(?:-based)?\s+paint\b/,
    ],
    notice:
      "Do not sand, scrape, cut, or drill material that may contain asbestos or lead paint. Have a sample tested before disturbing it.",
    warning:
      "Possible asbestos or lead-containing material: do not disturb it until a sample has been tested by an accredited lab.",
    forcesProfessional: false,
  },
];

// Negation words that cancel a match when they appear shortly before it.
const NEGATION = /\b(?:no|not|never|none|without|nor|free\s+of|absence\s+of|isn't|aren't|wasn't|weren't|don't|doesn't|didn't|hasn't|haven't|cannot|can't|no\s+sign\s+of|no\s+signs\s+of|no\s+evidence\s+of|rule\s+out|ruled\s+out)\b/;
const NEGATION_WINDOW_WORDS = 6;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ");
}

function isNegated(text: string, matchIndex: number): boolean {
  // Look back only within the current sentence.
  const sentenceStart = Math.max(
    text.lastIndexOf(".", matchIndex - 1),
    text.lastIndexOf("!", matchIndex - 1),
    text.lastIndexOf("?", matchIndex - 1),
    text.lastIndexOf(";", matchIndex - 1),
  );
  const before = text.slice(sentenceStart + 1, matchIndex).trim();
  const words = before.split(" ").filter(Boolean);
  const window = words.slice(-NEGATION_WINDOW_WORDS).join(" ");
  return NEGATION.test(window);
}

export interface HazardMatch {
  category: HazardCategory;
  notice: string;
  warning: string;
  forcesProfessional: boolean;
}

function scan(texts: Array<string | null | undefined>, useOutputPatterns: boolean): HazardMatch[] {
  const combined = normalize(texts.filter(Boolean).join(". "));
  if (combined.trim() === "") return [];
  const found: HazardMatch[] = [];

  for (const rule of RULES) {
    const patterns = useOutputPatterns ? rule.outputPatterns ?? rule.patterns : rule.patterns;
    const hit = patterns.some((pattern) => {
      const global = new RegExp(pattern.source, "g");
      for (const match of combined.matchAll(global)) {
        if (!isNegated(combined, match.index ?? 0)) return true;
      }
      return false;
    });
    if (hit) {
      found.push({
        category: rule.category,
        notice: rule.notice,
        warning: rule.warning,
        forcesProfessional: rule.forcesProfessional,
      });
    }
  }
  return found;
}

/** Hazards described (and not negated) in the user's own words. */
export function detectInputHazards(...texts: Array<string | null | undefined>): HazardMatch[] {
  return scan(texts, false);
}

/** Hazards described (and not negated) in the model's findings. */
export function detectOutputHazards(...texts: Array<string | null | undefined>): HazardMatch[] {
  return scan(texts, true);
}
