# Task #648 — In-Game Text Chat: Implementation Plan

**Status:** `todo` → `in_progress`  
**Priority:** Medium  
**Domain:** Frontend  
**Project:** Big2 Mobile App  

## Overview

Add real-time text chat during multiplayer games via **Supabase Realtime broadcast** on the existing `room:{roomId}` channel. UI: **top-overlay panel that slides down from the top of the game screen** (triggered by the 💬 icon in the HUD). Message schema: `{user_id, username, message, created_at}`. Include profanity filter + client-side rate limiting (max 1 msg / 2s per player).

---

## Architecture Decision

- **Transport:** Supabase Realtime broadcast (`chat_message` event) on the existing room channel — no new channel needed.
- **No DB table:** Messages are ephemeral (broadcast-only). No persistence needed — chat disappears when the game ends.
- **Profanity filter:** Client-side regex-based blocklist (lightweight, no external dependency). Runs before send.
- **Rate limiting:** Client-side cooldown (2s between sends). Server-side validation is unnecessary since messages are broadcast (not DB writes) and abuse is limited to 4 players in a private room.
- **UI:** Top-overlay panel (fixed `top:0`, animated `translateY`) using `react-native-reanimated` (already installed). Hidden fully off-screen when closed; slides down to `PANEL_TOP = 110` when the 💬 icon is tapped. Drag-handle at the top of the panel closes it via swipe-up gesture scoped to the header row. Badge for unread count shown on the icon when panel is closed.

---

## Step-by-Step Plan

### Phase 1: Types & Broadcast Infrastructure

1. **Add `chat_message` to `BroadcastEvent` union** in `src/types/multiplayer.ts`
2. **Add chat message data shape** to `BroadcastData` union in `src/types/multiplayer.ts`
3. **Create `src/types/chat.ts`** — `ChatMessage` interface: `{ id: string; user_id: string; username: string; message: string; created_at: string }`

### Phase 2: Chat Hook (`useGameChat`)

4. **Create `src/hooks/useGameChat.ts`** — custom hook:
   - Subscribes to `chat_message` broadcast events on the existing channel
   - Maintains message array state (capped at 100 messages)
   - `sendMessage(text: string)` — validates, filters profanity, enforces rate limit, broadcasts
   - `messages: ChatMessage[]` — all received messages
   - `unreadCount: number` — increments when drawer is collapsed, resets on open
   - `isCooldown: boolean` — true during 2s post-send cooldown
   - Accepts `channelRef` from `useRealtime` (the existing room channel)

### Phase 3: Profanity Filter

5. **Create `src/utils/profanityFilter.ts`** — lightweight client-side filter:
   - Regex-based word blocklist (common English profanity)
   - `filterMessage(text: string): string` — replaces profane words with `***`
   - `containsProfanity(text: string): boolean` — quick check
   - Handles l33tspeak substitutions for common patterns

### Phase 4: Chat Drawer UI

6. **Create `src/components/game/ChatDrawer.tsx`** — animated bottom drawer:
   - Collapsed state: thin bar with chat icon + unread badge
   - Expanded state: message list + text input
   - Drag-to-open/close using `react-native-gesture-handler` PanGesture
   - Animated height using `react-native-reanimated` shared values
   - `<FlatList>` for messages (inverted, newest at bottom)
   - Text input with send button, disabled during cooldown
   - Each message bubble: username, text, timestamp
   - Different styling for own messages vs others

### Phase 5: Integration

7. **Wire `useGameChat` into `MultiplayerGame.tsx`**:
   - Pass `channelRef` from `useRealtime` to `useGameChat`
   - Expose `useRealtime` channelRef (currently internal) via return value
   - Add chat state to `GameContext` (messages, sendMessage, unreadCount, etc.)
8. **Add chat fields to `GameContextType`** in `src/contexts/GameContext.tsx`
9. **Render `<ChatDrawer />` in `GameView.tsx`** (multiplayer only)

### Phase 6: i18n

10. **Add `chat.*` i18n keys** to `src/i18n/index.ts` (en/ar/de):
    - `chat.placeholder`, `chat.send`, `chat.noMessages`, `chat.cooldown`, `chat.title`, `chat.profanityWarning`

### Phase 7: Testing

11. **Create `src/hooks/__tests__/useGameChat.test.ts`** — unit tests:
    - Message send/receive
    - Rate limiting enforcement
    - Profanity filter integration
    - Unread count behavior
    - Message cap (100 max)
12. **Create `src/utils/__tests__/profanityFilter.test.ts`** — filter tests

---

## Implementation Checklist

- [ ] **1.** Add `chat_message` to `BroadcastEvent` in `types/multiplayer.ts`
- [ ] **2.** Add chat data shape to `BroadcastData` in `types/multiplayer.ts`
- [ ] **3.** Create `types/chat.ts` with `ChatMessage` interface
- [ ] **4.** Create `hooks/useGameChat.ts` hook
- [ ] **5.** Create `utils/profanityFilter.ts`
- [ ] **6.** Create `components/game/ChatDrawer.tsx`
- [ ] **7.** Expose `channelRef` from `useRealtime` return
- [ ] **8.** Wire `useGameChat` into `MultiplayerGame.tsx`
- [ ] **9.** Add chat fields to `GameContextType` in `GameContext.tsx`
- [ ] **10.** Render `<ChatDrawer />` in `GameView.tsx`
- [ ] **11.** Add `chat.*` i18n keys (en/ar/de)
- [ ] **12.** Write `useGameChat.test.ts` unit tests
- [ ] **13.** Write `profanityFilter.test.ts` unit tests
- [ ] **14.** Manual QA: send/receive in 2-player game
- [ ] **15.** Commit, push, create PR, request Copilot review

---

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `src/types/multiplayer.ts` | EDIT | Add `chat_message` event + data type |
| `src/types/chat.ts` | CREATE | `ChatMessage` interface |
| `src/hooks/useGameChat.ts` | CREATE | Chat hook (send, receive, rate limit) |
| `src/utils/profanityFilter.ts` | CREATE | Client-side profanity filter |
| `src/components/game/ChatDrawer.tsx` | CREATE | Animated bottom drawer UI |
| `src/components/game/index.ts` | EDIT | Export `ChatDrawer` |
| `src/hooks/useRealtime.ts` | EDIT | Expose `channelRef` in return value |
| `src/screens/MultiplayerGame.tsx` | EDIT | Wire `useGameChat`, pass to context |
| `src/contexts/GameContext.tsx` | EDIT | Add chat fields to context type |
| `src/screens/GameView.tsx` | EDIT | Render `<ChatDrawer />` |
| `src/i18n/index.ts` | EDIT | Add `chat.*` keys (en/ar/de) |
| `src/hooks/__tests__/useGameChat.test.ts` | CREATE | Unit tests |
| `src/utils/__tests__/profanityFilter.test.ts` | CREATE | Filter tests |
