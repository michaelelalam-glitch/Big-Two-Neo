
# Phase 4b Implementation Plan - Complete Multiplayer ELO System
**Date:** December 22, 2025  
**Project:** Big-Two-Neo Mobile  
**Branch:** dev  
**Agent:** Project Manager (BU1.2-Efficient)

---

## Executive Summary

This document outlines the implementation strategy for the remaining Phase 4b features:
1. **IP-based Region Detection** - Auto-detect user region from IP address
2. **Matchmaking Preferences UI** - Toggle between Casual/Ranked matchmaking modes
3. **Ranked Leaderboard** - Display top players by ELO rating (ranked matches only)
4. **Match History UI** - Show past matches with ELO changes, opponent details
5. **Spectator Mode** - Allow disconnected players to rejoin as read-only spectators
6. **HowToPlay Documentation** - Explain ELO system and reconnection mechanics (3 languages)

---

## 1. IP-Based Region Detection

### Goal
Automatically detect user's geographic region from IP address on profile creation.

### Implementation

#### A. Create Region Detection Util (`src/utils/regionDetector.ts`)
```typescript
export type Region = 'us-east' | 'us-west' | 'eu-west' | 'eu-central' | 'ap-south' | 'ap-southeast' | 'ap-northeast' | 'sa-east' | 'unknown';

interface IPAPIResponse {
  country_code: string;
  region_code: string;
  city: string;
  latitude: number;
  longitude: number;
}

const REGION_MAP: Record<string, Region> = {
  // North America
  'US-CA': 'us-west', 'US-OR': 'us-west', 'US-WA': 'us-west',
  'US-NY': 'us-east', 'US-FL': 'us-east', 'US-MA': 'us-east',
  
  // Europe
  'GB': 'eu-west', 'FR': 'eu-west', 'ES': 'eu-west',
  'DE': 'eu-central', 'PL': 'eu-central', 'AT': 'eu-central',
  
  // Asia-Pacific
  'IN': 'ap-south',
  'SG': 'ap-southeast', 'ID': 'ap-southeast', 'TH': 'ap-southeast',
  'JP': 'ap-northeast', 'KR': 'ap-northeast', 'CN': 'ap-northeast',
  
  // South America
  'BR': 'sa-east', 'AR': 'sa-east', 'CL': 'sa-east',
};

export async function detectRegion(): Promise<Region> {
  try {
    // Use ipapi.co free tier (1,500 requests/day, no API key required)
    const response = await fetch('https://ipapi.co/json/', {
      headers: { 'User-Agent': 'Big2Mobile/1.0' },
      timeout: 5000, // 5-second timeout
    });
    
    if (!response.ok) throw new Error('IP API failed');
    
    const data: IPAPIResponse = await response.json();
    const regionKey = `${data.country_code}-${data.region_code}`;
    
    // Try country-region combo first, then fallback to country only
    return REGION_MAP[regionKey] || REGION_MAP[data.country_code] || 'unknown';
  } catch (error) {
    console.error('[Region Detection] Failed:', error);
    return 'unknown'; // Default fallback
  }
}
```

#### B. Update Profile Creation (`src/services/profile.ts`)
```typescript
import { detectRegion } from '../utils/regionDetector';

export async function createProfile(userId: string, username: string) {
  const region = await detectRegion();
  
  const { error } = await supabase
    .from('profiles')
    .insert({
      id: userId,
      username,
      region, // Auto-detected
      elo_rating: 1000, // Default starting ELO
      rank: 'Silver', // calculate_rank_from_elo(1000) = 'Silver'
      matchmaking_preference: 'casual', // Default to casual
    });
    
  if (error) throw error;
}
```

#### C. Add Region Selector to Settings (`src/screens/SettingsScreen.tsx`)
Allow users to manually override auto-detected region.

---

## 2. Matchmaking Preferences UI

### Goal
Let users toggle between Casual (no ELO changes) and Ranked (ELO updates) matchmaking modes.

### Implementation

#### A. Update MatchmakingScreen (`src/screens/MatchmakingScreen.tsx`)
```typescript
// Add state for matchmaking preference
const [matchType, setMatchType] = useState<'casual' | 'ranked'>('casual');

// Add toggle UI before "Find Match" button
<View style={styles.matchTypeContainer}>
  <TouchableOpacity 
    style={[styles.matchTypeButton, matchType === 'casual' && styles.matchTypeActive]}
    onPress={() => setMatchType('casual')}
  >
    <Text style={styles.matchTypeText}>🎮 {i18n.t('matchmaking.casual')}</Text>
    <Text style={styles.matchTypeDesc}>{i18n.t('matchmaking.casualDesc')}</Text>
  </TouchableOpacity>
  
  <TouchableOpacity 
    style={[styles.matchTypeButton, matchType === 'ranked' && styles.matchTypeActive]}
    onPress={() => setMatchType('ranked')}
  >
    <Text style={styles.matchTypeText}>🏆 {i18n.t('matchmaking.ranked')}</Text>
    <Text style={styles.matchTypeDesc}>{i18n.t('matchmaking.rankedDesc')}</Text>
  </TouchableOpacity>
</View>

// Pass matchType to startMatchmaking
const handleFindMatch = async () => {
  await startMatchmaking(matchType); // Modified hook to accept match_type
};
```

#### B. Update useMatchmaking Hook (`src/hooks/useMatchmaking.ts`)
```typescript
export function useMatchmaking() {
  const [matchType, setMatchType] = useState<'casual' | 'ranked'>('casual');
  
  const startMatchmaking = async (type: 'casual' | 'ranked') => {
    setMatchType(type);
    
    // Insert into waiting_room with match_type
    const { error } = await supabase
      .from('waiting_room')
      .insert({
        user_id: user.id,
        username: profile.username,
        skill_rating: profile.elo_rating,
        region: profile.region,
        match_type: type, // NEW COLUMN NEEDED
      });
      
    // ... rest of logic
  };
}
```

#### C. Update Migration (`supabase/migrations/20251222000004_add_match_type_preference.sql`)
```sql
-- Add match_type column to waiting_room
ALTER TABLE waiting_room 
ADD COLUMN match_type VARCHAR DEFAULT 'casual' CHECK (match_type IN ('casual', 'ranked'));

CREATE INDEX idx_waiting_room_match_type ON waiting_room(match_type);

-- Update find_match() function to filter by match_type
-- (Modify existing function to include match_type matching)
```

#### D. Add i18n Translations
```typescript
// EN
matchmaking: {
  casual: 'Casual',
  casualDesc: 'For fun, no ELO changes',
  ranked: 'Ranked',
  rankedDesc: 'Competitive, ELO updates',
}

// AR
matchmaking: {
  casual: 'عادي',
  casualDesc: 'للمتعة، بدون تغيير التصنيف',
  ranked: 'تصنيف',
  rankedDesc: 'تنافسي، تحديثات التصنيف',
}

// DE
matchmaking: {
  casual: 'Casual',
  casualDesc: 'Zum Spaß, keine ELO-Änderungen',
  ranked: 'Ranked',
  rankedDesc: 'Wettbewerbsfähig, ELO-Updates',
}
```

---

## 3. Ranked Leaderboard View

### Goal
Display top players by ELO rating, filtered for ranked matches only.

### Implementation

#### A. Create RankedLeaderboardScreen (`src/screens/RankedLeaderboardScreen.tsx`)
```typescript
import { supabase } from '../services/supabase';
import { RankBadge } from '../components/RankBadge';

export function RankedLeaderboardScreen() {
  const [players, setPlayers] = useState<ProfileWithRank[]>([]);
  const [timeFilter, setTimeFilter] = useState<'all-time' | 'weekly' | 'daily'>('all-time');
  
  useEffect(() => {
    fetchRankedLeaderboard();
  }, [timeFilter]);
  
  const fetchRankedLeaderboard = async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, username, elo_rating, rank, ranked_matches_played, best_elo_rating')
      .gte('ranked_matches_played', 10) // Minimum 10 ranked matches
      .order('elo_rating', { ascending: false })
      .limit(100);
      
    if (data) setPlayers(data);
  };
  
  return (
    <FlatList
      data={players}
      keyExtractor={(item) => item.id}
      renderItem={({ item, index }) => (
        <View style={styles.leaderboardRow}>
          <Text style={styles.position}>#{index + 1}</Text>
          <RankBadge rank={item.rank} elo={item.elo_rating} size="small" showElo={false} />
          <Text style={styles.username}>{item.username}</Text>
          <Text style={styles.elo}>{item.elo_rating}</Text>
          <Text style={styles.matches}>{item.ranked_matches_played}M</Text>
        </View>
      )}
    />
  );
}
```

#### B. Add Navigation Route (`src/navigation/AppNavigator.tsx`)
```typescript
<Stack.Screen 
  name="RankedLeaderboard" 
  component={RankedLeaderboardScreen} 
  options={{ title: i18n.t('leaderboard.ranked') }} 
/>
```

#### C. Add Button to HomeScreen
```typescript
<TouchableOpacity onPress={() => navigation.navigate('RankedLeaderboard')}>
  <Text>🏆 {i18n.t('home.rankedLeaderboard')}</Text>
</TouchableOpacity>
```

---

## 4. Match History UI

### Goal
Show users their past matches with ELO changes, opponents, final positions.

### Implementation

#### A. Create MatchHistoryScreen (`src/screens/MatchHistoryScreen.tsx`)
```typescript
export function MatchHistoryScreen() {
  const [matches, setMatches] = useState<MatchWithParticipants[]>([]);
  const { user } = useAuth();
  
  useEffect(() => {
    fetchMatchHistory();
  }, []);
  
  const fetchMatchHistory = async () => {
    // Fetch matches from match_participants where user_id = current user
    const { data, error } = await supabase
      .from('match_participants')
      .select(`
        *,
        match_history!inner (
          room_code,
          match_type,
          started_at,
          ended_at,
          winner_username
        )
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50); // Paginate: show last 50 matches
      
    if (data) setMatches(data);
  };
  
  return (
    <FlatList
      data={matches}
      renderItem={({ item }) => (
        <View style={styles.matchCard}>
          <View style={styles.matchHeader}>
            <Text style={styles.roomCode}>{item.match_history.room_code}</Text>
            <Text style={styles.matchType}>
              {item.match_history.match_type === 'ranked' ? '🏆 Ranked' : '🎮 Casual'}
            </Text>
          </View>
          
          <View style={styles.matchBody}>
            <Text style={styles.position}>
              {item.final_position === 1 ? '🥇 1st Place' :
               item.final_position === 2 ? '🥈 2nd Place' :
               item.final_position === 3 ? '🥉 3rd Place' : '4th Place'}
            </Text>
            
            {item.match_history.match_type === 'ranked' && (
              <Text style={[
                styles.eloChange,
                item.elo_change > 0 ? styles.eloPositive : styles.eloNegative
              ]}>
                {item.elo_change > 0 ? '+' : ''}{item.elo_change} ELO
              </Text>
            )}
          </View>
          
          <Text style={styles.date}>
            {new Date(item.match_history.ended_at).toLocaleDateString()}
          </Text>
        </View>
      )}
    />
  );
}
```

#### B. Add Link from ProfileScreen
```typescript
<TouchableOpacity onPress={() => navigation.navigate('MatchHistory')}>
  <Text>📜 {i18n.t('profile.viewMatchHistory')}</Text>
</TouchableOpacity>
```

---

## 5. Spectator Mode

### Goal
Allow disconnected players to rejoin a match as read-only spectators.

### Implementation

#### A. Update reconnect_player Function (`supabase/migrations/20251222000005_add_spectator_mode.sql`)
```sql
-- Add spectator_mode column to room_players
ALTER TABLE room_players 
ADD COLUMN is_spectator BOOLEAN DEFAULT FALSE;

-- Modified reconnect_player function
CREATE OR REPLACE FUNCTION reconnect_player(
  p_room_id UUID,
  p_user_id UUID
) RETURNS JSONB AS $$
DECLARE
  v_player RECORD;
  v_room RECORD;
BEGIN
  -- Check if room is still active
  SELECT * INTO v_room FROM rooms WHERE id = p_room_id AND status IN ('waiting', 'playing');
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Room not found or ended');
  END IF;
  
  -- Check if player was in this room
  SELECT * INTO v_player FROM room_players 
  WHERE room_id = p_room_id AND user_id = p_user_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Player not in room');
  END IF;
  
  -- If game already started and player was disconnected, rejoin as spectator
  IF v_room.status = 'playing' AND v_player.connection_status = 'disconnected' THEN
    UPDATE room_players
    SET 
      is_spectator = TRUE,
      connection_status = 'connected',
      last_seen_at = NOW()
    WHERE id = v_player.id;
    
    RETURN jsonb_build_object('success', true, 'spectator_mode', true);
  END IF;
  
  -- Normal reconnection (restore player from bot)
  UPDATE room_players
  SET 
    is_bot = FALSE,
    connection_status = 'connected',
    last_seen_at = NOW(),
    disconnected_at = NULL
  WHERE id = v_player.id;
  
  RETURN jsonb_build_object('success', true, 'spectator_mode', false);
END;
$$ LANGUAGE plpgsql;
```

#### B. Update GameScreen to Handle Spectator Mode (`src/screens/GameScreen.tsx`)
```typescript
const [isSpectator, setIsSpectator] = useState(false);

useEffect(() => {
  // Check if current player is a spectator
  const currentPlayer = room_players.find(p => p.user_id === user.id);
  setIsSpectator(currentPlayer?.is_spectator || false);
}, [room_players]);

// Disable all controls if spectator
const canPlay = !isSpectator && currentPlayer === user.id;

// Show spectator banner
{isSpectator && (
  <View style={styles.spectatorBanner}>
    <Text style={styles.spectatorText}>
      👁️ {i18n.t('game.spectatorMode')}
    </Text>
  </View>
)}
```

---

## 6. HowToPlay Documentation

### Goal
Add comprehensive explanation of ELO system and reconnection mechanics in all 3 languages.

### Implementation

#### A. Update HowToPlayScreen (`src/screens/HowToPlayScreen.tsx`)

Add two new sections:

**Section: ELO Rating System**
```typescript
<Collapsible title={i18n.t('howToPlay.eloSystem')}>
  <Text>{i18n.t('howToPlay.eloSystemDesc')}</Text>
  <Text>{i18n.t('howToPlay.eloFormula')}</Text>
  <View style={styles.rankTiers}>
    <Text>🥉 Bronze: <1000</Text>
    <Text>🥈 Silver: 1000-1199</Text>
    <Text>🥇 Gold: 1200-1399</Text>
    <Text>💎 Platinum: 1400-1599</Text>
    <Text>💠 Diamond: 1600-1799</Text>
    <Text>👑 Master: 1800-1999</Text>
    <Text>🏆 Grandmaster: 2000+</Text>
  </View>
</Collapsible>
```

**Section: Reconnection & Disconnection**
```typescript
<Collapsible title={i18n.t('howToPlay.reconnection')}>
  <Text>{i18n.t('howToPlay.reconnectionDesc')}</Text>
  <Text>{i18n.t('howToPlay.disconnectGrace')}</Text>
  <Text>{i18n.t('howToPlay.botReplacement')}</Text>
  <Text>{i18n.t('howToPlay.spectatorMode')}</Text>
</Collapsible>
```

#### B. Add i18n Translations

**English (EN):**
```typescript
howToPlay: {
  eloSystem: 'ELO Rating System',
  eloSystemDesc: 'Your ELO rating measures your skill level. It increases when you win and decreases when you lose in ranked matches. Casual matches do not affect your ELO.',
  eloFormula: 'ELO changes are calculated using the chess rating formula with K-factor=32. Winning against higher-rated opponents gives more points.',
  reconnection: 'Reconnection & Disconnection',
  reconnectionDesc: 'If you lose connection during a match, you have 15 seconds to reconnect before a bot replaces you.',
  disconnectGrace: 'Grace Period: 15 seconds to resume your app and restore your position.',
  botReplacement: 'Bot Replacement: After 15 seconds, a bot with your current hand will play for you.',
  spectatorMode: 'Spectator Mode: If you reconnect after bot replacement, you can watch the match but cannot play.',
}
```

**Arabic (AR):**
```typescript
howToPlay: {
  eloSystem: 'نظام تصنيف ELO',
  eloSystemDesc: 'تصنيف ELO الخاص بك يقيس مستوى مهارتك. يزداد عندما تفوز ويقل عندما تخسر في المباريات المصنفة. المباريات العادية لا تؤثر على ELO الخاص بك.',
  eloFormula: 'يتم حساب تغييرات ELO باستخدام صيغة تصنيف الشطرنج مع عامل K = 32. الفوز ضد خصوم ذوي تصنيف أعلى يمنح المزيد من النقاط.',
  reconnection: 'إعادة الاتصال والانقطاع',
  reconnectionDesc: 'إذا فقدت الاتصال أثناء المباراة، لديك 15 ثانية لإعادة الاتصال قبل أن يحل بوت محلك.',
  disconnectGrace: 'فترة السماح: 15 ثانية لاستئناف التطبيق واستعادة موضعك.',
  botReplacement: 'استبدال البوت: بعد 15 ثانية، سيلعب بوت بأوراقك الحالية نيابة عنك.',
  spectatorMode: 'وضع المشاهدة: إذا أعدت الاتصال بعد استبدال البوت، يمكنك مشاهدة المباراة ولكن لا يمكنك اللعب.',
}
```

**German (DE):**
```typescript
howToPlay: {
  eloSystem: 'ELO-Bewertungssystem',
  eloSystemDesc: 'Ihre ELO-Bewertung misst Ihr Fähigkeitsniveau. Sie steigt, wenn Sie gewinnen, und sinkt, wenn Sie in gewerteten Spielen verlieren. Casual-Spiele beeinflussen Ihre ELO nicht.',
  eloFormula: 'ELO-Änderungen werden mit der Schachbewertungsformel mit K-Faktor=32 berechnet. Gewinnen gegen höher bewertete Gegner gibt mehr Punkte.',
  reconnection: 'Wiederverbindung & Trennung',
  reconnectionDesc: 'Wenn Sie während eines Spiels die Verbindung verlieren, haben Sie 15 Sekunden Zeit, um sich wieder zu verbinden, bevor ein Bot Sie ersetzt.',
  disconnectGrace: 'Kulanzfrist: 15 Sekunden, um Ihre App fortzusetzen und Ihre Position wiederherzustellen.',
  botReplacement: 'Bot-Ersatz: Nach 15 Sekunden spielt ein Bot mit Ihren aktuellen Karten für Sie.',
  spectatorMode: 'Zuschauermodus: Wenn Sie sich nach dem Bot-Ersatz wieder verbinden, können Sie das Spiel ansehen, aber nicht spielen.',
}
```

---

## Implementation Order

**Priority 1 (Critical for Core Multiplayer):**
1. Fix CICD ✅ (DONE)
2. Matchmaking Preferences UI (Casual/Ranked toggle)
3. Match History UI (users need to see their progress)
4. HowToPlay Documentation (user education)

**Priority 2 (Enhancement):**
5. IP-Based Region Detection (improves matchmaking quality)
6. Ranked Leaderboard (competitive motivation)

**Priority 3 (Advanced Feature):**
7. Spectator Mode (nice-to-have, complex implementation)

---

## Testing Plan

**Manual Testing:**
1. Test matchmaking with both Casual and Ranked modes
2. Verify ELO updates only occur in Ranked matches
3. Check match history displays correctly
4. Test region detection on WiFi and cellular
5. Verify HowToPlay translations render correctly in all 3 languages

**Integration Testing:**
- Test reconnection flow: disconnect → wait 15s → reconnect → check spectator mode
- Test match completion → verify match_history record created
- Test leaderboard pagination (100+ users)

---

## Estimated LOC

- Region Detection: ~100 lines
- Matchmaking Preferences: ~200 lines (UI + hook + migration)
- Ranked Leaderboard: ~250 lines (screen + navigation)
- Match History UI: ~300 lines (screen + queries)
- Spectator Mode: ~150 lines (migration + GameScreen updates)
- HowToPlay: ~100 lines (translations)
- **Total: ~1,100 lines**

---

## Dependencies

**New NPM Packages:** None (using native fetch for ipapi.co)

**New Supabase Tables:** None (reusing existing: match_history, match_participants)

**New Supabase Functions:** 
- Modified: `reconnect_player` (add spectator logic)
- Modified: `find_match` (add match_type filter)

---

## Commit Strategy

**Commit 1:** Region detection + matchmaking preferences  
**Commit 2:** Ranked leaderboard + match history UI  
**Commit 3:** Spectator mode + HowToPlay documentation  
**Commit 4:** i18n translations for all new features  
**Commit 5:** Integration testing + bug fixes  

---

**Document End**
