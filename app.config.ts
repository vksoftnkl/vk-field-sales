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
    // Login only: no extra Android permissions. Add Bluetooth / location here when printing returns.
    permissions: [],
  },
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.vksoftwares.fieldsales',
  },
  plugins: [
    'expo-router',
    'expo-sqlite',
    'expo-localization',
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
