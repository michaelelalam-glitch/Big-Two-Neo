-- Fix casual rank points going deeply negative in multi-match games.
--
-- Root cause: the formula `ROUND((100 - p_score) * p_bot_multiplier)` uses the
-- cumulative Big Two penalty score across all matches. In a long game (10+ rounds)
-- a losing player can easily accumulate 120-300+ penalty points, making
-- `(100 - score)` a large negative number and causing rank points to spiral down
-- (e.g. -67 → -157 → -227 → -260) even for players who completed the game.
--
-- Fix: cap the score used in the rank point formula at 100, so that completed
-- games (non-abandoned, non-disconnected) can only produce a [0, +100*multiplier]
-- rank point change. A player who scores 0 (winner) earns +100 * multiplier;
-- a player with score ≥ 100 earns 0 (no gain, no loss from the formula alone).
-- Disconnected/abandoned players still receive the 200-point penalty score,
-- producing a negative change — that is intentional.
--
-- This replaces the update_player_stats_after_game function defined in
-- migration 20260718000001_fix_avg_cards_left_completed_only.sql.

CREATE OR REPLACE FUNCTION public.update_player_stats_after_game(
  p_user_id uuid,
  p_game_type text,
  p_won boolean,
  p_score integer,
  p_finish_position integer,
  p_total_players integer,
  p_bot_multiplier numeric,
  p_cards_left integer DEFAULT 0,
  p_disconnected boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rank_point_change INTEGER;
  v_capped_score INTEGER;
BEGIN
  -- Cap score at 100 for rank point calculation so that completed games never
  -- produce a negative rank point change. Abandoned/disconnected players use
  -- their raw score (200 by convention), correctly generating negative points.
  v_capped_score := LEAST(p_score, 100);

  v_rank_point_change := CASE
    WHEN p_game_type = 'casual' THEN ROUND((100 - v_capped_score) * p_bot_multiplier)::INTEGER
    ELSE 0
  END;

  INSERT INTO public.player_stats (
    user_id,
    games_played,
    games_won,
    total_score,
    rank_points,
    avg_cards_left,
    last_game_at
  )
  VALUES (
    p_user_id,
    1,
    CASE WHEN p_won THEN 1 ELSE 0 END,
    p_score,
    v_rank_point_change,
    CASE WHEN NOT p_won AND NOT p_disconnected THEN p_cards_left ELSE NULL END,
    NOW()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    games_played   = player_stats.games_played + 1,
    games_won      = player_stats.games_won + CASE WHEN p_won THEN 1 ELSE 0 END,
    total_score    = player_stats.total_score + p_score,
    rank_points    = player_stats.rank_points + v_rank_point_change,
    avg_cards_left = CASE
      WHEN NOT p_won AND NOT p_disconnected AND p_cards_left IS NOT NULL THEN
        ROUND(
          (COALESCE(player_stats.avg_cards_left, 0) * (player_stats.games_played - player_stats.games_won)
           + p_cards_left)
          / NULLIF((player_stats.games_played - player_stats.games_won + 1), 0),
          2
        )
      ELSE player_stats.avg_cards_left
    END,
    last_game_at   = NOW();
END;
$$;
