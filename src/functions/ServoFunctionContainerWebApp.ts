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
//ret til : async function willRainNextHour(): Promise<boolean> {
async function willRainNextHour(context: InvocationContext): Promise<{
  rainNextHour: boolean;
  predictedTime?: number;
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

  // Hvis der ingen fremtidsdata er, returner false
  if (res.rows.length === 0) {
    context.log("No future weather predictions found after:", now);
    return { rainNextHour: false, temperature: undefined };
  }

  //debugging
  const row = res.rows[0];
  const predictedTime = Number(row.predicted_time);
  const precipitation = Number(row.precipitation);
  context.log("Selected predicted_time:", predictedTime);

  // Tjek precipitation-værdien for den næste forecast
  //return Number(res.rows[0].precipitation) >= 0.01;
  return {
    rainNextHour: precipitation >= 0.01,
    predictedTime,
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
    //const rainNextHour = await willRainNextHour(); 
    const result = await willRainNextHour(context); //context for debug
    // Arduino'en læser dette svar og beslutter selv, hvad den skal gøre
    return {
      status: 200,
      headers: {
        "Content-Type": "application/json", //Fortæller at svaret er i JSON-format, så den kan parses.
      } /*
      body: JSON.stringify({
        rainNextHour,
        action: rainNextHour ? "dosomething" : "donothing",
        predictedTime: row.predicted_time,
      }),
      */,
      body: JSON.stringify({
        rainNextHour: result.rainNextHour,
        action: result.rainNextHour ? "dosomething" : "donothing",
        predictedTime: result.predictedTime,
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
