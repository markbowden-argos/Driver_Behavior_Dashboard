// dashboard.js — Driver Behavior Dashboard
// MyGeotab Add-In data layer (imperial / miles)
// Called by dashboard.html via runDashboard(api, onSuccess, onError)

var TRACKED_RULES = [
  "Speeding",
  "HarshBraking",
  "HarshAcceleration",
  "HarshCornering",
  "DistractedDriving",
  "HandheldCellphoneUse",
  "SeatbeltViolation",
  "DriverFatigue"
];

var WEIGHTS = {
  "Speeding":             0.25,
  "HarshBraking":         0.18,
  "HarshAcceleration":    0.12,
  "HarshCornering":       0.08,
  "DistractedDriving":    0.15,
  "HandheldCellphoneUse": 0.12,
  "SeatbeltViolation":    0.06,
  "DriverFatigue":        0.04
};

// Max incidents per 1,000 miles before a category scores zero.
// Update these thresholds to match your fleet's standards.
var MAX_RATE = {
  "Speeding":             16,
  "HarshBraking":         13,
  "HarshAcceleration":    10,
  "HarshCornering":        8,
  "DistractedDriving":     6,
  "HandheldCellphoneUse":  5,
  "SeatbeltViolation":     3,
  "DriverFatigue":         2
};

// Trip.distance from the Geotab API is always in meters.
var METERS_TO_MILES = 0.000621371;

// ---------------------------------------------------------------------------
// Date ranges
// ---------------------------------------------------------------------------

function daysBack(n) {
  var d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

var D_NOW = new Date().toISOString();
var D_30  = daysBack(30);
var D_31  = daysBack(31);
var D_60  = daysBack(60);
var D_YTD = new Date(new Date().getFullYear(), 0, 1).toISOString();

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function calcScore(evtMap, miles) {
  if (miles < 1) { return 100; }
  var per1000mi = miles / 1000;
  var tot = 0, wt = 0;
  var i, rule, cnt, rate, mx, cat;
  for (i = 0; i < TRACKED_RULES.length; i++) {
    rule = TRACKED_RULES[i];
    cnt  = evtMap[rule] ? evtMap[rule] : 0;
    rate = cnt / per1000mi;
    mx   = MAX_RATE[rule] ? MAX_RATE[rule] : 8;
    cat  = 100 - (rate / mx) * 100;
    if (cat < 0) { cat = 0; }
    tot += cat * WEIGHTS[rule];
    wt  += WEIGHTS[rule];
  }
  return wt > 0 ? Math.round(tot / wt) : 100;
}

function grade(s) {
  if (s >= 85) { return "A"; }
  if (s >= 75) { return "B"; }
  if (s >= 65) { return "C"; }
  return "D";
}

function signed(n) {
  return (n >= 0 ? "+" : "") + n;
}

function pctChange(a, b) {
  if (!b) { return "n/a"; }
  return Math.round(((a - b) / b) * 1000) / 10 + "%";
}

function arrAvg(arr) {
  if (!arr.length) { return 0; }
  var s = 0, i;
  for (i = 0; i < arr.length; i++) { s += arr[i]; }
  return Math.round((s / arr.length) * 10) / 10;
}

// ---------------------------------------------------------------------------
// Data aggregation helpers
// ---------------------------------------------------------------------------

function groupByDriver(events, ruleIdToName) {
  var out = {}, i, ev, did, rid, rn;
  for (i = 0; i < events.length; i++) {
    ev  = events[i];
    did = ev.driver && ev.driver.id;
    rid = ev.rule   && ev.rule.id;
    if (!did || !rid) { continue; }
    rn = ruleIdToName[rid];
    if (!rn) { continue; }
    if (!out[did]) { out[did] = {}; }
    out[did][rn] = (out[did][rn] || 0) + 1;
  }
  return out;
}

function milesByDriver(trips) {
  var out = {}, i, t, did;
  for (i = 0; i < trips.length; i++) {
    t   = trips[i];
    did = t.driver && t.driver.id;
    if (!did) { continue; }
    out[did] = (out[did] || 0) + (t.distance || 0) * METERS_TO_MILES;
  }
  return out;
}

function camByDriver(files) {
  var out = {}, i, f, did;
  for (i = 0; i < files.length; i++) {
    f   = files[i];
    did = f.driver && f.driver.id;
    if (!did) { continue; }
    if (!out[did]) { out[did] = 0; }
    out[did] = out[did] + 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main entry point
// Called by dashboard.html: runDashboard(api, onSuccess, onError)
//   onSuccess(rows, fleetSummary) — rows is array of driver result objects
//   onError(message)              — called if either batch fails
// ---------------------------------------------------------------------------

function runDashboard(api, onSuccess, onError) {

  // Batch 1: users (drivers) + rules
  api.multiCall(
    [
      ["Get", { typeName: "User", search: { isDriver: true } }],
      ["Get", { typeName: "Rule", search: {} }]
    ],
    function(r1) {
      var users = r1[0];
      var rules = r1[1];
      var i, j, r, idToName = {};

      // Filter to driver-enabled users; fall back to all users if none flagged
      var drivers = [];
      for (i = 0; i < users.length; i++) {
        if (users[i].isDriver === true) { drivers.push(users[i]); }
      }
      if (drivers.length === 0) { drivers = users; }

      // Build ruleId → ruleName map for only the rules we track
      for (i = 0; i < rules.length; i++) {
        r = rules[i];
        for (j = 0; j < TRACKED_RULES.length; j++) {
          if (r.name === TRACKED_RULES[j]) {
            idToName[r.id] = r.name;
            break;
          }
        }
      }

      // Batch 2: exception events (3 windows) + trips (3 windows) + camera files
      api.multiCall(
        [
          ["Get", { typeName: "ExceptionEvent",
            search: { fromDate: D_30, toDate: D_NOW } }],
          ["Get", { typeName: "ExceptionEvent",
            search: { fromDate: D_60, toDate: D_31 } }],
          ["Get", { typeName: "ExceptionEvent",
            search: { fromDate: D_YTD, toDate: D_NOW } }],
          ["Get", { typeName: "Trip",
            search: { fromDate: D_30, toDate: D_NOW } }],
          ["Get", { typeName: "Trip",
            search: { fromDate: D_60, toDate: D_31 } }],
          ["Get", { typeName: "Trip",
            search: { fromDate: D_YTD, toDate: D_NOW } }],
          ["Get", { typeName: "MediaFile",
            search: { fromDate: D_30, toDate: D_NOW } }]
        ],
        function(r2) {
          var evCur = r2[0], evPrv = r2[1], evYtd = r2[2];
          var trCur = r2[3], trPrv = r2[4], trYtd = r2[5];
          var media = r2[6];

          var emCur = groupByDriver(evCur, idToName);
          var emPrv = groupByDriver(evPrv, idToName);
          var emYtd = groupByDriver(evYtd, idToName);
          var miCur = milesByDriver(trCur);
          var miPrv = milesByDriver(trPrv);
          var miYtd = milesByDriver(trYtd);
          var camCt = camByDriver(media);

          // Score every driver
          var rows = [];
          var d, id, sc, sp, sy, nm, ev;
          for (i = 0; i < drivers.length; i++) {
            d  = drivers[i];
            id = d.id;
            sc = calcScore(emCur[id] || {}, miCur[id] || 0);
            sp = calcScore(emPrv[id] || {}, miPrv[id] || 0);
            sy = calcScore(emYtd[id] || {}, miYtd[id] || 0);
            nm = ((d.firstName || "") + " " + (d.lastName || "")).trim();
            if (!nm) { nm = d.name || id; }
            ev = emCur[id] || {};

            rows.push({
              Name:        nm,
              Score:       sc,
              Grade:       grade(sc),
              vsPrevMo:    signed(sc - sp),
              YTD:         sy,
              vsYTD:       signed(sc - sy),
              Miles:       Math.round(miCur[id] || 0),
              Speeding:    ev["Speeding"]             || 0,
              Braking:     ev["HarshBraking"]         || 0,
              Accel:       ev["HarshAcceleration"]    || 0,
              Distraction: ev["DistractedDriving"]    || 0,
              Phone:       ev["HandheldCellphoneUse"] || 0,
              Camera:      camCt[id] || 0
            });
          }

          rows.sort(function(a, b) { return b.Score - a.Score; });

          // Fleet-level averages
          var sc30 = [], scPr = [], scYt = [], k;
          for (k = 0; k < rows.length; k++) {
            sc30.push(rows[k].Score);
            scPr.push(rows[k].Score - parseInt(rows[k].vsPrevMo, 10));
            scYt.push(rows[k].YTD);
          }

          var avg30  = arrAvg(sc30);
          var avgPrv = arrAvg(scPr);
          var avgYtd = arrAvg(scYt);

          var fleet = {
            score30:         avg30,
            scorePrev:       avgPrv,
            scoreYtd:        avgYtd,
            changePrev:      pctChange(avg30, avgPrv),
            changeYtd:       pctChange(avg30, avgYtd),
            incidents30:     evCur.length,
            incidentsPrev:   evPrv.length,
            incidentsChange: pctChange(evCur.length, evPrv.length),
            cameraEvents:    media.length,
            driverCount:     rows.length
          };

          if (typeof onSuccess === "function") { onSuccess(rows, fleet); }
        },
        function(e) {
          if (typeof onError === "function") { onError("Batch 2: " + e); }
        }
      );
    },
    function(e) {
      if (typeof onError === "function") { onError("Batch 1: " + e); }
    }
  );
}
