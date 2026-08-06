/**
 * The triage contract shared by the browser app and the offline eval harness.
 *
 * Both the running app (src/utils/llmHelper.js) and `npm run eval:hybrid`
 * (eval/run.mjs) send this prompt and parse the response with the same code, so
 * the numbers the harness reports describe the behaviour users actually get.
 */

/**
 * Provider defaults. Both are overridable per environment — the app reads Vite's
 * import.meta.env, the eval harness reads process.env / .env.local — so this
 * module stays free of any env access and runs unchanged in the browser and Node.
 *
 * Any OpenAI-compatible chat-completions endpoint works here (OpenRouter, Groq,
 * a local server); only the base URL, key, and model ID differ.
 */
export const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'
export const DEFAULT_MODEL = 'meta-llama/llama-3.3-70b-instruct'

/**
 * Request a triage assessment from an OpenAI-compatible chat-completions endpoint.
 *
 * Uses plain fetch rather than a vendor SDK: the request is one JSON POST, and
 * vendor SDKs hardcode their own provider's URL path onto the base URL, which
 * silently breaks when pointed at a different provider.
 *
 * Rate limits and transient server errors are retried with exponential backoff:
 * batch triage and the eval harness both issue many requests in a row, and a
 * 429 there means "wait a moment", not "this message cannot be classified".
 *
 * @param {{apiKey: string, baseUrl?: string, model?: string, headers?: Record<string,string>, retries?: number}} config
 * @param {string} message - The customer support message
 * @returns {Promise<TriageResult>}
 */
export async function requestTriage(config, message) {
  const baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')
  const maxAttempts = (config.retries ?? 3) + 1

  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        ...config.headers,
      },
      body: JSON.stringify({
        model: config.model || DEFAULT_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: message },
        ],
        temperature: 0, // deterministic classification
        response_format: { type: 'json_object' },
      }),
    })

    if (response.ok) {
      const body = await response.json()
      return parseTriageResponse(body.choices?.[0]?.message?.content ?? '')
    }

    // Surface the provider's own explanation — "key limit exceeded" and
    // "model not found" need very different fixes, and a generic
    // "request failed" sends you looking in the wrong place.
    const detail = await response.text()
    let reason = detail.slice(0, 200)
    try {
      reason = JSON.parse(detail).error?.message ?? reason
    } catch {
      // Non-JSON body (usually an HTML error page) — the raw excerpt is the best clue.
    }

    const retriable = response.status === 429 || response.status >= 500
    if (!retriable || attempt >= maxAttempts) {
      throw new Error(`${response.status} ${reason}`)
    }

    await sleep(backoffMs(response.headers.get('retry-after'), attempt))
  }
}

/**
 * Delay before the next attempt: honour the provider's Retry-After when given,
 * otherwise exponential backoff with jitter so parallel workers that were rate
 * limited together do not all retry on the same tick.
 */
function backoffMs(retryAfterHeader, attempt) {
  const retryAfter = Number(retryAfterHeader)
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, 20000)
  }
  return Math.min(500 * 2 ** (attempt - 1), 8000) + Math.random() * 400
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// The fixed set of categories the model is allowed to return. Kept in sync with
// the recommendation templates so every category maps to an action.
export const CATEGORIES = [
  'Billing Issue',
  'Technical Problem',
  'Feature Request',
  'General Inquiry',
  'Unknown',
]

export const SENTIMENTS = ['Positive', 'Neutral', 'Negative']

// Urgency inputs the model supplies. Scoring lives in urgencyScorer.js — the
// model reports what it observed, it does not pick the final urgency level.
export const SEVERITIES = ['None', 'Low', 'Medium', 'High', 'Critical']
export const IMPACTS = ['None', 'Individual', 'Team', 'Organization']
export const TIME_PRESSURES = ['None', 'Soon', 'Immediate']

export const SYSTEM_PROMPT = `You are a customer support triage assistant. Analyze the customer's message and return a structured assessment.

Allowed categories (use these exact strings):
- "Billing Issue": payments, invoices, charges, refunds, subscriptions, account billing.
- "Technical Problem": bugs, errors, outages, broken or non-working functionality.
- "Feature Request": suggestions, enhancements, or requests for new functionality.
- "General Inquiry": questions, how-to, general information, or positive feedback.
- "Unknown": the message is unclear or does not fit the categories above.

You also report three urgency signals. Judge them from what the message describes, not from how politely or angrily it is written — an furious complaint about a typo is not severe, and a calm "we are all locked out" is.

"severity" — how badly the customer is blocked right now:
- "None": nothing is broken (praise, a question, a suggestion, a resolved issue).
- "Low": a minor annoyance; an easy workaround exists.
- "Medium": a real defect that impedes normal use but work can continue.
- "High": the customer cannot complete an important task.
- "Critical": outage, data loss, security breach, or total loss of access.

"businessImpact" — who is affected:
- "None", "Individual" (one person), "Team" (a group), "Organization" (everyone / production).

"timePressure" — how soon a response is needed, based on stated or clearly implied deadlines:
- "None", "Soon" (hours to days, or the customer is already waiting on a reply), "Immediate" (right now).

Important: if the customer says the problem is already fixed, resolved, or no longer happening, severity is "None" and timePressure is "None", however dramatic the wording.

Respond ONLY with a JSON object of this exact shape:
{
  "category": "<one of the allowed categories>",
  "sentiment": "<Positive | Neutral | Negative>",
  "severity": "<None | Low | Medium | High | Critical>",
  "businessImpact": "<None | Individual | Team | Organization>",
  "timePressure": "<None | Soon | Immediate>",
  "summary": "<a single concise sentence summarizing what the customer wants>",
  "tags": ["<2-4 short lowercase topic tags>"],
  "language": "<the language the message is written in, e.g. English>",
  "confidence": <integer 0-100, your confidence in the category>,
  "reasoning": "<one or two sentences explaining the classification and the severity>",
  "suggestedReply": "<a polite, ready-to-send draft reply to the customer, 2-4 sentences>"
}`

/**
 * @typedef {Object} TriageResult
 * @property {string} category
 * @property {"Positive"|"Neutral"|"Negative"} sentiment
 * @property {"None"|"Low"|"Medium"|"High"|"Critical"} severity
 * @property {"None"|"Individual"|"Team"|"Organization"} businessImpact
 * @property {"None"|"Soon"|"Immediate"} timePressure
 * @property {string} summary
 * @property {string[]} tags
 * @property {string} language
 * @property {number|null} confidence    0-100
 * @property {string} reasoning
 * @property {string} suggestedReply
 * @property {"ai"|"mock"} source
 */

/**
 * Parse and normalize a raw model response into a TriageResult.
 * Any field the model omits or malforms falls back to a safe default rather
 * than propagating undefined into the scorer.
 *
 * @param {string} content - Raw JSON string from the model
 * @returns {TriageResult}
 */
export function parseTriageResponse(content) {
  const parsed = JSON.parse(content)
  const oneOf = (allowed, value, fallback) =>
    allowed.includes(value) ? value : fallback

  return {
    category: oneOf(CATEGORIES, parsed.category, 'Unknown'),
    sentiment: oneOf(SENTIMENTS, parsed.sentiment, 'Neutral'),
    severity: oneOf(SEVERITIES, parsed.severity, 'None'),
    businessImpact: oneOf(IMPACTS, parsed.businessImpact, 'None'),
    timePressure: oneOf(TIME_PRESSURES, parsed.timePressure, 'None'),
    summary: cleanString(parsed.summary) || 'No summary provided.',
    tags: normalizeTags(parsed.tags),
    language: cleanString(parsed.language) || 'Unknown',
    confidence: clampConfidence(parsed.confidence),
    reasoning: cleanString(parsed.reasoning) || 'No reasoning provided by the model.',
    suggestedReply: cleanString(parsed.suggestedReply) || '',
    source: 'ai',
  }
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return []
  return tags
    .filter((t) => typeof t === 'string' && t.trim())
    .map((t) => t.trim().toLowerCase())
    .slice(0, 4)
}

function clampConfidence(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.min(100, Math.round(n)))
}
