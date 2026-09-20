/**
 * AppShell —— 双端共享的"应用装配 + 导航"。
 *
 * 为什么放在 app-bootstrap 而不是各自入口：
 *   H5 与 小游戏两个入口要装配的是**同一套**屏幕与导航关系。
 *   如果各写一份，极易出现"H5 返回主菜单、小游戏返回选关"这类双端漂移，
 *   而这种 bug 在开发期（只跑 H5）根本发现不了。
 *
 * 层级关系（严格单向，无循环依赖）：
 *   app-bootstrap  →  render（屏幕/UI）  →  core（逻辑） / platform（接口）
 *
 * ⚠️ 本文件不含任何平台实现细节：平台实例由宿主注入，
 *    因此本文件不出现 window / wx / document。
 */

import {
  Analytics,
  LevelRepository,
  SAVE_KEY,
  parseLevelPack,
  parseSave,
  type Level,
  type SaveV1,
} from '@rush-hour/core';
import type { Platform, RemoteApi } from '@rush-hour/platform';
import {
  BootScreen,
  DailyScreen,
  GameScreen,
  LeaderboardScreen,
  MenuScreen,
  PrivacyScreen,
  ScreenManager,
  SelectScreen,
  SettingsScreen,
  type GameParams,
  type ScreenId,
} from '@rush-hour/render';

export interface AppShellDeps {
  platform: Platform;
  /** 关卡包原始数据（构建期内联的 __LEVELS__） */
  levelData: unknown;
  /** 远端契约实现（本轮为 LocalOnlyApi） */
  remote: RemoteApi;
  /** 是否显示启动页（e2e 可关掉以缩短用例时间） */
  showBoot?: boolean;
  /** 启动页停留时长覆盖（测试用） */
  bootMs?: number;
}

export class AppShell {
  readonly analytics: Analytics;
  readonly manager: ScreenManager;
  readonly save: SaveV1;
  readonly repo: LevelRepository;

  private readonly game: GameScreen;
  private readonly select: SelectScreen;
  private readonly settings: SettingsScreen;
  private readonly leaderboard: LeaderboardScreen;
  private readonly privacy: PrivacyScreen;
  private readonly menu: MenuScreen;

  constructor(private readonly deps: AppShellDeps) {
    const { platform } = deps;

    this.analytics = new Analytics();
    this.repo = new LevelRepository(parseLevelPack(deps.levelData));
    this.save = parseSave(platform.storage.get(SAVE_KEY));

    this.manager = new ScreenManager(
      {
        platform,
        onNavigate: (to, from) => {
          this.analytics.track('screen_view', { screen: to, from: from ?? 'none' });
        },
      },
      {},
    );

    // ---- 屏幕装配 ----
    // 注意顺序：GameScreen 与 SelectScreen 需要互相引用（选关→游戏、游戏→返回选关），
    // 因此先创建实例、再通过闭包回调建立双向导航，避免构造期的循环依赖。
    //
    // 屏幕内部发起的导航一律走 push（压栈）：
    //   否则"进到设置页后按返回"会因为栈空而退无可退 —— 这是提审硬伤。
    //   主菜单是唯一用 reset 的入口（进主菜单即清空历史，避免栈无限深）。
    const navigate = (id: ScreenId, params?: unknown) => this.manager.push(id, params);
    const goBack = () => this.back();

    this.game = new GameScreen(
      {
        platform,
        repo: this.repo,
        save: this.save,
        persist: () => this.persist(),
        analytics: this.analytics,
        navigate,
        goBack,
      },
      {
        onProgressChanged: () => this.persist(),
        onShare: (info) => this.share(info),
      },
    );

    this.select = new SelectScreen({
      platform,
      repo: this.repo,
      save: this.save,
      navigate,
      startGame: (p) => this.manager.push('game', { ...p, from: 'select' } satisfies GameParams),
      goBack,
    });

    this.menu = new MenuScreen({
      platform,
      repo: this.repo,
      save: this.save,
      navigate,
      startGame: (p) => this.manager.push('game', { ...p } satisfies GameParams),
    });

    this.settings = new SettingsScreen({
      platform,
      repo: this.repo,
      save: this.save,
      persist: () => this.persist(),
      onWipe: () => this.wipeSave(),
      goBack,
      onReplayTutorial: () => {
        // 重看引导：直接进第一关并强制触发引导遮罩（压栈，便于返回设置页）
        this.manager.push('game', {
          levelId: this.repo.first.id,
          from: 'menu',
          forceTutorial: true,
        } satisfies GameParams);
      },
    });

    this.leaderboard = new LeaderboardScreen({
      platform,
      repo: this.repo,
      save: this.save,
      goBack,
    });

    const daily = new DailyScreen({ platform, goBack });

    this.privacy = new PrivacyScreen({ platform, goBack });

    const boot = new BootScreen({
      platform,
      onDone: () => {
        this.analytics.track('screen_view', { screen: 'menu', from: 'boot' });
        this.manager.reset('menu');
      },
    });

    for (const s of [
      boot,
      this.menu,
      this.select,
      this.game,
      this.settings,
      this.leaderboard,
      daily,
      this.privacy,
    ]) {
      this.manager.register(s);
    }

    this.manager.attach();

    if (deps.showBoot === false) {
      this.manager.currentScreen?.onResize();
      this.manager.reset('menu');
    } else {
      this.manager.navigate('boot');
    }
  }

  /** 启动帧循环 */
  start(): void {
    this.manager.start();
  }

  stop(): void {
    this.manager.stop();
  }

  dispose(): void {
    this.game.dispose();
    this.manager.dispose();
  }

  // ---------------------------------------------------------------- 导航辅助

  /**
   * 返回上一层。
   * 栈空时的兜底：游戏页回主菜单，其余页回主菜单 —— 保证任何页面都能退出，
   * 不会出现"卡在某个页面上没有返回路径"（提审时这是硬伤）。
   */
  private back(): void {
    if (this.manager.back()) return;
    this.manager.reset('menu');
  }

  /**
   * 从列表页直接进游戏（e2e 与深链用）。
   * 走 push 压栈：这样从游戏页返回时会回到进入前的那一屏（选关/主菜单）。
   */
  openLevel(levelId: string, from: 'menu' | 'select' | 'daily' = 'select'): boolean {
    const level = this.repo.get(levelId);
    if (!level) return false;
    this.manager.push('game', { levelId, from } satisfies GameParams);
    return true;
  }

  // ---------------------------------------------------------------- 能力实现

  private persist(): void {
    this.deps.platform.storage.set(SAVE_KEY, JSON.stringify(this.save));
  }

  /**
   * 清档。
   *
   * 必须**同时**清 storage 与内存态：只清 storage 的话，当前 session 里
   * 已经读进内存的 save 对象仍带着旧进度，一旦触发任何 persist()（比如走一步）
   * 就会把旧数据写回去 —— 表现为"清了档但进度还在"。
   */
  wipeSave(): void {
    this.deps.platform.storage.remove(SAVE_KEY);
    for (const k of Object.keys(this.save.levels)) delete this.save.levels[k];
    this.save.current = undefined;
    this.save.tutorialDone = false;
    this.save.settings = { sfx: true, music: true, vibrate: true, moveMetric: 'moves' };
    this.save.dirty = false;
    this.persist();
  }

  /**
   * 分享。
   *
   * 合规红线（docs/01 §6.4）：分享**不得**作为解锁条件。
   * 这里只做"调起分享面板"，没有任何奖励发放逻辑 —— 请勿在此加解锁。
   * 文案不含 openid / 昵称 / 头像，仅含关卡与成绩。
   */
  private share(info: { levelName: string; steps: number; stars: number }): void {
    this.deps.platform.share({
      title: `我在《汽车华容道》用 ${info.steps} 步拿下了「${info.levelName}」，来挑战！`,
      query: 'from=share',
    });
  }

  /** 首屏就绪（供宿主移除加载指示） */
  get booted(): boolean {
    return this.manager.currentId !== null;
  }

  /** 当前关卡（e2e / 深链断言用） */
  get currentLevel(): Level | undefined {
    return this.repo.get(this.game.levelId);
  }

  /** 供 e2e 直接访问游戏屏 */
  get gameScreen(): GameScreen {
    return this.game;
  }

  /** 供 e2e 直接访问选关屏 */
  get selectScreen(): SelectScreen {
    return this.select;
  }

  /** 供 e2e 直接访问设置屏 */
  get settingsScreen(): SettingsScreen {
    return this.settings;
  }

  /** 供 e2e 直接访问排行榜屏 */
  get leaderboardScreen(): LeaderboardScreen {
    return this.leaderboard;
  }

  /** 供 e2e 直接访问隐私政策屏 */
  get privacyScreen(): PrivacyScreen {
    return this.privacy;
  }

  /** 供 e2e 直接访问主菜单屏（断言菜单项、直接触发入口） */
  get menuScreen(): MenuScreen {
    return this.menu;
  }
}
