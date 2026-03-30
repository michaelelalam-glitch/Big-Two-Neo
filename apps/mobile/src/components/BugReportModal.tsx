/**
 * BugReportModal — full-featured in-app bug/feedback submission form.
 *
 * Features:
 *  - Category selection (Bug / Suggestion / Performance / Crash / Other)
 *  - Multi-line description text input
 *  - Optional screenshot attachment via photo library (expo-image-picker)
 *  - Optional console log attachment (reads today's log file via expo-file-system)
 */

import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Image,
  ActivityIndicator,
  Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
// expo-file-system/legacy is used intentionally: the named exports
// (documentDirectory, getInfoAsync, readAsStringAsync, EncodingType) exist
// only in the legacy API. The non-legacy path exposes a class-based API
// (Paths.document, File) that would require a separate, larger refactor.
import {
  documentDirectory,
  getInfoAsync,
  readAsStringAsync,
  EncodingType,
} from 'expo-file-system/legacy';
import { COLORS, SPACING, FONT_SIZES } from '../constants';
import { submitBugReportWithOptions, isSentryEnabled, BugReportCategory } from '../services/sentry';
import { trackEvent } from '../services/analytics';
import { showSuccess, showError } from '../utils';
import { getTodayLogFileName } from '../utils/logger';
import { i18n } from '../i18n';

const t = (key: string) => i18n.t(key);

// ─── Constants ────────────────────────────────────────────────────────────── //

/** Alias for the canonical BugReportCategory type defined in sentry.ts. */
export type BugCategory = BugReportCategory;

const CATEGORIES: BugCategory[] = ['Bug', 'Suggestion', 'Performance', 'Crash', 'Other'];

// ─── Props ────────────────────────────────────────────────────────────────── //

interface BugReportModalProps {
  visible: boolean;
  onClose: () => void;
  userEmail?: string;
  userName?: string;
}

// ─── Component ────────────────────────────────────────────────────────────── //

export default function BugReportModal({
  visible,
  onClose,
  userEmail,
  userName,
}: BugReportModalProps) {
  const [category, setCategory] = useState<BugCategory>('Bug');
  const [description, setDescription] = useState('');
  const [screenshotUri, setScreenshotUri] = useState<string | null>(null);
  const [screenshotBase64, setScreenshotBase64] = useState<string | null>(null);
  const [screenshotMimeType, setScreenshotMimeType] = useState<string | null>(null);
  const [includeLog, setIncludeLog] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // ── Helpers ──────────────────────────────────────────────────────────────── //

  const handlePickScreenshot = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      showError(t('bugReportModal.photoPermissionDenied'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      base64: true,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets.length > 0) {
      const asset = result.assets[0];
      setScreenshotUri(asset.uri);
      setScreenshotBase64(asset.base64 ?? null);
      setScreenshotMimeType(asset.mimeType ?? null);
    }
  };

  const handleRemoveScreenshot = () => {
    setScreenshotUri(null);
    setScreenshotBase64(null);
    setScreenshotMimeType(null);
  };

  const readTodayLog = async (): Promise<string | null> => {
    try {
      if (!documentDirectory) return null;
      // Use the centralised helper so the filename format stays in sync with
      // the production logger transport (react-native-logs {date-today}).
      const logPath = `${documentDirectory}${getTodayLogFileName()}`;
      const info = await getInfoAsync(logPath);
      if (!info.exists) return null;
      // Read last 50 KB without loading the entire file into memory
      const maxBytes = 51200;
      const fileSize =
        typeof (info as { size?: number }).size === 'number'
          ? (info as { size?: number }).size!
          : undefined;
      if (fileSize && fileSize > maxBytes) {
        const start = fileSize - maxBytes;
        return await readAsStringAsync(logPath, {
          position: start,
          length: maxBytes,
          encoding: EncodingType.UTF8,
        } as Parameters<typeof readAsStringAsync>[1]);
      }
      return await readAsStringAsync(logPath, { encoding: EncodingType.UTF8 });
    } catch {
      return null;
    }
  };

  const handleSubmit = async () => {
    if (!description.trim()) {
      showError(t('bugReportModal.descriptionRequired'));
      return;
    }
    if (!isSentryEnabled()) {
      showError(t('settings.bugReportUnavailable'));
      return;
    }

    setSubmitting(true);
    try {
      let consoleLog: string | undefined;
      if (includeLog) {
        consoleLog = (await readTodayLog()) ?? undefined;
      }

      submitBugReportWithOptions({
        description: description.trim(),
        category,
        email: userEmail,
        name: userName,
        screenshotBase64: screenshotBase64 ?? undefined,
        screenshotMimeType: screenshotMimeType ?? undefined,
        consoleLog,
      });

      trackEvent('bug_report_submitted', {
        category,
        has_screenshot: screenshotBase64 ? 'yes' : 'no',
        has_log: consoleLog ? 'yes' : 'no',
        description_length: description.trim().length,
      });

      showSuccess(t('settings.bugReportSubmitted'));
      handleClose();
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setCategory('Bug');
    setDescription('');
    setScreenshotUri(null);
    setScreenshotBase64(null);
    setScreenshotMimeType(null);
    setIncludeLog(false);
    onClose();
  };

  // ── Render ───────────────────────────────────────────────────────────────── //

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.cancelButton} onPress={handleClose}>
            <Text style={styles.cancelText}>{t('common.cancel')}</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('bugReportModal.title')}</Text>
          <TouchableOpacity
            style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator size="small" color={COLORS.white} />
            ) : (
              <Text style={styles.submitText}>{t('common.submit')}</Text>
            )}
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.scrollView} keyboardShouldPersistTaps="handled">
          {/* Category */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t('bugReportModal.categoryLabel')}</Text>
            <View style={styles.categoryRow}>
              {CATEGORIES.map(cat => (
                <TouchableOpacity
                  key={cat}
                  style={[styles.categoryChip, category === cat && styles.categoryChipActive]}
                  onPress={() => setCategory(cat)}
                >
                  <Text
                    style={[
                      styles.categoryChipText,
                      category === cat && styles.categoryChipTextActive,
                    ]}
                  >
                    {t(`bugReportModal.category${cat}`)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Description */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t('bugReportModal.descriptionLabel')}</Text>
            <TextInput
              style={styles.textInput}
              placeholder={t('bugReportModal.descriptionPlaceholder')}
              placeholderTextColor={COLORS.gray.medium}
              multiline
              numberOfLines={Platform.OS === 'ios' ? undefined : 6}
              textAlignVertical="top"
              value={description}
              onChangeText={setDescription}
              maxLength={2000}
            />
            <Text style={styles.charCount}>{description.length}/2000</Text>
          </View>

          {/* Screenshot */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t('bugReportModal.screenshotLabel')}</Text>
            {screenshotUri ? (
              <View style={styles.screenshotPreviewContainer}>
                <Image source={{ uri: screenshotUri }} style={styles.screenshotPreview} />
                <TouchableOpacity style={styles.removeButton} onPress={handleRemoveScreenshot}>
                  <Text style={styles.removeButtonText}>
                    {t('bugReportModal.removeScreenshot')}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={styles.attachButton} onPress={handlePickScreenshot}>
                <Text style={styles.attachButtonText}>{t('bugReportModal.attachScreenshot')}</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Console log */}
          <View style={styles.section}>
            <TouchableOpacity
              style={styles.toggleRow}
              onPress={() => setIncludeLog(v => !v)}
              activeOpacity={0.7}
            >
              <View style={styles.toggleInfo}>
                <Text style={styles.sectionLabel}>{t('bugReportModal.includeLogLabel')}</Text>
                <Text style={styles.toggleDescription}>
                  {t('bugReportModal.includeLogDescription')}
                </Text>
              </View>
              <View style={[styles.toggle, includeLog && styles.toggleActive]}>
                <View style={[styles.toggleKnob, includeLog && styles.toggleKnobActive]} />
              </View>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────── //

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.primary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray.dark,
  },
  headerTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '700',
    color: COLORS.white,
  },
  cancelButton: {
    paddingVertical: SPACING.xs,
    paddingRight: SPACING.sm,
  },
  cancelText: {
    fontSize: FONT_SIZES.md,
    color: COLORS.gray.medium,
  },
  submitButton: {
    backgroundColor: COLORS.accent,
    borderRadius: 8,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    minWidth: 70,
    alignItems: 'center',
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitText: {
    fontSize: FONT_SIZES.md,
    fontWeight: '700',
    color: COLORS.white,
  },
  scrollView: {
    flex: 1,
  },
  section: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray.dark,
  },
  sectionLabel: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
    color: COLORS.gray.medium,
    textTransform: 'uppercase',
    marginBottom: SPACING.sm,
  },
  categoryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  categoryChip: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.gray.dark,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
  },
  categoryChipActive: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  categoryChipText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.gray.medium,
    fontWeight: '500',
  },
  categoryChipTextActive: {
    color: COLORS.white,
    fontWeight: '700',
  },
  textInput: {
    backgroundColor: COLORS.gray.dark,
    borderRadius: 8,
    padding: SPACING.md,
    fontSize: FONT_SIZES.md,
    color: COLORS.white,
    minHeight: 120,
  },
  charCount: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.gray.medium,
    textAlign: 'right',
    marginTop: SPACING.xs,
  },
  attachButton: {
    borderWidth: 1,
    borderColor: COLORS.secondary,
    borderRadius: 8,
    borderStyle: 'dashed',
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  attachButtonText: {
    fontSize: FONT_SIZES.md,
    color: COLORS.secondary,
    fontWeight: '600',
  },
  screenshotPreviewContainer: {
    gap: SPACING.sm,
  },
  screenshotPreview: {
    width: '100%',
    height: 180,
    borderRadius: 8,
    resizeMode: 'contain',
    backgroundColor: COLORS.gray.dark,
  },
  removeButton: {
    alignSelf: 'flex-end',
  },
  removeButtonText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.error,
    fontWeight: '600',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleInfo: {
    flex: 1,
    marginRight: SPACING.md,
  },
  toggleDescription: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.gray.medium,
    marginTop: 2,
  },
  toggle: {
    width: 48,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.gray.dark,
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  toggleActive: {
    backgroundColor: COLORS.accent,
  },
  toggleKnob: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.white,
  },
  toggleKnobActive: {
    alignSelf: 'flex-end',
  },
});
