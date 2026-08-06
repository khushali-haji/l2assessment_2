/**
 * Persistence for triage records.
 *
 * localStorage is the store, which means a hard size ceiling. Batch runs can add
 * dozens of records at once, so writes are capped and quota failures are
 * reported rather than thrown into the caller's analysis path — a full store
 * must not make a successful analysis look like a failed one.
 */

const KEY = 'triageHistory'

// Roughly the number of records that fits comfortably under a 5MB quota with
// room to spare for long messages and drafted replies.
const MAX_RECORDS = 500

/**
 * @returns {object[]} Stored records, oldest first. Never throws.
 */
export function loadHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    // Corrupt or unreadable storage should not take down the page.
    return []
  }
}

/**
 * Append records, trimming the oldest once the cap is reached.
 *
 * A message is a thing, not an event: re-analyzing the same text replaces its
 * earlier record rather than adding a second one. Without this, re-running a
 * batch to compare models silently doubles History and skews every Dashboard
 * count.
 *
 * @param {object[]} records
 * @returns {{saved: boolean, error?: string, dropped: number, replaced: number}}
 */
export function appendHistory(records) {
  if (!records || records.length === 0) return { saved: true, dropped: 0, replaced: 0 }

  const incoming = new Set(records.map((record) => record.message))
  const existing = loadHistory()
  const kept = existing.filter((record) => !incoming.has(record.message))
  const replaced = existing.length - kept.length

  const combined = [...kept, ...records]
  const dropped = Math.max(0, combined.length - MAX_RECORDS)
  const trimmed = dropped > 0 ? combined.slice(dropped) : combined

  try {
    localStorage.setItem(KEY, JSON.stringify(trimmed))
    return { saved: true, dropped, replaced }
  } catch (error) {
    // Most likely QuotaExceededError. Retry with only the newest records so the
    // current run is not lost entirely.
    try {
      const recent = combined.slice(-Math.min(records.length, 50))
      localStorage.setItem(KEY, JSON.stringify(recent))
      return { saved: true, dropped: combined.length - recent.length, replaced }
    } catch {
      return { saved: false, error: error.message, dropped: 0, replaced: 0 }
    }
  }
}

/** Remove all stored records. */
export function clearHistory() {
  localStorage.setItem(KEY, '[]')
}
