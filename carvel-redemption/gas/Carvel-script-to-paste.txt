/**
 * Carvel coupon redemption — Google Sheets backend.
 *
 * Replaces the Supabase database. The Sheet is the ledger; this script is the only
 * thing that writes to it on behalf of the register.
 *
 * THE ONE HARD RULE: a coupon can never be redeemed twice.
 * Every scan runs inside LockService.getScriptLock(), so two phones scanning the same
 * coupon in the same second are queued, one at a time: the first claims the row, the
 * second then finds it already claimed and reports ALREADY USED. Never read the sheet
 * outside the lock and then write inside it — that reintroduces the race.
 *
 * Failure policy is unchanged: any error (including a lock timeout) returns
 * result "error", which the staff screen shows as NO CONNECTION and approves nothing.
 */

var SHEET_ID = '1qGAK_zpTSVUspbi-heRCCSCxqfJJidMW6QAxuIjvKaM';
var TZ = 'America/New_York';
var LOCK_MS = 20000;

// ---------------------------------------------------------------- web endpoints

function doPost(e) {
  var out;
  try {
    var req = JSON.parse(e.postData.contents);
    out = withLock_(function () {
      var ctx = load_();
      return req.action === 'override' ? override_(ctx, req) : redeem_(ctx, req);
    });
  } catch (err) {
    out = { result: 'error', message: String(err) };
  }
  return json_(out);
}

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'ping';
  try {
    if (action === 'stats') return json_(dailyStats_(load_()));
    return json_({ ok: true });
  } catch (err) {
    return json_({ result: 'error', message: String(err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_MS);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ------------------------------------------------------------------- loading

function load_() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var coupons = ss.getSheetByName('Coupons');
  var settings = ss.getSheetByName('Settings');
  var n = coupons.getLastRow() - 1;
  var data = n > 0 ? coupons.getRange(2, 1, n, 6).getValues() : [];

  var s = {};
  settings.getRange(2, 1, 4, 2).getValues().forEach(function (r) {
    s[r[0]] = r[1];
  });

  var regCount = Math.max(settings.getLastRow() - 7, 0);
  var registers = regCount
    ? settings.getRange(8, 1, regCount, 7).getValues().map(function (r) {
        return {
          token: String(r[0]),
          name: r[1],
          enabled: r[2] === true,
          lat: r[3],
          lon: r[4],
          radius: Number(r[5]) || 400,
          enforce: r[6] === true,
        };
      })
    : [];

  return {
    ss: ss,
    coupons: coupons,
    data: data,
    range: {
      min: Number(s.serial_min),
      max: Number(s.serial_max),
      enabled: s.enabled === true,
      unitCost: Number(s.unit_cost) || 0,
    },
    registers: registers,
  };
}

function findStore_(ctx, token) {
  for (var i = 0; i < ctx.registers.length; i++) {
    if (ctx.registers[i].token === String(token) && ctx.registers[i].enabled) {
      return ctx.registers[i];
    }
  }
  return null;
}

function isRedeemed_(row) {
  return row[2] !== '' && row[2] !== null;
}

function toDate_(v) {
  return v instanceof Date ? v : new Date(v);
}

// --------------------------------------------------------------------- location

function distanceM_(lat1, lon1, lat2, lon2) {
  var r = Math.PI / 180;
  var a =
    Math.pow(Math.sin(((lat2 - lat1) * r) / 2), 2) +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.pow(Math.sin(((lon2 - lon1) * r) / 2), 2);
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** ok | far | no_fix | unset. "far" only if outside the radius by MORE than the fix's own accuracy. */
function classify_(store, req) {
  if (store.lat === '' || store.lon === '') return { status: 'unset', distance: null };
  if (req.lat == null || req.lon == null) return { status: 'no_fix', distance: null };
  var d = distanceM_(Number(store.lat), Number(store.lon), Number(req.lat), Number(req.lon));
  var far = d - (Number(req.acc) || 0) > store.radius;
  return { status: far ? 'far' : 'ok', distance: d };
}

// --------------------------------------------------------------------- logging

function log_(ctx, e) {
  ctx.ss
    .getSheetByName('Log')
    .appendRow([
      new Date(),
      e.serial == null ? '' : e.serial,
      e.result,
      e.store || '',
      !!e.test,
      e.geo || '',
      e.distance == null ? '' : Math.round(e.distance),
      e.acc == null ? '' : Math.round(e.acc),
      e.lat == null ? '' : e.lat,
      e.lon == null ? '' : e.lon,
      e.device || '',
      e.note || '',
    ]);
}

function logEntry_(req, result, serial, g, note) {
  return {
    serial: serial,
    result: result,
    store: req.store,
    test: !!req.test,
    geo: g ? g.status : 'unset',
    distance: g ? g.distance : null,
    acc: req.acc,
    lat: req.lat,
    lon: req.lon,
    device: req.device,
    note: note,
  };
}

function reply_(result, redeemedAt, serial, g) {
  return {
    result: result,
    redeemed_at: redeemedAt ? toDate_(redeemedAt).toISOString() : null,
    serial: serial,
    geo_status: g ? g.status : 'unset',
    distance_m: g ? g.distance : null,
  };
}

// ------------------------------------------------------------------- redeem

function redeem_(ctx, req) {
  var serial = parseInt(req.serial, 10);
  var test = !!req.test;
  var store = findStore_(ctx, req.store);

  if (!isFinite(serial) || !store) {
    log_(ctx, logEntry_(req, 'bad_format', isFinite(serial) ? serial : null, null, ''));
    return reply_('bad_format', null, isFinite(serial) ? serial : null, null);
  }

  var g = classify_(store, req);

  // TEST MODE: validate and report, never mutate a coupon.
  if (test) {
    log_(ctx, logEntry_(req, 'test', serial, g, ''));
    return reply_('test', null, serial, g);
  }

  if (g.status === 'far' && store.enforce) {
    log_(ctx, logEntry_(req, 'wrong_location', serial, g, ''));
    return reply_('wrong_location', null, serial, g);
  }

  if (!(ctx.range.enabled && serial >= ctx.range.min && serial <= ctx.range.max)) {
    log_(ctx, logEntry_(req, 'out_of_range', serial, g, ''));
    return reply_('out_of_range', null, serial, g);
  }

  var idx = -1;
  for (var i = 0; i < ctx.data.length; i++) {
    if (Number(ctx.data[i][0]) === serial) {
      idx = i;
      break;
    }
  }

  if (idx === -1) {
    log_(ctx, logEntry_(req, 'not_found', serial, g, ''));
    return reply_('not_found', null, serial, g);
  }

  var row = ctx.data[idx];
  if (isRedeemed_(row)) {
    log_(ctx, logEntry_(req, 'already_used', serial, g, ''));
    return reply_('already_used', row[2], serial, g);
  }

  // The claim. We hold the script lock, and ctx.data was read after taking it.
  var now = new Date();
  ctx.coupons.getRange(idx + 2, 3, 1, 3).setValues([[now, store.token, req.device || '']]);
  SpreadsheetApp.flush();
  log_(ctx, logEntry_(req, 'ok', serial, g, ''));
  return reply_('ok', now, serial, g);
}

// ------------------------------------------------------------------ override

/**
 * Redeem WITHOUT a readable serial: claims one real unclaimed coupon from the TOP of the
 * active range. There are exactly as many rows as printed coupons, so no sequence of
 * scans and overrides can exceed the allotment. When none are left -> "exhausted".
 */
function override_(ctx, req) {
  var reason = String(req.reason || '').replace(/^\s+|\s+$/g, '');
  var store = findStore_(ctx, req.store);

  if (!reason || !store) {
    log_(ctx, logEntry_(req, 'bad_format', null, null, 'override'));
    return { result: 'bad_format', serial: null, remaining: null, geo_status: 'unset', distance_m: null };
  }

  var g = classify_(store, req);
  var note = 'override: ' + reason;

  function available(row) {
    var s = Number(row[0]);
    return (
      row[1] !== true &&
      !isRedeemed_(row) &&
      ctx.range.enabled &&
      s >= ctx.range.min &&
      s <= ctx.range.max
    );
  }

  var remaining = 0;
  var pick = -1;
  for (var i = ctx.data.length - 1; i >= 0; i--) {
    if (available(ctx.data[i])) {
      remaining++;
      if (pick === -1 || Number(ctx.data[i][0]) > Number(ctx.data[pick][0])) pick = i;
    }
  }

  function out(result, serial, rem) {
    return { result: result, serial: serial, remaining: rem, geo_status: g.status, distance_m: g.distance };
  }

  if (!!req.test) {
    log_(ctx, logEntry_(req, 'test', null, g, note));
    return out('test', null, remaining);
  }

  if (g.status === 'far' && store.enforce) {
    log_(ctx, logEntry_(req, 'wrong_location', null, g, note));
    return out('wrong_location', null, remaining);
  }

  if (pick === -1) {
    log_(ctx, logEntry_(req, 'exhausted', null, g, note));
    return out('exhausted', null, 0);
  }

  var serial = Number(ctx.data[pick][0]);
  var now = new Date();
  ctx.coupons.getRange(pick + 2, 3, 1, 4).setValues([[now, store.token, req.device || '', note]]);
  ctx.ss.getSheetByName('Overrides').appendRow([now, serial, reason, store.token, req.device || '']);
  SpreadsheetApp.flush();
  log_(ctx, logEntry_(req, 'override', serial, g, note));
  return out('override', serial, Math.max(remaining - 1, 0));
}

// -------------------------------------------------------------------- stats

function dayOf_(d) {
  return Utilities.formatDate(toDate_(d), TZ, 'yyyy-MM-dd');
}

/** Counts only — no serials, no locations. This is what the nightly report reads. */
function dailyStats_(ctx) {
  var today = dayOf_(new Date());
  var real = ctx.data.filter(function (r) {
    return r[1] !== true;
  });
  var redeemed = real.filter(isRedeemed_);
  var redeemedToday = redeemed.filter(function (r) {
    return dayOf_(r[2]) === today;
  }).length;

  var ov = ctx.ss.getSheetByName('Overrides');
  var ovRows = ov.getLastRow() > 1 ? ov.getRange(2, 1, ov.getLastRow() - 1, 1).getValues() : [];
  var overridesToday = ovRows.filter(function (r) {
    return r[0] !== '' && dayOf_(r[0]) === today;
  }).length;

  var lg = ctx.ss.getSheetByName('Log');
  var lgRows = lg.getLastRow() > 1 ? lg.getRange(2, 1, lg.getLastRow() - 1, 6).getValues() : [];
  var offsiteToday = lgRows.filter(function (r) {
    return r[5] === 'far' && r[4] !== true && r[0] !== '' && dayOf_(r[0]) === today;
  }).length;

  var unitCost = ctx.range.enabled ? ctx.range.unitCost : 0;
  return {
    day: today,
    redeemed_today: redeemedToday,
    overrides_today: overridesToday,
    offsite_today: offsiteToday,
    redeemed_total: redeemed.length,
    remaining: real.length - redeemed.length,
    unit_cost: unitCost,
    amount_owed: redeemed.length * unitCost,
  };
}

// ------------------------------------------------------------- admin (in the Sheet)

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Carvel')
    .addItem('Un-redeem a coupon…', 'unredeem')
    .addToUi();
}

/** Releases a coupon redeemed by mistake. Needs a reason; the scan history stays in Log. */
function unredeem() {
  var ui = SpreadsheetApp.getUi();
  var s = ui.prompt('Un-redeem', 'Serial number to release (e.g. 123):', ui.ButtonSet.OK_CANCEL);
  if (s.getSelectedButton() !== ui.Button.OK) return;
  var serial = parseInt(s.getResponseText(), 10);
  if (!isFinite(serial)) return ui.alert('That is not a serial number.');

  var r = ui.prompt('Reason (required)', 'Why is this being released?', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var reason = r.getResponseText().replace(/^\s+|\s+$/g, '');
  if (reason.length < 3) return ui.alert('A reason is required — it goes in the audit trail.');

  var msg = withLock_(function () {
    var ctx = load_();
    for (var i = 0; i < ctx.data.length; i++) {
      if (Number(ctx.data[i][0]) !== serial) continue;
      if (!isRedeemed_(ctx.data[i])) return serial + ' was not redeemed, so there is nothing to release.';
      ctx.coupons.getRange(i + 2, 3, 1, 4).setValues([['', '', '', 'un-redeemed ' + dayOf_(new Date()) + ': ' + reason]]);
      ctx.ss
        .getSheetByName('Log')
        .appendRow([new Date(), serial, 'unredeemed', '', false, '', '', '', '', '', Session.getActiveUser().getEmail(), reason]);
      return serial + ' released — it can be redeemed again.';
    }
    return 'No coupon with serial ' + serial + '.';
  });
  ui.alert(msg);
}

// ------------------------------------------------------------------ one-time setup

var HIST = {"redeemed":[[3,"2026-08-22T16:33:48.610Z","CARVEL-WLB","kbjkv2/ios"],[11,"2026-09-14T20:24:50.392Z","CARVEL-WLB","b44q4y/ios"],[13,"2026-08-29T18:26:35.958Z","CARVEL-WLB","bc6khc/ios"],[14,"2026-08-29T18:27:25.887Z","CARVEL-WLB","c8o85p/ios"],[15,"2026-08-28T19:02:16.418Z","CARVEL-WLB","segi53/ios"],[16,"2026-08-28T19:02:13.953Z","CARVEL-WLB","segi53/ios"],[17,"2026-08-30T19:08:35.836Z","CARVEL-WLB","segi53/ios"],[18,"2026-08-29T18:27:05.137Z","CARVEL-WLB","bc6khc/ios"],[19,"2026-08-31T19:21:34.407Z","CARVEL-WLB","b44q4y/ios"],[22,"2026-08-23T21:29:49.991Z","CARVEL-WLB","v25pi2/ios"],[23,"2026-09-04T21:11:27.797Z","CARVEL-WLB","076a0o/ios"],[24,"2026-09-01T20:05:29.678Z","CARVEL-WLB","7kn9iy/ios"],[25,"2026-08-25T17:18:42.546Z","CARVEL-WLB","wm1ssx/ios"],[35,"2026-09-04T21:11:22.208Z","CARVEL-WLB","076a0o/ios"],[40,"2026-08-23T21:29:42.955Z","CARVEL-WLB","v25pi2/ios"],[42,"2026-09-01T20:05:33.758Z","CARVEL-WLB","7kn9iy/ios"],[43,"2026-08-25T17:18:48.414Z","CARVEL-WLB","wm1ssx/ios"],[46,"2026-09-04T00:20:38.099Z","CARVEL-WLB","vyvzpc/ios"],[56,"2026-08-23T21:29:56.429Z","CARVEL-WLB","v25pi2/ios"],[57,"2026-09-01T20:05:37.846Z","CARVEL-WLB","7kn9iy/ios"],[58,"2026-08-23T21:29:34.989Z","CARVEL-WLB","v25pi2/ios"],[60,"2026-09-01T20:05:41.041Z","CARVEL-WLB","7kn9iy/ios"],[117,"2026-08-29T19:44:04.725Z","CARVEL-WLB","bwtuxb/ios"],[133,"2026-10-05T22:01:45.155Z","CARVEL-WLB","b44q4y/ios"],[134,"2026-08-25T21:11:26.673Z","CARVEL-WLB","bc6khc/ios"],[135,"2026-09-06T19:12:56.029Z","CARVEL-WLB","segi53/ios"],[136,"2026-10-05T22:01:28.313Z","CARVEL-WLB","b44q4y/ios"],[137,"2026-08-25T21:11:17.580Z","CARVEL-WLB","bc6khc/ios"],[138,"2026-09-06T19:13:08.411Z","CARVEL-WLB","segi53/ios"],[139,"2026-08-23T21:29:07.585Z","CARVEL-WLB","v25pi2/ios"],[141,"2026-08-23T21:28:58.869Z","CARVEL-WLB","v25pi2/ios"],[151,"2026-10-05T22:01:38.224Z","CARVEL-WLB","b44q4y/ios"],[152,"2026-08-25T21:11:11.980Z","CARVEL-WLB","bc6khc/ios"],[153,"2026-09-06T19:13:00.567Z","CARVEL-WLB","segi53/ios"],[162,"2026-09-24T19:11:41.885Z","CARVEL-WLB","b44q4y/ios"],[169,"2026-10-05T22:01:41.755Z","CARVEL-WLB","b44q4y/ios"],[170,"2026-08-25T21:11:21.912Z","CARVEL-WLB","bc6khc/ios"],[171,"2026-09-06T19:13:03.911Z","CARVEL-WLB","segi53/ios"],[180,"2026-09-11T19:30:24.132Z","CARVEL-WLB","segi53/ios"],[188,"2026-09-06T21:24:17.429Z","CARVEL-WLB","8qtv1a/ios"],[190,"2026-08-29T18:26:58.640Z","CARVEL-WLB","bc6khc/ios"],[191,"2026-08-28T19:02:09.312Z","CARVEL-WLB","segi53/ios"],[208,"2026-08-29T18:26:54.949Z","CARVEL-WLB","c8o85p/ios"],[215,"2026-09-01T19:21:33.830Z","CARVEL-WLB","b44q4y/ios"],[216,"2026-09-11T19:30:22.379Z","CARVEL-WLB","segi53/ios"],[227,"2026-08-31T19:21:30.947Z","CARVEL-WLB","b44q4y/ios"],[233,"2026-09-01T19:21:47.057Z","CARVEL-WLB","b44q4y/ios"],[270,"2026-10-09T17:58:09.710Z","CARVEL-WLB","segi53/ios"],[285,"2026-08-21T15:01:52.313Z","CARVEL-WLB","1frp7t/ios"],[291,"2026-08-25T21:11:04.551Z","CARVEL-WLB","yuc8by/ios"],[313,"2026-09-22T19:17:19.211Z","CARVEL-WLB","b44q4y/ios"],[327,"2026-08-25T21:11:44.614Z","CARVEL-WLB","bc6khc/ios"],[351,"2026-09-06T17:20:46.196Z","CARVEL-WLB","segi53/ios"],[369,"2026-09-06T17:20:41.210Z","CARVEL-WLB","segi53/ios"],[386,"2026-09-06T17:20:44.046Z","CARVEL-WLB","segi53/ios"],[402,"2026-09-04T00:20:44.472Z","CARVEL-WLB","vyvzpc/ios"],[405,"2026-08-28T17:01:58.027Z","CARVEL-WLB","segi53/ios"],[409,"2026-08-31T19:21:36.170Z","CARVEL-WLB","b44q4y/ios"],[412,"2026-09-11T16:12:16.556Z","CARVEL-WLB","segi53/ios"],[416,"2026-09-11T16:12:14.112Z","CARVEL-WLB","segi53/ios"],[422,"2026-09-11T16:12:08.146Z","CARVEL-WLB","segi53/ios"],[424,"2026-09-06T17:40:55.997Z","CARVEL-WLB","segi53/ios"],[445,"2026-08-31T19:21:38.414Z","CARVEL-WLB","b44q4y/ios"],[449,"2026-09-11T16:12:04.958Z","CARVEL-WLB","segi53/ios"],[452,"2026-09-20T16:47:01.318Z","CARVEL-WLB","segi53/ios"],[454,"2026-10-18T20:25:43.371Z","CARVEL-WLB","segi53/ios"],[455,"2026-09-04T00:20:51.909Z","CARVEL-WLB","vyvzpc/ios"],[463,"2026-09-20T16:47:06.016Z","CARVEL-WLB","segi53/ios"],[464,"2026-09-06T17:40:46.771Z","CARVEL-WLB","segi53/ios"],[467,"2026-09-06T17:40:53.425Z","CARVEL-WLB","segi53/ios"],[472,"2026-09-07T22:36:24.892Z","CARVEL-WLB","f4xjkf/ios"],[473,"2026-08-28T17:02:02.543Z","CARVEL-WLB","segi53/ios"],[474,"2026-09-29T22:39:53.081Z","CARVEL-WLB","pbfei7/ios"],[475,"2026-10-18T20:25:49.010Z","CARVEL-WLB","segi53/ios"],[477,"2026-10-18T20:25:46.876Z","CARVEL-WLB","segi53/ios"],[484,"2026-09-20T16:46:56.128Z","CARVEL-WLB","segi53/ios"],[485,"2026-09-06T17:41:00.496Z","CARVEL-WLB","segi53/ios"],[491,"2026-09-15T22:57:16.020Z","CARVEL-WLB","781cwf/ios"],[493,"2026-10-18T20:25:50.194Z","CARVEL-WLB","segi53/ios"],[494,"2026-09-29T22:39:57.693Z","CARVEL-WLB","pbfei7/ios"],[495,"2026-10-18T20:25:41.149Z","CARVEL-WLB","segi53/ios"]],"log":[["2026-08-13T19:49:46.208Z",148,"test","CARVEL-WLB",true,"far",39660,8,40.344536109736,-74.4912995941763,"woq04l/ios",""],["2026-08-13T19:49:54.228Z",137,"test","CARVEL-WLB",true,"far",39660,7,40.3445361084604,-74.491299577546,"woq04l/ios",""],["2026-08-13T19:50:06.152Z",148,"test","CARVEL-WLB",true,"far",39660,9,40.3445361059566,-74.4912995449045,"woq04l/ios",""],["2026-08-13T19:51:48.314Z",900001,"out_of_range","CARVEL-WLB",false,"far",39660,9,40.3445361075034,-74.4912995607809,"hf8joo/ios",""],["2026-08-13T20:35:10.782Z",900001,"test","CARVEL-WLB",true,"far",39647,10,40.3445612792293,-74.4911342207883,"zx9vre/ios",""],["2026-08-16T16:49:26.110Z",900001,"test","CARVEL-WLB",true,"ok",74,23,40.294833408065,-74.0288717129999,"hf8joo/ios",""],["2026-08-16T16:54:35.340Z",900001,"out_of_range","CARVEL-WLB",false,"ok",73,14,40.2948032263712,-74.0288736171244,"hf8joo/ios",""],["2026-08-16T16:54:47.427Z",900001,"out_of_range","CARVEL-WLB",false,"ok",73,11,40.294801577671,-74.0288803703443,"hf8joo/ios",""],["2026-08-16T16:54:50.262Z",900001,"out_of_range","CARVEL-WLB",false,"ok",72,11,40.2947914706787,-74.0288700791872,"hf8joo/ios",""],["2026-08-16T17:01:42.496Z",900001,"out_of_range","CARVEL-WLB",false,"no_fix","","","","","8r32jl/ios",""],["2026-08-16T21:18:10.646Z",900001,"out_of_range","CARVEL-WLB",false,"no_fix","","","","","943gzm/ios",""],["2026-08-21T15:01:52.313Z",285,"ok","CARVEL-WLB",false,"no_fix","","","","","1frp7t/ios",""],["2026-08-21T15:02:04.793Z",285,"already_used","CARVEL-WLB",false,"no_fix","","","","","a2rwjh/ios",""],["2026-08-22T16:33:48.610Z",3,"ok","CARVEL-WLB",false,"ok",79,24,40.2948737457657,-74.0289084556279,"kbjkv2/ios",""],["2026-08-22T16:34:08.978Z",3,"already_used","CARVEL-WLB",false,"ok",76,19,40.2948214483652,-74.0289100545898,"kbjkv2/ios",""],["2026-08-23T21:28:58.869Z",141,"ok","CARVEL-WLB",false,"ok",67,12,40.2944653594785,-74.028910173631,"v25pi2/ios",""],["2026-08-23T21:29:07.585Z",139,"ok","CARVEL-WLB",false,"ok",67,9,40.2944653401959,-74.0289101551923,"v25pi2/ios",""],["2026-08-23T21:29:34.989Z",58,"ok","CARVEL-WLB",false,"ok",67,11,40.2944653151065,-74.0289101312009,"v25pi2/ios",""],["2026-08-23T21:29:42.955Z",40,"ok","CARVEL-WLB",false,"ok",67,10,40.2944653142467,-74.0289101303788,"v25pi2/ios",""],["2026-08-23T21:29:49.991Z",22,"ok","CARVEL-WLB",false,"ok",69,8,40.2944603004827,-74.0289347236351,"v25pi2/ios",""],["2026-08-23T21:29:56.429Z",56,"ok","CARVEL-WLB",false,"ok",69,8,40.2944621539803,-74.0289392651608,"v25pi2/ios",""],["2026-08-23T21:30:06.265Z",22,"already_used","CARVEL-WLB",false,"ok",66,6,40.2944062849096,-74.0288988456177,"v25pi2/ios",""],["2026-08-25T17:18:42.546Z",25,"ok","CARVEL-WLB",false,"ok",92,30,40.294960916252,-74.029017102794,"wm1ssx/ios",""],["2026-08-25T17:18:48.414Z",43,"ok","CARVEL-WLB",false,"ok",73,8,40.2947074357765,-74.0289301439314,"wm1ssx/ios",""],["2026-08-25T21:11:04.551Z",291,"ok","CARVEL-WLB",false,"no_fix","","","","","yuc8by/ios",""],["2026-08-25T21:11:11.980Z",152,"ok","CARVEL-WLB",false,"no_fix","","","","","bc6khc/ios",""],["2026-08-25T21:11:17.580Z",137,"ok","CARVEL-WLB",false,"no_fix","","","","","bc6khc/ios",""],["2026-08-25T21:11:21.912Z",170,"ok","CARVEL-WLB",false,"no_fix","","","","","bc6khc/ios",""],["2026-08-25T21:11:26.673Z",134,"ok","CARVEL-WLB",false,"no_fix","","","","","bc6khc/ios",""],["2026-08-25T21:11:32.969Z",25,"already_used","CARVEL-WLB",false,"no_fix","","","","","bc6khc/ios",""],["2026-08-25T21:11:38.791Z",43,"already_used","CARVEL-WLB",false,"no_fix","","","","","bc6khc/ios",""],["2026-08-25T21:11:44.614Z",327,"ok","CARVEL-WLB",false,"no_fix","","","","","bc6khc/ios",""],["2026-08-25T21:11:51.028Z",900001,"out_of_range","CARVEL-WLB",false,"no_fix","","","","","bc6khc/ios",""],["2026-08-25T23:34:39.916Z",327,"already_used","CARVEL-WLB",false,"ok",72,11,40.2945934295387,-74.0289624767991,"hczwrk/ios",""],["2026-08-28T17:01:58.027Z",405,"ok","CARVEL-WLB",false,"no_fix","","","","","segi53/ios",""],["2026-08-28T17:02:02.543Z",473,"ok","CARVEL-WLB",false,"no_fix","","","","","segi53/ios",""],["2026-08-28T17:02:12.780Z",405,"already_used","CARVEL-WLB",false,"no_fix","","","","","segi53/ios",""],["2026-08-28T17:02:22.535Z",405,"already_used","CARVEL-WLB",false,"no_fix","","","","","segi53/ios",""],["2026-08-28T19:02:09.312Z",191,"ok","CARVEL-WLB",false,"no_fix","","","","","segi53/ios",""],["2026-08-28T19:02:13.953Z",16,"ok","CARVEL-WLB",false,"no_fix","","","","","segi53/ios",""],["2026-08-28T19:02:16.418Z",15,"ok","CARVEL-WLB",false,"no_fix","","","","","segi53/ios",""],["2026-08-29T18:26:35.958Z",13,"ok","CARVEL-WLB",false,"no_fix","","","","","bc6khc/ios",""],["2026-08-29T18:26:54.949Z",208,"ok","CARVEL-WLB",false,"ok",79,23,40.2948631207932,-74.0289154311069,"c8o85p/ios",""],["2026-08-29T18:26:58.640Z",190,"ok","CARVEL-WLB",false,"no_fix","","","","","bc6khc/ios",""],["2026-08-29T18:27:05.137Z",18,"ok","CARVEL-WLB",false,"no_fix","","","","","bc6khc/ios",""],["2026-08-29T18:27:25.887Z",14,"ok","CARVEL-WLB",false,"ok",86,37,40.2949002233383,-74.0289798204847,"c8o85p/ios",""],["2026-08-29T19:44:04.725Z",117,"ok","CARVEL-WLB",false,"ok",81,33,40.2948790516737,-74.0289349077708,"bwtuxb/ios",""],["2026-08-29T19:44:10.152Z",15,"already_used","CARVEL-WLB",false,"ok",83,29,40.2948916570244,-74.0289456972117,"bwtuxb/ios",""],["2026-08-29T19:44:25.173Z",16,"already_used","CARVEL-WLB",false,"ok",83,34,40.2949045543091,-74.0289296786562,"bwtuxb/ios",""],["2026-08-29T19:44:30.986Z",191,"already_used","CARVEL-WLB",false,"ok",83,42,40.2948948171869,-74.0289410031076,"bwtuxb/ios",""],["2026-08-29T19:44:35.530Z",405,"already_used","CARVEL-WLB",false,"ok",83,30,40.2949004550027,-74.0289425995548,"bwtuxb/ios",""],["2026-08-29T19:44:40.412Z",473,"already_used","CARVEL-WLB",false,"ok",84,36,40.2949038460869,-74.0289546686191,"bwtuxb/ios",""],["2026-08-29T19:44:46.053Z",473,"already_used","CARVEL-WLB",false,"ok",84,36,40.2949038460869,-74.0289546686191,"bwtuxb/ios",""],["2026-08-29T19:44:52.143Z",285,"already_used","CARVEL-WLB",false,"ok",82,29,40.2949013870931,-74.0289238067303,"bwtuxb/ios",""],["2026-08-29T19:44:57.826Z",327,"already_used","CARVEL-WLB",false,"ok",85,39,40.2949052723465,-74.0289563130263,"bwtuxb/ios",""],["2026-08-29T19:45:02.683Z",134,"already_used","CARVEL-WLB",false,"ok",84,36,40.2948944706671,-74.0289641905376,"bwtuxb/ios",""],["2026-08-29T19:45:08.896Z",170,"already_used","CARVEL-WLB",false,"ok",83,30,40.2948901152799,-74.0289481342109,"bwtuxb/ios",""],["2026-08-29T19:45:13.652Z",137,"already_used","CARVEL-WLB",false,"ok",84,37,40.2949032304518,-74.0289545306386,"bwtuxb/ios",""],["2026-08-29T19:45:17.237Z",152,"already_used","CARVEL-WLB",false,"ok",84,37,40.2949032304518,-74.0289545306386,"bwtuxb/ios",""],["2026-08-29T19:45:20.669Z",291,"already_used","CARVEL-WLB",false,"ok",87,62,40.2949407670196,-74.0289625491174,"bwtuxb/ios",""],["2026-08-29T19:45:23.601Z",25,"already_used","CARVEL-WLB",false,"ok",72,26,40.294679232556,-74.0289397340333,"bwtuxb/ios",""],["2026-08-29T19:45:27.928Z",43,"already_used","CARVEL-WLB",false,"ok",61,19,40.2945970628033,-74.0288279123551,"bwtuxb/ios",""],["2026-08-29T19:45:28.902Z",43,"already_used","CARVEL-WLB",false,"ok",60,17,40.294567263867,-74.0288227812328,"bwtuxb/ios",""],["2026-08-29T19:45:33.089Z",56,"already_used","CARVEL-WLB",false,"ok",63,17,40.2945215963649,-74.0288678881616,"bwtuxb/ios",""],["2026-08-29T19:45:36.119Z",40,"already_used","CARVEL-WLB",false,"ok",69,15,40.2946029763934,-74.0289304602992,"bwtuxb/ios",""],["2026-08-29T19:45:36.925Z",22,"already_used","CARVEL-WLB",false,"ok",72,15,40.2946016391914,-74.028966859708,"bwtuxb/ios",""],["2026-08-29T19:45:41.003Z",40,"already_used","CARVEL-WLB",false,"ok",74,14,40.2945900279657,-74.0289922234277,"bwtuxb/ios",""],["2026-08-29T19:45:44.485Z",58,"already_used","CARVEL-WLB",false,"ok",63,30,40.2943917142654,-74.0288558414048,"bwtuxb/ios",""],["2026-08-29T19:45:48.043Z",141,"already_used","CARVEL-WLB",false,"ok",71,47,40.2946474543218,-74.0289371275101,"bwtuxb/ios",""],["2026-08-29T19:45:51.629Z",139,"already_used","CARVEL-WLB",false,"ok",74,52,40.2946143888452,-74.0289779654583,"bwtuxb/ios",""],["2026-08-29T19:45:54.814Z",3,"already_used","CARVEL-WLB",false,"ok",61,29,40.2944596081694,-74.0288414915997,"bwtuxb/ios",""],["2026-08-30T19:08:35.836Z",17,"ok","CARVEL-WLB",false,"no_fix","","","","","segi53/ios",""],["2026-08-31T19:21:30.947Z",227,"ok","CARVEL-WLB",false,"no_fix","","","","","b44q4y/ios",""],["2026-08-31T19:21:34.407Z",19,"ok","CARVEL-WLB",false,"no_fix","","","","","b44q4y/ios",""],["2026-08-31T19:21:36.170Z",409,"ok","CARVEL-WLB",false,"no_fix","","","","","b44q4y/ios",""],["2026-08-31T19:21:38.414Z",445,"ok","CARVEL-WLB",false,"no_fix","","","","","b44q4y/ios",""],["2026-09-01T19:21:33.830Z",215,"ok","CARVEL-WLB",false,"no_fix","","","","","b44q4y/ios",""],["2026-09-01T19:21:35.416Z",215,"already_used","CARVEL-WLB",false,"no_fix","","","","","b44q4y/ios",""],["2026-09-01T19:21:40.357Z",215,"already_used","CARVEL-WLB",false,"no_fix","","","","","b44q4y/ios",""],["2026-09-01T19:21:47.057Z",233,"ok","CARVEL-WLB",false,"no_fix","","","","","b44q4y/ios",""],["2026-09-01T19:21:51.052Z",215,"already_used","CARVEL-WLB",false,"no_fix","","","","","b44q4y/ios",""],["2026-09-01T20:05:29.678Z",24,"ok","CARVEL-WLB",false,"ok",82,23,40.2948860886443,-74.028943732001,"7kn9iy/ios",""],["2026-09-01T20:05:33.758Z",42,"ok","CARVEL-WLB",false,"ok",82,23,40.2948860886443,-74.028943732001,"7kn9iy/ios",""],["2026-09-01T20:05:37.846Z",57,"ok","CARVEL-WLB",false,"ok",84,33,40.2948881653655,-74.0289619004462,"7kn9iy/ios",""],["2026-09-01T20:05:41.041Z",60,"ok","CARVEL-WLB",false,"ok",68,28,40.2947964496271,-74.0288139639703,"7kn9iy/ios",""],["2026-09-04T00:20:38.099Z",46,"ok","CARVEL-WLB",false,"ok",67,12,40.2944961019776,-74.0289170462138,"vyvzpc/ios",""],["2026-09-04T00:20:44.472Z",402,"ok","CARVEL-WLB",false,"ok",67,10,40.2944931208888,-74.0289170866562,"vyvzpc/ios",""],["2026-09-04T00:20:51.909Z",455,"ok","CARVEL-WLB",false,"ok",67,9,40.2944914248062,-74.0289171392149,"vyvzpc/ios",""],["2026-09-04T21:11:22.208Z",35,"ok","CARVEL-WLB",false,"ok",73,10,40.2943095376336,-74.0289495612949,"076a0o/ios",""],["2026-09-04T21:11:27.797Z",23,"ok","CARVEL-WLB",false,"ok",70,7,40.2943706684126,-74.0289419536602,"076a0o/ios",""],["2026-09-05T18:26:00.330Z",455,"already_used","CARVEL-WLB",false,"no_fix","","","","","mjch2i/ios",""],["2026-09-05T18:26:05.697Z",402,"already_used","CARVEL-WLB",false,"no_fix","","","","","mjch2i/ios",""],["2026-09-05T18:26:08.623Z",46,"already_used","CARVEL-WLB",false,"no_fix","","","","","mjch2i/ios",""],["2026-09-06T17:20:41.210Z",369,"ok","CARVEL-WLB",false,"ok",78,26,40.2948847237355,-74.0288804566462,"segi53/ios",""],["2026-09-06T17:20:44.046Z",386,"ok","CARVEL-WLB",false,"ok",78,26,40.2948847237355,-74.0288804566462,"segi53/ios",""],["2026-09-06T17:20:46.196Z",351,"ok","CARVEL-WLB",false,"ok",78,26,40.2948847237355,-74.0288804566462,"segi53/ios",""],["2026-09-06T17:40:46.771Z",464,"ok","CARVEL-WLB",false,"ok",77,23,40.2948590844471,-74.0288914829582,"segi53/ios",""],["2026-09-06T17:40:53.425Z",467,"ok","CARVEL-WLB",false,"ok",78,36,40.2948926349572,-74.0288697862725,"segi53/ios",""],["2026-09-06T17:40:55.997Z",424,"ok","CARVEL-WLB",false,"ok",78,36,40.2948926349572,-74.0288697862725,"segi53/ios",""],["2026-09-06T17:41:00.496Z",485,"ok","CARVEL-WLB",false,"ok",77,36,40.2948771233547,-74.0288795871956,"segi53/ios",""],["2026-09-06T19:12:56.029Z",135,"ok","CARVEL-WLB",false,"ok",76,22,40.2948644742525,-74.0288762641067,"segi53/ios",""],["2026-09-06T19:13:00.567Z",153,"ok","CARVEL-WLB",false,"ok",79,38,40.2948896587925,-74.0288976885759,"segi53/ios",""],["2026-09-06T19:13:03.911Z",171,"ok","CARVEL-WLB",false,"ok",79,38,40.2948896587925,-74.0288976885759,"segi53/ios",""],["2026-09-06T19:13:08.411Z",138,"ok","CARVEL-WLB",false,"ok",80,25,40.2948883695479,-74.0289102624278,"segi53/ios",""],["2026-09-06T21:24:17.429Z",188,"ok","CARVEL-WLB",false,"ok",66,11,40.2944811487111,-74.0289006766693,"8qtv1a/ios",""],["2026-09-07T22:36:24.892Z",472,"ok","CARVEL-WLB",false,"ok",66,10,40.2944836130802,-74.028900774368,"f4xjkf/ios",""],["2026-09-07T22:36:48.004Z",188,"already_used","CARVEL-WLB",false,"ok",66,18,40.2944813715793,-74.0289006351549,"f4xjkf/ios",""],["2026-09-07T22:37:04.795Z",188,"already_used","CARVEL-WLB",false,"ok",66,12,40.2944813072591,-74.0289006311602,"f4xjkf/ios",""],["2026-09-11T16:12:04.958Z",449,"ok","CARVEL-WLB",false,"ok",66,15,40.2945420687244,-74.0289018263344,"segi53/ios",""],["2026-09-11T16:12:08.146Z",422,"ok","CARVEL-WLB",false,"ok",66,15,40.2945420687244,-74.0289018263344,"segi53/ios",""],["2026-09-11T16:12:14.112Z",416,"ok","CARVEL-WLB",false,"ok",66,13,40.2945420616169,-74.0289018145245,"segi53/ios",""],["2026-09-11T16:12:16.556Z",412,"ok","CARVEL-WLB",false,"ok",66,11,40.2945420586898,-74.028901809661,"segi53/ios",""],["2026-09-11T19:30:22.379Z",216,"ok","CARVEL-WLB",false,"ok",66,15,40.2945378196925,-74.0289067097651,"segi53/ios",""],["2026-09-11T19:30:24.132Z",180,"ok","CARVEL-WLB",false,"ok",66,13,40.2945378122923,-74.0289066976324,"segi53/ios",""],["2026-09-14T20:24:50.392Z",11,"ok","CARVEL-WLB",false,"no_fix","","","","","b44q4y/ios",""],["2026-09-15T22:57:16.020Z",491,"ok","CARVEL-WLB",false,"ok",66,12,40.2945136580097,-74.0289024737047,"781cwf/ios",""],["2026-09-20T16:46:56.128Z",484,"ok","CARVEL-WLB",false,"ok",64,15,40.2945927865673,-74.0288688013796,"segi53/ios",""],["2026-09-20T16:47:01.318Z",452,"ok","CARVEL-WLB",false,"ok",64,14,40.2945927865137,-74.0288688012891,"segi53/ios",""],["2026-09-20T16:47:06.016Z",463,"ok","CARVEL-WLB",false,"ok",64,14,40.2945927865137,-74.0288688012891,"segi53/ios",""],["2026-09-22T19:17:19.211Z",313,"ok","CARVEL-WLB",false,"no_fix","","","","","b44q4y/ios",""],["2026-09-24T19:11:41.885Z",162,"ok","CARVEL-WLB",false,"no_fix","","","","","b44q4y/ios",""],["2026-09-29T22:39:53.081Z",474,"ok","CARVEL-WLB",false,"ok",78,11,40.2948524782048,-74.0289073725416,"pbfei7/ios",""],["2026-09-29T22:39:57.693Z",494,"ok","CARVEL-WLB",false,"ok",78,11,40.2948524782048,-74.0289073725416,"pbfei7/ios",""],["2026-09-29T22:40:04.057Z",494,"already_used","CARVEL-WLB",false,"ok",78,11,40.2948524782048,-74.0289073725416,"pbfei7/ios",""],["2026-10-05T22:01:28.313Z",136,"ok","CARVEL-WLB",false,"no_fix","","","","","b44q4y/ios",""],["2026-10-05T22:01:38.224Z",151,"ok","CARVEL-WLB",false,"no_fix","","","","","b44q4y/ios",""],["2026-10-05T22:01:41.755Z",169,"ok","CARVEL-WLB",false,"no_fix","","","","","b44q4y/ios",""],["2026-10-05T22:01:45.155Z",133,"ok","CARVEL-WLB",false,"no_fix","","","","","b44q4y/ios",""],["2026-10-09T17:58:09.710Z",270,"ok","CARVEL-WLB",false,"ok",85,27,40.2949361794369,-74.0289284002625,"segi53/ios",""],["2026-10-18T20:25:41.149Z",495,"ok","CARVEL-WLB",false,"ok",89,47,40.2949640881498,-74.0289705685298,"segi53/ios",""],["2026-10-18T20:25:43.371Z",454,"ok","CARVEL-WLB",false,"ok",89,47,40.2949640881498,-74.0289705685298,"segi53/ios",""],["2026-10-18T20:25:44.451Z",454,"already_used","CARVEL-WLB",false,"ok",89,47,40.2949640881498,-74.0289705685298,"segi53/ios",""],["2026-10-18T20:25:46.876Z",477,"ok","CARVEL-WLB",false,"ok",93,49,40.2949777383192,-74.0290075130969,"segi53/ios",""],["2026-10-18T20:25:49.010Z",475,"ok","CARVEL-WLB",false,"ok",93,49,40.2949777383192,-74.0290075130969,"segi53/ios",""],["2026-10-18T20:25:50.194Z",493,"ok","CARVEL-WLB",false,"ok",93,49,40.2949777383192,-74.0290075130969,"segi53/ios",""]]};

/**
 * Run ONCE, from the Apps Script editor. Builds every tab and loads the history that
 * came across from Supabase (81 redemptions, 135 log rows).
 * Refuses to run twice: re-running after go-live would wipe real redemptions.
 */
function setup() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var existing = ss.getSheetByName('Coupons');
  if (existing && existing.getLastRow() > 1) {
    throw new Error('Setup has already been run. Not touching the live data.');
  }
  ss.setSpreadsheetTimeZone(TZ);

  function tab(name) {
    var t = ss.getSheetByName(name) || ss.insertSheet(name);
    t.clear();
    return t;
  }
  var sum = tab('Summary');
  var cp = tab('Coupons');
  var lg = tab('Log');
  var ov = tab('Overrides');
  var st = tab('Settings');
  var dflt = ss.getSheetByName('Sheet1');
  if (dflt) ss.deleteSheet(dflt);

  // ---- Coupons: 500 real + 10 demo, with the redemptions carried over.
  var redeemed = {};
  HIST.redeemed.forEach(function (r) {
    redeemed[r[0]] = r;
  });
  var rows = [];
  var serials = [];
  for (var i = 1; i <= 500; i++) serials.push([i, false]);
  for (var j = 900001; j <= 900010; j++) serials.push([j, true]);
  serials.forEach(function (p) {
    var r = redeemed[p[0]];
    rows.push([p[0], p[1], r ? new Date(r[1]) : '', r ? r[2] : '', r ? r[3] : '', '']);
  });
  cp.getRange(1, 1, 1, 6).setValues([['serial', 'test', 'redeemed_at', 'register', 'device', 'note']]);
  cp.getRange(2, 1, rows.length, 6).setValues(rows);
  cp.getRange(2, 3, rows.length, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
  cp.setFrozenRows(1);

  // ---- Log
  lg.getRange(1, 1, 1, 12).setValues([
    ['at', 'serial', 'result', 'register', 'test', 'geo', 'distance_m', 'accuracy_m', 'lat', 'lon', 'device', 'note'],
  ]);
  var logRows = HIST.log.map(function (r) {
    return [new Date(r[0])].concat(r.slice(1));
  });
  if (logRows.length) lg.getRange(2, 1, logRows.length, 12).setValues(logRows);
  lg.getRange(2, 1, Math.max(logRows.length, 1), 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
  lg.setFrozenRows(1);

  // ---- Overrides
  ov.getRange(1, 1, 1, 5).setValues([['at', 'serial', 'reason', 'register', 'device']]);
  ov.setFrozenRows(1);

  // ---- Settings (the register + range live here, edit in place)
  st.getRange(1, 1, 5, 3).setValues([
    ['Setting', 'Value', 'Notes'],
    ['serial_min', 1, 'First live serial'],
    ['serial_max', 500, 'Last live serial'],
    ['enabled', true, 'Untick to refuse EVERY coupon (kill switch)'],
    ['unit_cost', 1, 'What Hatzalah pays Carvel per cup'],
  ]);
  st.getRange(7, 1, 1, 7).setValues([['token', 'name', 'enabled', 'lat', 'lon', 'radius_m', 'enforce']]);
  st.getRange(8, 1, 1, 7).setValues([
    ['CARVEL-WLB', 'Carvel — 175 Monmouth Rd, West Long Branch NJ', true, 40.294485, -74.028126, 400, false],
  ]);
  st.getRange(2, 2, 3, 1).setNumberFormat('General');
  st.getRange(1, 1, 1, 3).setFontWeight('bold');
  st.getRange(7, 1, 1, 7).setFontWeight('bold');
  st.getRange(4, 2).insertCheckboxes();
  st.getRange(8, 3).insertCheckboxes();
  st.getRange(8, 7).insertCheckboxes();
  st.setColumnWidth(2, 320);

  // ---- Summary
  // Labels and formulas go in separately: setFormulas() tries to EVALUATE every string,
  // so a plain label like "Issued" would show #NAME? instead of its text.
  sum.getRange(1, 1, 9, 1).setValues([
    ['Issued'],
    ['Redeemed'],
    ['Remaining'],
    ['Unit cost'],
    ['OWED TO CARVEL'],
    ['Redeemed today'],
    ['Manual overrides (total)'],
    ['Off-site scans (total)'],
    ['Last scan'],
  ]);
  sum.getRange(1, 2, 9, 1).setFormulas([
    ['=COUNTIF(Coupons!B2:B,FALSE)'],
    ['=COUNTIFS(Coupons!B2:B,FALSE,Coupons!C2:C,"<>")'],
    ['=B1-B2'],
    ['=Settings!B5'],
    ['=B2*B4'],
    ['=COUNTIFS(Coupons!B2:B,FALSE,Coupons!C2:C,">="&TODAY(),Coupons!C2:C,"<"&(TODAY()+1))'],
    ['=COUNTA(Overrides!A2:A)'],
    ['=COUNTIFS(Log!F2:F,"far",Log!E2:E,FALSE)'],
    ['=IFERROR(MAX(Log!A2:A),"")'],
  ]);
  sum.getRange(4, 2).setNumberFormat('$0.00');
  sum.getRange(5, 2).setNumberFormat('$0.00');
  sum.getRange(9, 2).setNumberFormat('yyyy-mm-dd hh:mm');
  sum.getRange(1, 1, 9, 1).setFontWeight('bold');
  sum.getRange(5, 1, 1, 2).setFontSize(14).setFontWeight('bold');
  sum.getRange(1, 4, 1, 2).setValues([['Day', 'Redeemed']]).setFontWeight('bold');
  // One row per day that had a redemption, then a count beside each. Plain functions on
  // purpose (no QUERY): the ledger is what matters, this table is only a convenience.
  sum
    .getRange(2, 4)
    .setFormula(
      '=IFERROR(SORT(UNIQUE(ARRAYFORMULA(INT(FILTER(Coupons!C2:C,Coupons!B2:B=FALSE,Coupons!C2:C<>""))))),"")',
    );
  sum
    .getRange(2, 5)
    .setFormula(
      '=ARRAYFORMULA(IF(D2:D200="","",COUNTIFS(Coupons!B2:B,FALSE,Coupons!C2:C,">="&D2:D200,Coupons!C2:C,"<"&(D2:D200+1))))',
    );
  sum.getRange(2, 4, 400, 1).setNumberFormat('ddd mmm d');
  sum.setColumnWidth(1, 220);
  sum.setColumnWidth(2, 120);
  sum.setColumnWidth(4, 120);
  var chart = sum
    .newChart()
    .setChartType(Charts.ChartType.COLUMN)
    .addRange(sum.getRange('D1:E60'))
    .setPosition(11, 1, 0, 0)
    .setOption('title', 'Redemptions per day')
    .setOption('legend', { position: 'none' })
    .setNumHeaders(1)
    .build();
  sum.insertChart(chart);

  ss.setActiveSheet(sum);
  ss.moveActiveSheet(1);
  SpreadsheetApp.flush();
  return 'Setup complete: ' + HIST.redeemed.length + ' redemptions and ' + HIST.log.length + ' log rows loaded.';
}
