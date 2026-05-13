import type { ComplianceEvent } from "../types/index.js";

type RuleDef = {
  ruleId: ComplianceEvent["ruleId"];
  title: string;
  severity: ComplianceEvent["severity"];
  patterns: RegExp[];
  rationale: string;
  suggestion: string;
};

const SAFETY_QUALIFIER_RE =
  /\b(safety|warning|warnings|adverse|side effect|side effects|risk|risks|contraindicat|monitor|tolerability|precaution)\b/i;
const BENEFIT_CLAIM_RE =
  /\b(improves?|reduces?|prevents?|delivers?|provides?|effective|efficacy|benefit|response rate|outcome|works?)\b/i;

const RULES: RuleDef[] = [
  {
    ruleId: "off_label_language",
    title: "Potential off-label language",
    severity: "high",
    patterns: [
      /\boff[- ]label\b/i,
      /\bunapproved (use|indication)\b/i,
      /\bnot approved for\b/i,
      /\boutside (the )?label\b/i,
    ],
    rationale: "The phrasing suggests use beyond the approved label.",
    suggestion: "Re-anchor to the approved indication and invite a label-based discussion.",
  },
  {
    ruleId: "unsupported_superiority_claim",
    title: "Unsupported superiority claim",
    severity: "medium",
    patterns: [
      /\bsuperior to\b/i,
      /\bbetter than\b/i,
      /\boutperforms?\b/i,
      /\bbest[- ]in[- ]class\b/i,
      /\bnumber one\b/i,
    ],
    rationale: "Comparative claims need substantiation and careful framing.",
    suggestion: "Cite head-to-head evidence or soften to a label-supported clinical observation.",
  },
  {
    ruleId: "absolute_efficacy_claim",
    title: "Absolute efficacy claim",
    severity: "high",
    patterns: [/\b(always|never)\b/i, /\b(cures?|eliminates?)\b/i, /\b100%\b/i, /\bevery patient\b/i, /\bcompletely\b/i],
    rationale: "Absolute outcome language can overstate efficacy.",
    suggestion: "Use qualified, evidence-based wording with appropriate limitations.",
  },
  {
    ruleId: "guaranteed_or_risk_free",
    title: "Risk-free or guaranteed phrasing",
    severity: "high",
    patterns: [/\bguaranteed\b/i, /\brisk[- ]free\b/i, /\bno risk\b/i, /\bzero risk\b/i, /\bside[- ]effect[- ]free\b/i],
    rationale: "Safety and efficacy should never be framed as guaranteed or risk-free.",
    suggestion: "Acknowledge risks plainly and balance benefits with safety context.",
  },
];

function excerptFor(text: string, match: RegExpExecArray | null): string {
  if (!match || match.index == null) return text.trim().slice(0, 140);
  const start = Math.max(0, match.index - 30);
  const end = Math.min(text.length, match.index + match[0].length + 50);
  return text.slice(start, end).trim();
}

export function scanCompliance(text: string, turnId: string): ComplianceEvent[] {
  const source = text.trim();
  if (!source) return [];

  const events: ComplianceEvent[] = [];

  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      const match = pattern.exec(source);
      if (!match) continue;
      events.push({
        id: `${rule.ruleId}:${turnId}:${match.index ?? 0}`,
        turnId,
        ruleId: rule.ruleId,
        title: rule.title,
        severity: rule.severity,
        excerpt: excerptFor(source, match),
        rationale: rule.rationale,
        suggestion: rule.suggestion,
        timestamp: Date.now(),
      });
      break;
    }
  }

  if (BENEFIT_CLAIM_RE.test(source) && !SAFETY_QUALIFIER_RE.test(source)) {
    events.push({
      id: `missing_safety_qualifier:${turnId}`,
      turnId,
      ruleId: "missing_safety_qualifier",
      title: "Benefit claim without safety qualifier",
      severity: "medium",
      excerpt: source.slice(0, 140),
      rationale: "The message makes a benefit claim without balancing safety or monitoring context.",
      suggestion: "Pair benefit language with relevant safety, tolerability, or monitoring context.",
      timestamp: Date.now(),
    });
  }

  return events;
}
