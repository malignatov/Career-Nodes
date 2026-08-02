/**
 * The braid, portrait — mobile client-mode journey ("Braid Mobile App" handoff).
 * A 390×1640 drifting-diagonal field: nodes sit ON their drawn curve (the same
 * sampled points build the path, the oscillation, and the shake), the camera
 * moves vertically only, and the session lifts the node into a compact header
 * with the chat below. Same ctx seam and WS surface contract as the desktop
 * braid; active on Capacitor or sub-900px client viewports.
 */
window.BraidM = (() => {
  "use strict";

  /* ── geometry (verbatim from the reference) ───────────────── */

  // FOCUS_S sits below the session header (title + status note) so the
  // lifted sphere clears it instead of colliding — tuned on-device.
  const W = 390, H = 2140, FOCUS_J = 336, FOCUS_S = 150;
  // Ω geometry: every thread pours into the omega crown past the last bead.
  const OMX = 195, OMY = 1940;

  const rnd = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const NY = (j) => 150 + j * 100;
  const nodeYf = (j, f) => { const d = j - f; return NY(j) + (Math.abs(d) === 1 ? 26 * Math.sign(d) : 0); };
  const sstep = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

  const spineX = (y) => 96 + 150 * sstep((y - 120) / 1320) + 10 * Math.sin(y * 0.017 + 0.6);

  function strayX(j, y) {
    const side = rnd(j * 3 + 5) < 0.5 ? -1 : 1;
    const c = spineX(NY(j)) + side * (36 + rnd(j * 3 + 1) * 104);
    const amp = 22 + rnd(j * 3 + 2) * 44;
    const freq = 0.006 + rnd(j * 3 + 3) * 0.009;
    const ph = rnd(j * 3 + 4) * 6.283;
    return c + amp * Math.sin(y * freq + ph);
  }

  const braidX = (j, y) => spineX(y) + (5 + rnd(j * 7 + 6) * 8) * Math.sin(y * 0.03 + rnd(j * 7 + 7) * 6.283);

  function baseX(j, y) {
    const st = M.status[j], ny = NY(j);
    const a = st === "done" ? 1 : st === "next" ? 0.6 * Math.exp(-Math.pow((y - ny) / 210, 2)) : 0;
    const sx = strayX(j, y);
    const x = Math.max(24, Math.min(W - 24, sx + (braidX(j, y) - sx) * a));
    // Endgame convergence: all threads blend toward the omega — and release
    // past its center back to their own wander (no straight tail).
    const c = sstep((y - 1560) / 240);
    const r = sstep((y - 1990) / 220);
    return x + (OMX - x) * c * (1 - r);
  }

  /* Threads sample every 52px, skipping ±26 around the node; the SAME points
   * draw the path, place the node, oscillate, and shake — they cannot diverge.
   * The range runs 620px past the strip so strings exit the viewport
   * continuously AND the knot solver covers a session column below even the
   * last node (whose chat maps beyond the nominal strip height). */
  function threadPts(j, off) {
    const ny = nodeYf(j, M.focus);
    const pts = [];
    // -280 keeps thread tops above the viewport even at the journey camera's
    // maximum downward shift (focus 0), so strings run continuously under the
    // header instead of starting mid-screen.
    for (let y = -280; y <= H + 620; y += 52) {
      if (Math.abs(y - ny) < 26) continue;
      pts.push([baseX(j, y) + (off ? off(y) : 0), y]);
    }
    return pts;
  }

  function qd(pts) {
    let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1]}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = ((pts[i][0] + pts[i + 1][0]) / 2).toFixed(1);
      const my = ((pts[i][1] + pts[i + 1][1]) / 2).toFixed(1);
      d += ` Q ${pts[i][0].toFixed(1)} ${pts[i][1]} ${mx} ${my}`;
    }
    return d + ` L ${pts[pts.length - 1][0].toFixed(1)} ${pts[pts.length - 1][1]}`;
  }

  function qxAt(pts, ky) {
    let sx = pts[0][0], sy = pts[0][1];
    for (let i = 1; i < pts.length - 1; i++) {
      const cx = pts[i][0], cy = pts[i][1];
      const ex = (pts[i][0] + pts[i + 1][0]) / 2, ey = (pts[i][1] + pts[i + 1][1]) / 2;
      for (let t = 0; t <= 1; t += 0.05) {
        const y = (1 - t) * (1 - t) * sy + 2 * t * (1 - t) * cy + t * t * ey;
        if (Math.abs(y - ky) < 8) return (1 - t) * (1 - t) * sx + 2 * t * (1 - t) * cx + t * t * ex;
      }
      sx = ex; sy = ey;
    }
    return null;
  }

  const curveX = (pts, ky, fb) => { const x = qxAt(pts, ky); return x == null ? fb : x; };

  /* ── geodesic spheres (same recipe as the desktop braid) ──── */

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
        const k = a < b ? `${a}_${b}` : `${b}_${a}`;
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
    faces.forEach((f) => { for (let i = 0; i < 3; i++) { const a = f[i], b = f[(i + 1) % 3]; es.add(a < b ? `${a}_${b}` : `${b}_${a}`); } });
    return (geoCache[level] = { verts, edges: [...es].map((s) => s.split("_").map(Number)) });
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
      const seg = `M${P[a][0].toFixed(1)} ${P[a][1].toFixed(1)}L${P[b][0].toFixed(1)} ${P[b][1].toFixed(1)}`;
      if (P[a][2] + P[b][2] > 0) front += seg; else back += seg;
    });
    P.forEach((q) => { if (q[2] > 0.22) dots += `M${q[0].toFixed(1)} ${q[1].toFixed(1)}l.01 0`; });
    return `<path d="${back}" style="fill:none;stroke:var(--bm-wireB);stroke-width:${swB};vector-effect:non-scaling-stroke"></path>`
      + `<path d="${front}" style="fill:none;stroke:color-mix(in srgb, var(--vacc, var(--acc)) 80%, var(--bm-wireF));stroke-width:${swF};stroke-linecap:round;vector-effect:non-scaling-stroke"></path>`
      + `<path d="${dots}" style="fill:none;stroke:var(--vacc, var(--acc));stroke-width:${mode === "wire" ? 1.6 : 1.1};stroke-linecap:round;vector-effect:non-scaling-stroke"></path>`;
  }

  /* Node cores: ghost wireframe → waking wire sphere → pigment bead. */
  function core(el, st, j, big) {
    if (st === "next" || (M.merge && M.merge.j === j && M.merge.phase === "travel")) {
      // Box transition: a just-promoted bead grows out of its ghost.
      el.style.cssText = "position:absolute;left:-26px;top:-26px;width:52px;height:52px;"
        + "transition:left .8s cubic-bezier(.3,.7,.2,1), top .8s cubic-bezier(.3,.7,.2,1), width .8s cubic-bezier(.3,.7,.2,1), height .8s cubic-bezier(.3,.7,.2,1)";
      if (el.__c !== "wire2") {
        el.__c = "wire2";
        el.innerHTML =
          '<div style="position:absolute;inset:11%;border-radius:99px;background:radial-gradient(circle, color-mix(in srgb, var(--acc) 60%, transparent) 0%, color-mix(in srgb, var(--acc) 24%, transparent) 44%, transparent 70%)"></div>'
          + `<svg data-wire width="100%" height="100%" viewBox="-26 -26 52 52" style="position:absolute;inset:0;overflow:visible">${sphereSVG(23, 0.6, 0.35, "wire")}</svg>`;
      }
      return;
    }
    if (st === "done") {
      const D = big ? 26 : 13, sz = big ? 52 : 26;
      el.style.cssText = `position:absolute;left:-${D}px;top:-${D}px;width:${sz}px;height:${sz}px;`
        + "filter:drop-shadow(0 5px 8px rgba(0,0,0,.4)) drop-shadow(0 0 10px color-mix(in srgb, var(--pig) 30%, transparent));"
        + "transition:left .8s cubic-bezier(.3,.7,.2,1), top .8s cubic-bezier(.3,.7,.2,1), width .8s cubic-bezier(.3,.7,.2,1), height .8s cubic-bezier(.3,.7,.2,1)";
      if (el.__c !== "solid3") {
        const pop = el.__c === "wire2";
        el.__c = "solid3";
        el.innerHTML =
          `<div style="position:absolute;inset:8%;border-radius:99px;opacity:.62;background:radial-gradient(circle, var(--pig) 0%, color-mix(in srgb, var(--pig) 76%, #14120c) 58%, color-mix(in srgb, var(--pig) 30%, transparent) 86%, transparent 100%);${pop ? "animation:t4mfill 1.4s cubic-bezier(.3,.7,.2,1) both;" : ""}"></div>`
          + `<svg width="100%" height="100%" viewBox="-13 -13 26 26" style="position:absolute;inset:0;overflow:visible">${sphereSVG(11, 0.9 + j * 1.7, 0.42, "wire")}</svg>`
          + '<div style="position:absolute;inset:7%;border-radius:99px;background:radial-gradient(circle at 32% 24%, rgba(255,255,255,.42), rgba(255,255,255,0) 38%), radial-gradient(circle at 70% 84%, rgba(0,0,0,.32), transparent 46%)"></div>';
        if (pop) el.style.animation = "t4msolidify 1.5s cubic-bezier(.25,.75,.2,1)";
      }
      return;
    }
    el.style.cssText = "position:absolute;left:-9px;top:-9px;width:18px;height:18px";
    if (el.__c !== "wlo") {
      el.__c = "wlo";
      el.innerHTML = `<svg width="100%" height="100%" viewBox="-9.5 -9.5 19 19" style="position:absolute;inset:0;overflow:visible">${sphereSVG(8, 0.4 + j * 1.1, 0.3, "wireLo")}</svg>`;
    }
  }

  /* ── state ────────────────────────────────────────────────── */

  const M = { ovKind: "alpha",
    ctx: null, root: null, stage: null, strip: null,
    nodes: [], status: [], focus: 0, vp: 0,
    sess: null,               // null | "chat" | "review"
    merge: null, pendNext: null, slowUntil: 0, glideDur: null,
    timers: { phase: 0, advance: 0, toast: 0, flash: 0, reload: 0, shake: 0, tick: 0 },
    spin: 0.6, acc: 0, pd: null,
    gen: 0, open: false, closing: false, node: null,
    chatless: false, reviewing: false, firstReview: false,
    composerMode: "answer", reviewPayload: null, record: null,
    scriptDone: false, draft: "", placeholder: "",
    tWhat: "", tCompiled: "",
    mock: false, mockTurns: 0, mockAnswers: [], skipCeremonyReload: false,
    canSend: false,
  };

  const q = (cls) => (M.root ? M.root.querySelector(cls) : null);

  const openable = (j) => M.nodes[j] && M.nodes[j].status !== "planned";

  function mapStatuses() {
    const current = M.ctx.currentNodeId();
    return M.nodes.map((n) => {
      if (M.ctx.isSettled(n.status)) return "done";
      if (n.id === current) return "next";
      return "plan";
    });
  }

  function defaultFocus() {
    const next = M.status.indexOf("next");
    if (next >= 0) return next;
    const lastDone = M.status.lastIndexOf("done");
    return lastDone >= 0 ? lastDone : 0;
  }

  /* ── build ────────────────────────────────────────────────── */

  function build(root) {
    stopTick();
    if (M.open) abortSession();
    const paths = [], nodes = [];
    for (let j = 0; j < M.nodes.length; j++) {
      paths.push(`<path data-s="${j}" fill="none" stroke-linecap="round"></path>`);
      nodes.push(`<div class="bm-node" data-n="${j}"><div class="bm-hit"></div><div class="bm-ping" data-mping></div><div data-core></div></div>`);
    }
    root.innerHTML = `
      <div class="bm-root">
        <div class="bm-stage">
          <div class="bm-strip">
            <svg width="390" height="2140" viewBox="0 0 390 2140" aria-hidden="true">
              <defs>
                <!-- Strands dissolve inside the Ω, fully gone before the
                     reading text at 2076 (fade 1990 → 2068). -->
                <linearGradient id="bmTailFade" x1="0" y1="1990" x2="0" y2="2068" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stop-color="#fff"></stop>
                  <stop offset="1" stop-color="#fff" stop-opacity="0"></stop>
                </linearGradient>
                <mask id="bmTailMask" maskUnits="userSpaceOnUse" x="-300" y="-600" width="1000" height="3600">
                  <rect x="-300" y="-600" width="1000" height="2590" fill="#fff"></rect>
                  <rect x="-300" y="1990" width="1000" height="78" fill="url(#bmTailFade)"></rect>
                </mask>
              </defs>
              <g mask="url(#bmTailMask)">${paths.join("")}<g data-mknots></g></g></svg>
            <div class="bm-omega"><div class="bm-omega-glow"></div><svg data-momw width="100%" height="100%" viewBox="-105 -105 210 210" style="position:absolute;inset:0;overflow:visible">${sphereSVG(100, 0.6, 0.35, "wire")}</svg></div>
            ${nodes.join("")}
            <div class="bm-title"></div>
            <div class="bm-time"></div>
            <div class="bm-prompt"></div>
            <div class="bm-alpha" hidden>
              <div class="bm-ao-lead" data-ao="lead"></div>
              <div class="bm-ao-body" data-ao="what"></div>
              <div class="bm-ao-body" data-ao="seven"></div>
              <div class="bm-ao-begin" data-ao="begin"></div>
              <div class="bm-ao-pause" data-ao="pause"></div>
            </div>
            <div class="bm-omread" hidden>
              <div class="bm-om-whisper"></div>
              <div class="bm-om-note"></div>
              <div class="bm-om-reading"></div>
              <div class="bm-om-actions"><span class="bm-om-export"></span></div>
              <div class="bm-om-rest"></div>
            </div>
          </div>
        </div>
        <div class="bm-topfade"></div>
        <div class="bm-head">
          <div><div class="bm-htitle"></div><div class="bm-hsub"></div></div>
          <div class="bm-count"></div>
        </div>
        <button class="bm-exit"></button>
        <button class="bm-info">◎</button>
        <div class="bm-sesshead"><div class="bm-sh-title"></div><div class="bm-sh-note"></div></div>
        <div class="bm-chat"><div class="bm-msgs"></div></div>
        <div class="bm-comp">
          <button class="bm-skip" hidden></button>
          <button class="bm-mic" hidden><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"></rect><path d="M5 11a7 7 0 0 0 14 0"></path><path d="M12 18v3"></path></svg></button>
          <textarea class="bm-input" rows="1" data-own-mic="1" disabled></textarea>
          <button class="bm-send">↑</button>
        </div>
        <div class="bm-authbar">
          <button class="bm-authorize"></button>
          <button class="bm-authamend"></button>
        </div>
        <div class="bm-tpanel">
          <div class="bm-tp-head"><span class="bm-tp-kicker"></span><button class="bm-tp-close">✕</button></div>
          <div class="bm-tbody">
            <div class="bm-tp-label" data-l1></div>
            <div class="bm-tp-what"></div>
            <div class="bm-tp-label" data-l2></div>
            <div class="bm-tp-mono"></div>
          </div>
        </div>
        <div class="bm-flash"></div>
        <div class="bm-toast"></div>
      </div>`;
    M.root = root.firstElementChild;
    M.stage = M.root.querySelector(".bm-stage");
    M.strip = M.root.querySelector(".bm-strip");

    bindPointer();
    bindChrome();
    bindKeyboardLift();
    startTick();
  }

  /* Capacitor's WKWebView is not resized by the keyboard: measure its overlap
   * via visualViewport and lift the composer/chat above it. */
  function bindKeyboardLift() {
    const vv = window.visualViewport;
    if (!vv) return;
    const apply = () => {
      if (!M.root || !M.root.isConnected) return;
      // iOS pans the layout viewport to "reveal" the focused input, shoving
      // the fixed UI off-screen. Undo the pan — the --kb lift below is what
      // keeps the composer visible, without displacing anything else.
      if (window.scrollY || document.documentElement.scrollTop || vv.offsetTop) {
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
      }
      const kb = Math.max(0, Math.round(window.innerHeight - vv.height));
      // −8 tucks the composer right against the keyboard while it is open.
      M.root.style.setProperty("--kb", kb > 0 ? `${Math.max(0, kb - 8)}px` : "0px");
      if (kb > 0) {
        const box = q(".bm-msgs");
        if (box) box.scrollTop = box.scrollHeight;
      }
    };
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    window.addEventListener("focusin", () => { setTimeout(apply, 60); setTimeout(apply, 350); });
    apply();
  }

  /* ── input model: pointer with 8px slop, flick, wheel ─────── */

  function bindPointer() {
    const st = M.stage;
    st.addEventListener("wheel", (e) => {
      if (M.sess) {
        if (!e.target.closest(".bm-chat,.bm-tpanel")) e.preventDefault();
        return;
      }
      e.preventDefault();
      if (M.omega) {
        if (M.omega !== "rest") return; // the ceremony owns the field
        M.acc += e.deltaY;
        if (M.acc < -40) { M.acc = 0; omegaExitM(); }
        else if (M.acc > 0) M.acc = 0;
        return;
      }
      if (M.merge) return; // the weave ceremony owns the field
      M.acc += e.deltaY;
      if (M.acc > 40) {
        M.acc = 0;
        if (M.focus === M.nodes.length - 1 && M.omDone && M.status[M.focus] === "done") omegaEnterM();
        else setFocus(M.focus + 1);
      } else if (M.acc < -40) { M.acc = 0; setFocus(M.focus - 1); }
    }, { passive: false });

    M.root.addEventListener("pointerdown", (e) => {
      M.pd = { x: e.clientX, y: e.clientY, node: e.target.closest(".bm-node"), moved: false };
    });
    M.root.addEventListener("pointermove", (e) => {
      if (!M.pd) return;
      if (Math.abs(e.clientY - M.pd.y) > 8 || Math.abs(e.clientX - M.pd.x) > 8) M.pd.moved = true;
    });
    M.root.addEventListener("pointercancel", () => { M.pd = null; });
    M.root.addEventListener("pointerup", (e) => {
      const pd = M.pd; M.pd = null;
      if (!pd) return;
      const dy = e.clientY - pd.y;
      if (M.sess) {
        if (pd.moved) return;
        // Tap-out no longer exits — ‹ Journey (and Esc) are the deliberate
        // ways out; an accidental tap must not end an interview. A field tap
        // folds the transparency panel; the node still toggles it.
        if (!e.target || !e.target.isConnected) return;
        if (e.target.closest(".bm-tpanel,.bm-info")) return;
        const tp = q(".bm-tpanel");
        if (tp && tp.classList.contains("on")) { tp.classList.remove("on"); return; }
        if (e.target.closest(".bm-node")) toggleTransparency();
        return;
      }
      if (M.omega) {
        // Terminal rest: a downward swipe returns to the field.
        if (M.omega === "rest" && pd.moved && dy > 34) omegaExitM();
        return;
      }
      if (M.merge) return; // no flicks or taps mid-weave
      if (pd.moved && Math.abs(dy) > 34) {
        const steps = Math.max(-3, Math.min(3, Math.round(-dy / 96))) || (dy < 0 ? 1 : -1);
        if (M.focus + steps > M.nodes.length - 1 && M.omDone && M.status[M.nodes.length - 1] === "done") {
          omegaEnterM();
          return;
        }
        setFocus(M.focus + steps);
      } else if (!pd.moved && pd.node) {
        const j = Number(pd.node.dataset.n);
        if (j === M.focus) openNode(j);
        else setFocus(j);
      }
    });
  }

  function bindChrome() {
    q(".bm-exit").addEventListener("click", () => exitSession());
    q(".bm-info").addEventListener("click", toggleTransparency);
    q(".bm-tp-close").addEventListener("click", () => q(".bm-tpanel").classList.remove("on"));
    const inp = q(".bm-input");
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    });
    inp.addEventListener("input", () => {
      autosize(inp);
      M.draft = inp.value;
    });
    q(".bm-send").addEventListener("click", send);
    q(".bm-skip").addEventListener("click", () => {
      // Sends the literal /skip; the engine closes the step gracefully when
      // nothing was shared, or ends just this topic otherwise.
      if (!M.open || M.closing || !M.canSend) return;
      if (!M.mock && !M.ctx.wsSend({ type: "answer", text: "/skip" })) return connLost();
      compose(false);
      msgEl("user", t("braid_skip_step"));
    });
    q(".bm-mic").addEventListener("click", () => {
      if (!M.open) return;
      const v = M.ctx.voice;
      if (!v?.enabled?.()) return;
      if (v.active()) v.stop(); else v.start(inp);
    });
    q(".bm-authorize").addEventListener("click", authorize);
    q(".bm-authamend").addEventListener("click", amend);
    M.strip.querySelector('.bm-alpha [data-ao="begin"]')?.addEventListener("click", beginM);
  }

  function openNode(j) {
    if (M.merge) return;
    if (!openable(j)) { lockNudge(); return; }
    openSess(j);
  }

  function lockNudge() {
    q(".bm-prompt")?.animate?.([{ opacity: 1 }, { opacity: .3 }, { opacity: 1 }], { duration: 460, easing: "ease" });
    M.strip.querySelector(`.bm-node[data-n="${M.focus}"] [data-core]`)
      ?.animate?.([{ transform: "translateX(0)" }, { transform: "translateX(-4px)" }, { transform: "translateX(4px)" }, { transform: "translateX(0)" }], { duration: 360, easing: "ease" });
  }

  /* ── layout ───────────────────────────────────────────────── */

  const esc = (s) => M.ctx.esc(s);
  const t = (k, ...a) => M.ctx.t(k, ...a);

  function updateHeader() {
    q(".bm-htitle").textContent = t("journey_title");
    q(".bm-hsub").textContent = t("braid_journey_sub");
    const done = M.status.filter((s) => s === "done").length;
    // Stage progress leads; the total stays small underneath.
    const nextIdx = M.status.indexOf("next");
    const curSector = nextIdx >= 0 ? M.nodes[nextIdx].sector : M.nodes[M.nodes.length - 1].sector;
    const inSector = M.nodes.map((n, j) => [n, j]).filter(([n]) => n.sector === curSector);
    const doneIn = inSector.filter(([, j]) => M.status[j] === "done").length;
    const sec = M.ctx.journey.sectors.find((s) => s.n === curSector);
    const phName = sec ? (M.ctx.phaseLabel(sec) || sec.label).split("·").pop().trim() : "";
    q(".bm-count").innerHTML =
      `<div class="bm-cnt-ph">${esc(t("braid_stage_of", phName, doneIn, inSector.length))}</div>`
      + `<div class="bm-cnt-tot">${done} / ${M.nodes.length}</div>`;
    q(".bm-exit").textContent = t("braid_m_back");
    q(".bm-info").title = t("transparency");
    q(".bm-authorize").textContent = t("braid_m_authorize");
    q(".bm-authamend").textContent = t("braid_m_amend_btn");
    q(".bm-tp-kicker").textContent = `◎ ${t("transparency")}`;
    q(".bm-tpanel [data-l1]").textContent = t("t_what");
    q(".bm-tpanel [data-l2]").textContent = t("t_compiled");
    const inp = q(".bm-input");
    if (inp && !M.open) inp.placeholder = t("placeholder");
  }

  function layout(instant = false) {
    if (!M.root || !M.root.isConnected) return;
    // The Ω owns the camera and thread styling while it lives.
    if (M.omega) { omegaLayoutM(); return; }
    const dur = instant ? "0s" : (M.glideDur || (Date.now() < M.slowUntil ? "1.8s" : ".75s"));
    const eas = "cubic-bezier(.2,.8,.3,1)";
    const f = M.focus;
    // Later phases recede further into the paper (extra node dim).
    const nextIdx = M.status.indexOf("next");
    const curSector = nextIdx >= 0 ? M.nodes[nextIdx].sector : Infinity;

    M.vp = Math.min(1, M.status.filter((s) => s === "done").length / 13);
    M.root.style.setProperty("--vacc", `color-mix(in srgb, var(--acc) ${Math.round(8 + 92 * M.vp)}%, var(--bm-mut))`);

    // The focus lines ride below the notch: the root is pinned to the true
    // viewport, so the safe-area inset shifts the camera, not the layout.
    const sat = parseFloat(getComputedStyle(M.root).getPropertyValue("--sat")) || 0;
    const fy = (M.sess ? FOCUS_S : FOCUS_J) + sat;
    M.strip.style.transition = `transform ${dur} ${eas}`;
    M.strip.style.transform = `translateY(${(fy - NY(f)).toFixed(0)}px)`;

    for (let j = 0; j < M.nodes.length; j++) {
      const pts = threadPts(j);
      const p = M.strip.querySelector(`[data-s="${j}"]`);
      const st = M.status[j];
      const focusPlan = j === f && st === "plan";
      if (p) {
        p.style.transition = `d ${dur} ${eas}, opacity .6s ease, stroke-width .5s ease`;
        if ("d" in p.style) p.style.d = `path("${qd(pts)}")`; else p.setAttribute("d", qd(pts));
        p.setAttribute("stroke", st === "done" ? "var(--acc)" : st === "next" ? "var(--vacc, var(--acc))" : "var(--bm-bone)");
        p.setAttribute("stroke-width", st === "next" ? "1.8" : st === "done" ? "1.4" : focusPlan ? "1.3" : "0.9");
        // α: planned threads lift to .16 while the overture lives.
        p.style.opacity = st === "done" ? (0.2 + 0.24 * M.vp).toFixed(2)
          : st === "next" ? ".42"
          : M.ov ? ".16"
          : focusPlan ? ".4" : ".1";
      }
      const nd = M.strip.querySelector(`.bm-node[data-n="${j}"]`);
      if (nd) {
        const ny = nodeYf(j, f);
        const nx = curveX(pts, ny, baseX(j, ny));
        nd.style.transition = `transform ${dur} ${eas}, opacity .45s ease`;
        nd.style.transform = `translate(${nx.toFixed(1)}px, ${ny.toFixed(1)}px)${j === f ? " scale(1.5)" : ""}`;
        nd.classList.toggle("focus", j === f);
        nd.classList.toggle("bm-future", M.nodes[j].sector > curSector);
        core(nd.querySelector("[data-core]"), st, j, Boolean(M.merge && M.merge.j === j && M.merge.phase === "solid"));
        nd.querySelector("[data-mping]").classList.toggle("on", st === "next" && !M.sess && !ovHoldM());
      }
    }

    // Focused name above / caption below, clamped into the frame.
    const focused = M.nodes[f];
    const fst = M.status[f];
    const fny = NY(f);
    const fnx = curveX(threadPts(f), fny, baseX(f, fny));
    const clx = (w) => Math.max(8, Math.min(W - w - 8, fnx - w / 2));
    const gap = 40 + (fst === "next" ? 12 : 0);
    const title = q(".bm-title"), prompt = q(".bm-prompt");
    title.textContent = M.ctx.nodeTitle(focused);
    // Server truth, not paint state — and only a DERIVED step is described as
    // waiting: the interview steps hang on the goal alone, never on each
    // other, so naming the step above them claimed an order that isn't there.
    if (focused.status === "planned" && focused.kind === "derived" && f > 0) {
      prompt.innerHTML = `<span>${esc(M.ctx.nodeDesc(focused))}</span><span class="bm-locked">${esc(t("locked_unlocks_after", M.ctx.nodeTitle(M.nodes[f - 1])))}</span>`;
    } else {
      prompt.textContent = M.merge && M.merge.j === f && M.merge.phase === "solid"
        ? t("braid_woven_in")
        : M.ctx.nodeDesc(focused);
    }
    // The time whisper — its own small object between the sphere and the
    // caption; the caption steps down to make room while it shows.
    const timeEl = q(".bm-time");
    const mins = fst !== "done" && !M.merge && focused.minutes
      ? t("braid_minutes", focused.minutes) : "";
    if (timeEl) {
      timeEl.textContent = mins;
      timeEl.style.transition = `transform ${dur} ${eas}, opacity .4s ease`;
      timeEl.style.transform = `translate(${clx(200).toFixed(1)}px, ${(fny + gap - 2).toFixed(1)}px)`;
      timeEl.style.opacity = mins ? "" : "0";
    }
    title.style.transition = `transform ${dur} ${eas}, opacity .4s ease`;
    prompt.style.transition = `transform ${dur} ${eas}, opacity .4s ease`;
    // α: the focused text constellation is withheld until the overture wakes;
    // the wake blooms it in on the slow ceremony easing.
    const timeEl2 = q(".bm-time");
    if (ovHoldM()) {
      title.style.opacity = "0";
      prompt.style.opacity = "0";
      if (timeEl2) timeEl2.style.opacity = "0";
    } else {
      if (M.ovPend) {
        M.ovPend = false;
        title.style.transition = "opacity 1.9s cubic-bezier(.3,.7,.15,1)";
        prompt.style.transition = "opacity 1.9s cubic-bezier(.3,.7,.15,1)";
      }
      title.style.opacity = "";
      prompt.style.opacity = "";
    }
    title.style.transform = `translate(${clx(300).toFixed(1)}px, ${(fny - gap - (title.offsetHeight || 28)).toFixed(1)}px)`;
    prompt.style.transform = `translate(${clx(312).toFixed(1)}px, ${(fny + gap + (mins ? 18 : 0)).toFixed(1)}px)`;

    updateHeader();
  }

  /* ── tick: oscillation + knots (33ms interval per the ref) ── */

  function startTick() {
    clearInterval(M.timers.tick);
    M.timers.tick = setInterval(() => {
      if (!M.root || !M.root.isConnected) { stopTick(); return; }
      const ts = Date.now();
      // The omega is the always-active node — stately spin, whenever visible
      // (rebuilding its wireframe below the fold is pure churn on mobile).
      const ow = M.strip.querySelector("[data-momw]");
      if (ow) {
        const or = ow.getBoundingClientRect();
        if (or.bottom > 0 && or.top < innerHeight) {
          M.omSpin = (M.omSpin || 0.6) + 0.0031;
          ow.innerHTML = sphereSVG(100, M.omSpin, 0.35, "wire");
        }
      }
      const j = M.status.indexOf("next");
      if (j >= 0 && !M.merge) {
        M.spin += 0.011;
        const ny = nodeYf(j, M.focus);
        const nx0 = baseX(j, ny);
        const dir = Math.sign(braidX(j, ny) - nx0) || 1;
        const amp = (M.sess ? 0 : 13) * (0.5 - 0.5 * Math.cos(ts * 2 * Math.PI / 6200)) * dir;
        const pts = threadPts(j, (y) => amp * Math.exp(-Math.pow((y - ny) / 165, 2)));
        const p = M.strip.querySelector(`[data-s="${j}"]`);
        if (p) { if ("d" in p.style) { p.style.transition = "opacity .6s ease"; p.style.d = `path("${qd(pts)}")`; } else p.setAttribute("d", qd(pts)); }
        const nd = M.strip.querySelector(`.bm-node[data-n="${j}"]`);
        if (nd) {
          nd.style.transition = "none";
          nd.style.transform = `translate(${curveX(pts, ny, nx0 + amp).toFixed(1)}px, ${ny.toFixed(1)}px)${j === M.focus ? " scale(1.5)" : ""}`;
          const wc = nd.querySelector("[data-wire]");
          if (wc) wc.innerHTML = sphereSVG(23, M.spin, 0.35, "wire");
        }
      }
      renderKnots();
    }, 33);
  }
  function stopTick() { clearInterval(M.timers.tick); M.timers.tick = 0; }

  /* Knots tie at each user message's vertical center, solved on the live
   * curve; text that would collide with a knot wraps clear of it. */
  function renderKnots() {
    const kg = M.strip?.querySelector("[data-mknots]");
    if (!kg) return;
    if (!M.sess || M.merge) { if (kg.innerHTML) kg.innerHTML = ""; return; }
    const pts = threadPts(M.focus);
    const sr = M.strip.getBoundingClientRect();
    if (!sr.height) return;
    const scaleY = sr.height / H, scaleX = sr.width / W;
    let out = "";
    M.root.querySelectorAll(".bm-msgs .bm-user").forEach((u) => {
      const r = u.getBoundingClientRect();
      if (!r.height) return;
      const ky = (r.top + r.height / 2 - sr.top) / scaleY;
      const kx = qxAt(pts, ky);
      if (kx == null) return;
      const kcx = sr.left + kx * scaleX;
      if (!u.__kw && r.left < kcx + 14) {
        u.__kw = true;
        u.style.maxWidth = Math.max(120, Math.round(r.right - kcx - 18)) + "px";
      }
      out += u.dataset.big
        ? `<circle cx="${kx.toFixed(1)}" cy="${ky.toFixed(1)}" r="5.5" fill="var(--acc)"></circle><circle cx="${kx.toFixed(1)}" cy="${ky.toFixed(1)}" r="11" fill="none" stroke="var(--acc)" stroke-opacity=".4"></circle>`
        : `<circle cx="${kx.toFixed(1)}" cy="${ky.toFixed(1)}" r="3.4" fill="var(--acc)"></circle>`;
    });
    kg.innerHTML = out;
  }

  /* ══ α / Ω — overture and closing ceremony ════════════════ */

  function fillAoTexts() {
    const a = M.strip && M.strip.querySelector(".bm-alpha");
    if (a) a.querySelectorAll("[data-ao]").forEach((el) => {
      el.textContent = t(`braid_${M.ovKind}_${el.dataset.ao}`);
      el.hidden = !el.textContent; // α has no pause line; Σ does
    });
  }

  /** Both moments release on wake; a session drops the hold outright. */
  const ovHoldM = () => M.ov && !M.sess && !M.ovWake;

  /** The first step that composes itself instead of being told. */
  const firstDerivedM = () => M.nodes.findIndex((n) => n.kind === "derived");

  /** Σ stands while the telling is done and the first composed bead is not. */
  function sigmaDueM() {
    const d = firstDerivedM();
    if (d <= 0 || M.omega) return false;
    return M.nodes.slice(0, d).every((n) => M.ctx.isSettled(n.status))
      && !M.ctx.isSettled(M.nodes[d].status) && M.status[d] !== "done";
  }

  function overtureOpenM(kind) {
    M.ovKind = kind;
    M.ov = true;
    M.ovWake = false;
    M.ovDone = false;
    const a = M.strip && M.strip.querySelector(".bm-alpha");
    if (!a) return;
    fillAoTexts();
    // Strip coordinates, so the copy follows the bead its moment belongs to.
    const at = kind === "sigma" ? firstDerivedM() : 0;
    a.style.top = (NY(Math.max(0, at)) + 140) + "px";
    a.hidden = false;
    a.style.opacity = "1";
    const dl = { lead: 0.3, what: 1.2, seven: 2.1, begin: 3.1, pause: 3.9 };
    a.querySelectorAll("[data-ao]").forEach((el) => {
      el.style.animation = "none";
      void el.offsetWidth;
      el.style.animation = `mfloatIn 1s ${dl[el.dataset.ao] || 0.3}s both`;
    });
    clearTimeout(M.timers.aoWake);
    M.timers.aoWake = setTimeout(wakeM, 5000);
    layout();
  }

  function wakeM() {
    if (!M.ov || M.ovDone || M.ovWake || M.sess) return;
    M.ovWake = true;
    M.ovPend = true;
    M.slowUntil = Date.now() + 1900;
    layout();
  }

  function beginM(e) {
    if (e) e.stopPropagation();
    if (M.sess || M.ovDone) return;
    const first = !M.ovWake;
    M.ovWake = true;
    if (first) M.ovPend = true;
    M.slowUntil = Date.now() + 1900;
    const at = Math.max(0, M.ovKind === "sigma" ? firstDerivedM() : 0);
    if (M.focus !== at) setFocus(at); else layout();
    const core0 = M.strip && M.strip.querySelector(`.bm-node[data-n="${at}"] [data-core]`);
    if (core0 && core0.animate) {
      core0.animate(
        [{ transform: "scale(1)" }, { transform: "scale(1.15)" }, { transform: "scale(1)" }],
        { duration: 650, easing: "ease-in-out" },
      );
    }
  }

  function aoDismissM() {
    if (M.ovDone) return;
    M.ovDone = true;
    M.ov = false;
    clearTimeout(M.timers.aoWake);
    const a = M.strip && M.strip.querySelector(".bm-alpha");
    if (a) {
      a.style.opacity = "0";
      setTimeout(() => { a.hidden = true; }, 1400);
    }
    if (M.ovKind !== "sigma") M.ctx?.setFlag?.("overture_done");
  }

  function omegaLayoutM() {
    const strip = M.strip;
    if (!strip) return;
    const vh = (M.root && M.root.clientHeight) || 844;
    strip.style.transition = M.omega === "descend"
      ? "transform 2.6s cubic-bezier(.3,.7,.15,1)"
      : "transform 1.05s cubic-bezier(.32,.72,.16,1)";
    strip.style.transform = `translate(0px, ${(vh * 0.42 - OMY).toFixed(0)}px)`;
    strip.querySelectorAll("path[data-s]").forEach((p) => {
      p.style.transition = "opacity 2.2s ease, stroke-width .8s ease";
      p.style.opacity = ".5";
      p.setAttribute("stroke-width", "1.4");
    });
  }

  function omegaReadingM() {
    const rd = M.strip && M.strip.querySelector(".bm-omread");
    if (!rd) return;
    const idn = M.nodes.find((n) => n.id === "identity_statement");
    const lp = M.nodes.find((n) => n.id === "life_portrait");
    const text = idn?.distilled?.[0]?.text || lp?.distilled?.[0]?.text || "";
    rd.querySelector(".bm-om-whisper").textContent = t("braid_omega_whisper");
    rd.querySelector(".bm-om-note").textContent = t("braid_omega_note");
    rd.querySelector(".bm-om-reading").textContent = text ? `«${text}»` : "";
    rd.querySelector(".bm-om-rest").textContent = t("braid_omega_rest_m");
    const ex = rd.querySelector(".bm-om-export");
    ex.textContent = t("braid_omega_export");
    if (!ex.__bound) {
      ex.__bound = true;
      ex.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (ex.__busy) return;
        ex.__busy = 1;
        ex.textContent = t("braid_omega_exporting");
        try { await M.ctx.exportPdf(); } catch { /* canceled */ }
        ex.textContent = t("braid_omega_export");
        ex.__busy = 0;
      });
    }
    rd.hidden = false;
  }

  function omegaCeremonyM() {
    const last = M.nodes.length - 1;
    M.omega = "descend";
    M.focus = last;
    if (M.root) M.root.dataset.omg = "1";
    omegaLayoutM();
    clearTimeout(M.timers.omT1);
    clearTimeout(M.timers.omT2);
    clearTimeout(M.timers.omT3);
    M.timers.omT1 = setTimeout(() => {
      M.omega = "pour";
      M.merge = { j: last, phase: "omega" };
      shake(last, 1800);
      flash();
    }, 2750);
    M.timers.omT2 = setTimeout(() => {
      M.merge = null;
      omegaReadingM();
    }, 4400);
    M.timers.omT3 = setTimeout(() => {
      M.omega = "rest";
      M.omDone = true;
      M.ctx?.setFlag?.("omega_done");
    }, 5700);
  }

  function omegaEnterM() {
    if (M.omega || !M.omDone) return;
    M.omega = "rest";
    if (M.root) M.root.dataset.omg = "1";
    omegaReadingM();
    omegaLayoutM();
  }

  function omegaExitM() {
    if (!M.omega) return;
    M.omega = null;
    if (M.root) delete M.root.dataset.omg;
    const rd = M.strip && M.strip.querySelector(".bm-omread");
    if (rd) rd.hidden = true;
    layout();
  }

  /* ── focus / ceremony ─────────────────────────────────────── */

  function setFocus(i) {
    clearTimeout(M.timers.phase);
    clearTimeout(M.timers.advance);
    const ceremonial = M.merge !== null || M.pendNext != null;
    M.merge = null;
    delete M.root?.dataset.merge;
    const p = M.pendNext;
    if (p != null) {
      M.pendNext = null;
      if (p < M.nodes.length && M.status[p] === "plan") M.status[p] = "next";
    }
    M.focus = Math.max(0, Math.min(M.nodes.length - 1, i));
    layout();
    if (ceremonial) {
      if (M.skipCeremonyReload) { M.skipCeremonyReload = false; return; }
      clearTimeout(M.timers.reload);
      M.timers.reload = setTimeout(() => M.ctx.reload(), 1300);
    }
  }

  function weave(j) {
    if (M.merge) return;
    if (M.ov && !M.ovDone) aoDismissM(); // the first weave ends the overture
    M.status[j] = "done";
    M.pendNext = j + 1;
    M.merge = { j, phase: "travel" };
    M.root.dataset.merge = "1";
    M.slowUntil = Date.now() + 1900;
    const core0 = M.strip.querySelector(`.bm-node[data-n="${j}"] [data-core]`);
    if (core0) core0.__c = "wire2"; // travel keeps the wireframe; solid pops later
    layout();
    setSessNote(t("braid_m_weaving"));
    M.timers.phase = setTimeout(() => {
      M.merge = { j, phase: "solid" };
      const c = M.strip.querySelector(`.bm-node[data-n="${j}"] [data-core]`);
      if (c) core(c, "done", j, true);
      shake(j);
      flash();
      toast(t("braid_m_toast"));
      const prompt = q(".bm-prompt");
      if (prompt && M.focus === j) prompt.textContent = t("braid_woven_in");
    }, 1750);
    M.timers.advance = setTimeout(() => {
      M.merge = null;
      delete M.root.dataset.merge;
      M.strip.querySelectorAll("[data-cur]").forEach((el) => { delete el.dataset.cur; });
      const kg = M.strip.querySelector("[data-mknots]");
      if (kg) kg.innerHTML = "";
      endSessionState();
      delete M.root.dataset.sess;
      // The braid is whole: the Ω ceremony takes the advance's place.
      if (j === M.nodes.length - 1 && M.status.every((s) => s === "done")) {
        M.pendNext = null;
        omegaCeremonyM();
        if (M.skipCeremonyReload) M.skipCeremonyReload = false; // mock: local only
        else {
          clearTimeout(M.timers.reload);
          M.timers.reload = setTimeout(() => M.ctx.reload(), 6100);
        }
        return;
      }
      M.glideDur = "1.15s"; // ONE combined glide to the woken node
      const nx = Math.min(M.nodes.length - 1, j + 1);
      if (nx !== M.focus || M.pendNext != null) setFocus(nx); else layout();
      M.glideDur = null;
      // Σ fires the moment the weave completes the telling; the boot rule
      // re-raises it on any later open until the first composed bead weaves.
      if (!M.ov) {
        const d = firstDerivedM();
        if (d > 0 && j < d && M.status.slice(0, d).every((st) => st === "done") && M.status[d] !== "done") {
          overtureOpenM("sigma");
        }
      }
    }, 3600);
  }

  function shake(j, originY) {
    clearInterval(M.timers.shake);
    const t0 = Date.now(), dur = 1000, ny = originY ?? NY(j);
    M.timers.shake = setInterval(() => {
      const e = (Date.now() - t0) / dur;
      if (e >= 1 || !M.merge || M.merge.j !== j) {
        clearInterval(M.timers.shake);
        if (M.root?.isConnected) layout();
        return;
      }
      const amp = Math.sin(e * Math.PI) * Math.exp(-e * 1.6) * 15 * Math.sin(e * 25);
      for (let k = 0; k < M.nodes.length; k++) {
        if (M.status[k] !== "done") continue;
        const a2 = k === j ? amp : amp * 0.35;
        const pts = threadPts(k, (y) => a2 * Math.exp(-Math.pow((y - ny) / 190, 2)));
        const p = M.strip.querySelector(`[data-s="${k}"]`);
        if (p) { p.style.transition = "none"; if ("d" in p.style) p.style.d = `path("${qd(pts)}")`; else p.setAttribute("d", qd(pts)); }
        const nd = M.strip.querySelector(`.bm-node[data-n="${k}"]`);
        if (nd) {
          const nyk = nodeYf(k, M.focus);
          nd.style.transition = "none";
          nd.style.transform = `translate(${curveX(pts, nyk, baseX(k, nyk)).toFixed(1)}px, ${nyk.toFixed(1)}px)${k === M.focus ? " scale(1.5)" : ""}`;
        }
      }
    }, 33);
  }

  function flash() {
    const fl = q(".bm-flash");
    if (fl) {
      fl.style.setProperty("--fy", `${Math.round(FOCUS_S / M.root.clientHeight * 100)}%`);
      fl.animate([{ opacity: 0 }, { opacity: .9, offset: .15 }, { opacity: 0 }], { duration: 900, easing: "ease-out" });
    }
    M.stage.style.transition = "filter .55s ease";
    M.stage.style.filter = "saturate(1.6) contrast(1.06) brightness(1.13)";
    clearTimeout(M.timers.flash);
    M.timers.flash = setTimeout(() => {
      M.stage.style.transition = "filter 2.4s ease";
      M.stage.style.filter = "none";
    }, 750);
  }

  function toast(text) {
    const el = q(".bm-toast");
    if (!el) return;
    el.textContent = text;
    el.classList.add("on");
    clearTimeout(M.timers.toast);
    M.timers.toast = setTimeout(() => el.classList.remove("on"), 1300);
  }

  /* ── session (real WS through the ctx seam) ───────────────── */

  function msgEl(kind, text, html) {
    const box = q(".bm-msgs");
    if (!box) return null;
    const d = document.createElement("div");
    d.className = `bm-${kind}`;
    if (html !== undefined) d.innerHTML = html; else d.textContent = text;
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
    return d;
  }

  function statusMsg(text) {
    const box = q(".bm-msgs");
    if (!box) return;
    const st = box.querySelector("[data-mstatus]");
    if (st) { st.textContent = text; box.scrollTop = box.scrollHeight; }
    else { const d = msgEl("note", text); if (d) d.dataset.mstatus = "1"; }
  }

  function setSessNote(text) {
    const el = q(".bm-sh-note");
    if (el) el.textContent = text;
  }

  function composerBars() {
    q(".bm-comp")?.classList.toggle("on", M.sess === "chat" && !M.scriptDone && !M.merge);
    q(".bm-authbar")?.classList.toggle("on", M.sess === "chat" && M.scriptDone && !M.merge);
  }

  const coarse = matchMedia("(pointer: coarse)").matches;

  /* One sizing rule for typing, dictation, and draft restore: grow to 40% of
   * the viewport, then the field scrolls internally. */
  function autosize(inp) {
    inp = inp || q(".bm-input");
    if (!inp) return;
    const cap = Math.round(((M.root && M.root.clientHeight) || 844) * 0.4);
    inp.style.height = "42px";
    const h = Math.min(cap, Math.max(42, inp.scrollHeight));
    inp.style.height = h + "px";
    // The chat floor rides up with the growing field (see .bm-chat bottom).
    if (M.root) M.root.style.setProperty("--bm-grow", (h - 42) + "px");
    // The floor just moved: without this the newest words stay behind the
    // field the client is typing into, and look truncated mid-sentence.
    const box = q(".bm-msgs");
    if (box) box.scrollTop = box.scrollHeight;
  }

  /* Three pulsing dots + a rotating phrase while the counselor reads or
   * composes. `start` picks the opening phrase; `rot=false` (mock's scripted
   * beats) keeps the static "Thinking…" only. */
  function showThink(start = 0, rot = true) {
    const box = q(".bm-msgs");
    if (!box || box.querySelector("[data-mthink]")) return;
    const d = document.createElement("div");
    d.className = "bm-think";
    d.dataset.mthink = "1";
    d.innerHTML = '<span></span><span></span><span></span><em class="bm-think-phrase"></em>';
    const ph = d.querySelector(".bm-think-phrase");
    const pool = () => t("braid_think_pool");
    let i = rot ? start % pool().length : 0;
    ph.textContent = pool()[i];
    if (rot) {
      d.__rot = setInterval(() => {
        ph.style.opacity = "0";
        ph.style.transform = "translateY(3px)";
        setTimeout(() => {
          i = (i + 1) % pool().length;
          ph.textContent = pool()[i];
          ph.style.opacity = "";
          ph.style.transform = "";
        }, 300);
      }, 2000);
    }
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
  }
  function clearThink() {
    const el = q(".bm-msgs")?.querySelector("[data-mthink]");
    if (el) { clearInterval(el.__rot); el.remove(); }
  }

  /* iOS raises the keyboard only on user-gesture focus, and dismisses it when
   * the field is disabled — so on touch devices the input stays enabled and
   * unfocused-by-code; `on` gates SENDING (button + Enter), not the field. */
  function compose(on, placeholder) {
    const inp = q(".bm-input");
    if (!inp) return;
    M.canSend = on;
    const sk = q(".bm-skip");
    if (sk) {
      sk.textContent = t("braid_skip_step");
      sk.hidden = !(on && M.composerMode !== "amend" && M.nodes[M.idx]?.skippable);
    }
    if (coarse) {
      inp.disabled = false;
      inp.style.opacity = "1";
    } else {
      inp.disabled = !on;
      inp.style.opacity = on ? "1" : ".45";
    }
    const send = q(".bm-send");
    if (send) { send.disabled = !on; send.style.opacity = on ? "1" : ".4"; }
    if (placeholder) { inp.placeholder = placeholder; M.placeholder = placeholder; }
    if (on) {
      if (!inp.value && M.draft) inp.value = M.draft;
      autosize(inp);
      // Desktop-narrow only: the accent caret draws the eye. On touch, a
      // programmatic focus would break the next tap's keyboard.
      if (!coarse) setTimeout(() => { if (M.open) inp.focus({ preventScroll: true }); }, 480);
    }
  }

  function connLost() {
    compose(false);
    msgEl("note", t("conn_closed"));
    q(".bm-authorize") && (q(".bm-authorize").disabled = false);
  }

  function send() {
    const inp = q(".bm-input");
    const text = inp && inp.value.trim();
    if (!text || !M.open || M.closing || !M.canSend) return;
    if (!M.mock) {
      const payload = M.composerMode === "amend"
        ? { type: "review_action", action: "feedback", text }
        : { type: "answer", text };
      if (!M.ctx.wsSend(payload)) return connLost();
    }
    inp.value = "";
    M.ctx.voice?.sent?.(); // the dictation turn went with the message
    M.draft = "";
    autosize(inp);
    compose(false);
    msgEl("user", text);
    if (M.mock) { mockTurn(text); return; }
    // An amend note opens a conversation — the counselor confirms before any
    // revision, so the "revising…" whisper waits for the server's own note.
    if (M.composerMode === "amend") M.composerMode = "answer";
    showThink(1); // cleared by whatever arrives next
  }

  /* Keyless mock: a scripted counselor that keeps the whole interaction —
   * keyboard, send, knots, draft, authorize ceremony — testable. The user's
   * own words become the draft, verbatim; nothing is saved. */
  function mockTurn(text) {
    M.mockAnswers.push(text);
    M.mockTurns++;
    showThink(0, false); // scripted beat: dots + "Thinking…" only
    setTimeout(() => {
      if (!M.open || !M.mock) return;
      clearThink();
      if (M.mockTurns < 2) {
        msgEl("say", t("braid_m_mock_ack"));
        setTimeout(() => { if (M.open) { compose(true, t("placeholder")); } }, 400);
      } else {
        statusMsg(t("braid_m_draft_ready"));
        const wrap = document.createElement("div");
        wrap.dataset.mdraft = "1";
        wrap.style.display = "contents";
        let html = `<div class="bm-story">${M.mockAnswers.map((a) => esc(a)).join(" ")}</div>`;
        for (const a of M.mockAnswers) html += `<div class="bm-user bm-frag" data-big="1">«<span>${esc(a)}</span>»</div>`;
        wrap.innerHTML = html;
        const box = q(".bm-msgs");
        if (box) { box.appendChild(wrap); box.scrollTop = box.scrollHeight; }
        M.scriptDone = true;
        setSessNote(t("braid_m_st_ready"));
        composerBars();
      }
    }, 700);
  }

  function authorize() {
    if (M.mock) {
      q(".bm-authorize").disabled = true;
      q(".bm-authamend").disabled = true;
      setSessNote(t("braid_m_weaving"));
      const j = M.focus;
      M.skipCeremonyReload = true; // mock weaves are local — a reload would revert them mid-glide
      weave(j);
      return;
    }
    if (!M.reviewPayload) return;
    const m = { type: "review_action", action: "authorize" };
    if (M.reviewPayload.mode === "candidates") m.value = M.reviewPayload.candidates[0] ?? "";
    if (!M.ctx.wsSend(m)) return connLost();
    q(".bm-authorize").disabled = true;
    q(".bm-authamend").disabled = true;
    setSessNote(t("braid_m_weaving"));
  }

  function amend() {
    if (M.mock) {
      M.scriptDone = false;
      M.mockTurns = Math.max(0, M.mockTurns - 1);
      q(".bm-msgs")?.querySelector("[data-mdraft]")?.remove();
      composerBars();
      compose(true, t("amend_placeholder"));
      return;
    }
    if (!M.ctx.wsLive()) return connLost();
    M.composerMode = "amend";
    M.scriptDone = false;
    composerBars();
    compose(true, t("amend_placeholder"));
  }

  /* The review draft (chat mode): story + verbatim fragments + authorize bar. */
  function renderDraft(payload) {
    M.reviewPayload = payload;
    const box = q(".bm-msgs");
    if (!box) return;
    box.querySelector("[data-mdraft]")?.remove();
    box.querySelector("[data-mstatus]")?.remove();
    const ctx = M.ctx;
    const quotes = payload.verified_quotes ?? [];
    const wrap = document.createElement("div");
    wrap.dataset.mdraft = "1";
    wrap.style.display = "contents";
    const story = payload.mode === "candidates"
      ? ctx.markVerbatim(payload.candidates[0] ?? "", quotes)
      : ctx.renderFields(payload.draft, quotes, payload.warnings ?? [], { order: payload.field_order, playbook: M.nodes[M.idx]?.id });
    let html = `<div class="bm-note">${esc(t("braid_m_draft_ready"))}</div><div class="bm-story">${story}</div>`;
    for (const qt of quotes) html += `<div class="bm-user bm-frag" data-big="1">«<span>${esc(qt)}</span>»</div>`;
    wrap.innerHTML = html;
    box.appendChild(wrap);
    box.scrollTop = box.scrollHeight;
    M.scriptDone = true;
    q(".bm-authorize").disabled = false;
    q(".bm-authamend").disabled = false;
    setSessNote(t("braid_m_st_ready"));
    compose(false);
    composerBars();
  }

  /* Review-in-place (woven bead): authored story + fragments + transcript
   * toggle + Amend / Continue. */
  function reviewFill(payload) {
    M.reviewPayload = payload;
    const box = q(".bm-msgs");
    if (!box) return;
    box.querySelector("[data-mdraft]")?.remove();
    const ctx = M.ctx;
    const quotes = payload.verified_quotes ?? [];
    const wrap = document.createElement("div");
    wrap.dataset.mdraft = "1";
    wrap.style.display = "contents";
    const story = payload.mode === "candidates"
      ? ctx.markVerbatim(payload.candidates[0] ?? "", quotes)
      : ctx.renderFields(payload.draft, quotes, payload.warnings ?? [], { order: payload.field_order, playbook: M.nodes[M.idx]?.id });
    const hasRecord = Boolean(M.record?.length);
    let html = `<div class="bm-note${hasRecord ? " bm-hist-toggle" : ""}" data-mwhisper>${esc(t("braid_authored_whisper"))}${hasRecord ? "  ▸" : ""}</div>`;
    html += `<div class="bm-story">${story}</div>`;
    for (const qt of quotes) html += `<div class="bm-user bm-frag" data-big="1">«<span>${esc(qt)}</span>»</div>`;
    const nextIdx = M.status.indexOf("next");
    html += `<div class="bm-acts"><button class="bm-act" data-mamend>${esc(t("braid_amend"))}</button>`
      + `<button class="bm-act bm-danger" data-mreset>${esc(t("braid_start_over"))}</button>`
      + (nextIdx >= 0 ? `<button class="bm-act accent" data-mcont>${esc(t("braid_m_continue"))}</button>` : "")
      + "</div>";
    wrap.innerHTML = html;
    box.appendChild(wrap);
    box.scrollTop = 0;
    setSessNote(t("braid_m_st_woven"));
    if (hasRecord) wrap.querySelector("[data-mwhisper]").addEventListener("click", toggleHist);
    // Starting over erases the client's own words, so the button asks twice:
    // the first tap arms it and says what will go, the second does it.
    const rst = wrap.querySelector("[data-mreset]");
    const rstLabel = rst.textContent;
    rst.addEventListener("click", () => {
      if (!rst.classList.contains("armed")) {
        rst.classList.add("armed");
        rst.textContent = t("braid_start_over_confirm");
        setTimeout(() => {
          if (!rst.isConnected || !rst.classList.contains("armed")) return;
          rst.classList.remove("armed");
          rst.textContent = rstLabel;
        }, 5000);
        return;
      }
      rst.disabled = true;
      const id = M.nodes[M.idx].id;
      exitSession(false);
      M.ctx.resetNode(id);
    });
    wrap.querySelector("[data-mamend]").addEventListener("click", () => {
      if (!M.ctx.wsLive()) return connLost();
      M.sess = "chat";
      M.scriptDone = false;
      M.composerMode = "amend";
      M.firstReview = false;
      composerBars();
      compose(true, t("amend_placeholder"));
    });
    wrap.querySelector("[data-mcont]")?.addEventListener("click", () => {
      exitSession(false);
      setTimeout(() => setFocus(nextIdx), 380);
    });
  }

  function toggleHist(e) {
    const note = e.currentTarget;
    const label = esc(t("braid_authored_whisper"));
    const ex = note.parentElement?.querySelector("[data-mhist]");
    if (ex) { ex.remove(); note.innerHTML = `${label}  ▸`; return; }
    const w = document.createElement("div");
    w.dataset.mhist = "1";
    w.className = "bm-hist";
    // The full session log, amends included, with a divider per amend run.
    let inAmend = false;
    for (const turn of M.record ?? []) {
      const isAmend = String(turn.phase ?? "").startsWith("amend");
      if (isAmend && !inAmend) {
        const n = document.createElement("div");
        n.className = "bm-note";
        n.style.animation = "none";
        n.textContent = t("braid_amend_divider");
        w.appendChild(n);
      }
      inAmend = isAmend;
      const d = document.createElement("div");
      d.className = turn.speaker === "user" ? "bm-user" : "bm-say";
      d.style.animation = "none";
      // The record reads like the conversation did: the counselor's emphasis
      // renders, the client's words stay exactly as they were typed.
      if (turn.speaker === "user") d.textContent = turn.text;
      else d.innerHTML = M.ctx?.prose?.(turn.text) ?? esc(turn.text);
      w.appendChild(d);
    }
    note.after(w);
    note.innerHTML = `${label}  ▾`;
  }

  function toggleTransparency() {
    const tp = q(".bm-tpanel");
    if (!tp) return;
    if (!tp.classList.contains("on")) {
      q(".bm-tp-what").textContent = M.tWhat;
      q(".bm-tp-mono").innerHTML = M.tCompiled;
    }
    tp.classList.toggle("on");
  }

  /* ── the WS surface ───────────────────────────────────────── */

  const surface = {
    say(text, anchor) {
      clearThink();
      if (anchor) msgEl("note", t("anchor_label"));
      msgEl("say", text, M.ctx.prose?.(text));
    },
    note(text) {
      const localized = M.ctx.localizeNote(text);
      if (M.reviewing || M.chatless || M.scriptDone) statusMsg(localized);
      else msgEl("note", localized);
      // Model-work notes keep or start the loader without resetting the
      // phrase rotation; arriving words (say/review) clear it.
      if (M.reviewing || M.chatless || M.scriptDone
        || /^\((inducing|revising|the conversation is complete)/.test(text)) showThink();
    },
    error(text) { clearThink(); msgEl("error", text); },
    ask(prompt) {
      clearThink();
      M.composerMode = "answer";
      M.scriptDone = false;
      composerBars();
      const ph = prompt && prompt.includes("esume") ? t("placeholder_resume")
        : prompt && prompt !== "you" ? prompt : t("placeholder");
      compose(true, ph);
      // An amend conversation over a woven bead is not an interview — keep
      // the "Woven · authored" header note.
      if (!M.reviewing) setSessNote(t("braid_m_st_int"));
    },
    review(payload) {
      clearThink();
      // existing stays true through a withdrawn amend — re-present as the
      // authored passage; only a real re-draft opens the editable card.
      if (M.reviewing && payload.existing) { M.firstReview = false; reviewFill(payload); }
      else { M.sess = "chat"; M.firstReview = false; renderDraft(payload); }
    },
    done(outcome) {
      if (outcome === "authorized") {
        // A re-authorized woven bead (amended or not) never re-runs the
        // ceremony — it was woven the moment the session opened for review.
        if (M.reviewing) {
          M.ctx.closeWs();
          exitSession();
          return;
        }
        const j = M.focus;
        M.ctx.closeWs();
        weave(j);
      } else msgEl("note", t("session_saved", outcome));
    },
    closed() {
      if (!M.open || M.closing || M.merge) return;
      compose(false);
      msgEl("note", t("conn_closed"));
    },
  };

  /* ── session open/close ───────────────────────────────────── */

  async function openSess(j) {
    if (M.open || !M.root) return;
    const ctx = M.ctx;
    const node = M.nodes[j];
    if (!node) return;
    const my = ++M.gen;
    M.open = true;
    M.closing = false;
    M.node = node;
    M.focus = j;
    M.reviewPayload = null;
    M.record = null;
    M.draft = "";
    M.composerMode = "answer";
    M.scriptDone = false;
    M.chatless = node.kind === "derived";
    M.reviewing = ctx.isSettled(node.status) || M.status[j] === "done";
    M.firstReview = M.reviewing;
    M.sess = M.reviewing ? "review" : "chat";
    // Keyless chat runs as a mock so the interaction stays fully testable.
    M.mock = !M.reviewing && (!ctx.journey.ai || localStorage.getItem("braidmock") === "1");
    M.mockTurns = 0;
    M.mockAnswers = [];
    M.tWhat = "";
    M.tCompiled = "";

    M.root.dataset.sess = "1";
    const pth = M.strip.querySelector(`[data-s="${j}"]`);
    if (pth) pth.dataset.cur = "1";
    const nd = M.strip.querySelector(`.bm-node[data-n="${j}"]`);
    if (nd) nd.dataset.cur = "1";
    layout();

    q(".bm-msgs").innerHTML = "";
    q(".bm-sh-title").textContent = ctx.nodeTitle(node);
    setSessNote(M.reviewing ? t("braid_m_st_woven") : t("braid_m_st_int"));
    const mic = q(".bm-mic");
    if (mic) mic.hidden = !ctx.voice?.enabled?.();
    compose(false, ctx.t("placeholder"));
    composerBars();
    if (M.chatless && !M.reviewing) statusMsg(ctx.localizeNote(t("status_preparing")));

    fetch(`/api/playbook/${node.id}?lang=${ctx.lang}`)
      .then((r) => r.json())
      .then((pb) => {
        if (!M.open || M.gen !== my) return;
        M.tWhat = (ctx.lang !== "en" ? `${t("playbook_lang_note")}\n\n` : "") + pb.purpose;
        M.tCompiled = ctx.compiledHtml(pb.compiled);
        const tp = q(".bm-tpanel");
        if (tp?.classList.contains("on")) {
          q(".bm-tp-what").textContent = M.tWhat;
          q(".bm-tp-mono").innerHTML = M.tCompiled;
        }
      })
      .catch(() => {});

    let resuming = false;
    if (node.kind === "conversation" && (M.reviewing || node.status === "in_progress")) {
      try {
        const res = await fetch(ctx.api(`/api/session/${node.id}`));
        if (!M.open || M.gen !== my) return;
        if (res.ok) {
          const saved = await res.json();
          if (!M.open || M.gen !== my) return;
          M.record = saved.exchange ?? [];
          if (!M.reviewing) {
            for (const e2 of M.record) {
              const d = msgEl(e2.speaker === "user" ? "user" : "say", e2.text);
              if (d) d.style.animation = "none";
            }
            if (M.record.length) { msgEl("note", t("resumed_note")); resuming = true; }
          }
        }
      } catch { /* fresh start */ }
    }
    if (!M.open || M.gen !== my) return;

    if (M.mock) {
      // No backend: scripted counselor. The step's caption is the question.
      msgEl("note", t("braid_m_mock_note"));
      setTimeout(() => {
        if (!M.open || M.gen !== my) return;
        msgEl("say", ctx.nodeDesc(node));
        compose(true, t("placeholder"));
        setSessNote(t("braid_m_st_int"));
      }, 600);
      return;
    }

    ctx.connect(node.id, { resuming, review: M.reviewing, surface });
  }

  function endSessionState() {
    M.gen++;
    M.ctx?.stopDictation?.();
    M.open = false;
    M.closing = false;
    M.sess = null;
    M.reviewPayload = null;
    M.scriptDone = false;
    const box = q(".bm-msgs");
    if (box) box.innerHTML = "";
    q(".bm-tpanel")?.classList.remove("on");
    q(".bm-comp")?.classList.remove("on");
    q(".bm-authbar")?.classList.remove("on");
    const kg = M.strip?.querySelector("[data-mknots]");
    if (kg) kg.innerHTML = "";
  }

  function exitSession(reload = true) {
    if (!M.open || M.closing) return;
    const ctx = M.ctx;
    ctx.closeWs();
    if (M.merge) { // leaving mid-ceremony cancels the dwell and promotes now
      clearTimeout(M.timers.phase);
      clearTimeout(M.timers.advance);
      clearInterval(M.timers.shake);
      M.merge = null;
      delete M.root?.dataset.merge;
      if (M.pendNext != null && M.status[M.pendNext] === "plan") { M.status[M.pendNext] = "next"; M.pendNext = null; }
    }
    endSessionState();
    if (M.root) {
      delete M.root.dataset.sess;
      M.strip.querySelectorAll("[data-cur]").forEach((el) => { delete el.dataset.cur; });
    }
    if (M.root?.isConnected) layout();
    if (reload) ctx.reload();
  }

  function abortSession() {
    M.gen++;
    Object.values(M.timers).forEach((id) => { clearTimeout(id); clearInterval(id); });
    M.ctx?.closeWs?.();
    M.ctx?.stopDictation?.();
    M.open = false;
    M.closing = false;
    M.sess = null;
    M.merge = null;
    M.pendNext = null;
  }

  /* ── global hooks ─────────────────────────────────────────── */

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !M.root?.isConnected) return;
    if (M.omega === "rest") { omegaExitM(); return; }
    const tp = q(".bm-tpanel");
    if (tp?.classList.contains("on")) { tp.classList.remove("on"); return; }
    if (M.open && !M.closing) exitSession();
  });

  document.addEventListener("cc-voice-state", (e) => {
    if (!M.open || !M.root?.isConnected) return;
    const mic = q(".bm-mic");
    if (!mic) return;
    const listening = e.detail === "connecting" || e.detail === "rec";
    mic.classList.toggle("listening", listening);
    mic.classList.toggle("err", e.detail === "error");
    const inp = q(".bm-input");
    if (inp) inp.placeholder = listening ? t("braid_listening") : (M.placeholder || t("placeholder"));
  });

  const narrow = matchMedia("(max-width: 899px)");
  narrow.addEventListener?.("change", () => {
    if (M.open) abortSession();
    if (M.ctx) M.ctx.reload();
  });

  /* ── public seam ──────────────────────────────────────────── */

  function renderJourney(root, ctx) {
    M.ctx = ctx;
    M.nodes = ctx.journey.nodes;
    const rebuild = !M.root || !M.root.isConnected || M.root.parentElement !== root
      || M.strip.querySelectorAll(".bm-node").length !== M.nodes.length;
    if (!M.merge && !M.open) {
      const fresh = mapStatuses();
      const changed = rebuild || fresh.join() !== M.status.join();
      M.status = fresh;
      if (changed) M.focus = defaultFocus();
    }
    if (rebuild) {
      build(root);
      layout(true);
      requestAnimationFrame(() => layout(true));
    } else layout();
    fillAoTexts();
    // α/Ω boot — mirrors the desktop braid.
    const flags = ctx.journey.flags ?? {};
    M.omDone = Boolean(flags.omega_done);
    if (M.ovProfile !== ctx.profile) { // per-journey moments, module state
      M.ovProfile = ctx.profile;
      M.ov = false; M.ovDone = false; M.ovKind = "alpha";
      clearTimeout(M.timers.aoWake);
      const oa = M.strip && M.strip.querySelector(".bm-alpha");
      if (oa) { oa.hidden = true; oa.style.opacity = "0"; }
    }
    if (!flags.overture_done && ctx.journey.authorized === 0 && !M.ov) overtureOpenM("alpha");
    else if (M.ov && M.ovKind === "alpha" && ctx.journey.authorized > 0) aoDismissM();
    else if (M.ov && M.ovKind === "sigma" && !sigmaDueM()) aoDismissM(); // woven meanwhile
    else if (!M.ov && sigmaDueM()) overtureOpenM("sigma");
    if (rebuild && M.omega) omegaLayoutM();
  }

  function openAny(id, ctx) {
    const j = M.nodes.findIndex((n) => n.id === id);
    if (j < 0 || !M.root?.isConnected) return;
    M.ctx = ctx;
    if (j !== M.focus) setFocus(j);
    openSess(j);
  }

  return {
    ready: true,
    active() {
      if (!this.ready) return false;
      if (localStorage.getItem("braidm") === "0") return false;
      return Boolean(window.Capacitor?.isNativePlatform?.()) || matchMedia("(max-width: 899px)").matches;
    },
    renderJourney,
    openSession: openAny,
    abortSession() { if (M.open) abortSession(); },
    _debug: () => ({ open: M.open, sess: M.sess, focus: M.focus, merge: Boolean(M.merge), status: M.status.join(","), reviewing: M.reviewing }),
    _knots: () => { renderKnots(); return M.strip?.querySelector("[data-mknots]")?.childElementCount ?? -1; },
  };
})();
