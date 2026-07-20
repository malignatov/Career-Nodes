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
    spin: 0.6, hoverScale: 1, nimX: undefined, nimY: undefined,
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
    const c = smoothstep((y - 1430) / 260);
    return x + (450 - x) * c;
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

  const stripY = () => Math.max(-900, Math.min(180, 320 - NY(J.focus)));

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
    if (st === "next") { renderNextCore(el); return; }
    if (st === "done") {
      const m = J.merge;
      if (m && m.j === j && m.phase === "travel") renderNextCore(el);
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

  function renderNextCore(el) {
    el.style.cssText = "position:absolute;left:-25px;top:-25px;width:50px;height:50px;transition:filter .35s ease";
    if (el.__c !== "wire2") {
      el.__c = "wire2";
      el.innerHTML =
        '<div style="position:absolute;inset:11%;border-radius:99px;background:radial-gradient(circle, color-mix(in srgb, var(--acc) 60%, transparent) 0%, color-mix(in srgb, var(--acc) 24%, transparent) 44%, transparent 70%)"></div>' +
        '<svg data-wire width="100%" height="100%" viewBox="-25 -25 50 50" style="position:absolute;inset:0;overflow:visible">' + sphereSVG(22, 0.6, 0.35, "wire") + "</svg>";
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
      nodes.push(`<div class="br-node" data-i="${j}"><div data-core></div></div>`);
      nodes.push(`<div class="br-label" data-i="${j}"></div>`);
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
            <svg width="900" height="1760" viewBox="0 0 900 1760" aria-hidden="true">${paths.join("")}</svg>
            <div class="br-omega"><svg width="420" height="420" viewBox="-105 -105 210 210">${sphereSVG(100, 0.8, 0.3, "wire")}</svg></div>
            ${nodes.join("")}
            <div class="br-nimbus">
              <div class="br-nimbus-glow"></div>
              <div class="br-ping" data-ping></div>
            </div>
            <div class="br-plaque">
              <div class="br-plaque-title"></div>
              <div class="br-plaque-line"></div>
            </div>
          </div>
          <div class="br7-canvas">
            <div class="br7-chat"><div class="br7-msgs"></div></div>
            <div class="br7-comp">
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
        <button class="br7-info" title="Transparency">◎</button>
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

    let acc = 0;
    J.stage.addEventListener("wheel", (e) => {
      if (J.sess) {
        // Navigation freezes, but the transcript and the transparency panel
        // must stay scrollable (their scrollbars are hidden, not their scroll).
        if (!e.target.closest(".br7-chat,.br7-tpanel")) e.preventDefault();
        return;
      }
      e.preventDefault();
      if (J.merge) return; // no scrolling away mid-weave
      acc += e.deltaY;
      if (acc > 34) { acc = 0; setFocus(J.focus + 1); }
      else if (acc < -34) { acc = 0; setFocus(J.focus - 1); }
    }, { passive: false });

    // Third exit (with Esc and the node-as-button): click empty field to leave —
    // the open transparency panel closes first, then the session.
    J.stage.addEventListener("click", (e) => {
      if (!J.sess || L.closing) return;
      // The click that follows a node press must never count as a click-out:
      // opening shifts the camera, so the node slides out from under the
      // cursor and this click's target is no longer the node.
      if (Date.now() - (J.__pd || 0) < 700) return;
      if (e.target.closest(".br7-chat,.br7-comp,.br7-info,.br7-exit,.br7-tpanel,.br7-mic,.br-node")) return;
      const tp = q7(".br7-tpanel");
      if (tp && !tp.hidden) { tp.hidden = true; return; }
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
      inp.style.height = "38px";
      inp.style.height = Math.min(120, Math.max(38, inp.scrollHeight)) + "px";
      L.draft = inp.value; // persist the in-progress draft across re-renders
    });
    q7(".br7-mic").addEventListener("click", () => {
      if (!L.open) return;
      const v = L.ctx.voice;
      if (!v?.enabled?.()) return;
      if (v.active()) v.stop();
      else v.start(inp);
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
    const wovenText = t("braid_woven_of", done, J.nodes.length);
    // "N of 15 woven": the number stays bright, the rest muted.
    const numMatch = wovenText.match(/\d+/);
    if (numMatch) {
      const i = wovenText.indexOf(numMatch[0]);
      count.append(wovenText.slice(0, i + numMatch[0].length));
      const rest = document.createElement("span");
      rest.textContent = wovenText.slice(i + numMatch[0].length);
      count.append(rest);
    } else count.textContent = wovenText;

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
    J.strip.querySelectorAll(".br-label").forEach((el) => {
      const j = Number(el.dataset.i);
      const nm = J.ctx.nodeTitle(J.nodes[j]);
      // Locked steps carry an "Unlocks after {previous step}" sub-line.
      if (J.nodes[j].status === "planned" && j > 0) { // server truth, not paint state
        const prev = J.ctx.nodeTitle(J.nodes[j - 1]);
        el.innerHTML = `<div>${esc(nm)}</div><div class="br-label-sub">${esc(t("unlocks_after", prev))}</div>`;
      } else if (el.textContent !== nm || el.querySelector(".br-label-sub")) {
        el.textContent = nm;
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

  function labelPlace(j, anchor) {
    const ny = nodeYf(j);
    const nx = withGrav(baseX(j, ny), ny, anchor);
    // ~14px gap from node center; flip to the in-frame side; clamp inside the
    // 900-wide field so no name leaves the frame.
    const LW = 180, FW = 900;
    let right = nx < 450;
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
    const tm = instant ? { dur: "0s", ease: "linear", op: "0s" } : timing();
    const anchor = anchorFor(J.focus);
    const n = J.nodes.length;

    J.vp = Math.min(1, J.status.filter((s) => s === "done").length / 13);
    J.stage.style.setProperty("--vacc", `color-mix(in srgb, var(--acc) ${Math.round(8 + 92 * J.vp)}%, var(--t4mut))`);

    J.strip.style.transition = `transform ${tm.dur} ${tm.ease}`;
    J.strip.style.transform = `translate(${(J.sess ? J.sx : 0).toFixed(0)}px, ${stripY().toFixed(0)}px)`;

    for (let j = 0; j < n; j++) {
      const p = J.strip.querySelector(`[data-s="${j}"]`);
      if (p) {
        p.style.transition = `d ${tm.dur} ${tm.ease}, opacity ${tm.op} ease`;
        setD(p, threadD(j, anchor));
        const st = threadStyle(J.status[j], j === J.focus);
        p.setAttribute("stroke", st.stroke);
        p.setAttribute("stroke-width", st.width);
        p.style.opacity = st.opacity;
      }
      const nd = J.strip.querySelector(`.br-node[data-i="${j}"]`);
      if (nd) {
        const ny = nodeYf(j);
        const nx = withGrav(baseX(j, ny), ny, anchor);
        nd.style.transition = `transform ${tm.dur} ${tm.ease}, opacity .45s ease`;
        nd.style.transform = `translate(${nx.toFixed(1)}px, ${ny.toFixed(1)}px)${j === J.focus ? " scale(1.6)" : ""}`;
        renderCore(nd.querySelector("[data-core]"), J.status[j], j);
      }
      const l = J.strip.querySelector(`.br-label[data-i="${j}"]`);
      if (l) {
        const lp = labelPlace(j, anchor);
        l.style.transition = instant ? "none" : "transform .7s cubic-bezier(.2,.9,.25,1), opacity .45s ease";
        l.style.transform = `translate(${lp.x.toFixed(1)}px, ${lp.y.toFixed(1)}px)`;
        l.style.textAlign = lp.right ? "left" : "right";
        l.style.opacity = lp.opacity;
        const st = J.status[j];
        l.style.color = st === "done" ? "var(--t4lab1)" : st === "next" ? "var(--t4lab2)" : "var(--t4lab3)";
      }
    }

    const focused = J.nodes[J.focus];
    const fst = J.status[J.focus];
    const plaque = J.strip.querySelector(".br-plaque");
    const nimbus = J.strip.querySelector(".br-nimbus");
    const titleEl = plaque.querySelector(".br-plaque-title");
    titleEl.textContent = J.ctx.nodeTitle(focused);
    // Far-left locked nodes (strings splay left) would run the title off-frame:
    // flip it to the node's right. Caption stays right in both cases.
    const flip = !J.sess && anchor.nx < 372;
    titleEl.style.right = "auto";
    titleEl.style.left = flip ? "20px" : "-356px";
    titleEl.style.textAlign = flip ? "left" : "right";
    plaque.querySelector(".br-plaque-line").textContent =
      J.merge && J.merge.j === J.focus && J.merge.phase === "solid"
        ? J.ctx.t("braid_woven_in")
        // "Locked" must reflect SERVER truth: a step that is available but
        // simply not the current one still opens — never call it locked.
        : (focused.status === "planned" && J.focus > 0)
          ? J.ctx.t("locked_unlocks_after", J.ctx.nodeTitle(J.nodes[J.focus - 1]))
          : J.ctx.nodeDesc(focused);
    // When the waking sphere is focused, the rAF loop owns plaque/nimbus
    // position (lerp .14/frame); reset the lerp so it starts from the node.
    if (fst === "next") {
      J.nimX = J.nimY = undefined;
      plaque.style.transition = "opacity .5s ease";
      nimbus.style.transition = "opacity .5s ease";
    } else {
      plaque.style.transition = `transform ${tm.dur} ${tm.ease}, opacity .5s ease`;
      nimbus.style.transition = `transform ${tm.dur} ${tm.ease}, opacity .5s ease`;
      const tx = `translate(${anchor.nx.toFixed(1)}px, ${anchor.py.toFixed(1)}px)`;
      plaque.style.transform = tx;
      nimbus.style.transform = tx;
    }
    nimbus.style.opacity = fst === "next" ? "1" : fst === "done" ? ".4" : "0";
    nimbus.querySelector("[data-ping]").style.display = fst === "next" ? "" : "none";
    // Caption dip-and-return on every relayout.
    if (!instant) {
      plaque.style.opacity = "0";
      requestAnimationFrame(() => { plaque.style.opacity = "1"; });
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
      const j = J.status.indexOf("next");
      const anchor = anchorFor(J.focus);
      if (j < 0) { renderKnots(strip, j, anchor, 0); return; }
      const ny = nodeYf(j);
      const nx0 = withGrav(baseX(j, ny), ny, anchor);
      const dir = Math.sign(braidX(j, ny) - nx0) || 1;
      const amp = 26 * (0.5 - 0.5 * Math.cos(ts * 2 * Math.PI / 6500)) * dir;
      const pts = sampleYs(ny).map((y) => {
        const bell = Math.exp(-Math.pow((y - ny) / 170, 2));
        return [withGrav(baseX(j, y), y, anchor) + amp * bell, y];
      });
      const p = strip.querySelector(`[data-s="${j}"]`);
      if (p) { p.style.transition = "opacity .7s ease"; setD(p, quadPath(pts)); }
      const nd = strip.querySelector(`.br-node[data-i="${j}"]`);
      const dt = Math.min(64, J.lastTs ? ts - J.lastTs : 16);
      J.lastTs = ts;
      // Mouse is stage-space; threads are strip-space (900 wide, centered).
      const offX = (stage.clientWidth - 900) / 2;
      const sy = stripY();
      const hov = J.mx !== undefined
        && Math.abs(J.mx - offX - (J.sess ? J.sx : 0) - (nx0 + amp)) < 140
        && (J.my - (ny + sy)) > -105 && (J.my - (ny + sy)) < 140;
      J.hoverScale += ((hov ? 1.09 : 1) - J.hoverScale) * 0.15;
      if (nd) {
        nd.style.transition = "none";
        nd.style.transform = `translate(${(nx0 + amp).toFixed(1)}px, ${ny.toFixed(1)}px) scale(${((j === J.focus ? 1.6 : 1) * J.hoverScale).toFixed(3)})`;
      }
      J.spin += dt * (hov ? 0.0016 : 0.00042);
      const wc = nd && nd.querySelector("[data-wire]");
      if (wc) {
        wc.innerHTML = sphereSVG(22, J.spin, 0.35, "wire");
        const light = document.documentElement.dataset.theme === "light";
        wc.parentElement.style.filter = hov ? (light ? "brightness(.68) saturate(1.25)" : "brightness(1.4)") : "none";
      }
      if (j === J.focus) {
        const nim = strip.querySelector(".br-nimbus");
        const txp = nx0 + amp;
        J.nimX = J.nimX === undefined ? txp : J.nimX + (txp - J.nimX) * 0.14;
        J.nimY = J.nimY === undefined ? ny : J.nimY + (ny - J.nimY) * 0.14;
        const tx = `translate(${J.nimX.toFixed(1)}px, ${J.nimY.toFixed(1)}px)`;
        nim.style.transform = tx;
        const ring = nim.querySelector("[data-ping]");
        if (ring) {
          // Sonar ping phase-locked to the oscillation peak.
          const ph = ((ts % 6500) / 6500 + 0.5) % 1;
          const op = ph < 0.09 ? (ph / 0.09) * 0.75 : Math.max(0, 0.75 * (1 - (ph - 0.09) / 0.6));
          ring.style.animation = "none";
          ring.style.transform = `scale(${(0.42 + 0.95 * ph).toFixed(3)})`;
          ring.style.opacity = op.toFixed(2);
        }
        const plq = strip.querySelector(".br-plaque");
        plq.style.transform = tx;
      }
      // Ride-along label when the waking node is not the focused one.
      const l = strip.querySelector(`.br-label[data-i="${j}"]`);
      if (l && j !== J.focus) {
        let right = (nx0 + amp) < 450, lx;
        const fy = NY(J.focus);
        const vHit = (ny + 8 > fy - 88 && ny - 10 < fy - 50) || (ny + 8 > fy + 52 && ny - 10 < fy + 120);
        if (Math.abs(j - J.focus) === 1 && vHit) {
          const fx = anchor.nx;
          right = (nx0 + amp) >= fx;
          lx = right ? Math.max(nx0 + amp + 26, fx + 180) : Math.min(nx0 + amp - 206, fx - 360);
          lx = Math.max(8, Math.min(712, lx));
          l.style.opacity = (lx + 180 > fx - 180 && lx < fx + 180) ? ".15" : "1";
        } else lx = right ? nx0 + amp + 26 : nx0 + amp - 206;
        l.style.transition = "none";
        l.style.transform = `translate(${lx.toFixed(1)}px, ${(ny - 10).toFixed(1)}px)`;
        l.style.textAlign = right ? "left" : "right";
      }
      renderKnots(strip, j, anchor, amp, pts);
    };
    J.loop = loop;
    J.raf = requestAnimationFrame(loop);
  }

  /* Session knots sit exactly on the rendered string (qxAt over the same
   * pts that drew it), riding its oscillation. Rebuilt every frame. */
  function renderKnots(strip, nextJ, anchor, amp, livePts) {
    if (!J.sess || !L.open) return;
    const kg = strip.querySelector("[data-knots]");
    if (!kg) return;
    const sNy = nodeYf(L.idx);
    // The session thread's rendered pts: the live oscillating set when the
    // session node IS the waking one, else its static curve.
    const pts = (livePts && L.idx === nextJ)
      ? livePts
      : sampleYs(sNy).map((y) => [withGrav(baseX(L.idx, y), y, anchor), y]);
    let kn = "";
    for (const [ky, big] of L.knots) {
      const kxv = qxAt(pts, ky);
      const bell = Math.exp(-Math.pow((ky - sNy) / 170, 2));
      const kx = (kxv == null
        ? withGrav(baseX(L.idx, ky), ky, anchor) + (L.idx === nextJ ? amp * bell : 0)
        : kxv).toFixed(1);
      kn += big
        ? `<circle cx="${kx}" cy="${ky}" r="6" fill="var(--acc)"></circle><circle cx="${kx}" cy="${ky}" r="12" fill="none" stroke="var(--acc)" stroke-opacity=".4"></circle>`
        : `<circle cx="${kx}" cy="${ky}" r="3.6" fill="var(--acc)"></circle><circle cx="${kx}" cy="${ky}" r="8" fill="none" stroke="var(--acc)" stroke-opacity=".3"></circle>`;
    }
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
      setFocus(J.pendingNext ?? Math.min(J.nodes.length - 1, i + 1));
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
  function shakeBraid(j) {
    const strip = J.strip;
    if (!strip) return;
    const anchor = anchorFor(J.focus);
    const ny = NY(j), t0 = performance.now(), dur = 950;
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

  function inlineMsg(kind, text, html) {
    const box = q7(".br7-msgs");
    if (!box) return null;
    const d = document.createElement("div");
    d.className = `br7-${kind}`;
    if (html !== undefined) d.innerHTML = html;
    else d.textContent = text;
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
    return d;
  }

  function inlineCompose(on, placeholder) {
    const inp = q7(".br7-input");
    if (!inp) return;
    inp.disabled = !on;
    inp.style.opacity = on ? "1" : ".35";
    if (placeholder) { inp.placeholder = placeholder; L.placeholder = placeholder; }
    if (on) {
      if (!inp.value && L.draft) inp.value = L.draft; // restore a draft after re-render
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
    inp.style.height = "38px";
    inlineCompose(false);
    inlineMsg("user", text);
    if (L.composerMode === "amend") {
      L.composerMode = "answer";
      inlineStatus(L.ctx.t("status_revising"));
    } else pushKnot(false);
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
      parts.push(`<div class="br7-review-body">${ctx.renderFields(payload.draft, payload.verified_quotes)}</div>`);
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
    for (const turn of L.record ?? []) {
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
      : ctx.renderFields(payload.draft, quotes);
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
      if (anchor) inlineMsg("note", L.ctx.t("anchor_label"));
      inlineMsg("say", text);
    },
    note(text) {
      const localized = L.ctx.localizeNote(text);
      // Process notes during induction or revision collapse onto one line;
      // conversation notes (topics) stay part of the transcript.
      if (L.review || L.chatless) inlineStatus(localized);
      else inlineMsg("note", localized);
    },
    error(text) { inlineMsg("error", text); },
    ask(prompt) {
      L.composerMode = "answer";
      const t = L.ctx.t;
      const ph = prompt && prompt.includes("esume") ? t("placeholder_resume")
        : prompt && prompt !== "you" ? prompt : t("placeholder");
      inlineCompose(true, ph);
    },
    review(payload) {
      // A woven bead's own authored record reads back as the passage; an
      // amended re-draft (any later payload) falls through to the editable
      // card so it can be re-authorized.
      if (L.reviewing && payload.existing && L.firstReview) {
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
    L.draft = "";
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
    if (e.key !== "Escape") return;
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
      parts.push(`<div class="t5-draft-body">${ctx.renderFields(payload.draft, payload.verified_quotes)}</div>`);
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
    _debug: () => ({ raf: J.raf, sOpen: S.open, lOpen: L.open, sess: J.sess, sx: J.sx, focus: J.focus, status: J.status.join(","), knots: L.knots.length, syncs: J._syncs || 0, syncSkips: J._syncSkips || 0, merge: Boolean(J.merge), pendingNext: J.pendingNext }),
    _frame: (ts) => { if (J.loop) J.loop(ts); },
  };
})();
