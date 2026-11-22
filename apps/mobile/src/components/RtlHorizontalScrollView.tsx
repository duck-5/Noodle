import React, { useCallback, useEffect, useRef } from 'react';
import { ScrollView, ScrollViewProps } from 'react-native';

export interface RtlHorizontalScrollViewProps extends ScrollViewProps {
  isRtl: boolean;
  children?: React.ReactNode;
}

/**
 * Horizontal ScrollView wrapper that handles RTL chip/tab rows cleanly on Android & iOS:
 * reverses flex direction and scrolls to the right start edge automatically on initial layout
 * and content size changes when `isRtl` is true.
 */
export function RtlHorizontalScrollView({
  isRtl,
  contentContainerStyle,
  onContentSizeChange,
  showsHorizontalScrollIndicator = false,
  children,
  ...rest
}: RtlHorizontalScrollViewProps) {
  const scrollRef = useRef<ScrollView | null>(null);
  const lastContentWidthRef = useRef<number>(0);

  useEffect(() => {
    if (isRtl) {
      scrollRef.current?.scrollToEnd({ animated: false });
    } else {
      scrollRef.current?.scrollTo({ x: 0, animated: false });
    }
  }, [isRtl]);

  const handleContentSizeChange = useCallback(
    (w: number, h: number) => {
      if (isRtl && w !== lastContentWidthRef.current) {
        lastContentWidthRef.current = w;
        scrollRef.current?.scrollToEnd({ animated: false });
      }
      onContentSizeChange?.(w, h);
    },
    [isRtl, onContentSizeChange]
  );

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={showsHorizontalScrollIndicator}
      onContentSizeChange={handleContentSizeChange}
      contentContainerStyle={[
        {
          flexGrow: 1,
          flexDirection: isRtl ? 'row-reverse' : 'row',
        },
        contentContainerStyle,
      ]}
      {...rest}
    >
      {children}
    </ScrollView>
  );
}
