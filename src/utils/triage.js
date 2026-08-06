import { categorizeMessage } from './llmHelper'
import { scoreUrgency } from './urgencyScorer'
import { getRecommendedAction, getTeam } from './templates'

/**
 * The full triage pipeline for one message: classify, score urgency, route.
 *
 * Shared by the single-message Analyze page and the batch Queue so both produce
 * identical records — a message triaged in a batch must be indistinguishable
 * from the same message triaged on its own.
 *
 * @param {string} message - The customer support message
 * @returns {Promise<object>} A history record
 */
export async function triageMessage(message) {
  const analysis = await categorizeMessage(message)
  // Urgency blends the model's severity / impact / time-pressure reading with
  // deterministic text rules — see urgencyScorer.js.
  const urgency = scoreUrgency(message, analysis)

  return {
    message,
    ...analysis,
    urgency: urgency.level,
    urgencyDetail: {
      score: urgency.score,
      ruleScore: urgency.ruleScore,
      aiScore: urgency.aiScore,
      basis: urgency.basis,
      divergent: urgency.divergent,
    },
    recommendedAction: getRecommendedAction(analysis.category, urgency.level),
    team: getTeam(analysis.category),
    timestamp: new Date().toISOString(),
  }
}

/**
 * Run `task` over `items` with a bounded number in flight.
 *
 * Batches are the whole point of the queue, but firing fifty requests at once
 * gets you rate limited rather than served. Results keep input order regardless
 * of completion order.
 *
 * @template T, R
 * @param {T[]} items
 * @param {(item: T, index: number) => Promise<R>} task
 * @param {{limit?: number, onSettled?: (result: R, index: number) => void, shouldStop?: () => boolean}} [options]
 * @returns {Promise<R[]>}
 */
export async function runPooled(items, task, options = {}) {
  const { limit = 3, onSettled, shouldStop } = options
  const results = new Array(items.length)
  let cursor = 0

  async function worker() {
    while (cursor < items.length) {
      if (shouldStop?.()) return
      const index = cursor++
      const result = await task(items[index], index)
      results[index] = result
      onSettled?.(result, index)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  )
  return results
}

/**
 * Split pasted text into individual messages.
 *
 * Blank lines separate messages, because a single customer message often spans
 * several lines. Text with no blank line at all is treated as one message per
 * line, which is what a list pasted from a spreadsheet looks like.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function splitMessages(text) {
  const trimmed = (text || '').trim()
  if (!trimmed) return []

  const separator = /\n\s*\n/.test(trimmed) ? /\n\s*\n+/ : /\n+/
  return trimmed
    .split(separator)
    .map((part) => part.trim())
    .filter(Boolean)
}

/**
 * Pull messages out of an imported JSON file.
 * Accepts an array of strings, an array of objects with a `message` field, or
 * an object wrapping such an array (the shape of sample-messages.json).
 *
 * @param {string} raw - File contents
 * @returns {string[]}
 * @throws {Error} When no messages can be found
 */
export function parseImportedJson(raw) {
  const data = JSON.parse(raw)
  const list = Array.isArray(data)
    ? data
    : Object.values(data).find((value) => Array.isArray(value))

  if (!Array.isArray(list)) {
    throw new Error('Expected an array of messages, or an object containing one.')
  }

  const messages = list
    .map((item) => (typeof item === 'string' ? item : item?.message))
    .filter((message) => typeof message === 'string' && message.trim())
    .map((message) => message.trim())

  if (messages.length === 0) {
    throw new Error('No messages found — expected strings, or objects with a "message" field.')
  }
  return messages
}
