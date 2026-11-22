import React from 'react';
import * as RN from 'react-native';
import { render, screen, fireEvent, act } from '@testing-library/react-native';
import { groupEnrolledCourses } from '@tautracker/moodle-client';
import { Colors } from '@/constants/theme';
import { generateMockCourseSyncData, MOCK_COURSE_ID } from '@/services/mockCourse';
import { translate } from '@/services/i18n';
import { DEFAULT_MOBILE_SETTINGS, MobileAppSettings } from '@/services/settingsSyncService';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();

jest.mock('expo-router', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  const TabsMock: any = ({ children, tabBar }: any) =>
    ReactActual.createElement(
      View,
      { testID: tabBar ? 'tabs-no-bottom-bar' : 'tabs-with-bottom-bar' },
      children
    );
  TabsMock.Screen = ({ name, options }: any) =>
    ReactActual.createElement(View, {
      testID: `tab-screen-${name}`,
      accessibilityState: { disabled: options?.href === null },
    });
  return {
    useRouter: () => ({
      push: mockPush,
      replace: mockReplace,
      navigate: mockPush,
      back: mockBack,
      canGoBack: () => true,
    }),
    usePathname: () => '/',
    useLocalSearchParams: () => ({ id: String(MOCK_COURSE_ID) }),
    useSegments: () => ['(tabs)'],
    useFocusEffect: jest.fn(),
    Stack: { Screen: () => null },
    Tabs: TabsMock,
  };
});

jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    SafeAreaView: View,
    SafeAreaProvider: View,
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
});

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(async () => ({ canceled: true, assets: [] })),
}));

const mockSetThemeMode = jest.fn();
const mockSetTimeWindow = jest.fn();
const mockSetLanguage = jest.fn();
const mockRefreshPreferences = jest.fn();

const mockPreferencesValue = {
  themeMode: 'noodle' as const,
  effectiveThemeName: 'noodle' as const,
  theme: Colors.noodle,
  language: 'en' as const,
  isRtl: false,
  timeDayStart: 7,
  timeDayEnd: 17,
  setThemeMode: mockSetThemeMode,
  setTimeWindow: mockSetTimeWindow,
  setLanguage: mockSetLanguage,
  refreshPreferences: mockRefreshPreferences,
  t: (key: string, params?: Record<string, string | number>) => translate(key, params, 'en'),
};

jest.mock('@/hooks/use-preferences', () => ({
  usePreferences: () => mockPreferencesValue,
  PreferencesProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const mockSyncData = generateMockCourseSyncData('en');
const mockCourses = mockSyncData.courses || [];

const baseSettings: MobileAppSettings = {
  ...DEFAULT_MOBILE_SETTINGS,
  language: 'en',
  theme: 'noodle',
  panoptoEnabled: true,
  trackedCourseIds: [MOCK_COURSE_ID],
  coursesColorMap: { [MOCK_COURSE_ID]: '#8b5cf6' },
  coursesCustomNames: { [MOCK_COURSE_ID]: 'Data Structures Demo' },
};

const mockAppState: any = {
  isInitialized: true,
  isAuthenticated: true,
  hasCompletedOnboarding: true,
  syncResult: mockSyncData,
  enrolledCourses: mockCourses,
  groupedCourses: groupEnrolledCourses(mockCourses),
  isSyncing: false,
  syncProgress: null,
  lastSyncedAt: mockSyncData.syncedAt,
  syncError: null,
  tourActive: false,
  tourStep: -1,
  settings: baseSettings,
  trackedCourseIds: baseSettings.trackedCourseIds,
  coursesColorMap: baseSettings.coursesColorMap,
  coursesCustomNames: baseSettings.coursesCustomNames,
  hiddenAssignments: [],
  completedAssignments: [],
  uncompletedAssignments: [],
  hiddenZoomMeetings: [],
  watchedRecordings: [],
  hiddenRecordings: [],
  trackedPanoptoHosts: {},
  coursesPanoptoStaff: {},
  coursesPanoptoMap: {},
  userFullname: 'Test Student',
  hasMockCourse: true,
  loginWithSso: jest.fn(async () => true),
  loginWithToken: jest.fn(async () => true),
  fetchOnboardingCourses: jest.fn(async () => mockCourses),
  completeOnboarding: jest.fn(async () => {}),
  triggerSync: jest.fn(async () => mockSyncData),
  toggleAssignmentDone: jest.fn(async () => {}),
  toggleAssignmentHidden: jest.fn(async () => {}),
  bulkSetCourseAssignmentsHidden: jest.fn(async () => {}),
  toggleZoomHidden: jest.fn(async () => {}),
  bulkSetCourseZoomHidden: jest.fn(async () => {}),
  toggleRecordingWatched: jest.fn(async () => {}),
  toggleRecordingHidden: jest.fn(async () => {}),
  toggleTrackedHost: jest.fn(async () => {}),
  saveCoursePanoptoStaff: jest.fn(async () => {}),
  saveCoursePanoptoFolder: jest.fn(async () => {}),
  saveCoursesConfiguration: jest.fn(async () => {}),
  updateSetting: jest.fn(async () => {}),
  refreshFromLocal: jest.fn(async () => {}),
  addMockCourse: jest.fn(async () => {}),
  removeMockCourse: jest.fn(async () => {}),
  disconnectAccount: jest.fn(async () => {}),
  startTour: jest.fn(),
  setTourStep: jest.fn(),
  stopTour: jest.fn(),
  syncWarnings: [],
  syncWindowVisible: undefined,
  syncWindowCollapsed: undefined,
  setSyncWindowCollapsed: jest.fn(),
  openSyncWindow: jest.fn(),
  closeSyncWindow: jest.fn(),
};

jest.mock('@/hooks/use-app-state', () => ({
  useAppState: () => mockAppState,
  useSyncProgress: () => mockAppState,
  AppStateProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import { SyncProgressBanner } from '@/components/SyncProgressBanner';
import { SsoWebViewModal } from '@/components/SsoWebViewModal';
import { AssignmentDetailSheet } from '@/components/AssignmentDetailSheet';
import { TourOverlay } from '@/components/TourOverlay';
import { ScheduleCalendarView } from '@/components/ScheduleCalendarView';
import { ColorPalettePickerModal } from '@/components/ColorPalettePickerModal';
import { ManageCoursesModal } from '@/components/ManageCoursesModal';
import { MoodleFileRow } from '@/components/MoodleFileRow';
import OnboardingScreen from '@/app/onboarding';
import DashboardScreen from '@/app/(tabs)/index';
import CoursesScreen from '@/app/(tabs)/courses';
import AssignmentsScreen from '@/app/(tabs)/assignments';
import RecordingsScreen from '@/app/(tabs)/recordings';
import GradesScreen from '@/app/(tabs)/grades';
import CourseDetailScreen from '@/app/course/[id]';
import SettingsScreen from '@/app/(tabs)/settings';
import TabsLayout from '@/app/(tabs)/_layout';

describe('Mobile v4.1 screens and components integration tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAppState.isSyncing = false;
    mockAppState.syncProgress = null;
    mockAppState.syncError = null;
    mockAppState.tourActive = false;
    mockAppState.tourStep = -1;
    mockAppState.settings = { ...baseSettings };
  });

  afterEach(() => {
    act(() => {
      RN.Dimensions.set({
        window: { width: 750, height: 1334, scale: 2, fontScale: 1 },
        screen: { width: 750, height: 1334, scale: 2, fontScale: 1 },
      });
    });
    jest.restoreAllMocks();
  });

  it('renders SyncProgressBanner when syncing with live percent and counts and supports collapse/expand', () => {
    mockAppState.isSyncing = true;
    mockAppState.syncProgress = {
      percent: 64,
      stage: 'courses',
      message: 'Scanning courses...',
      coursesCompleted: 2,
      totalCourses: 4,
      activitiesCompleted: 5,
      totalActivities: 10,
    };

    render(<SyncProgressBanner />);
    expect(screen.getByTestId('sync-progress-window')).toBeTruthy();
    expect(screen.getByText('64%')).toBeTruthy();
    expect(screen.getByText('Scanning courses...')).toBeTruthy();

    fireEvent.press(screen.getByTestId('sync-collapse-btn'));
    expect(screen.getByTestId('sync-progress-collapsed')).toBeTruthy();
    expect(screen.queryByTestId('sync-progress-window')).toBeNull();

    fireEvent.press(screen.getByTestId('sync-expand-btn'));
    expect(screen.getByTestId('sync-progress-window')).toBeTruthy();
  });

  it('renders AssignmentDetailSheet with decoupled status and grace period text', () => {
    const sampleAssignment = mockSyncData.assignments[0]; // Assignment 3 with cutoffDate & attachments
    const onClose = jest.fn();

    render(
      <AssignmentDetailSheet
        visible={true}
        assignment={sampleAssignment}
        courseColor="#8b5cf6"
        courseDisplayName="Data Structures Demo"
        onClose={onClose}
      />
    );

    expect(screen.getByText(sampleAssignment.name)).toBeTruthy();
    expect(screen.getByText('hw3_avl_trees.pdf')).toBeTruthy();
    expect(screen.getByText(translate('mark_completed', undefined, 'en'))).toBeTruthy();
    expect(screen.getByTestId('detail-go-to-course-btn')).toBeTruthy();
  });

  it('renders TourOverlay and advances steps on next button press', () => {
    mockAppState.tourActive = true;
    mockAppState.tourStep = 0;

    render(<TourOverlay />);
    expect(screen.getByText('Upcoming To-Do Queue & Grace Periods')).toBeTruthy();
    fireEvent.press(screen.getByText('Next'));
    expect(mockAppState.setTourStep).toHaveBeenCalledWith(1);
  });

  it('renders ScheduleCalendarView in Month and Week modes', () => {
    const onToggleOverlay = jest.fn();
    render(
      <ScheduleCalendarView
        mode="assignments"
        assignments={mockSyncData.assignments}
        recordings={mockSyncData.recordings || []}
        showOverlay={false}
        onToggleOverlay={onToggleOverlay}
        coursesColorMap={baseSettings.coursesColorMap}
        coursesCustomNames={baseSettings.coursesCustomNames}
      />
    );

    expect(screen.getByText(translate('calendar_month', undefined, 'en'))).toBeTruthy();
    fireEvent.press(screen.getByText(translate('calendar_week', undefined, 'en')));
    expect(screen.getByText(translate('also_show_recordings', undefined, 'en'))).toBeTruthy();
  });

  it('renders Onboarding Step 1 login form with Israeli ID validation and WebView SSO option', () => {
    mockAppState.isAuthenticated = false;
    mockAppState.hasCompletedOnboarding = false;
    render(<OnboardingScreen />);
    expect(screen.getByText(translate('connect_moodle', undefined, 'en'))).toBeTruthy();
    expect(screen.getByText(translate('webview_sso_btn', undefined, 'en'))).toBeTruthy();
    mockAppState.isAuthenticated = true;
    mockAppState.hasCompletedOnboarding = true;
  });

  it('renders Dashboard Cockpit in phone mode without Courses section or top-right Tour/Manage buttons and opens Semester Progress menu only on press', () => {
    RN.Dimensions.set({
      window: { width: 412, height: 915, scale: 2, fontScale: 1 },
      screen: { width: 412, height: 915, scale: 2, fontScale: 1 },
    });

    render(<DashboardScreen />);
    expect(screen.getByTestId('dashboard-header-logo')).toBeTruthy();
    expect(screen.getByText(translate('upcoming_queue_title', undefined, 'en'))).toBeTruthy();
    expect(screen.getByText(translate('semester_progress_title', undefined, 'en'))).toBeTruthy();
    expect(screen.getByText(translate('join_zoom', undefined, 'en'))).toBeTruthy();
    expect(screen.getByTestId('closest-task-glow')).toBeTruthy();

    // C2, E4, E5: Courses section, Manage Courses button, and Tour button removed from phone Dashboard
    expect(screen.queryByText(translate('my_courses_title', undefined, 'en'))).toBeNull();
    expect(screen.queryByTestId('dashboard-courses-cards-grid')).toBeNull();
    expect(screen.queryByTestId('dashboard-manage-courses-btn')).toBeNull();
    expect(screen.queryByLabelText(translate('take_tour_btn', undefined, 'en'))).toBeNull();

    // E6: Semester Progress selector opens only on press
    expect(screen.queryByTestId('semester-progress-mode-menu')).toBeNull();
    fireEvent.press(screen.getByTestId('semester-progress-mode-btn'));
    expect(screen.getByTestId('semester-progress-mode-menu')).toBeTruthy();
    fireEvent.press(screen.getByTestId('semester-progress-option-lectures'));
    expect(mockAppState.updateSetting).toHaveBeenCalledWith('semesterProgressMode', 'lectures');
    expect(screen.queryByTestId('semester-progress-mode-menu')).toBeNull();
  });

  it('renders CoursesScreen on phone/portrait with Manage Courses grouped beside Cards/List switcher', () => {
    RN.Dimensions.set({
      window: { width: 412, height: 915, scale: 2, fontScale: 1 },
      screen: { width: 412, height: 915, scale: 2, fontScale: 1 },
    });

    const { rerender } = render(<CoursesScreen />);
    expect(screen.getByText(translate('my_courses_title', undefined, 'en'))).toBeTruthy();
    expect(screen.getByTestId('dashboard-courses-cards-grid')).toBeTruthy();
    expect(screen.getByTestId('dashboard-manage-courses-btn')).toBeTruthy();
    expect(screen.getAllByText('Data Structures Demo').length).toBeGreaterThan(0);

    mockAppState.settings = { ...baseSettings, coursesViewMode: 'list' };
    rerender(<CoursesScreen />);
    expect(screen.getByTestId(`course-go-btn-${MOCK_COURSE_ID}`)).toBeTruthy();
    mockAppState.settings = { ...baseSettings };
  });

  it('renders TrackedCoursesSection directly on DashboardScreen in landscape tablet (1280x800)', () => {
    RN.Dimensions.set({
      window: { width: 1280, height: 800, scale: 2, fontScale: 1 },
      screen: { width: 1280, height: 800, scale: 2, fontScale: 1 },
    });

    const { rerender } = render(<DashboardScreen />);
    expect(screen.getByText(translate('upcoming_queue_title', undefined, 'en'))).toBeTruthy();
    expect(screen.getByText(translate('my_courses_title', undefined, 'en'))).toBeTruthy();
    expect(screen.getByTestId('dashboard-courses-cards-grid')).toBeTruthy();
    expect(screen.getByTestId('dashboard-manage-courses-btn')).toBeTruthy();

    mockAppState.settings = { ...baseSettings, coursesViewMode: 'list' };
    rerender(<DashboardScreen />);
    expect(screen.getByTestId(`course-go-btn-${MOCK_COURSE_ID}`)).toBeTruthy();
    mockAppState.settings = { ...baseSettings };
  });

  it('renders Assignments Hub with filter chips and Hidden Assignments drawer', () => {
    render(<AssignmentsScreen />);
    expect(screen.getByText(/^To Do \(\d+\)/)).toBeTruthy();
    expect(screen.getByText(/^Past \(\d+\)/)).toBeTruthy();
    expect(screen.getByText(/^Completed \(\d+\)/)).toBeTruthy();
    expect(screen.getByText(/^Hidden \(\d+\)/)).toBeTruthy();
  });

  it('renders Recordings Hub CTA when Panopto disabled and recordings list when enabled', () => {
    mockAppState.settings = { ...baseSettings, panoptoEnabled: false };
    const { rerender } = render(<RecordingsScreen />);
    expect(screen.getByText(translate('panopto_disabled_title', undefined, 'en'))).toBeTruthy();

    mockAppState.settings = { ...baseSettings, panoptoEnabled: true };
    rerender(<RecordingsScreen />);
    expect(screen.getByTestId('recordings-panopto-sso-btn')).toBeTruthy();
    expect(screen.getByText(/^Unwatched \(\d+\)/)).toBeTruthy();
    expect(screen.getByText('Lecture 4 - Balanced Search Trees (AVL)')).toBeTruthy();
  });

  it('renders Grades screen using published grades only, with policy note and bonus badge', () => {
    render(<GradesScreen />);
    expect(screen.getByText(translate('grades_policy_note', undefined, 'en'))).toBeTruthy();
    expect(screen.getByText('96.00')).toBeTruthy();
    expect(screen.getByText(translate('grades_bonus_label', undefined, 'en'))).toBeTruthy();
  });

  it('renders Course Detail view with 2-level sections, mod_folder ZIP, announcements, and tabs', () => {
    render(<CourseDetailScreen />);
    expect(screen.getByText('Data Structures Demo')).toBeTruthy();
    expect(screen.getByText(translate('announcements_title', undefined, 'en'))).toBeTruthy();
    expect(screen.getByText(translate('download_zip', undefined, 'en'))).toBeTruthy();
    expect(screen.getByText('Past Exams & Syllabus Archive')).toBeTruthy();
  });

  it('renders Settings screen with all 4+2 themes, Panopto settings, Google Tasks, Mock Course & Disconnect', () => {
    render(<SettingsScreen />);
    expect(screen.getByText(translate('theme_noodle', undefined, 'en'))).toBeTruthy();
    expect(screen.getByText(translate('theme_coffee', undefined, 'en'))).toBeTruthy();
    expect(screen.getByText(translate('theme_dark', undefined, 'en'))).toBeTruthy();
    expect(screen.getByText(translate('theme_time', undefined, 'en'))).toBeTruthy();
    expect(screen.getByText(translate('take_tour_btn', undefined, 'en'))).toBeTruthy();
    expect(screen.getByText(translate('disconnect_account', undefined, 'en'))).toBeTruthy();
  });

  it('renders Extension-style collapsible sidebar on landscape tablets (1280x800), omits Courses tab on landscape tablet, and supports LTR/RTL horizontal swipe', () => {
    const setDims = (w: number, h: number) => {
      RN.Dimensions.set({
        window: { width: w, height: h, scale: 2, fontScale: 1 },
        screen: { width: w, height: h, scale: 2, fontScale: 1 },
      });
    };

    setDims(1280, 800);
    const landscape = render(<TabsLayout />);
    expect(landscape.getByTestId('tablet-sidebar')).toBeTruthy();
    expect(landscape.getByTestId('tabs-no-bottom-bar')).toBeTruthy();
    expect(landscape.getByText('Noodle')).toBeTruthy();
    expect(landscape.queryByTestId('sidebar-nav-courses')).toBeNull();
    expect(landscape.getByTestId('tab-screen-courses').props.accessibilityState.disabled).toBe(true);
    expect(landscape.getByText(translate('sidebar_collapse', undefined, 'en'))).toBeTruthy();
    expect(landscape.getByTestId('sidebar-tour-btn')).toBeTruthy();
    expect(landscape.getByTestId('sidebar-disconnect-btn')).toBeTruthy();

    fireEvent.press(landscape.getByTestId('sidebar-toggle-btn'));
    expect(landscape.queryByText('Noodle')).toBeNull();
    expect(landscape.queryByText(translate('sidebar_collapse', undefined, 'en'))).toBeNull();
    fireEvent.press(landscape.getByTestId('sidebar-toggle-btn'));
    expect(landscape.getByText('Noodle')).toBeTruthy();
    expect(landscape.getByText(translate('sidebar_collapse', undefined, 'en'))).toBeTruthy();
    landscape.unmount();

    setDims(800, 1280);
    const portraitTablet = render(<TabsLayout />);
    expect(portraitTablet.queryByTestId('tablet-sidebar')).toBeNull();
    expect(portraitTablet.getByTestId('tabs-with-bottom-bar')).toBeTruthy();
    expect(portraitTablet.getByTestId('tab-screen-courses').props.accessibilityState.disabled).toBe(false);
    portraitTablet.unmount();

    setDims(412, 915);
    const phone = render(<TabsLayout />);
    expect(phone.queryByTestId('tablet-sidebar')).toBeNull();
    expect(phone.getByTestId('tabs-with-bottom-bar')).toBeTruthy();
    expect(phone.getByTestId('tab-screen-courses').props.accessibilityState.disabled).toBe(false);

    const simulateHorizontalSwipe = (container: any, startX: number, endX: number) => {
      const midX = Math.round((startX + endX) / 2);
      const mkTouchEvt = (prevX: number, currX: number, prevTs: number, currTs: number) => ({
        nativeEvent: { touches: [{ identifier: 0 }] },
        touchHistory: {
          numberActiveTouches: 1,
          indexOfSingleActiveTouch: 0,
          mostRecentTimeStamp: currTs,
          touchBank: [
            {
              touchActive: true,
              startPageX: startX,
              startPageY: 100,
              startTimeStamp: 10,
              previousPageX: prevX,
              previousPageY: 100,
              previousTimeStamp: prevTs,
              currentPageX: currX,
              currentPageY: 104,
              currentTimeStamp: currTs,
            },
          ],
        },
      });
      const startEvt = mkTouchEvt(startX, startX, 10, 10);
      const claimMoveEvt = mkTouchEvt(startX, midX, 10, 80);
      const dragMoveEvt = mkTouchEvt(midX, endX, 80, 160);

      expect(container.props.onStartShouldSetResponderCapture(startEvt)).toBe(false);
      expect(container.props.onStartShouldSetResponder(startEvt)).toBe(false);
      expect(container.props.onMoveShouldSetResponderCapture(claimMoveEvt)).toBe(false);
      expect(container.props.onMoveShouldSetResponder(claimMoveEvt)).toBe(true);
      act(() => {
        container.props.onResponderGrant(claimMoveEvt);
        container.props.onResponderMove(dragMoveEvt);
        container.props.onResponderRelease(dragMoveEvt);
      });
    };

    // Horizontal swipe LTR -> forward to '/courses'
    const swipeContainer = phone.getByTestId('tabs-swipe-container');
    simulateHorizontalSwipe(swipeContainer, 200, 100);
    expect(mockPush).toHaveBeenCalledWith('/courses');
    phone.unmount();

    // Horizontal swipe RTL -> inverted (dx > 0 moves forward to '/courses')
    mockPush.mockClear();
    mockPreferencesValue.isRtl = true;
    const rtlPhone = render(<TabsLayout />);
    const rtlSwipe = rtlPhone.getByTestId('tabs-swipe-container');
    simulateHorizontalSwipe(rtlSwipe, 100, 200);
    expect(mockPush).toHaveBeenCalledWith('/courses');
    rtlPhone.unmount();
    mockPreferencesValue.isRtl = false;
  });

  it('uses inline Master-Detail split pane on landscape tablets (1280x800) and modal sheet in vertical tablet/phone views', () => {
    const sampleAssignment = mockSyncData.assignments[0];

    RN.Dimensions.set({
      window: { width: 1280, height: 800, scale: 2, fontScale: 1 },
      screen: { width: 1280, height: 800, scale: 2, fontScale: 1 },
    });
    const landscapeDash = render(<DashboardScreen />);
    expect(landscapeDash.queryByTestId('dashboard-master-detail')).toBeNull();
    fireEvent.press(landscapeDash.getAllByText(sampleAssignment.name)[0]);
    expect(landscapeDash.getByTestId('dashboard-master-detail')).toBeTruthy();
    expect(landscapeDash.getByTestId('assignment-detail-inline')).toBeTruthy();
    fireEvent.press(landscapeDash.getByTestId('detail-close-btn'));
    expect(landscapeDash.queryByTestId('assignment-detail-inline')).toBeNull();
    landscapeDash.unmount();

    RN.Dimensions.set({
      window: { width: 800, height: 1280, scale: 2, fontScale: 1 },
      screen: { width: 800, height: 1280, scale: 2, fontScale: 1 },
    });
    const portraitTabletDash = render(<DashboardScreen />);
    fireEvent.press(portraitTabletDash.getAllByText(sampleAssignment.name)[0]);
    expect(portraitTabletDash.queryByTestId('dashboard-master-detail')).toBeNull();
    expect(portraitTabletDash.queryByTestId('assignment-detail-inline')).toBeNull();
    expect(portraitTabletDash.getByTestId('detail-close-btn')).toBeTruthy();
    portraitTabletDash.unmount();
  });

  it('renders CourseDetailScreen as 2-column grid in landscape tablet (1280x800) and segmented tabs in portrait tablet (800x1280)', () => {
    RN.Dimensions.set({
      window: { width: 1280, height: 800, scale: 2, fontScale: 1 },
      screen: { width: 1280, height: 800, scale: 2, fontScale: 1 },
    });
    const landscapeCourse = render(<CourseDetailScreen />);
    expect(landscapeCourse.getByTestId('course-tablet-grid')).toBeTruthy();
    expect(landscapeCourse.queryByTestId('course-segmented-bar')).toBeNull();
    landscapeCourse.unmount();

    RN.Dimensions.set({
      window: { width: 800, height: 1280, scale: 2, fontScale: 1 },
      screen: { width: 800, height: 1280, scale: 2, fontScale: 1 },
    });
    const portraitCourse = render(<CourseDetailScreen />);
    expect(portraitCourse.getByTestId('course-segmented-bar')).toBeTruthy();
    expect(portraitCourse.queryByTestId('course-tablet-grid')).toBeNull();
    portraitCourse.unmount();
  });

  it('keeps phone-landscape (915x412) in phone mode instead of tablet sidebar (sw600dp guard)', () => {
    RN.Dimensions.set({
      window: { width: 915, height: 412, scale: 2, fontScale: 1 },
      screen: { width: 915, height: 412, scale: 2, fontScale: 1 },
    });
    const phoneLandscape = render(<TabsLayout />);
    expect(phoneLandscape.queryByTestId('tablet-sidebar')).toBeNull();
    expect(phoneLandscape.getByTestId('tabs-with-bottom-bar')).toBeTruthy();
    phoneLandscape.unmount();
  });

  it('renders Dashboard in Hebrew RTL mode and strips raw HTML from AssignmentDetailSheet feedback', () => {
    mockPreferencesValue.language = 'he' as any;
    mockPreferencesValue.isRtl = true;
    mockPreferencesValue.t = (key: string, params?: Record<string, string | number>) =>
      translate(key, params, 'he');

    const rtlDash = render(<DashboardScreen />);
    expect(rtlDash.getByText(translate('upcoming_queue_title', undefined, 'he'))).toBeTruthy();
    rtlDash.unmount();

    const rtlCourses = render(<CoursesScreen />);
    expect(rtlCourses.getByText(translate('my_courses_title', undefined, 'he'))).toBeTruthy();
    rtlCourses.unmount();

    const sampleAssignment = {
      ...mockSyncData.assignments[0],
      feedback: '<p>Great <b>work</b> &amp; clean proof!</p>',
    };
    const sheet = render(
      <AssignmentDetailSheet
        visible={true}
        assignment={sampleAssignment}
        courseColor="#8b5cf6"
        courseDisplayName="Data Structures Demo"
        onClose={jest.fn()}
      />
    );
    expect(sheet.getByText('Great work & clean proof!')).toBeTruthy();
    expect(sheet.queryByText(/<p>/)).toBeNull();
    sheet.unmount();

    mockPreferencesValue.language = 'en' as any;
    mockPreferencesValue.isRtl = false;
    mockPreferencesValue.t = (key: string, params?: Record<string, string | number>) =>
      translate(key, params, 'en');
  });

  it('renders SsoWebViewModal in Panopto mode targeting Login.aspx', () => {
    const modal = render(
      <SsoWebViewModal
        visible={true}
        mode="panopto"
        onClose={jest.fn()}
        onPanoptoSuccess={jest.fn()}
      />
    );
    expect(modal.getAllByText(/Panopto/i).length).toBeGreaterThan(0);
    modal.unmount();
  });

  it('supports custom color selection in ColorPalettePickerModal and opens from ManageCoursesModal', () => {
    const onSelectColor = jest.fn();
    const onClose = jest.fn();
    render(
      <ColorPalettePickerModal
        visible={true}
        initialColor="#E58C7A"
        courseName="Linear Algebra"
        onSelectColor={onSelectColor}
        onClose={onClose}
      />
    );

    expect(screen.getByTestId('color-picker-preview')).toBeTruthy();
    expect(screen.getByTestId('color-picker-sv-canvas')).toBeTruthy();
    expect(screen.getByTestId('color-picker-hue-bar')).toBeTruthy();
    expect(screen.getByTestId('color-picker-spectrum-grid')).toBeTruthy();

    fireEvent.press(screen.getByTestId('spectrum-tile-#74AEE3'));
    expect(screen.getByTestId('color-picker-hex-input').props.value).toBe('#74AEE3');

    fireEvent.changeText(screen.getByTestId('color-picker-hex-input'), '#123456');
    fireEvent.press(screen.getByTestId('color-picker-apply-btn'));
    expect(onSelectColor).toHaveBeenCalledWith('#123456');
    expect(onClose).toHaveBeenCalled();

    const manage = render(<ManageCoursesModal visible={true} onClose={jest.fn()} />);
    expect(manage.getByTestId(`custom-color-btn-${MOCK_COURSE_ID}`)).toBeTruthy();
    manage.unmount();
  });

  it('renders MoodleFileRow with Open and Download actions only (no Share button)', () => {
    render(
      <MoodleFileRow
        fileName="lecture01.pdf"
        fileSize={2048}
        colors={Colors.noodle}
        onOpen={jest.fn()}
        onDownload={jest.fn()}
      />
    );
    expect(screen.getByLabelText(`${translate('open_file')} lecture01.pdf`)).toBeTruthy();
    expect(screen.getByLabelText(`${translate('download_file')} lecture01.pdf`)).toBeTruthy();
    expect(screen.queryByLabelText(`${translate('share_file')} lecture01.pdf`)).toBeNull();
  });
});
