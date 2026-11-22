import React, { useId, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { COURSE_COLOR_PALETTE, getReadableTextColor } from '@/constants/theme';
import { usePreferences } from '@/hooks/use-preferences';
import {
  CheckIcon,
  CloseIcon,
  CourseIcon,
  PaletteIcon,
} from '@/components/icons/NoodleIcons';

export interface ColorPalettePickerModalProps {
  visible: boolean;
  initialColor: string;
  courseName?: string;
  onSelectColor: (hex: string) => void;
  onClose: () => void;
}

export interface HsvColor {
  h: number;
  s: number;
  v: number;
}

/**
 * 36 curated spectrum tiles (6 hue families x 6 saturation/brightness levels)
 * offering quick one-tap pastel, balanced, and deep tones beyond the 14 defaults.
 */
export const SPECTRUM_GRID_COLORS: readonly string[] = [
  // Row 1: Airy Pastels
  '#F4B4A7', '#F2CC96', '#AED6B8', '#9BD3DE', '#B0B8EE', '#EAAFD1',
  // Row 2: Noodle Pastels
  '#E58C7A', '#E2B86B', '#7DB899', '#74AEE3', '#9D8BE3', '#DF86AC',
  // Row 3: Muted / Earthy
  '#C9846B', '#C9A25B', '#6BB0A8', '#7E9BB5', '#8296E0', '#BE89D6',
  // Row 4: Vivid Midtones
  '#E06358', '#E5963E', '#4BAE7C', '#3A94D6', '#7265DE', '#D4579B',
  // Row 5: Rich Saturated
  '#C24138', '#C47524', '#2F8B5E', '#246EB9', '#5546C2', '#AD3878',
  // Row 6: Deep / Ink Accents
  '#8F2D27', '#8C5218', '#1F6343', '#1B4E85', '#3D3191', '#7A2455',
] as const;

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function normalizeHex(raw: string): string | null {
  const cleaned = (raw || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(cleaned)) {
    const expanded = cleaned
      .split('')
      .map((ch) => ch + ch)
      .join('')
      .toUpperCase();
    return `#${expanded}`;
  }
  if (/^[0-9a-f]{6}$/i.test(cleaned)) {
    return `#${cleaned.toUpperCase()}`;
  }
  return null;
}

export function hexToHsv(hex: string): HsvColor {
  const normalized = normalizeHex(hex) ?? '#74AEE3';
  const r = parseInt(normalized.slice(1, 3), 16) / 255;
  const g = parseInt(normalized.slice(3, 5), 16) / 255;
  const b = parseInt(normalized.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta > 1e-6) {
    if (max === r) {
      h = 60 * (((g - b) / delta) % 6);
    } else if (max === g) {
      h = 60 * ((b - r) / delta + 2);
    } else {
      h = 60 * ((r - g) / delta + 4);
    }
    if (h < 0) h += 360;
  }

  const s = max <= 1e-6 ? 0 : delta / max;
  const v = max;
  return { h: clamp(h, 0, 359.99), s: clamp(s, 0, 1), v: clamp(v, 0, 1) };
}

export function hsvToHex(h: number, s: number, v: number): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s, 0, 1);
  const val = clamp(v, 0, 1);

  const c = val * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = val - c;

  let rp = 0;
  let gp = 0;
  let bp = 0;

  if (hue < 60) {
    rp = c;
    gp = x;
  } else if (hue < 120) {
    rp = x;
    gp = c;
  } else if (hue < 180) {
    gp = c;
    bp = x;
  } else if (hue < 240) {
    gp = x;
    bp = c;
  } else if (hue < 300) {
    rp = x;
    bp = c;
  } else {
    rp = c;
    bp = x;
  }

  const toHexByte = (channel: number): string =>
    clamp(Math.round((channel + m) * 255), 0, 255)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase();

  return `#${toHexByte(rp)}${toHexByte(gp)}${toHexByte(bp)}`;
}

export function ColorPalettePickerModal({
  visible,
  initialColor,
  courseName,
  onSelectColor,
  onClose,
}: ColorPalettePickerModalProps) {
  const { theme, isRtl, t } = usePreferences();
  const reactId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const svSatId = `cpSvSat_${reactId}`;
  const svValId = `cpSvVal_${reactId}`;
  const hueGradId = `cpHue_${reactId}`;

  const safeInitial =
    normalizeHex(initialColor) ?? COURSE_COLOR_PALETTE[0] ?? '#E58C7A';

  const [hsv, setHsv] = useState<HsvColor>(() => hexToHsv(safeInitial));
  const [hexInput, setHexInput] = useState<string>(safeInitial);
  const [prevVisible, setPrevVisible] = useState<boolean>(false);
  const [svSize, setSvSize] = useState<{ w: number; h: number }>({ w: 280, h: 170 });
  const [hueWidth, setHueWidth] = useState<number>(280);

  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible) {
      const nextInitial =
        normalizeHex(initialColor) ?? COURSE_COLOR_PALETTE[0] ?? '#E58C7A';
      const nextHsv = hexToHsv(nextInitial);
      setHsv(nextHsv);
      setHexInput(nextInitial);
    }
  }

  const selectedHex = useMemo(
    () => hsvToHex(hsv.h, hsv.s, hsv.v),
    [hsv.h, hsv.s, hsv.v]
  );
  const pureHueHex = useMemo(() => hsvToHex(hsv.h, 1, 1), [hsv.h]);
  const contrastColor = useMemo(
    () => getReadableTextColor(selectedHex),
    [selectedHex]
  );

  const svPanResponder = useMemo(() => {
    const applySvFromEvent = (evt: { nativeEvent: { locationX?: number; locationY?: number } }) => {
      if (svSize.w <= 0 || svSize.h <= 0) return;
      const x = clamp(evt.nativeEvent.locationX ?? svSize.w * 0.5, 0, svSize.w);
      const y = clamp(evt.nativeEvent.locationY ?? svSize.h * 0.5, 0, svSize.h);
      const nextS = clamp(x / svSize.w, 0, 1);
      const nextV = clamp(1 - y / svSize.h, 0, 1);
      setHsv((prev) => {
        const next: HsvColor = { h: prev.h, s: nextS, v: nextV };
        setHexInput(hsvToHex(next.h, next.s, next.v));
        return next;
      });
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (evt) => {
        applySvFromEvent(evt);
      },
      onPanResponderMove: (evt) => {
        applySvFromEvent(evt);
      },
    });
  }, [svSize.h, svSize.w]);

  const huePanResponder = useMemo(() => {
    const applyHueFromEvent = (evt: { nativeEvent: { locationX?: number } }) => {
      if (hueWidth <= 0) return;
      const x = clamp(evt.nativeEvent.locationX ?? hueWidth * 0.5, 0, hueWidth);
      const nextH = clamp(x / hueWidth, 0, 0.9999) * 360;
      setHsv((prev) => {
        const next: HsvColor = { h: nextH, s: prev.s, v: prev.v };
        setHexInput(hsvToHex(next.h, next.s, next.v));
        return next;
      });
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (evt) => {
        applyHueFromEvent(evt);
      },
      onPanResponderMove: (evt) => {
        applyHueFromEvent(evt);
      },
    });
  }, [hueWidth]);

  const applyHexSelection = (hex: string) => {
    const normalized = normalizeHex(hex);
    if (!normalized) return;
    const nextHsv = hexToHsv(normalized);
    setHsv(nextHsv);
    setHexInput(normalized);
  };

  const handleHexTextChange = (txt: string) => {
    setHexInput(txt);
    const normalized = normalizeHex(txt);
    if (normalized) {
      const nextHsv = hexToHsv(normalized);
      setHsv(nextHsv);
    }
  };

  const handleHexBlur = () => {
    const normalized = normalizeHex(hexInput);
    setHexInput(normalized ?? selectedHex);
  };

  const handleApply = () => {
    const normalized = normalizeHex(hexInput) ?? selectedHex;
    onSelectColor(normalized);
    onClose();
  };

  const rowDir = isRtl ? 'row-reverse' : 'row';
  const textAlign = isRtl ? 'right' : 'left';
  const svThumbLeft = clamp(hsv.s * svSize.w - 10, -10, Math.max(-10, svSize.w - 10));
  const svThumbTop = clamp(
    (1 - hsv.v) * svSize.h - 10,
    -10,
    Math.max(-10, svSize.h - 10)
  );
  const hueThumbLeft = clamp(
    (hsv.h / 360) * hueWidth - 11,
    0,
    Math.max(0, hueWidth - 22)
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.backgroundElement,
              borderColor: theme.border,
            },
          ]}
        >
          {/* Header */}
          <View
            style={[
              styles.header,
              { borderBottomColor: theme.border, flexDirection: rowDir },
            ]}
          >
            <View style={[styles.headerTitleWrap, { flexDirection: rowDir }]}>
              <PaletteIcon size={18} color={theme.primary} />
              <Text
                style={[styles.headerTitle, { color: theme.text, textAlign }]}
                numberOfLines={1}
              >
                {t('custom_color_picker_title')}
              </Text>
            </View>
            <TouchableOpacity
              testID="color-picker-close-btn"
              onPress={onClose}
              style={[styles.closeBtn, { backgroundColor: theme.backgroundSelected }]}
              accessibilityLabel={t('cancel')}
            >
              <CloseIcon size={17} color={theme.text} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.bodyScroll}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Live Course Card Preview */}
            <Text
              style={[styles.sectionLabel, { color: theme.textSecondary, textAlign }]}
            >
              {t('color_preview_label')}
            </Text>
            <View
              testID="color-picker-preview"
              style={[
                styles.previewCard,
                {
                  backgroundColor: theme.background,
                  borderColor: selectedHex,
                  flexDirection: rowDir,
                },
              ]}
            >
              <View
                style={[styles.previewAccentStrip, { backgroundColor: selectedHex }]}
              />
              <View
                style={[
                  styles.previewIconWrap,
                  { backgroundColor: `${selectedHex}24` },
                ]}
              >
                <CourseIcon size={16} color={selectedHex} />
              </View>
              <Text
                style={[styles.previewCourseName, { color: theme.text, textAlign }]}
                numberOfLines={1}
              >
                {courseName?.trim() || t('color_preview_sample_course')}
              </Text>
              <View
                style={[styles.previewHexPill, { backgroundColor: selectedHex }]}
              >
                <Text
                  style={[styles.previewHexPillText, { color: contrastColor }]}
                >
                  {selectedHex}
                </Text>
              </View>
            </View>

            {/* 2D Saturation / Value SVG Canvas */}
            <View
              testID="color-picker-sv-canvas"
              onLayout={(e) => {
                const w = Math.round(e.nativeEvent.layout.width);
                const h = Math.round(e.nativeEvent.layout.height);
                if (w > 0 && h > 0) {
                  setSvSize({ w, h });
                }
              }}
              style={[styles.svCanvas, { borderColor: theme.border }]}
              {...svPanResponder.panHandlers}
            >
              <Svg pointerEvents="none" width="100%" height="100%">
                <Defs>
                  <LinearGradient id={svSatId} x1="0%" y1="0%" x2="100%" y2="0%">
                    <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={1} />
                    <Stop offset="100%" stopColor={pureHueHex} stopOpacity={1} />
                  </LinearGradient>
                  <LinearGradient id={svValId} x1="0%" y1="0%" x2="0%" y2="100%">
                    <Stop offset="0%" stopColor="#000000" stopOpacity={0} />
                    <Stop offset="100%" stopColor="#000000" stopOpacity={1} />
                  </LinearGradient>
                </Defs>
                <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${svSatId})`} />
                <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${svValId})`} />
              </Svg>
              <View
                pointerEvents="none"
                style={[
                  styles.svThumb,
                  {
                    left: svThumbLeft,
                    top: svThumbTop,
                    backgroundColor: selectedHex,
                    borderColor: contrastColor,
                  },
                ]}
              />
            </View>

            {/* 360-deg Hue Slider Bar */}
            <View
              testID="color-picker-hue-bar"
              onLayout={(e) => {
                const w = Math.round(e.nativeEvent.layout.width);
                if (w > 0) setHueWidth(w);
              }}
              style={[styles.hueBar, { borderColor: theme.border }]}
              {...huePanResponder.panHandlers}
            >
              <Svg pointerEvents="none" width="100%" height="100%">
                <Defs>
                  <LinearGradient id={hueGradId} x1="0%" y1="0%" x2="100%" y2="0%">
                    <Stop offset="0%" stopColor="#FF0000" />
                    <Stop offset="16.67%" stopColor="#FFFF00" />
                    <Stop offset="33.33%" stopColor="#00FF00" />
                    <Stop offset="50%" stopColor="#00FFFF" />
                    <Stop offset="66.67%" stopColor="#0000FF" />
                    <Stop offset="83.33%" stopColor="#FF00FF" />
                    <Stop offset="100%" stopColor="#FF0000" />
                  </LinearGradient>
                </Defs>
                <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${hueGradId})`} />
              </Svg>
              <View
                pointerEvents="none"
                style={[
                  styles.hueThumb,
                  {
                    left: hueThumbLeft,
                    backgroundColor: pureHueHex,
                  },
                ]}
              />
            </View>

            {/* 36-Tile Spectrum Grid */}
            <Text
              style={[styles.sectionLabel, { color: theme.textSecondary, textAlign }]}
            >
              {t('color_spectrum_presets')}
            </Text>
            <View testID="color-picker-spectrum-grid" style={styles.spectrumGrid}>
              {SPECTRUM_GRID_COLORS.map((hex) => {
                const isActive = selectedHex.toLowerCase() === hex.toLowerCase();
                return (
                  <TouchableOpacity
                    key={hex}
                    testID={`spectrum-tile-${hex}`}
                    onPress={() => applyHexSelection(hex)}
                    style={[
                      styles.spectrumTile,
                      {
                        backgroundColor: hex,
                        borderColor: isActive ? theme.text : 'rgba(0,0,0,0.08)',
                        borderWidth: isActive ? 2 : 1,
                      },
                    ]}
                    accessibilityLabel={`${t('course_color')} ${hex}`}
                  >
                    {isActive && (
                      <CheckIcon
                        size={12}
                        color={getReadableTextColor(hex)}
                        strokeWidth={2.6}
                      />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Hex Input Row */}
            <View style={[styles.hexRow, { flexDirection: rowDir }]}>
              <Text style={[styles.hexLabel, { color: theme.textSecondary }]}>
                {t('custom_color_hex')}
              </Text>
              <View
                style={[
                  styles.hexInputWrap,
                  {
                    backgroundColor: theme.background,
                    borderColor: theme.border,
                    flexDirection: rowDir,
                  },
                ]}
              >
                <View style={[styles.hexDot, { backgroundColor: selectedHex }]} />
                <TextInput
                  testID="color-picker-hex-input"
                  value={hexInput}
                  onChangeText={handleHexTextChange}
                  onBlur={handleHexBlur}
                  maxLength={7}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  placeholder="#E58C7A"
                  placeholderTextColor={theme.placeholder}
                  style={[styles.hexInput, { color: theme.text }]}
                  textAlign="left"
                />
              </View>
            </View>
          </ScrollView>

          {/* Footer */}
          <View
            style={[
              styles.footer,
              { borderTopColor: theme.border, flexDirection: rowDir },
            ]}
          >
            <TouchableOpacity
              onPress={onClose}
              style={[styles.cancelBtn, { backgroundColor: theme.backgroundSelected }]}
            >
              <Text style={[styles.cancelBtnText, { color: theme.text }]}>
                {t('cancel')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="color-picker-apply-btn"
              onPress={handleApply}
              style={[
                styles.applyBtn,
                { backgroundColor: selectedHex, flexDirection: rowDir },
              ]}
            >
              <CheckIcon size={15} color={contrastColor} strokeWidth={2.5} />
              <Text style={[styles.applyBtnText, { color: contrastColor }]}>
                {t('apply_color_btn')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.54)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '90%',
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden',
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  headerTitleWrap: {
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    flex: 1,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bodyScroll: {
    flexGrow: 0,
  },
  bodyContent: {
    padding: 16,
    gap: 12,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  previewCard: {
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 10,
    paddingVertical: 10,
    alignItems: 'center',
    gap: 8,
    overflow: 'hidden',
  },
  previewAccentStrip: {
    width: 5,
    height: 24,
    borderRadius: 3,
  },
  previewIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewCourseName: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: '700',
  },
  previewHexPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  previewHexPillText: {
    fontSize: 11,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  svCanvas: {
    height: 168,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
    direction: 'ltr',
  },
  svThumb: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2.5,
  },
  hueBar: {
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
    justifyContent: 'center',
    direction: 'ltr',
  },
  hueThumb: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2.5,
    borderColor: '#ffffff',
    top: 1,
  },
  spectrumGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
  },
  spectrumTile: {
    width: '14%',
    aspectRatio: 1,
    minHeight: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hexRow: {
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 2,
  },
  hexLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  hexInputWrap: {
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 136,
  },
  hexDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  hexInput: {
    fontSize: 13.5,
    fontWeight: '700',
    minWidth: 80,
    paddingVertical: 2,
    fontVariant: ['tabular-nums'],
  },
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
  },
  cancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  cancelBtnText: {
    fontSize: 13.5,
    fontWeight: '700',
  },
  applyBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    gap: 6,
  },
  applyBtnText: {
    fontSize: 13.5,
    fontWeight: '800',
  },
});
