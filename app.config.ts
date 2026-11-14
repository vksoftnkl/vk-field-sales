import type { ExpoConfig } from 'expo/config';

/**
 * App config. APP_VARIANT comes from the EAS build profile in eas.json.
 * The VK Nex server address is entered on the phone (Server settings), not baked in here.
 */
const IS_DEV = process.env.APP_VARIANT === 'development';

const config: ExpoConfig = {
  name: IS_DEV ? 'VK Field Sales (Dev)' : 'VK Field Sales',
  slug: 'vk-field-sales',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  scheme: 'vkfieldsales',
  // Mobile only. Without this, Expo adds 'web' because react-dom is installed.
  platforms: ['android', 'ios'],
  userInterfaceStyle: 'light',
  android: {
    package: IS_DEV ? 'com.vksoftwares.fieldsales.dev' : 'com.vksoftwares.fieldsales',
    adaptiveIcon: {
      backgroundColor: '#8B1D1D',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    // Bluetooth Classic printers + GPS visits (Phase 1/4). Remove what you don't use.
    permissions: [
      'android.permission.BLUETOOTH_CONNECT',
      'android.permission.BLUETOOTH_SCAN',
      'android.permission.ACCESS_FINE_LOCATION',
    ],
  },
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.vksoftwares.fieldsales',
  },
  plugins: [
    'expo-router',
    'expo-sqlite',
    'expo-secure-store',
    'expo-localization',
    // Sync talks to the VK Nex server PC over plain http:// on the office LAN.
    // Android 9+ blocks cleartext HTTP unless this is on.
    ['expo-build-properties', { android: { usesCleartextTraffic: true } }],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    eas: {
      // Filled in by `npx eas-cli@latest init`
      projectId: process.env.EAS_PROJECT_ID,
    },
  },
};

export default config;
