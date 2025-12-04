import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useAuth } from '../contexts/AuthContext';

const ProfileScreen = () => {
  const { user, profile, isLoading, signOut } = useAuth();

  const handleSignOut = async () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      {
        text: 'Cancel',
        style: 'cancel',
      },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          try {
            await signOut();
          } catch (error) {
            console.error('Error signing out:', error);
            Alert.alert('Error', 'Failed to sign out. Please try again.');
          }
        },
      },
    ]);
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#4A90E2" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.content}>
          <View style={styles.header}>
            <Text style={styles.title}>Profile</Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Account Information</Text>

            <View style={styles.infoRow}>
              <Text style={styles.label}>Email</Text>
              <Text style={styles.value}>{user?.email || 'Not provided'}</Text>
            </View>

            <View style={styles.infoRow}>
              <Text style={styles.label}>User ID</Text>
              <Text style={styles.valueSmall} numberOfLines={1}>
                {user?.id || 'N/A'}
              </Text>
            </View>

            {profile?.username && (
              <View style={styles.infoRow}>
                <Text style={styles.label}>Username</Text>
                <Text style={styles.value}>{profile.username}</Text>
              </View>
            )}

            {profile?.full_name && (
              <View style={styles.infoRow}>
                <Text style={styles.label}>Full Name</Text>
                <Text style={styles.value}>{profile.full_name}</Text>
              </View>
            )}

            <View style={styles.infoRow}>
              <Text style={styles.label}>Provider</Text>
              <Text style={styles.value}>
                {user?.app_metadata?.provider || 'email'}
              </Text>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Session Details</Text>

            <View style={styles.infoRow}>
              <Text style={styles.label}>Last Sign In</Text>
              <Text style={styles.valueSmall}>
                {user?.last_sign_in_at
                  ? new Date(user.last_sign_in_at).toLocaleDateString()
                  : 'N/A'}
              </Text>
            </View>

            <View style={styles.infoRow}>
              <Text style={styles.label}>Created At</Text>
              <Text style={styles.valueSmall}>
                {user?.created_at
                  ? new Date(user.created_at).toLocaleDateString()
                  : 'N/A'}
              </Text>
            </View>

            <View style={styles.infoRow}>
              <Text style={styles.label}>Email Confirmed</Text>
              <Text style={styles.value}>
                {user?.email_confirmed_at ? 'Yes' : 'No'}
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={styles.signOutButton}
            onPress={handleSignOut}
            activeOpacity={0.7}
          >
            <Text style={styles.signOutButtonText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#25292e',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 20,
  },
  header: {
    marginBottom: 30,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
  },
  section: {
    backgroundColor: '#1c1f24',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2d33',
  },
  label: {
    fontSize: 14,
    color: '#a0a0a0',
    flex: 1,
  },
  value: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '500',
    flex: 2,
    textAlign: 'right',
  },
  valueSmall: {
    fontSize: 12,
    color: '#fff',
    fontWeight: '500',
    flex: 2,
    textAlign: 'right',
  },
  signOutButton: {
    backgroundColor: '#dc3545',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 20,
  },
  signOutButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default ProfileScreen;
