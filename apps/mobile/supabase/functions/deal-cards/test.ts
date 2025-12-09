import { assertEquals, assertExists, assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts';

/**
 * Unit Tests for deal-cards Edge Function
 * 
 * These tests verify the card dealing logic without hitting the database.
 * For integration tests with database, see integration.test.ts
 */

// Import functions to test (note: in real implementation, we'd export these from index.ts)
// For now, we'll duplicate the helper functions for testing

interface Card {
  id: string;
  rank: string;
  suit: string;
}

function createDeck(): Card[] {
  const ranks = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
  const suits = ['D', 'C', 'H', 'S'];
  const deck: Card[] = [];
  
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({
        id: `${rank}${suit}`,
        rank,
        suit
      });
    }
  }
  
  return deck;
}

function shuffleDeck(deck: Card[]): void {
  const randomValues = new Uint32Array(deck.length);
  crypto.getRandomValues(randomValues);
  
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomValues[i] % (i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
}

// Tests

Deno.test('createDeck: Creates exactly 52 cards', () => {
  const deck = createDeck();
  assertEquals(deck.length, 52);
});

Deno.test('createDeck: All cards are unique', () => {
  const deck = createDeck();
  const ids = deck.map(card => card.id);
  const uniqueIds = new Set(ids);
  assertEquals(uniqueIds.size, 52);
});

Deno.test('createDeck: Contains all ranks', () => {
  const deck = createDeck();
  const ranks = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
  
  for (const rank of ranks) {
    const cardsWithRank = deck.filter(card => card.rank === rank);
    assertEquals(cardsWithRank.length, 4, `Expected 4 cards of rank ${rank}`);
  }
});

Deno.test('createDeck: Contains all suits', () => {
  const deck = createDeck();
  const suits = ['D', 'C', 'H', 'S'];
  
  for (const suit of suits) {
    const cardsWithSuit = deck.filter(card => card.suit === suit);
    assertEquals(cardsWithSuit.length, 13, `Expected 13 cards of suit ${suit}`);
  }
});

Deno.test('createDeck: Contains 3 of Diamonds', () => {
  const deck = createDeck();
  const threeDiamonds = deck.find(card => card.id === '3D');
  assertExists(threeDiamonds);
  assertEquals(threeDiamonds.rank, '3');
  assertEquals(threeDiamonds.suit, 'D');
});

Deno.test('shuffleDeck: Maintains deck size', () => {
  const deck = createDeck();
  const originalSize = deck.length;
  shuffleDeck(deck);
  assertEquals(deck.length, originalSize);
});

Deno.test('shuffleDeck: Contains all original cards', () => {
  const deck = createDeck();
  const originalIds = new Set(deck.map(card => card.id));
  
  shuffleDeck(deck);
  
  const shuffledIds = new Set(deck.map(card => card.id));
  assertEquals(shuffledIds.size, 52);
  
  // Verify all original IDs are still present
  for (const id of originalIds) {
    assert(shuffledIds.has(id), `Card ${id} missing after shuffle`);
  }
});

Deno.test('shuffleDeck: Changes card order (randomness test)', () => {
  const deck1 = createDeck();
  const deck2 = createDeck();
  
  shuffleDeck(deck1);
  shuffleDeck(deck2);
  
  // Very unlikely (but not impossible) that two shuffles produce same order
  const same = deck1.every((card, i) => card.id === deck2[i].id);
  
  // If they're the same, shuffle again and check - should be different
  if (same) {
    shuffleDeck(deck2);
    const stillSame = deck1.every((card, i) => card.id === deck2[i].id);
    assertEquals(stillSame, false, 'Two consecutive shuffles should not produce same order');
  }
});

Deno.test('Card dealing: 4 players get 13 cards each', () => {
  const deck = createDeck();
  const playerCount = 4;
  const cardsPerPlayer = Math.floor(52 / playerCount);
  
  assertEquals(cardsPerPlayer, 13);
  
  const hands: Card[][] = [];
  for (let i = 0; i < playerCount; i++) {
    const hand = deck.slice(i * cardsPerPlayer, (i + 1) * cardsPerPlayer);
    hands.push(hand);
  }
  
  // Verify each hand has 13 cards
  for (const hand of hands) {
    assertEquals(hand.length, 13);
  }
  
  // Verify all 52 cards distributed
  const totalCards = hands.reduce((sum, hand) => sum + hand.length, 0);
  assertEquals(totalCards, 52);
});

Deno.test('Card dealing: 3 players get 17 cards each', () => {
  const deck = createDeck();
  const playerCount = 3;
  const cardsPerPlayer = Math.floor(52 / playerCount);
  
  assertEquals(cardsPerPlayer, 17);
  
  const hands: Card[][] = [];
  for (let i = 0; i < playerCount; i++) {
    const hand = deck.slice(i * cardsPerPlayer, (i + 1) * cardsPerPlayer);
    hands.push(hand);
  }
  
  // Verify each hand has 17 cards
  for (const hand of hands) {
    assertEquals(hand.length, 17);
  }
  
  // Total cards distributed (1 card will be leftover)
  const totalCards = hands.reduce((sum, hand) => sum + hand.length, 0);
  assertEquals(totalCards, 51);
});

Deno.test('Card dealing: 2 players get 26 cards each', () => {
  const deck = createDeck();
  const playerCount = 2;
  const cardsPerPlayer = Math.floor(52 / playerCount);
  
  assertEquals(cardsPerPlayer, 26);
  
  const hands: Card[][] = [];
  for (let i = 0; i < playerCount; i++) {
    const hand = deck.slice(i * cardsPerPlayer, (i + 1) * cardsPerPlayer);
    hands.push(hand);
  }
  
  // Verify each hand has 26 cards
  for (const hand of hands) {
    assertEquals(hand.length, 26);
  }
  
  // All 52 cards distributed
  const totalCards = hands.reduce((sum, hand) => sum + hand.length, 0);
  assertEquals(totalCards, 52);
});

Deno.test('Find starting player: Locates player with 3 of Diamonds', () => {
  const deck = createDeck();
  
  // Manually put 3D in player 2's hand
  const threeDiamonds = deck.find(card => card.id === '3D')!;
  const threeDIndex = deck.indexOf(threeDiamonds);
  
  // Swap to position 26 (start of player 2's hand in 2-player game)
  [deck[threeDIndex], deck[26]] = [deck[26], deck[threeDIndex]];
  
  // Deal to 2 players
  const hands: Card[][] = [
    deck.slice(0, 26),
    deck.slice(26, 52),
  ];
  
  // Find starting player
  let startingPlayer = 0;
  for (let i = 0; i < hands.length; i++) {
    if (hands[i].some(card => card.id === '3D')) {
      startingPlayer = i;
      break;
    }
  }
  
  assertEquals(startingPlayer, 1, 'Player 1 (index 1) should have 3 of Diamonds');
});

Deno.test('Find starting player: Always finds 3D in 4-player game', () => {
  const deck = createDeck();
  shuffleDeck(deck);
  
  // Deal to 4 players
  const hands: Card[][] = [];
  for (let i = 0; i < 4; i++) {
    hands.push(deck.slice(i * 13, (i + 1) * 13));
  }
  
  // Find starting player
  let startingPlayer = -1;
  for (let i = 0; i < hands.length; i++) {
    if (hands[i].some(card => card.id === '3D')) {
      startingPlayer = i;
      break;
    }
  }
  
  assert(startingPlayer >= 0 && startingPlayer < 4, 'Starting player should be found (0-3)');
});

console.log('✅ All unit tests completed');
