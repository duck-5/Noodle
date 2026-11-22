import React, { useEffect, useId, useMemo, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewProps,
  ViewStyle,
} from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

const isJestEnv =
  typeof process !== 'undefined' && Boolean(process.env?.JEST_WORKER_ID);

const AnimatedSvgRect = Animated.createAnimatedComponent(Rect);

/**
 * Legacy helper kept for backward compatibility.
 * Layout transitions on Fabric / New Architecture should use `<ReanimatedLayoutBox>`.
 */
export function animateLayout(): void {
  // No-op: deprecated LayoutAnimation replaced by Reanimated LinearTransition in ReanimatedLayoutBox.
}

let reanimatedModule: typeof import('react-native-reanimated') | null = null;
if (!isJestEnv) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    reanimatedModule = require('react-native-reanimated');
  } catch {
    reanimatedModule = null;
  }
}

export interface ReanimatedLayoutBoxProps extends ViewProps {
  duration?: number;
  children?: React.ReactNode;
}

/**
 * Smooth Fabric-safe layout transition container powered by `react-native-reanimated`
 * `LinearTransition`. Falls back to a plain `<View>` in Jest or unsupported runtimes.
 */
export function ReanimatedLayoutBox({
  duration = 220,
  children,
  style,
  ...rest
}: ReanimatedLayoutBoxProps) {
  const layoutTransition = useMemo(() => {
    if (isJestEnv || !reanimatedModule?.LinearTransition) return undefined;
    try {
      return reanimatedModule.LinearTransition.duration(duration);
    } catch {
      return undefined;
    }
  }, [duration]);

  if (isJestEnv || !reanimatedModule?.default?.View || !layoutTransition) {
    return (
      <View style={style} {...rest}>
        {children}
      </View>
    );
  }

  const ReanimatedView = reanimatedModule.default.View;
  return (
    <ReanimatedView layout={layoutTransition} style={style} {...rest}>
      {children}
    </ReanimatedView>
  );
}

export interface NoodleGradientButtonProps {
  label: string;
  onPress: () => void;
  icon?: React.ReactNode;
  size?: 'xs' | 'sm' | 'md';
  isRtl?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  testID?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Signature 135-degree Purple-Magenta-Orange Noodle CTA gradient button
 * matching `.manage-courses-trigger-btn` and `.btn-go-to-course` in the Extension.
 */
export function NoodleGradientButton({
  label,
  onPress,
  icon,
  size = 'sm',
  isRtl = false,
  disabled = false,
  fullWidth = false,
  testID,
  accessibilityLabel,
  style,
}: NoodleGradientButtonProps) {
  const reactId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const gradId = `noodleBtnGrad_${reactId}`;
  const scaleAnim = useState(() => new Animated.Value(1))[0];

  const handlePressIn = () => {
    if (disabled || isJestEnv) return;
    Animated.spring(scaleAnim, {
      toValue: 0.97,
      speed: 35,
      bounciness: 0,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    if (isJestEnv) return;
    Animated.spring(scaleAnim, {
      toValue: 1,
      speed: 28,
      bounciness: 4,
      useNativeDriver: true,
    }).start();
  };

  const rowDir = isRtl ? 'row-reverse' : 'row';
  const sizePadStyle =
    size === 'xs'
      ? styles.gradBtnXsPad
      : size === 'md'
        ? styles.gradBtnMdPad
        : styles.gradBtnSmPad;
  const textSize = size === 'xs' ? 11.5 : size === 'md' ? 14 : 12.5;

  return (
    <Animated.View
      style={[
        fullWidth && styles.fullWidth,
        { transform: [{ scale: scaleAnim }] },
        style,
      ]}
    >
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || label}
        disabled={disabled}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={[
          styles.gradBtnOuter,
          size === 'xs' && styles.gradBtnXsRadius,
          fullWidth && styles.fullWidth,
          { opacity: disabled ? 0.6 : 1 },
        ]}
      >
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Svg
            pointerEvents="none"
            style={StyleSheet.absoluteFill}
            width="100%"
            height="100%"
            preserveAspectRatio="none"
          >
            <Defs>
              <LinearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
                <Stop offset="0%" stopColor="#5b48b6" />
                <Stop offset="48%" stopColor="#a04977" />
                <Stop offset="100%" stopColor="#d46337" />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradId})`} />
          </Svg>
        </View>

        <View
          style={[
            styles.gradBtnContent,
            sizePadStyle,
            fullWidth && styles.fullWidth,
            { flexDirection: rowDir },
          ]}
        >
          {icon}
          <Text
            style={[styles.gradBtnText, { fontSize: textSize }]}
            numberOfLines={1}
          >
            {label}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

export interface ClosestTaskGlowWrapProps {
  active: boolean;
  borderRadius?: number;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Traveling perimeter beam glow frame for the #1 main pending assignment,
 * matching `.queue-item.closest-task-glow` in the Extension without Android elevation artifacts.
 */
export function ClosestTaskGlowWrap({
  active,
  borderRadius = 12,
  children,
  style,
  testID,
}: ClosestTaskGlowWrapProps) {
  const reactId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const gradId = `closestGlowGrad_${reactId}`;
  const [beamAnim] = useState(() => new Animated.Value(0));
  const [boxSize, setBoxSize] = useState<{ w: number; h: number } | null>(null);

  const perimeter = useMemo(() => {
    if (!boxSize) return 0;
    const rw = Math.max(1, boxSize.w - 1.5);
    const rh = Math.max(1, boxSize.h - 1.5);
    const r = Math.min(borderRadius, rw / 2, rh / 2);
    return 2 * (rw + rh - 2 * r) + 2 * Math.PI * r;
  }, [boxSize, borderRadius]);

  useEffect(() => {
    if (!active || isJestEnv || perimeter <= 0) {
      beamAnim.setValue(0);
      return;
    }
    beamAnim.setValue(0);
    const loop = Animated.loop(
      Animated.timing(beamAnim, {
        toValue: 1,
        duration: 4500,
        easing: Easing.linear,
        useNativeDriver: false,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [active, beamAnim, perimeter]);

  if (!active) {
    return style ? <View style={style}>{children}</View> : <>{children}</>;
  }

  const beamLength = Math.max(36, Math.round(perimeter * 0.18));
  const gapLength = Math.max(1, perimeter - beamLength);
  const dashOffset =
    perimeter > 0
      ? beamAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [0, -perimeter],
        })
      : 0;

  return (
    <View
      testID={testID || 'closest-task-glow'}
      onLayout={(e) => {
        const w = Math.round(e.nativeEvent.layout.width);
        const h = Math.round(e.nativeEvent.layout.height);
        if (w > 0 && h > 0 && (!boxSize || Math.abs(boxSize.w - w) > 1 || Math.abs(boxSize.h - h) > 1)) {
          setBoxSize({ w, h });
        }
      }}
      style={[styles.glowOuter, { borderRadius }, style]}
    >
      {children}
      {boxSize && (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Svg width={boxSize.w} height={boxSize.h}>
            <Defs>
              <LinearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
                <Stop offset="0%" stopColor="#5b48b6" stopOpacity={0.15} />
                <Stop offset="50%" stopColor="#a04977" stopOpacity={0.55} />
                <Stop offset="100%" stopColor="#d46337" stopOpacity={0.15} />
              </LinearGradient>
            </Defs>
            {/* Subtle permanent base hairline border */}
            <Rect
              x={0.75}
              y={0.75}
              width={Math.max(1, boxSize.w - 1.5)}
              height={Math.max(1, boxSize.h - 1.5)}
              rx={borderRadius}
              ry={borderRadius}
              stroke="rgba(160, 73, 119, 0.14)"
              strokeWidth={1}
              fill="none"
            />
            {/* Traveling gradient beam around the perimeter */}
            <AnimatedSvgRect
              x={0.75}
              y={0.75}
              width={Math.max(1, boxSize.w - 1.5)}
              height={Math.max(1, boxSize.h - 1.5)}
              rx={borderRadius}
              ry={borderRadius}
              stroke={`url(#${gradId})`}
              strokeWidth={1.25}
              strokeLinecap="round"
              strokeDasharray={`${beamLength} ${gapLength}`}
              strokeDashoffset={dashOffset}
              fill="none"
            />
          </Svg>
        </View>
      )}
    </View>
  );
}

export interface SpinningIconProps {
  spinning: boolean;
  children: React.ReactNode;
}

/**
 * Continuous smooth 360-degree rotation animation for active Refresh/Sync icons.
 */
export function SpinningIcon({ spinning, children }: SpinningIconProps) {
  const [spinAnim] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!spinning || isJestEnv) {
      spinAnim.setValue(0);
      return;
    }
    spinAnim.setValue(0);
    const loop = Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [spinning, spinAnim]);

  const rotate = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      {children}
    </Animated.View>
  );
}

export interface AnimatedProgressBarProps {
  percent: number;
  color: string;
  trackColor: string;
  height?: number;
  isRtl?: boolean;
  gradientColors?: [string, string];
}

/**
 * Smoothly animated horizontal progress bar track & fill (animating from 0 on mount).
 */
export function AnimatedProgressBar({
  percent,
  color,
  trackColor,
  height = 8,
  isRtl = false,
  gradientColors,
}: AnimatedProgressBarProps) {
  const reactId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const gradId = `progressGrad_${reactId}`;
  const clamped = Math.max(0, Math.min(100, Number(percent) || 0));
  const [widthAnim] = useState(() => new Animated.Value(isJestEnv ? clamped : 0));

  useEffect(() => {
    if (isJestEnv) {
      widthAnim.setValue(clamped);
      return;
    }
    Animated.timing(widthAnim, {
      toValue: clamped,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [clamped, widthAnim]);

  const widthInterpolated = widthAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
  });

  return (
    <View
      style={[
        styles.progressTrack,
        {
          height,
          borderRadius: height / 2,
          backgroundColor: trackColor,
        },
      ]}
    >
      <Animated.View
        style={[
          styles.progressFill,
          {
            width: widthInterpolated,
            backgroundColor: gradientColors ? 'transparent' : color,
            borderRadius: height / 2,
            alignSelf: isRtl ? 'flex-end' : 'flex-start',
            overflow: 'hidden',
          },
        ]}
      >
        {gradientColors && (
          <Svg
            pointerEvents="none"
            style={StyleSheet.absoluteFill}
            width="100%"
            height="100%"
            preserveAspectRatio="none"
          >
            <Defs>
              <LinearGradient
                id={gradId}
                x1={isRtl ? '100%' : '0%'}
                y1="0%"
                x2={isRtl ? '0%' : '100%'}
                y2="0%"
              >
                <Stop offset="0%" stopColor={gradientColors[0]} />
                <Stop offset="100%" stopColor={gradientColors[1]} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradId})`} />
          </Svg>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  fullWidth: {
    width: '100%',
  },
  gradBtnOuter: {
    position: 'relative',
    padding: 0,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.22)',
    shadowColor: '#5b48b6',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.28,
    shadowRadius: 6,
    elevation: 3,
  },
  gradBtnXsRadius: {
    borderRadius: 8,
  },
  gradBtnXsPad: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  gradBtnSmPad: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  gradBtnMdPad: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  gradBtnContent: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  gradBtnText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  glowOuter: {
    position: 'relative',
    padding: 0,
  },
  progressTrack: {
    width: '100%',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
  },
});
