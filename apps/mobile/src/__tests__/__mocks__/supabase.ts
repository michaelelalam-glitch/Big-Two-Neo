/**
 * Mock for Supabase client
 * Prevents "supabaseUrl is required" errors in tests
 */

const mockSupabaseClient = {
  from: jest.fn(() => ({
    select: jest.fn(() => ({
      eq: jest.fn(() => ({
        single: jest.fn(() => Promise.resolve({ data: null, error: null })),
        data: [],
        error: null,
      })),
      data: [],
      error: null,
    })),
    insert: jest.fn(() => Promise.resolve({ data: null, error: null })),
    update: jest.fn(() => ({
      eq: jest.fn(() => Promise.resolve({ data: null, error: null })),
    })),
    delete: jest.fn(() => ({
      eq: jest.fn(() => Promise.resolve({ data: null, error: null })),
    })),
    rpc: jest.fn(() => Promise.resolve({ data: null, error: null })),
  })),
  rpc: jest.fn(() => ({
    single: jest.fn(() => Promise.resolve({ data: null, error: null })),
  })),
  auth: {
    getSession: jest.fn(() => Promise.resolve({ data: { session: null }, error: null })),
    getUser: jest.fn(() => Promise.resolve({ data: { user: null }, error: null })),
    signInWithOAuth: jest.fn(() => Promise.resolve({ data: null, error: null })),
    signOut: jest.fn(() => Promise.resolve({ error: null })),
    onAuthStateChange: jest.fn(() => ({
      data: { subscription: { unsubscribe: jest.fn() } },
    })),
  },
  functions: {
    invoke: jest.fn(() => Promise.resolve({ data: null, error: null })),
  },
  channel: jest.fn(() => ({
    on: jest.fn(() => ({
      subscribe: jest.fn(),
    })),
    subscribe: jest.fn(),
    unsubscribe: jest.fn(),
  })),
  getChannels: jest.fn(() => []),
  removeChannel: jest.fn().mockResolvedValue('ok'),
  removeAllChannels: jest.fn().mockResolvedValue([]),
};

export const supabase = mockSupabaseClient;
export default mockSupabaseClient;
