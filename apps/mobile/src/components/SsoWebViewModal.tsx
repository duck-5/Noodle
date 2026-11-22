import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePreferences } from '@/hooks/use-preferences';
import {
  getStoredCredentials,
  tryExtractTokenFromUrl,
  type MoodleCredentials,
} from '@/services/auth';
import {
  flushCookiesNative,
  hasPanoptoAuthCookieNative,
  isNoodleNativeAvailable,
} from '@/services/nativeBridge';
import { CheckIcon, CloseIcon, InfoIcon, RefreshIcon, ShieldIcon } from '@/components/icons/NoodleIcons';

export interface SsoWebViewModalProps {
  visible: boolean;
  mode: 'moodle' | 'panopto';
  onClose: () => void;
  onTokenCaptured?: (token: string) => void;
  onPanoptoSuccess?: () => void;
}

const MOODLE_SSO_LAUNCH_URL =
  'https://moodle.tau.ac.il/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=noodle';
const PANOPTO_SSO_URL = 'https://tau.cloud.panopto.eu/Panopto/Pages/Auth/Login.aspx';

function isExpectedPanoptoSsoHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (!host) return false;
  if (host === 'nidp.tau.ac.il' || host === 'panopto.eu' || host === 'panopto.tau.ac.il') {
    return true;
  }
  if (host.endsWith('.panopto.eu') || host.endsWith('.panopto.tau.ac.il')) {
    return true;
  }
  return /^moodle[^.]*\.tau\.ac\.il$/.test(host);
}

function buildPanoptoAutoLoginJs(
  creds: MoodleCredentials | null,
  options: { allowNidpSubmit: boolean; allowExtLoginClick: boolean }
): string {
  const safeCredsJson = JSON.stringify({
    username: creds?.username || '',
    idNumber: creds?.idNumber || '',
    password: creds?.password || '',
  }).replace(/</g, '\\u003c');
  const allowNidpSubmit = options.allowNidpSubmit ? 'true' : 'false';
  const allowExtLoginClick = options.allowExtLoginClick ? 'true' : 'false';

  return `(function() {
  try {
    var creds = ${safeCredsJson};
    var allowNidpSubmit = ${allowNidpSubmit};
    var allowExtLoginClick = ${allowExtLoginClick};
    var now = Date.now();
    var host = (window.location.hostname || '').toLowerCase();
    var href = window.location.href || '';
    var lowerHref = href.toLowerCase();

    function postMsg(payload) {
      if (window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === 'function') {
        window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      }
    }

    // 1. Panopto domain: check auth state, select Moodle provider, click external login
    if (host.indexOf('panopto.eu') !== -1 || host.indexOf('panopto.tau.ac.il') !== -1) {
      var pUser = window.Panopto && window.Panopto.user;
      var isAuth = Boolean(
        pUser &&
        pUser.isAuthenticated &&
        pUser.userId &&
        String(pUser.userId) !== '00000000-0000-0000-0000-000000000000'
      );
      if (isAuth) {
        postMsg({ type: 'PANOPTO_AUTH_CHECK', authenticated: true });
        if (lowerHref.indexOf('/auth/login.aspx') !== -1) {
          if (!window.__noodleAuthedRedirectAt || now - window.__noodleAuthedRedirectAt > 3000) {
            window.__noodleAuthedRedirectAt = now;
            window.location.href = 'https://tau.cloud.panopto.eu/Panopto/Pages/Home.aspx';
          }
        }
        return true;
      }

      var providerSelect = document.querySelector('#PageContentPlaceholder_loginControl_providerDropdown, select[id*="providerDropdown"]');
      if (providerSelect && (!providerSelect.value || providerSelect.value === 'panoptointernal')) {
        var options = Array.prototype.slice.call(providerSelect.options || []);
        var currentYear = String(new Date().getFullYear());
        var moodleOpt = null;
        for (var i = 0; i < options.length; i++) {
          if (options[i].value === 'Moodle' + currentYear) {
            moodleOpt = options[i];
            break;
          }
        }
        if (!moodleOpt) {
          for (var j = 0; j < options.length; j++) {
            if ((options[j].value || '').toLowerCase().indexOf('moodle') === 0) {
              moodleOpt = options[j];
              break;
            }
          }
        }
        if (moodleOpt) {
          providerSelect.value = moodleOpt.value;
          providerSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }

      var extBtn = document.querySelector('#PageContentPlaceholder_loginControl_externalLoginButton, [id*="externalLoginButton"]');
      if (extBtn && allowExtLoginClick) {
        if (!window.__noodleExtLoginClickedAt) {
          window.__noodleExtLoginClickedAt = now;
          postMsg({ type: 'PANOPTO_EXT_LOGIN_CLICKED' });
          extBtn.click();
          setTimeout(function() {
            try {
              var curHref = (window.location.href || '').toLowerCase();
              if (curHref.indexOf('/auth/login.aspx') !== -1) {
                var sel = document.querySelector('#PageContentPlaceholder_loginControl_providerDropdown, select[id*="providerDropdown"]');
                var selectedInstance = (sel && sel.value && sel.value !== 'panoptointernal')
                  ? sel.value
                  : ('Moodle' + new Date().getFullYear());
                var search = window.location.search || '';
                if (!search.includes('AllowBounce=true')) {
                  var sep = search.indexOf('?') === -1 ? '?' : '&';
                  var extra =
                    (search.indexOf('instance=') === -1
                      ? 'instance=' + encodeURIComponent(selectedInstance) + '&'
                      : '') + 'AllowBounce=true';
                  window.location.search = search + sep + extra;
                }
              }
            } catch (err) {}
          }, 2500);
          return true;
        }
        return true;
      }

      var signInBtn = document.querySelector('#loginButton, a[href*="Login.aspx"]');
      if (signInBtn && lowerHref.indexOf('/home.aspx') !== -1) {
        if (!window.__noodleSignInClickedAt || now - window.__noodleSignInClickedAt > 4000) {
          window.__noodleSignInClickedAt = now;
          signInBtn.click();
          return true;
        }
      }
      return true;
    }

    // 2. Moodle login page bounce: click SAML login button
    if (host.indexOf('moodle') !== -1 && host.indexOf('tau.ac.il') !== -1 && lowerHref.indexOf('/login/') !== -1) {
      var samlBtn = document.querySelector('a[href*="/auth/saml2/login.php"], .login-btn, a.btn-primary');
      if (samlBtn && (!window.__noodleMoodleSamlClickedAt || now - window.__noodleMoodleSamlClickedAt > 4000)) {
        window.__noodleMoodleSamlClickedAt = now;
        samlBtn.click();
        return true;
      }
      return true;
    }

    // 3. TAU NIDP portal: auto-fill #Ecom_User_ID, #Ecom_User_Pid, #Ecom_Password once (HTTPS + exact NIDP host only)
    if (host === 'nidp.tau.ac.il' && (window.location.protocol || '').toLowerCase() === 'https:') {
      var userEl = document.querySelector('#Ecom_User_ID, input[name="Ecom_User_ID"]');
      var pidEl = document.querySelector('#Ecom_User_Pid, input[name="Ecom_User_Pid"]');
      var passEl = document.querySelector('#Ecom_Password, input[name="Ecom_Password"]');
      if (userEl && pidEl && passEl) {
        if (allowNidpSubmit && creds && creds.username && creds.idNumber && creds.password) {
          if (!window.__noodleNidpSubmittedAt || now - window.__noodleNidpSubmittedAt > 6000) {
            window.__noodleNidpSubmittedAt = now;
            var setField = function(el, val) {
              el.focus();
              var descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
              if (descriptor && descriptor.set) {
                descriptor.set.call(el, val);
              } else {
                el.value = val;
              }
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            };
            setField(userEl, creds.username);
            setField(pidEl, creds.idNumber);
            setField(passEl, creds.password);

            postMsg({ type: 'PANOPTO_NIDP_SUBMITTED' });

            var form = (passEl.closest && passEl.closest('form')) || document.querySelector('form');
            var submitBtn = document.querySelector(
              '#loginButton2, button[type="submit"], input[type="submit"], input[type="image"], [onclick*="submit" i], [onclick*="login" i]'
            ) || (form ? form.querySelector('button, input[type="button"]') : null);

            if (submitBtn) {
              submitBtn.click();
            } else if (form) {
              if (typeof form.requestSubmit === 'function') {
                form.requestSubmit();
              } else {
                form.submit();
              }
            }
          }
        }
        return true;
      }
    }

    // 4. SAML auto-post relay form fallback
    var samlInput = document.querySelector('input[name="SAMLResponse"], input[name="SAMLRequest"], input[name="wresult"]');
    if (samlInput) {
      var relayForm = samlInput.closest ? samlInput.closest('form') : document.querySelector('form');
      if (relayForm && (!window.__noodleSamlFormSubmittedAt || now - window.__noodleSamlFormSubmittedAt > 3000)) {
        window.__noodleSamlFormSubmittedAt = now;
        relayForm.submit();
        return true;
      }
    }
  } catch (e) {}
  return true;
})();`;
}

function getNativeWebViewComponent(): React.ComponentType<any> | null {
  if (Platform.OS === 'web') {
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-webview');
    return mod?.WebView || mod?.default || null;
  } catch {
    return null;
  }
}

const NativeWebView = getNativeWebViewComponent();

export function SsoWebViewModal({
  visible,
  mode,
  onClose,
  onTokenCaptured,
  onPanoptoSuccess,
}: SsoWebViewModalProps) {
  const { theme, language, isRtl, t } = usePreferences();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState(
    mode === 'moodle' ? MOODLE_SSO_LAUNCH_URL : PANOPTO_SSO_URL
  );
  const currentUrlRef = useRef(mode === 'moodle' ? MOODLE_SSO_LAUNCH_URL : PANOPTO_SSO_URL);
  const visibleRef = useRef(visible);
  const handledRef = useRef(false);
  const webViewRef = useRef<any>(null);
  const credsRef = useRef<MoodleCredentials | null>(null);
  const credsPromiseRef = useRef<Promise<MoodleCredentials | null> | null>(null);
  const nidpSubmittedRef = useRef(false);
  const extLoginClickCountRef = useRef(0);
  const isMountedRef = useRef(true);

  const modalResetKey = `${visible ? '1' : '0'}:${mode}`;
  const [prevModalResetKey, setPrevModalResetKey] = useState(modalResetKey);
  if (prevModalResetKey !== modalResetKey) {
    setPrevModalResetKey(modalResetKey);
    if (visible) {
      const nextUrl = mode === 'moodle' ? MOODLE_SSO_LAUNCH_URL : PANOPTO_SSO_URL;
      setLoading(true);
      setLoadError(null);
      setCurrentUrl(nextUrl);
    }
  }

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      credsRef.current = null;
      credsPromiseRef.current = null;
    };
  }, []);

  useEffect(() => {
    visibleRef.current = visible;
    if (visible) {
      currentUrlRef.current = mode === 'moodle' ? MOODLE_SSO_LAUNCH_URL : PANOPTO_SSO_URL;
      handledRef.current = false;
      nidpSubmittedRef.current = false;
      extLoginClickCountRef.current = 0;
      if (mode === 'panopto') {
        credsPromiseRef.current = getStoredCredentials()
          .then((creds) => {
            if (isMountedRef.current) {
              credsRef.current = creds;
            }
            return creds;
          })
          .catch(() => null);
      } else {
        credsRef.current = null;
        credsPromiseRef.current = null;
      }
    } else {
      credsRef.current = null;
      credsPromiseRef.current = null;
    }
  }, [visible, mode]);

  const targetUrl = mode === 'moodle' ? MOODLE_SSO_LAUNCH_URL : PANOPTO_SSO_URL;
  const rowDir = isRtl ? 'row-reverse' : 'row';
  const textAlign = isRtl ? 'right' : 'left';

  const completePanoptoAuth = async (manualTap = false) => {
    if (handledRef.current || !visibleRef.current) return;
    await flushCookiesNative();
    if (!isMountedRef.current || !visibleRef.current || handledRef.current) return;

    if (isNoodleNativeAvailable()) {
      let hasAuthCookie = await hasPanoptoAuthCookieNative();
      if (!isMountedRef.current || !visibleRef.current || handledRef.current) return;
      if (!hasAuthCookie && !manualTap) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        if (!isMountedRef.current || !visibleRef.current || handledRef.current) return;
        await flushCookiesNative();
        if (!isMountedRef.current || !visibleRef.current || handledRef.current) return;
        hasAuthCookie = await hasPanoptoAuthCookieNative();
      }
      if (!hasAuthCookie) {
        if (manualTap && isMountedRef.current && visibleRef.current) {
          setLoadError(
            language === 'he'
              ? 'התחברות ל-Panopto טרם הושלמה. אנא השלם את ההתחברות בדף שלפניך.'
              : 'Panopto sign-in is not complete yet. Please finish signing in first.'
          );
        }
        return;
      }
    }

    if (!isMountedRef.current || !visibleRef.current || handledRef.current) return;
    handledRef.current = true;
    onPanoptoSuccess?.();
    onClose();
  };

  const handleMoodleUrlCheck = (url: string): boolean => {
    if (!url) return true;
    const lower = url.toLowerCase();
    const isCustomScheme =
      lower.startsWith('moodlemobile://') || lower.startsWith('moodleapp://');
    const extracted = tryExtractTokenFromUrl(url);

    if (extracted) {
      if (!handledRef.current) {
        handledRef.current = true;
        onTokenCaptured?.(extracted);
        onClose();
      }
      return false;
    }

    if (isCustomScheme) {
      return false;
    }
    return true;
  };

  const handleNavigationChange = (navState: { url?: string; loading?: boolean }) => {
    const url = navState?.url || '';
    if (url) {
      currentUrlRef.current = url;
      setCurrentUrl(url);
    }
    if (typeof navState?.loading === 'boolean') {
      setLoading(navState.loading);
    }

    if (mode === 'moodle') {
      handleMoodleUrlCheck(url);
    }
  };

  const handleLoadEnd = async (event?: { nativeEvent?: { url?: string } }) => {
    setLoading(false);
    if (mode === 'panopto' && !handledRef.current && visibleRef.current) {
      try {
        const rawUrl = event?.nativeEvent?.url || currentUrlRef.current || currentUrl;
        let parsed: URL;
        try {
          parsed = new URL(rawUrl);
        } catch {
          return;
        }
        if (parsed.protocol !== 'https:') {
          return;
        }
        const host = parsed.hostname.toLowerCase();
        if (!isExpectedPanoptoSsoHost(host)) {
          return;
        }

        const isNidpHost = host === 'nidp.tau.ac.il';
        let creds: MoodleCredentials | null = null;
        if (isNidpHost) {
          creds =
            credsRef.current ??
            (credsPromiseRef.current ? await credsPromiseRef.current : null);
          if (!isMountedRef.current || !visibleRef.current || handledRef.current) return;
        }

        const js = buildPanoptoAutoLoginJs(isNidpHost ? creds : null, {
          allowNidpSubmit: isNidpHost && !nidpSubmittedRef.current,
          allowExtLoginClick: extLoginClickCountRef.current < 2,
        });
        webViewRef.current?.injectJavaScript?.(js);
      } catch {
        // Ignore injection errors if WebView is unmounting
      }
    }
  };

  const handleWebViewMessage = (event: { nativeEvent?: { data?: string } }) => {
    const raw = event?.nativeEvent?.data;
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.type === 'PANOPTO_EXT_LOGIN_CLICKED') {
        extLoginClickCountRef.current += 1;
      } else if (parsed?.type === 'PANOPTO_NIDP_SUBMITTED') {
        nidpSubmittedRef.current = true;
      } else if (parsed?.type === 'PANOPTO_AUTH_CHECK' && parsed?.authenticated === true) {
        void completePanoptoAuth(false);
      }
    } catch {
      // Ignore non-JSON messages from page scripts
    }
  };

  const handleRetry = () => {
    setLoadError(null);
    setLoading(true);
    try {
      webViewRef.current?.reload?.();
    } catch {
      // Ignore reload errors
    }
  };

  const modalTitle =
    mode === 'moodle'
      ? t('webview_sso_btn')
      : t('panopto_sso_btn');

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
        <View
          style={[
            styles.header,
            {
              backgroundColor: theme.backgroundElement,
              borderBottomColor: theme.border,
              flexDirection: rowDir,
            },
          ]}
        >
          <View style={[styles.headerTitleWrap, { flexDirection: rowDir }]}>
            <ShieldIcon size={18} color={theme.primary} />
            <Text style={[styles.headerTitle, { color: theme.text, textAlign }]} numberOfLines={1}>
              {modalTitle}
            </Text>
          </View>

          <View style={[styles.headerActions, { flexDirection: rowDir }]}>
            {mode === 'panopto' && Platform.OS !== 'web' && (
              <TouchableOpacity
                onPress={() => {
                  void completePanoptoAuth(true);
                }}
                style={[styles.doneBtn, { backgroundColor: theme.secondary, flexDirection: rowDir }]}
              >
                <CheckIcon size={14} color="#ffffff" />
                <Text style={styles.doneBtnText}>
                  {language === 'he' ? 'סיום' : 'Done'}
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={onClose}
              style={[styles.closeBtn, { backgroundColor: theme.backgroundSelected }]}
              accessibilityLabel={t('cancel')}
            >
              <CloseIcon size={18} color={theme.text} />
            </TouchableOpacity>
          </View>
        </View>

        <View
          style={[
            styles.urlBar,
            {
              backgroundColor: theme.backgroundElement,
              borderBottomColor: theme.border,
              flexDirection: rowDir,
            },
          ]}
        >
          {loading && Platform.OS !== 'web' && (
            <ActivityIndicator size="small" color={theme.primary} />
          )}
          <Text style={[styles.urlText, { color: theme.textSecondary }]} numberOfLines={1}>
            {currentUrl}
          </Text>
        </View>

        {loadError && Platform.OS !== 'web' && (
          <View
            style={[
              styles.errorBanner,
              {
                backgroundColor: `${theme.danger}18`,
                borderBottomColor: theme.danger,
                flexDirection: rowDir,
              },
            ]}
          >
            <InfoIcon size={16} color={theme.danger} />
            <Text
              style={[styles.errorBannerText, { color: theme.danger, textAlign }]}
              numberOfLines={2}
            >
              {loadError}
            </Text>
            <TouchableOpacity
              onPress={handleRetry}
              style={[styles.retryBtn, { backgroundColor: theme.danger, flexDirection: rowDir }]}
            >
              <RefreshIcon size={13} color="#ffffff" />
              <Text style={styles.retryBtnText}>
                {language === 'he' ? 'נסה שוב' : 'Retry'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {Platform.OS === 'web' || !NativeWebView ? (
          <View style={styles.webNoticeContainer}>
            <View
              style={[
                styles.webNoticeCard,
                {
                  backgroundColor: theme.backgroundElement,
                  borderColor: theme.border,
                },
              ]}
            >
              <InfoIcon size={32} color={theme.primary} />
              <Text style={[styles.webNoticeTitle, { color: theme.text }]}>
                {language === 'he'
                  ? 'דפדפן פנימי זמין באפליקציית Android ו-iOS'
                  : 'Embedded WebView SSO is available on Android & iOS'}
              </Text>
              <Text style={[styles.webNoticeBody, { color: theme.textSecondary }]}>
                {language === 'he'
                  ? 'בגרסת הדפדפן (Web) לא ניתן להטמיע התחברות SSO חיצונית בתוך חלון פנימי. ניתן להתחבר באמצעות פרטי המשתמש של TAU או הזנת Token ידנית.'
                  : 'Embedded WebView authentication is only supported on native mobile platforms. Please sign in with your TAU credentials or enter an access token manually.'}
              </Text>
              <TouchableOpacity
                onPress={onClose}
                style={[styles.primaryBtn, { backgroundColor: theme.primary }]}
              >
                <Text style={styles.primaryBtnText}>{t('back_btn')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.webviewWrap}>
            <NativeWebView
              ref={webViewRef}
              source={{ uri: targetUrl }}
              style={styles.webview}
              sharedCookiesEnabled={true}
              thirdPartyCookiesEnabled={true}
              javaScriptEnabled={true}
              domStorageEnabled={true}
              originWhitelist={['https://*', 'http://*', 'moodlemobile://*', 'moodleapp://*']}
              onLoadStart={() => {
                setLoading(true);
                setLoadError(null);
              }}
              onLoadEnd={handleLoadEnd}
              onMessage={handleWebViewMessage}
              onError={(e: { nativeEvent?: { description?: string } }) => {
                setLoading(false);
                setLoadError(
                  e?.nativeEvent?.description ||
                    (language === 'he'
                      ? 'טעינת דף ההתחברות נכשלה.'
                      : 'Failed to load sign-in page.')
                );
              }}
              onHttpError={(e: { nativeEvent?: { statusCode?: number; description?: string } }) => {
                const code = e?.nativeEvent?.statusCode;
                if (code && code >= 400) {
                  setLoadError(
                    e?.nativeEvent?.description ||
                      (language === 'he'
                        ? `שגיאת שרת (${code})`
                        : `Server error (${code})`)
                  );
                }
              }}
              onNavigationStateChange={handleNavigationChange}
              onShouldStartLoadWithRequest={(req: { url?: string }) => {
                if (mode === 'moodle') {
                  return handleMoodleUrlCheck(req?.url || '');
                }
                return true;
              }}
            />
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  headerTitleWrap: {
    flex: 1,
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
  },
  headerActions: {
    alignItems: 'center',
    gap: 8,
  },
  doneBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    alignItems: 'center',
    gap: 5,
  },
  doneBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  urlBar: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    alignItems: 'center',
    gap: 8,
  },
  urlText: {
    fontSize: 12,
    flex: 1,
  },
  webviewWrap: {
    flex: 1,
  },
  webview: {
    flex: 1,
  },
  webNoticeContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  webNoticeCard: {
    width: '100%',
    maxWidth: 460,
    borderRadius: 16,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
    gap: 12,
  },
  webNoticeTitle: {
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  webNoticeBody: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  primaryBtn: {
    marginTop: 8,
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderRadius: 10,
  },
  primaryBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  errorBanner: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderBottomWidth: 1,
    alignItems: 'center',
    gap: 8,
  },
  errorBannerText: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: '600',
  },
  retryBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 7,
    alignItems: 'center',
    gap: 5,
  },
  retryBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
});
