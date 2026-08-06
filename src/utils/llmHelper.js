import { requestTriage } from './triagePrompt'

/**
 * LLM Helper for categorizing customer support messages.
 *
 * The prompt and response parsing live in triagePrompt.js, shared with the eval
 * harness (`npm run eval:hybrid`) so measured accuracy reflects the real app.
 *
 * Requests go to whatever OpenAI-compatible endpoint VITE_LLM_BASE_URL specifies
 * — OpenRouter by default, but Groq or any other compatible endpoint works by
 * changing the base URL, key, and model in .env.local.
 *
 * Note that this sends the key straight from the browser; see the security note
 * in README.md.
 */

// Trimmed because a key pasted from a website often carries a trailing newline
// or stray quotes, which produce a confusing 401 rather than an obvious error.
const API_KEY = (import.meta.env.VITE_LLM_API_KEY || '').trim().replace(/^["']|["']$/g, '')

/**
 * Analyze a customer support message using Groq AI.
 *
 * @param {string} message - The customer support message
 * @returns {Promise<import('./triagePrompt').TriageResult>}
 */
export async function categorizeMessage(message) {
  if (!API_KEY) {
    console.warn('No VITE_LLM_API_KEY set — using the offline keyword fallback.')
    return getMockCategorization(message)
  }

  try {
    return await requestTriage(
      {
        apiKey: API_KEY,
        baseUrl: import.meta.env.VITE_LLM_BASE_URL,
        model: import.meta.env.VITE_LLM_MODEL,
        // Optional OpenRouter attribution headers; ignored by other providers.
        headers: {
          'HTTP-Referer': window.location.origin,
          'X-Title': 'Customer Inbox Triage',
        },
      },
      message
    )
  } catch (error) {
    console.warn('LLM request failed, using offline fallback:', error.message)
    return getMockCategorization(message)
  }
}

// Derived sentiment per category, used only by the offline fallback.
const MOCK_SENTIMENT = {
  'Billing Issue': 'Negative',
  'Technical Problem': 'Negative',
  'Feature Request': 'Neutral',
  'General Inquiry': 'Neutral',
  Unknown: 'Neutral',
}

/**
 * Offline fallback that mirrors the AI result shape using simple keyword rules.
 * Used when the Groq API is unavailable.
 *
 * @param {string} message
 * @returns {import('./triagePrompt').TriageResult}
 */
function getMockCategorization(message) {
  const { category, reasoning } = mockClassify(message)
  const firstSentence = message.trim().split(/(?<=[.!?])\s/)[0] || message.trim()

  return {
    category,
    sentiment: MOCK_SENTIMENT[category] || 'Neutral',
    // The urgency signals are deliberately null rather than "None": they are a
    // reading of the message, and there is no model here to read it. Null makes
    // the scorer fall back to text rules alone instead of treating the missing
    // assessment as "nothing is wrong".
    severity: null,
    businessImpact: null,
    timePressure: null,
    summary: firstSentence.slice(0, 140),
    tags: [category.split(' ')[0].toLowerCase()],
    language: 'Unknown',
    confidence: null, // keyword guess — no meaningful confidence
    reasoning,
    suggestedReply: '', // the offline fallback does not draft replies
    source: 'mock',
  }
}

/**
 * Keyword-based category guess (offline).
 */
function mockClassify(message) {
  const lowerMessage = message.toLowerCase();

  // Array of possible reasoning variations for each category
  const reasoningVariations = {
    billing: [
      "Based on keywords related to payments and billing, this appears to be a billing-related inquiry. The customer may need assistance with account charges or payment issues.",
      "This message contains billing terminology. The customer is likely experiencing issues with payments, invoices, or account charges.",
      "The message references financial matters related to the customer's account. This suggests a billing or payment concern that requires attention.",
    ],
    technical: [
      "This message describes technical difficulties or system errors. The customer is reporting functionality issues that may require engineering review.",
      "Based on error-related keywords, this appears to be a technical support issue. The customer is experiencing problems with product functionality.",
      "The message indicates a technical problem or bug. This requires investigation from the technical support team.",
      "System-related issues are mentioned in this message. The customer needs technical assistance to resolve functionality problems.",
    ],
    feature: [
      "This message suggests improvements or new functionality. The customer is providing product feedback and feature suggestions.",
      "The customer is requesting enhancements to the product. This appears to be a feature request that should be reviewed by the product team.",
      "Based on the language used, this seems to be a suggestion for product improvements rather than a support issue.",
    ],
    inquiry: [
      "This appears to be a general question about the product or service. The customer is seeking information or clarification.",
      "The message contains questions that don't indicate a specific problem. This is likely a general inquiry requiring informational support.",
      "Based on the question format, this seems to be an information request rather than a technical or billing issue.",
    ],
    positive: [
      "This message contains positive sentiment and appreciation. While not a support request, it may warrant acknowledgment.",
      "The customer is expressing satisfaction or gratitude. This doesn't appear to require immediate support action.",
    ],
    ambiguous: [
      "The message content is unclear or doesn't match standard support categories. Manual review may be needed for proper categorization.",
      "This message doesn't contain clear indicators for automatic categorization. Human review recommended.",
    ]
  };

  // Helper to get random reasoning
  const getRandomReasoning = (category) => {
    const reasons = reasoningVariations[category];
    return reasons[Math.floor(Math.random() * reasons.length)];
  };

  // Billing-related detection
  if (lowerMessage.includes('bill') || lowerMessage.includes('payment') ||
      lowerMessage.includes('charge') || lowerMessage.includes('invoice') ||
      lowerMessage.includes('credit card') || lowerMessage.includes('subscription') ||
      lowerMessage.includes('refund') || lowerMessage.includes('cancel') && lowerMessage.includes('account')) {
    return {
      category: "Billing Issue",
      reasoning: getRandomReasoning('billing')
    };
  }

  // Technical problem detection
  if (lowerMessage.includes('bug') || lowerMessage.includes('error') ||
      lowerMessage.includes('broken') || lowerMessage.includes('not working') ||
      lowerMessage.includes('crash') || lowerMessage.includes('down') ||
      lowerMessage.includes('server') || lowerMessage.includes('loading') ||
      lowerMessage.includes('slow') || lowerMessage.includes('issue') ||
      lowerMessage.includes('problem') && !lowerMessage.includes('no problem')) {
    return {
      category: "Technical Problem",
      reasoning: getRandomReasoning('technical')
    };
  }

  // Feature request detection
  if (lowerMessage.includes('feature') || lowerMessage.includes('add') && (lowerMessage.includes('please') || lowerMessage.includes('could')) ||
      lowerMessage.includes('improve') || lowerMessage.includes('would like to see') ||
      lowerMessage.includes('suggestion') || lowerMessage.includes('wish') ||
      lowerMessage.includes('could you') && lowerMessage.includes('add') ||
      lowerMessage.includes('enhancement') || lowerMessage.includes('would be great')) {
    return {
      category: "Feature Request",
      reasoning: getRandomReasoning('feature')
    };
  }

  // Positive feedback detection
  if ((lowerMessage.includes('thank') || lowerMessage.includes('thanks') || lowerMessage.includes('appreciate')) &&
      !lowerMessage.includes('but') && !lowerMessage.includes('however')) {
    return {
      category: "General Inquiry",
      reasoning: getRandomReasoning('positive')
    };
  }

  // Question/inquiry detection
  if (lowerMessage.includes('how') || lowerMessage.includes('what') ||
      lowerMessage.includes('when') || lowerMessage.includes('where') ||
      lowerMessage.includes('can i') || lowerMessage.includes('is there') ||
      lowerMessage.includes('?')) {
    return {
      category: "General Inquiry",
      reasoning: getRandomReasoning('inquiry')
    };
  }

  // Fallback for ambiguous messages
  return {
    category: "General Inquiry",
    reasoning: getRandomReasoning('ambiguous')
  };
}
