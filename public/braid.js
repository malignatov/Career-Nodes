/**
 * The braid — desktop client-mode redesign (Stacked Journey handoff).
 * Journey home: fifteen threads weaving into a central braid; material states
 * instead of chips. Session: the step's thread runs through the transcript.
 *
 * Loaded as a classic script before app.js; everything it needs arrives via
 * the ctx object at call time. `localStorage.braid = "0"` is the escape hatch
 * back to the card journey.
 *
 * All geometry constants are verbatim from the design reference
 * (design_handoff_braid_journey/Stacked Journey.dc.html, turns 4 & 5).
 */
(() => {
  "use strict";

  /* ══ shared math ══════════════════════════════════════════ */

  const rnd = (n) => { const v = Math.sin(n * 127.1) * 43758.5453; return v - Math.floor(v); };
  const smoothstep = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

  /* Icosahedron subdivision, cached per level: 1 → 42 verts, 2 → 162. */
  const geoCache = {};
  function geoSphere(level) {
    if (geoCache[level]) return geoCache[level];
    const nrm = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
    const t = (1 + Math.sqrt(5)) / 2;
    const verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(nrm);
    let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    for (let s = 0; s < level; s++) {
      const cache = {}, nf = [];
      const mid = (a, b) => {
        const k = a < b ? a + "_" + b : b + "_" + a;
        if (cache[k] === undefined) {
          verts.push(nrm([(verts[a][0] + verts[b][0]) / 2, (verts[a][1] + verts[b][1]) / 2, (verts[a][2] + verts[b][2]) / 2]));
          cache[k] = verts.length - 1;
        }
        return cache[k];
      };
      faces.forEach(([a, b, c]) => {
        const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
        nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
      });
      faces = nf;
    }
    const es = new Set();
    faces.forEach((f) => { for (let i = 0; i < 3; i++) { const a = f[i], b = f[(i + 1) % 3]; es.add(a < b ? a + "_" + b : b + "_" + a); } });
    return (geoCache[level] = { verts, edges: [...es].map((s) => s.split("_").map(Number)) });
  }

  /* Wireframe sphere as SVG inner markup. rotY(ry) then rotX(rx); mild
   * perspective s = R / (1 − z·0.16); edges split front/back by mean z;
   * vertex dots are zero-length round-cap segments on the front hemisphere. */
  const DPR = Math.min(2, window.devicePixelRatio || 1);
  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* Canvas twin of sphereSVG — the idle spin must not touch the DOM (per-frame
   * innerHTML/style writes feed the macOS cursor race; see .br-live in css). */
  function sphereDraw(g, R, ry, rx, colors, unit) {
    const { verts, edges } = geoSphere(2);
    const cy = Math.cos(ry), sy = Math.sin(ry), cx = Math.cos(rx), sx = Math.sin(rx);
    const P = verts.map(([x, y, z]) => {
      const X = x * cy + z * sy, Z0 = z * cy - x * sy;
      const Y = y * cx - Z0 * sx, Z = y * sx + Z0 * cx;
      const s = R / (1 - Z * 0.16);
      return [X * s, Y * s, Z];
    });
    const seg = (pass) => {
      g.beginPath();
      edges.forEach(([a, b]) => {
        if ((P[a][2] + P[b][2] > 0) === pass) { g.moveTo(P[a][0], P[a][1]); g.lineTo(P[b][0], P[b][1]); }
      });
      g.stroke();
    };
    g.lineCap = "round";
    g.lineWidth = 0.4 / unit; g.strokeStyle = pcss(colors.back); seg(false);
    g.lineWidth = 0.6 / unit; g.strokeStyle = pcss(colors.front); seg(true);
    g.lineWidth = 1.6 / unit; g.strokeStyle = pcss(colors.dot);
    g.beginPath();
    P.forEach((q) => { if (q[2] > 0.22) { g.moveTo(q[0], q[1]); g.lineTo(q[0] + 0.01, q[1]); } });
    g.stroke();
  }

  /* Paint token {r,g,b,a} → css string, alpha scaled by mul. */
  const pcss = (p, mul = 1) => p
    ? `rgba(${p.r},${p.g},${p.b},${Math.max(0, Math.min(1, p.a * mul)).toFixed(3)})`
    : `rgba(153,153,153,${mul})`;

  /* Resolve any CSS color (vars, color-mix, color(srgb …)) to {r,g,b,a} via
   * a 1×1 canvas — computed styles return syntaxes no regex should parse. */
  function livePaintColor(expr) {
    let cv = J.__pcv;
    if (!cv) {
      cv = J.__pcv = document.createElement("canvas");
      cv.width = cv.height = 1;
      cv.__g = cv.getContext("2d", { willReadFrequently: true });
    }
    const g = cv.__g;
    g.clearRect(0, 0, 1, 1);
    g.fillStyle = liveColor(expr);
    g.fillRect(0, 0, 1, 1);
    const d = g.getImageData(0, 0, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
  }

  /* Blend two paint tokens — the name's colour travels with its motion. */
  const plerp = (A, B, t) => (!A || !B ? (A || B) : {
    r: A.r + (B.r - A.r) * t, g: A.g + (B.g - A.g) * t,
    b: A.b + (B.b - A.b) * t, a: A.a + (B.a - A.a) * t,
  });

  /* Resolve a CSS color expression (vars, color-mix) against the live strip. */
  function liveColor(expr) {
    let s = J.__cspan;
    if (!s || !s.isConnected) {
      s = J.__cspan = document.createElement("span");
      s.style.display = "none";
      (J.strip || document.body).appendChild(s);
    }
    s.style.color = expr;
    return getComputedStyle(s).color;
  }

  function sphereSVG(R, ry, rx, mode) {
    const { verts, edges } = geoSphere(mode === "wireLo" ? 1 : 2);
    const cy = Math.cos(ry), sy = Math.sin(ry), cx = Math.cos(rx), sx = Math.sin(rx);
    const P = verts.map(([x, y, z]) => {
      const X = x * cy + z * sy, Z0 = z * cy - x * sy;
      const Y = y * cx - Z0 * sx, Z = y * sx + Z0 * cx;
      const s = R / (1 - Z * 0.16);
      return [X * s, Y * s, Z];
    });
    const swB = mode === "wire" ? ".4" : ".28", swF = mode === "wire" ? ".6" : ".45";
    let back = "", front = "", dots = "";
    edges.forEach(([a, b]) => {
      const seg = "M" + P[a][0].toFixed(1) + " " + P[a][1].toFixed(1) + "L" + P[b][0].toFixed(1) + " " + P[b][1].toFixed(1);
      if (P[a][2] + P[b][2] > 0) front += seg; else back += seg;
    });
    P.forEach((q) => { if (q[2] > 0.22) dots += "M" + q[0].toFixed(1) + " " + q[1].toFixed(1) + "l.01 0"; });
    return '<path d="' + back + '" style="fill:none;stroke:var(--t4wireB);stroke-width:' + swB + ';vector-effect:non-scaling-stroke"></path>'
      + '<path d="' + front + '" style="fill:none;stroke:color-mix(in srgb, var(--vacc, var(--acc)) 80%, var(--t4wireF));stroke-width:' + swF + ';stroke-linecap:round;vector-effect:non-scaling-stroke"></path>'
      + '<path d="' + dots + '" style="fill:none;stroke:var(--vacc, var(--acc));stroke-width:' + (mode === "wire" ? 1.6 : 1.1) + ';stroke-linecap:round;vector-effect:non-scaling-stroke"></path>';
  }

  /* Solve the rendered midpoint-smoothed path for x at a given y — knots
   * must sit exactly on the string, not on the pre-smoothing curve. */
  function qxAt(pts, ky) {
    let sx = pts[0][0], sy = pts[0][1];
    for (let i = 1; i < pts.length - 1; i++) {
      const cx = pts[i][0], cy = pts[i][1];
      const ex = (pts[i][0] + pts[i + 1][0]) / 2, ey = (pts[i][1] + pts[i + 1][1]) / 2;
      if (ky >= sy && ky <= ey) {
        const a = sy - 2 * cy + ey, b = 2 * (cy - sy), c = sy - ky;
        let t;
        if (Math.abs(a) < 1e-6) t = b !== 0 ? -c / b : 0;
        else {
          const disc = Math.max(0, b * b - 4 * a * c);
          t = (-b + Math.sqrt(disc)) / (2 * a);
          if (t < 0 || t > 1) t = (-b - Math.sqrt(disc)) / (2 * a);
        }
        t = Math.max(0, Math.min(1, t));
        return (1 - t) * (1 - t) * sx + 2 * t * (1 - t) * cx + t * t * ex;
      }
      sx = ex; sy = ey;
    }
    return null;
  }

  /* Quadratic midpoint smoothing. */
  function quadPath(pts) {
    let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1]}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = ((pts[i][0] + pts[i + 1][0]) / 2).toFixed(1);
      const my = ((pts[i][1] + pts[i + 1][1]) / 2).toFixed(1);
      d += ` Q ${pts[i][0].toFixed(1)} ${pts[i][1]} ${mx} ${my}`;
    }
    return d;
  }

  /* ══ journey field geometry ═══════════════════════════════ */

  const NY = (j) => 140 + j * 88;

  const J = {
    ctx: null, frame: null, stage: null, strip: null,
    nodes: [], status: [], focus: 0, vp: 0,
    merge: null, pendingNext: null, slowUntil: 0,
    timers: { phase: 0, advance: 0, flash: 0, reload: 0 },
    raf: 0, lastTs: undefined, mx: undefined, my: undefined,
    spin: 0.6, hovOn: false, hovK: 1, nameP: 0, prevNext: null, wakeT: 0, pulseT: 0, glowT: 0,
    flashOn: false, resetTimer: 0,
    sess: false, sx: 0, // inline session: camera X shift while the field recedes
  };

  const nodeYf = (j) => {
    const d = j - J.focus;
    return NY(j) + (Math.abs(d) === 1 ? 44 * Math.sign(d) : 0);
  };

  const spineX = (y) => 430 + 55 * Math.sin(y * 0.0026 + 0.8) + 25 * Math.sin(y * 0.0011);

  function strayX(j, y) {
    const cx = 110 + rnd(j * 3 + 1) * 680;
    const amp = 60 + rnd(j * 3 + 2) * 170;
    const freq = 0.0026 + rnd(j * 3 + 3) * 0.004;
    const ph = rnd(j * 3 + 4) * 6.283;
    const lean = (rnd(j * 3 + 5) - 0.5) * 0.18;
    return cx + amp * Math.sin(y * freq + ph) + lean * (y - NY(j));
  }

  const braidX = (j, y) =>
    spineX(y) + (6 + rnd(j * 7 + 6) * 10) * Math.sin(y * 0.012 + rnd(j * 7 + 7) * 6.283);

  function baseX(j, y) {
    const st = J.status[j], ny = NY(j);
    const a = st === "done"
      ? (y >= ny ? 1 : smoothstep((y - (ny - 240)) / 240))
      : st === "next"
        ? 0.62 * Math.exp(-Math.pow((y - ny) / 240, 2))
        : 0;
    const sx = strayX(j, y);
    const x = sx + (braidX(j, y) - sx) * a;
    // Gather into the Ω… then release: past its center the strings return to
    // their own wander — loose thread ends after the knot, not a straight tail.
    const c = smoothstep((y - 1430) / 260);
    const r = smoothstep((y - 1790) / 300);
    return x + (450 - x) * c * (1 - r);
  }

  /* Caption anchor: 176px to the caption side of the focused node. */
  function anchorFor(focus) {
    const nx = baseX(focus, NY(focus));
    const right = nx < 450;
    return { nx, right, px: right ? nx + 176 : nx - 176, py: NY(focus) };
  }

  function withGrav(x, y, anchor) {
    const dx = x - anchor.px, dy = (y - anchor.py) * 0.85;
    const d2 = dx * dx + dy * dy, dist = Math.sqrt(d2) || 1;
    return x + (dx / dist) * 100 * Math.exp(-d2 / (190 * 190));
  }

  /* Sample ys every 120px over -320..2860; the pin pair ny∓16 makes the
   * curve pass exactly through the node. */
  function sampleYs(ny) {
    const ys = [];
    for (let y = -320; y <= 2860; y += 120) { if (Math.abs(y - ny) >= 70) ys.push(y); }
    ys.push(ny - 16, ny + 16);
    ys.sort((a, b) => a - b);
    return ys;
  }

  function threadD(j, anchor) {
    const pts = sampleYs(nodeYf(j)).map((y) => [withGrav(baseX(j, y), y, anchor), y]);
    return quadPath(pts);
  }

  // Top clamp 90 (was 180): only the first node ever hits it, and 180 left a
  // dead band between the header and the goal sphere.
  const stripY = () => Math.max(-900, Math.min(90, 320 - NY(J.focus)));

  function threadStyle(status, focused) {
    if (status === "done") return { stroke: "var(--acc)", width: "1.4", opacity: (0.2 + 0.24 * J.vp).toFixed(2) };
    if (status === "next") return { stroke: "var(--vacc, var(--acc))", width: "1.8", opacity: ".42" };
    // A focused-but-dormant (locked) thread lights up — highlighted yet inactive.
    if (focused) return { stroke: "var(--t4bone)", width: "1.3", opacity: ".4" };
    return { stroke: "var(--t4bone)", width: "0.9", opacity: ".1" };
  }

  function setD(p, d) {
    if ("d" in p.style) p.style.d = `path("${d}")`;
    else p.setAttribute("d", d);
  }

  /* ══ node cores (material states) ═════════════════════════ */

  function renderCore(el, st, j) {
    if (st === "next") { renderLiveCore(el); return; }
    if (st === "done") {
      const m = J.merge;
      if (m && m.j === j && m.phase === "travel") renderTravelCore(el);
      else renderDoneCore(el, j, !!(m && m.j === j));
    } else renderPlanCore(el, j);
  }

  function renderPlanCore(el, j) {
    el.style.cssText = "position:absolute;left:-9px;top:-9px;width:18px;height:18px";
    if (el.__c !== "wlo") {
      el.__c = "wlo";
      el.innerHTML = '<svg width="100%" height="100%" viewBox="-9.5 -9.5 19 19" style="position:absolute;inset:0;overflow:visible">' + sphereSVG(8, 0.4 + j * 1.1, 0.3, "wireLo") + "</svg>";
    }
  }

  /* The idle waking sphere has NO DOM material: sway, spin, glow, ping and
   * the wake growth are all painted on the strip canvas by the tick. The DOM
   * keeps only the static [data-pad] hit surface (cursor-war rule). */
  function renderLiveCore(el) {
    el.style.cssText = "position:absolute;left:-25px;top:-25px;width:50px;height:50px";
    if (el.__c !== "live") {
      el.__c = "live";
      el.innerHTML = "";
    }
  }

  /* Ceremony-only DOM twin of the waking sphere: the travel leg rides nd's
   * transform transition, which canvas cannot follow. Transient by nature. */
  function renderTravelCore(el) {
    el.style.cssText = "position:absolute;left:-25px;top:-25px;width:50px;height:50px;"
      + "transition:left .8s cubic-bezier(.3,.7,.2,1), top .8s cubic-bezier(.3,.7,.2,1), width .8s cubic-bezier(.3,.7,.2,1), height .8s cubic-bezier(.3,.7,.2,1)";
    if (el.__c !== "wire2") {
      el.__c = "wire2";
      el.innerHTML =
        '<div style="position:absolute;inset:11%;border-radius:99px;pointer-events:none;background:radial-gradient(circle, color-mix(in srgb, var(--acc) 60%, transparent) 0%, color-mix(in srgb, var(--acc) 24%, transparent) 44%, transparent 70%)"></div>' +
        '<svg width="100%" height="100%" viewBox="-25 -25 50 50" style="position:absolute;inset:0;overflow:visible;pointer-events:none">' + sphereSVG(22, J.spin, 0.35, "wire") + "</svg>";
    }
  }

  function renderDoneCore(el, j, big) {
    const D = big ? 25 : 13, sz = big ? 50 : 26;
    el.style.cssText = "position:absolute;left:-" + D + "px;top:-" + D + "px;width:" + sz + "px;height:" + sz + "px;"
      + "filter:drop-shadow(0 " + (big ? "9px 14px" : "7px 9px") + " var(--t4ds)) drop-shadow(0 0 " + (big ? 18 : 12) + "px color-mix(in srgb, var(--pig, var(--acc)) 30%, transparent));"
      + "transition:left .8s cubic-bezier(.3,.7,.2,1), top .8s cubic-bezier(.3,.7,.2,1), width .8s cubic-bezier(.3,.7,.2,1), height .8s cubic-bezier(.3,.7,.2,1)";
    if (el.__c !== "solid3") {
      const pop = el.__c === "wire2";
      el.__c = "solid3";
      el.innerHTML =
        '<div style="position:absolute;inset:8%;border-radius:99px;opacity:var(--t4fop,.62);background:radial-gradient(circle, var(--pig, var(--acc)) 0%, color-mix(in srgb, var(--pig, var(--acc)) 76%, #14120c) 58%, color-mix(in srgb, var(--pig, var(--acc)) 30%, transparent) 86%, transparent 100%);' + (pop ? "animation:t4fill 1.4s cubic-bezier(.3,.7,.2,1) both;" : "") + '"></div>' +
        '<svg width="100%" height="100%" viewBox="-13 -13 26 26" style="position:absolute;inset:0;overflow:visible">' + sphereSVG(11, 0.9 + j * 1.7, 0.42, "wire") + "</svg>" +
        '<div style="position:absolute;inset:7%;border-radius:99px;background:radial-gradient(circle at 32% 24%, rgba(255,255,255,.42), rgba(255,255,255,0) 38%), radial-gradient(circle at 70% 84%, rgba(0,0,0,.32), transparent 46%)"></div>';
      if (pop) el.style.animation = "t4solidify 1.5s cubic-bezier(.25,.75,.2,1)";
    }
  }

  /* ══ journey view ═════════════════════════════════════════ */

  /* Demo statuses done/next/plan mapped from the app model: authorized|stale
   * are woven; the single current actionable step is the waking sphere. */
  function mapStatuses() {
    const cur = J.ctx.currentNodeId();
    return J.nodes.map((n) =>
      J.ctx.isSettled(n.status) ? "done"
        : n.id === cur && (n.status === "available" || n.status === "in_progress") ? "next"
          : "plan");
  }

  const openable = (j) => J.nodes[j] && J.nodes[j].status !== "planned";

  function defaultFocus() {
    const next = J.status.indexOf("next");
    if (next >= 0) return next;
    const lastDone = J.status.lastIndexOf("done");
    return lastDone >= 0 ? lastDone : 0;
  }

  function build(root) {
    const n = J.nodes.length;
    stopTick();
    if (L.open) inlineAbort(); // a rebuild strands any live inline session
    const paths = [];
    for (let j = 0; j < n; j++) {
      paths.push(`<path data-s="${j}" d="" fill="none" stroke-linecap="round"></path>`);
    }
    const nodes = [];
    for (let j = 0; j < n; j++) {
      nodes.push(`<div class="br-node" data-i="${j}"><div data-pad hidden></div><div class="br-sway"><div data-core></div></div></div>`);
      nodes.push(`<div class="br-label" data-i="${j}"><span data-lab></span></div>`);
    }
    root.innerHTML = `
      <div class="br-frame">
        <div class="br-fade"></div>
        <div class="br-head">
          <div>
            <div class="br-title"></div>
            <div class="br-sub"></div>
          </div>
          <div class="br-head-right">
            <div class="br-count"></div>
            <div class="br-tools"></div>
          </div>
        </div>
        <div class="br-stage">
          <div class="br-strip">
            <svg width="900" height="1760" viewBox="0 0 900 1760" aria-hidden="true">
              <defs>
                <!-- The released strands dissolve inside the Ω: nothing may
                     cross the reading text below it (fade 1860 → 1968). -->
                <linearGradient id="brTailFade" x1="0" y1="1860" x2="0" y2="1968" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stop-color="#fff"></stop>
                  <stop offset="1" stop-color="#fff" stop-opacity="0"></stop>
                </linearGradient>
                <mask id="brTailMask" maskUnits="userSpaceOnUse" x="-600" y="-600" width="2100" height="3600">
                  <rect x="-600" y="-600" width="2100" height="2460" fill="#fff"></rect>
                  <rect x="-600" y="1860" width="2100" height="108" fill="url(#brTailFade)"></rect>
                </mask>
              </defs>
              <g mask="url(#brTailMask)">${paths.join("")}</g></svg>
            <canvas class="br-live" width="${900 * DPR}" height="${1760 * DPR}" style="width:900px;height:1760px"></canvas>
            <div class="br-omega"><div class="br-omega-glow"></div><canvas data-omw width="${420 * DPR}" height="${420 * DPR}" style="width:420px;height:420px"></canvas></div>
            <div class="br-alpha" hidden>
              <div class="br-ao-lead" data-ao="lead"></div>
              <div class="br-ao-body" data-ao="what"></div>
              <div class="br-ao-body" data-ao="seven"></div>
              <div class="br-ao-begin" data-ao="begin"></div>
            </div>
            <div class="br-omread" hidden>
              <div class="br-om-whisper"></div>
              <div class="br-om-note"></div>
              <div class="br-om-reading"></div>
              <div class="br-om-actions"><span class="br-om-export"></span></div>
              <div class="br-om-rest"></div>
            </div>
            ${nodes.join("")}
            <div class="br-nimbus">
              <div class="br-sway">
                <div class="br-nimbus-glow"></div>
                <div class="br-ping" data-ping></div>
              </div>
            </div>
            <div class="br-plaque">
              <div class="br-sway">
                <div class="br-plaque-title"></div>
                <div class="br-plaque-time"></div>
                <div class="br-plaque-line"></div>
              </div>
            </div>
          </div>
          <div class="br7-canvas">
            <div class="br7-chat"><div class="br7-msgs"></div></div>
            <div class="br7-comp">
              <button class="br7-skip" hidden></button>
              <textarea class="br7-input" rows="1" data-own-mic="1" disabled></textarea>
              <button class="br7-mic" hidden>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"></rect><path d="M5 11a7 7 0 0 0 14 0"></path><path d="M12 18v3"></path></svg>
              </button>
            </div>
            <div class="t5-tpanel br7-tpanel" hidden style="pointer-events:auto">
              <div class="t5-tpanel-head">
                <span class="t5-tpanel-kicker"></span>
                <button class="t5-tclose">✕</button>
              </div>
              <div class="t5-tlabel" data-l1></div>
              <div class="t5-twhat"></div>
              <div class="t5-tlabel" data-l2></div>
              <div class="t5-tmono"></div>
            </div>
          </div>
        </div>
        <button class="br7-exit"><span class="br7-exit-arrow">←</span> <span class="br7-exit-label"></span></button>
        <!-- Drawn, not typed: the ◎ glyph's metrics differ per platform font
             (visibly off-centre on Windows' symbol fallback). -->
        <button class="br7-info" title="Transparency" aria-label="Transparency">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="6.4" stroke="currentColor" stroke-width="1.2"></circle>
            <circle cx="8" cy="8" r="2.5" fill="currentColor"></circle>
          </svg>
        </button>
      </div>`;
    J.frame = root.firstElementChild;
    J.stage = J.frame.querySelector(".br-stage");
    J.strip = J.frame.querySelector(".br-strip");

    const onPick = (e) => {
      if (J.merge) return; // the weave ceremony owns the field until it settles
      const j = Number(e.currentTarget.dataset.i);
      if (J.sess) {
        // The field is inert during a session; the node itself stays the
        // transparency button (the app's invariant).
        if (j === L.idx) toggleInlineTransparency();
        return;
      }
      if (j === J.focus) {
        // Press the focused node: open it if it's ready, else nudge to explain
        // it's locked. Every openable bead — woven or actionable — talks inline
        // beside its node; woven ones open straight to the authored passage.
        if (openable(j)) { if (!J.merge) inlineOpen(j); }
        else lockFeedback();
      } else setFocus(j); // press any other node → bring its thread to center
    };
    // The waking sphere oscillates every frame, so a real `click` (press+release
    // on the same element) gets dropped when it slides out from under the cursor.
    // Activate on `pointerdown` (one instantaneous hit-test) and swallow the
    // trailing synthetic click for 700ms.
    J.strip.querySelectorAll(".br-node,.br-label").forEach((el) => {
      el.addEventListener("pointerdown", (e) => { J.__pd = Date.now(); onPick(e); });
      el.addEventListener("click", (e) => { if (Date.now() - (J.__pd || 0) < 700) return; onPick(e); });
    });
    J.strip.querySelector('.br-alpha [data-ao="begin"]')?.addEventListener("click", aoBegin);

    let acc = 0;
    J.stage.addEventListener("wheel", (e) => {
      if (J.sess) {
        // Navigation freezes, but the transcript and the transparency panel
        // must stay scrollable (their scrollbars are hidden, not their scroll).
        if (!e.target.closest(".br7-chat,.br7-tpanel")) e.preventDefault();
        return;
      }
      e.preventDefault();
      if (J.omega) {
        // Terminal state: the reading can run taller than the window (long
        // statements, small laptops), so scrolling DOWN pans the camera to
        // the end of it first. Only from the top does up return to the field.
        if (J.omega !== "rest") return;
        const rd = J.strip.querySelector(".br-omread");
        // Bound the pan in LAYOUT coordinates (offsetTop/Height ignore the
        // strip's transform). Measuring the live rect instead lets a burst of
        // wheel events clamp against a position the transition hasn't reached
        // yet — the pan then runs away by thousands of pixels.
        const maxPan = rd
          ? Math.max(0, rd.offsetTop + rd.offsetHeight + 28 - 1330 - J.stage.clientHeight)
          : 0;
        if (e.deltaY > 0) {
          acc = 0;
          if ((J.omPan || 0) < maxPan) {
            J.omPan = Math.min(maxPan, (J.omPan || 0) + e.deltaY);
            omegaLayout(true);
          }
          return;
        }
        if ((J.omPan || 0) > 0) { acc = 0; J.omPan = Math.max(0, J.omPan + e.deltaY); omegaLayout(true); return; }
        acc += e.deltaY;
        if (acc < -34) { acc = 0; omegaExit(); }
        return;
      }
      if (J.merge) return; // no scrolling away mid-weave
      acc += e.deltaY;
      if (acc > 34) {
        acc = 0;
        // One more notch below the last woven bead re-enters the Ω rest.
        if (J.focus === J.nodes.length - 1 && J.omDone && J.status[J.focus] === "done") omegaEnter();
        else setFocus(J.focus + 1);
      } else if (acc < -34) { acc = 0; setFocus(J.focus - 1); }
    }, { passive: false });

    // Third exit (with Esc and the node-as-button): click empty field to leave —
    // the open transparency panel closes first, then the session.
    J.stage.addEventListener("click", (e) => {
      if (!J.sess || L.closing) return;
      // Clicking UI that re-renders on click (alternative wording, review
      // actions) detaches the target before this handler runs; closest()
      // would then miss the chat and close the session out from under it.
      if (!e.target || !e.target.isConnected) return;
      // The click that follows a node press must never count as a click-out:
      // opening shifts the camera, so the node slides out from under the
      // cursor and this click's target is no longer the node.
      if (Date.now() - (J.__pd || 0) < 700) return;
      // The whole session column counts as "inside" — the empty space under
      // the messages and around the composer is where a hand naturally rests,
      // and losing an interview to a stray click there is indefensible.
      if (e.target.closest(".br7-canvas,.br7-chat,.br7-comp,.br7-info,.br7-exit,.br7-tpanel,.br7-mic,.br-node")) return;
      const tp = q7(".br7-tpanel");
      if (tp && !tp.hidden) { tp.hidden = true; return; }
      // Work in flight is never discarded by a click: unsent words, or an
      // amend conversation mid-settlement. Esc and ← Journey still leave.
      if (L.open && (composerText() || L.composerMode === "amend")) return;
      if (L.open) { L.ctx.closeWs(); inlineClose(); L.ctx.reload(); }
    });

    J.stage.addEventListener("mousemove", (e) => {
      const r = J.stage.getBoundingClientRect();
      J.mx = e.clientX - r.left;
      J.my = e.clientY - r.top;
    });
    J.stage.addEventListener("mouseleave", () => { J.mx = undefined; });

    // Inline session shell wiring.
    const inp = q7(".br7-input");
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); inlineSend(); }
    });
    inp.addEventListener("input", () => {
      autosize(inp);
      L.draft = inp.value; // persist the in-progress draft across re-renders
      saveDraft(inp.value); // …and across leaving the session entirely
    });
    q7(".br7-mic").addEventListener("click", () => {
      if (!L.open) return;
      const v = L.ctx.voice;
      if (!v?.enabled?.()) return;
      if (v.active()) v.stop();
      else v.start(inp);
    });
    q7(".br7-skip").addEventListener("click", () => {
      // The affordance sends the literal /skip command; the engine decides
      // whether the whole step closes gracefully or just this topic ends.
      if (!L.open || L.closing) return;
      if (!L.ctx.wsSend({ type: "answer", text: "/skip" })) return inlineConnLost();
      inlineCompose(false);
      inlineMsg("user", L.ctx.t("braid_skip_step"));
    });
    q7(".t5-tclose").addEventListener("click", () => { q7(".br7-tpanel").hidden = true; });
    J.frame.querySelector(".br7-info").addEventListener("click", toggleInlineTransparency);
    J.frame.querySelector(".br7-exit").addEventListener("click", () => {
      if (!L.open || L.closing) return;
      L.ctx.closeWs();
      inlineClose();
      L.ctx.reload();
    });
  }

  function updateHeader() {
    const { t, journey, mode, profile, profiles, profileName, exportPdf, actions } = J.ctx;
    J.frame.querySelector(".br-title").textContent = t("journey_title");
    J.frame.querySelector(".br-sub").textContent = t("braid_journey_sub");
    const done = J.status.filter((s) => s === "done").length;
    const count = J.frame.querySelector(".br-count");
    count.innerHTML = "";
    // The stage you're in leads — "Interview · 2 of 5" answers how much of
    // THIS is left, so fifteen nodes never read as fifteen interviews. The
    // overall count stays underneath, muted, and never lies.
    const nextIdx = J.status.indexOf("next");
    const curSector = nextIdx >= 0 ? J.nodes[nextIdx].sector : J.nodes[J.nodes.length - 1].sector;
    const inSector = J.nodes.map((n, j) => [n, j]).filter(([n]) => n.sector === curSector);
    const doneIn = inSector.filter(([, j]) => J.status[j] === "done").length;
    const sec = journey.sectors.find((s) => s.n === curSector);
    const phaseName = (J.ctx.phaseLabel(sec) || sec.label).split("·").pop().trim();
    const phase = document.createElement("div");
    phase.className = "br-count-phase";
    phase.textContent = t("braid_stage_of", phaseName, doneIn, inSector.length);
    const total = document.createElement("div");
    total.className = "br-count-total";
    total.textContent = t("braid_woven_of", done, J.nodes.length);
    count.append(phase, total);

    const tools = J.frame.querySelector(".br-tools");
    tools.innerHTML = "";
    const pill = (label, cls, fn) => {
      const b = document.createElement("button");
      b.className = `br-pill${cls ? " " + cls : ""}`;
      b.textContent = label;
      b.addEventListener("click", fn);
      tools.appendChild(b);
      return b;
    };
    if (journey.authorized > 0) {
      const b = pill(t("btn_export"), "", exportPdf);
      b.title = t("btn_export_title");
    }
    if (profile !== "default") {
      const chip = document.createElement("span");
      chip.className = "br-chip";
      chip.textContent = profileName(profiles.find((p) => p.id === profile) ?? { id: profile });
      tools.appendChild(chip);
    }
    pill(mode === "client" ? t("mode_practitioner") : t("mode_client"), "", actions.toggleMode);
    pill(J.ctx.theme === "light" ? t("theme_dark") : t("theme_light"), "", actions.toggleTheme);
    pill(J.ctx.lang === "en" ? "RU" : "EN", "", actions.toggleLang);
    const hasProgress = J.nodes.some((x) => J.ctx.isSettled(x.status) || x.status === "in_progress");
    if (hasProgress) {
      const rb = pill(t("btn_reset"), "quiet", async () => {
        if (!rb.classList.contains("armed")) {
          rb.classList.add("armed");
          const who = profileName(profiles.find((p) => p.id === profile) ?? { id: profile });
          rb.textContent = t("reset_confirm", who);
          clearTimeout(J.resetTimer);
          J.resetTimer = setTimeout(() => {
            if (rb.isConnected) { rb.classList.remove("armed"); rb.textContent = t("btn_reset"); }
          }, 5000);
          return;
        }
        rb.disabled = true;
        await J.ctx.reset();
      });
    }
  }

  function updateTexts() {
    const { t, esc } = J.ctx;
    // α copy in the current language (the layer lives across re-renders).
    const alpha = J.strip.querySelector(".br-alpha");
    if (alpha) {
      alpha.querySelectorAll("[data-ao]").forEach((el) => {
        el.textContent = t(`braid_alpha_${el.dataset.ao}`);
      });
    }
    J.strip.querySelectorAll(".br-label").forEach((el) => {
      const j = Number(el.dataset.i);
      const node = J.nodes[j];
      const nm = J.ctx.nodeTitle(node);
      // Only DERIVED steps explain themselves while they wait — they compose
      // from what's already woven, so the wait is the point. The interview
      // steps say nothing: they hang on the goal alone, never on each other,
      // and naming the step above them claimed an order that doesn't exist.
      const span = el.firstElementChild;
      if (node.status === "planned" && node.kind === "derived") {
        span.innerHTML = `<div>${esc(nm)}</div><div class="br-label-sub">${esc(t("derived_sub"))}</div>`;
      } else if (span.textContent !== nm || span.querySelector(".br-label-sub")) {
        span.textContent = nm;
      }
    });
    const inp = q7(".br7-input");
    if (inp && !L.open) inp.placeholder = t("placeholder");
    const info = J.frame.querySelector(".br7-info");
    if (info) info.title = t("transparency");
    const exitLabel = J.frame.querySelector(".br7-exit-label");
    if (exitLabel) exitLabel.textContent = `${t("exit").replace(/^[←\s]+/, "")} ${t("exit_saved")}`;
    const tp = q7(".br7-tpanel");
    if (tp) {
      tp.querySelector(".t5-tpanel-kicker").textContent = `◎ ${t("transparency")}`;
      tp.querySelector("[data-l1]").textContent = t("t_what");
      tp.querySelector("[data-l2]").textContent = t("t_compiled");
    }
  }

  const timing = () => Date.now() < J.slowUntil
    ? { dur: "1.7s", ease: "cubic-bezier(.3,.7,.15,1)", op: "1.3s" }
    : { dur: "1.05s", ease: "cubic-bezier(.32,.72,.16,1)", op: ".7s" };

  /* The two stations a node's name can occupy, both measured from the node's
   * own centre. Active: risen and full size, clear of the sphere. Inactive:
   * small and tucked against its side. Scaling happens about the node-facing
   * edge, so the two states are one continuous physical move — the name is
   * drawn out of the node, or pulled back into it. */
  function nameStation(active, right, r = 13) {
    const scale = active ? 1.92 : 1;      // 13.5px → ~26px
    const clear = (active ? r * 1.6 : r) + (active ? 18 : 11); // past the sphere
    return {
      scale,
      origin: right ? "0% 50%" : "100% 50%",
      align: right ? "left" : "right",
      dx: right ? clear : -(300 + clear),
      dy: active ? -52 : -8,
    };
  }

  /* The drawn radius of a node's sphere, which is what its name must clear. */
  const nodeR = (j) => (J.status[j] === "next" ? 25 : J.status[j] === "done" ? 13 : 9);

  function labelPlace(j, anchor) {
    const ny = nodeYf(j);
    const nx = withGrav(baseX(j, ny), ny, anchor);
    // ~14px gap from node center; flip to the in-frame side; clamp inside the
    // 900-wide field so no name leaves the frame.
    const LW = 180, FW = 900;
    // The name prefers the LEFT of its sphere, reading right-aligned into it
    // (the field's original hand). It only takes the right shoulder when the
    // frame's edge would cut it off — half the field was too eager a rule,
    // and pushed near-centre nodes like the goal onto their crowded side.
    let right = nx < 366;
    let lx = right ? nx + 14 : nx - 194;
    if (!right && lx < 12) { right = true; lx = nx + 14; }
    else if (right && lx + LW > FW - 12) { right = false; lx = nx - 194; }
    lx = Math.max(12, Math.min(FW - 12 - LW, lx));
    let squeezed = false;
    if (Math.abs(j - J.focus) === 1 &&
      ((ny + 8 > anchor.py - 88 && ny - 10 < anchor.py - 50) ||
        (ny + 8 > anchor.py + 52 && ny - 10 < anchor.py + 120))) {
      right = nx >= anchor.nx;
      lx = right ? Math.max(nx + 26, anchor.nx + 230) : Math.min(nx - 206, anchor.nx - 410);
      lx = Math.max(8, Math.min(712, lx));
      squeezed = lx + 180 > anchor.nx - 235 && lx < anchor.nx + 235;
    }
    return { x: lx, y: ny - 10, right, opacity: j === J.focus ? "0" : squeezed ? ".15" : "1" };
  }

  function layout(instant = false) {
    if (!J.stage || !J.stage.isConnected) return;
    // The Ω owns the camera and thread styling while it lives; resyncs and
    // stray layout calls must not pull the field back up mid-ceremony.
    if (J.omega) { omegaLayout(); return; }
    const tm = instant ? { dur: "0s", ease: "linear", op: "0s" } : timing();
    const anchor = anchorFor(J.focus);
    const n = J.nodes.length;
    // The phase the journey is in right now; everything in LATER phases
    // recedes further into the paper (extra dim on nodes and labels).
    const nextIdx = J.status.indexOf("next");
    const curSector = nextIdx >= 0 ? J.nodes[nextIdx].sector : Infinity;

    J.vp = Math.min(1, J.status.filter((s) => s === "done").length / 13);
    J.stage.style.setProperty("--vacc", `color-mix(in srgb, var(--acc) ${Math.round(8 + 92 * J.vp)}%, var(--t4mut))`);

    // Canvas paint kit, resolved once per layout (theme/pigment changes all
    // funnel through here) — the tick must never query styles per frame.
    J.paint = {
      back: livePaintColor("var(--t4wireB)"),
      front: livePaintColor("color-mix(in srgb, var(--vacc, var(--acc)) 80%, var(--t4wireF))"),
      dot: livePaintColor("var(--vacc, var(--acc))"),
      acc: livePaintColor("var(--acc)"),
      cnt: livePaintColor("var(--t4cnt)"),
      note: livePaintColor("var(--t4note)"),
      lab2: livePaintColor("var(--t4lab2)"),
      ts3: livePaintColor("var(--t4ts3)"),
      ink2: livePaintColor("var(--t4ink2)"),
      lab3: livePaintColor("var(--t4lab3)"),
      body: livePaintColor("var(--t4body)"),
      ts1: livePaintColor("var(--t4ts1)"),
      ts2: livePaintColor("var(--t4ts2)"),
    };
    if (nextIdx >= 0) {
      const st = threadStyle("next", nextIdx === J.focus);
      J.paint.thread = { c: livePaintColor(st.stroke), width: st.width, opacity: st.opacity };
    }

    J.strip.style.transition = `transform ${tm.dur} ${tm.ease}`;
    J.strip.style.transform = `translate(${(J.sess ? J.sx : 0).toFixed(0)}px, ${stripY().toFixed(0)}px)`;

    let focusPos = null;
    for (let j = 0; j < n; j++) {
      const p = J.strip.querySelector(`[data-s="${j}"]`);
      if (p) {
        p.style.transition = `d ${tm.dur} ${tm.ease}, opacity ${tm.op} ease`;
        setD(p, threadD(j, anchor));
        const st = threadStyle(J.status[j], j === J.focus);
        p.setAttribute("stroke", st.stroke);
        p.setAttribute("stroke-width", st.width);
        // α: planned threads lift to .16 while the overture lives — the
        // field shows all fifteen strays instead of near-invisible ones.
        // The waking thread is the live canvas's alone — its svg twin hides.
        p.style.opacity = J.status[j] === "next" ? "0" : J.ov ? ".16" : st.opacity;
      }
      const nd = J.strip.querySelector(`.br-node[data-i="${j}"]`);
      if (nd) {
        const ny = nodeYf(j);
        const nx = withGrav(baseX(j, ny), ny, anchor);
        nd.style.transition = `transform ${tm.dur} ${tm.ease}, opacity .45s ease`;
        nd.style.transform = `translate(${nx.toFixed(1)}px, ${ny.toFixed(1)}px)${j === J.focus ? " scale(1.6)" : ""}`;
        nd.classList.toggle("br-future", J.nodes[j].sector > curSector);
        renderCore(nd.querySelector("[data-core]"), J.status[j], j);
        const pad = nd.querySelector("[data-pad]");
        if (pad) pad.hidden = j !== nextIdx;
        if (j === J.focus) focusPos = { x: nx, y: ny };
      }
      const l = J.strip.querySelector(`.br-label[data-i="${j}"]`);
      if (l) {
        const lp = labelPlace(j, anchor);
        const span = l.firstElementChild;
        const st = J.status[j];
        const active = j === J.focus;
        // The frame the canvas hands this name back to the DOM, it must be
        // there ALREADY — fading in over a third of a second is what made the
        // name vanish and reappear at the far end of a weave.
        // Ownership of this name changes in BOTH directions: the canvas takes
        // it when the step wakes, and gives it back when the step is woven.
        // Whichever way it goes, the outgoing copy must leave in the same
        // frame the incoming one arrives — a fade means both are on screen
        // at once, in two different places, and the name reads as doubled.
        const handoff = (J.wasWake === j) !== (st === "next");
        // The box rides the node; the name moves only relative to it.
        const lny = nodeYf(j);
        const lx = withGrav(baseX(j, lny), lny, anchor);
        if (handoff && st !== "next" && J.lastAmp) {
          // Take the name back exactly where the canvas was holding it —
          // mid-sway — then let it settle to rest instead of snapping there.
          l.style.transition = "none";
          l.style.transform = `translate(${(lx + J.lastAmp).toFixed(1)}px, ${lny.toFixed(1)}px)`;
          void l.offsetWidth;
        }
        l.style.transition = instant ? "none" : `transform ${tm.dur} ${tm.ease}`;
        l.style.transform = `translate(${lx.toFixed(1)}px, ${lny.toFixed(1)}px)`;
        // In session the chat owns the right of the field, so the name
        // takes the other side of its sphere rather than colliding with it.
        const ns = nameStation(active, J.sess ? false : lp.right, nodeR(j));
        span.style.transition = instant || handoff ? "none" : "";
        span.style.transformOrigin = ns.origin;
        span.style.transform = `translate(${ns.dx}px, ${ns.dy}px) scale(${ns.scale})`;
        span.style.textAlign = ns.align;
        // Future phases recede: their labels dim further — the field's
        // stage structure is carried by depth, not by signposts. During the
        // overture every label steps back so the copy can speak.
        span.style.opacity = ((active ? 1 : lp.opacity)
          * (J.nodes[j].sector > curSector ? 0.45 : 1)
          * (J.ov && !J.ovWake ? 0.3 : 1)).toFixed(2);
        span.style.color = active ? "var(--t4ink2)"
          : st === "done" ? "var(--t4lab1)" : st === "next" ? "var(--t4lab2)" : "var(--t4lab3)";
        // The waking node oscillates, so a DOM name pinned to its resting
        // place drifts out from under it. Its name rides the sway on the
        // canvas instead; the box stays as the click target, invisible.
        if (st === "next") {
          span.style.opacity = "0";
        }
        if (handoff) { void span.offsetWidth; span.style.transition = ""; } // commit, then let motion resume
      }
    }

    const focused = J.nodes[J.focus];
    const fst = J.status[J.focus];
    const plaque = J.strip.querySelector(".br-plaque");
    const nimbus = J.strip.querySelector(".br-nimbus");
    const titleEl = plaque.querySelector(".br-plaque-title");
    titleEl.textContent = J.ctx.nodeTitle(focused);
    // The name belongs to its node now — the label rises into place for a DOM
    // node, the canvas paints it for the waking one. This third copy lived on
    // the plaque, which travels between nodes: it was the ghost that appeared
    // to carry a name from one sphere to another. It never shows again.
    titleEl.style.display = "none";
    // Far-left locked nodes (strings splay left) would run the title off-frame:
    // flip it to the node's right. Caption stays right in both cases.
    const flip = !J.sess && anchor.nx < 372;
    titleEl.style.right = "auto";
    titleEl.style.left = flip ? "20px" : "-356px";
    titleEl.style.textAlign = flip ? "left" : "right";
    // The time sits on the sphere's upper shoulder, opposite the caption —
    // and swaps shoulders with the title when the title flips.
    const timeEl = plaque.querySelector(".br-plaque-time");
    timeEl.style.left = flip ? "-234px" : "34px";
    timeEl.style.textAlign = flip ? "right" : "left";
    plaque.querySelector(".br-plaque-time").textContent =
      !J.merge && fst !== "done" && focused.minutes
        ? J.ctx.t("braid_minutes", focused.minutes) : "";
    plaque.querySelector(".br-plaque-line").textContent =
      J.merge && J.merge.j === J.focus && J.merge.phase === "solid"
        ? J.ctx.t("braid_woven_in")
        // "Locked" must reflect SERVER truth: a step that is available but
        // simply not the current one still opens — never call it locked.
        // And only a DERIVED step is ever described as waiting: an interview
        // step keeps its own invitation, whatever order it is met in.
        : (focused.status === "planned" && focused.kind === "derived" && J.focus > 0)
          ? J.ctx.t("locked_unlocks_after", J.ctx.nodeTitle(J.nodes[J.focus - 1]))
          : J.ctx.nodeDesc(focused);
    // Plaque and nimbus ride the camera via inline transform. A WAKING focus
    // hands the whole plaque (name, time, caption) to the canvas, which rides
    // the sway with the old soft-follow — the DOM twin sleeps meanwhile.
    // Nothing crosses the field: the caption and the glow belong to whichever
    // node holds the focus, so they cut to it and fade there. Transitioning
    // the transform made them fly between spheres — the same ghost the title
    // was making, one element down.
    // Same hand-off rule for the caption: when the canvas takes the focused
    // node's words (or hands them back), the plaque must not linger through a
    // fade beside the copy that has already arrived.
    const capCanvas = fst === "next";
    const capHandoff = J.wasCapCanvas !== capCanvas;
    J.wasCapCanvas = capCanvas;
    plaque.style.transition = capHandoff ? "none" : "opacity .5s ease";
    nimbus.style.transition = capHandoff ? "none" : "opacity .5s ease";
    // The caption belongs to its node, so it hangs off the node's REAL
    // position — anchor.nx is the raw pre-gravity value and sits ~40px away,
    // which is exactly how far the caption jumped when the canvas (which
    // draws node-relative) handed it back at a weave.
    const tx = `translate(${(focusPos ? focusPos.x : anchor.nx).toFixed(1)}px, ${(focusPos ? focusPos.y : anchor.py).toFixed(1)}px)`;
    plaque.style.transform = tx;
    nimbus.style.transform = tx;
    // The waking node's words are canvas-painted in BOTH states (it sways, and
    // no transition may run beside a cursor) — so the state is kept whether or
    // not it holds the focus, and the painter interpolates between the two.
    J.wasWake = nextIdx;
    if (nextIdx >= 0) {
      const wn = J.nodes[nextIdx];
      const wake = nextIdx === J.focus;
      J.wake = {
        j: nextIdx,
        title: J.ctx.nodeTitle(wn),
        time: wake && !J.sess ? timeEl.textContent : "",
        line: wake && !J.sess ? plaque.querySelector(".br-plaque-line").textContent : "",
        flip: J.sess ? false : labelPlace(nextIdx, anchor).right,
      };
    } else J.wake = null;
    // A waking focus draws its whole aura (glow, ping, sway) on the canvas —
    // the DOM nimbus serves only the settled (done) state, where it is still.
    nimbus.style.opacity = fst === "next" ? "0" : fst === "done" ? ".4" : "0";
    // A node that just became the waking one grows out of its planned ghost
    // on the canvas (0.36 → 1 over .8s), mirroring the old DOM box transition.
    if (J.prevNext !== nextIdx) {
      J.prevNext = nextIdx;
      J.wakeT = performance.now();
    }
    // α: the plaque and the canvas aura (glow/ping) are withheld while the
    // overture speaks; the wake blooms them in on the 1.9s canvas ramp
    // (J.glowT). The dip-and-return must not run in either state — it would
    // clobber the withhold and cut the bloom short.
    if (fst === "next") {
      // Canvas-ridden plaque: the DOM twin sleeps whenever the focus wakes;
      // the α gates apply inside the draw, but ovPend must still arm them.
      plaque.style.opacity = "0";
      if (J.ovPend) { J.ovPend = false; J.glowT = performance.now(); }
    } else if (J.ov && !J.ovWake) {
      plaque.style.opacity = "0";
    } else if (J.ovPend) {
      J.ovPend = false;
      J.glowT = performance.now();
      plaque.style.transition = "opacity 1.9s cubic-bezier(.3,.7,.15,1)";
      plaque.style.opacity = "1";
    } else if (!instant) {
      // Caption dip-and-return on every relayout. The callback re-checks the
      // world at fire time: a ceremony's advance can re-layout (waking focus,
      // canvas-ridden plaque) between the dip and this frame — restoring "1"
      // blindly painted the DOM plaque on top of its canvas twin.
      plaque.style.opacity = "0";
      requestAnimationFrame(() => {
        if (!(J.ov && !J.ovWake) && J.status[J.focus] !== "next") plaque.style.opacity = "1";
      });
    } else plaque.style.opacity = "1";
  }

  /* All focus changes route through here: cancels a running ceremony dwell
   * and promotes the pending step immediately. */
  function setFocus(i) {
    clearTimeout(J.timers.phase);
    clearTimeout(J.timers.advance);
    // Cutting a ceremony short (wheel, click) still owes the server sync the
    // advance timer would have scheduled.
    const ceremonial = J.merge !== null || J.pendingNext != null;
    J.merge = null;
    const p = J.pendingNext;
    if (p != null) {
      J.pendingNext = null;
      if (p < J.nodes.length && J.status[p] === "plan") J.status[p] = "next";
    }
    J.focus = Math.max(0, Math.min(J.nodes.length - 1, i));
    layout();
    if (ceremonial) {
      clearTimeout(J.timers.reload);
      J.timers.reload = setTimeout(() => J.ctx.reload(), 1300);
    }
  }

  /* A press on a focused-but-locked node explains itself: the caption flickers
   * and the sphere gives a small shake, instead of a silent no-op. */
  function lockFeedback() {
    const line = J.strip?.querySelector(".br-plaque-line");
    line?.animate?.([{ opacity: 1 }, { opacity: .35 }, { opacity: 1 }], { duration: 460, easing: "ease" });
    const core = J.strip?.querySelector(`.br-node[data-i="${J.focus}"] [data-core]`);
    core?.animate?.([
      { transform: "translateX(0)" }, { transform: "translateX(-4px)" },
      { transform: "translateX(4px)" }, { transform: "translateX(-2px)" }, { transform: "translateX(0)" },
    ], { duration: 380, easing: "ease" });
  }

  /* ── rAF loop: oscillation, spin, hover, nimbus/ping ────── */

  function startTick() {
    if (J.raf) return;
    const loop = (ts) => {
      J.loop = loop;
      J.raf = requestAnimationFrame(loop);
      const stage = J.stage, strip = J.strip;
      if (!stage || !stage.isConnected) { stopTick(); return; }
      if (S.open) return; // the page-style review overlay owns the screen
      // IDLE FRAMES ARE PAINT-ONLY. Any per-frame style/DOM write — and any
      // CSS animation moving near the pointer — feeds the macOS
      // AppKit↔Chromium cursor race: a stationary pointer flips to the arrow
      // whenever hover is re-evaluated under it. All idle motion (sway, spin,
      // glow, ping) is canvas paint; this loop must never touch the DOM.
      const ow = strip.querySelector("[data-omw]");
      if (ow && ow.getContext) {
        // Spin the Ω only while it can be seen — below the fold it holds.
        // Its sway is drawn here too: the rest-state export link sits beside
        // it, and CSS animations near a parked cursor re-arm the race.
        const or = ow.getBoundingClientRect();
        if (or.bottom > 0 && or.top < innerHeight) {
          J.omSpin = (J.omSpin || 0.6) + 0.002;
          const swx = -9 * Math.cos(ts * 2 * Math.PI / 6500);
          const g = ow.__g || (ow.__g = ow.getContext("2d"));
          g.setTransform(1, 0, 0, 1, 0, 0);
          g.clearRect(0, 0, ow.width, ow.height);
          g.setTransform(2 * DPR, 0, 0, 2 * DPR, ow.width / 2 + swx * DPR, ow.height / 2);
          sphereDraw(g, 100, J.omSpin, 0.35, J.paint || {}, 2);
        }
      }
      const j = J.status.indexOf("next");
      const anchor = anchorFor(J.focus);
      const live = strip.querySelector(".br-live");
      const lg = live && (live.__g || (live.__g = live.getContext("2d")));
      if (lg) {
        lg.setTransform(DPR, 0, 0, DPR, 0, 0);
        if (live.__drawn || j >= 0 || J.sat) lg.clearRect(0, 0, 900, 1760);
        live.__drawn = j >= 0 || !!J.sat;
      }
      if (j < 0) {
        drawWait(lg, ts, anchor.nx, anchor.py);
        renderKnots(strip, j, anchor, 0);
        return;
      }
      const ny = nodeYf(j);
      const nx0 = withGrav(baseX(j, ny), ny, anchor);
      const dir = Math.sign(braidX(j, ny) - nx0) || 1;
      // The sway eases in from nothing as a step wakes: the DOM held this
      // name at rest, and the canvas picking it up mid-swing threw it
      // sideways by up to the full amplitude in a single frame.
      const swayIn = Math.min(1, Math.max(0, (ts - (J.wakeT || 0)) / 700));
      const amp = 26 * (0.5 - 0.5 * Math.cos(ts * 2 * Math.PI / 6500)) * dir * swayIn;
      J.lastAmp = amp; // the DOM settles from here when it takes the name back
      const pts = sampleYs(ny).map((y) => {
        const bell = Math.exp(-Math.pow((y - ny) / 170, 2));
        return [withGrav(baseX(j, y), y, anchor) + amp * bell, y];
      });
      // [data-sess] recession twin, per draw: the session's OWN thread and
      // sphere stay full (its node is the [data-cur] peer); only a background
      // waking ensemble recedes with the rest of the field.
      const isCur = J.sess && L.open && L.idx === j;
      const dim = J.sess && !isCur ? 0.055 : 1;
      if (lg) {
        const th = (J.paint && J.paint.thread) || { c: null, width: 1.4, opacity: 1 };
        lg.globalAlpha = (+th.opacity || 1) * dim;
        lg.lineWidth = +th.width || 1.4;
        lg.lineCap = "round";
        lg.strokeStyle = pcss(th.c);
        lg.stroke(new Path2D(quadPath(pts)));
        lg.globalAlpha = 1;
      }
      const dt = Math.min(64, J.lastTs ? ts - J.lastTs : 16);
      J.lastTs = ts;
      // Mouse is stage-space; threads are strip-space (900 wide, centered).
      const offX = (stage.clientWidth - 900) / 2;
      const sy = stripY();
      const hov = J.mx !== undefined
        && Math.abs(J.mx - offX - (J.sess ? J.sx : 0) - (nx0 + amp)) < 140
        && (J.my - (ny + sy)) > -105 && (J.my - (ny + sy)) < 140;
      J.hovOn = hov; // canvas state only — hover writes nothing to the DOM
      J.hovK += ((hov ? 1.09 : 1) - J.hovK) * 0.15;
      J.spin += dt * (hov ? 0.0016 : 0.00042);
      if (lg && !(J.merge && J.merge.j === j)) {
        // The waking ensemble — growth, pulse, glow, ping, wire — painted at
        // the live position. The DOM carries none of it (cursor-war rule).
        const paint = J.paint || {};
        const clamp01 = (v) => Math.max(0, Math.min(1, v));
        const ge = 1 - Math.pow(1 - clamp01((ts - (J.wakeT || 0)) / 800), 3);
        const pk = J.pulseT ? 1 + 0.18 * Math.sin(Math.PI * clamp01((ts - J.pulseT) / 700)) : 1;
        const sc = (j === J.focus ? 1.6 : 1) * J.hovK * pk * (0.36 + 0.64 * ge);
        const cx0 = nx0 + amp;
        const light = document.documentElement.dataset.theme === "light";
        lg.filter = hov ? (light ? "brightness(.68) saturate(1.25)" : "brightness(1.4)") : "none";
        lg.globalAlpha = dim;
        if (!(J.ov && !J.ovWake)) { // α withhold: the bare sphere, no aura
          const bloom = (J.glowT ? clamp01((ts - J.glowT) / 1900) : 1)
            * (0.6 + 0.4 * (0.5 - 0.5 * Math.cos(ts * 2 * Math.PI / 6500))); // breatheGlow twin
          const aura = lg.createRadialGradient(cx0, ny, 0, cx0, ny, 100);
          aura.addColorStop(0, pcss(paint.dot, 0.4 * bloom));
          aura.addColorStop(0.42, pcss(paint.dot, 0.15 * bloom));
          aura.addColorStop(0.78, pcss(paint.dot, 0));
          lg.fillStyle = aura;
          lg.beginPath(); lg.arc(cx0, ny, 100, 0, 7); lg.fill();
          const halo = lg.createRadialGradient(cx0, ny, 0, cx0, ny, 19.5 * sc);
          halo.addColorStop(0, pcss(paint.acc, 0.6 * bloom));
          halo.addColorStop(0.44, pcss(paint.acc, 0.24 * bloom));
          halo.addColorStop(0.7, pcss(paint.acc, 0));
          lg.fillStyle = halo;
          lg.beginPath(); lg.arc(cx0, ny, 19.5 * sc, 0, 7); lg.fill();
          // Sonar ping phase-locked to the sway peak (+half period).
          // The ping sits out sessions entirely ([data-sess] [data-ping] twin).
          const ph = ((ts % 6500) / 6500 + 0.5) % 1;
          const op = (ph < 0.09 ? (ph / 0.09) * 0.75 : Math.max(0, 0.75 * (1 - (ph - 0.09) / 0.6))) * bloom;
          if (!J.sess && op > 0.01) {
            lg.globalAlpha = op * 0.8 * dim;
            lg.strokeStyle = pcss(paint.dot);
            lg.lineWidth = 1;
            lg.beginPath(); lg.arc(cx0, ny, 46 * (0.42 + 0.95 * ph), 0, 7); lg.stroke();
            lg.globalAlpha = dim;
          }
        }
        lg.save();
        lg.translate(cx0, ny);
        lg.scale(sc, sc);
        sphereDraw(lg, 22, J.spin, 0.35, paint, sc);
        lg.restore();
        lg.filter = "none";
        lg.globalAlpha = 1;
      }
      // The waking node's name rides its oscillation (the DOM box beneath is
      // the click target, held invisible by layout). It stays a step quieter
      // than the focused node's title, and ducks when the two would collide.
      // One name, two stations: eased here because canvas has no transitions.
      J.nameP += ((j === J.focus ? 1 : 0) - J.nameP) * 0.12;
      // Rings wrap the WAITING node: when the waking sphere is the focus they
      // ride its live swayed center; otherwise they hold on the focused node's
      // RENDERED position (withGrav — anchorFor's raw base misses by the
      // gravity offset, which is where off-center rings came from).
      // The waking node's words ride its sway in either state.
      drawWake(lg, ts, nx0 + amp, ny, dim);
      if (j === J.focus) {
        drawWait(lg, ts, nx0 + amp, ny);
      } else {
        const fny = nodeYf(J.focus);
        drawWait(lg, ts, withGrav(baseX(J.focus, fny), fny, anchor), fny);
      }
      renderKnots(strip, j, anchor, amp, pts, lg);
    };
    J.loop = loop;
    J.raf = requestAnimationFrame(loop);
  }

  /* Session knots sit exactly on the rendered string (qxAt over the same
   * pts that drew it). Riding a waking thread they are canvas paint (per-frame
   * svg writes feed the cursor race); on a still thread they render once. */
  function renderKnots(strip, nextJ, anchor, amp, livePts, lg) {
    if (!J.sess || !L.open) return;
    const kg = strip.querySelector("[data-knots]");
    if (!kg) return;
    const sNy = nodeYf(L.idx);
    const riding = !!(livePts && L.idx === nextJ);
    // The session thread's rendered pts: the live oscillating set when the
    // session node IS the waking one, else its static curve.
    const pts = riding
      ? livePts
      : sampleYs(sNy).map((y) => [withGrav(baseX(L.idx, y), y, anchor), y]);
    if (riding && lg) {
      if (kg.__kn !== "") { kg.__kn = ""; kg.innerHTML = ""; } // svg hands over once
      const acc = (J.paint && J.paint.acc) || null;
      for (const [ky, big] of L.knots) {
        const kxv = qxAt(pts, ky);
        const bell = Math.exp(-Math.pow((ky - sNy) / 170, 2));
        const kx = kxv == null ? withGrav(baseX(L.idx, ky), ky, anchor) + amp * bell : kxv;
        lg.fillStyle = pcss(acc);
        lg.strokeStyle = pcss(acc);
        lg.beginPath(); lg.arc(kx, ky, big ? 6 : 3.6, 0, 7); lg.fill();
        lg.globalAlpha = big ? 0.4 : 0.3;
        lg.lineWidth = 1;
        lg.beginPath(); lg.arc(kx, ky, big ? 12 : 8, 0, 7); lg.stroke();
        lg.globalAlpha = 1;
      }
      return;
    }
    let kn = "";
    for (const [ky, big] of L.knots) {
      const kxv = qxAt(pts, ky);
      const kx = (kxv == null ? withGrav(baseX(L.idx, ky), ky, anchor) : kxv).toFixed(1);
      kn += big
        ? `<circle cx="${kx}" cy="${ky}" r="6" fill="var(--acc)"></circle><circle cx="${kx}" cy="${ky}" r="12" fill="none" stroke="var(--acc)" stroke-opacity=".4"></circle>`
        : `<circle cx="${kx}" cy="${ky}" r="3.6" fill="var(--acc)"></circle><circle cx="${kx}" cy="${ky}" r="8" fill="none" stroke="var(--acc)" stroke-opacity=".3"></circle>`;
    }
    if (kg.__kn === kn) return; // still thread → identical markup most frames
    kg.__kn = kn;
    kg.innerHTML = kn;
  }

  function stopTick() {
    if (J.raf) cancelAnimationFrame(J.raf);
    J.raf = 0;
    J.lastTs = undefined;
  }

  /* ── authorize ceremony: travel → solidify+shake+flash → advance ── */

  function startWeave(i) {
    if (i < 0 || i >= J.nodes.length) return;
    clearThink(); // no loader may outlive its wait into the ceremony
    if (J.ov && !J.ovDone) aoDismiss(); // the first weave ends the overture
    J.status = J.status.slice();
    J.status[i] = "done";
    // The step that wakes: mirror currentNodeId()'s ordering over the
    // pre-authorize node statuses (server truth arrives with the reload).
    J.pendingNext = null;
    for (const pref of ["in_progress", "available"]) {
      const k = J.nodes.findIndex((n, j) => j !== i && n.status === pref);
      if (k >= 0) { J.pendingNext = k; break; }
    }
    J.focus = i;
    J.merge = { j: i, phase: "travel" };
    J.slowUntil = Date.now() + 1900;
    clearTimeout(J.timers.phase);
    clearTimeout(J.timers.advance);
    clearTimeout(J.timers.reload);
    layout();
    J.timers.phase = setTimeout(() => {
      J.merge = { j: i, phase: "solid" };
      const core = J.strip && J.strip.querySelector(`.br-node[data-i="${i}"] [data-core]`);
      if (core) renderCore(core, "done", i);
      if (J.focus === i) {
        const line = J.strip.querySelector(".br-plaque-line");
        if (line) line.textContent = J.ctx.t("braid_woven_in");
      }
      shakeBraid(i);
      const stage = J.stage;
      if (stage) {
        stage.style.transition = "filter .55s ease";
        J.flashOn = true;
        stage.style.filter = `saturate(${(1.45 + 0.45 * J.vp).toFixed(2)}) contrast(1.06) brightness(1.13)`;
        clearTimeout(J.timers.flash);
        J.timers.flash = setTimeout(() => {
          stage.style.transition = "filter 2.4s ease";
          J.flashOn = false;
          stage.style.filter = "none";
        }, 750);
      }
    }, 1750);
    J.timers.advance = setTimeout(() => {
      J.merge = null;
      // The braid is whole: the Ω ceremony takes the advance's place, and
      // the resync waits until the rest state so it can't fight the descent.
      if (i === J.nodes.length - 1 && J.status.every((s) => s === "done")) {
        omegaCeremony();
        clearTimeout(J.timers.reload);
        J.timers.reload = setTimeout(() => J.ctx.reload(), 6100);
        return;
      }
      // The advance target wakes NOW, not after the resync: funneling it
      // through pendingNext lets setFocus promote a still-planned bead to
      // its waking material before the camera arrives — it appears
      // activated small and enlarges on focus (per the ceremony spec). The
      // linear map makes the optimism safe; the resync confirms it.
      J.pendingNext = J.pendingNext ?? Math.min(J.nodes.length - 1, i + 1);
      setFocus(J.pendingNext);
      // ALWAYS resync after a weave: the authorize changed server state even
      // when no already-known step wakes — the step this one just unlocked
      // only exists server-side. (Sequential unlocks otherwise paint stale
      // "Locked" until a manual reload.)
      clearTimeout(J.timers.reload);
      J.timers.reload = setTimeout(() => J.ctx.reload(), 1300);
    }, 3600);
  }

  /* Damped shake of every woven thread, bell-centered on the join. The
   * beads ride their strings (joining bead full amplitude, braid ×.45),
   * then hand back to the .7s settle transition. */
  function shakeBraid(j, originY) {
    const strip = J.strip;
    if (!strip) return;
    const anchor = anchorFor(J.focus);
    const ny = originY ?? NY(j), t0 = performance.now(), dur = 950;
    const ks = [];
    for (let k = 0; k < J.nodes.length; k++) if (J.status[k] === "done") ks.push(k);
    const paths = ks.map((k) => [k, strip.querySelector(`[data-s="${k}"]`)]).filter((e) => e[1]);
    paths.forEach(([, p]) => { p.style.transition = "opacity .7s ease"; });
    const nodes = ks.map((k) => {
      const n = strip.querySelector(`.br-node[data-i="${k}"]`);
      if (!n) return null;
      const nyk = nodeYf(k);
      const nxk = withGrav(baseX(k, nyk), nyk, anchor);
      const bl = Math.exp(-Math.pow((nyk - ny) / 200, 2));
      const sc = k === J.focus ? 1.6 : 1;
      n.style.transition = "none";
      return { k, n, nyk, nxk, bl, sc };
    }).filter(Boolean);
    const setAll = (amp) => {
      paths.forEach(([k, p]) => {
        const a2 = k === j ? amp : amp * 0.45;
        const pts = sampleYs(nodeYf(k)).map((y) => {
          const bell = Math.exp(-Math.pow((y - ny) / 200, 2));
          return [withGrav(baseX(k, y), y, anchor) + a2 * bell, y];
        });
        setD(p, quadPath(pts));
      });
      nodes.forEach((o) => {
        const a2 = o.k === j ? amp : amp * 0.45;
        o.n.style.transform = `translate(${(o.nxk + a2 * o.bl).toFixed(1)}px, ${o.nyk.toFixed(1)}px)${o.sc === 1.6 ? " scale(1.6)" : ""}`;
      });
    };
    const step = (now) => {
      if (!J.merge || J.merge.j !== j) return;
      const t = (now - t0) / dur;
      if (t >= 1) {
        setAll(0);
        paths.forEach(([, p]) => { p.style.transition = "d .7s cubic-bezier(.2,.8,.3,1), opacity .7s ease"; });
        nodes.forEach((o) => { o.n.style.transition = "transform .7s cubic-bezier(.2,.8,.3,1), opacity .45s ease"; });
        return;
      }
      setAll(10 * Math.exp(-4.2 * t) * Math.sin(t * 26.4));
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* ══ α / Ω — the overture and the closing ceremony ════════ */

  function alphaOpen() {
    J.ov = true;
    J.ovWake = false;
    const a = J.strip && J.strip.querySelector(".br-alpha");
    if (!a) return;
    a.hidden = false;
    a.style.opacity = "1";
    const dl = { lead: 0.3, what: 1.3, seven: 2.3, begin: 3.4 };
    a.querySelectorAll("[data-ao]").forEach((el) => {
      el.style.animation = "none";
      void el.offsetWidth;
      el.style.animation = `floatIn 1.1s ${dl[el.dataset.ao] || 0.3}s both`;
    });
    clearTimeout(J.timers.aoWake);
    J.timers.aoWake = setTimeout(aoWake, 5200);
    layout();
  }

  function aoWake() {
    if (!J.ov || J.ovDone || J.ovWake || J.sess) return;
    J.ovWake = true;
    J.ovPend = true; // next layout blooms the plaque/nimbus in on 1.9s
    J.slowUntil = Date.now() + 1900;
    layout();
  }

  function aoBegin(e) {
    if (e) e.stopPropagation();
    if (J.sess || J.ovDone) return;
    const first = !J.ovWake;
    J.ovWake = true;
    if (first) J.ovPend = true;
    J.slowUntil = Date.now() + 1900;
    if (J.focus !== 0) setFocus(0);
    else layout();
    // The acknowledging pulse lives on the canvas with the rest of the
    // waking sphere's material (one-shot; the draw eases it over 700ms).
    J.pulseT = performance.now();
  }

  /* The overture leaves on the first authorize and never returns. */
  function aoDismiss() {
    if (J.ovDone) return;
    J.ovDone = true;
    J.ov = false;
    clearTimeout(J.timers.aoWake);
    const a = J.strip && J.strip.querySelector(".br-alpha");
    if (a) {
      a.style.opacity = "0";
      setTimeout(() => { a.hidden = true; }, 1500);
    }
    J.ctx?.setFlag?.("overture_done");
  }

  /* Terminal camera + the pour styling — idempotent, called by layout()
   * whenever J.omega is set so resyncs can't fight the ceremony. */
  function omegaLayout(panning) {
    const strip = J.strip;
    if (!strip) return;
    strip.style.transition = panning
      ? "transform .18s ease-out" // hand-on-the-wheel, not a ceremony
      : J.omega === "descend"
        ? "transform 2.6s cubic-bezier(.3,.7,.15,1)"
        : "transform 1.05s cubic-bezier(.32,.72,.16,1)";
    strip.style.transform = `translate(0px, ${(-1330 - (J.omPan || 0)).toFixed(0)}px)`;
    strip.querySelectorAll("path[data-s]").forEach((p) => {
      p.style.transition = "opacity 2.2s ease";
      p.style.opacity = ".5";
      p.setAttribute("stroke-width", "1.5");
    });
  }

  /* The reading: the identity statement, verbatim, then Export. */
  function omegaReading() {
    const rd = J.strip && J.strip.querySelector(".br-omread");
    if (!rd) return;
    const t = J.ctx.t;
    const idn = J.nodes.find((n) => n.id === "identity_statement");
    const lp = J.nodes.find((n) => n.id === "life_portrait");
    const text = idn?.distilled?.[0]?.text || lp?.distilled?.[0]?.text || "";
    rd.querySelector(".br-om-whisper").textContent = t("braid_omega_whisper");
    rd.querySelector(".br-om-note").textContent = t("braid_omega_note");
    rd.querySelector(".br-om-reading").textContent = text ? `«${text}»` : "";
    rd.querySelector(".br-om-rest").textContent = t("braid_omega_rest");
    const ex = rd.querySelector(".br-om-export");
    ex.textContent = t("braid_omega_export");
    if (!ex.__bound) {
      ex.__bound = true;
      ex.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (ex.__busy) return;
        ex.__busy = 1;
        ex.textContent = J.ctx.t("braid_omega_exporting");
        try { await J.ctx.exportPdf(); } catch { /* canceled */ }
        ex.textContent = J.ctx.t("braid_omega_export");
        ex.__busy = 0;
      });
    }
    rd.hidden = false; // re-display restarts the staggered floatIns
  }

  /* Fifteenth authorization: descent → pour → reading → rest. */
  function omegaCeremony() {
    const last = J.nodes.length - 1;
    J.omega = "descend";
    J.omPan = 0;
    J.focus = last;
    if (J.stage) J.stage.dataset.omg = "1";
    omegaLayout();
    clearTimeout(J.timers.omT1);
    clearTimeout(J.timers.omT2);
    clearTimeout(J.timers.omT3);
    J.timers.omT1 = setTimeout(() => {
      J.omega = "pour";
      J.merge = { j: last, phase: "omega" }; // lets the rope shake run
      shakeBraid(last, 1650);
      const stage = J.stage;
      if (stage) {
        stage.style.transition = "filter .6s ease";
        J.flashOn = true;
        stage.style.filter = "saturate(1.9) contrast(1.08) brightness(1.16)";
        clearTimeout(J.timers.flash);
        J.timers.flash = setTimeout(() => {
          stage.style.transition = "filter 2.6s ease";
          J.flashOn = false;
          stage.style.filter = "none";
        }, 950);
      }
    }, 2750);
    J.timers.omT2 = setTimeout(() => {
      J.merge = null;
      omegaReading();
    }, 4400);
    J.timers.omT3 = setTimeout(() => {
      J.omega = "rest";
      J.omDone = true;
      J.ctx?.setFlag?.("omega_done");
    }, 5700);
  }

  /* The terminal state is permanent and re-enterable — from the last bead,
   * one more scroll down descends again; up (or Esc) returns to the field. */
  function omegaEnter() {
    if (J.omega || !J.omDone) return;
    J.omega = "rest";
    J.omPan = 0;
    if (J.stage) J.stage.dataset.omg = "1";
    omegaReading();
    omegaLayout();
  }

  function omegaExit() {
    if (!J.omega) return;
    J.omega = null;
    J.omPan = 0;
    if (J.stage) delete J.stage.dataset.omg;
    const rd = J.strip && J.strip.querySelector(".br-omread");
    if (rd) rd.hidden = true;
    layout();
  }

  /* ── entry: render (or refresh) the journey home ────────── */

  function renderJourney(root, ctx) {
    J.ctx = ctx;
    J.nodes = ctx.journey.nodes;
    const rebuild = !J.frame || !J.frame.isConnected || J.frame.parentElement !== root
      || J.strip.querySelectorAll(".br-node").length !== J.nodes.length;
    if (!J.merge && !J.sess) {
      const fresh = mapStatuses();
      const changed = fresh.join() !== J.status.join();
      J.status = fresh;
      J._syncs = (J._syncs || 0) + 1;
      if (rebuild || changed) J.focus = Math.max(0, Math.min(J.nodes.length - 1, defaultFocus()));
    } else J._syncSkips = (J._syncSkips || 0) + 1;
    if (rebuild) {
      build(root);
      updateTexts();
      layout(true);
      requestAnimationFrame(() => layout());
    } else {
      updateTexts();
      layout();
    }
    updateHeader();
    startTick();
    // α/Ω boot: a virgin journey opens on the overture (once, ever); a
    // completed one remembers the ceremony already played.
    const flags = ctx.journey.flags ?? {};
    J.omDone = Boolean(flags.omega_done);
    if (!flags.overture_done && ctx.journey.authorized === 0 && !J.ovDone && !J.ov) alphaOpen();
    else if (J.ov && ctx.journey.authorized > 0) aoDismiss(); // authorized elsewhere
    if (rebuild && J.omega) omegaLayout(); // a rebuild mid-rest re-applies the terminal camera
  }

  /* ══ inline session: the talk happens beside the node ═════ */

  const L = {
    open: false, closing: false, gen: 0, ctx: null, node: null, idx: -1,
    knots: [], knotN: 0, review: null, editing: false,
    composerMode: "answer", chatless: false, timers: [],
    placeholder: "", tWhat: "", tCompiled: "",
    reviewing: false, firstReview: false,
  };

  const q7 = (cls) => (J.stage ? J.stage.querySelector(cls) : null);

  /* Scrolling to the bottom ONCE lands short: the bubble arrives mid
   * fade-in (translated down), and a web font landing late reflows it taller.
   * Pin again across those settling frames — a message the client can read
   * without touching the wheel is the whole point. */
  function pinBottom(box) {
    box.scrollTop = box.scrollHeight;
    requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; });
    for (const ms of [120, 320, 620]) setTimeout(() => { box.scrollTop = box.scrollHeight; }, ms);
    document.fonts?.ready?.then(() => { box.scrollTop = box.scrollHeight; }).catch(() => {});
  }

  function inlineMsg(kind, text, html) {
    const box = q7(".br7-msgs");
    if (!box) return null;
    const d = document.createElement("div");
    d.className = `br7-${kind}`;
    if (html !== undefined) d.innerHTML = html;
    else d.textContent = text;
    box.appendChild(d);
    pinBottom(box);
    return d;
  }

  /* One sizing rule for every way text can land in the field: typing,
   * dictation (which dispatches `input`), and draft restore. Grows to 40% of
   * the stage, then the field scrolls internally. */
  function autosize(inp) {
    inp = inp || q7(".br7-input");
    if (!inp) return;
    const cap = Math.round(((J.stage && J.stage.clientHeight) || 640) * 0.4);
    inp.style.height = "38px";
    const h = Math.min(cap, Math.max(38, inp.scrollHeight));
    inp.style.height = h + "px";
    // The transcript floor rides up with the growing field — the two must
    // never superimpose on the transparent stage.
    if (J.stage) J.stage.style.setProperty("--br7-grow", (h - 38) + "px");
  }

  /** Unsent words currently in the composer (empty string when none). */
  function composerText() {
    const inp = q7(".br7-input");
    return inp ? inp.value.trim() : "";
  }

  /* A half-written answer outlives the session it was typed in: leaving (by
   * any route, including a crash) must never cost the client their words. */
  const draftKey = (id) => `cc_draft_${id}`;
  function saveDraft(text) {
    if (!L.node) return;
    try {
      if (text) localStorage.setItem(draftKey(L.node.id), text);
      else localStorage.removeItem(draftKey(L.node.id));
    } catch { /* private mode — the in-memory draft still serves */ }
  }
  function loadDraft(id) {
    try { return localStorage.getItem(draftKey(id)) ?? ""; } catch { return ""; }
  }

  function inlineCompose(on, placeholder) {
    const inp = q7(".br7-input");
    if (!inp) return;
    inp.disabled = !on;
    inp.style.opacity = on ? "1" : ".35";
    if (placeholder) { inp.placeholder = placeholder; L.placeholder = placeholder; }
    // The quiet skip affordance lives with the composer — only on steps the
    // playbook declares declinable (the typed /skip works everywhere).
    const sk = q7(".br7-skip");
    if (sk && L.ctx) {
      sk.textContent = L.ctx.t("braid_skip_step");
      sk.hidden = !(on && L.composerMode !== "amend" && J.nodes[L.idx]?.skippable);
    }
    if (on) {
      if (!inp.value && L.draft) inp.value = L.draft; // restore a draft after re-render
      autosize(inp);
      // Auto-focus once the camera has settled, so the accent caret draws the eye.
      setTimeout(() => { if (L.open) inp.focus({ preventScroll: true }); }, 480);
    }
  }

  /* Knot y follows the reference: first at nodeY+98, then every 46px; the
   * big authorize knot takes the next slot without consuming it. */
  function pushKnot(big) {
    const n = big ? L.knotN + 1 : ++L.knotN;
    L.knots.push([NY(L.idx) + 52 + n * 46, big]);
  }

  function inlineConnLost() {
    inlineCompose(false);
    inlineMsg("note", L.ctx.t("conn_closed"));
  }

  /* Engine process notes (inducing/revising) update one whisper in place
   * instead of stacking — the transcript keeps only the conversation. */
  function inlineStatus(text) {
    const box = q7(".br7-msgs");
    if (!box) return;
    const st = box.querySelector("[data-status]");
    if (st) {
      st.textContent = text;
      box.scrollTop = box.scrollHeight;
    } else {
      const d = inlineMsg("note", text);
      if (d) d.dataset.status = "1";
    }
  }

  function inlineSend() {
    const inp = q7(".br7-input");
    const text = inp && inp.value.trim();
    if (!text || !L.open || L.closing) return;
    const payload = L.composerMode === "amend"
      ? { type: "review_action", action: "feedback", text }
      : { type: "answer", text };
    if (!L.ctx.wsSend(payload)) return inlineConnLost();
    inp.value = "";
    L.draft = "";
    saveDraft(""); // sent — the stored copy has served its purpose
    autosize(inp);
    inlineCompose(false);
    inlineMsg("user", text);
    // An amend note opens a conversation now — the counselor talks the change
    // through and asks for confirmation before anything is revised, so no
    // eager "revising…" whisper; the server sends it when it actually revises.
    if (L.composerMode === "amend") {
      L.composerMode = "answer";
      // The engine stops listening for review actions until the conversation
      // settles — freeze the card's buttons so an Authorize click can't be
      // silently swallowed. The next review payload rebuilds them fresh.
      q7(".br7-msgs")?.querySelector("[data-review]")
        ?.querySelectorAll("button").forEach((b) => { b.disabled = true; });
    } else pushKnot(false);
    showThink(1); // the counselor is reading — cleared by whatever arrives next
  }

  /* The wait loader: three pulsing dots + a rotating phrase in the
   * counselor's spot, and Saturn rings around the current node. Any arriving
   * surface event clears both. `start` picks the opening phrase (1 right
   * after a user message, 0 otherwise). */
  /* The wait ensemble (dots · rotating phrase · Saturn rings) is CANVAS
   * state drawn by the tick: its old CSS animations (brdots, satSpin) and
   * 2s phrase swaps re-armed the macOS cursor race exactly when users park
   * the cursor — mid-wait (cursor-war rule). */
  function showThink(start = 0) {
    const box = q7(".br7-msgs");
    if (box && !box.querySelector("[data-think]")) {
      const d = document.createElement("div");
      d.className = "br7-think";
      d.dataset.think = "1";
      d.innerHTML = `<canvas data-thinkcv width="${340 * DPR}" height="${26 * DPR}" style="width:340px;height:26px"></canvas>`;
      box.appendChild(d);
      box.scrollTop = box.scrollHeight;
    }
    // Re-entry keeps the running clock — a work note must not reset rotation.
    if (!J.think) J.think = { t0: performance.now(), i: start };
    satOn();
  }
  function clearThink() {
    J.think = null;
    const el = q7(".br7-msgs")?.querySelector("[data-think]");
    if (el) el.remove();
    satOff();
  }

  /* Saturn rings — three tilted orbits around the waiting node, canvas-drawn
   * around the focused sphere (fade .7s in/out, spin phases as the old CSS). */
  function satOn() {
    if (!J.sat || J.sat.offT) J.sat = { onT: performance.now(), offT: 0 };
  }
  function satOff() {
    if (J.sat && !J.sat.offT) J.sat.offT = performance.now();
  }

  /* Canvas text measured before its webfont lands wraps against fallback
   * metrics — and a cached wrap would keep those wrong line breaks forever
   * (first run on a cold font cache, i.e. every new Windows install). Bump
   * the generation when fonts settle so every cache recomputes once. */
  let fontGen = 0;
  document.fonts?.ready?.then(() => { fontGen++; }).catch(() => {});

  /* Greedy word-wrap against the current ctx font; cached by the caller. */
  function wrapLines(g, text, maxW) {
    const words = String(text || "").split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";
    for (const w of words) {
      const probe = line ? line + " " + w : w;
      if (line && g.measureText(probe).width > maxW) { lines.push(line); line = w; }
      else line = probe;
    }
    if (line) lines.push(line);
    return lines;
  }

  /* Text with the plaque's double halo (canvas shadows take one pass each). */
  function haloText(g, text, x, y, fill, sh, blurA, blurB) {
    g.shadowColor = sh;
    g.fillStyle = fill;
    g.shadowBlur = blurA; g.shadowOffsetY = 0; g.fillText(text, x, y);
    g.shadowBlur = blurB; g.shadowOffsetY = 1; g.fillText(text, x, y);
    g.shadowBlur = 0; g.shadowOffsetY = 0;
  }

  /* The waking plaque — name, time, caption — painted riding the sway with
   * the old soft-follow (.14 lerp), honoring the α withhold and bloom. */
  /* The waking node's words, painted because that node oscillates and no DOM
   * transition may run beside a cursor. Same two stations as every other
   * node's name (nameStation), interpolated here by hand: the name grows out
   * of the sphere or is drawn back into it, and the caption simply arrives
   * with it. Nothing travels across the field. */
  function drawWake(lg, ts, cx, ny, dim) {
    const w = J.wake;
    if (!w || !lg) return;
    if (J.ov && !J.ovWake) return; // α withhold — the copy owns the field
    const p = J.paint || {};
    const bloom = (J.glowT ? Math.max(0, Math.min(1, (ts - J.glowT) / 1900)) : 1) * dim;
    if (bloom <= 0.01) return;
    const q = J.nameP;                       // 0 = tucked aside, 1 = risen
    const right = !w.flip ? false : true;    // flip → the name sits to the right
    const r = 25; // the waking sphere
    const s0 = nameStation(false, right, r), s1 = nameStation(true, right, r);
    const mix = (a, b) => a + (b - a) * q;
    const scale = mix(s0.scale, s1.scale);
    const dx = mix(s0.dx, s1.dx);
    const dy = mix(s0.dy, s1.dy);
    lg.save();
    // Line breaks are scale-invariant: the box and the type grow together.
    lg.font = "600 13.5px Lora, serif";
    if (!w._t || w._g !== fontGen) { w._t = wrapLines(lg, w.title, 300); w._g = fontGen; }
    const size = 13.5 * scale, lineH = 1.18 * size;
    const centreY = ny + dy + (w._t.length * 1.18 * 13.5) / 2;
    const top = centreY - (w._t.length * lineH) / 2;
    lg.font = `600 ${size.toFixed(2)}px Lora, serif`;
    lg.textAlign = right ? "left" : "right";
    lg.textBaseline = "middle";
    const tX = right ? cx + dx : cx + dx + 300;
    const ink = pcss(plerp(p.lab2, p.ink2, q), mix(0.6, 1) * dim);
    const halo = pcss(plerp(p.ts3, p.ts1, q), bloom);
    w._t.forEach((ln, i) => {
      haloText(lg, ln, tX, top + lineH * (i + 0.5), ink, halo, mix(3, 24), mix(2, 12));
    });
    // Time and caption belong to the risen state — they arrive with it.
    const a = bloom * q;
    if (a > 0.01 && w.time) {
      lg.font = "600 11px Karla, Manrope, sans-serif";
      lg.letterSpacing = "1px";
      lg.textAlign = right ? "right" : "left";
      lg.textBaseline = "alphabetic";
      lg.fillStyle = pcss(p.lab3, 0.9 * a);
      lg.fillText(w.time.toUpperCase(), right ? cx - 34 : cx + 34, ny - 38);
      lg.letterSpacing = "0px";
    }
    if (a > 0.01 && w.line) {
      lg.font = "400 13.5px Lora, serif";
      if (!w._l || w._lg !== fontGen) { w._l = wrapLines(lg, w.line, 260); w._lg = fontGen; }
      lg.textAlign = "left";
      lg.textBaseline = "alphabetic";
      w._l.forEach((ln, i) => {
        haloText(lg, ln, cx + 20, ny + 59 + i * 21.6, pcss(p.body, a), pcss(p.ts2, a), 18, 6);
      });
    }
    lg.restore();
  }

  /* Per-frame paint of the wait ensemble: rings on the strip canvas centered
   * on the LIVE sphere position, dots and the rotating phrase on the loader's
   * inline canvas in the chat. */
  function drawWait(lg, ts, px, py) {
    if (J.sat && lg && !REDUCED) {
      let a = Math.min(1, ((J.sat.offT || ts) - J.sat.onT) / 700);
      if (J.sat.offT) a *= Math.max(0, 1 - (ts - J.sat.offT) / 700);
      if (J.sat.offT && a <= 0) J.sat = null;
      else {
        const p = J.paint || {}, sc = 1.6, tilt = -14 * Math.PI / 180, squish = Math.cos(76 * Math.PI / 180);
        lg.save();
        lg.translate(px, py);
        lg.rotate(tilt);
        lg.globalAlpha = a;
        const ring = (r, alpha, width, dash, phase) => {
          lg.strokeStyle = pcss(p.acc, alpha);
          lg.lineWidth = width;
          lg.setLineDash(dash);
          lg.lineDashOffset = phase;
          lg.beginPath(); lg.ellipse(0, 0, r * sc, r * sc * squish, 0, 0, 7); lg.stroke();
        };
        ring(33, 0.55, 1.3, [4, 4], (ts / 4200) * 33 * sc * 6.283);
        ring(44, 0.3, 1.3, [4, 4], -(ts / 7500) * 44 * sc * 6.283);
        ring(38, 0.15, 1, [], 0);
        lg.setLineDash([]);
        const mth = (ts / 2700) * 6.283;
        const mx = Math.cos(mth) * 38 * sc, my = Math.sin(mth) * 38 * sc * squish;
        lg.shadowBlur = 9; lg.shadowColor = pcss(p.acc, 1);
        lg.fillStyle = "#fff";
        lg.beginPath(); lg.arc(mx, my, 2, 0, 7); lg.fill();
        lg.shadowBlur = 0;
        lg.restore();
        lg.globalAlpha = 1;
      }
    } else if (J.sat && J.sat.offT) J.sat = null;
    const cv = J.frame && J.frame.querySelector("[data-thinkcv]");
    if (cv && J.think && cv.getContext) {
      const g = cv.__g || (cv.__g = cv.getContext("2d"));
      const p = J.paint || {};
      g.setTransform(DPR, 0, 0, DPR, 0, 0);
      g.clearRect(0, 0, 340, 26);
      for (let k = 0; k < 3; k++) {
        const ph = REDUCED ? 0.4 : (((ts / 1200) - k * 0.15) % 1 + 1) % 1;
        const lift = ph < 0.4 ? ph / 0.4 : ph < 0.8 ? 1 - (ph - 0.4) / 0.4 : 0;
        g.fillStyle = pcss(p.cnt, 0.25 + 0.75 * lift);
        g.beginPath(); g.arc(6 + k * 10, 15 - 3.5 * lift, 2.5, 0, 7); g.fill();
      }
      // Pool re-read every frame so a mid-wait language switch takes.
      const pool = J.ctx.t("braid_think_pool");
      const slot = (ts - J.think.t0) / 2000;
      const idx = ((J.think.i + Math.floor(Math.max(0, slot))) % pool.length + pool.length) % pool.length;
      const f = ((slot % 1) + 1) % 1;
      const fade = REDUCED ? 1 : f < 0.15 ? f / 0.15 : f > 0.85 ? (1 - f) / 0.15 : 1;
      g.font = "italic 500 13.5px Lora, serif";
      g.fillStyle = pcss(p.note, fade);
      g.fillText(pool[idx], 34, 19 - (REDUCED ? 0 : (1 - fade) * (f < 0.5 ? -2 : 2)));
    }
  }

  function toggleInlineTransparency() {
    const tp = q7(".br7-tpanel");
    if (!tp) return;
    if (tp.hidden) {
      tp.querySelector(".t5-twhat").textContent = L.tWhat;
      tp.querySelector(".t5-tmono").innerHTML = L.tCompiled;
    }
    tp.hidden = !tp.hidden;
  }

  /* The accent-left-ruled review passage — full parity with the modal
   * (alternates, edit wording, amend, reprocess), quiet plain-text actions. */
  function buildInlineReview() {
    const { payload, currentText, edited } = L.review;
    const ctx = L.ctx, t = ctx.t;
    const box = q7(".br7-msgs");
    if (!box) return;
    const old = box.querySelector("[data-review]");
    if (old) old.remove();
    const st = box.querySelector("[data-status]");
    if (st) st.remove(); // the arriving draft supersedes the process whisper

    const candidates = payload.mode === "candidates";
    const others = candidates ? payload.candidates.filter((c) => c !== currentText) : [];
    const verifiedN = candidates ? quotesIn(currentText, payload.verified_quotes) : payload.verified_quotes.length;

    const parts = [];
    if (L.editing) {
      parts.push(`<div class="br7-edit"><textarea data-edit>${ctx.esc(currentText)}</textarea></div>`);
    } else if (candidates) {
      parts.push(`<div class="br7-review-body">${edited ? ctx.esc(currentText) : ctx.markVerbatim(currentText, payload.verified_quotes)}</div>`);
    } else {
      parts.push(`<div class="br7-review-body">${ctx.renderFields(payload.draft, payload.verified_quotes, payload.warnings ?? [])}</div>`);
    }
    if (payload.existing && L.node.status === "stale") parts.push(`<div class="br7-stale">${ctx.esc(t("stale_note"))}</div>`);
    if (edited) parts.push(`<div class="br7-verify"><span class="tick">✓</span> ${ctx.esc(t("edited_by_you"))}</div>`);
    else if (verifiedN > 0) parts.push(`<div class="br7-verify"><span class="tick">✓</span> ${ctx.esc(t("verified", verifiedN))} · ${ctx.esc(t("braid_verbatim_note"))}</div>`);
    if (!L.editing && candidates && !edited && others.length) {
      parts.push(`<div class="br7-alts"><div class="br7-alts-label">${ctx.esc(t("alt_label"))}</div>${others
        .map((c, i) => `<button class="br7-alt" data-alt="${i}">${ctx.markVerbatim(c, payload.verified_quotes)}</button>`)
        .join("")}</div>`);
    }
    const acts = [];
    if (candidates) acts.push(`<button class="br7-act" data-edit-btn>${ctx.esc(L.editing ? t("cancel_edit") : t("edit_wording"))}</button>`);
    if (L.editing) acts.push(`<button class="br7-act accent" data-save>${ctx.esc(t("save_wording"))}</button>`);
    else {
      acts.push(`<button class="br7-act" data-amend>${ctx.esc(t("braid_amend"))}</button>`);
      if (payload.existing) {
        acts.push(`<button class="br7-act" data-reprocess>${ctx.esc(L.node.kind === "derived" ? t("reprocess") : t("reprocess_conversation"))}</button>`);
      }
      acts.push(`<button class="br7-act accent" data-auth>${ctx.esc(t("braid_authorize"))}</button>`);
    }
    parts.push(`<div class="br7-acts">${acts.join("")}</div>`);
    if (payload.authorize_language) parts.push(`<div class="br7-authlang">${ctx.esc(payload.authorize_language)}</div>`);

    const wrap = document.createElement("div");
    wrap.className = "br7-say";
    wrap.dataset.review = "1";
    wrap.style.maxWidth = "400px";
    wrap.innerHTML = `<div class="br7-review">${parts.join("")}</div>`;
    box.appendChild(wrap);
    box.scrollTop = box.scrollHeight;

    wrap.querySelectorAll("[data-alt]").forEach((b) =>
      b.addEventListener("click", () => {
        L.review.currentText = others[Number(b.dataset.alt)];
        buildInlineReview();
      }));
    const editBtn = wrap.querySelector("[data-edit-btn]");
    if (editBtn) editBtn.addEventListener("click", () => {
      L.editing = !L.editing;
      buildInlineReview();
    });
    const save = wrap.querySelector("[data-save]");
    if (save) save.addEventListener("click", () => {
      const ta = wrap.querySelector("[data-edit]");
      const text = ta && ta.value.trim();
      if (text) {
        L.review.currentText = text;
        L.review.edited = true;
      }
      L.editing = false;
      buildInlineReview();
    });
    const amend = wrap.querySelector("[data-amend]");
    if (amend) amend.addEventListener("click", () => {
      const on = L.composerMode !== "amend";
      if (on && !ctx.wsLive()) return inlineConnLost();
      L.composerMode = on ? "amend" : "answer";
      amend.classList.toggle("active", on);
      inlineCompose(on, t("amend_placeholder"));
    });
    const reprocess = wrap.querySelector("[data-reprocess]");
    if (reprocess) reprocess.addEventListener("click", () => {
      if (!ctx.wsSend({ type: "review_action", action: "reprocess" })) return inlineConnLost();
      inlineMsg("note", t("status_revising"));
      wrap.querySelectorAll("button").forEach((b) => { b.disabled = true; });
    });
    const auth = wrap.querySelector("[data-auth]");
    if (auth) auth.addEventListener("click", () => {
      const m = { type: "review_action", action: "authorize" };
      if (candidates) m.value = L.review.currentText;
      if (!ctx.wsSend(m)) return inlineConnLost();
      wrap.querySelectorAll("button").forEach((b) => { b.disabled = true; });
    });
  }

  /* Review-in-place: the woven bead reads its authored story back — a quiet
   * "authored" whisper, the serif passage, its verbatim fragments returned to
   * the right, and plain-text Amend / Continue. No card, no composer. */
  /* The "Authored · woven in" whisper unfolds the recorded interview inline —
   * the same say/user bubbles as live chat, in a dash-bordered section above
   * the authored story — and folds it back on a second tap. */
  function toggleHist(e) {
    const note = e.currentTarget;
    const ctx = L.ctx;
    const label = ctx.esc(ctx.t("braid_authored_whisper"));
    const ex = note.parentElement?.querySelector("[data-hist]");
    if (ex) {
      ex.remove();
      note.innerHTML = `${label}  ▸`;
      return;
    }
    const w = document.createElement("div");
    w.dataset.hist = "1";
    w.className = "br7-hist";
    // The full session log, amends included — each amend conversation gets
    // its own caps-whisper divider.
    let inAmend = false;
    for (const turn of L.record ?? []) {
      if (turn.phase === "amend" && !inAmend) {
        const n = document.createElement("div");
        n.className = "br7-note";
        n.style.animation = "none";
        n.textContent = ctx.t("braid_amend_divider");
        w.appendChild(n);
      }
      inAmend = turn.phase === "amend";
      const d = document.createElement("div");
      d.className = turn.speaker === "user" ? "br7-user" : "br7-say";
      d.style.animation = "none";
      d.textContent = turn.text;
      w.appendChild(d);
    }
    note.after(w);
    note.innerHTML = `${label}  ▾`;
    const box = q7(".br7-msgs");
    if (box) box.scrollTop = note.offsetTop - 12;
  }

  function buildInlinePassage(payload) {
    const ctx = L.ctx, t = ctx.t;
    const box = q7(".br7-msgs");
    if (!box) return;
    const old = box.querySelector("[data-review]");
    if (old) old.remove();
    const status = box.querySelector("[data-status]");
    if (status) status.remove();

    // A display:contents wrapper keeps one removable [data-review] element
    // while its parts still lay out as siblings in the message column.
    const wrap = document.createElement("div");
    wrap.dataset.review = "1";
    wrap.style.display = "contents";

    const candidates = payload.mode === "candidates";
    const quotes = payload.verified_quotes ?? [];
    const story = candidates
      ? ctx.markVerbatim(payload.candidates[0] ?? "", quotes)
      : ctx.renderFields(payload.draft, quotes, payload.warnings ?? []);
    const frags = quotes.length
      ? `<div class="br7-fragments">${quotes
        .map((qt) => `<div class="br7-fragment">«<span>${ctx.esc(qt)}</span>»</div>`)
        .join("")}</div>`
      : "";
    // With a recorded interview behind the artifact, the whisper becomes a
    // toggle that unfolds the original conversation above the story.
    const hasRecord = Boolean(L.record?.length);
    wrap.innerHTML =
      `<div class="br7-note${hasRecord ? " br7-hist-toggle" : ""}" data-whisper>${ctx.esc(t("braid_authored_whisper"))}${hasRecord ? "  ▸" : ""}</div>` +
      `<div class="br7-story">${story}</div>` +
      frags +
      `<div class="br7-acts"><button class="br7-act" data-amend>${ctx.esc(t("braid_amend"))}</button>` +
      `<button class="br7-act accent" data-continue>${ctx.esc(t("braid_continue"))}</button></div>`;
    box.appendChild(wrap);
    box.scrollTop = box.scrollHeight;
    if (hasRecord) {
      wrap.querySelector("[data-whisper]").addEventListener("click", toggleHist);
    }

    wrap.querySelector("[data-amend]").addEventListener("click", () => {
      if (!ctx.wsLive()) return inlineConnLost();
      const comp = q7(".br7-comp");
      if (comp) comp.style.display = ""; // reveal the composer Amend reopens
      L.composerMode = "amend";
      wrap.querySelector("[data-amend]").classList.add("active");
      inlineCompose(true, t("amend_placeholder"));
    });
    wrap.querySelector("[data-continue]").addEventListener("click", () => {
      ctx.closeWs();
      inlineClose();
      // Statuses are unchanged, so no reload — just move focus to the step
      // that is actually next.
      const cur = ctx.currentNodeId();
      const k = J.nodes.findIndex((n) => n.id === cur);
      if (k >= 0) setFocus(k);
    });
  }

  /* Authorized: seal, whisper, end-knot, then the camera returns and the
   * journey's weaving ceremony takes over. */
  function inlineSeal() {
    L.closing = true;
    const ctx = L.ctx, idx = L.idx, wasWoven = L.reviewing;
    const wrap = q7(".br7-msgs")?.querySelector("[data-review]");
    const acts = wrap?.querySelector(".br7-acts");
    if (acts) acts.remove();
    inlineMsg("woven", ctx.t("braid_woven_in"));
    pushKnot(true);
    L.timers.push(setTimeout(() => {
      ctx.closeWs();
      inlineClose();
      // An amended re-authorization of an already-woven bead just closes; only
      // a first authorization runs the weaving ceremony (into a quiet field —
      // not a ceremony already running or a session reopened meanwhile).
      if (!wasWoven) setTimeout(() => {
        if (!J.merge && !J.sess && !L.open && J.stage && J.stage.isConnected) startWeave(idx);
      }, 350);
    }, 1400));
  }

  const inlineSurface = {
    say(text, anchor) {
      clearThink();
      if (anchor) inlineMsg("note", L.ctx.t("anchor_label"));
      inlineMsg("say", text);
    },
    note(text) {
      const localized = L.ctx.localizeNote(text);
      // Process notes during induction or revision collapse onto one line;
      // conversation notes (topics) stay part of the transcript.
      if (L.review || L.chatless) inlineStatus(localized);
      else inlineMsg("note", localized);
      // Model-work notes (solidifying, inducing, revising) carry a wait
      // behind them — keep or start the loader, rings included, without
      // resetting a rotation already underway. Words (say/review) clear it.
      if (L.review || L.chatless || /^\((inducing|revising|the conversation is complete)/.test(text)) showThink();
    },
    error(text) { clearThink(); inlineMsg("error", text); },
    ask(prompt) {
      clearThink();
      L.composerMode = "answer";
      const t = L.ctx.t;
      const ph = prompt && prompt.includes("esume") ? t("placeholder_resume")
        : prompt && prompt !== "you" ? prompt : t("placeholder");
      inlineCompose(true, ph);
    },
    review(payload) {
      clearThink();
      // A woven bead's own authored record reads back as the passage —
      // including a re-present after a withdrawn amend (existing stays true
      // until a real revision). Only an actual re-draft (existing false)
      // falls through to the editable card for re-authorization.
      if (L.reviewing && payload.existing) {
        L.firstReview = false;
        buildInlinePassage(payload);
        return;
      }
      L.firstReview = false;
      L.review = { payload, currentText: payload.candidates[0] ?? "", edited: false };
      L.editing = false;
      L.composerMode = "answer";
      inlineCompose(false);
      buildInlineReview();
    },
    done(outcome) {
      if (outcome === "authorized") inlineSeal();
      else inlineMsg("note", L.ctx.t("session_saved", outcome));
    },
    closed() {
      if (!L.open || L.closing) return;
      clearThink(); // a drop mid-LLM-turn must not leave the dots pulsing
      inlineCompose(false);
      inlineMsg("note", L.ctx.t("conn_closed"));
    },
  };

  async function inlineOpen(j) {
    if (L.open || S.open || !J.stage) return;
    const ctx = J.ctx;
    const node = J.nodes[j];
    if (!node) return;
    // A woven bead opens to review-in-place, not the interview.
    const reviewing = ctx.isSettled(node.status) || J.status[j] === "done";
    const my = ++L.gen;
    L.open = true;
    L.closing = false;
    L.ctx = ctx;
    L.node = node;
    L.idx = j;
    L.knots = [];
    L.knotN = 0;
    L.review = null;
    L.editing = false;
    L.composerMode = "answer";
    L.chatless = node.kind === "derived";
    L.reviewing = reviewing;
    L.firstReview = reviewing;
    L.draft = loadDraft(node.id); // words typed before an earlier exit come back
    L.record = null;
    L.tWhat = "";
    L.tCompiled = "";

    // Camera + recession: [data-sess] drives the CSS fades; the focused
    // thread/node carry [data-cur] and stay lit.
    J.sess = true;
    J.focus = j;
    J.stage.dataset.sess = "1";
    J.frame.dataset.sess = "1";
    const pth = J.strip.querySelector(`[data-s="${j}"]`);
    if (pth) pth.dataset.cur = "1";
    const nd = J.strip.querySelector(`.br-node[data-i="${j}"]`);
    if (nd) nd.dataset.cur = "1";
    // The session's own node keeps its name (the rest of the field's names
    // recede) — it is the only thing left naming the step you are inside.
    const lb = J.strip.querySelector(`.br-label[data-i="${j}"]`);
    if (lb) lb.dataset.cur = "1";
    const svg = J.strip.querySelector("svg");
    if (svg && !svg.querySelector("[data-knots]")) {
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.setAttribute("data-knots", "");
      svg.appendChild(g);
    }
    J.sx = Math.max(-420, Math.min(100, 250 - anchorFor(j).nx));
    layout();

    const chat = q7(".br7-chat"), comp = q7(".br7-comp");
    [chat, comp].forEach((el) => {
      if (el) { el.style.opacity = "1"; el.style.pointerEvents = "auto"; }
    });
    // Woven beads review without a composer until Amend reopens it.
    if (comp) comp.style.display = reviewing ? "none" : "";
    const box = q7(".br7-msgs");
    if (box) box.innerHTML = "";
    const mic = q7(".br7-mic");
    if (mic) mic.hidden = !ctx.voice?.enabled?.();
    inlineCompose(false, ctx.t("placeholder"));
    if (L.chatless && !reviewing) inlineStatus(ctx.localizeNote(ctx.t("status_preparing")));

    fetch(`/api/playbook/${node.id}?lang=${ctx.lang}`)
      .then((r) => r.json())
      .then((pb) => {
        if (!L.open || L.gen !== my) return;
        L.tWhat = (ctx.lang !== "en" ? `${ctx.t("playbook_lang_note")}\n\n` : "") + pb.purpose;
        L.tCompiled = ctx.compiledHtml(pb.compiled);
        const tp = q7(".br7-tpanel");
        if (tp && !tp.hidden) { // panel already open — fill it in place
          tp.querySelector(".t5-twhat").textContent = L.tWhat;
          tp.querySelector(".t5-tmono").innerHTML = L.tCompiled;
        }
      })
      .catch(() => {});

    let resuming = false;
    if (reviewing) {
      // Woven records seed knots only: the saved transcript stays folded and
      // the authored passage stands in for it. Derived nodes have no knots.
      if (node.kind === "conversation") {
        try {
          const res = await fetch(ctx.api(`/api/session/${node.id}`));
          if (!L.open || L.gen !== my) return;
          if (res.ok) {
            const saved = await res.json();
            if (!L.open || L.gen !== my) return;
            L.record = saved.exchange ?? []; // kept for the transcript toggle
            for (const e of L.record) {
              if (e.speaker === "user") pushKnot(false);
            }
            pushKnot(true); // the authored end-knot
          }
        } catch { /* no recording — no knots */ }
      }
    } else if (node.kind === "conversation" && node.status === "in_progress") {
      try {
        const res = await fetch(ctx.api(`/api/session/${node.id}`));
        if (!L.open || L.gen !== my) return;
        if (res.ok) {
          const saved = await res.json();
          if (!L.open || L.gen !== my) return;
          for (const e of saved.exchange ?? []) {
            const d = inlineMsg(e.speaker === "user" ? "user" : "say", e.text);
            if (d) d.style.animation = "none";
            if (e.speaker === "user") pushKnot(false);
          }
          inlineMsg("note", ctx.t("resumed_note"));
          resuming = true;
        }
      } catch { /* no recording — fresh start */ }
    }
    if (!L.open || L.gen !== my) return;

    ctx.connect(node.id, { resuming, review: reviewing, surface: inlineSurface });
  }

  /* Reverse of inlineOpen: restore the field, clear the shell. */
  function inlineClose() {
    if (!L.open) return;
    clearThink(); // stop the loader (and its interval) with the session
    L.gen++;
    L.timers.forEach(clearTimeout);
    L.timers = [];
    L.ctx?.stopDictation?.();
    L.open = false;
    L.closing = false;
    L.review = null;
    J.sess = false;
    J.sx = 0;
    if (J.stage) delete J.stage.dataset.sess;
    if (J.frame) delete J.frame.dataset.sess;
    if (J.strip) {
      J.strip.querySelectorAll("[data-cur]").forEach((el) => { delete el.dataset.cur; });
      const kg = J.strip.querySelector("[data-knots]");
      if (kg) kg.innerHTML = "";
    }
    L.knots = [];
    L.knotN = 0;
    L.reviewing = false;
    L.firstReview = false;
    const chat = q7(".br7-chat"), comp = q7(".br7-comp"), tp = q7(".br7-tpanel");
    [chat, comp].forEach((el) => {
      if (el) { el.style.opacity = "0"; el.style.pointerEvents = "none"; }
    });
    if (comp) comp.style.display = ""; // restore the composer for the next session
    if (tp) tp.hidden = true;
    const box = q7(".br7-msgs");
    if (box) box.innerHTML = "";
    if (J.stage && J.stage.isConnected) layout();
  }

  /* A DOM rebuild strands the session without touching the old DOM. */
  function inlineAbort() {
    clearThink(); // the interval must not outlive the stranded session
    L.gen++;
    L.timers.forEach(clearTimeout);
    L.timers = [];
    L.ctx?.closeWs?.();
    L.ctx?.stopDictation?.();
    L.open = false;
    L.closing = false;
    L.review = null;
    L.reviewing = false;
    L.firstReview = false;
    L.knots = [];
    L.knotN = 0;
    J.sess = false;
    J.sx = 0;
  }

  // The braid mic mirrors the app's dictation state (app.js broadcasts it).
  document.addEventListener("cc-voice-state", (e) => {
    if (!L.open) return;
    const mic = q7(".br7-mic");
    if (!mic) return;
    const listening = e.detail === "connecting" || e.detail === "rec";
    mic.classList.toggle("listening", listening);
    mic.classList.toggle("err", e.detail === "error");
    const inp = q7(".br7-input");
    if (inp) inp.placeholder = listening ? L.ctx.t("braid_listening") : (L.placeholder || L.ctx.t("placeholder"));
  });

  // Escape stands in for the retired back buttons: first it dismisses the open
  // transparency panel, otherwise it leaves whichever session surface is live.
  // Inert when the braid is showing the card field (app.js owns Escape there).
  document.addEventListener("keydown", (e) => {
    // Page/Home/End belong to the braid, not the document underneath it.
    // (The css lock already stops the page from scrolling away; this gives
    // the keys something sensible to do instead of nothing.)
    if (["PageUp", "PageDown", "Home", "End"].includes(e.key)
      && J.frame && J.frame.isConnected && !/^(TEXTAREA|INPUT)$/.test(e.target.tagName)) {
      e.preventDefault();
      const box = q7(".br7-msgs");
      if (L.open && box) {
        const step = e.key === "PageUp" ? -box.clientHeight * 0.8
          : e.key === "PageDown" ? box.clientHeight * 0.8
            : e.key === "Home" ? -box.scrollHeight : box.scrollHeight;
        box.scrollTop += step;
      } else if (!J.omega && !J.merge) {
        if (e.key === "PageDown") setFocus(J.focus + 1);
        else if (e.key === "PageUp") setFocus(J.focus - 1);
        else setFocus(e.key === "Home" ? 0 : J.nodes.length - 1);
      }
      return;
    }
    if (e.key !== "Escape") return;
    if (J.omega === "rest") { omegaExit(); return; }
    const tp = q7(".br7-tpanel");
    if (tp && !tp.hidden) { tp.hidden = true; return; }
    if (L.open && !L.closing) {
      const ctx = L.ctx;
      ctx.closeWs();
      inlineClose();
      ctx.reload();
    } else if (S.open && !S.closing) {
      const ctx = S.ctx;
      ctx.closeWs();
      teardown();
      ctx.reload();
    }
  });

  /* ══ session view (t5) ════════════════════════════════════ */

  const S = {
    open: false, closing: false, ctx: null, node: null, idx: 0,
    root: null, els: {}, knots: 0, review: null, editing: false,
    composerMode: "answer", chatless: false, reviewMode: false,
    wasSettled: false, timers: [], gen: 0,
  };

  const el = (cls) => (S.root ? S.root.querySelector(cls) : null);

  function sessionBuild(ctx, node) {
    const t = ctx.t;
    const div = document.createElement("div");
    div.id = "braidSession";
    div.innerHTML = `
      <div class="t5-col">
        <div class="t5-top">
          <button class="t5-back">${ctx.esc(t("exit"))} <span>· ${ctx.esc(t("exit_saved"))}</span></button>
          <span class="t5-step">${ctx.esc(t("braid_step", S.idx + 1, ctx.journey.total))}</span>
        </div>
        <div class="t5-topfade"></div>
        <div class="t5-hero">
          <div class="t5-orb" title="${ctx.esc(t("transparency"))}"></div>
          <div>
            <div class="t5-title">${ctx.esc(ctx.nodeTitle(node))}</div>
            <div class="t5-sub"></div>
          </div>
        </div>
        <div class="t5-tpanel" hidden>
          <div class="t5-tpanel-head">
            <span class="t5-tpanel-kicker">◎ ${ctx.esc(t("transparency"))}</span>
            <button class="t5-tclose">✕</button>
          </div>
          <div class="t5-tlabel">${ctx.esc(t("t_what"))}</div>
          <div class="t5-twhat"></div>
          <div class="t5-tlabel">${ctx.esc(t("t_compiled"))}</div>
          <div class="t5-tmono"></div>
        </div>
        <div class="t5-scroll">
          <div class="t5-flow">
            <svg width="900" height="700" viewBox="0 0 900 700" aria-hidden="true">
              <path data-thread d="" fill="none" stroke="var(--acc)" stroke-width="1.6" stroke-linecap="round" style="opacity:.5"></path>
              <g data-knots></g>
            </svg>
            <div class="t5-msgs"></div>
          </div>
        </div>
        <div class="t5-botfade"></div>
        <div class="t5-composer">
          <input class="t5-input" type="text" autocomplete="off" placeholder="${ctx.esc(t("placeholder"))}" disabled>
          <button class="t5-send" disabled>→</button>
        </div>
      </div>`;
    document.body.appendChild(div);
    S.root = div;

    el(".t5-back").addEventListener("click", () => {
      if (S.closing) return;
      ctx.closeWs();
      teardown();
      ctx.reload();
    });
    el(".t5-orb").addEventListener("click", toggleTransparency);
    el(".t5-tclose").addEventListener("click", toggleTransparency);
    el(".t5-send").addEventListener("click", sendComposer);
    el(".t5-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); sendComposer(); }
    });
    orbInit();
  }

  function teardown() {
    S.timers.forEach(clearTimeout);
    S.timers = [];
    S.ctx?.stopDictation?.(); // a live recording must not outlive its input
    if (S.root) S.root.remove();
    S.root = null;
    S.open = false;
    S.closing = false;
    S.review = null;
  }

  function orbInit() {
    el(".t5-orb").innerHTML =
      '<div data-pig style="position:absolute;inset:11%;border-radius:99px;opacity:0;transition:opacity 1.1s ease;background:radial-gradient(circle, var(--pig, var(--acc)) 0%, color-mix(in srgb, var(--pig, var(--acc)) 76%, #14120c) 58%, color-mix(in srgb, var(--pig, var(--acc)) 30%, transparent) 86%, transparent 100%)"></div>'
      + '<svg width="100%" height="100%" viewBox="-19 -19 38 38" style="position:absolute;inset:0;overflow:visible">' + sphereSVG(16, 0.7, 0.32, "wire") + "</svg>";
  }

  function orbSet(p) {
    const pig = S.root && S.root.querySelector("[data-pig]");
    if (!pig) return;
    const fop = parseFloat(getComputedStyle(pig).getPropertyValue("--t4fop")) || 0.62;
    pig.style.opacity = (Math.max(0, Math.min(1, p)) * fop).toFixed(2);
  }

  /* Interviews have no fixed exchange count — the pigment approaches full
   * asymptotically per tied knot; the arriving draft completes it. */
  const orbProgress = () => 1 - Math.pow(0.82, S.knots);

  function toggleTransparency() {
    const p = el(".t5-tpanel");
    p.hidden = !p.hidden;
    el(".t5-orb").style.filter = p.hidden ? "" : "drop-shadow(0 0 14px color-mix(in srgb, var(--acc) 60%, transparent))";
  }

  function setSub(text) {
    const sub = el(".t5-sub");
    if (sub) sub.textContent = text ?? "";
  }

  function composeEnable(on, placeholder) {
    const inp = el(".t5-input"), btn = el(".t5-send");
    if (!inp) return;
    inp.disabled = !on;
    btn.disabled = !on;
    inp.style.opacity = on ? "1" : ".35";
    btn.style.opacity = on ? "1" : ".25";
    if (on) {
      if (placeholder) inp.placeholder = placeholder;
      inp.focus();
    }
  }

  function msg(kind, text) {
    const box = el(".t5-msgs");
    if (!box) return null;
    const d = document.createElement("div");
    d.className = `t5-${kind}`;
    d.dataset.k = kind;
    d.textContent = text;
    box.appendChild(d);
    layoutThread();
    return d;
  }

  /* The step's thread curves down the left of the transcript; every sent
   * answer ties a knot at its card's center. Recomputed on each append. */
  function layoutThread() {
    const flow = el(".t5-flow"), svg = flow && flow.querySelector("svg"), scroll = el(".t5-scroll");
    if (!flow || !svg) return;
    const H = Math.max(flow.scrollHeight, 700);
    svg.setAttribute("height", String(H));
    svg.setAttribute("viewBox", "0 0 900 " + H);
    const tx = (y) => 196 + 20 * Math.sin(y * 0.0045 + 1.2);
    const pts = [];
    for (let y = 0; y <= H; y += 70) pts.push([tx(y), y]);
    setDAttr(svg.querySelector("[data-thread]"), quadPath(pts));
    const msgs = flow.querySelector(".t5-msgs");
    let knots = "";
    msgs.querySelectorAll('[data-k="user"]').forEach((m) => {
      const y = m.offsetTop + msgs.offsetTop + m.offsetHeight / 2;
      knots += `<circle cx="${tx(y).toFixed(1)}" cy="${y}" r="3.6" fill="var(--acc)"></circle><circle cx="${tx(y).toFixed(1)}" cy="${y}" r="8" fill="none" stroke="var(--acc)" stroke-opacity=".3"></circle>`;
    });
    const wov = msgs.querySelector('[data-k="woven"]');
    if (wov) {
      const y = wov.offsetTop + msgs.offsetTop + wov.offsetHeight / 2;
      knots += `<circle cx="${tx(y).toFixed(1)}" cy="${y}" r="6" fill="var(--acc)"></circle><circle cx="${tx(y).toFixed(1)}" cy="${y}" r="12" fill="none" stroke="var(--acc)" stroke-opacity=".4"></circle>`;
    }
    svg.querySelector("[data-knots]").innerHTML = knots;
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  }

  function setDAttr(p, d) { p.setAttribute("d", d); }

  /** The socket died under an interactive control: say so, don't pretend. */
  function connLost() {
    composeEnable(false);
    if (S.chatless) setSub(S.ctx.t("conn_closed"));
    else msg("note", S.ctx.t("conn_closed"));
  }

  function sendComposer() {
    const inp = el(".t5-input");
    const text = inp && inp.value.trim();
    if (!text) return;
    const payload = S.composerMode === "amend"
      ? { type: "review_action", action: "feedback", text }
      : { type: "answer", text };
    if (!S.ctx.wsSend(payload)) return connLost();
    inp.value = "";
    composeEnable(false);
    msg("user", text);
    if (S.composerMode === "amend") {
      S.composerMode = "answer";
      setSub(S.ctx.t("status_revising"));
    } else {
      S.knots++;
      orbSet(orbProgress());
    }
  }

  /* ── inline review card ─────────────────────────────────── */

  function quotesIn(text, quotes) {
    return quotes.filter((q) => text.includes(q)).length;
  }

  function buildReviewCard() {
    const { payload, currentText, edited } = S.review;
    const ctx = S.ctx, t = ctx.t;
    const box = el(".t5-msgs");
    if (!box) return;
    const old = box.querySelector('[data-k="draft"]');
    if (old) old.remove();

    const card = document.createElement("div");
    card.className = "t5-draft";
    card.dataset.k = "draft";

    const stale = payload.existing && S.node.status === "stale";
    const candidates = payload.mode === "candidates";
    const others = candidates ? payload.candidates.filter((c) => c !== currentText) : [];
    const verifiedN = candidates ? quotesIn(currentText, payload.verified_quotes) : payload.verified_quotes.length;

    const parts = [];
    parts.push(`<div class="t5-draft-kicker">${ctx.esc(payload.existing ? t("chip_authorized") : t("braid_draft_kicker"))}</div>`);
    if (S.editing) {
      parts.push(`<div class="t5-edit-area"><textarea data-edit>${ctx.esc(currentText)}</textarea></div>`);
    } else if (candidates) {
      parts.push(`<div class="t5-draft-body">${edited ? ctx.esc(currentText) : ctx.markVerbatim(currentText, payload.verified_quotes)}</div>`);
    } else {
      parts.push(`<div class="t5-draft-body">${ctx.renderFields(payload.draft, payload.verified_quotes, payload.warnings ?? [])}</div>`);
    }
    if (stale) parts.push(`<div class="t5-stale">${ctx.esc(t("stale_note"))}</div>`);
    if (edited) parts.push(`<div class="t5-verify"><span class="tick">✓</span> ${ctx.esc(t("edited_by_you"))}</div>`);
    else if (verifiedN > 0) parts.push(`<div class="t5-verify"><span class="tick">✓</span> ${ctx.esc(t("verified", verifiedN))} · ${ctx.esc(t("braid_verbatim_note"))}</div>`);
    if (!S.editing && candidates && !edited && others.length) {
      parts.push(`<div class="t5-alts"><div class="t5-alts-label">${ctx.esc(t("alt_label"))}</div>${others
        .map((c, i) => `<button class="t5-alt" data-alt="${i}">${ctx.markVerbatim(c, payload.verified_quotes)}</button>`)
        .join("")}</div>`);
    }
    const acts = [];
    if (candidates) acts.push(`<button class="t5-ghost" data-edit-btn>${ctx.esc(S.editing ? t("cancel_edit") : t("edit_wording"))}</button>`);
    if (S.editing) acts.push(`<button class="t5-auth" data-save>${ctx.esc(t("save_wording"))}</button>`);
    else {
      acts.push(`<button class="t5-ghost" data-amend>${ctx.esc(t("braid_amend"))}</button>`);
      if (S.reviewMode || payload.existing) {
        acts.push(`<button class="t5-ghost" data-reprocess>${ctx.esc(S.node.kind === "derived" ? t("reprocess") : t("reprocess_conversation"))}</button>`);
      }
      if (S.reviewMode && S.node.kind === "conversation") {
        acts.push(`<button class="t5-ghost" data-restart>${ctx.esc(t("restart_interview"))}</button>`);
      }
      acts.push(`<button class="t5-auth" data-auth>${ctx.esc(t("braid_authorize"))}</button>`);
    }
    parts.push(`<div class="t5-acts">${acts.join("")}</div>`);
    if (payload.authorize_language) parts.push(`<div class="t5-authlang">${ctx.esc(payload.authorize_language)}</div>`);
    card.innerHTML = parts.join("");
    box.appendChild(card);

    card.querySelectorAll("[data-alt]").forEach((b) =>
      b.addEventListener("click", () => {
        S.review.currentText = others[Number(b.dataset.alt)];
        buildReviewCard();
      }));
    const editBtn = card.querySelector("[data-edit-btn]");
    if (editBtn) editBtn.addEventListener("click", () => {
      S.editing = !S.editing;
      buildReviewCard();
    });
    const save = card.querySelector("[data-save]");
    if (save) save.addEventListener("click", () => {
      const ta = card.querySelector("[data-edit]");
      const text = ta && ta.value.trim();
      if (text) {
        S.review.currentText = text;
        S.review.edited = true;
      }
      S.editing = false;
      buildReviewCard();
    });
    const amend = card.querySelector("[data-amend]");
    if (amend) amend.addEventListener("click", () => {
      const on = S.composerMode !== "amend";
      if (on && !ctx.wsLive()) return connLost();
      S.composerMode = on ? "amend" : "answer";
      amend.classList.toggle("active", on);
      composeEnable(on, t("amend_placeholder"));
    });
    const reprocess = card.querySelector("[data-reprocess]");
    if (reprocess) reprocess.addEventListener("click", () => {
      if (!ctx.wsSend({ type: "review_action", action: "reprocess" })) return connLost();
      setSub(t("status_revising"));
      card.querySelectorAll("button").forEach((b) => { b.disabled = true; });
    });
    const restart = card.querySelector("[data-restart]");
    if (restart) restart.addEventListener("click", () => {
      ctx.closeWs();
      el(".t5-msgs").innerHTML = "";
      S.review = null;
      S.reviewMode = false;
      S.chatless = S.node.kind === "derived";
      S.knots = 0;
      orbSet(0);
      setSub(ctx.nodeDesc(S.node));
      layoutThread();
      ctx.connect(S.node.id, { resuming: false, review: false, surface: braidSurface });
    });
    const auth = card.querySelector("[data-auth]");
    if (auth) auth.addEventListener("click", () => {
      const m = { type: "review_action", action: "authorize" };
      if (candidates) m.value = S.review.currentText;
      if (!ctx.wsSend(m)) return connLost();
      card.querySelectorAll("button").forEach((b) => { b.disabled = true; });
    });
    layoutThread();
  }

  /* ── authorize → close ceremony → journey weave ─────────── */

  function sealAndClose() {
    const ctx = S.ctx, t = ctx.t;
    S.closing = true;
    const card = S.root && S.root.querySelector('[data-k="draft"]');
    if (card) {
      card.classList.add("sealed");
      const acts = card.querySelector(".t5-acts");
      if (acts) acts.remove();
    }
    orbSet(1);
    msg("woven", t("braid_woven_in"));
    setSub(t("braid_authored_sub"));
    const orb = el(".t5-orb");
    if (orb) {
      orb.style.animation = "none";
      requestAnimationFrame(() => { orb.style.animation = "t4solidify 1.5s cubic-bezier(.25,.75,.2,1)"; });
    }
    // The step that wakes next, in journey order, for the parting sub-line.
    const after = S.idx + 1 < J.nodes.length && !S.wasSettled ? J.nodes[S.idx + 1] : null;
    S.timers.push(setTimeout(() => {
      const scroll = el(".t5-scroll"), comp = el(".t5-composer"), fade = el(".t5-botfade");
      [scroll, comp, fade].forEach((e) => {
        if (e) { e.style.transition = "opacity .7s ease"; e.style.opacity = "0"; e.style.pointerEvents = "none"; }
      });
      const hero = el(".t5-hero");
      if (hero) {
        hero.style.transition = "top 1.15s cubic-bezier(.3,.7,.2,1)";
        hero.style.top = "42dvh";
      }
      if (orb) {
        orb.style.transition = "filter .35s ease, width 1.15s cubic-bezier(.3,.7,.2,1), height 1.15s cubic-bezier(.3,.7,.2,1)";
        orb.style.width = "96px";
        orb.style.height = "96px";
        orb.style.animation = "none";
        S.timers.push(setTimeout(() => { orb.style.animation = "t4solidify 1.5s cubic-bezier(.25,.75,.2,1)"; }, 1100));
      }
      setSub(after ? t("braid_next_wakes", ctx.nodeTitle(after)) : S.wasSettled ? t("braid_authored_sub") : t("braid_journey_done"));
      S.timers.push(setTimeout(() => {
        ctx.closeWs();
        const idx = S.idx, wasSettled = S.wasSettled;
        teardown();
        if (!wasSettled && J.frame && J.frame.isConnected) {
          startTick();
          startWeave(idx);
        } else {
          ctx.reload();
        }
      }, 2700));
    }, 1600));
  }

  /* ── the WS surface: braid session rendering of the message flow ── */

  const braidSurface = {
    say(text, anchor) {
      if (S.chatless) return setSub(text);
      if (anchor) msg("note", S.ctx.t("anchor_label"));
      msg("say", text);
    },
    note(text) {
      const localized = S.ctx.localizeNote(text);
      if (S.chatless || S.review) setSub(localized);
      else msg("note", localized);
    },
    error(text) {
      if (S.chatless) setSub(text);
      else msg("error", text);
    },
    ask(prompt) {
      S.composerMode = "answer";
      const t = S.ctx.t;
      const ph = prompt && prompt.includes("esume") ? t("placeholder_resume")
        : prompt && prompt !== "you" ? prompt : t("placeholder");
      composeEnable(true, ph);
    },
    review(payload) {
      S.review = { payload, currentText: payload.candidates[0] ?? "", edited: false };
      S.editing = false;
      S.composerMode = "answer";
      composeEnable(false);
      orbSet(1);
      setSub(payload.existing ? S.ctx.nodeDesc(S.node) : S.ctx.t("braid_draft_ready"));
      buildReviewCard();
    },
    done(outcome) {
      if (outcome === "authorized") sealAndClose();
      else if (!S.chatless) msg("note", S.ctx.t("session_saved", outcome));
    },
    closed() {
      if (!S.open || S.closing) return;
      composeEnable(false);
      if (S.chatless) setSub(S.ctx.t("conn_closed"));
      else msg("note", S.ctx.t("conn_closed"));
    },
  };

  /* ── entry: open a step's session ───────────────────────── */

  async function openSession(id, ctx) {
    if (S.open) return;
    const node = ctx.journey.nodes.find((n) => n.id === id);
    if (!node || node.status === "planned") return;

    S.open = true;
    S.closing = false;
    const my = ++S.gen; // stale continuations must not touch a later session
    S.ctx = ctx;
    S.node = node;
    S.idx = ctx.journey.nodes.findIndex((n) => n.id === id);
    S.knots = 0;
    S.review = null;
    S.editing = false;
    S.composerMode = "answer";
    // The braid may know the step is woven before the server model reloads
    // (the ~5s ceremony window) — never reopen a woven step as an interview.
    S.reviewMode = ctx.isSettled(node.status) || J.status[S.idx] === "done";
    S.chatless = S.reviewMode || node.kind === "derived";
    S.wasSettled = S.reviewMode;

    sessionBuild(ctx, node);
    setSub(S.chatless && !S.reviewMode ? ctx.t("status_preparing") : ctx.nodeDesc(node));
    layoutThread();

    // Transparency panel content — same sources as the modal.
    fetch(`/api/playbook/${id}?lang=${ctx.lang}`)
      .then((r) => r.json())
      .then((pb) => {
        if (!S.open || S.gen !== my) return;
        el(".t5-twhat").textContent = (ctx.lang !== "en" ? `${ctx.t("playbook_lang_note")}\n\n` : "") + pb.purpose;
        el(".t5-tmono").innerHTML = ctx.compiledHtml(pb.compiled);
      })
      .catch(() => {});

    // The recorded conversation flows through the same transcript: resumed
    // sessions continue it, settled ones show it above the review card.
    let resuming = false;
    if (node.kind === "conversation" && (node.status === "in_progress" || S.reviewMode)) {
      try {
        const res = await fetch(ctx.api(`/api/session/${id}`));
        if (!S.open || S.gen !== my) return;
        if (res.ok) {
          const saved = await res.json();
          if (!S.open || S.gen !== my) return;
          for (const e of saved.exchange ?? []) {
            const d = msg(e.speaker === "user" ? "user" : "say", e.text);
            if (d) d.style.animation = "none";
          }
          S.knots = (saved.exchange ?? []).filter((e) => e.speaker === "user").length;
          orbSet(S.reviewMode ? 1 : orbProgress());
          if (node.status === "in_progress") {
            msg("note", ctx.t("resumed_note"));
            resuming = true;
          }
        }
      } catch { /* no recording — fresh start */ }
    }
    if (!S.open || S.gen !== my) return; // closed or reopened while fetching

    ctx.connect(id, { resuming, review: S.reviewMode, surface: braidSurface });
  }

  /* Route an open request the same way a field click does: every openable
   * step talks inline beside its node (woven ones review in place). Only when
   * there is no field on screen do we fall back to the page view. */
  function openAny(id, ctx) {
    const node = ctx.journey.nodes.find((n) => n.id === id);
    if (!node) return;
    const j = J.nodes.findIndex((n) => n.id === id);
    if (j >= 0 && J.stage && J.stage.isConnected) return inlineOpen(j);
    return openSession(id, ctx); // no field on screen — fall back to the page view
  }

  /* ══ public seam ══════════════════════════════════════════ */

  const wide = matchMedia("(min-width: 900px)");
  wide.addEventListener?.("change", () => {
    if (L.open) inlineAbort(); // leaving braid mode must not strand the interview
    if (J.ctx) J.ctx.reload();
  });

  window.Braid = {
    ready: true,

    active() {
      if (!this.ready) return false;
      if (window.Capacitor?.isNativePlatform?.()) return false;
      if (localStorage.getItem("braid") === "0") return false;
      return wide.matches;
    },

    renderJourney,
    openSession: openAny,
    /** Close any live inline session (ws included) — called by the app when
     * the braid stops being the active journey surface. */
    abortSession() { if (L.open) inlineAbort(); },
    _debug: () => ({ raf: J.raf, sOpen: S.open, lOpen: L.open, sess: J.sess, sx: J.sx, focus: J.focus, status: J.status.join(","), knots: L.knots.length, syncs: J._syncs || 0, syncSkips: J._syncSkips || 0, merge: Boolean(J.merge), pendingNext: J.pendingNext, hov: J.hovOn, hovK: J.hovK, nameP: J.nameP, ov: J.ov, ovWake: J.ovWake, wake: !!J.wake, think: !!J.think, sat: J.sat ? (J.sat.offT ? "fading" : "on") : null, thinkIdx: J.think && J.ctx ? (J.think.i + Math.floor(Math.max(0, (performance.now() - J.think.t0) / 2000))) % J.ctx.t("braid_think_pool").length : null }),
    _frame: (ts) => { if (J.loop) J.loop(ts); },
  };
})();
