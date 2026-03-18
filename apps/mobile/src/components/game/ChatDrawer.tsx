/**
 * ChatDrawer — top-overlay panel for in-game text chat (Task #648).
 *
 * The trigger icon button lives in GameView's scoreActionContainer.
 * When isOpen=true the panel slides down from the top of the screen.
 * When isOpen=false the panel is animated off-screen (pointerEvents="none").
 *
 * GestureDetector wraps ONLY the header so the inner FlatList can scroll
 * freely without gesture conflicts (Copilot PR-150 review fix).
 */

import React, { useRef, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { i18n } from '../../i18n';
import type { ChatMessage } from '../../types/chat';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ChatDrawerProps {
  messages: ChatMessage[];
  sendMessage: (text: string) => void;
  isCooldown: boolean;
  isOpen: boolean;
  onToggle: () => void;
  localUserId: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Distance from the top of the screen to the visible panel when open (portrait). */
const PANEL_TOP_PORTRAIT = 110;
/** In landscape the panel sits flush at the top (no status-bar gap needed). */
const PANEL_TOP_LANDSCAPE = 0;
/** Visible panel height when open. */
const PANEL_HEIGHT = 300;
const ANIMATION_DURATION = 250;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ChatDrawer({
  messages,
  sendMessage,
  isCooldown,
  isOpen,
  onToggle,
  localUserId,
}: ChatDrawerProps) {
  const inputRef = useRef<TextInput>(null);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const [inputText, setInputText] = React.useState('');
  // Incrementing key remounts the TextInput node, destroying the native IME session.
  const [inputKey, setInputKey] = React.useState(0);
  // ── Autocorrect guard ───────────────────────────────────────────────────
  // Root cause of the ghost-text bug:
  //   After handleSend calls setInputText(''), iOS / Android fires onChangeText
  //   asynchronously with the autocorrected word (e.g. "High"). Because this
  //   native event hits the JS bridge AFTER our state update is scheduled but
  //   BEFORE React flushes the re-render, it wins the batch and the cleared
  //   input re-fills with the autocorrect suggestion.
  //
  // Fix: isSendingRef is set true the instant we decide to send. onChangeText
  //   ignores all native events while the flag is set. The flag is cleared
  //   after 300 ms — long enough to outlast any autocorrect commit on both iOS
  //   (typically <200 ms) and Android (typically <150 ms).
  const isSendingRef = useRef(false);
  const sendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Derive panel offset from current orientation so the drawer sits at the
  // very top in landscape (no status-bar gap) and 110 px down in portrait.
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const panelTop = isLandscape ? PANEL_TOP_LANDSCAPE : PANEL_TOP_PORTRAIT;
  const panelHiddenY = -(PANEL_HEIGHT + panelTop);

  // Panel slides down from above: translateY starts hidden and animates to
  // panelTop (visible). Re-runs when orientation changes so position stays
  // correct without needing the user to re-open the drawer.
  const translateY = useSharedValue(panelHiddenY);

  useEffect(() => {
    translateY.value = withTiming(isOpen ? panelTop : panelHiddenY, {
      duration: ANIMATION_DURATION,
      easing: Easing.out(Easing.cubic),
    });
  }, [isOpen, panelTop, panelHiddenY, translateY]);

  // Auto-focus the text input once the open animation completes (Copilot
  // PR-150 r2950333902 — use inputRef intentionally).
  useEffect(() => {
    if (!isOpen) return;
    const id = setTimeout(() => inputRef.current?.focus(), ANIMATION_DURATION + 50);
    return () => clearTimeout(id);
  }, [isOpen]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  // Scroll to the newest message whenever the list content grows.
  // The timer is cleared on cleanup so a stale call can't fire after unmount.
  const scrollToBottom = useCallback(() => {
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = setTimeout(() => {
      scrollTimerRef.current = null;
      listRef.current?.scrollToEnd({ animated: true });
    }, 80);
  }, []);

  useEffect(() => {
    if (isOpen && messages.length > 0) scrollToBottom();
  }, [messages.length, isOpen, scrollToBottom]);

  // Clear any pending scroll timer on unmount.
  useEffect(() => {
    return () => {
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    };
  }, []);

  // Drag-to-close gesture: swipe up ≥ 30 px on the header closes the panel.
  // GestureDetector is scoped to the header only so the FlatList scroll gesture
  // is unaffected (Copilot PR-150 r2947303858 fix).
  // Memoized so the Gesture object is only recreated when onToggle changes;
  // recreating it on every render can cause reattachment work and subtle
  // gesture glitches with react-native-gesture-handler (Copilot PR-150
  // r2950221399). dragStartY removed — translationY is read directly from the
  // onEnd event so no shared value is needed (Copilot PR-150 r2950333904).
  const headerPanGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY([-8, 8])
        .onEnd((e) => {
          if (e.translationY < -30) runOnJS(onToggle)();
        }),
    [onToggle],
  );

  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text) return;
    // Set BEFORE sendMessage so any synchronous autocorrect onChangeText that
    // fires during or immediately after this call is swallowed.
    isSendingRef.current = true;
    sendMessage(text);
    setInputKey((k) => k + 1);
    setInputText('');
    // Clear the guard after the autocorrect commit window.
    // Clearing any in-flight timer first prevents multiple rapid sends from
    // resetting the flag too early (Copilot PR-151 r2951116762).
    if (sendTimerRef.current) clearTimeout(sendTimerRef.current);
    sendTimerRef.current = setTimeout(() => { isSendingRef.current = false; }, 300);
  }, [inputText, sendMessage]);

  // Android fires onChangeText with the autocorrected word BEFORE
  // onSubmitEditing, so `inputText` may already be "High" by the time the
  // return-key handler runs. Reading nativeEvent.text gives us the actual
  // contents of the native field at submit time (= what the user confirmed).
  const handleSubmitEditing = useCallback(
    (e: { nativeEvent: { text: string } }) => {
      const text = e.nativeEvent.text.trim();
      if (!text) return;
      isSendingRef.current = true;
      sendMessage(text);
      setInputKey((k) => k + 1);
      setInputText('');
      if (sendTimerRef.current) clearTimeout(sendTimerRef.current);
      sendTimerRef.current = setTimeout(() => { isSendingRef.current = false; }, 300);
    },
    [sendMessage],
  );

  // Only propagate native text changes when we are NOT in a send cycle.
  const handleChangeText = useCallback((text: string) => {
    if (isSendingRef.current) return;
    setInputText(text);
  }, []);

  // ── Message bubble ──────────────────────────────────────────────────────

  const renderMessage = useCallback(
    ({ item }: { item: ChatMessage }) => {
      const isOwn = item.user_id === localUserId;
      return (
        <View style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther]}>
          {!isOwn && <Text style={styles.bubbleUsername}>{item.username}</Text>}
          <Text style={styles.bubbleText}>{item.message}</Text>
          <Text style={styles.bubbleTime}>
            {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
      );
    },
    [localUserId],
  );

  const keyExtractor = useCallback((item: ChatMessage) => item.id, []);

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    // Keep the node mounted to preserve scroll position; hide via translateY
    // and block touches when closed.
    <Animated.View
      style={[styles.panel, animatedStyle]}
      pointerEvents={isOpen ? 'auto' : 'none'}
    >
      {/* Header — GestureDetector wraps ONLY this bar to avoid stealing
          scroll events from the FlatList below. */}
      <GestureDetector gesture={headerPanGesture}>
        <Pressable
          style={styles.header}
          onPress={onToggle}
          accessibilityRole="button"
          accessibilityLabel={i18n.t('common.close')}
        >
          <View style={styles.dragHandle} />
          <Text style={styles.headerTitle}>{i18n.t('chat.title')}</Text>
          <Text style={styles.closeIcon}>✕</Text>
        </Pressable>
      </GestureDetector>

      {/* Messages */}
      {messages.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>{i18n.t('chat.noMessages')}</Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={keyExtractor}
          style={styles.messageList}
          contentContainerStyle={styles.messageListContent}
          onContentSizeChange={isOpen ? scrollToBottom : undefined}
        />
      )}

      {/* Input row — KeyboardAvoidingView keeps it above the soft keyboard.
          The panel is near the top of the screen so the keyboard (at the bottom)
          rarely covers the input, but we add padding-based avoidance for safety. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={panelTop}
      >
        <View style={styles.inputRow}>
          <TextInput
            key={inputKey}
            ref={inputRef}
            style={styles.input}
            value={inputText}
            onChangeText={handleChangeText}
            placeholder={isCooldown ? i18n.t('chat.cooldown') : i18n.t('chat.placeholder')}
            placeholderTextColor="#888"
            maxLength={500}
            editable={!isCooldown}
            onSubmitEditing={handleSubmitEditing}
            returnKeyType="send"
            blurOnSubmit={false}
          />
          <Pressable
            style={[styles.sendButton, (isCooldown || !inputText.trim()) && styles.sendButtonDisabled]}
            onPress={handleSend}
            disabled={isCooldown || !inputText.trim()}
            accessibilityRole="button"
            accessibilityLabel={i18n.t('chat.send')}
          >
            <Text style={styles.sendButtonText}>{i18n.t('chat.send')}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  // Panel drops down from the top of the screen.
  panel: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: PANEL_HEIGHT,
    backgroundColor: 'rgba(10,10,20,0.96)',
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
    zIndex: 200,
    elevation: 10, // Android z-ordering
  },
  // ── Header ─────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#444',
  },
  dragHandle: {
    width: 32,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#555',
    marginRight: 10,
  },
  headerTitle: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  closeIcon: {
    color: '#aaa',
    fontSize: 16,
    paddingLeft: 8,
  },
  // ── Messages ─────────────────────────────────────────────────────────
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: '#777',
    fontSize: 13,
  },
  messageList: {
    flex: 1,
  },
  messageListContent: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  bubble: {
    maxWidth: '75%',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    marginVertical: 2,
  },
  bubbleOwn: {
    alignSelf: 'flex-end',
    backgroundColor: '#4A90E2',
  },
  bubbleOther: {
    alignSelf: 'flex-start',
    backgroundColor: '#333',
  },
  bubbleUsername: {
    color: '#aaa',
    fontSize: 11,
    marginBottom: 2,
  },
  bubbleText: {
    color: '#fff',
    fontSize: 14,
  },
  bubbleTime: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 10,
    alignSelf: 'flex-end',
    marginTop: 2,
  },
  // ── Input ─────────────────────────────────────────────────────────────
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#444',
  },
  input: {
    flex: 1,
    backgroundColor: '#222',
    color: '#fff',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 14,
    marginRight: 8,
  },
  sendButton: {
    backgroundColor: '#4A90E2',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
  sendButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
});
