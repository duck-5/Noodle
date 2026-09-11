describe('Category 5: Zoom Meetings & Live Sessions', () => {
  describe('TC-ZM-01: Zoom Module & Schedule Scraping', () => {
    it('should extract meetingNumber, password, and direct link from Zoom join URLs', () => {
      const joinUrl = 'https://tau-ac-il.zoom.us/j/123456789?pwd=mockPassword123';
      const matchNum = joinUrl.match(/\/j\/(\d+)/);
      const urlObj = new URL(joinUrl);
      const password = urlObj.searchParams.get('pwd');

      expect(matchNum).not.toBeNull();
      expect(matchNum![1]).toBe('123456789');
      expect(password).toBe('mockPassword123');
    });

    it('should normalize meeting join URL with direct tau-ac-il domain', () => {
      const meetingNumber = '987654321';
      const password = 'secretPassword';
      const directUrl = `https://tau-ac-il.zoom.us/j/${meetingNumber}?pwd=${password}`;

      expect(directUrl).toBe('https://tau-ac-il.zoom.us/j/987654321?pwd=secretPassword');
    });
  });

  describe('TC-ZM-02: Active Meeting Detection (● פעיל כעת)', () => {
    it('should mark meeting as active when current time is within meeting window', () => {
      const isMeetingActive = (startTimeMs: number, durationMinutes: number, currentTimeMs: number): boolean => {
        const endTimeMs = startTimeMs + durationMinutes * 60 * 1000;
        return currentTimeMs >= startTimeMs && currentTimeMs <= endTimeMs;
      };

      const meetingStart = new Date('2026-10-12T10:00:00Z').getTime();
      const duration = 120; // 2 hours

      // At 10:30 (active)
      const testTimeActive = new Date('2026-10-12T10:30:00Z').getTime();
      expect(isMeetingActive(meetingStart, duration, testTimeActive)).toBe(true);

      // At 14:00 (inactive)
      const testTimeInactive = new Date('2026-10-12T14:00:00Z').getTime();
      expect(isMeetingActive(meetingStart, duration, testTimeInactive)).toBe(false);

      // Before start at 09:30 (inactive)
      const testTimeBefore = new Date('2026-10-12T09:30:00Z').getTime();
      expect(isMeetingActive(meetingStart, duration, testTimeBefore)).toBe(false);
    });
  });

  describe('TC-ZM-03: Zoom Meeting Interest / Favorite Toggle', () => {
    it('should toggle meeting numbers in interested meetings array', () => {
      let interestedMeetings: string[] = [];

      const toggleInterest = (meetingNumber: string) => {
        if (interestedMeetings.includes(meetingNumber)) {
          interestedMeetings = interestedMeetings.filter((num) => num !== meetingNumber);
        } else {
          interestedMeetings.push(meetingNumber);
        }
      };

      toggleInterest('123456789');
      expect(interestedMeetings).toContain('123456789');

      toggleInterest('123456789');
      expect(interestedMeetings).not.toContain('123456789');
    });
  });
});
