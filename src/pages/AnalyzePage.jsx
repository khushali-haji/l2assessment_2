import { useState, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import { categorizeMessage } from '../utils/llmHelper'
import { calculateUrgency } from '../utils/urgencyScorer'
import { getRecommendedAction, getTeam } from '../utils/templates'

const urgencyStyles = {
  High: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  Medium: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  Low: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
}

const sentimentStyles = {
  Positive: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  Neutral: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  Negative: 'bg-rose-50 text-rose-700 ring-rose-600/20',
}

function AnalyzePage() {
  const [message, setMessage] = useState('')
  const [results, setResults] = useState(null)
  const [replyDraft, setReplyDraft] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [replyCopied, setReplyCopied] = useState(false)

  useEffect(() => {
    const exampleMessage = localStorage.getItem('exampleMessage')
    if (exampleMessage) {
      setMessage(exampleMessage)
      localStorage.removeItem('exampleMessage')
    }
  }, [])

  const handleAnalyze = async () => {
    if (!message.trim()) {
      setError('Please enter a message to analyze.')
      return
    }

    setError('')
    setIsLoading(true)
    setResults(null)

    try {
      const analysis = await categorizeMessage(message)
      const urgency = calculateUrgency(message)
      const recommendedAction = getRecommendedAction(analysis.category, urgency)
      const team = getTeam(analysis.category)

      const analysisResult = {
        message,
        ...analysis,
        urgency,
        recommendedAction,
        team,
        timestamp: new Date().toISOString(),
      }

      setResults(analysisResult)
      setReplyDraft(analysisResult.suggestedReply || '')

      const history = JSON.parse(localStorage.getItem('triageHistory') || '[]')
      history.push(analysisResult)
      localStorage.setItem('triageHistory', JSON.stringify(history))
    } catch (err) {
      console.error('Error analyzing message:', err)
      setError('Something went wrong while analyzing. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  // ⌘/Ctrl + Enter to analyze.
  const handleKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleAnalyze()
    }
  }

  const handleClear = () => {
    setMessage('')
    setResults(null)
    setReplyDraft('')
    setError('')
  }

  const handleCopy = () => {
    const text = `Category: ${results.category}\nUrgency: ${results.urgency}\nSentiment: ${results.sentiment}\nRoute to: ${results.team}\nRecommendation: ${results.recommendedAction}\n\nReasoning: ${results.reasoning}`
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleCopyReply = () => {
    navigator.clipboard.writeText(replyDraft)
    setReplyCopied(true)
    setTimeout(() => setReplyCopied(false), 2000)
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Analyze message</h1>
        <p className="mt-1 text-sm text-slate-500">
          Paste a customer message to categorize and prioritize it automatically.
        </p>
      </header>

      {/* Input */}
      <div className="surface p-5">
        <div className="mb-1.5 flex items-center justify-between">
          <label htmlFor="message" className="text-sm font-medium text-slate-700">
            Customer message
          </label>
          <span className="text-xs tabular-nums text-slate-400">{message.length} chars</span>
        </div>
        <textarea
          id="message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Paste customer message here…"
          className="h-40 w-full resize-none rounded-xl border border-slate-200 bg-white p-3.5 text-sm text-slate-900 placeholder:text-slate-400 transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          disabled={isLoading}
        />

        {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}

        <div className="mt-4 flex items-center gap-2">
          <button onClick={handleAnalyze} disabled={isLoading} className="btn-primary flex-1">
            {isLoading ? (
              <>
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Analyzing…
              </>
            ) : (
              'Analyze message'
            )}
          </button>
          <button onClick={handleClear} disabled={isLoading} className="btn-ghost">
            Clear
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Tip: press <kbd className="rounded border border-slate-200 bg-slate-50 px-1 font-sans">⌘</kbd>
          +<kbd className="rounded border border-slate-200 bg-slate-50 px-1 font-sans">Enter</kbd> to analyze.
        </p>
      </div>

      {/* Results */}
      {results && (
        <div className="surface mt-6 p-5">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Results</h2>
            <button onClick={handleCopy} className="btn-ghost px-3 py-1.5 text-xs">
              {copied ? 'Copied ✓' : 'Copy summary'}
            </button>
          </div>

          {results.source === 'mock' && (
            <div className="mb-5 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-inset ring-amber-600/10">
              AI service was unavailable — this result came from the offline keyword fallback, not the AI model.
            </div>
          )}

          {results.urgency === 'High' && (
            <div className="mb-5 rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700 ring-1 ring-inset ring-rose-600/10">
              High urgency — escalate to a human agent now.
            </div>
          )}

          {/* Summary */}
          {results.summary && (
            <p className="mb-5 text-base text-slate-800">{results.summary}</p>
          )}

          {/* Badges */}
          <div className="mb-6 flex flex-wrap gap-x-6 gap-y-4">
            <div>
              <div className="mb-1.5 text-xs font-medium text-slate-400">Category</div>
              <span className="inline-flex rounded-lg bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 ring-1 ring-inset ring-indigo-600/10">
                {results.category}
              </span>
            </div>
            <div>
              <div className="mb-1.5 text-xs font-medium text-slate-400">Urgency</div>
              <span
                className={`inline-flex rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-inset ${
                  urgencyStyles[results.urgency] || urgencyStyles.Low
                }`}
              >
                {results.urgency}
              </span>
            </div>
            <div>
              <div className="mb-1.5 text-xs font-medium text-slate-400">Sentiment</div>
              <span
                className={`inline-flex rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-inset ${
                  sentimentStyles[results.sentiment] || sentimentStyles.Neutral
                }`}
              >
                {results.sentiment}
              </span>
            </div>
            <div>
              <div className="mb-1.5 text-xs font-medium text-slate-400">Route to</div>
              <span className="inline-flex rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-500/10">
                {results.team}
              </span>
            </div>
            {typeof results.confidence === 'number' && (
              <div>
                <div className="mb-1.5 text-xs font-medium text-slate-400">Confidence</div>
                <span className="inline-flex rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium tabular-nums text-slate-700 ring-1 ring-inset ring-slate-500/10">
                  {results.confidence}%
                </span>
              </div>
            )}
            {results.language && results.language !== 'Unknown' && (
              <div>
                <div className="mb-1.5 text-xs font-medium text-slate-400">Language</div>
                <span className="inline-flex rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-500/10">
                  {results.language}
                </span>
              </div>
            )}
          </div>

          {/* Tags */}
          {results.tags?.length > 0 && (
            <div className="mb-5 flex flex-wrap gap-1.5">
              {results.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-md bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-500 ring-1 ring-inset ring-slate-200"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}

          {/* Recommended action */}
          <div className="mb-5">
            <div className="mb-1.5 text-xs font-medium text-slate-400">Recommended action</div>
            <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
              {results.recommendedAction}
            </p>
          </div>

          {/* Suggested reply (editable) */}
          {(replyDraft || results.suggestedReply) && (
            <div className="mb-5">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-medium text-slate-400">Suggested reply</span>
                <button onClick={handleCopyReply} className="btn-ghost px-3 py-1 text-xs">
                  {replyCopied ? 'Copied ✓' : 'Copy reply'}
                </button>
              </div>
              <textarea
                value={replyDraft}
                onChange={(e) => setReplyDraft(e.target.value)}
                className="h-32 w-full resize-none rounded-xl border border-slate-200 bg-white p-3.5 text-sm text-slate-700 transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
            </div>
          )}

          {/* Reasoning */}
          <div>
            <div className="mb-1.5 text-xs font-medium text-slate-400">AI reasoning</div>
            <div className="prose prose-sm max-w-none rounded-xl bg-slate-50 p-4 text-slate-700 prose-p:my-1">
              <ReactMarkdown>{results.reasoning}</ReactMarkdown>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AnalyzePage
