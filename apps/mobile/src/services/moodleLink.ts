import { Linking } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { MoodleClient } from '@tautracker/moodle-client';

export async function openMoodleLink(url: string) {
  try {
    if (!url.includes('moodle.tau.ac.il')) {
      return Linking.openURL(url);
    }
    const token = await SecureStore.getItemAsync('moodle_wstoken');
    if (!token) {
      return Linking.openURL(url);
    }
    const client = new MoodleClient(token);
    const siteInfo = await client.getSiteInfo();
    const { key, autologinurl } = await client.getAutoLoginKey();
    const finalUrl = \\${autologinurl}?userid=&key=&urltogo=\\;
    return Linking.openURL(finalUrl);
  } catch (err) {
    console.error('Failed to open Moodle link with auto-login', err);
    return Linking.openURL(url);
  }
}
