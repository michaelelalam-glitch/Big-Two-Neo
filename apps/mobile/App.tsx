// Side-effect 'react-native-gesture-handler' import lives in index.ts (the entry point)
// so it executes before any other app code, per the library's setup requirements.
import { GestureHandlerRootView } from 'react-native-gesture-handler';
// Explicit import removed - Babel plugin handles initialization in v4.1.6+
// See: https://docs.swmansion.com/react-native-reanimated/docs/fundamentals/installation
import 'react-native-reanimated';
import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from './src/contexts/AuthContext';
import { i18n } from './src/i18n';
import AppNavigator from './src/navigation/AppNavigator';

export default function App() {
  const [i18nInitialized, setI18nInitialized] = useState(false);

  useEffect(() => {
    // Initialize i18n system on app start
    i18n.initialize().then(() => {
      setI18nInitialized(true);
    });
  }, []);

  if (!i18nInitialized) {
    // Show loading screen while i18n initializes
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#25292e' }}>
        <ActivityIndicator size="large" color="#4A90E2" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <StatusBar style="light" />
        <AppNavigator />
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
