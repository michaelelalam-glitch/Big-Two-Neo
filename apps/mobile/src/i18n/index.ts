/**
 * i18n System
 * 
 * Provides internationalization support for the Big2 Mobile app.
 * Supports: English (EN), Arabic (AR), German (DE)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { I18nManager as RNI18nManager } from 'react-native';

// Storage key
const LANGUAGE_KEY = '@big2_language';

// Supported languages
export type Language = 'en' | 'ar' | 'de';

export const LANGUAGES: Record<Language, { name: string; nativeName: string; rtl: boolean }> = {
  en: { name: 'English', nativeName: 'English', rtl: false },
  ar: { name: 'Arabic', nativeName: 'العربية', rtl: true },
  de: { name: 'German', nativeName: 'Deutsch', rtl: false },
};

// Translation type structure
export interface Translations {
  // Common
  common: {
    ok: string;
    cancel: string;
    save: string;
    delete: string;
    confirm: string;
    back: string;
    close: string;
    yes: string;
    no: string;
    on: string;
    off: string;
    loading: string;
    error: string;
    success: string;
    info: string;
    timeout: string;
    you: string;
    bot: string;
    current: string;
    allTime: string;
    weekly: string;
    daily: string;
    comingSoon: string;
  };
  
  // Settings Screen
  settings: {
    title: string;
    profileSettings: string;
    gameSettings: string;
    notificationSettings: string;
    audioHaptics: string;
    language: string;
    account: string;
    about: string;
    
    // Profile
    editProfile: string;
    username: string;
    avatar: string;
    privacy: string;
    privacyDescription: string;
    profileVisibility: string;
    showOnlineStatus: string;
    
    // Game Settings
    cardSortOrder: string;
    cardSortOrderDescription: string;
    sortBySuit: string;
    sortByRank: string;
    animationSpeed: string;
    animationSpeedDescription: string;
    slow: string;
    normal: string;
    fast: string;
    autoPassTimer: string;
    autoPassTimerDescription: string;
    disabled: string;
    
    // Notifications
    pushNotifications: string;
    pushNotificationsDescription: string;
    enableNotifications: string;
    notificationTypes: string;
    
    // Audio & Haptics
    soundEffects: string;
    soundEffectsDescription: string;
    music: string;
    musicDescription: string;
    vibration: string;
    vibrationDescription: string;
    volume: string;
    
    // Language
    selectLanguage: string;
    languageDescription: string;
    changeLanguageWarning: string;
    restartRequired: string;
    languageChangedSuccess: string;
    
    // Account
    accountManagement: string;
    clearCache: string;
    clearCacheDescription: string;
    clearCacheConfirm: string;
    clearCacheSuccess: string;
    deleteAccount: string;
    deleteAccountDescription: string;
    deleteAccountWarning: string;
    deleteAccountConfirm: string;
    noUserLoggedIn: string;
    deleteAccountFailed: string;
    accountDeletedSuccess: string;
    profileComingSoonDescription: string;
    autoPassTimerBanner: string;
    
    // About
    version: string;
    termsOfService: string;
    privacyPolicy: string;
    support: string;
  };
  
  // Home Screen
  home: {
    title: string;
    welcome: string;
    quickPlay: string;
    quickPlayDescription: string;
    createRoom: string;
    createRoomDescription: string;
    joinRoom: string;
    joinRoomDescription: string;
    howToPlay: string;
    howToPlayDescription: string;
    leaderboard: string;
    profile: string;
    currentRoom: string;
    leave: string;
    leftRoom: string;
    leaveRoomConfirm: string;
  };

  // How to Play Screen
  howToPlay: {
    title: string;
    objectiveTitle: string;
    objectiveText: string;
    cardRankingsTitle: string;
    rankOrderLabel: string;
    rankOrder: string;
    suitOrderLabel: string;
    suitOrder: string;
    cardNote: string;
    validCombinationsTitle: string;
    single: string;
    pair: string;
    triple: string;
    straight: string;
    flush: string;
    fullHouse: string;
    fourOfAKind: string;
    straightFlush: string;
    // Optional separate label/text properties for non-English languages
    singleLabel?: string;
    singleText?: string;
    pairLabel?: string;
    pairText?: string;
    tripleLabel?: string;
    tripleText?: string;
    fiveCardCombosLabel?: string;
    straightLabel?: string;
    straightText?: string;
    flushLabel?: string;
    flushText?: string;
    fullHouseLabel?: string;
    fullHouseText?: string;
    fourOfAKindLabel?: string;
    fourOfAKindText?: string;
    straightFlushLabel?: string;
    straightFlushText?: string;
    gameplayTitle: string;
    startingGame: string;
    playingCards: string;
    passing: string;
    leading: string;
    winning: string;
    // Optional gameplay points for non-English languages
    gameplayPoint1?: string;
    gameplayPoint2?: string;
    gameplayPoint3?: string;
    gameplayPoint4?: string;
    gameplayPoint5?: string;
    specialRulesTitle: string;
    autoPassTimer: string;
    oneCardLeft: string;
    fiveCardCombos: string;
    // Optional special rules for non-English languages
    specialRule1?: string;
    specialRule2?: string;
    specialRule3?: string;
    scoringTitle: string;
    scoringIntro: string;
    scoring1to4: string;
    scoring5to9: string;
    scoring10to13: string;
    // Optional scoring variants for non-English languages
    scoring1to7?: string;
    scoring8to10?: string;
    scoring11to12?: string;
    scoringWarning: string;
    letsPlay: string;
    // ELO Rating System (Phase 4b)
    eloSystemTitle: string;
    eloSystemDesc: string;
    eloFormula: string;
    rankTiersTitle: string;
    // Reconnection & Disconnection (Phase 4b)
    reconnectionTitle: string;
    reconnectionDesc: string;
    disconnectGrace: string;
    botReplacement: string;
    spectatorMode: string;
  };
  
  // Game Screen
  game: {
    yourTurn: string;
    waiting: string;
    pass: string;
    play: string;
    hint: string;
    smart: string;
    sort: string;
    lastPlayedBy: string;
    noCardsYet: string;
    cardsLeft: string;
    combo: string;
    winner: string;
    gameOver: string;
    playAgain: string;
    backToHome: string;
    selectCards: string;
    cannotBeat: string;
    invalidCombo: string;
    mustPlayHigher: string;
    autoPassTimer: string;
    secondsRemaining: string;
    settings: string;
    leaveGame: string;
    leaveGameConfirm: string;
    leaveGameMessage: string;
    stay: string;
  };
  
  // Game End Modal
  gameEnd: {
    gameWinner: string;
    finalStandings: string;
    scoreHistory: string;
    playHistory: string;
    shareResults: string;
    playAgain: string;
    returnToMenu: string;
    loadingResults: string;
    noScoreHistory: string;
    scoresWillAppear: string;
    noPlayHistory: string;
    playsWillAppear: string;
    match: string;
    hand: string;
    hands: string;
    points: string;
    latest: string;
    matchByMatch: string;
    cardPlayHistory: string;
    tapToExpand: string;
    playAgainTitle: string;
    playAgainMessage: string;
    newGame: string;
    returnToMenuTitle: string;
    returnToMenuMessage: string;
    leaveGame: string;
    shareError: string;
    shareErrorMessage: string;
    restartError: string;
    restartErrorMessage: string;
    leaveError: string;
    leaveErrorMessage: string;
    matchesPlayed: string;
    oneMatch: string;
  };
  
  // Lobby Screen
  lobby: {
    title: string;
    roomCode: string;
    waitingForPlayers: string;
    players: string;
    ready: string;
    notReady: string;
    startGame: string;
    leaveRoom: string;
    copyCode: string;
    codeCopied: string;
    minPlayers: string;
    inviteFriends: string;
    emptySlot: string;
    you: string;
    readyUp: string;
    starting: string;
    startWithBots: string;
    hostInfo: string;
    waitingForHost: string;
    onlyHostCanStart: string;
    playerDataNotFound: string;
    createPlayerError: string;
    loadPlayersError: string;
    readyStatusError: string;
    leaveRoomError: string;
    startGameError: string;
  };
  
  // Create/Join Room Screens
  room: {
    createTitle: string;
    joinTitle: string;
    enterCode: string;
    createButton: string;
    joinButton: string;
    invalidCode: string;
    roomFull: string;
    roomNotFound: string;
    alreadyInRoom: string;
    createSubtitle: string;
    joinSubtitle: string;
    shareableCode: string;
    upTo4Players: string;
    fillWithBots: string;
    customizeSettings: string;
    mustBeSignedIn: string;
    alreadyInRoomMessage: string;
    goToRoom: string;
    leaveAndCreate: string;
    leaveRoomError: string;
    leaveTimeout: string;
    createRoomError: string;
    invalidCodeTitle: string;
    alreadyInDifferentRoom: string;
    goToCurrentRoom: string;
    alreadyInAnotherRoom: string;
    joinRoomError: string;
    tip: string;
    askFriendForCode: string;
  };
  
  // Profile Screen
  profile: {
    title: string;
    stats: string;
    gamesPlayed: string;
    gamesWon: string;
    gamesLost: string;
    winRate: string;
    bestStreak: string;
    totalScore: string;
    rank: string;
    editProfile: string;
    signOut: string;
    rankPoints: string;
    currentStreak: string;
    noStatsYet: string;
    playFirstGame: string;
    accountInfo: string;
    email: string;
    notProvided: string;
    userId: string;
    username: string;
    fullName: string;
    provider: string;
    sessionDetails: string;
    lastSignIn: string;
    createdAt: string;
    emailConfirmed: string;
    signOutConfirm: string;
    signOutError: string;
    overview: string;
    streaks: string;
    losses: string;
    wins: string;
    performance: string;
    totalPoints: string;
    avgPosition: string;
    avgScore: string;
    highestScore: string;
    combosPlayed: string;
    straights: string;
    triples: string;
    pairs: string;
    singles: string;
    straightFlush: string;
    fourOfAKind: string;
    fullHouses: string;
    flushes: string;
    royalFlush: string;
    recentGames: string;
  };
  
  // Leaderboard Screen
  leaderboard: {
    title: string;
    rank: string;
    player: string;
    wins: string;
    winRate: string;
    score: string;
    noData: string;
    allTime: string;
    weekly: string;
    daily: string;
    winLoss: string;
    points: string;
    winStreak: string;
    noRankings: string;
    playToRank: string;
  };
  
  // Auth Screens
  auth: {
    signIn: string;
    signUp: string;
    email: string;
    password: string;
    confirmPassword: string;
    forgotPassword: string;
    dontHaveAccount: string;
    alreadyHaveAccount: string;
    signInWithGoogle: string;
    signInWithApple: string;
    orContinueWith: string;
    agreeToTerms: string;
  };
  
  // Matchmaking Screen
  matchmaking: {
    title: string;
    searching: string;
    initializing: string;
    waiting1: string;
    waiting2: string;
    waiting3: string;
    matched: string;
    beFirst: string;
    onePlayerWaiting: string;
    twoPlayersWaiting: string;
    threePlayersWaiting: string;
    startingGame: string;
    playersInQueue: string;
    playersNeeded: string;
    howItWorks: string;
    description: string;
  };
}

// English translations (default)
const en: Translations = {
  common: {
    ok: 'OK',
    cancel: 'Cancel',
    save: 'Save',
    delete: 'Delete',
    confirm: 'Confirm',
    back: 'Back',
    close: 'Close',
    yes: 'Yes',
    no: 'No',
    on: 'On',
    off: 'Off',
    loading: 'Loading...',
    error: 'Error',
    success: 'Success',
    info: 'Info',
    timeout: 'Request timed out',
    you: 'You',
    bot: 'Bot',
    current: 'Current',
    allTime: 'All Time',
    weekly: 'Weekly',
    daily: 'Daily',
    comingSoon: 'Coming Soon',
  },
  settings: {
    title: 'Settings',
    profileSettings: 'Profile Settings',
    gameSettings: 'Game Settings',
    notificationSettings: 'Notifications',
    audioHaptics: 'Audio & Haptics',
    language: 'Language',
    account: 'Account',
    about: 'About',
    
    editProfile: 'Edit Profile',
    username: 'Username',
    avatar: 'Avatar',
    privacy: 'Privacy',
    privacyDescription: 'Control who can see your profile',
    profileVisibility: 'Profile Visibility',
    showOnlineStatus: 'Show Online Status',
    
    cardSortOrder: 'Card Sort Order',
    cardSortOrderDescription: 'How to sort your cards in hand',
    sortBySuit: 'By Suit',
    sortByRank: 'By Rank',
    animationSpeed: 'Animation Speed',
    animationSpeedDescription: 'Speed of card and UI animations',
    slow: 'Slow',
    normal: 'Normal',
    fast: 'Fast',
    autoPassTimer: 'Auto-Pass Timer',
    autoPassTimerDescription: 'Automatically pass after inactivity',
    disabled: 'Disabled',
    
    pushNotifications: 'Push Notifications',
    pushNotificationsDescription: 'Receive notifications for game events',
    enableNotifications: 'Enable Notifications',
    notificationTypes: 'Notification Types',
    
    soundEffects: 'Sound Effects',
    soundEffectsDescription: 'Play sounds during gameplay',
    music: 'Music',
    musicDescription: 'Background music',
    vibration: 'Vibration',
    vibrationDescription: 'Haptic feedback',
    volume: 'Volume',
    
    selectLanguage: 'Select Language',
    languageDescription: 'Choose your preferred language',
    changeLanguageWarning: 'Changing language will restart the app',
    restartRequired: 'Restart Required',
    languageChangedSuccess: 'Language changed successfully',
    
    accountManagement: 'Account Management',
    clearCache: 'Clear Cache',
    clearCacheDescription: 'Free up storage space',
    clearCacheConfirm: 'Clear all cached data?',
    clearCacheSuccess: 'Cache cleared successfully',
    deleteAccount: 'Delete Account',
    deleteAccountDescription: 'Permanently delete your account',
    deleteAccountWarning: 'This action cannot be undone. All your data will be permanently deleted.',
    deleteAccountConfirm: 'Are you sure you want to delete your account?',
    noUserLoggedIn: 'No user logged in',
    deleteAccountFailed: 'Failed to delete account. Please contact support.',
    accountDeletedSuccess: 'Account deleted successfully',
    profileComingSoonDescription: 'Profile visibility and online status will be available with online multiplayer!',
    autoPassTimerBanner: 'ℹ️ Note: Game currently uses a fixed 10-second timer. Custom durations coming soon!',
    
    version: 'Version',
    termsOfService: 'Terms of Service',
    privacyPolicy: 'Privacy Policy',
    support: 'Support',
  },
  home: {
    title: 'Big2 Mobile',
    welcome: 'Welcome',
    quickPlay: '⚡ Quick Play',
    quickPlayDescription: 'Join a random game',
    createRoom: '➕ Create Room',
    createRoomDescription: 'Host a private game',
    joinRoom: '🔗 Join Room',
    joinRoomDescription: 'Enter a room code',
    howToPlay: '📖 How to Play',
    howToPlayDescription: 'Learn the rules',
    leaderboard: '🏆 Leaderboard',
    profile: 'Profile',
    currentRoom: 'Currently in room',
    leave: 'Leave',
    leftRoom: 'Left the room',
    leaveRoomConfirm: 'Leave room?',
  },
  howToPlay: {
    title: '📖 How to Play Big Two',
    objectiveTitle: 'Objective',
    objectiveText: 'Be the first player to play all your cards.',
    cardRankingsTitle: 'Card Rankings',
    rankOrderLabel: 'Rank Order (lowest to highest):',
    rankOrder: '3, 4, 5, 6, 7, 8, 9, 10, J, Q, K, A, 2',
    suitOrderLabel: 'Suit Order (lowest to highest):',
    suitOrder: '♦ Diamonds, ♣ Clubs, ♥ Hearts, ♠ Spades',
    cardNote: 'Note: The 3 of Diamonds (3♦) is the lowest card & the 2 of Spades (2♠) is the highest!',
    validCombinationsTitle: 'Valid Combinations',
    single: 'Single: Any single card',
    pair: 'Pair: Two cards of the same rank',
    triple: 'Triple: Three cards of the same rank',
    straight: 'Straight: 5 consecutive cards from (A-2-3-4-5 to 10-J-Q-K-A)',
    flush: 'Flush: 5 cards of the same suit',
    fullHouse: 'Full House: 3 of a kind + a pair',
    fourOfAKind: 'Four of a Kind: 4 cards of the same rank + 1 card',
    straightFlush: 'Straight Flush: 5 consecutive cards of the same suit',
    gameplayTitle: 'Gameplay',
    startingGame: 'Starting the Game: The player with 3♦ must play it (either alone or in a combination).',
    playingCards: 'Playing Cards: Each player must play a higher combination of the same type (e.g., pair beats pair).',
    passing: 'Passing: If you can\'t or don\'t want to play, click "Pass".',
    leading: 'Leading: When everyone passes, the last player to play cards starts a new round with any valid combination.',
    winning: 'Winning: First player to empty their hand wins the match and starts the next match!',
    specialRulesTitle: 'Special Rules',
    autoPassTimer: 'Auto-Pass Timer: When the highest possible card/combo is played, other players have 10 seconds to respond or will auto-pass.',
    oneCardLeft: 'One Card Left: When a player has 1 card remaining, the player who plays immediately before them (in turn order) MUST play their highest single card if they are playing a single. Pairs, triples, and 5-card combos are not restricted.',
    fiveCardCombos: '5-Card Combos: Straights, flushes, full houses, four of a kind, and straight flushes can only be beaten by higher combinations of the same type.',
    scoringTitle: 'Scoring',
    scoringIntro: 'Points are awarded based on how many cards opponents have left when you win:',
    scoring1to4: '1-4 cards left: 1 point per card',
    scoring5to9: '5-9 cards left: 2 points per card',
    scoring10to13: '10-13 cards left: 3 points per card',
    scoringWarning: 'Warning: First player to reach over 100 points loses the game! The player with the lowest score wins.',
    letsPlay: "Let's Play!",
    // ELO Rating System
    eloSystemTitle: '🏆 ELO Rating System',
    eloSystemDesc: 'Your ELO rating measures your skill level. It increases when you win and decreases when you lose in ranked matches. Casual matches do not affect your ELO.',
    eloFormula: 'ELO changes are calculated using the chess rating formula with K-factor=32. Winning against higher-rated opponents gives more points.',
    rankTiersTitle: 'Rank Tiers:',
    // Reconnection & Disconnection
    reconnectionTitle: '🔄 Reconnection & Disconnection',
    reconnectionDesc: 'If you lose connection during a match, you have 15 seconds to reconnect before a bot replaces you.',
    disconnectGrace: '⏱️ Grace Period: 15 seconds to resume your app and restore your position.',
    botReplacement: '🤖 Bot Replacement: After 15 seconds, a bot with your current hand will play for you.',
    spectatorMode: '👁️ Spectator Mode: If you reconnect after bot replacement, you can watch the match but cannot play.',
  },
  game: {
    yourTurn: 'Your Turn',
    waiting: 'Waiting for',
    pass: 'Pass',
    play: 'Play',
    hint: 'Hint',
    smart: 'Smart',
    sort: 'Sort',
    lastPlayedBy: 'Last played by',
    noCardsYet: 'No cards played yet',
    cardsLeft: 'cards left',
    combo: 'Combo',
    winner: 'Winner',
    gameOver: 'Game Over',
    playAgain: 'Play Again',
    backToHome: 'Back to Home',
    selectCards: 'Select cards to play',
    cannotBeat: 'Cannot beat this combo',
    invalidCombo: 'Invalid card combination',
    mustPlayHigher: 'Must play higher combo',
    autoPassTimer: 'Auto-pass in',
    secondsRemaining: 'seconds if no manual pass',
    settings: 'Settings',
    leaveGame: 'Leave Game',
    leaveGameConfirm: 'Leave Game?',
    leaveGameMessage: 'Are you sure you want to leave? Your progress will be lost.',
    stay: 'Stay',
  },
  gameEnd: {
    gameWinner: 'Game Winner',
    finalStandings: 'Final Standings',
    scoreHistory: 'Score History',
    playHistory: 'Play History',
    shareResults: 'Share Results',
    playAgain: 'Play Again',
    returnToMenu: 'Return to Menu',
    loadingResults: 'Loading results...',
    noScoreHistory: 'No score history available',
    scoresWillAppear: 'Scores will appear here as matches are played',
    noPlayHistory: 'No play history available',
    playsWillAppear: 'Card plays will appear here as hands are played',
    match: 'Match',
    hand: 'hand',
    hands: 'hands',
    points: 'pts',
    latest: 'Latest',
    matchByMatch: 'Match-by-Match Scores',
    cardPlayHistory: 'Card Play History',
    tapToExpand: 'Tap matches to expand/collapse',
    playAgainTitle: 'Play Again',
    playAgainMessage: 'Start a new game with the same players?',
    newGame: 'New Game',
    returnToMenuTitle: 'Return to Menu',
    returnToMenuMessage: 'Leave the current game and return to the main menu?',
    leaveGame: 'Leave Game',
    shareError: 'Share Error',
    shareErrorMessage: 'Failed to share results. Please try again.',
    restartError: 'Error',
    restartErrorMessage: 'Failed to restart game. Please try again.',
    leaveError: 'Error',
    leaveErrorMessage: 'Failed to leave game. Please try again.',
    matchesPlayed: 'matches played',
    oneMatch: 'match',
  },
  lobby: {
    title: 'Game Lobby',
    roomCode: 'Room Code',
    waitingForPlayers: 'Waiting for players',
    players: 'Players',
    ready: 'Ready',
    notReady: 'Not Ready',
    startGame: 'Start Game',
    leaveRoom: 'Leave Room',
    copyCode: 'Copy Code',
    codeCopied: 'Room code copied!',
    minPlayers: 'Need at least 2 players to start',
    inviteFriends: 'Share this code with friends',
    emptySlot: 'Empty Slot',
    you: 'You',
    readyUp: 'Ready Up',
    starting: 'Starting',
    startWithBots: 'Start with AI Bots',
    hostInfo: "You're the host. Start with bots or wait for players.",
    waitingForHost: 'Waiting for host to start the game...',
    onlyHostCanStart: 'Only the host can start the game with bots',
    playerDataNotFound: 'Could not find your player data',
    createPlayerError: 'Failed to create player entry',
    loadPlayersError: 'Failed to load players',
    readyStatusError: 'Failed to update ready status',
    leaveRoomError: 'Failed to leave room',
    startGameError: 'Failed to start game',
  },
  room: {
    createTitle: 'Create Room',
    joinTitle: 'Join Room',
    enterCode: 'Enter room code',
    createButton: 'Create Room',
    joinButton: 'Join Room',
    invalidCode: 'Room code must be 6 characters',
    roomFull: 'Room is full (4/4 players)',
    roomNotFound: 'Room not found',
    alreadyInRoom: 'Already in Room',
    createSubtitle: 'Create a private room and invite your friends',
    joinSubtitle: 'Enter a 6-character room code to join',
    shareableCode: "You'll get a shareable room code",
    upTo4Players: 'Up to 4 players can join',
    fillWithBots: 'Fill empty slots with bots',
    customizeSettings: 'Customize game settings',
    mustBeSignedIn: 'You must be signed in to create a room',
    alreadyInRoomMessage: "You're already in room {{code}} ({{status}}). Leave and create new room?",
    goToRoom: 'Go to Room',
    leaveAndCreate: 'Leave & Create',
    leaveRoomError: 'Failed to leave existing room',
    leaveTimeout: 'Taking longer than expected to leave room. Please try again or wait a moment.',
    createRoomError: 'Failed to create room',
    invalidCodeTitle: 'Invalid Code',
    alreadyInDifferentRoom: "You're already in room {{code}}. Leave it first to join a different room.",
    goToCurrentRoom: 'Go to Current Room',
    alreadyInAnotherRoom: 'You are already in another room. Please leave it first.',
    joinRoomError: 'Failed to join room',
    tip: 'Tip',
    askFriendForCode: 'Ask your friend for the room code and enter it here to join their game',
  },
  profile: {
    title: 'Profile',
    stats: 'Statistics',
    gamesPlayed: 'Games Played',
    gamesWon: 'Games Won',
    winRate: 'Win Rate',
    bestStreak: 'Best Streak',
    totalScore: 'Total Points',
    rank: 'Global Rank',
    editProfile: 'Edit Profile',
    signOut: 'Sign Out',
    rankPoints: 'Rank Points',
    currentStreak: 'Current Streak',
    noStatsYet: 'No statistics yet',
    playFirstGame: 'Play your first game to see your stats!',
    accountInfo: 'Account Information',
    email: 'Email',
    notProvided: 'Not provided',
    userId: 'User ID',
    username: 'Username',
    fullName: 'Full Name',
    provider: 'Provider',
    sessionDetails: 'Session Details',
    lastSignIn: 'Last Sign In',
    createdAt: 'Created At',
    emailConfirmed: 'Email Confirmed',
    signOutConfirm: 'Are you sure you want to sign out?',
    signOutError: 'Failed to sign out. Please try again.',
    overview: 'Overview',
    streaks: 'Streaks',
    gamesLost: 'Games Lost',
    losses: 'Losses',
    wins: 'Wins',
    performance: 'Performance',
    totalPoints: 'Total Points',
    avgPosition: 'Avg Position',
    avgScore: 'Avg Score',
    highestScore: 'Highest Score',
    combosPlayed: 'Combos Played',
    straights: 'Straights',
    triples: 'Triples',
    pairs: 'Pairs',
    singles: 'Singles',
    straightFlush: 'Straight Flush',
    fourOfAKind: 'Four of a Kind',
    fullHouses: 'Full Houses',
    flushes: 'Flushes',
    royalFlush: 'Royal Flush',
    recentGames: 'Recent Games',
  },
  leaderboard: {
    title: 'Leaderboard',
    rank: 'Rank',
    player: 'Player',
    wins: 'Wins',
    winRate: 'Win Rate',
    score: 'Score',
    noData: 'No leaderboard data yet',
    allTime: 'All Time',
    weekly: 'Weekly',
    daily: 'Daily',
    winLoss: 'W/L',
    points: 'Points',
    winStreak: 'win streak',
    noRankings: 'No rankings yet',
    playToRank: 'Play some games to appear on the leaderboard!',
  },
  auth: {
    signIn: 'Sign In',
    signUp: 'Sign Up',
    email: 'Email',
    password: 'Password',
    confirmPassword: 'Confirm Password',
    forgotPassword: 'Forgot Password?',
    dontHaveAccount: "Don't have an account?",
    alreadyHaveAccount: 'Already have an account?',
    signInWithGoogle: 'Sign in with Google',
    signInWithApple: 'Sign in with Apple',
    orContinueWith: 'Or continue with',
    agreeToTerms: 'By signing up, you agree to our Terms of Service and Privacy Policy',
  },
  matchmaking: {
    title: 'Find Match',
    searching: 'Searching for players...',
    initializing: 'Initializing matchmaking...',
    waiting1: 'Found 1 player, waiting for 3 more...',
    waiting2: 'Found 2 players, waiting for 2 more...',
    waiting3: 'Found 3 players, waiting for 1 more...',
    matched: 'Match found! Starting game...',
    beFirst: 'Be the first to join!',
    onePlayerWaiting: '1 player is waiting. Join now!',
    twoPlayersWaiting: '2 players are waiting. Almost there!',
    threePlayersWaiting: '3 players are waiting. One more needed!',
    startingGame: 'Starting game now! 🎮',
    playersInQueue: 'players in queue',
    playersNeeded: 'players needed',
    howItWorks: 'How It Works',
    description: 'We\'ll match you with players of similar skill level. The game starts automatically when 4 players are ready!',
  },
};

// Arabic translations
const ar: Translations = {
  common: {
    ok: 'موافق',
    cancel: 'إلغاء',
    save: 'حفظ',
    delete: 'حذف',
    confirm: 'تأكيد',
    back: 'رجوع',
    close: 'إغلاق',
    yes: 'نعم',
    no: 'لا',
    on: 'تشغيل',
    off: 'إيقاف',
    loading: 'جار التحميل...',
    error: 'خطأ',
    success: 'نجح',
    info: 'معلومات',
    timeout: 'انتهت مهلة الطلب',
    you: 'أنت',
    bot: 'بوت',
    current: 'الحالي',
    allTime: 'كل الأوقات',
    weekly: 'أسبوعي',
    daily: 'يومي',
    comingSoon: 'قريبًا',
  },
  settings: {
    title: 'الإعدادات',
    profileSettings: 'إعدادات الملف الشخصي',
    gameSettings: 'إعدادات اللعبة',
    notificationSettings: 'الإشعارات',
    audioHaptics: 'الصوت والاهتزاز',
    language: 'اللغة',
    account: 'الحساب',
    about: 'حول',
    
    editProfile: 'تعديل الملف الشخصي',
    username: 'اسم المستخدم',
    avatar: 'الصورة الرمزية',
    privacy: 'الخصوصية',
    privacyDescription: 'التحكم في من يمكنه رؤية ملفك الشخصي',
    profileVisibility: 'رؤية الملف الشخصي',
    showOnlineStatus: 'إظهار الحالة على الإنترنت',
    
    cardSortOrder: 'ترتيب البطاقات',
    cardSortOrderDescription: 'كيفية ترتيب البطاقات في يدك',
    sortBySuit: 'حسب النوع',
    sortByRank: 'حسب الرتبة',
    animationSpeed: 'سرعة الرسوم المتحركة',
    animationSpeedDescription: 'سرعة حركة البطاقات والواجهة',
    slow: 'بطيء',
    normal: 'عادي',
    fast: 'سريع',
    autoPassTimer: 'مؤقت التمرير التلقائي',
    autoPassTimerDescription: 'التمرير تلقائيًا بعد عدم النشاط',
    disabled: 'معطل',
    
    pushNotifications: 'إشعارات الدفع',
    pushNotificationsDescription: 'تلقي إشعارات لأحداث اللعبة',
    enableNotifications: 'تفعيل الإشعارات',
    notificationTypes: 'أنواع الإشعارات',
    
    soundEffects: 'المؤثرات الصوتية',
    soundEffectsDescription: 'تشغيل الأصوات أثناء اللعب',
    music: 'الموسيقى',
    musicDescription: 'موسيقى الخلفية',
    vibration: 'الاهتزاز',
    vibrationDescription: 'ردود الفعل اللمسية',
    volume: 'مستوى الصوت',
    
    selectLanguage: 'اختر اللغة',
    languageDescription: 'اختر لغتك المفضلة',
    changeLanguageWarning: 'تغيير اللغة سيعيد تشغيل التطبيق',
    restartRequired: 'إعادة التشغيل مطلوبة',
    languageChangedSuccess: 'تم تغيير اللغة بنجاح',
    
    accountManagement: 'إدارة الحساب',
    clearCache: 'مسح ذاكرة التخزين المؤقت',
    clearCacheDescription: 'حرر مساحة التخزين',
    clearCacheConfirm: 'مسح جميع البيانات المخزنة مؤقتًا؟',
    clearCacheSuccess: 'تم مسح ذاكرة التخزين المؤقت بنجاح',
    deleteAccount: 'حذف الحساب',
    deleteAccountDescription: 'احذف حسابك نهائيًا',
    deleteAccountWarning: 'لا يمكن التراجع عن هذا الإجراء. سيتم حذف جميع بياناتك نهائيًا.',
    deleteAccountConfirm: 'هل أنت متأكد أنك تريد حذف حسابك؟',
    noUserLoggedIn: 'لم يتم تسجيل دخول مستخدم',
    deleteAccountFailed: 'فشل حذف الحساب. يرجى الاتصال بالدعم.',
    accountDeletedSuccess: 'تم حذف الحساب بنجاح',
    profileComingSoonDescription: 'ستكون رؤية الملف الشخصي وحالة الاتصال متاحة مع اللعب الجماعي عبر الإنترنت!',
    autoPassTimerBanner: 'ℹ️ ملاحظة: تستخدم اللعبة حاليًا مؤقتًا ثابتًا مدته 10 ثوانٍ. ستكون المدد المخصصة متاحة قريبًا!',
    
    version: 'الإصدار',
    termsOfService: 'شروط الخدمة',
    privacyPolicy: 'سياسة الخصوصية',
    support: 'الدعم',
  },
  home: {
    title: 'Big2 Mobile',
    welcome: 'مرحبًا',
    quickPlay: '⚡ لعب سريع',
    quickPlayDescription: 'انضم إلى لعبة عشوائية',
    createRoom: '➕ إنشاء غرفة',
    createRoomDescription: 'استضافة لعبة خاصة',
    joinRoom: '🔗 الانضمام إلى غرفة',
    joinRoomDescription: 'أدخل رمز الغرفة',
    leaderboard: '🏆 لوحة المتصدرين',
    profile: 'الملف الشخصي',
    currentRoom: 'حاليًا في الغرفة',
    leave: 'غادر',
    leftRoom: 'غادرت الغرفة',
    leaveRoomConfirm: 'غادر الغرفة؟',
    howToPlay: '📖 كيف تلعب',
    howToPlayDescription: 'تعلم قواعد اللعبة',
  },
  game: {
    yourTurn: 'دورك',
    waiting: 'في انتظار',
    pass: 'تمرير',
    play: 'لعب',
    hint: 'تلميح',
    smart: 'ذكي',
    sort: 'ترتيب',
    lastPlayedBy: 'آخر من لعب',
    noCardsYet: 'لم يتم لعب أي بطاقات بعد',
    cardsLeft: 'بطاقات متبقية',
    combo: 'كومبو',
    winner: 'الفائز',
    gameOver: 'انتهت اللعبة',
    playAgain: 'العب مرة أخرى',
    backToHome: 'العودة إلى الصفحة الرئيسية',
    selectCards: 'حدد البطاقات للعب',
    cannotBeat: 'لا يمكن التغلب على هذا الكومبو',
    invalidCombo: 'مجموعة بطاقات غير صالحة',
    mustPlayHigher: 'يجب لعب كومبو أعلى',
    autoPassTimer: 'التمرير التلقائي في',
    secondsRemaining: 'ثانية إذا لم يتم التمرير يدويًا',
    settings: 'الإعدادات',
    leaveGame: 'مغادرة اللعبة',
    leaveGameConfirm: 'مغادرة اللعبة؟',
    leaveGameMessage: 'هل أنت متأكد أنك تريد المغادرة؟ سيتم فقدان تقدمك.',
    stay: 'البقاء',
  },
  gameEnd: {
    gameWinner: 'فائز اللعبة',
    finalStandings: 'التصنيف النهائي',
    scoreHistory: 'سجل النقاط',
    playHistory: 'سجل اللعب',
    shareResults: 'مشاركة النتائج',
    playAgain: 'العب مرة أخرى',
    returnToMenu: 'العودة إلى القائمة',
    loadingResults: 'جارٍ تحميل النتائج...',
    noScoreHistory: 'لا يوجد سجل نقاط متاح',
    scoresWillAppear: 'ستظهر النقاط هنا عند لعب المباريات',
    noPlayHistory: 'لا يوجد سجل لعب متاح',
    playsWillAppear: 'ستظهر اللعبات هنا عند لعب الأيدي',
    match: 'مباراة',
    hand: 'يد',
    hands: 'أيدي',
    points: 'نقاط',
    latest: 'الأحدث',
    matchByMatch: 'النقاط مباراة تلو الأخرى',
    cardPlayHistory: 'سجل لعب البطاقات',
    tapToExpand: 'اضغط على المباريات للتوسيع/الطي',
    playAgainTitle: 'العب مرة أخرى',
    playAgainMessage: 'بدء لعبة جديدة مع نفس اللاعبين؟',
    newGame: 'لعبة جديدة',
    returnToMenuTitle: 'العودة إلى القائمة',
    returnToMenuMessage: 'غادر اللعبة الحالية والعودة إلى القائمة الرئيسية؟',
    leaveGame: 'مغادرة اللعبة',
    shareError: 'خطأ في المشاركة',
    shareErrorMessage: 'فشلت مشاركة النتائج. حاول مرة أخرى.',
    restartError: 'خطأ',
    restartErrorMessage: 'فشل إعادة تشغيل اللعبة. حاول مرة أخرى.',
    leaveError: 'خطأ',
    leaveErrorMessage: 'فشلت مغادرة اللعبة. حاول مرة أخرى.',
    matchesPlayed: 'مباريات ملعوبة',
    oneMatch: 'مباراة',
  },
  lobby: {
    title: 'صالة اللعبة',
    roomCode: 'رمز الغرفة',
    waitingForPlayers: 'في انتظار اللاعبين',
    players: 'اللاعبون',
    ready: 'جاهز',
    notReady: 'غير جاهز',
    startGame: 'ابدأ اللعبة',
    leaveRoom: 'غادر الغرفة',
    copyCode: 'نسخ الرمز',
    codeCopied: 'تم نسخ رمز الغرفة!',
    minPlayers: 'تحتاج إلى لاعبين على الأقل للبدء',
    inviteFriends: 'شارك هذا الرمز مع الأصدقاء',
    emptySlot: 'فتحة فارغة',
    you: 'أنت',
    readyUp: 'جاهز',
    starting: 'البدء',
    startWithBots: 'ابدأ مع روبوتات الذكاء الاصطناعي',
    hostInfo: 'أنت المضيف. ابدأ مع الروبوتات أو انتظر اللاعبين.',
    waitingForHost: 'في انتظار المضيف لبدء اللعبة...',
    onlyHostCanStart: 'فقط المضيف يمكنه بدء اللعبة مع الروبوتات',
    playerDataNotFound: 'لا يمكن العثور على بيانات اللاعب الخاصة بك',
    createPlayerError: 'فشل إنشاء إدخال اللاعب',
    loadPlayersError: 'فشل تحميل اللاعبين',
    readyStatusError: 'فشل تحديث حالة الجاهزية',
    leaveRoomError: 'فشل مغادرة الغرفة',
    startGameError: 'فشل بدء اللعبة',
  },
  room: {
    createTitle: 'إنشاء غرفة',
    joinTitle: 'الانضمام إلى غرفة',
    enterCode: 'أدخل رمز الغرفة',
    createButton: 'إنشاء',
    joinButton: 'انضم',
    invalidCode: 'رمز غرفة غير صالح',
    roomFull: 'الغرفة ممتلئة',
    roomNotFound: 'الغرفة غير موجودة',
    alreadyInRoom: 'أنت موجود بالفعل في غرفة',
    createSubtitle: 'أنشئ غرفة خاصة وادع أصدقائك',
    joinSubtitle: 'أدخل رمز الغرفة المكون من 6 أحرف للانضمام',
    shareableCode: 'ستحصل على رمز غرفة قابل للمشاركة',
    upTo4Players: 'يمكن لما يصل إلى 4 لاعبين الانضمام',
    fillWithBots: 'املأ الفتحات الفارغة بالروبوتات',
    customizeSettings: 'تخصيص إعدادات اللعبة',
    mustBeSignedIn: 'يجب عليك تسجيل الدخول لإنشاء غرفة',
    alreadyInRoomMessage: 'أنت بالفعل في الغرفة {{code}} ({{status}}). المغادرة وإنشاء غرفة جديدة؟',
    goToRoom: 'اذهب إلى الغرفة',
    leaveAndCreate: 'غادر وأنشئ',
    leaveRoomError: 'فشل مغادرة الغرفة الحالية',
    leaveTimeout: 'يستغرق الأمر وقتًا أطول من المتوقع لمغادرة الغرفة. حاول مرة أخرى أو انتظر لحظة.',
    createRoomError: 'فشل إنشاء الغرفة',
    invalidCodeTitle: 'رمز غير صالح',
    alreadyInDifferentRoom: 'أنت بالفعل في الغرفة {{code}}. غادرها أولاً للانضمام إلى غرفة مختلفة.',
    goToCurrentRoom: 'اذهب إلى الغرفة الحالية',
    alreadyInAnotherRoom: 'أنت بالفعل في غرفة أخرى. يرجى المغادرة أولاً.',
    joinRoomError: 'فشل الانضمام إلى الغرفة',
    tip: 'نصيحة',
    askFriendForCode: 'اطلب من صديقك رمز الغرفة وأدخله هنا للانضمام إلى لعبته',
  },
  profile: {
    title: 'الملف الشخصي',
    stats: 'الإحصائيات',
    gamesPlayed: 'الألعاب التي تم لعبها',
    gamesWon: 'الألعاب الفائزة',
    gamesLost: 'الألعاب المفقودة',
    winRate: 'معدل الفوز',
    bestStreak: 'أفضل سلسلة',
    totalScore: 'النقاط الإجمالية',
    rank: 'الرتبة',
    editProfile: 'تعديل الملف الشخصي',
    signOut: 'تسجيل الخروج',
    rankPoints: 'نقاط الترتيب',
    currentStreak: 'السلسلة الحالية',
    noStatsYet: 'لا توجد إحصائيات بعد',
    playFirstGame: 'العب أول لعبة لك لرؤية إحصائياتك!',
    accountInfo: 'معلومات الحساب',
    email: 'البريد الإلكتروني',
    notProvided: 'غير مقدم',
    userId: 'معرف المستخدم',
    username: 'اسم المستخدم',
    fullName: 'الاسم الكامل',
    provider: 'المزود',
    sessionDetails: 'تفاصيل الجلسة',
    lastSignIn: 'آخر تسجيل دخول',
    createdAt: 'تم الإنشاء في',
    emailConfirmed: 'تأكيد البريد الإلكتروني',
    signOutConfirm: 'هل أنت متأكد أنك تريد تسجيل الخروج؟',
    signOutError: 'فشل تسجيل الخروج. حاول مرة أخرى.',
    overview: 'نظرة عامة',
    streaks: 'السلاسل',
    losses: 'الخسائر',
    wins: 'الانتصارات',
    performance: 'الأداء',
    totalPoints: 'النقاط الإجمالية',
    avgPosition: 'متوسط المركز',
    avgScore: 'متوسط النقاط',
    highestScore: 'أعلى نقاط',
    combosPlayed: 'المجموعات التي تم لعبها',
    straights: 'المتتاليات',
    triples: 'الثلاثيات',
    pairs: 'الأزواج',
    singles: 'الفردي',
    straightFlush: 'سلسلة متدرجة',
    fourOfAKind: 'أربعة من نوع',
    fullHouses: 'البيوت الكاملة',
    flushes: 'السحب',
    royalFlush: 'السحب الملكي',
    recentGames: 'الألعاب الأخيرة',
  },
  leaderboard: {
    title: 'لوحة المتصدرين',
    rank: 'الرتبة',
    player: 'اللاعب',
    wins: 'الفوز',
    winRate: 'معدل الفوز',
    score: 'النقاط',
    noData: 'لا توجد بيانات لوحة المتصدرين حتى الآن',
    allTime: 'كل الأوقات',
    weekly: 'أسبوعي',
    daily: 'يومي',
    winLoss: 'ف/خ',
    points: 'النقاط',
    winStreak: 'سلسلة الفوز',
    noRankings: 'لا توجد تصنيفات بعد',
    playToRank: 'العب بعض الألعاب للظهور على لوحة المتصدرين!',
  },
  auth: {
    signIn: 'تسجيل الدخول',
    signUp: 'اشتراك',
    email: 'البريد الإلكتروني',
    password: 'كلمة المرور',
    confirmPassword: 'تأكيد كلمة المرور',
    forgotPassword: 'هل نسيت كلمة المرور؟',
    dontHaveAccount: 'ليس لديك حساب؟',
    alreadyHaveAccount: 'هل لديك حساب؟',
    signInWithGoogle: 'تسجيل الدخول باستخدام Google',
    signInWithApple: 'تسجيل الدخول باستخدام Apple',
    orContinueWith: 'أو تابع باستخدام',
    agreeToTerms: 'من خلال التسجيل، فإنك توافق على شروط الخدمة وسياسة الخصوصية الخاصة بنا',
  },
  matchmaking: {
    title: 'البحث عن مباراة',
    searching: 'البحث عن لاعبين...',
    initializing: 'جارٍ التهيئة...',
    waiting1: 'تم العثور على لاعب واحد، في انتظار 3 لاعبين آخرين...',
    waiting2: 'تم العثور على لاعبين، في انتظار لاعبين آخرين...',
    waiting3: 'تم العثور على 3 لاعبين، في انتظار لاعب واحد...',
    matched: 'تم العثور على مباراة! جارٍ بدء اللعبة...',
    beFirst: 'كن أول من ينضم!',
    onePlayerWaiting: 'لاعب واحد في الانتظار. انضم الآن!',
    twoPlayersWaiting: 'لاعبان في الانتظار. نحن قريبون!',
    threePlayersWaiting: '3 لاعبين في الانتظار. نحتاج واحد فقط!',
    startingGame: 'بدء اللعبة الآن! 🎮',
    playersInQueue: 'لاعبين في قائمة الانتظار',
    playersNeeded: 'لاعبين مطلوبين',
    howItWorks: 'كيف يعمل',
    description: 'سنطابقك مع لاعبين لديهم مستوى مهارة مماثل. تبدأ اللعبة تلقائيًا عندما يكون 4 لاعبين جاهزين!',
  },
  howToPlay: {
    title: 'كيفية اللعب',
    objectiveTitle: '🎯 الهدف',
    objectiveText: 'كن أول لاعب يتخلص من جميع بطاقاته. آخر لاعب لديه بطاقات يخسر.',
    rankOrderLabel: '🃏 ترتيب القيم (من الأدنى إلى الأعلى):',
    rankOrder: '3، 4، 5، 6، 7، 8، 9، 10، J، Q، K، A، 2',
    suitOrderLabel: '🎴 ترتيب الأنواع (عند التساوي في القيمة):',
    suitOrder: '♦ الماس، ♣ السباتي، ♥ القلوب، ♠ البستوني',
    cardNote: 'ملاحظة: 3 الماس (3♦) هو أضعف ورقة و 2 البستوني (2♠) هو أقوى ورقة!',
    validCombinationsTitle: '🎮 التشكيلات الصحيحة',
    cardRankingsTitle: '🎴 ترتيب البطاقات',
    single: 'مفرد: أي ورقة واحدة',
    pair: 'زوج: ورقتان بنفس القيمة',
    triple: 'ثلاثية: ثلاث أوراق بنفس القيمة',
    straight: 'متتالية: 5 أوراق متتالية',
    flush: 'فلاش: 5 أوراق من نفس النوع',
    fullHouse: 'فل هاوس: ثلاثية + زوج',
    fourOfAKind: 'أربعة متشابهة: 4 أوراق بنفس القيمة',
    straightFlush: 'فلاش متتالي: 5 أوراق متتالية من نفس النوع',
    singleLabel: '1️⃣ مفرد:',
    singleText: 'أي ورقة واحدة',
    pairLabel: '2️⃣ زوج:',
    pairText: 'ورقتان بنفس القيمة (مثال: 7♦ و 7♥)',
    tripleLabel: '3️⃣ ثلاثية:',
    tripleText: 'ثلاث أوراق بنفس القيمة (مثال: Q♣، Q♦، Q♠)',
    fiveCardCombosLabel: '5️⃣ تشكيلات الخمس أوراق:',
    straightLabel: '▪ متتالية:',
    straightText: '5 أوراق متتالية (مثال: 5، 6، 7، 8، 9)',
    flushLabel: '▪ فلاش:',
    flushText: '5 أوراق من نفس النوع',
    fullHouseLabel: '▪ فل هاوس:',
    fullHouseText: 'ثلاثية + زوج (مثال: 8، 8، 8 + K، K)',
    fourOfAKindLabel: '▪ أربعة متشابهة:',
    fourOfAKindText: '4 أوراق بنفس القيمة + أي ورقة خامسة (مثال: A، A، A، A + 5)',
    straightFlushLabel: '▪ فلاش متتالي:',
    straightFlushText: '5 أوراق متتالية من نفس النوع (أقوى تشكيلة!)',
    gameplayTitle: '⚡ طريقة اللعب',
    gameplayPoint1: '• اللاعب الذي لديه 3 الماس (3♦) يبدأ الجولة الأولى',
    gameplayPoint2: '• يجب أن تلعب نفس نوع التشكيلة (مفرد، زوج، إلخ) لكن بقيمة أعلى',
    gameplayPoint3: '• إذا لم تستطع أو لا تريد اللعب، اضغط "تمرير"',
    gameplayPoint4: '• عندما يمرر جميع اللاعبين، يبدأ اللاعب الأخير الذي لعب جولة جديدة',
    gameplayPoint5: '• استمر باللعب حتى يتخلص لاعب واحد من كل أوراقه!',
    startingGame: 'بدء اللعبة: اللاعب الذي لديه 3 الماس (3♦) يبدأ الجولة الأولى',
    playingCards: 'لعب البطاقات: يجب أن تلعب نفس نوع التشكيلة لكن بقيمة أعلى',
    passing: 'التمرير: إذا لم تستطع أو لا تريد اللعب، اضغط "تمرير"',
    leading: 'القيادة: عندما يمرر جميع اللاعبين، يبدأ اللاعب الأخير جولة جديدة',
    winning: 'الفوز: أول لاعب يتخلص من جميع بطاقاته يفوز!',
    specialRulesTitle: '💡 قواعد خاصة',
    specialRule1: '• لا يمكن للتشكيلات الأضعف أن تتفوق على الأقوى',
    specialRule2: '• فلاش متتالي > أربعة متشابهة > فل هاوس > فلاش > متتالية',
    specialRule3: '• يمكنك استخدام الأزرار المساعدة (فرز، ذكي، تلميح) لترتيب أوراقك',
    autoPassTimer: 'مؤقت التمرير التلقائي: عندما يتم لعب أعلى بطاقة، لدى اللاعبين الآخرين 10 ثواني للرد',
    oneCardLeft: 'بطاقة واحدة متبقية: عندما يكون لدى اللاعب بطاقة واحدة، يجب على اللاعب السابق لعب أعلى بطاقة مفردة',
    fiveCardCombos: 'تشكيلات 5 بطاقات: المتتاليات والفلاش لا يمكن هزيمتها إلا بتشكيلة أعلى من نفس النوع',
    scoringTitle: '🏆 نظام النقاط',
    scoringIntro: 'في نهاية كل جولة، اللاعبون الذين لم يتخلصوا من أوراقهم يحصلون على نقاط بناءً على عدد الأوراق المتبقية:',
    scoring1to4: '1-4 أوراق متبقية: 1 نقطة',
    scoring5to9: '5-9 أوراق متبقية: 2 نقطة',
    scoring10to13: '10-13 ورقة متبقية: 3 نقاط',
    scoring1to7: '• 1-7 أوراق متبقية = 1 نقطة',
    scoring8to10: '• 8-10 أوراق متبقية = 2 نقطة',
    scoring11to12: '• 11-12 ورقة متبقية = 3 نقاط',
    scoringWarning: 'تحذير: أول لاعب يصل إلى أكثر من 100 نقطة يخسر اللعبة! اللاعب صاحب أقل نقاط يفوز.',
    letsPlay: 'هيا نلعب!',
    // ELO Rating System
    eloSystemTitle: '🏆 نظام تصنيف ELO',
    eloSystemDesc: 'تصنيف ELO الخاص بك يقيس مستوى مهارتك. يزداد عندما تفوز ويقل عندما تخسر في المباريات المصنفة. المباريات العادية لا تؤثر على ELO الخاص بك.',
    eloFormula: 'يتم حساب تغييرات ELO باستخدام صيغة تصنيف الشطرنج مع عامل K = 32. الفوز ضد خصوم ذوي تصنيف أعلى يمنح المزيد من النقاط.',
    rankTiersTitle: 'مستويات الرتب:',
    // Reconnection & Disconnection
    reconnectionTitle: '🔄 إعادة الاتصال والانقطاع',
    reconnectionDesc: 'إذا فقدت الاتصال أثناء المباراة، لديك 15 ثانية لإعادة الاتصال قبل أن يحل بوت محلك.',
    disconnectGrace: '⏱️ فترة السماح: 15 ثانية لاستئناف التطبيق واستعادة موضعك.',
    botReplacement: '🤖 استبدال البوت: بعد 15 ثانية، سيلعب بوت بأوراقك الحالية نيابة عنك.',
    spectatorMode: '👁️ وضع المشاهدة: إذا أعدت الاتصال بعد استبدال البوت، يمكنك مشاهدة المباراة ولكن لا يمكنك اللعب.',
  },
};

// German translations
const de: Translations = {
  common: {
    ok: 'OK',
    cancel: 'Abbrechen',
    save: 'Speichern',
    delete: 'Löschen',
    confirm: 'Bestätigen',
    back: 'Zurück',
    close: 'Schließen',
    yes: 'Ja',
    no: 'Nein',
    on: 'Ein',
    off: 'Aus',
    loading: 'Lädt...',
    error: 'Fehler',
    success: 'Erfolg',
    info: 'Info',
    timeout: 'Zeitüberschreitung',
    you: 'Du',
    bot: 'Bot',
    current: 'Aktuell',
    allTime: 'Alle Zeit',
    weekly: 'Wöchentlich',
    daily: 'Täglich',
    comingSoon: 'Bald verfügbar',
  },
  settings: {
    title: 'Einstellungen',
    profileSettings: 'Profilseinstellungen',
    gameSettings: 'Spieleinstellungen',
    notificationSettings: 'Benachrichtigungen',
    audioHaptics: 'Audio & Haptik',
    language: 'Sprache',
    account: 'Konto',
    about: 'Über',
    
    editProfile: 'Profil bearbeiten',
    username: 'Benutzername',
    avatar: 'Avatar',
    privacy: 'Datenschutz',
    privacyDescription: 'Steuern Sie, wer Ihr Profil sehen kann',
    profileVisibility: 'Profilsichtbarkeit',
    showOnlineStatus: 'Online-Status anzeigen',
    
    cardSortOrder: 'Kartensortierung',
    cardSortOrderDescription: 'Wie Ihre Karten sortiert werden',
    sortBySuit: 'Nach Farbe',
    sortByRank: 'Nach Rang',
    animationSpeed: 'Animationsgeschwindigkeit',
    animationSpeedDescription: 'Geschwindigkeit der Karten- und UI-Animationen',
    slow: 'Langsam',
    normal: 'Normal',
    fast: 'Schnell',
    autoPassTimer: 'Auto-Pass-Timer',
    autoPassTimerDescription: 'Automatisch passen nach Inaktivität',
    disabled: 'Deaktiviert',
    
    pushNotifications: 'Push-Benachrichtigungen',
    pushNotificationsDescription: 'Benachrichtigungen für Spielereignisse erhalten',
    enableNotifications: 'Benachrichtigungen aktivieren',
    notificationTypes: 'Benachrichtigungstypen',
    
    soundEffects: 'Soundeffekte',
    soundEffectsDescription: 'Sounds während des Spiels abspielen',
    music: 'Musik',
    musicDescription: 'Hintergrundmusik',
    vibration: 'Vibration',
    vibrationDescription: 'Haptisches Feedback',
    volume: 'Lautstärke',
    
    selectLanguage: 'Sprache auswählen',
    languageDescription: 'Wählen Sie Ihre bevorzugte Sprache',
    changeLanguageWarning: 'Das Ändern der Sprache startet die App neu',
    restartRequired: 'Neustart erforderlich',
    languageChangedSuccess: 'Sprache erfolgreich geändert',
    
    accountManagement: 'Kontoverwaltung',
    clearCache: 'Cache leeren',
    clearCacheDescription: 'Speicherplatz freigeben',
    clearCacheConfirm: 'Alle zwischengespeicherten Daten löschen?',
    clearCacheSuccess: 'Cache erfolgreich geleert',
    deleteAccount: 'Konto löschen',
    deleteAccountDescription: 'Ihr Konto dauerhaft löschen',
    deleteAccountWarning: 'Diese Aktion kann nicht rückgängig gemacht werden. Alle Ihre Daten werden dauerhaft gelöscht.',
    deleteAccountConfirm: 'Sind Sie sicher, dass Sie Ihr Konto löschen möchten?',
    noUserLoggedIn: 'Kein Benutzer angemeldet',
    deleteAccountFailed: 'Fehler beim Löschen des Kontos. Bitte wenden Sie sich an den Support.',
    accountDeletedSuccess: 'Konto erfolgreich gelöscht',
    profileComingSoonDescription: 'Profilsichtbarkeit und Online-Status werden mit Online-Multiplayer verfügbar sein!',
    autoPassTimerBanner: 'ℹ️ Hinweis: Das Spiel verwendet derzeit einen festen 10-Sekunden-Timer. Benutzerdefinierte Dauern sind bald verfügbar!',
    
    version: 'Version',
    termsOfService: 'Nutzungsbedingungen',
    privacyPolicy: 'Datenschutzerklärung',
    support: 'Support',
  },
  home: {
    title: 'Big2 Mobile',
    welcome: 'Willkommen',
    quickPlay: '⚡ Schnellspiel',
    quickPlayDescription: 'Zufälligem Spiel beitreten',
    createRoom: '➕ Raum erstellen',
    createRoomDescription: 'Privates Spiel hosten',
    joinRoom: '🔗 Raum beitreten',
    joinRoomDescription: 'Raumcode eingeben',
    leaderboard: '🏆 Bestenliste',
    profile: 'Profil',
    currentRoom: 'Derzeit im Raum',
    leave: 'Verlassen',
    leftRoom: 'Raum verlassen',
    leaveRoomConfirm: 'Raum verlassen?',
    howToPlay: '📖 Wie man spielt',
    howToPlayDescription: 'Spielregeln lernen',
  },
  game: {
    yourTurn: 'Dein Zug',
    waiting: 'Warten auf',
    pass: 'Passen',
    play: 'Spielen',
    hint: 'Hinweis',
    smart: 'Clever',
    sort: 'Sortieren',
    lastPlayedBy: 'Zuletzt gespielt von',
    noCardsYet: 'Noch keine Karten gespielt',
    cardsLeft: 'Karten übrig',
    combo: 'Kombo',
    winner: 'Gewinner',
    gameOver: 'Spiel beendet',
    playAgain: 'Nochmal spielen',
    backToHome: 'Zurück zur Startseite',
    selectCards: 'Karten zum Spielen auswählen',
    cannotBeat: 'Kann diese Kombo nicht schlagen',
    invalidCombo: 'Ungültige Kartenkombination',
    mustPlayHigher: 'Muss höhere Kombo spielen',
    autoPassTimer: 'Auto-Pass in',
    secondsRemaining: 'Sekunden, wenn kein manuelles Passen',
    settings: 'Einstellungen',
    leaveGame: 'Spiel verlassen',
    leaveGameConfirm: 'Spiel verlassen?',
    leaveGameMessage: 'Bist du sicher, dass du gehen möchtest? Dein Fortschritt geht verloren.',
    stay: 'Bleiben',
  },
  gameEnd: {
    gameWinner: 'Spielgewinner',
    finalStandings: 'Endstand',
    scoreHistory: 'Punkteverlauf',
    playHistory: 'Spielverlauf',
    shareResults: 'Ergebnisse teilen',
    playAgain: 'Nochmal spielen',
    returnToMenu: 'Zurück zum Menü',
    loadingResults: 'Ergebnisse werden geladen...',
    noScoreHistory: 'Kein Punkteverlauf verfügbar',
    scoresWillAppear: 'Punkte erscheinen hier, wenn Matches gespielt werden',
    noPlayHistory: 'Kein Spielverlauf verfügbar',
    playsWillAppear: 'Kartenspiele erscheinen hier, wenn Hände gespielt werden',
    match: 'Match',
    hand: 'Hand',
    hands: 'Hände',
    points: 'Pkte',
    latest: 'Neueste',
    matchByMatch: 'Punktestand Match für Match',
    cardPlayHistory: 'Kartenspiel-Verlauf',
    tapToExpand: 'Tippen Sie auf Matches zum Erweitern/Zuklappen',
    playAgainTitle: 'Nochmal spielen',
    playAgainMessage: 'Ein neues Spiel mit denselben Spielern starten?',
    newGame: 'Neues Spiel',
    returnToMenuTitle: 'Zurück zum Menü',
    returnToMenuMessage: 'Das aktuelle Spiel verlassen und zum Hauptmenü zurückkehren?',
    leaveGame: 'Spiel verlassen',
    shareError: 'Fehler beim Teilen',
    shareErrorMessage: 'Ergebnisse konnten nicht geteilt werden. Bitte erneut versuchen.',
    restartError: 'Fehler',
    restartErrorMessage: 'Spiel konnte nicht neu gestartet werden. Bitte erneut versuchen.',
    leaveError: 'Fehler',
    leaveErrorMessage: 'Spiel konnte nicht verlassen werden. Bitte erneut versuchen.',
    matchesPlayed: 'gespielte Matches',
    oneMatch: 'Match',
  },
  lobby: {
    title: 'Spiellobby',
    roomCode: 'Raumcode',
    waitingForPlayers: 'Warte auf Spieler',
    players: 'Spieler',
    ready: 'Bereit',
    notReady: 'Nicht bereit',
    startGame: 'Spiel starten',
    leaveRoom: 'Raum verlassen',
    copyCode: 'Code kopieren',
    codeCopied: 'Raumcode kopiert!',
    minPlayers: 'Mindestens 2 Spieler erforderlich',
    inviteFriends: 'Teile diesen Code mit Freunden',
    emptySlot: 'Leerer Platz',
    you: 'Du',
    readyUp: 'Bereit machen',
    starting: 'Startet',
    startWithBots: 'Mit KI-Bots starten',
    hostInfo: 'Du bist der Host. Starte mit Bots oder warte auf Spieler.',
    waitingForHost: 'Warte darauf, dass der Host das Spiel startet...',
    onlyHostCanStart: 'Nur der Host kann das Spiel mit Bots starten',
    playerDataNotFound: 'Deine Spielerdaten konnten nicht gefunden werden',
    createPlayerError: 'Fehler beim Erstellen des Spielereintrags',
    loadPlayersError: 'Fehler beim Laden der Spieler',
    readyStatusError: 'Fehler beim Aktualisieren des Bereitschaftsstatus',
    leaveRoomError: 'Fehler beim Verlassen des Raums',
    startGameError: 'Fehler beim Starten des Spiels',
  },
  room: {
    createTitle: 'Raum erstellen',
    joinTitle: 'Raum beitreten',
    enterCode: 'Raumcode eingeben',
    createButton: 'Erstellen',
    joinButton: 'Beitreten',
    invalidCode: 'Ungültiger Raumcode',
    roomFull: 'Raum ist voll',
    roomNotFound: 'Raum nicht gefunden',
    alreadyInRoom: 'Du bist bereits in einem Raum',
    createSubtitle: 'Erstelle einen privaten Raum und lade deine Freunde ein',
    joinSubtitle: 'Gib einen 6-stelligen Raumcode ein, um beizutreten',
    shareableCode: 'Du erhältst einen teilbaren Raumcode',
    upTo4Players: 'Bis zu 4 Spieler können beitreten',
    fillWithBots: 'Leere Plätze mit Bots füllen',
    customizeSettings: 'Spieleinstellungen anpassen',
    mustBeSignedIn: 'Du musst angemeldet sein, um einen Raum zu erstellen',
    alreadyInRoomMessage: 'Du bist bereits in Raum {{code}} ({{status}}). Verlassen und neuen Raum erstellen?',
    goToRoom: 'Zum Raum gehen',
    leaveAndCreate: 'Verlassen & Erstellen',
    leaveRoomError: 'Fehler beim Verlassen des Raums',
    leaveTimeout: 'Das Verlassen des Raums dauert länger als erwartet. Bitte versuche es erneut oder warte einen Moment.',
    createRoomError: 'Fehler beim Erstellen des Raums',
    invalidCodeTitle: 'Ungültiger Code',
    alreadyInDifferentRoom: 'Du bist bereits in Raum {{code}}. Verlasse ihn zuerst, um einem anderen Raum beizutreten.',
    goToCurrentRoom: 'Zum aktuellen Raum gehen',
    alreadyInAnotherRoom: 'Du bist bereits in einem anderen Raum. Bitte verlasse ihn zuerst.',
    joinRoomError: 'Fehler beim Beitreten zum Raum',
    tip: 'Tipp',
    askFriendForCode: 'Frage deinen Freund nach dem Raumcode und gib ihn hier ein, um seinem Spiel beizutreten',
  },
  profile: {
    title: 'Profil',
    stats: 'Statistiken',
    gamesPlayed: 'Gespielte Spiele',
    gamesWon: 'Gewonnene Spiele',
    gamesLost: 'Verlorene Spiele',
    winRate: 'Gewinnrate',
    bestStreak: 'Beste Serie',
    totalScore: 'Gesamtpunktzahl',
    rank: 'Rang',
    editProfile: 'Profil bearbeiten',
    signOut: 'Abmelden',
    rankPoints: 'Rangpunkte',
    currentStreak: 'Aktuelle Serie',
    noStatsYet: 'Noch keine Statistiken',
    playFirstGame: 'Spiele dein erstes Spiel, um deine Statistiken zu sehen!',
    accountInfo: 'Kontoinformationen',
    email: 'E-Mail',
    notProvided: 'Nicht angegeben',
    userId: 'Benutzer-ID',
    username: 'Benutzername',
    fullName: 'Vollständiger Name',
    provider: 'Anbieter',
    sessionDetails: 'Sitzungsdetails',
    lastSignIn: 'Letzte Anmeldung',
    createdAt: 'Erstellt am',
    emailConfirmed: 'E-Mail bestätigt',
    signOutConfirm: 'Bist du sicher, dass du dich abmelden möchtest?',
    signOutError: 'Abmeldung fehlgeschlagen. Bitte versuche es erneut.',
    overview: 'Übersicht',
    streaks: 'Serien',
    losses: 'Niederlagen',
    wins: 'Siege',
    performance: 'Leistung',
    totalPoints: 'Gesamtpunktzahl',
    avgPosition: 'Durchschn. Position',
    avgScore: 'Durchschn. Punktzahl',
    highestScore: 'Höchste Punktzahl',
    combosPlayed: 'Gespielte Kombos',
    straights: 'Straßen',
    triples: 'Drillinge',
    pairs: 'Paare',
    singles: 'Einzelne',
    straightFlush: 'Straight Flush',
    fourOfAKind: 'Vierling',
    fullHouses: 'Full Houses',
    flushes: 'Flushes',
    royalFlush: 'Royal Flush',
    recentGames: 'Letzte Spiele',
  },
  leaderboard: {
    title: 'Bestenliste',
    rank: 'Rang',
    player: 'Spieler',
    wins: 'Siege',
    winRate: 'Gewinnrate',
    score: 'Punkte',
    noData: 'Noch keine Bestenlisten-Daten',
    allTime: 'Alle Zeit',
    weekly: 'Wöchentlich',
    daily: 'Täglich',
    winLoss: 'S/N',
    points: 'Punkte',
    winStreak: 'Siegesserie',
    noRankings: 'Noch keine Rankings',
    playToRank: 'Spiele ein paar Spiele, um auf der Bestenliste zu erscheinen!',
  },
  auth: {
    signIn: 'Anmelden',
    signUp: 'Registrieren',
    email: 'E-Mail',
    password: 'Passwort',
    confirmPassword: 'Passwort bestätigen',
    forgotPassword: 'Passwort vergessen?',
    dontHaveAccount: 'Noch kein Konto?',
    alreadyHaveAccount: 'Bereits ein Konto?',
    signInWithGoogle: 'Mit Google anmelden',
    signInWithApple: 'Mit Apple anmelden',
    orContinueWith: 'Oder fortfahren mit',
    agreeToTerms: 'Mit der Registrierung stimmst du unseren Nutzungsbedingungen und Datenschutzrichtlinien zu',
  },
  matchmaking: {
    title: 'Spiel finden',
    searching: 'Suche nach Spielern...',
    initializing: 'Matchmaking wird initialisiert...',
    waiting1: '1 Spieler gefunden, warte auf 3 weitere...',
    waiting2: '2 Spieler gefunden, warte auf 2 weitere...',
    waiting3: '3 Spieler gefunden, warte auf 1 weiteren...',
    matched: 'Spiel gefunden! Starte...',
    beFirst: 'Sei der Erste, der beitritt!',
    onePlayerWaiting: '1 Spieler wartet. Jetzt beitreten!',
    twoPlayersWaiting: '2 Spieler warten. Fast geschafft!',
    threePlayersWaiting: '3 Spieler warten. Einer fehlt noch!',
    startingGame: 'Starte jetzt! 🎮',
    playersInQueue: 'Spieler in der Warteschlange',
    playersNeeded: 'Spieler benötigt',
    howItWorks: 'So funktioniert es',
    description: 'Wir matchen dich mit Spielern ähnlichen Niveaus. Das Spiel startet automatisch, wenn 4 Spieler bereit sind!',
  },
  howToPlay: {
    title: 'Spielanleitung',
    objectiveTitle: '🎯 Ziel',
    objectiveText: 'Sei der erste Spieler, der alle seine Karten loswird. Der letzte Spieler mit Karten verliert.',
    rankOrderLabel: '🃏 Rangfolge (vom niedrigsten zum höchsten):',
    rankOrder: '3, 4, 5, 6, 7, 8, 9, 10, J, Q, K, A, 2',
    suitOrderLabel: '🎴 Farbenrangfolge (bei gleichem Rang):',
    suitOrder: '♦ Karo, ♣ Kreuz, ♥ Herz, ♠ Pik',
    cardNote: 'Hinweis: Die Karo 3 (3♦) ist die schwächste Karte & die Pik 2 (2♠) ist die stärkste!',
    validCombinationsTitle: '🎮 Gültige Kombinationen',
    cardRankingsTitle: '🎴 Kartenrangfolge',
    single: 'Einzelkarte: Eine beliebige einzelne Karte',
    pair: 'Paar: Zwei Karten mit demselben Rang',
    triple: 'Drilling: Drei Karten mit demselben Rang',
    straight: 'Straße: 5 aufeinanderfolgende Karten',
    flush: 'Flush: 5 Karten derselben Farbe',
    fullHouse: 'Full House: Drilling + Paar',
    fourOfAKind: 'Vierling: 4 Karten mit demselben Rang',
    straightFlush: 'Straight Flush: 5 aufeinanderfolgende Karten derselben Farbe',
    singleLabel: '1️⃣ Einzelkarte:',
    singleText: 'Eine beliebige einzelne Karte',
    pairLabel: '2️⃣ Paar:',
    pairText: 'Zwei Karten mit demselben Rang (Beispiel: 7♦ & 7♥)',
    tripleLabel: '3️⃣ Drilling:',
    tripleText: 'Drei Karten mit demselben Rang (Beispiel: Q♣, Q♦, Q♠)',
    fiveCardCombosLabel: '5️⃣ 5-Karten-Kombinationen:',
    straightLabel: '▪ Straße:',
    straightText: '5 aufeinanderfolgende Karten (Beispiel: 5, 6, 7, 8, 9)',
    flushLabel: '▪ Flush:',
    flushText: '5 Karten derselben Farbe',
    fullHouseLabel: '▪ Full House:',
    fullHouseText: 'Drilling + Paar (Beispiel: 8, 8, 8 + K, K)',
    fourOfAKindLabel: '▪ Vierling:',
    fourOfAKindText: '4 Karten mit demselben Rang + beliebige 5. Karte (Beispiel: A, A, A, A + 5)',
    straightFlushLabel: '▪ Straight Flush:',
    straightFlushText: '5 aufeinanderfolgende Karten derselben Farbe (stärkste Kombination!)',
    gameplayTitle: '⚡ Spielablauf',
    gameplayPoint1: '• Der Spieler mit der Karo 3 (3♦) startet die erste Runde',
    gameplayPoint2: '• Du musst denselben Kombinationstyp (Einzelkarte, Paar usw.) spielen, aber höher',
    gameplayPoint3: '• Wenn du nicht kannst oder willst, drücke "Passen"',
    gameplayPoint4: '• Wenn alle Spieler passen, startet der letzte Spieler eine neue Runde',
    gameplayPoint5: '• Spiele weiter, bis ein Spieler alle seine Karten losgeworden ist!',
    startingGame: 'Spielstart: Der Spieler mit der Karo 3 (3♦) startet die erste Runde',
    playingCards: 'Karten spielen: Du musst denselben Kombinationstyp spielen, aber höher',
    passing: 'Passen: Wenn du nicht kannst oder willst, drücke "Passen"',
    leading: 'Führen: Wenn alle Spieler passen, startet der letzte Spieler eine neue Runde',
    winning: 'Gewinnen: Der erste Spieler, der alle Karten loswird, gewinnt!',
    specialRulesTitle: '💡 Spezielle Regeln',
    specialRule1: '• Schwächere 5-Karten-Kombinationen können stärkere nicht schlagen',
    specialRule2: '• Straight Flush > Vierling > Full House > Flush > Straße',
    specialRule3: '• Du kannst die Hilfsschaltflächen (Sortieren, Smart, Hinweis) verwenden, um deine Karten zu ordnen',
    autoPassTimer: 'Auto-Pass-Timer: Bei der höchstmöglichen Karte haben andere Spieler 10 Sekunden zum Reagieren',
    oneCardLeft: 'Eine Karte übrig: Bei 1 verbleibender Karte muss der vorherige Spieler seine höchste Einzelkarte spielen',
    fiveCardCombos: '5-Karten-Kombinationen: Straßen und Flushs können nur von höheren Kombinationen des gleichen Typs geschlagen werden',
    scoringTitle: '🏆 Punktesystem',
    scoringIntro: 'Am Ende jeder Runde erhalten Spieler, die ihre Karten nicht losgeworden sind, Punkte basierend auf ihren verbleibenden Karten:',
    scoring1to4: '1-4 verbleibende Karten: 1 Punkt',
    scoring5to9: '5-9 verbleibende Karten: 2 Punkte',
    scoring10to13: '10-13 verbleibende Karten: 3 Punkte',
    scoring1to7: '• 1-7 verbleibende Karten = 1 Punkt',
    scoring8to10: '• 8-10 verbleibende Karten = 2 Punkte',
    scoring11to12: '• 11-12 verbleibende Karten = 3 Punkte',
    scoringWarning: 'Warnung: Der erste Spieler, der über 100 Punkte erreicht, verliert das Spiel! Der Spieler mit der niedrigsten Punktzahl gewinnt.',
    letsPlay: 'Los geht\'s!',
    // ELO Rating System
    eloSystemTitle: '🏆 ELO-Bewertungssystem',
    eloSystemDesc: 'Ihre ELO-Bewertung misst Ihr Fähigkeitsniveau. Sie steigt, wenn Sie gewinnen, und sinkt, wenn Sie in gewerteten Spielen verlieren. Casual-Spiele beeinflussen Ihre ELO nicht.',
    eloFormula: 'ELO-Änderungen werden mit der Schachbewertungsformel mit K-Faktor=32 berechnet. Gewinnen gegen höher bewertete Gegner gibt mehr Punkte.',
    rankTiersTitle: 'Rangstufen:',
    // Reconnection & Disconnection
    reconnectionTitle: '🔄 Wiederverbindung & Trennung',
    reconnectionDesc: 'Wenn Sie während eines Spiels die Verbindung verlieren, haben Sie 15 Sekunden Zeit, um sich wieder zu verbinden, bevor ein Bot Sie ersetzt.',
    disconnectGrace: '⏱️ Kulanzfrist: 15 Sekunden, um Ihre App fortzusetzen und Ihre Position wiederherzustellen.',
    botReplacement: '🤖 Bot-Ersatz: Nach 15 Sekunden spielt ein Bot mit Ihren aktuellen Karten für Sie.',
    spectatorMode: '👁️ Zuschauermodus: Wenn Sie sich nach dem Bot-Ersatz wieder verbinden, können Sie das Spiel ansehen, aber nicht spielen.',
  },
};

// Translation map
const translations: Record<Language, Translations> = {
  en,
  ar,
  de,
};

// Current language state
let currentLanguage: Language = 'en';
let currentTranslations: Translations = translations.en;

/**
 * i18n Manager class
 */
class I18nManager {
  /**
   * Initialize i18n system
   * Loads user's preferred language from AsyncStorage
   */
  async initialize(): Promise<void> {
    try {
      const savedLanguage = await AsyncStorage.getItem(LANGUAGE_KEY);
      if (savedLanguage && (savedLanguage === 'en' || savedLanguage === 'ar' || savedLanguage === 'de')) {
        currentLanguage = savedLanguage;
        currentTranslations = translations[currentLanguage];
        
        // Configure RTL if Arabic
        if (currentLanguage === 'ar' && !RNI18nManager.isRTL) {
          RNI18nManager.forceRTL(true);
          // Note: Requires app restart to take effect
        } else if (currentLanguage !== 'ar' && RNI18nManager.isRTL) {
          RNI18nManager.forceRTL(false);
        }
      }
      console.log('[i18n] Initialized with language:', currentLanguage);
    } catch (error) {
      console.error('[i18n] Failed to load language:', error);
    }
  }

  /**
   * Get current language
   */
  getLanguage(): Language {
    return currentLanguage;
  }

  /**
   * Change language
   * Note: Changing to/from Arabic requires app restart for RTL changes
   */
  async setLanguage(language: Language): Promise<boolean> {
    try {
      await AsyncStorage.setItem(LANGUAGE_KEY, language);
      currentLanguage = language;
      currentTranslations = translations[language];
      
      // Check if RTL change is needed
      const needsRTL = language === 'ar';
      const requiresRestart = needsRTL !== RNI18nManager.isRTL;
      
      if (requiresRestart) {
        RNI18nManager.forceRTL(needsRTL);
      }
      
      console.log('[i18n] Language changed to:', language, { requiresRestart });
      return requiresRestart; // Return true if app restart is needed
    } catch (error) {
      console.error('[i18n] Failed to set language:', error);
      return false;
    }
  }

  /**
   * Get current translations
   */
  getTranslations(): Translations {
    return currentTranslations;
  }

  /**
   * Get translation for a specific key path
   * Supports template variable replacement: {{key}}
   * @param path Translation key path (e.g., 'room.alreadyInRoomMessage')
   * @param vars Optional variables to replace in template (e.g., { code: 'ABC123', status: 'waiting' })
   */
  t(path: string, vars?: Record<string, string | number>): string {
    const keys = path.split('.');
    let value: any = currentTranslations;
    
    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        console.warn(`[i18n] Translation not found: ${path}`);
        return path;
      }
    }
    
    let result = typeof value === 'string' ? value : path;
    
    // Replace template variables like {{code}}, {{status}}, etc.
    if (vars && typeof result === 'string') {
      Object.keys(vars).forEach(key => {
        const placeholder = `{{${key}}}`;
        result = result.replace(new RegExp(placeholder, 'g'), String(vars[key]));
      });
    }
    
    return result;
  }
}

// Export singleton instance
export const i18n = new I18nManager();

// Export hook for React components
export function useTranslation() {
  return {
    t: (path: string) => i18n.t(path),
    language: currentLanguage,
    translations: currentTranslations,
  };
}
