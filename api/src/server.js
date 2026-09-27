import { createServer } from "node:http";
import { getHeatmap } from "./heatmap.js";

const port = Number(process.env.PORT) || 8787;

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": status === 200 ? "public, max-age=10" : "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Max-Age": "86400",
    });
    response.end();
    return;
  }

  const url = new URL(request.url ?? "/", "http://localhost");
  try {
    if (url.pathname === "/health") {
      sendJson(response, 200, { ok: true });
      return;
    }
    if (url.pathname === "/api/heatmap") {
      sendJson(response, 200, await getHeatmap());
      return;
    }
    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    console.error(error);
    sendJson(response, 503, { error: "Market data is temporarily unavailable." });
  }
});

server.listen(port, () => {
  console.log(`S&P heatmap API listening on ${port}`);
});

getHeatmap()
  .then((body) => {
    console.log(
      `Ready: ${body.quotedCount}/${body.stockCount} quotes, weights as of ${body.weightsAsOf}, ${body.marketStatus}`,
    );
  })
  .catch((error) => {
    console.error(`Cache warm-up failed: ${error.message}`);
  });
