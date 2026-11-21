/**
 * Demo engine — deterministic sample results for local development, automated
 * browser tests, and walkthroughs, with no AI provider and no cost.
 *
 * Every result's note begins with "Demo result" and `/api/health` reports
 * `demo_mode: true`, which the web client turns into a persistent banner. The
 * samples run through the same normalization, validation, and safety layers as
 * real model output, so they exercise the production pipeline end to end.
 */
import {
  applySafetyRules,
  normalizeAnalysis,
  parseAnalysis,
  type Analysis,
} from "./diagnosis-contract.js";
import type { AnalysisResult, DiagnosisEngine } from "./diagnosis-engine.js";
import { PROMPT_VERSION } from "./prompt.js";
import type { AnalyzeRequest } from "./request-schema.js";

type Scenario = "ceiling" | "crack" | "electrical" | "window" | "plumbing" | "general" | "retake" | "unrelated";

const DEMO = "Demo result — sample content, not an analysis of your photo.";

function pick(request: AnalyzeRequest): Scenario {
  const text = `${request.category ?? ""} ${request.description ?? ""}`.toLowerCase();
  if (/\b(blurry|blurred|dark photo|retake)\b/.test(text)) return "retake";
  if (/\b(car|vehicle|truck|dog|cat|person)\b/.test(text)) return "unrelated";
  if (/\b(outlet|electrical|spark|switch|breaker|wiring)\b/.test(text)) return "electrical";
  if (/\b(crack|cracks|drywall|plaster|nail pop)\b/.test(text)) return "crack";
  if (/\b(window|door|seal|fogg?ed|draft)\b/.test(text)) return "window";
  if (/\b(pipe|plumbing|sink|faucet|drip|valve|toilet)\b/.test(text)) return "plumbing";
  if (/\b(ceiling|stain|roof|water spot|leak)\b/.test(text)) return "ceiling";
  if (/\bwall\b/.test(text)) return "crack";
  return "general";
}

const base = {
  retake_guidance: [] as string[],
  follow_up_questions: [] as unknown[],
  safety_notices: [] as string[],
};

function questions(scenario: Scenario): unknown {
  const sets: Record<string, unknown[]> = {
    ceiling: [
      {
        id: "after_rain",
        question: "Does the stain grow or darken after rain?",
        why_it_matters: "Growth after rain points to a roof or flashing leak rather than plumbing or an old, dried stain.",
        options: ["Yes, after rain", "No change with rain", "It grows without rain", "I'm not sure"],
      },
      {
        id: "touch",
        question: "If you can reach it safely, does the stained area feel soft or damp?",
        why_it_matters: "A soft or damp ceiling suggests an active leak and possible hidden damage.",
        options: ["Soft or damp", "Firm and dry", "I can't reach it"],
      },
    ],
    general: [
      {
        id: "when_started",
        question: "When did you first notice this?",
        why_it_matters: "Recent, fast-changing damage is more urgent than a long-stable mark.",
        options: ["This week", "Within a few months", "Over a year ago", "I'm not sure"],
      },
    ],
  };
  return {
    ...base,
    result_type: "questions",
    note: `${DEMO} A couple of quick answers will sharpen this assessment.`,
    image_quality: "good",
    follow_up_questions: sets[scenario] ?? sets.general,
    diagnosis: null,
  };
}

const COMMON_ASSUMPTION = "Typical United States prices; costs vary by region, access, and what is found once work begins.";

function diagnosis(scenario: Scenario): unknown {
  const shared = {
    disclaimer_required: true,
    next_measurement: null,
    additional_photos: [],
  };
  const byScenario: Record<string, unknown> = {
    ceiling: {
      subject: "Ceiling below a bathroom or roofline (demo)",
      diagnosis: "Water staining on the ceiling drywall, consistent with a past or intermittent leak",
      observations: [
        "Irregular brown ring-shaped stain on a white painted ceiling",
        "Darker outer edge, typical of water that wicked outward and dried",
        "No visible sagging or peeling paint in the photo",
      ],
      likely_cause: "Most likely water from above — a roof or flashing leak, or a plumbing leak — that has wetted and dried at least once.",
      possible_causes: [
        { cause: "Roof or flashing leak", likelihood: "possible", supporting_evidence: "Stain shape is typical of water arriving from above; depends on whether it grows after rain." },
        { cause: "Plumbing leak from a bathroom above", likelihood: "possible", supporting_evidence: "Stains below bathrooms commonly come from drain or wax-ring leaks." },
        { cause: "Condensation from an attic duct", likelihood: "less_likely", supporting_evidence: "Can cause similar rings, usually near vents." },
      ],
      limitations: [
        "The photo cannot show whether the leak is still active.",
        "Moisture content and any damage above the ceiling are not visible.",
      ],
      severity: 5,
      urgency: "soon",
      confidence: 0.62,
      safe_to_diy: true,
      diy_or_pro_reason: "Finding and stopping the source may need a roofer or plumber, but sealing and repainting a dry, firm stain is a common DIY job.",
      recommendation: {
        best_fix: "Find and stop the water source first, confirm the drywall is dry and firm, then seal the stain with stain-blocking primer and repaint.",
        cheap_or_temp_fix: "Mark the stain outline with pencil and date it, then check after the next rain or heavy bathroom use to see whether it grows.",
        tools_or_parts: ["Stain-blocking primer (shellac or oil-based)", "Ceiling paint", "Angled brush and roller with extension pole", "Drop cloth", "Safety glasses", "Stable step ladder"],
        difficulty: "easy",
        repair_steps: [
          "Confirm the source is fixed and the stain has not grown for at least two weeks.",
          "Press gently on the stain; if it is soft or crumbly, stop — the drywall needs replacing.",
          "Lay a drop cloth, put on safety glasses, and set up a stable ladder.",
          "Clean the area lightly with a damp sponge and let it dry completely.",
          "Apply one coat of stain-blocking primer extending 2–3 inches past the stain edge.",
          "Let the primer dry per the label, then apply two coats of ceiling paint, feathering the edges.",
          "Check the area after the next rain to confirm the stain does not return.",
        ],
      },
      next_inspection_steps: [
        "Check the attic above the stain with a flashlight after rain, from the access hatch only.",
        "Look for loose flooring, a rocking toilet, or caulk gaps in any bathroom directly above.",
      ],
      cost_estimate: {
        currency: "USD",
        diy_materials: { low: 25, high: 70 },
        professional_total: { low: 200, high: 600 },
        assumptions: [COMMON_ASSUMPTION, "Assumes the leak source is found and repaired separately.", "Assumes no drywall replacement is needed."],
      },
      labor_estimate: { hours_low: 1.5, hours_high: 3, who: "Homeowner with basic painting experience", assumptions: ["Excludes primer and paint drying time."] },
      risk_if_ignored: "An active leak can rot framing, damage insulation, and eventually bring down a section of ceiling.",
      needs_professional: false,
      professional_type: null,
      safety_warnings: [],
      maintenance_tips: ["Keep gutters and downspouts clear.", "Re-caulk around the tub and toilet base when caulk cracks."],
      follow_up: { reinspect_in_days: 14, what_to_check: "Whether the pencil outline has been crossed after rain or bathroom use." },
      next_measurement: {
        instrument: "moisture_meter",
        target: "Center of the stain and a clean area of the same ceiling",
        why: "Distinguishes an active leak from an old, dry stain.",
        expected_discriminator: "A stain reading well above the clean-area reference (more than about 5 points) indicates active moisture; a reading within a few points of it suggests an old, dried stain.",
        safety_note: null,
      },
    },
    crack: {
      subject: "Interior drywall near a door frame (demo)",
      diagnosis: "Hairline drywall crack at a door-frame corner, typical of minor seasonal movement",
      observations: [
        "Thin diagonal crack running from the upper corner of the door frame",
        "Crack edges are flush, with no visible offset between the two sides",
      ],
      likely_cause: "Normal framing shrinkage and seasonal movement concentrating stress at the door-opening corner.",
      possible_causes: [
        { cause: "Seasonal wood movement and settling", likelihood: "most_likely", supporting_evidence: "Diagonal hairline cracks from opening corners are a classic pattern." },
        { cause: "Ongoing structural movement", likelihood: "less_likely", supporting_evidence: "Would usually show widening, offset edges, or sticking doors." },
      ],
      limitations: ["A photo cannot show whether the crack is still moving.", "Crack width was not measured."],
      severity: 2,
      urgency: "cosmetic",
      confidence: 0.78,
      safe_to_diy: true,
      diy_or_pro_reason: "Taping and patching a stable hairline crack needs only basic tools and no special safety risk.",
      recommendation: {
        best_fix: "Re-tape the crack with mesh tape and joint compound, then sand, prime, and paint.",
        cheap_or_temp_fix: "Fill with flexible paintable caulk and touch up the paint.",
        tools_or_parts: ["Self-adhesive mesh drywall tape", "Lightweight joint compound", "6-inch drywall knife", "120-grit sanding sponge", "Primer and matching paint", "Dust mask"],
        difficulty: "easy",
        repair_steps: [
          "Widen the crack slightly into a shallow V with a utility knife and brush out dust.",
          "Apply mesh tape centered over the crack.",
          "Spread a thin coat of joint compound over the tape and let it dry.",
          "Apply a second, wider coat, feathering the edges; let it dry.",
          "Sand smooth wearing a dust mask, prime the patch, and repaint.",
        ],
      },
      next_inspection_steps: ["Pencil-mark both crack ends with the date and check monthly for growth.", "Check whether the door sticks or the gap around it is uneven."],
      cost_estimate: {
        currency: "USD",
        diy_materials: { low: 15, high: 40 },
        professional_total: { low: 150, high: 350 },
        assumptions: [COMMON_ASSUMPTION, "Assumes a single crack under about two feet long."],
      },
      labor_estimate: { hours_low: 1, hours_high: 2, who: "Homeowner", assumptions: ["Excludes compound drying time between coats."] },
      risk_if_ignored: "Mostly cosmetic; the crack may reopen with seasonal changes.",
      needs_professional: false,
      professional_type: null,
      safety_warnings: [],
      maintenance_tips: ["Keep indoor humidity steady (roughly 30–50%) to reduce seasonal movement."],
      follow_up: { reinspect_in_days: 30, what_to_check: "Whether the crack has extended past the pencil marks or widened." },
    },
    electrical: {
      subject: "Wall outlet (demo)",
      diagnosis: "Discoloration around an outlet that may indicate overheating",
      observations: ["Brown discoloration on the outlet face around one slot", "Faceplate appears slightly warped near the discoloration"],
      likely_cause: "Possible loose connection or worn receptacle causing heat at the contact.",
      possible_causes: [
        { cause: "Loose wire connection at the receptacle", likelihood: "possible", supporting_evidence: "Heat marks concentrated at one slot are common with loose terminals." },
        { cause: "Worn receptacle contacts from a high-draw appliance", likelihood: "possible", supporting_evidence: "Repeated heavy loads can wear contacts and cause heating." },
      ],
      limitations: ["The photo cannot show the wiring behind the outlet or whether it is currently hot."],
      severity: 8,
      urgency: "urgent",
      confidence: 0.6,
      safe_to_diy: false,
      diy_or_pro_reason: "Overheating at an outlet is a fire risk that needs a licensed electrician to diagnose the wiring.",
      recommendation: {
        best_fix: "Have a licensed electrician inspect the receptacle, connections, and circuit, and replace damaged components.",
        cheap_or_temp_fix: "Stop using the outlet and unplug anything connected to it until it is inspected.",
        tools_or_parts: [],
        difficulty: "pro-only",
        repair_steps: [],
      },
      next_inspection_steps: ["Note which devices were plugged in and whether the breaker has tripped recently, to tell the electrician."],
      cost_estimate: {
        currency: "USD",
        diy_materials: null,
        professional_total: { low: 150, high: 400 },
        assumptions: [COMMON_ASSUMPTION, "Assumes a single receptacle replacement without rewiring the circuit."],
      },
      labor_estimate: { hours_low: 0.5, hours_high: 2, who: "Licensed electrician", assumptions: ["More time if damaged wiring is found."] },
      risk_if_ignored: "Overheating connections can start an electrical fire.",
      needs_professional: true,
      professional_type: "electrician",
      safety_warnings: ["Do not touch the outlet if it is hot, smells of burning, or sparks."],
      maintenance_tips: ["Avoid running space heaters and other high-draw appliances through extension cords."],
      follow_up: null,
    },
    window: {
      subject: "Double-pane window (demo)",
      diagnosis: "Fogging between the glass panes, indicating a failed insulated-glass seal",
      observations: ["Hazy film between the two panes that cannot be wiped from either side", "Window frame appears intact"],
      likely_cause: "The perimeter seal of the insulated glass unit has failed, letting moist air enter the space between panes.",
      possible_causes: [
        { cause: "Failed insulated-glass unit seal", likelihood: "most_likely", supporting_evidence: "Fog trapped between panes is the hallmark of seal failure." },
        { cause: "Interior condensation on the glass surface", likelihood: "less_likely", supporting_evidence: "Would wipe off the room-side surface." },
      ],
      limitations: ["Whether the frame or sill below is water-damaged is not visible."],
      severity: 3,
      urgency: "monitor",
      confidence: 0.82,
      safe_to_diy: false,
      diy_or_pro_reason: "Replacing a sealed glass unit requires custom-ordered glass and careful handling; a window or glass shop is the usual route.",
      recommendation: {
        best_fix: "Replace the insulated glass unit (the glass only, if the frame is sound).",
        cheap_or_temp_fix: "Leave it in place; it is mainly an efficiency and appearance issue.",
        tools_or_parts: [],
        difficulty: "hard",
        repair_steps: [],
      },
      next_inspection_steps: ["Check the sill and lower frame for soft wood or peeling paint."],
      cost_estimate: {
        currency: "USD",
        diy_materials: null,
        professional_total: { low: 150, high: 500 },
        assumptions: [COMMON_ASSUMPTION, "Assumes a standard-size unit and a reusable frame."],
      },
      labor_estimate: { hours_low: 1, hours_high: 2, who: "Glass or window technician", assumptions: ["Excludes ordering lead time."] },
      risk_if_ignored: "Reduced insulation and visibility; the haze usually worsens.",
      needs_professional: true,
      professional_type: "general_contractor",
      safety_warnings: [],
      maintenance_tips: ["Keep weep holes at the bottom of the frame clear."],
      follow_up: null,
    },
    plumbing: {
      subject: "Sink supply line (demo)",
      diagnosis: "A slow drip at a compression fitting under the sink",
      observations: ["Water droplets at the nut where the supply line meets the shut-off valve", "Mineral residue on the valve body"],
      likely_cause: "A loose compression nut or a worn ferrule at the valve outlet.",
      possible_causes: [
        { cause: "Loose compression nut", likelihood: "most_likely", supporting_evidence: "Drips concentrated at the nut threads." },
        { cause: "Worn or cracked supply line", likelihood: "possible", supporting_evidence: "Older braided lines can fail near the crimp." },
      ],
      limitations: ["Valve internals and the condition of the line inside its braid are not visible."],
      severity: 4,
      urgency: "soon",
      confidence: 0.8,
      safe_to_diy: true,
      diy_or_pro_reason: "Tightening or replacing a supply line is a routine DIY repair once the water is shut off.",
      recommendation: {
        best_fix: "Shut off the water, replace the supply line, and snug the compression nut a quarter turn past hand-tight.",
        cheap_or_temp_fix: "Place a dry towel and a shallow tray under the fitting and check daily.",
        tools_or_parts: ["Replacement braided supply line (matching length and fittings)", "Two adjustable wrenches", "Towel and bucket", "Flashlight"],
        difficulty: "easy",
        repair_steps: [
          "Turn the shut-off valve clockwise until it stops; open the faucet to relieve pressure.",
          "Place a towel and bucket under the connection.",
          "Hold the valve with one wrench and loosen the supply-line nut with the other.",
          "Thread the new line on by hand, then tighten a quarter turn with the wrench.",
          "Slowly open the valve and watch the fitting for two minutes.",
          "Check again the next day with a dry tissue for any moisture.",
        ],
      },
      next_inspection_steps: ["Feel the cabinet floor for soft or swollen spots."],
      cost_estimate: {
        currency: "USD",
        diy_materials: { low: 10, high: 25 },
        professional_total: { low: 125, high: 275 },
        assumptions: [COMMON_ASSUMPTION, "Assumes the shut-off valve works and does not need replacing."],
      },
      labor_estimate: { hours_low: 0.5, hours_high: 1, who: "Homeowner", assumptions: ["Assumes easy access under the sink."] },
      risk_if_ignored: "A slow drip can rot the cabinet floor and grow mold.",
      needs_professional: false,
      professional_type: null,
      safety_warnings: [],
      maintenance_tips: ["Replace braided supply lines roughly every 5–8 years."],
      follow_up: { reinspect_in_days: 7, what_to_check: "Dryness at the fitting and cabinet floor." },
    },
    general: {
      subject: "Surface damage (demo)",
      diagnosis: "Localized surface wear with no visible signs of an active problem",
      observations: ["Scuffed and worn finish in a small area", "No staining, cracking, or deformation visible"],
      likely_cause: "Everyday wear and minor impact.",
      possible_causes: [{ cause: "Everyday wear", likelihood: "most_likely", supporting_evidence: "Localized finish wear without other damage." }],
      limitations: ["Underlying material condition is not visible."],
      severity: 1,
      urgency: "cosmetic",
      confidence: 0.7,
      safe_to_diy: true,
      diy_or_pro_reason: "Cosmetic touch-up with common materials.",
      recommendation: {
        best_fix: "Clean, lightly sand if needed, and refinish the area to match.",
        cheap_or_temp_fix: "Clean the area and leave as is.",
        tools_or_parts: ["Mild cleaner", "Fine sanding sponge", "Matching paint or finish"],
        difficulty: "easy",
        repair_steps: ["Clean the area and let it dry.", "Lightly sand any rough edges.", "Apply matching finish in thin coats.", "Let it cure fully before use."],
      },
      next_inspection_steps: [],
      cost_estimate: {
        currency: "USD",
        diy_materials: { low: 10, high: 30 },
        professional_total: { low: 100, high: 250 },
        assumptions: [COMMON_ASSUMPTION],
      },
      labor_estimate: { hours_low: 0.5, hours_high: 1.5, who: "Homeowner", assumptions: ["Excludes curing time."] },
      risk_if_ignored: "Cosmetic only.",
      needs_professional: false,
      professional_type: null,
      safety_warnings: [],
      maintenance_tips: [],
      follow_up: null,
    },
  };
  const selected = byScenario[scenario] ?? byScenario.general;
  return {
    ...base,
    result_type: "diagnosis",
    note: `${DEMO} The photo is clear enough for a first-look assessment.`,
    image_quality: "good",
    diagnosis: { ...shared, ...(selected as object) },
  };
}

function sample(request: AnalyzeRequest): unknown {
  const scenario = pick(request);
  if (scenario === "retake") {
    return {
      ...base,
      result_type: "retake",
      note: `${DEMO} The photo is too dark or blurry to assess.`,
      image_quality: "poor",
      retake_guidance: ["Turn on the room lights or use daylight.", "Hold the phone steady and tap to focus on the damage.", "Take one wide shot and one close-up."],
      diagnosis: null,
    };
  }
  if (scenario === "unrelated") {
    return {
      ...base,
      result_type: "cannot_assess",
      note: `${DEMO} This does not look like a home-repair subject FixSight can assess.`,
      image_quality: "good",
      diagnosis: null,
    };
  }
  const asksFirst = scenario === "ceiling" || scenario === "general";
  if (asksFirst && request.answers.length === 0) return questions(scenario);
  return diagnosis(scenario);
}

export class DemoDiagnosisEngine implements DiagnosisEngine {
  constructor(private readonly delayMs = 900) {}

  async analyze(request: AnalyzeRequest): Promise<AnalysisResult> {
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    const analysis: Analysis = applySafetyRules(parseAnalysis(normalizeAnalysis(sample(request))), {
      description: request.description,
      answers: request.answers.map((answer) => answer.answer),
    });
    return {
      analysis,
      metadata: { model_id: "demo", prompt_version: `${PROMPT_VERSION}-demo` },
    };
  }
}
