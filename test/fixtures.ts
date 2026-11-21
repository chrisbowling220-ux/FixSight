/** Contract v5 fields shared by test diagnoses. Spread after legacy fields. */
export const V5_DIAGNOSIS_FIELDS = {
  observations: ["Water droplets at the compression nut under the sink"],
  possible_causes: [
    {
      cause: "Loose compression nut",
      likelihood: "most_likely",
      supporting_evidence: "Drips concentrate at the nut threads.",
    },
  ],
  limitations: ["The inside of the valve is not visible."],
  diy_or_pro_reason: "A routine repair once the water is shut off.",
  next_inspection_steps: ["Check the cabinet floor for soft spots."],
  cost_estimate: {
    currency: "USD",
    diy_materials: { low: 10, high: 25 },
    professional_total: { low: 125, high: 275 },
    assumptions: ["Typical United States prices; vary by region."],
  },
  labor_estimate: {
    hours_low: 0.5,
    hours_high: 1,
    who: "Homeowner",
    assumptions: ["Easy access under the sink."],
  },
  maintenance_tips: ["Replace braided supply lines every few years."],
  follow_up: { reinspect_in_days: 7, what_to_check: "Dryness at the fitting." },
  additional_photos: [],
} as const;

export const V5_REPAIR_STEPS = [
  "Shut off the water at the valve.",
  "Replace the ferrule and retighten the nut.",
] as const;
