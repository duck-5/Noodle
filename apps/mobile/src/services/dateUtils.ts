export function getDueTextAndClass(
  deadlineString: string | null,
  lang: 'he' | 'en',
  greenThreshold: number = 7,
  yellowThreshold: number = 3,
  shortFormat: boolean = false,
  status?: string
): {
  deadlineText: string;
  badgeClass: 'badge-success' | 'badge-warning' | 'badge-danger' | 'badge-muted';
  timeColorClass: 'due-green' | 'due-yellow' | 'due-red';
} {
  let badgeClass: 'badge-success' | 'badge-warning' | 'badge-danger' | 'badge-muted' = 'badge-muted';
  let timeColorClass: 'due-green' | 'due-yellow' | 'due-red' = 'due-red';
  let deadlineText = lang === 'he' ? (shortFormat ? 'אין מועד' : 'אין מועד הגשה') : 'No deadline';

  if (status === 'Submitted') {
    badgeClass = 'badge-success';
    timeColorClass = 'due-green';
    deadlineText = lang === 'he' ? 'הוגש' : 'Submitted';
    return { deadlineText, badgeClass, timeColorClass };
  }

  if (!deadlineString) {
    return { deadlineText, badgeClass, timeColorClass };
  }

  const deadline = new Date(deadlineString);
  if (isNaN(deadline.getTime())) {
    return { deadlineText, badgeClass, timeColorClass };
  }

  const diffMs = deadline.getTime() - Date.now();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const daysLeft = diffMs / (1000 * 60 * 60 * 24);

  if (diffMs < 0) {
    badgeClass = 'badge-danger';
    timeColorClass = 'due-red';
    deadlineText = lang === 'he' ? 'עבר המועד!' : 'Overdue!';
    return { deadlineText, badgeClass, timeColorClass };
  }

  const effectiveGreen = typeof greenThreshold === 'number' && !isNaN(greenThreshold) ? greenThreshold : 7;
  const effectiveYellow = typeof yellowThreshold === 'number' && !isNaN(yellowThreshold) ? yellowThreshold : 3;

  if (daysLeft > effectiveGreen) {
    badgeClass = 'badge-success';
    timeColorClass = 'due-green';
  } else if (daysLeft > effectiveYellow) {
    badgeClass = 'badge-warning';
    timeColorClass = 'due-yellow';
  } else {
    badgeClass = 'badge-danger';
    timeColorClass = 'due-red';
  }

  if (diffDays >= 1) {
    if (shortFormat) {
      deadlineText = lang === 'he' ? `${diffDays}ימים` : `${diffDays}d`;
    } else {
      deadlineText =
        lang === 'he'
          ? `${diffDays === 1 ? 'יום' : `${diffDays} ימים`}`
          : `${diffDays} ${diffDays === 1 ? 'day' : 'days'}`;
    }
  } else if (diffHours >= 1) {
    if (shortFormat) {
      deadlineText = lang === 'he' ? `${diffHours}ש'` : `${diffHours}h`;
    } else {
      deadlineText =
        lang === 'he'
          ? `${diffHours === 1 ? 'שעה' : `${diffHours} שעות`}`
          : `${diffHours} ${diffHours === 1 ? 'hour' : 'hours'}`;
    }
  } else {
    const mins = diffMins > 0 ? diffMins : 1;
    if (shortFormat) {
      deadlineText = lang === 'he' ? `${mins}דק'` : `${mins}m`;
    } else {
      deadlineText =
        lang === 'he'
          ? `${mins === 1 ? 'דקה' : `${mins} דקות`}`
          : `${mins} ${mins === 1 ? 'minute' : 'minutes'}`;
    }
  }

  return { deadlineText, badgeClass, timeColorClass };
}

export function formatGracePeriodText(cutoffDate: string, lang: 'he' | 'en'): string {
  if (!cutoffDate) return '';
  const date = new Date(cutoffDate);
  if (isNaN(date.getTime())) return '';

  let formattedDate = '';
  try {
    formattedDate = date.toLocaleString(lang === 'he' ? 'he-IL' : 'en-US', {
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    formattedDate = `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()} ${formatTimeHM(cutoffDate, lang)}`;
  }

  if (lang === 'he') {
    return `מטלות באיחור יתקבלו עד ${formattedDate}`;
  }
  return `Late submission accepted until ${formattedDate}`;
}

export function formatShortDate(iso: string | null | undefined, lang: 'he' | 'en'): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (isNaN(date.getTime())) return '';

  try {
    return date.toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-US', {
      day: 'numeric',
      month: 'short',
    });
  } catch {
    return `${date.getDate()}/${date.getMonth() + 1}`;
  }
}

export function formatTimeHM(iso: string | null | undefined, _lang: 'he' | 'en'): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (isNaN(date.getTime())) return '';

  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function getZoomLiveStatus(startTime?: string | null): 'active' | 'upcoming' | 'past' | 'permanent' {
  if (!startTime || !startTime.trim()) {
    return 'permanent';
  }
  const startDate = new Date(startTime);
  const startMs = startDate.getTime();
  if (isNaN(startMs)) {
    return 'permanent';
  }

  const elapsedMs = Date.now() - startMs;
  const minBeforeMs = -15 * 60 * 1000;
  const maxAfterMs = 120 * 60 * 1000;

  if (elapsedMs >= minBeforeMs && elapsedMs <= maxAfterMs) {
    return 'active';
  }
  if (elapsedMs < minBeforeMs) {
    return 'upcoming';
  }
  return 'past';
}
