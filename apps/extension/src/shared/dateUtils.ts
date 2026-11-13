export function getDueTextAndClass(
  deadlineString: string | null,
  lang: 'he' | 'en',
  greenThreshold: number = 7,
  yellowThreshold: number = 3,
  shortFormat: boolean = false,
  status?: string
): { deadlineText: string; badgeClass: string; timeColorClass: string } {
  let badgeClass = 'badge-muted';
  let timeColorClass = 'due-muted';
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
      deadlineText = lang === 'he'
        ? (diffDays === 1 ? 'יום 1' : `${diffDays} ימים`)
        : `${diffDays} ${diffDays === 1 ? 'day' : 'days'}`;
    } else {
      deadlineText = lang === 'he'
        ? `${diffDays === 1 ? 'יום 1' : `${diffDays} ימים`}`
        : `${diffDays} ${diffDays === 1 ? 'day' : 'days'}`;
    }
  } else if (diffHours >= 1) {
    if (shortFormat) {
      deadlineText = lang === 'he'
        ? (diffHours === 1 ? 'שעה' : `${diffHours} שעות`)
        : `${diffHours} ${diffHours === 1 ? 'hr' : 'hrs'}`;
    } else {
      deadlineText = lang === 'he'
        ? `${diffHours === 1 ? 'שעה' : `${diffHours} שעות`}`
        : `${diffHours} ${diffHours === 1 ? 'hour' : 'hours'}`;
    }
  } else {
    const mins = diffMins > 0 ? diffMins : 1;
    if (shortFormat) {
      deadlineText = lang === 'he'
        ? (mins === 1 ? 'דקה' : `${mins} דקות`)
        : `${mins} min`;
    } else {
      deadlineText = lang === 'he'
        ? `${mins === 1 ? 'דקה' : `${mins} דקות`}`
        : `${mins} ${mins === 1 ? 'minute' : 'minutes'}`;
    }
  }

  return { deadlineText, badgeClass, timeColorClass };
}

/**
 * Formats the tooltip text for an assignment's late submission cut-off / grace period.
 */
export function formatGracePeriodTooltip(cutoffDateString: string, lang: 'he' | 'en'): string {
  const date = new Date(cutoffDateString);
  const formattedDate = date.toLocaleString(lang === 'he' ? 'he-IL' : 'en-US', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  if (lang === 'he') {
    return `מטלות באיחור יתקבלו עד ${formattedDate}`;
  }
  return `Late assignment accepted til ${formattedDate}`;
}
