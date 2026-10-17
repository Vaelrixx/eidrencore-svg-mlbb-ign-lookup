import test from "node:test";
import assert from "node:assert/strict";
import { parseHokCampInviteLink } from "../src/lib/hok-camp-invite.mjs";

const makeLink = (overrides = {}) => {
  const payload = {
    uid: "16748967652449811412",
    name: "YT%3aHOKGAMING",
    icon: "@99",
    grade: 8,
    score: 2,
    dwLogicWorldId: 108011,
    ...overrides,
  };
  const params = new URLSearchParams({
    linkType: "InviteFriend",
    from: "HOK",
    a1: payload.uid,
    linkData: Buffer.from(JSON.stringify(payload)).toString("base64url"),
  });
  return `https://camp.honorofkings.com/h5/friend-invite/index.html?${params}`;
};

test("parses a Camp invite snapshot without fetching from Camp", () => {
  const result = parseHokCampInviteLink(makeLink());
  assert.equal(result.ok, true);
  assert.deepEqual(result.profile, {
    gameUid: "16748967652449811412",
    nickname: "YT:HOKGAMING",
    icon: "@99",
    grade: 8,
    score: 2,
    worldId: 108011,
  });
});

test("rejects non-Camp hosts and non-HTTPS URLs", () => {
  assert.equal(parseHokCampInviteLink(makeLink().replace("camp.honorofkings.com", "evil.example")).ok, false);
  assert.equal(parseHokCampInviteLink(makeLink().replace("https://", "http://")).ok, false);
});

test("rejects unrelated Camp pages and non-invite links", () => {
  assert.equal(parseHokCampInviteLink(makeLink().replace("friend-invite/index.html", "app/index.html")).ok, false);
  assert.equal(parseHokCampInviteLink(makeLink().replace("InviteFriend", "Other")).ok, false);
});

test("rejects mismatched, malformed, and oversized snapshot values", () => {
  const mismatched = makeLink().replace("a1=16748967652449811412", "a1=999999999999");
  assert.equal(parseHokCampInviteLink(mismatched).ok, false);
  assert.equal(parseHokCampInviteLink("x".repeat(4097)).ok, false);
  assert.equal(parseHokCampInviteLink("not a URL").ok, false);
});

test("rejects missing or unsafe nickname while allowing nullable stats", () => {
  assert.equal(parseHokCampInviteLink(makeLink({ name: "" })).ok, false);
  const result = parseHokCampInviteLink(makeLink({ grade: "not-a-number", score: null, dwLogicWorldId: -1 }));
  assert.equal(result.ok, true);
  assert.equal(result.profile.grade, null);
  assert.equal(result.profile.score, null);
  assert.equal(result.profile.worldId, null);
});
