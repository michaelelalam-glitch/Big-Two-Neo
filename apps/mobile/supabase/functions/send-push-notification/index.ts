import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // ⚠️ SECURITY WARNING: This function currently accepts arbitrary user_ids from untrusted clients.
    // For production, implement JWT validation and derive target users from server-side context.
    // See docs/BACKEND_PUSH_NOTIFICATION_INTEGRATION.md for security best practices.
    
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

    console.log(`📤 Sending notifications to ${tokens.length} device${tokens.length === 1 ? '' : 's'}`)

    // Prepare messages for Expo Push API
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

    // Send to Expo Push Notification service
    const expoPushUrl = 'https://exp.host/--/api/v2/push/send'
    const response = await fetch(expoPushUrl, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    })

    const result = await response.json()
    
    if (!response.ok) {
      console.error('Expo Push API error:', result)
      return new Response(
        JSON.stringify({ error: 'Failed to send notifications', details: result }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('✅ Notifications sent successfully:', result)

    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        sent: messages.length,
        results: result.data,
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
