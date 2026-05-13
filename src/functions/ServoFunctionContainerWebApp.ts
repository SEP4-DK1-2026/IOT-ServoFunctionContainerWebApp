import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { Pool } from "pg";

// Postgres connection pool - bruger process.env sat i src/index.ts via dotenv.config()
const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT),
  ssl: true,
});

function unixTimestamp() {
  return Math.floor(Date.now() / 1000);
}

// Database query for at tjekke om det vil regne i næste time
// Bruger promise for placeholder, da det er en asynkron operation
async function willRainNextHour(): Promise<boolean> {
  const start = unixTimestamp();
  const end = start + 3600; // næste time

  const sql = `
    SELECT COUNT(*) as count
    FROM WeatherPrediction
    WHERE ts BETWEEN $1 AND $2
    AND precipitation >= 0.01
    `;

  const res = await pool.query(sql, [start, end]);
  const count = Number(res.rows?.[0]?.cnt || 0);
  return count > 0;
}

// Export så Azure kan finde den, med en indkommende HTTP-request og en kontekst for logging osv.
// Returnerer et promise, der bliver til et HttpResponseInit-objekt
export async function ServoFunctionContainerWebApp(
  req: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const rainNextHour = await willRainNextHour();

    // Arduino'en læser dette svar og beslutter selv, hvad den skal gøre
    return {
      status: 200,
      headers: {
        "Content-Type": "application/json", //Fortæller at svaret er i JSON-format, så den kan parses.
      },
      body: JSON.stringify({
        rainNextHour,
        action: rainNextHour ? "dosomething" : "donothing",
      }),
    };
  } catch (error) {
    context.error("Error in ServoFunctionContainerWebApp:", error);

    return {
      status: 500,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        error: "Failed to check weather",
      }),
    };
  }
}

app.http("ServoFunctionContainerWebApp", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: ServoFunctionContainerWebApp,
});
