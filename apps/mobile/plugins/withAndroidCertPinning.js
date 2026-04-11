/**
 * Expo Config Plugin: Android Network Security Config (P10-3 Certificate Pinning)
 *
 * Creates res/xml/network_security_config.xml with SPKI SHA-256 pins for
 * Supabase (*.supabase.co) and registers it via
 * android:networkSecurityConfig in AndroidManifest.xml.
 *
 * ─── HOW TO GET THE SPKI HASHES ────────────────────────────────────────────
 *
 *   1. Primary leaf pin (run before each release / when cert rotates):
 *      openssl s_client \
 *        -connect dppybucldqufbqhwnkxu.supabase.co:443 \
 *        -servername dppybucldqufbqhwnkxu.supabase.co \
 *        </dev/null 2>/dev/null \
 *      | openssl x509 -noout -pubkey \
 *      | openssl pkey -pubin -outform der \
 *      | openssl dgst -sha256 -binary | base64
 *
 *   2. Backup pin (Cloudflare intermediate CA — rotate if Cloudflare changes CA):
 *      Download: https://developers.cloudflare.com/ssl/static/origin_ca_rsa_root.pem
 *      openssl x509 -in origin_ca_rsa_root.pem -noout -pubkey \
 *      | openssl pkey -pubin -outform der \
 *      | openssl dgst -sha256 -binary | base64
 *
 *   Replace the PIN_* constants below with the resulting base64 strings.
 *
 * ─── WHY TWO PINS ───────────────────────────────────────────────────────────
 *   RFC 7469 / Android docs require at least one backup pin so that you can
 *   push a new leaf hash if the primary certificate rotates without locking
 *   users out.  The backup pin on the intermediate CA gives you a rotation
 *   window where either the leaf OR the intermediate matches.
 *
 * NOTE: /android is gitignored (Expo convention). This plugin regenerates the
 *       file on every `expo prebuild` / EAS local build automatically.
 */

const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// ─── PLACEHOLDER PINS ──────────────────────────────────────────────────────
// Replace these with the actual SPKI SHA-256 hashes for your Supabase project.
// See the "HOW TO GET THE SPKI HASHES" block above for the openssl commands.
// Primary leaf pin — Supabase project dppybucldqufbqhwnkxu (expires ~2026).
// Regenerate with: openssl s_client -connect dppybucldqufbqhwnkxu.supabase.co:443 \
//   -servername dppybucldqufbqhwnkxu.supabase.co </dev/null 2>/dev/null | \
//   openssl x509 -noout -pubkey | openssl pkey -pubin -outform der | \
//   openssl dgst -sha256 -binary | base64
const PIN_PRIMARY_SUPABASE = 'GU2W4j1P24T3sqlI+o6YTnidzz0PI8fB/Gvd2ITfSZE=';
// Backup pin — Google Trust Services WE1 intermediate CA (signs *.supabase.co as of Apr 2026).
// Regenerate with: openssl s_client -showcerts -connect dppybucldqufbqhwnkxu.supabase.co:443 \
//   </dev/null 2>/dev/null | awk chain_cert_index_2 | openssl x509 -noout -pubkey | \
//   openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64
const PIN_BACKUP_GTS_WE1_INTERMEDIATE = 'kIdp6NNEd8wsugYyyIYFsi1ylMCED3hZbSR8ZFsa/A4=';
const SUPABASE_DOMAIN = 'supabase.co';
// Pin expiration — update when cert rotates (typically annually).
const PIN_EXPIRATION = '2027-04-12';

const NETWORK_SECURITY_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<!--
  Android Network Security Configuration — P10-3 Certificate Pinning
  Docs: https://developer.android.com/training/articles/security-config#CertificatePinning
-->
<network-security-config>
    <!-- Trust system CAs for all domains by default -->
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system"/>
        </trust-anchors>
    </base-config>

    <!-- Supabase API: pin the leaf cert + Google Trust Services WE1 intermediate as backup -->
    <domain-config>
        <domain includeSubdomains="true">${SUPABASE_DOMAIN}</domain>
        <pin-set expiration="${PIN_EXPIRATION}">
            <!-- Primary: Supabase leaf certificate SPKI SHA-256 -->
            <pin digest="SHA-256">${PIN_PRIMARY_SUPABASE}</pin>
            <!-- Backup: Google Trust Services WE1 intermediate CA SPKI SHA-256 -->
            <pin digest="SHA-256">${PIN_BACKUP_GTS_WE1_INTERMEDIATE}</pin>
        </pin-set>
    </domain-config>
</network-security-config>
`;

/**
 * Step 1: Write network_security_config.xml into the Android res/xml/ directory.
 */
const withNetworkSecurityConfigFile = (config) => {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const xmlDir = path.join(projectRoot, 'android', 'app', 'src', 'main', 'res', 'xml');
      fs.mkdirSync(xmlDir, { recursive: true });
      fs.writeFileSync(path.join(xmlDir, 'network_security_config.xml'), NETWORK_SECURITY_CONFIG, 'utf8');
      return config;
    },
  ]);
};

/**
 * Step 2: Reference network_security_config.xml in AndroidManifest.xml
 * by setting android:networkSecurityConfig on the <application> element.
 */
const withNetworkSecurityConfigManifest = (config) => {
  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    if (application) {
      application.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    }
    return config;
  });
};

const withAndroidCertPinning = (config) => {
  config = withNetworkSecurityConfigFile(config);
  config = withNetworkSecurityConfigManifest(config);
  return config;
};

module.exports = withAndroidCertPinning;
