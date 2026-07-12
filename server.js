"use strict";

const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const PORT = Number(process.env.PORT || 3000);
const JMA_ENDPOINT = process.env.JMA_TYPHOON_URL || "https://www.data.jma.go.jp/multi/data/VPTW60/61_cn_zs.json";
const FRESH_MS = 5 * 60 * 1000;
const STALE_MS = 30 * 60 * 1000;
let cache = { value: null, freshUntil: 0, staleUntil: 0 };

// ---------------------------------------------------------------------------
// Utility functions (exported for testing)
// ---------------------------------------------------------------------------

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function parseNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value).trim().replace(/,/g, "");
  const match = text.match(/[-+]?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function normalizeLongitude(value) {
  const number = parseNumber(value);
  if (number === null) return null;
  return /W/i.test(String(value)) ? -Math.abs(number) : number;
}

function normalizeLatitude(value) {
  const number = parseNumber(value);
  if (number === null) return null;
  return /S/i.test(String(value)) ? (-Math.abs(number) || 0) : (number || 0);
}

function findValue(object, names) {
  if (!object || typeof object !== "object") return undefined;
  const wanted = names.map((name) => name.toLowerCase());
  for (const [key, value] of Object.entries(object)) {
    if (wanted.includes(key.toLowerCase())) return value;
  }
  return undefined;
}

function dateValue(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function visit(value, fn, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value); fn(value);
  Object.values(value).forEach((item) => { if (item && typeof item === "object") visit(item, fn, seen); });
}

// ---------------------------------------------------------------------------
// Point extraction from a JMA meteorologicalInfos entry
// ---------------------------------------------------------------------------

/**
 * Parse a single entry from JMA's meteorologicalInfos array.
 * Handles both analysis entries (direct coordinateLat/coordinateLon) and
 * forecast entries (probabilityCircle.basePointLat/basePointLon fallback).
 */
function parseMeteorologicalInfo(info) {
  const cp = info.centerPart || {};
  const wp = info.windPart || {};
  const clp = info.classPart || {};

  // Direct coordinates — available on the analysis (first) entry
  let lat = normalizeLatitude(cp.coordinateLat);
  let lon = normalizeLongitude(cp.coordinateLon);
  let probRadius = null;

  // Forecast entries use probabilityCircle base points instead of direct coords
  if ((lat === null || lon === null) && cp.probabilityCircle) {
    const pc = cp.probabilityCircle;
    lat = normalizeLatitude(pc.basePointLat);
    lon = normalizeLongitude(pc.basePointLon);
    if (pc.axis && pc.axis.radiusKm) {
      probRadius = parseNumber(pc.axis.radiusKm);
    }
  }

  if (lat === null || lon === null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

  return {
    validAt: dateValue(info.dateTime),
    latitude: Number(lat.toFixed(3)),
    longitude: Number(lon.toFixed(3)),
    pressureHpa: parseNumber(cp.pressure),
    windKts: parseNumber(wp.windSpeedKnot),
    gustKts: parseNumber(wp.windGustSpeedKnot),
    movementKph: parseNumber(cp.speedKmH),
    probabilityRadiusKm: probRadius,
    intensity: clp.typhoonClassName || clp.intensityAndTyphoonClass || null
  };
}

// ---------------------------------------------------------------------------
// Wind radii extraction from warningAreaPart50 / warningAreaPart30
// ---------------------------------------------------------------------------

/**
 * Extract wind radii from the first meteorologicalInfos entry's warning areas.
 * warningAreaPart50 = storm-force winds (50 kt), warningAreaPart30 = gale (30 kt).
 * Returns the maximum radius from directional sectors as a conservative estimate.
 */
function extractWindRadii(firstInfo) {
  const found = { stormKm: null, galeKm: null };

  function maxRadius(areas) {
    if (!Array.isArray(areas)) return null;
    const radii = areas.map(function (r) { return parseNumber(r.radiusKm); }).filter(function (n) { return n !== null && n >= 1 && n <= 2500; });
    return radii.length ? Math.max.apply(null, radii) : null;
  }

  if (firstInfo) {
    found.stormKm = maxRadius(firstInfo.warningAreaPart50);
    found.galeKm = maxRadius(firstInfo.warningAreaPart30);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Generic extractRadii (kept for backward compat with tests that use visit)
// ---------------------------------------------------------------------------

function extractRadii(root) {
  const found = { stormKm: null, galeKm: null };
  visit(root, function (item) {
    for (var _i = 0, _a = Object.entries(item); _i < _a.length; _i++) {
      var _b = _a[_i], key = _b[0], value = _b[1];
      var name = key.toLowerCase();
      if (!/(radius|radii|windcircle|wind_radius|暴风|强风|gale|storm)/.test(name)) continue;
      var numeric = parseNumber(typeof value === "object" ? findValue(value, ["radius", "km", "value"]) : value);
      if (!numeric || numeric < 1 || numeric > 2500) continue;
      if (/(storm|暴风|25|30)/.test(name) && !found.stormKm) found.stormKm = numeric;
      if (/(gale|strong|强风|15|50)/.test(name) && !found.galeKm) found.galeKm = numeric;
    }
  });
  return found;
}

// ---------------------------------------------------------------------------
// JMA payload adapter
// ---------------------------------------------------------------------------

/**
 * JMA's multi-language endpoint returns a structure with:
 *   reportDateTime, name, number, meteorologicalInfos[]
 *
 * Each meteorologicalInfos entry has:
 *   centerPart  — coordinateLat, coordinateLon, pressure, speedKmH, probabilityCircle
 *   windPart    — windSpeedKnot, windGustSpeedKnot
 *   classPart   — typhoonClassName, typhoonClass
 *   warningAreaPart50 / warningAreaPart30 — wind radii arrays
 *
 * The first entry is the current analysis; subsequent entries are forecasts.
 * Forecast entries may have null coordinateLat/coordinateLon and use
 * probabilityCircle.basePointLat/basePointLon instead.
 */
function adaptJmaPayload(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("JMA returned an invalid JSON object");

  var reportAt = dateValue(raw.reportDateTime);
  var name = raw.name || "巴威 BAVI";
  var number = raw.number || "2026-09";
  var infos = raw.meteorologicalInfos || [];

  // Parse points from each meteorologicalInfos entry
  var points = [];
  for (var i = 0; i < infos.length; i++) {
    var point = parseMeteorologicalInfo(infos[i]);
    if (point) points.push(point);
  }

  if (!points.length) throw new Error("JMA response contains no valid typhoon coordinates");

  var current = points[0];
  var forecast = points.slice(1, 10);

  return {
    storm: { id: String(number), name: String(name), basin: "西北太平洋", status: current.intensity || null },
    current: current,
    forecast: forecast,
    windRadii: extractWindRadii(infos[0]),
    source: { provider: "日本气象厅 JMA", endpoint: JMA_ENDPOINT, publishedAt: reportAt, fetchedAt: new Date().toISOString() }
  };
}

// ---------------------------------------------------------------------------
// Cached fetch
// ---------------------------------------------------------------------------

async function fetchTyphoon() {
  const now = Date.now();
  if (cache.value && now < cache.freshUntil) return { ...cache.value, meta: { cache: "fresh", stale: false } };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(JMA_ENDPOINT, { signal: controller.signal, headers: { Accept: "application/json", "User-Agent": "BAVI-monitor/1.0" } });
    if (!response.ok) throw new Error(`JMA returned HTTP ${response.status}`);
    const raw = await response.json();
    const value = adaptJmaPayload(raw);
    cache = { value, freshUntil: now + FRESH_MS, staleUntil: now + STALE_MS };
    return { ...value, meta: { cache: "network", stale: false } };
  } catch (error) {
    if (cache.value && now < cache.staleUntil) return { ...cache.value, meta: { cache: "stale", stale: true, error: "更新失败，正在展示最后一次成功数据。" } };
    throw error;
  } finally { clearTimeout(timer); }
}

function clearCache() {
  cache = { value: null, freshUntil: 0, staleUntil: 0 };
}

// ---------------------------------------------------------------------------
// Static file serving
// ---------------------------------------------------------------------------

const typeByExtension = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".css": "text/css; charset=utf-8" };
async function serveStatic(res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const safePath = path.resolve(__dirname, `.${requested}`);
  if (!safePath.startsWith(__dirname)) { res.writeHead(403); return res.end("Forbidden"); }
  try { const file = await fs.readFile(safePath); res.writeHead(200, { "Content-Type": typeByExtension[path.extname(safePath)] || "application/octet-stream" }); res.end(file); }
  catch { res.writeHead(404); res.end("Not found"); }
}

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------

async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (req.method === "GET" && url.pathname === "/api/typhoon") {
    try { return json(res, 200, await fetchTyphoon()); }
    catch (error) { return json(res, 503, { error: "数据暂不可用", detail: error.message, source: { provider: "日本气象厅 JMA", endpoint: JMA_ENDPOINT } }); }
  }
  if (req.method === "GET") return serveStatic(res, url.pathname);
  res.writeHead(405); res.end("Method Not Allowed");
}

function createServer() { return http.createServer(handler); }

// ---------------------------------------------------------------------------
// Exports — Vercel calls module.exports(req, res); tests destructure named
// exports attached to the function object.
// ---------------------------------------------------------------------------

module.exports = handler;
module.exports.handler = handler;
module.exports.createServer = createServer;
module.exports.adaptJmaPayload = adaptJmaPayload;
module.exports.parseMeteorologicalInfo = parseMeteorologicalInfo;
module.exports.extractWindRadii = extractWindRadii;
module.exports.parseNumber = parseNumber;
module.exports.normalizeLatitude = normalizeLatitude;
module.exports.normalizeLongitude = normalizeLongitude;
module.exports.findValue = findValue;
module.exports.dateValue = dateValue;
module.exports.extractRadii = extractRadii;
module.exports.fetchTyphoon = fetchTyphoon;
module.exports.clearCache = clearCache;
module.exports.FRESH_MS = FRESH_MS;
module.exports.STALE_MS = STALE_MS;

// ---------------------------------------------------------------------------
// Local dev server
// ---------------------------------------------------------------------------

if (require.main === module) createServer().listen(PORT, () => console.log(`BAVI monitor: http://localhost:${PORT}`));
