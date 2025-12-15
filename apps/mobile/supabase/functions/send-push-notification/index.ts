import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// FCM v1 API configuration
const FCM_PROJECT_ID = Deno.env.get('FCM_PROJECT_ID') || 'big2-969bc'; // Fallback for backward compatibility
const FCM_API_URL = `https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`;
const FCM_SCOPES = ['https://www.googleapis.com/auth/firebase.messaging']

interface PushMessage {
  to: string;
  sound: string;
  title: string;
  body: string;
  data?: Record<string, any>;
  badge?: number;
  channelId?: string;
  priority?: 'default' | 'normal' | 'high';
}

interface NotificationRequest {
  user_ids: string[];
  title: string;
  body: string;
  data?: {
    type: 'game_invite' | 'your_turn' | 'game_started' | 'friend_request';
    roomCode?: string;
    [key: string]: any;
  };
  badge?: number;
}

// Base64url encode utility (RFC 7519 compliant)
// Moved outside to avoid recreation on every getAccessToken call
const base64url = (input: string): string => {
  return btoa(input)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
};

// Get OAuth2 access token from service account using Google's library approach
async function getAccessToken(): Promise<string> {
  const serviceAccountJson = Deno.env.get('FCM_SERVICE_ACCOUNT_JSON')
  if (!serviceAccountJson) {
    throw new Error('FCM_SERVICE_ACCOUNT_JSON environment variable not set')
  }
  
  const serviceAccount = JSON.parse(serviceAccountJson)
  
  // Use Google's JWT signing approach with proper base64url encoding
  const now = Math.floor(Date.now() / 1000)
  
  const header = {
    alg: 'RS256',
    typ: 'JWT'
  }
  
  const payload = {
    iss: serviceAccount.client_email,
    scope: FCM_SCOPES.join(' '),
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }
  
  const encodedHeader = base64url(JSON.stringify(header))
  const encodedPayload = base64url(JSON.stringify(payload))
  const unsignedToken = `${encodedHeader}.${encodedPayload}`
  
  // Import the private key
  const pemHeader = '-----BEGIN PRIVATE KEY-----'
  const pemFooter = '-----END PRIVATE KEY-----'
  const pemContents = serviceAccount.private_key
    .replace(pemHeader, '')
    .replace(pemFooter, '')
    .replace(/\s/g, '')
  
  const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0))
  
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryDer,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    false,
    ['sign']
  )
  
  // Sign the token
  const encoder = new TextEncoder()
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    encoder.encode(unsignedToken)
  )
  
  // Base64url encode the signature
  const signatureArray = new Uint8Array(signature)
  const signatureBase64 = btoa(String.fromCharCode(...signatureArray))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
  
  const jwt = `${unsignedToken}.${signatureBase64}`
  
  // Exchange JWT for access token
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  })
  
  const tokenData = await tokenResponse.json()
  if (!tokenResponse.ok) {
    console.error('❌ OAuth2 token error:', tokenData)
    throw new Error(`Failed to get access token: ${JSON.stringify(tokenData)}`)
  }
  
  console.log('✅ Got OAuth2 access token successfully')
  return tokenData.access_token
}

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Create Supabase client
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    // Parse request body
    const notificationRequest: NotificationRequest = await req.json()
    const { user_ids, title, body, data, badge } = notificationRequest

    if (!user_ids || user_ids.length === 0) {
      return new Response(
        JSON.stringify({ error: 'user_ids is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate required fields for game-related notifications
    if (data?.type && ['game_invite', 'your_turn', 'game_started'].includes(data.type)) {
      if (!data.roomCode) {
        return new Response(
          JSON.stringify({ error: 'roomCode is required for game notification types' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    // Get push tokens for the specified users
    const { data: tokens, error: tokensError } = await supabaseAdmin
      .from('push_tokens')
      .select('push_token, platform, user_id')
      .in('user_id', user_ids)

    if (tokensError) {
      console.error('Error fetching push tokens:', tokensError)
      return new Response(
        JSON.stringify({ error: 'Failed to fetch push tokens', details: tokensError }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!tokens || tokens.length === 0) {
      console.log('No push tokens found for specified users')
      return new Response(
        JSON.stringify({ message: 'No push tokens found', sent: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`📤 Sending notifications to ${tokens.length} device(s)`)

    // Prepare messages
    const messages: PushMessage[] = tokens.map((token) => {
      const message: PushMessage = {
        to: token.push_token,
        sound: 'default',
        title,
        body,
        data: data || {},
        priority: 'high',
      }

      // Add badge if specified
      if (badge !== undefined) {
        message.badge = badge
      }

      // Add Android channel based on notification type
      if (token.platform === 'android' && data?.type) {
        switch (data.type) {
          case 'game_invite':
          case 'game_started':
            message.channelId = 'game-updates'
            break
          case 'your_turn':
            message.channelId = 'turn-notifications'
            break
          case 'friend_request':
            message.channelId = 'social'
            break
          default:
            message.channelId = 'default'
        }
      }

      return message
    })

    // Get OAuth2 token for FCM v1 API
    const accessToken = await getAccessToken()
    
    // Send notifications via FCM v1 API
    const results = []
    for (const message of messages) {
      try {
        // Extract token: handle both wrapped (ExponentPushToken[...]) and native FCM tokens
        let token = message.to;
        if (token.startsWith('ExponentPushToken[') && token.endsWith(']')) {
          token = token.slice(18, -1); // Remove wrapper
        }
        
        // Validate token: must be non-empty and reasonably well-formed
        if (!token || typeof token !== 'string' || token.trim() === '') {
          console.error(`❌ Invalid push token for message:`, message.to);
          results.push({ status: 'error', message: 'Invalid push token', to: message.to });
          continue;
        }
        
        const fcmMessage = {
          message: {
            token: token,
            notification: {
              title: message.title,
              body: message.body,
            },
            data: message.data || {},
            android: {
              priority: 'high',
              notification: {
                channel_id: message.channelId || 'default',
                sound: message.sound || 'default',
              }
            }
          }
        }
        
        const response = await fetch(FCM_API_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(fcmMessage),
        })
        
        const result = await response.json()
        
        if (!response.ok) {
          console.error(`❌ FCM error for ${message.to}:`, result)
          results.push({ status: 'error', message: result })
        } else {
          console.log(`✅ Sent to ${message.to}`)
          results.push({ status: 'ok', id: result.name })
        }
      } catch (error) {
        console.error(`❌ Error sending to ${message.to}:`, error)
        results.push({ status: 'error', message: error.message })
      }
    }

    console.log('✅ Notifications sent via FCM v1 API:', results)

    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        sent: messages.length,
        results: results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error in send-push-notification function:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
