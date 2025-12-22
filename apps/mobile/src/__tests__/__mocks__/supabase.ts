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
  auth: {
    getSession: jest.fn(() => Promise.resolve({ data: { session: null }, error: null })),
    signInWithOAuth: jest.fn(() => Promise.resolve({ data: null, error: null })),
    signOut: jest.fn(() => Promise.resolve({ error: null })),
  },
  channel: jest.fn(() => ({
    on: jest.fn(() => ({
      subscribe: jest.fn(),
    })),
    subscribe: jest.fn(),
    unsubscribe: jest.fn(),
  })),
  removeChannel: jest.fn(),
};

export const supabase = mockSupabaseClient;
export default mockSupabaseClient;
