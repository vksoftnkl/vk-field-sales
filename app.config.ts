import type { ExpoConfig } from 'expo/config';

/** App config. APP_VARIANT comes from the EAS build profile in eas.json. */
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
    // Location for Check in (expo-location adds ACCESS_COARSE/FINE_LOCATION). Add Bluetooth here when printing returns.
    permissions: ['android.permission.ACCESS_COARSE_LOCATION', 'android.permission.ACCESS_FINE_LOCATION'],
  },
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.vksoftwares.fieldsales',
  },
  plugins: [
    'expo-router',
    'expo-sqlite',
    'expo-localization',
    // Check in saves where the visit happened (foreground only, never in the background).
    ['expo-location', { locationWhenInUsePermission: 'VKSMAN saves your location with each shop visit (Check in).' }],
    // Sync talks to the VK Nex server PC over plain HTTP on the office LAN; Android 9+ blocks
    // that unless it is allowed here. Needs a new build (Expo Go already allows it).
    ['expo-build-properties', { android: { usesCleartextTraffic: true } }],
    // Sync can also use https (VK Nex port 3011): trusts certificates installed on the phone, and
    // keeps plain HTTP allowed. See the file for how to install the server's certificate.
    './plugins/with-network-security.js',
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    eas: {
      // From `npx eas-cli@latest init` (Expo account prathap.ramesh). Not a secret; it must be
      // in this file because .env is not uploaded to the EAS build servers.
      projectId: '903f30a0-24c9-47ea-8044-8c0088cea7da',
    },
  },
};

export default config;
