import { useWindowDimensions } from 'react-native';

export interface ResponsiveLayoutInfo {
  width: number;
  height: number;
  shortestEdge: number;
  isTabletDevice: boolean;
  isLandscapeTablet: boolean;
  isPortraitTablet: boolean;
  isCompactPhone: boolean;
  isShortLandscape: boolean;
}

export function useResponsiveLayout(): ResponsiveLayoutInfo {
  const { width, height } = useWindowDimensions();
  const shortestEdge = Math.min(width, height);
  const isTabletDevice = shortestEdge >= 600;
  const isLandscapeTablet = isTabletDevice && width > height && width >= 768;
  const isPortraitTablet = isTabletDevice && height >= width;
  const isCompactPhone = !isTabletDevice && width < 380;
  const isShortLandscape = !isTabletDevice && width > height && height < 500;

  return {
    width,
    height,
    shortestEdge,
    isTabletDevice,
    isLandscapeTablet,
    isPortraitTablet,
    isCompactPhone,
    isShortLandscape,
  };
}
