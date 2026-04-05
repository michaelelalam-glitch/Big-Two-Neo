export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '13.0.5';
  };
  public: {
    Tables: {
      bot_coordinator_locks: {
        Row: {
          coordinator_id: string;
          expires_at: string;
          locked_at: string;
          room_code: string;
        };
        Insert: {
          coordinator_id: string;
          expires_at: string;
          locked_at?: string;
          room_code: string;
        };
        Update: {
          coordinator_id?: string;
          expires_at?: string;
          locked_at?: string;
          room_code?: string;
        };
        Relationships: [];
      };
      friendships: {
        Row: {
          addressee_id: string;
          created_at: string;
          id: string;
          is_favorite: boolean;
          requester_id: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          addressee_id: string;
          created_at?: string;
          id?: string;
          is_favorite?: boolean;
          requester_id: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          addressee_id?: string;
          created_at?: string;
          id?: string;
          is_favorite?: boolean;
          requester_id?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'friendships_addressee_id_fkey';
            columns: ['addressee_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'friendships_requester_id_fkey';
            columns: ['requester_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      game_events: {
        Row: {
          created_at: string;
          event_data: Json;
          event_type: Database['public']['Enums']['game_event_type'];
          id: string;
          player_id: string | null;
          player_index: number | null;
          room_id: string;
          sequence_number: number;
        };
        Insert: {
          created_at?: string;
          event_data?: Json;
          event_type: Database['public']['Enums']['game_event_type'];
          id?: string;
          player_id?: string | null;
          player_index?: number | null;
          room_id: string;
          sequence_number?: number;
        };
        Update: {
          created_at?: string;
          event_data?: Json;
          event_type?: Database['public']['Enums']['game_event_type'];
          id?: string;
          player_id?: string | null;
          player_index?: number | null;
          room_id?: string;
          sequence_number?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'game_events_player_id_fkey';
            columns: ['player_id'];
            isOneToOne: false;
            referencedRelation: 'players';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'game_events_room_id_fkey';
            columns: ['room_id'];
            isOneToOne: false;
            referencedRelation: 'rooms';
            referencedColumns: ['id'];
          },
        ];
      };
      game_hands_training: {
        Row: {
          alternative_plays_available: number | null;
          bot_difficulty: string | null;
          cards_played: Json;
          cards_remaining_after_play: number;
          combo_key: number | null;
          combo_type: string;
          created_at: string;
          game_ended_at: string | null;
          game_session_id: string;
          game_type: string | null;
          hand_before_play: Json;
          hand_size_before: number;
          id: string;
          is_bot: boolean;
          is_first_play_of_game: boolean;
          is_first_play_of_round: boolean;
          last_play_before: Json | null;
          last_play_combo_type: string | null;
          opponent_hand_sizes: Json;
          passes_before_this_play: number | null;
          play_sequence: number;
          player_hash: string | null;
          player_index: number;
          risk_score: number | null;
          room_code: string | null;
          room_id: string | null;
          round_number: number;
          total_cards_remaining: number;
          was_highest_possible: boolean | null;
          won_game: boolean | null;
          won_round: boolean | null;
          won_trick: boolean | null;
        };
        Insert: {
          alternative_plays_available?: number | null;
          bot_difficulty?: string | null;
          cards_played: Json;
          cards_remaining_after_play: number;
          combo_key?: number | null;
          combo_type: string;
          created_at?: string;
          game_ended_at?: string | null;
          game_session_id: string;
          game_type?: string | null;
          hand_before_play: Json;
          hand_size_before: number;
          id?: string;
          is_bot?: boolean;
          is_first_play_of_game?: boolean;
          is_first_play_of_round?: boolean;
          last_play_before?: Json | null;
          last_play_combo_type?: string | null;
          opponent_hand_sizes: Json;
          passes_before_this_play?: number | null;
          play_sequence: number;
          player_hash?: string | null;
          player_index: number;
          risk_score?: number | null;
          room_code?: string | null;
          room_id?: string | null;
          round_number?: number;
          total_cards_remaining: number;
          was_highest_possible?: boolean | null;
          won_game?: boolean | null;
          won_round?: boolean | null;
          won_trick?: boolean | null;
        };
        Update: {
          alternative_plays_available?: number | null;
          bot_difficulty?: string | null;
          cards_played?: Json;
          cards_remaining_after_play?: number;
          combo_key?: number | null;
          combo_type?: string;
          created_at?: string;
          game_ended_at?: string | null;
          game_session_id?: string;
          game_type?: string | null;
          hand_before_play?: Json;
          hand_size_before?: number;
          id?: string;
          is_bot?: boolean;
          is_first_play_of_game?: boolean;
          is_first_play_of_round?: boolean;
          last_play_before?: Json | null;
          last_play_combo_type?: string | null;
          opponent_hand_sizes?: Json;
          passes_before_this_play?: number | null;
          play_sequence?: number;
          player_hash?: string | null;
          player_index?: number;
          risk_score?: number | null;
          room_code?: string | null;
          room_id?: string | null;
          round_number?: number;
          total_cards_remaining?: number;
          was_highest_possible?: boolean | null;
          won_game?: boolean | null;
          won_round?: boolean | null;
          won_trick?: boolean | null;
        };
        Relationships: [];
      };
      game_history: {
        Row: {
          bot_difficulty: string | null;
          created_at: string;
          finished_at: string;
          game_completed: boolean | null;
          game_duration_seconds: number | null;
          game_mode: string | null;
          game_type: string;
          id: string;
          player_1_cards_left: number | null;
          player_1_disconnected: boolean | null;
          player_1_id: string | null;
          player_1_original_username: string | null;
          player_1_score: number | null;
          player_1_username: string | null;
          player_1_was_bot: boolean | null;
          player_2_cards_left: number | null;
          player_2_disconnected: boolean | null;
          player_2_id: string | null;
          player_2_original_username: string | null;
          player_2_score: number | null;
          player_2_username: string | null;
          player_2_was_bot: boolean | null;
          player_3_cards_left: number | null;
          player_3_disconnected: boolean | null;
          player_3_id: string | null;
          player_3_original_username: string | null;
          player_3_score: number | null;
          player_3_username: string | null;
          player_3_was_bot: boolean | null;
          player_4_cards_left: number | null;
          player_4_disconnected: boolean | null;
          player_4_id: string | null;
          player_4_original_username: string | null;
          player_4_score: number | null;
          player_4_username: string | null;
          player_4_was_bot: boolean | null;
          room_code: string;
          room_id: string | null;
          started_at: string;
          stats_applied_at: string | null;
          total_rounds: number | null;
          voided_user_id: string | null;
          winner_id: string | null;
        };
        Insert: {
          bot_difficulty?: string | null;
          created_at?: string;
          finished_at: string;
          game_completed?: boolean | null;
          game_duration_seconds?: number | null;
          game_mode?: string | null;
          game_type?: string;
          id?: string;
          player_1_cards_left?: number | null;
          player_1_disconnected?: boolean | null;
          player_1_id?: string | null;
          player_1_original_username?: string | null;
          player_1_score?: number | null;
          player_1_username?: string | null;
          player_1_was_bot?: boolean | null;
          player_2_cards_left?: number | null;
          player_2_disconnected?: boolean | null;
          player_2_id?: string | null;
          player_2_original_username?: string | null;
          player_2_score?: number | null;
          player_2_username?: string | null;
          player_2_was_bot?: boolean | null;
          player_3_cards_left?: number | null;
          player_3_disconnected?: boolean | null;
          player_3_id?: string | null;
          player_3_original_username?: string | null;
          player_3_score?: number | null;
          player_3_username?: string | null;
          player_3_was_bot?: boolean | null;
          player_4_cards_left?: number | null;
          player_4_disconnected?: boolean | null;
          player_4_id?: string | null;
          player_4_original_username?: string | null;
          player_4_score?: number | null;
          player_4_username?: string | null;
          player_4_was_bot?: boolean | null;
          room_code: string;
          room_id?: string | null;
          started_at: string;
          stats_applied_at?: string | null;
          total_rounds?: number | null;
          voided_user_id?: string | null;
          winner_id?: string | null;
        };
        Update: {
          bot_difficulty?: string | null;
          created_at?: string;
          finished_at?: string;
          game_completed?: boolean | null;
          game_duration_seconds?: number | null;
          game_mode?: string | null;
          game_type?: string;
          id?: string;
          player_1_cards_left?: number | null;
          player_1_disconnected?: boolean | null;
          player_1_id?: string | null;
          player_1_original_username?: string | null;
          player_1_score?: number | null;
          player_1_username?: string | null;
          player_1_was_bot?: boolean | null;
          player_2_cards_left?: number | null;
          player_2_disconnected?: boolean | null;
          player_2_id?: string | null;
          player_2_original_username?: string | null;
          player_2_score?: number | null;
          player_2_username?: string | null;
          player_2_was_bot?: boolean | null;
          player_3_cards_left?: number | null;
          player_3_disconnected?: boolean | null;
          player_3_id?: string | null;
          player_3_original_username?: string | null;
          player_3_score?: number | null;
          player_3_username?: string | null;
          player_3_was_bot?: boolean | null;
          player_4_cards_left?: number | null;
          player_4_disconnected?: boolean | null;
          player_4_id?: string | null;
          player_4_original_username?: string | null;
          player_4_score?: number | null;
          player_4_username?: string | null;
          player_4_was_bot?: boolean | null;
          room_code?: string;
          room_id?: string | null;
          started_at?: string;
          stats_applied_at?: string | null;
          total_rounds?: number | null;
          voided_user_id?: string | null;
          winner_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'game_history_room_id_fkey';
            columns: ['room_id'];
            isOneToOne: false;
            referencedRelation: 'rooms';
            referencedColumns: ['id'];
          },
        ];
      };
      game_state: {
        Row: {
          auto_pass_timer: Json | null;
          current_turn: number;
          final_scores: Json | null;
          game_ended_at: string | null;
          game_phase: string;
          game_winner_index: number | null;
          hands: Json;
          id: string;
          last_match_winner_index: number | null;
          last_play: Json | null;
          last_player: number | null;
          match_ended_at: string | null;
          match_number: number;
          pass_count: number | null;
          passes: number | null;
          passes_in_row: number | null;
          play_history: Json | null;
          played_cards: Json | null;
          room_id: string | null;
          round_number: number | null;
          scores_history: Json;
          started_at: string | null;
          total_training_actions: number;
          turn_started_at: string | null;
          updated_at: string | null;
          winner: number | null;
        };
        Insert: {
          auto_pass_timer?: Json | null;
          current_turn?: number;
          final_scores?: Json | null;
          game_ended_at?: string | null;
          game_phase?: string;
          game_winner_index?: number | null;
          hands?: Json;
          id?: string;
          last_match_winner_index?: number | null;
          last_play?: Json | null;
          last_player?: number | null;
          match_ended_at?: string | null;
          match_number?: number;
          pass_count?: number | null;
          passes?: number | null;
          passes_in_row?: number | null;
          play_history?: Json | null;
          played_cards?: Json | null;
          room_id?: string | null;
          round_number?: number | null;
          scores_history?: Json;
          started_at?: string | null;
          total_training_actions?: number;
          turn_started_at?: string | null;
          updated_at?: string | null;
          winner?: number | null;
        };
        Update: {
          auto_pass_timer?: Json | null;
          current_turn?: number;
          final_scores?: Json | null;
          game_ended_at?: string | null;
          game_phase?: string;
          game_winner_index?: number | null;
          hands?: Json;
          id?: string;
          last_match_winner_index?: number | null;
          last_play?: Json | null;
          last_player?: number | null;
          match_ended_at?: string | null;
          match_number?: number;
          pass_count?: number | null;
          passes?: number | null;
          passes_in_row?: number | null;
          play_history?: Json | null;
          played_cards?: Json | null;
          room_id?: string | null;
          round_number?: number | null;
          scores_history?: Json;
          started_at?: string | null;
          total_training_actions?: number;
          turn_started_at?: string | null;
          updated_at?: string | null;
          winner?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'game_state_room_id_fkey';
            columns: ['room_id'];
            isOneToOne: true;
            referencedRelation: 'rooms';
            referencedColumns: ['id'];
          },
        ];
      };
      match_history: {
        Row: {
          created_at: string | null;
          duration_seconds: number | null;
          ended_at: string | null;
          id: string;
          match_type: string;
          room_code: string | null;
          room_id: string;
          started_at: string;
          winner_elo_change: number | null;
          winner_user_id: string | null;
          winner_username: string | null;
        };
        Insert: {
          created_at?: string | null;
          duration_seconds?: number | null;
          ended_at?: string | null;
          id?: string;
          match_type: string;
          room_code?: string | null;
          room_id: string;
          started_at: string;
          winner_elo_change?: number | null;
          winner_user_id?: string | null;
          winner_username?: string | null;
        };
        Update: {
          created_at?: string | null;
          duration_seconds?: number | null;
          ended_at?: string | null;
          id?: string;
          match_type?: string;
          room_code?: string | null;
          room_id?: string;
          started_at?: string;
          winner_elo_change?: number | null;
          winner_user_id?: string | null;
          winner_username?: string | null;
        };
        Relationships: [];
      };
      match_participants: {
        Row: {
          cards_remaining: number | null;
          combos_played: number | null;
          created_at: string | null;
          disconnected: boolean | null;
          elo_after: number | null;
          elo_before: number | null;
          elo_change: number | null;
          final_position: number | null;
          final_score: number | null;
          id: string;
          match_id: string;
          player_index: number;
          user_id: string | null;
          username: string;
          was_bot: boolean | null;
        };
        Insert: {
          cards_remaining?: number | null;
          combos_played?: number | null;
          created_at?: string | null;
          disconnected?: boolean | null;
          elo_after?: number | null;
          elo_before?: number | null;
          elo_change?: number | null;
          final_position?: number | null;
          final_score?: number | null;
          id?: string;
          match_id: string;
          player_index: number;
          user_id?: string | null;
          username: string;
          was_bot?: boolean | null;
        };
        Update: {
          cards_remaining?: number | null;
          combos_played?: number | null;
          created_at?: string | null;
          disconnected?: boolean | null;
          elo_after?: number | null;
          elo_before?: number | null;
          elo_change?: number | null;
          final_position?: number | null;
          final_score?: number | null;
          id?: string;
          match_id?: string;
          player_index?: number;
          user_id?: string | null;
          username?: string;
          was_bot?: boolean | null;
        };
        Relationships: [
          {
            foreignKeyName: 'match_participants_match_id_fkey';
            columns: ['match_id'];
            isOneToOne: false;
            referencedRelation: 'match_history';
            referencedColumns: ['id'];
          },
        ];
      };
      player_hands: {
        Row: {
          card_count: number;
          cards: Json;
          created_at: string;
          id: string;
          player_id: string;
          player_index: number;
          room_id: string;
          updated_at: string;
        };
        Insert: {
          card_count?: number;
          cards?: Json;
          created_at?: string;
          id?: string;
          player_id: string;
          player_index: number;
          room_id: string;
          updated_at?: string;
        };
        Update: {
          card_count?: number;
          cards?: Json;
          created_at?: string;
          id?: string;
          player_id?: string;
          player_index?: number;
          room_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'player_hands_player_id_fkey';
            columns: ['player_id'];
            isOneToOne: false;
            referencedRelation: 'room_players';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'player_hands_room_id_fkey';
            columns: ['room_id'];
            isOneToOne: false;
            referencedRelation: 'rooms';
            referencedColumns: ['id'];
          },
        ];
      };
      player_stats: {
        Row: {
          avg_cards_left_in_hand: number | null;
          avg_finish_position: number | null;
          avg_score_per_game: number | null;
          casual_avg_cards_left: number | null;
          casual_avg_finish_position: number | null;
          casual_avg_score_per_game: number | null;
          casual_flushes_played: number | null;
          casual_four_of_a_kinds_played: number | null;
          casual_full_houses_played: number | null;
          casual_games_abandoned: number | null;
          casual_games_completed: number | null;
          casual_games_lost: number | null;
          casual_games_played: number | null;
          casual_games_voided: number | null;
          casual_games_won: number | null;
          casual_highest_score: number | null;
          casual_lowest_score: number | null;
          casual_pairs_played: number | null;
          casual_rank_points: number | null;
          casual_royal_flushes_played: number | null;
          casual_singles_played: number | null;
          casual_straight_flushes_played: number | null;
          casual_straights_played: number | null;
          casual_total_cards_left: number | null;
          casual_total_points: number | null;
          casual_triples_played: number | null;
          casual_win_rate: number | null;
          completion_rate: number | null;
          created_at: string;
          current_completion_streak: number | null;
          current_loss_streak: number | null;
          current_win_streak: number | null;
          first_game_at: string | null;
          flushes_played: number | null;
          four_of_a_kinds_played: number | null;
          full_houses_played: number | null;
          games_abandoned: number | null;
          games_completed: number | null;
          games_lost: number | null;
          games_played: number | null;
          games_voided: number | null;
          games_won: number | null;
          global_rank: number | null;
          highest_score: number | null;
          id: string;
          last_game_at: string | null;
          longest_completion_streak: number | null;
          longest_win_streak: number | null;
          lowest_score: number | null;
          pairs_played: number | null;
          private_avg_cards_left: number | null;
          private_avg_finish_position: number | null;
          private_avg_score_per_game: number | null;
          private_flushes_played: number | null;
          private_four_of_a_kinds_played: number | null;
          private_full_houses_played: number | null;
          private_games_abandoned: number | null;
          private_games_completed: number | null;
          private_games_lost: number | null;
          private_games_played: number | null;
          private_games_voided: number | null;
          private_games_won: number | null;
          private_highest_score: number | null;
          private_lowest_score: number | null;
          private_pairs_played: number | null;
          private_royal_flushes_played: number | null;
          private_singles_played: number | null;
          private_straight_flushes_played: number | null;
          private_straights_played: number | null;
          private_total_cards_left: number | null;
          private_total_points: number | null;
          private_triples_played: number | null;
          private_win_rate: number | null;
          rank_points: number | null;
          rank_points_history: Json | null;
          ranked_avg_cards_left: number | null;
          ranked_avg_finish_position: number | null;
          ranked_avg_score_per_game: number | null;
          ranked_flushes_played: number | null;
          ranked_four_of_a_kinds_played: number | null;
          ranked_full_houses_played: number | null;
          ranked_games_abandoned: number | null;
          ranked_games_completed: number | null;
          ranked_games_lost: number | null;
          ranked_games_played: number | null;
          ranked_games_voided: number | null;
          ranked_games_won: number | null;
          ranked_highest_score: number | null;
          ranked_lowest_score: number | null;
          ranked_pairs_played: number | null;
          ranked_rank_points: number | null;
          ranked_royal_flushes_played: number | null;
          ranked_singles_played: number | null;
          ranked_straight_flushes_played: number | null;
          ranked_straights_played: number | null;
          ranked_total_cards_left: number | null;
          ranked_total_points: number | null;
          ranked_triples_played: number | null;
          ranked_win_rate: number | null;
          royal_flushes_played: number | null;
          singles_played: number | null;
          straight_flushes_played: number | null;
          straights_played: number | null;
          total_cards_left_in_hand: number | null;
          total_points: number | null;
          triples_played: number | null;
          updated_at: string;
          user_id: string;
          win_rate: number | null;
        };
        Insert: {
          avg_cards_left_in_hand?: number | null;
          avg_finish_position?: number | null;
          avg_score_per_game?: number | null;
          casual_avg_cards_left?: number | null;
          casual_avg_finish_position?: number | null;
          casual_avg_score_per_game?: number | null;
          casual_flushes_played?: number | null;
          casual_four_of_a_kinds_played?: number | null;
          casual_full_houses_played?: number | null;
          casual_games_abandoned?: number | null;
          casual_games_completed?: number | null;
          casual_games_lost?: number | null;
          casual_games_played?: number | null;
          casual_games_voided?: number | null;
          casual_games_won?: number | null;
          casual_highest_score?: number | null;
          casual_lowest_score?: number | null;
          casual_pairs_played?: number | null;
          casual_rank_points?: number | null;
          casual_royal_flushes_played?: number | null;
          casual_singles_played?: number | null;
          casual_straight_flushes_played?: number | null;
          casual_straights_played?: number | null;
          casual_total_cards_left?: number | null;
          casual_total_points?: number | null;
          casual_triples_played?: number | null;
          casual_win_rate?: number | null;
          completion_rate?: number | null;
          created_at?: string;
          current_completion_streak?: number | null;
          current_loss_streak?: number | null;
          current_win_streak?: number | null;
          first_game_at?: string | null;
          flushes_played?: number | null;
          four_of_a_kinds_played?: number | null;
          full_houses_played?: number | null;
          games_abandoned?: number | null;
          games_completed?: number | null;
          games_lost?: number | null;
          games_played?: number | null;
          games_voided?: number | null;
          games_won?: number | null;
          global_rank?: number | null;
          highest_score?: number | null;
          id?: string;
          last_game_at?: string | null;
          longest_completion_streak?: number | null;
          longest_win_streak?: number | null;
          lowest_score?: number | null;
          pairs_played?: number | null;
          private_avg_cards_left?: number | null;
          private_avg_finish_position?: number | null;
          private_avg_score_per_game?: number | null;
          private_flushes_played?: number | null;
          private_four_of_a_kinds_played?: number | null;
          private_full_houses_played?: number | null;
          private_games_abandoned?: number | null;
          private_games_completed?: number | null;
          private_games_lost?: number | null;
          private_games_played?: number | null;
          private_games_voided?: number | null;
          private_games_won?: number | null;
          private_highest_score?: number | null;
          private_lowest_score?: number | null;
          private_pairs_played?: number | null;
          private_royal_flushes_played?: number | null;
          private_singles_played?: number | null;
          private_straight_flushes_played?: number | null;
          private_straights_played?: number | null;
          private_total_cards_left?: number | null;
          private_total_points?: number | null;
          private_triples_played?: number | null;
          private_win_rate?: number | null;
          rank_points?: number | null;
          rank_points_history?: Json | null;
          ranked_avg_cards_left?: number | null;
          ranked_avg_finish_position?: number | null;
          ranked_avg_score_per_game?: number | null;
          ranked_flushes_played?: number | null;
          ranked_four_of_a_kinds_played?: number | null;
          ranked_full_houses_played?: number | null;
          ranked_games_abandoned?: number | null;
          ranked_games_completed?: number | null;
          ranked_games_lost?: number | null;
          ranked_games_played?: number | null;
          ranked_games_voided?: number | null;
          ranked_games_won?: number | null;
          ranked_highest_score?: number | null;
          ranked_lowest_score?: number | null;
          ranked_pairs_played?: number | null;
          ranked_rank_points?: number | null;
          ranked_royal_flushes_played?: number | null;
          ranked_singles_played?: number | null;
          ranked_straight_flushes_played?: number | null;
          ranked_straights_played?: number | null;
          ranked_total_cards_left?: number | null;
          ranked_total_points?: number | null;
          ranked_triples_played?: number | null;
          ranked_win_rate?: number | null;
          royal_flushes_played?: number | null;
          singles_played?: number | null;
          straight_flushes_played?: number | null;
          straights_played?: number | null;
          total_cards_left_in_hand?: number | null;
          total_points?: number | null;
          triples_played?: number | null;
          updated_at?: string;
          user_id: string;
          win_rate?: number | null;
        };
        Update: {
          avg_cards_left_in_hand?: number | null;
          avg_finish_position?: number | null;
          avg_score_per_game?: number | null;
          casual_avg_cards_left?: number | null;
          casual_avg_finish_position?: number | null;
          casual_avg_score_per_game?: number | null;
          casual_flushes_played?: number | null;
          casual_four_of_a_kinds_played?: number | null;
          casual_full_houses_played?: number | null;
          casual_games_abandoned?: number | null;
          casual_games_completed?: number | null;
          casual_games_lost?: number | null;
          casual_games_played?: number | null;
          casual_games_voided?: number | null;
          casual_games_won?: number | null;
          casual_highest_score?: number | null;
          casual_lowest_score?: number | null;
          casual_pairs_played?: number | null;
          casual_rank_points?: number | null;
          casual_royal_flushes_played?: number | null;
          casual_singles_played?: number | null;
          casual_straight_flushes_played?: number | null;
          casual_straights_played?: number | null;
          casual_total_cards_left?: number | null;
          casual_total_points?: number | null;
          casual_triples_played?: number | null;
          casual_win_rate?: number | null;
          completion_rate?: number | null;
          created_at?: string;
          current_completion_streak?: number | null;
          current_loss_streak?: number | null;
          current_win_streak?: number | null;
          first_game_at?: string | null;
          flushes_played?: number | null;
          four_of_a_kinds_played?: number | null;
          full_houses_played?: number | null;
          games_abandoned?: number | null;
          games_completed?: number | null;
          games_lost?: number | null;
          games_played?: number | null;
          games_voided?: number | null;
          games_won?: number | null;
          global_rank?: number | null;
          highest_score?: number | null;
          id?: string;
          last_game_at?: string | null;
          longest_completion_streak?: number | null;
          longest_win_streak?: number | null;
          lowest_score?: number | null;
          pairs_played?: number | null;
          private_avg_cards_left?: number | null;
          private_avg_finish_position?: number | null;
          private_avg_score_per_game?: number | null;
          private_flushes_played?: number | null;
          private_four_of_a_kinds_played?: number | null;
          private_full_houses_played?: number | null;
          private_games_abandoned?: number | null;
          private_games_completed?: number | null;
          private_games_lost?: number | null;
          private_games_played?: number | null;
          private_games_voided?: number | null;
          private_games_won?: number | null;
          private_highest_score?: number | null;
          private_lowest_score?: number | null;
          private_pairs_played?: number | null;
          private_royal_flushes_played?: number | null;
          private_singles_played?: number | null;
          private_straight_flushes_played?: number | null;
          private_straights_played?: number | null;
          private_total_cards_left?: number | null;
          private_total_points?: number | null;
          private_triples_played?: number | null;
          private_win_rate?: number | null;
          rank_points?: number | null;
          rank_points_history?: Json | null;
          ranked_avg_cards_left?: number | null;
          ranked_avg_finish_position?: number | null;
          ranked_avg_score_per_game?: number | null;
          ranked_flushes_played?: number | null;
          ranked_four_of_a_kinds_played?: number | null;
          ranked_full_houses_played?: number | null;
          ranked_games_abandoned?: number | null;
          ranked_games_completed?: number | null;
          ranked_games_lost?: number | null;
          ranked_games_played?: number | null;
          ranked_games_voided?: number | null;
          ranked_games_won?: number | null;
          ranked_highest_score?: number | null;
          ranked_lowest_score?: number | null;
          ranked_pairs_played?: number | null;
          ranked_rank_points?: number | null;
          ranked_royal_flushes_played?: number | null;
          ranked_singles_played?: number | null;
          ranked_straight_flushes_played?: number | null;
          ranked_straights_played?: number | null;
          ranked_total_cards_left?: number | null;
          ranked_total_points?: number | null;
          ranked_triples_played?: number | null;
          ranked_win_rate?: number | null;
          royal_flushes_played?: number | null;
          singles_played?: number | null;
          straight_flushes_played?: number | null;
          straights_played?: number | null;
          total_cards_left_in_hand?: number | null;
          total_points?: number | null;
          triples_played?: number | null;
          updated_at?: string;
          user_id?: string;
          win_rate?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'player_stats_user_id_profiles_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      players: {
        Row: {
          auto_pass: boolean;
          bot_difficulty: string | null;
          bot_name: string | null;
          card_order: Json;
          cards: Json;
          connected: boolean | null;
          connected_at: string;
          created_at: string | null;
          disconnected_at: string | null;
          id: string;
          is_bot: boolean;
          is_host: boolean | null;
          is_ready: boolean | null;
          last_seen_at: string;
          player_index: number;
          player_name: string;
          position: number | null;
          replaced_by_bot: boolean | null;
          replaced_player_name: string | null;
          room_id: string;
          score: number;
          status: string;
          tricks_won: number;
          updated_at: string | null;
          user_id: string | null;
          username: string | null;
        };
        Insert: {
          auto_pass?: boolean;
          bot_difficulty?: string | null;
          bot_name?: string | null;
          card_order?: Json;
          cards?: Json;
          connected?: boolean | null;
          connected_at?: string;
          created_at?: string | null;
          disconnected_at?: string | null;
          id?: string;
          is_bot?: boolean;
          is_host?: boolean | null;
          is_ready?: boolean | null;
          last_seen_at?: string;
          player_index: number;
          player_name: string;
          position?: number | null;
          replaced_by_bot?: boolean | null;
          replaced_player_name?: string | null;
          room_id: string;
          score?: number;
          status?: string;
          tricks_won?: number;
          updated_at?: string | null;
          user_id?: string | null;
          username?: string | null;
        };
        Update: {
          auto_pass?: boolean;
          bot_difficulty?: string | null;
          bot_name?: string | null;
          card_order?: Json;
          cards?: Json;
          connected?: boolean | null;
          connected_at?: string;
          created_at?: string | null;
          disconnected_at?: string | null;
          id?: string;
          is_bot?: boolean;
          is_host?: boolean | null;
          is_ready?: boolean | null;
          last_seen_at?: string;
          player_index?: number;
          player_name?: string;
          position?: number | null;
          replaced_by_bot?: boolean | null;
          replaced_player_name?: string | null;
          room_id?: string;
          score?: number;
          status?: string;
          tricks_won?: number;
          updated_at?: string | null;
          user_id?: string | null;
          username?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'players_room_id_fkey';
            columns: ['room_id'];
            isOneToOne: false;
            referencedRelation: 'rooms';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'players_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          best_elo_rating: number | null;
          casual_matches_played: number | null;
          created_at: string | null;
          display_name: string | null;
          elo_rating: number | null;
          elo_updated_at: string | null;
          games_played: number | null;
          id: string;
          losses: number | null;
          matchmaking_preference: string | null;
          rank: string | null;
          ranked_matches_played: number | null;
          rating: number | null;
          region: string | null;
          total_matches_played: number | null;
          updated_at: string | null;
          username: string;
          wins: number | null;
        };
        Insert: {
          avatar_url?: string | null;
          best_elo_rating?: number | null;
          casual_matches_played?: number | null;
          created_at?: string | null;
          display_name?: string | null;
          elo_rating?: number | null;
          elo_updated_at?: string | null;
          games_played?: number | null;
          id: string;
          losses?: number | null;
          matchmaking_preference?: string | null;
          rank?: string | null;
          ranked_matches_played?: number | null;
          rating?: number | null;
          region?: string | null;
          total_matches_played?: number | null;
          updated_at?: string | null;
          username: string;
          wins?: number | null;
        };
        Update: {
          avatar_url?: string | null;
          best_elo_rating?: number | null;
          casual_matches_played?: number | null;
          created_at?: string | null;
          display_name?: string | null;
          elo_rating?: number | null;
          elo_updated_at?: string | null;
          games_played?: number | null;
          id?: string;
          losses?: number | null;
          matchmaking_preference?: string | null;
          rank?: string | null;
          ranked_matches_played?: number | null;
          rating?: number | null;
          region?: string | null;
          total_matches_played?: number | null;
          updated_at?: string | null;
          username?: string;
          wins?: number | null;
        };
        Relationships: [];
      };
      push_tokens: {
        Row: {
          created_at: string | null;
          id: string;
          platform: string;
          push_token: string;
          updated_at: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string | null;
          id?: string;
          platform: string;
          push_token: string;
          updated_at?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string | null;
          id?: string;
          platform?: string;
          push_token?: string;
          updated_at?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      rate_limit_tracking: {
        Row: {
          action_type: string;
          attempts: number;
          updated_at: string;
          user_id: string;
          window_start: string;
        };
        Insert: {
          action_type: string;
          attempts?: number;
          updated_at?: string;
          user_id: string;
          window_start: string;
        };
        Update: {
          action_type?: string;
          attempts?: number;
          updated_at?: string;
          user_id?: string;
          window_start?: string;
        };
        Relationships: [];
      };
      room_analytics: {
        Row: {
          bot_player_count: number | null;
          created_at: string;
          error_type: string | null;
          event_at: string;
          human_player_count: number | null;
          id: string;
          is_dirty: boolean | null;
          metadata: Json | null;
          player_count_at_event: number | null;
          room_code: string;
          room_id: string | null;
          status_reached: string;
          time_in_playing_seconds: number | null;
          time_in_waiting_seconds: number | null;
        };
        Insert: {
          bot_player_count?: number | null;
          created_at: string;
          error_type?: string | null;
          event_at?: string;
          human_player_count?: number | null;
          id?: string;
          is_dirty?: boolean | null;
          metadata?: Json | null;
          player_count_at_event?: number | null;
          room_code: string;
          room_id?: string | null;
          status_reached: string;
          time_in_playing_seconds?: number | null;
          time_in_waiting_seconds?: number | null;
        };
        Update: {
          bot_player_count?: number | null;
          created_at?: string;
          error_type?: string | null;
          event_at?: string;
          human_player_count?: number | null;
          id?: string;
          is_dirty?: boolean | null;
          metadata?: Json | null;
          player_count_at_event?: number | null;
          room_code?: string;
          room_id?: string | null;
          status_reached?: string;
          time_in_playing_seconds?: number | null;
          time_in_waiting_seconds?: number | null;
        };
        Relationships: [];
      };
      room_players: {
        Row: {
          bot_difficulty: string | null;
          connection_status: string | null;
          disconnect_timer_started_at: string | null;
          disconnected_at: string | null;
          human_user_id: string | null;
          id: string;
          is_bot: boolean | null;
          is_connected: boolean | null;
          is_host: boolean | null;
          is_ready: boolean | null;
          joined_at: string | null;
          last_seen_at: string | null;
          player_id: string | null;
          player_index: number;
          position: number | null;
          replaced_username: string | null;
          room_id: string;
          score: number;
          user_id: string | null;
          username: string | null;
        };
        Insert: {
          bot_difficulty?: string | null;
          connection_status?: string | null;
          disconnect_timer_started_at?: string | null;
          disconnected_at?: string | null;
          human_user_id?: string | null;
          id?: string;
          is_bot?: boolean | null;
          is_connected?: boolean | null;
          is_host?: boolean | null;
          is_ready?: boolean | null;
          joined_at?: string | null;
          last_seen_at?: string | null;
          player_id?: string | null;
          player_index: number;
          position?: number | null;
          replaced_username?: string | null;
          room_id: string;
          score?: number;
          user_id?: string | null;
          username?: string | null;
        };
        Update: {
          bot_difficulty?: string | null;
          connection_status?: string | null;
          disconnect_timer_started_at?: string | null;
          disconnected_at?: string | null;
          human_user_id?: string | null;
          id?: string;
          is_bot?: boolean | null;
          is_connected?: boolean | null;
          is_host?: boolean | null;
          is_ready?: boolean | null;
          joined_at?: string | null;
          last_seen_at?: string | null;
          player_id?: string | null;
          player_index?: number;
          position?: number | null;
          replaced_username?: string | null;
          room_id?: string;
          score?: number;
          user_id?: string | null;
          username?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'room_players_player_id_fkey';
            columns: ['player_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'room_players_room_id_fkey';
            columns: ['room_id'];
            isOneToOne: false;
            referencedRelation: 'rooms';
            referencedColumns: ['id'];
          },
        ];
      };
      rooms: {
        Row: {
          banned_user_ids: string[];
          bot_coordinator_id: string | null;
          code: string;
          created_at: string | null;
          current_players: number | null;
          fill_with_bots: boolean | null;
          finished_at: string | null;
          host_id: string | null;
          host_player_id: string | null;
          id: string;
          is_matchmaking: boolean | null;
          is_public: boolean | null;
          is_quick_play: boolean;
          max_players: number | null;
          ranked_mode: boolean | null;
          rematch_for_room_id: string | null;
          room_code: string | null;
          settings: Json | null;
          started_at: string | null;
          status: string;
          updated_at: string | null;
        };
        Insert: {
          banned_user_ids?: string[];
          bot_coordinator_id?: string | null;
          code: string;
          created_at?: string | null;
          current_players?: number | null;
          fill_with_bots?: boolean | null;
          finished_at?: string | null;
          host_id?: string | null;
          host_player_id?: string | null;
          id?: string;
          is_matchmaking?: boolean | null;
          is_public?: boolean | null;
          is_quick_play?: boolean;
          max_players?: number | null;
          ranked_mode?: boolean | null;
          rematch_for_room_id?: string | null;
          room_code?: string | null;
          settings?: Json | null;
          started_at?: string | null;
          status?: string;
          updated_at?: string | null;
        };
        Update: {
          banned_user_ids?: string[];
          bot_coordinator_id?: string | null;
          code?: string;
          created_at?: string | null;
          current_players?: number | null;
          fill_with_bots?: boolean | null;
          finished_at?: string | null;
          host_id?: string | null;
          host_player_id?: string | null;
          id?: string;
          is_matchmaking?: boolean | null;
          is_public?: boolean | null;
          is_quick_play?: boolean;
          max_players?: number | null;
          ranked_mode?: boolean | null;
          rematch_for_room_id?: string | null;
          room_code?: string | null;
          settings?: Json | null;
          started_at?: string | null;
          status?: string;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'rooms_host_id_fkey';
            columns: ['host_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rooms_host_player_id_fkey';
            columns: ['host_player_id'];
            isOneToOne: false;
            referencedRelation: 'players';
            referencedColumns: ['id'];
          },
        ];
      };
      waiting_room: {
        Row: {
          id: string;
          joined_at: string;
          match_type: string | null;
          matched_at: string | null;
          matched_room_id: string | null;
          region: string | null;
          skill_rating: number | null;
          status: string | null;
          user_id: string;
          username: string;
        };
        Insert: {
          id?: string;
          joined_at?: string;
          match_type?: string | null;
          matched_at?: string | null;
          matched_room_id?: string | null;
          region?: string | null;
          skill_rating?: number | null;
          status?: string | null;
          user_id: string;
          username: string;
        };
        Update: {
          id?: string;
          joined_at?: string;
          match_type?: string | null;
          matched_at?: string | null;
          matched_room_id?: string | null;
          region?: string | null;
          skill_rating?: number | null;
          status?: string | null;
          user_id?: string;
          username?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'waiting_room_matched_room_id_fkey';
            columns: ['matched_room_id'];
            isOneToOne: false;
            referencedRelation: 'rooms';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      leaderboard_casual: {
        Row: {
          avatar_url: string | null;
          current_win_streak: number | null;
          games_played: number | null;
          games_won: number | null;
          longest_win_streak: number | null;
          rank: number | null;
          rank_points: number | null;
          user_id: string | null;
          username: string | null;
          win_rate: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'player_stats_user_id_profiles_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      leaderboard_global: {
        Row: {
          avatar_url: string | null;
          current_win_streak: number | null;
          games_played: number | null;
          games_won: number | null;
          longest_win_streak: number | null;
          rank: number | null;
          rank_points: number | null;
          user_id: string | null;
          username: string | null;
          win_rate: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'player_stats_user_id_profiles_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      leaderboard_ranked: {
        Row: {
          avatar_url: string | null;
          current_win_streak: number | null;
          games_played: number | null;
          games_won: number | null;
          longest_win_streak: number | null;
          rank: number | null;
          rank_points: number | null;
          user_id: string | null;
          username: string | null;
          win_rate: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'player_stats_user_id_profiles_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Functions: {
      advance_game_state: {
        Args: { p_event_type: string; p_room_code: string };
        Returns: Json;
      };
      calculate_rank_from_elo: {
        Args: { p_elo_rating: number };
        Returns: string;
      };
      calculate_trick_winner: { Args: { p_room_id: string }; Returns: number };
      cancel_matchmaking: { Args: { p_user_id: string }; Returns: undefined };
      card_string_to_object: { Args: { card_code: string }; Returns: Json };
      check_all_players_ready: { Args: { p_room_id: string }; Returns: boolean };
      classify_combo: { Args: { cards: Json }; Returns: Json };
      cleanup_abandoned_rooms: { Args: never; Returns: Json };
      cleanup_stale_waiting_room_entries: { Args: never; Returns: undefined };
      compare_cards: { Args: { card1: Json; card2: Json }; Returns: number };
      complete_game_from_client: {
        Args: {
          p_finished_at: string;
          p_game_duration_seconds: number;
          p_players: Json;
          p_room_code: string;
          p_room_id: string;
          p_started_at: string;
          p_winner_id: string;
        };
        Returns: Json;
      };
      delete_room_players_by_human_user_id: {
        Args: { human_user_id: string };
        Returns: undefined;
      };
      execute_auto_pass_batch: {
        Args: {
          p_exempt_player_id: string;
          p_room_code: string;
          p_timer_sequence_id: number;
        };
        Returns: Json;
      };
      execute_bot_turn: {
        Args: { p_bot_player_index: number; p_room_id: string };
        Returns: Json;
      };
      execute_pass_move: {
        Args: { p_player_id: string; p_room_code: string };
        Returns: Json;
      };
      execute_play_move: {
        Args: { p_cards: Json; p_player_id: string; p_room_code: string };
        Returns: Json;
      };
      find_highest_beating_single: {
        Args: { p_hand: Json; p_last_play: Json };
        Returns: Json;
      };
      find_match: {
        Args: {
          p_match_type?: string;
          p_region?: string;
          p_skill_rating?: number;
          p_username: string;
        };
        Returns: {
          matched: boolean;
          room_code: string;
          room_id: string;
          waiting_count: number;
        }[];
      };
      force_leave_room: { Args: { p_user_id: string }; Returns: undefined };
      generate_room_code: { Args: never; Returns: string };
      generate_room_code_v2: { Args: never; Returns: string };
      get_card_value: { Args: { p_card: Json }; Returns: number };
      get_leaderboard_casual: {
        Args: { p_limit?: number; p_offset?: number };
        Returns: {
          avatar_url: string;
          current_win_streak: number;
          games_played: number;
          games_won: number;
          longest_win_streak: number;
          rank: number;
          rank_points: number;
          user_id: string;
          username: string;
          win_rate: number;
        }[];
      };
      get_leaderboard_global: {
        Args: { p_limit?: number; p_offset?: number };
        Returns: {
          avatar_url: string;
          current_win_streak: number;
          games_played: number;
          games_won: number;
          longest_win_streak: number;
          rank: number;
          rank_points: number;
          user_id: string;
          username: string;
          win_rate: number;
        }[];
      };
      get_leaderboard_rank_casual_by_user_id: {
        Args: { p_user_id: string };
        Returns: {
          avatar_url: string;
          current_win_streak: number;
          games_played: number;
          games_won: number;
          longest_win_streak: number;
          rank: number;
          rank_points: number;
          user_id: string;
          username: string;
          win_rate: number;
        }[];
      };
      get_leaderboard_rank_ranked_by_user_id: {
        Args: { p_user_id: string };
        Returns: {
          avatar_url: string;
          current_win_streak: number;
          games_played: number;
          games_won: number;
          longest_win_streak: number;
          rank: number;
          rank_points: number;
          user_id: string;
          username: string;
          win_rate: number;
        }[];
      };
      get_leaderboard_ranked: {
        Args: { p_limit?: number; p_offset?: number };
        Returns: {
          avatar_url: string;
          current_win_streak: number;
          games_played: number;
          games_won: number;
          longest_win_streak: number;
          rank: number;
          rank_points: number;
          user_id: string;
          username: string;
          win_rate: number;
        }[];
      };
      get_mutual_friends_count: {
        Args: { p_other_user_id: string };
        Returns: number;
      };
      get_mutual_friends_list: {
        Args: { p_other_user_id: string };
        Returns: {
          friend_id: string;
          username: string;
        }[];
      };
      get_next_turn_after_three_passes: {
        Args: { p_game_state_id: string; p_last_passing_player_index: number };
        Returns: number;
      };
      get_or_create_rematch_room: {
        Args: {
          p_is_matchmaking: boolean;
          p_is_public: boolean;
          p_ranked_mode: boolean;
          p_source_room_id: string;
          p_user_id: string;
          p_username: string;
        };
        Returns: Json;
      };
      get_or_create_room: {
        Args: {
          p_is_matchmaking: boolean;
          p_is_public: boolean;
          p_ranked_mode: boolean;
          p_user_id: string;
          p_username: string;
        };
        Returns: Json;
      };
      get_rejoin_status: {
        Args: { p_room_id: string; p_user_id: string };
        Returns: Json;
      };
      initialize_player_stats: { Args: { p_user_id: string }; Returns: string };
      is_auto_pass_timer_expired: {
        Args: { timer_state: Json };
        Returns: boolean;
      };
      is_bot_coordinator: { Args: { p_room_id: string }; Returns: boolean };
      is_highest_possible_play: {
        Args: { p_cards: Json; p_played_cards: Json };
        Returns: boolean;
      };
      is_username_available_global: {
        Args: { p_exclude_user_id?: string; p_username: string };
        Returns: boolean;
      };
      join_room_atomic: {
        Args: { p_room_code: string; p_user_id: string; p_username: string };
        Returns: Json;
      };
      lobby_claim_host: { Args: { p_room_id: string }; Returns: Json };
      lobby_evict_ghosts: { Args: { p_room_id: string }; Returns: number };
      lobby_host_leave: {
        Args: { p_leaving_user_id: string; p_room_id: string };
        Returns: undefined;
      };
      lobby_kick_player: {
        Args: {
          p_kicked_user_id: string;
          p_kicker_user_id: string;
          p_room_id: string;
        };
        Returns: undefined;
      };
      log_room_event: {
        Args: {
          p_error_type?: string;
          p_event_type: string;
          p_metadata?: Json;
          p_room_id: string;
        };
        Returns: string;
      };
      mark_player_disconnected: {
        Args: { p_room_id: string; p_user_id: string };
        Returns: undefined;
      };
      process_disconnected_players: { Args: never; Returns: Json };
      reassign_next_host: { Args: { p_room_id: string }; Returns: boolean };
      reconnect_player: {
        Args: { p_room_id: string; p_user_id: string };
        Returns: Json;
      };
      refresh_bot_coordinator_lease: {
        Args: {
          p_coordinator_id: string;
          p_room_code: string;
          p_timeout_seconds?: number;
        };
        Returns: boolean;
      };
      refresh_leaderboard: { Args: never; Returns: undefined };
      release_bot_coordinator_lease: {
        Args: { p_coordinator_id: string; p_room_code: string };
        Returns: undefined;
      };
      replace_disconnected_with_bot: {
        Args: {
          p_disconnect_duration_seconds: number;
          p_player_index: number;
          p_room_id: string;
        };
        Returns: Json;
      };
      server_time_ms: { Args: never; Returns: number };
      start_game_with_bots:
        | {
            Args: {
              p_bot_count: number;
              p_bot_difficulty?: string;
              p_room_id: string;
            };
            Returns: Json;
          }
        | {
            Args: { p_bot_difficulty?: string; p_room_id: string };
            Returns: Json;
          };
      test_cleanup_user_data: {
        Args: { p_user_ids: string[] };
        Returns: undefined;
      };
      try_acquire_bot_coordinator_lease: {
        Args: {
          p_coordinator_id: string;
          p_room_code: string;
          p_timeout_seconds?: number;
        };
        Returns: boolean;
      };
      try_join_quick_play_room: {
        Args: { p_player_name: string; p_room_code?: string };
        Returns: Json;
      };
      update_player_heartbeat: {
        Args: { p_room_id: string; p_user_id: string };
        Returns: undefined;
      };
      update_player_stats: {
        Args: {
          p_cards_left?: number;
          p_combo_stats?: Json;
          p_completed?: boolean;
          p_finish_position: number;
          p_game_type?: string;
          p_score: number;
          p_user_id: string;
          p_won: boolean;
        };
        Returns: undefined;
      };
      update_player_stats_after_game: {
        Args: {
          p_bot_multiplier?: number;
          p_cards_left?: number;
          p_combos_played: Json;
          p_completed?: boolean;
          p_finish_position: number;
          p_game_type?: string;
          p_ranked_elo_change?: number;
          p_score: number;
          p_user_id: string;
          p_voided?: boolean;
          p_won: boolean;
        };
        Returns: undefined;
      };
      upsert_rate_limit_counter: {
        Args: {
          p_action_type: string;
          p_user_id: string;
          p_window_secs: number;
        };
        Returns: number;
      };
      validate_one_card_left_rule: {
        Args: {
          p_current_player_hand: Json;
          p_last_play: Json;
          p_next_player_card_count: number;
          p_selected_cards: Json;
        };
        Returns: Json;
      };
      validate_pass_action: {
        Args: { p_player_id: string; p_room_code: string };
        Returns: Json;
      };
      validate_play_action: {
        Args: { p_cards: Json; p_player_id: string; p_room_code: string };
        Returns: Json;
      };
    };
    Enums: {
      game_event_type:
        | 'room_created'
        | 'player_joined'
        | 'player_left'
        | 'game_started'
        | 'cards_dealt'
        | 'play_made'
        | 'pass'
        | 'turn_changed'
        | 'round_ended'
        | 'game_ended'
        | 'chat_message'
        | 'player_reconnected';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      game_event_type: [
        'room_created',
        'player_joined',
        'player_left',
        'game_started',
        'cards_dealt',
        'play_made',
        'pass',
        'turn_changed',
        'round_ended',
        'game_ended',
        'chat_message',
        'player_reconnected',
      ],
    },
  },
} as const;
