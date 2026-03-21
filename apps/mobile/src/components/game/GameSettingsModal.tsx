import React, { useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
  useWindowDimensions,
  Share,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { tryCopyTextWithShareFallback } from '../../utils/clipboard';
import { COLORS, SPACING, FONT_SIZES, OVERLAYS, MODAL } from '../../constants';
import { i18n } from '../../i18n';
import { soundManager, hapticManager, HapticType } from '../../utils';
import { useAudioSettingsStore } from '../../store';

interface GameSettingsModalProps {
  visible: boolean;
  onClose: () => void;
  onLeaveGame: () => void;
  /** Room code to display (multiplayer only) */
  roomCode?: string;
  // ── Voice / video chat controls (multiplayer only) ──────────────────────────
  /** Whether the local player is in a chat session (voice or video) */
  isInChatSession?: boolean;
  /** Whether the local microphone is active */
  isLocalMicOn?: boolean;
  /** Whether the local camera is streaming */
  isLocalCameraOn?: boolean;
  /** Whether the video chat connect/disconnect is in-flight */
  isVideoChatConnecting?: boolean;
  /** Whether the audio-only connect/disconnect is in-flight */
  isAudioChatConnecting?: boolean;
  /** Toggle voice-only chat */
  onToggleVoiceChat?: () => Promise<void>;
  /** Join/leave full video+audio session */
  onToggleVideoChat?: () => Promise<void>;
  /** Toggle camera track on/off within an active session */
  onToggleCamera?: () => Promise<void>;
  /** Mute/unmute microphone */
  onToggleMic?: () => Promise<void>;
}

// Task #628: React.memo — bail out of re-renders driven by GameContext changes
// when modal is closed and props are reference-equal.
function GameSettingsModalComponent({
  visible,
  onClose,
  onLeaveGame,
  roomCode,
  isInChatSession = false,
  isLocalMicOn = false,
  isLocalCameraOn = false,
  isVideoChatConnecting = false,
  isAudioChatConnecting = false,
  onToggleVoiceChat,
  onToggleVideoChat,
  onToggleCamera,
  onToggleMic,
}: GameSettingsModalProps) {
  // Detect orientation
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  // Task #647: read sound/vibration from Zustand store (eliminates async useEffect on mount)
  const soundEnabled = useAudioSettingsStore(s => s.soundEnabled);
  const vibrationEnabled = useAudioSettingsStore(s => s.vibrationEnabled);
  const setSoundEnabled = useAudioSettingsStore(s => s.setSoundEnabled);
  const setVibrationEnabled = useAudioSettingsStore(s => s.setVibrationEnabled);
  const hydrate = useAudioSettingsStore(s => s.hydrate);

  // Fallback sync: if the persist store hasn't been hydrated from SettingsScreen
  // yet (e.g. user opens this modal on first launch before visiting Settings),
  // pull the current values from the manager singletons so the toggles are correct.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const managerSound = await soundManager.isAudioEnabled();
        const managerVibration = await hapticManager.isHapticsEnabled();
        if (!cancelled) {
          hydrate({ soundEnabled: managerSound, vibrationEnabled: managerVibration });
        }
      } catch {
        // Non-fatal: store defaults (true/true) remain in effect
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToggleSound = async () => {
    const newValue = !soundEnabled;
    setSoundEnabled(newValue); // Zustand (persists automatically)
    await soundManager.setAudioEnabled(newValue); // sync manager singleton
    // Play confirmation haptic
    if (vibrationEnabled) {
      hapticManager.trigger(HapticType.SELECTION);
    }
  };

  const handleToggleVibration = async () => {
    const newValue = !vibrationEnabled;
    setVibrationEnabled(newValue); // Zustand (persists automatically)
    await hapticManager.setHapticsEnabled(newValue); // sync manager singleton
    // Play confirmation haptic if enabling (ironic but standard UX)
    if (newValue) {
      hapticManager.trigger(HapticType.SELECTION);
    }
  };

  const handleLeaveGame = () => {
    // Close modal first, then trigger leave game flow
    // GameScreen will show the confirmation dialog
    onClose();
    onLeaveGame();
  };

  const handleCopyRoomCode = useCallback(async () => {
    if (!roomCode) return;
    const result = await tryCopyTextWithShareFallback(roomCode, i18n.t('lobby.shareTitle'));
    if (result === 'copied') {
      if (vibrationEnabled) hapticManager.trigger(HapticType.SUCCESS);
      Alert.alert(i18n.t('lobby.copiedTitle'), i18n.t('lobby.copiedMessage', { roomCode }));
    } else if (result === 'failed') {
      Alert.alert(i18n.t('lobby.copyFailedTitle'), i18n.t('lobby.copyFailedMessage', { roomCode }));
    }
    // 'shared': Share sheet was presented — no additional alert needed
  }, [roomCode, vibrationEnabled]);

  const handleShareRoomCode = useCallback(async () => {
    if (!roomCode) return;
    try {
      await Share.share({
        message:
          i18n.t('lobby.shareMessage', { roomCode }) ||
          `Join my Big Two game! Room code: ${roomCode}`,
        title: i18n.t('lobby.shareTitle') || 'Join Big Two Game',
      });
    } catch {
      // User dismissed the share sheet — no action needed
    }
  }, [roomCode]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      supportedOrientations={['portrait', 'landscape']}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <View
          style={[
            styles.modalContainer,
            isLandscape && styles.modalContainerLandscape,
            { maxHeight: height * 0.88 },
          ]}
          onStartShouldSetResponder={() => true}
        >
          <View style={[styles.header, isLandscape && styles.headerLandscape]}>
            <Text style={[styles.headerTitle, isLandscape && styles.headerTitleLandscape]}>
              {i18n.t('game.settings')}
            </Text>
            <Pressable
              onPress={onClose}
              style={styles.closeButton}
              testID="close-settings-button"
              accessibilityRole="button"
              accessibilityLabel="Close settings"
            >
              <Text style={styles.closeButtonText}>✕</Text>
            </Pressable>
          </View>

          {/* LANDSCAPE MODE: Single-row layout (no scroll) */}
          {isLandscape ? (
            <View style={styles.contentLandscape}>
              <Pressable
                style={styles.menuItemLandscape}
                onPress={handleToggleSound}
                accessibilityRole="button"
                accessibilityLabel={`${i18n.t('settings.soundEffects')}, currently ${soundEnabled ? i18n.t('common.on') : i18n.t('common.off')}`}
              >
                <Text style={styles.menuItemTextLandscape}>🔊</Text>
                <Text style={styles.menuItemLabelLandscape}>{i18n.t('settings.soundEffects')}</Text>
                <Text style={styles.menuItemValueLandscape}>
                  {soundEnabled ? i18n.t('common.on') : i18n.t('common.off')}
                </Text>
              </Pressable>

              <View style={styles.menuItemLandscape}>
                <Text style={[styles.menuItemTextLandscape, styles.disabledText]}>🎵</Text>
                <Text style={[styles.menuItemLabelLandscape, styles.disabledText]}>
                  {i18n.t('settings.music')}
                </Text>
                <Text style={[styles.menuItemValueLandscape, styles.disabledText]}>
                  {i18n.t('common.off')}
                </Text>
              </View>

              <Pressable
                style={styles.menuItemLandscape}
                onPress={handleToggleVibration}
                accessibilityRole="button"
                accessibilityLabel={`${i18n.t('settings.vibration')}, currently ${vibrationEnabled ? i18n.t('common.on') : i18n.t('common.off')}`}
              >
                <Text style={styles.menuItemTextLandscape}>📳</Text>
                <Text style={styles.menuItemLabelLandscape}>{i18n.t('settings.vibration')}</Text>
                <Text style={styles.menuItemValueLandscape}>
                  {vibrationEnabled ? i18n.t('common.on') : i18n.t('common.off')}
                </Text>
              </Pressable>

              <View style={styles.dividerLandscape} />

              {/* Voice / Video chat controls — landscape, multiplayer only */}
              {(onToggleVoiceChat || onToggleVideoChat || onToggleCamera || onToggleMic) && (
                <>
                  {/* Camera button — always visible in multiplayer (landscape).
                  Not in session: tap to join with camera.
                  In session: tap to toggle camera track on/off. */}
                  {(onToggleVideoChat || onToggleCamera) && (
                    <Pressable
                      style={[
                        styles.menuItemLandscape,
                        isInChatSession && isLocalCameraOn && styles.chatActiveItemLandscape,
                        (isVideoChatConnecting || isAudioChatConnecting) && styles.disabledItem,
                      ]}
                      testID="camera-toggle-button"
                      onPress={
                        isVideoChatConnecting || isAudioChatConnecting
                          ? undefined
                          : async () => {
                              if (!isInChatSession) {
                                await onToggleVideoChat?.();
                              } else {
                                await onToggleCamera?.();
                              }
                            }
                      }
                      disabled={isVideoChatConnecting || isAudioChatConnecting}
                      accessibilityRole="switch"
                      accessibilityLabel={
                        isVideoChatConnecting
                          ? i18n.t('chat.connectingVideo')
                          : !isInChatSession
                            ? `${i18n.t('chat.camera')}, ${i18n.t('common.off')} — ${i18n.t('chat.joinVideo')}`
                            : isLocalCameraOn
                              ? `${i18n.t('chat.camera')}, ${i18n.t('common.on')} — ${i18n.t('chat.tapTurnCameraOff')}`
                              : `${i18n.t('chat.camera')}, ${i18n.t('common.off')} — ${i18n.t('chat.tapTurnCameraOn')}`
                      }
                      accessibilityState={{
                        checked: isLocalCameraOn,
                        disabled: isVideoChatConnecting || isAudioChatConnecting,
                        busy: isVideoChatConnecting || isAudioChatConnecting,
                      }}
                    >
                      {isVideoChatConnecting ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.menuItemTextLandscape}>
                          {isLocalCameraOn ? '📷' : '📵'}
                        </Text>
                      )}
                      <Text style={styles.menuItemLabelLandscape}>{i18n.t('chat.camera')}</Text>
                      <Text style={styles.menuItemValueLandscape}>
                        {isLocalCameraOn ? i18n.t('common.on') : i18n.t('common.off')}
                      </Text>
                    </Pressable>
                  )}

                  {/* Microphone button — always visible in multiplayer (landscape).
                      Not in session: tap to join voice-only.
                      In session: tap to mute/unmute (both voice-only and video sessions).
                      Voice-only: a separate Leave Voice Chat button appears below. */}
                  {(onToggleVoiceChat || onToggleMic) && (
                    <Pressable
                      style={[
                        styles.menuItemLandscape,
                        isInChatSession && isLocalMicOn && styles.chatActiveItemLandscape,
                        (isAudioChatConnecting || isVideoChatConnecting) && styles.disabledItem,
                      ]}
                      testID="mic-toggle-button"
                      onPress={
                        isAudioChatConnecting || isVideoChatConnecting
                          ? undefined
                          : async () => {
                              if (!isInChatSession) {
                                await onToggleVoiceChat?.();
                              } else {
                                await onToggleMic?.();
                              }
                            }
                      }
                      disabled={isAudioChatConnecting || isVideoChatConnecting}
                      accessibilityRole="switch"
                      accessibilityLabel={
                        isAudioChatConnecting
                          ? i18n.t('chat.connectingVoice')
                          : !isInChatSession
                            ? `${i18n.t('chat.microphone')}, ${i18n.t('common.off')} — ${i18n.t('chat.joinVoice')}`
                            : isLocalMicOn
                              ? `${i18n.t('chat.microphone')}, ${i18n.t('common.on')} — ${i18n.t('chat.tapMute')}`
                              : `${i18n.t('chat.microphone')}, ${i18n.t('chat.muted')} — ${i18n.t('chat.tapUnmute')}`
                      }
                      accessibilityState={{
                        checked: isLocalMicOn,
                        disabled: isAudioChatConnecting || isVideoChatConnecting,
                        busy: isAudioChatConnecting,
                      }}
                    >
                      {isAudioChatConnecting ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.menuItemTextLandscape}>
                          {isLocalMicOn ? '🎤' : isInChatSession ? '🔇' : '🎙️'}
                        </Text>
                      )}
                      <Text style={styles.menuItemLabelLandscape}>{i18n.t('chat.microphone')}</Text>
                      <Text style={styles.menuItemValueLandscape}>
                        {!isInChatSession
                          ? i18n.t('common.off')
                          : isLocalMicOn
                            ? i18n.t('common.on')
                            : i18n.t('chat.muted')}
                      </Text>
                    </Pressable>
                  )}

                  {/* Leave Voice Chat — visible only in voice-only mode (no camera) */}
                  {isInChatSession && !isLocalCameraOn && onToggleVoiceChat && (
                    <Pressable
                      style={[styles.menuItemLandscape, styles.leaveGameItemLandscape]}
                      onPress={async () => {
                        await onToggleVoiceChat();
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={i18n.t('chat.leaveVoice')}
                    >
                      <Text style={styles.menuItemTextLandscape}>📵</Text>
                      <Text style={[styles.menuItemLabelLandscape, styles.leaveGameTextLandscape]}>
                        {i18n.t('chat.leaveVoice')}
                      </Text>
                    </Pressable>
                  )}

                  <View style={styles.dividerLandscape} />
                </>
              )}

              {/* Room Code in landscape — tap to copy */}
              {roomCode ? (
                <Pressable
                  style={styles.menuItemLandscape}
                  onPress={handleCopyRoomCode}
                  onLongPress={handleShareRoomCode}
                  accessibilityRole="button"
                  accessibilityLabel={`Room code ${roomCode}, tap to copy`}
                >
                  <Text style={styles.menuItemTextLandscape}>🏠</Text>
                  <Text style={styles.menuItemLabelLandscape}>{i18n.t('lobby.roomCode')}</Text>
                  <Text style={styles.menuItemValueLandscape}>{roomCode}</Text>
                </Pressable>
              ) : null}

              <Pressable
                style={[styles.menuItemLandscape, styles.leaveGameItemLandscape]}
                onPress={handleLeaveGame}
                accessibilityRole="button"
                accessibilityLabel="Leave game"
              >
                <Text style={styles.leaveGameTextLandscape}>{i18n.t('game.leaveGame')}</Text>
              </Pressable>
            </View>
          ) : (
            /* PORTRAIT MODE: Scrollable vertical layout */
            <ScrollView
              contentContainerStyle={styles.content}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              {/* Sound Settings */}
              <Pressable
                style={styles.menuItem}
                onPress={handleToggleSound}
                accessibilityRole="button"
                accessibilityLabel={`${i18n.t('settings.soundEffects')}, currently ${soundEnabled ? i18n.t('common.on') : i18n.t('common.off')}`}
                accessibilityHint="Tap to toggle sound effects"
              >
                <Text style={styles.menuItemText}>🔊 {i18n.t('settings.soundEffects')}</Text>
                <Text style={styles.menuItemValue}>
                  {soundEnabled ? i18n.t('common.on') : i18n.t('common.off')}
                </Text>
              </Pressable>

              {/* Music Settings - Coming Soon (non-interactive) */}
              <View style={[styles.menuItem, styles.disabledItem]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={[styles.menuItemText, styles.disabledText]}>
                    🎵 {i18n.t('settings.music')}
                  </Text>
                  <Text style={styles.comingSoonBadge}>Coming soon</Text>
                </View>
                <Text style={styles.disabledText}>{i18n.t('common.off')}</Text>
              </View>

              {/* Vibration Settings */}
              <Pressable
                style={styles.menuItem}
                onPress={handleToggleVibration}
                accessibilityRole="button"
                accessibilityLabel={`${i18n.t('settings.vibration')}, currently ${vibrationEnabled ? i18n.t('common.on') : i18n.t('common.off')}`}
                accessibilityHint="Tap to toggle vibration"
              >
                <Text style={styles.menuItemText}>📳 {i18n.t('settings.vibration')}</Text>
                <Text style={styles.menuItemValue}>
                  {vibrationEnabled ? i18n.t('common.on') : i18n.t('common.off')}
                </Text>
              </Pressable>

              {/* Room Code — Multiplayer only.
                  The divider above is also gated on roomCode so single-player games
                  don't get two consecutive dividers with nothing between them. */}
              {roomCode ? (
                <>
                  <View style={styles.divider} />
                  <View style={styles.roomCodeContainer}>
                    <View style={styles.roomCodeLabelRow}>
                      <Text style={styles.roomCodeLabel}>🏠 {i18n.t('lobby.roomCode')}</Text>
                    </View>
                    <Text style={styles.roomCodeValue}>{roomCode}</Text>
                    <View style={styles.roomCodeButtonsRow}>
                      <Pressable
                        style={styles.roomCodeAction}
                        onPress={handleCopyRoomCode}
                        accessibilityRole="button"
                        accessibilityLabel="Copy room code"
                      >
                        <Text style={styles.roomCodeActionText}>{i18n.t('lobby.copy')}</Text>
                      </Pressable>
                      <Pressable
                        style={styles.roomCodeAction}
                        onPress={handleShareRoomCode}
                        accessibilityRole="button"
                        accessibilityLabel="Share room code"
                      >
                        <Text style={styles.roomCodeActionText}>{i18n.t('lobby.share')}</Text>
                      </Pressable>
                    </View>
                  </View>
                </>
              ) : null}

              <View style={styles.divider} />

              {/* Voice / Video chat controls — Multiplayer only.
                  Shows exactly two buttons: Camera (video) and Microphone.
                  - Camera: joins video session when not connected; toggles camera track when in session.
                  - Microphone: joins voice-only session when not connected; mutes/unmutes when in session. */}
              {(onToggleVoiceChat || onToggleVideoChat || onToggleCamera || onToggleMic) && (
                <>
                  <Text style={styles.sectionHeader}>🎙️ {i18n.t('chat.sectionTitle')}</Text>

                  {/* Camera button — always visible in multiplayer.
                      Not in session: tap to join with camera (calls onToggleVideoChat).
                      In session: tap to toggle camera track on/off (calls onToggleCamera). */}
                  {(onToggleVideoChat || onToggleCamera) && (
                    <Pressable
                      style={[
                        styles.menuItem,
                        isInChatSession && isLocalCameraOn && styles.chatActiveItem,
                        (isVideoChatConnecting || isAudioChatConnecting) && styles.disabledItem,
                      ]}
                      testID="camera-toggle-button"
                      onPress={
                        isVideoChatConnecting || isAudioChatConnecting
                          ? undefined
                          : async () => {
                              if (!isInChatSession) {
                                await onToggleVideoChat?.();
                              } else {
                                await onToggleCamera?.();
                              }
                            }
                      }
                      disabled={isVideoChatConnecting || isAudioChatConnecting}
                      accessibilityRole="switch"
                      accessibilityLabel={
                        isVideoChatConnecting
                          ? i18n.t('chat.connectingVideo')
                          : !isInChatSession
                            ? `${i18n.t('chat.camera')}, ${i18n.t('common.off')} — ${i18n.t('chat.joinVideo')}`
                            : isLocalCameraOn
                              ? `${i18n.t('chat.camera')}, ${i18n.t('common.on')} — ${i18n.t('chat.tapTurnCameraOff')}`
                              : `${i18n.t('chat.camera')}, ${i18n.t('common.off')} — ${i18n.t('chat.tapTurnCameraOn')}`
                      }
                      accessibilityState={{
                        checked: isLocalCameraOn,
                        disabled: isVideoChatConnecting || isAudioChatConnecting,
                        busy: isVideoChatConnecting || isAudioChatConnecting,
                      }}
                    >
                      <Text style={styles.menuItemText}>
                        {isLocalCameraOn ? '📷' : '📵'} {i18n.t('chat.camera')}
                      </Text>
                      {isVideoChatConnecting ? (
                        <ActivityIndicator size="small" color={COLORS.white} />
                      ) : (
                        <Text style={styles.menuItemValue}>
                          {isLocalCameraOn ? i18n.t('common.on') : i18n.t('common.off')}
                        </Text>
                      )}
                    </Pressable>
                  )}

                  {/* Microphone button — always visible in multiplayer.
                      Not in session: tap to join voice-only chat (calls onToggleVoiceChat).
                      In session: tap to mute/unmute microphone (calls onToggleMic).
                      Voice-only: a separate Leave Voice Chat button appears below. */}
                  {(onToggleVoiceChat || onToggleMic) && (
                    <Pressable
                      style={[
                        styles.menuItem,
                        isInChatSession && isLocalMicOn && styles.chatActiveItem,
                        (isAudioChatConnecting || isVideoChatConnecting) && styles.disabledItem,
                      ]}
                      testID="mic-toggle-button"
                      onPress={
                        isAudioChatConnecting || isVideoChatConnecting
                          ? undefined
                          : async () => {
                              if (!isInChatSession) {
                                await onToggleVoiceChat?.();
                              } else {
                                await onToggleMic?.();
                              }
                            }
                      }
                      disabled={isAudioChatConnecting || isVideoChatConnecting}
                      accessibilityRole="switch"
                      accessibilityLabel={
                        isAudioChatConnecting
                          ? i18n.t('chat.connectingVoice')
                          : !isInChatSession
                            ? `${i18n.t('chat.microphone')}, ${i18n.t('common.off')} — ${i18n.t('chat.joinVoice')}`
                            : isLocalMicOn
                              ? `${i18n.t('chat.microphone')}, ${i18n.t('common.on')} — ${i18n.t('chat.tapMute')}`
                              : `${i18n.t('chat.microphone')}, ${i18n.t('chat.muted')} — ${i18n.t('chat.tapUnmute')}`
                      }
                      accessibilityState={{
                        checked: isLocalMicOn,
                        disabled: isAudioChatConnecting || isVideoChatConnecting,
                        busy: isAudioChatConnecting,
                      }}
                    >
                      <Text style={styles.menuItemText}>
                        {isLocalMicOn ? '🎤' : isInChatSession ? '🔇' : '🎙️'}{' '}
                        {i18n.t('chat.microphone')}
                      </Text>
                      {isAudioChatConnecting ? (
                        <ActivityIndicator size="small" color={COLORS.white} />
                      ) : (
                        <Text style={styles.menuItemValue}>
                          {!isInChatSession
                            ? i18n.t('common.off')
                            : isLocalMicOn
                              ? i18n.t('common.on')
                              : i18n.t('chat.muted')}
                        </Text>
                      )}
                    </Pressable>
                  )}

                  {/* Leave Voice Chat — visible only in voice-only mode (no camera) */}
                  {isInChatSession && !isLocalCameraOn && onToggleVoiceChat && (
                    <Pressable
                      style={[styles.menuItem, styles.leaveGameItem]}
                      onPress={async () => {
                        await onToggleVoiceChat();
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={i18n.t('chat.leaveVoice')}
                    >
                      <Text style={[styles.menuItemText, styles.leaveGameText]}>
                        📵 {i18n.t('chat.leaveVoice')}
                      </Text>
                    </Pressable>
                  )}
                </>
              )}

              {/* Leave Game - Only shown in game */}
              <Pressable
                style={[styles.menuItem, styles.leaveGameItem]}
                onPress={handleLeaveGame}
                accessibilityRole="button"
                accessibilityLabel="Leave game"
                accessibilityHint="Leave the current game and return to home"
              >
                <Text style={[styles.menuItemText, styles.leaveGameText]}>
                  {i18n.t('game.leaveGame')}
                </Text>
              </Pressable>
            </ScrollView>
          )}
        </View>
      </Pressable>
    </Modal>
  );
}

export default React.memo(GameSettingsModalComponent);

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: OVERLAYS.modalOverlay,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    width: '85%',
    maxWidth: MODAL.maxWidth,
    backgroundColor: COLORS.primary,
    borderRadius: MODAL.borderRadius,
    borderWidth: MODAL.borderWidth,
    borderColor: COLORS.gray.medium,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SPACING.lg,
    paddingHorizontal: SPACING.xl,
    backgroundColor: COLORS.gray.dark,
    borderBottomWidth: MODAL.headerBorderWidth,
    borderBottomColor: COLORS.gray.medium,
  },
  headerTitle: {
    fontSize: FONT_SIZES.xl,
    fontWeight: 'bold',
    color: COLORS.white,
  },
  closeButton: {
    width: MODAL.closeButtonSize,
    height: MODAL.closeButtonSize,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: MODAL.closeButtonRadius,
    backgroundColor: OVERLAYS.closeButtonBackground,
  },
  closeButtonText: {
    fontSize: FONT_SIZES.xl,
    color: COLORS.white,
    fontWeight: 'bold',
  },
  content: {
    padding: SPACING.lg,
  },
  chatActiveItemLandscape: {
    borderWidth: 1,
    borderColor: '#60A5FA',
    backgroundColor: '#1E3A5F',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    backgroundColor: COLORS.gray.dark,
    borderRadius: MODAL.menuItemBorderRadius,
    marginBottom: SPACING.sm,
  },
  menuItemText: {
    fontSize: FONT_SIZES.lg,
    color: COLORS.white,
    fontWeight: '600',
  },
  menuItemValue: {
    fontSize: FONT_SIZES.md,
    color: COLORS.gray.light,
    fontWeight: '500',
  },
  divider: {
    height: MODAL.dividerHeight,
    backgroundColor: COLORS.gray.medium,
    marginVertical: SPACING.md,
  },
  leaveGameItem: {
    backgroundColor: OVERLAYS.leaveGameBackground,
    borderWidth: MODAL.leaveGameBorderWidth,
    borderColor: OVERLAYS.leaveGameBorder,
  },
  leaveGameText: {
    color: COLORS.danger,
  },
  sectionHeader: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.gray.light,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.xs,
    paddingBottom: SPACING.xs,
  },
  chatActiveItem: {
    borderWidth: 1,
    borderColor: '#60A5FA',
    backgroundColor: '#1E3A5F',
  },
  disabledItem: {
    opacity: 0.5,
  },
  disabledText: {
    color: COLORS.gray.medium,
  },
  comingSoonBadge: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.gray.medium,
    fontStyle: 'italic',
    opacity: 0.8,
  },
  // LANDSCAPE MODE STYLES - Compact horizontal layout
  modalContainerLandscape: {
    width: '96%',
    maxWidth: 800,
  },
  headerLandscape: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
  },
  headerTitleLandscape: {
    fontSize: FONT_SIZES.lg,
  },
  contentLandscape: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    gap: SPACING.sm,
  },
  menuItemLandscape: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    backgroundColor: COLORS.gray.dark,
    borderRadius: MODAL.menuItemBorderRadius,
    minWidth: 80,
    gap: 4,
  },
  menuItemTextLandscape: {
    fontSize: FONT_SIZES.xl,
  },
  menuItemLabelLandscape: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.white,
    fontWeight: '600',
    textAlign: 'center',
  },
  menuItemValueLandscape: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.gray.light,
    fontWeight: '500',
    textAlign: 'center',
  },
  dividerLandscape: {
    width: 1,
    height: 50,
    backgroundColor: COLORS.gray.medium,
  },
  leaveGameItemLandscape: {
    backgroundColor: OVERLAYS.leaveGameBackground,
    borderWidth: MODAL.leaveGameBorderWidth,
    borderColor: OVERLAYS.leaveGameBorder,
  },
  leaveGameTextLandscape: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.danger,
    fontWeight: '700',
    textAlign: 'center',
  },
  // ROOM CODE STYLES
  roomCodeContainer: {
    backgroundColor: COLORS.gray.dark,
    borderRadius: MODAL.menuItemBorderRadius,
    marginBottom: SPACING.sm,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
  },
  roomCodeLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  roomCodeLabel: {
    fontSize: FONT_SIZES.lg,
    color: COLORS.white,
    fontWeight: '600',
  },
  roomCodeButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: SPACING.sm,
    marginTop: SPACING.sm,
  },
  roomCodeValue: {
    fontSize: FONT_SIZES.xl,
    color: '#facc15',
    fontWeight: 'bold',
    letterSpacing: 4,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 4,
  },
  roomCodeAction: {
    paddingVertical: 4,
    paddingHorizontal: SPACING.md,
    backgroundColor: OVERLAYS.closeButtonBackground,
    borderRadius: 8,
  },
  roomCodeActionText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.white,
    fontWeight: '600',
  },
});
