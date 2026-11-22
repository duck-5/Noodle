import React from 'react';
import Svg, { Path, Circle, Rect, Line, Polyline, Polygon } from 'react-native-svg';

export interface IconProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
}

const DEFAULT_SIZE = 20;
const DEFAULT_COLOR = '#3d405b';
const DEFAULT_STROKE = 1.8;

export function DashboardIcon({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = DEFAULT_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Rect x="3" y="3" width="7" height="9" rx="1.5" />
      <Rect x="14" y="3" width="7" height="5" rx="1.5" />
      <Rect x="14" y="12" width="7" height="9" rx="1.5" />
      <Rect x="3" y="16" width="7" height="5" rx="1.5" />
    </Svg>
  );
}

export function AssignmentsIcon({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = DEFAULT_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Rect x="5" y="4" width="14" height="17" rx="2" />
      <Path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" />
      <Line x1="9" y1="10" x2="15" y2="10" />
      <Line x1="9" y1="14" x2="15" y2="14" />
      <Line x1="9" y1="18" x2="12" y2="18" />
    </Svg>
  );
}

export function RecordingsIcon({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = DEFAULT_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx="12" cy="12" r="9" />
      <Polygon points="10 8.5 16 12 10 15.5 10 8.5" />
    </Svg>
  );
}

export function GradesIcon({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = DEFAULT_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M2 10l10-5 10 5-10 5-10-5Z" />
      <Path d="M6 12v5c0 1.66 2.69 3 6 3s6-1.34 6-3v-5" />
      <Line x1="22" y1="10" x2="22" y2="16" />
    </Svg>
  );
}

export function SettingsIcon({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = DEFAULT_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx="12" cy="12" r="3" />
      <Path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.78 1 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </Svg>
  );
}

export function CourseIcon({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = DEFAULT_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z" />
      <Path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z" />
    </Svg>
  );
}

export function CalendarIcon({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = DEFAULT_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Rect x="3" y="4" width="18" height="17" rx="2" />
      <Line x1="16" y1="2" x2="16" y2="6" />
      <Line x1="8" y1="2" x2="8" y2="6" />
      <Line x1="3" y1="10" x2="21" y2="10" />
    </Svg>
  );
}

export function ClockIcon({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = DEFAULT_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx="12" cy="12" r="9" />
      <Polyline points="12 7 12 12 15.5 14" />
    </Svg>
  );
}

export function SearchIcon({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = DEFAULT_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx="11" cy="11" r="7" />
      <Line x1="20" y1="20" x2="16" y2="16" />
    </Svg>
  );
}

export function FilterIcon({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = DEFAULT_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Polygon points="22 4 2 4 10 13.5 10 19 14 21 14 13.5 22 4" />
    </Svg>
  );
}

export function CheckIcon({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = DEFAULT_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Polyline points="20 6 9 17 4 12" />
    </Svg>
  );
}

export function TrashIcon({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = DEFAULT_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Polyline points="3 6 5 6 21 6" />
      <Path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <Path d="M10 11v6" />
      <Path d="M14 11v6" />
      <Path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </Svg>
  );
}

export function EyeIcon({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = DEFAULT_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <Circle cx="12" cy="12" r="3" />
    </Svg>
  );
}

export function EyeOffIcon({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = DEFAULT_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <Path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c6.5 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <Path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3.5 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <Line x1="2" y1="2" x2="22" y2="22" />
    </Svg>
  );
}

export function FolderIcon({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = DEFAULT_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z" />
    </Svg>
  );
}

export function FileIcon({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = DEFAULT_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <Polyline points="14 2 14 8 20 8" />
      <Line x1="8" y1="13" x2="16" y2="13" />
      <Line x1="8" y1="17" x2="13" y2="17" />
    </Svg>
  );
}

export function ZipIcon({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = DEFAULT_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Rect x="4" y="3" width="16" height="18" rx="2" />
      <Line x1="12" y1="7" x2="12" y2="9" />
      <Line x1="12" y1="11" x2="12" y2="13" />
      <Rect x="10" y="15" width="4" height="3" rx="0.5" />
    </Svg>
  );
}

export function DownloadIcon({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = DEFAULT_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <Polyline points="7 10 12 15 17 10" />
      <Line x1="12" y1="15" x2="12" y2="3" />
    </Svg>
  );
}

export function ShareIcon({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = DEFAULT_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx="18" cy="5" r="3" />
      <Circle cx="6" cy="12" r="3" />
      <Circle cx="18" cy="19" r="3" />
      <Line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <Line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </Svg>
  );
}

export function ExternalLinkIcon({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = DEFAULT_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <Polyline points="15 3 21 3 21 9" />
      <Line x1="10" y1="14" x2="21" y2="3" />
    </Svg>
  );
}

export function VideoIcon({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = DEFAULT_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Rect x="2" y="6" width="14" height="12" rx="2" />
      <Polygon points="22 8 16 12 22 16 22 8" />
    </Svg>
  );
}

export function QuizIcon({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = DEFAULT_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx="12" cy="12" r="9" />
      <Path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <Line x1="12" y1="17" x2="12.01" y2="17" />
    </Svg>
  );
}

export function AnnouncementIcon({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = DEFAULT_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <Path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </Svg>
  );
}

export function SparklesIcon({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = DEFAULT_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z" />
      <Path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z" />
    </Svg>
  );
}

export function RefreshIcon({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = DEFAULT_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Polyline points="23 4 23 10 17 10" />
      <Polyline points="1 20 1 14 7 14" />
      <Path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
      <Path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" />
    </Svg>
  );
}

export function ChevronRightIcon({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = DEFAULT_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Polyline points="9 18 15 12 9 6" />
    </Svg>
  );
}

export function ChevronLeftIcon({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = DEFAULT_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Polyline points="15 18 9 12 15 6" />
    </Svg>
  );
}

export function ChevronDownIcon({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = DEFAULT_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Polyline points="6 9 12 15 18 9" />
    </Svg>
  );
}

export function ChevronUpIcon({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = DEFAULT_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Polyline points="18 15 12 9 6 15" />
    </Svg>
  );
}

export function PlusIcon({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = DEFAULT_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Line x1="12" y1="5" x2="12" y2="19" />
      <Line x1="5" y1="12" x2="19" y2="12" />
    </Svg>
  );
}

export function CloseIcon({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = DEFAULT_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Line x1="18" y1="6" x2="6" y2="18" />
      <Line x1="6" y1="6" x2="18" y2="18" />
    </Svg>
  );
}

export function ShieldIcon({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = DEFAULT_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 2l7 4v6c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-4Z" />
    </Svg>
  );
}

export function InfoIcon({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = DEFAULT_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx="12" cy="12" r="9" />
      <Line x1="12" y1="16" x2="12" y2="12" />
      <Line x1="12" y1="8" x2="12.01" y2="8" />
    </Svg>
  );
}

export function SunIcon({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = DEFAULT_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx="12" cy="12" r="4" />
      <Line x1="12" y1="2" x2="12" y2="4" />
      <Line x1="12" y1="20" x2="12" y2="22" />
      <Line x1="4.93" y1="4.93" x2="6.34" y2="6.34" />
      <Line x1="17.66" y1="17.66" x2="19.07" y2="19.07" />
      <Line x1="2" y1="12" x2="4" y2="12" />
      <Line x1="20" y1="12" x2="22" y2="12" />
      <Line x1="4.93" y1="19.07" x2="6.34" y2="17.66" />
      <Line x1="17.66" y1="6.34" x2="19.07" y2="4.93" />
    </Svg>
  );
}

export function MoonIcon({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = DEFAULT_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
    </Svg>
  );
}

export function CoffeeIcon({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = DEFAULT_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M17 8h1a4 4 0 1 1 0 8h-1" />
      <Path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V8Z" />
      <Line x1="6" y1="2" x2="6" y2="5" />
      <Line x1="10" y1="2" x2="10" y2="5" />
      <Line x1="14" y1="2" x2="14" y2="5" />
    </Svg>
  );
}

export function PaletteIcon({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = DEFAULT_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 2a10 10 0 0 0 0 20c1.38 0 2.5-1.12 2.5-2.5 0-.64-.24-1.22-.64-1.66-.39-.44-.61-1.02-.61-1.64 0-1.38 1.12-2.5 2.5-2.5H18a4 4 0 0 0 4-4c0-4.42-4.48-8-10-8Z" />
      <Circle cx="7.5" cy="10.5" r="1" />
      <Circle cx="10.5" cy="7.5" r="1" />
      <Circle cx="15.5" cy="8.5" r="1" />
    </Svg>
  );
}

export function LogoutIcon({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = DEFAULT_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <Polyline points="16 17 21 12 16 7" />
      <Line x1="21" y1="12" x2="9" y2="12" />
    </Svg>
  );
}

export function UserIcon({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = DEFAULT_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <Circle cx="12" cy="7" r="4" />
    </Svg>
  );
}

export function LinkIcon({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = DEFAULT_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <Path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </Svg>
  );
}

export function StarIcon({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = DEFAULT_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </Svg>
  );
}

export function FlaskIcon({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = DEFAULT_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Line x1="9" y1="3" x2="15" y2="3" />
      <Path d="M10 3v5.5L4.7 17.6A2 2 0 0 0 6.4 20.5h11.2a2 2 0 0 0 1.7-2.9L14 8.5V3" />
      <Line x1="7.5" y1="15" x2="16.5" y2="15" />
    </Svg>
  );
}

export function TourIcon({ size = DEFAULT_SIZE, color = DEFAULT_COLOR, strokeWidth = DEFAULT_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx="12" cy="12" r="9" />
      <Polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
    </Svg>
  );
}
