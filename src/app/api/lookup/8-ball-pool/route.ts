import { createRapidApiGameHandler } from "../rapidapi-game-routes";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const { POST, GET } = createRapidApiGameHandler("8-ball-pool");
export { POST, GET };
