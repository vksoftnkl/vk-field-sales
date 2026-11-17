// Config plugin: lets the Android app reach VK Nex over both plain HTTP (phone port 3012) and
// HTTPS (port 3011).
//
// - Plain HTTP on the office LAN stays allowed (cleartextTrafficPermitted). Once an app has a
//   network security config, Android ignores android:usesCleartextTraffic, so it must be said here.
// - HTTPS trusts the usual public certificates (system) AND certificates installed on the phone
//   (user). VK Nex's 3011 certificate is made by mkcert on the server PC; to use https with it,
//   install that PC's mkcert rootCA.pem once on the phone: Settings > Security > Encryption &
//   credentials > Install a certificate > CA certificate. Never copy rootCA-key.pem anywhere.
//   A real (Let's Encrypt) certificate needs no install.
//
// Needs a new build (EAS); it changes nothing in Expo Go.
const fs = require('fs');
const path = require('path');
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

const FILE = 'network_security_config';
const XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="true">
    <trust-anchors>
      <certificates src="system" />
      <certificates src="user" />
    </trust-anchors>
  </base-config>
</network-security-config>
`;

function withNetworkSecurity(config) {
  config = withDangerousMod(config, [
    'android',
    async (cfg) => {
      const dir = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml');
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(path.join(dir, `${FILE}.xml`), XML);
      return cfg;
    },
  ]);
  return withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app.$['android:networkSecurityConfig'] = `@xml/${FILE}`;
    return cfg;
  });
}

module.exports = withNetworkSecurity;
