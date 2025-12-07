# Integration Tests for Big2 Mobile App

## Username Uniqueness Integration Tests

Location: `src/__tests__/integration/username-uniqueness.integration.test.ts`

### Overview
Tests the `join_room_atomic` RPC function and global username uniqueness constraints against a real Supabase database.

### Prerequisites

1. **Supabase Test Environment**
   - Create a separate Supabase project for testing (recommended)
   - Or use a dedicated test schema in your development database
   - Apply all migrations, especially `20251206000002_fix_global_username_uniqueness.sql`

2. **Environment Variables**
   - Copy `.env.example` to `.env.test`
   - Set `EXPO_PUBLIC_SUPABASE_URL` to your test database URL
   - Set `EXPO_PUBLIC_SUPABASE_ANON_KEY` to your test anon key

3. **Test User Accounts**
   - Integration tests create temporary test users
   - Cleanup is automatic after each test

### Running Integration Tests

```bash
# Run all integration tests
npm run test:integration

# Run with verbose output
npm run test:integration -- --verbose

# Run specific test file
npm run test:integration -- username-uniqueness

# Run with coverage
npm run test:integration -- --coverage
```

### Test Scenarios Covered

#### ✅ Scenario 1: Two users in same room with same username
- **Expected**: First user succeeds, second user gets error
- **Tests**: Atomic join prevents duplicates

#### ✅ Scenario 2: Same username in different rooms
- **Expected**: Both fail (global uniqueness enforced)
- **Design Decision**: One username per user across entire app

#### ⚠️ Scenario 3: Bot names can duplicate
- **Current Behavior**: Bots are subject to global uniqueness
- **Note**: If bots need duplicate names, special handling required

#### ✅ Scenario 4: Case insensitive validation
- **Expected**: "Player1", "player1", "PLAYER1" are all treated as same username
- **Implementation**: `LOWER(username)` index in database

#### ✅ Scenario 5: Auto-generated usernames
- **Pattern**: `Player_{user_id_prefix}`
- **Behavior**: Users can change from auto-generated to custom username

#### ✅ Scenario 6: Race condition prevention
- **Expected**: Concurrent joins with same username handled gracefully
- **Implementation**: `FOR UPDATE` locks in `join_room_atomic`

### Test Database Setup

#### Option A: Separate Test Project (Recommended)

```bash
# 1. Create new Supabase project named "big2-mobile-test"
# 2. Apply migrations
cd apps/mobile/supabase/migrations
# Upload migrations to test project via Supabase Dashboard

# 3. Update .env.test with test project credentials
```

#### Option B: Test Schema in Dev Database

```sql
-- Create test schema
CREATE SCHEMA IF NOT EXISTS test;

-- Copy tables to test schema
CREATE TABLE test.rooms (LIKE public.rooms INCLUDING ALL);
CREATE TABLE test.room_players (LIKE public.room_players INCLUDING ALL);

-- Copy functions to test schema
-- (Manually copy join_room_atomic and related functions)
```

### Cleanup Strategy

Tests automatically clean up after themselves:
- Delete test `room_players` entries using RPC function
- Test `rooms` (e.g., TSTAA1, TSTAA2) are permanent fixtures and are never deleted
- Use unique test identifiers to avoid conflicts

### Known Limitations

1. **Bot Username Handling**: Current implementation enforces global uniqueness for all users including bots. If bots need duplicate names, consider:
   - Special bot user_id prefix (e.g., `bot_*`)
   - Exclude bot user_ids from uniqueness constraint
   - Or use bot-specific username patterns

2. **Profile Screen Testing**: Scenario 5 (after signup flow) requires ProfileScreen implementation, which is not yet complete.

3. **True E2E Testing**: These are integration tests that call RPC functions directly. For full UI-driven E2E tests, consider:
   - **Detox**: Most popular for React Native, requires native builds
   - **Maestro**: Simpler setup, cloud-based testing
   - **Appium**: Cross-platform but complex setup

### Troubleshooting

#### Tests fail with "Cannot read properties of undefined"
- Ensure Supabase credentials are set in `.env.test`
- Verify migrations are applied to test database

#### Tests fail with "Permission denied"
- Check RLS policies allow test operations
- Ensure anon key has necessary permissions

#### Cleanup doesn't work
- Manually clear test data: `DELETE FROM room_players WHERE user_id LIKE 'test-user-%'`
- Check foreign key constraints

### Next Steps

1. ✅ Write integration tests (COMPLETE)
2. 🔜 Run tests against test Supabase instance
3. 🔜 Add tests to CI/CD pipeline
4. 🔜 Consider adding Detox/Maestro for full E2E tests
5. 🔜 Implement ProfileScreen and add signup flow tests

### Contributing

When adding new username-related features:
1. Add corresponding integration test
2. Update this README with new scenarios
3. Ensure cleanup logic handles new test data
