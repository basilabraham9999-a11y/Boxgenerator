function PathBuilder() { this.segs = []; }
PathBuilder.prototype.M = function (x, y) { this.segs.push({ t: 'M', x: x, y: y }); return this; };
PathBuilder.prototype.L = function (x, y) { this.segs.push({ t: 'L', x: x, y: y }); return this; };
PathBuilder.prototype.A = function (r, x, y, sweep) { this.segs.push({ t: 'A', r: r, x: x, y: y, sweep: sweep || 0 }); return this; };
PathBuilder.prototype.Z = function () { this.segs.push({ t: 'Z' }); return this; };
PathBuilder.prototype.render = function () {
  return this.segs.map(function (s) {
    if (s.t === 'Z') return 'Z';
    if (s.t === 'A') return 'A ' + s.r.toFixed(2) + ' ' + s.r.toFixed(2) + ' 0 0 ' + s.sweep + ' ' + s.x.toFixed(2) + ' ' + s.y.toFixed(2);
    return s.t + ' ' + s.x.toFixed(2) + ' ' + s.y.toFixed(2);
  }).join(' ');
};
PathBuilder.prototype.getSegments = function () {
  var lines = [], cx = 0, cy = 0, sx = 0, sy = 0;
  this.segs.forEach(function (s) {
    if (s.t === 'M') { cx = s.x; cy = s.y; sx = cx; sy = cy; }
    else if (s.t === 'L') { lines.push({ x1: cx, y1: cy, x2: s.x, y2: s.y }); cx = s.x; cy = s.y; }
    else if (s.t === 'A') {
      var r = Math.abs(s.r), sweep = s.sweep || 0;
      var dx = s.x - cx, dy = s.y - cy;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d > 0) {
        r = Math.max(r, d / 2); // Prevent math domain errors
        var mx = (cx + s.x) / 2, my = (cy + s.y) / 2;
        var h = Math.sqrt(r * r - (d / 2) * (d / 2));
        var C_x = sweep === 1 ? mx + h * (-dy / d) : mx + h * (dy / d);
        var C_y = sweep === 1 ? my + h * (dx / d) : my + h * (-dx / d);
        
        var a1 = Math.atan2(cy - C_y, cx - C_x);
        var a2 = Math.atan2(s.y - C_y, s.x - C_x);
        var diff = a2 - a1;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        
        var steps = Math.max(8, Math.ceil(Math.abs(diff) * r)); // Dynamic High-Res curve density
        for (var i = 1; i <= steps; i++) {
          var angle = a1 + diff * (i / steps);
          var nx = C_x + r * Math.cos(angle), ny = C_y + r * Math.sin(angle);
          lines.push({ x1: cx, y1: cy, x2: nx, y2: ny });
          cx = nx; cy = ny;
        }
      }
      cx = s.x; cy = s.y;
    }
    else if (s.t === 'Z') { lines.push({ x1: cx, y1: cy, x2: sx, y2: sy }); cx = sx; cy = sy; }
  });
  return lines;
};

const MM_PER_IN = 25.4;

// Computes a radius-r fillet at corner (cx,cy) between the segment coming
// from (px,py) and the segment going to (nx,ny).
function filletCorner(px, py, cx, cy, nx, ny, r) {
  var v1x = px - cx, v1y = py - cy;
  var v2x = nx - cx, v2y = ny - cy;
  var len1 = Math.sqrt(v1x * v1x + v1y * v1y);
  var len2 = Math.sqrt(v2x * v2x + v2y * v2y);
  var u1x = v1x / len1, u1y = v1y / len1;
  var u2x = v2x / len2, u2y = v2y / len2;
  var dot = Math.max(-1, Math.min(1, u1x * u2x + u1y * u2y));
  var theta = Math.acos(dot);
  var t = r / Math.tan(theta / 2);
  return {
    t1: { x: cx + u1x * t, y: cy + u1y * t },
    t2: { x: cx + u2x * t, y: cy + u2y * t }
  };
}

export function buildDieline(options) {
  var currentUnit = options.unit;
  var unitMul = (currentUnit === 'in') ? MM_PER_IN : 1;
  // The labeled Length is the horizontal opening; Width is the
  // panel-stacking direction used for the box depth panels.
  var lengthRaw = parseFloat(options.length);
  var W = (isNaN(lengthRaw) ? 180 : lengthRaw * unitMul);
  var T = Math.max(0.1, Math.min(7, parseFloat(options.thickness) || 1.5));

  // Minimum depth scales with caliper: thin single-wall board (E/B/C) keeps the
  // legacy 18mm floor, but heavier double-wall board (BC 7mm) needs more room
  // for the inner walls/ears (dfW, sideInnerW) to stay structurally positive.
  var minD = Math.max(18, T * 4);
  var minDepthInput = (unitMul === 1 ? minD : minD / MM_PER_IN).toFixed(unitMul === 1 ? 1 : 3);
  var dRaw = parseFloat(options.depth);
  var D = Math.max(minD, isNaN(dRaw) ? 50 : dRaw * unitMul);

  // Width cannot be smaller than Height.
  var minWidthInput = (unitMul === 1 ? D : D / MM_PER_IN).toFixed(unitMul === 1 ? 1 : 3);
  var widthRaw = parseFloat(options.width);
  var L = Math.max(D, isNaN(widthRaw) ? 120 : widthRaw * unitMul);

  var cuts = new PathBuilder();
  var folds = new PathBuilder();
  var annotations = "";

  var dfW = D - 2 * T;

  var sideOuterW = D + T;
  var sideTopW = 3 * T;
  var sideInnerW = D - 1.5 * T;

  var frEarW = 0.25 * L + 18;

  var useDualLocks = L > 100;
  var useTripleLocks = L > 350;
  var lockW = 2 * T + 2;
  var lockH = 0.2 * L;

  // Lock-slot entry flare: fixed 3mm was tuned for 1.5mm E-flute. Thicker,
  // stiffer board needs more flare so the tab compresses and seats properly;
  // clamped to a fraction of slot height so it can never invert on short boxes.
  var lockFlare = Math.min(Math.max(3, T + 1.5), lockH * 0.4);

  var getTuckEarWidth = function(d) {
    var mapping = [
      {h: 20, w: 15}, {h: 30, w: 24}, {h: 35, w: 29}, {h: 40, w: 33},
      {h: 45, w: 38}, {h: 50, w: 41}, {h: 55, w: 47}, {h: 60, w: 50},
      {h: 65, w: 56}, {h: 70, w: 60}, {h: 165, w: 96}
    ];
    
    if (d < mapping[0].h) {
      var m0 = mapping[0], m1 = mapping[1];
      var slope = (m1.w - m0.w) / (m1.h - m0.h);
      return m0.w + slope * (d - m0.h);
    }
    for (var i = 0; i < mapping.length - 1; i++) {
      if (d >= mapping[i].h && d <= mapping[i+1].h) {
        var t = (d - mapping[i].h) / (mapping[i+1].h - mapping[i].h);
        return mapping[i].w + t * (mapping[i+1].w - mapping[i].w);
      }
    }
    var last = mapping[mapping.length - 1];
    var prev = mapping[mapping.length - 2];
    var extSlope = (last.w - prev.w) / (last.h - prev.h);
    return last.w + extSlope * (d - last.h);
  };

  // Base curve was profiled at E-flute (1.5mm). Thicker board is stiffer, so the
  // tuck ear needs extra bite/width beyond that baseline to lock in reliably.
  var tuckEarW = getTuckEarWidth(D) + Math.max(0, (T - 1.5) * 2);
  var tuckL = D - T; // matches Pacdora ref: 48.5 for D=50, T=1.5

  // Parametric Tuck Ear Shape Engine
  var tuckScaleY = tuckL / 48.5;
  var tuckScaleX = tuckEarW / 41.0;
  
  // Dynamic Corner Radius
  var maxCornerR = (tuckL - 2) * 0.4;
  var rTuckCorner = Math.min(11 * tuckScaleX, maxCornerR);
  if (rTuckCorner < 1.5) rTuckCorner = 1.5; // practical steel-rule/laser minimum
  
  // Dynamic Sweeping Arc (Maintains the exact proportional shape angle regardless of depth)
  var tDx = tuckEarW;
  var tDy = tuckL - 2 - rTuckCorner;
  var tChord = Math.sqrt(tDx * tDx + tDy * tDy);
  var rTuck = tChord * 0.88; 
  if (rTuck < (tChord / 2)) rTuck = (tChord / 2) + 0.1; // Safety fallback

  var y_tuck_top = -D - L - tuckL;
  var y_lid_top = -D - L;
  var y_rear_top = -D;
  var y_bot_top = 0;
  var y_bot_bot = L;
  var y_front_bot = L + D;

  var x_l = 0;
  var x_r = W;

  var xl_outer = -sideOuterW;
  var xl_spacer = xl_outer - sideTopW;
  var xl_inner = xl_spacer - sideInnerW;

  var xr_outer = W + sideOuterW;
  var xr_spacer = xr_outer + sideTopW;
  var xr_inner = xr_spacer + sideInnerW;

  var rearInset = 2 * T;      // REAR panel is 3mm narrower each side than BOTTOM
  var xr_rear = x_r - rearInset;
  var xl_rear = x_l + rearInset;

  var lidInset = 3 * T;       // LID panel is inset even further: width = W - 6T
  var xr_lid = x_r - lidInset;
  var xl_lid = x_l + lidInset;

  var lockFractions = useTripleLocks ? [0.2, 0.5, 0.8] : (useDualLocks ? [0.3, 0.7] : [0.5]);
  var slotList = lockFractions.map(function (fraction) {
    var centerY = y_bot_top + L * fraction;
    return { y1: centerY - lockH / 2, y2: centerY + lockH / 2 };
  });

  // --- 1. CONTINUOUS PERIMETER CUT ---
  var dynRadius = 1.5;
  if (T <= 1.5) dynRadius = 1.5;
  else if (T <= 3.0) dynRadius = 2.0;
  else dynRadius = 4.0;

  // Notch/step clearance between an ear cut and its neighboring fold line.
  // Must stay >= the corner fillet's own tangent length (~0.7 * dynRadius,
  // from the same ~110deg corner angle used elsewhere), or the fillet arc
  // overshoots past this point and the path has to backtrack to reach it â€”
  // that backtrack is exactly the "not smooth" kink between T=3.1 and 5mm,
  // where dynRadius steps up to 4.0 but the old formula hadn't caught up.
  var earClear = Math.max(2, T * 0.55, dynRadius * 0.7002 + 0.5);

  var rLid = Math.min(12, dfW * 0.25);
  var tan20 = 0.36397, cos20 = 0.93969, sin20 = 0.34202;
  var tDist = rLid * 0.7002, topDx = tDist * cos20, topDy = tDist * sin20;
  var tDistTop = tDist, botDx = topDx, botDy = topDy, tDistBot = tDist;

  var rLidTopY = y_lid_top + (dfW * tan20);
  var rLidBotY = y_rear_top - (dfW * tan20);

  // Calculate Exact Outer Tangent Points
  var rTopOuterArcStart = { x: xr_lid + dfW - topDx, y: rLidTopY - topDy };
  var rBotOuterArcEnd = { x: xr_lid + dfW - botDx, y: rLidBotY + botDy };
  var lBotOuterArcEnd = { x: xl_lid - dfW + botDx, y: rLidBotY + botDy };
  var lTopOuterArcStart = { x: xl_lid - dfW + topDx, y: rLidTopY - topDy };

  // Dynamic Fillet Generation anchored EXACTLY to the Lid Fold intersections (xr_lid & xl_lid)
  var rTopCorner = { x: xr_lid, y: y_lid_top };
  var rTopFillet = filletCorner(xr_lid, y_lid_top - earClear, rTopCorner.x, rTopCorner.y, rTopOuterArcStart.x, rTopOuterArcStart.y, dynRadius);

  var rBotCorner = { x: xr_lid, y: y_rear_top };
  var rBotFillet = filletCorner(rBotOuterArcEnd.x, rBotOuterArcEnd.y, rBotCorner.x, rBotCorner.y, xr_lid, y_rear_top + earClear, dynRadius);

  var lBotCorner = { x: xl_lid, y: y_rear_top };
  var lBotFillet = filletCorner(xl_lid, y_rear_top + earClear, lBotCorner.x, lBotCorner.y, lBotOuterArcEnd.x, lBotOuterArcEnd.y, dynRadius);

  var lTopCorner = { x: xl_lid, y: y_lid_top };
  var lTopFillet = filletCorner(lTopOuterArcStart.x, lTopOuterArcStart.y, lTopCorner.x, lTopCorner.y, xl_lid, y_lid_top - earClear, dynRadius);

  // [START TRACING]
  cuts.M(x_l + T, y_tuck_top);
  cuts.L(x_r - T, y_tuck_top);

  // Right Tuck Ear
  cuts.A(rTuck, x_r - T + tuckEarW, y_lid_top - rTuckCorner - earClear, 1);
  cuts.A(rTuckCorner, x_r - T + (tuckEarW - rTuckCorner), y_lid_top - earClear, 1);
  
  // Right Tuck Ear to Lid Ear transition (Top Clearance)
  cuts.L(x_r - T, y_lid_top - earClear); 
  cuts.L(xr_lid, y_lid_top - earClear); 

  // Right Lid Ear (Starting exactly from the Lid Fold Line)
  cuts.L(rTopFillet.t1.x, rTopFillet.t1.y); 
  cuts.A(dynRadius, rTopFillet.t2.x, rTopFillet.t2.y, 0); 
  cuts.L(rTopOuterArcStart.x, rTopOuterArcStart.y); 
  cuts.A(rLid, xr_lid + dfW, rLidTopY + tDistTop, 1);
  cuts.L(xr_lid + dfW, rLidBotY - tDistBot);
  cuts.A(rLid, rBotOuterArcEnd.x, rBotOuterArcEnd.y, 1);
  
  // Right Lid Ear to Rear Dust Flap transition (Bottom Clearance)
  cuts.L(rBotFillet.t1.x, rBotFillet.t1.y); 
  cuts.A(dynRadius, rBotFillet.t2.x, rBotFillet.t2.y, 0); 
  
  // Gap and Intersection (Right Lid to Rear)
  cuts.L(xr_lid, y_rear_top + earClear); 
  cuts.L(xr_rear, y_rear_top + earClear); 

  // Right Rear Dust Flap
  cuts.L(xr_rear + frEarW, y_rear_top + earClear);
  cuts.L(xr_rear + frEarW, y_bot_top - earClear);
  cuts.L(xr_rear, y_bot_top - earClear);
  
  // Bottom Inner Panel (Right Side)
  cuts.L(xr_rear, y_bot_top);
  cuts.L(x_r, y_bot_top);
  cuts.L(xr_outer, y_bot_top);
  cuts.L(xr_spacer, y_bot_top + T);
  cuts.L(xr_inner, y_bot_top + T);
  
  slotList.forEach(function (slot) {
    cuts.L(xr_inner, slot.y1);
    cuts.L(xr_inner + 2 * T, slot.y1 + lockFlare);
    cuts.L(xr_inner + 2 * T, slot.y2 - lockFlare);
    cuts.L(xr_inner, slot.y2);
  });

  cuts.L(xr_inner, y_bot_bot - T);
  cuts.L(xr_spacer, y_bot_bot - T);
  cuts.L(xr_outer, y_bot_bot);
  cuts.L(x_r, y_bot_bot);

  // Right Front Dust Flap
  cuts.L(xr_rear, y_bot_bot);
  cuts.L(xr_rear, y_bot_bot + earClear); 
  cuts.L(xr_rear + frEarW, y_bot_bot + earClear);
  cuts.L(xr_rear + frEarW, y_front_bot);
  cuts.L(xr_rear, y_front_bot);

  // Front Panel Bottom
  cuts.L(xl_rear, y_front_bot);

  // Left Front Dust Flap
  cuts.L(xl_rear - frEarW, y_front_bot);
  cuts.L(xl_rear - frEarW, y_bot_bot + earClear);
  cuts.L(xl_rear, y_bot_bot + earClear); 
  cuts.L(xl_rear, y_bot_bot);
  
  // Bottom Inner Panel (Left Side)
  cuts.L(x_l, y_bot_bot);
  cuts.L(xl_outer, y_bot_bot);
  cuts.L(xl_spacer, y_bot_bot - T);
  cuts.L(xl_inner, y_bot_bot - T);

  slotList.slice().reverse().forEach(function (slot) {
    cuts.L(xl_inner, slot.y2);
    cuts.L(xl_inner - 2 * T, slot.y2 - lockFlare);
    cuts.L(xl_inner - 2 * T, slot.y1 + lockFlare);
    cuts.L(xl_inner, slot.y1);
  });

  cuts.L(xl_inner, y_bot_top + T);
  cuts.L(xl_spacer, y_bot_top + T);
  cuts.L(xl_outer, y_bot_top);
  cuts.L(x_l, y_bot_top);
  
  // Left Rear Dust Flap
  cuts.L(xl_rear, y_bot_top);
  cuts.L(xl_rear, y_bot_top - earClear);
  cuts.L(xl_rear - frEarW, y_bot_top - earClear);
  cuts.L(xl_rear - frEarW, y_rear_top + earClear);
  cuts.L(xl_rear, y_rear_top + earClear); 
  
  // Left Rear Dust Flap to Lid Ear transition (Bottom Clearance)
  cuts.L(xl_lid, y_rear_top + earClear); 
  
  // Left Lid Ear
  cuts.L(lBotFillet.t1.x, lBotFillet.t1.y); 
  cuts.A(dynRadius, lBotFillet.t2.x, lBotFillet.t2.y, 0); 
  cuts.L(lBotOuterArcEnd.x, lBotOuterArcEnd.y); 
  cuts.A(rLid, xl_lid - dfW, rLidBotY - tDistBot, 1);
  cuts.L(xl_lid - dfW, rLidTopY + tDistTop);
  cuts.A(rLid, lTopOuterArcStart.x, lTopOuterArcStart.y, 1);
  
  // Left Lid Ear to Tuck Ear transition (Top Clearance)
  cuts.L(lTopFillet.t1.x, lTopFillet.t1.y);
  cuts.A(dynRadius, lTopFillet.t2.x, lTopFillet.t2.y, 0); 
  
  // Gap and Intersection (Left Lid to Tuck)
  cuts.L(xl_lid, y_lid_top - earClear); 
  cuts.L(x_l + T, y_lid_top - earClear); 

  // Left Tuck Ear
  cuts.L(x_l + T - (tuckEarW - rTuckCorner), y_lid_top - earClear);
  cuts.A(rTuckCorner, x_l + T - tuckEarW, y_lid_top - rTuckCorner - earClear, 1);
  cuts.A(rTuck, x_l + T, y_tuck_top, 1);

  cuts.Z();

  // --- 2. INTERNAL CUTS (Locking Slots) ---
  slotList.forEach(function (slot) {
    cuts.M(x_l + T, slot.y1).L(x_l + T + lockW, slot.y1).L(x_l + T + lockW, slot.y2).L(x_l + T, slot.y2).Z();
    cuts.M(x_r - T, slot.y1).L(x_r - T - lockW, slot.y1).L(x_r - T - lockW, slot.y2).L(x_r - T, slot.y2).Z();
  });

  // --- 3. DISCRETE FOLDS (Explicitly defined for CAD accuracy) ---
  // Clip every fold segment to the actual cut-path boundary, so no fold
  // line can render outside the cutline at any thickness. Build the main
  // closed cut polygon (tessellated points) once, then trim each fold's
  // horizontal/vertical extent against it via scanline intersection.
  var cutPolyLines = joinSegments(cuts.getSegments());
  var mainCutPoly = cutPolyLines.reduce(function (a, b) { return a.length > b.length ? a : b; }, []);
  var cutPolygon = mainCutPoly.map(function (s) { return { x: s.x1, y: s.y1 }; });

  function clipToPolygon(fixed, isHorizontal, aMin, aMax) {
    var crossings = [];
    var n = cutPolygon.length;
    for (var i = 0; i < n; i++) {
      var p1 = cutPolygon[i], p2 = cutPolygon[(i + 1) % n];
      if (isHorizontal) {
        var y1p = p1.y, y2p = p2.y;
        if ((y1p <= fixed && y2p > fixed) || (y2p <= fixed && y1p > fixed)) {
          crossings.push(p1.x + (fixed - y1p) / (y2p - y1p) * (p2.x - p1.x));
        }
      } else {
        var x1p = p1.x, x2p = p2.x;
        if ((x1p <= fixed && x2p > fixed) || (x2p <= fixed && x1p > fixed)) {
          crossings.push(p1.y + (fixed - x1p) / (x2p - x1p) * (p2.y - p1.y));
        }
      }
    }
    crossings.sort(function (a, b) { return a - b; });
    var out = [];
    for (var j = 0; j < crossings.length - 1; j += 2) {
      var lo = Math.max(aMin, crossings[j]), hi = Math.min(aMax, crossings[j + 1]);
      if (hi - lo > 0.01) out.push([lo, hi]);
    }
    return out;
  }

  // Perforated fold lines: a stroke-dasharray is a paint style only â€” the
  // underlying path is still one continuous line, so laser software (which
  // reads path geometry, not CSS) cuts/engraves it solid. For a real
  // perforated fold, the gaps must be actual breaks in the vector path.
  var perfEnabled = options.perfFold;
  var perfCut = 4, perfGap = 1.5; // mm â€” cut/tie lengths for a laser perf-fold

  function addPerfSegment(x1, y1, x2, y2) {
    if (!perfEnabled) { folds.M(x1, y1).L(x2, y2); return; }
    var dx = x2 - x1, dy = y2 - y1;
    var len = Math.hypot(dx, dy);
    if (len < 0.01) return;
    var ux = dx / len, uy = dy / len;
    var pos = 0, cutting = true;
    while (pos < len) {
      var segLen = Math.min(cutting ? perfCut : perfGap, len - pos);
      if (cutting) {
        folds.M(x1 + ux * pos, y1 + uy * pos).L(x1 + ux * (pos + segLen), y1 + uy * (pos + segLen));
      }
      pos += segLen;
      cutting = !cutting;
    }
  }

  function addFoldH(y, x1, x2) {
    clipToPolygon(y, true, Math.min(x1, x2), Math.max(x1, x2)).forEach(function (iv) {
      addPerfSegment(iv[0], y, iv[1], y);
    });
  }
  function addFoldV(x, y1, y2) {
    clipToPolygon(x, false, Math.min(y1, y2), Math.max(y1, y2)).forEach(function (iv) {
      addPerfSegment(x, iv[0], x, iv[1]);
    });
  }

  // Horizontal main folds
  addFoldH(y_lid_top, xl_lid, xr_lid); // Lid to Tuck Flap
  addFoldH(y_rear_top, xl_rear, xr_rear); // Lid to Rear
  addFoldH(y_bot_top, x_l, x_r); // Rear to Bottom
  addFoldH(y_bot_bot, x_l, x_r); // Bottom to Front

  // Vertical dust flap folds
  addFoldV(xl_rear, y_rear_top, y_bot_top);
  addFoldV(xr_rear, y_rear_top, y_bot_top);
  addFoldV(xl_rear, y_bot_bot, y_front_bot);
  addFoldV(xr_rear, y_bot_bot, y_front_bot);

  // Vertical Lid Ears and Bottom panel side folds
  addFoldV(xl_lid, y_lid_top, y_rear_top);
  addFoldV(xr_lid, y_lid_top, y_rear_top);
  addFoldV(x_l, y_bot_top, y_bot_bot);
  addFoldV(x_r, y_bot_top, y_bot_bot);

  // Vertical Tuck Ear Folds
  addFoldV(x_l + T, y_lid_top, y_tuck_top);
  addFoldV(x_r - T, y_lid_top, y_tuck_top);

  // Outer & Spacer folds
  addFoldV(xl_outer, y_bot_top, y_bot_bot);
  addFoldV(xl_spacer, y_bot_top + T, y_bot_bot - T);
  addFoldV(xr_outer, y_bot_top, y_bot_bot);
  addFoldV(xr_spacer, y_bot_top + T, y_bot_bot - T);

  // --- 4. ANNOTATIONS ---
  if (options.showNames) {
    var mkTxt = function (t, x, y) { return '<text x="' + x + '" y="' + y + '" class="panel-label" fill="#94a3b8" stroke="none" font-family="sans-serif" font-size="8px" font-weight="800" text-anchor="middle" opacity="0.6">' + t + '</text>'; };
    annotations += mkTxt("BOTTOM", W / 2, y_bot_top + L / 2);
    annotations += mkTxt("REAR", W / 2, y_rear_top + D / 2);
    annotations += mkTxt("LID", W / 2, y_lid_top + L / 2);
    annotations += mkTxt("FRONT", W / 2, y_bot_bot + D / 2);
    annotations += mkTxt("TUCK", W / 2, y_tuck_top + tuckL / 2);
    annotations += mkTxt("OUTER", xl_outer + D / 2, y_bot_top + L / 2);
    annotations += mkTxt("INNER", xl_inner + D / 2, y_bot_top + L / 2);
    annotations += mkTxt("OUTER", xr_outer - D / 2, y_bot_top + L / 2);
    annotations += mkTxt("INNER", xr_inner - D / 2, y_bot_top + L / 2);
    annotations += mkTxt("LID EAR", xr_lid + dfW / 2, y_lid_top + L / 2);
    annotations += mkTxt("LID EAR", xl_lid - dfW / 2, y_lid_top + L / 2);
  }

  if (options.showFormulas) {
    var drawDimH = function (val, x1, x2, y) {
      return '<path d="M ' + x1 + ' ' + y + ' L ' + x2 + ' ' + y + '" stroke="#3b82f6" stroke-width="0.75" fill="none" />' +
        '<path d="M ' + (x1 - 2) + ' ' + (y + 2) + ' L ' + (x1 + 2) + ' ' + (y - 2) + ' M ' + (x2 - 2) + ' ' + (y + 2) + ' L ' + (x2 + 2) + ' ' + (y - 2) + '" stroke="#3b82f6" stroke-width="1.2" fill="none" stroke-linecap="round" />' +
        '<text x="' + ((x1 + x2) / 2) + '" y="' + (y - 3) + '" class="dim-marker" fill="#3b82f6" stroke="none" font-family="monospace" font-size="9px" font-weight="700" text-anchor="middle">' + val + '</text>';
    };
    var drawDimV = function (val, x, y1, y2) {
      return '<path d="M ' + x + ' ' + y1 + ' L ' + x + ' ' + y2 + '" stroke="#3b82f6" stroke-width="0.75" fill="none" />' +
        '<path d="M ' + (x - 2) + ' ' + (y1 + 2) + ' L ' + (x + 2) + ' ' + (y1 - 2) + ' M ' + (x - 2) + ' ' + (y2 + 2) + ' L ' + (x + 2) + ' ' + (y2 - 2) + '" stroke="#3b82f6" stroke-width="1.2" fill="none" stroke-linecap="round" />' +
        '<text x="' + (x - 3) + '" y="' + ((y1 + y2) / 2) + '" class="dim-marker" fill="#3b82f6" stroke="none" font-family="monospace" font-size="9px" font-weight="700" text-anchor="middle" transform="rotate(-90, ' + (x - 3) + ', ' + ((y1 + y2) / 2) + ')" dominant-baseline="central">' + val + '</text>';
    };
    var extLineV = function (x, y1, y2) { return '<path d="M ' + x + ' ' + y1 + ' L ' + x + ' ' + y2 + '" stroke="#94a3b8" stroke-width="0.5" stroke-dasharray="2,2" fill="none" />'; };
    var extLineH = function (y, x1, x2) { return '<path d="M ' + x1 + ' ' + y + ' L ' + x2 + ' ' + y + '" stroke="#94a3b8" stroke-width="0.5" stroke-dasharray="2,2" fill="none" />'; };

    var dimY_chain = y_front_bot + 15;
    annotations += extLineV(x_l - frEarW, y_front_bot, dimY_chain + 10);
    annotations += extLineV(x_l, y_front_bot, dimY_chain + 10);
    annotations += extLineV(x_r, y_front_bot, dimY_chain + 10);
    annotations += extLineV(x_r + frEarW, y_front_bot, dimY_chain + 10);

    annotations += drawDimH(frEarW.toFixed(1), x_l - frEarW, x_l, dimY_chain);
    annotations += drawDimH(W.toFixed(1), x_l, x_r, dimY_chain);
    annotations += drawDimH(frEarW.toFixed(1), x_r, x_r + frEarW, dimY_chain);

    var dimY_parallel = dimY_chain + 12;
    var totalW = (frEarW + W + frEarW).toFixed(1);
    annotations += drawDimH(totalW, x_l - frEarW, x_r + frEarW, dimY_parallel);

    var rearEarY = y_rear_top + D / 2;
    annotations += extLineV(xr_rear, y_rear_top, rearEarY + 5);
    annotations += extLineV(xr_rear + frEarW, y_rear_top, rearEarY + 5);
    annotations += drawDimH(frEarW.toFixed(1), xr_rear, xr_rear + frEarW, rearEarY);

    var lidEarY = y_lid_top + L / 2;
    annotations += extLineV(xr_lid, y_lid_top, lidEarY + 5);
    annotations += extLineV(xr_lid + dfW, y_lid_top, lidEarY + 5);
    annotations += drawDimH(dfW.toFixed(1), xr_lid, xr_lid + dfW, lidEarY);

    var tuckEarY = y_lid_top - 15;
    annotations += extLineV(xr_lid, y_lid_top - 5, tuckEarY + 5);
    annotations += extLineV(xr_lid + tuckEarW, y_lid_top - 5, tuckEarY + 5);
    annotations += drawDimH(tuckEarW.toFixed(1), xr_lid, xr_lid + tuckEarW, tuckEarY);

    var dimX_chainV = xl_inner - 2 * T - 15;
    annotations += extLineH(y_tuck_top, xl_inner, dimX_chainV - 10);
    annotations += extLineH(y_lid_top, x_l, dimX_chainV - 10);
    annotations += extLineH(y_rear_top, x_l, dimX_chainV - 10);
    annotations += extLineH(y_bot_top, x_l, dimX_chainV - 10);
    annotations += extLineH(y_bot_bot, x_l, dimX_chainV - 10);
    annotations += extLineH(y_front_bot, x_l, dimX_chainV - 10);

    annotations += drawDimV(tuckL.toFixed(1), dimX_chainV, y_tuck_top, y_lid_top);
    annotations += drawDimV(L.toFixed(1), dimX_chainV, y_lid_top, y_rear_top);
    annotations += drawDimV(D.toFixed(1), dimX_chainV, y_rear_top, y_bot_top);
    annotations += drawDimV(L.toFixed(1), dimX_chainV, y_bot_top, y_bot_bot);
    annotations += drawDimV(D.toFixed(1), dimX_chainV, y_bot_bot, y_front_bot);

    var dimX_parallelV = dimX_chainV - 12;
    var totalL = (tuckL + L + D + L + D).toFixed(1);
    annotations += drawDimV(totalL, dimX_parallelV, y_tuck_top, y_front_bot);

    var innerDimY = y_bot_top - 20;
    annotations += extLineV(xr_spacer, y_bot_top + T, innerDimY - 5);
    annotations += extLineV(xr_inner, y_bot_top + T, innerDimY - 5);
    annotations += drawDimH(sideInnerW.toFixed(1), xr_spacer, xr_inner, innerDimY);
  }

  // --- RENDER ---
  var pad = 60;
  var maxRight = Math.max(xr_inner + 2 * T, x_r + frEarW);
  var maxLeft = Math.min(xl_inner - 2 * T, x_l - frEarW);

  var canvasW = maxRight - maxLeft + (pad * 2);
  var canvasH = y_front_bot - y_tuck_top + (pad * 2);

  var boundingBox = { w: canvasW, h: canvasH, x: maxLeft - pad, y: y_tuck_top - pad };

  // True extent of the cut line itself (max horizontal/vertical distance
  // across its actual geometry), independent of the padded export canvas.
  var cutBBoxSegs = cuts.getSegments();
  var cutMinX = Infinity, cutMaxX = -Infinity, cutMinY = Infinity, cutMaxY = -Infinity;
  cutBBoxSegs.forEach(function (s) {
    cutMinX = Math.min(cutMinX, s.x1, s.x2);
    cutMaxX = Math.max(cutMaxX, s.x1, s.x2);
    cutMinY = Math.min(cutMinY, s.y1, s.y2);
    cutMaxY = Math.max(cutMaxY, s.y1, s.y2);
  });
  var cutLineWidth = cutMaxX - cutMinX;
  var cutLineHeight = cutMaxY - cutMinY;

  var dispMul = (currentUnit === 'in') ? MM_PER_IN : 1;
  var stats = {
    width: (cutLineWidth / dispMul).toFixed(dispMul === 1 ? 0 : 2) + ' ' + currentUnit,
    height: (cutLineHeight / dispMul).toFixed(dispMul === 1 ? 0 : 2) + ' ' + currentUnit,
    minDepth: (minD / dispMul).toFixed(dispMul === 1 ? 1 : 3) + ' ' + currentUnit,
    flare: lockFlare.toFixed(1) + ' mm',
    minDepthInput: minDepthInput,
    minWidthInput: minWidthInput
  };
  /* Legacy DOM statistic assignment removed.
  document.getElementById('stat-flare').innerText = lockFlare.toFixed(1) + ' mm'; // fine manufacturing dimension â€” always mm

  */
  var svgHTML =
    '<svg width="' + canvasW + 'mm" height="' + canvasH + 'mm" viewBox="' + boundingBox.x + ' ' + boundingBox.y + ' ' + canvasW + ' ' + canvasH + '" xmlns="http://www.w3.org/2000/svg">\n' +
    '  <g id="Cutting">\n' +
    '    <path class="cut-line" fill="none" stroke="#000000" stroke-width="1.5" d="' + cuts.render() + '" />\n' +
    '  </g>\n' +
    '  <g id="Folding">\n' +
    '    <path class="fold-line" fill="none" stroke="#ff0000" stroke-width="1.5" stroke-dasharray="6,4" d="' + folds.render() + '" />\n' +
    '  </g>\n' +
    '  <g id="Annotations">\n' + annotations + '  </g>\n' +
    '</svg>';
  return { svgHTML: svgHTML, cuts: cuts, folds: folds, perfEnabled: perfEnabled, boundingBox: boundingBox, stats: stats };
}

export function joinSegments(segments) {
  if (segments.length === 0) return [];
  var unjoined = segments.slice();
  var polylines = [];

  while (unjoined.length > 0) {
    var currentPoly = [unjoined.shift()];
    var changed = true;

    while (changed) {
      changed = false;
      var head = currentPoly[0];
      var tail = currentPoly[currentPoly.length - 1];

      for (var i = 0; i < unjoined.length; i++) {
        var seg = unjoined[i];
        if (Math.abs(tail.x2 - seg.x1) < 0.001 && Math.abs(tail.y2 - seg.y1) < 0.001) {
          currentPoly.push(seg); unjoined.splice(i, 1); changed = true; break;
        } else if (Math.abs(head.x1 - seg.x2) < 0.001 && Math.abs(head.y1 - seg.y2) < 0.001) {
          currentPoly.unshift(seg); unjoined.splice(i, 1); changed = true; break;
        } else if (Math.abs(tail.x2 - seg.x2) < 0.001 && Math.abs(tail.y2 - seg.y2) < 0.001) {
          currentPoly.push({x1: seg.x2, y1: seg.y2, x2: seg.x1, y2: seg.y1}); unjoined.splice(i, 1); changed = true; break;
        } else if (Math.abs(head.x1 - seg.x1) < 0.001 && Math.abs(head.y1 - seg.y1) < 0.001) {
          currentPoly.unshift({x1: seg.x2, y1: seg.y2, x2: seg.x1, y2: seg.y1}); unjoined.splice(i, 1); changed = true; break;
        }
      }
    }
    polylines.push(currentPoly);
  }
  return polylines;
}
