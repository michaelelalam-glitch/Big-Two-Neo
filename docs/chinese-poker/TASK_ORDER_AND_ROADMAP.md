# Big2 Mobile App — Task Audit & Completion Roadmap

> Generated: March 16, 2026  
> Total tasks reviewed: 39 (16 backlog · 18 todo · 5 in_progress)

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
| 1 | `#628` | Fix GameScreen slow renders (263 occurrences/session) | 2–3 days | 🔴 High |
| 2 | `#643` | Add React Error Boundaries to game screens | 1 day | 🟡 Medium |

---

### TIER 2 — Active Feature Work 🚀
> Tasks we are building or immediately queued.  
> **Estimated: ~2 weeks**

| # | ID | Title | Est. Time | Priority |
|---|----|-------|-----------|----------|
| 3 | `#648` | [FEATURE] In-game text chat (Supabase Realtime) | 5–7 days | 🟡 Medium |
| 4 | `#646` | Configure deep linking for room codes & game invites | 2–3 days | 🟡 Medium |
| 5 | `#650` | Increase card touch targets to iOS HIG 44px minimum | 1 day | 🟢 Low |
| 6 | `#652` | Enhance drop zone UX (glow, haptic, drag hint) | 1 day | 🟢 Low |

---

### TIER 3 — Architecture & CI Hardening 🏗️
> State management improvements and CI pipeline quality gates.  
> **Estimated: ~1 week**

| # | ID | Title | Est. Time | Priority |
|---|----|-------|-----------|----------|
| 7 | `#647` | Expand Zustand store (replace Context prop drilling) | 3–4 days | 🟢 Low |
| 8 | `#616` | CI: Bundle size monitoring (bundlewatch/size-limit) | 0.5 days | 🟢 Low |
| 9 | `#617` | Ratchet coverage thresholds +2% per sprint toward 80% | 0.5 day/sprint | 🟢 Low |
| 10 | `#328` | Add performance benchmarks for card rendering (CI) | 1 day | 🟢 Low |

---

### TIER 4 — Test Suite 🧪
> Build out automated test coverage before store submission.
> **Estimated: ~6–8 days** *(revised Mar 16 — Jest/unit/component/CI already done; remaining work is Detox E2E + coverage threshold only)*

| # | ID | Title | Est. Time | Priority |
|---|----|-------|-----------|----------|
| 11 | `#325` | Add E2E tests with Detox | 5–7 days *(Detox only — Jest/CI already done)* | 🟡 Medium |
| 12 | `#327` | Add visual regression tests for card UI | 2 days | 🟢 Low |
| 13 | `#273` | Write comprehensive tests (unit, integration, E2E) | ~0.5 day (coverage threshold) + Detox *(unit/component/CI already done)* | 🔴 High |
| 14 | `#522` | Phase 3.6J: Rejoin testing (banner + state continuity) | 0.5 day | 🟡 Medium |

---

### TIER 5 — Accessibility ♿
> After core UX is stable, bring it to WCAG 2.1 AA.  
> **Estimated: ~4 days** *(Consolidates #329, #580)*

| # | ID | Title | Est. Time | Priority |
|---|----|-------|-----------|----------|
| 15 | `#645` | Improve VoiceOver/TalkBack — WCAG 2.1 AA | 3–4 days | 🟢 Low |

---

### TIER 6 — Performance Tuning ⚡
> Optimize mobile engine and bundle after test suite is solid.  
> **Estimated: ~1.5 weeks**

| # | ID | Title | Est. Time | Priority |
|---|----|-------|-----------|----------|
| 16 | `#280` | Optimize mobile game engine (memoization, lazy loading) | 3–4 days | 🟡 Medium |
| 17 | `#276` | Optimize performance and bundle size (<50MB, <3s start) | 3–4 days | 🔴 High |

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

### 🔵 IN PROGRESS (2 tasks)
- `#617` — Ratchet coverage thresholds +2% per sprint
- `#628` — Fix GameScreen slow renders *(moved from todo → in_progress)*

### 🟡 TODO — Ready to start (8 tasks)
- `#616` — CI: Bundle size monitoring
- `#643` — Add React Error Boundaries
- `#645` — Improve accessibility: VoiceOver/TalkBack
- `#646` — Configure deep linking
- `#647` — Expand Zustand store
- `#648` — [FEATURE] In-game text chat
- `#650` — Increase card touch targets
- `#652` — Enhance drop zone UX (glow, haptic, drag hint)

### ⚪ BACKLOG — Queued but not ready (30 tasks)
All remaining tasks in tiers 4–10 plus the 9 duplicate/stale tasks above.

---

## 🗃️ Full ID Reference

### Active In-Progress
`#617` `#628`

### Todo (next up)
`#616` `#643` `#645` `#646` `#647` `#648` `#652` `#650`

### Backlog (ordered)
`#315` `#314` `#279` `#255` `#272` `#252` `#254` `#274` `#275` `#251` `#256` `#249` `#250` `#253` `#280` `#276` `#325` `#327` `#273` `#522` `#328` `#329` `#329_dup`
