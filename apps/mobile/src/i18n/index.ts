/**
 * i18n System
 *
 * Provides internationalization support for the Stephanos app.
 * Supports: English (EN), Arabic (AR), German (DE)
 */

import { I18nManager as RNI18nManager } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { uiLogger } from '../utils/logger';

// Storage key
const LANGUAGE_KEY = '@stephanos_language';

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
    disable: string;
    submit: string;
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
    continue: string;
    tryAgain: string;
    connected: string;
    reconnecting: string;
    disconnected: string;
    replacedByBot: string;
  };

  // In-game chat controls
  chat: {
    joinVoice: string;
    leaveVoice: string;
    joinVideo: string;
    leaveVideo: string;
    muted: string;
    camera: string;
    microphone: string;
    audio: string;
    video: string;
    sectionTitle: string;
    connectingVideo: string;
    connectingVoice: string;
    tapTurnCameraOff: string;
    tapTurnCameraOn: string;
    tapMute: string;
    tapUnmute: string;
    // Accessibility labels for mic toggle
    muteMicrophone: string;
    unmuteMicrophone: string;
    microphoneOn: string;
    microphoneOff: string;
    // Phase 4 — permission UX
    cameraPermissionTitle: string;
    cameraPermissionMessage: string;
    micPermissionTitle: string;
    micPermissionMessage: string;
    permissionDeniedCameraTitle: string;
    permissionDeniedCameraMessage: string;
    permissionDeniedMicTitle: string;
    permissionDeniedMicMessage: string;
    openSettings: string;
    connectFailedTitle: string;
    connectFailedMessage: string;
    voiceConnectFailedTitle: string;
    voiceConnectFailedMessage: string;
    devBuildRequiredTitle: string;
    devBuildRequiredMessage: string;
    // Task #648 — text chat
    title: string;
    placeholder: string;
    send: string;
    noMessages: string;
    cooldown: string;
    // Task #628 — accessibility labels for chat toggle button
    a11yToggleLabel: string;
    a11yToggleHint: string;
  };

  // Game Selection Screen
  gameSelection: {
    welcome: string;
    subtitle: string;
    lebanesePokerTitle: string;
    lebanesePokerDesc: string;
    playButton: string;
    lebaneseDealTitle: string;
    lebaneseDealDesc: string;
    soonButton: string;
    moreGamesFooter: string;
    comingSoonAlertTitle: string;
    comingSoonAlertMsg: string;
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
    profilePhotoSize: string;
    profilePhotoSizeDescription: string;
    profilePhotoSizeSmall: string;
    profilePhotoSizeMedium: string;
    profilePhotoSizeLarge: string;

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
    stayUpdatedNotifications: string;
    enableNotifications: string;
    enableNotificationsDescription: string;
    notificationTypes: string;
    gameInvites: string;
    gameInvitesDescription: string;
    yourTurn: string;
    yourTurnDescription: string;
    gameStarted: string;
    gameStartedDescription: string;
    friendRequests: string;
    friendRequestsDescription: string;
    testing: string;
    sendTestNotification: string;
    debugInfo: string;
    pushToken: string;
    userIdLabel: string;
    platformLabel: string;

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
    clearCacheFailed: string;
    openLinkFailed: string;
    notificationsEnabledSuccess: string;
    permissionsRequired: string;
    permissionsMessage: string;
    openSettingsButton: string;
    disableNotificationsTitle: string;
    disableNotificationsMessage: string;
    enableNotificationsFirst: string;
    notificationsDisabledTitle: string;
    testNotificationSentMessage: string;
    testNotificationSentTitle: string;
    testNotificationFailed: string;

    // About
    version: string;
    termsOfService: string;
    privacyPolicy: string;
    support: string;

    // Data & Privacy
    dataPrivacy: string;
    analyticsTracking: string;
    analyticsTrackingDescription: string;

    // Bug Report
    bugReport: string;
    reportABug: string;
    bugReportPromptTitle: string;
    bugReportPromptMessage: string;
    bugReportUnavailable: string;
    bugReportSubmitted: string;
    bugReportAndroidTitle: string;
    bugReportAndroidMessage: string;
  };

  // Android notification channel names (P11-1)
  notificationChannels: {
    default: string;
    gameUpdates: string;
    turnNotifications: string;
    social: string;
  };

  // P11-M2: Push notification content strings (used by pushNotificationTriggers.ts)
  pushContent: {
    gameStartingTitle: string;
    gameStartingBody: string;
    yourTurnTitle: string;
    yourTurnBody: string;
    victoryTitle: string;
    victoryBody: string;
    gameOverTitle: string;
    gameOverBody: string;
    roomInviteTitle: string;
    roomInviteBody: string;
    playerJoinedTitle: string;
    playerJoinedBody: string;
    timeRunningOutTitle: string;
    timeRunningOutBody: string;
    readyToStartTitle: string;
    readyToStartBody: string;
    friendRequestTitle: string;
    friendRequestBody: string;
    friendAcceptedTitle: string;
    friendAcceptedBody: string;
  };

  // Bug Report Modal
  bugReportModal: {
    title: string;
    categoryLabel: string;
    categoryBug: string;
    categorySuggestion: string;
    categoryPerformance: string;
    categoryCrash: string;
    categoryOther: string;
    descriptionLabel: string;
    descriptionPlaceholder: string;
    descriptionRequired: string;
    screenshotLabel: string;
    attachScreenshot: string;
    removeScreenshot: string;
    photoPermissionDenied: string;
    screenshotUnavailable: string;
    includeLogLabel: string;
    includeLogDescription: string;
  };

  // Home Screen
  home: {
    title: string;
    welcome: string;
    findMatch: string;
    findMatchDescription: string;
    quickPlay: string;
    quickPlayDescription: string;
    createRoom: string;
    createRoomDescription: string;
    joinRoom: string;
    joinRoomDescription: string;
    howToPlay: string;
    howToPlayDescription: string;
    roomClosedTitle: string;
    roomClosedMessage: string;
    joinCasualLobby: string;
    leaderboard: string;
    rankedLeaderboard: string;
    rankedLeaderboardDescription: string;
    profile: string;
    currentRoom: string;
    leave: string;
    leftRoom: string;
    leaveRoomConfirm: string;
    casualMatch: string;
    casualMatchDescription: string;
    rankedMatch: string;
    rankedMatchDescription: string;
    findGame: string;
    findGameDescription: string;
    offlinePractice: string;
    offlinePracticeDescription: string;
    botDifficultyTitle: string;
    botDifficultySubtitle: string;
    easy: string;
    easyDesc: string;
    medium: string;
    mediumDesc: string;
    hard: string;
    hardDesc: string;
    chooseGameMode: string;
    noGameInProgress: string;
    startNewGameHint: string;
    activeOnlineGame: string;
    activeOfflineGame: string;
    inProgress: string;
    waitingStatus: string;
    rejoin: string;
    replaceBotAndRejoin: string;
    cancelSearch: string;
    findingRankedMatch: string;
    offlineMatchSubtitle: string;
    botReplacingYou: string;
    beforeBotReplaces: string;
    botPlayingForYou: string;
    roomClosedError: string;
    roomCheckError: string;
    reportBug: string;
  };
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
    noteText?: string; // For non-English
    validCombinationsTitle: string;
    combinationsTitle?: string; // For non-English
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
    noCards: string;
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
    cardNotInHand: string;
    firstPlayMustInclude3D: string;
    oneCardLeftMustPlayHighestSingle: string;
    mustPlayHigher: string;
    autoPassTimer: string;
    secondsRemaining: string;
    autoPassHighestPlay: string;
    autoPassNoOneCanBeat: string;
    autoPassInlineMessage: string;
    invalidMoveTitle: string;
    cannotPassTitle: string;
    cannotPassMessage: string;
    settings: string;
    leaveGame: string;
    leaveGameConfirm: string;
    leaveGameMessage: string;
    stay: string;
    spectatorMode: string;
    spectatorDescription: string;
    initializingGame: string;
    settingUpEngine: string;
    matchHistoryTitle: string;
    finalScoresTitle: string;
    matchColumn: string;
    totalRow: string;
    pastMatchesHeader: string;
    matchNum: string;
    matchCurrentLabel: string;
    noPlaysRecorded: string;
    noCardsThisMatch: string;
    cardsWillAppear: string;
    noPlayHistoryYet: string;
    dragToPlayHint: string;
    dropZoneRelease: string;
    dropZoneReleaseMultiple: string;
    dropZoneDrop: string;
    // Helper button messages
    hintNoValidPlay: string;
    // Throwables
    throwPickerTitle: string;
    throwItemAction: string;
    throwEgg: string;
    throwSmoke: string;
    throwConfetti: string;
    throwCake: string;
    throwSplatEgg: string;
    throwSplatSmoke: string;
    throwSplatConfetti: string;
    throwSplatCake: string;
    throwAtYou: string;
    throwDismissHint: string;
    throwAtPickerTitle: string;
    positionTop: string;
    positionLeft: string;
    positionRight: string;
    // RejoinModal
    botReplacedYouTitle: string;
    botReplacedYouBody: string;
    botReplacedYouBodyWithBot: string;
    botReplacedYouInstruction: string;
    reclaimMySeat: string;
    watchGame: string;
    seatReclaimed: string;
    leaveRoom: string;
    // TurnAutoPlayModal
    autoPlayedForYouTitle: string;
    autoPlayedPlay: string;
    autoPlayedPass: string;
    areYouStillHere: string;
    tapBelowOrDisconnect: string;
    imStillHere: string;
    secondsRemainingTimer: string;
    autoPlayedLabel: string;
    cardSingular: string;
    cardPlural: string;
    botTurnErrorTitle: string;
    botTurnErrorMessage: string;
    scoreboardError: string;
    scoreboardErrorMessage: string;
    scoreboardRetryHint: string;
    // P11-L1: Accessibility labels for GameView toolbar buttons
    a11yViewPlayHistory: string;
    a11yToggleScoreboard: string;
    a11yOpenSettings: string;
    a11yToggleOrientation: string;
    a11yPlayHistoryHint: string;
    a11yScoreboardHint: string;
    a11ySettingsHint: string;
    a11yOrientationHint: string;
  };

  // Game End Modal
  gameEnd: {
    gameWinner: string;
    finalStandings: string;
    scoreHistory: string;
    playHistory: string;
    shareResults: string;
    copyResults: string;
    copyResultsSuccess: string;
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
    shareResultsTitle: string;
    shareError: string;
    shareErrorMessage: string;
    restartError: string;
    restartErrorMessage: string;
    leaveError: string;
    leaveErrorMessage: string;
    matchesPlayed: string;
    oneMatch: string;
    collapseAll: string;
    expandAll: string;
    card: string;
    cards: string;
  };

  // Card accessibility labels (H11 — VoiceOver/TalkBack i18n for suits and ranks)
  cardA11y: {
    hearts: string;
    diamonds: string;
    clubs: string;
    spades: string;
    ace: string;
    king: string;
    queen: string;
    jack: string;
    ten: string;
    nine: string;
    eight: string;
    seven: string;
    six: string;
    five: string;
    four: string;
    three: string;
    two: string;
    selected: string;
    /** Template: '{{rank}} of {{suit}}' */
    cardLabel: string;
    /** Template: '{{rank}} of {{suit}}, selected' — localized selected-card label */
    selectedCardLabel: string;
    /** Hint shown when card is not selected (or only this card is selected) */
    hintSelectDeselect: string;
    /** Hint shown when card is selected and multiple cards are selected */
    hintDeselectMulti: string;
    /** Accessibility action label to select a card */
    actionSelect: string;
    /** Accessibility action label to deselect a card */
    actionDeselect: string;
    /** Accessibility action label for long press */
    actionLongPress: string;
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
    copy: string;
    share: string;
    codeCopied: string;
    copiedTitle: string;
    copiedMessage: string;
    copyFailedTitle: string;
    copyFailedMessage: string;
    shareTitle: string;
    shareMessage: string;
    minPlayers: string;
    inviteFriends: string;
    emptySlot: string;
    you: string;
    readyUp: string;
    starting: string;
    startWithBots: string;
    startWithBotsCount: string;
    humanPlayers: string;
    botsNeeded: string;
    casualMatch: string;
    casualRoomInfo: string;
    hostInfo: string;
    waitingForHost: string;
    onlyHostCanStart: string;
    playerDataNotFound: string;
    createPlayerError: string;
    loadPlayersError: string;
    readyStatusError: string;
    leaveRoomError: string;
    startGameError: string;
    notAllPlayersReady: string;
    shareError: string;
    shareErrorMessage: string;
    rankedRequirement: string;
    waitingForMorePlayers: string;
    allReadyToStart: string;
    botDifficultyLabel: string;
    easy: string;
    medium: string;
    hard: string;
    rankedMatch: string;
    privateRoom: string;
    confirmLeaveTitle: string;
    confirmLeaveHost: string;
    confirmLeaveReady: string;
    confirmLeaveMessage: string;
    confirmLeaveYes: string;
    confirmLeaveNo: string;
    kickedTitle: string;
    kickedByHostMessage: string;
    kickedDisconnectedMessage: string;
    kickedInactivityMessage: string;
    kickPlayerTitle: string;
    kickPlayerMessage: string;
    kickPlayerConfirm: string;
    kickPlayerError: string;
    kickPlayer: string;
    tooManyPlayers: string;
    noPlayersError: string;
  };
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
    leaveAndJoin: string;
    leaveRoomError: string;
    leaveTimeout: string;
    createRoomError: string;
    invalidCodeTitle: string;
    alreadyInDifferentRoom: string;
    goToCurrentRoom: string;
    alreadyInAnotherRoom: string;
    joinRoomError: string;
    kickedFromRoom: string;
    kickedFromRoomByHost: string;
    tip: string;
    askFriendForCode: string;
    createRoomRateLimited: string;
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
    viewFullStats: string;
    lowestScore: string;
    avgCardsLeft: string;
    gameCompletion: string;
    rankProgression: string;
    completed: string;
    abandoned: string;
    voided: string;
    private: string;
    casualStats: string;
    privateStats: string;
    rankedStats: string;
    peak: string;
    lowest: string;
    win: string;
    loss: string;
    totalGames: string;
    currentPoints: string;
    peakPoints: string;
    rankPointsProgression: string;
    historyTabRecent: string;
    historyTabWon: string;
    historyTabLost: string;
    historyTabIncomplete: string;
    historyEmptyRecent: string;
    historyEmptyWon: string;
    historyEmptyLost: string;
    historyEmptyIncomplete: string;
    mutualFriends: string;
    mutualFriendsLabel: string;
    mutualFriendsLabelOne: string;
    mutualFriendsLabelMany: string;
    noMutualFriends: string;
    unknownPlayer: string;
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
    rankedTitle: string;
    filter: string;
    matches: string;
    noRankedPlayers: string;
    playRankedMatches: string;
  };

  // Auth Screens
  auth: {
    signIn: string;
    signUp: string;
    welcomeTitle: string;
    welcomeSubtitle: string;
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
    // Match Type Preferences (Phase 4b)
    selectMatchType: string;
    casual: string;
    ranked: string;
    casualDesc: string;
    rankedDesc: string;
    shareWithFriends: string;
    friendsCanJoin: string;
    signInRequired: string;
    queueExpiresIn: string;
  };

  // Match History Screen
  matchHistory: {
    title: string;
    noMatches: string;
    playFirstMatch: string;
    position: string;
    /** Shown instead of a placement when final_position === 0 (voided/abandoned). */
    abandoned: string;
    elo: string;
    justNow: string;
    minutesAgo: string;
    hoursAgo: string;
    daysAgo: string;
    local: string;
  };

  // Friends & Social
  friends: {
    title: string;
    myFriends: string;
    requests: string;
    noFriends: string;
    noPending: string;
    addFriend: string;
    added: string;
    alreadyFriends: string;
    tapToSendFriendRequest: string;
    requestPending: string;
    requestSent: string;
    cancelRequest: string;
    accept: string;
    decline: string;
    unfriend: string;
    favorite: string;
    unfavorite: string;
    online: string;
    offline: string;
    sendInvite: string;
    unknownPlayer: string;
    friendRequest: string;
    sentYouARequest: string;
    requestAlreadyHandled: string;
    throttle: string;
    requestReceived: string;
    inviteFriends: string;
    noFriendsToInvite: string;
    searchPlaceholder: string;
    noResults: string;
    clearSearch: string;
  };

  notifications: {
    title: string;
    empty: string;
    clearAll: string;
    justNow: string;
    bellLabel: string;
    bellLabelWithCount: string;
    bellHint: string;
  };

  // Ranked Leaderboard
}

// English translations (default)
const en: Translations = {
  common: {
    ok: 'OK',
    cancel: 'Cancel',
    save: 'Save',
    delete: 'Delete',
    confirm: 'Confirm',
    disable: 'Disable',
    submit: 'Submit',
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
    continue: 'Continue',
    tryAgain: 'Try Again',
    connected: 'Connected',
    reconnecting: 'Reconnecting...',
    disconnected: 'Disconnected',
    replacedByBot: 'Replaced by Bot',
  },
  chat: {
    joinVoice: 'Join Voice Chat',
    leaveVoice: 'Leave Voice Chat',
    joinVideo: 'Join Video Chat',
    leaveVideo: 'Leave Video Chat',
    muted: 'Muted',
    camera: 'Camera',
    microphone: 'Microphone',
    audio: 'Audio',
    video: 'Video',
    sectionTitle: 'Chat',
    connectingVideo: 'Connecting to video chat',
    connectingVoice: 'Connecting to voice chat',
    tapTurnCameraOff: 'tap to turn camera off',
    tapTurnCameraOn: 'tap to turn camera on',
    tapMute: 'tap to mute',
    tapUnmute: 'tap to unmute',
    muteMicrophone: 'Mute microphone',
    unmuteMicrophone: 'Unmute microphone',
    microphoneOn: 'Microphone on',
    microphoneOff: 'Microphone off',
    // Phase 4 — permission UX
    cameraPermissionTitle: 'Camera Access',
    cameraPermissionMessage: 'Stephanos needs camera access to show your video to other players.',
    micPermissionTitle: 'Microphone Access',
    micPermissionMessage: 'Stephanos needs microphone access so other players can hear you.',
    permissionDeniedCameraTitle: 'Camera Permission Denied',
    permissionDeniedCameraMessage:
      'Camera access was denied. To enable video chat, open Settings and allow camera access for Stephanos.',
    permissionDeniedMicTitle: 'Microphone Permission Denied',
    permissionDeniedMicMessage:
      'Microphone access was denied. To enable voice chat, open Settings and allow microphone access for Stephanos.',
    openSettings: 'Open Settings',
    connectFailedTitle: 'Video Chat Unavailable',
    connectFailedMessage:
      'Could not connect to the video chat room. Please check your connection and try again.',
    voiceConnectFailedTitle: 'Voice Chat Unavailable',
    voiceConnectFailedMessage:
      'Could not connect to the voice chat room. Please check your connection and try again.',
    devBuildRequiredTitle: 'Dev Build Required',
    devBuildRequiredMessage:
      'Voice and video chat require native WebRTC modules that are not available in this build.',
    // Task #648 — text chat
    title: 'Chat',
    placeholder: 'Type a message…',
    send: 'Send',
    noMessages: 'No messages yet. Say hi!',
    cooldown: 'Wait…',
    // Task #628 — accessibility labels for chat toggle button
    a11yToggleLabel: 'Open chat',
    a11yToggleHint: 'Opens or closes the in-game text chat drawer',
  },
  gameSelection: {
    welcome: 'Welcome,',
    subtitle: 'Choose a game to play',
    lebanesePokerTitle: 'Lebanese Poker',
    lebanesePokerDesc: 'Lebanese Poker — the classic card game.\nPlay online or against bots.',
    playButton: 'PLAY →',
    lebaneseDealTitle: 'Lebanese Deal',
    lebaneseDealDesc: 'A brand-new card game experience.\nStay tuned for the launch!',
    soonButton: 'SOON',
    moreGamesFooter: 'More games coming in future updates',
    comingSoonAlertTitle: '🚧 Coming Soon!',
    comingSoonAlertMsg: 'Lebanese Deal is currently in development. Stay tuned!',
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
    profilePhotoSize: 'Profile Photo Size',
    profilePhotoSizeDescription: 'Size of profile photos in-game',
    profilePhotoSizeSmall: 'Small',
    profilePhotoSizeMedium: 'Medium',
    profilePhotoSizeLarge: 'Large',

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
    pushNotificationsDescription: 'Receive push notifications for game events',
    stayUpdatedNotifications: 'Stay updated with game invites, turn notifications, and more.',
    enableNotifications: 'Enable Notifications',
    enableNotificationsDescription: 'Receive push notifications for game events',
    notificationTypes: 'Notification Types',
    gameInvites: 'Game Invites',
    gameInvitesDescription: 'Get notified when someone invites you to a game',
    yourTurn: 'Your Turn',
    yourTurnDescription: "Get notified when it's your turn to play",
    gameStarted: 'Game Started',
    gameStartedDescription: 'Get notified when a game you joined starts',
    friendRequests: 'Friend Requests',
    friendRequestsDescription: 'Get notified when someone sends you a friend request',
    testing: 'Testing',
    sendTestNotification: 'Send Test Notification',
    debugInfo: 'Debug Info',
    pushToken: 'Push Token:',
    userIdLabel: 'User ID:',
    platformLabel: 'Platform:',

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
    deleteAccountWarning:
      'This action cannot be undone. All your data will be permanently deleted.',
    deleteAccountConfirm: 'Are you sure you want to delete your account?',
    noUserLoggedIn: 'No user logged in',
    deleteAccountFailed: 'Failed to delete account. Please contact support.',
    accountDeletedSuccess: 'Account deleted successfully',
    profileComingSoonDescription:
      'Profile visibility and online status will be available with online multiplayer!',
    autoPassTimerBanner:
      'ℹ️ Note: Game currently uses a fixed 10-second timer. Custom durations coming soon!',
    clearCacheFailed: 'Failed to clear cache',
    openLinkFailed: 'Failed to open link',
    notificationsEnabledSuccess: 'Push notifications have been enabled!',
    permissionsRequired: 'Permissions Required',
    permissionsMessage:
      'Please enable notifications in your device settings to receive game updates.',
    openSettingsButton: 'Open Settings',
    disableNotificationsTitle: 'Disable Notifications',
    disableNotificationsMessage:
      'Are you sure you want to disable push notifications? You will not receive game invites or turn notifications.',
    enableNotificationsFirst: 'Please enable notifications first.',
    notificationsDisabledTitle: 'Notifications Disabled',
    testNotificationSentMessage: 'You should receive a notification in 2 seconds!',
    testNotificationSentTitle: 'Test Notification Sent',
    testNotificationFailed: 'Failed to send test notification.',

    version: 'Version',
    termsOfService: 'Terms of Service',
    privacyPolicy: 'Privacy Policy',
    support: 'Support',

    dataPrivacy: 'Data & Privacy',
    analyticsTracking: 'Analytics & Crash Reporting',
    analyticsTrackingDescription: 'Help improve the app by sharing anonymous usage data',

    bugReport: 'Bug Report',
    reportABug: 'Report a Bug',
    bugReportPromptTitle: 'Report a Bug',
    bugReportPromptMessage: 'Describe the issue you encountered:',
    bugReportUnavailable: 'Bug reporting is currently unavailable.',
    bugReportSubmitted: 'Bug report submitted. Thank you!',
    bugReportAndroidTitle: 'Report a Bug',
    bugReportAndroidMessage:
      'To report a bug, please email support@stephanos.app with a description of the issue.',
  },
  notificationChannels: {
    default: 'Default',
    gameUpdates: 'Game Updates',
    turnNotifications: 'Turn Notifications',
    social: 'Social',
  },
  pushContent: {
    gameStartingTitle: '🎮 Game Starting!',
    gameStartingBody: 'Your game in room {{roomCode}} is beginning. Good luck!',
    yourTurnTitle: '⏰ Your Turn!',
    yourTurnBody: "It's your turn to play in room {{roomCode}}",
    victoryTitle: '🎉 Victory!',
    victoryBody: 'Congratulations! You won in room {{roomCode}}!',
    gameOverTitle: '🏁 Game Over',
    gameOverBody: '{{winnerName}} won the game in room {{roomCode}}',
    roomInviteTitle: '🎴 Room Invite',
    roomInviteBody: '{{inviterName}} invited you to join room {{roomCode}}',
    playerJoinedTitle: '👋 Player Joined',
    playerJoinedBody: '{{joinerName}} joined room {{roomCode}}',
    timeRunningOutTitle: '⚠️ Time Running Out!',
    timeRunningOutBody: '{{seconds}}s left to play in room {{roomCode}}',
    readyToStartTitle: '✅ Ready to Start',
    readyToStartBody: 'All players are ready in room {{roomCode}}. You can start the game!',
    friendRequestTitle: '👋 Friend Request',
    friendRequestBody: '{{senderName}} sent you a friend request',
    friendAcceptedTitle: '🤝 Friend Request Accepted',
    friendAcceptedBody: '{{accepterName}} accepted your friend request',
  },
  bugReportModal: {
    title: 'Report a Bug',
    categoryLabel: 'Category',
    categoryBug: 'Bug',
    categorySuggestion: 'Suggestion',
    categoryPerformance: 'Performance',
    categoryCrash: 'Crash',
    categoryOther: 'Other',
    descriptionLabel: 'Description',
    descriptionPlaceholder: 'Describe the issue or suggestion in detail…',
    descriptionRequired: 'Please enter a description.',
    screenshotLabel: 'Screenshot (optional)',
    attachScreenshot: '📎 Attach Screenshot',
    removeScreenshot: 'Remove',
    photoPermissionDenied: 'Photo library access is required to attach a screenshot.',
    screenshotUnavailable:
      'Screenshot attachment is not available in this build. Please rebuild the app to enable it.',
    includeLogLabel: 'Include Console Log',
    includeLogDescription: "Attach today's app log to help diagnose the issue.",
  },
  home: {
    title: 'Stephanos',
    welcome: 'Welcome',
    findMatch: '🎯 Find Match (NEW!)',
    findMatchDescription: 'Quick 4-player match with skill-based pairing',
    quickPlay: '⚡ Quick Play',
    quickPlayDescription: 'Join a random game',
    createRoom: '➕ Create Room',
    createRoomDescription: 'Host a private game',
    joinRoom: '🔗 Join Room',
    joinRoomDescription: 'Enter a room code',
    howToPlay: '📖 How to Play',
    howToPlayDescription: 'Learn the rules',
    roomClosedTitle: 'Room Closed',
    roomClosedMessage: 'The room you were in has been closed by the host.',
    joinCasualLobby: 'Join Casual Lobby',
    leaderboard: '🏆 Leaderboard',
    rankedLeaderboard: '🏆 Ranked Leaderboard',
    rankedLeaderboardDescription: 'See top players by ELO rating',
    profile: 'Profile',
    currentRoom: 'Currently in room',
    leave: 'Leave',
    leftRoom: 'Left the room',
    leaveRoomConfirm: 'Leave room?',
    casualMatch: 'Casual Match',
    casualMatchDescription: 'Quick game with relaxed ranking',
    rankedMatch: 'Ranked Match',
    rankedMatchDescription: 'Competitive ELO-rated match',
    findGame: '🎮 Find a Game',
    findGameDescription: 'Play online matches',
    offlinePractice: '🤖 Offline Practice',
    offlinePracticeDescription: 'Play with 3 AI bots',
    botDifficultyTitle: '🤖 Bot Difficulty',
    botDifficultySubtitle: 'Choose how smart the bots will be',
    easy: 'Easy',
    easyDesc: 'Bots make mistakes and pass often. Great for learning!',
    medium: 'Medium',
    mediumDesc: 'Balanced play with basic strategy. A fair challenge.',
    hard: 'Hard',
    hardDesc: 'Optimal play with advanced combos. Think you can win?',
    chooseGameMode: 'Choose your game mode',
    noGameInProgress: 'No Game in Progress',
    startNewGameHint: 'Start a new game to play!',
    activeOnlineGame: 'Active Online Game',
    activeOfflineGame: 'Active Offline Game',
    inProgress: 'In Progress',
    waitingStatus: 'Waiting',
    rejoin: '🔄 Rejoin',
    replaceBotAndRejoin: '🔄 Replace Bot & Rejoin',
    cancelSearch: '❌ Cancel Search',
    findingRankedMatch: '🔍 Finding ranked match...',
    offlineMatchSubtitle: 'Match {{match}} · vs AI',
    botReplacingYou: 'Bot replacing you...',
    beforeBotReplaces: '⏱ {{seconds}}s before bot replaces you',
    botPlayingForYou: '🤖 A bot is playing for you',
    roomClosedError: 'Room is no longer available',
    roomCheckError: 'Failed to check room status',
    reportBug: 'Report a bug',
  },
  howToPlay: {
    title: '📖 How to Play Stephanos',
    objectiveTitle: 'Objective',
    objectiveText: 'Be the first player to play all your cards.',
    cardRankingsTitle: 'Card Rankings',
    rankOrderLabel: 'Rank Order (lowest to highest):',
    rankOrder: '3, 4, 5, 6, 7, 8, 9, 10, J, Q, K, A, 2',
    suitOrderLabel: 'Suit Order (lowest to highest):',
    suitOrder: '♦ Diamonds, ♣ Clubs, ♥ Hearts, ♠ Spades',
    cardNote:
      'Note: The 3 of Diamonds (3♦) is the lowest card & the 2 of Spades (2♠) is the highest!',
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
    startingGame:
      'Starting the Game: The player with 3♦ must play it (either alone or in a combination).',
    playingCards:
      'Playing Cards: Each player must play a higher combination of the same type (e.g., pair beats pair).',
    passing: 'Passing: If you can\'t or don\'t want to play, click "Pass".',
    leading:
      'Leading: When everyone passes, the last player to play cards starts a new round with any valid combination.',
    winning: 'Winning: First player to empty their hand wins the match and starts the next match!',
    specialRulesTitle: 'Special Rules',
    autoPassTimer:
      'Auto-Pass Timer: When the highest possible card/combo is played, other players have 10 seconds to respond or will auto-pass.',
    oneCardLeft:
      'One Card Left: When a player has 1 card remaining, the player who plays immediately before them (in turn order) MUST play their highest single card if they are playing a single. Pairs, triples, and 5-card combos are not restricted.',
    fiveCardCombos:
      '5-Card Combos: Straights, flushes, full houses, four of a kind, and straight flushes can only be beaten by higher combinations of the same type.',
    scoringTitle: 'Scoring',
    scoringIntro: 'Points are awarded based on how many cards opponents have left when you win:',
    scoring1to4: '1-4 cards left: 1 point per card',
    scoring5to9: '5-9 cards left: 2 points per card',
    scoring10to13: '10-13 cards left: 3 points per card',
    scoringWarning:
      'Warning: First player to reach over 100 points loses the game! The player with the lowest score wins.',
    letsPlay: "Let's Play!",
    // ELO Rating System
    eloSystemTitle: '🏆 ELO Rating System',
    eloSystemDesc:
      'Your ELO rating measures your skill level. It increases when you win and decreases when you lose in ranked matches. Casual matches do not affect your ELO.',
    eloFormula:
      'ELO changes are calculated using the chess rating formula with K-factor=32. Winning against higher-rated opponents gives more points.',
    rankTiersTitle: 'Rank Tiers:',
    // Reconnection & Disconnection
    reconnectionTitle: '🔄 Reconnection & Disconnection',
    reconnectionDesc:
      'If you lose connection during a match, you have 60 seconds to reconnect and take back your position from the bot.',
    disconnectGrace: '⏱️ Grace Period: 60 seconds to resume your app and restore your position.',
    botReplacement:
      '🤖 Bot Replacement: After 60 seconds, a bot with your current hand will fill in for you.',
    spectatorMode:
      '🔄 Rejoin & Replace Bot: You can rejoin the game at any time during the match and take over your hand from the bot. Tap "Replace Bot & Rejoin" to instantly resume where the bot left off.',
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
    noCards: 'No cards remaining',
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
    cardNotInHand: 'Card not in hand',
    firstPlayMustInclude3D: 'First play must include 3♦',
    oneCardLeftMustPlayHighestSingle: 'Must play your highest single — opponent has 1 card left',
    mustPlayHigher: 'Must play higher combo',
    autoPassTimer: 'Auto-pass in',
    secondsRemaining: 'seconds if no manual pass',
    autoPassHighestPlay: 'Highest Play:',
    autoPassNoOneCanBeat: 'No one can beat this play - {seconds}s to pass',
    autoPassInlineMessage: 'Highest Play: {{combo}} · auto pass in {{seconds}}s',
    invalidMoveTitle: 'Invalid Move',
    cannotPassTitle: 'Cannot Pass',
    cannotPassMessage: 'Cannot pass when leading',
    settings: 'Settings',
    leaveGame: 'Leave Game',
    leaveGameConfirm: 'Leave Game?',
    leaveGameMessage: 'Are you sure you want to leave? Your progress will be lost.',
    stay: 'Stay',
    spectatorMode: 'Spectator Mode',
    spectatorDescription: 'You are watching this match. A bot replaced you after disconnection.',
    initializingGame: 'Initializing game...',
    settingUpEngine: 'Setting up game engine...',
    matchHistoryTitle: 'Match {{n}} History',
    finalScoresTitle: '🏁 Final Scores',
    matchColumn: 'Match',
    totalRow: 'Total',
    pastMatchesHeader: 'Past Matches (tap to expand)',
    matchNum: 'Match {{n}}',
    matchCurrentLabel: '🎯 Match {{n}} (Current)',
    noPlaysRecorded: 'No plays recorded',
    noCardsThisMatch: '🃏 No cards played yet this match',
    cardsWillAppear: 'Cards will appear here after each play',
    noPlayHistoryYet: 'No play history yet. Start playing to see card history!',
    dragToPlayHint: '↑ Drag up to play',
    dropZoneRelease: 'Release to play',
    dropZoneReleaseMultiple: 'Release to play {{count}} cards',
    dropZoneDrop: 'Drop to play',
    // Helper button messages
    hintNoValidPlay: 'No valid play — recommend passing',
    // Throwables
    throwPickerTitle: 'Throw something',
    throwItemAction: 'Throw {{item}}',
    throwEgg: 'Egg',
    throwSmoke: 'Smoke',
    throwConfetti: 'Confetti',
    throwCake: 'Cake',
    throwSplatEgg: 'Splat!',
    throwSplatSmoke: 'Poof!',
    throwSplatConfetti: 'Surprise!',
    throwSplatCake: 'Splat!',
    throwAtYou: '{{name}} threw this at you!',
    throwDismissHint: 'Double-tap to dismiss',
    throwAtPickerTitle: 'Throw at…',
    positionTop: 'Top',
    positionLeft: 'Left',
    positionRight: 'Right',
    // RejoinModal
    botReplacedYouTitle: 'A bot replaced you!',
    botReplacedYouBody: 'A bot is playing in your seat.',
    botReplacedYouBodyWithBot: '{{botName}} (bot) is playing in your seat.',
    botReplacedYouInstruction:
      'Tap Reclaim My Seat to jump back in — the game keeps going for everyone else.',
    reclaimMySeat: 'Reclaim My Seat',
    watchGame: 'Watch Game',
    seatReclaimed: '✅ Seat reclaimed! Rejoining…',
    leaveRoom: 'Leave Room',
    // TurnAutoPlayModal
    autoPlayedForYouTitle: 'We played for you!',
    autoPlayedPlay:
      "You didn't play within 60 seconds, so we auto-played your {{count}} highest valid {{card}}.",
    autoPlayedPass:
      "You didn't play within 60 seconds, so we passed for you (no valid play available).",
    areYouStillHere: 'Are you still here?',
    tapBelowOrDisconnect:
      "Tap below within {{seconds}}s or you'll be disconnected and replaced by a bot.",
    imStillHere: "I'm Still Here ✋",
    secondsRemainingTimer: '{{seconds}}s remaining',
    autoPlayedLabel: 'Auto-played:',
    cardSingular: 'card',
    cardPlural: 'cards',
    botTurnErrorTitle: 'Bot Error',
    botTurnErrorMessage: '{{botName}} encountered an error during their turn.',
    scoreboardError: 'Scoreboard Error',
    scoreboardErrorMessage: 'Unable to display scoreboard data',
    scoreboardRetryHint: 'Attempts to reload the scoreboard',
    a11yViewPlayHistory: 'View play history',
    a11yToggleScoreboard: 'Toggle scoreboard',
    a11yOpenSettings: 'Open settings menu',
    a11yToggleOrientation: 'Toggle orientation',
    a11yPlayHistoryHint: 'Opens the list of plays for this match',
    a11yScoreboardHint: 'Expands or collapses the scoreboard',
    a11ySettingsHint: 'Opens game settings and options',
    a11yOrientationHint: 'Switch between portrait and landscape mode',
  },
  gameEnd: {
    gameWinner: 'Game Winner',
    finalStandings: 'Final Standings',
    scoreHistory: 'Score History',
    playHistory: 'Play History',
    shareResults: 'Share Results',
    copyResults: 'Copy Results',
    copyResultsSuccess: 'Results copied to clipboard!',
    shareResultsTitle: 'Stephanos Game Results',
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
    collapseAll: 'Collapse All',
    expandAll: 'Expand All',
    card: 'card',
    cards: 'cards',
  },
  cardA11y: {
    hearts: 'Hearts',
    diamonds: 'Diamonds',
    clubs: 'Clubs',
    spades: 'Spades',
    ace: 'Ace',
    king: 'King',
    queen: 'Queen',
    jack: 'Jack',
    ten: 'Ten',
    nine: 'Nine',
    eight: 'Eight',
    seven: 'Seven',
    six: 'Six',
    five: 'Five',
    four: 'Four',
    three: 'Three',
    two: 'Two',
    selected: 'selected',
    cardLabel: '{{rank}} of {{suit}}',
    selectedCardLabel: '{{rank}} of {{suit}}, selected',
    hintSelectDeselect: 'Double tap to select or deselect. Long press then drag to rearrange.',
    hintDeselectMulti: 'Double tap to deselect. Drag with other selected cards to play.',
    actionSelect: 'Select card',
    actionDeselect: 'Deselect card',
    actionLongPress: 'Long press',
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
    copy: 'Copy',
    share: 'Share',
    codeCopied: 'Room code copied!',
    copiedTitle: 'Copied!',
    copiedMessage: 'Room code {{roomCode}} has been copied to your clipboard.',
    copyFailedTitle: 'Copy Failed',
    copyFailedMessage: 'Could not copy to clipboard. Your room code is: {{roomCode}}',
    shareTitle: 'Join Stephanos Game',
    shareMessage: 'Join my Stephanos game! Room code: {{roomCode}}',
    minPlayers: 'Need at least 2 players to start',
    inviteFriends: 'Share this code with friends',
    emptySlot: 'Empty Slot',
    you: 'You',
    readyUp: 'Ready Up',
    starting: 'Starting',
    startWithBots: 'Start with AI Bots',
    startWithBotsCount: 'Start with {{count}} AI Bot(s)',
    humanPlayers: 'Human Players',
    botsNeeded: 'Bots Needed',
    casualMatch: 'Casual Match',
    casualRoomInfo: 'Anyone can start this casual game',
    hostInfo: "You're the host. Start with bots or wait for players.",
    waitingForHost: 'Waiting for host to start the game...',
    onlyHostCanStart: 'Only the host can start the game with bots',
    playerDataNotFound: 'Could not find your player data',
    createPlayerError: 'Failed to create player entry',
    loadPlayersError: 'Failed to load players',
    readyStatusError: 'Failed to update ready status',
    leaveRoomError: 'Failed to leave room',
    startGameError: 'Failed to start game',
    notAllPlayersReady: 'All non-host players must be ready before starting',
    shareError: 'Share Error',
    shareErrorMessage: 'Unable to share room code',
    rankedRequirement: 'Ranked matches require 4 human players',
    waitingForMorePlayers: 'Waiting for more players...',
    allReadyToStart: 'All ready to start!',
    botDifficultyLabel: '🤖 Bot Difficulty:',
    easy: 'Easy',
    medium: 'Medium',
    hard: 'Hard',
    rankedMatch: '🏆 Ranked Match',
    privateRoom: '🔒 Private Room',
    confirmLeaveTitle: 'Leave Room?',
    confirmLeaveHost: 'You are the host. Leaving will assign a new host or close the room.',
    confirmLeaveReady: "You're marked as ready. Are you sure you want to leave?",
    confirmLeaveMessage: 'Are you sure you want to leave the room?',
    confirmLeaveYes: 'Leave',
    confirmLeaveNo: 'Stay',
    kickedTitle: 'Kicked',
    kickedByHostMessage: 'You were kicked from the room by {{hostName}}',
    kickedDisconnectedMessage:
      'You were removed from the lobby due to a disconnection. Please check your internet connection.',
    kickedInactivityMessage: 'You were removed from the lobby due to inactivity or disconnection.',
    kickPlayerTitle: 'Kick Player',
    kickPlayerMessage: 'Are you sure you want to kick {{name}} from the room?',
    kickPlayerConfirm: 'Kick',
    kickPlayerError: 'Failed to kick player',
    kickPlayer: 'Kick',
    tooManyPlayers: 'Too many players! Maximum 4 players allowed.',
    noPlayersError: 'Cannot start game without any players!',
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
    alreadyInRoomMessage:
      "You're already in room {{code}} ({{status}}). Leave and create new room?",
    goToRoom: 'Go to Room',
    leaveAndCreate: 'Leave & Create',
    leaveAndJoin: 'Leave & Join',
    leaveRoomError: 'Failed to leave existing room',
    leaveTimeout: 'Taking longer than expected to leave room. Please try again or wait a moment.',
    createRoomError: 'Failed to create room',
    invalidCodeTitle: 'Invalid Code',
    alreadyInDifferentRoom:
      "You're already in room {{code}}. Leave it first to join a different room.",
    goToCurrentRoom: 'Go to Current Room',
    alreadyInAnotherRoom: 'You are already in another room. Please leave it first.',
    kickedFromRoom: 'You have been kicked from this room and cannot rejoin',
    kickedFromRoomByHost:
      '{{hostName}} has kicked you out of the game lobby and you cannot re-enter',
    joinRoomError: 'Failed to join room',
    tip: 'Tip',
    askFriendForCode: 'Ask your friend for the room code and enter it here to join their game',
    createRoomRateLimited:
      "You've created too many rooms recently. Please wait up to an hour before creating another.", // Rate limit window is 1 hour — Task #281
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
    viewFullStats: 'View Full Stats',
    lowestScore: 'Lowest Score',
    avgCardsLeft: 'Avg Cards Left',
    gameCompletion: 'Game Completion',
    rankProgression: 'Rank Progression',
    completed: 'Completed',
    abandoned: 'Abandoned',
    voided: 'Voided',
    private: 'Private',
    casualStats: 'Casual Stats',
    privateStats: 'Private Stats',
    rankedStats: 'Ranked Stats',
    peak: 'Peak',
    lowest: 'Lowest',
    win: 'Win',
    loss: 'Loss',
    totalGames: 'Total Games',
    currentPoints: 'Current Points',
    peakPoints: 'Peak Points',
    rankPointsProgression: 'Rank Points Progression',
    historyTabRecent: '🕑 Recent',
    historyTabWon: '🏆 Won',
    historyTabLost: '❌ Lost',
    historyTabIncomplete: '⚫ Incomplete',
    historyEmptyRecent: 'No games yet.',
    historyEmptyWon: 'No wins yet.',
    historyEmptyLost: 'No losses.',
    historyEmptyIncomplete: 'No incomplete games.',
    mutualFriends: 'Mutual Friends',
    mutualFriendsLabel: '👥 {{count}} mutual friend{{plural}} ›',
    mutualFriendsLabelOne: '👥 {{count}} mutual friend ›',
    mutualFriendsLabelMany: '👥 {{count}} mutual friends ›',
    noMutualFriends: 'No mutual friends found',
    unknownPlayer: 'Unknown',
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
    rankedTitle: 'Ranked Leaderboard',
    filter: 'Time Period',
    matches: 'matches',
    noRankedPlayers: 'No Ranked Players',
    playRankedMatches: 'Play 10+ ranked matches to appear here',
  },
  auth: {
    signIn: 'Sign In',
    signUp: 'Sign Up',
    welcomeTitle: 'Welcome to Stephanos',
    welcomeSubtitle: 'Sign in to play with friends and track your progress',
    email: 'Email',
    password: 'Password',
    confirmPassword: 'Confirm Password',
    forgotPassword: 'Forgot Password?',
    dontHaveAccount: "Don't have an account?",
    alreadyHaveAccount: 'Already have an account?',
    signInWithGoogle: 'Sign in with Google',
    signInWithApple: 'Sign in with Apple',
    orContinueWith: 'Or continue with',
    agreeToTerms: 'By continuing, you agree to our Terms of Service and Privacy Policy',
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
    description:
      "We'll match you with players of similar skill level. The game starts automatically when 4 players are ready!",
    // Match Type Preferences (Phase 4b)
    selectMatchType: 'Select Match Type',
    casual: 'Casual',
    ranked: 'Ranked',
    casualDesc: 'Play for fun, no ELO changes',
    rankedDesc: 'Competitive play with ELO rating changes',
    shareWithFriends: 'Share with Friends',
    friendsCanJoin: 'Friends can join your match using this code',
    signInRequired: 'You must be signed in to use matchmaking',
    queueExpiresIn: 'Queue expires in {{count}}s',
  },
  matchHistory: {
    title: 'Match History',
    noMatches: 'No Matches Yet',
    playFirstMatch: 'Play your first match to see your history here',
    position: '{{ordinal}} Place',
    abandoned: 'Abandoned',
    elo: 'ELO',
    justNow: 'Just now',
    minutesAgo: '{{count}}m ago',
    hoursAgo: '{{count}}h ago',
    daysAgo: '{{count}}d ago',
    local: 'Local',
  },
  friends: {
    title: 'Friends',
    myFriends: 'My Friends',
    requests: 'Requests',
    noFriends: 'No friends yet — add players from the leaderboard or in-game!',
    noPending: 'No pending requests',
    addFriend: 'Add Friend',
    added: 'Friend request sent!',
    alreadyFriends: 'Friends',
    tapToSendFriendRequest: 'Tap to send a friend request',
    requestPending: "You're already friends or a request is already pending.",
    requestSent: 'Request Sent',
    cancelRequest: 'Cancel',
    accept: 'Accept',
    decline: 'Decline',
    unfriend: 'Unfriend',
    favorite: 'Add to Favourites',
    unfavorite: 'Remove Favourite',
    online: 'Online',
    offline: 'Offline',
    sendInvite: 'Send Invite',
    unknownPlayer: 'Player',
    friendRequest: 'Friend Request',
    sentYouARequest: 'sent you a friend request.',
    requestAlreadyHandled: 'This request has already been handled or you do not have permission.',
    throttle: 'Please wait before sending another request.',
    requestReceived: 'Request Received',
    inviteFriends: '👥 Invite Friends',
    noFriendsToInvite: 'All your friends are already in this room.',
    searchPlaceholder: 'Search players by username...',
    clearSearch: 'Clear search',
    noResults: 'No players found',
  },
  notifications: {
    title: '🔔 Notifications',
    empty: 'No notifications yet',
    clearAll: 'Clear All',
    justNow: 'Just now',
    bellLabel: 'Notifications',
    bellLabelWithCount: 'Notifications, {{count}} unread',
    bellHint: 'Opens notification history',
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
    disable: 'تعطيل',
    submit: 'إرسال',
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
    continue: 'متابعة',
    tryAgain: 'حاول مرة أخرى',
    connected: 'متصل',
    reconnecting: 'جارٍ إعادة الاتصال...',
    disconnected: 'غير متصل',
    replacedByBot: 'تم استبدالك بروبوت',
  },
  chat: {
    joinVoice: 'انضم إلى الدردشة الصوتية',
    leaveVoice: 'غادر الدردشة الصوتية',
    joinVideo: 'انضم إلى محادثة الفيديو',
    leaveVideo: 'غادر محادثة الفيديو',
    muted: 'مكتوم',
    camera: 'الكاميرا',
    microphone: 'الميكروفون',
    audio: 'صوت',
    video: 'فيديو',
    sectionTitle: 'دردشة',
    connectingVideo: 'جاري الاتصال بمحادثة الفيديو',
    connectingVoice: 'جاري الاتصال بالدردشة الصوتية',
    tapTurnCameraOff: 'اضغط لإيقاف تشغيل الكاميرا',
    tapTurnCameraOn: 'اضغط لتشغيل الكاميرا',
    tapMute: 'اضغط لكتم الصوت',
    tapUnmute: 'اضغط لإلغاء كتم الصوت',
    muteMicrophone: 'كتم الميكروفون',
    unmuteMicrophone: 'إلغاء كتم الميكروفون',
    microphoneOn: 'الميكروفون مفعّل',
    microphoneOff: 'الميكروفون مغلق',
    // Phase 4 — permission UX
    cameraPermissionTitle: 'الوصول إلى الكاميرا',
    cameraPermissionMessage:
      'يحتاج Stephanos إلى الوصول إلى الكاميرا لعرض الفيديو للاعبين الآخرين.',
    micPermissionTitle: 'الوصول إلى الميكروفون',
    micPermissionMessage: 'يحتاج Stephanos إلى الوصول إلى الميكروفون حتى يسمعك اللاعبون الآخرون.',
    permissionDeniedCameraTitle: 'تم رفض إذن الكاميرا',
    permissionDeniedCameraMessage:
      'تم رفض الوصول إلى الكاميرا. لتمكين الدردشة المرئية، افتح الإعدادات وامنح الإذن.',
    permissionDeniedMicTitle: 'تم رفض إذن الميكروفون',
    permissionDeniedMicMessage:
      'تم رفض الوصول إلى الميكروفون. لتمكين الدردشة الصوتية، افتح الإعدادات وامنح الإذن.',
    openSettings: 'فتح الإعدادات',
    connectFailedTitle: 'الدردشة المرئية غير متاحة',
    connectFailedMessage: 'تعذّر الاتصال بغرفة الدردشة المرئية. تحقق من اتصالك وأعد المحاولة.',
    voiceConnectFailedTitle: 'الدردشة الصوتية غير متاحة',
    voiceConnectFailedMessage: 'تعذّر الاتصال بغرفة الدردشة الصوتية. تحقق من اتصالك وأعد المحاولة.',
    devBuildRequiredTitle: 'مطلوب إصدار مطوّر',
    devBuildRequiredMessage:
      'تتطلب الدردشة الصوتية والمرئية وحدات WebRTC الأصلية غير المتوفرة في هذا الإصدار.',
    // Task #648 — text chat
    title: 'دردشة',
    placeholder: 'اكتب رسالة…',
    send: 'إرسال',
    noMessages: 'لا رسائل بعد. قل مرحبًا!',
    cooldown: 'انتظر…',
    // Task #628 — accessibility labels for chat toggle button
    a11yToggleLabel: 'فتح الدردشة',
    a11yToggleHint: 'يفتح أو يغلق درج الدردشة النصية داخل اللعبة',
  },
  gameSelection: {
    welcome: 'مرحبًا،',
    subtitle: 'اختر لعبة للعب',
    lebanesePokerTitle: 'بوكر لبناني',
    lebanesePokerDesc: 'Stephanos — لعبة الورق الكلاسيكية.\nالعب أونلاين أو ضد الروبوتات.',
    playButton: '←  العب',
    lebaneseDealTitle: 'ديل لبناني',
    lebaneseDealDesc: 'تجربة لعبة ورق جديدة كليًا.\nترقبوا الإطلاق!',
    soonButton: 'قريبًا',
    moreGamesFooter: 'المزيد من الألعاب في التحديثات القادمة',
    comingSoonAlertTitle: '🚧 قريبًا!',
    comingSoonAlertMsg: 'الديل اللبناني قيد التطوير حاليًا. ترقبوا!',
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
    profilePhotoSize: 'حجم صورة الملف الشخصي',
    profilePhotoSizeDescription: 'حجم صور الملف الشخصي في اللعبة',
    profilePhotoSizeSmall: 'صغير',
    profilePhotoSizeMedium: 'متوسط',
    profilePhotoSizeLarge: 'كبير',

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
    pushNotificationsDescription: 'تلقي إشعارات الدفع لأحداث اللعبة',
    stayUpdatedNotifications: 'ابقَ على اطلاع بدعوات اللعبة وإشعارات الدور والمزيد.',
    enableNotifications: 'تفعيل الإشعارات',
    enableNotificationsDescription: 'تلقي إشعارات الدفع لأحداث اللعبة',
    notificationTypes: 'أنواع الإشعارات',
    gameInvites: 'دعوات اللعبة',
    gameInvitesDescription: 'احصل على إشعار عندما يدعوك شخص ما إلى لعبة',
    yourTurn: 'دورك',
    yourTurnDescription: 'احصل على إشعار عندما يحين دورك للعب',
    gameStarted: 'بدأت اللعبة',
    gameStartedDescription: 'احصل على إشعار عندما تبدأ لعبة انضممت إليها',
    friendRequests: 'طلبات الصداقة',
    friendRequestsDescription: 'احصل على إشعار عندما يرسل لك شخص ما طلب صداقة',
    testing: 'اختبار',
    sendTestNotification: 'إرسال إشعار تجريبي',
    debugInfo: 'معلومات التصحيح',
    pushToken: 'رمز الدفع:',
    userIdLabel: 'معرف المستخدم:',
    platformLabel: 'المنصة:',

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
    profileComingSoonDescription:
      'ستكون رؤية الملف الشخصي وحالة الاتصال متاحة مع اللعب الجماعي عبر الإنترنت!',
    autoPassTimerBanner:
      'ℹ️ ملاحظة: تستخدم اللعبة حاليًا مؤقتًا ثابتًا مدته 10 ثوانٍ. ستكون المدد المخصصة متاحة قريبًا!',
    clearCacheFailed: 'فشل مسح ذاكرة التخزين المؤقت',
    openLinkFailed: 'فشل فتح الرابط',
    notificationsEnabledSuccess: 'تم تفعيل إشعارات الدفع!',
    permissionsRequired: 'الأذونات مطلوبة',
    permissionsMessage: 'يرجى تفعيل الإشعارات في إعدادات جهازك لتلقي تحديثات اللعبة.',
    openSettingsButton: 'فتح الإعدادات',
    disableNotificationsTitle: 'تعطيل الإشعارات',
    disableNotificationsMessage:
      'هل أنت متأكد أنك تريد تعطيل الإشعارات؟ لن تتلقى دعوات اللعبة أو إشعارات الدور.',
    enableNotificationsFirst: 'يرجى تفعيل الإشعارات أولاً.',
    notificationsDisabledTitle: 'الإشعارات معطلة',
    testNotificationSentMessage: 'يجب أن تتلقى إشعارًا خلال ثانيتين!',
    testNotificationSentTitle: 'تم إرسال إشعار تجريبي',
    testNotificationFailed: 'فشل إرسال إشعار تجريبي.',

    version: 'الإصدار',
    termsOfService: 'شروط الخدمة',
    privacyPolicy: 'سياسة الخصوصية',
    support: 'الدعم',

    dataPrivacy: 'البيانات والخصوصية',
    analyticsTracking: 'التحليلات وتقارير الأعطال',
    analyticsTrackingDescription: 'ساعد في تحسين التطبيق من خلال مشاركة بيانات الاستخدام المجهولة',

    bugReport: 'تقرير خطأ',
    reportABug: 'الإبلاغ عن خطأ',
    bugReportPromptTitle: 'الإبلاغ عن خطأ',
    bugReportPromptMessage: 'صف المشكلة التي واجهتها:',
    bugReportUnavailable: 'الإبلاغ عن الأخطاء غير متاح حاليًا.',
    bugReportSubmitted: 'تم إرسال تقرير الخطأ. شكرًا لك!',
    bugReportAndroidTitle: 'الإبلاغ عن خطأ',
    bugReportAndroidMessage:
      'للإبلاغ عن خطأ، يرجى إرسال بريد إلكتروني إلى support@stephanos.app مع وصف المشكلة.',
  },
  notificationChannels: {
    default: 'افتراضي',
    gameUpdates: 'تحديثات اللعبة',
    turnNotifications: 'إشعارات الدَّوْر',
    social: 'اجتماعي',
  },
  pushContent: {
    gameStartingTitle: '🎮 اللعبة تبدأ!',
    gameStartingBody: 'لعبتك في غرفة {{roomCode}} تبدأ الآن. حظًا سعيدًا!',
    yourTurnTitle: '⏰ دورك!',
    yourTurnBody: 'حان دورك للعب في غرفة {{roomCode}}',
    victoryTitle: '🎉 فوز!',
    victoryBody: 'تهانينا! لقد فزت في غرفة {{roomCode}}!',
    gameOverTitle: '🏁 انتهت اللعبة',
    gameOverBody: '{{winnerName}} فاز باللعبة في غرفة {{roomCode}}',
    roomInviteTitle: '🎴 دعوة غرفة',
    roomInviteBody: '{{inviterName}} دعاك للانضمام إلى غرفة {{roomCode}}',
    playerJoinedTitle: '👋 انضم لاعب',
    playerJoinedBody: '{{joinerName}} انضم إلى غرفة {{roomCode}}',
    timeRunningOutTitle: '⚠️ الوقت ينفد!',
    timeRunningOutBody: '{{seconds}} ثانية متبقية للعب في غرفة {{roomCode}}',
    readyToStartTitle: '✅ جاهز للبدء',
    readyToStartBody: 'جميع اللاعبين جاهزون في غرفة {{roomCode}}. يمكنك بدء اللعبة!',
    friendRequestTitle: '👋 طلب صداقة',
    friendRequestBody: '{{senderName}} أرسل لك طلب صداقة',
    friendAcceptedTitle: '🤝 تم قبول طلب الصداقة',
    friendAcceptedBody: '{{accepterName}} قبل طلب صداقتك',
  },
  bugReportModal: {
    title: 'الإبلاغ عن مشكلة',
    categoryLabel: 'الفئة',
    categoryBug: 'خطأ',
    categorySuggestion: 'اقتراح',
    categoryPerformance: 'الأداء',
    categoryCrash: 'توقف مفاجئ',
    categoryOther: 'أخرى',
    descriptionLabel: 'الوصف',
    descriptionPlaceholder: 'صف المشكلة أو الاقتراح بالتفصيل…',
    descriptionRequired: 'يرجى إدخال وصف.',
    screenshotLabel: 'لقطة شاشة (اختياري)',
    attachScreenshot: '📎 إرفاق لقطة شاشة',
    removeScreenshot: 'إزالة',
    photoPermissionDenied: 'يلزم الوصول إلى مكتبة الصور لإرفاق لقطة شاشة.',
    screenshotUnavailable:
      'إرفاق لقطة الشاشة غير متاح في هذا الإصدار. يرجى إعادة بناء التطبيق لتفعيله.',
    includeLogLabel: 'تضمين سجل التطبيق',
    includeLogDescription: 'أرفق سجل التطبيق لهذا اليوم لمساعدتنا في التشخيص.',
  },
  home: {
    title: 'Stephanos',
    welcome: 'مرحبًا',
    findMatch: '🎯 البحث عن مباراة (جديد!)',
    findMatchDescription: 'مباراة سريعة لـ 4 لاعبين مع مطابقة المهارات',
    quickPlay: '⚡ لعب سريع',
    quickPlayDescription: 'انضم إلى لعبة عشوائية',
    createRoom: '➕ إنشاء غرفة',
    createRoomDescription: 'استضافة لعبة خاصة',
    joinRoom: '🔗 الانضمام إلى غرفة',
    joinRoomDescription: 'أدخل رمز الغرفة',
    leaderboard: '🏆 لوحة المتصدرين',
    rankedLeaderboard: '🏆 لوحة الصدارة التصنيفية',
    rankedLeaderboardDescription: 'شاهد أفضل اللاعبين حسب تصنيف ELO',
    profile: 'الملف الشخصي',
    currentRoom: 'حاليًا في الغرفة',
    leave: 'غادر',
    leftRoom: 'غادرت الغرفة',
    leaveRoomConfirm: 'غادر الغرفة؟',
    casualMatch: 'مباراة عادية',
    casualMatchDescription: 'لعبة سريعة مع تصنيف مريح',
    rankedMatch: 'مباراة مصنفة',
    rankedMatchDescription: 'مباراة تنافسية بتصنيف ELO',
    howToPlay: '📖 كيف تلعب',
    howToPlayDescription: 'تعلم قواعد اللعبة',
    roomClosedTitle: 'تم إغلاق الغرفة',
    roomClosedMessage: 'تم إغلاق الغرفة التي كنت فيها من قبل المضيف.',
    joinCasualLobby: 'انضم إلى لوبي عادي',
    findGame: '🎮 ابحث عن لعبة',
    findGameDescription: 'العب مباريات أونلاين',
    offlinePractice: '🤖 تدريب بدون إنترنت',
    offlinePracticeDescription: 'العب مع 3 روبوتات',
    botDifficultyTitle: '🤖 صعوبة الروبوت',
    botDifficultySubtitle: 'اختر مدى ذكاء الروبوتات',
    easy: 'سهل',
    easyDesc: 'الروبوتات ترتكب أخطاء وتمرر كثيرًا. مثالي للتعلم!',
    medium: 'متوسط',
    mediumDesc: 'لعب متوازن باستراتيجية أساسية. تحدٍّ عادل.',
    hard: 'صعب',
    hardDesc: 'لعب مثالي بتشكيلات متقدمة. هل تعتقد أنك ستفوز؟',
    chooseGameMode: 'اختر وضع اللعب',
    noGameInProgress: 'لا توجد لعبة جارية',
    startNewGameHint: 'ابدأ لعبة جديدة للعب!',
    activeOnlineGame: 'لعبة أونلاين نشطة',
    activeOfflineGame: 'لعبة أوفلاين نشطة',
    inProgress: 'جارية',
    waitingStatus: 'انتظار',
    rejoin: '🔄 إعادة الانضمام',
    replaceBotAndRejoin: '🔄 استبدال الروبوت والانضمام',
    cancelSearch: '❌ إلغاء البحث',
    findingRankedMatch: '🔍 البحث عن مباراة مصنفة...',
    offlineMatchSubtitle: 'مباراة {{match}} · ضد الذكاء الاصطناعي',
    botReplacingYou: 'يحل البوت محلك...',
    beforeBotReplaces: '⏱ {{seconds}} ثانية قبل أن يحل البوت محلك',
    botPlayingForYou: '🤖 بوت يلعب نيابة عنك',
    roomClosedError: 'الغرفة لم تعد متاحة',
    roomCheckError: 'فشل في التحقق من حالة الغرفة',
    reportBug: 'الإبلاغ عن خطأ',
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
    noCards: 'لا توجد بطاقات متبقية',
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
    cardNotInHand: 'البطاقة ليست في يدك',
    firstPlayMustInclude3D: 'اللعبة الأولى يجب أن تتضمن 3♦',
    oneCardLeftMustPlayHighestSingle: 'يجب لعب أعلى ورقة منفردة — الخصم لديه ورقة واحدة متبقية',
    mustPlayHigher: 'يجب لعب كومبو أعلى',
    autoPassTimer: 'التمرير التلقائي في',
    secondsRemaining: 'ثانية إذا لم يتم التمرير يدويًا',
    autoPassHighestPlay: 'أعلى لعبة:',
    autoPassNoOneCanBeat: 'لا أحد يستطيع التغلب على هذه اللعبة - {seconds} ثانية للمرور',
    autoPassInlineMessage: 'أعلى لعبة: {{combo}} · تمرير تلقائي في {{seconds}} ثانية',
    invalidMoveTitle: 'حركة غير صالحة',
    cannotPassTitle: 'لا يمكن المرور',
    cannotPassMessage: 'لا يمكن المرور عند القيادة',
    settings: 'الإعدادات',
    leaveGame: 'مغادرة اللعبة',
    leaveGameConfirm: 'مغادرة اللعبة؟',
    leaveGameMessage: 'هل أنت متأكد أنك تريد المغادرة؟ سيتم فقدان تقدمك.',
    stay: 'البقاء',
    spectatorMode: 'وضع المشاهدة',
    spectatorDescription: 'أنت تشاهد هذه المباراة. حل بوت محلك بعد الانقطاع.',
    initializingGame: 'جارٍ تهيئة اللعبة...',
    settingUpEngine: 'جارٍ إعداد محرك اللعبة...',
    matchHistoryTitle: 'سجل المباراة {{n}}',
    finalScoresTitle: '🏁 النتائج النهائية',
    matchColumn: 'مباراة',
    totalRow: 'المجموع',
    pastMatchesHeader: 'المباريات السابقة (اضغط للتوسيع)',
    matchNum: 'مباراة {{n}}',
    matchCurrentLabel: '🎯 مباراة {{n}} (الحالية)',
    noPlaysRecorded: 'لا توجد لعبات مسجلة',
    noCardsThisMatch: '🃏 لم يتم لعب أي بطاقات بعد في هذه المباراة',
    cardsWillAppear: 'ستظهر البطاقات هنا بعد كل لعب',
    noPlayHistoryYet: 'لا يوجد سجل لعب بعد. ابدأ اللعب لرؤية سجل البطاقات!',
    dragToPlayHint: '↑ اسحب للأعلى للعب',
    dropZoneRelease: 'الإفلات للعب',
    dropZoneReleaseMultiple: 'الإفلات للعب {{count}} أوراق',
    dropZoneDrop: 'وضع هنا للعب',
    // Helper button messages
    hintNoValidPlay: 'لا توجد لعبة صالحة — يُنصح بالتمرير',
    // Throwables
    throwPickerTitle: 'ارمِ شيئاً',
    throwItemAction: 'ارمِ {{item}}',
    throwEgg: 'بيضة',
    throwSmoke: 'دخان',
    throwConfetti: 'قصاصات',
    throwCake: 'كعكة',
    throwSplatEgg: 'ضربة!',
    throwSplatSmoke: 'بوف!',
    throwSplatConfetti: 'مفاجأة!',
    throwSplatCake: 'ضربة!',
    throwAtYou: 'رمى {{name}} هذا عليك!',
    throwDismissHint: 'انقر مرتين للإغلاق',
    throwAtPickerTitle: 'ارمِ على...',
    positionTop: 'أعلى',
    positionLeft: 'يسار',
    positionRight: 'يمين',
    // RejoinModal
    botReplacedYouTitle: 'حل بوت محلك!',
    botReplacedYouBody: 'بوت يلعب في مقعدك.',
    botReplacedYouBodyWithBot: '{{botName}} (بوت) يلعب في مقعدك.',
    botReplacedYouInstruction: 'اضغط على "استعد مقعدي" للعودة — تستمر اللعبة للجميع.',
    reclaimMySeat: 'استعد مقعدي',
    watchGame: 'مشاهدة اللعبة',
    seatReclaimed: '✅ تم استعادة المقعد! إعادة الانضمام...',
    leaveRoom: 'غادر الغرفة',
    // TurnAutoPlayModal
    autoPlayedForYouTitle: 'لعبنا نيابة عنك!',
    autoPlayedPlay: 'لم تلعب خلال 60 ثانية، لذلك لعبنا أعلى {{count}} {{card}} صالحة تلقائياً.',
    autoPlayedPass: 'لم تلعب خلال 60 ثانية، لذلك مررنا نيابة عنك (لا توجد لعبة صالحة).',
    areYouStillHere: 'هل لا تزال هنا؟',
    tapBelowOrDisconnect: 'اضغط في الأسفل خلال {{seconds}} ثانية أو ستُفصل ويحل بوت محلك.',
    imStillHere: 'أنا هنا ✋',
    secondsRemainingTimer: 'تبقى {{seconds}} ثانية',
    autoPlayedLabel: 'لُعب تلقائياً:',
    cardSingular: 'بطاقة',
    cardPlural: 'بطاقات',
    botTurnErrorTitle: 'خطأ في الروبوت',
    botTurnErrorMessage: 'واجه {{botName}} خطأ أثناء دوره.',
    scoreboardError: 'خطأ في لوحة النتائج',
    scoreboardErrorMessage: 'تعذر عرض بيانات لوحة النتائج',
    scoreboardRetryHint: 'يحاول إعادة تحميل لوحة النتائج',
    a11yViewPlayHistory: 'عرض سجل اللعب',
    a11yToggleScoreboard: 'تبديل لوحة النتائج',
    a11yOpenSettings: 'فتح قائمة الإعدادات',
    a11yToggleOrientation: 'تبديل الاتجاه',
    a11yPlayHistoryHint: 'يفتح قائمة اللعبات لهذه المباراة',
    a11yScoreboardHint: 'يوسع أو يطوي لوحة النتائج',
    a11ySettingsHint: 'يفتح إعدادات اللعبة والخيارات',
    a11yOrientationHint: 'التبديل بين الوضع العمودي والأفقي',
  },
  gameEnd: {
    gameWinner: 'فائز اللعبة',
    finalStandings: 'التصنيف النهائي',
    scoreHistory: 'سجل النقاط',
    playHistory: 'سجل اللعب',
    shareResults: 'مشاركة النتائج',
    copyResults: 'نسخ النتائج',
    copyResultsSuccess: 'تم نسخ النتائج إلى الحافظة!',
    shareResultsTitle: 'نتائج لعبة بيغ تو',
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
    collapseAll: 'طي الكل',
    expandAll: 'توسيع الكل',
    card: 'بطاقة',
    cards: 'بطاقات',
  },
  cardA11y: {
    hearts: 'قلوب',
    diamonds: 'ماس',
    clubs: 'سباتي',
    spades: 'بستوني',
    ace: 'آس',
    king: 'ملك',
    queen: 'ملكة',
    jack: 'جاك',
    ten: 'عشرة',
    nine: 'تسعة',
    eight: 'ثمانية',
    seven: 'سبعة',
    six: 'ستة',
    five: 'خمسة',
    four: 'أربعة',
    three: 'ثلاثة',
    two: 'اثنان',
    selected: 'محدد',
    cardLabel: '{{rank}} من {{suit}}',
    selectedCardLabel: '{{rank}} من {{suit}}، محدد',
    hintSelectDeselect: 'انقر مرتين للتحديد أو إلغاء التحديد. اضغط طويلاً ثم اسحب لإعادة الترتيب.',
    hintDeselectMulti: 'انقر مرتين لإلغاء التحديد. اسحب مع البطاقات المحددة الأخرى للعب.',
    actionSelect: 'تحديد البطاقة',
    actionDeselect: 'إلغاء تحديد البطاقة',
    actionLongPress: 'ضغط طويل',
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
    copy: '📋 نسخ',
    share: '📤 مشاركة',
    codeCopied: 'تم نسخ رمز الغرفة!',
    copiedTitle: 'تم النسخ!',
    copiedMessage: 'تم نسخ رمز الغرفة {{roomCode}} إلى الحافظة.',
    copyFailedTitle: 'فشل النسخ',
    copyFailedMessage: 'تعذّر النسخ إلى الحافظة. رمز الغرفة هو: {{roomCode}}',
    shareTitle: 'انضم إلى لعبة Stephanos',
    shareMessage: 'انضم إلى لعبتي في Stephanos! رمز الغرفة: {{roomCode}}',
    minPlayers: 'تحتاج إلى لاعبين على الأقل للبدء',
    inviteFriends: 'شارك هذا الرمز مع الأصدقاء',
    emptySlot: 'فتحة فارغة',
    you: 'أنت',
    readyUp: 'جاهز',
    starting: 'البدء',
    startWithBots: 'ابدأ مع روبوتات الذكاء الاصطناعي',
    startWithBotsCount: 'ابدأ مع {{count}} روبوت(ات)',
    humanPlayers: 'لاعبون بشر',
    botsNeeded: 'الروبوتات المطلوبة',
    casualMatch: 'مباراة عادية',
    casualRoomInfo: 'يمكن لأي لاعب بدء اللعبة في الوضع العادي',
    hostInfo: 'أنت المضيف. ابدأ مع الروبوتات أو انتظر اللاعبين.',
    waitingForHost: 'في انتظار المضيف لبدء اللعبة...',
    onlyHostCanStart: 'فقط المضيف يمكنه بدء اللعبة مع الروبوتات',
    playerDataNotFound: 'لا يمكن العثور على بيانات اللاعب الخاصة بك',
    createPlayerError: 'فشل إنشاء إدخال اللاعب',
    loadPlayersError: 'فشل تحميل اللاعبين',
    readyStatusError: 'فشل تحديث حالة الجاهزية',
    leaveRoomError: 'فشل مغادرة الغرفة',
    startGameError: 'فشل بدء اللعبة',
    notAllPlayersReady: 'يجب أن يكون جميع اللاعبين (عدا المضيف) مستعدين قبل البدء',
    shareError: 'خطأ في المشاركة',
    shareErrorMessage: 'فشلت مشاركة رمز الغرفة. حاول مرة أخرى.',
    rankedRequirement: 'تتطلب المباريات المصنفة 4 لاعبين بشريين',
    waitingForMorePlayers: 'في انتظار المزيد من اللاعبين...',
    allReadyToStart: 'الجميع جاهز للبدء!',
    botDifficultyLabel: '🤖 صعوبة الروبوت:',
    easy: 'سهل',
    medium: 'متوسط',
    hard: 'صعب',
    rankedMatch: '🏆 مباراة مصنفة',
    privateRoom: '🔒 غرفة خاصة',
    confirmLeaveTitle: 'مغادرة الغرفة؟',
    confirmLeaveHost: 'أنت المضيف. سيؤدي المغادرة إلى تعيين مضيف جديد أو إغلاق الغرفة.',
    confirmLeaveReady: 'أنت مستعد. هل أنت متأكد أنك تريد المغادرة؟',
    confirmLeaveMessage: 'هل أنت متأكد أنك تريد مغادرة الغرفة؟',
    confirmLeaveYes: 'مغادرة',
    confirmLeaveNo: 'البقاء',
    kickedTitle: 'تمت إزالتك',
    kickedByHostMessage: 'لقد تمت إزالتك من الغرفة بواسطة {{hostName}}',
    kickedDisconnectedMessage:
      'تمت إزالتك من الغرفة بسبب انقطاع الاتصال. يرجى التحقق من اتصالك بالإنترنت.',
    kickedInactivityMessage: 'تمت إزالتك من الغرفة بسبب عدم النشاط أو انقطاع الاتصال.',
    kickPlayerTitle: 'طرد اللاعب',
    kickPlayerMessage: 'هل أنت متأكد أنك تريد طرد {{name}} من الغرفة؟',
    kickPlayerConfirm: 'طرد',
    kickPlayerError: 'فشل في طرد اللاعب',
    kickPlayer: 'طرد',
    tooManyPlayers: 'عدد اللاعبين كبير جداً! الحد الأقصى 4 لاعبين.',
    noPlayersError: 'لا يمكن بدء اللعبة بدون أي لاعبين!',
  },
  room: {
    createTitle: 'إنشاء غرفة',
    joinTitle: 'الانضمام إلى غرفة',
    enterCode: 'أدخل رمز الغرفة',
    createButton: 'إنشاء',
    joinButton: 'انضم',
    invalidCode: 'يجب أن يتكون رمز الغرفة من 6 أحرف',
    roomFull: 'الغرفة ممتلئة (4/4 لاعبين)',
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
    leaveAndJoin: 'غادر وانضم',
    leaveRoomError: 'فشل مغادرة الغرفة الحالية',
    leaveTimeout: 'يستغرق الأمر وقتًا أطول من المتوقع لمغادرة الغرفة. حاول مرة أخرى أو انتظر لحظة.',
    createRoomError: 'فشل إنشاء الغرفة',
    invalidCodeTitle: 'رمز غير صالح',
    alreadyInDifferentRoom: 'أنت بالفعل في الغرفة {{code}}. غادرها أولاً للانضمام إلى غرفة مختلفة.',
    goToCurrentRoom: 'اذهب إلى الغرفة الحالية',
    alreadyInAnotherRoom: 'أنت بالفعل في غرفة أخرى. يرجى المغادرة أولاً.',
    kickedFromRoom: 'لقد تمت إزالتك من هذه الغرفة ولا يمكنك الانضمام إليها مجدداً',
    kickedFromRoomByHost: '{{hostName}} قام بطردك من اللعبة ولا يمكنك العودة',
    joinRoomError: 'فشل الانضمام إلى الغرفة',
    tip: 'نصيحة',
    askFriendForCode: 'اطلب من صديقك رمز الغرفة وأدخله هنا للانضمام إلى لعبته',
    createRoomRateLimited:
      'لقد أنشأت غرفًا كثيرة مؤخرًا. يرجى الانتظار نحو ساعة قبل إنشاء غرفة أخرى.',
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
    viewFullStats: 'عرض كل الإحصائيات',
    lowestScore: 'أدنى نقاط',
    avgCardsLeft: 'متوسط البطاقات المتبقية',
    gameCompletion: 'إتمام اللعبة',
    rankProgression: 'تقدم الترتيب',
    completed: 'مكتمل',
    abandoned: 'متخلى عنها',
    voided: 'ملغى',
    private: 'خاص',
    casualStats: 'إحصاءات العادي',
    privateStats: 'إحصاءات الخاص',
    rankedStats: 'إحصاءات المصنف',
    peak: 'الذروة',
    lowest: 'الأدنى',
    win: 'فوز',
    loss: 'خسارة',
    totalGames: 'إجمالي الألعاب',
    currentPoints: 'النقاط الحالية',
    peakPoints: 'نقاط الذروة',
    rankPointsProgression: 'تطور نقاط الترتيب',
    historyTabRecent: '🕑 الأخيرة',
    historyTabWon: '🏆 الفوز',
    historyTabLost: '❌ الخسارة',
    historyTabIncomplete: '⚫ غير مكتملة',
    historyEmptyRecent: 'لا توجد ألعاب بعد.',
    historyEmptyWon: 'لا انتصارات بعد.',
    historyEmptyLost: 'لا خسائر.',
    historyEmptyIncomplete: 'لا توجد ألعاب غير مكتملة.',
    mutualFriends: 'أصدقاء مشتركون',
    mutualFriendsLabel: '👥 {{count}} صديق مشترك{{plural}} ›',
    mutualFriendsLabelOne: '👥 {{count}} صديق مشترك ›',
    mutualFriendsLabelMany: '👥 {{count}} أصدقاء مشتركون ›',
    noMutualFriends: 'لا يوجد أصدقاء مشتركون',
    unknownPlayer: 'غير معروف',
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
    rankedTitle: 'لوحة الصدارة التصنيفية',
    filter: 'الفترة الزمنية',
    matches: 'مباريات',
    noRankedPlayers: 'لا يوجد لاعبون مصنفون',
    playRankedMatches: 'العب 10+ مباريات تصنيفية للظهور هنا',
  },
  auth: {
    signIn: 'تسجيل الدخول',
    signUp: 'اشتراك',
    welcomeTitle: 'مرحبًا بك في Stephanos',
    welcomeSubtitle: 'سجّل دخولك للعب مع الأصدقاء وتتبّع تقدمك',
    email: 'البريد الإلكتروني',
    password: 'كلمة المرور',
    confirmPassword: 'تأكيد كلمة المرور',
    forgotPassword: 'هل نسيت كلمة المرور؟',
    dontHaveAccount: 'ليس لديك حساب؟',
    alreadyHaveAccount: 'هل لديك حساب؟',
    signInWithGoogle: 'تسجيل الدخول باستخدام Google',
    signInWithApple: 'تسجيل الدخول باستخدام Apple',
    orContinueWith: 'أو تابع باستخدام',
    agreeToTerms: 'بالمتابعة، فإنك توافق على شروط الخدمة وسياسة الخصوصية الخاصة بنا',
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
    description:
      'سنطابقك مع لاعبين لديهم مستوى مهارة مماثل. تبدأ اللعبة تلقائيًا عندما يكون 4 لاعبين جاهزين!',
    // Match Type Preferences (Phase 4b)
    selectMatchType: 'اختر نوع المباراة',
    casual: 'عادي',
    ranked: 'تصنيفي',
    casualDesc: 'العب من أجل المتعة، لا تغييرات في تصنيف ELO',
    rankedDesc: 'لعب تنافسي مع تغييرات تصنيف ELO',
    shareWithFriends: 'شارك مع الأصدقاء',
    friendsCanJoin: 'يمكن للأصدقاء الانضمام إلى مباراتك باستخدام هذا الرمز',
    signInRequired: 'يجب أن تكون مسجلاً للدخول لاستخدام البحث عن مباراة',
    queueExpiresIn: 'تنتهي صلاحية قائمة الانتظار خلال {{count}} ثانية',
  },
  matchHistory: {
    title: 'سجل المباريات',
    noMatches: 'لا توجد مباريات بعد',
    playFirstMatch: 'العب مباراتك الأولى لرؤية سجلك هنا',
    position: 'المركز {{ordinal}}',
    abandoned: 'متخلى عنها',
    elo: 'ELO',
    justNow: 'الآن',
    minutesAgo: 'منذ {{count}} د',
    hoursAgo: 'منذ {{count}} س',
    daysAgo: 'منذ {{count}} ي',
    local: 'محلي',
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
    noteText: 'ملاحظة: 3 الماس (3♦) هو أضعف ورقة و 2 البستوني (2♠) هو أقوى ورقة!',
    validCombinationsTitle: '🎮 التشكيلات الصحيحة',
    combinationsTitle: '🎮 التشكيلات الصحيحة',
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
    autoPassTimer:
      'مؤقت التمرير التلقائي: عندما يتم لعب أعلى بطاقة، لدى اللاعبين الآخرين 10 ثواني للرد',
    oneCardLeft:
      'بطاقة واحدة متبقية: عندما يكون لدى اللاعب بطاقة واحدة، يجب على اللاعب السابق لعب أعلى بطاقة مفردة',
    fiveCardCombos:
      'تشكيلات 5 بطاقات: المتتاليات والفلاش لا يمكن هزيمتها إلا بتشكيلة أعلى من نفس النوع',
    scoringTitle: '🏆 نظام النقاط',
    scoringIntro:
      'في نهاية كل جولة، اللاعبون الذين لم يتخلصوا من أوراقهم يحصلون على نقاط بناءً على عدد الأوراق المتبقية:',
    scoring1to4: '1-4 أوراق متبقية: 1 نقطة',
    scoring5to9: '5-9 أوراق متبقية: 2 نقطة',
    scoring10to13: '10-13 ورقة متبقية: 3 نقاط',
    scoring1to7: '• 1-7 أوراق متبقية = 1 نقطة',
    scoring8to10: '• 8-10 أوراق متبقية = 2 نقطة',
    scoring11to12: '• 11-12 ورقة متبقية = 3 نقاط',
    scoringWarning:
      'تحذير: أول لاعب يصل إلى أكثر من 100 نقطة يخسر اللعبة! اللاعب صاحب أقل نقاط يفوز.',
    letsPlay: 'هيا نلعب!',
    // ELO Rating System
    eloSystemTitle: '🏆 نظام تصنيف ELO',
    eloSystemDesc:
      'تصنيف ELO الخاص بك يقيس مستوى مهارتك. يزداد عندما تفوز ويقل عندما تخسر في المباريات المصنفة. المباريات العادية لا تؤثر على ELO الخاص بك.',
    eloFormula:
      'يتم حساب تغييرات ELO باستخدام صيغة تصنيف الشطرنج مع عامل K = 32. الفوز ضد خصوم ذوي تصنيف أعلى يمنح المزيد من النقاط.',
    rankTiersTitle: 'مستويات الرتب:',
    // Reconnection & Disconnection
    reconnectionTitle: '🔄 إعادة الاتصال والانقطاع',
    reconnectionDesc:
      'إذا فقدت الاتصال أثناء المباراة، لديك 60 ثانية لإعادة الاتصال واسترداد موضعك من البوت.',
    disconnectGrace: '⏱️ فترة السماح: 60 ثانية لاستئناف التطبيق واستعادة موضعك.',
    botReplacement: '🤖 استبدال البوت: بعد 60 ثانية، سيلعب بوت بأوراقك الحالية نيابة عنك.',
    spectatorMode:
      '🔄 إعادة الانضمام واستبدال البوت: يمكنك إعادة الانضمام في أي وقت أثناء المباراة واستعادة يدك من البوت. اضغط على "استبدال البوت وإعادة الانضمام" للاستئناف فوراً.',
  },
  friends: {
    title: 'الأصدقاء',
    myFriends: 'أصدقائي',
    requests: 'الطلبات',
    noFriends: 'لا أصدقاء حتى الآن — أضف لاعبين من لوحة المتصدرين أو في اللعبة!',
    noPending: 'لا طلبات معلقة',
    addFriend: 'إضافة صديق',
    added: 'تم إرسال طلب الصداقة!',
    alreadyFriends: 'أصدقاء',
    tapToSendFriendRequest: 'اضغط لإرسال طلب صداقة',
    requestPending: 'أنتما أصدقاء بالفعل أو الطلب معلق.',
    requestSent: 'تم الإرسال',
    cancelRequest: 'إلغاء',
    accept: 'قبول',
    decline: 'رفض',
    unfriend: 'إلغاء الصداقة',
    favorite: 'إضافة إلى المفضلة',
    unfavorite: 'إزالة من المفضلة',
    online: 'متصل',
    offline: 'غير متصل',
    sendInvite: 'إرسال دعوة',
    unknownPlayer: 'لاعب',
    friendRequest: 'طلب صداقة',
    sentYouARequest: 'أرسل لك طلب صداقة.',
    requestAlreadyHandled: 'تمت معالجة هذا الطلب مسبقاً أو ليس لديك الصلاحية.',
    throttle: 'يرجى الانتظار قبل إرسال طلب آخر.',
    requestReceived: 'طلب مستلم',
    inviteFriends: '👥 دعوة الأصدقاء',
    noFriendsToInvite: 'جميع أصدقائك موجودون بالفعل في هذه الغرفة.',
    searchPlaceholder: 'ابحث عن لاعبين باسم المستخدم...',
    clearSearch: 'مسح البحث',
    noResults: 'لم يتم العثور على لاعبين',
  },
  notifications: {
    title: '🔔 الإشعارات',
    empty: 'لا توجد إشعارات بعد',
    clearAll: 'مسح الكل',
    justNow: 'الآن',
    bellLabel: 'الإشعارات',
    bellLabelWithCount: 'الإشعارات، {{count}} غير مقروء',
    bellHint: 'يفتح سجل الإشعارات',
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
    disable: 'Deaktivieren',
    submit: 'Absenden',
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
    allTime: 'Gesamt',
    weekly: 'Wöchentlich',
    daily: 'Täglich',
    comingSoon: 'Bald verfügbar',
    continue: 'Weiter',
    tryAgain: 'Erneut versuchen',
    connected: 'Verbunden',
    reconnecting: 'Verbindung wird wiederhergestellt...',
    disconnected: 'Getrennt',
    replacedByBot: 'Durch Bot ersetzt',
  },
  chat: {
    joinVoice: 'Sprach-Chat beitreten',
    leaveVoice: 'Sprach-Chat verlassen',
    joinVideo: 'Video-Chat beitreten',
    leaveVideo: 'Video-Chat verlassen',
    muted: 'Stummgeschaltet',
    camera: 'Kamera',
    microphone: 'Mikrofon',
    audio: 'Audio',
    video: 'Video',
    sectionTitle: 'Chat',
    connectingVideo: 'Verbindung zum Video-Chat wird hergestellt',
    connectingVoice: 'Verbindung zum Sprach-Chat wird hergestellt',
    tapTurnCameraOff: 'Zum Ausschalten der Kamera tippen',
    tapTurnCameraOn: 'Zum Einschalten der Kamera tippen',
    tapMute: 'Zum Stummschalten tippen',
    tapUnmute: 'Stummschaltung aufheben',
    muteMicrophone: 'Mikrofon stummschalten',
    unmuteMicrophone: 'Mikrofon Stummschaltung aufheben',
    microphoneOn: 'Mikrofon an',
    microphoneOff: 'Mikrofon aus',
    // Phase 4 — permission UX
    cameraPermissionTitle: 'Kamerazugriff',
    cameraPermissionMessage:
      'Stephanos benötigt Kamerazugriff, um dein Video anderen Spielern zu zeigen.',
    micPermissionTitle: 'Mikrofonzugriff',
    micPermissionMessage:
      'Stephanos benötigt Mikrofonzugriff, damit andere Spieler dich hören können.',
    permissionDeniedCameraTitle: 'Kamerazugriff verweigert',
    permissionDeniedCameraMessage:
      'Der Kamerazugriff wurde verweigert. Öffne die Einstellungen und erlaube Stephanos den Kamerazugriff.',
    permissionDeniedMicTitle: 'Mikrofonzugriff verweigert',
    permissionDeniedMicMessage:
      'Der Mikrofonzugriff wurde verweigert. Öffne die Einstellungen und erlaube Stephanos den Mikrofonzugriff.',
    openSettings: 'Einstellungen öffnen',
    connectFailedTitle: 'Video-Chat nicht verfügbar',
    connectFailedMessage:
      'Verbindung zum Video-Chatraum fehlgeschlagen. Prüfe deine Verbindung und versuche es erneut.',
    voiceConnectFailedTitle: 'Sprach-Chat nicht verfügbar',
    voiceConnectFailedMessage:
      'Verbindung zum Sprach-Chatraum fehlgeschlagen. Prüfe deine Verbindung und versuche es erneut.',
    devBuildRequiredTitle: 'Dev-Build erforderlich',
    devBuildRequiredMessage:
      'Sprach- und Video-Chat erfordern native WebRTC-Module, die in diesem Build nicht verfügbar sind.',
    // Task #648 — text chat
    title: 'Chat',
    placeholder: 'Nachricht eingeben…',
    send: 'Senden',
    noMessages: 'Noch keine Nachrichten. Sag Hallo!',
    cooldown: 'Warten…',
    // Task #628 — accessibility labels for chat toggle button
    a11yToggleLabel: 'Chat öffnen',
    a11yToggleHint: 'Öffnet oder schließt die In-Game-Chat-Leiste',
  },
  gameSelection: {
    welcome: 'Willkommen,',

    subtitle: 'Wähle ein Spiel',
    lebanesePokerTitle: 'Libanesisches Poker',
    lebanesePokerDesc: 'Stephanos — das klassische Kartenspiel.\nOnline spielen oder gegen Bots.',
    playButton: 'SPIELEN →',
    lebaneseDealTitle: 'Libanesischer Deal',
    lebaneseDealDesc: 'Ein brandneues Kartenspiel-Erlebnis.\nBleibt auf dem Laufenden!',
    soonButton: 'BALD',
    moreGamesFooter: 'Weitere Spiele in künftigen Updates',
    comingSoonAlertTitle: '🚧 Bald verfügbar!',
    comingSoonAlertMsg: 'Libanesischer Deal ist derzeit in Entwicklung. Bleibt gespannt!',
  },
  settings: {
    title: 'Einstellungen',
    profileSettings: 'Profileinstellungen',
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
    profilePhotoSize: 'Profilfotogröße',
    profilePhotoSizeDescription: 'Größe der Profilfotos im Spiel',
    profilePhotoSizeSmall: 'Klein',
    profilePhotoSizeMedium: 'Mittel',
    profilePhotoSizeLarge: 'Groß',

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
    pushNotificationsDescription: 'Push-Benachrichtigungen für Spielereignisse erhalten',
    stayUpdatedNotifications:
      'Bleiben Sie auf dem Laufenden mit Spieleinladungen, Zugbenachrichtigungen und mehr.',
    enableNotifications: 'Benachrichtigungen aktivieren',
    enableNotificationsDescription: 'Push-Benachrichtigungen für Spielereignisse erhalten',
    notificationTypes: 'Benachrichtigungstypen',
    gameInvites: 'Spieleinladungen',
    gameInvitesDescription: 'Benachrichtigung erhalten, wenn Sie jemand zu einem Spiel einlädt',
    yourTurn: 'Ihr Zug',
    yourTurnDescription: 'Benachrichtigung erhalten, wenn Sie an der Reihe sind',
    gameStarted: 'Spiel gestartet',
    gameStartedDescription:
      'Benachrichtigung erhalten, wenn ein Spiel beginnt, dem Sie beigetreten sind',
    friendRequests: 'Freundschaftsanfragen',
    friendRequestsDescription:
      'Benachrichtigung erhalten, wenn Ihnen jemand eine Freundschaftsanfrage sendet',
    testing: 'Testen',
    sendTestNotification: 'Testbenachrichtigung senden',
    debugInfo: 'Debug-Info',
    pushToken: 'Push-Token:',
    userIdLabel: 'Benutzer-ID:',
    platformLabel: 'Plattform:',

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
    deleteAccountWarning:
      'Diese Aktion kann nicht rückgängig gemacht werden. Alle Ihre Daten werden dauerhaft gelöscht.',
    deleteAccountConfirm: 'Sind Sie sicher, dass Sie Ihr Konto löschen möchten?',
    noUserLoggedIn: 'Kein Benutzer angemeldet',
    deleteAccountFailed: 'Fehler beim Löschen des Kontos. Bitte wenden Sie sich an den Support.',
    accountDeletedSuccess: 'Konto erfolgreich gelöscht',
    profileComingSoonDescription:
      'Profilsichtbarkeit und Online-Status werden mit Online-Multiplayer verfügbar sein!',
    autoPassTimerBanner:
      'ℹ️ Hinweis: Das Spiel verwendet derzeit einen festen 10-Sekunden-Timer. Benutzerdefinierte Dauern sind bald verfügbar!',
    clearCacheFailed: 'Cache konnte nicht geleert werden',
    openLinkFailed: 'Link konnte nicht geöffnet werden',
    notificationsEnabledSuccess: 'Push-Benachrichtigungen wurden aktiviert!',
    permissionsRequired: 'Berechtigungen erforderlich',
    permissionsMessage:
      'Bitte aktivieren Sie Benachrichtigungen in Ihren Geräteeinstellungen, um Spielupdates zu erhalten.',
    openSettingsButton: 'Einstellungen öffnen',
    disableNotificationsTitle: 'Benachrichtigungen deaktivieren',
    disableNotificationsMessage:
      'Möchten Sie Push-Benachrichtigungen wirklich deaktivieren? Sie erhalten keine Spieleinladungen oder Zugbenachrichtigungen mehr.',
    enableNotificationsFirst: 'Bitte aktivieren Sie zuerst die Benachrichtigungen.',
    notificationsDisabledTitle: 'Benachrichtigungen deaktiviert',
    testNotificationSentMessage: 'Sie sollten in 2 Sekunden eine Benachrichtigung erhalten!',
    testNotificationSentTitle: 'Testbenachrichtigung gesendet',
    testNotificationFailed: 'Testbenachrichtigung konnte nicht gesendet werden.',

    version: 'Version',
    termsOfService: 'Nutzungsbedingungen',
    privacyPolicy: 'Datenschutzerklärung',
    support: 'Support',

    dataPrivacy: 'Daten & Datenschutz',
    analyticsTracking: 'Analyse & Absturzberichte',
    analyticsTrackingDescription: 'Helfen Sie, die App durch anonyme Nutzungsdaten zu verbessern',

    bugReport: 'Fehlerbericht',
    reportABug: 'Einen Fehler melden',
    bugReportPromptTitle: 'Einen Fehler melden',
    bugReportPromptMessage: 'Beschreiben Sie das aufgetretene Problem:',
    bugReportUnavailable: 'Fehlerberichterstattung ist derzeit nicht verfügbar.',
    bugReportSubmitted: 'Fehlerbericht eingereicht. Vielen Dank!',
    bugReportAndroidTitle: 'Einen Fehler melden',
    bugReportAndroidMessage:
      'Um einen Fehler zu melden, senden Sie bitte eine E-Mail an support@stephanos.app mit einer Beschreibung des Problems.',
  },
  notificationChannels: {
    default: 'Standard',
    gameUpdates: 'Spielaktualisierungen',
    turnNotifications: 'Zugbenachrichtigungen',
    social: 'Soziales',
  },
  pushContent: {
    gameStartingTitle: '🎮 Spiel beginnt!',
    gameStartingBody: 'Dein Spiel in Raum {{roomCode}} beginnt. Viel Glück!',
    yourTurnTitle: '⏰ Du bist dran!',
    yourTurnBody: 'Du bist in Raum {{roomCode}} am Zug',
    victoryTitle: '🎉 Sieg!',
    victoryBody: 'Herzlichen Glückwunsch! Du hast in Raum {{roomCode}} gewonnen!',
    gameOverTitle: '🏁 Spiel beendet',
    gameOverBody: '{{winnerName}} hat das Spiel in Raum {{roomCode}} gewonnen',
    roomInviteTitle: '🎴 Raumeinladung',
    roomInviteBody: '{{inviterName}} hat dich eingeladen, Raum {{roomCode}} beizutreten',
    playerJoinedTitle: '👋 Spieler beigetreten',
    playerJoinedBody: '{{joinerName}} ist Raum {{roomCode}} beigetreten',
    timeRunningOutTitle: '⚠️ Zeit läuft ab!',
    timeRunningOutBody: '{{seconds}}s verbleibend in Raum {{roomCode}}',
    readyToStartTitle: '✅ Bereit zum Start',
    readyToStartBody: 'Alle Spieler sind bereit in Raum {{roomCode}}. Du kannst das Spiel starten!',
    friendRequestTitle: '👋 Freundschaftsanfrage',
    friendRequestBody: '{{senderName}} hat dir eine Freundschaftsanfrage gesendet',
    friendAcceptedTitle: '🤝 Freundschaftsanfrage angenommen',
    friendAcceptedBody: '{{accepterName}} hat deine Freundschaftsanfrage angenommen',
  },
  bugReportModal: {
    title: 'Problem melden',
    categoryLabel: 'Kategorie',
    categoryBug: 'Fehler',
    categorySuggestion: 'Vorschlag',
    categoryPerformance: 'Leistung',
    categoryCrash: 'Absturz',
    categoryOther: 'Sonstiges',
    descriptionLabel: 'Beschreibung',
    descriptionPlaceholder: 'Beschreiben Sie das Problem oder den Vorschlag im Detail…',
    descriptionRequired: 'Bitte geben Sie eine Beschreibung ein.',
    screenshotLabel: 'Screenshot (optional)',
    attachScreenshot: '📎 Screenshot anhängen',
    removeScreenshot: 'Entfernen',
    photoPermissionDenied:
      'Für das Anhängen eines Screenshots ist Zugriff auf die Fotobibliothek erforderlich.',
    screenshotUnavailable:
      'Screenshot-Anhänge sind in diesem Build nicht verfügbar. Bitte bauen Sie die App neu, um diese Funktion zu aktivieren.',
    includeLogLabel: 'Protokoll einschließen',
    includeLogDescription: 'Das heutige App-Protokoll anhängen, um die Diagnose zu erleichtern.',
  },
  home: {
    title: 'Stephanos',
    welcome: 'Willkommen',
    findMatch: '🎯 Spiel finden (NEU!)',
    findMatchDescription: 'Schnelles 4-Spieler-Spiel mit fähigkeitsbasierter Paarung',
    quickPlay: '⚡ Schnellspiel',
    quickPlayDescription: 'Zufälligem Spiel beitreten',
    createRoom: '➕ Raum erstellen',
    createRoomDescription: 'Privates Spiel hosten',
    joinRoom: '🔗 Raum beitreten',
    joinRoomDescription: 'Raumcode eingeben',
    leaderboard: '🏆 Bestenliste',
    rankedLeaderboard: '🏆 Ranglisten-Bestenliste',
    rankedLeaderboardDescription: 'Die besten Spieler nach ELO-Bewertung sehen',
    profile: 'Profil',
    currentRoom: 'Derzeit im Raum',
    leave: 'Verlassen',
    leftRoom: 'Raum verlassen',
    leaveRoomConfirm: 'Raum verlassen?',
    casualMatch: 'Freundschaftsspiel',
    casualMatchDescription: 'Schnelles Spiel mit entspanntem Ranking',
    rankedMatch: 'Ranglisten-Match',
    rankedMatchDescription: 'Wettbewerbsorientiertes ELO-Match',
    howToPlay: '📖 Wie man spielt',
    howToPlayDescription: 'Spielregeln lernen',
    roomClosedTitle: 'Raum geschlossen',
    roomClosedMessage: 'Der Raum, in dem Sie sich befanden, wurde vom Gastgeber geschlossen.',
    joinCasualLobby: 'Casual-Lobby beitreten',
    findGame: '🎮 Spiel finden',
    findGameDescription: 'Online-Matches spielen',
    offlinePractice: '🤖 Offline-Training',
    offlinePracticeDescription: 'Mit 3 KI-Bots spielen',
    botDifficultyTitle: '🤖 Bot-Schwierigkeit',
    botDifficultySubtitle: 'Wähle, wie klug die Bots sein sollen',
    easy: 'Einfach',
    easyDesc: 'Bots machen Fehler und passen oft. Ideal zum Lernen!',
    medium: 'Mittel',
    mediumDesc: 'Ausgewogenes Spiel mit einfacher Strategie. Eine faire Herausforderung.',
    hard: 'Schwer',
    hardDesc:
      'Optimales Spiel mit fortgeschrittenen Kombinationen. Glaubst du, du kannst gewinnen?',
    chooseGameMode: 'Wähle deinen Spielmodus',
    noGameInProgress: 'Kein laufendes Spiel',
    startNewGameHint: 'Starte ein neues Spiel!',
    activeOnlineGame: 'Aktives Online-Spiel',
    activeOfflineGame: 'Aktives Offline-Spiel',
    inProgress: 'Läuft',
    waitingStatus: 'Warten',
    rejoin: '🔄 Wieder beitreten',
    replaceBotAndRejoin: '🔄 Bot ersetzen & beitreten',
    cancelSearch: '❌ Suche abbrechen',
    findingRankedMatch: '🔍 Suche nach gerangetem Spiel...',
    offlineMatchSubtitle: 'Match {{match}} · gegen KI',
    botReplacingYou: 'Bot ersetzt dich...',
    beforeBotReplaces: '⏱ {{seconds}}s bevor der Bot dich ersetzt',
    botPlayingForYou: '🤖 Ein Bot spielt für dich',
    roomClosedError: 'Raum ist nicht mehr verfügbar',
    roomCheckError: 'Raumstatus konnte nicht überprüft werden',
    reportBug: 'Fehler melden',
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
    noCards: 'Keine Karten übrig',
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
    cardNotInHand: 'Karte nicht in der Hand',
    firstPlayMustInclude3D: 'Erstes Spiel muss 3♦ enthalten',
    oneCardLeftMustPlayHighestSingle:
      'Muss die höchste Einzelkarte spielen — Gegner hat noch 1 Karte',
    mustPlayHigher: 'Muss höhere Kombo spielen',
    autoPassTimer: 'Auto-Pass in',
    secondsRemaining: 'Sekunden, wenn kein manuelles Passen',
    autoPassHighestPlay: 'Höchstes Spiel:',
    autoPassNoOneCanBeat: 'Niemand kann dieses Spiel schlagen - {seconds}s zum Passen',
    autoPassInlineMessage: 'Höchstes Spiel: {{combo}} · auto-pass in {{seconds}}s',
    invalidMoveTitle: 'Ungültiger Zug',
    cannotPassTitle: 'Kann nicht passen',
    cannotPassMessage: 'Kann beim Führen nicht passen',
    settings: 'Einstellungen',
    leaveGame: 'Spiel verlassen',
    leaveGameConfirm: 'Spiel verlassen?',
    leaveGameMessage: 'Bist du sicher, dass du gehen möchtest? Dein Fortschritt geht verloren.',
    stay: 'Bleiben',
    spectatorMode: 'Zuschauermodus',
    spectatorDescription:
      'Du schaust bei diesem Spiel zu. Ein Bot hat dich nach der Trennung ersetzt.',
    initializingGame: 'Spiel wird initialisiert...',
    settingUpEngine: 'Spielengine wird eingerichtet...',
    matchHistoryTitle: 'Runde {{n}} Verlauf',
    finalScoresTitle: '🏁 Finale Ergebnisse',
    matchColumn: 'Runde',
    totalRow: 'Gesamt',
    pastMatchesHeader: 'Vergangene Spiele (tippen zum Erweitern)',
    matchNum: 'Runde {{n}}',
    matchCurrentLabel: '🎯 Runde {{n}} (Aktuell)',
    noPlaysRecorded: 'Keine Spielzüge aufgezeichnet',
    noCardsThisMatch: '🃏 Noch keine Karten in dieser Runde gespielt',
    cardsWillAppear: 'Karten erscheinen hier nach jedem Spielzug',
    noPlayHistoryYet: 'Noch kein Spielverlauf. Spiele um den Kartenverlauf zu sehen!',
    dragToPlayHint: '↑ Nach oben ziehen zum Spielen',
    dropZoneRelease: 'Loslassen zum Spielen',
    dropZoneReleaseMultiple: '{{count}} Karten loslassen zum Spielen',
    dropZoneDrop: 'Hier ablegen zum Spielen',
    // Helper button messages
    hintNoValidPlay: 'Kein gültiger Zug — Passen empfohlen',
    // Throwables
    throwPickerTitle: 'Etwas werfen',
    throwItemAction: '{{item}} werfen',
    throwEgg: 'Ei',
    throwSmoke: 'Rauch',
    throwConfetti: 'Konfetti',
    throwCake: 'Kuchen',
    throwSplatEgg: 'Klatsch!',
    throwSplatSmoke: 'Puff!',
    throwSplatConfetti: 'Überraschung!',
    throwSplatCake: 'Klatsch!',
    throwAtYou: '{{name}} hat das auf dich geworfen!',
    throwDismissHint: 'Zweimal tippen zum Schließen',
    throwAtPickerTitle: 'Werfen auf…',
    positionTop: 'Oben',
    positionLeft: 'Links',
    positionRight: 'Rechts',
    // RejoinModal
    botReplacedYouTitle: 'Ein Bot hat dich ersetzt!',
    botReplacedYouBody: 'Ein Bot spielt auf deinem Platz.',
    botReplacedYouBodyWithBot: '{{botName}} (Bot) spielt auf deinem Platz.',
    botReplacedYouInstruction:
      'Tippe auf "Platz zurückfordern" um zurückzukehren — das Spiel geht für alle weiter.',
    reclaimMySeat: 'Platz zurückfordern',
    watchGame: 'Spiel ansehen',
    seatReclaimed: '✅ Platz zurückgefordert! Wiederverbinden…',
    leaveRoom: 'Raum verlassen',
    // TurnAutoPlayModal
    autoPlayedForYouTitle: 'Wir haben für dich gespielt!',
    autoPlayedPlay:
      'Du hast nicht innerhalb von 60 Sekunden gespielt, also haben wir deine {{count}} höchste(n) gültige(n) {{card}} automatisch gespielt.',
    autoPlayedPass:
      'Du hast nicht innerhalb von 60 Sekunden gespielt, also haben wir für dich gepasst (kein gültiger Zug verfügbar).',
    areYouStillHere: 'Bist du noch da?',
    tapBelowOrDisconnect:
      'Tippe unten innerhalb von {{seconds}}s oder du wirst getrennt und durch einen Bot ersetzt.',
    imStillHere: 'Ich bin noch hier ✋',
    secondsRemainingTimer: 'Noch {{seconds}}s',
    autoPlayedLabel: 'Automatisch gespielt:',
    cardSingular: 'Karte',
    cardPlural: 'Karten',
    botTurnErrorTitle: 'Bot-Fehler',
    botTurnErrorMessage: '{{botName}} hat während seines Zuges einen Fehler erhalten.',
    scoreboardError: 'Anzeigetafel-Fehler',
    scoreboardErrorMessage: 'Anzeigetafel-Daten können nicht angezeigt werden',
    scoreboardRetryHint: 'Versucht die Anzeigetafel neu zu laden',
    a11yViewPlayHistory: 'Spielverlauf anzeigen',
    a11yToggleScoreboard: 'Anzeigetafel umschalten',
    a11yOpenSettings: 'Einstellungsmenü öffnen',
    a11yToggleOrientation: 'Ausrichtung umschalten',
    a11yPlayHistoryHint: 'Öffnet die Liste der Spielzüge für dieses Match',
    a11yScoreboardHint: 'Erweitert oder reduziert die Anzeigetafel',
    a11ySettingsHint: 'Öffnet Spieleinstellungen und Optionen',
    a11yOrientationHint: 'Zwischen Hoch- und Querformat wechseln',
  },
  gameEnd: {
    gameWinner: 'Spielgewinner',
    finalStandings: 'Endstand',
    scoreHistory: 'Punkteverlauf',
    playHistory: 'Spielverlauf',
    shareResults: 'Ergebnisse teilen',
    copyResults: 'Ergebnisse kopieren',
    copyResultsSuccess: 'Ergebnisse in die Zwischenablage kopiert!',
    shareResultsTitle: 'Stephanos Spielergebnisse',
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
    collapseAll: 'Alle einklappen',
    expandAll: 'Alle ausklappen',
    card: 'Karte',
    cards: 'Karten',
  },
  cardA11y: {
    hearts: 'Herz',
    diamonds: 'Karo',
    clubs: 'Kreuz',
    spades: 'Pik',
    ace: 'Ass',
    king: 'König',
    queen: 'Dame',
    jack: 'Bube',
    ten: 'Zehn',
    nine: 'Neun',
    eight: 'Acht',
    seven: 'Sieben',
    six: 'Sechs',
    five: 'Fünf',
    four: 'Vier',
    three: 'Drei',
    two: 'Zwei',
    selected: 'ausgewählt',
    cardLabel: '{{rank}} von {{suit}}',
    selectedCardLabel: '{{rank}} von {{suit}}, ausgewählt',
    hintSelectDeselect:
      'Doppeltippen zum Auswählen oder Abwählen. Lang drücken dann ziehen zum Neuanordnen.',
    hintDeselectMulti:
      'Doppeltippen zum Abwählen. Mit anderen ausgewählten Karten ziehen zum Spielen.',
    actionSelect: 'Karte auswählen',
    actionDeselect: 'Karte abwählen',
    actionLongPress: 'Langer Druck',
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
    copy: '📋 Kopieren',
    share: '📤 Teilen',
    codeCopied: 'Raumcode kopiert!',
    copiedTitle: 'Kopiert!',
    copiedMessage: 'Raumcode {{roomCode}} wurde in die Zwischenablage kopiert.',
    copyFailedTitle: 'Kopieren fehlgeschlagen',
    copyFailedMessage:
      'Kopieren in die Zwischenablage fehlgeschlagen. Ihr Raumcode lautet: {{roomCode}}',
    shareTitle: 'Stephanos Spiel beitreten',
    shareMessage: 'Tritt meinem Stephanos Spiel bei! Raumcode: {{roomCode}}',
    minPlayers: 'Mindestens 2 Spieler erforderlich',
    inviteFriends: 'Teile diesen Code mit Freunden',
    emptySlot: 'Leerer Platz',
    you: 'Du',
    readyUp: 'Bereit machen',
    starting: 'Startet',
    startWithBots: 'Mit KI-Bots starten',
    startWithBotsCount: 'Mit {{count}} Bot(s) starten',
    humanPlayers: 'Menschliche Spieler',
    botsNeeded: 'Benötigte Bots',
    casualMatch: 'Freundschaftsspiel',
    casualRoomInfo: 'Jeder kann dieses Casual-Spiel starten',
    hostInfo: 'Du bist der Host. Starte mit Bots oder warte auf Spieler.',
    waitingForHost: 'Warte darauf, dass der Host das Spiel startet...',
    onlyHostCanStart: 'Nur der Host kann das Spiel mit Bots starten',
    playerDataNotFound: 'Deine Spielerdaten konnten nicht gefunden werden',
    createPlayerError: 'Fehler beim Erstellen des Spielereintrags',
    loadPlayersError: 'Fehler beim Laden der Spieler',
    readyStatusError: 'Fehler beim Aktualisieren des Bereitschaftsstatus',
    leaveRoomError: 'Fehler beim Verlassen des Raums',
    startGameError: 'Fehler beim Starten des Spiels',
    notAllPlayersReady: 'Alle Nicht-Host-Spieler müssen bereit sein, bevor das Spiel beginnt',
    shareError: 'Fehler beim Teilen',
    shareErrorMessage: 'Raumcode konnte nicht geteilt werden. Bitte erneut versuchen.',
    rankedRequirement: 'Ranglistenspiele erfordern 4 menschliche Spieler',
    waitingForMorePlayers: 'Warte auf weitere Spieler...',
    allReadyToStart: 'Alle bereit zum Starten!',
    botDifficultyLabel: '🤖 Bot-Schwierigkeit:',
    easy: 'Einfach',
    medium: 'Mittel',
    hard: 'Schwer',
    rankedMatch: '🏆 Ranglistenspiel',
    privateRoom: '🔒 Privater Raum',
    confirmLeaveTitle: 'Raum verlassen?',
    confirmLeaveHost:
      'Du bist der Host. Wenn du gehst, wird ein neuer Host bestimmt oder der Raum geschlossen.',
    confirmLeaveReady: 'Du bist als bereit markiert. Möchtest du wirklich gehen?',
    confirmLeaveMessage: 'Möchtest du den Raum wirklich verlassen?',
    confirmLeaveYes: 'Verlassen',
    confirmLeaveNo: 'Bleiben',
    kickedTitle: 'Rausgeworfen',
    kickedByHostMessage: 'Du wurdest von {{hostName}} aus dem Raum geworfen',
    kickedDisconnectedMessage:
      'Du wurdest wegen einer Verbindungsunterbrechung aus dem Raum entfernt. Bitte überprüfe deine Internetverbindung.',
    kickedInactivityMessage:
      'Du wurdest wegen Inaktivität oder Verbindungsunterbrechung aus dem Raum entfernt.',
    kickPlayerTitle: 'Spieler rauswerfen',
    kickPlayerMessage: 'Möchtest du {{name}} wirklich aus dem Raum werfen?',
    kickPlayerConfirm: 'Rauswerfen',
    kickPlayerError: 'Spieler konnte nicht rausgeworfen werden',
    kickPlayer: 'Rauswerfen',
    tooManyPlayers: 'Zu viele Spieler! Maximal 4 Spieler erlaubt.',
    noPlayersError: 'Spiel kann nicht ohne Spieler gestartet werden!',
  },
  room: {
    createTitle: 'Raum erstellen',
    joinTitle: 'Raum beitreten',
    enterCode: 'Raumcode eingeben',
    createButton: 'Erstellen',
    joinButton: 'Beitreten',
    invalidCode: 'Raumcode muss 6 Zeichen lang sein',
    roomFull: 'Raum ist voll (4/4 Spieler)',
    roomNotFound: 'Raum nicht gefunden',
    alreadyInRoom: 'Du bist bereits in einem Raum',
    createSubtitle: 'Erstelle einen privaten Raum und lade deine Freunde ein',
    joinSubtitle: 'Gib einen 6-stelligen Raumcode ein, um beizutreten',
    shareableCode: 'Du erhältst einen teilbaren Raumcode',
    upTo4Players: 'Bis zu 4 Spieler können beitreten',
    fillWithBots: 'Leere Plätze mit Bots füllen',
    customizeSettings: 'Spieleinstellungen anpassen',
    mustBeSignedIn: 'Du musst angemeldet sein, um einen Raum zu erstellen',
    alreadyInRoomMessage:
      'Du bist bereits in Raum {{code}} ({{status}}). Verlassen und neuen Raum erstellen?',
    goToRoom: 'Zum Raum gehen',
    leaveAndCreate: 'Verlassen & Erstellen',
    leaveAndJoin: 'Verlassen & Beitreten',
    leaveRoomError: 'Fehler beim Verlassen des Raums',
    leaveTimeout:
      'Das Verlassen des Raums dauert länger als erwartet. Bitte versuche es erneut oder warte einen Moment.',
    createRoomError: 'Fehler beim Erstellen des Raums',
    invalidCodeTitle: 'Ungültiger Code',
    alreadyInDifferentRoom:
      'Du bist bereits in Raum {{code}}. Verlasse ihn zuerst, um einem anderen Raum beizutreten.',
    goToCurrentRoom: 'Zum aktuellen Raum gehen',
    alreadyInAnotherRoom: 'Du bist bereits in einem anderen Raum. Bitte verlasse ihn zuerst.',
    kickedFromRoom: 'Du wurdest aus diesem Raum geworfen und kannst nicht erneut beitreten',
    kickedFromRoomByHost:
      '{{hostName}} hat dich aus der Lobby geworfen und du kannst nicht erneut beitreten',
    joinRoomError: 'Fehler beim Beitreten zum Raum',
    tip: 'Tipp',
    askFriendForCode:
      'Frage deinen Freund nach dem Raumcode und gib ihn hier ein, um seinem Spiel beizutreten',
    createRoomRateLimited:
      'Du hast in letzter Zeit zu viele Räume erstellt. Bitte warte etwa eine Stunde, bevor du einen weiteren erstellst.',
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
    viewFullStats: 'Vollständige Statistiken',
    lowestScore: 'Niedrigste Punktzahl',
    avgCardsLeft: 'Durchschn. Karten übrig',
    gameCompletion: 'Spielabschluss',
    rankProgression: 'Rangverlauf',
    completed: 'Abgeschlossen',
    abandoned: 'Abgebrochen',
    voided: 'Annulliert',
    private: 'Privat',
    casualStats: 'Casual-Statistiken',
    privateStats: 'Privatspiel-Statistiken',
    rankedStats: 'Ranglisten-Statistiken',
    peak: 'Höchstwert',
    lowest: 'Tiefstwert',
    win: 'Sieg',
    loss: 'Niederlage',
    totalGames: 'Spiele gesamt',
    currentPoints: 'Aktuelle Punkte',
    peakPoints: 'Höchstpunktzahl',
    rankPointsProgression: 'Rangpunkte-Verlauf',
    historyTabRecent: '🕑 Aktuell',
    historyTabWon: '🏆 Gewonnen',
    historyTabLost: '❌ Verloren',
    historyTabIncomplete: '⚫ Unvollständig',
    historyEmptyRecent: 'Noch keine Spiele.',
    historyEmptyWon: 'Noch keine Siege.',
    historyEmptyLost: 'Keine Niederlagen.',
    historyEmptyIncomplete: 'Keine unvollständigen Spiele.',
    mutualFriends: 'Gemeinsame Freunde',
    mutualFriendsLabel: '👥 {{count}} gemeinsamer Freund{{plural}} ›',
    mutualFriendsLabelOne: '👥 {{count}} gemeinsamer Freund ›',
    mutualFriendsLabelMany: '👥 {{count}} gemeinsame Freunde ›',
    noMutualFriends: 'Keine gemeinsamen Freunde gefunden',
    unknownPlayer: 'Unbekannt',
  },
  leaderboard: {
    title: 'Bestenliste',
    rank: 'Rang',
    player: 'Spieler',
    wins: 'Siege',
    winRate: 'Gewinnrate',
    score: 'Punkte',
    noData: 'Noch keine Bestenlisten-Daten',
    allTime: 'Gesamt',
    weekly: 'Wöchentlich',
    daily: 'Täglich',
    winLoss: 'S/N',
    points: 'Punkte',
    winStreak: 'Siegesserie',
    noRankings: 'Noch keine Rankings',
    playToRank: 'Spiele ein paar Spiele, um auf der Bestenliste zu erscheinen!',
    rankedTitle: 'Ranglisten-Bestenliste',
    filter: 'Zeitraum',
    matches: 'Spiele',
    noRankedPlayers: 'Keine Ranglisten-Spieler',
    playRankedMatches: 'Spiele 10+ Ranglistenspiele, um hier zu erscheinen',
  },
  auth: {
    signIn: 'Anmelden',
    signUp: 'Registrieren',
    welcomeTitle: 'Willkommen bei Stephanos',
    welcomeSubtitle:
      'Melde dich an, um mit Freunden zu spielen und deinen Fortschritt zu verfolgen',
    email: 'E-Mail',
    password: 'Passwort',
    confirmPassword: 'Passwort bestätigen',
    forgotPassword: 'Passwort vergessen?',
    dontHaveAccount: 'Noch kein Konto?',
    alreadyHaveAccount: 'Bereits ein Konto?',
    signInWithGoogle: 'Mit Google anmelden',
    signInWithApple: 'Mit Apple anmelden',
    orContinueWith: 'Oder fortfahren mit',
    agreeToTerms:
      'Durch Fortfahren stimmst du unseren Nutzungsbedingungen und Datenschutzrichtlinien zu',
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
    description:
      'Wir matchen dich mit Spielern ähnlichen Niveaus. Das Spiel startet automatisch, wenn 4 Spieler bereit sind!',
    // Match Type Preferences (Phase 4b)
    selectMatchType: 'Spieltyp wählen',
    casual: 'Gelegenheitsspiel',
    ranked: 'Rangliste',
    casualDesc: 'Zum Spaß spielen, keine ELO-Änderungen',
    rankedDesc: 'Wettbewerbsspiel mit ELO-Bewertungsänderungen',
    shareWithFriends: 'Mit Freunden teilen',
    friendsCanJoin: 'Freunde können deinem Spiel mit diesem Code beitreten',
    signInRequired: 'Sie müssen angemeldet sein, um die Spielsuche zu nutzen',
    queueExpiresIn: 'Warteschlange läuft ab in {{count}}s',
  },
  matchHistory: {
    title: 'Spielverlauf',
    noMatches: 'Noch keine Spiele',
    playFirstMatch: 'Spiele dein erstes Spiel, um deinen Verlauf hier zu sehen',
    position: '{{ordinal}}. Platz',
    abandoned: 'Abgebrochen',
    elo: 'ELO',
    justNow: 'Gerade eben',
    minutesAgo: 'vor {{count}} Min.',
    hoursAgo: 'vor {{count}} Std.',
    daysAgo: 'vor {{count}} T.',
    local: 'Lokal',
  },
  howToPlay: {
    title: 'Spielanleitung',
    objectiveTitle: '🎯 Ziel',
    objectiveText:
      'Sei der erste Spieler, der alle seine Karten loswird. Der letzte Spieler mit Karten verliert.',
    rankOrderLabel: '🃏 Rangfolge (vom niedrigsten zum höchsten):',
    rankOrder: '3, 4, 5, 6, 7, 8, 9, 10, J, Q, K, A, 2',
    suitOrderLabel: '🎴 Farbenrangfolge (bei gleichem Rang):',
    suitOrder: '♦ Karo, ♣ Kreuz, ♥ Herz, ♠ Pik',
    cardNote:
      'Hinweis: Die Karo 3 (3♦) ist die schwächste Karte & die Pik 2 (2♠) ist die stärkste!',
    noteText:
      'Hinweis: Die Karo 3 (3♦) ist die schwächste Karte & die Pik 2 (2♠) ist die stärkste!',
    validCombinationsTitle: '🎮 Gültige Kombinationen',
    combinationsTitle: '🎮 Gültige Kombinationen',
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
    gameplayPoint2:
      '• Du musst denselben Kombinationstyp (Einzelkarte, Paar usw.) spielen, aber höher',
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
    specialRule3:
      '• Du kannst die Hilfsschaltflächen (Sortieren, Smart, Hinweis) verwenden, um deine Karten zu ordnen',
    autoPassTimer:
      'Auto-Pass-Timer: Bei der höchstmöglichen Karte haben andere Spieler 10 Sekunden zum Reagieren',
    oneCardLeft:
      'Eine Karte übrig: Bei 1 verbleibender Karte muss der vorherige Spieler seine höchste Einzelkarte spielen',
    fiveCardCombos:
      '5-Karten-Kombinationen: Straßen und Flushs können nur von höheren Kombinationen des gleichen Typs geschlagen werden',
    scoringTitle: '🏆 Punktesystem',
    scoringIntro:
      'Am Ende jeder Runde erhalten Spieler, die ihre Karten nicht losgeworden sind, Punkte basierend auf ihren verbleibenden Karten:',
    scoring1to4: '1-4 verbleibende Karten: 1 Punkt',
    scoring5to9: '5-9 verbleibende Karten: 2 Punkte',
    scoring10to13: '10-13 verbleibende Karten: 3 Punkte',
    scoring1to7: '• 1-7 verbleibende Karten = 1 Punkt',
    scoring8to10: '• 8-10 verbleibende Karten = 2 Punkte',
    scoring11to12: '• 11-12 verbleibende Karten = 3 Punkte',
    scoringWarning:
      'Warnung: Der erste Spieler, der über 100 Punkte erreicht, verliert das Spiel! Der Spieler mit der niedrigsten Punktzahl gewinnt.',
    letsPlay: "Los geht's!",
    // ELO Rating System
    eloSystemTitle: '🏆 ELO-Bewertungssystem',
    eloSystemDesc:
      'Deine ELO-Bewertung misst dein Fähigkeitsniveau. Sie steigt, wenn du gewinnst, und sinkt, wenn du in gewerteten Spielen verlierst. Casual-Spiele beeinflussen deine ELO nicht.',
    eloFormula:
      'ELO-Änderungen werden mit der Schachbewertungsformel mit K-Faktor=32 berechnet. Gewinnen gegen höher bewertete Gegner gibt mehr Punkte.',
    rankTiersTitle: 'Rangstufen:',
    // Reconnection & Disconnection
    reconnectionTitle: '🔄 Wiederverbindung & Trennung',
    reconnectionDesc:
      'Wenn du während eines Spiels die Verbindung verlierst, hast du 60 Sekunden Zeit, um dich wieder zu verbinden und deine Position vom Bot zu übernehmen.',
    disconnectGrace:
      '⏱️ Kulanzfrist: 60 Sekunden, um deine App fortzusetzen und deine Position wiederherzustellen.',
    botReplacement:
      '🤖 Bot-Ersatz: Nach 60 Sekunden spielt ein Bot mit deinen aktuellen Karten für dich.',
    spectatorMode:
      '🔄 Wieder beitreten & Bot ersetzen: Du kannst jederzeit während des Spiels wieder beitreten und deine Hand vom Bot übernehmen. Tippe auf "Bot ersetzen & beitreten", um sofort weiterzuspielen.',
  },
  friends: {
    title: 'Freunde',
    myFriends: 'Meine Freunde',
    requests: 'Anfragen',
    noFriends: 'Noch keine Freunde — füge Spieler über die Rangliste oder im Spiel hinzu!',
    noPending: 'Keine ausstehenden Anfragen',
    addFriend: 'Freund hinzufügen',
    added: 'Freundschaftsanfrage gesendet!',
    alreadyFriends: 'Freunde',
    tapToSendFriendRequest: 'Tippe, um eine Freundschaftsanfrage zu senden',
    requestPending: 'Ihr seid bereits befreundet oder eine Anfrage ist ausstehend.',
    requestSent: 'Gesendet',
    cancelRequest: 'Abbrechen',
    accept: 'Annehmen',
    decline: 'Ablehnen',
    unfriend: 'Freundschaft beenden',
    favorite: 'Zu Favoriten hinzufügen',
    unfavorite: 'Favorit entfernen',
    online: 'Online',
    offline: 'Offline',
    sendInvite: 'Einladung senden',
    unknownPlayer: 'Spieler',
    friendRequest: 'Freundschaftsanfrage',
    sentYouARequest: 'hat dir eine Freundschaftsanfrage gesendet.',
    requestAlreadyHandled:
      'Diese Anfrage wurde bereits bearbeitet oder du hast keine Berechtigung.',
    throttle: 'Bitte warte, bevor du eine weitere Anfrage sendest.',
    requestReceived: 'Anfrage erhalten',
    inviteFriends: '👥 Freunde einladen',
    noFriendsToInvite: 'Alle deine Freunde befinden sich bereits in diesem Raum.',
    searchPlaceholder: 'Spieler nach Benutzernamen suchen...',
    clearSearch: 'Suche löschen',
    noResults: 'Keine Spieler gefunden',
  },
  notifications: {
    title: '🔔 Benachrichtigungen',
    empty: 'Noch keine Benachrichtigungen',
    clearAll: 'Alle löschen',
    justNow: 'Gerade eben',
    bellLabel: 'Benachrichtigungen',
    bellLabelWithCount: 'Benachrichtigungen, {{count}} ungelesen',
    bellHint: 'Öffnet den Benachrichtigungsverlauf',
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
      if (
        savedLanguage &&
        (savedLanguage === 'en' || savedLanguage === 'ar' || savedLanguage === 'de')
      ) {
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
      uiLogger.info('[i18n] Initialized with language:', currentLanguage);
    } catch (error) {
      uiLogger.error('[i18n] Failed to load language:', error);
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

      uiLogger.info('[i18n] Language changed to:', language, { requiresRestart });
      return requiresRestart; // Return true if app restart is needed
    } catch (error) {
      uiLogger.error('[i18n] Failed to set language:', error);
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
    let value: unknown = currentTranslations;

    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = (value as Record<string, unknown>)[key];
      } else {
        uiLogger.warn(`[i18n] Translation not found: ${path}`);
        // Report to Sentry as a silent breadcrumb (lazy import to avoid circular deps).
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { reportMissingTranslation } = require('../services/sentry') as {
            reportMissingTranslation: (key: string, lang: string) => void;
          };
          reportMissingTranslation(path, currentLanguage);
        } catch {
          /* Sentry not available */
        }
        return path;
      }
    }

    let result = typeof value === 'string' ? value : path;

    // Replace template variables using DOUBLE-BRACE syntax: {{key}}.
    // This is the canonical interpolation format for this i18n engine.
    // Usage:  i18n.t('section.key', { count: 5 })
    // String: '{{count}}m ago'  →  '5m ago'
    //
    // NOTE: single-brace {key} is NOT handled by this engine. A few legacy
    // strings (e.g. game.autoPassNoOneCanBeat) use component-level .replace()
    // with single-brace — those strings must NOT be passed to t() with vars.
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
