# Push Notification Backend Integration

This document explains how to integrate push notifications into the Big2 multiplayer game server.

## Architecture

```
Client App (Mobile)
    ↓ registers push token
Supabase Database (push_tokens table)
    ↓ fetches tokens
Edge Function (send-push-notification)
    ↓ sends to
Expo Push Service
    ↓ delivers to
Device (iOS/Android)
```

## Files Created

1. **Supabase Edge Function**: `apps/mobile/supabase/functions/send-push-notification/index.ts`
   - Fetches push tokens from database
   - Sends notifications via Expo Push API
   - Handles platform-specific settings (Android channels, badges)

2. **Notification Service**: `apps/mobile/src/services/pushNotificationService.ts`
   - Helper functions for common game events
   - `notifyGameInvite()`, `notifyYourTurn()`, `notifyGameStarted()`, etc.

## Setup Instructions

### 1. Deploy Edge Function

```bash
cd apps/mobile

# Login to Supabase
npx supabase login

# Link to your project
npx supabase link --project-ref dppybucldqufbqhwnkxu

# Deploy the edge function
npx supabase functions deploy send-push-notification
```

### 2. Use Notification Service in Your Code

Import the service in your React Native components:

```typescript
import { notifyGameInvite, notifyYourTurn, notifyGameStarted } from '../services/pushNotificationService';
```

### 3. Set Environment Variables

Make sure your `.env` file has:

```env
EXPO_PUBLIC_SUPABASE_URL=https://dppybucldqufbqhwnkxu.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

## Integration Examples

### Example 1: Notify When Game Starts

```typescript
import { notifyGameStarted } from '@big2/notification-service';

async function startGame(roomCode: string, playerIds: string[]) {
  // ... game start logic ...
  
  // Send notifications to all players
  await notifyGameStarted(playerIds, roomCode);
  
  console.log(`Game started! Notified ${playerIds.length} players`);
}
```

### Example 2: Notify Player Turn

```typescript
### Example 1: Notify When Game Starts

```typescript
import { notifyGameStarted } from '../services/pushNotificationService';

async function startGame(roomCode: string, playerIds: string[]) {
  // ... game start logic ...
  
  // Send notifications to all players (don't await - run async)
  notifyGameStarted(playerIds, roomCode).catch(console.error);
  
  console.log(`Game started! Notified ${playerIds.length} players`);
}
```

### Example 2: Notify Player Turn

```typescript
import { notifyYourTurn } from '../services/pushNotificationService';

async function nextTurn(roomCode: string, currentPlayerId: string, nextPlayerId: string) {
  // ... switch turn logic ...
  
  // Notify the next player (don't await - run async)
  notifyYourTurn(
    nextPlayerId,
    roomCode,
    `${currentPlayerName} just played. Your turn!`
  ).catch(console.error);
}
```

### Example 3: Room Invite

```typescript
import { notifyGameInvite } from '../services/pushNotificationService';

async function inviteToRoom(roomCode: string, inviterUserId: string, invitedUserIds: string[]) {
  // Get inviter's username from database
  const inviter = await getUser(inviterUserId);
  
  // Send invite notifications (don't await - run async)
  notifyGameInvite(
    invitedUserIds,
    roomCode,
    inviter.username
  ).catch(console.error);
}
``` 
    // If room is now full, start game and notify everyone
    if (room.players.length === 4) {
      const playerIds = room.players.map(p => p.userId);
      await notifyGameStarted(playerIds, roomCode);
      
      io.to(roomCode).emit('game-start', room);
    }
  });
  
  // When a player makes a move
  socket.on('play-cards', async (data) => {
    const { roomCode, userId, cards } = data;
    
    // Process the move
    const gameState = processMove(roomCode, userId, cards);
    
    // Broadcast to all players in room
    io.to(roomCode).emit('game-update', gameState);
    
    // Notify the next player specifically
    if (gameState.currentTurn !== userId) {
      await notifyYourTurn(
        gameState.currentTurn,
        roomCode,
        'Your turn to play!'
      );
    }
  });
});
```

### Example 5: Direct Edge Function Call (Alternative)

If you don't want to use the helper service, call the edge function directly:

```typescript
async function sendCustomNotification(userIds: string[], title: string, body: string) {
  const response = await fetch(
    'https://dppybucldqufbqhwnkxu.supabase.co/functions/v1/send-push-notification',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
        'apikey': process.env.SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        user_ids: userIds,
        title: title,
        body: body,
        data: {
          type: 'game_invite',
          roomCode: 'ABC123',
        },
      }),
    }
  );
  
  return response.json();
}
```

## Notification Types

The system supports four notification types with deep linking:

| Type | Navigates To | Use Case |
|------|-------------|----------|
| `game_invite` | Lobby screen | Player invited to join a room |
| `your_turn` | Game screen | It's the player's turn to play |
| `game_started` | Game screen | Game has started, all players ready |
| `friend_request` | Profile screen | Someone sent a friend request |

## Testing

### Test Edge Function Directly

```bash
curl -X POST \
  https://dppybucldqufbqhwnkxu.supabase.co/functions/v1/send-push-notification \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -d '{
    "user_ids": ["user-uuid-here"],
    "title": "Test Notification",
    "body": "This is a test",
    "data": {
      "type": "game_invite",
      "roomCode": "TEST123"
    }
  }'
```

### Test from Mobile App

The mobile app includes a "Test Notification" button in the Notification Settings screen that sends a local notification after 2 seconds.

## Best Practices

1. **Don't Block Game Logic**: Send notifications asynchronously
   ```typescript
   // ✅ Good - don't await
   notifyYourTurn(nextPlayerId, roomCode).catch(console.error);
   
   // ❌ Bad - blocks game flow
   await notifyYourTurn(nextPlayerId, roomCode);
   ```

2. **Handle Errors Gracefully**: Notifications should never crash your server
   ```typescript
   try {
     await notifyGameStarted(playerIds, roomCode);
   } catch (error) {
     console.error('Notification failed:', error);
     // Game continues regardless
   }
   ```

3. **Check User Preferences**: Before sending, verify user wants notifications
   ```typescript
   if (user.notificationSettings?.gameInvites) {
     await notifyGameInvite([user.id], roomCode, inviterName);
   }
   ```

4. **Rate Limiting**: Don't spam users with too many notifications
   ```typescript
   const lastNotification = await getLastNotificationTime(userId);
   if (Date.now() - lastNotification > 5000) { // 5 second cooldown
     await notifyYourTurn(userId, roomCode);
   }
   ```

## Monitoring

Check Edge Function logs:
```bash
npx supabase functions logs send-push-notification --follow
```

Check mobile app for registration status:
- Open app → Settings → Notifications
- View debug panel showing push token and user ID

## Troubleshooting

| Issue | Solution |
|-------|----------|
| No tokens found | User hasn't logged in on mobile app yet |
| Edge function 401 error | Check SUPABASE_ANON_KEY is correct |
| Notifications not appearing | Verify user granted permissions on mobile |
| Wrong screen opens | Check `data.type` matches notification type |
| Android not working | Verify notification channels are configured |

## Next Steps

1. ✅ Deploy edge function to Supabase
2. ✅ Set environment variables
3. ⏳ Integrate notification calls in your game server
4. ⏳ Test on physical devices (iOS + Android)
5. ⏳ Set up Firebase (Android) and APNs (iOS) credentials for production

## Production Requirements

Before going live:
- [ ] Configure Firebase Cloud Messaging (FCM) for Android
- [ ] Set up Apple Push Notification service (APNs) for iOS
- [ ] Add proper error tracking (Sentry, LogRocket, etc.)
- [ ] Implement user notification preferences in database
- [ ] Add notification delivery receipts tracking
- [ ] Set up monitoring/alerting for edge function failures
