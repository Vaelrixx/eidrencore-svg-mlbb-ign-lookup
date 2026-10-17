const CAMP_HOST = "camp.honorofkings.com";
const INVITE_PATH = "/h5/friend-invite/index.html";

function integerOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number <= 2_147_483_647 ? number : null;
}

export function parseHokCampInviteLink(input) {
  if (typeof input !== "string" || input.length > 4096) {
    return { ok: false, error: "Paste a Camp friend-invite link under 4,096 characters." };
  }

  let url;
  try {
    url = new URL(input.trim());
  } catch {
    return { ok: false, error: "That does not look like a valid Camp invite link." };
  }

  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== CAMP_HOST || url.port || url.username || url.password || url.pathname !== INVITE_PATH) {
    return { ok: false, error: "Use the Honor of Kings Camp friend-invite link from your own profile." };
  }
  if (url.searchParams.get("linkType") !== "InviteFriend" || url.searchParams.get("from") !== "HOK") {
    return { ok: false, error: "This Camp link is not a HoK friend invite." };
  }

  const encoded = url.searchParams.get("linkData");
  if (!encoded || encoded.length > 2048) {
    return { ok: false, error: "The invite link does not contain a readable profile snapshot." };
  }

  let snapshot;
  try {
    snapshot = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return { ok: false, error: "The profile snapshot in that invite link could not be read." };
  }

  const uid = typeof snapshot?.uid === "string" ? snapshot.uid : "";
  const linkUid = url.searchParams.get("a1") || "";
  if (!/^\d{6,22}$/.test(uid) || uid !== linkUid) {
    return { ok: false, error: "The UID in the invite link is missing or inconsistent." };
  }

  let nickname = typeof snapshot.name === "string" ? snapshot.name : "";
  try { nickname = decodeURIComponent(nickname); } catch { /* Keep the original text if it is not percent-encoded. */ }
  nickname = nickname.trim();
  if (!nickname || nickname.length > 64 || [...nickname].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    return { ok: false, error: "The nickname in the invite link is missing or invalid." };
  }

  const icon = typeof snapshot.icon === "string" && snapshot.icon.length <= 40 ? snapshot.icon : null;
  const grade = integerOrNull(snapshot.grade);
  const score = integerOrNull(snapshot.score);
  const worldId = integerOrNull(snapshot.dwLogicWorldId);

  return {
    ok: true,
    profile: { gameUid: uid, nickname, icon, grade, score, worldId },
  };
}
