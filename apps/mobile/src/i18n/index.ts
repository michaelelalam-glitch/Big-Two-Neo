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
    leaderboard: string;
    profile: string;
    currentRoom: string;
    leave: string;
    leftRoom: string;
    leaveRoomConfirm: string;
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
    
    accountManagement: 'Account Management',
    clearCache: 'Clear Cache',
    clearCacheDescription: 'Free up storage space',
    clearCacheConfirm: 'Clear all cached data?',
    clearCacheSuccess: 'Cache cleared successfully',
    deleteAccount: 'Delete Account',
    deleteAccountDescription: 'Permanently delete your account',
    deleteAccountWarning: 'This action cannot be undone. All your data will be permanently deleted.',
    deleteAccountConfirm: 'Are you sure you want to delete your account?',
    
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
    leaderboard: '🏆 Leaderboard',
    profile: 'Profile',
    currentRoom: 'Currently in room',
    leave: 'Leave',
    leftRoom: 'Left the room',
    leaveRoomConfirm: 'Leave room?',
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
    
    accountManagement: 'إدارة الحساب',
    clearCache: 'مسح ذاكرة التخزين المؤقت',
    clearCacheDescription: 'حرر مساحة التخزين',
    clearCacheConfirm: 'مسح جميع البيانات المخزنة مؤقتًا؟',
    clearCacheSuccess: 'تم مسح ذاكرة التخزين المؤقت بنجاح',
    deleteAccount: 'حذف الحساب',
    deleteAccountDescription: 'احذف حسابك نهائيًا',
    deleteAccountWarning: 'لا يمكن التراجع عن هذا الإجراء. سيتم حذف جميع بياناتك نهائيًا.',
    deleteAccountConfirm: 'هل أنت متأكد أنك تريد حذف حسابك؟',
    
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
    gamesLost: 'الألعاب المفقودة',
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
    
    accountManagement: 'Kontoverwaltung',
    clearCache: 'Cache leeren',
    clearCacheDescription: 'Speicherplatz freigeben',
    clearCacheConfirm: 'Alle zwischengespeicherten Daten löschen?',
    clearCacheSuccess: 'Cache erfolgreich geleert',
    deleteAccount: 'Konto löschen',
    deleteAccountDescription: 'Ihr Konto dauerhaft löschen',
    deleteAccountWarning: 'Diese Aktion kann nicht rückgängig gemacht werden. Alle Ihre Daten werden dauerhaft gelöscht.',
    deleteAccountConfirm: 'Sind Sie sicher, dass Sie Ihr Konto löschen möchten?',
    
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
    gamesLost: 'Verlorene Spiele',
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
