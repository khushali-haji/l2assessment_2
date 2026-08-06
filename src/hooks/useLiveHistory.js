import { useCallback, useEffect, useState } from 'react'
import { loadHistory } from '../utils/history'

/**
 * Triage history that stays current while the page is open.
 *
 * Read-once-at-mount goes stale as soon as anything else writes: run a batch in
 * another tab, or leave the Dashboard open while triaging, and the numbers on
 * screen quietly stop being true. This re-reads when the tab regains focus and
 * when another tab writes to storage.
 *
 * @returns {object[]} Stored records, oldest first
 */
export function useLiveHistory() {
  const [history, setHistory] = useState(loadHistory)

  const refresh = useCallback(() => setHistory(loadHistory()), [])

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh()
    }

    // `storage` fires in *other* tabs, `visibilitychange` covers returning to
    // this one — together they catch both ways the data can change underneath.
    window.addEventListener('storage', refresh)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('storage', refresh)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [refresh])

  return history
}
