// Generates the app icon: the braid's authored bead — a level-2 geodesic
// wireframe with a pine pigment core, threaded on its string, on paper.
// Same math as public/braid.js (icosahedron subdivision, rotY/rotX, mild
// perspective). Output: app/icon.svg (1024×1024).
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function geoSphere(level) {
  const nrm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
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
  return { verts, edges: [...es].map((s) => s.split("_").map(Number)) };
}

const SIZE = 1024, CX = 512, CY = 512, R = 330;
const RY = 0.55, RX = 0.42;
const { verts, edges } = geoSphere(2);
const cy = Math.cos(RY), sy = Math.sin(RY), cx = Math.cos(RX), sx = Math.sin(RX);
const P = verts.map(([x, y, z]) => {
  const X = x * cy + z * sy, Z0 = z * cy - x * sy;
  const Y = y * cx - Z0 * sx, Z = y * sx + Z0 * cx;
  const s = R / (1 - Z * 0.16);
  return [CX + X * s, CY + Y * s, Z];
});
let back = "", front = "", dots = "";
edges.forEach(([a, b]) => {
  const seg = `M${P[a][0].toFixed(1)} ${P[a][1].toFixed(1)}L${P[b][0].toFixed(1)} ${P[b][1].toFixed(1)}`;
  if (P[a][2] + P[b][2] > 0) front += seg; else back += seg;
});
P.forEach((q) => { if (q[2] > 0.22) dots += `M${q[0].toFixed(1)} ${q[1].toFixed(1)}l.01 0`; });

// The bead's string: a gentle curve entering top, exiting bottom.
const thread = `M ${CX - 118} -20 Q ${CX - 40} ${CY - 260} ${CX} ${CY} Q ${CX + 34} ${CY + 230} ${CX - 60} ${SIZE + 20}`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
    <radialGradient id="pig" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#2A5E14"/>
      <stop offset="58%" stop-color="#25500F"/>
      <stop offset="86%" stop-color="#2A5E14" stop-opacity=".3"/>
      <stop offset="100%" stop-color="#2A5E14" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="spec" cx="32%" cy="24%" r="45%">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity=".5"/>
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="ao" cx="70%" cy="84%" r="46%">
      <stop offset="0%" stop-color="#000000" stop-opacity=".28"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="paper" cx="38%" cy="30%" r="90%">
      <stop offset="0%" stop-color="#F4F0E7"/>
      <stop offset="100%" stop-color="#E9E3D6"/>
    </radialGradient>
    <clipPath id="squircle"><rect x="0" y="0" width="${SIZE}" height="${SIZE}" rx="229" ry="229"/></clipPath>
  </defs>
  <g clip-path="url(#squircle)">
    <rect width="${SIZE}" height="${SIZE}" fill="url(#paper)"/>
    <path d="${thread}" fill="none" stroke="#33302A" stroke-width="6" stroke-opacity=".45"/>
    <circle cx="${CX}" cy="${CY}" r="${R * 0.92}" fill="url(#pig)" opacity=".82"/>
    <path d="${back}" fill="none" stroke="#3C3529" stroke-width="3.2" stroke-opacity=".30"/>
    <path d="${front}" fill="none" stroke="#33302A" stroke-width="5" stroke-linecap="round"/>
    <path d="${dots}" fill="none" stroke="#33302A" stroke-width="10" stroke-linecap="round"/>
    <circle cx="${CX}" cy="${CY}" r="${R * 0.93}" fill="url(#spec)"/>
    <circle cx="${CX}" cy="${CY}" r="${R * 0.93}" fill="url(#ao)"/>
  </g>
</svg>
`;
writeFileSync(join(root, "app/icon.svg"), svg);
console.log("wrote app/icon.svg");
