import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAppState } from '@/hooks/use-app-state';
import { usePreferences } from '@/hooks/use-preferences';
import {
  AssignmentsIcon,
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  CourseIcon,
  GradesIcon,
  SettingsIcon,
  VideoIcon,
} from '@/components/icons/NoodleIcons';
import { NoodleGradientButton } from '@/components/ui/NoodleAnimations';

interface TourStepItem {
  id: string;
  tagHe: string;
  tagEn: string;
  titleHe: string;
  titleEn: string;
  descHe: string;
  descEn: string;
  chipsHe: string[];
  chipsEn: string[];
  renderIcon: (color: string) => React.ReactNode;
}

const TOUR_STEPS: TourStepItem[] = [
  {
    id: 'upcoming',
    tagHe: 'שלב 1 מתוך 6',
    tagEn: 'Step 1 of 6',
    titleHe: 'תור משימות קרובות וזמני חסד',
    titleEn: 'Upcoming To-Do Queue & Grace Periods',
    descHe:
      'לוח הבקרה מציג את המטלות והבחנים הפתוחים שלך לפי דחיפות, כולל שעון חסד להגשות באיחור. לחץ על משימה כדי לצפות בקבצים מצורפים, קבצי נושא, וסטטוס הגשה אמיתי במודל בנפרד מסימון ידני.',
    descEn:
      'Your Dashboard prioritizes pending assignments and quizzes by urgency, including late-submission grace clocks. Tap any task to view attachments, subject files, and authentic Moodle status separately from manual checkoffs.',
    chipsHe: ['סדר עדיפויות חכם', 'חלונות חסד', 'קבצי נושא'],
    chipsEn: ['Smart Priority Queue', 'Grace Period Clocks', 'Subject Files'],
    renderIcon: (color) => <AssignmentsIcon size={22} color={color} />,
  },
  {
    id: 'zoom-panopto',
    tagHe: 'שלב 2 מתוך 6',
    tagEn: 'Step 2 of 6',
    titleHe: 'מפגשי זום חיים והקלטות להשלמה',
    titleEn: 'Live Zoom & Catch-Up Recordings',
    descHe:
      'קישורי Zoom פעילים מופיעים אוטומטית בחלון השידור החי (מ-15 דקות לפני השיעור ועד שעתיים אחריו). כאשר Panopto מופעל, תוכל לעקוב אחר הרצאות ותרגולים לפי המרצים והמתרגלים שבחרת.',
    descEn:
      'Active Zoom sessions surface automatically in the Live Strip from 15 minutes before start through 2 hours in. With Panopto enabled, track unwatched lectures and recitations filtered by your chosen hosts.',
    chipsHe: ['מפגשי Zoom חיים', 'השלמות Panopto', 'סינון לפי מנחה'],
    chipsEn: ['Live Zoom Strip', 'Panopto Catch-Up', 'Host Filtering'],
    renderIcon: (color) => <VideoIcon size={22} color={color} />,
  },
  {
    id: 'courses',
    tagHe: 'שלב 3 מתוך 6',
    tagEn: 'Step 3 of 6',
    titleHe: 'קורסים במעקב וקיבוץ חכם',
    titleEn: 'Tracked Courses & Course Grouping',
    descHe:
      'קורסים מרובי-קבוצות (הרצאה + תרגול) מתאחדים אוטומטית לכרטיס קורס אחד נקי, וקורסי בטיחות ומנהלה מרוכזים תחת מעטפת אחת. הקש על קורס כדי לגלוש לתכנים, תיקיות ZIP וקישורים.',
    descEn:
      'Multi-group courses (lecture + recitation portals) merge cleanly into unified course cards, while safety tutorials group under an Administrative Umbrella. Tap any course to browse sections, folders, and links.',
    chipsHe: ['איחוד קבוצות', 'הורדת תיקיות ZIP', 'צבעים וכינויים'],
    chipsEn: ['Unified Grouping', 'Folder ZIP Downloads', 'Colors & Nicknames'],
    renderIcon: (color) => <CourseIcon size={22} color={color} />,
  },
  {
    id: 'assignments-calendar',
    tagHe: 'שלב 4 מתוך 6',
    tagEn: 'Step 4 of 6',
    titleHe: 'מרכז מטלות ולוח שנה אקדמי',
    titleEn: 'Assignments Hub & Calendar',
    descHe:
      'בלשונית המטלות תוכל לסנן לפי לביצוע, עברו, הושלמו ומוסתרים, לחפש לפי שם או קורס, ולעבור לתצוגת לוח שנה שבועי או חודשי כדי לראות עומסים קדימה.',
    descEn:
      'In the Assignments tab, filter across To Do, Past, Completed, and Hidden views, search instantly, and toggle into Week or Month calendar views to plan ahead.',
    chipsHe: ['4 מסנני סטטוס', 'לוח שנה שבועי וחודשי', 'מגירת מוסתרים'],
    chipsEn: ['4 Status Filters', 'Week & Month Calendar', 'Hidden Drawer'],
    renderIcon: (color) => <CalendarIcon size={22} color={color} />,
  },
  {
    id: 'grades',
    tagHe: 'שלב 5 מתוך 6',
    tagEn: 'Step 5 of 6',
    titleHe: 'ציונים וחישוב ממוצע שקוף',
    titleEn: 'Grades & Pedagogical Policy',
    descHe:
      'לשונית הציונים מסנכרנת ציונים רשמיים, תגיות בונוס ומשובי בודקים ישירות ממודל. הממוצע המשוקלל מתבסס אך ורק על רכיבים שנבדקו ופורסם עבורם ציון, ללא הכללת קורסי מנהלה.',
    descEn:
      'The Grades tab syncs official Moodle scores, bonus tags, and grader feedback. Your estimated GPA includes only graded components and excludes administrative compliance tutorials.',
    chipsHe: ['פירוט רכיבים', 'משובי בודקים', 'ללא קורסי מנהלה'],
    chipsEn: ['Component Breakdown', 'Grader Feedback', 'Clean GPA'],
    renderIcon: (color) => <GradesIcon size={22} color={color} />,
  },
  {
    id: 'sync-themes',
    tagHe: 'שלב 6 מתוך 6',
    tagEn: 'Step 6 of 6',
    titleHe: 'סנכרון בין מכשירים, ערכות נושא ו-Google Tasks',
    titleEn: 'Cross-Device Sync, Themes & Google Tasks',
    descHe:
      'ההגדרות, הצבעים, הכינויים והמטלות המסומנות מסתנכרנים בין הדפדפן לנייד דרך חשבון המודל שלך. בחר בין ערכות נושא (כולל נודל ביום וקפה בלילה), ייצא גיבוי JSON, וחבר את Google Tasks.',
    descEn:
      'Your settings, colors, nicknames, and task states stay in sync across browser and mobile via Moodle storage. Switch themes (including time-based Noodle/Coffee), export JSON backups, and sync Google Tasks.',
    chipsHe: ['סנכרון בין מכשירים', '6 מצבי ערכות נושא', 'Google Tasks'],
    chipsEn: ['Cross-Device Sync', '6 Theme Modes', 'Google Tasks'],
    renderIcon: (color) => <SettingsIcon size={22} color={color} />,
  },
];

export function TourOverlay() {
  const { tourActive, tourStep, setTourStep, stopTour } = useAppState();
  const { theme, language, isRtl } = usePreferences();

  if (!tourActive) {
    return null;
  }

  const safeIndex = Math.max(0, Math.min(TOUR_STEPS.length - 1, tourStep));
  const current = TOUR_STEPS[safeIndex];
  const isFirst = safeIndex === 0;
  const isLast = safeIndex === TOUR_STEPS.length - 1;
  const rowDir = isRtl ? 'row-reverse' : 'row';
  const textAlign = isRtl ? 'right' : 'left';

  const handlePrev = () => {
    if (!isFirst) {
      setTourStep(safeIndex - 1);
    }
  };

  const handleNext = () => {
    if (isLast) {
      stopTour();
    } else {
      setTourStep(safeIndex + 1);
    }
  };

  const chips = language === 'he' ? current.chipsHe : current.chipsEn;
  const title = language === 'he' ? current.titleHe : current.titleEn;
  const tag = language === 'he' ? current.tagHe : current.tagEn;
  const desc = language === 'he' ? current.descHe : current.descEn;

  return (
    <Modal
      visible={tourActive}
      transparent
      animationType="fade"
      onRequestClose={stopTour}
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={stopTour} />

        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.backgroundElement,
              borderColor: theme.primary,
            },
          ]}
        >
          {/* Segmented Stepper */}
          <View style={[styles.stepperRow, { flexDirection: rowDir }]}>
            {TOUR_STEPS.map((item, idx) => {
              const active = idx === safeIndex;
              const completed = idx < safeIndex;
              return (
                <TouchableOpacity
                  key={item.id}
                  onPress={() => setTourStep(idx)}
                  style={[
                    styles.stepBar,
                    {
                      backgroundColor: active
                        ? theme.primary
                        : completed
                          ? theme.secondary
                          : theme.backgroundSelected,
                    },
                  ]}
                  accessibilityLabel={`${idx + 1}`}
                />
              );
            })}
          </View>

          {/* Header */}
          <View style={[styles.headerRow, { flexDirection: rowDir }]}>
            <View style={[styles.headerMeta, { flexDirection: rowDir }]}>
              <View
                style={[
                  styles.iconBadge,
                  { backgroundColor: `${theme.primary}1A`, borderColor: `${theme.primary}40` },
                ]}
              >
                {current.renderIcon(theme.primary)}
              </View>
              <View style={styles.tagWrap}>
                <Text style={[styles.tagText, { color: theme.primary, textAlign }]}>
                  {tag}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              onPress={stopTour}
              style={[styles.closeBtn, { backgroundColor: theme.backgroundSelected }]}
              accessibilityLabel={language === 'he' ? 'דלג' : 'Skip'}
            >
              <CloseIcon size={16} color={theme.text} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.bodyScroll}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={[styles.title, { color: theme.text, textAlign }]}>{title}</Text>
            <Text style={[styles.desc, { color: theme.textSecondary, textAlign }]}>{desc}</Text>

            <View style={[styles.chipsRow, { flexDirection: rowDir }]}>
              {chips.map((chip) => (
                <View
                  key={chip}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: `${theme.primary}14`,
                      borderColor: `${theme.primary}38`,
                    },
                  ]}
                >
                  <Text style={[styles.chipText, { color: theme.text }]}>{chip}</Text>
                </View>
              ))}
            </View>
          </ScrollView>

          {/* Footer Navigation */}
          <View
            style={[
              styles.footer,
              {
                borderTopColor: theme.border,
                flexDirection: rowDir,
              },
            ]}
          >
            <TouchableOpacity onPress={stopTour} style={styles.skipBtn}>
              <Text style={[styles.skipText, { color: theme.textSecondary }]}>
                {language === 'he' ? 'דלג' : 'Skip'}
              </Text>
            </TouchableOpacity>

            <View style={[styles.navBtns, { flexDirection: rowDir }]}>
              {!isFirst && (
                <TouchableOpacity
                  onPress={handlePrev}
                  style={[
                    styles.prevBtn,
                    {
                      backgroundColor: theme.backgroundSelected,
                      flexDirection: rowDir,
                    },
                  ]}
                >
                  {isRtl ? (
                    <ChevronRightIcon size={15} color={theme.text} />
                  ) : (
                    <ChevronLeftIcon size={15} color={theme.text} />
                  )}
                  <Text style={[styles.prevBtnText, { color: theme.text }]}>
                    {language === 'he' ? 'הקודם' : 'Previous'}
                  </Text>
                </TouchableOpacity>
              )}

              <NoodleGradientButton
                label={
                  isLast
                    ? language === 'he'
                      ? 'סיום'
                      : 'Finish'
                    : language === 'he'
                      ? 'הבא'
                      : 'Next'
                }
                onPress={handleNext}
                isRtl={isRtl}
                size="sm"
                icon={
                  !isLast ? (
                    isRtl ? (
                      <ChevronLeftIcon size={15} color="#ffffff" />
                    ) : (
                      <ChevronRightIcon size={15} color="#ffffff" />
                    )
                  ) : undefined
                }
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '85%',
    borderRadius: 20,
    borderWidth: 1.5,
    padding: 20,
    gap: 14,
  },
  stepperRow: {
    gap: 6,
  },
  stepBar: {
    flex: 1,
    height: 5,
    borderRadius: 3,
  },
  headerRow: {
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  headerMeta: {
    flex: 1,
    alignItems: 'center',
    gap: 10,
  },
  iconBadge: {
    width: 42,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagWrap: {
    flex: 1,
  },
  tagText: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
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
    gap: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 26,
  },
  desc: {
    fontSize: 14,
    lineHeight: 21,
  },
  chipsRow: {
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  footer: {
    paddingTop: 12,
    borderTopWidth: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  skipBtn: {
    paddingVertical: 8,
    paddingHorizontal: 6,
  },
  skipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  navBtns: {
    alignItems: 'center',
    gap: 8,
  },
  prevBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    gap: 4,
  },
  prevBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  nextBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    gap: 4,
  },
  nextBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
});
