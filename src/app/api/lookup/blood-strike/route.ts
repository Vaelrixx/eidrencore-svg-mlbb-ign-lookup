import { createRapidApiGameHandler } from "../rapidapi-game-routes";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const { POST, GET } = createRapidApiGameHandler("blood-strike");
export { POST, GET };
