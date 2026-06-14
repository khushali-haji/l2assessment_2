/**
 * Urgency Scorer - Rule-based urgency calculation
 *
 * Scores a customer message on what actually signals urgency: severity of the
 * problem described, explicit time pressure, and frustration. Scoring is
 * deterministic — the same message always produces the same result, independent
 * of the day/time it is analyzed.
 */

// Words that signal a severe, business-impacting problem.
const CRITICAL_KEYWORDS = [
  'down', 'outage', 'offline', 'crash', 'crashed', 'critical', 'emergency',
  'urgent', 'asap', 'immediately', 'cannot access', "can't access", 'cant access',
  'locked out', 'data loss', 'lost data', 'security', 'breach', 'hacked',
  'not working', 'broken', 'failed', 'failing', 'production',
]

// Words that signal a real but less severe problem.
const ELEVATED_KEYWORDS = [
  'error', 'bug', 'issue', 'problem', 'slow', 'loading', 'timeout', 'timing out',
  'stuck', 'refund', 'charged', 'overcharged', 'unable',
]

// Words that signal the message is calm / low priority.
const POSITIVE_KEYWORDS = [
  'thank', 'thanks', 'appreciate', 'love', 'great', 'excellent', 'wonderful', 'happy',
]

function countMatches(text, keywords) {
  return keywords.reduce((count, word) => (text.includes(word) ? count + 1 : count), 0)
}

/**
 * Calculate the urgency level of a message.
 *
 * @param {string} message - The customer support message
 * @returns {"High" | "Medium" | "Low"}
 */
export function calculateUrgency(message) {
  if (!message || !message.trim()) return 'Low'

  const text = message.toLowerCase()
  let score = 40

  // Severity of the described problem is the strongest signal.
  score += countMatches(text, CRITICAL_KEYWORDS) * 30
  score += countMatches(text, ELEVATED_KEYWORDS) * 12

  // Emphasis (exclamation marks, sustained shouting) raises urgency, capped so
  // a wall of "!!!" can't dominate the real signal.
  const exclamations = (message.match(/!/g) || []).length
  score += Math.min(exclamations, 3) * 8

  const letters = message.replace(/[^a-zA-Z]/g, '')
  if (letters.length > 10) {
    const upper = message.replace(/[^A-Z]/g, '').length
    if (upper / letters.length > 0.7) score += 15 // shouting = frustration
  }

  // Calm / appreciative language lowers urgency.
  score -= countMatches(text, POSITIVE_KEYWORDS) * 15

  // A polite question with no problem signal is usually a low-priority inquiry,
  // but only nudge — it should never override a genuine problem.
  if (message.includes('?') && countMatches(text, CRITICAL_KEYWORDS) === 0) {
    score -= 10
  }

  if (score >= 70) return 'High'
  if (score >= 40) return 'Medium'
  return 'Low'
}
