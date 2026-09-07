import { Linking } from 'react-native';

export async function openMoodleLink(url: string) {
  try {
    await Linking.openURL(url);
  } catch (err) {
    console.error('Failed to open URL', err);
  }
}
