/**
 * Recommendation Templates - Maps categories (and urgency) to recommended actions
 */

const actionTemplates = {
  "Billing Issue": "Direct the customer to the billing portal and verify recent charges on their account.",
  "Technical Problem": "Gather reproduction steps (browser, time, error message) and check service status before responding.",
  "General Inquiry": "Answer directly or share the relevant FAQ / documentation link.",
  "Feature Request": "Thank the customer and log the request for the product team to review.",
  "Unknown": "Review manually and route to the appropriate team."
}

/**
 * Get recommended action for a given category and urgency.
 *
 * @param {string} category - The message category
 * @param {string} [urgency] - The urgency level ("High" | "Medium" | "Low")
 * @returns {string} - Recommended next step
 */
export function getRecommendedAction(category, urgency) {
  const base = actionTemplates[category] || "No recommendation available."

  if (urgency === "High") {
    return `Escalate to a human agent now — high urgency. ${base}`
  }
  return base
}

// Which team owns each category. Used to auto-route triaged messages.
const teamRouting = {
  "Billing Issue": "Billing",
  "Technical Problem": "Engineering",
  "Feature Request": "Product",
  "General Inquiry": "Support",
  "Unknown": "Support",
}

/**
 * Get the team a message should be routed to based on its category.
 *
 * @param {string} category - The message category
 * @returns {string} - Team name
 */
export function getTeam(category) {
  return teamRouting[category] || "Support"
}

/**
 * Get all available categories
 *
 * @returns {string[]} - List of categories
 */
export function getAvailableCategories() {
  return Object.keys(actionTemplates)
}

/**
 * Determines if a message should be escalated to a human agent.
 *
 * @param {string} category - The message category
 * @param {string} urgency - The urgency level
 * @returns {boolean} - Whether to escalate
 */
export function shouldEscalate(category, urgency) {
  return urgency === "High" || category === "Unknown"
}
