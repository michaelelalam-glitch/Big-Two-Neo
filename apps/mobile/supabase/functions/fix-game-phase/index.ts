// Apply critical game_phase trigger fix
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Fix 1: Update the trigger function
    const { error: triggerError } = await supabaseClient.rpc('exec_sql', {
      sql: `
        CREATE OR REPLACE FUNCTION transition_game_phase_after_first_play()
        RETURNS TRIGGER AS $$
        BEGIN
          IF NEW.game_phase = 'first_play' AND 
             NEW.played_cards IS NOT NULL AND 
             jsonb_array_length(NEW.played_cards) > 0 THEN
            NEW.game_phase := 'playing';
            RAISE NOTICE 'game_phase transitioned from first_play to playing for room_id: %', NEW.room_id;
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `
    });

    if (triggerError) {
      console.error('Failed to update trigger:', triggerError);
    }

    // Fix 2: Fix existing games stuck in 'normal_play'
    const { data: updateData, error: updateError } = await supabaseClient
      .from('game_state')
      .update({ game_phase: 'playing' })
      .eq('game_phase', 'normal_play')
      .select();

    console.log(`Fixed ${updateData?.length || 0} games stuck in 'normal_play'`);

    return new Response(
      JSON.stringify({ 
        success: true,
        trigger_updated: !triggerError,
        games_fixed: updateData?.length || 0
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('fix-game-phase error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
