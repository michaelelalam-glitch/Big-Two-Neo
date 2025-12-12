/**
 * Tests for Auto-Pass Timer WebSocket Events
 * 
 * Tests the three new broadcast events:
 * - auto_pass_timer_started
 * - auto_pass_timer_cancelled
 * - auto_pass_executed
 */

import type { AutoPassTimerState, BroadcastEvent } from '../../types/multiplayer';

describe('Auto-Pass Timer WebSocket Events', () => {
  describe('Event type definitions', () => {
    it('should have auto_pass_timer_started event type', () => {
      const event: BroadcastEvent = 'auto_pass_timer_started';
      expect(event).toBe('auto_pass_timer_started');
    });
    
    it('should have auto_pass_timer_cancelled event type', () => {
      const event: BroadcastEvent = 'auto_pass_timer_cancelled';
      expect(event).toBe('auto_pass_timer_cancelled');
    });
    
    it('should have auto_pass_executed event type', () => {
      const event: BroadcastEvent = 'auto_pass_executed';
      expect(event).toBe('auto_pass_executed');
    });
  });
  
  describe('auto_pass_timer_started data payload', () => {
    it('should support timer state with all required fields', () => {
      const timerState: AutoPassTimerState = {
        active: true,
        started_at: new Date().toISOString(),
        duration_ms: 10000,
        remaining_ms: 10000,
        triggering_play: {
          position: 0,
          cards: [{ id: '2S', rank: '2', suit: 'S' }],
          combo_type: 'Single',
        },
        player_id: 'player-0',
      };
      
      expect(timerState.active).toBe(true);
      expect(timerState.duration_ms).toBe(10000);
      expect(timerState.remaining_ms).toBe(10000);
      expect(timerState.triggering_play.cards.length).toBe(1);
    });
    
    it('should support triggering play with pairs', () => {
      const timerState: AutoPassTimerState = {
        active: true,
        started_at: '2025-12-12T10:00:00.000Z',
        duration_ms: 10000,
        remaining_ms: 10000,
        triggering_play: {
          position: 2,
          cards: [
            { id: '2S', rank: '2', suit: 'S' },
            { id: '2H', rank: '2', suit: 'H' },
          ],
          combo_type: 'Pair',
        },
        player_id: 'player-2',
      };
      
      expect(timerState.triggering_play.cards.length).toBe(2);
      expect(timerState.triggering_play.combo_type).toBe('Pair');
    });
  });
  
  describe('auto_pass_timer_cancelled data payload', () => {
    it('should support manual_pass reason', () => {
      const data = {
        player_index: 1,
        reason: 'manual_pass' as const,
      };
      
      expect(data.player_index).toBe(1);
      expect(data.reason).toBe('manual_pass');
    });
    
    it('should support new_play reason', () => {
      const data = {
        player_index: 2,
        reason: 'new_play' as const,
      };
      
      expect(data.player_index).toBe(2);
      expect(data.reason).toBe('new_play');
    });
  });
  
  describe('auto_pass_executed data payload', () => {
    it('should identify which player was auto-passed', () => {
      const data = {
        player_index: 3,
      };
      
      expect(data.player_index).toBe(3);
      expect(typeof data.player_index).toBe('number');
    });
  });
  
  describe('Event sequence scenarios', () => {
    it('should support full auto-pass lifecycle sequence', () => {
      const events: BroadcastEvent[] = [
        'auto_pass_timer_started',
        'auto_pass_executed',
      ];
      
      expect(events).toEqual(['auto_pass_timer_started', 'auto_pass_executed']);
    });
    
    it('should support timer cancellation by manual pass', () => {
      const events: BroadcastEvent[] = [
        'auto_pass_timer_started',
        'auto_pass_timer_cancelled',
        'player_passed',
      ];
      
      expect(events).toEqual([
        'auto_pass_timer_started',
        'auto_pass_timer_cancelled',
        'player_passed',
      ]);
    });
    
    it('should support timer cancellation by new play', () => {
      const events: BroadcastEvent[] = [
        'auto_pass_timer_started',
        'auto_pass_timer_cancelled',
        'cards_played',
      ];
      
      expect(events).toEqual([
        'auto_pass_timer_started',
        'auto_pass_timer_cancelled',
        'cards_played',
      ]);
    });
  });
  
  describe('AutoPassTimerState type validation', () => {
    it('should have all required properties', () => {
      const timerState: AutoPassTimerState = {
        active: true,
        started_at: new Date().toISOString(),
        duration_ms: 10000,
        remaining_ms: 10000,
        triggering_play: {
          position: 0,
          cards: [{ id: '2S', rank: '2', suit: 'S' }],
          combo_type: 'Single',
        },
        player_id: 'player-0',
      };
      
      expect(timerState).toHaveProperty('active');
      expect(timerState).toHaveProperty('started_at');
      expect(timerState).toHaveProperty('duration_ms');
      expect(timerState).toHaveProperty('remaining_ms');
      expect(timerState).toHaveProperty('triggering_play');
      
      expect(typeof timerState.active).toBe('boolean');
      expect(typeof timerState.started_at).toBe('string');
      expect(typeof timerState.duration_ms).toBe('number');
      expect(typeof timerState.remaining_ms).toBe('number');
    });
    
    it('should validate ISO timestamp format', () => {
      const timerState: AutoPassTimerState = {
        active: true,
        started_at: '2025-12-12T10:00:00.000Z',
        duration_ms: 10000,
        remaining_ms: 5000,
        triggering_play: {
          position: 1,
          cards: [{ id: 'AS', rank: 'A', suit: 'S' }],
          combo_type: 'Single',
        },
        player_id: 'player-1',
      };
      
      const timestamp = new Date(timerState.started_at);
      expect(timestamp.getTime()).toBeGreaterThan(0);
      expect(isNaN(timestamp.getTime())).toBe(false);
    });
  });
  
  describe('Integration with existing events', () => {
    it('should work alongside existing broadcast events', () => {
      const allEvents: BroadcastEvent[] = [
        'player_joined',
        'player_left',
        'player_ready',
        'game_started',
        'turn_changed',
        'cards_played',
        'player_passed',
        'game_ended',
        'reconnected',
        'auto_pass_timer_started',
        'auto_pass_timer_cancelled',
        'auto_pass_executed',
      ];
      
      expect(allEvents).toContain('auto_pass_timer_started');
      expect(allEvents).toContain('auto_pass_timer_cancelled');
      expect(allEvents).toContain('auto_pass_executed');
      expect(allEvents.length).toBe(12);
    });
  });
});
