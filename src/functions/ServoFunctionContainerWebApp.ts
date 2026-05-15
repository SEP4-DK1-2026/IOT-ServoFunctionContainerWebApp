import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { Pool } from "pg";

// Postgres connection pool - bruger process.env sat i src/index.ts via dotenv.config() ABE GGGG
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
async function willRainNextHour(): Promise<{
  rainNextHour: boolean;
  temperature: number;
}> {
  //Hent nuværende unix-tid
  const now = unixTimestamp();

  // Søg efter forudsigelse inden for næste time + margin
  // Fra nu til 2 timer frem - det sikrer at du rammer selv hvis der er små forsinkelser
  const sql = `
    SELECT predicted_time, precipitation, temperature
    FROM "WeatherPrediction"
    WHERE predicted_time > $1 AND predicted_time <= $2
    ORDER BY predicted_time ASC
    LIMIT 1
  `;

  const res = await pool.query(sql, [now, now + 7200]); // 7200 sekunder for at give lidt margin

  if (res.rows.length === 0) {
    return {
      rainNextHour: false,
      temperature: 0,
    };
  }
  const row = res.rows[0];
  // Tjek precipitation-værdien for den næste forecast
  return {
    rainNextHour: Number(row.precipitation) >= 0.01,
    temperature: Number(row.temperature),
  };
}

// Export så Azure kan finde den, med en indkommende HTTP-request og en kontekst for logging osv.
// Returnerer et promise, der bliver til et HttpResponseInit-objekt
export async function ServoFunctionContainerWebApp(
  req: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const result = await willRainNextHour();
    // Arduino'en læser dette svar og beslutter selv, hvad den skal gøre
    return {
      status: 200,
      headers: {
        "Content-Type": "application/json", //Fortæller at svaret er i JSON-format, så den kan parses.
      },
      body: JSON.stringify({
        rainNextHour: result.rainNextHour,
        temperature: result.temperature,
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
        details: error instanceof Error ? error.message : String(error),
      }),
    };
  }
}

app.http("ServoFunctionContainerWebApp", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: ServoFunctionContainerWebApp,
});
