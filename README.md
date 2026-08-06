# Customer Inbox Triage App

## Overview

The Customer Inbox Triage app classifies customer support messages, scores how urgent they are, and
routes them to the right team. It triages one message at a time or a whole batch, and its triage
quality is measured against a labelled dataset rather than assumed.

An LLM reads each message and reports what it observed; deterministic rules read the same text
independently; the two are blended into an urgency score. Where they disagree, the app says so
instead of averaging the disagreement away.

## Problem Statement

Support teams waste time manually reading and triaging customer messages. This tool provides an automated first pass at classification to help prioritize and route messages more efficiently.

## Tech Stack

- **Frontend**: React + Vite + Tailwind CSS
- **AI**: Any OpenAI-compatible endpoint (OpenRouter by default, Llama 3.3 70B)
- **Runtime**: Browser-based (local development only)

## Setup Instructions

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- An LLM API key (get one from https://openrouter.ai/keys)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd "L2 assessment"
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure your API key**
   
   Create a `.env.local` file in the root directory:
   ```bash
   cp .env.example .env.local
   ```
   
   Edit `.env.local` and add your key:
   ```
   VITE_LLM_API_KEY=sk-or-v1-your-actual-key-here
   ```
   
   Get a key from: https://openrouter.ai/keys
   
   Any OpenAI-compatible endpoint works — set `VITE_LLM_BASE_URL` and `VITE_LLM_MODEL` to point
   at a different provider or model. See [LLM-SETUP.md](LLM-SETUP.md) for details and
   troubleshooting.

4. **Run the application**
   ```bash
   npm run dev
   ```
   
   The app will be available at `http://localhost:5173`

## How It Works

Triage is a pipeline, not a set of independent checks — each step consumes the one before it
(`src/utils/triage.js`):

1. **Input** — paste one message on **Analyze**, or a batch on **Queue**.
2. **Classification (LLM)** — one call returns the category, sentiment, a summary, a drafted reply,
   and three urgency observations: `severity`, `businessImpact`, `timePressure`.
3. **Urgency scoring (hybrid)** — those model observations are blended with deterministic text
   rules. This step *depends* on step 2; it is not run in parallel with it.
4. **Routing and recommendation (templates)** — category maps to an owning team and a next action,
   escalated when urgency is High.
5. **Persistence** — results are written to `localStorage` and shown in **History** and
   **Dashboard**.

If the LLM call fails, steps 3–5 still run using the offline keyword fallback and rules-only
scoring, and every surface that displays the result says so.

### Pages

| Page | Purpose |
|---|---|
| **Analyze** | One message, full detail: badges, score breakdown, editable reply draft, reasoning |
| **Queue** | Batch triage, grouped worst-first — see [Batch Triage](#batch-triage) |
| **History** | Searchable, filterable log of past analyses, exportable to CSV |
| **Dashboard** | Category distribution, urgency breakdown, volume stats |

## Batch Triage

The **Queue** tab triages many messages in one pass, because an inbox is the actual unit of work —
one-at-a-time analysis is slower than just reading the messages.

- Paste messages separated by blank lines, or **Import JSON** (an array of strings, or of objects
  with a `message` field — `sample-messages.json` in this repo works as-is).
- Analyses run a few at a time and stream in as they land, with progress and a working **Cancel**.
  Cancelling keeps the results already paid for.
- Output is grouped **High → Medium → Low** and sorted by score within each group, so the queue
  answers "what do I pick up next" rather than "what did I do most recently".
- Rows flag `signals disagree` (rules and model diverged) and `offline fallback` (that message was
  keyword-scored because the API call failed), so a degraded result is never presented as an AI one.
- Everything is written to History, so the Dashboard picks it up.

Re-analyzing a message **replaces** its earlier record rather than adding a second one — a message
is a thing, not an event, so re-running a batch to compare models does not silently double every
count. The Queue reports how many records it replaced.

Rate limits are retried with exponential backoff, honouring `Retry-After` — in a batch a 429 means
"wait a moment", not "this message cannot be classified".

## Urgency Scoring

Urgency drives escalation, so it is the most expensive output to get wrong — a false High burns an
engineer's afternoon, a false Low misses an outage. It is scored from two independent estimates
(`src/utils/urgencyScorer.js`):

| | What it contributes | Cost |
|---|---|---|
| **Text rules** | Phrase matching over the raw message, with word boundaries and negation detection, weighted by severity, blast radius, deadline, and whether support has already failed to reply | Free, instant, deterministic, works with no API key |
| **Model signals** | `severity`, `businessImpact` and `timePressure` as assessed by the LLM, which actually understands the sentence | One API call (already being made for categorization) |

The model leads the blend — it comprehends, keywords only pattern-match — but the rules hold a
floor, so an unmistakable outage phrase cannot be scored away by a model that misread the message.
Where the two reach different conclusions the result is flagged **divergent** and surfaced in the
UI, rather than quietly averaged: a message the two halves disagree about is usually one worth a
human glance.

Sentiment is deliberately excluded from urgency. An angry message about a typo is still a typo.

When the API is unavailable the app falls back to rules-only scoring, and the UI says so.

## Evaluation

Triage quality is measured against a labelled dataset (`eval/dataset.json`, 36 messages) so a change
to the rules or the prompt produces a number rather than an opinion.

```bash
npm run eval          # rules only — offline, deterministic, no API key needed
npm run eval:hybrid   # rules + live model signals (requires a working API key)
```

The report gives accuracy, a confusion matrix, and every remaining miss with the signals that
produced it. Because urgency errors are asymmetric, under- and over-triage are counted separately —
a scorer that never misses a High but cries wolf constantly is not a good scorer.

Each run also scores the pre-hybrid implementation (`eval/legacyUrgency.mjs`) on the same cases, so
the before/after is measured rather than asserted, and **exits non-zero if accuracy regresses below
that baseline** — usable as a CI gate.

Current results, rules only:

```
legacy (pre-hybrid)     58.3%  21/36   under-triaged 5, over-triaged 10, missed High 5, false High 6
rules (current)         88.9%  32/36   under-triaged 4, over-triaged 0,  missed High 3, false High 0
```

Every remaining miss is under-triage on a problem described without any conventional keyword
("logins from a country I have never been to", "throwing 502s"). That is the limit of what text
rules can do, and precisely what the model half of the blend is there for.

A hybrid run on a small free model (`openai/gpt-oss-20b:free`) reached the same 88.9%, but with a
better error profile: **no High message was scored Low** (the rules-only run scores two of them
Low), and three genuinely ambiguous messages were flagged divergent for human review. That run was
partial — 14 of 36 calls hit free-tier rate limits and fell back to rules — so it is a smoke test,
not a measurement. Re-run it on a paid model for a real number.

To add a case, drop it into `eval/dataset.json` with the urgency a support lead would assign.
Cases the scorer gets wrong belong in the set — they are not relabelled to make the number look
better.


## Interface Notes

Decisions that are not obvious from the screenshots:

- **Results announce themselves.** After analysis the panel is scrolled into view, focus moves to
  it, and it sits in an `aria-live` region. Without this the result renders below the fold and the
  page looks unchanged after a multi-second wait.
- **Loading has a shape.** A skeleton mirroring the result card fills the wait, so the layout does
  not jump when content lands.
- **Motion is decoration, never the only cue.** Entrances are staggered so lists read as a sequence
  rather than one flash, and everything collapses under
  `prefers-reduced-motion: reduce`. Every state an animation conveys is also stated in text.
- **Text areas grow with their content**, capped before they push the controls off screen.
- **Counts stay live.** Home and Dashboard re-read history when the tab regains focus or another
  tab writes, instead of going stale at mount.
- **Degraded results are labelled, never disguised.** `offline fallback` means keyword scoring;
  `signals disagree` means rules and model diverged; `rules only` under the urgency badge means no
  model input reached the score.

## Project Structure

```
src/
  pages/          Analyze · Queue · History · Dashboard · Home
  components/     Navigation, AutoTextarea, ResultsSkeleton
  hooks/          useLiveHistory — history that refreshes on focus / cross-tab writes
  utils/
    triagePrompt.js   Prompt, response parsing, and the HTTP call (with retry).
                      Shared by the app and the eval harness so measured
                      accuracy reflects real behaviour.
    urgencyScorer.js  Hybrid urgency scoring: rules + model signals
    triage.js         The pipeline, plus batch pooling and input parsing
    templates.js      Category → team and recommended action
    llmHelper.js      Browser client and the offline keyword fallback
    history.js        localStorage persistence, dedupe, quota handling
eval/
  dataset.json      36 labelled messages
  run.mjs           Scoring harness and regression gate
  legacyUrgency.mjs Pre-hybrid scorer, kept as the measured baseline
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on http://localhost:5173 |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run eval` | Offline urgency evaluation — no API key needed |
| `npm run eval:hybrid` | Evaluation with live model signals |

## Example Test Messages

The labelled set in `eval/dataset.json` doubles as a demo — import it on the **Queue** tab, or
`sample-messages.json` for a shorter batch. Two cases worth trying on **Analyze**, because they show
what the hybrid scoring is for:

```
How do I download my invoice?
```
Scores **Low**. The pre-hybrid scorer marked this **High** and fired "escalate to a human agent
now", because `download` contains `down`.

```
I think someone else accessed my account — there are logins from a country I have never been to.
```
Scores **High** and is flagged **divergent**: the text rules find no urgent keyword at all (score
20), the model recognises a security breach (score 100). Neither half gets this right alone.

## Security Note

⚠️ **Warning**: This application sends the API key directly from the browser, so anyone who opens
devtools can read it. This is acceptable for local development only and should **NEVER** be done in
production. In a real application the call in `requestTriage()` would move behind a backend endpoint
that holds the key server-side.

## Switching Providers

The app is not tied to any one vendor — it speaks the OpenAI chat-completions protocol, so
`VITE_LLM_BASE_URL`, `VITE_LLM_MODEL` and `VITE_LLM_API_KEY` are all you need to change to move
between OpenRouter, Groq, or a local server. Because the eval harness reads the same variables,
you can compare candidates on measured triage accuracy rather than on vendor claims:

```bash
VITE_LLM_MODEL=meta-llama/llama-3.3-70b-instruct npm run eval:hybrid
VITE_LLM_MODEL=anthropic/claude-sonnet-4.5       npm run eval:hybrid
```

## License

This project is for educational purposes only.
