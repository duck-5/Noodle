export function getDueTextAndClass(
  deadlineString: string | null,
  lang: 'he' | 'en',
  greenThreshold: number = 7,
  yellowThreshold: number = 3,
  shortFormat: boolean = false
): { deadlineText: string; badgeClass: string; timeColorClass: string } {
  let badgeClass = 'badge-muted';
  let timeColorClass = 'due-red';
  let deadlineText = lang === 'he' ? (shortFormat ? 'אין מועד' : 'אין מועד הגשה') : 'No deadline';

  if (!deadlineString) {
    return { deadlineText, badgeClass, timeColorClass };
  }

  const deadline = new Date(deadlineString);
  const diffMs = deadline.getTime() - Date.now();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const hoursLeft = diffMs / (1000 * 60 * 60);
  const daysLeft = diffMs / (1000 * 60 * 60 * 24);

  if (diffMs < 0) {
    badgeClass = 'badge-danger';
    timeColorClass = 'due-red';
    deadlineText = lang === 'he' ? 'עבר המועד!' : 'Overdue!';
    return { deadlineText, badgeClass, timeColorClass };
  }

  if (hoursLeft <= 24) {
    badgeClass = 'badge-danger';
  } else if (hoursLeft <= 72) {
    badgeClass = 'badge-warning';
  } else {
    badgeClass = 'badge-success';
  }

  if (daysLeft > greenThreshold) {
    timeColorClass = 'due-green';
  } else if (daysLeft > yellowThreshold) {
    timeColorClass = 'due-yellow';
  }

  if (diffDays >= 1) {
    if (shortFormat) {
      deadlineText = lang === 'he' ? `${diffDays}ימים` : `${diffDays}d`;
    } else {
      deadlineText = lang === 'he'
        ? `${diffDays === 1 ? 'יום' : `${diffDays} ימים`}`
        : `${diffDays} ${diffDays === 1 ? 'day' : 'days'}`;
    }
  } else if (diffHours >= 1) {
    if (shortFormat) {
      deadlineText = lang === 'he' ? `${diffHours}ש'` : `${diffHours}h`;
    } else {
      deadlineText = lang === 'he'
        ? `${diffHours === 1 ? 'שעה' : `${diffHours} שעות`}`
        : `${diffHours} ${diffHours === 1 ? 'hour' : 'hours'}`;
    }
  } else {
    const mins = diffMins > 0 ? diffMins : 1;
    if (shortFormat) {
      deadlineText = lang === 'he' ? `${mins}דק'` : `${mins}m`;
    } else {
      deadlineText = lang === 'he'
        ? `${mins === 1 ? 'דקה' : `${mins} דקות`}`
        : `${mins} ${mins === 1 ? 'minute' : 'minutes'}`;
    }
  }

  return { deadlineText, badgeClass, timeColorClass };
}
