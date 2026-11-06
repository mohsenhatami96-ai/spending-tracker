# Spending Tracker — Clean Architecture Refactor (Design Spec)

Date: 2026-11-06 · Status: Locked (executor) · Baseline: `b686675`

## 1. Goals
- Refactor the ~2800-line single-file `spending-tracker.html` **in place** into ports & adapters: pure `domain/`, `storage/` localStorage adapter, `ui/` views, thin `app.js` composition root.
- Native ES modules, **no bundler**. Source of truth is modular; `build-pwa.js` copies modules into `./pwa` and still strips the `@private` local rules block.
- Identical user-visible behavior and **zero data loss**.
- Domain logic covered by fast unit tests (`node:test`).

## 2. Non-goals
- No greenfield rewrite, no TypeScript, no bundler.
- No localStorage key or schema migration; `LS_KEY` stays exactly `spendingTracker.v1`.
- No new features or visual changes.

## 3. Target layout
```
spending-tracker.html    slim shell: CSS link + body markup + <script type="module" src="app.js">
styles.css               extracted from <style>
app.js                   composition root: load state, wire UI, expose window.SpendingTracker, SW register (PWA)
domain/
  util.js                uid, round2, foldText, tokensOf, MONTHS_SHORT
  money.js               parseAmount, looksNum, detectDecimal, formatters (pure parts)
  dates.js               parseDate, detectDateFormat, validYMD, monthLabel, fmtDate helpers
  categories.js          CATEGORY_TREE, shadeColor, DEFAULT_CATS, LEGACY_CATS, migrateCategories, cat helpers
  rules-data.js          DEFAULT_RULES
  local.js               LOCAL_RULES / LOCAL_CITIES / LOCAL_LOC_ABBR (@private markers for build-pwa)
  rules.js               compile/match/fuzzy, cleanDescription, displayName, isViaKlarna
  dict.js                DICT_* + dictMatch
  categorize.js          categorize, merchantKey, dedupeKey, recategorizeAll (takes state accessors)
  state.js               defaultState, normalizeState
  parse-csv.js           parseCSV, detectDelimiter
  parse-xlsx.js          inflate/zip/xlsx parsers
  import.js              buildConfig, buildTxns, addTxnsDeduped, mapping helpers (pure+DOM-free)
  periods.js             paydayDate, getPeriods, periodOf, allMonths, …
  accounts.js            cardFor, payoffTreatment, payoffMatch, summarize, detectRecurring
  plan.js                normalizePlan, planStats, planInsights, goalStatus, fvSeries, ISK_RULES
  ports.js               JSDoc: StateStore contract
storage/
  localStorage.js        LS_KEY='spendingTracker.v1', load/save implementing the port
ui/
  dom.js                 $, $$, esc, toast, modal
  charts.js              donutSVG, trendSVG, growthSVG
  cat-picker.js          searchable category picker
  dashboard.js, transactions.js, review.js, budgets.js, plan-ui.js, settings.js, import-ui.js
tests/domain/*.test.js
test.js / test-pwa.js / test-xlsx.js / test-live.js   (test.js served over http so ES modules work)
```

Dependency rule: `domain/` imports only `domain/`; `ui/` calls domain + storage port via deps from `app.js`, never `localStorage` directly; only `storage/` reads/writes `LS_KEY`.

## 4. Data safety (must not change)
- `LS_KEY = 'spendingTracker.v1'` (verified in source and tests).
- `normalizeState` / `defaultState` / `migrateCategories` behavior unchanged (v1→v2 category tree, needsRecat).
- Backup JSON shape unchanged (`app: 'spending-tracker'` + state fields).
- `window.SpendingTracker` API surface kept for Playwright tests.

## 5. Vertical slice order
1. Design note (this file) + module shell (HTML loads `app.js` as module; CSS extracted).
2. Domain money/dates/csv + unit tests.
3. Storage adapter with exact `LS_KEY`.
4. Categories/rules/dict/categorize/state + unit tests.
5. Import/xlsx/periods/accounts/plan domain modules.
6. UI modules + composition root; preserve SpendingTracker global.
7. Update `build-pwa.js` to copy modules into `pwa/`, strip private local.js, include modules in SW `SHELL`.
8. Green `node --test`, `test.js`, `test-pwa.js` (no push).

## 6. build-pwa changes
- Copy `styles.css`, `app.js`, `domain/**`, `storage/**`, `ui/**` into `pwa/`.
- Replace `domain/local.js` contents with empty LOCAL_* for the public build (same DENY list).
- Slim `index.html` from modular `spending-tracker.html` + PWA head tags (not the old monolithic script).
- SW `SHELL` lists every module path; version hash includes those files.

## 7. Rollback
Revert to baseline commit `b686675`; localStorage key unchanged so data is untouched.
