import { createRapidApiGameHandler } from "../rapidapi-game-routes";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const { POST, GET } = createRapidApiGameHandler("arena-of-valor");
export { POST, GET };
