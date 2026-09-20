import type {
  RemoteApi,
  SavePayloadV1,
  SubmitScoreRequest,
  SubmitScoreResponse,
} from './types';

/**
 * 纯本地空实现（P0–P2 使用）。
 *
 * 设计意图：业务层从第一天起就只依赖 RemoteApi 接口调用云端能力，
 * 因此 P5 接入自建 FastAPI 时，只需在应用入口替换这一个实现，
 * game/save 等模块零改动。
 *
 * 语义约定：
 *  - fetchSave 返回 null 表示"云端无数据"，与本地存档合并时以本地为准；
 *  - pushSave / submitScore 静默成功，不产生网络副作用；
 *  - 所有方法均为 async，保证替换为真实实现时不改变调用点。
 */
export class LocalOnlyApi implements RemoteApi {
  async fetchSave(): Promise<SavePayloadV1 | null> {
    return null;
  }

  async pushSave(_save: SavePayloadV1): Promise<void> {
    /* no-op：离线优先 */
  }

  async submitScore(_req: SubmitScoreRequest): Promise<SubmitScoreResponse> {
    return { accepted: false, bestMoves: 0, stars: 0 };
  }

  async leaderboard(_levelId: string): Promise<Array<{ openid: string; moves: number }>> {
    return [];
  }
}
