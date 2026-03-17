/**
 * ChatDrawer — collapsible bottom drawer for in-game text chat (Task #648).
 *
 * Collapsed: thin pressable bar with 💬 icon + unread badge.
 * Expanded: message list + text input with send button.
 */

import React, { useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { i18n } from '../../i18n';
import type { ChatMessage } from '../../types/chat';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ChatDrawerProps {
  messages: ChatMessage[];
  sendMessage: (text: string) => void;
  unreadCount: number;
  isCooldown: boolean;
  isOpen: boolean;
  onToggle: () => void;
  localUserId: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLLAPSED_HEIGHT = 40;
const EXPANDED_HEIGHT = 280;
const ANIMATION_DURATION = 250;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ChatDrawer({
  messages,
  sendMessage,
  unreadCount,
  isCooldown,
  isOpen,
  onToggle,
  localUserId,
}: ChatDrawerProps) {
  const inputRef = useRef<TextInput>(null);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const [inputText, setInputText] = React.useState('');

  // Animated height
  const drawerHeight = useSharedValue(COLLAPSED_HEIGHT);

  useEffect(() => {
    drawerHeight.value = withTiming(isOpen ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT, {
      duration: ANIMATION_DURATION,
      easing: Easing.out(Easing.cubic),
    });
  }, [isOpen, drawerHeight]);

  const animatedStyle = useAnimatedStyle(() => ({
    height: drawerHeight.value,
  }));

  // Auto-scroll to bottom on new message
  useEffect(() => {
    if (isOpen && messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length, isOpen]);

  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text) return;
    sendMessage(text);
    setInputText('');
  }, [inputText, sendMessage]);

  // ── Collapsed bar ───────────────────────────────────────────────────────

  const renderCollapsedBar = () => (
    <Pressable style={styles.collapsedBar} onPress={onToggle} accessibilityRole="button" accessibilityLabel={i18n.t('chat.title')}>
      <Text style={styles.chatIcon}>💬</Text>
      <Text style={styles.chatLabel}>{i18n.t('chat.title')}</Text>
      {unreadCount > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
        </View>
      )}
    </Pressable>
  );

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
    <Animated.View style={[styles.container, animatedStyle]}>
      {!isOpen ? (
        renderCollapsedBar()
      ) : (
        <KeyboardAvoidingView
          style={styles.expandedContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={100}
        >
          {/* Header with close handle */}
          <Pressable style={styles.header} onPress={onToggle} accessibilityRole="button" accessibilityLabel={i18n.t('common.close')}>
            <View style={styles.dragHandle} />
            <Text style={styles.headerTitle}>{i18n.t('chat.title')}</Text>
          </Pressable>

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
            />
          )}

          {/* Input row */}
          <View style={styles.inputRow}>
            <TextInput
              ref={inputRef}
              style={styles.input}
              value={inputText}
              onChangeText={setInputText}
              placeholder={isCooldown ? i18n.t('chat.cooldown') : i18n.t('chat.placeholder')}
              placeholderTextColor="#888"
              maxLength={500}
              editable={!isCooldown}
              onSubmitEditing={handleSend}
              returnKeyType="send"
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
      )}
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.85)',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    overflow: 'hidden',
    zIndex: 100,
  },
  // ── Collapsed ─────────────────────────────────────────────────────────
  collapsedBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  chatIcon: {
    fontSize: 18,
    marginRight: 6,
  },
  chatLabel: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  badge: {
    marginLeft: 8,
    backgroundColor: '#F44336',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  // ── Expanded ──────────────────────────────────────────────────────────
  expandedContainer: {
    flex: 1,
  },
  header: {
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#444',
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#666',
    marginBottom: 4,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  // ── Messages ──────────────────────────────────────────────────────────
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
