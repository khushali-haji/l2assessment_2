# Setting Up Your LLM API Key

The app talks to any **OpenAI-compatible chat-completions endpoint**. OpenRouter is the default —
one key gives access to models from every major provider, which matters here because
`npm run eval:hybrid` lets you compare them on real triage accuracy.

## Step-by-Step Setup (OpenRouter)

### 1. Get Your API Key

1. Go to https://openrouter.ai/keys
2. Sign in (Google/GitHub/email)
3. Click **Create Key**, give it a name (e.g. "Customer Triage App")
4. **Copy the key** — it starts with `sk-or-v1-`

Save it somewhere safe; you won't be able to see it again.

### 1a. Give the Key a Spend Limit

By default a new key can be created with a limit of `0`, which blocks every paid model with
`403 Key limit exceeded` even though the key itself is valid. At
https://openrouter.ai/settings/keys, set the key's limit above zero (and add account credit).

To skip this entirely, use a free model — see [Choosing a Model](#choosing-a-model). Free models
work even on a zero-limit key, but are heavily rate limited.

### 2. Add It to Your Project

Create or edit **`.env.local`** in the project root — the same folder as `package.json`:

```
VITE_LLM_API_KEY=sk-or-v1-your-actual-key-here
```

That's the only required line. If the file still has a `VITE_GROQ_API_KEY=...` line, delete it —
it is no longer read.

⚠️ **Check the capitalisation.** OpenRouter keys are entirely lowercase and begin `sk-or-v1-`.
Editors and phone keyboards like to autocapitalise the first letter, and `Sk-or-v1-…` fails with a
misleading `401 Missing Authentication header` rather than an obvious "bad key".

### 3. Restart the Dev Server

Vite only reads `.env.local` at startup, so the change needs a restart:

```bash
npm run dev
```

### 4. Test It

1. Open http://localhost:5173
2. Go to the **Analyze** tab
3. Paste `Our production server is down` and click **Analyze message**
4. Under the Urgency badge you should see **"AI + rules"** — that confirms the key is working.
   If it says **"rules only"**, the API call failed and you're seeing the offline fallback (the
   results panel shows an amber banner explaining this).

You can also verify from the terminal, which prints the exact error on failure:

```bash
npm run eval:hybrid
```

## Choosing a Model

The default is `meta-llama/llama-3.3-70b-instruct`. To use a different one, add to `.env.local`:

```
VITE_LLM_MODEL=anthropic/claude-sonnet-4.5
```

Browse available IDs at https://openrouter.ai/models. Free options (no credit needed, but tightly
rate limited — a 36-case eval run will hit 429s partway through) include `openai/gpt-oss-20b:free`
and `nvidia/nemotron-3-super-120b-a12b:free`. Since triage quality *is* the product, the
useful way to pick is to measure rather than guess:

```bash
VITE_LLM_MODEL=meta-llama/llama-3.3-70b-instruct npm run eval:hybrid
VITE_LLM_MODEL=anthropic/claude-sonnet-4.5       npm run eval:hybrid
```

Compare the urgency and category accuracy each reports on the same 36 labelled messages.

## Using a Different Provider

Override the base URL to point anywhere OpenAI-compatible:

```
# Groq
VITE_LLM_BASE_URL=https://api.groq.com
VITE_LLM_MODEL=llama-3.3-70b-versatile
VITE_LLM_API_KEY=gsk_your-key-here
```

The same three variables are read by both the app and the eval harness.

## Troubleshooting

### Results always say "rules only"

The API call is failing and the app has fallen back to offline keyword scoring. Check the browser
console for the reason, or run `npm run eval:hybrid` to see the raw error. Usual causes:

- The file is named `.env` instead of `.env.local`
- The dev server wasn't restarted after adding the key
- Stray quotes or spaces around the value

### 401 Unauthorized / `expired_api_key`

The key is invalid, revoked, or expired. Generate a fresh one at https://openrouter.ai/keys and
replace the value in `.env.local`.

### 402 Payment Required / 403 Key limit exceeded

The model costs money and the key cannot spend any. Either raise the key's limit and add credit at
https://openrouter.ai/settings/keys, or switch to a free model:

```
VITE_LLM_MODEL=openai/gpt-oss-20b:free
```

Note that `:free` variants come and go — `meta-llama/llama-3.3-70b-instruct:free`, for instance, is
no longer free and now returns a 404. List what is currently free with:

```bash
node -e 'fetch("https://openrouter.ai/api/v1/models").then(r=>r.json()).then(({data})=>data.filter(m=>+m.pricing.prompt===0&&+m.pricing.completion===0).forEach(m=>console.log(m.id)))'
```

### 429 Rate limit exceeded

Wait a minute and retry. Free models have tight limits, and `npm run eval:hybrid` makes 36 calls in
a row, which can trip them.

## Mock Mode (No API Key Needed)

With no key — or whenever the API call fails — the app falls back to offline keyword categorization
and rules-only urgency scoring, and says so in the UI. Nothing crashes, but classification quality
drops significantly, so it is a safety net rather than a way to run the app.

The rules-only evaluation needs no key at all:

```bash
npm run eval
```

## Need Help?

- OpenRouter docs: https://openrouter.ai/docs
- Project README: see `README.md` in this folder
