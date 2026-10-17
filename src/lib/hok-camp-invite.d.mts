export type HokCampSnapshot = {
  gameUid: string;
  nickname: string;
  icon: string | null;
  grade: number | null;
  score: number | null;
  worldId: number | null;
};
export function parseHokCampInviteLink(input: unknown):
  | { ok: true; profile: HokCampSnapshot }
  | { ok: false; error: string };
