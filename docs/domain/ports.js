/**
 * Ports (contracts) for Spending Tracker adapters.
 * @typedef {object} AppState
 * @property {number} version
 * @property {object[]} txns
 * @property {object[]} categories
 * @property {object[]} rules
 * @property {object} budgets
 * @property {object[]} accounts
 * @property {object} layouts
 * @property {object} settings
 * @property {object} plan
 *
 * @typedef {object} StateStore
 * @property {() => AppState} load
 * @property {(state: AppState) => void} save
 * @property {string} key  // must remain spendingTracker.v1
 */
export {};
