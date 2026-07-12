"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");

const server = require("./server");

// ---------------------------------------------------------------------------
// Sample payload matching real JMA structure (2026-07-12 BAVI data)
// ---------------------------------------------------------------------------
const realFormatPayload = {
  reportDateTime: "2026/07/12 06:50",
  name: "BAVI",
  number: "2609",
  meteorologicalInfos: [
    {
      dateTime: "2026/07/12 06:00",
      classPart: { typhoonClass: "STS", typhoonClassName: "强热带风暴", areaClass: "大型", intensityAndTyphoonClass: "强热带风暴" },
      centerPart: { coordinateLat: "29.2N", coordinateLon: "119.8E", probabilityCircle: null, direction: "西北", speedKnot: "17", speedKmH: "30", pressure: "965" },
      windPart: { windSpeedKnot: "60", windSpeedKnotCondition: "なし", windSpeedMS: "30", windSpeedMSCondition: "なし", windGustSpeedKnot: "85", windGustSpeedMS: "45" },
      warningAreaPart50: [{ direction: "东", radiusNm: "120", radiusKm: "220" }, { direction: "西", radiusNm: "60", radiusKm: "110" }],
      warningAreaPart30: [{ direction: "东", radiusNm: "400", radiusKm: "750" }, { direction: "西", radiusNm: "180", radiusKm: "330" }]
    },
    {
      dateTime: "2026/07/12 18:00",
      classPart: { typhoonClass: "TS", typhoonClassName: "热带风暴", areaClass: null, intensityAndTyphoonClass: "热带风暴" },
      centerPart: { coordinateLat: null, coordinateLon: null, probabilityCircle: { basePointLat: "31.3N", basePointLon: "118.4E", axis: { direction: "全区域", radiusNm: "25", radiusKm: "45" } }, direction: "北北西", speedKnot: "12", speedKmH: "20", pressure: "975" },
      windPart: { windSpeedKnot: "45", windSpeedKnotCondition: "なし", windSpeedMS: "23", windSpeedMSCondition: "なし", windGustSpeedKnot: "65", windGustSpeedMS: "35" },
      warningAreaPart50: [{ direction: "全区域", radiusNm: "", radiusKm: "" }],
      warningAreaPart30: null
    },
    {
      dateTime: "2026/07/13 06:00",
      classPart: { typhoonClass: "TS", typhoonClassName: "热带风暴", areaClass: null, intensityAndTyphoonClass: "热带风暴" },
      centerPart: { coordinateLat: null, coordinateLon: null, probabilityCircle: { basePointLat: "32.7N", basePointLon: "117.9E", axis: { direction: "全区域", radiusNm: "35", radiusKm: "65" } }, direction: "北北西", speedKnot: "7", speedKmH: "15", pressure: "985" },
      windPart: { windSpeedKnot: "35", windSpeedKnotCondition: "なし", windSpeedMS: "18", windSpeedMSCondition: "なし", windGustSpeedKnot: "50", windGustSpeedMS: "25" }
    }
  ]
};

// ---------------------------------------------------------------------------
// Group A: parseNumber
// ---------------------------------------------------------------------------
describe("parseNumber", function () {
  it("returns the number as-is when already a finite number", function () {
    assert.equal(server.parseNumber(42), 42);
    assert.equal(server.parseNumber(-15.7), -15.7);
    assert.equal(server.parseNumber(0), 0);
  });
  it("parses a numeric string", function () {
    assert.equal(server.parseNumber("42"), 42);
    assert.equal(server.parseNumber("22.4"), 22.4);
  });
  it("handles comma-separated thousands", function () {
    assert.equal(server.parseNumber("1,234"), 1234);
  });
  it("extracts the first number from strings with units", function () {
    assert.equal(server.parseNumber("945 hPa"), 945);
  });
  it("returns null for null, undefined, empty, and non-numeric", function () {
    assert.equal(server.parseNumber(null), null);
    assert.equal(server.parseNumber(undefined), null);
    assert.equal(server.parseNumber(""), null);
    assert.equal(server.parseNumber("abc"), null);
  });
});

// ---------------------------------------------------------------------------
// Group B: normalizeLatitude / normalizeLongitude
// ---------------------------------------------------------------------------
describe("normalizeLatitude", function () {
  it("handles N/S directional strings", function () {
    assert.equal(server.normalizeLatitude("29.2N"), 29.2);
    assert.equal(server.normalizeLatitude("22.4S"), -22.4);
  });
  it("handles numeric values", function () {
    assert.equal(server.normalizeLatitude(22.4), 22.4);
  });
  it("returns null for invalid inputs", function () {
    assert.equal(server.normalizeLatitude(null), null);
    assert.equal(server.normalizeLatitude(""), null);
  });
});

describe("normalizeLongitude", function () {
  it("handles E/W directional strings", function () {
    assert.equal(server.normalizeLongitude("119.8E"), 119.8);
    assert.equal(server.normalizeLongitude("118.6W"), -118.6);
  });
  it("returns null for invalid inputs", function () {
    assert.equal(server.normalizeLongitude(null), null);
  });
});

// ---------------------------------------------------------------------------
// Group C: dateValue
// ---------------------------------------------------------------------------
describe("dateValue", function () {
  it("parses JMA date format (2026/07/12 06:00)", function () {
    var result = server.dateValue("2026/07/12 06:00");
    assert.ok(result);
    assert.ok(typeof result === "string");
    // Date parses correctly — exact ISO string depends on local timezone
  });
  it("returns null for null, empty, invalid", function () {
    assert.equal(server.dateValue(null), null);
    assert.equal(server.dateValue(""), null);
    assert.equal(server.dateValue("not a date"), null);
  });
});

// ---------------------------------------------------------------------------
// Group D: parseMeteorologicalInfo — analysis entry (direct coords)
// ---------------------------------------------------------------------------
describe("parseMeteorologicalInfo — analysis entry", function () {
  it("extracts all fields from an analysis entry with direct coordinates", function () {
    var info = realFormatPayload.meteorologicalInfos[0];
    var point = server.parseMeteorologicalInfo(info);
    assert.equal(point.latitude, 29.2);
    assert.equal(point.longitude, 119.8);
    assert.equal(point.pressureHpa, 965);
    assert.equal(point.windKts, 60);
    assert.equal(point.gustKts, 85);
    assert.equal(point.movementKph, 30);
    assert.equal(point.intensity, "强热带风暴");
    assert.equal(point.probabilityRadiusKm, null);
    assert.ok(point.validAt);
  });
});

// ---------------------------------------------------------------------------
// Group E: parseMeteorologicalInfo — forecast entry (probabilityCircle fallback)
// ---------------------------------------------------------------------------
describe("parseMeteorologicalInfo — forecast entry", function () {
  it("falls back to probabilityCircle basePoint when direct coords are null", function () {
    var info = realFormatPayload.meteorologicalInfos[1];
    var point = server.parseMeteorologicalInfo(info);
    assert.equal(point.latitude, 31.3);
    assert.equal(point.longitude, 118.4);
    assert.equal(point.pressureHpa, 975);
    assert.equal(point.windKts, 45);
    assert.equal(point.probabilityRadiusKm, 45);
  });
  it("returns null when both direct coords and probabilityCircle are missing", function () {
    var info = { centerPart: {}, windPart: {}, classPart: {} };
    assert.equal(server.parseMeteorologicalInfo(info), null);
  });
});

// ---------------------------------------------------------------------------
// Group F: extractWindRadii
// ---------------------------------------------------------------------------
describe("extractWindRadii", function () {
  it("extracts storm and gale radii from the first meteorologicalInfos entry", function () {
    var radii = server.extractWindRadii(realFormatPayload.meteorologicalInfos[0]);
    assert.equal(radii.stormKm, 220);
    assert.equal(radii.galeKm, 750);
  });
  it("returns null for missing warning areas", function () {
    var radii = server.extractWindRadii({});
    assert.equal(radii.stormKm, null);
    assert.equal(radii.galeKm, null);
  });
  it("filters out empty radius strings", function () {
    var radii = server.extractWindRadii(realFormatPayload.meteorologicalInfos[1]);
    assert.equal(radii.stormKm, null);
    assert.equal(radii.galeKm, null);
  });
});

// ---------------------------------------------------------------------------
// Group G: adaptJmaPayload — real format happy path
// ---------------------------------------------------------------------------
describe("adaptJmaPayload — real JMA format", function () {
  var result;
  before(function () {
    result = server.adaptJmaPayload(realFormatPayload);
  });

  it("returns correct storm metadata", function () {
    assert.equal(result.storm.name, "BAVI");
    assert.equal(result.storm.id, "2609");
    assert.equal(result.storm.basin, "西北太平洋");
    assert.equal(result.storm.status, "强热带风暴");
  });
  it("current point has correct position", function () {
    assert.equal(result.current.latitude, 29.2);
    assert.equal(result.current.longitude, 119.8);
  });
  it("current point has all numeric fields", function () {
    assert.equal(result.current.pressureHpa, 965);
    assert.equal(result.current.windKts, 60);
    assert.equal(result.current.gustKts, 85);
    assert.equal(result.current.movementKph, 30);
  });
  it("current point has intensity from classPart", function () {
    assert.equal(result.current.intensity, "强热带风暴");
  });
  it("forecast has correct number of points", function () {
    assert.equal(result.forecast.length, 2);
  });
  it("forecast points use probabilityCircle base coords", function () {
    assert.equal(result.forecast[0].latitude, 31.3);
    assert.equal(result.forecast[0].longitude, 118.4);
    assert.equal(result.forecast[0].probabilityRadiusKm, 45);
    assert.equal(result.forecast[1].latitude, 32.7);
    assert.equal(result.forecast[1].probabilityRadiusKm, 65);
  });
  it("windRadii extracted correctly", function () {
    assert.equal(result.windRadii.stormKm, 220);
    assert.equal(result.windRadii.galeKm, 750);
  });
  it("source has all required fields", function () {
    assert.equal(result.source.provider, "日本气象厅 JMA");
    assert.ok(result.source.publishedAt);
    assert.ok(result.source.fetchedAt);
    assert.ok(result.source.endpoint);
  });
  it("all top-level keys present", function () {
    assert.ok("storm" in result);
    assert.ok("current" in result);
    assert.ok("forecast" in result);
    assert.ok("windRadii" in result);
    assert.ok("source" in result);
  });
  it("current has all expected point fields", function () {
    var c = result.current;
    assert.ok("validAt" in c);
    assert.ok("latitude" in c);
    assert.ok("longitude" in c);
    assert.ok("pressureHpa" in c);
    assert.ok("windKts" in c);
    assert.ok("gustKts" in c);
    assert.ok("movementKph" in c);
    assert.ok("probabilityRadiusKm" in c);
    assert.ok("intensity" in c);
  });
  it("forecast is always an array", function () {
    assert.ok(Array.isArray(result.forecast));
  });
});

// ---------------------------------------------------------------------------
// Group H: adaptJmaPayload — edge cases
// ---------------------------------------------------------------------------
describe("adaptJmaPayload — edge cases", function () {
  it("handles single-entry (current only, no forecast)", function () {
    var payload = {
      reportDateTime: "2026/07/12 06:00",
      name: "BAVI", number: "2609",
      meteorologicalInfos: [
        { dateTime: "2026/07/12 06:00", classPart: {}, centerPart: { coordinateLat: "29.2N", coordinateLon: "119.8E", pressure: "965" }, windPart: { windSpeedKnot: "60" } }
      ]
    };
    var r = server.adaptJmaPayload(payload);
    assert.equal(r.current.latitude, 29.2);
    assert.equal(r.forecast.length, 0);
  });
  it("handles tropical depression with weak intensity", function () {
    var payload = {
      reportDateTime: "2026/07/12 06:00",
      name: "BAVI", number: "2609",
      meteorologicalInfos: [
        { dateTime: "2026/07/12 06:00", classPart: { typhoonClassName: "热带低气压" }, centerPart: { coordinateLat: "20.0N", coordinateLon: "115.0E", pressure: "1002" }, windPart: { windSpeedKnot: "30" } }
      ]
    };
    var r = server.adaptJmaPayload(payload);
    assert.equal(r.current.latitude, 20.0);
    assert.equal(r.current.intensity, "热带低气压");
    assert.equal(r.current.pressureHpa, 1002);
  });
  it("skips entries where neither direct coords nor probabilityCircle have coords", function () {
    var payload = {
      reportDateTime: "2026/07/12 06:00",
      meteorologicalInfos: [
        { dateTime: "2026/07/12 06:00", centerPart: { coordinateLat: "29.2N", coordinateLon: "119.8E", pressure: "965" }, windPart: {}, classPart: {} },
        { dateTime: "2026/07/13 06:00", centerPart: {}, windPart: {}, classPart: {} },
        { dateTime: "2026/07/14 06:00", centerPart: { coordinateLat: "31.0N", coordinateLon: "120.0E" }, windPart: {}, classPart: {} }
      ]
    };
    var r = server.adaptJmaPayload(payload);
    assert.equal(r.current.latitude, 29.2);
    assert.equal(r.forecast.length, 1);
    assert.equal(r.forecast[0].latitude, 31.0);
  });
  it("caps forecast at 10", function () {
    var infos = [{ dateTime: "2026/07/12 06:00", centerPart: { coordinateLat: "29.2N", coordinateLon: "119.8E" }, windPart: {}, classPart: {} }];
    for (var i = 0; i < 15; i++) {
      infos.push({ dateTime: "2026/07/" + (13 + i) + " 06:00", classPart: {}, centerPart: { coordinateLat: null, coordinateLon: null, probabilityCircle: { basePointLat: (30 + i) + "N", basePointLon: "120E" } }, windPart: {} });
    }
    var r = server.adaptJmaPayload({ reportDateTime: "2026/07/12 06:00", name: "X", number: "9999", meteorologicalInfos: infos });
    assert.ok(r.forecast.length <= 10);
  });
});

// ---------------------------------------------------------------------------
// Group I: adaptJmaPayload — error conditions
// ---------------------------------------------------------------------------
describe("adaptJmaPayload — error conditions", function () {
  it("throws when payload is null", function () {
    assert.throws(function () { server.adaptJmaPayload(null); });
  });
  it("throws when payload is not an object", function () {
    assert.throws(function () { server.adaptJmaPayload("string"); });
    assert.throws(function () { server.adaptJmaPayload([]); });
  });
  it("throws when meteorologicalInfos is missing or empty", function () {
    assert.throws(function () { server.adaptJmaPayload({ reportDateTime: "x" }); });
    assert.throws(function () { server.adaptJmaPayload({ reportDateTime: "x", meteorologicalInfos: [] }); });
  });
  it("throws when no entry has valid coordinates", function () {
    assert.throws(function () {
      server.adaptJmaPayload({ reportDateTime: "x", meteorologicalInfos: [{ centerPart: {}, windPart: {}, classPart: {} }] });
    });
  });
  it("rejects out-of-range latitude", function () {
    var r = server.adaptJmaPayload({
      reportDateTime: "x",
      meteorologicalInfos: [
        { dateTime: "x", centerPart: { coordinateLat: "95N", coordinateLon: "119E" }, windPart: {}, classPart: {} },
        { dateTime: "y", centerPart: { coordinateLat: "29.2N", coordinateLon: "119.8E" }, windPart: {}, classPart: {} }
      ]
    });
    assert.equal(r.current.latitude, 29.2);
    assert.equal(r.forecast.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Group J: fetchTyphoon — cache behavior
// ---------------------------------------------------------------------------
describe("fetchTyphoon — cache behavior", function () {
  var originalFetch;

  before(function () { originalFetch = global.fetch; server.clearCache(); });
  after(function () { global.fetch = originalFetch; server.clearCache(); });

  it("network fetch returns data with meta.cache = 'network'", async function () {
    global.fetch = async function () {
      return { ok: true, status: 200, json: async function () { return realFormatPayload; } };
    };
    var result = await server.fetchTyphoon();
    assert.equal(result.meta.cache, "network");
    assert.equal(result.meta.stale, false);
    assert.equal(result.storm.name, "BAVI");
  });

  it("second call within fresh window returns cached data", async function () {
    var calls = 0;
    global.fetch = async function () { calls++; return { ok: true, status: 200, json: async function () { return realFormatPayload; } }; };
    server.clearCache();
    await server.fetchTyphoon();
    var count = calls;
    var result = await server.fetchTyphoon();
    assert.equal(result.meta.cache, "fresh");
    assert.equal(calls, count);
  });

  it("stale cache: returns stale data when fetch fails", async function () {
    server.clearCache();
    global.fetch = async function () { return { ok: true, status: 200, json: async function () { return realFormatPayload; } }; };
    await server.fetchTyphoon();
    var realNow = Date.now;
    Date.now = function () { return realNow() + 6 * 60 * 1000; };
    global.fetch = async function () { throw new Error("timeout"); };
    var result = await server.fetchTyphoon();
    assert.equal(result.meta.stale, true);
    assert.ok(result.meta.error);
    Date.now = realNow;
  });

  it("throws when no cache and fetch fails", async function () {
    server.clearCache();
    global.fetch = async function () { throw new Error("network down"); };
    await assert.rejects(async function () { await server.fetchTyphoon(); });
  });
});

// ---------------------------------------------------------------------------
// Group K: createServer — integration
// ---------------------------------------------------------------------------
describe("createServer", function () {
  var http = require("node:http");

  it("returns an http.Server instance", function () {
    var s = server.createServer();
    assert.ok(s instanceof http.Server);
    s.close();
  });

  it("responds to GET /api/typhoon with JSON", async function () {
    var origFetch = global.fetch;
    global.fetch = async function () { return { ok: true, status: 200, json: async function () { return realFormatPayload; } }; };
    server.clearCache();
    try {
      var s = server.createServer();
      await new Promise(function (resolve) {
        s.listen(0, function () {
          var port = s.address().port;
          http.get({ hostname: "localhost", port: port, path: "/api/typhoon" }, function (res) {
            var body = "";
            res.on("data", function (d) { body += d; });
            res.on("end", function () {
              assert.equal(res.statusCode, 200);
              assert.ok(res.headers["content-type"].includes("application/json"));
              var parsed = JSON.parse(body);
              assert.equal(parsed.storm.name, "BAVI");
              assert.equal(parsed.current.latitude, 29.2);
              assert.equal(parsed.meta.cache, "network");
              s.close(function () { resolve(); });
            });
          });
        });
      });
    } finally { global.fetch = origFetch; }
  });

  it("returns 405 for POST on /api/typhoon", async function () {
    var s = server.createServer();
    await new Promise(function (resolve) {
      s.listen(0, function () {
        var port = s.address().port;
        var req = http.request({ hostname: "localhost", port: port, path: "/api/typhoon", method: "POST" }, function (res) {
          assert.equal(res.statusCode, 405);
          res.resume();
          s.close(function () { resolve(); });
        });
        req.end();
      });
    });
  });

  it("returns 404 for non-existent static files", async function () {
    var s = server.createServer();
    await new Promise(function (resolve) {
      s.listen(0, function () {
        var port = s.address().port;
        http.get({ hostname: "localhost", port: port, path: "/nonexistent.xyz" }, function (res) {
          assert.equal(res.statusCode, 404);
          res.resume();
          s.close(function () { resolve(); });
        });
      });
    });
  });
});
