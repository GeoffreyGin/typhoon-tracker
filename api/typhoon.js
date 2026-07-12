"use strict";

// Vercel serverless function for /api/typhoon
// Reuses the fetch/cache logic from server.js

const { fetchTyphoon, clearCache } = require("../server");

// Clear cache on cold start so we always fetch fresh data
clearCache();

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.writeHead(405, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ error: "Method not allowed" }));
  }

  try {
    const data = await fetchTyphoon();
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    });
    res.end(JSON.stringify(data));
  } catch (error) {
    res.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({
      error: "数据暂不可用",
      detail: error.message,
      source: { provider: "日本气象厅 JMA" }
    }));
  }
};
