-- Migration: fix invalid ORDER BY expression inside UNION ALL in update_player_stats_after_game
-- Root cause: PostgreSQL rejects ORDER BY with expressions inside a UNION/INTERSECT/EXCEPT.
-- The fix wraps the UNION ALL in an inner subquery and places the ORDER BY in the outer
-- query where expressions are valid. Also aligns rank_points_history entry schema to
-- {points, is_win, game_type, timestamp} (matching StatsScreen type guard) and adds
-- SET search_path = public to prevent search_path hijacking on this SECURITY DEFINER function.

CREATE OR REPLACE FUNCTION public.update_player_stats_after_game(
  p_user_id             uuid,
  p_won                 boolean,
  p_finish_position     integer,
  p_score               integer,
  p_combos_played       jsonb,
  p_game_type           text    DEFAULT 'casual',
  p_completed           boolean DEFAULT true,
  p_cards_left          integer DEFAULT 0,
  p_voided              boolean DEFAULT false,
  p_bot_multiplier      numeric DEFAULT 1.0,
  p_ranked_elo_change   integer DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_stats                RECORD;
  v_new_win_rate         DECIMAL(5,2);
  v_new_mode_win_rate    DECIMAL(5,2);
  v_new_avg_score        DECIMAL(10,2);
  v_new_completion_rate  DECIMAL(5,2);
  v_new_avg_cards_left   DECIMAL(5,2);
  v_rank_point_change    INTEGER;
  v_new_casual_rp        INTEGER;
  v_new_ranked_rp        INTEGER;
  v_history_entry        JSONB;
  v_mode_completed       INTEGER;
  v_mode_total_cards     INTEGER;
  v_mode_avg_cards       DECIMAL(5,2);
  v_mode_avg_score       DECIMAL(10,2);
  v_mode_avg_pos         DECIMAL(3,2);
BEGIN
  SELECT * INTO v_stats FROM player_stats WHERE user_id = p_user_id;
  IF NOT FOUND THEN
    PERFORM initialize_player_stats(p_user_id);
    SELECT * INTO v_stats FROM player_stats WHERE user_id = p_user_id;
  END IF;

  v_rank_point_change := CASE
    WHEN p_game_type = 'casual' THEN
      CASE
        WHEN NOT p_completed THEN -50
        ELSE ((100 - LEAST(p_score, 100))::DECIMAL * p_bot_multiplier)::INTEGER
      END
    ELSE 0
  END;

  v_new_casual_rp := GREATEST(0,
    COALESCE(v_stats.casual_rank_points, 1000) +
    CASE WHEN p_game_type = 'casual' THEN v_rank_point_change ELSE 0 END
  );

  v_new_ranked_rp := GREATEST(0,
    COALESCE(v_stats.ranked_rank_points, 1000) +
    CASE WHEN p_game_type = 'ranked' THEN p_ranked_elo_change ELSE 0 END
  );

  v_new_win_rate := ROUND(
    (v_stats.games_won + CASE WHEN p_won THEN 1 ELSE 0 END)::DECIMAL /
    (v_stats.games_played + 1)::DECIMAL * 100, 2
  );

  v_new_avg_cards_left := CASE
    WHEN p_completed AND NOT p_voided THEN
      ROUND(
        (COALESCE(v_stats.total_cards_left_in_hand, 0) + p_cards_left)::DECIMAL /
        (COALESCE(v_stats.games_completed, 0) + 1)::DECIMAL, 2
      )
    ELSE COALESCE(v_stats.avg_cards_left_in_hand, 0)
  END;

  v_new_avg_score := CASE
    WHEN p_completed THEN
      ROUND(
        (COALESCE(v_stats.avg_score_per_game, 0) * COALESCE(v_stats.games_completed, 0) + p_score)::DECIMAL /
        (COALESCE(v_stats.games_completed, 0) + 1)::DECIMAL, 2
      )
    ELSE v_stats.avg_score_per_game
  END;

  v_new_completion_rate := LEAST(100, GREATEST(0, ROUND(
    (COALESCE(v_stats.games_completed, 0) + CASE WHEN p_completed THEN 1 ELSE 0 END)::DECIMAL /
    (v_stats.games_played + 1)::DECIMAL * 100, 2
  )));

  UPDATE player_stats SET
    games_played           = games_played + CASE WHEN NOT p_voided THEN 1 ELSE 0 END,
    games_won              = games_won  + CASE WHEN (NOT p_voided AND p_won) THEN 1 ELSE 0 END,
    games_lost             = games_lost + CASE WHEN (NOT p_voided AND NOT p_won) THEN 1 ELSE 0 END,
    win_rate               = CASE WHEN NOT p_voided THEN v_new_win_rate ELSE win_rate END,
    current_win_streak     = CASE
                               WHEN p_voided THEN current_win_streak
                               WHEN p_won    THEN current_win_streak + 1
                               ELSE 0
                             END,
    longest_win_streak     = CASE
                               WHEN p_voided THEN longest_win_streak
                               ELSE GREATEST(
                                 longest_win_streak,
                                 CASE WHEN p_won THEN current_win_streak + 1 ELSE current_win_streak END
                               )
                             END,
    current_loss_streak    = CASE
                               WHEN p_voided  THEN current_loss_streak
                               WHEN NOT p_won THEN current_loss_streak + 1
                               ELSE 0
                             END,
    rank_points            = CASE WHEN (NOT p_voided AND p_game_type = 'casual') THEN v_new_casual_rp ELSE rank_points END,
    games_completed        = COALESCE(games_completed, 0)  + CASE WHEN (NOT p_voided AND p_completed) THEN 1 ELSE 0 END,
    games_abandoned        = COALESCE(games_abandoned, 0)  + CASE WHEN (NOT p_completed AND NOT p_voided) THEN 1 ELSE 0 END,
    games_voided           = COALESCE(games_voided, 0)     + CASE WHEN p_voided THEN 1 ELSE 0 END,
    completion_rate        = CASE WHEN NOT p_voided THEN v_new_completion_rate ELSE completion_rate END,
    current_completion_streak = CASE
      WHEN p_voided     THEN current_completion_streak
      WHEN p_completed  THEN COALESCE(current_completion_streak, 0) + 1
      ELSE 0
    END,
    longest_completion_streak = CASE
      WHEN p_voided THEN COALESCE(longest_completion_streak, 0)
      ELSE GREATEST(
        COALESCE(longest_completion_streak, 0),
        CASE WHEN p_completed THEN COALESCE(current_completion_streak, 0) + 1 ELSE COALESCE(current_completion_streak, 0) END
      )
    END,
    total_cards_left_in_hand = CASE
      WHEN p_completed AND NOT p_voided THEN COALESCE(total_cards_left_in_hand, 0) + p_cards_left
      ELSE COALESCE(total_cards_left_in_hand, 0)
    END,
    avg_cards_left_in_hand   = CASE WHEN p_completed AND NOT p_voided THEN v_new_avg_cards_left ELSE avg_cards_left_in_hand END,
    last_game_at             = NOW(),
    updated_at               = NOW()
  WHERE user_id = p_user_id;

  IF p_completed AND NOT p_voided THEN
    UPDATE player_stats SET
      avg_finish_position = ROUND(
        (COALESCE(avg_finish_position, 2.5) * COALESCE(games_completed - 1, 0) + p_finish_position)::DECIMAL /
        GREATEST(COALESCE(games_completed, 1), 1)::DECIMAL, 2
      ),
      total_points             = total_points + p_score,
      highest_score            = GREATEST(highest_score, p_score),
      lowest_score             = CASE WHEN lowest_score IS NULL THEN p_score ELSE LEAST(lowest_score, p_score) END,
      avg_score_per_game       = v_new_avg_score,
      singles_played           = singles_played + COALESCE((p_combos_played->>'singles')::INTEGER, 0),
      pairs_played             = pairs_played   + COALESCE((p_combos_played->>'pairs')::INTEGER, 0),
      triples_played           = triples_played + COALESCE((p_combos_played->>'triples')::INTEGER, 0),
      straights_played         = straights_played + COALESCE((p_combos_played->>'straights')::INTEGER, 0),
      flushes_played           = COALESCE(flushes_played, 0) + COALESCE((p_combos_played->>'flushes')::INTEGER, 0),
      full_houses_played       = full_houses_played + COALESCE((p_combos_played->>'full_houses')::INTEGER, 0),
      four_of_a_kinds_played   = four_of_a_kinds_played + COALESCE((p_combos_played->>'four_of_a_kinds')::INTEGER, 0),
      straight_flushes_played  = straight_flushes_played + COALESCE((p_combos_played->>'straight_flushes')::INTEGER, 0),
      royal_flushes_played     = royal_flushes_played + COALESCE((p_combos_played->>'royal_flushes')::INTEGER, 0)
    WHERE user_id = p_user_id;
  END IF;

  IF p_game_type = 'casual' THEN
    v_new_mode_win_rate := ROUND(
      (COALESCE(v_stats.casual_games_won, 0) + CASE WHEN p_won THEN 1 ELSE 0 END)::DECIMAL /
      (COALESCE(v_stats.casual_games_played, 0) + 1)::DECIMAL * 100, 2
    );
    v_mode_completed   := COALESCE(v_stats.casual_games_completed, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN 1 ELSE 0 END;
    v_mode_total_cards := COALESCE(v_stats.casual_total_cards_left, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN p_cards_left ELSE 0 END;
    v_mode_avg_cards   := CASE WHEN (p_completed AND NOT p_voided) AND v_mode_completed > 0
                           THEN ROUND(v_mode_total_cards::DECIMAL / v_mode_completed::DECIMAL, 2)
                           ELSE COALESCE(v_stats.casual_avg_cards_left, 0) END;
    v_mode_avg_score   := CASE WHEN (p_completed AND NOT p_voided) AND v_mode_completed > 0
                           THEN ROUND(
                             (COALESCE(v_stats.casual_avg_score_per_game, 0) * COALESCE(v_stats.casual_games_completed, 0) + p_score)::DECIMAL /
                             v_mode_completed::DECIMAL, 2)
                           ELSE COALESCE(v_stats.casual_avg_score_per_game, 0) END;
    v_mode_avg_pos     := CASE WHEN (p_completed AND NOT p_voided) AND v_mode_completed > 0
                           THEN ROUND(
                             (COALESCE(v_stats.casual_avg_finish_position, 2.5) * COALESCE(v_stats.casual_games_completed, 0) + p_finish_position)::DECIMAL /
                             v_mode_completed::DECIMAL, 2)
                           ELSE COALESCE(v_stats.casual_avg_finish_position, 2.5) END;
    UPDATE player_stats SET
      casual_games_played    = COALESCE(casual_games_played, 0) + CASE WHEN NOT p_voided THEN 1 ELSE 0 END,
      casual_games_won       = COALESCE(casual_games_won, 0) + CASE WHEN (NOT p_voided AND p_won) THEN 1 ELSE 0 END,
      casual_games_lost      = COALESCE(casual_games_lost, 0) + CASE WHEN (NOT p_voided AND NOT p_won) THEN 1 ELSE 0 END,
      casual_win_rate        = CASE WHEN NOT p_voided THEN v_new_mode_win_rate ELSE casual_win_rate END,
      casual_rank_points     = CASE WHEN NOT p_voided THEN v_new_casual_rp ELSE casual_rank_points END,
      casual_games_completed = COALESCE(casual_games_completed, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN 1 ELSE 0 END,
      casual_games_abandoned = COALESCE(casual_games_abandoned, 0) + CASE WHEN (NOT p_completed AND NOT p_voided) THEN 1 ELSE 0 END,
      casual_games_voided    = COALESCE(casual_games_voided, 0) + CASE WHEN p_voided THEN 1 ELSE 0 END,
      casual_total_points        = COALESCE(casual_total_points, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN p_score ELSE 0 END,
      casual_highest_score       = CASE WHEN (p_completed AND NOT p_voided) THEN GREATEST(COALESCE(casual_highest_score, 0), p_score) ELSE COALESCE(casual_highest_score, 0) END,
      casual_lowest_score        = CASE WHEN (p_completed AND NOT p_voided) THEN
                                     CASE WHEN casual_lowest_score IS NULL THEN p_score ELSE LEAST(casual_lowest_score, p_score) END
                                   ELSE casual_lowest_score END,
      casual_avg_score_per_game  = CASE WHEN NOT p_voided THEN v_mode_avg_score ELSE casual_avg_score_per_game END,
      casual_avg_finish_position = CASE WHEN NOT p_voided THEN v_mode_avg_pos ELSE casual_avg_finish_position END,
      casual_total_cards_left    = CASE WHEN NOT p_voided THEN v_mode_total_cards ELSE COALESCE(casual_total_cards_left, 0) END,
      casual_avg_cards_left      = CASE WHEN NOT p_voided THEN v_mode_avg_cards ELSE casual_avg_cards_left END,
      casual_singles_played            = COALESCE(casual_singles_played, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN COALESCE((p_combos_played->>'singles')::INTEGER, 0) ELSE 0 END,
      casual_pairs_played              = COALESCE(casual_pairs_played, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN COALESCE((p_combos_played->>'pairs')::INTEGER, 0) ELSE 0 END,
      casual_triples_played            = COALESCE(casual_triples_played, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN COALESCE((p_combos_played->>'triples')::INTEGER, 0) ELSE 0 END,
      casual_straights_played          = COALESCE(casual_straights_played, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN COALESCE((p_combos_played->>'straights')::INTEGER, 0) ELSE 0 END,
      casual_flushes_played            = COALESCE(casual_flushes_played, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN COALESCE((p_combos_played->>'flushes')::INTEGER, 0) ELSE 0 END,
      casual_full_houses_played        = COALESCE(casual_full_houses_played, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN COALESCE((p_combos_played->>'full_houses')::INTEGER, 0) ELSE 0 END,
      casual_four_of_a_kinds_played    = COALESCE(casual_four_of_a_kinds_played, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN COALESCE((p_combos_played->>'four_of_a_kinds')::INTEGER, 0) ELSE 0 END,
      casual_straight_flushes_played   = COALESCE(casual_straight_flushes_played, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN COALESCE((p_combos_played->>'straight_flushes')::INTEGER, 0) ELSE 0 END,
      casual_royal_flushes_played      = COALESCE(casual_royal_flushes_played, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN COALESCE((p_combos_played->>'royal_flushes')::INTEGER, 0) ELSE 0 END
    WHERE user_id = p_user_id;

  ELSIF p_game_type = 'ranked' THEN
    v_new_mode_win_rate := ROUND(
      (COALESCE(v_stats.ranked_games_won, 0) + CASE WHEN p_won THEN 1 ELSE 0 END)::DECIMAL /
      (COALESCE(v_stats.ranked_games_played, 0) + 1)::DECIMAL * 100, 2
    );
    v_mode_completed   := COALESCE(v_stats.ranked_games_completed, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN 1 ELSE 0 END;
    v_mode_total_cards := COALESCE(v_stats.ranked_total_cards_left, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN p_cards_left ELSE 0 END;
    v_mode_avg_cards   := CASE WHEN (p_completed AND NOT p_voided) AND v_mode_completed > 0
                           THEN ROUND(v_mode_total_cards::DECIMAL / v_mode_completed::DECIMAL, 2)
                           ELSE COALESCE(v_stats.ranked_avg_cards_left, 0) END;
    v_mode_avg_score   := CASE WHEN (p_completed AND NOT p_voided) AND v_mode_completed > 0
                           THEN ROUND(
                             (COALESCE(v_stats.ranked_avg_score_per_game, 0) * COALESCE(v_stats.ranked_games_completed, 0) + p_score)::DECIMAL /
                             v_mode_completed::DECIMAL, 2)
                           ELSE COALESCE(v_stats.ranked_avg_score_per_game, 0) END;
    v_mode_avg_pos     := CASE WHEN (p_completed AND NOT p_voided) AND v_mode_completed > 0
                           THEN ROUND(
                             (COALESCE(v_stats.ranked_avg_finish_position, 2.5) * COALESCE(v_stats.ranked_games_completed, 0) + p_finish_position)::DECIMAL /
                             v_mode_completed::DECIMAL, 2)
                           ELSE COALESCE(v_stats.ranked_avg_finish_position, 2.5) END;
    UPDATE player_stats SET
      ranked_games_played    = COALESCE(ranked_games_played, 0) + CASE WHEN NOT p_voided THEN 1 ELSE 0 END,
      ranked_games_won       = COALESCE(ranked_games_won, 0) + CASE WHEN (NOT p_voided AND p_won) THEN 1 ELSE 0 END,
      ranked_games_lost      = COALESCE(ranked_games_lost, 0) + CASE WHEN (NOT p_voided AND NOT p_won) THEN 1 ELSE 0 END,
      ranked_win_rate        = CASE WHEN NOT p_voided THEN v_new_mode_win_rate ELSE ranked_win_rate END,
      ranked_rank_points     = CASE WHEN NOT p_voided THEN v_new_ranked_rp ELSE ranked_rank_points END,
      ranked_games_completed = COALESCE(ranked_games_completed, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN 1 ELSE 0 END,
      ranked_games_abandoned = COALESCE(ranked_games_abandoned, 0) + CASE WHEN (NOT p_completed AND NOT p_voided) THEN 1 ELSE 0 END,
      ranked_games_voided    = COALESCE(ranked_games_voided, 0) + CASE WHEN p_voided THEN 1 ELSE 0 END,
      ranked_total_points        = COALESCE(ranked_total_points, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN p_score ELSE 0 END,
      ranked_highest_score       = CASE WHEN (p_completed AND NOT p_voided) THEN GREATEST(COALESCE(ranked_highest_score, 0), p_score) ELSE COALESCE(ranked_highest_score, 0) END,
      ranked_lowest_score        = CASE WHEN (p_completed AND NOT p_voided) THEN
                                    CASE WHEN ranked_lowest_score IS NULL THEN p_score ELSE LEAST(ranked_lowest_score, p_score) END
                                   ELSE ranked_lowest_score END,
      ranked_avg_score_per_game  = CASE WHEN NOT p_voided THEN v_mode_avg_score ELSE ranked_avg_score_per_game END,
      ranked_avg_finish_position = CASE WHEN NOT p_voided THEN v_mode_avg_pos ELSE ranked_avg_finish_position END,
      ranked_total_cards_left    = CASE WHEN NOT p_voided THEN v_mode_total_cards ELSE COALESCE(ranked_total_cards_left, 0) END,
      ranked_avg_cards_left      = CASE WHEN NOT p_voided THEN v_mode_avg_cards ELSE ranked_avg_cards_left END,
      ranked_singles_played            = COALESCE(ranked_singles_played, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN COALESCE((p_combos_played->>'singles')::INTEGER, 0) ELSE 0 END,
      ranked_pairs_played              = COALESCE(ranked_pairs_played, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN COALESCE((p_combos_played->>'pairs')::INTEGER, 0) ELSE 0 END,
      ranked_triples_played            = COALESCE(ranked_triples_played, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN COALESCE((p_combos_played->>'triples')::INTEGER, 0) ELSE 0 END,
      ranked_straights_played          = COALESCE(ranked_straights_played, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN COALESCE((p_combos_played->>'straights')::INTEGER, 0) ELSE 0 END,
      ranked_flushes_played            = COALESCE(ranked_flushes_played, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN COALESCE((p_combos_played->>'flushes')::INTEGER, 0) ELSE 0 END,
      ranked_full_houses_played        = COALESCE(ranked_full_houses_played, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN COALESCE((p_combos_played->>'full_houses')::INTEGER, 0) ELSE 0 END,
      ranked_four_of_a_kinds_played    = COALESCE(ranked_four_of_a_kinds_played, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN COALESCE((p_combos_played->>'four_of_a_kinds')::INTEGER, 0) ELSE 0 END,
      ranked_straight_flushes_played   = COALESCE(ranked_straight_flushes_played, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN COALESCE((p_combos_played->>'straight_flushes')::INTEGER, 0) ELSE 0 END,
      ranked_royal_flushes_played      = COALESCE(ranked_royal_flushes_played, 0) + CASE WHEN (p_completed AND NOT p_voided) THEN COALESCE((p_combos_played->>'royal_flushes')::INTEGER, 0) ELSE 0 END
    WHERE user_id = p_user_id;

  ELSIF p_game_type = 'private' THEN
    v_new_mode_win_rate := ROUND(
      (COALESCE(v_stats.private_games_won, 0) + CASE WHEN p_won THEN 1 ELSE 0 END)::DECIMAL /
      (COALESCE(v_stats.private_games_played, 0) + 1)::DECIMAL * 100, 2
    );
    UPDATE player_stats SET
      private_games_played = COALESCE(private_games_played, 0) + CASE WHEN NOT p_voided THEN 1 ELSE 0 END,
      private_games_won    = COALESCE(private_games_won, 0) + CASE WHEN (NOT p_voided AND p_won) THEN 1 ELSE 0 END,
      private_games_lost   = COALESCE(private_games_lost, 0) + CASE WHEN (NOT p_voided AND NOT p_won) THEN 1 ELSE 0 END,
      private_win_rate     = CASE WHEN NOT p_voided THEN v_new_mode_win_rate ELSE private_win_rate END
    WHERE user_id = p_user_id;
  END IF;

  v_history_entry := jsonb_build_object(
    'points',    CASE WHEN p_game_type = 'ranked' THEN v_new_ranked_rp ELSE v_new_casual_rp END,
    'is_win',    p_won,
    'game_type', p_game_type,
    'timestamp', NOW()
  );

  -- FIX: previously ORDER BY used an expression inside a UNION ALL, which is
  -- invalid in PostgreSQL (error: "Only result column names can be used, not
  -- expressions or functions"). The fix wraps the UNION ALL in an inner subquery
  -- and places the ORDER BY + LIMIT in the outer query.
  UPDATE player_stats SET
    rank_points_history = (
      SELECT jsonb_agg(entry ORDER BY (entry->>'timestamp')::timestamptz DESC NULLS LAST)
      FROM (
        SELECT entry
        FROM (
          SELECT entry
          FROM jsonb_array_elements(
            COALESCE(rank_points_history, '[]'::jsonb)
          ) AS entry
          UNION ALL
          SELECT v_history_entry
        ) combined
        ORDER BY (entry->>'timestamp')::timestamptz DESC NULLS LAST
        LIMIT 100
      ) sub
    )
  WHERE user_id = p_user_id;

END;
$function$;
