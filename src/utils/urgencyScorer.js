/**
 * Urgency Scorer — hybrid rule + model scoring.
 *
 * Urgency drives escalation, so it is the most expensive output to get wrong: a
 * false High burns an engineer's afternoon, a false Low misses an outage. Two
 * independent estimates are combined:
 *
 *   1. Rules  — deterministic phrase matching over the raw text. Free, instant,
 *               reproducible, and works with no API key. Matching is
 *               word-boundary and negation aware, so "download" is not "down"
 *               and "the server is not down" is not an outage.
 *   2. Model  — severity / business impact / time pressure as assessed by the
 *               LLM, which actually understands the sentence. See triagePrompt.js.
 *
 * The model leads (it comprehends; keywords only pattern-match) but the rules
 * hold a floor, so an unmistakable outage phrase cannot be scored away by a
 * model that misread the message. When the two disagree sharply the result is
 * flagged `divergent` — that is a message worth a human glance, not a number to
 * average away.
 *
 * Scoring is deterministic: the same message and the same model signals always
 * produce the same result, independent of the day or time it is analyzed.
 */

const HIGH_THRESHOLD = 65
const MEDIUM_THRESHOLD = 35

// A message with no signal at all sits below Medium — "hi" is not a Medium
// priority ticket just because it exists.
const BASE_SCORE = 20

// Phrases describing an outage, lockout, or loss of data. Weighted so that one
// unambiguous hit alone reaches High.
const SEVERE = [
  'outage', 'down', 'downtime', 'offline',
  'cannot access', "can't access", 'no access', 'lost access', 'locked out',
  'cannot log in', "can't log in", 'cannot login', "can't login", 'unable to log in',
  'unable to access', 'data loss', 'lost data', 'data breach', 'security breach',
  'breach', 'hacked', 'compromised', 'unauthorized access',
  'connection lost', 'lost connection', 'unusable', 'corrupted', 'wiped',
  'nothing works', 'completely broken', 'shut down',
]

// Phrases describing a real defect that impedes work but is not a total loss.
const MODERATE = [
  'not working', 'not work', 'stopped working', "doesn't work", 'does not work',
  "won't work", "isn't working", 'broken', 'failed', 'failing', 'fails',
  // A crash confined to one screen is a bug, not an outage — the genuinely
  // total cases carry severe wording of their own ("nothing works", "unusable").
  'crash', 'crashes', 'crashed', 'crashing',
  'error', 'bug', 'stuck', 'frozen', 'hangs', 'timeout', 'timed out', 'timing out',
  "won't load", 'not loading', 'blocked', 'rejected', 'declined',
  'charged twice', 'double charged', 'overcharged', 'wrong amount',
  'unable', 'blocking us', 'blocking me',
]

// Phrases that indicate friction without describing a specific failure.
const MINOR = [
  'issue', 'problem', 'slow', 'sluggish', 'loading', 'glitch', 'confusing',
  'unexpected', 'weird', 'strange', 'delayed', 'refund', 'charged',
]

// Explicit or clearly implied deadlines.
const TIME_PRESSURE = [
  'asap', 'urgent', 'urgently', 'immediately', 'right now', 'right away',
  'as soon as possible', 'today', 'tonight', 'deadline', 'end of day', 'eod',
  'time sensitive', 'time-sensitive', 'critical', 'emergency',
]

// The normal support flow has already failed for this customer.
const IGNORED = [
  'still waiting', 'been waiting', 'waiting for days', 'no response', 'no reply',
  "haven't heard", 'have not heard',
  'nobody has replied', 'no one has replied', 'third time', 'fourth time',
  'asked twice', 'following up again', 'second follow-up', 'chasing this',
]

// Frustration. Real signal, but weak on its own — angry about a typo is still a typo.
const FRUSTRATION = [
  'unacceptable', 'ridiculous', 'furious', 'angry', 'frustrated', 'frustrating',
  'fed up', 'disappointed', 'terrible', 'awful', 'worst',
]

// Scope of the blast radius.
const BROAD_IMPACT = [
  'whole team', 'entire team', 'all our users', 'all of our users', 'our customers',
  'everyone', 'company-wide', 'all staff', 'multiple users', 'production',
  'all of our customers', 'every user',
]

// Calm, low-priority framing.
const CALM = [
  'thank', 'thanks', 'appreciate', 'love', 'great job', 'excellent', 'wonderful',
  'happy', 'no rush', 'no hurry', 'not urgent', 'whenever you get a chance',
  'just curious', 'when you have time', 'nice to have',
]

// The customer is telling us it is already over.
const RESOLVED = [
  'resolved', 'fixed now', 'already fixed', 'back up', 'working again',
  'up and running', 'no longer an issue', 'all good now', 'sorted now',
  'never mind', 'disregard',
]

const NEGATOR = /\b(not|no|never|nothing|without|avoid)\b|n['’]t\b/i

const TIERS = [
  { name: 'severe', patterns: SEVERE, weight: 45, problem: true },
  { name: 'moderate', patterns: MODERATE, weight: 18, problem: true },
  { name: 'minor', patterns: MINOR, weight: 9, problem: true },
  { name: 'ignored', patterns: IGNORED, weight: 25 },
  { name: 'timePressure', patterns: TIME_PRESSURE, weight: 15 },
  // Blast radius is a first-class urgency dimension, not a tiebreaker: the same
  // defect affecting every customer is a different ticket than one affecting one.
  { name: 'impact', patterns: BROAD_IMPACT, weight: 15 },
  { name: 'frustration', patterns: FRUSTRATION, weight: 6 },
  { name: 'calm', patterns: CALM, weight: -20 },
  { name: 'resolved', patterns: RESOLVED, weight: -30 },
]

// Ceiling per tier so a message repeating one word cannot run away with the score.
const TIER_CAPS = {
  severe: 70, moderate: 45, minor: 27, ignored: 25,
  timePressure: 30, impact: 20, frustration: 18,
  calm: -40, resolved: -30,
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Cache the compiled patterns — the tier lists are static.
const COMPILED = TIERS.map((tier) => ({
  ...tier,
  matchers: tier.patterns.map((pattern) => ({
    pattern,
    // Apostrophes vary by keyboard; match both forms.
    regex: new RegExp(`\\b${escapeRegex(pattern).replace(/'/g, "['’]")}\\b`, 'gi'),
  })),
}))

/**
 * True when the words immediately before `index` negate the phrase that follows.
 * "the server is not down" and "no issues at all" must not read as problems.
 */
function isNegated(text, index) {
  const before = text.slice(0, index).trim().split(/\s+/).slice(-4).join(' ')
  return NEGATOR.test(before)
}

/**
 * Collect every non-overlapping phrase hit, longest phrase first.
 *
 * Longest-first matching is what stops double counting: "unable to log in" is a
 * severe hit, and consuming its span prevents "unable" from also scoring as
 * moderate for the same words.
 */
function findMatches(message) {
  const candidates = []

  for (const tier of COMPILED) {
    for (const { pattern, regex } of tier.matchers) {
      regex.lastIndex = 0
      let m
      while ((m = regex.exec(message)) !== null) {
        candidates.push({
          tier: tier.name,
          weight: tier.weight,
          pattern,
          start: m.index,
          end: m.index + m[0].length,
          negated: tier.weight > 0 && isNegated(message, m.index),
        })
      }
    }
  }

  candidates.sort((a, b) => b.pattern.length - a.pattern.length || a.start - b.start)

  const taken = []
  const accepted = []
  for (const c of candidates) {
    if (taken.some((t) => c.start < t.end && c.end > t.start)) continue
    taken.push({ start: c.start, end: c.end })
    if (!c.negated) accepted.push(c)
  }

  return accepted.sort((a, b) => a.start - b.start)
}

/**
 * Deterministic, offline urgency score from the message text alone.
 *
 * @param {string} message
 * @returns {{score: number, signals: {label: string, tier: string, weight: number}[], hasProblem: boolean, hasSevere: boolean}}
 */
function scoreByRules(message) {
  const matches = findMatches(message)
  const signals = []
  const tierTotals = {}
  let score = BASE_SCORE

  for (const match of matches) {
    const cap = TIER_CAPS[match.tier]
    const used = tierTotals[match.tier] || 0
    const room = cap - used
    // Caps are negative for calm/resolved, so clamp toward zero from the right side.
    const applied = cap >= 0 ? Math.min(match.weight, room) : Math.max(match.weight, room)
    if (applied === 0) continue
    tierTotals[match.tier] = used + applied
    score += applied
    signals.push({ label: match.pattern, tier: match.tier, weight: applied })
  }

  // An unanswered ticket that is already days old is an SLA breach, and it ages
  // upward: how long the customer has waited matters, not just that they waited.
  const waitingOnUs = matches.some((m) => m.tier === 'ignored')
  const duration = /\b(?:\d+|a few|several|couple of)\s+(?:days?|weeks?)\b/i.exec(message)
  if (waitingOnUs && duration) {
    score += 8
    signals.push({ label: `waiting ${duration[0]}`, tier: 'ignored', weight: 8 })
  }

  // Sustained emphasis: shouting and exclamation marks read as frustration, but
  // they are capped hard — tone is the weakest urgency signal there is.
  const exclamations = (message.match(/!/g) || []).length
  if (exclamations > 0) {
    const points = Math.min(exclamations, 3) * 3
    score += points
    signals.push({ label: 'exclamation marks', tier: 'emphasis', weight: points })
  }

  const letters = message.replace(/[^a-zA-Z]/g, '')
  if (letters.length > 10) {
    const upper = message.replace(/[^A-Z]/g, '').length
    if (upper / letters.length > 0.7) {
      score += 8
      signals.push({ label: 'all caps', tier: 'emphasis', weight: 8 })
    }
  }

  const problemSignals = matches.filter((m) =>
    m.tier === 'severe' || m.tier === 'moderate' || m.tier === 'minor'
  )

  // A question that describes no problem is a low-priority inquiry. If the
  // customer *is* describing a problem, phrasing it as a question earns no
  // discount — "is the site down?" is not a casual enquiry.
  if (message.includes('?') && problemSignals.length === 0) {
    score -= 8
    signals.push({ label: 'question, no problem described', tier: 'inquiry', weight: -8 })
  }

  return {
    score: clamp(score),
    signals,
    hasProblem: problemSignals.length > 0,
    hasSevere: problemSignals.some((m) => m.tier === 'severe'),
  }
}

const SEVERITY_SCORE = { None: 0, Low: 15, Medium: 42, High: 70, Critical: 95 }
const IMPACT_BONUS = { None: 0, Individual: 0, Team: 10, Organization: 18 }
const TIME_BONUS = { None: 0, Soon: 8, Immediate: 16 }

/**
 * Urgency score derived from what the model understood about the message.
 * Sentiment is deliberately excluded: an angry feature request is not urgent.
 *
 * @param {{severity?: string, businessImpact?: string, timePressure?: string}} ai
 * @returns {number|null} 0-100, or null when the model supplied nothing usable
 */
function scoreByModel(ai) {
  if (!ai || typeof ai.severity !== 'string' || !(ai.severity in SEVERITY_SCORE)) return null

  const base = SEVERITY_SCORE[ai.severity]
  // Nothing is broken — scope and deadline cannot manufacture urgency.
  if (base === 0) return 0

  return clamp(base + (IMPACT_BONUS[ai.businessImpact] || 0) + (TIME_BONUS[ai.timePressure] || 0))
}

function clamp(n) {
  return Math.max(0, Math.min(100, Math.round(n)))
}

/**
 * Map a 0-100 urgency score to its level. Exported so callers can label the
 * individual rule and model scores without duplicating the thresholds.
 *
 * @param {number} score
 * @returns {"High" | "Medium" | "Low"}
 */
export function levelForScore(score) {
  if (score >= HIGH_THRESHOLD) return 'High'
  if (score >= MEDIUM_THRESHOLD) return 'Medium'
  return 'Low'
}

const toLevel = levelForScore

/**
 * @typedef {Object} UrgencyAssessment
 * @property {"High"|"Medium"|"Low"} level
 * @property {number} score           0-100, the blended score
 * @property {number} ruleScore       0-100, text rules alone
 * @property {number|null} aiScore    0-100, model signals alone (null when unavailable)
 * @property {"hybrid"|"rules"} basis Which inputs produced the level
 * @property {boolean} divergent      Rules and model reached different levels
 * @property {{label: string, tier: string, weight: number}[]} signals
 */

/**
 * Assess the urgency of a customer message.
 *
 * @param {string} message - The customer support message
 * @param {{severity?: string, businessImpact?: string, timePressure?: string}} [aiSignals]
 *        Urgency signals from the LLM. Omit to score from text rules alone.
 * @returns {UrgencyAssessment}
 */
export function scoreUrgency(message, aiSignals) {
  if (!message || !message.trim()) {
    return {
      level: 'Low', score: 0, ruleScore: 0, aiScore: null,
      basis: 'rules', divergent: false, signals: [],
    }
  }

  const rules = scoreByRules(message)
  const aiScore = scoreByModel(aiSignals)

  if (aiScore === null) {
    return {
      level: toLevel(rules.score), score: rules.score, ruleScore: rules.score,
      aiScore: null, basis: 'rules', divergent: false, signals: rules.signals,
    }
  }

  // The model comprehends the message; the rules only pattern-match. Weight
  // accordingly, but keep the rules in the blend so a model that returns a
  // confidently wrong severity is pulled back toward the observable text.
  let score = clamp(0.65 * aiScore + 0.35 * rules.score)

  // Safety floors — under-triage is the costlier error, so an unmistakable
  // signal from either side holds the result up even if the other disagrees.
  // These are deliberately symmetric: weighting the model at 0.65 otherwise lets
  // a middling model score average away a confident, correct rules verdict.
  if (aiSignals.severity === 'Critical') score = Math.max(score, HIGH_THRESHOLD)
  if (rules.hasSevere && aiScore >= SEVERITY_SCORE.High) score = Math.max(score, HIGH_THRESHOLD)
  // Rules reached High on the text alone and the model at least sees a problem.
  if (rules.score >= HIGH_THRESHOLD && aiScore >= MEDIUM_THRESHOLD) {
    score = Math.max(score, HIGH_THRESHOLD)
  }

  return {
    level: toLevel(score),
    score,
    ruleScore: rules.score,
    aiScore,
    basis: 'hybrid',
    divergent: toLevel(rules.score) !== toLevel(aiScore) && Math.abs(rules.score - aiScore) >= 25,
    signals: rules.signals,
  }
}

/**
 * Urgency level only. Thin wrapper over {@link scoreUrgency} for callers that
 * just need the label.
 *
 * @param {string} message - The customer support message
 * @param {object} [aiSignals] - Optional urgency signals from the LLM
 * @returns {"High" | "Medium" | "Low"}
 */
export function calculateUrgency(message, aiSignals) {
  return scoreUrgency(message, aiSignals).level
}
