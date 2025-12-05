// App-wide constants

export const COLORS = {
  primary: '#25292e',
  secondary: '#4A90E2',
  accent: '#FF6B35',
  success: '#4CAF50',
  error: '#F44336',
  warning: '#FF9800',
  white: '#FFFFFF',
  black: '#000000',
  gray: {
    light: '#F5F5F5',
    medium: '#9E9E9E',
    dark: '#424242',
  },
  card: {
    hearts: '#E74C3C',
    diamonds: '#E74C3C',
    clubs: '#2C3E50',
    spades: '#2C3E50',
  },
};

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const FONT_SIZES = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
};

export const API = {
  SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL || '',
  SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '',
};
