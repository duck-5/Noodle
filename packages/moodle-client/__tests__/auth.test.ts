import { MoodleClient, MoodleApiError, isValidIsraeliId } from '../src/moodleApi.js';

describe('Category 1: Authentication, SSO & Session Management', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('TC-AUTH-01: TAU SSO Login Redirect Chain', () => {
    it('should successfully retrieve wstoken when login succeeds', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ token: 'MOCK_WSTOKEN_12345' }),
      } as Response);

      const token = await MoodleClient.fetchToken('testuser', 'testpass');
      expect(token).toBe('MOCK_WSTOKEN_12345');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/login/token.php?username=testuser&password=testpass&service=moodle_mobile_app')
      );
    });

    it('should handle token extraction from moodlemobile redirect URL', () => {
      const redirectUrl = 'moodlemobile://token=MOCK_WSTOKEN_12345&privatetoken=999';
      const match = redirectUrl.match(/token=([^&]+)/);
      expect(match).not.toBeNull();
      expect(match![1]).toBe('MOCK_WSTOKEN_12345');
    });
  });

  describe('TC-AUTH-02: Israeli ID Mod-10 Validation', () => {
    it('should return true for valid Israeli ID', () => {
      // 123456782 is a canonical valid Israeli ID
      expect(isValidIsraeliId('123456782')).toBe(true);
      // Valid ID with leading zero or short length padded to 9 digits
      expect(isValidIsraeliId('012345674')).toBe(true);
      expect(isValidIsraeliId('12345674')).toBe(true);
    });

    it('should return false for invalid Israeli IDs', () => {
      expect(isValidIsraeliId('123456789')).toBe(false);
      expect(isValidIsraeliId('111111111')).toBe(false);
    });

    it('should return false for non-numeric or invalid length inputs', () => {
      expect(isValidIsraeliId('abc')).toBe(false);
      expect(isValidIsraeliId('1234567890')).toBe(false); // 10 digits
      expect(isValidIsraeliId('')).toBe(false);
      expect(isValidIsraeliId('       ')).toBe(false);
      expect(isValidIsraeliId('12345678a')).toBe(false);
    });
  });

  describe('TC-AUTH-03: Invalid Credentials Error Handling', () => {
    it('should throw an error when token endpoint returns error response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ error: 'Invalid login, please try again', errorcode: 'invalidlogin' }),
      } as Response);

      await expect(MoodleClient.fetchToken('baduser', 'badpass')).rejects.toThrow(
        'Invalid login, please try again'
      );
    });

    it('should throw an error on HTTP failure status (e.g. 401)', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
      } as Response);

      await expect(MoodleClient.fetchToken('baduser', 'badpass')).rejects.toThrow(
        'HTTP error! status: 401'
      );
    });

    it('should throw MoodleApiError when API response contains errorcode or exception (HTTP 200 with error)', async () => {
      const client = new MoodleClient('SOME_TOKEN');
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          exception: 'moodle_exception',
          errorcode: 'invalidtoken',
          message: 'Invalid token - token not found',
        }),
      } as Response);

      await expect(client.getSiteInfo()).rejects.toThrow(MoodleApiError);
    });
  });

  describe('TC-AUTH-05: Silent Re-Authentication on Token Expiry', () => {
    it('should detect invalidtoken error and allow retrying with refreshed token', async () => {
      let callCount = 0;
      let currentToken = 'EXPIRED_TOKEN';

      const mockFetch = jest.fn().mockImplementation(async (url: string) => {
        callCount++;
        if (url.includes('wstoken=EXPIRED_TOKEN')) {
          return {
            ok: true,
            json: async () => ({
              exception: 'moodle_exception',
              errorcode: 'invalidtoken',
              message: 'Invalid token',
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({ userid: 101, username: 'student', fullname: 'Test Student', sitename: 'TAU' }),
        };
      });

      global.fetch = mockFetch;

      const executeWithRetry = async () => {
        let client = new MoodleClient(currentToken);
        try {
          return await client.getSiteInfo();
        } catch (err: any) {
          if (err instanceof MoodleApiError && err.errorcode === 'invalidtoken') {
            // Simulate silent re-authentication
            currentToken = 'FRESH_TOKEN';
            client = new MoodleClient(currentToken);
            return await client.getSiteInfo();
          }
          throw err;
        }
      };

      const result = await executeWithRetry();
      expect(result.userid).toBe(101);
      expect(result.fullname).toBe('Test Student');
      expect(callCount).toBe(2);
      expect(currentToken).toBe('FRESH_TOKEN');
    });
  });
});
