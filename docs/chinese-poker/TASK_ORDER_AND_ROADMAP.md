# Big2 Mobile App — Task Audit & Completion Roadmap

> Generated: March 16, 2026 · Last updated: March 22, 2026  
> Total tasks reviewed: 44 (13 backlog · 12 todo · 6 in_progress · 13 completed)

---

## 🗑️ Deleted Tasks (Duplicates & Stale)

9 tasks deleted on March 16, 2026. Canonical replacements listed.

| Deleted ID | Reason | Canonical |
|-----------|--------|-----------|
| `#329`, `#580` | Duplicate accessibility audits | `#645` |
| `#579` | Duplicate performance monitoring | `#272` |
| `#530` | Duplicate beta testing | `#251` |
| `#531`, `#532`, `#527`, `#533` | Stale Dec-2025 phase architecture | `#250`, `#273` |

---

## ✅ Completion Roadmap (Ordered by Dependency + Priority)

### TIER 1 — Stability First 🔧
> Fix crashes and regressions before adding features.  
> **Estimated: ~3–4 days**

| # | ID | Title | Est. Time | Priority |
|---|----|-------|-----------|----------|
| 1 | `#628` | ✅ Fix GameScreen slow renders — Completed Mar 29, 2026 | 0 days | ✅ Completed |
| 2 | `#643` | Add React Error Boundaries to game screens | 1 day | 🟡 Medium |

---

### TIER 2 — Active Feature Work 🚀
> Tasks we are building or immediately queued.  
> **Estimated: ~2 weeks**

| # | ID | Title | Est. Time | Priority |
|---|----|-------|-----------|----------|
| 3 | `#648` | [FEATURE] In-game text chat (Supabase Realtime) | 5–7 days | 🟡 Medium |
| 4 | `#646` | ✅ Configure deep linking, friends list & game invite share — Completed Mar 21, 2026 | 0 days | ✅ Completed |
| 5 | `#650` | Increase card touch targets to iOS HIG 44px minimum | 1 day | 🟢 Low |
| 6 | `#652` | ✅ Enhance drop zone UX (glow, haptic, drag hint) — Completed Mar 21, 2026 | 0 days | ✅ Completed |

---

### TIER 3 — Architecture & CI Hardening 🏗️
> State management improvements and CI pipeline quality gates.  
> **Estimated: ~1 week**

| # | ID | Title | Est. Time | Priority |
|---|----|-------|-----------|----------|
| 7 | `#647` | ✅ Expand Zustand store (replace Context prop drilling) — Completed Mar 29, 2026 | 0 days | ✅ Completed |
| 8 | `#616` | ✅ CI: Bundle size monitoring (bundlewatch/size-limit) — Completed Mar 29, 2026 | 0 days | ✅ Completed |
| 9 | `#617` | ✅ Ratchet coverage thresholds +2% per sprint toward 80% — Completed Mar 29, 2026 | 0 days | ✅ Completed |
| 10 | `#328` | ✅ Add performance benchmarks for card rendering (CI) — Completed Mar 29, 2026 | 0 days | ✅ Completed |

> ✅ Tasks #617, #616, #328, #647 **COMPLETED** — PR #165 merged. Branch `feat/tasks-617-616-328-647-ci-arch` deleted (Mar 29, 2026).

---

### TIER 4 — Test Suite 🧪
> Build out automated test coverage before store submission.
> **Estimated: ~6–8 days** *(revised Mar 16 — Jest/unit/component/CI already done; remaining work is Detox E2E + coverage threshold only)*

| # | ID | Title | Est. Time | Priority |
|---|----|-------|-----------|----------|
| 11 | `#325` | 🔵 Add E2E tests (Maestro) — **IN REVIEW** on PR #167 (flows 10 + 11 ✅; Android EAS test profile ✅) | 0 days remaining | 🟡 Medium |
| 12 | `#327` | 🔵 Add visual regression tests for card UI — **IN REVIEW** on PR #167 (21 snapshot tests ✅) | 0 days remaining | 🟢 Low |
| 13 | `#273` | 🔵 Write comprehensive tests (unit, integration, E2E) — **IN REVIEW** on PR #167 (32 game-logic tests ✅) | 0 days remaining | 🔴 High |
| 14 | `#522` | ✅ Phase 3.6J: Rejoin testing (banner + state continuity) — Completed Mar 18, 2026 | 0 days | ✅ Completed |

---

### TIER 5 — Accessibility ♿
> After core UX is stable, bring it to WCAG 2.1 AA.  
> **Estimated: ~4 days** *(Consolidates #329, #580)*

| # | ID | Title | Est. Time | Priority |
|---|----|-------|-----------|----------|
| 15 | `#645` | 🔵 Improve VoiceOver/TalkBack — WCAG 2.1 AA — **IN PROGRESS** on `feat/tasks-645-280-276-accessibility-perf` | ~1 day remaining | 🟢 Low |

---

### TIER 6 — Performance Tuning ⚡
> Optimize mobile engine and bundle after test suite is solid.  
> **Estimated: ~1.5 weeks**

| # | ID | Title | Est. Time | Priority |
|---|----|-------|-----------|----------|
| 16 | `#280` | 🔵 Optimize mobile game engine (memoization, lazy loading) — **IN PROGRESS** on `feat/tasks-645-280-276-accessibility-perf` | ~2 days remaining | 🟡 Medium |
| 17 | `#276` | 🔵 Optimize performance and bundle size (<50MB, <3s start) — **IN PROGRESS** on `feat/tasks-645-280-276-accessibility-perf` | ~2 days remaining | 🔴 High |

---

### TIER 7 — Pre-Launch Infrastructure ⚙️
> Production credentials, infrastructure, monitoring — everything needed before store submission.  
> **Estimated: ~2 weeks**

| # | ID | Title | Est. Time | Priority |
|---|----|-------|-----------|----------|
| 18 | `#315` | Set up Firebase (Android) and APNs (iOS) production credentials | 1 day | 🔴 Critical |
| 19 | `#314` | Physical device testing: push notifications on real devices | 1–2 days | 🔴 High |
| 20 | `#279` | Configure Apple Sign-In OAuth provider | 0.5 day | 🟢 Low |
| 21 | `#255` | Set up backend infrastructure for production (Supabase scale, TURN) | 3–4 days | 🔴 High |
| 22 | `#272` | Set up error tracking & analytics (Sentry + Firebase Analytics) | 2–3 days | 🟡 Medium |

---

### TIER 8 — Legal & Store Prep 📄
> Non-negotiable before submitting to App Store / Play Store.  
> **Estimated: ~3.5 weeks**

| # | ID | Title | Est. Time | Priority |
|---|----|-------|-----------|----------|
| 23 | `#252` | Implement Terms of Service & Privacy Policy (GDPR, CCPA) | 3–5 days | 🔴 High |
| 24 | `#254` | Create onboarding tutorial (3–5 screen interactive flow) | 5–7 days | 🟡 Medium |
| 25 | `#274` | Configure iOS build and App Store setup (EAS, TestFlight) | 2–3 days | 🔴 Critical |
| 26 | `#275` | Configure Android build and Play Store setup (AAB, EAS) | 2–3 days | 🔴 Critical |

---

### TIER 9 — Beta & Marketing 📣
> External validation and launch preparation.  
> **Estimated: ~5–8 weeks**

| # | ID | Title | Est. Time | Priority |
|---|----|-------|-----------|----------|
| 27 | `#251` | Beta test with real users (50–100 testers via TestFlight/Internal) | 2–3 weeks | 🔴 Critical |
| 28 | `#256` | Implement App Store Optimization (ASO) | 3–4 days | 🟡 Medium |
| 29 | `#249` | Plan launch marketing strategy (Product Hunt, social, press kit) | 3–5 days | 🟢 Low |
| 30 | `#250` | Launch v1.0 on App Store and Play Store 🎉 | 1 day + review time | 🔴 Critical |

---

### TIER 10 — Post-Launch (Ongoing) 🔁

| # | ID | Title | Est. Time | Priority |
|---|----|-------|-----------|----------|
| 31 | `#253` | Post-launch monitoring and iteration (D1/D7/D30 retention) | Ongoing | 🔴 High |

---

## 🗓️ Timeline Summary

| Phase | Tiers | Calendar Estimate |
|-------|-------|-------------------|
| Stability + Active Features | 1–2 | Weeks 1–3 (Mar 16 – Apr 4) |
| Architecture + CI + Tests | 3–4 | Weeks 3–8 (Apr 4 – May 9) |
| Accessibility + Performance | 5–6 | Weeks 7–9 (May 2 – May 16) |
| Pre-Launch Infra + Legal | 7–8 | Weeks 9–14 (May 16 – Jun 20) |
| Beta + Marketing + Launch | 9 | Weeks 14–22 (Jun 20 – Aug 14) |
| Post-Launch | 10 | Ongoing from launch |

> **Estimated v1.0 launch window: mid-to-late August 2026** (assuming 1–2 engineers, part-time)

---

## 📋 Current Status Board

### 🚧 IN PROGRESS (6 tasks — 2 branches)
**Branch `feat/tasks-327-273-325-tests-e2e`** off `game/chinese-poker` — PR #167 open, Copilot review loop complete (0 non-outdated comments)
- `#327` — Add visual regression snapshot tests for card UI (21 tests passing ✅)
- `#273` — Write comprehensive game-engine unit tests (32 tests passing ✅)
- `#325` — Expand Maestro E2E flows with CI tags (flows 10 + 11 added ✅; Android EAS test profile ✅)

**Branch `feat/tasks-645-280-276-accessibility-perf`** off `game/chinese-poker` (Mar 22, 2026)
- `#645` — Improve VoiceOver/TalkBack WCAG 2.1 AA (Card.tsx + GameControls.tsx)
- `#280` — Optimize mobile game engine (memoize classifyCards, sortHand; lazy bot AI)
- `#276` — Optimize bundle size & performance (Hermes, metro tree-shaking, image audit)

> 📌 Branch `game/chinese-poker` is **0 ahead / 0 behind** `main` (synced Mar 22, 2026)

### 🟡 TODO — Ready to start (5 tasks)
- `#643` — Add React Error Boundaries
- `#648` — [FEATURE] In-game text chat
- `#650` — Increase card touch targets
- `#315` — Firebase (Android) / APNs (iOS) production credentials
- `#272` — Error tracking & analytics (Sentry + Firebase Analytics)

### ✅ RECENTLY COMPLETED (Mar 22, 2026)
- `#617` — Ratchet coverage thresholds +2%/sprint — Completed Mar 29, 2026 (PR #165)
- `#616` — CI: Bundle size monitoring — Completed Mar 29, 2026 (PR #165)
- `#328` — Performance benchmarks for card rendering (CI) — Completed Mar 29, 2026 (PR #165)
- `#647` — Expand Zustand store — Completed Mar 29, 2026 (PR #165)
- `#628` — Fix GameScreen slow renders — Completed Mar 29, 2026
- `#646` — Configure deep linking, friends list & game invite share — Completed Mar 21, 2026
- `#652` — Enhance drop zone UX (glow, haptic, drag hint) — Completed Mar 21, 2026
- `#522` — Phase 3.6J: Rejoin testing — Completed Mar 18, 2026

### ⚪ BACKLOG — Queued but not ready (13 tasks)
All remaining tasks in tiers 7–10.

---

## 🗃️ Full ID Reference

### 🔵 Active In-Progress
`#327` `#273` `#325` `#645` `#280` `#276`

### Todo (next up)
`#643` `#648` `#650` `#315` `#272`

### Backlog (ordered)
`#314` `#279` `#255` `#252` `#254` `#274` `#275` `#251` `#256` `#249` `#250` `#253`

### ✅ COMPLETED (13 tasks)
- `#522` — Phase 3.6J: Rejoin testing (banner + state continuity) — Completed Mar 18, 2026
- `#646` — Configure deep linking, friends list & game invite share — Completed Mar 21, 2026
- `#652` — Enhance drop zone UX (glow, haptic, drag hint) — Completed Mar 21, 2026
- `#617` — Ratchet coverage thresholds +2%/sprint — Completed Mar 29, 2026 (PR #165)
- `#616` — CI: Bundle size monitoring — Completed Mar 29, 2026 (PR #165)
- `#328` — Performance benchmarks for card rendering (CI) — Completed Mar 29, 2026 (PR #165)
- `#647` — Expand Zustand store — Completed Mar 29, 2026 (PR #165)
- `#628` — Fix GameScreen slow renders — Completed Mar 29, 2026
