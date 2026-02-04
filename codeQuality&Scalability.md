# Ship Studio — Code Quality & Scalability Review

## Executive Summary

The codebase is **well-structured for its current scale** but has several areas that need attention before scaling further. The most critical issues are:

1. A **monolithic `App.tsx`** (2,576 lines, 40+ state variables)
2. **Minimal test coverage** (~5% of frontend files)
3. **Inconsistent error handling** (mixed `console.*` and structured logger, silent catches)

---

## Table of Contents

- [1. CRITICAL Issues](#1-critical-issues)
- [2. HIGH Severity Issues](#2-high-severity-issues)
- [3. MEDIUM Severity Issues](#3-medium-severity-issues)
- [4. LOW Severity / Quality Notes](#4-low-severity--quality-notes)
- [5. Prioritized Recommendations](#5-prioritized-recommendations)
- [6. Scalability Verdict](#6-scalability-verdict)

---

## 1. CRITICAL Issues

### 1.1 Monolithic App.tsx (2,576 lines)

`src/App.tsx` is the single biggest quality risk. It contains:

- **40+ `useState` hooks** and 1 `useReducer` (lines 239–399)
- **16+ refs** (terminal maps, dev server, screenshot intervals, preview)
- **15+ props drilled** into children like `SubmitReviewModal`, `CompactActionsRow`
- All view orchestration, side effects, and business logic in one file

Every state change triggers a potential re-render of the entire component tree. **No `React.memo()` is used on any child component.**

**Recommendation:** Extract into custom hooks (`useTerminalState`, `useDevServer`, `useBranchManagement`, `usePublishing`) and memoize expensive children.

---

### 1.2 Test Coverage (~5%)

Only **4 test files** exist for 83 frontend files:

| Test File | Lines | Quality |
|-----------|-------|---------|
| `BranchIndicator.test.tsx` | 143 | Good |
| `polling.test.ts` | 293 | Excellent |
| `health.test.ts` | 122 | Good |
| `logger.test.ts` | 184 | Excellent |

**Missing tests for:** `App.tsx`, `Terminal`, `Preview`, all `lib/` invoke wrappers, all modals, all publishing flows.

---

## 2. HIGH Severity Issues

### 2.1 Inconsistent Error Handling

75 `console.log/warn/error` statements mixed with 97 structured `logger` calls across 17 components. Many catch blocks are silent:

```typescript
// src/lib/project.ts:237-240 — empty catch blocks
.catch(() => {})

// src/App.tsx:1414-1415 — repeated 20+ times
.catch(() => null)
```

---

### 2.2 No Centralized IPC Layer

Each `src/lib/*.ts` file calls `invoke()` directly with ad-hoc error handling. There is no:

- Retry logic at the IPC layer
- Timeout enforcement (only used in 2 places via `withTimeout`)
- Request logging or correlation IDs
- Centralized error transformation

---

### 2.3 Large Components Beyond App.tsx

| Component | Lines | Concern |
|-----------|-------|---------|
| `Preview.tsx` | 1,148 | Breakpoints, routing, CMS, health checks all in one |
| `CodeHealthPanel.tsx` | 936 | Health checking + script management + rendering |
| `EnvEditor.tsx` | 734 | Editor + modal logic combined |
| `CreateProject.tsx` | 723 | Wizard + PTY event listeners in one component |
| `AssetsPanel.tsx` | 711 | Upload/delete/list all inline |
| `PublishBranchDropdown.tsx` | 634 | Dropdown + publish logic + state |

---

## 3. MEDIUM Severity Issues

### 3.1 Code Duplication

- **Hardcoded branch names** (`'main'`, `'master'`, `'staging'`) appear in **8+ files** without shared constants: `BranchesTab`, `BranchIndicator`, `BranchSelectorModal`, `App.tsx`, `PublishDropdown`, `CompactActionsRow`

---

### 3.2 Polling Inconsistency

Some components use the well-designed `usePolling` hook, others use raw `setInterval`:

- **`PublishBranchDropdown.tsx:92-93`** — manual `setInterval` without exponential backoff

---

### 3.3 CSS Collision Risk

30 CSS files use global class names (no CSS Modules, no scoping). Examples of inconsistent naming: `.modal-overlay` vs `.onboarding-terminal-overlay`. As the component count grows, class collisions become likely.

---

## 4. LOW Severity / Quality Notes

### 4.1 Positives Worth Noting

- **No `any` types** found in the entire frontend codebase
- Good **optional chaining** usage (`?.`) throughout
- Proper **event listener cleanup** in all `useEffect` returns
- **Visibility-based polling** — stops polling when tab is hidden
- **Good polling library** — `polling.ts` has jitter, backoff, proper cleanup

---

### 4.2 No Cross-Window Communication

Each project window has fully isolated React state. GitHub auth changes in window A don't notify window B. Each window independently polls for the same data.

---

### 4.3 No Performance Metrics

No timing data collected for common operations. Can't answer: "Is the app getting slower?" No cache hit rate tracking, no IPC latency measurement.

---

## 5. Prioritized Recommendations

### Immediate (before next feature)

| # | Action | Impact |
|---|--------|--------|
| 1 | Replace all `console.*` with `logger.*` | Consistency |
| 2 | Add `React.memo()` to `BranchesTab`, `Preview`, `ProjectCard` | Performance |

### Short-term (next 1-2 releases)

| # | Action | Impact |
|---|--------|--------|
| 3 | Extract `App.tsx` into 4-5 custom hooks | Maintainability |
| 4 | Create centralized `safeInvoke()` wrapper with timeout + retry | Reliability |
| 5 | Add tests for `lib/` wrappers and critical components (target 40%) | Confidence |
| 6 | Extract hardcoded branch names to constants file | Duplication |

### Medium-term (architectural)

| # | Action | Impact |
|---|--------|--------|
| 7 | Add request correlation IDs (frontend invoke → backend log) | Observability |
| 8 | Consider CSS Modules or scoped styling | Scalability |
| 9 | Add performance metrics collection | Monitoring |

---

## 6. Scalability Verdict

The app is at a **critical threshold**. It works well at its current size but the monolithic `App.tsx`, lack of tests, and ad-hoc error handling mean that **adding 3-5 more features without refactoring will make the codebase significantly harder to maintain**.

**Action:** Address items 1-6 above before major feature additions.
