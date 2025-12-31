// deno-lint-ignore-file no-explicit-any
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ==================== MAIN HANDLER ====================

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get authenticated user from request
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get user from JWT
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
    
    if (authError || !user) {
      console.error('❌ [cancel-matchmaking] Auth error:', authError);
      return new Response(
        JSON.stringify({ success: false, error: 'Not authenticated' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = user.id;

    console.log('🚫 [cancel-matchmaking] Request received:', {
      user_id: userId.substring(0, 8),
    });

    // Update waiting room entry to cancelled
    const { error: updateError } = await supabaseClient
      .from('waiting_room')
      .update({ status: 'cancelled' })
      .eq('user_id', userId)
      .eq('status', 'waiting');

    if (updateError) {
      console.error('❌ [cancel-matchmaking] Failed to update status:', updateError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to cancel matchmaking' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Delete cancelled entries
    const { error: deleteError } = await supabaseClient
      .from('waiting_room')
      .delete()
      .eq('user_id', userId)
      .eq('status', 'cancelled');

    if (deleteError) {
      console.error('❌ [cancel-matchmaking] Failed to delete entry:', deleteError);
      // Don't fail - the entry is already marked as cancelled
    }

    console.log('✅ [cancel-matchmaking] Successfully cancelled matchmaking');

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('💥 [cancel-matchmaking] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
