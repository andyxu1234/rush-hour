/**
 * 双端共享的"应用装配出口"——把 core / platform / render 的公开符号集中导出。
 *
 * 存在的意义：H5 与小游戏两个入口要装配的是**同一套**东西，
 * 集中在这里可以保证两端不会因为各写一份 import 而逐渐漂移。
 * 本文件不含任何逻辑，只有再导出（装配逻辑在 app-shell.ts）。
 */

export {
  Analytics,
  COLS,
  EXIT_ROW,
  Game,
  H,
  LevelRepository,
  RED_ID,
  ROWS,
  SAVE_KEY,
  Solver,
  V,
  createEmptySave,
  isUnlocked,
  mergeProgress,
  parseLevelPack,
  parseSave,
  recordClear,
  tierOf,
  totalStars,
  unlockedCount,
} from '@rush-hour/core';
export type {
  AnalyticsEvent,
  AnalyticsEventName,
  ClearResult,
  CurrentSession,
  Difficulty,
  Level,
  LevelPack,
  LevelProgress,
  Move,
  MoveDir,
  Piece,
  SaveSettings,
  SaveV1,
  State,
} from '@rush-hour/core';

export { LocalOnlyApi, WebPlatform, WxPlatform } from '@rush-hour/platform';
export type {
  AdsApi,
  AudioApi,
  Platform,
  RemoteApi,
  SavePayloadV1,
  ShareOptions,
  SubmitScoreRequest,
  SubmitScoreResponse,
} from '@rush-hour/platform';

export {
  BootScreen,
  DailyScreen,
  GameScreen,
  LeaderboardScreen,
  MenuScreen,
  PrivacyScreen,
  PRIVACY_SECTIONS,
  ScreenManager,
  SelectScreen,
  SettingsScreen,
  TUTORIAL_TEXT,
  TutorialOverlay,
  computeLayout,
  drawShareCard,
  drawShareCardPreview,
  pickColors,
  SHARE_CARD_SIZE,
} from '@rush-hour/render';
export type {
  GameParams,
  GameScreenDeps,
  GameScreenHooks,
  LeaderboardScope,
  LevelCell,
  MenuAction,
  MenuItem,
  Screen,
  ScreenId,
  ShareCardInfo,
  SettingId,
  SettingItem,
} from '@rush-hour/render';

export { AppShell } from './app-shell';
export type { AppShellDeps } from './app-shell';

/** 构建期注入的关卡包（Vite define / esbuild define） */
declare const __LEVELS__: unknown;

export const levelData: unknown = typeof __LEVELS__ !== 'undefined' ? __LEVELS__ : undefined;
