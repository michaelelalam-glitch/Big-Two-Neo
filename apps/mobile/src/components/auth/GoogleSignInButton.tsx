import React, { useEffect } from 'react';
import { TouchableOpacity, Text, View, StyleSheet, Image } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '../../services/supabase';

WebBrowser.maybeCompleteAuthSession();

const GoogleSignInButton = () => {
  const extractParamsFromUrl = (url: string) => {
    const parsedUrl = new URL(url);
    
    // Try to get params from hash first (OAuth 2.0 implicit flow)
    let params = new URLSearchParams(parsedUrl.hash.substring(1));
    
    // If no hash params, try query parameters (PKCE flow)
    if (!params.has('access_token') && !params.has('code')) {
      params = new URLSearchParams(parsedUrl.search.substring(1));
    }

    console.log('Extracted URL params:', {
      hash: parsedUrl.hash,
      search: parsedUrl.search,
      access_token: params.get('access_token') ? 'present' : 'missing',
      refresh_token: params.get('refresh_token') ? 'present' : 'missing',
      code: params.get('code') ? 'present' : 'missing',
    });

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
      console.log('Google sign in - start');

      const res = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: 'big2mobile://',
          queryParams: { prompt: 'consent' },
          skipBrowserRedirect: true,
        },
      });

      const googleOAuthUrl = res.data.url;

      if (!googleOAuthUrl) {
        console.error('No OAuth URL found!');
        return;
      }

      const result = await WebBrowser.openAuthSessionAsync(
        googleOAuthUrl,
        'big2mobile://',
        { showInRecents: true }
      ).catch((err) => {
        console.error('openAuthSessionAsync - error', { err });
        throw err;
      });

      console.log('openAuthSessionAsync - result', { result });

      if (result && result.type === 'success') {
        console.log('openAuthSessionAsync - success');
        // Redirect URL contains sensitive OAuth tokens - not logging
        
        // Check for error in the callback URL
        const parsedUrl = new URL(result.url);
        const errorParam = parsedUrl.searchParams.get('error') || 
                          new URLSearchParams(parsedUrl.hash.substring(1)).get('error');
        const errorDescription = parsedUrl.searchParams.get('error_description') ||
                                new URLSearchParams(parsedUrl.hash.substring(1)).get('error_description');
        
        if (errorParam) {
          const decodedError = decodeURIComponent(errorDescription || errorParam);
          console.error('OAuth error:', errorParam, decodedError);
          throw new Error(`Authentication failed: ${decodedError}`);
        }
        
        const params = extractParamsFromUrl(result.url);
        console.log('openAuthSessionAsync - success params', { params });

        if (params.access_token && params.refresh_token) {
          console.log('Setting session...');
          const { data, error } = await supabase.auth.setSession({
            access_token: params.access_token,
            refresh_token: params.refresh_token,
          });
          console.log('setSession - result', { data, error });

          if (error) {
            console.error('Error setting session:', error);
            throw error;
          }
        } else {
          console.error('Missing tokens in OAuth callback', {
            hasAccessToken: !!params.access_token,
            hasRefreshToken: !!params.refresh_token,
            hasCode: !!params.code,
          });
        }
      } else {
        console.log('OAuth flow cancelled or failed', { result });
      }
    } catch (error) {
      console.error('Error during Google sign in:', error);
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
