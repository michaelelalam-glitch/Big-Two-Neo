/**
 * IP-based Region Detector
 * 
 * Uses ipapi.co free API to detect user's geographic region
 * - 1,500 requests/day limit (no API key required)
 * - Maps country codes to Supabase regions
 * - Graceful fallback to 'global' on error
 * 
 * Regions:
 * - us-east: USA East Coast
 * - us-west: USA West Coast  
 * - eu-west: Western Europe
 * - eu-central: Central Europe
 * - ap-south: Asia Pacific
 * - sa-east: South America
 * - global: Fallback/Unknown
 */

import { networkLogger } from './logger';

export type Region = 'us-east' | 'us-west' | 'eu-west' | 'eu-central' | 'ap-south' | 'sa-east' | 'global';

interface IPApiResponse {
  country_code: string;
  country_name: string;
  region: string;
  city: string;
  timezone: string;
}

// Country code to region mapping
const REGION_MAP: Record<string, Region> = {
  // North America - East
  US: 'us-east', // Default to east, will refine by state later
  CA: 'us-east', // Canada defaults to east
  MX: 'us-east', // Mexico
  
  // Europe - West
  GB: 'eu-west', // United Kingdom
  IE: 'eu-west', // Ireland
  FR: 'eu-west', // France
  ES: 'eu-west', // Spain
  PT: 'eu-west', // Portugal
  NL: 'eu-west', // Netherlands
  BE: 'eu-west', // Belgium
  
  // Europe - Central
  DE: 'eu-central', // Germany
  AT: 'eu-central', // Austria
  CH: 'eu-central', // Switzerland
  IT: 'eu-central', // Italy
  PL: 'eu-central', // Poland
  CZ: 'eu-central', // Czech Republic
  HU: 'eu-central', // Hungary
  RO: 'eu-central', // Romania
  
  // Asia Pacific
  CN: 'ap-south', // China
  JP: 'ap-south', // Japan
  KR: 'ap-south', // South Korea
  IN: 'ap-south', // India
  AU: 'ap-south', // Australia
  NZ: 'ap-south', // New Zealand
  SG: 'ap-south', // Singapore
  TH: 'ap-south', // Thailand
  VN: 'ap-south', // Vietnam
  ID: 'ap-south', // Indonesia
  PH: 'ap-south', // Philippines
  MY: 'ap-south', // Malaysia
  
  // South America
  BR: 'sa-east', // Brazil
  AR: 'sa-east', // Argentina
  CL: 'sa-east', // Chile
  CO: 'sa-east', // Colombia
  PE: 'sa-east', // Peru
  VE: 'sa-east', // Venezuela
};

// US states to region mapping (for US only)
const US_WEST_STATES = ['CA', 'WA', 'OR', 'NV', 'AZ', 'UT', 'ID', 'MT', 'WY', 'CO', 'NM', 'HI', 'AK'];

/**
 * Detect user's region based on IP address
 * 
 * @returns Promise<Region> - Detected region or 'global' as fallback
 */
export async function detectRegion(): Promise<Region> {
  try {
    networkLogger.info('[RegionDetector] Fetching IP geolocation...');
    
    const response = await fetch('https://ipapi.co/json/', {
      method: 'GET',
      headers: {
        'User-Agent': 'BigTwo/1.0',
      },
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });

    if (!response.ok) {
      networkLogger.warn('[RegionDetector] API returned status:', response.status);
      return 'global';
    }

    const data: IPApiResponse = await response.json();
    networkLogger.info('[RegionDetector] Detected country:', data.country_code, data.country_name);

    // Check if country is in our mapping
    let region = REGION_MAP[data.country_code];

    // Special handling for US: refine by state
    if (data.country_code === 'US' && data.region) {
      const stateCode = data.region.split('-')[1] || data.region; // Extract state code
      if (US_WEST_STATES.includes(stateCode)) {
        region = 'us-west';
        networkLogger.debug('[RegionDetector] US state detected:', stateCode, '→ us-west');
      } else {
        networkLogger.debug('[RegionDetector] US state detected:', stateCode, '→ us-east');
      }
    }

    if (!region) {
      networkLogger.info('[RegionDetector] Country not mapped, using global:', data.country_code);
      return 'global';
    }

    networkLogger.info('[RegionDetector] Final region:', region);
    return region;
  } catch (error: unknown) {
    networkLogger.error('[RegionDetector] Detection failed:', error instanceof Error ? error.message : String(error));
    return 'global';
  }
}

/**
 * Get human-readable region name for display
 * 
 * @param region - Region code
 * @returns string - Display name
 */
export function getRegionDisplayName(region: Region): string {
  const names: Record<Region, string> = {
    'us-east': 'USA East',
    'us-west': 'USA West',
    'eu-west': 'Europe West',
    'eu-central': 'Europe Central',
    'ap-south': 'Asia Pacific',
    'sa-east': 'South America',
    'global': 'Global',
  };
  return names[region] || 'Global';
}

/**
 * Get region emoji flag for display
 * 
 * @param region - Region code
 * @returns string - Emoji flag(s)
 */
export function getRegionEmoji(region: Region): string {
  const emojis: Record<Region, string> = {
    'us-east': '🇺🇸',
    'us-west': '🇺🇸',
    'eu-west': '🇪🇺',
    'eu-central': '🇪🇺',
    'ap-south': '🌏',
    'sa-east': '🌎',
    'global': '🌍',
  };
  return emojis[region] || '🌍';
}
