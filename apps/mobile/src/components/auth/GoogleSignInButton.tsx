import React, { useEffect } from 'react';
import { TouchableOpacity, Text, View, StyleSheet, Image } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '../../services/supabase';
import { authLogger } from '../../utils/logger';

WebBrowser.maybeCompleteAuthSession();

const GoogleSignInButton = () => {
  const extractParamsFromUrl = (url: string) => {
    const parsedUrl = new URL(url);
    const hash = parsedUrl.hash.substring(1); // Remove the leading '#'
    const params = new URLSearchParams(hash);

    return {
      access_token: params.get('access_token'),
      expires_in: parseInt(params.get('expires_in') || '0'),
      refresh_token: params.get('refresh_token'),
      token_type: params.get('token_type'),
      provider_token: params.get('provider_token'),
      code: params.get('code'),
    };
  };

  const onSignInButtonPress = async () => {
    try {
      authLogger.info('Google sign in - start');

      const res = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: 'big2mobile://google-auth',
          queryParams: { prompt: 'consent' },
          skipBrowserRedirect: true,
        },
      });

      const googleOAuthUrl = res.data.url;

      if (!googleOAuthUrl) {
        authLogger.error('No OAuth URL found!');
        return;
      }

      const result = await WebBrowser.openAuthSessionAsync(
        googleOAuthUrl,
        'big2mobile://google-auth',
        { showInRecents: true }
      ).catch((err) => {
        authLogger.error('openAuthSessionAsync - error', err?.message || err?.code || String(err));
        throw err;
      });

      authLogger.debug('openAuthSessionAsync - result', { result });

      if (result && result.type === 'success') {
        authLogger.info('openAuthSessionAsync - success');
        const params = extractParamsFromUrl(result.url);
        // Redact sensitive tokens before logging
        const redactedParams = {
          ...params,
          access_token: params.access_token ? '[REDACTED]' : undefined,
          refresh_token: params.refresh_token ? '[REDACTED]' : undefined,
        };
        authLogger.debug('openAuthSessionAsync - success params', { params: redactedParams });

        if (params.access_token && params.refresh_token) {
          authLogger.debug('Setting session...');
          const { data, error } = await supabase.auth.setSession({
            access_token: params.access_token,
            refresh_token: params.refresh_token,
          });
          // Redact sensitive tokens from session data before logging
          const redactedData = data ? {
            user: data.user ? { id: data.user.id, email: data.user.email } : null,
            session: data.session ? '[REDACTED]' : null
          } : data;
          authLogger.debug('setSession - result', { data: redactedData, error: error?.message });

          if (error) {
            authLogger.error('Error setting session:', error?.message || error?.code || 'Unknown error');
            throw error;
          }
        } else {
          authLogger.error('Missing tokens in OAuth callback');
        }
      } else {
        authLogger.info('OAuth flow cancelled or failed');
      }
    } catch (error: any) {
      authLogger.error('Error during Google sign in:', error?.message || error?.code || String(error));
      throw error;
    }
  };

  // Warm up browser on mount
  useEffect(() => {
    WebBrowser.warmUpAsync();

    return () => {
      WebBrowser.coolDownAsync();
    };
  }, []);

  return (
    <TouchableOpacity
      onPress={onSignInButtonPress}
      style={styles.button}
      activeOpacity={0.8}
    >
      <View style={styles.buttonContent}>
        <Image
          source={{
            uri: 'https://developers.google.com/identity/images/g-logo.png',
          }}
          style={styles.logo}
        />
        <Text style={styles.buttonText}>Sign in with Google</Text>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dbdbdb',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 15,
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: 24,
    height: 24,
    marginRight: 10,
  },
  buttonText: {
    fontSize: 16,
    color: '#757575',
    fontWeight: '500',
  },
});

export default GoogleSignInButton;
