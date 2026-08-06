#!/usr/bin/env node
/**
 * Triage evaluation harness.
 *
 * Scores the urgency scorer against a labelled dataset so a change to the rules
 * or the prompt produces a number instead of an opinion.
 *
 *   npm run eval           rules only — offline, deterministic, no API key
 *   npm run eval:hybrid    rules + live model signals from Groq
 *
 * The rules run also scores the pre-hybrid implementation (eval/legacyUrgency.mjs)
 * so the before/after is measured on the same cases, and exits non-zero if the
 * current scorer has regressed below that baseline.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { scoreUrgency } from '../src/utils/urgencyScorer.js'
import { calculateUrgency as legacyUrgency } from './legacyUrgency.mjs'
import { DEFAULT_BASE_URL, DEFAULT_MODEL, requestTriage } from '../src/utils/triagePrompt.js'

const here = dirname(fileURLToPath(import.meta.url))
const { cases } = JSON.parse(readFileSync(join(here, 'dataset.json'), 'utf8'))

const LEVELS = ['High', 'Medium', 'Low']
const hybrid = process.argv.includes('--hybrid')

const c = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
}

/**
 * Read a config value from the environment, falling back to .env.local so the
 * harness picks up the same settings the dev server uses.
 */
function readEnv(name) {
  const raw = process.env[name] ?? readFromEnvFile(name)
  return raw ? raw.trim().replace(/^["']|["']$/g, '') : null
}

function readFromEnvFile(name) {
  try {
    const env = readFileSync(join(here, '..', '.env.local'), 'utf8')
    const match = env.match(new RegExp(`^\\s*${name}\\s*=\\s*(.+)$`, 'm'))
    return match ? match[1] : null
  } catch {
    return null
  }
}

const MODEL = readEnv('VITE_LLM_MODEL') || DEFAULT_MODEL
const BASE_URL = readEnv('VITE_LLM_BASE_URL') || DEFAULT_BASE_URL

/**
 * Urgency errors are asymmetric: missing a real problem costs more than
 * interrupting someone over a non-problem, so the two are counted separately.
 */
function summarize(name, results) {
  const total = results.length
  const correct = results.filter((r) => r.actual === r.expected).length
  const rank = (level) => LEVELS.indexOf(level) // 0 High … 2 Low
  const under = results.filter((r) => rank(r.actual) > rank(r.expected)).length
  const over = results.filter((r) => rank(r.actual) < rank(r.expected)).length
  const missedHigh = results.filter((r) => r.expected === 'High' && r.actual !== 'High').length
  const falseHigh = results.filter((r) => r.actual === 'High' && r.expected !== 'High').length

  return {
    name, total, correct, under, over, missedHigh, falseHigh,
    accuracy: (correct / total) * 100,
  }
}

function printSummary(s) {
  const pct = s.accuracy.toFixed(1).padStart(5)
  const color = s.accuracy >= 90 ? c.green : s.accuracy >= 70 ? c.yellow : c.red
  console.log(
    `  ${s.name.padEnd(22)} ${color}${pct}%${c.reset}  ` +
    `${String(s.correct).padStart(2)}/${s.total}   ` +
    `${c.dim}under-triaged ${s.under}, over-triaged ${s.over}, ` +
    `missed High ${s.missedHigh}, false High ${s.falseHigh}${c.reset}`
  )
}

function printConfusion(results) {
  console.log(`\n  ${c.dim}expected \\ actual   High  Medium   Low${c.reset}`)
  for (const expected of LEVELS) {
    const row = LEVELS.map((actual) => {
      const n = results.filter((r) => r.expected === expected && r.actual === actual).length
      const cell = String(n).padStart(5)
      return expected === actual ? `${c.green}${cell}${c.reset}` : n > 0 ? `${c.red}${cell}${c.reset}` : `${c.dim}${cell}${c.reset}`
    }).join('  ')
    console.log(`  ${expected.padEnd(18)}${row}`)
  }
}

async function main() {
  let llmConfig = null
  if (hybrid) {
    const apiKey = readEnv('VITE_LLM_API_KEY')
    if (!apiKey) {
      console.error(
        `${c.red}No API key found.${c.reset} Set VITE_LLM_API_KEY in .env.local ` +
        `or the environment, or run \`npm run eval\` for the offline rules-only evaluation.`
      )
      process.exit(2)
    }
    llmConfig = { apiKey, baseUrl: BASE_URL, model: MODEL }
  }

  console.log(
    `\n${c.bold}Triage evaluation${c.reset} ${c.dim}— ${cases.length} labelled messages, ` +
    `${hybrid ? `hybrid (rules + ${MODEL})` : 'rules only (offline)'}${c.reset}\n`
  )

  const current = []
  const legacy = []
  const categoryResults = []
  const failures = []
  let apiErrors = 0

  for (const testCase of cases) {
    let aiSignals = null
    if (hybrid) {
      try {
        aiSignals = await requestTriage(llmConfig, testCase.message)
        categoryResults.push({
          expected: testCase.category,
          actual: aiSignals.category,
          message: testCase.message,
        })
      } catch (error) {
        apiErrors++
        console.error(`  ${c.red}API error on case ${testCase.id}:${c.reset} ${error.message}`)
        // A misconfigured key or model fails identically on all 36 cases. Say it
        // once and stop, rather than printing the same error 36 times.
        if (apiErrors >= 3 && categoryResults.length === 0) {
          console.error(
            `\n${c.red}Aborting: the first ${apiErrors} requests all failed.${c.reset} ` +
            `Fix the error above, then re-run. ` +
            `See LLM-SETUP.md, or use \`npm run eval\` for the offline evaluation.\n`
          )
          process.exit(2)
        }
      }
    }

    const assessment = scoreUrgency(testCase.message, aiSignals)
    current.push({ ...testCase, actual: assessment.level, expected: testCase.urgency, assessment })
    legacy.push({ ...testCase, actual: legacyUrgency(testCase.message), expected: testCase.urgency })

    if (assessment.level !== testCase.urgency) {
      failures.push({ testCase, assessment })
    }
  }

  const currentSummary = summarize(hybrid ? 'hybrid (current)' : 'rules (current)', current)
  const legacySummary = summarize('legacy (pre-hybrid)', legacy)

  console.log(`${c.bold}Urgency accuracy${c.reset}`)
  printSummary(legacySummary)
  printSummary(currentSummary)

  const delta = currentSummary.accuracy - legacySummary.accuracy
  const arrow = delta >= 0 ? `${c.green}+${delta.toFixed(1)}` : `${c.red}${delta.toFixed(1)}`
  console.log(`  ${c.dim}${'change'.padEnd(22)}${c.reset}${arrow} points${c.reset}`)

  printConfusion(current)

  if (failures.length > 0) {
    console.log(`\n${c.bold}Remaining misses${c.reset} ${c.dim}(${failures.length})${c.reset}`)
    for (const { testCase, assessment } of failures) {
      const detail = assessment.aiScore === null
        ? `score ${assessment.score}`
        : `score ${assessment.score} (rules ${assessment.ruleScore}, model ${assessment.aiScore})`
      console.log(
        `  ${c.dim}#${String(testCase.id).padStart(2)}${c.reset} ` +
        `${c.red}${assessment.level.padEnd(6)}${c.reset}${c.dim}want${c.reset} ${testCase.urgency.padEnd(6)} ` +
        `${c.dim}${detail}${c.reset}`
      )
      console.log(`      ${c.dim}${JSON.stringify(testCase.message.slice(0, 90))}${c.reset}`)
      const signals = assessment.signals.map((s) => `${s.label} ${s.weight > 0 ? '+' : ''}${s.weight}`)
      if (signals.length > 0) console.log(`      ${c.dim}signals: ${signals.join(', ')}${c.reset}`)
    }
  }

  if (hybrid && categoryResults.length > 0) {
    const correct = categoryResults.filter((r) => r.actual === r.expected).length
    const pct = ((correct / categoryResults.length) * 100).toFixed(1)
    console.log(
      `\n${c.bold}Category accuracy${c.reset}  ${pct}% ` +
      `${c.dim}(${correct}/${categoryResults.length})${c.reset}`
    )
    for (const r of categoryResults.filter((r) => r.actual !== r.expected)) {
      console.log(
        `  ${c.red}${r.actual.padEnd(18)}${c.reset}${c.dim}want${c.reset} ${r.expected.padEnd(18)} ` +
        `${c.dim}${JSON.stringify(r.message.slice(0, 60))}${c.reset}`
      )
    }
  }

  const divergent = current.filter((r) => r.assessment.divergent)
  if (divergent.length > 0) {
    console.log(
      `\n${c.bold}Rules/model divergence${c.reset} ${c.dim}(${divergent.length} flagged for human review)${c.reset}`
    )
    for (const r of divergent) {
      console.log(
        `  ${c.yellow}rules ${r.assessment.ruleScore} vs model ${r.assessment.aiScore}${c.reset} ` +
        `${c.dim}${JSON.stringify(r.message.slice(0, 70))}${c.reset}`
      )
    }
  }

  if (apiErrors > 0) {
    console.log(`\n${c.red}${apiErrors} case(s) failed to reach the API — results above are incomplete.${c.reset}`)
  }
  console.log()

  // Regression gate: the current scorer must not do worse than what it replaced.
  if (currentSummary.accuracy < legacySummary.accuracy) {
    console.error(`${c.red}FAIL: accuracy regressed below the pre-hybrid baseline.${c.reset}\n`)
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
