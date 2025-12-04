# Big2 Mobile

A production-ready mobile application for playing Big 2 (Big Two) card game with real-time multiplayer and video chat.

## 📱 Tech Stack

- **Framework**: Expo SDK 54
- **Language**: TypeScript
- **Navigation**: React Navigation (Stack Navigator)
- **State Management**: Zustand
- **Backend**: Supabase (Auth, Realtime, Database)
- **Video Chat**: React Native WebRTC
- **Styling**: React Native StyleSheet
- **Haptics**: Expo Haptics

## 🚀 Getting Started

### Prerequisites

- Node.js (LTS version)
- npm or pnpm
- Expo Go app on your mobile device
- iOS Simulator (macOS) or Android Emulator

### Installation

```bash
# Install dependencies
npm install

# Start the development server
npm start

# Run on iOS simulator
npm run ios

# Run on Android emulator
npm run android
```

### Environment Setup

1. Copy `.env.example` to `.env`
2. Add your Supabase credentials:
   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`

## 📁 Project Structure

```
mobile/
├── src/
│   ├── components/     # Reusable UI components
│   ├── screens/        # Screen components
│   ├── navigation/     # Navigation configuration
│   ├── hooks/          # Custom React hooks
│   ├── services/       # API services (Supabase, WebRTC)
│   ├── store/          # Zustand state management
│   ├── utils/          # Utility functions
│   ├── types/          # TypeScript type definitions
│   └── constants/      # App constants
├── assets/             # Images, fonts, etc.
├── App.tsx             # Root component
└── app.json            # Expo configuration
```

## 🧪 Testing

### iOS Simulator
```bash
npm run ios
```

### Android Emulator
```bash
npm run android
```

### Physical Device
1. Install Expo Go from App Store or Play Store
2. Run `npm start`
3. Scan the QR code with your device

## 🏗️ Building for Production

### Development Build
```bash
npx eas-cli build --profile development --platform ios
npx eas-cli build --profile development --platform android
```

### Production Build
```bash
npx eas-cli build --profile production --platform ios
npx eas-cli build --profile production --platform android
```

## 📦 Dependencies

### Core
- `expo` - Expo SDK
- `react-native` - React Native framework
- `typescript` - Type safety

### Navigation
- `@react-navigation/native` - Navigation framework
- `@react-navigation/stack` - Stack navigator
- `react-native-screens` - Native screen primitives
- `react-native-safe-area-context` - Safe area handling

### Backend & State
- `@supabase/supabase-js` - Supabase client
- `@react-native-async-storage/async-storage` - Async storage
- `zustand` - State management

### Features
- `react-native-webrtc` - Video chat
- `expo-haptics` - Haptic feedback

## 🎨 Design System

The app uses a consistent design system defined in `src/constants/`:
- **Colors**: Primary, secondary, card suits
- **Spacing**: xs, sm, md, lg, xl
- **Typography**: Font sizes and weights

## 🔐 Security

- Environment variables for sensitive data
- Supabase Row Level Security (RLS)
- Secure token storage with AsyncStorage

## 📄 License

Private project - All rights reserved

## 👨‍💻 Development

Created as part of Task #259: Expo Mobile Project Setup
Project: Big2 Mobile App
