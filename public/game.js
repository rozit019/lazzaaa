import * as THREE from "./three.module.min.js";

/* ================= basics ================= */
const $ = (id) => document.getElementById(id);
const NET = {
  on: false,
  host: false,
  guest: false,
  ws: null,
  you: null,
  room: null,
  ev: [],
  cache: new Map(),
  mir: new Map(),
  wmir: new Map(),
  gm: {},
  inp: {},
  acts: [],
  run: true,
  wx: 0,
  wz: 0,
  tS: 0,
  tI: 0,
  keepT: 0,
  healT: 0,
  rx: false,
  endOk: false,
  nid: 0,
  byId: new Map(),
  reg: {},
  regIdx: new Map(),
  q: Promise.resolve(),
  itSig: "",
  trSig: "",
  lastIn: "",
};
let SUBJ = null; // multiplayer: the remote player whose button press the host is carrying out right now
const R_ISLAND = 130,
  R_GRASS = 118,
  LOBBY = { x: 0, z: 64, r: 8 };
const LOBBY_TIME = 90,
  ROUND_TIME = 600;
const H = [1.8, 1.1, 0.55],
  SPD = [1, 0.5, 0.28],
  RAD = 0.35,
  GRAV = 20,
  JUMP = 7.6;
let seed = 1234567;
const srand = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const rnd = (a = 1, b) =>
  b === undefined ? Math.random() * a : a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const hyp = Math.hypot;

const canvas = $("c");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true; // shadows refresh every 2nd frame
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fd0f5);
scene.fog = new THREE.Fog(0x8fd0f5, 90, 300);
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 600);
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
/* adaptive quality: if the frame rate stays low, step the render resolution down (and back up when there is headroom) */
const Q = { r: Math.min(devicePixelRatio || 1, 1.5), t: 0, n: 0, up: 0, sh: 0 };
function qTick(rawDt) {
  if (rawDt > 0 && rawDt < 0.25) {
    Q.t += rawDt;
    Q.n++;
  }
  if (Q.n >= 90) {
    const fps = Q.n / Q.t;
    Q.t = 0;
    Q.n = 0;
    if (fps < 45 && Q.r > 0.81) {
      Q.r = Math.max(0.8, Q.r - 0.25);
      renderer.setPixelRatio(Q.r);
      Q.up = 0;
    } else if (fps > 58 && Q.r < 1.49) {
      if (++Q.up >= 3) {
        Q.r = Math.min(1.5, Q.r + 0.25);
        renderer.setPixelRatio(Q.r);
        Q.up = 0;
      }
    } else Q.up = 0;
  }
  renderer.shadowMap.needsUpdate = (Q.sh = (Q.sh + 1) % 2) === 0;
}
addEventListener("resize", resize);
resize();

const hemi = new THREE.HemisphereLight(0xdff2ff, 0x6b8f5a, 1.5);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff3d6, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
const sc = sun.shadow.camera;
sc.left = -55;
sc.right = 55;
sc.top = 55;
sc.bottom = -55;
sc.near = 1;
sc.far = 220;
sun.shadow.bias = -0.0008;
sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);

/* ================= world ================= */
const colliders = [];
const BOX = new THREE.BoxGeometry(1, 1, 1);
const mats = {};
const mat = (c) =>
  mats[c] || (mats[c] = new THREE.MeshLambertMaterial({ color: c }));
function addBox(x, y, z, w, h, d, col, solid = true) {
  const m = new THREE.Mesh(BOX, mat(col));
  m.scale.set(w, h, d);
  m.position.set(x, y + h / 2, z);
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
  if (solid)
    colliders.push({
      x0: x - w / 2,
      x1: x + w / 2,
      y0: y,
      y1: y + h,
      z0: z - d / 2,
      z1: z + d / 2,
    });
  return m;
}
function ghostBox(x, y, z, w, h, d) {
  colliders.push({
    x0: x - w / 2,
    x1: x + w / 2,
    y0: y,
    y1: y + h,
    z0: z - d / 2,
    z1: z + d / 2,
    ghost: true,
  });
  return null;
}
function hit(x, y, z, r, h) {
  for (let i = 0; i < colliders.length; i++) {
    const b = colliders[i];
    if (
      x + r > b.x0 &&
      x - r < b.x1 &&
      z + r > b.z0 &&
      z - r < b.z1 &&
      y + h > b.y0 &&
      y < b.y1 - 0.02
    )
      return b;
  }
  return null;
}
function pointIn(x, y, z) {
  return hit(x, y, z, 0.15, 0.15);
}
function los(ax, ay, az, bx, by, bz) {
  const dx = bx - ax,
    dy = by - ay,
    dz = bz - az;
  for (let i = 0; i < colliders.length; i++) {
    const b = colliders[i];
    let t0 = 0,
      t1 = 1,
      a,
      c,
      s;
    if (Math.abs(dx) < 1e-6) {
      if (ax < b.x0 || ax > b.x1) continue;
    } else {
      a = (b.x0 - ax) / dx;
      c = (b.x1 - ax) / dx;
      if (a > c) {
        s = a;
        a = c;
        c = s;
      }
      if (a > t0) t0 = a;
      if (c < t1) t1 = c;
      if (t0 > t1) continue;
    }
    if (Math.abs(dy) < 1e-6) {
      if (ay < b.y0 || ay > b.y1) continue;
    } else {
      a = (b.y0 - ay) / dy;
      c = (b.y1 - ay) / dy;
      if (a > c) {
        s = a;
        a = c;
        c = s;
      }
      if (a > t0) t0 = a;
      if (c < t1) t1 = c;
      if (t0 > t1) continue;
    }
    if (Math.abs(dz) < 1e-6) {
      if (az < b.z0 || az > b.z1) continue;
    } else {
      a = (b.z0 - az) / dz;
      c = (b.z1 - az) / dz;
      if (a > c) {
        s = a;
        a = c;
        c = s;
      }
      if (a > t0) t0 = a;
      if (c < t1) t1 = c;
      if (t0 > t1) continue;
    }
    return false;
  }
  return true;
}
const RIVERS = [
  {
    hw: 5.2,
    pts: [
      [-127, 24],
      [-70, 22],
      [-40, 19],
      [-12, 23],
      [12, 20],
      [40, 20.5],
      [70, 22],
      [128, 16],
    ],
  }, // v51: 10.4 wide, too far to jump; widened away from the prison
  {
    hw: 5.2,
    pts: [
      [-59.3, -113],
      [-40.3, -62],
      [-41.3, -30],
      [-38.3, -8],
      [-37.3, 19],
    ],
  },
];
const RIVERS_OLD = [
  {
    hw: 3.2,
    pts: [
      [-127, 26],
      [-70, 24],
      [-40, 21],
      [-12, 25],
      [12, 22],
      [40, 22.5],
      [70, 24],
      [128, 18],
    ],
  },
  {
    hw: 2.5,
    pts: [
      [-62, -113],
      [-43, -62],
      [-44, -30],
      [-41, -8],
      [-40, 21],
    ],
  },
]; // only used so the random trees and rocks stay where they always were
const bridges = [],
  interiors = [],
  navRects = [];
function riverDist(x, z, RV = RIVERS) {
  let best = 1e9;
  for (const r of RV)
    for (let i = 0; i < r.pts.length - 1; i++) {
      const ax = r.pts[i][0],
        az = r.pts[i][1],
        dx = r.pts[i + 1][0] - ax,
        dz = r.pts[i + 1][1] - az;
      const t = clamp(
          ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz),
          0,
          1,
        ),
        d = hyp(x - ax - dx * t, z - az - dz * t) - r.hw;
      if (d < best) best = d;
    }
  return best;
}
const inRiver = (x, z) => riverDist(x, z) < 0;
function crossesRiver(ax, az, bx, bz) {
  for (let i = 1; i < 8; i++)
    if (inRiver(ax + ((bx - ax) * i) / 8, az + ((bz - az) * i) / 8))
      return true;
  return false;
}
const MOUTHS = [
  [-127, 24, -141, 24.5, 5.2],
  [128, 16, 142, 15.3, 5.2],
  [-59.3, -113, -64.2, -126.2, 5.2],
]; // where each river runs out over the beach into the sea
function inMouth(x, z) {
  for (const m of MOUTHS) {
    const dx = m[2] - m[0],
      dz = m[3] - m[1],
      t = clamp(
        ((x - m[0]) * dx + (z - m[1]) * dz) / (dx * dx + dz * dz),
        0,
        1,
      );
    if (hyp(x - m[0] - dx * t, z - m[1] - dz * t) < m[4] * (1 + 0.5 * t))
      return true;
  }
  return false;
}
const WDEEP = -1.5; // rivers are deep: you swim, and that is slower than running
const groundY = (x, z) => {
  const r = hyp(x, z);
  if (r < R_ISLAND + 13) {
    const rd = riverDist(x, z);
    if (rd < 0) return Math.max(WDEEP, rd * 1.1 - 0.15);
    if (r > R_ISLAND - 6 && inMouth(x, z)) return WDEEP;
  }
  /* the bank shelves down: shallow at the edge, swimming depth a step further in */ return r >
    R_ISLAND
    ? Math.max(-1.6, -0.03 - (r - R_ISLAND) * 0.2667)
    : 0;
}; // the beach slopes down into the sea like the sand you see
const waterTop = (x, z) =>
  hyp(x, z) > R_ISLAND + 0.5 && !inRiver(x, z) ? -0.35 : 0.04;

const FH = 3.2,
  towers = [];
function tower(x, z, floors, col, fc = 0x8f8676) {
  // multi-floor building: inner stairs, door/balcony openings N+S on every floor, open roof
  const w = 12,
    d = 11,
    t = 0.4,
    dw = 2.4,
    dh = 2.3,
    sw = (w - dw) / 2,
    st = [];
  for (let k = 0; k < floors; k++) {
    const y = k * FH,
      top = k === floors - 1,
      WH = top ? FH - 0.3 : FH; // top-storey walls stop under the roof slab (no overlapping faces)
    for (const s of [-1, 1]) {
      const zz = z + s * (d / 2 - t / 2);
      addBox(x - dw / 2 - sw / 2, y, zz, sw, WH, t, col);
      addBox(x + dw / 2 + sw / 2, y, zz, sw, WH, t, col);
      addBox(x, y + dh, zz, dw, WH - dh, t, col);
      if (k > 0)
        addBox(x, y - 0.3, z + s * (d / 2 + 0.5), 3.4, 0.3, 1.8, 0x6d5b4b); // balcony (reaches in through the doorway)
    }
    addBox(x - w / 2 + t / 2, y, z, t, WH, d - 2 * t, col);
    addBox(x + w / 2 - t / 2, y, z, t, WH, d - 2 * t, col);
    const sd = k % 2 ? -1 : 1,
      sx = x + sd * (w / 2 - t - 0.7);
    for (let i = 1; i <= 8; i++)
      addBox(
        sx,
        y,
        z - 2.4 + (i - 0.5) * 0.6,
        1.4,
        i * 0.4,
        0.6,
        i % 2 ? 0x8a6a3a : 0x9a7a48,
      );
    st.push({ bx: sx, bz: z - 3.2, tx: sx, tz: z + 3.3, sd });
    // floor slab above: inset between the walls on middle floors, overhanging roof on top; with a stairwell hole
    const Y = y + FH - 0.3,
      o = top ? 0.25 : -t,
      X0 = x - w / 2 - o,
      X1 = x + w / 2 + o,
      Z0 = z - d / 2 - o,
      Z1 = z + d / 2 + o,
      sc = top ? 0x7a7468 : fc;
    const wi = sd > 0 ? x + w / 2 - t : x - w / 2 + t,
      hi = wi - sd * 1.45; // stairwell: from inner wall face (wi) to hi
    const slab = (a0, a1, b0, b1) => {
      if (a1 - a0 > 0.01 && b1 - b0 > 0.01)
        addBox((a0 + a1) / 2, Y, (b0 + b1) / 2, a1 - a0, 0.3, b1 - b0, sc);
    };
    if (sd > 0) {
      slab(X0, hi, Z0, Z1);
      slab(hi, X1, Z0, z - 2.4);
      slab(hi, X1, z + 2.4, Z1);
      slab(wi, X1, z - 2.4, z + 2.4);
    } else {
      slab(hi, X1, Z0, Z1);
      slab(X0, hi, Z0, z - 2.4);
      slab(X0, hi, z + 2.4, Z1);
      slab(X0, wi, z - 2.4, z + 2.4);
    }
    addBox(hi - sd * 0.05, y + FH, z, 0.1, 0.9, 4.8, 0x6d5b4b); // stairwell rail
    addBox(sx, y + FH, z - 2.45, 1.4, 0.9, 0.1, 0x6d5b4b);
  }
  towers.push({ x, z, w, d, floors, st });
  interiors.push({ x, z, w, d });
}
function towerOf(x, z) {
  for (const t of towers)
    if (Math.abs(x - t.x) < t.w / 2 && Math.abs(z - t.z) < t.d / 2) return t;
  return null;
}
const floorOf = (e) => clamp(Math.floor((e.pos.y + 0.3) / FH), 0, 9);
function buildWorld() {
  // ocean, sand, grass
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(600, 48),
    new THREE.MeshLambertMaterial({
      color: 0x2f86c9,
      transparent: true,
      opacity: 0.86,
    }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.35;
  scene.add(water);
  const bed = new THREE.Mesh(new THREE.CircleGeometry(600, 32), mat(0x1c5d92));
  bed.rotation.x = -Math.PI / 2;
  bed.position.y = -1.6;
  scene.add(bed);
  const sand = new THREE.Mesh(
    new THREE.CylinderGeometry(R_ISLAND, R_ISLAND + 6, 1.6, 56),
    mat(0xe9d69a),
  );
  sand.position.y = -0.83;
  sand.receiveShadow = true;
  scene.add(sand);
  const grass = new THREE.Mesh(
    new THREE.CylinderGeometry(R_GRASS, R_GRASS + 1, 1, 56),
    mat(0x6aa84f),
  );
  grass.position.y = -0.5;
  grass.receiveShadow = true;
  scene.add(grass);
  // paths (decor)
  const pathM = mat(0xb9ad8c);
  const strip = (x, z, w, d) => {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), pathM);
    p.rotation.x = -Math.PI / 2;
    p.position.set(x, 0.015, z);
    p.receiveShadow = true;
    scene.add(p);
  };
  strip(0, 28, 5, 56);
  strip(0, 0, 120, 5);
  strip(0, -32, 5, 60);
  // rivers
  const rivM = mat(0x3f9be0);
  for (const r of RIVERS)
    for (let i = 0; i < r.pts.length; i++) {
      const [ax, az] = r.pts[i];
      const c = new THREE.Mesh(new THREE.CircleGeometry(r.hw, 18), rivM);
      c.rotation.x = -Math.PI / 2;
      c.position.set(ax, 0.03, az);
      scene.add(c);
      if (i === r.pts.length - 1) break;
      const [bx, bz] = r.pts[i + 1],
        len = hyp(bx - ax, bz - az);
      const p = new THREE.Mesh(new THREE.PlaneGeometry(r.hw * 2, len), rivM);
      p.rotation.order = "YXZ";
      p.rotation.x = -Math.PI / 2;
      p.rotation.y = Math.atan2(bx - ax, bz - az);
      p.position.set((ax + bx) / 2, 0.04, (az + bz) / 2);
      scene.add(p);
    }
  {
    const deepM = mat(0x256fb5);
    for (const r of RIVERS)
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [ax, az] = r.pts[i],
          [bx, bz] = r.pts[i + 1],
          len = hyp(bx - ax, bz - az); // darker middle: the deep channel
        const p = new THREE.Mesh(
          new THREE.PlaneGeometry(r.hw * 1.15, len + r.hw * 0.5),
          deepM,
        );
        p.rotation.order = "YXZ";
        p.rotation.x = -Math.PI / 2;
        p.rotation.y = Math.atan2(bx - ax, bz - az);
        p.position.set((ax + bx) / 2, 0.05, (az + bz) / 2);
        scene.add(p);
      }
    for (const m of MOUTHS) {
      const dx = m[2] - m[0],
        dz = m[3] - m[1],
        len = hyp(dx, dz),
        yaw = Math.atan2(dx, dz),
        drop = 0.4; // the river mouth: a slab of water running down the beach into the ocean
      const g = new THREE.Group();
      g.position.set(m[0], 0.04, m[1]);
      g.rotation.order = "YXZ";
      g.rotation.y = yaw;
      g.rotation.x = Math.atan2(drop, len);
      scene.add(g);
      const sh = new THREE.Shape();
      sh.moveTo(-m[4], 0);
      sh.lineTo(m[4], 0);
      sh.lineTo(m[4] * 1.5, len);
      sh.lineTo(-m[4] * 1.5, len);
      sh.closePath();
      const top = new THREE.Mesh(new THREE.ShapeGeometry(sh), rivM);
      top.rotation.x = Math.PI / 2;
      top.material.side = THREE.DoubleSide;
      g.add(top);
      const sh2 = new THREE.Shape();
      sh2.moveTo(-m[4] * 0.55, 0);
      sh2.lineTo(m[4] * 0.55, 0);
      sh2.lineTo(m[4] * 0.9, len);
      sh2.lineTo(-m[4] * 0.9, len);
      sh2.closePath();
      const mid = new THREE.Mesh(new THREE.ShapeGeometry(sh2), deepM);
      mid.rotation.x = Math.PI / 2;
      mid.position.y = 0.012;
      deepM.side = THREE.DoubleSide;
      g.add(mid);
      for (const sd of [-1, 1]) {
        const wall = new THREE.Mesh(BOX, rivM);
        wall.scale.set(0.3, 1.5, len * 1.01);
        wall.position.set(sd * m[4] * 1.25, -0.76, len / 2);
        wall.rotation.y = sd * Math.atan2(m[4] * 0.5, len);
        g.add(wall);
      }
    }
  }
  const stepBox = (x, y, z, w, h, d, col) => {
    addBox(x, y, z, w, h, d, col);
    colliders[colliders.length - 1].nonav = true;
  };
  const bridge = (x, z, alongZ, len) => {
    const w = 4.2,
      HB = 2.1,
      NS = 6,
      SD = 0.5,
      P = (a, l, y, wa, h, wl, col, solid, fn = addBox) =>
        alongZ
          ? fn(x + l, y, z + a, wl, h, wa, col, solid)
          : fn(x + a, y, z + l, wa, h, wl, col, solid); // a = along the bridge, l = across it
    P(0, 0, HB - 0.25, len, 0.25, w, 0x8a6a3a, true); // the deck, high enough for a boat to pass under
    for (const s of [-1, 1]) {
      for (let k = 1; k <= NS; k++)
        P(
          s * (len / 2 + (k - 0.5) * SD),
          0,
          0,
          SD,
          HB - k * 0.3 + (k === 1 ? 0 : 0),
          w,
          k % 2 ? 0x7d5f33 : 0x8a6a3a,
          true,
          stepBox,
        ); // stairs at both ends
      for (const sd of [-1, 1]) {
        P(0, sd * (w / 2 - 0.1), HB + 0.85, len, 0.12, 0.12, 0x6d5b4b, false);
        for (let k = -1; k <= 1; k++)
          P(
            k * (len / 2 - 0.3),
            sd * (w / 2 - 0.1),
            HB,
            0.14,
            0.9,
            0.14,
            0x6d5b4b,
            false,
          );
        {
          const a0 = -(len / 2 + NS * SD + 0.2),
            a1 = len / 2 + NS * SD + 0.2,
            l0 = sd * (w / 2 - 0.55),
            l1 = sd * (w / 2 + 0.7),
            A0 = Math.min(a0, a1),
            A1 = Math.max(a0, a1),
            L0 = Math.min(l0, l1),
            L1 = Math.max(l0, l1);
          navRects.push(
            alongZ
              ? { x0: x + L0, x1: x + L1, z0: z + A0, z1: z + A1 }
              : { x0: x + A0, x1: x + A1, z0: z + L0, z1: z + L1 },
          );
        } // bots must take the stairs from the end, not from the side
        const rail = P(
          s * (len / 2 + (NS * SD) / 2),
          sd * (w / 2 - 0.06),
          HB / 2 + 0.75,
          hyp(NS * SD, HB),
          0.12,
          0.12,
          0x6d5b4b,
          false,
        );
        if (alongZ) rail.rotation.x = s * Math.atan2(HB, NS * SD);
        else rail.rotation.z = -s * Math.atan2(HB, NS * SD);
        P(
          s * (len / 2 + NS * SD - 0.1),
          sd * (w / 2 - 0.06),
          0,
          0.14,
          0.95,
          0.14,
          0x6d5b4b,
          false,
        );
      }
      P(s * (len / 2 - 0.25), 0, 0, 0.5, HB - 0.25, w, 0x6d5b4b, false); // pier under each end of the deck
    }
    bridges.push({
      x,
      z,
      ax: alongZ ? 0 : 1,
      az: alongZ ? 1 : 0,
      len: len + NS * SD * 2 + 0.4,
      w,
    });
  };
  const bridgeOld = (x, z, alongZ, len) => {
    const w = 4.2;
    if (alongZ) {
      addBox(x, 0.05, z, w, 0.25, len, 0x8a6a3a);
      for (const s of [-1, 1]) {
        addBox(x + s * (w / 2 - 0.1), 0.9, z, 0.12, 0.12, len, 0x6d5b4b, false);
        for (let k = -1; k <= 1; k++)
          addBox(
            x + s * (w / 2 - 0.1),
            0.3,
            z + k * (len / 2 - 0.3),
            0.14,
            0.6,
            0.14,
            0x6d5b4b,
            false,
          );
      }
    } else {
      addBox(x, 0.05, z, len, 0.25, w, 0x8a6a3a);
      for (const s of [-1, 1]) {
        addBox(x, 0.9, z + s * (w / 2 - 0.1), len, 0.12, 0.12, 0x6d5b4b, false);
        for (let k = -1; k <= 1; k++)
          addBox(
            x + k * (len / 2 - 0.3),
            0.3,
            z + s * (w / 2 - 0.1),
            0.14,
            0.6,
            0.14,
            0x6d5b4b,
            false,
          );
      }
    }
    bridges.push({ x, z, ax: alongZ ? 0 : 1, az: alongZ ? 1 : 0, len, w });
  };
  bridge(0, 21.5, true, 14);
  bridge(55, 21.3, true, 14);
  bridge(-62, 21.7, true, 14);
  bridge(-38.2, 0, false, 14.4);
  bridge(-40.8, -46, false, 14.4);
  bridge(-100, 23, true, 14);
  bridge(101.5, 18.7, true, 14);
  bridge(-50.7, -90, false, 14.4);
  interiors.push({ x: -63, z: -2.5, w: 26, d: 21 });

  const stairs = (x, z, dx, dz, n, col = 0x9a7446) => {
    for (let i = 1; i <= n; i++)
      addBox(
        x + dx * (n - i) * 1.2,
        0,
        z + dz * (n - i) * 1.2,
        1.2,
        i * 1.2,
        1.2,
        i % 2 ? col : 0xb08a55,
      );
  };
  const house = (x, z, w, d, h, col, roofCol = 0x8a4b3a) => {
    const t = 0.4,
      dw = 2.4,
      dh = 2.3,
      sw = (w - dw) / 2;
    for (const s of [-1, 1]) {
      // north & south walls with doors
      const zz = z + s * (d / 2 - t / 2);
      addBox(x - dw / 2 - sw / 2, 0, zz, sw, h, t, col);
      addBox(x + dw / 2 + sw / 2, 0, zz, sw, h, t, col);
      addBox(x, dh, zz, dw, h - dh, t, col);
    }
    addBox(x - w / 2 + t / 2, 0, z, t, h, d - 2 * t, col);
    addBox(x + w / 2 - t / 2, 0, z, t, h, d - 2 * t, col);
    addBox(x, h, z, w + 0.6, 0.3, d + 0.6, roofCol);
    addBox(x - w / 2 + 1.3, 0, z + d / 2 - 1.4, 1.1, 1.1, 1.1, 0x9a7446); // crate to hide behind
    interiors.push({ x, z, w, d });
  };

  // central plaza
  addBox(0, 0, 0, 5, 0.4, 5, 0x9aa3ab);
  addBox(0, 0.4, 0, 3.6, 0.5, 3.6, 0x56b6e8);
  addBox(0, 0.9, 0, 0.8, 1.6, 0.8, 0x9aa3ab);

  // ---- town (north) ----
  const hs = 3.3; // roof top at 3.6 = 3 crate steps
  house(-24, -22, 10, 8, hs, 0xd9c7a3);
  stairs(-24 + 5.3 + 0.6, -22, 1, 0, 2);
  house(-8, -24, 8, 8, hs, 0xc7d3dd, 0x4d6a8a);
  stairs(-8, -24 + 4.3 + 0.6, 0, 1, 2);
  house(9, -22, 10, 8, hs, 0xe0b98f);
  stairs(9 - 5.3 - 0.6, -19, -1, 0, 2);
  house(26, -24, 9, 9, hs, 0xcfd8b0, 0x5a7a4a);
  stairs(26 + 4.8 + 0.6, -24, 1, 0, 2);
  addBox(0.5, 3.45, -23, 6.4, 0.2, 1.4, 0x8a6a3a); // plank bridges between roofs
  addBox(17.8, 3.45, -23, 5.6, 0.2, 1.4, 0x8a6a3a);
  // back row
  addBox(-22, 0, -44, 11, 7.2, 10, 0xb9a48a);
  stairs(-22 + 5.5 + 0.6, -44, 1, 0, 6);
  addBox(-22, 7.2, -47, 3, 1.2, 2, 0x777f88);
  house(-5, -45, 9, 9, hs, 0xd6b3b3);
  stairs(-5 - 4.8 - 0.6, -42, -1, 0, 2);
  addBox(11, 0, -45, 9, 3.6, 9, 0xa9b7c2);
  stairs(11, -45 + 4.5 + 0.6, 0, 1, 2);
  addBox(11, 3.6, -45, 3, 1.2, 3, 0x8794a0);
  addBox(27, 0, -47, 6, 10.8, 6, 0x8c7b6b);
  stairs(27 - 3 - 0.6, -47, -1, 0, 3); // tower: 3 steps then ledges
  addBox(27, 3.4, -42.6, 3, 0.2, 2.8, 0x6d5b4b);
  addBox(31.4, 4.6, -47, 2.8, 0.2, 3, 0x6d5b4b);
  addBox(27, 5.8, -51.4, 3, 0.2, 2.8, 0x6d5b4b);
  addBox(22.6, 7.0, -50, 2.8, 0.2, 3, 0x6d5b4b);
  addBox(22.6, 8.2, -45.5, 2.8, 0.2, 3, 0x6d5b4b);
  addBox(22.6, 9.4, -47.5, 2.8, 0.2, 2, 0x6d5b4b);
  addBox(3, 3.45, -45, 7.4, 0.2, 1.4, 0x8a6a3a);
  addBox(-13.2, 3.45, -45, 7.4, 0.2, 1.4, 0x8a6a3a);
  // market stalls
  for (let i = 0; i < 4; i++) {
    const x = -14 + i * 9,
      z = -9;
    addBox(x, 0, z, 3, 1, 1.4, 0x9a7446);
    addBox(x - 1.4, 1, z, 0.15, 1.4, 0.15, 0x6d5b4b);
    addBox(x + 1.4, 1, z, 0.15, 1.4, 0.15, 0x6d5b4b);
    addBox(
      x,
      2.4,
      z,
      3.6,
      0.15,
      2.2,
      [0xd9534f, 0x3f8fd9, 0xe2b93b, 0x4cae4c][i],
    );
  }

  // ---- container yard (east) ----
  const cc = [0xc0392b, 0x2e86c1, 0xd68910, 0x229954, 0x7d3c98, 0x839192];
  let ci = 0;
  for (let r = 0; r < 4; r++)
    for (let k = 0; k < 3; k++) {
      if (srand() < 0.15) continue;
      const x = 42 + k * 10 + (r % 2) * 2.5,
        z = -14 + r * 9,
        AB = r === 3 && k === 1 ? ghostBox : addBox; // that one stood where the longer bridge now lands
      AB(x, 0, z, 6.5, 2.4, 2.6, cc[ci++ % 6]);
      if (srand() < 0.45) AB(x + 0.6, 2.4, z, 6.5, 2.4, 2.6, cc[ci++ % 6]);
      if (srand() < 0.6) AB(x - 4, 0, z + 0.4, 1.2, 1.2, 1.2, 0x9a7446);
    }
  addBox(47, 2.5, -9.5, 1.4, 0.2, 6.6, 0x8a6a3a);
  // crane
  addBox(72, 0, 2, 1.2, 12, 1.2, 0xe2b93b);
  addBox(66, 12, 2, 14, 0.8, 1.2, 0xe2b93b);

  // ---- maze (west) ----
  (() => {
    const n = 6,
      cs = 5,
      ox = -78,
      oz = -15,
      wh = 2.4,
      t = 0.5;
    const open = new Set(),
      vis = new Set(["0,0"]),
      stack = [[0, 0]];
    while (stack.length) {
      const [cx, cz] = stack[stack.length - 1];
      const nb = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]
        .map(([a, b]) => [cx + a, cz + b])
        .filter(
          ([a, b]) =>
            a >= 0 && b >= 0 && a < n && b < n && !vis.has(a + "," + b),
        );
      if (!nb.length) {
        stack.pop();
        continue;
      }
      const [nx, nz] = nb[Math.floor(srand() * nb.length)];
      open.add(
        nx !== cx ? `v${Math.max(nx, cx)},${cz}` : `h${cx},${Math.max(nz, cz)}`,
      );
      vis.add(nx + "," + nz);
      stack.push([nx, nz]);
    }
    ["v0,1", "v0,4", "v6,2", "v6,5", "h1,0", "h4,0", "h2,6", "h5,6"].forEach(
      (k) => open.add(k),
    );
    for (let i = 0; i <= n; i++)
      for (let j = 0; j < n; j++) {
        if (!open.has(`v${i},${j}`) && !(i > 0 && i < n && srand() < 0.22))
          (j === n - 1 ? ghostBox : addBox)(
            ox + i * cs,
            0,
            oz + j * cs + cs / 2,
            t,
            wh,
            cs + t,
            0x8e9aa6,
          ); // the last row made room for the wider river
        if (!open.has(`h${j},${i}`) && !(i > 0 && i < n && srand() < 0.22))
          (i === n ? ghostBox : addBox)(
            ox + j * cs + cs / 2,
            0,
            oz + i * cs,
            cs + t,
            wh,
            t,
            0x7f8b97,
          );
      }
    addBox(ox + 12.5, 0, oz + 12.5, 1.2, 1.2, 1.2, 0x9a7446);
    addBox(ox + 22.5, 0, oz + 17.5, 1.2, 1.2, 1.2, 0x9a7446);
  })();

  // ---- warehouse (south-west) ----
  house(-42, 42, 18, 14, 4.5, 0x9fa8b0, 0x56616b);
  stairs(-42 + 9.3 + 0.6, 42, 1, 0, 3);
  addBox(-46, 0, 40, 2.4, 1.2, 2.4, 0x9a7446);
  addBox(-46, 1.2, 40, 1.2, 1.2, 1.2, 0xb08a55);
  addBox(-38, 0, 44, 3, 2.4, 1.4, 0x2e86c1);
  addBox(-40, 0, 39, 1.2, 1.2, 1.2, 0x9a7446);
  addBox(-58, 0, 34, 6.5, 2.4, 2.6, 0x229954);
  addBox(-58, 0, 30, 1.2, 1.2, 1.2, 0x9a7446);

  // ---- parkour park (south-east) ----
  const pk = [
    [36, 40, 1.2],
    [39, 43, 2.4],
    [43, 44, 3.6],
    [47, 42, 4.8],
    [50, 38, 6],
    [48, 33, 4.8],
    [44, 30, 3.6],
    [40, 32, 2.4],
    [53, 45, 3.6],
    [57, 40, 2.4],
    [55, 34, 1.2],
  ];
  pk.forEach(([x, z, h], i) =>
    addBox(x, 0, z, 2.2, h, 2.2, i % 2 ? 0xc98f5a : 0xa9b7c2),
  );
  addBox(46, 5.8, 37, 1.2, 0.2, 5, 0x8a6a3a);
  addBox(62, 0, 50, 8, 0.4, 8, 0x9aa3ab);
  for (const [a, b] of [
    [-3.5, -3.5],
    [3.5, -3.5],
    [-3.5, 3.5],
    [3.5, 3.5],
  ])
    addBox(62 + a, 0.4, 50 + b, 0.7, 3, 0.7, 0xd8d2c4);
  addBox(62, 3.4, 50, 8.4, 0.3, 8.4, 0xc98f5a);

  // ---- multi-floor buildings ----
  tower(-72, -42, 3, 0xbfb39a);
  tower(76, 45, 3, 0xa9b7c2);
  tower(30, 71, 2, 0xd6b3b3);
  tower(-20, 88, 2, 0xc7d3dd);
  tower(60, -55, 3, 0xcfd8b0);
  // ---- outskirts (outer ring) ----
  house(-92, 58, 9, 8, hs, 0xd9c7a3);
  stairs(-92 + 4.8 + 0.6, 58, 1, 0, 2);
  house(88, -66, 10, 8, hs, 0xc7d3dd, 0x4d6a8a);
  stairs(88 - 5.3 - 0.6, -66, -1, 0, 2);
  house(4, -96, 9, 9, hs, 0xe0b98f);
  stairs(4 + 4.8 + 0.6, -96, 1, 0, 2);
  house(102, -18, 8, 8, hs, 0xcfd8b0, 0x5a7a4a);
  stairs(102, -18 - 4.3 - 0.6, 0, -1, 2);
  house(-104, -28, 9, 8, hs, 0xd6b3b3);
  stairs(-104, -28 + 4.3 + 0.6, 0, 1, 2);
  house(90, 62, 10, 9, hs, 0xd9c7a3, 0x56616b);
  stairs(90 - 5.3 - 0.6, 62, -1, 0, 2);
  house(-48, 92, 9, 8, hs, 0xc7d3dd);
  stairs(-48 + 4.8 + 0.6, 92, 1, 0, 2);
  house(40, 92, 9, 8, hs, 0xe0b98f, 0x5a7a4a);
  stairs(40 - 4.8 - 0.6, 92, -1, 0, 2);
  addBox(-80, 0, -70, 9, 4.8, 9, 0xa9b7c2);
  stairs(-80 + 4.5 + 0.6, -70, 1, 0, 4);
  addBox(-80, 4.8, -70, 3, 1.2, 3, 0x8794a0);
  addBox(70, 0, -92, 5, 9.6, 5, 0xe8e4d8);
  addBox(70, 9.6, -92, 6.4, 0.3, 6.4, 0xc9302c);
  stairs(70 - 2.5 - 0.6, -92, -1, 0, 4); // lighthouse
  // v51 ledges you can step onto straight from the ladder (ladder at x 71.8 on the south face): left, right, left, right on the way up
  addBox(69.7, 2.8, -88.3, 3.4, 0.2, 2.4, 0x8a6a3a); // 1: left of the ladder
  addBox(73.5, 4.4, -90.3, 2.2, 0.2, 6.4, 0x8a6a3a); // 2: right of the ladder, round the corner along the east wall
  addBox(69.0, 6.0, -88.3, 4.8, 0.2, 2.4, 0x8a6a3a);
  addBox(66.4, 6.0, -89.0, 2.2, 0.2, 3.8, 0x8a6a3a); // 3: left again, round the corner to just above the top of the stairs
  addBox(73.5, 7.6, -91.5, 2.2, 0.2, 8.8, 0x8a6a3a);
  addBox(70.2, 7.6, -95.6, 6.6, 0.2, 2.2, 0x8a6a3a); // 4: right, along the east wall and round to the back
  for (const [x, z, c] of [
    [-75, 85, 0xc0392b],
    [-68, 80, 0x2e86c1],
    [108, 30, 0x229954],
    [104, 36, 0xd68910],
    [-110, 5, 0x7d3c98],
    [20, -110, 0x839192],
  ]) {
    addBox(x, 0, z, 6.5, 2.4, 2.6, c);
    addBox(x + 4.2, 0, z + 0.5, 1.2, 1.2, 1.2, 0x9a7446);
  }
  // ---- prone tunnels & low cover ----
  const tunnel = (x, z, rot) => {
    const L = 5;
    if (rot) {
      addBox(x, 0, z - 0.95, L, 0.7, 0.3, 0x7a7a72);
      addBox(x, 0, z + 0.95, L, 0.7, 0.3, 0x7a7a72);
      addBox(x, 0.7, z, L, 0.3, 2.2, 0x8b8b82);
    } else {
      addBox(x - 0.95, 0, z, 0.3, 0.7, L, 0x7a7a72);
      addBox(x + 0.95, 0, z, 0.3, 0.7, L, 0x7a7a72);
      addBox(x, 0.7, z, 2.2, 0.3, L, 0x8b8b82);
    }
  };
  tunnel(18, 9.6, 1);
  tunnel(-20, 11, 0);
  tunnel(34, -36, 1);
  tunnel(-34, -36, 0);
  tunnel(20, 52, 1);
  tunnel(-60, 100, 1);
  tunnel(75, 80, 0);
  tunnel(-95, -55, 1);
  tunnel(105, -45, 0);

  // ---- random trees, rocks, low walls ----
  ghostBox(18, 0, 14, 5, 1, 2.2); // where a tunnel used to be
  const rndC0 = colliders.length,
    rndM0 = scene.children.length;
  const leafG = new THREE.IcosahedronGeometry(1, 0);
  const leafM = [
    new THREE.MeshLambertMaterial({ color: 0x3f8f3a, flatShading: true }),
    new THREE.MeshLambertMaterial({ color: 0x4fa044, flatShading: true }),
  ];
  const free = (x, z, r) =>
    !hit(x, 0, z, r, 3) &&
    hyp(x - LOBBY.x, z - LOBBY.z) > LOBBY.r + 5 &&
    hyp(x, z) > 7 &&
    !(Math.abs(x) < 3.5 && z > 0 && z < 60) &&
    !(Math.abs(z) < 3.5) &&
    riverDist(x, z, RIVERS_OLD) > 2.6;
  let placed = 0,
    tries = 0;
  while (placed < 120 && tries++ < 1600) {
    const a = srand() * 6.283,
      r = Math.sqrt(srand()) * (R_GRASS - 4),
      x = Math.cos(a) * r,
      z = Math.sin(a) * r;
    const forest =
      (x < -15 && z < -50) ||
      (x < -55 && z < -20) ||
      (x > 45 && z < -30) ||
      hyp(x, z) > 92;
    if (!forest && srand() < 0.55) continue;
    if (!free(x, z, 2.2)) continue;
    const th = 2.6 + srand() * 1.6;
    addBox(x, 0, z, 0.7, th, 0.7, 0x7a5533);
    const lf = new THREE.Mesh(leafG, leafM[placed & 1]);
    const s = 2 + srand() * 1.2;
    lf.scale.set(s, s * 0.85, s);
    lf.position.set(x, th + s * 0.5, z);
    lf.rotation.y = srand() * 6;
    lf.castShadow = true;
    scene.add(lf);
    placed++;
  }
  placed = 0;
  tries = 0;
  while (placed < 62 && tries++ < 900) {
    const a = srand() * 6.283,
      r = 10 + Math.sqrt(srand()) * (R_GRASS - 10),
      x = Math.cos(a) * r,
      z = Math.sin(a) * r;
    if (!free(x, z, 2.5)) continue;
    const k = srand();
    if (k < 0.4) {
      const s = 1 + srand() * 1.4;
      addBox(x, 0, z, s * 1.4, s * 0.8, s * 1.2, 0x8d9299);
      if (srand() < 0.5)
        addBox(x + s * 0.9, 0, z + 0.3, s, s * 1.5, s, 0x7c8188);
    } else if (k < 0.75) {
      srand() < 0.5
        ? addBox(x, 0, z, 3.4, 1, 0.5, 0xb7b0a0)
        : addBox(x, 0, z, 0.5, 1, 3.4, 0xb7b0a0);
    } else {
      addBox(x, 0, z, 1.2, 1.2, 1.2, 0x9a7446);
      if (srand() < 0.5) addBox(x + 1.2, 0, z, 1.2, 2.4, 1.2, 0xb08a55);
    }
    placed++;
  }
  // v51: the rivers are wider now — take out the random trees and rocks that would stand in the water or on a bridge, and the stand-in colliders
  {
    const wet = (x, z) =>
      riverDist(x, z) < 2.2 ||
      bridges.some(
        (b) =>
          Math.abs((x - b.x) * b.ax + (z - b.z) * b.az) < b.len / 2 + 1.5 &&
          Math.abs((x - b.x) * b.az + (z - b.z) * b.ax) < b.w / 2 + 1.5,
      );
    for (let i = colliders.length - 1; i >= 0; i--) {
      const c = colliders[i];
      if (c.ghost || (i >= rndC0 && wet((c.x0 + c.x1) / 2, (c.z0 + c.z1) / 2)))
        colliders.splice(i, 1);
    }
    for (let i = scene.children.length - 1; i >= rndM0; i--) {
      const m = scene.children[i];
      if (wet(m.position.x, m.position.z)) scene.remove(m);
    }
  }
}

/* lobby visuals */
const lobbyGroup = new THREE.Group();
function buildLobby() {
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(LOBBY.r + 0.6, LOBBY.r + 0.6, 0.06, 40),
    mat(0x343a46),
  );
  disc.position.set(LOBBY.x, 0.03, LOBBY.z);
  disc.receiveShadow = true;
  scene.add(disc);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(LOBBY.r + 0.1, LOBBY.r + 0.5, 48),
    new THREE.MeshBasicMaterial({ color: 0x35c8ff }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(LOBBY.x, 0.07, LOBBY.z);
  scene.add(ring);
  const hex = new THREE.Mesh(
    new THREE.RingGeometry(2.6, 3, 6),
    new THREE.MeshBasicMaterial({ color: 0xffcc44 }),
  );
  hex.rotation.x = -Math.PI / 2;
  hex.position.set(LOBBY.x, 0.075, LOBBY.z);
  scene.add(hex);
  const bm = new THREE.MeshBasicMaterial({
    color: 0x35c8ff,
    transparent: true,
    opacity: 0.8,
  });
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * 6.283;
    const p = new THREE.Mesh(BOX, bm);
    p.scale.set(0.12, 7, 0.12);
    p.position.set(
      LOBBY.x + Math.cos(a) * (LOBBY.r + 0.3),
      3.5,
      LOBBY.z + Math.sin(a) * (LOBBY.r + 0.3),
    );
    lobbyGroup.add(p);
  }
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(LOBBY.r + 0.3, LOBBY.r + 0.3, 7, 40, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0x35c8ff,
      transparent: true,
      opacity: 0.08,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  wall.position.set(LOBBY.x, 3.5, LOBBY.z);
  lobbyGroup.add(wall);
  scene.add(lobbyGroup);
}

/* ================= navigation grid + A* ================= */
const N = 300,
  HALF = 150;
const nav = new Uint8Array(N * N),
  navC = new Uint8Array(N * N);
let GR = nav;
const cellOf = (v) => clamp(Math.floor(v + HALF), 0, N - 1),
  cw = (i) => i - HALF + 0.5;
function buildNav() {
  for (let z = 0; z < N; z++)
    for (let x = 0; x < N; x++)
      if (hyp(cw(x), cw(z)) > R_ISLAND - 7) GR[z * N + x] = 1;
  for (const b of colliders) {
    if (b.y0 >= 1.5 || b.y1 <= 0.42 || b.nonav) continue;
    for (let z = cellOf(b.z0 - 0.5); z <= cellOf(b.z1 + 0.5); z++)
      for (let x = cellOf(b.x0 - 0.5); x <= cellOf(b.x1 + 0.5); x++) {
        const px = cw(x),
          pz = cw(z);
        if (
          px > b.x0 - 0.5 &&
          px < b.x1 + 0.5 &&
          pz > b.z0 - 0.5 &&
          pz < b.z1 + 0.5
        )
          GR[z * N + x] = 1;
      }
  }
}
const chokes = [];
function buildNavC() {
  for (const b of navRects)
    for (let z = cellOf(b.z0); z <= cellOf(b.z1); z++)
      for (let x = cellOf(b.x0); x <= cellOf(b.x1); x++) {
        const px = cw(x),
          pz = cw(z);
        if (px > b.x0 && px < b.x1 && pz > b.z0 && pz < b.z1)
          nav[z * N + x] = 1;
      }

  navC.set(nav);
  const onBridge = (x, z) =>
    bridges.some(
      (b) =>
        Math.abs(x - b.x) < (b.ax ? b.len / 2 : b.w / 2 - 0.5) &&
        Math.abs(z - b.z) < (b.az ? b.len / 2 : b.w / 2 - 0.5),
    );
  for (let z = 0; z < N; z++)
    for (let x = 0; x < N; x++) {
      const px = cw(x),
        pz = cw(z);
      if (riverDist(px, pz) < 0.5 && !onBridge(px, pz)) navC[z * N + x] = 1;
    }
  const B = (x, z) => nav[z * N + x];
  for (let z = 8; z < N - 8; z++)
    for (let x = 8; x < N - 8; x++) {
      if (B(x, z)) continue;
      const px = cw(x),
        pz = cw(z);
      if (
        hyp(px, pz) > R_GRASS - 6 ||
        riverDist(px, pz) < 2.5 ||
        hyp(px - LOBBY.x, pz - LOBBY.z) < LOBBY.r + 3
      )
        continue;
      const nx = (B(x - 1, z) || B(x - 2, z)) && (B(x + 1, z) || B(x + 2, z)),
        nz = (B(x, z - 1) || B(x, z - 2)) && (B(x, z + 1) || B(x, z + 2));
      if (
        nx === nz ||
        hit(px, 0, pz, 0.6, 2) ||
        chokes.some((c) => hyp(c.x - px, c.z - pz) < 4)
      )
        continue;
      chokes.push({ x: px, z: pz });
    }
  for (const b of bridges)
    for (const s of [-1, 1])
      chokes.push({
        x: b.x + b.ax * s * (b.len / 2 + 1.8),
        z: b.z + b.az * s * (b.len / 2 + 1.8),
        bridge: true,
      });
  nav.set(navC); // the rivers are deep and full of crocodiles now: runner bots use the bridges too
}
const navFree = (x, z) => !GR[cellOf(z) * N + cellOf(x)];
function nearestFree(cx, cz) {
  if (!GR[cz * N + cx]) return cz * N + cx;
  for (let r = 1; r < 14; r++)
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = cx + dx,
          z = cz + dz;
        if (x < 0 || z < 0 || x >= N || z >= N) continue;
        if (!GR[z * N + x]) return z * N + x;
      }
  return -1;
}
function navLine(ax, az, bx, bz) {
  const d = hyp(bx - ax, bz - az),
    n = Math.ceil(d / 0.4);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (!navFree(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
  }
  return true;
}
const gS = new Float32Array(N * N),
  fS = new Float32Array(N * N),
  par = new Int32Array(N * N),
  st = new Uint32Array(N * N),
  cl = new Uint32Array(N * N);
let stamp = 0;
const DIRS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, 1.414],
  [1, -1, 1.414],
  [-1, 1, 1.414],
  [-1, -1, 1.414],
];
function findPath(sx, sz, tx, tz, forChaser) {
  GR = forChaser ? navC : nav;
  try {
    return findPath_(sx, sz, tx, tz);
  } finally {
    GR = nav;
  }
}
function findPath_(sx, sz, tx, tz) {
  const s = nearestFree(cellOf(sx), cellOf(sz)),
    t = nearestFree(cellOf(tx), cellOf(tz));
  if (s < 0 || t < 0) return null;
  const txc = t % N,
    tzc = (t / N) | 0;
  const hfn = (x, z) => {
    const a = Math.abs(x - txc),
      b = Math.abs(z - tzc);
    return Math.max(a, b) + 0.414 * Math.min(a, b);
  };
  stamp++;
  const heap = [s];
  gS[s] = 0;
  fS[s] = hfn(s % N, (s / N) | 0);
  st[s] = stamp;
  par[s] = -1;
  let best = s,
    bestH = fS[s],
    it = 0;
  while (heap.length && it++ < 22000) {
    // pop
    const cur = heap[0],
      last = heap.pop();
    if (heap.length) {
      let i = 0;
      heap[0] = last;
      for (;;) {
        let l = 2 * i + 1,
          r = l + 1,
          m = i;
        if (l < heap.length && fS[heap[l]] < fS[heap[m]]) m = l;
        if (r < heap.length && fS[heap[r]] < fS[heap[m]]) m = r;
        if (m === i) break;
        const q = heap[i];
        heap[i] = heap[m];
        heap[m] = q;
        i = m;
      }
    }
    if (cur === t) {
      best = t;
      break;
    }
    if (cl[cur] === stamp) continue;
    cl[cur] = stamp;
    const cx = cur % N,
      cz = (cur / N) | 0;
    for (let k = 0; k < 8; k++) {
      const nx = cx + DIRS[k][0],
        nz = cz + DIRS[k][1];
      if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
      const ni = nz * N + nx;
      if (GR[ni] || cl[ni] === stamp) continue;
      if (k > 3 && (GR[cz * N + nx] || GR[nz * N + cx])) continue;
      const ng = gS[cur] + DIRS[k][2];
      if (st[ni] !== stamp || ng < gS[ni]) {
        st[ni] = stamp;
        gS[ni] = ng;
        par[ni] = cur;
        const hh = hfn(nx, nz);
        fS[ni] = ng + hh;
        if (hh < bestH) {
          bestH = hh;
          best = ni;
        }
        let i = heap.length;
        heap.push(ni);
        while (i > 0) {
          const p = (i - 1) >> 1;
          if (fS[heap[p]] <= fS[heap[i]]) break;
          const q = heap[i];
          heap[i] = heap[p];
          heap[p] = q;
          i = p;
        }
      }
    }
  }
  const raw = [];
  for (let c = best; c !== -1; c = par[c])
    raw.push({ x: cw(c % N), z: cw((c / N) | 0) });
  raw.reverse();
  // string-pull
  const out = [];
  let a = 0;
  while (a < raw.length - 1) {
    let b = Math.min(raw.length - 1, a + 14);
    while (b > a + 1 && !navLine(raw[a].x, raw[a].z, raw[b].x, raw[b].z)) b--;
    out.push(raw[b]);
    a = b;
  }
  if (!out.length) out.push(raw[raw.length - 1]);
  return out;
}
function randFree(cx, cz, rmin, rmax) {
  for (let i = 0; i < 40; i++) {
    const a = rnd(6.283),
      r = rnd(rmin, rmax),
      x = cx + Math.cos(a) * r,
      z = cz + Math.sin(a) * r;
    if (hyp(x, z) < R_GRASS - 2 && navFree(x, z) && !inRiver(x, z))
      return { x, z };
  }
  return null;
}

/* ================= audio & fx ================= */
let actx = null;
function beep(f, d = 0.08, type = "square", v = 0.08, slide = 0) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const harsh = type === "square" || type === "sawtooth",
      t0 = actx.currentTime;
    const o = actx.createOscillator(),
      g = actx.createGain(),
      lp = actx.createBiquadFilter();
    o.type = harsh ? "triangle" : type;
    o.frequency.value = f;
    if (slide)
      o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), t0 + d);
    lp.type = "lowpass";
    lp.frequency.value = harsh ? 1400 : 4000;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(v * (harsh ? 1.3 : 1), t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + d);
    o.connect(g).connect(lp).connect(actx.destination);
    o.start(t0);
    o.stop(t0 + d + 0.02);
  } catch (e) {}
}
let chimeT = 0;
function chime(kind) {
  // feed notification: soft two-note bell (alarm = three quick high notes)
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const nv = SNDV.notif * 1.43;
    if (nv <= 0.01 || !BGM.on) return;
    const now = actx.currentTime;
    if (now - chimeT < 0.35 && kind !== "alarm") return;
    chimeT = now;
    const notes =
      kind === "alarm"
        ? [
            [988, 0],
            [784, 0.13],
            [988, 0.26],
            [784, 0.39],
          ]
        : [
            [784, 0],
            [1175, 0.09],
          ];
    for (const [f, at] of notes) {
      const o = actx.createOscillator(),
        g = actx.createGain(),
        t0 = now + at;
      o.type = "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(
        (kind === "alarm" ? 0.09 : 0.045) * nv,
        t0 + 0.01,
      );
      g.gain.exponentialRampToValueAtTime(
        0.0001,
        t0 + (kind === "alarm" ? 0.16 : 0.45),
      );
      o.connect(g).connect(actx.destination);
      o.start(t0);
      o.stop(t0 + 0.5);
    }
  } catch (e) {}
}
const fx = [];
function textSprite(text, color = "#fff", size = 64, bg = null) {
  const c = document.createElement("canvas"),
    x = c.getContext("2d"),
    font = `bold ${size}px Trebuchet MS, sans-serif`,
    I = window.ICO;
  const segs = I ? I.split(text) : [{ t: text }],
    iw = size * 1.08; // emoji become drawn icons (same width before and after the pictures load)
  x.font = font;
  let w = 24;
  for (const s of segs) w += s.t !== undefined ? x.measureText(s.t).width : iw;
  w = Math.ceil(w);
  c.width = w;
  c.height = size + 20;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const draw = () => {
    x.clearRect(0, 0, w, c.height);
    x.font = font;
    x.textBaseline = "middle";
    x.textAlign = "left";
    if (bg) {
      x.fillStyle = bg;
      x.fillRect(0, 0, w, c.height);
    }
    let px = 12;
    for (const s of segs) {
      if (s.t !== undefined) {
        x.lineWidth = 8;
        x.strokeStyle = "rgba(0,0,0,.75)";
        x.strokeText(s.t, px, c.height / 2);
        x.fillStyle = color;
        x.fillText(s.t, px, c.height / 2);
        px += x.measureText(s.t).width;
      } else {
        const im = I.imgs[s.k];
        if (im && im.complete && im.naturalWidth)
          x.drawImage(im, px + size * 0.04, (c.height - size) / 2, size, size);
        px += iw;
      }
    }
    tex.needsUpdate = true;
  };
  draw();
  if (I && !I.loaded && segs.some((s) => s.k)) I.ready.then(draw);
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
    }),
  );
  s.userData.aspect = w / c.height;
  return s;
}
function popText(text, x, y, z, color = "#ffe14d", scale = 0.9) {
  if (NET.on) {
    if (NET.guest && !NET.rx) return;
    if (NET.host) NET.ev.push(["p", text, r3(x), r3(y), r3(z), color, scale]);
  }
  const s = textSprite(text, color);
  s.scale.set(scale * s.userData.aspect, scale, 1);
  s.position.set(x, y, z);
  scene.add(s);
  fx.push({
    t: 0,
    life: 0.9,
    up(dt) {
      s.position.y += dt * 1.6;
      s.material.opacity = 1 - this.t / this.life;
    },
    end() {
      scene.remove(s);
      s.material.map.dispose();
      s.material.dispose();
    },
  });
}
function puff(x, y, z, col, n = 8, sp = 3) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(BOX, mat(col));
    const s = rnd(0.1, 0.25);
    m.scale.set(s, s, s);
    m.position.set(x, y, z);
    scene.add(m);
    const v = new THREE.Vector3(
      rnd(-1, 1) * sp,
      rnd(1, 2) * sp,
      rnd(-1, 1) * sp,
    );
    fx.push({
      t: 0,
      life: 0.7,
      up(dt) {
        v.y -= 14 * dt;
        m.position.addScaledVector(v, dt);
      },
      end() {
        scene.remove(m);
      },
    });
  }
}
function msg(t, kind) {
  if (NET.on) {
    const mine = /^You /.test(t);
    if (NET.guest && !NET.rx && !mine) return;
    if (NET.host && !mine) NET.ev.push(["m", t, kind]);
  }
  if (phase !== "menu") chime(kind);
  const d = document.createElement("div");
  d.textContent = t;
  $("feed").prepend(d);
  while ($("feed").children.length > 3) $("feed").lastChild.remove();
  setTimeout(() => (d.style.opacity = 0), 4500);
  setTimeout(() => d.remove(), 5200);
}

/* ================= characters ================= */
const ents = [];
let player = null,
  chaser = null;
function makeChar(shirt, isChaser) {
  const g = new THREE.Group(),
    body = new THREE.Group();
  g.add(body);
  const skin = 0xe2b58c,
    pants = 0x2c3442;
  const part = (w, h, d, c, x, y, z, parent = body) => {
    const m = new THREE.Mesh(BOX, mat(c));
    m.scale.set(w, h, d);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  part(0.7, 0.72, 0.4, shirt, 0, 1.11, 0);
  const head = new THREE.Group();
  head.position.set(0, 1.47, 0);
  body.add(head);
  part(0.46, 0.46, 0.46, skin, 0, 0.25, 0, head);
  part(0.5, 0.14, 0.5, isChaser ? 0x111111 : 0x5a3320, 0, 0.5, 0, head);
  const eyeL = part(0.08, 0.08, 0.03, 0x111111, -0.11, 0.3, 0.235, head),
    eyeR = part(0.08, 0.08, 0.03, 0x111111, 0.11, 0.3, 0.235, head);
  const browL = part(0.15, 0.035, 0.03, 0x2a1a0e, -0.11, 0.4, 0.238, head),
    browR = part(0.15, 0.035, 0.03, 0x2a1a0e, 0.11, 0.4, 0.238, head);
  const mouth = part(0.16, 0.04, 0.03, 0x5a1f1f, 0, 0.11, 0.238, head);
  const limb = (x, y, w, h, d, c, c2) => {
    const p = new THREE.Group();
    p.position.set(x, y, 0);
    body.add(p);
    part(w, h, d, c, 0, -h / 2, 0, p);
    if (c2) part(w + 0.02, 0.2, d + 0.02, c2, 0, -h + 0.1, 0, p);
    return p;
  };
  const armL = limb(-0.47, 1.45, 0.22, 0.7, 0.26, shirt, skin),
    armR = limb(0.47, 1.45, 0.22, 0.7, 0.26, shirt, skin);
  const legL = limb(-0.18, 0.75, 0.3, 0.75, 0.32, pants, 0x222222),
    legR = limb(0.18, 0.75, 0.3, 0.75, 0.32, pants, 0x222222);
  const vest = part(0.76, 0.5, 0.46, 0x2f6b2f, 0, 1.15, 0);
  vest.visible = false;
  return {
    g,
    body,
    head,
    armL,
    armR,
    legL,
    legR,
    vest,
    eyeL,
    eyeR,
    browL,
    browR,
    mouth,
  };
}
function mkEnt(name, role, isPlayer, color) {
  const v = makeChar(color, role === "chaser");
  const label = textSprite(name, role === "chaser" ? "#ff6b61" : "#ffffff", 48);
  label.scale.set(0.5 * label.userData.aspect, 0.5, 1);
  label.position.y = 2.35;
  v.g.add(label);
  if (role === "chaser") {
    const tag = textSprite("CHASER", "#fff", 40, "#c9302c");
    tag.scale.set(0.3 * tag.userData.aspect, 0.3, 1);
    tag.position.y = 2.8;
    v.g.add(tag);
  }
  const held = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.22, 0),
    new THREE.MeshBasicMaterial({ color: 0xff4444, wireframe: true }),
  );
  held.position.y = 2.05;
  held.visible = false;
  v.g.add(held);
  scene.add(v.g);
  const e = {
    name,
    role,
    isPlayer,
    v,
    label,
    heldMesh: held,
    pos: new THREE.Vector3(),
    vy: 0,
    yaw: 0,
    stance: 0,
    run: true,
    onGround: true,
    wx: 0,
    wz: 0,
    hp: 100,
    armor: 0,
    alive: true,
    stun: null,
    slow: 0,
    boost: 0,
    shoes: 0,
    held: null,
    nets: 0,
    hooks: 0,
    inv: { smoke: 0, decoy: 0, banana: 0, medkit: 0 },
    zipCd: 0,
    boatCd: 0,
    roarCd: 0,
    chargeCd: 0,
    color,
    kit: [],
    pushCd: 0,
    freezeImm: 0,
    atk: null,
    pushUsed: false,
    scared: false,
    cd: 0,
    kx: 0,
    kz: 0,
    walk: 0,
    moving: 0,
    wantJump: false,
    lastHit: 99,
    ai: {
      think: rnd(0.5),
      path: null,
      pi: 0,
      goalT: 0,
      alert: 0,
      wait: 0,
      mem: 0,
      last: null,
      stuckT: 0,
      sx: 0,
      sz: 0,
      climb: false,
      trapT: rnd(8, 16),
      react: 0,
      itemCd: 0,
    },
  };
  ents.push(e);
  return e;
}
function setStance(e, s) {
  if (e.stun) return;
  if (s < e.stance && hit(e.pos.x, e.pos.y, e.pos.z, RAD, H[s])) return;
  e.stance = s;
}
function tryMove(e, nx, nz) {
  const h = H[e.stance],
    y = e.pos.y,
    b = hit(nx, y, nz, RAD, h);
  if (!b) {
    e.pos.x = nx;
    e.pos.z = nz;
    return true;
  }
  const lim = e.onGround ? 0.45 : 1.0;
  if (b.y1 - y <= lim && b.y1 > y && !hit(nx, b.y1, nz, RAD, h)) {
    e.pos.x = nx;
    e.pos.z = nz;
    e.pos.y = b.y1;
    if (e.vy < 0) e.vy = 0;
    return true;
  }
  return false;
}
function stepEnt(e, dt) {
  // timers
  e.cd -= dt;
  e.slow -= dt;
  e.boost -= dt;
  e.lastHit += dt;
  if (specialMove(e, dt)) return;
  if (e.climbing) {
    // bot hauling itself up a wall
    const c = e.climbing;
    if (e.stun || !e.alive) e.climbing = null;
    else {
      c.t += dt;
      const k = Math.min(1, c.t / c.dur),
        up = Math.min(1, k / 0.8),
        ov = Math.max(0, (k - 0.8) / 0.2);
      e.pos.set(
        c.fx + (c.tx - c.fx) * ov,
        c.fy + (c.ty - c.fy) * up,
        c.fz + (c.tz - c.fz) * ov,
      );
      e.vy = 0;
      e.kx = e.kz = 0;
      e.moving = 0;
      e.onGround = false;
      e.yaw = Math.atan2(c.tx - c.fx, c.tz - c.fz);
      if (k >= 1) {
        e.climbing = null;
        e.onGround = true;
      }
      return;
    }
  }
  let wx = e.wx,
    wz = e.wz,
    wl = hyp(wx, wz);
  if (wl > 1) {
    wx /= wl;
    wz /= wl;
    wl = 1;
  }
  let locked = !e.alive;
  if (e.stun) {
    e.stun.t -= dt;
    locked = true;
    if (e.stun.type === "hook" && e.stun.src) {
      const dx = e.stun.src.pos.x - e.pos.x,
        dz = e.stun.src.pos.z - e.pos.z,
        d = hyp(dx, dz);
      if (d > 1.7) {
        const s = Math.min(26 * dt, d - 1.6);
        tryMove(e, e.pos.x + (dx / d) * s, e.pos.z);
        tryMove(e, e.pos.x, e.pos.z + (dz / d) * s);
      } else e.stun.t = 0;
    }
    if (e.stun.t <= 0) {
      const ty = e.stun.type;
      e.stun = null;
      if (STUCK.includes(ty)) {
        if (e.hum) statusTo(e, "");
      }
    }
  }
  const inWater = e.pos.y < -0.2;
  let sp = (e.run ? (e.role === "chaser" ? 8.4 : 8.0) : 4.3) * SPD[e.stance];
  if (e.fuel) sp *= 0.82;
  if (e.chain) sp *= 0.88;
  if (e.sail) sp *= 0.9;
  if (e.wood) sp *= 1 - 0.035 * e.wood;
  if (e.iron) sp *= 1 - 0.05 * e.iron;
  sp *= tideSlow(e);
  if (e.run) sp *= 1 - 0.08 * stormK;
  if (!e.isPlayer && !e.rid) sp *= e.role === "chaser" ? LVL.cs : LVL.rs; // the bot speed setting never applies to people
  if (e.slow > 0) sp *= 0.5;
  if (e.boost > 0) sp *= 1.6;
  if (inWater)
    sp *=
      hyp(e.pos.x, e.pos.z) > R_ISLAND
        ? e.role === "chaser"
          ? FIN.on
            ? 0.8
            : 0.6
          : 0.45
        : e.role === "chaser"
          ? FIN.on
            ? 0.9
            : 0.5
          : 0.5;
  if (e.atk) sp *= 0.35;
  let mx = 0,
    mz = 0;
  if (!locked) {
    mx = wx * sp;
    mz = wz * sp;
    if (wl > 0.05 && !e.atk) {
      const ty = Math.atan2(wx, wz);
      let d = ty - e.yaw;
      while (d > Math.PI) d -= 6.283;
      while (d < -Math.PI) d += 6.283;
      e.yaw += d * Math.min(1, dt * 14);
    }
    if (e.wantJump && e.onGround) {
      if (e.stance > 0) setStance(e, 0);
      if (e.stance === 0) {
        e.vy = JUMP;
        e.onGround = false;
        if (e.isPlayer) beep(300, 0.1, "sine", 0.05, 200);
      }
    }
  }
  e.wantJump = false;
  mx += e.kx;
  mz += e.kz;
  const kd = Math.exp(-6 * dt);
  e.kx *= kd;
  e.kz *= kd;
  const ox = e.pos.x,
    oz = e.pos.z;
  const stuckType = e.stun && STUCK.includes(e.stun.type);
  if (!stuckType) {
    let blocked = false;
    if (mx) blocked = !tryMove(e, e.pos.x + mx * dt, e.pos.z) || blocked;
    if (mz) blocked = !tryMove(e, e.pos.x, e.pos.z + mz * dt) || blocked;
    if (blocked && e.ai.climb && !locked) {
      e.vy = Math.max(e.vy, 5.5);
      e.onGround = false;
    }
  }
  // bounds
  if (phase === "lobby") {
    const dx = e.pos.x - LOBBY.x,
      dz = e.pos.z - LOBBY.z,
      d = hyp(dx, dz);
    if (e.role === "runner" && d > LOBBY.r - 0.5) {
      e.pos.x = LOBBY.x + (dx / d) * (LOBBY.r - 0.5);
      e.pos.z = LOBBY.z + (dz / d) * (LOBBY.r - 0.5);
    }
    if (e.role === "chaser" && d < LOBBY.r + 1.2) {
      e.pos.x = LOBBY.x + (dx / d) * (LOBBY.r + 1.2);
      e.pos.z = LOBBY.z + (dz / d) * (LOBBY.r + 1.2);
    }
  }
  const rr = hyp(e.pos.x, e.pos.z),
    rmax = R_ISLAND + (FIN.on || RAFT.go ? 46 : 14);
  if (rr > rmax) {
    e.pos.x *= rmax / rr;
    e.pos.z *= rmax / rr;
  }
  // vertical
  if (!(e.stun && e.stun.type === "hang")) {
    e.vy -= GRAV * dt;
    let ny = e.pos.y + e.vy * dt;
    if (e.vy <= 0) {
      let floor = groundY(e.pos.x, e.pos.z);
      const r = RAD * 0.9,
        x = e.pos.x,
        z = e.pos.z;
      for (let i = 0; i < colliders.length; i++) {
        const b = colliders[i];
        if (
          x + r > b.x0 &&
          x - r < b.x1 &&
          z + r > b.z0 &&
          z - r < b.z1 &&
          b.y1 <= e.pos.y + 0.05 &&
          b.y1 > floor
        )
          floor = b.y1;
      }
      if (ny <= floor) {
        ny = floor;
        e.vy = 0;
        e.onGround = true;
      } else e.onGround = false;
    } else {
      if (hit(e.pos.x, ny, e.pos.z, RAD, H[e.stance])) {
        ny = e.pos.y;
        e.vy = 0;
      }
      e.onGround = false;
    }
    e.pos.y = ny;
  }
  e.moving = hyp(e.pos.x - ox, e.pos.z - oz) / Math.max(dt, 1e-4);
  afterMove(e, dt);
  footstep(e, dt);
  // attack progress
  if (e.atk) {
    const a = e.atk;
    a.t += dt;
    if (!a.done && a.t >= a.dur * 0.4) {
      a.done = true;
      doHit(e, a.type);
    }
    if (a.t >= a.dur) e.atk = null;
  }
}
function setFace(e) {
  const v = e.v,
    st = e.stun && e.stun.type;
  let ex = 0.08,
    ey = 0.08,
    bz = 0,
    by = 0.4,
    mw = 0.16,
    mh = 0.04;
  const pant = 0.06 + Math.abs(Math.sin(clock * 9)) * 0.08;
  if (!e.alive) {
    ey = 0.02;
    ex = 0.12;
    mw = 0.1;
    mh = 0.1;
    bz = 0.3;
  } else if (e.lastHit < 0.5 || st === "stagger" || st === "slip") {
    ey = 0.025;
    ex = 0.12;
    bz = -0.5;
    by = 0.36;
    mw = 0.22;
    mh = 0.1;
  } // wince
  else if (st) {
    ey = 0.14;
    ex = 0.1;
    by = 0.46;
    bz = 0.4;
    mw = 0.15;
    mh = 0.16;
  } // panic
  else if (e.role === "chaser") {
    bz = -0.6;
    by = 0.37;
    ey = 0.06;
    if (e.atk) {
      mw = 0.24;
      mh = 0.11;
    } else if (e.moving > 5) {
      mw = 0.22;
      mh = 0.07;
    } else {
      mw = 0.2;
      mh = 0.035;
    }
  } // angry
  else if (e.moving > 5) {
    if (e.scared) {
      ey = 0.14;
      ex = 0.1;
      by = 0.47;
      bz = 0.45;
      mw = 0.16;
      mh = pant + 0.06;
    } else {
      ey = 0.07;
      bz = -0.2;
      mw = 0.13;
      mh = pant;
    }
  } // terrified sprint / panting
  else if (e.scared) {
    ey = 0.12;
    by = 0.45;
    bz = 0.35;
    mw = 0.1;
    mh = 0.07;
  } else {
    mw = 0.18;
    mh = 0.035;
  }
  v.eyeL.scale.set(ex, ey, 0.03);
  v.eyeR.scale.set(ex, ey, 0.03);
  v.browL.position.y = v.browR.position.y = by;
  v.browL.rotation.z = bz;
  v.browR.rotation.z = -bz;
  if (e.sayT > 0) {
    mw = 0.21;
    mh = 0.07 + 0.075 * Math.abs(Math.sin(clock * 13));
  } // talking: the mouth opens and closes
  v.mouth.scale.set(mw, mh, 0.03);
}
function updateVisual(e, dt) {
  if (e.sayT > 0) e.sayT -= dt;
  setFace(e);
  const v = e.v,
    b = v.body;
  e.walk += e.moving * dt * 1.5;
  const sw = e.onGround
    ? Math.sin(e.walk) * Math.min(1, e.moving / 5) * 0.9
    : 0.5;
  v.g.position.copy(e.pos);
  v.g.rotation.y = e.yaw;
  b.rotation.set(0, 0, 0);
  b.position.set(0, 0, 0);
  b.scale.set(1, 1, 1);
  v.legL.rotation.x = sw;
  v.legR.rotation.x = -sw;
  v.armL.rotation.x = -sw;
  v.armR.rotation.x = sw;
  v.armL.rotation.z = v.armR.rotation.z = 0;
  e.label.position.y = 2.35;
  e.label.visible = true;
  const st = e.stun && e.stun.type;
  if (!e.alive) {
    b.rotation.x = -Math.PI / 2;
    b.position.set(0, 0.22, 0.9);
    v.armL.rotation.z = -1;
    v.armR.rotation.z = 1;
    v.legL.rotation.x = v.legR.rotation.x = 0;
    e.label.position.y = 1;
  } else if (st === "hang") {
    const s = Math.sin(clock * 3) * 0.25;
    b.rotation.z = Math.PI + s;
    b.position.y = 3.5;
    v.armL.rotation.x = v.armR.rotation.x = Math.PI;
    e.label.position.y = 4;
  } else if (st === "pit") {
    v.g.position.y = e.pos.y - 1.25;
    v.armL.rotation.x = v.armR.rotation.x =
      Math.PI + Math.sin(clock * 12) * 0.4;
    e.label.position.y = 3.4;
  } else if (st === "slip") {
    b.rotation.x = -Math.PI / 2;
    b.position.set(0, 0.22, 0.9);
    e.label.position.y = 1;
  } else if (e.stance === 2) {
    b.rotation.x = Math.PI / 2;
    b.position.set(0, 0.24, -0.9);
    v.armL.rotation.x = v.armR.rotation.x = Math.PI + sw * 0.6;
    v.legL.rotation.x *= 0.4;
    v.legR.rotation.x *= 0.4;
    e.label.position.y = 1;
  } else if (e.stance === 1) {
    b.scale.y = 0.62;
    b.rotation.x = 0.18;
    e.label.position.y = 1.6;
  } else if (e.moving > 5 && e.onGround)
    b.rotation.x = e.boost > 0 ? 0.3 : 0.15;
  if (st === "net" || st === "stagger") {
    b.rotation.z += Math.sin(clock * 30) * 0.08;
  }
  if (e.atk) {
    const k = Math.sin(Math.min(1, e.atk.t / e.atk.dur) * Math.PI);
    if (e.atk.type === "punch") {
      (e.atk.left ? v.armL : v.armR).rotation.x = -1.6 * k;
      b.rotation.y = (e.atk.left ? 0.35 : -0.35) * k;
      (e.atk.left ? v.armR : v.armL).rotation.x = -0.6;
    } else if (e.atk.type === "push") {
      v.armL.rotation.x = v.armR.rotation.x = -1.55 * k;
      b.rotation.x = 0.2 * k;
    } else {
      v.legR.rotation.x = -1.7 * k;
      b.rotation.x = -0.25 * k;
      v.armL.rotation.x = 0.6 * k;
      v.armR.rotation.x = 0.6 * k;
    }
  } else if (e.role === "chaser" && e.alive && !st && e.stance === 0) {
    v.armL.rotation.x -= 0.5;
    v.armR.rotation.x -= 0.5;
  } // fists up
  if (
    e.alive &&
    e.pos.y < -0.8 &&
    !st &&
    !e.boat &&
    e.raft == null &&
    e.seat == null &&
    !e.hidden &&
    !e.cap
  ) {
    // deep water: swim
    const top = waterTop(e.pos.x, e.pos.z),
      s = Math.sin(clock * (e.moving > 1 ? 9 : 3.5));
    b.rotation.set(1.15, 0, 0);
    b.scale.set(1, 1, 1);
    b.position.set(0, top - 0.55 - e.pos.y, -0.45);
    v.armL.rotation.x = Math.PI + s * 0.9;
    v.armR.rotation.x = Math.PI - s * 0.9;
    v.legL.rotation.x = s * 0.5;
    v.legR.rotation.x = -s * 0.5;
    e.label.position.y = top - e.pos.y + 1.3;
  }
  if (e.climbing) {
    const s = Math.sin(clock * 11);
    v.armL.rotation.x = Math.PI + s * 0.5;
    v.armR.rotation.x = Math.PI - s * 0.5;
    v.legL.rotation.x = s * 0.7;
    v.legR.rotation.x = -s * 0.7;
  }
  visExtras(e);
  v.vest.visible = e.armor > 0;
  e.heldMesh.visible = !!e.held;
  if (e.held) e.heldMesh.rotation.y += dt * 3;
  if (e.netMesh) {
    e.netMesh.visible = st === "net";
  }
}

/* ================= combat ================= */
function startAttack(e, type) {
  if (e.atk || e.cd > 0 || e.stun || phase === "end") return;
  if (e.stance) setStance(e, 0);
  if (e.isPlayer) {
    // aim assist
    let best = null,
      bd = 3.4;
    for (const r of ents)
      if (isPrey(r)) {
        const d = hyp(r.pos.x - e.pos.x, r.pos.z - e.pos.z);
        if (d < bd) {
          bd = d;
          best = r;
        }
      }
    if (best) e.yaw = Math.atan2(best.pos.x - e.pos.x, best.pos.z - e.pos.z);
    else e.yaw = camYaw + Math.PI;
  }
  e.punchSide = !e.punchSide;
  e.atk = {
    type,
    t: 0,
    dur: type === "punch" ? 0.32 : 0.5,
    left: e.punchSide,
    done: false,
  };
  e.cd = type === "punch" ? 0.42 : 0.85;
  whoosh(e);
}
function doHit(e, type) {
  const range = type === "punch" ? 2.0 : 2.5,
    fx_ = Math.sin(e.yaw),
    fz = Math.cos(e.yaw);
  if (phase === "game") searchSpots(e);
  for (const r of ents) {
    if (!isPrey(r)) continue;
    const dx = r.pos.x - e.pos.x,
      dz = r.pos.z - e.pos.z,
      d = hyp(dx, dz);
    if (d > range || Math.abs(r.pos.y - e.pos.y) > 1.7) continue;
    if (d > 0.5 && (dx * fx_ + dz * fz) / d < 0.3) continue;
    if (phase !== "game") {
      popText("not yet!", r.pos.x, r.pos.y + 2.4, r.pos.z, "#fff", 0.5);
      continue;
    }
    r.caughtBy = e;
    damage(
      r,
      type === "punch" ? 9 : 15,
      fx_,
      fz,
      type === "punch" ? 5 : 11,
      type === "punch"
        ? ["POW!", "BAM!", "WHACK!"][Math.floor(rnd(3))]
        : "KICK!",
      true,
    );
  }
}
function damage(r, dmg, dx, dz, kb, text, beat) {
  if (r.seat != null) leaveSeat(r);
  if (r.role === "decoy") {
    popDecoy(r);
    return;
  }
  if (r.armor > 0) {
    const a = Math.min(r.armor, dmg);
    r.armor -= a;
    dmg -= a * 0.85;
    if (r.armor <= 0) {
      msg(`${r.name}'s vest broke!`);
      puff(r.pos.x, r.pos.y + 1.2, r.pos.z, 0x2f6b2f, 8);
    }
  }
  r.hp -= dmg;
  r.lastHit = 0;
  const stuck = r.stun && STUCK.includes(r.stun.type);
  if (!stuck) {
    r.kx += dx * kb;
    r.kz += dz * kb;
    if (kb > 8 && r.onGround) r.vy = 4;
    if (!r.stun) r.stun = { type: "stagger", t: 0.22 };
  }
  popText(
    text,
    r.pos.x,
    r.pos.y + 2.2 + (r.stun && r.stun.type === "hang" ? 1 : 0),
    r.pos.z,
  );
  puff(r.pos.x, r.pos.y + 1.3, r.pos.z, 0xffe14d, 5, 2.5);
  thud(r, kb > 8 ? 1.25 : 1);
  if (beat) playHit(r);
  r.ai.alert = 8;
  if (r.isPlayer) {
    $("flash").style.opacity = 1;
    setTimeout(() => ($("flash").style.opacity = 0), 160);
    shake = 0.35;
  } else if (player && player.role === "chaser") shake = 0.15;
  if (r.hp <= 0) knockOut(r);
}
function knockOut(r) {
  if (r.caughtBy && r.caughtBy.alive && r.caughtBy.role === "chaser")
    say(r.caughtBy, HAH); // caught you: the chaser laughs
  r.hp = 0;
  r.alive = false;
  r.stun = null;
  r.held && dropItem(r);
  r.cap = "down";
  r.capT = 0;
  r.claim = null;
  r.claimT = 0;
  for (const [k, ty] of [
    ["wood", "wood"],
    ["iron", "iron"],
    ["sail", "sail"],
  ]) {
    for (let i = 0; i < (r[k] || 0); i++) {
      const a = rnd(6.283);
      spawnItem(
        ty,
        r.pos.x + Math.cos(a) * 1.3,
        r.pos.z + Math.sin(a) * 1.3,
        floorAt(r.pos.x, r.pos.z, r.pos.y + 0.3),
        false,
        ty === "wood" && i < (r.wet || 0),
      );
    }
    if (ty === "wood") r.wet = 0;
    if (r[k])
      msg(
        `${r.name} dropped ${r[k]} ${ty === "wood" ? "plank" : ty === "sail" ? "sail cloth" : "iron part"}${r[k] > 1 && ty !== "sail" ? "s" : ""}`,
      );
    r[k] = 0;
  }
  if (r.fuel) {
    r.fuel = false;
    spawnItem(
      "fuel",
      r.pos.x,
      r.pos.z,
      floorAt(r.pos.x, r.pos.z, r.pos.y + 0.3),
    );
    msg(`⛽ ${r.name} dropped a fuel can`);
  }
  if (FIN.on) {
    r.cap = "out";
    r.hop = null;
    r.ci = undefined;
    msg(`🌊 ${r.name} was lost to the flood`, "alarm");
    puff(r.pos.x, 0.4, r.pos.z, 0xbfe6ff, 22, 5);
    sndAt(r, { f: 220, slide: -150, d: 0.5, type: "triangle", v: 0.22 });
    return;
  }
  msg(`💥 ${r.name} was beaten down!`);
  popText("K.O.!", r.pos.x, r.pos.y + 2.8, r.pos.z, "#ff5a4d", 1.3);
  sndAt(r, { f: 220, slide: -150, d: 0.5, type: "triangle", v: 0.22 });
}
function doPush(e) {
  if (!e.alive || e.stun) return;
  if (e.role === "runner" && phase === "game") {
    // pulling a teammate out of a trap: always possible, no cooldown
    let t = null,
      bd = 2.6;
    for (const o of ents)
      if (o !== e && o.role === "runner" && o.alive && o.stun && o.stun.held) {
        const d = hyp(o.pos.x - e.pos.x, o.pos.z - e.pos.z);
        if (d < bd && Math.abs(o.pos.y - e.pos.y) < 2.5) {
          bd = d;
          t = o;
        }
      }
    if (t) {
      const dx = t.pos.x - e.pos.x,
        dz = t.pos.z - e.pos.z,
        l = hyp(dx, dz) || 1;
      e.yaw = Math.atan2(dx, dz);
      e.atk = { type: "push", t: 0, dur: 0.32, left: false, done: true };
      t.stun = null;
      t.pos.y = Math.max(t.pos.y, 0.05);
      t.vy = 5;
      t.onGround = false;
      t.kx += (dx / l) * 7;
      t.kz += (dz / l) * 7;
      t.trapImm = 2;
      if (t.ai) {
        t.ai.alert = 6;
        t.ai.path = null;
      }
      popText("FREED!", t.pos.x, t.pos.y + 2.6, t.pos.z, "#7dffa0", 1.1);
      puff(t.pos.x, t.pos.y + 0.8, t.pos.z, 0x7dffa0, 12, 3);
      beep(620, 0.25, "sine", 0.08, 300);
      msg(`🤝 ${e.name} pushed ${t.name} out of the trap!`);
      if (t.hum) statusTo(t, "🤝 A teammate pushed you free — RUN!", 2.5);
      return;
    }
  }
  if (e.pushCd > 0) {
    if (e.hum) statusTo(e, `Push ready in ${Math.ceil(e.pushCd)}s`, 1.2);
    return;
  }
  if (phase === "game" && MT.on) {
    // shove a mountain monster off the path
    let mm = null,
      md = 2.9;
    for (const m of MT.mons) {
      if (m.fall) continue;
      const q = m.g.position,
        d = hyp(q.x - e.pos.x, q.z - e.pos.z);
      if (d < md && Math.abs(q.y - e.pos.y) < 1.8) {
        md = d;
        mm = m;
      }
    }
    if (mm) {
      const q = mm.g.position,
        ox = q.x - MT.x,
        oz = q.z - MT.z,
        ol = hyp(ox, oz) || 1;
      e.yaw = Math.atan2(q.x - e.pos.x, q.z - e.pos.z);
      e.pushCd = e.role === "runner" ? 10 : 5;
      e.atk = { type: "push", t: 0, dur: 0.32, left: false, done: true };
      if (mm.hp > 1) {
        mm.hp--;
        mm.stag = 1.5;
        mm.wind = 0;
        e.pushCd = e.role === "runner" ? 4 : 3;
        popText("STAGGERED!", q.x, q.y + 2.6, q.z, "#ffd23f", 1.1);
        puff(q.x, q.y + 1, q.z, 0xffffff, 8, 3);
        beep(110, 0.15, "square", 0.1, -30);
        if (e.hum)
          statusTo(
            e,
            "👹 It only staggered — run past now, or shove it AGAIN in 4 s to throw it off",
            3,
          );
        return;
      }
      mm.wind = 0;
      mm.fall = {
        t: 0,
        x: q.x,
        y: q.y,
        z: q.z,
        vx: (ox / ol) * 7,
        vz: (oz / ol) * 7,
        vy: 6,
        gy: 0,
        hit: false,
      };
      {
        const fx_ = q.x + (ox / ol) * 6,
          fz_ = q.z + (oz / ol) * 6;
        mm.fall.gy = Math.min(q.y, floorAt(fx_, fz_, q.y + 0.5));
        if (hyp(fx_, fz_) > R_ISLAND) mm.fall.gy = Math.max(mm.fall.gy, -1.5);
      }
      popText("SHOVE!", q.x, q.y + 2.6, q.z, "#9fe0ff", 1.1);
      puff(q.x, q.y + 1, q.z, 0xffffff, 10, 3);
      beep(130, 0.18, "square", 0.1, -50);
      msg(`💪 ${e.name} shoved a mountain monster off the path!`);
      if (e.hum)
        statusTo(
          e,
          "💪 Monster shoved off the mountain — it climbs back in 8 s",
          2.5,
        );
      return;
    }
  }
  if (phase !== "game") {
    if (e.hum) statusTo(e, "You can push once the round starts", 1.5);
    return;
  }
  let t = null,
    bd = 2.5;
  for (const o of ents) {
    if (
      o === e ||
      !o.alive ||
      o.hidden ||
      (o.stun && STUCK.includes(o.stun.type))
    )
      continue;
    const d = hyp(o.pos.x - e.pos.x, o.pos.z - e.pos.z);
    if (d < bd && Math.abs(o.pos.y - e.pos.y) < 1.5) {
      bd = d;
      t = o;
    }
  }
  if (!t) {
    if (e.hum) statusTo(e, "No one close enough to push", 1.2);
    return;
  }
  if (e.role === "chaser" && t.seat != null) {
    e.yaw = Math.atan2(t.pos.x - e.pos.x, t.pos.z - e.pos.z);
    shoveOff(e, t);
    return;
  }
  if (e.role === "chaser" && t.raft != null) {
    e.yaw = Math.atan2(t.pos.x - e.pos.x, t.pos.z - e.pos.z);
    e.pushCd = 4;
    e.atk = { type: "push", t: 0, dur: 0.32, left: false, done: true };
    raftOff(t, e);
    return;
  }
  const dx = t.pos.x - e.pos.x,
    dz = t.pos.z - e.pos.z,
    l = hyp(dx, dz) || 1;
  e.yaw = Math.atan2(dx, dz);
  e.pushCd = e.role === "runner" ? 10 : 5;
  e.atk = { type: "push", t: 0, dur: 0.32, left: false, done: true };
  t.kx += (dx / l) * 17;
  t.kz += (dz / l) * 17;
  if (t.onGround) t.vy = 4.5;
  t.atk = null;
  t.stun = { type: "slip", t: t.role === "chaser" ? 1.9 : 1.2 };
  popText("SHOVE!", t.pos.x, t.pos.y + 2.4, t.pos.z, "#9fe0ff", 1);
  puff(t.pos.x, t.pos.y + 1.2, t.pos.z, 0xffffff, 8, 3);
  beep(130, 0.18, "square", 0.1, -50);
  msg(`🫸 ${e.name} shoved ${t.name} to the ground!`);
  if (e.isPlayer || t.isPlayer) shake = 0.3;
  if (t.hum) statusTo(t, "🫸 You got SHOVED!", 1.5);
}
function dropItem(r) {
  spawnItem(r.held, r.pos.x, r.pos.z);
  r.held = null;
}

/* nets, hooks, thrown items */
const projs = [];
function useNet_(e) {
  if (e.nets <= 0 || e.cd > 0 || e.stun || phase !== "game") return;
  const t = aimTarget(e, 16, 0.5);
  e.nets--;
  e.cd = 0.6;
  let dx = Math.sin(e.yaw),
    dz = Math.cos(e.yaw),
    dy = 0.1;
  if (t) {
    const d = hyp(t.pos.x - e.pos.x, t.pos.z - e.pos.z) || 1;
    const lead = d / 24;
    dx = t.pos.x + t.wx * 6 * lead - e.pos.x;
    dz = t.pos.z + t.wz * 6 * lead - e.pos.z;
    const l = hyp(dx, dz) || 1;
    dx /= l;
    dz /= l;
    dy = (t.pos.y - e.pos.y) / d + 0.08;
    e.yaw = Math.atan2(dx, dz);
  }
  const m = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.6, 1),
    new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true }),
  );
  scene.add(m);
  m.position.set(e.pos.x, e.pos.y + 1.4, e.pos.z);
  projs.push({ kind: "net", m, vx: dx * 24, vy: dy * 24, vz: dz * 24, t: 0 });
  beep(500, 0.15, "sine", 0.06, -300);
  if (e.isPlayer || true) msg(`${e.name} threw a net!`);
}
function useHook_(e) {
  if (e.cd > 0 || e.stun || phase !== "game") return;
  if (e.hookCd > 0) {
    if (e.hum) statusTo(e, `🪝 Hook ready in ${Math.ceil(e.hookCd)}s`, 1);
    return;
  }
  e.hookCd = 7;
  e.cd = 0.8;
  let t = aimTarget(e, 24, 0.75),
    dodged = null;
  if (
    t &&
    (clock - (t.jig || -9) < 0.5 ||
      (!t.isPlayer && t.moving > 3 && Math.random() < 0.12 + 0.18 * LVL.smart))
  ) {
    dodged = t;
    t = null;
  } // jiggling left-right makes the hook miss
  const ax = e.pos.x,
    ay = e.pos.y + 1.3,
    az = e.pos.z;
  let bx = ax + Math.sin(e.yaw) * 20,
    by = ay,
    bz = az + Math.cos(e.yaw) * 20;
  if (t) {
    bx = t.pos.x;
    by = t.pos.y + 1;
    bz = t.pos.z;
    e.yaw = Math.atan2(bx - ax, bz - az);
    t.stun = { type: "hook", t: 1.2, src: e };
    t.ai.alert = 8;
    msg(`🪝 ${e.name} hooked ${t.name}!`);
    if (t.hum) statusTo(t, "🪝 HOOKED!", 1.5);
  } else if (dodged) {
    bx = dodged.pos.x + Math.cos(e.yaw) * 1.1;
    by = dodged.pos.y + 1;
    bz = dodged.pos.z - Math.sin(e.yaw) * 1.1;
    popText(
      "DODGED!",
      dodged.pos.x,
      dodged.pos.y + 2.6,
      dodged.pos.z,
      "#7dffa0",
      1,
    );
    msg(`🪝 ${dodged.name} jiggled out of ${e.name}'s hook!`);
    if (dodged.hum)
      statusTo(dodged, "🪝 You dodged the hook — nice jiggle!", 2);
    dodged.ai.alert = 8;
  } else msg(`${e.name}'s hook missed`);
  const len = hyp(bx - ax, by - ay, bz - az),
    rope = new THREE.Mesh(BOX, mat(0x222222));
  rope.scale.set(0.06, 0.06, len);
  rope.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
  rope.lookAt(bx, by, bz);
  scene.add(rope);
  fx.push({
    t: 0,
    life: 0.5,
    up() {},
    end() {
      scene.remove(rope);
    },
  });
  beep(700, 0.2, "sawtooth", 0.05, -500);
}
function aimTarget(e, range, cosMin) {
  let best = null,
    bs = 1e9;
  const fx_ = Math.sin(e.yaw),
    fz = Math.cos(e.yaw);
  const cfx = e.isPlayer ? -Math.sin(camYaw) : e.rid ? -Math.sin(e.cy) : fx_,
    cfz = e.isPlayer ? -Math.cos(camYaw) : e.rid ? -Math.cos(e.cy) : fz;
  for (const r of ents) {
    if (!isPrey(r)) continue;
    const dx = r.pos.x - e.pos.x,
      dz = r.pos.z - e.pos.z,
      d = hyp(dx, dz);
    if (d > range || d < 0.01) continue;
    const dot = (dx * cfx + dz * cfz) / d;
    if (dot < cosMin) continue;
    if (
      !los(
        e.pos.x,
        e.pos.y + 1.5,
        e.pos.z,
        r.pos.x,
        r.pos.y + H[r.stance] * 0.7,
        r.pos.z,
      )
    )
      continue;
    const s = d * (1.6 - dot);
    if (s < bs) {
      bs = s;
      best = r;
    }
  }
  return best;
}
function throwHeld_(e) {
  if (!e.held || e.stun || !e.alive) return;
  const m = itemMesh(e.held);
  scene.add(m);
  m.position.set(e.pos.x, e.pos.y + 1.5, e.pos.z);
  const fx_ = e.isPlayer
      ? -Math.sin(camYaw)
      : e.rid
        ? -Math.sin(e.cy)
        : Math.sin(e.yaw),
    fz = e.isPlayer
      ? -Math.cos(camYaw)
      : e.rid
        ? -Math.cos(e.cy)
        : Math.cos(e.yaw);
  e.yaw = Math.atan2(fx_, fz);
  projs.push({
    kind: "item",
    type: e.held,
    m,
    vx: fx_ * 18,
    vy: 8,
    vz: fz * 18,
    t: 0,
    by: e.name,
  });
  e.held = null;
  e.atk = { type: "punch", t: 0, dur: 0.3, left: false, done: true };
  beep(400, 0.12, "sine", 0.05, 200);
}
function updateProjs(dt) {
  for (let i = projs.length - 1; i >= 0; i--) {
    const p = projs[i],
      m = p.m;
    p.t += dt;
    let dead = false;
    if (p.kind === "net") {
      p.vy -= 6 * dt;
      m.position.x += p.vx * dt;
      m.position.y += p.vy * dt;
      m.position.z += p.vz * dt;
      m.rotation.x += dt * 8;
      for (const r of ents)
        if (
          isPrey(r) &&
          hyp(r.pos.x - m.position.x, r.pos.z - m.position.z) < 1.4 &&
          Math.abs(r.pos.y + 1 - m.position.y) < 1.8
        ) {
          r.stun = { type: "net", t: 3.5 };
          r.ai.alert = 8;
          msg(`🕸️ ${r.name} is tangled in a net!`);
          if (r.hum) statusTo(r, "🕸️ NETTED! mash JUMP to break free");
          if (!r.netMesh) {
            r.netMesh = new THREE.Mesh(
              new THREE.IcosahedronGeometry(1.05, 1),
              new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true }),
            );
            r.netMesh.position.y = 0.95;
            r.v.g.add(r.netMesh);
          }
          dead = true;
          beep(250, 0.2, "triangle", 0.08);
          break;
        }
      if (
        p.t > 1.1 ||
        m.position.y < groundY(m.position.x, m.position.z) ||
        pointIn(m.position.x, m.position.y, m.position.z)
      )
        dead = true;
    } else {
      p.vy -= GRAV * dt;
      m.position.x += p.vx * dt;
      m.position.y += p.vy * dt;
      m.position.z += p.vz * dt;
      m.rotation.x += dt * 7;
      if (pointIn(m.position.x, m.position.y, m.position.z) && p.vy > -2) {
        p.vx *= -0.2;
        p.vz *= -0.2;
      }
      const r = hyp(m.position.x, m.position.z);
      if (r > R_ISLAND && m.position.y < -0.3) {
        dead = true;
        puff(m.position.x, -0.2, m.position.z, 0xbfe6ff, 12, 4);
        msg(`🌊 ${p.by} threw the chaser's ${p.type} into the ocean!`);
        popText("SPLASH!", m.position.x, 1, m.position.z, "#9fe0ff", 1.2);
        beep(180, 0.3, "sine", 0.08, -100);
      } else if (r <= R_ISLAND && m.position.y < 0.2 && p.vy < 0) {
        dead = true;
        let x = m.position.x,
          z = m.position.z;
        if (hit(x, 0, z, 0.3, 1)) {
          const c = nearestFree(cellOf(x), cellOf(z));
          if (c >= 0) {
            x = cw(c % N);
            z = cw((c / N) | 0);
          }
        }
        spawnItem(p.type, x, z);
      }
    }
    if (dead) {
      scene.remove(m);
      projs.splice(i, 1);
    }
  }
}

/* ================= items ================= */
const items = [];
const ITEM_INFO = {
  vest: { c: 0x3fae4a, n: "Vest", ring: 0x35c8ff },
  shoes: { c: 0xff9a2e, n: "Boost shoes", ring: 0x35c8ff },
  net: { c: 0xffffff, n: "Net", ring: 0xff4d4d },
  hook: { c: 0x9aa3ab, n: "Hook", ring: 0xff4d4d },
};
function itemMesh(type) {
  const g = new THREE.Group(),
    add = (w, h, d, c, x, y, z) => {
      const m = new THREE.Mesh(BOX, mat(c));
      m.scale.set(w, h, d);
      m.position.set(x, y, z);
      m.castShadow = true;
      g.add(m);
      return m;
    };
  if (EXTRA_MESH[type]) {
    EXTRA_MESH[type](add);
    return g;
  }
  if (type === "vest") {
    add(0.6, 0.6, 0.3, 0x2f6b2f, 0, 0, 0);
    add(0.16, 0.2, 0.32, 0x245524, -0.2, 0.38, 0);
    add(0.16, 0.2, 0.32, 0x245524, 0.2, 0.38, 0);
  } else if (type === "shoes") {
    for (const s of [-0.2, 0.2]) {
      add(0.22, 0.2, 0.5, 0xff9a2e, s, 0, 0);
      add(0.22, 0.28, 0.22, 0xff9a2e, s, 0.2, -0.14);
      add(0.24, 0.06, 0.52, 0xffffff, s, -0.12, 0);
    }
  } else if (type === "net") {
    g.add(
      new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.4, 1),
        new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true }),
      ),
    );
  } else {
    add(0.1, 0.7, 0.1, 0x8d9299, 0, 0, 0);
    add(0.4, 0.1, 0.1, 0x8d9299, 0.15, -0.35, 0);
    add(0.1, 0.25, 0.1, 0x8d9299, 0.3, -0.25, 0);
    add(0.16, 0.16, 0.16, 0x6b4a2a, 0, 0.4, 0);
  }
  return g;
}
function openCrate(it, quiet) {
  if (!it.crate) return;
  it.crate = false;
  it.pry = 0;
  it.g.remove(it.crateM);
  it.m.visible = true;
  if (!quiet) {
    puff(it.x, it.y + 0.6, it.z, 0x8a5a2b, 14, 4);
    beep(180, 0.2, "square", 0.07, -80);
  }
}
function spawnItem(type, x, z, y = 0, crate = false, wet = false) {
  const m = itemMesh(type);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 0.7, 20),
    new THREE.MeshBasicMaterial({
      color: ITEM_INFO[type].ring,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
    }),
  );
  const g = new THREE.Group();
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  m.position.y = 0.9;
  g.add(ring, m);
  g.position.set(x, y, z);
  scene.add(g);
  const it = {
    type,
    x,
    z,
    y,
    g,
    m,
    cd: 0.8,
    crate: false,
    pry: 0,
    pryAt: 0,
    wet: !!wet,
  };
  items.push(it);
  if (wet) {
    ring.material.color.set(0x35a8ff);
    m.traverse((o) => {
      if (o.isMesh) {
        o.material = o.material.clone();
        o.material.color
          .multiplyScalar(0.5)
          .lerp(new THREE.Color(0x2f6fa8), 0.3);
      }
    });
  }
  if (crate) {
    // iron is nailed inside a crate: it has to be pried open first
    const cm = new THREE.Group(),
      bx = (w, h, d, c, px, py, pz) => {
        const q = new THREE.Mesh(BOX, mat(c));
        q.scale.set(w, h, d);
        q.position.set(px, py, pz);
        q.castShadow = true;
        cm.add(q);
      };
    bx(0.95, 0.8, 0.95, 0x8a5a2b, 0, 0.4, 0);
    bx(1.0, 0.1, 1.0, 0x5d3b1a, 0, 0.2, 0);
    bx(1.0, 0.1, 1.0, 0x5d3b1a, 0, 0.62, 0);
    bx(0.5, 0.06, 0.3, 0x4a4f58, 0, 0.83, 0);
    g.add(cm);
    it.crateM = cm;
    it.crate = true;
    m.visible = false;
  }
}
function updateItems(dt) {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    it.m.rotation.y += dt * 2;
    it.m.position.y = 0.9 + Math.sin(clock * 3 + i) * 0.12;
    it.cd -= dt;
    if (it.crate) {
      it.crateM.rotation.z =
        clock - it.pryAt < 0.3 ? Math.sin(clock * 34) * 0.06 : 0;
      if (it.pry > 0 && clock - it.pryAt > 0.4)
        it.pry = Math.max(0, it.pry - dt * 1.5);
    }
    if (it.cd > 0 || NET.guest) continue;
    for (const e of ents) {
      if (
        e.role === "decoy" ||
        e.hidden ||
        e.zip ||
        !e.alive ||
        e.stun ||
        Math.abs(e.pos.y - it.y) > 1.2 ||
        hyp(e.pos.x - it.x, e.pos.z - it.z) > 1.2
      )
        continue;
      if (it.crate) {
        const want =
          e.role === "runner"
            ? phase !== "lobby" &&
              (e.iron || 0) < IRON_MAX &&
              ironDone < IRON_SHIP &&
              (e.hum || e.ai.fan)
            : e.role === "chaser" && !e.chain && chainsMade < 3;
        if (!want) continue;
        const b0 = Math.floor(it.pry * 2);
        it.pry += dt;
        it.pryAt = clock;
        if (!e.hum && !e.scared) e.pryT = clock + 0.25;
        if (Math.floor(it.pry * 2) !== b0) {
          puff(it.x, it.y + 0.8, it.z, 0x8a5a2b, 3, 2);
          beep(150 + 40 * b0, 0.06, "square", 0.05);
        }
        if (e.hum)
          statusTo(
            e,
            `🧰 Prying the crate open… ${Math.max(1, Math.ceil(PRY_T - it.pry))}s — stay next to it`,
            0.5,
          );
        if (it.pry < PRY_T) continue;
        openCrate(it);
      }
      let took = false;
      const chaserItem = it.type === "net" || it.type === "hook";
      if (e.role === "runner") {
        if (phase === "lobby") continue;
        if (it.type === "vest" && e.armor < 50) {
          e.armor = 50;
          took = true;
          msg(`🦺 ${e.name} put on a vest`);
        } else if (it.type === "shoes") {
          e.shoes++;
          took = true;
          msg(`👟 ${e.name} found boost shoes`);
        } else if (it.type === "kit") {
          const ty = TT[Math.floor(rnd(TT.length))];
          e.kit.push(ty);
          took = true;
          msg(`🧰 ${e.name} found a trap kit`);
          if (e.hum)
            statusTo(
              e,
              `🧰 Trap kit: ${TRAP_N[ty]} — press F to set it for the chasers`,
              4,
            );
        } else if (it.type === "shovel") {
          if (!e.shovel && (e.isPlayer || e.ai.fan)) {
            e.shovel = true;
            took = true;
            msg(`⛏ ${e.name} found a shovel`);
            if (e.hum)
              statusTo(
                e,
                "⛏ Shovel! Now look for a dark OIL LEAK on the ground and stand on it to dig",
                5,
              );
          }
        } else if (it.type === "axe") {
          if (!e.axe) {
            e.axe = true;
            took = true;
            msg(`🪓 ${e.name} found an axe`);
            if (e.hum)
              statusTo(
                e,
                CHAIN.on
                  ? "🪓 Axe! Chop the chain at the far end of the DOCK"
                  : "🪓 Axe! Keep it — it cuts the chain if the chasers lock the ship",
                5,
              );
          }
        } else if (it.type === "sail") {
          if (!e.sail && sailDone < SAIL_NEED) {
            e.sail = 1;
            took = true;
            msg(`⛵ ${e.name} found sail cloth for the ship`);
            if (e.hum)
              statusTo(
                e,
                "⛵ Sail cloth! Carry it to the DOCK to rig the ship",
                4,
              );
          }
        } else if (it.type === "iron") {
          if ((e.iron || 0) < IRON_MAX && ironDone < IRON_SHIP) {
            e.iron = (e.iron || 0) + 1;
            took = true;
            msg(`🔩 ${e.name} found an iron part for the ship`);
            if (e.hum)
              statusTo(
                e,
                "🔩 Iron part! Carry it to the DOCK to repair the ship",
                4,
              );
          }
        } else if (it.type === "wood") {
          if ((e.wood || 0) < WOOD_MAX && woodDone < WOOD_NEED) {
            e.wood = (e.wood || 0) + 1;
            if (it.wet) e.wet = (e.wet || 0) + 1;
            took = true;
            if (e.hum)
              statusTo(
                e,
                it.wet
                  ? `💧 WET plank ${e.wood}/${WOOD_MAX} — dry it at a CAMPFIRE (🔥 on the map) before the ship takes it`
                  : `🪵 Plank ${e.wood}/${WOOD_MAX} — carry them to the DOCK to rebuild the ship`,
                3.5,
              );
          }
        } else if (it.type === "fuel") {
          if (!e.fuel) {
            e.fuel = true;
            took = true;
            msg(`⛽ ${e.name} picked up a fuel can`);
            if (e.hum)
              statusTo(
                e,
                "⛽ Carry the fuel to the DOCK — orange mark on the east shore of the map",
                4.5,
              );
          }
        } else if (e.inv[it.type] !== undefined) {
          e.inv[it.type]++;
          took = true;
          if (e.isPlayer) msg(`You picked up a ${ITEM_INFO[it.type].n}`);
        } else if (chaserItem && !e.held) {
          e.held = it.type;
          took = true;
          msg(`${e.name} grabbed the chaser's ${it.type}!`);
          if (e.hum)
            statusTo(
              e,
              `You hold the chaser's ${it.type} — THROW it into the ocean!`,
              4,
            );
        }
      } else if (chaserItem) {
        if (it.type === "net") e.nets++;
        else e.hooks++;
        took = true;
        msg(`${e.name} picked up a ${it.type}`);
      } else if (it.type === "iron") {
        if (!e.chain && chainsMade < 3) {
          took = true;
          ironN++;
          const mine = player.role === "chaser";
          if (ironN >= IRON_NEED) {
            ironN -= IRON_NEED;
            e.chain = true;
            chainsMade++;
            if (mine)
              msg(
                `⛓ ${e.name} forged a HEAVY CHAIN from ${IRON_NEED} iron parts — it goes to the dock`,
                "alarm",
              );
            if (e.hum)
              statusTo(
                e,
                "⛓ Chain forged! Carry it to the far END OF THE DOCK and stand there to lock the ship",
                6,
              );
          } else if (mine)
            msg(
              `🔩 ${e.name} found an iron part (${ironN}/${IRON_NEED} for a chain)`,
            );
        }
      } else if (it.type === "axe") {
      } else if (it.type === "kit") {
        trapBudget++;
        took = true;
        msg(`🧰 ${e.name} grabbed a trap kit (+1 trap)`);
      } else if (it.type === "fuel") {
        took = true;
        puff(it.x, it.y + 0.6, it.z, 0xff7a1a, 16, 4);
        msg(`🔥 ${e.name} burned a fuel can!`);
        beep(140, 0.4, "sawtooth", 0.08, 200);
      } else if (it.type === "shoes") {
        e.shoes++;
        took = true;
        msg(`👟 Chaser ${e.name} picked up boost shoes!`);
      }
      if (took) {
        scene.remove(it.g);
        items.splice(i, 1);
        if (e.isPlayer) beep(660, 0.12, "sine", 0.07, 300);
        break;
      }
    }
  }
}

/* ================= traps ================= */
const traps = [];
let trapBudget = 8,
  trapRegen = 0;
const TRAP_N = {
  pit: "pit",
  water: "water trap",
  hang: "hanging trap",
  bear: "bear trap",
};
function placeTrap(e, type, at) {
  const mine = e.role === "runner"; // a stolen trap, re-set by a runner
  if (!mine && trapBudget <= 0) {
    if (e.hum) statusTo(e, "No traps left — wait for more", 1.5);
    return false;
  }
  if (e.stun || !e.onGround) return false;
  if (e.pos.y > 0.25) {
    if (e.hum)
      statusTo(
        e,
        "Not placeable here — traps only work on the ground, not on roofs or floors above",
        2.2,
      );
    return false;
  }
  const x = at ? at.x : e.pos.x + Math.sin(e.yaw) * (e.isPlayer ? 1.8 : 0),
    z = at ? at.z : e.pos.z + Math.cos(e.yaw) * (e.isPlayer ? 1.8 : 0);
  const bad =
    e.pos.y > 0.2 ||
    hyp(x, z) > R_ISLAND - 3 ||
    hit(x, 0, z, 0.6, 2) ||
    riverDist(x, z) < 1 ||
    hyp(x - LOBBY.x, z - LOBBY.z) < LOBBY.r + 2 ||
    traps.some((t) => hyp(t.x - x, t.z - z) < 2.6);
  if (bad && !(at && at.force)) {
    if (e.hum) statusTo(e, "Can't place a trap here (needs open ground)", 1.5);
    return false;
  }
  if (!mine) trapBudget--;
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const onSand = hyp(x, z) > R_GRASS,
    rad = type === "water" ? 1.7 : type === "pit" ? 1.15 : 0.9;
  const camoCol =
    type === "water"
      ? onSand
        ? 0xd9cf9f
        : 0x62a556
      : onSand
        ? 0xe2cf92
        : 0x64a04a;
  const camo = new THREE.Mesh(
    new THREE.CircleGeometry(rad, 14),
    new THREE.MeshLambertMaterial({
      color: camoCol,
      transparent: true,
      opacity: type === "water" ? 0.75 : 0.95,
    }),
  );
  camo.rotation.x = -Math.PI / 2;
  camo.position.y = 0.03;
  camo.receiveShadow = true;
  g.add(camo);
  if (type === "pit")
    for (let i = 0; i < 4; i++) {
      const l = new THREE.Mesh(BOX, mat(0x5a9442));
      l.scale.set(0.5, 0.02, 0.12);
      l.position.set(rnd(-0.6, 0.6), 0.05, rnd(-0.6, 0.6));
      l.rotation.y = rnd(3);
      g.add(l);
    }
  if (type === "hang") {
    const loop = new THREE.Mesh(
      new THREE.TorusGeometry(0.5, 0.03, 4, 14),
      mat(0x8a7a4a),
    );
    loop.rotation.x = Math.PI / 2;
    loop.position.y = 0.05;
    g.add(loop);
  }
  if (type === "bear") {
    const loop = new THREE.Mesh(
      new THREE.TorusGeometry(0.45, 0.05, 4, 12),
      mat(0x70766c),
    );
    loop.rotation.x = Math.PI / 2;
    loop.position.y = 0.06;
    g.add(loop);
    const pl = new THREE.Mesh(BOX, mat(0x5d6258));
    pl.scale.set(0.3, 0.03, 0.3);
    pl.position.y = 0.05;
    g.add(pl);
  }
  const mark = new THREE.Mesh(
    new THREE.RingGeometry(rad, rad + 0.15, 20),
    new THREE.MeshBasicMaterial({
      color: mine ? 0x35c8ff : 0xff3b30,
      side: THREE.DoubleSide,
    }),
  );
  mark.rotation.x = -Math.PI / 2;
  mark.position.y = 0.06;
  mark.visible = player.role === e.role;
  g.add(mark);
  if (player.role === e.role) {
    const lb = textSprite(type.toUpperCase(), "#ff8a80", 40);
    lb.scale.set(0.35 * lb.userData.aspect, 0.35, 1);
    lb.position.y = 0.8;
    g.add(lb);
  }
  scene.add(g);
  traps.push({ type, x, z, rad, g, camo, sprung: false, t: 0, owner: e.role });
  puff(x, 0.2, z, type === "water" ? 0x7cc8ee : 0x7a5533, 8, 2);
  if (e.isPlayer && !mine) {
    beep(220, 0.15, "triangle", 0.07);
    msg(`You set a ${TRAP_N[type]} (${trapBudget} left)`);
  }
  return true;
}
function updateTraps(dt) {
  for (let i = traps.length - 1; i >= 0; i--) {
    const t = traps[i];
    if (t.sprung) {
      t.t -= dt;
      if (t.t <= 0) {
        scene.remove(t.g);
        traps.splice(i, 1);
      }
      continue;
    }
    if (phase !== "game" || NET.guest) continue;
    for (const e of ents) {
      if (
        e.role !== (t.owner === "runner" ? "chaser" : "runner") ||
        e.hidden ||
        e.zip ||
        e.boat ||
        !e.alive ||
        e.trapImm > 0 ||
        (e.stun && e.stun.type !== "stagger" && e.stun.type !== "slip")
      )
        continue;
      const td = hyp(e.pos.x - t.x, e.pos.z - t.z);
      if (td > t.rad + 1) continue;
      if (!e.isPlayer && !e.stun) {
        // smarter bots may notice the camouflage and hop over
        t.seen = t.seen || {};
        if (t.seen[e.name] === undefined)
          t.seen[e.name] = Math.random() < LVL.notice;
        if (t.seen[e.name]) {
          e.wantJump = true;
          continue;
        }
      }
      if (e.pos.y > 0.3 || td > t.rad * 0.85) continue;
      t.sprung = true;
      e.ai.path = null;
      e.ai.alert = 8;
      e.kx = e.kz = 0;
      const add = (w, h, d, c, x, y, z) => {
        const m = new THREE.Mesh(BOX, mat(c));
        m.scale.set(w, h, d);
        m.position.set(x, y, z);
        t.g.add(m);
      };
      if (t.type === "pit") {
        e.pos.x = t.x;
        e.pos.z = t.z;
        e.stun = { type: "pit", t: 4.5 };
        t.t = 6;
        t.camo.material = new THREE.MeshBasicMaterial({ color: 0x1a120a });
        puff(t.x, 0.2, t.z, 0x7a5533, 14, 3);
        msg(`🕳️ ${e.name} fell into a hidden pit!`);
        if (e.hum) statusTo(e, "🕳️ You fell in a PIT! mash JUMP to climb out");
      } else if (t.type === "water") {
        e.stun = { type: "slip", t: 1.4 };
        e.slow = 7;
        t.t = 4;
        t.camo.material = new THREE.MeshBasicMaterial({
          color: 0x4fb3e8,
          transparent: true,
          opacity: 0.8,
        });
        puff(t.x, 0.2, t.z, 0xbfe6ff, 16, 4);
        msg(`💦 ${e.name} slipped in a water trap — soaked & slowed!`);
        if (e.hum)
          statusTo(e, "💦 WATER TRAP! You slipped — soaked and slow", 3);
      } else if (t.type === "bear") {
        e.pos.x = t.x;
        e.pos.z = t.z;
        t.t = 5;
        e.charge = null;
        e.atk = null;
        add(0.9, 0.5, 0.06, 0x70766c, 0, 0.3, -0.14);
        add(0.9, 0.5, 0.06, 0x70766c, 0, 0.3, 0.14);
        if (e.role === "runner") damage(e, 9, 0, 0, 0, "SNAP!");
        if (e.alive) {
          e.stun = { type: "bear", t: 3.5 };
          e.slow = 7;
        }
        msg(`🐻 ${e.name} stepped in a bear trap!`);
        if (e.hum) statusTo(e, "🐻 BEAR TRAP! mash JUMP to pry it open");
      } else {
        e.pos.x = t.x;
        e.pos.z = t.z;
        e.stun = { type: "hang", t: 5 };
        e.stance = 0;
        t.t = 6.5;
        add(0.2, 5, 0.2, 0x6b4a2a, 1.3, 2.5, 0);
        add(1.5, 0.15, 0.15, 0x6b4a2a, 0.6, 5, 0);
        add(0.04, 1.5, 0.04, 0xc9b27a, 0, 4.25, 0);
        msg(`🪢 ${e.name} got yanked up by a hanging trap!`);
        if (e.hum) statusTo(e, "🪢 HANGING TRAP! mash JUMP to wriggle free");
      }
      t.g.children.forEach((c) => {
        if (c.isSprite) c.visible = false;
      });
      beep(120, 0.3, "sawtooth", 0.1, 300);
      popText("TRAPPED!", t.x, 2.6, t.z, "#ff8a80", 1);
      break;
    }
  }
}

/* ================= AI ================= */
const LEVELS = {
  easy: {
    fool: 0.95,
    slip: 0.85,
    slipT: 1.9,
    climb: 1.5,
    cs: 0.84,
    rs: 0.86,
    vis: 28,
    react: [0.6, 1.1],
    notice: 0,
    smartTrap: 0,
    lead: 0,
    pushP: 0.05,
    trapSense: 18,
    gadget: 0.4,
    smart: 0,
  },
  normal: {
    fool: 0.75,
    slip: 0.65,
    slipT: 1.5,
    climb: 1.15,
    cs: 0.95,
    rs: 0.94,
    vis: 42,
    react: [0.3, 0.6],
    notice: 0.2,
    smartTrap: 0.55,
    lead: 0.3,
    pushP: 0.15,
    trapSense: 40,
    gadget: 1,
    smart: 0.4,
  },
  hard: {
    fool: 0.5,
    slip: 0.45,
    slipT: 1.2,
    climb: 0.95,
    cs: 1.0,
    rs: 0.98,
    vis: 52,
    react: [0.15, 0.35],
    notice: 0.45,
    smartTrap: 0.9,
    lead: 0.7,
    pushP: 0.3,
    trapSense: 80,
    gadget: 1.7,
    smart: 0.8,
  },
  intelligent: {
    fool: 0.25,
    slip: 0.28,
    slipT: 1.0,
    climb: 0.8,
    cs: 1.03,
    rs: 1.0,
    vis: 62,
    react: [0.08, 0.2],
    notice: 0.7,
    smartTrap: 1,
    lead: 1,
    pushP: 0.5,
    trapSense: 300,
    gadget: 2.6,
    smart: 1,
  },
};
let LVL = LEVELS.normal;
const chasers = [];
function nearestChaser(e) {
  let b = chasers[0],
    bd = 1e9;
  for (const c of chasers) {
    const d = hyp(c.pos.x - e.pos.x, c.pos.z - e.pos.z);
    if (d < bd) {
      bd = d;
      b = c;
    }
  }
  return b;
}
const TT = ["pit", "water", "hang", "bear"];
function pickTrapSpot(e, maxD) {
  // where should a chaser bot put its next trap?
  const lobby = phase === "lobby";
  const ok = (x, z) =>
    hyp(x - e.pos.x, z - e.pos.z) < maxD &&
    !traps.some((t) => hyp(t.x - x, t.z - z) < 3.5) &&
    !chasers.some(
      (o) =>
        o !== e && o.ai.spot && hyp(o.ai.spot.x - x, o.ai.spot.z - z) < 3.5,
    );
  if (Math.random() < LVL.smartTrap) {
    let best = null,
      bs = -1e9;
    const consider = (x, z, type, bonus) => {
      if (!ok(x, z)) return;
      const s =
        bonus +
        rnd(34) -
        hyp(x - e.pos.x, z - e.pos.z) * (lobby ? 0.3 : 0.5) -
        (lobby ? hyp(x - LOBBY.x, z - LOBBY.z) * 0.18 : 0);
      if (s > bs) {
        bs = s;
        best = { x, z, type };
      }
    };
    for (const c of chokes)
      consider(
        c.x,
        c.z,
        c.bridge ? "water" : Math.random() < 0.6 ? "pit" : "hang",
        c.bridge ? 14 : 8,
      ); // doorways, corridors, bridge ends
    for (const it of items)
      if (it.type === "vest")
        consider(it.x, it.z, Math.random() < 0.5 ? "hang" : "pit", 16); // bait: trap right under loot
    if (lobby)
      for (let i = 0; i < 2; i++) {
        const p = randFree(LOBBY.x, LOBBY.z, LOBBY.r + 3, LOBBY.r + 9);
        if (p) consider(p.x, p.z, "water", 4);
      } // just outside the lobby
    if (best) return best;
  }
  const p = lobby
    ? Math.random() < 0.6
      ? randFree(LOBBY.x, LOBBY.z, LOBBY.r + 4, 30)
      : randFree(0, 0, 5, R_GRASS - 12)
    : randFree(e.pos.x, e.pos.z, 3, 20);
  return p && ok(p.x, p.z)
    ? { x: p.x, z: p.z, type: TT[Math.floor(rnd(3))] }
    : null;
}
function follow(e) {
  // steer along path, returns false when done
  const ai = e.ai;
  if (!ai.path) {
    e.wx = e.wz = 0;
    return false;
  }
  while (ai.pi < ai.path.length) {
    const p = ai.path[ai.pi],
      dx = p.x - e.pos.x,
      dz = p.z - e.pos.z,
      d = hyp(dx, dz);
    if (d < 0.6) {
      ai.pi++;
      continue;
    }
    e.wx = dx / d;
    e.wz = dz / d;
    return true;
  }
  ai.path = null;
  e.wx = e.wz = 0;
  return false;
}
function goTo(e, x, z) {
  e.ai.path = findPath(e.pos.x, e.pos.z, x, z, e.role === "chaser");
  e.ai.pi = 0;
  e.ai.goal = { x, z };
}
function sees(a, b, range) {
  const d = hyp(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
  if (b.hidden) return false;
  if (d > 2.5 && smoked(a, b)) return false;
  if (
    a.role === "chaser" &&
    !a.isPlayer &&
    a.ai.tgt !== b &&
    d > 0.01 &&
    (b.pos.x - a.pos.x) * Math.sin(a.yaw) +
      (b.pos.z - a.pos.z) * Math.cos(a.yaw) <
      -0.5 * d
  )
    return false; // no eyes in the back of his head
  if (d < 1.6) return true;
  const r = range * (b.stance === 2 ? 0.4 : b.stance === 1 ? 0.65 : 1);
  if (d > r) return false;
  return los(
    a.pos.x,
    a.pos.y + H[a.stance] * 0.9,
    a.pos.z,
    b.pos.x,
    b.pos.y + H[b.stance] * 0.75,
    b.pos.z,
  );
}
function stuckCheck(e, dt) {
  const ai = e.ai;
  ai.stuckT += dt;
  if (ai.stuckT > 0.8) {
    if (
      (e.wx || e.wz) &&
      hyp(e.pos.x - ai.sx, e.pos.z - ai.sz) < 0.35 &&
      !e.stun
    ) {
      e.wantJump = true;
      ai.think = 0;
      ai.path = null;
      ai.goalT = 0;
    }
    ai.stuckT = 0;
    ai.sx = e.pos.x;
    ai.sz = e.pos.z;
  }
}
function surfaceUnder(e) {
  let best = null;
  const r = RAD * 0.9,
    x = e.pos.x,
    z = e.pos.z;
  for (const b of colliders)
    if (
      x + r > b.x0 &&
      x - r < b.x1 &&
      z + r > b.z0 &&
      z - r < b.z1 &&
      b.y1 <= e.pos.y + 0.05 &&
      (!best || b.y1 > best.y1)
    )
      best = b;
  return best;
}
function floorAt(x, z, y) {
  let f = groundY(x, z);
  for (const b of colliders)
    if (
      x > b.x0 &&
      x < b.x1 &&
      z > b.z0 &&
      z < b.z1 &&
      b.y1 <= y + 0.05 &&
      b.y1 > f
    )
      f = b.y1;
  return f;
}
function climbToward(e, b, tgt) {
  // chaser bot: get next to whatever the runner is standing on, then climb up its side
  const ai = e.ai,
    cx = clamp(e.pos.x, b.x0, b.x1),
    cz = clamp(e.pos.z, b.z0, b.z1),
    inside = cx === e.pos.x && cz === e.pos.z,
    dd = hyp(e.pos.x - cx, e.pos.z - cz);
  if (!inside && dd < 1.15 && e.onGround) {
    const mx = (b.x0 + b.x1) / 2,
      mz = (b.z0 + b.z1) / 2;
    let tx = b.x1 - b.x0 < 0.9 ? mx : clamp(e.pos.x, b.x0 + 0.45, b.x1 - 0.45),
      tz = b.z1 - b.z0 < 0.9 ? mz : clamp(e.pos.z, b.z0 + 0.45, b.z1 - 0.45);
    if (hit(tx, b.y1, tz, RAD, 1.8)) {
      tx = clamp(tgt.pos.x, b.x0, b.x1);
      tz = clamp(tgt.pos.z, b.z0, b.z1);
    }
    const h = b.y1 - e.pos.y;
    e.climbing = {
      fx: e.pos.x,
      fy: e.pos.y,
      fz: e.pos.z,
      tx,
      ty: b.y1,
      tz,
      t: 0,
      dur: (0.45 + 0.28 * h) * LVL.climb,
    };
    ai.path = null;
    e.wx = e.wz = 0;
    e.atk = null;
    return;
  }
  if (ai.think <= 0 || (!ai.path && !ai.climbPt)) {
    ai.think = 0.6;
    const o = 0.8,
      mx = (b.x0 + b.x1) / 2,
      mz = (b.z0 + b.z1) / 2,
      tx = clamp(tgt.pos.x, b.x0, b.x1),
      tz = clamp(tgt.pos.z, b.z0, b.z1);
    let best = null,
      bs = 1e9;
    for (const [px, pz] of [
      [b.x0 - o, mz],
      [b.x1 + o, mz],
      [mx, b.z0 - o],
      [mx, b.z1 + o],
      [b.x0 - o, tz],
      [b.x1 + o, tz],
      [tx, b.z0 - o],
      [tx, b.z1 + o],
    ]) {
      if (!navFree(px, pz) || inRiver(px, pz)) continue;
      const s =
        hyp(px - e.pos.x, pz - e.pos.z) +
        0.6 * hyp(px - tgt.pos.x, pz - tgt.pos.z);
      if (s < bs) {
        bs = s;
        best = { x: px, z: pz };
      }
    }
    ai.climbPt = best;
    if (best) goTo(e, best.x, best.z);
  }
  if (!ai.climbPt) {
    const dx = tgt.pos.x - e.pos.x,
      dz = tgt.pos.z - e.pos.z,
      d = hyp(dx, dz) || 1;
    e.wx = dx / d;
    e.wz = dz / d;
    ai.climb = true;
  } else if (!follow(e)) moveTo(e, cx, cz);
}
function ladderFor(x, y, z, max) {
  let b = null,
    bd = max;
  for (const l of ladders) {
    if (Math.abs(l.y1 - y) > 1.3) continue;
    const d = hyp(l.lx - x, l.lz - z);
    if (d < bd) {
      bd = d;
      b = l;
    }
  }
  return b;
}
function ladderAI(e, dt) {
  // a bot that decided to take a ladder: walk to its foot, then climb; true while it is busy with that
  const ai = e.ai,
    l = ai.lad;
  ai.ladT -= dt;
  if (!l || ai.ladT <= 0 || e.stun || !e.alive || e.pos.y >= l.y1 - 0.05) {
    if (l && e.pos.y >= l.y1 - 0.05) ai.ladTop = l;
    ai.lad = null;
    ai.path = null;
    return false;
  }
  e.run = true;
  if (e.stance) setStance(e, 0);
  const fx = l.sx + l.nx * 1.3,
    fz = l.sz + l.nz * 1.3;
  if (
    e.onLadder > 0 ||
    e.pos.y > 0.4 ||
    hyp(fx - e.pos.x, fz - e.pos.z) < 1.1 ||
    (e.pos.x > l.x0 && e.pos.x < l.x1 && e.pos.z > l.z0 && e.pos.z < l.z1)
  ) {
    const dx = l.sx - l.nx * 0.6 - e.pos.x,
      dz = l.sz - l.nz * 0.6 - e.pos.z,
      d = hyp(dx, dz) || 1;
    e.wx = dx / d;
    e.wz = dz / d;
    if (e.onLadder > 0) {
      e.wx = -l.nx;
      e.wz = -l.nz;
    }
    return true;
  }
  navTo(e, fx, fz, dt);
  return true;
}
function moveTo(e, x, z) {
  const dx = x - e.pos.x,
    dz = z - e.pos.z,
    d = hyp(dx, dz);
  if (d < 0.3) {
    e.wx = e.wz = 0;
    return true;
  }
  e.wx = dx / d;
  e.wz = dz / d;
  return false;
}
function towerNav(e, t, f) {
  // walk a bot to floor f of a multi-floor building; true once it is on that floor
  const ai = e.ai,
    inT = towerOf(e.pos.x, e.pos.z) === t,
    my = inT ? Math.min(floorOf(e), t.floors) : 0;
  if (inT && my >= 1 && my <= f) {
    // just came up the stairs: step clear of the stairwell before turning
    const pv = t.st[my - 1];
    if (
      Math.abs(e.pos.x - pv.bx) < 0.9 &&
      e.pos.z > pv.bz + 0.7 &&
      e.pos.z < pv.tz - 0.3
    ) {
      ai.path = null;
      moveTo(e, pv.tx, pv.tz);
      return false;
    }
    if (Math.abs(e.pos.x - pv.bx) < 1.3 && e.pos.z >= pv.tz - 0.3) {
      ai.path = null;
      moveTo(e, pv.bx - pv.sd * 2.2, pv.tz);
      return false;
    } // walk round the stairwell rail
  }
  if (inT && my === f) return true;
  if (my < f) {
    const s = t.st[my],
      onRun =
        inT &&
        Math.abs(e.pos.x - s.bx) < 0.75 &&
        e.pos.z > s.bz - 0.4 &&
        (e.pos.z < s.bz + 1.2 || e.pos.y > my * FH + 0.2);
    if (onRun) {
      ai.path = null;
      moveTo(e, s.tx, s.tz);
    } else if (my === 0) {
      if (!ai.path || !ai.goal || hyp(ai.goal.x - s.bx, ai.goal.z - s.bz) > 0.1)
        goTo(e, s.bx, s.bz);
      if (!follow(e)) moveTo(e, s.bx, s.bz);
    } else moveTo(e, s.bx, s.bz);
  } else {
    const s = t.st[my - 1],
      onRun =
        Math.abs(e.pos.x - s.bx) < 0.75 &&
        e.pos.z > s.bz + 0.7 &&
        e.pos.z < s.tz + 0.4;
    ai.path = null;
    if (onRun) moveTo(e, s.bx, s.bz - 1);
    else moveTo(e, s.tx, s.tz);
  }
  return false;
}
function leaveTower(e, T, s) {
  // walk out of an upper-floor opening (side s) and drop down
  e.ai.path = null;
  if (Math.abs(e.pos.x - T.x) > 0.45 && Math.abs(e.pos.z - T.z) < T.d / 2 - 0.5)
    moveTo(e, T.x, T.z + s * (T.d / 2 - 1.3));
  else moveTo(e, T.x, T.z + s * (T.d / 2 + 3));
}
function pathLen(p, sx, sz, tx, tz) {
  if (!p || !p.length) return 999;
  const l = p[p.length - 1];
  if (hyp(l.x - tx, l.z - tz) > 3) return 999;
  let d = 0,
    x = sx,
    z = sz;
  for (const q of p) {
    d += hyp(q.x - x, q.z - z);
    x = q.x;
    z = q.z;
  }
  return d;
}
function usefulItem(e, it) {
  if (it.y > 1) return false;
  if (it.type === "shoes") return e.shoes < 2;
  if (it.type === "vest") return e.armor <= 0;
  if (it.type === "shovel") return false;
  if (
    (it.type === "iron" || it.type === "wood" || it.type === "sail") &&
    !e.ai.fan
  )
    return false;
  if (it.type === "sail")
    return (
      !e.sail &&
      sailDone +
        ents.reduce((n, o) => n + (o.role === "runner" ? o.sail || 0 : 0), 0) <
        SAIL_NEED
    );
  if (it.type === "iron")
    return (
      (e.iron || 0) < IRON_MAX &&
      ironDone +
        ents.reduce((n, o) => n + (o.role === "runner" ? o.iron || 0 : 0), 0) <
        IRON_SHIP
    );
  if (it.type === "wood")
    return (e.wood || 0) < WOOD_MAX && woodDone < WOOD_NEED;
  if (it.type === "axe") return !e.axe;
  if (it.type === "kit") return LVL.smart >= 0.4 && e.kit.length < 2;
  if (it.type === "fuel") return !e.fuel;
  if (it.type === "medkit") return e.inv.medkit < 1 || e.hp < 60;
  if (e.inv[it.type] !== undefined) return e.inv[it.type] < 2;
  return !e.held && LVL.smart >= 0.4;
}
const chaserDist = (x, z) =>
  Math.min(...chasers.map((k) => hyp(x - k.pos.x, z - k.pos.z)));
function aiRunner(e, dt) {
  const ai = e.ai;
  ai.think -= dt;
  ai.goalT -= dt;
  ai.alert -= dt;
  ai.wait -= dt;
  ai.itemCd -= dt;
  if (FIN.on) {
    if (e.stun) {
      e.wx = e.wz = 0;
      return;
    }
    aiRunnerFin(e, dt);
    return;
  }
  if (
    phase === "game" &&
    !e.stun &&
    e.pos.y < -0.5 &&
    e.pos.x > 118 &&
    Math.abs(e.pos.z - DOCK.z) < 9
  ) {
    ai.seaT = (ai.seaT || 0) + dt;
    if (ai.seaT > 2.5) {
      ai.seaT = 0;
      puff(e.pos.x, 0, e.pos.z, 0xbfe6ff, 10, 4);
      e.pos.set(DOCK.x - 2, 0.35, DOCK.z);
      e.vy = 0;
      ai.path = null;
    }
  } else ai.seaT = 0;
  if (e.stun) {
    e.wx = e.wz = 0;
    if (
      !e.stun.held &&
      e.stun.type !== "stagger" &&
      e.stun.type !== "hook" &&
      e.stun.type !== "slip" &&
      Math.random() < dt * 1.2
    )
      e.stun.t -= 0.25;
    return;
  }
  if (phase === "lobby") {
    if (ai.wait <= 0) {
      ai.wait = rnd(1.5, 5);
      const a = rnd(6.283),
        r = rnd(LOBBY.r - 1.5);
      ai.goal = { x: LOBBY.x + Math.cos(a) * r, z: LOBBY.z + Math.sin(a) * r };
      if (Math.random() < 0.25) e.wantJump = true;
    }
    const dx = ai.goal.x - e.pos.x,
      dz = ai.goal.z - e.pos.z,
      d = hyp(dx, dz);
    e.run = false;
    if (d > 0.5) {
      e.wx = dx / d;
      e.wz = dz / d;
    } else e.wx = e.wz = 0;
    return;
  }
  const c = nearestChaser(e),
    cd = hyp(c.pos.x - e.pos.x, c.pos.z - e.pos.z);
  if (
    roundT < 60 &&
    phase === "game" &&
    !shipReady() &&
    COURSE.length > 6 &&
    !e.hidden &&
    !e.stun &&
    !RAFT.go &&
    (e.raft != null ||
      e.hop ||
      e.ci != null ||
      (cd > 9 &&
        ents.filter((o) => o.role === "runner" && o.alive && !o.cap).length >=
          RSEAT.length))
  ) {
    ai.lad = ai.ladTop = null;
    aiRunnerFin(e, dt);
    return;
  } // last minute: five free runners can take the raft already
  if (
    roundT < 42 &&
    shipGone &&
    !e.hidden &&
    cd > 12 &&
    ai.alert <= 0 &&
    COURSE.length > 6
  ) {
    // the flood is close: wait beside the posts that lead to the raft
    const q = COURSE[3 + ((ents.indexOf(e) * 2) % (COURSE.length - 5))];
    e.run = true;
    if (e.stance) setStance(e, 0);
    if (hyp(q.x - e.pos.x, q.z - e.pos.z) > 3.6)
      navTo(e, q.x + 1.9, q.z + 1.9, dt);
    else e.wx = e.wz = 0;
    return;
  }
  if (ai.lad) {
    if (cd < 3.5 && e.pos.y < 0.4 && !(e.onLadder > 0)) ai.lad = null;
    else if (ladderAI(e, dt)) return;
  }
  if (ai.ladTop) {
    const l = ai.ladTop;
    ai.roofT = (ai.roofT === undefined ? rnd(9, 18) : ai.roofT) - dt; // up on the roof: keep low and wait, leave when a chaser comes up or after a while
    const danger = chasers.some(
      (o) =>
        o.pos.y > 1.2 &&
        hyp(o.pos.x - e.pos.x, o.pos.z - e.pos.z) < 12 &&
        Math.abs(o.pos.y - e.pos.y) < 6,
    );
    if (
      e.pos.y < l.y1 - 1 ||
      ai.roofT <= 0 ||
      danger ||
      shipReady() ||
      (roundT < 45 && shipGone)
    ) {
      ai.ladTop = null;
      ai.roofT = undefined;
      ai.ladCd = clock + 25;
      if (danger) ai.alert = 6;
      if (e.stance) setStance(e, 0);
      if (e.pos.y > l.y1 - 1) {
        const fc = chasers.reduce(
            (b, o) =>
              !b ||
              hyp(o.pos.x - e.pos.x, o.pos.z - e.pos.z) <
                hyp(b.pos.x - e.pos.x, b.pos.z - e.pos.z)
                ? o
                : b,
            null,
          ),
          dx = e.pos.x - fc.pos.x,
          dz = e.pos.z - fc.pos.z,
          d = hyp(dx, dz) || 1;
        ai.roofOff = { x: dx / d, z: dz / d, t: 2.2 };
      }
    } else {
      const dx = l.lx - l.nx * 1.6 - e.pos.x,
        dz = l.lz - l.nz * 1.6 - e.pos.z,
        d = hyp(dx, dz);
      e.run = false;
      if (d > 0.6) {
        e.wx = dx / d;
        e.wz = dz / d;
      } else {
        e.wx = e.wz = 0;
        setStance(e, 1);
      }
      return;
    }
  }
  if (ai.roofOff) {
    const o = ai.roofOff;
    o.t -= dt;
    if (o.t <= 0 || e.pos.y < 1) ai.roofOff = null;
    else {
      e.run = true;
      e.wx = o.x;
      e.wz = o.z;
      stuckCheck(e, dt);
      return;
    }
  } // run off the edge, away from the chaser
  if (
    !e.fuel &&
    !e.wood &&
    !e.iron &&
    !e.sail &&
    !(ai.ladCd > clock) &&
    e.pos.y < 0.4 &&
    cd > 9 &&
    (ai.alert > 0 ? cd < 40 : Math.random() < dt * 0.02 * (0.4 + LVL.smart))
  ) {
    let l = null,
      bd = ai.alert > 0 ? 16 : 30;
    for (const q of ladders) {
      const d = hyp(q.sx - e.pos.x, q.sz - e.pos.z);
      if (
        d < bd &&
        hyp(q.sx - c.pos.x, q.sz - c.pos.z) > d + 6 &&
        !ents.some(
          (o) => o !== e && o.ai && (o.ai.lad === q || o.ai.ladTop === q),
        )
      ) {
        bd = d;
        l = q;
      }
    }
    if (l && (ai.alert <= 0 || Math.random() < 0.5 + 0.5 * LVL.smart)) {
      ai.lad = l;
      ai.ladT = 14;
      ai.path = null;
      ladderAI(e, dt);
      return;
    } else if (ai.alert > 0) ai.ladCd = clock + 6;
  }
  if (runnerExtras(e, dt, c, cd)) return;
  // ---- multi-floor buildings: hide upstairs, and jump out of a balcony when the chaser comes up ----
  const T = towerOf(e.pos.x, e.pos.z),
    up = !!T && e.pos.y > 2;
  if (!up) {
    ai.bail = false;
    ai.bailS = 0;
  }
  if (ai.tower && !up && (ai.alert > 0 || cd < 12)) ai.tower = null;
  if (ai.tower || up) {
    const threat = up && cd < 16 && (towerOf(c.pos.x, c.pos.z) === T || cd < 8);
    if (up && (threat || ai.bail || !ai.tower)) {
      ai.bail = true;
      ai.tower = null;
      e.run = true;
      if (e.stance) setStance(e, 0);
      if (threat) ai.alert = 5;
      leaveTower(e, T, ai.bailS || (ai.bailS = c.pos.z > e.pos.z ? -1 : 1));
    } else {
      const tw = ai.tower;
      if (towerNav(e, tw.t, tw.f)) {
        e.run = false;
        if (moveTo(e, tw.hx, tw.hz)) {
          setStance(e, 1);
          tw.wait -= dt;
          if (tw.wait <= 0) {
            ai.tower = null;
            ai.bail = true;
          }
        }
      } else if (e.stance) setStance(e, 0);
    }
    stuckCheck(e, dt);
    return;
  }
  if (ai.think <= 0) {
    ai.think = rnd(0.3, 0.5);
    if (sees(e, c, LVL.vis) || cd < 5 + 7 * LVL.smart) ai.alert = 5;
    if (!(e.pushCd > 0) && cd < 2.1 && !c.stun && Math.random() < LVL.pushP) {
      doPush(e);
      ai.alert = 6;
    }
    if (ai.alert > 0) {
      e.run = true;
      if (e.stance) setStance(e, 0);
      if (e.shoes > 0 && e.boost <= 0 && (cd < 9 || (e.slow > 0 && cd < 20)))
        useShoes(e);
      const g = ai.goal,
        threat = g && hyp(g.x - c.pos.x, g.z - c.pos.z) < cd * 0.8;
      if (!ai.path || ai.goalT <= 0 || threat || !ai.fleeing) {
        const cands = [],
          ax = (e.pos.x - c.pos.x) / (cd || 1),
          az = (e.pos.z - c.pos.z) / (cd || 1);
        const score = (p) => {
          const dm = hyp(p.x - e.pos.x, p.z - e.pos.z) || 1;
          return (
            chaserDist(p.x, p.z) -
            dm * 0.3 +
            (((p.x - e.pos.x) * ax + (p.z - e.pos.z) * az) / dm) * 18 -
            (hyp(p.x, p.z) > R_GRASS - 10 ? 10 : 0) +
            (LVL.smart && crossesRiver(p.x, p.z, c.pos.x, c.pos.z)
              ? 16 * LVL.smart
              : 0)
          );
        };
        for (let i = 0; i < 12; i++) {
          const p = randFree(e.pos.x, e.pos.z, 14, 42);
          if (p) cands.push({ x: p.x, z: p.z, s: score(p) });
        }
        for (const it of items)
          if (
            (it.type === "shoes" || it.type === "vest") &&
            usefulItem(e, it)
          ) {
            const dm = hyp(it.x - e.pos.x, it.z - e.pos.z);
            if (dm < 24 && chaserDist(it.x, it.z) > dm + 5)
              cands.push({ x: it.x, z: it.z, s: score(it) + 14 });
          } // grab loot on the run
        cands.sort((a, b) => b.s - a.s);
        let best = cands[0],
          bp = null;
        if (best && LVL.smart >= 0.4) {
          // compare real routes: how long for me vs. how long for the chaser (who must use bridges)
          let bm = -1e9;
          for (const k of cands.slice(0, 3)) {
            const rp = findPath(e.pos.x, e.pos.z, k.x, k.z),
              rl = pathLen(rp, e.pos.x, e.pos.z, k.x, k.z);
            if (rl > 900) continue;
            const first = rp[0],
              toward =
                cd < 14
                  ? ((first.x - e.pos.x) * -ax + (first.z - e.pos.z) * -az) /
                    (hyp(first.x - e.pos.x, first.z - e.pos.z) || 1)
                  : 0;
            const m =
              Math.min(
                pathLen(
                  findPath(c.pos.x, c.pos.z, k.x, k.z, true),
                  c.pos.x,
                  c.pos.z,
                  k.x,
                  k.z,
                ),
                160,
              ) -
              rl * 1.15 +
              k.s * 0.25 -
              (toward > 0.5 ? 40 : 0);
            if (m > bm) {
              bm = m;
              best = k;
              bp = rp;
            }
          }
        }
        if (best) {
          if (bp) {
            ai.path = bp;
            ai.pi = 0;
            ai.goal = { x: best.x, z: best.z };
          } else goTo(e, best.x, best.z);
        }
        ai.goalT = 2.5;
        ai.fleeing = true;
      }
    } else {
      if (ai.fleeing) {
        ai.fleeing = false;
        ai.path = null;
        ai.wait = 0;
      }
      if (e.held) {
        // carry chaser's item to the shore
        const r = hyp(e.pos.x, e.pos.z) || 1;
        if (r > R_ISLAND - 14) {
          e.yaw = Math.atan2(e.pos.x, e.pos.z);
          throwHeld(e);
          ai.path = null;
        } else if (!ai.path)
          goTo(
            e,
            (e.pos.x / r) * (R_ISLAND - 11),
            (e.pos.z / r) * (R_ISLAND - 11),
          );
        e.run = true;
        if (e.stance) setStance(e, 0);
      } else if (!ai.path && ai.wait <= 0) {
        let tgt = null,
          isItem = false;
        if (ai.itemCd <= 0) {
          // collect boots / vests / the chaser's gadgets
          ai.itemCd = 3;
          let bd = 65;
          for (const it of items) {
            if (!usefulItem(e, it)) continue;
            const d =
              hyp(it.x - e.pos.x, it.z - e.pos.z) *
              (it.type === "shoes" ? 0.7 : 1);
            if (d < bd && chaserDist(it.x, it.z) > 18) {
              bd = d;
              tgt = it;
              isItem = true;
            }
          }
        }
        if (!tgt && Math.random() < 0.35 * LVL.smart) {
          // go hide upstairs
          let bt = null,
            bd = 70;
          for (const t of towers) {
            const d = hyp(t.x - e.pos.x, t.z - e.pos.z);
            if (d < bd && chaserDist(t.x, t.z) > 25) {
              bd = d;
              bt = t;
            }
          }
          if (bt) {
            const f = 1 + Math.floor(rnd(bt.floors));
            ai.tower = {
              t: bt,
              f,
              hx: bt.x - bt.st[f - 1].sd * rnd(1.5, 3.5),
              hz: bt.z + rnd(-3, 3),
              wait: rnd(10, 22),
            };
            ai.path = null;
            e.run = true;
            return;
          }
        }
        if (!tgt) tgt = randFree(e.pos.x, e.pos.z, 8, 30);
        if (tgt) {
          goTo(e, tgt.x, tgt.z);
          e.run = isItem || Math.random() < 0.4;
          if (e.stance) setStance(e, 0);
          ai.arrive = !isItem;
          if (isItem) ai.wait = 0;
        }
      }
    }
  }
  if (!follow(e) && ai.arrive && ai.alert <= 0) {
    ai.arrive = false;
    ai.wait = rnd(2, 7);
    if (Math.random() < 0.7) setStance(e, Math.random() < 0.3 ? 2 : 1);
  }
  stuckCheck(e, dt);
}
function aiChaser(e, dt) {
  const ai = e.ai;
  ai.think -= dt;
  ai.mem -= dt;
  ai.trapT -= dt;
  ai.react -= dt;
  ai.climb = false;
  e.run = true;
  if (e.stun || e.climbing) {
    e.wx = e.wz = 0;
    return;
  }
  if (FIN.on) {
    ai.lad = null;
    aiChaserFin(e, dt);
    return;
  }
  if (ai.lad) {
    const t = ai.tgt;
    if (!t || !t.alive || t.cap || t.pos.y < ai.lad.y1 - 1.5) ai.lad = null;
    else if (ladderAI(e, dt)) return;
  }
  const nearSpot = () =>
    ai.spot && hyp(e.pos.x - ai.spot.x, e.pos.z - ai.spot.z) < 2.6;
  if (phase === "lobby") {
    if (!ai.path && ai.think <= 0) {
      ai.think = 0.4;
      if (nearSpot() && trapBudget > 0) placeTrap(e, ai.spot.type, ai.spot);
      ai.spot = trapBudget > 0 ? pickTrapSpot(e, 250) : null;
      if (ai.spot) goTo(e, ai.spot.x, ai.spot.z);
      else {
        // traps done: collect own gadgets, then wait outside the lobby
        let it = null,
          bd = (lobbyT - 8) * 3;
        for (const k of items)
          if (
            CH_ITEMS.has(k.type) &&
            k.y < 1 &&
            !(k.type === "iron" && chainsMade >= 3)
          ) {
            const d =
              hyp(k.x - e.pos.x, k.z - e.pos.z) +
              hyp(k.x - LOBBY.x, k.z - LOBBY.z);
            if (d < bd) {
              bd = d;
              it = k;
            }
          }
        if (it) goTo(e, it.x, it.z);
        else {
          const p = randFree(LOBBY.x, LOBBY.z, LOBBY.r + 6, 18);
          if (p) goTo(e, p.x, p.z);
          ai.think = 3;
        }
      }
    }
    follow(e);
    stuckCheck(e, dt);
    return;
  }
  // choose a target
  let tgt = null,
    td = 1e9;
  for (const r of ents) {
    if (!isPrey(r) || (r.role === "decoy" && !fooled(e, r))) continue;
    const d = hyp(r.pos.x - e.pos.x, r.pos.z - e.pos.z),
      trapped = r.stun && r.stun.type !== "stagger";
    let sc =
      d -
      (trapped ? 15 : 0) -
      (r === ai.tgt ? 4 : 0) -
      (r.role === "decoy" ? 14 : 0);
    if (chasers.length > 1 && chasers.some((o) => o !== e && o.ai.tgt === r))
      sc += 10;
    if (
      sc < td &&
      ((trapped && d < LVL.trapSense) || sees(e, r, LVL.vis + 4))
    ) {
      td = sc;
      tgt = r;
    }
  }
  if (tgt) {
    ai.tgt = tgt;
    ai.mem = 3 + 5 * LVL.smart;
    ai.last = { x: tgt.pos.x, z: tgt.pos.z };
    ai.spot = null;
  } else if (ai.mem <= 0) ai.tgt = null;
  if (chaserExtras(e, dt, tgt)) return;
  if (!tgt && phase === "game" && roundT < 28 && COURSE.length) {
    const k = chasers.indexOf(e) % 3,
      q =
        COURSE[k === 0 ? COURSE.length - 1 : k === 1 ? COURSE.length >> 1 : 2];
    if (hyp(q.x - e.pos.x, q.z - e.pos.z) > 5)
      navTo(e, q.x + 2.5, q.z + 2.5, dt);
    else e.wx = e.wz = 0;
    return;
  } // the flood is seconds away: wait along the course to the raft
  if (!tgt && ai.smoke) {
    if (
      ai.smoke.t < clock ||
      hyp(ai.smoke.x - e.pos.x, ai.smoke.z - e.pos.z) < 5
    )
      ai.smoke = null;
    else {
      navTo(e, ai.smoke.x, ai.smoke.z, dt);
      return;
    }
  } // smoke over a campfire: go and look
  if (!tgt && ai.tgt && ai.tgt.alive && ai.mem > 0 && LVL.smart > 0.3)
    tgt = ai.tgt; // remembers where you went
  if (tgt) {
    const dx = tgt.pos.x - e.pos.x,
      dz = tgt.pos.z - e.pos.z,
      d = hyp(dx, dz),
      dy = tgt.pos.y - e.pos.y;
    const clear = los(
      e.pos.x,
      e.pos.y + 1.5,
      e.pos.z,
      tgt.pos.x,
      tgt.pos.y + H[tgt.stance] * 0.7,
      tgt.pos.z,
    );
    // never wade across a river after someone: go round by a bridge (only step in if the runner is IN the water and close)
    const riverOK =
      !crossesRiver(e.pos.x, e.pos.z, tgt.pos.x, tgt.pos.z) ||
      (inRiver(tgt.pos.x, tgt.pos.z) && d < 6);
    let handled = false;
    {
      // multi-floor buildings: use the stairs / drop out of a balcony
      const tT = towerOf(tgt.pos.x, tgt.pos.z),
        mT = towerOf(e.pos.x, e.pos.z);
      if (tT && tgt.pos.y > 2) {
        handled = true;
        if (towerNav(e, tT, Math.min(floorOf(tgt), tT.floors))) {
          e.wx = dx / d;
          e.wz = dz / d;
          ai.path = null;
        }
      } else if (mT && e.pos.y > 2) {
        handled = true;
        leaveTower(e, mT, tgt.pos.z > mT.z ? 1 : -1);
      }
    }
    // runner is up on a roof / crate / container: go to its side and climb up
    if (
      !handled &&
      MT.on &&
      tgt.pos.y > 0.2 &&
      hyp(tgt.pos.x - MT.x, tgt.pos.z - MT.z) < MT.R
    ) {
      handled = true;
      mtnNav(e, tgt, dt);
    }
    if (
      !handled &&
      MT.on &&
      e.pos.y > 0.2 &&
      hyp(e.pos.x - MT.x, e.pos.z - MT.z) < MT.R
    ) {
      handled = true;
      mtnNav(e, null, dt);
    } // target left: walk back down
    if (!handled && dy > 2.5 && e.pos.y < 0.5 && !e.carry) {
      const l = ladderFor(tgt.pos.x, tgt.pos.y, tgt.pos.z, 26);
      if (l && hyp(l.sx - e.pos.x, l.sz - e.pos.z) < 45) {
        ai.lad = l;
        ai.ladT = 16;
        ai.tgt = tgt;
        ai.mem = Math.max(ai.mem, 8);
        handled = true;
        ladderAI(e, dt);
        return;
      }
    } // a ladder leads up there
    if (!handled && dy > 0.9) {
      const sb = surfaceUnder(tgt);
      if (sb && sb.y1 > e.pos.y + 0.9) {
        handled = true;
        climbToward(e, sb, tgt);
      }
    }
    if (!handled) ai.climbPt = null;
    // juked! a sharp cut at close range while the chaser is at full sprint can make him lose his footing
    ai.jukeCd = (ai.jukeCd || 0) - dt;
    const jigNow = clock - (tgt.jig || -9) < 0.45; // the runner is jiggling left-right right in front of him
    if (
      e.moving > 5 &&
      d > 1.2 &&
      ai.jukeCd <= 0 &&
      e.onGround &&
      !e.atk &&
      Math.abs(dy) < 1.5 &&
      ((d < 4.8 && tgt.moving > 4 && (ai.hx * dx + ai.hz * dz) / d < 0.3) ||
        (jigNow && d < 6.5))
    ) {
      ai.jukeCd = jigNow ? 1.1 : 1.5;
      if (
        Math.random() <
        (jigNow ? Math.min(0.92, LVL.slip + 0.12) : LVL.slip * 0.7)
      ) {
        e.stun = { type: "slip", t: LVL.slipT };
        e.kx = ai.hx * 9;
        e.kz = ai.hz * 9;
        ai.jukeCd = 5;
        ai.path = null;
        popText("SLIPPED!", e.pos.x, e.pos.y + 2.5, e.pos.z, "#9fe0ff", 1.1);
        puff(e.pos.x, e.pos.y + 0.2, e.pos.z, 0xd9d2b8, 10, 3);
        beep(300, 0.25, "sawtooth", 0.07, -220);
        msg(`🌀 ${tgt.name} juked ${e.name} — he slipped!`);
        if (tgt.hum)
          statusTo(tgt, "🌀 Nice juke — the chaser slipped! RUN!", 2);
        e.wx = e.wz = 0;
        return;
      }
    }
    let over = false; // nothing taller than a jump between us: run straight at them and vault the crates / pillars / low walls
    if (
      !handled &&
      LVL.smart >= 0.3 &&
      d < 20 &&
      riverOK &&
      Math.abs(dy) < 3.2
    ) {
      const hy = Math.max(e.pos.y, tgt.pos.y) + 2.7,
        px = (-dz / d) * 0.45,
        pz = (dx / d) * 0.45;
      over =
        los(e.pos.x, hy, e.pos.z, tgt.pos.x, hy, tgt.pos.z) &&
        los(
          e.pos.x + px,
          hy,
          e.pos.z + pz,
          tgt.pos.x + px,
          hy,
          tgt.pos.z + pz,
        ) &&
        los(e.pos.x - px, hy, e.pos.z - pz, tgt.pos.x - px, hy, tgt.pos.z - pz);
    }
    if (handled) {
    } else if (over && d >= 1.2) {
      e.wx = dx / d;
      e.wz = dz / d;
      ai.path = null;
      ai.climb = true;
      e.run = true;
      ai.vault = true;
    } else if (d < 7 && (clear || dy > 0.8) && riverOK) {
      e.wx = dx / d;
      e.wz = dz / d;
      ai.path = null;
      ai.climb = dy > 0.8;
      if (dy > 0.6 && e.onGround && d < 4) e.wantJump = true;
    } else {
      if (ai.think <= 0) {
        ai.think = 0.4;
        const lead = Math.min(d / 9, 1.3) * LVL.lead * 7;
        let px = tgt.pos.x + tgt.wx * lead,
          pz = tgt.pos.z + tgt.wz * lead;
        if (!navFree(px, pz)) {
          px = tgt.pos.x;
          pz = tgt.pos.z;
        }
        goTo(e, px, pz);
        if (LVL.smartTrap > 0.8 && trapBudget > 1 && d > 10 && e.onGround) {
          const c = chokes.find(
            (c) =>
              hyp(c.x - e.pos.x, c.z - e.pos.z) < 1.7 &&
              !traps.some((t) => hyp(t.x - c.x, t.z - c.z) < 3.5),
          );
          if (c) placeTrap(e, c.bridge ? "water" : "pit", c);
        }
      }
      if (!follow(e)) {
        if (riverOK) {
          e.wx = dx / d;
          e.wz = dz / d;
          ai.climb = true;
        } else e.wx = e.wz = 0;
      }
    }
    {
      // momentum heading (lags behind sharp turns) + jump roof gaps instead of walking off the edge
      const ml = hyp(e.wx, e.wz);
      if (ml > 0.1) {
        const k = Math.min(1, dt * 2.5);
        ai.hx = (ai.hx || 0) + (e.wx / ml - (ai.hx || 0)) * k;
        ai.hz = (ai.hz || 0) + (e.wz / ml - (ai.hz || 0)) * k;
      }
      if (
        ml > 0.1 &&
        e.pos.y > 1 &&
        e.onGround &&
        tgt.pos.y > e.pos.y - 1.2 &&
        d > 2 &&
        floorAt(
          e.pos.x + (e.wx / ml) * 1.1,
          e.pos.z + (e.wz / ml) * 1.1,
          e.pos.y,
        ) <
          e.pos.y - 0.7
      )
        e.wantJump = true;
    }
    if (d < 1.9 && Math.abs(dy) < 1.5) {
      if (ai.react <= 0 && !e.atk && e.cd <= 0) {
        e.yaw = Math.atan2(dx, dz);
        startAttack(e, Math.random() < 0.65 ? "punch" : "kick");
        ai.react = rnd(LVL.react[0], LVL.react[1]);
      }
      if (d < 1.2) e.wx = e.wz = 0;
    }
    if (
      e.shoes > 0 &&
      e.boost <= 0 &&
      d > 5 &&
      d < 22 &&
      clear &&
      Math.random() < dt * 0.7 * LVL.gadget
    )
      useShoes(e);
    if (d < 1.9 && Math.abs(dy) < 1.5) {
    } else if (
      clear &&
      e.cd <= 0 &&
      !(tgt.stun && tgt.stun.type !== "stagger")
    ) {
      if (
        e.nets > 0 &&
        d > 4 &&
        d < 13 &&
        Math.random() < dt * 0.8 * LVL.gadget
      ) {
        e.yaw = Math.atan2(dx, dz);
        useNet(e);
      } else if (
        !(e.hookCd > 0) &&
        d > 6 &&
        d < 20 &&
        Math.random() < dt * 0.5 * LVL.gadget
      ) {
        e.yaw = Math.atan2(dx, dz);
        useHook(e);
      }
    }
  } else {
    if (!ai.path && ai.think <= 0) {
      ai.think = 0.5;
      if (nearSpot() && trapBudget > 0) placeTrap(e, ai.spot.type, ai.spot);
      ai.spot = null;
      if (ai.mem > 0 && ai.last) {
        goTo(e, ai.last.x, ai.last.z);
        ai.mem = 0;
      } else if (
        trapBudget > 0 &&
        ai.trapT <= 0 &&
        (ai.spot = pickTrapSpot(e, 40))
      ) {
        ai.trapT = rnd(6, 12);
        goTo(e, ai.spot.x, ai.spot.z);
      } else {
        let it = null,
          bd = 45;
        if (Math.random() < 0.75)
          for (const k of items)
            if (
              CH_ITEMS.has(k.type) &&
              k.y < 1 &&
              !(k.type === "iron" && chainsMade >= 3)
            ) {
              const d = hyp(k.x - e.pos.x, k.z - e.pos.z);
              if (d < bd) {
                bd = d;
                it = k;
              }
            }
        if (it) goTo(e, it.x, it.z);
        else {
          const alive = ents.filter((r) => r.role === "runner" && r.alive);
          const r = alive[Math.floor(rnd(alive.length))];
          const p = r && randFree(r.pos.x, r.pos.z, 4, 22);
          if (p) goTo(e, p.x, p.z);
        }
      }
    }
    follow(e);
  }
  stuckCheck(e, dt);
}
function useShoes(e) {
  if (e.shoes <= 0 || e.boost > 0 || !e.alive) return;
  e.shoes--;
  e.boost = 6;
  e.slow = 0;
  msg(`👟 ${e.name} used boost shoes!`);
  puff(e.pos.x, e.pos.y + 0.2, e.pos.z, 0xff9a2e, 12, 3);
  if (e.isPlayer) {
    setStatus("👟 BOOST!", 1.5);
    beep(500, 0.3, "sawtooth", 0.06, 600);
  }
}

/* ================= input ================= */
const keys = {};
let camYaw = 0,
  camPitch = 0.38,
  shake = 0;
const joy = { x: 0, y: 0, id: null };
const isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
if (isTouch) document.body.classList.add("touch");
function action(a) {
  const p = player;
  if (!p || (paused && !NET.on) || phase === "menu" || phase === "end") return;
  if (a === "run") {
    if (NET.guest) NET.run = !NET.run;
    else p.run = !p.run;
    $("brun").classList.toggle("on", NET.guest ? NET.run : p.run);
    return;
  }
  if (NET.guest) {
    if (p.alive && NET.acts.length < 8) NET.acts.push(a);
    if (a === "jump" && NET.pred) NET.jump = true;
    return;
  }
  actFor(p, a);
}
function actFor(p, a) {
  if (!p.alive || typeof a !== "string") return;
  if (extraAction(p, a)) return;
  if (a === "jump") {
    if (p.stun && p.stun.held) {
      if (p.isPlayer) {
        shake = 0.08;
        beep(180, 0.05, "square", 0.04);
      }
    } else if (p.stun && STUCK.includes(p.stun.type)) {
      p.stun.t -= 0.3;
      if (p.isPlayer) {
        shake = 0.1;
        beep(240, 0.05, "square", 0.04);
      }
    } else p.wantJump = true;
  } else if (a === "crouch") setStance(p, p.stance === 1 ? 0 : 1);
  else if (a === "prone") setStance(p, p.stance === 2 ? 0 : 2);
  else if (a === "push") doPush(p);
  else if (p.role === "chaser") {
    if (a === "punch" || a === "kick") startAttack(p, a);
    else if (a === "net") useNet(p);
    else if (a === "hook") useHook(p);
    else if (TRAP_N[a]) placeTrap(p, a);
  } else {
    if (a === "shoes") useShoes(p);
    else if (a === "throw") throwHeld(p);
  }
  if (a === "boost") useShoes(p);
}
const KEYMAP = {
  Space: "jump",
  ShiftLeft: "run",
  ShiftRight: "run",
  KeyC: "crouch",
  KeyZ: "prone",
  ControlLeft: "crouch",
  Digit1: "pit",
  Digit2: "water",
  Digit3: "hang",
  KeyQ: "net",
  KeyR: "hook",
  KeyG: "push",
  KeyB: "boost",
};
addEventListener("keydown", (ev) => {
  if (ev.target && ev.target.tagName === "INPUT") return;
  if (ev.repeat) {
    if (ev.code === "Space") ev.preventDefault();
    return;
  }
  keys[ev.code] = true;
  if (
    ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
      ev.code,
    )
  )
    ev.preventDefault();
  if (!player) return;
  const xk = extraKey(ev.code);
  if (xk) action(xk);
  else if (KEYMAP[ev.code]) action(KEYMAP[ev.code]);
  else if (ev.code === "KeyF")
    action(player.role === "chaser" ? "punch" : "throw");
  else if (ev.code === "KeyE")
    action(player.role === "chaser" ? "kick" : "shoes");
});
addEventListener("keyup", (ev) => (keys[ev.code] = false));
addEventListener("blur", () => {
  for (const k in keys) keys[k] = false;
});
let dragging = false;
canvas.addEventListener("mousedown", (ev) => {
  if (document.pointerLockElement === canvas) {
    if (player && player.role === "chaser")
      action(ev.button === 2 ? "kick" : "punch");
    return;
  }
  dragging = true;
  try {
    const p = canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => {});
  } catch (e) {}
});
addEventListener("mouseup", () => (dragging = false));
canvas.addEventListener("contextmenu", (ev) => ev.preventDefault());
addEventListener("mousemove", (ev) => {
  if (document.pointerLockElement === canvas || dragging)
    look(ev.movementX, ev.movementY, 0.0028);
});
function look(dx, dy, s) {
  camYaw -= dx * s;
  camPitch = clamp(camPitch + dy * s, -0.25, 1.25);
}
// touch look
const looks = {};
canvas.addEventListener(
  "touchstart",
  (ev) => {
    for (const t of ev.changedTouches)
      looks[t.identifier] = { x: t.clientX, y: t.clientY };
    ev.preventDefault();
  },
  { passive: false },
);
canvas.addEventListener(
  "touchmove",
  (ev) => {
    for (const t of ev.changedTouches) {
      const l = looks[t.identifier];
      if (l) {
        look(t.clientX - l.x, t.clientY - l.y, 0.006);
        l.x = t.clientX;
        l.y = t.clientY;
      }
    }
    ev.preventDefault();
  },
  { passive: false },
);
const tend = (ev) => {
  for (const t of ev.changedTouches) delete looks[t.identifier];
};
canvas.addEventListener("touchend", tend);
canvas.addEventListener("touchcancel", tend);
// joystick
const joyEl = $("joy"),
  knob = joyEl.firstElementChild;
const joyMove = (t) => {
  const r = joyEl.getBoundingClientRect();
  let x = (t.clientX - r.left - 65) / 50,
    y = (t.clientY - r.top - 65) / 50;
  const l = hyp(x, y);
  if (l > 1) {
    x /= l;
    y /= l;
  }
  joy.x = x;
  joy.y = y;
  knob.style.transform = `translate(${x * 40}px,${y * 40}px)`;
};
joyEl.addEventListener(
  "touchstart",
  (ev) => {
    joy.id = ev.changedTouches[0].identifier;
    joyMove(ev.changedTouches[0]);
    ev.preventDefault();
  },
  { passive: false },
);
joyEl.addEventListener(
  "touchmove",
  (ev) => {
    for (const t of ev.changedTouches) if (t.identifier === joy.id) joyMove(t);
    ev.preventDefault();
  },
  { passive: false },
);
const joyEnd = (ev) => {
  for (const t of ev.changedTouches)
    if (t.identifier === joy.id) {
      joy.id = null;
      joy.x = joy.y = 0;
      knob.style.transform = "";
    }
};
joyEl.addEventListener("touchend", joyEnd);
joyEl.addEventListener("touchcancel", joyEnd);
// buttons
document.querySelectorAll("#btns .b").forEach((b) => {
  const fire = (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    action(b.dataset.a);
  };
  b.addEventListener("touchstart", fire, { passive: false });
  b.addEventListener("mousedown", fire);
});
function skipLobby() {
  if (phase !== "lobby" || NET.on) return; // the lobby wait cannot be skipped in multiplayer
  if (NET.guest) {
    if (NET.acts.length < 8) NET.acts.push("skip");
  } else lobbyT = Math.min(lobbyT, 0.05);
}
$("skip").addEventListener("click", skipLobby);

let paused = false;
function setPause(v) {
  if ((phase !== "lobby" && phase !== "game") || NET.on) v = false; // no pausing in multiplayer
  if (NET.guest && NET.hp) return; // the host has paused the round for everyone
  if (NET.host && v !== paused) {
    NET.ev.push(["pz", v]);
    NET.tS = 0;
    netHostFrame(0);
  }
  paused = v;
  musApply();
  $("paused").classList.toggle("hide", !v);
  if (v) {
    for (const k in keys) keys[k] = false;
    if (document.exitPointerLock) document.exitPointerLock();
  }
  lastT = performance.now();
}
$("pause").addEventListener("click", () => setPause(true));
$("resume").addEventListener("click", () => setPause(false));
addEventListener("keydown", (ev) => {
  if (ev.target && ev.target.tagName === "INPUT") return;
  if (ev.repeat) return;
  if (ev.code === "KeyP" || ev.code === "Escape") setPause(!paused);
  else if (ev.code === "Enter" && phase === "lobby" && !paused) {
    skipLobby();
    ev.preventDefault();
  }
});
function playerInput(e) {
  let mx = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + joy.x,
    mz = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0) - joy.y;
  if (keys.ArrowLeft) camYaw += 0.035;
  if (keys.ArrowRight) camYaw -= 0.035;
  if (keys.ArrowUp) mz += 1;
  if (keys.ArrowDown) mz -= 1;
  const s = Math.sin(camYaw),
    c = Math.cos(camYaw);
  e.wx = -s * mz + c * mx;
  e.wz = -c * mz - s * mx;
}

/* ================= game flow ================= */
let phase = "menu",
  lobbyT = LOBBY_TIME,
  roundT = ROUND_TIME,
  clock = 0,
  statusT = 0;
function setStatus(t, dur = 0) {
  if (SUBJ) {
    netStatus(SUBJ, t, dur);
    return;
  }
  const el = $("status");
  if (el._t !== t) {
    el._t = t;
    el.textContent = t;
  }
  statusT = dur || 999;
}
const NAMES = [
    "Cleo",
    "Gizmo",
    "Nova",
    "Jett",
    "Kira",
    "Dax",
    "Milo",
    "Zara",
    "Finn",
    "Luna",
    "Rico",
    "Pip",
    "Sage",
    "Bo",
  ],
  COLORS = [
    0x7fae4d, 0xd94f9a, 0x2f9fd0, 0x2c8f80, 0xd3b24a, 0xe08a1e, 0x8a63d2,
    0x5fb8a8, 0xb86a4a, 0x6f86d6, 0xa3b14a, 0xd67a9c, 0x4f9a6a, 0x9a8f7a,
  ];
const CNAMES = ["Hawk", "Brutus", "Rex", "Viper", "Grim", "Tank"];
const settings = { ch: 3, ru: 10, level: "normal" },
  LIM = { ch: [3, 6], ru: [4, 14] };
document.querySelectorAll("#menu [data-st]").forEach((b) =>
  b.addEventListener("click", () => {
    const k = b.dataset.st;
    settings[k] = clamp(settings[k] + +b.dataset.d, LIM[k][0], LIM[k][1]);
    $("n" + k).textContent = settings[k];
  }),
);
document.querySelectorAll("#menu [data-lv]").forEach((b) =>
  b.addEventListener("click", () => {
    settings.level = b.dataset.lv;
    document
      .querySelectorAll("#menu [data-lv]")
      .forEach((o) => o.classList.toggle("sel", o === b));
  }),
);
let nRunners = 7;
function start(role, mp) {
  // multiplayer: every screen builds the same round from the same seed
  const mr = Math.random;
  if (mp) {
    let a = mp.seed >>> 0;
    Math.random = () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  try {
    start0(role, mp);
  } finally {
    Math.random = mr;
  }
}
function start0(role, mp) {
  if (role === "random") role = Math.random() < 0.5 ? "runner" : "chaser";
  $("menu").classList.add("hide");
  if (document.activeElement && document.activeElement.blur)
    document.activeElement.blur();
  const HC = mp ? mp.humans.filter((h) => h.role === "chaser") : [],
    HR = mp ? mp.humans.filter((h) => h.role === "runner") : [];
  if (mp) {
    settings.ch = mp.ch;
    settings.ru = mp.ru;
    settings.level = mp.level;
    const me = mp.humans.find((h) => h.id === mp.you);
    role = me ? me.role : "runner";
    NET.you = mp.you;
  }
  custom.name = ($("pname").value.trim() || "You").slice(0, 12);
  LVL = LEVELS[settings.level];
  nRunners = settings.ru;
  const isCh = role === "chaser";
  for (let i = 0; i < settings.ch; i++) {
    const h = mp ? HC[i] : null,
      me = mp ? !!h && h.id === mp.you : isCh && i === 0,
      c = mkEnt(
        h ? h.name : me ? custom.name : CNAMES[i],
        "chaser",
        me,
        h ? h.color : me ? custom.color : 0xc9302c,
      );
    netHuman(c, h, mp);
    c.pos.set((i - (settings.ch - 1) / 2) * 3, 0, 8);
    c.nets = 1;
    c.hooks = 1;
    chasers.push(c);
  }
  const n = nRunners,
    lr = n > 8 ? 5 : 3.5;
  for (let i = 0; i < n; i++) {
    const h = mp ? HR[i] : null,
      me = mp ? !!h && h.id === mp.you : !isCh && i === 0,
      e = mkEnt(
        h ? h.name : me ? custom.name : NAMES[i],
        "runner",
        me,
        h ? h.color : me ? custom.color : COLORS[i],
      );
    netHuman(e, h, mp);
    const a = (i / n) * 6.283;
    e.pos.set(LOBBY.x + Math.cos(a) * lr, 0, LOBBY.z + Math.sin(a) * lr);
    e.yaw = Math.atan2(-Math.cos(a), -Math.sin(a));
  }
  player = ents.find((e) => e.isPlayer);
  player.hum = true;
  netBegin(mp);
  trapBudget = 8 + (settings.ch - 1) * 3;
  camYaw = isCh ? Math.PI : 0;
  $("role").textContent = isCh ? "👊 CHASER" : "🏃 RUNNER";
  $("role").classList.toggle("ch", isCh);
  document
    .querySelectorAll("#btns .ch")
    .forEach((b) => b.classList.toggle("hide", !isCh));
  document
    .querySelectorAll("#btns .ru")
    .forEach((b) => b.classList.toggle("hide", isCh));
  if (isCh) $("bars").classList.add("hide");
  // items: some hidden inside buildings and the maze, the rest scattered
  const extra = Math.max(0, Math.round((n - 7) / 2));
  const types = [];
  const addT = (t, k) => {
    for (let i = 0; i < k; i++) types.push(t);
  };
  addT("vest", 11 + extra);
  addT("shoes", 20 + extra + settings.ch);
  addT("net", 6 + settings.ch);
  addT("kit", 10 + extra);
  addT("smoke", 7 + extra);
  addT("decoy", 6 + extra);
  addT("banana", 9 + extra);
  addT("medkit", 7 + extra);
  for (let i = types.length - 1; i > 0; i--) {
    const j = Math.floor(rnd(i + 1));
    const t = types[i];
    types[i] = types[j];
    types[j] = t;
  }
  for (const b of interiors)
    for (let k = 0; k < (b.w > 12 ? 2 : 1); k++)
      for (let a = 0; a < 25; a++) {
        const x = b.x + rnd(-1, 1) * (b.w / 2 - 1.4),
          z = b.z + rnd(-1, 1) * (b.d / 2 - 1.4);
        if (
          types.length &&
          navFree(x, z) &&
          !hit(x, 0, z, 0.5, 1.5) &&
          !items.some((i) => hyp(i.x - x, i.z - z) < 3)
        ) {
          spawnItem(types.pop(), x, z);
          break;
        }
      }
  for (const t of towers)
    for (let f = 1; f <= t.floors; f++)
      if (types.length && (f < t.floors || Math.random() < 0.6))
        spawnItem(
          types.pop(),
          t.x - t.st[f - 1].sd * rnd(1.5, 3.5),
          t.z + rnd(-3, 3),
          f * FH,
        );
  for (const t of types) {
    let p = null;
    for (let k = 0; k < 20 && !p; k++) {
      p = randFree(0, 0, 8, R_GRASS - 6);
      if (
        p &&
        (hyp(p.x - LOBBY.x, p.z - LOBBY.z) < LOBBY.r + 4 ||
          items.some((i) => hyp(i.x - p.x, i.z - p.z) < 8))
      )
        p = null;
    }
    if (p) spawnItem(t, p.x, p.z);
  }
  phase = "lobby";
  musPlay("ingame");
  $("pause").classList.remove("hide");
  const others = chasers
    .filter((c) => !c.isPlayer)
    .map((c) => c.name)
    .join(", ");
  msg(
    isCh
      ? "You are the CHASER — set traps before the lobby opens!"
      : `You are a RUNNER — ${others} ${chasers.length > 1 ? "are the chasers and are" : "is the chaser and is"} setting traps out there…`,
  );
  setStatus(
    isCh
      ? "Set traps: PIT [1] · WATER [2] · HANG [3] · BEAR [4]" +
          (mp ? "" : "  ·  Enter = skip wait")
      : "Wait in the lobby… get ready to run!" + (mp ? "" : "  (Enter = skip)"),
    6,
  );
  setupExtras();
  drawMapBase();
}
document
  .querySelectorAll("#menu [data-role]")
  .forEach((b) => b.addEventListener("click", () => start(b.dataset.role)));
/* ---------- explore mode: you alone on the island, time stopped, a few test buttons ---------- */
const XP = { on: false, run: false, fast: false };
function xpUi() {
  $("xprun").textContent = XP.run ? "Time: running" : "Time: stopped";
  $("xprun").classList.toggle("on", XP.run);
  $("xpfast").classList.toggle("on", XP.fast);
}
if ($("explore")) {
  $("explore").addEventListener("click", () => {
    XP.on = true;
    start("runner");
    lobbyT = 0.05;
    $("xp").classList.remove("hide");
    $("skip").classList.add("hide");
    xpUi();
    msg(
      "Explore mode — you are alone, time is stopped. Use the buttons on the left to test things",
    );
  });
  $("xprun").addEventListener("click", () => {
    XP.run = !XP.run;
    xpUi();
  });
  $("xpfast").addEventListener("click", () => {
    XP.fast = !XP.fast;
    xpUi();
  });
  $("xpparts").addEventListener("click", () => {
    const e = player;
    e.wood = WOOD_MAX;
    e.wet = 0;
    e.iron = IRON_MAX;
    e.sail = 1;
    e.fuel = true;
    setStatus(
      "Explore: you carry 4 planks, 2 iron, sail cloth and a fuel can — take them aboard the ship",
      3,
    );
  });
  $("xpdock").addEventListener("click", () => {
    player.pos.set(DOCK.x - 4, 0.4, DOCK.z);
    player.vy = 0;
  });
  $("xpjail").addEventListener("click", () => {
    player.pos.set(JAIL.x, JAIL.y + 0.2, JAIL.z + 4.5);
    player.vy = 0;
  });
  $("xptide").addEventListener("click", () => {
    roundT = Math.min(roundT, ROUND_TIME - TIDE_START - 60);
    XP.run = true;
    xpUi();
  });
  $("xplast").addEventListener("click", () => {
    if (roundT > 61) roundT = 61;
    XP.run = true;
    xpUi();
  });
  $("xpflood").addEventListener("click", () => {
    if (roundT > 1) roundT = 1;
    XP.run = true;
    xpUi();
  });
  for (const b of document.querySelectorAll("#xp button"))
    b.addEventListener("click", () => b.blur());
}
function endGame(chaserWon) {
  if (NET.guest && !NET.endOk) return;
  if (NET.host) netEnd("g", chaserWon);
  phase = "end";
  $("pause").classList.add("hide");
  if (document.exitPointerLock) document.exitPointerLock();
  const left = ents.filter((e) => e.role === "runner" && e.alive).length;
  const iWon =
    player.role === "chaser" ? chaserWon : !chaserWon && player.alive;
  musPlay(iWon ? "victory" : "defeat");
  $("endt").textContent = chaserWon ? "👊 CHASERS WIN" : "🏃 RUNNERS SURVIVE";
  $("endp").textContent =
    (chaserWon
      ? FIN.on
        ? "No runner made it off the flooded island."
        : `${chasers.map((c) => c.name).join(" & ")} captured every runner.`
      : `${left} runner${left > 1 ? "s" : ""} escaped.`) +
    (iWon
      ? " You win! 🎉"
      : player.role === "runner" && !chaserWon
        ? " (but you got caught…)"
        : " You lose.");
  if (chaserWon) endTaunt();
  setTimeout(() => $("end").classList.remove("hide"), 1200);
}
const fmt = (t) => {
  t = Math.max(0, Math.ceil(t));
  return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0");
};

/* minimap */
const mapC = $("map"),
  mctx = mapC.getContext("2d"),
  mapBase = document.createElement("canvas");
mapBase.width = mapBase.height = 150;
const MS = 150 / (2 * R_ISLAND + 32),
  mp = (v) => 75 + v * MS;
function drawMapBase() {
  const x = mapBase.getContext("2d");
  x.fillStyle = "#2a6fa8";
  x.fillRect(0, 0, 150, 150);
  x.fillStyle = "#e9d69a";
  x.beginPath();
  x.arc(75, 75, R_ISLAND * MS, 0, 7);
  x.fill();
  x.fillStyle = "#6aa84f";
  x.beginPath();
  x.arc(75, 75, R_GRASS * MS, 0, 7);
  x.fill();
  x.strokeStyle = "#3f9be0";
  x.lineCap = "round";
  x.lineJoin = "round";
  for (const r of RIVERS) {
    x.lineWidth = r.hw * 2 * MS;
    x.beginPath();
    r.pts.forEach((p, i) =>
      i ? x.lineTo(mp(p[0]), mp(p[1])) : x.moveTo(mp(p[0]), mp(p[1])),
    );
    x.stroke();
  }
  x.fillStyle = "#8a6a3a";
  for (const b of bridges)
    x.fillRect(
      mp(b.x - (b.ax ? b.len : b.w) / 2),
      mp(b.z - (b.az ? b.len : b.w) / 2),
      (b.ax ? b.len : b.w) * MS,
      (b.az ? b.len : b.w) * MS,
    );
  x.fillStyle = "#e8e4d8";
  for (const b of colliders)
    if (b.y1 > 0.9 && b.y0 < 0.1)
      x.fillRect(
        mp(b.x0),
        mp(b.z0),
        Math.max(1, (b.x1 - b.x0) * MS),
        Math.max(1, (b.z1 - b.z0) * MS),
      );
  x.fillStyle = "#343a46";
  x.beginPath();
  x.arc(mp(LOBBY.x), mp(LOBBY.z), LOBBY.r * MS, 0, 7);
  x.fill();
}
function drawMap() {
  mctx.drawImage(mapBase, 0, 0);
  const p = player,
    isCh = p.role === "chaser";
  const dot = (x, z, c, r = 2.5) => {
    mctx.fillStyle = c;
    mctx.beginPath();
    mctx.arc(mp(x), mp(z), r, 0, 7);
    mctx.fill();
  };
  for (const it of items)
    if (
      it.type !== "shovel" &&
      it.type !== "fuel" &&
      hyp(it.x - p.pos.x, it.z - p.pos.z) < 18
    )
      dot(
        it.x,
        it.z,
        it.type === "net" || it.type === "hook" ? "#ff9a9a" : "#7fe3ff",
        1.6,
      );
  if (isCh)
    for (const t of traps) {
      mctx.strokeStyle = "#ff3b30";
      mctx.lineWidth = 1.5;
      mctx.strokeRect(mp(t.x) - 2, mp(t.z) - 2, 4, 4);
    }
  for (const e of ents) {
    if (e === p) continue;
    const d = hyp(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
    if (e.role === "chaser") {
      if (isCh || phase === "lobby" || d < 45 || !p.alive)
        dot(e.pos.x, e.pos.z, "#ff2d2d", 3.5);
    } else if (!e.alive) dot(e.pos.x, e.pos.z, "#555", 2);
    else if (isCh && e.hidden && !(e.revealT > 0)) continue;
    else if (
      !isCh ||
      phase === "lobby" ||
      d < 28 ||
      e.revealT > 0 ||
      (e.stun && e.stun.type !== "stagger")
    )
      dot(e.pos.x, e.pos.z, isCh ? "#ffe14d" : "#ffffff", 2.5);
  }
  mapExtras(dot, p, isCh);
  mctx.save();
  mctx.translate(mp(p.pos.x), mp(p.pos.z));
  mctx.rotate(-camYaw);
  mctx.fillStyle = isCh ? "#ff2d2d" : "#35c8ff";
  mctx.strokeStyle = "#fff";
  mctx.lineWidth = 1.2;
  mctx.beginPath();
  mctx.moveTo(0, -6);
  mctx.lineTo(4.5, 5);
  mctx.lineTo(0, 2.5);
  mctx.lineTo(-4.5, 5);
  mctx.closePath();
  mctx.fill();
  mctx.stroke();
  mctx.restore();
}
let hudT = 0;
function updateHud(dt) {
  hudT -= dt;
  if (hudT > 0) return;
  hudT = 0.1;
  const p = player,
    alive = ents.filter((e) => e.role === "runner" && e.alive).length,
    tot = nRunners;
  $("phase").textContent =
    phase === "lobby"
      ? "ROUND STARTS IN"
      : phase === "game"
        ? FIN.on || RAFT.go
          ? RAFT.go
            ? "RAFT TO OPEN SEA"
            : "RAFT LEAVES IN"
          : "ISLAND FLOODS IN"
        : "ROUND OVER";
  $("timer").textContent =
    (FIN.on || RAFT.go) && phase === "game"
      ? RAFT.go
        ? Math.max(0, Math.round(R_ISLAND + 40 - hyp(RAFT.x, RAFT.z))) + " m"
        : fmt(FIN.t)
      : fmt(phase === "lobby" ? lobbyT : roundT);
  $("left").innerHTML =
    `Free: <b>${alive}</b>/${tot} (need ${NEED()})` +
    (p.role === "chaser" ? ` · Traps: <b>${trapBudget}</b>` : "");
  $("hpt").textContent = Math.ceil(p.hp);
  $("hpf").style.width = p.hp + "%";
  $("art").textContent = Math.ceil(p.armor);
  $("arf").style.width = p.armor * 2 + "%";
  $("arbar").style.opacity = p.armor > 0 ? 1 : 0.35;
  if (p.role === "chaser") {
    $("bnet").firstChild.textContent = `NET ×${p.nets}`;
    $("bnet").classList.toggle("off", !p.nets);
    $("bboost").firstChild.textContent =
      p.boost > 0 ? `BOOST ${p.boost.toFixed(0)}s` : `BOOST ×${p.shoes}`;
    $("bboost").classList.toggle("off", !p.shoes && p.boost <= 0);
    $("bhook").firstChild.textContent =
      p.hookCd > 0 ? `HOOK ${Math.ceil(p.hookCd)}s` : "HOOK";
    $("bhook").classList.toggle("off", p.hookCd > 0);
    document
      .querySelectorAll("#btns .grn")
      .forEach((b) => b.classList.toggle("off", trapBudget <= 0));
  } else {
    $("bshoes").firstChild.textContent =
      p.boost > 0 ? `BOOST ${p.boost.toFixed(0)}s` : `BOOST ×${p.shoes}`;
    $("bshoes").classList.toggle("off", !p.shoes && p.boost <= 0);
    $("bthrow").firstChild.textContent = p.held
      ? `THROW ${p.held.toUpperCase()}`
      : "THROW";
    $("bthrow").classList.toggle("off", !p.held);
  }
  hudExtras(p);
  document.querySelectorAll("[data-a=push]").forEach((b) => {
    b.classList.toggle("off", p.pushCd > 0);
    const t = p.pushCd > 0 ? `PUSH ${Math.ceil(p.pushCd)}s` : "PUSH";
    if (b.firstChild.textContent !== t) b.firstChild.textContent = t;
  });
  document
    .querySelector("[data-a=crouch]")
    .classList.toggle("on", p.stance === 1);
  document
    .querySelector("[data-a=prone]")
    .classList.toggle("on", p.stance === 2);
  $("skip").classList.toggle("hide", phase !== "lobby");
  if ((drawMap.n = (drawMap.n || 0) + 1) % 5 === 0) drawMap(); // minimap 12x/s is plenty
}

/* camera */
const camPos = new THREE.Vector3(0, 8, 80),
  camTgt = new THREE.Vector3(0, 1, 64),
  _cv = new THREE.Vector3();
function updateCamera(dt) {
  const f =
    player.alive || player.cap || phase === "end"
      ? player
      : nearestChaser(player);
  const hang = f.stun && f.stun.type === "hang",
    ty = f.pos.y + (hang ? 2.6 : H[f.stance] * 0.85 + 0.35);
  camTgt.lerp(_cv.set(f.pos.x, ty, f.pos.z), Math.min(1, dt * 14));
  const cp = Math.cos(camPitch),
    dx = Math.sin(camYaw) * cp,
    dy = Math.sin(camPitch),
    dz = Math.cos(camYaw) * cp;
  let dist = 6.5;
  for (let i = 1; i <= 13; i++) {
    const d = i * 0.5;
    const y = camTgt.y + dy * d;
    if (
      pointIn(camTgt.x + dx * d, y, camTgt.z + dz * d) ||
      y < groundY(camTgt.x + dx * d, camTgt.z + dz * d) + 0.2
    ) {
      dist = Math.max(0.6, d - 0.5);
      break;
    }
  }
  camPos.set(camTgt.x + dx * dist, camTgt.y + dy * dist, camTgt.z + dz * dist);
  camera.position.lerp(camPos, Math.min(1, dt * 18));
  if (shake > 0) {
    shake -= dt;
    camera.position.x += rnd(-1, 1) * shake * 0.5;
    camera.position.y += rnd(-1, 1) * shake * 0.5;
  }
  camera.lookAt(camTgt);
  sun.position.set(f.pos.x + 40, 70, f.pos.z + 25);
  sun.target.position.set(f.pos.x, 0, f.pos.z);
}

/* ================= main loop ================= */
/* ================= EXTRAS: escape boat, gadgets, abilities, toys, hiding, customisation ================= */
const STUCK = ["pit", "hang", "net", "bear"];
const isPrey = (r) =>
  r.alive && !r.hidden && (r.role === "runner" || r.role === "decoy");
const RITEMS = ["smoke", "decoy", "banana", "medkit"];
const CH_ITEMS = new Set(["net", "hook", "shoes", "kit", "iron"]);
const DOCK = { x: 124, z: -40 },
  SHIP = { x: 134, z: -35.75 },
  SEATS = [];
let shipWait = false;
const DIG_T = 8;
/* dock blockade: chasers forge a chain from iron parts and lock the ship; runners chop it with an axe */
const IRON_NEED = 3,
  CHOP_T = 6,
  FIX_T = 3;
const CHAIN = {
  x: 139.3,
  z: -38.9,
  on: false,
  fix: 0,
  chop: 0,
  g: null,
  ping: 0,
  noiseCd: 0,
  hitT: 0,
  told: false,
};
let ironN = 0;
const leaks = [];
const tramps = [],
  zips = [],
  ladders = [],
  boats = [],
  spots = [],
  smokes = [],
  peels = [];
let fuelDone = 0,
  boatT = 0;
/* the ship is a wreck: it needs wood (from the beaches), iron (from buildings) and fuel before it can sail */
const WOOD_NEED = 24,
  IRON_SHIP = 5,
  WOOD_MAX = 4,
  IRON_MAX = 2,
  SAIL_NEED = 3,
  PRY_T = 3;
let woodDone = 0,
  ironDone = 0,
  chainsMade = 0,
  readyTold = false,
  sailDone = 0;
let shipGone = false,
  shipGoneT = 0;
const shipReady = () =>
  !shipGone &&
  fuelDone >= 3 &&
  woodDone >= WOOD_NEED &&
  ironDone >= IRON_SHIP &&
  sailDone >= SAIL_NEED;
const SHIPFX = { holes: [], iron: [], sign: null, key: "" };
const custom = { name: "You", color: 0x1f5f8a, hat: "none" };
const HATS = ["none", "cap", "tophat", "party", "crown", "helmet"];
Object.assign(ITEM_INFO, {
  smoke: { n: "smoke bomb", ring: 0x35c8ff },
  decoy: { n: "decoy", ring: 0x35c8ff },
  banana: { n: "banana peel", ring: 0x35c8ff },
  medkit: { n: "medkit", ring: 0x35c8ff },
  shovel: { n: "shovel", ring: 0xffb020 },
  kit: { n: "trap kit", ring: 0xffd23f },
  fuel: { n: "fuel can", ring: 0xffb020 },
  iron: { n: "iron part", ring: 0xff4d4d },
  sail: { n: "sail cloth", ring: 0xffffff },
  wood: { n: "plank", ring: 0xd9a05b },
  axe: { n: "axe", ring: 0x35c8ff },
});
const EXTRA_MESH = {
  smoke(add) {
    add(0.34, 0.45, 0.34, 0x6f7780, 0, 0, 0);
    add(0.12, 0.12, 0.12, 0x222222, 0, 0.28, 0);
  },
  decoy(add) {
    add(0.3, 0.34, 0.2, 0xff66cc, 0, 0, 0);
    add(0.2, 0.2, 0.2, 0xe2b58c, 0, 0.27, 0);
    add(0.1, 0.25, 0.12, 0x2c3442, -0.08, -0.29, 0);
    add(0.1, 0.25, 0.12, 0x2c3442, 0.08, -0.29, 0);
  },
  banana(add) {
    add(0.5, 0.12, 0.14, 0xffe135, 0, 0, 0);
    add(0.14, 0.24, 0.12, 0xffe135, 0.22, 0.12, 0);
    add(0.14, 0.24, 0.12, 0xffe135, -0.22, 0.12, 0);
  },
  medkit(add) {
    add(0.56, 0.4, 0.3, 0xffffff, 0, 0, 0);
    add(0.3, 0.1, 0.32, 0xd9302c, 0, 0, 0);
    add(0.1, 0.3, 0.32, 0xd9302c, 0, 0, 0);
  },
  kit(add) {
    add(0.6, 0.4, 0.45, 0x6b4a2a, 0, 0, 0);
    add(0.64, 0.08, 0.49, 0x3a3f4a, 0, 0.1, 0);
    add(0.3, 0.12, 0.3, 0x9aa3ab, 0, 0.26, 0);
    add(0.08, 0.2, 0.08, 0xc9302c, 0, 0.4, 0);
  },
  wood(add) {
    add(1.0, 0.1, 0.24, 0xc48a4a, 0, -0.1, 0);
    add(1.0, 0.1, 0.24, 0xa9743a, 0.05, 0.02, 0.1);
    add(0.9, 0.1, 0.24, 0xd9a05b, -0.05, 0.14, -0.06);
  },
  sail(add) {
    add(0.75, 0.24, 0.24, 0xf2efe6, 0, 0, 0);
    add(0.08, 0.26, 0.26, 0xb9772e, -0.22, 0, 0);
    add(0.08, 0.26, 0.26, 0xb9772e, 0.22, 0, 0);
    add(0.3, 0.3, 0.04, 0xf2efe6, 0.1, -0.2, 0.1);
  },
  iron(add) {
    add(0.7, 0.16, 0.16, 0x4a4f58, 0, -0.1, 0);
    add(0.16, 0.16, 0.6, 0x3a3f4a, 0.1, 0.06, 0);
    add(0.34, 0.3, 0.3, 0x5d646e, -0.15, 0.2, 0.05);
    add(0.2, 0.08, 0.2, 0x8a4a2a, -0.15, 0.38, 0.05);
  },
  axe(add) {
    add(0.09, 0.95, 0.09, 0x8a5a2b, 0, 0, 0);
    add(0.42, 0.3, 0.07, 0xc8ced6, 0.2, 0.34, 0);
    add(0.1, 0.36, 0.08, 0xe9eef2, 0.42, 0.34, 0);
    add(0.14, 0.2, 0.1, 0xc9302c, 0, 0.36, 0);
  },
  shovel(add) {
    add(0.08, 0.9, 0.08, 0x8a5a2b, 0, 0.1, 0);
    add(0.3, 0.36, 0.05, 0x9aa3ab, 0, -0.5, 0);
    add(0.24, 0.07, 0.07, 0x8a5a2b, 0, 0.56, 0);
  },
  fuel(add) {
    add(0.46, 0.6, 0.3, 0xd9302c, 0, 0, 0);
    add(0.12, 0.14, 0.12, 0x222222, 0.1, 0.37, 0);
    add(0.3, 0.06, 0.06, 0x222222, -0.05, 0.36, 0);
    add(0.3, 0.2, 0.32, 0xffd23f, 0, 0, 0);
  },
};

/* ---------- world pieces ---------- */
const RLEN = RIVERS.map((r) => {
  const c = [0];
  for (let i = 1; i < r.pts.length; i++)
    c.push(
      c[i - 1] +
        hyp(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]),
    );
  return c;
});
function riverAt(ri, s) {
  const p = RIVERS[ri].pts,
    c = RLEN[ri];
  let i = 1;
  while (i < c.length - 1 && c[i] < s) i++;
  const t = clamp((s - c[i - 1]) / (c[i] - c[i - 1]), 0, 1),
    dx = p[i][0] - p[i - 1][0],
    dz = p[i][1] - p[i - 1][1],
    l = hyp(dx, dz);
  return {
    x: p[i - 1][0] + dx * t,
    z: p[i - 1][1] + dz * t,
    dx: dx / l,
    dz: dz / l,
  };
}
function buildExtras() {
  buildJail();
  buildCrawl();
  const deco = (x, y, z, w, h, d, c) => addBox(x, y, z, w, h, d, c, false);
  // ---- dock + escape boat ----
  addBox(130, 0.05, DOCK.z, 20, 0.25, 4.4, 0x8a6a3a);
  for (const x of [121, 127, 133, 139])
    for (const s of [-1, 1])
      deco(x, -1.2, DOCK.z + s * 2.3, 0.3, 2.2, 0.3, 0x6d5b4b);
  const shipN0 = scene.children.length;
  {
    // the escape ship: moored along the north side of the dock, deck level with it, benches to sit on
    const bx = SHIP.x,
      bz = SHIP.z;
    addBox(bx, -0.75, bz, 12, 1.05, 4, 0xf2efe6); // hull + deck (walkable, top 0.3)
    deco(bx, -0.12, bz, 12.1, 0.22, 4.1, 0xc9302c);
    deco(bx, 0.3, bz, 11.6, 0.03, 3.6, 0xb08a55);
    deco(bx + 6.6, -0.6, bz, 1.4, 0.9, 3.0, 0xf2efe6);
    deco(bx + 7.6, -0.5, bz, 0.9, 0.8, 1.8, 0xf2efe6); // bow
    deco(bx, 0.3, bz + 1.95, 12, 0.5, 0.1, 0xd8d2c4);
    deco(bx - 5.95, 0.3, bz, 0.1, 0.5, 4, 0xd8d2c4); // rails
    deco(bx + 4.9, 0.3, bz, 1.7, 1.9, 2.6, 0xe8e4d8);
    deco(bx + 4.9, 1.3, bz, 1.74, 0.5, 2.64, 0x3f9be0);
    deco(bx + 4.9, 2.2, bz, 2.0, 0.12, 2.9, 0xc9302c); // wheelhouse
    deco(bx + 4.9, 2.3, bz, 0.5, 1.3, 0.5, 0x3a3f4a);
    deco(bx + 4.9, 3.4, bz, 0.56, 0.2, 0.56, 0xc9302c); // funnel
    deco(bx - 5.5, 0.3, bz, 0.1, 3.4, 0.1, 0x444444);
    deco(bx - 4.9, 3.0, bz, 1.1, 0.6, 0.04, 0xffd23f); // flag
    for (const sz of [-1.45, 1.45]) {
      deco(bx - 1.45, 0.3, bz + sz, 8.6, 0.42, 0.55, 0x8a5a2b);
      for (let k = 0; k < 7; k++)
        SEATS.push({
          x: bx - 5.5 + k * 1.35,
          z: bz + sz,
          face: sz > 0 ? Math.PI : 0,
          occ: null,
        });
    }
  }
  {
    // the wreck: 20 holes that planks close one by one, 3 missing engine parts
    const bx = SHIP.x,
      bz = SHIP.z,
      hole = (x, y, z, w, h, d) => {
        const a = deco(x, y, z, w, h, d, 0x15100c),
          b = deco(x, y, z, w * 1.08, h * 1.3, d * 1.08, 0xdcb878);
        b.visible = false;
        SHIPFX.holes.push({ hole: a, patch: b });
      };
    for (let i = 0; i < 14; i++)
      hole(
        bx - 5 + (i >> 1) * 1.25 + (i % 2) * 0.3,
        0.31,
        bz + (i % 2 ? 0.55 : -0.5),
        0.95,
        0.03,
        0.6,
      );
    for (const [ox, y] of [
      [-0.4, 0.75],
      [0.4, 1.45],
    ])
      for (const sg of [-1, 1])
        hole(bx + 4.9 + ox, y, bz + sg * 1.31, 0.6, 0.5, 0.06);
    hole(bx + 4.0, 0.9, bz, 0.06, 0.7, 0.9);
    hole(bx + 4.9, 2.31, bz + 0.6, 0.8, 0.03, 0.8);
    deco(bx - 3, 0.3, bz + 0.2, 2.6, 0.12, 0.22, 0x6b4a2a).rotation.y = 0.5;
    deco(bx + 1.2, 0.3, bz - 0.3, 1.8, 0.1, 0.2, 0x6b4a2a).rotation.y = -0.8; // loose broken planks
    for (let i = 0; i < 3; i++) {
      deco(bx - 5.3, 0.3, bz - 0.8 + i * 0.8, 0.5, 0.12, 0.5, 0x7a3b22);
      const m = deco(
        bx - 5.3,
        0.3,
        bz - 0.8 + i * 0.8,
        0.52,
        0.6,
        0.52,
        0x59616c,
      );
      m.visible = false;
      SHIPFX.iron.push(m);
    }
    SHIPFX.sail = [];
    deco(bx + 0.6, 4.4, bz, 0.2, 6.2, 0.2, 0x6b4a2a);
    for (let i = 0; i < 3; i++) {
      const y = 6.15 - i * 1.6,
        w = 3.3 + i * 0.55;
      deco(bx + 0.74, y + 1.42, bz, 0.14, 0.14, w + 0.5, 0x6b4a2a);
      const m = deco(
        bx + 0.76,
        y,
        bz,
        0.1,
        1.4,
        w,
        i === 1 ? 0xe8e2d2 : 0xf7f4ec,
      );
      const st = deco(bx + 0.76, y + 0.35, bz, 0.18, 0.45, w, 0xc9302c);
      m.material = new THREE.MeshLambertMaterial({
        color: 0xffffff,
        emissive: 0x8a8678,
      });
      st.material = new THREE.MeshLambertMaterial({
        color: 0xd8342c,
        emissive: 0x5a1210,
      });
      m.visible = st.visible = false;
      SHIPFX.sail.push(m);
      SHIPFX.sailS = SHIPFX.sailS || [];
      SHIPFX.sailS.push(st);
    }
  }
  SHIPFX.meshes = scene.children.slice(shipN0);
  {
    // blockade: bollard on the dock end, two piles in the sea, the chain hangs across the bow
    const A = CHAIN,
      M = { x: 144.2, z: -38.9 },
      B = { x: 144.2, z: -31.6 };
    deco(A.x, 0.3, A.z, 0.5, 0.75, 0.5, 0x2c3138);
    deco(A.x, 1.05, A.z, 0.7, 0.14, 0.7, 0x2c3138);
    for (const P of [M, B]) {
      deco(P.x, -1.4, P.z, 0.55, 2.9, 0.55, 0x5a4634);
      deco(P.x, 1.5, P.z, 0.7, 0.14, 0.7, 0xc9302c);
    }
    const g = new THREE.Group(),
      lm = mat(0x3d434c),
      lm2 = mat(0x565d68);
    const run = (P, Q, y0, sag) => {
      const n = Math.ceil(hyp(Q.x - P.x, Q.z - P.z) / 0.34),
        ya = Math.atan2(Q.x - P.x, Q.z - P.z);
      for (let i = 0; i <= n; i++) {
        const t = i / n,
          m = new THREE.Mesh(BOX, i % 2 ? lm : lm2);
        m.scale.set(i % 2 ? 0.26 : 0.1, i % 2 ? 0.1 : 0.26, 0.4);
        m.position.set(
          P.x + (Q.x - P.x) * t,
          y0 - Math.sin(t * Math.PI) * sag,
          P.z + (Q.z - P.z) * t,
        );
        m.rotation.y = ya;
        m.castShadow = true;
        g.add(m);
      }
    };
    run(A, M, 0.95, 0.35);
    run(M, B, 1.2, 0.55);
    run(A, M, 0.6, 0.3);
    run(M, B, 0.8, 0.5);
    const lock = new THREE.Mesh(BOX, mat(0xffc21a));
    lock.scale.set(0.42, 0.5, 0.2);
    lock.position.set(A.x, 0.75, A.z + 0.36);
    g.add(lock);
    const tag = textSprite(
      "⛓ CHAINED — chop it with an AXE",
      "#ffd23f",
      40,
      "rgba(15,20,28,.85)",
    );
    tag.scale.set(0.5 * tag.userData.aspect, 0.5, 1);
    tag.position.set(A.x, 2.6, A.z);
    g.add(tag);
    g.visible = false;
    scene.add(g);
    A.g = g;
  }
  deco(120.5, 0, DOCK.z + 3.2, 0.2, 2.6, 0.2, 0x6d5b4b);
  const sign = textSprite(
    "🛠 DOCK: bring planks, iron, sail and fuel",
    "#ffd23f",
    44,
    "rgba(20,30,40,.85)",
  );
  sign.scale.set(0.55 * sign.userData.aspect, 0.55, 1);
  sign.position.set(120.5, 3.1, DOCK.z + 3.2);
  scene.add(sign);
  // ---- ladders ----
  const ladder = (x, z, nx, nz, top) => {
    const tx = nz ? 1 : 0,
      tz = nx ? 1 : 0;
    for (const s of [-0.35, 0.35])
      deco(
        x + nx * 0.08 + tx * s,
        0,
        z + nz * 0.08 + tz * s,
        0.08,
        top,
        0.08,
        0x7a5533,
      );
    for (let y = 0.4; y < top; y += 0.5)
      deco(
        x + nx * 0.08,
        y,
        z + nz * 0.08,
        tx ? 0.7 : 0.06,
        0.06,
        tz ? 0.7 : 0.06,
        0x9a7446,
      );
    ladders.push({
      x0: Math.min(x, x + nx) - tx * 0.7,
      x1: Math.max(x, x + nx) + tx * 0.7,
      z0: Math.min(z, z + nz) - tz * 0.7,
      z1: Math.max(z, z + nz) + tz * 0.7,
      y1: top,
      nx,
      nz,
      lx: x - nx * 1.2,
      lz: z - nz * 1.2,
      sx: x + nx * 0.45,
      sz: z + nz * 0.45,
    });
  };
  ladder(71.8, -89.5, 0, 1, 9.9);
  ladder(-25, -39, 0, 1, 7.2);
  ladder(-84.5, -70, -1, 0, 4.8);
  // ---- ziplines (start on a roof, end on the ground) ----
  const zip = (ax, az, bx, bz) => {
    const ay = floorAt(ax, az, 99);
    if (ay < 2) {
      console.warn("zip start not on a roof", ax, az);
      return;
    }
    for (let k = 0; k < 12 && hit(bx, 0, bz, 0.8, 4); k++) {
      bx += Math.sign(bx - ax) * 1.5;
      bz += Math.sign(bz - az) * 1.5;
    }
    const A = new THREE.Vector3(ax, ay + 2.2, az),
      B = new THREE.Vector3(bx, 3.2, bz),
      len = A.distanceTo(B);
    deco(ax, ay, az, 0.15, 2.3, 0.15, 0x444b55);
    deco(ax, ay + 2.2, az, 0.5, 0.12, 0.5, 0xffd23f);
    deco(bx, 0, bz, 0.2, 3.3, 0.2, 0x444b55);
    deco(bx, 3.3, bz, 0.5, 0.12, 0.5, 0xffd23f);
    const c = new THREE.Mesh(BOX, mat(0x1c1c1c));
    c.scale.set(0.05, 0.05, len);
    c.position.copy(A).add(B).multiplyScalar(0.5);
    c.lookAt(B);
    scene.add(c);
    zips.push({ ax, fy: ay, az, A, B, len });
  };
  zip(68.4, -93.6, 114, -46);
  zip(29, -45.2, 50, -22);
  zip(-17.5, -40.5, -52, -22);
  zip(71.5, 49.5, 50, 64);
  zip(-76.5, -38, -98, -18);
  zip(56, -51, 36, -72);
  zip(26, 75, 8, 88);
  zip(-16, 91.5, 4, 106);
  // ---- trampolines ----
  for (const [x, z] of [
    [30, 80.2],
    [-72, -32.8],
    [76, 54.2],
    [-42, 51.6],
    [17.8, -15.5],
    [50, 49],
    [-20, 96.8],
    [60, -46.2],
    [-36, -22],
    [96, 62],
  ]) {
    if (hit(x, 0, z, 1.4, 2) || riverDist(x, z) < 2) continue;
    addBox(x, 0, z, 2.6, 0.44, 2.6, 0x263040);
    deco(x, 0.44, z, 2.1, 0.03, 2.1, 0x35a8ff);
    tramps.push({
      x0: x - 1.3,
      x1: x + 1.3,
      z0: z - 1.3,
      z1: z + 1.3,
      y: 0.44,
    });
  }
  // ---- hiding spots: lockers inside buildings, barrels, bushes ----
  for (const b of interiors) {
    if (b.w > 12.5) continue;
    const x = b.x - b.w / 2 + 1.0,
      z = b.z - b.d / 2 + 0.95;
    if (hit(x, 0, z, 0.5, 2)) continue;
    addBox(x, 0, z, 0.85, 2.0, 0.7, 0x5f7a8c);
    const m = deco(x, 0.1, z + 0.36, 0.7, 1.8, 0.04, 0x7d98aa);
    spots.push({ type: "locker", x, z, m, wig: 0 });
  }
  {
    const x = -49.6,
      z = 36.4;
    if (!hit(x, 0, z, 0.5, 2)) {
      addBox(x, 0, z, 0.85, 2.0, 0.7, 0x5f7a8c);
      spots.push({
        type: "locker",
        x,
        z,
        m: deco(x, 0.1, z + 0.36, 0.7, 1.8, 0.04, 0x7d98aa),
        wig: 0,
      });
    }
  }
  for (const [x, z] of [
    [-15, -17],
    [14, -31],
    [33, -19],
    [-31, -47],
    [46, -5],
    [61, 12],
    [-36, 36],
    [-53, 47],
    [38, 36],
    [58, 59],
    [-60, -21],
    [8, 41],
    [-12, 52],
    [84, -58],
    [-96, 50],
    [20, 100],
    [100, -30],
    [-88, -48],
    [66, 76],
    [-64, 72],
  ]) {
    if (hit(x, 0, z, 0.9, 2) || riverDist(x, z) < 2.5) continue;
    addBox(x, 0, z, 0.95, 1.2, 0.95, 0x8a5a2b);
    deco(x, 0.3, z, 1.0, 0.08, 1.0, 0x4a4a4a);
    deco(x, 0.85, z, 1.0, 0.08, 1.0, 0x4a4a4a);
    spots.push({
      type: "barrel",
      x,
      z,
      m: deco(x, 1.2, z, 1.02, 0.08, 1.02, 0x5a3a1b),
      wig: 0,
    });
  }
  const bg = new THREE.IcosahedronGeometry(1, 0),
    bm = new THREE.MeshLambertMaterial({ color: 0x2f7a35, flatShading: true });
  let n = 0,
    tries = 0;
  while (n < 26 && tries++ < 500) {
    const a = srand() * 6.283,
      r = 12 + Math.sqrt(srand()) * (R_GRASS - 16),
      x = Math.cos(a) * r,
      z = Math.sin(a) * r;
    if (
      hit(x, 0, z, 1.6, 2) ||
      riverDist(x, z) < 3 ||
      hyp(x - LOBBY.x, z - LOBBY.z) < LOBBY.r + 5 ||
      spots.some((s) => hyp(s.x - x, s.z - z) < 7)
    )
      continue;
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    for (const [ox, oy, oz, s] of [
      [0, 0.75, 0, 1.05],
      [0.7, 0.55, 0.2, 0.75],
      [-0.6, 0.6, -0.3, 0.8],
      [0.1, 0.5, 0.75, 0.7],
    ]) {
      const m = new THREE.Mesh(bg, bm);
      m.position.set(ox, oy, oz);
      m.scale.set(s, s * 0.85, s);
      m.rotation.y = srand() * 6;
      m.castShadow = true;
      g.add(m);
    }
    scene.add(g);
    spots.push({ type: "bush", x, z, m: g, wig: 0 });
    n++;
  }
  // ---- rowing boats ----
  for (const [ri, s] of [
    [0, 100],
    [1, 62],
  ]) {
    const g = new THREE.Group(),
      add = (w, h, d, c, x, y, z) => {
        const m = new THREE.Mesh(BOX, mat(c));
        m.scale.set(w, h, d);
        m.position.set(x, y, z);
        m.castShadow = true;
        g.add(m);
      };
    add(1.5, 0.15, 3.2, 0x7a4a26, 0, 0, 0);
    add(0.15, 0.5, 3.2, 0x8a5a2b, -0.75, 0.25, 0);
    add(0.15, 0.5, 3.2, 0x8a5a2b, 0.75, 0.25, 0);
    add(1.5, 0.5, 0.15, 0x8a5a2b, 0, 0.25, 1.6);
    add(1.5, 0.5, 0.15, 0x8a5a2b, 0, 0.25, -1.6);
    add(1.5, 0.1, 0.4, 0xb08a55, 0, 0.3, -0.5);
    add(0.08, 0.08, 1.8, 0xd8c8a0, -1.2, 0.5, 0.2);
    add(0.08, 0.08, 1.8, 0xd8c8a0, 1.2, 0.5, 0.2);
    scene.add(g);
    boats.push({
      ri,
      s,
      dir: 1,
      min: ri ? 30 : 10,
      max: RLEN[ri][RLEN[ri].length - 1] - (ri ? 5 : 14),
      rider: null,
      m: g,
      x: 0,
      z: 0,
    });
  }
}

/* ---------- hats / customisation ---------- */
function addHat(e, type) {
  e.hat = type;
  if (!type || type === "none") return;
  const h = e.v.head,
    mk = (w, hh, d, c, x, y, z) => {
      const m = new THREE.Mesh(BOX, mat(c));
      m.scale.set(w, hh, d);
      m.position.set(x, y, z);
      m.castShadow = true;
      h.add(m);
      return m;
    };
  if (type === "cap") {
    mk(0.53, 0.12, 0.53, 0x2456c9, 0, 0.61, 0);
    mk(0.42, 0.04, 0.26, 0x2456c9, 0, 0.57, 0.36);
  } else if (type === "tophat") {
    mk(0.68, 0.05, 0.68, 0x151515, 0, 0.59, 0);
    mk(0.42, 0.42, 0.42, 0x151515, 0, 0.82, 0);
    mk(0.44, 0.07, 0.44, 0xc9302c, 0, 0.66, 0);
  } else if (type === "party") {
    const m = new THREE.Mesh(
      new THREE.ConeGeometry(0.2, 0.55, 8),
      mat(0xff4fa3),
    );
    m.position.set(0, 0.84, 0);
    h.add(m);
    mk(0.1, 0.1, 0.1, 0xffe135, 0, 1.13, 0);
  } else if (type === "crown") {
    mk(0.5, 0.12, 0.5, 0xf2c230, 0, 0.63, 0);
    for (const [x, z] of [
      [-0.2, -0.2],
      [0.2, -0.2],
      [-0.2, 0.2],
      [0.2, 0.2],
      [0, 0.2],
      [0, -0.2],
    ])
      mk(0.09, 0.14, 0.09, 0xf2c230, x, 0.76, z);
  } else if (type === "helmet") {
    mk(0.58, 0.3, 0.58, 0x6b7b3a, 0, 0.62, 0);
    mk(0.62, 0.05, 0.62, 0x57662e, 0, 0.5, 0);
  }
}
{
  // menu widgets
  const cols = [
      0x1f5f8a, 0xd9302c, 0x2f9d4a, 0xe08a1e, 0x8a4fd2, 0xe84f9a, 0x20a8a0,
      0x3a3f4a, 0xf2efe6,
    ],
    pc = $("pcol"),
    ph = $("phat");
  cols.forEach((c, i) => {
    const b = document.createElement("button");
    b.className = "sw" + (i ? "" : " sel");
    b.style.background = "#" + c.toString(16).padStart(6, "0");
    b.onclick = () => {
      custom.color = c;
      pc.querySelectorAll(".sw").forEach((o) =>
        o.classList.toggle("sel", o === b),
      );
    };
    pc.appendChild(b);
  });
  const hn = {
      none: "∅",
      cap: "🧢",
      tophat: "🎩",
      party: "🎉",
      crown: "👑",
      helmet: "⛑",
    },
    ht = {
      none: "No hat",
      cap: "Cap",
      tophat: "Top hat",
      party: "Party hat",
      crown: "Crown",
      helmet: "Helmet",
    };
  HATS.forEach((t, i) => {
    const b = document.createElement("button");
    b.textContent = hn[t];
    b.title = ht[t];
    if (!i) b.className = "sel";
    b.onclick = () => {
      custom.hat = t;
      ph.querySelectorAll("button").forEach((o) =>
        o.classList.toggle("sel", o === b),
      );
    };
    ph.appendChild(b);
  });
}
function setupExtras() {
  for (const e of ents) {
    const rh = Math.random() < 0.45,
      ri = Math.floor(rnd(HATS.length - 1));
    addHat(
      e,
      e.isPlayer ? custom.hat : e.hat0 ? e.hat0 : rh ? HATS[1 + ri] : "none",
    );
  }
  for (const e of ents) if (e.role === "runner") e.shovel = true; // every runner carries a shovel
  for (let i = 0; i < 8; i++)
    for (let k = 0; k < 90; k++) {
      const p = randFree(0, 0, 15, R_GRASS - 8);
      if (
        !p ||
        hit(p.x, 0, p.z, 1.3, 2) ||
        riverDist(p.x, p.z) < 3 ||
        hyp(p.x - DOCK.x, p.z - DOCK.z) < 45 ||
        hyp(p.x - LOBBY.x, p.z - LOBBY.z) < 22 ||
        leaks.some((c) => hyp(c.x - p.x, c.z - p.z) < 48 - k * 0.4) ||
        traps.some((t) => hyp(t.x - p.x, t.z - p.z) < 4)
      )
        continue;
      const g = new THREE.Group();
      g.position.set(p.x, 0, p.z);
      const om = new THREE.MeshBasicMaterial({
        color: 0x14110f,
        transparent: true,
        opacity: 0.82,
      });
      for (const [ox, oz, r] of [
        [0, 0, 0.7],
        [0.55, 0.3, 0.38],
        [-0.5, -0.35, 0.3],
        [0.2, -0.75, 0.16],
        [-0.85, 0.3, 0.12],
      ]) {
        const m = new THREE.Mesh(new THREE.CircleGeometry(r, 10), om);
        m.rotation.x = -Math.PI / 2;
        m.position.set(ox, 0.035, oz);
        g.add(m);
      }
      const sheen = new THREE.Mesh(
        new THREE.CircleGeometry(0.3, 8),
        new THREE.MeshBasicMaterial({
          color: 0x6a4fa0,
          transparent: true,
          opacity: 0.35,
        }),
      );
      sheen.rotation.x = -Math.PI / 2;
      sheen.position.set(0.1, 0.04, 0.1);
      g.add(sheen);
      g.rotation.y = rnd(6.283);
      scene.add(g);
      const tags = {};
      for (const [k, txt, col] of [
        ["fuel", "🛢 FUEL BURIED HERE", "#ffd23f"],
        ["empty", "⛏ ALREADY DUG UP", "#c8d0d8"],
        ["burnt", "🔥 BURNED", "#ff7a4d"],
      ]) {
        const t = textSprite(txt, col, 40, "rgba(15,20,28,.8)");
        t.scale.set(0.42 * t.userData.aspect, 0.42, 1);
        t.position.set(p.x, 1.5, p.z);
        t.visible = false;
        scene.add(t);
        tags[k] = t;
      }
      leaks.push({
        x: p.x,
        z: p.z,
        g,
        tags,
        dug: false,
        burnt: false,
        known: "fuel",
        dig: 0,
        puffT: 0,
      });
      break;
    }
  for (const b of boats) {
    const p = riverAt(b.ri, b.s);
    b.x = p.x;
    b.z = p.z;
  }
  // iron parts (for the chasers' chain) and axes (for the runners) lie inside buildings
  CHAIN.on = false;
  CHAIN.fix = CHAIN.chop = 0;
  CHAIN.g.visible = false;
  CHAIN.told = false;
  ironN = 0;
  const pool = [];
  for (let i = 0; i < 16; i++) pool.push("iron");
  for (let i = 0; i < 3; i++) pool.push("axe");
  for (let i = 0; i < 5; i++) pool.push("sail");
  const bl = interiors.slice();
  for (let i = bl.length - 1; i > 0; i--) {
    const j = Math.floor(rnd(i + 1));
    const t = bl[i];
    bl[i] = bl[j];
    bl[j] = t;
  }
  for (let rnd2 = 0; rnd2 < 3 && pool.length; rnd2++)
    for (const b of bl) {
      if (!pool.length) break;
      for (let a = 0; a < 25; a++) {
        const x = b.x + rnd(-1, 1) * (b.w / 2 - 1.4),
          z = b.z + rnd(-1, 1) * (b.d / 2 - 1.4);
        if (
          navFree(x, z) &&
          !hit(x, 0, z, 0.5, 1.5) &&
          !items.some((i) => hyp(i.x - x, i.z - z) < 2.2)
        ) {
          const t = pool.pop();
          spawnItem(t, x, z, 0, t === "iron");
          break;
        }
      }
    }
  for (const t of pool) {
    const p = randFree(0, 0, 8, R_GRASS - 8);
    if (p) spawnItem(t, p.x, p.z, 0, t === "iron");
  }
  woodDone = ironDone = chainsMade = sailDone = 0;
  readyTold = false;
  SHIPFX.key = "";
  for (let i = 0, tries = 0; i < 36 && tries < 1200; tries++) {
    // driftwood scattered along the beaches
    const a = rnd(6.283),
      r = rnd(110.5, 120.5),
      x = Math.cos(a) * r,
      z = Math.sin(a) * r;
    if (
      hit(x, 0, z, 0.7, 1.5) ||
      riverDist(x, z) < 3 ||
      hyp(x - DOCK.x, z - DOCK.z) < 14 ||
      items.some((k) => hyp(k.x - x, k.z - z) < 6)
    )
      continue;
    spawnItem("wood", x, z, 0, false, i % 5 < 2);
    i++; // two planks in five lie in the surf and are soaked
  }
}

/* ---------- hiding ---------- */
function exitOf(s) {
  if (s.type === "bush") return s;
  for (const [ox, oz] of [
    [0, 1.15],
    [1.15, 0],
    [-1.15, 0],
    [0, -1.15],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ])
    if (!hit(s.x + ox, 0, s.z + oz, RAD, 1.8))
      return { x: s.x + ox, z: s.z + oz };
  return s;
}
function hideIn(e, s) {
  const saw =
    phase === "game"
      ? chasers.filter((c) => !c.stun && sees(c, e, LVL.vis + 4))
      : [];
  s.known = saw.length > 0;
  for (const c of saw)
    if (!c.isPlayer && !c.carry) {
      c.ai.search = s;
      c.ai.searchT = 0;
      c.ai.path = null;
    }
  e.hidden = s;
  s.occ = e;
  s.wig = 0.5;
  e.hideT = 0;
  e.stance = 0;
  e.pos.set(s.x, 0, s.z);
  e.vy = 0;
  e.kx = e.kz = 0;
  e.ai.path = null;
  if (e.isPlayer) {
    setStatus(`🤫 Hiding in the ${s.type}… press H (or move) to come out`, 3);
    beep(200, 0.1, "sine", 0.05);
  }
  if (saw.length && e.hum)
    statusTo(e, "👀 The chaser SAW you climb in — he is coming for you!", 3);
}
function unhide(e) {
  const s = e.hidden;
  if (!s) return;
  const p = exitOf(s);
  s.occ = null;
  s.wig = 0.5;
  e.hidden = null;
  e.pos.set(p.x, 0, p.z);
  if (e.hum) statusTo(e, "");
}
function tryHide(e) {
  if (e.stun || !e.alive) return;
  if (e.hideCd > 0) {
    if (e.hum)
      statusTo(
        e,
        "🤧 Still coughing — wait a few seconds before hiding again",
        1.5,
      );
    return;
  }
  let best = null,
    bd = 2.2;
  for (const s of spots) {
    const d = hyp(s.x - e.pos.x, s.z - e.pos.z);
    if (!s.occ && d < bd && Math.abs(e.pos.y) < 1) {
      bd = d;
      best = s;
    }
  }
  if (best) hideIn(e, best);
  else if (e.hum)
    statusTo(e, "No hiding spot here — find a bush, barrel or locker", 1.6);
}
function searchSpots(e) {
  // a chaser beating on a hiding spot drags out whoever is inside
  for (const s of spots) {
    if (hyp(s.x - e.pos.x, s.z - e.pos.z) > 2.4 || Math.abs(e.pos.y) > 1.2)
      continue;
    s.wig = 0.6;
    s.chk = clock;
    puff(s.x, 1, s.z, s.type === "bush" ? 0x2f7a35 : 0x8a5a2b, 6, 2.5);
    const r = s.occ;
    if (!r) continue;
    unhide(r);
    r.hideCd = 6;
    {
      const dx = s.x - e.pos.x,
        dz = s.z - e.pos.z,
        l = hyp(dx, dz) || 1;
      damage(r, 12, dx / l, dz / l, 12, "DRAGGED OUT!", true);
    }
    if (!r.alive) continue;
    r.stun = { type: "slip", t: 0.9 };
    r.ai.alert = 8;
    r.ai.hideGo = null;
    popText("FOUND!", s.x, 2.6, s.z, "#ff8a80", 1.1);
    msg(`👀 ${e.name} dragged ${r.name} out of a ${s.type}!`);
    beep(500, 0.2, "square", 0.07, -250);
    if (r.hum) statusTo(r, "👀 FOUND! RUN!", 1.5);
  }
}

/* ---------- runner gadgets ---------- */
function useSmoke_(e) {
  if (e.inv.smoke <= 0 || e.stun || phase !== "game") return;
  e.inv.smoke--;
  const g = new THREE.Group();
  g.position.set(e.pos.x, e.pos.y, e.pos.z);
  const sm = new THREE.MeshLambertMaterial({
      color: 0xc9ced4,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    }),
    sg = new THREE.IcosahedronGeometry(1, 1);
  for (let i = 0; i < 9; i++) {
    const m = new THREE.Mesh(sg, sm);
    const a = rnd(6.283),
      r = i ? rnd(1, 3.4) : 0,
      s = rnd(1.7, 2.5);
    m.position.set(Math.cos(a) * r, rnd(0.8, 2.4), Math.sin(a) * r);
    m.scale.set(s, s, s);
    g.add(m);
  }
  g.scale.set(0.1, 0.1, 0.1);
  scene.add(g);
  smokes.push({ x: e.pos.x, z: e.pos.z, r: 5, t: 0, life: 9, g, sm });
  msg(`💨 ${e.name} threw a smoke bomb!`);
  beep(120, 0.4, "sawtooth", 0.06, 200);
  for (const c of chasers)
    if (c.ai.tgt === e && hyp(c.pos.x - e.pos.x, c.pos.z - e.pos.z) < 30)
      c.ai.mem = Math.min(c.ai.mem, 1.2 - LVL.smart * 0.6);
}
function smoked(a, b) {
  for (const s of smokes) {
    const dx = b.pos.x - a.pos.x,
      dz = b.pos.z - a.pos.z,
      l2 = dx * dx + dz * dz || 1,
      t = clamp(((s.x - a.pos.x) * dx + (s.z - a.pos.z) * dz) / l2, 0, 1);
    if (hyp(a.pos.x + dx * t - s.x, a.pos.z + dz * t - s.z) < s.r) return true;
  }
  return false;
}
function useDecoy(e) {
  if (e.inv.decoy <= 0 || e.stun || phase !== "game") return;
  e.inv.decoy--;
  const d = mkEnt(e.name, "decoy", false, e.color);
  addHat(d, e.hat);
  d.pos.copy(e.pos);
  d.dirA = e.isPlayer ? camYaw + Math.PI : e.yaw;
  d.yaw = d.dirA;
  d.life = 16;
  d.run = true;
  d.owner = e;
  d.zig = rnd(6.283);
  for (const c of chasers)
    if (
      !c.isPlayer &&
      c.ai.tgt === e &&
      fooled(c, d) &&
      hyp(c.pos.x - e.pos.x, c.pos.z - e.pos.z) > 3
    ) {
      c.ai.tgt = d;
      c.ai.mem = 6;
      c.ai.lure = 5;
    } // chasers already on your tail switch to the copy
  puff(e.pos.x, e.pos.y + 1, e.pos.z, 0xff66cc, 8, 2);
  msg(`🎭 ${e.name} sent out a decoy!`);
  if (e.isPlayer) beep(600, 0.12, "sine", 0.06, 300);
}
function aiDecoy(e, dt) {
  e.life -= dt;
  {
    const c = nearestChaser(e);
    if (c) {
      const dx = e.pos.x - c.pos.x,
        dz = e.pos.z - c.pos.z,
        dd = hyp(dx, dz);
      if (dd < 16 && dd > 0.1) {
        let da = Math.atan2(dx, dz) - e.dirA;
        while (da > Math.PI) da -= 6.283;
        while (da < -Math.PI) da += 6.283;
        e.dirA += da * Math.min(1, dt * 2.5);
      }
    }
  } // it runs away from the chaser like a real runner
  const za = e.dirA + Math.sin(clock * 2.3 + e.zig) * 0.45;
  e.wx = Math.sin(za);
  e.wz = Math.cos(za);
  if (e.moving < 1.5) {
    e.blk = (e.blk || 0) + dt;
    if (e.blk > 0.35) {
      e.dirA += (Math.random() < 0.5 ? 1 : -1) * rnd(0.9, 1.6);
      e.blk = 0;
    }
  } else e.blk = 0;
  if (e.life <= 0 || e.pos.y < -0.5) popDecoy(e);
}
function popDecoy(d) {
  if (d.dead) return;
  d.dead = true;
  d.alive = false;
  puff(d.pos.x, d.pos.y + 1, d.pos.z, 0xff66cc, 14, 3.5);
  popText("DECOY!", d.pos.x, d.pos.y + 2.4, d.pos.z, "#ff9ad8", 1);
  for (const c of chasers)
    if (hyp(c.pos.x - d.pos.x, c.pos.z - d.pos.z) < 4.5 && !c.stun) {
      c.stun = { type: "stagger", t: 1.8 };
      if (c.ai) {
        c.ai.tgt = null;
        c.ai.mem = 0;
      }
      msg(`🎭 ${c.name} fell for ${d.name}'s decoy!`);
    }
}
function fooled(c, d) {
  d.fool = d.fool || {};
  if (d.fool[c.name] === undefined)
    d.fool[c.name] = Math.random() < Math.min(1, LVL.fool + 0.35);
  return d.fool[c.name];
}
function dropBanana_(e) {
  if (e.inv.banana <= 0 || e.stun || phase !== "game") return;
  e.inv.banana--;
  const m = itemMesh("banana");
  const x = e.pos.x - Math.sin(e.yaw) * 0.7,
    z = e.pos.z - Math.cos(e.yaw) * 0.7,
    y = floorAt(x, z, e.pos.y + 0.3);
  m.position.set(x, y + 0.1, z);
  m.rotation.y = rnd(6);
  scene.add(m);
  peels.push({ x, y, z, m, seen: {} });
  if (e.isPlayer) {
    beep(350, 0.08, "sine", 0.05);
    msg("🍌 You dropped a banana peel");
  }
}
function useMedkit(e) {
  if (e.inv.medkit <= 0 || e.hp >= 100 || !e.alive) {
    if (e.isPlayer && e.inv.medkit > 0)
      setStatus("Health is already full", 1.2);
    return;
  }
  e.inv.medkit--;
  e.hp = Math.min(100, e.hp + 50);
  puff(e.pos.x, e.pos.y + 1.2, e.pos.z, 0x6fe08a, 10, 2.5);
  msg(`🩹 ${e.name} used a medkit`);
  if (e.isPlayer) beep(520, 0.25, "sine", 0.06, 300);
}

/* ---------- chaser abilities ---------- */
function doRoar_(e) {
  if (e.roarCd > 0 || e.stun || phase !== "game") return;
  e.roarCd = 25;
  let n = 0,
    near = null,
    nd = 1e9;
  for (const r of ents) {
    if (r.role !== "runner" || !r.alive) continue;
    const d = hyp(r.pos.x - e.pos.x, r.pos.z - e.pos.z);
    if (d > 48) continue;
    r.revealT = 6;
    n++;
    if (d < 14) {
      r.slow = Math.max(r.slow, 2.5);
      r.ai.alert = 8;
    }
    if (d < nd && !r.hidden) {
      nd = d;
      near = r;
    }
    if (r.hum)
      statusTo(r, "😱 The chaser ROARED — he knows where you are!", 2.5);
  }
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.9, 1, 40),
    new THREE.MeshBasicMaterial({
      color: 0xff3b30,
      transparent: true,
      side: THREE.DoubleSide,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(e.pos.x, e.pos.y + 0.3, e.pos.z);
  scene.add(ring);
  fx.push({
    t: 0,
    life: 1,
    up() {
      const s = 1 + this.t * 46;
      ring.scale.set(s, s, 1);
      ring.material.opacity = 1 - this.t;
    },
    end() {
      scene.remove(ring);
    },
  });
  popText("ROAAAR!", e.pos.x, e.pos.y + 2.9, e.pos.z, "#ff5a4d", 1.5);
  sndAt(e, { f: 70, slide: 60, d: 0.9, type: "sawtooth", v: 0.5 });
  if (hyp(e.pos.x - player.pos.x, e.pos.z - player.pos.z) < 30) shake = 0.4;
  msg(`🦁 ${e.name} roared — ${n} runner${n === 1 ? "" : "s"} revealed!`);
  if (!e.isPlayer && near) {
    e.ai.last = { x: near.pos.x, z: near.pos.z };
    e.ai.mem = 3;
    e.ai.path = null;
  }
}
function doCharge(e) {
  if (e.chargeCd > 0 || e.stun || e.atk || e.climbing || phase !== "game")
    return;
  e.chargeCd = 12;
  if (e.stance) setStance(e, 0);
  if (e.isPlayer) {
    const t = aimTarget(e, 11, 0.55);
    e.yaw = t
      ? Math.atan2(t.pos.x - e.pos.x, t.pos.z - e.pos.z)
      : camYaw + Math.PI;
  }
  e.charge = { t: 0.55, dx: Math.sin(e.yaw), dz: Math.cos(e.yaw) };
  beep(110, 0.35, "sawtooth", 0.09, 160);
  puff(e.pos.x, e.pos.y + 0.3, e.pos.z, 0xd9d2b8, 8, 3);
}

/* ---------- movement overrides (called from stepEnt) ---------- */
function leaveBoat(e) {
  const b = e.boat;
  if (!b) return;
  b.rider = null;
  e.boat = null;
  e.boatCd = 2.5;
  b.v = 0;
  const p = riverAt(b.ri, b.s),
    hw = RIVERS[b.ri].hw,
    first = e.wx * -p.dz + e.wz * p.dx >= 0 ? 1 : -1;
  let done = false; // step out onto the bank (the side you are steering towards)
  for (const sd of [first, -first])
    for (const off of [1.3, 2.1, 3.1, 4.2]) {
      const x = b.x - p.dz * sd * (hw + off),
        z = b.z + p.dx * sd * (hw + off);
      if (
        !done &&
        navFree(x, z) &&
        !inRiver(x, z) &&
        !hit(x, 0, z, RAD + 0.1, 1.8)
      ) {
        e.pos.set(x, 0, z);
        done = true;
      }
    }
  if (!done) {
    GR = navC;
    const c = nearestFree(cellOf(b.x), cellOf(b.z));
    GR = nav;
    if (c >= 0) e.pos.set(cw(c % N), 0, cw((c / N) | 0));
  }
  e.vy = 0;
  e.kx = e.kz = 0;
  if (e.hum) statusTo(e, "");
}
function specialMove(e, dt) {
  e.zipCd -= dt;
  e.boatCd -= dt;
  e.roarCd -= dt;
  e.chargeCd -= dt;
  if (e.revealT > 0) e.revealT -= dt;
  if (e.hideCd > 0) e.hideCd -= dt;
  if (e.pushCd > 0) e.pushCd -= dt;
  if (e.hookCd > 0) e.hookCd -= dt;
  if (e.freezeImm > 0) e.freezeImm -= dt;
  if (e.cap === "carried" && e.by) {
    const c = e.by;
    e.pos.set(c.pos.x, c.pos.y + 1.75, c.pos.z);
    e.yaw = c.yaw;
    e.vy = 0;
    e.moving = 0;
    e.kx = e.kz = 0;
    return true;
  }
  if (e.cap === "tied" || e.cap === "out") {
    e.vy = 0;
    e.moving = 0;
    e.kx = e.kz = 0;
    return true;
  }
  if (e.raft != null) {
    if (e.stun && e.stun.type === "stagger") e.stun = null; // riders hold on: a punch hurts but only a PUSH throws them off
    if ((e.stun || !e.alive) && phase === "game") raftOff(e, null);
    else {
      const o = RSEAT[e.raft % RSEAT.length],
        sn = Math.sin(RAFT.yaw),
        cs = Math.cos(RAFT.yaw);
      e.pos.set(
        RAFT.x + o[0] * cs + o[1] * sn,
        0.42,
        RAFT.z - o[0] * sn + o[1] * cs,
      );
      e.yaw = RAFT.yaw;
      e.vy = 0;
      e.moving = 0;
      e.kx = e.kz = 0;
      e.onGround = true;
      return true;
    }
  }
  if (e.hop) {
    const h = e.hop; // a bot jumping from post to post
    if (e.stun || !e.alive) {
      e.hop = null;
      e.ci = undefined;
      return false;
    }
    h.t += dt;
    const k = Math.min(1, h.t / h.dur);
    e.pos.set(
      h.fx + (h.tx - h.fx) * k,
      h.fy + (h.ty - h.fy) * k + Math.sin(k * Math.PI) * h.arc,
      h.fz + (h.tz - h.fz) * k,
    );
    e.yaw = Math.atan2(h.tx - h.fx, h.tz - h.fz);
    e.vy = 0;
    e.onGround = false;
    e.moving = 6;
    e.kx = e.kz = 0;
    if (k >= 1) {
      e.hop = null;
      e.onGround = true;
      if (h.raft) {
        if (raftCrew().length < RSEAT.length && !RAFT.go) raftOn(e);
        else e.ci = undefined;
      } else {
        e.ci = h.ci < 0 ? undefined : h.ci;
        if (h.ci < 0) {
          puff(e.pos.x, 0.3, e.pos.z, 0xbfe6ff, 12, 4);
          popText("SPLASH!", e.pos.x, 2.2, e.pos.z, "#9fe0ff", 0.9);
          e.stun = { type: "slip", t: 0.7 };
        }
      }
    }
    return true;
  }
  if (e.seatCd > 0) e.seatCd -= dt;
  if (e.seat != null) {
    if (e.stun || !e.alive || phase !== "game") leaveSeat(e);
    else {
      const S = SEATS[e.seat];
      e.pos.set(S.x, 0.3, S.z);
      e.yaw = S.face;
      e.vy = 0;
      e.moving = 0;
      e.kx = e.kz = 0;
      e.onGround = true;
      return true;
    }
  }
  if (!e.alive || phase === "end") {
    if (e.hidden) unhide(e);
    if (e.boat) leaveBoat(e);
    e.zip = null;
    e.charge = null;
    return false;
  }
  if (e.hidden) {
    e.moving = 0;
    e.vy = 0;
    e.hideT += dt;
    if (e.hideT > 10 && phase === "game") {
      cough(e);
      return true;
    }
    if (e.isPlayer && e.hideT > 0.5 && hyp(e.wx, e.wz) > 0.5) unhide(e);
    return true;
  }
  if (e.zip) {
    if (e.stun) {
      e.zip = null;
      return false;
    }
    const z = e.zip.z;
    e.zip.s += 15 * dt;
    const k = e.zip.s / z.len;
    if (k >= 1) {
      e.zip = null;
      e.zipCd = 1.5;
      e.vy = 0;
      return false;
    }
    e.pos.set(
      z.A.x + (z.B.x - z.A.x) * k,
      z.A.y + (z.B.y - z.A.y) * k - 2.2,
      z.A.z + (z.B.z - z.A.z) * k,
    );
    e.yaw = Math.atan2(z.B.x - z.A.x, z.B.z - z.A.z);
    e.vy = 0;
    e.onGround = false;
    e.moving = 15;
    e.kx = e.kz = 0;
    return true;
  }
  if (e.boat) {
    if (e.stun) {
      leaveBoat(e);
      return false;
    }
    const b = e.boat,
      p0 = riverAt(b.ri, b.s),
      al = clamp(e.wx * p0.dx + e.wz * p0.dz, -1, 1); // row along the river with the stick / keys; let go and the boat stops
    b.v =
      (b.v || 0) +
      ((Math.abs(al) > 0.25 ? al * 9 : 0) - (b.v || 0)) * Math.min(1, dt * 3);
    b.s = clamp(b.s + b.v * dt, b.min, b.max);
    if (b.s <= b.min || b.s >= b.max) b.v = 0;
    if (Math.abs(b.v) > 0.4) b.dir = Math.sign(b.v);
    if (e.hum && Math.abs(b.v) < 0.4)
      statusTo(
        e,
        b.s <= b.min || b.s >= b.max
          ? "🚣 End of the river — row back or JUMP to step out"
          : "🚣 Move along the river to row · JUMP to step out",
        0.4,
      );
    const p = riverAt(b.ri, b.s);
    b.x = p.x;
    b.z = p.z;
    e.pos.set(p.x, -0.3, p.z);
    e.yaw = Math.atan2(p.dx * b.dir, p.dz * b.dir);
    e.vy = 0;
    e.onGround = false;
    e.moving = Math.abs(b.v);
    e.kx = e.kz = 0;
    return true;
  }
  if (e.stun) {
    e.charge = null;
    return false;
  }
  if (e.isPlayer && phase === "game") {
    if (e.zipCd <= 0)
      for (const z of zips)
        if (hyp(e.pos.x - z.ax, e.pos.y - z.fy, e.pos.z - z.az) < 1.15) {
          e.zip = { z, s: 0 };
          e.stance = 0;
          beep(700, 0.5, "sawtooth", 0.04, -300);
          setStatus("🪂 ZIPLINE! (JUMP to let go)", 1.5);
          return true;
        }
    if (e.boatCd <= 0 && e.pos.y < 0.6)
      for (const b of boats)
        if (!b.rider && hyp(e.pos.x - b.x, e.pos.z - b.z) < 1.9) {
          e.boat = b;
          b.rider = e;
          b.v = 0;
          e.stance = 0;
          setStatus(
            "🚣 In the boat — move along the river to row, JUMP to step out",
            2.5,
          );
          return true;
        }
  }
  if (e.isPlayer || (e.ai && e.ai.lad))
    for (const l of ladders)
      if (
        e.pos.x > l.x0 &&
        e.pos.x < l.x1 &&
        e.pos.z > l.z0 &&
        e.pos.z < l.z1 &&
        e.pos.y < l.y1
      ) {
        const into = -(e.wx * l.nx + e.wz * l.nz);
        if (into < -0.3 || (into < 0.3 && e.pos.y < 0.3)) break; // walking away / just passing by
        if (
          e.isPlayer &&
          into < 0.3 &&
          Math.abs(e.wx * l.nz - e.wz * l.nx) > 0.45
        ) {
          e.onLadder = 0;
          if (e.vy < -2) e.vy = -2;
          break;
        } // v51: steer sideways to step off onto a ledge beside the ladder
        e.onLadder = 0.2;
        e.vy = 0;
        e.kx = e.kz = 0;
        e.moving = 0;
        e.onGround = false;
        e.yaw = Math.atan2(-l.nx, -l.nz);
        if (e.stance) e.stance = 0;
        if (into > 0.3) {
          e.pos.x = l.sx;
          e.pos.z = l.sz;
          e.pos.y += 4.6 * dt;
          e.climbA = (e.climbA || 0) + dt * 10;
          if (e.pos.y >= l.y1) {
            e.pos.set(l.lx, l.y1, l.lz);
            e.onGround = true;
          }
        }
        return true;
      }
  if (e.charge) {
    const c = e.charge;
    c.t -= dt;
    e.kx = c.dx * 19;
    e.kz = c.dz * 19;
    e.wx = e.wz = 0;
    for (const r of ents)
      if (
        isPrey(r) &&
        hyp(r.pos.x - e.pos.x, r.pos.z - e.pos.z) < 1.5 &&
        Math.abs(r.pos.y - e.pos.y) < 1.6
      ) {
        r.caughtBy = e;
        damage(r, 13, c.dx, c.dz, 13, "TACKLE!", true);
        if (
          r.alive &&
          r.role === "runner" &&
          !STUCK.includes(r.stun && r.stun.type)
        )
          r.stun = { type: "slip", t: 1.4 };
        e.charge = null;
        e.kx *= 0.2;
        e.kz *= 0.2;
        break;
      }
    if (e.charge && c.t <= 0) {
      e.charge = null;
      e.kx *= 0.3;
      e.kz *= 0.3;
      e.stun = { type: "stagger", t: 0.6 };
    }
  }
  return false;
}
function afterMove(e, dt) {
  if (e.onGround)
    for (const t of tramps)
      if (
        e.pos.x > t.x0 &&
        e.pos.x < t.x1 &&
        e.pos.z > t.z0 &&
        e.pos.z < t.z1 &&
        Math.abs(e.pos.y - t.y) < 0.06
      ) {
        e.vy = e.isPlayer && keys.Space ? 17 : 14;
        e.onGround = false;
        if (e.stance) e.stance = 0;
        puff(e.pos.x, t.y, e.pos.z, 0x35a8ff, 4, 2);
        if (e.isPlayer) beep(260, 0.25, "sine", 0.07, 500);
      }
  if (e.role === "chaser" && e.onGround && !e.stun && e.moving > 3)
    for (let i = peels.length - 1; i >= 0; i--) {
      const p = peels[i];
      if (
        hyp(p.x - e.pos.x, p.z - e.pos.z) > 0.85 ||
        Math.abs(p.y - e.pos.y) > 0.6
      )
        continue;
      if (!e.isPlayer) {
        if (p.seen[e.name] === undefined)
          p.seen[e.name] = Math.random() < LVL.notice * 0.8;
        if (p.seen[e.name]) continue;
      }
      scene.remove(p.m);
      peels.splice(i, 1);
      e.stun = { type: "slip", t: 1.8 };
      e.kx = Math.sin(e.yaw) * 9;
      e.kz = Math.cos(e.yaw) * 9;
      e.atk = null;
      e.charge = null;
      playVoiceAt(SLIP.a, e, 1);
      popText("SLIP!", e.pos.x, e.pos.y + 2.5, e.pos.z, "#ffe135", 1.1);
      msg(`🍌 ${e.name} slipped on a banana peel!`);
      beep(400, 0.3, "sawtooth", 0.07, -300);
      if (e.hum) statusTo(e, "🍌 You slipped on a banana peel!", 1.5);
    }
}
function visExtras(e) {
  const v = e.v;
  v.g.visible = !e.hidden && e.cap !== "out";
  if (e.raft != null) {
    const s = Math.sin(clock * 7 + e.raft);
    v.body.position.y = -0.3;
    v.legL.rotation.x = v.legR.rotation.x = -1.45;
    v.armL.rotation.x = v.armR.rotation.x = e.rcap ? -0.9 : -0.9 + s * 0.6;
  }
  if (e.cap === "tied") {
    v.body.rotation.set(0, 0, 0);
    v.body.position.set(0, 0, 0);
    v.armL.rotation.z = v.armR.rotation.z = 0;
    v.armL.rotation.x = v.armR.rotation.x = 0.7;
    e.label.position.y = 2.35;
    if (e.healed) v.body.rotation.z = Math.sin(clock * 7) * 0.12;
  }
  if (e.cap === "carried") {
    v.body.position.set(0, 0.1, 0.9);
    e.label.position.y = 0.9;
  }
  if (e.carry) {
    v.armL.rotation.x = v.armR.rotation.x = Math.PI;
  }
  if (e.seat != null) {
    v.body.position.y = -0.3;
    v.legL.rotation.x = v.legR.rotation.x = -1.45;
    v.armL.rotation.x = v.armR.rotation.x = -0.5;
  }
  if (e.zip) {
    v.armL.rotation.x = v.armR.rotation.x = Math.PI;
    v.legL.rotation.x = 0.35;
    v.legR.rotation.x = -0.15;
    v.body.rotation.x = 0;
  }
  if (e.boat) {
    v.body.scale.y = 0.62;
    const s = Math.sin(clock * 6);
    v.armL.rotation.x = v.armR.rotation.x = -1 + s * 0.5;
  }
  if (e.onLadder > 0) {
    e.onLadder -= 0.016;
    const s = Math.sin(e.climbA || 0);
    v.armL.rotation.x = Math.PI + s * 0.5;
    v.armR.rotation.x = Math.PI - s * 0.5;
    v.legL.rotation.x = s * 0.6;
    v.legR.rotation.x = -s * 0.6;
    v.body.rotation.x = 0;
  }
  if (e.charge) {
    v.body.rotation.x = 0.55;
    v.armL.rotation.x = v.armR.rotation.x = -1.3;
  }
  if (e.shovel && !e.shovelMesh) {
    const m = itemMesh("shovel");
    m.position.set(0.3, 1.2, -0.3);
    m.rotation.z = 0.5;
    v.body.add(m);
    e.shovelMesh = m;
  }
  if (e.axe && !e.axeMesh) {
    const m = itemMesh("axe");
    m.position.set(-0.3, 1.2, -0.3);
    m.rotation.z = -0.5;
    v.body.add(m);
    e.axeMesh = m;
  }
  if (e.chain && !e.chainMesh) {
    const m = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const k = new THREE.Mesh(BOX, mat(0x3d434c));
      k.scale.set(0.5, 0.1, 0.16);
      k.position.set(0, 1.0 + i * 0.09, 0.26);
      k.rotation.z = (i % 2 ? 1 : -1) * 0.5;
      m.add(k);
    }
    v.body.add(m);
    e.chainMesh = m;
  }
  if (e.chainMesh) e.chainMesh.visible = !!e.chain;
  const dg = e.digging > 0,
    dk = Math.sin(clock * 9);
  if (dg) {
    e.digging -= 0.016;
    v.body.rotation.x = 0.35 + dk * 0.15;
    v.armL.rotation.x = v.armR.rotation.x = -0.9 + dk * 0.6;
  }
  if (e.shovelMesh) {
    const m = e.shovelMesh;
    m.visible = !!e.shovel; // on the back, or in both hands stabbing the ground while digging
    if (dg && e.tool !== "axe") {
      m.position.set(0.02, 0.98 - dk * 0.16, 0.55 + dk * 0.05);
      m.rotation.set(-0.45 - dk * 0.3, 0, 0);
    } else {
      m.position.set(0.3, 1.2, -0.3);
      m.rotation.set(0, 0, 0.5);
    }
  }
  if (e.axeMesh) {
    const m = e.axeMesh;
    m.visible = !!e.axe;
    if (dg && e.tool === "axe") {
      m.position.set(0.05, 1.05, 0.5);
      m.rotation.set(0.5 + dk * 0.9, 0, 1.57);
    } else {
      m.position.set(-0.3, 1.2, -0.3);
      m.rotation.set(0, 0, -0.5);
    }
  }
  if (e.wood && !e.woodMesh) {
    const m = itemMesh("wood");
    m.position.set(0, 1.5, -0.38);
    m.rotation.y = 0;
    v.body.add(m);
    e.woodMesh = m;
  }
  if (e.woodMesh) e.woodMesh.visible = !!e.wood;
  if (e.sail && !e.sailMesh) {
    const m = itemMesh("sail");
    m.position.set(0, 1.25, -0.42);
    m.scale.multiplyScalar(1.25);
    v.body.add(m);
    e.sailMesh = m;
  }
  if (e.sailMesh) e.sailMesh.visible = !!e.sail;
  if (e.fuel && !e.fuelMesh) {
    const m = itemMesh("fuel");
    m.position.set(0, 1.15, -0.36);
    v.body.add(m);
    e.fuelMesh = m;
  }
  if (e.fuelMesh) e.fuelMesh.visible = !!e.fuel;
  const dt_ = !(e.revealT > 0);
  if (e.label.material.depthTest !== dt_) {
    e.label.material.depthTest = dt_;
    e.label.material.needsUpdate = true;
    e.label.renderOrder = dt_ ? 0 : 10;
  }
}

/* ---------- bot hooks ---------- */
const DOCKGO = { x: 117.5, z: -40 },
  SHIP_T = { wood: 1.6, iron: 1.6, sail: 3, fuel: 5 };
const cargo = (e) =>
  !!(e.fuel || e.sail || (e.iron || 0) > 0 || (e.wood || 0) - (e.wet || 0) > 0);
function shoveOff(c, r) {
  // a chaser throws a seated runner off the ship
  const dx = r.pos.x - c.pos.x,
    dz = r.pos.z - c.pos.z,
    l = hyp(dx, dz) || 1;
  leaveSeat(r);
  c.pushCd = 5;
  c.atk = { type: "push", t: 0, dur: 0.32, left: false, done: true };
  r.kx += (dx / l) * 14;
  r.kz += (dz / l) * 6 + 13;
  r.vy = 4.5;
  r.onGround = false;
  r.stun = { type: "slip", t: 1.3 };
  r.seatCd = 4; // over the far rail into the water
  popText("OVERBOARD!", r.pos.x, r.pos.y + 2.4, r.pos.z, "#9fe0ff", 1);
  thud(r, 1.2);
  msg(`🫸 ${c.name} shoved ${r.name} off the ship!`);
  if (r.hum)
    statusTo(
      r,
      "🫸 You were shoved off the ship — swim round and climb back on at the dock!",
      3.5,
    );
}
function leaveSeat(e) {
  if (e.seat == null) return;
  SEATS[e.seat].occ = null;
  e.seat = null;
  e.seatCd = 2.5;
  e.pos.z = SHIP.z;
  e.pos.y = 0.3;
}
const onShip = (e) =>
  Math.abs(e.pos.x - SHIP.x) < 5.9 &&
  Math.abs(e.pos.z - SHIP.z) < 1.95 &&
  e.pos.y > 0.1 &&
  e.pos.y < 1;
function toDock(e, dt) {
  const ai = e.ai;
  e.run = true;
  if (e.stance) setStance(e, 0);
  const onPier = e.pos.x > 116 && Math.abs(e.pos.z - DOCK.z) < 6.5;
  if (!onPier) {
    if (
      !ai.path ||
      !ai.goal ||
      hyp(ai.goal.x - DOCKGO.x, ai.goal.z - DOCKGO.z) > 1
    )
      goTo(e, DOCKGO.x, DOCKGO.z);
    if (!follow(e)) moveTo(e, DOCK.x - 1, DOCK.z);
    stuckCheck(e, dt);
  } else if (!shipReady() && !cargo(e)) {
    if (hyp(e.pos.x - DOCK.x, e.pos.z - DOCK.z) > 4)
      moveTo(e, DOCK.x - 1, DOCK.z);
    else e.wx = e.wz = 0;
  } else if (onShip(e) && !shipReady()) {
    const gx = SHIP.x - 3 + (ents.indexOf(e) % 5) * 1.3;
    if (Math.abs(e.pos.x - gx) > 0.5) moveTo(e, gx, SHIP.z);
    else e.wx = e.wz = 0;
  } // aboard with parts: stand still and fit them
  else if (e.pos.x < 130.5 && !onShip(e))
    moveTo(
      e,
      131.5,
      DOCK.z + (e.pos.x < 121 ? 0 : -0.6 + (ai.think % 1) * 1.2),
    ); // along the dock…
  else moveTo(e, SHIP.x - 1, SHIP.z); // …and step aboard
}
function pierTo(e, dt, x, z) {
  // walk to a spot on the dock: path to the foot of the pier, then straight
  const ai = e.ai;
  e.run = true;
  if (e.stance) setStance(e, 0);
  if (onShip(e) || (e.pos.x > 116 && Math.abs(e.pos.z - DOCK.z) < 6.5)) {
    if (hyp(e.pos.x - x, e.pos.z - z) < 0.7) e.wx = e.wz = 0;
    else moveTo(e, x, z);
  } else {
    if (
      !ai.path ||
      !ai.goal ||
      hyp(ai.goal.x - DOCKGO.x, ai.goal.z - DOCKGO.z) > 1
    )
      goTo(e, DOCKGO.x, DOCKGO.z);
    if (!follow(e)) moveTo(e, DOCK.x - 1, DOCK.z);
    stuckCheck(e, dt);
  }
}
function runnerExtras(e, dt, c, cd) {
  const ai = e.ai,
    inv = e.inv;
  if (CHAIN.on && !e.hidden && !e.fuel) {
    if (e.axe && (cd > 7 || hyp(e.pos.x - CHAIN.x, e.pos.z - CHAIN.z) < 3)) {
      if (e.seat != null) leaveSeat(e);
      pierTo(e, dt, CHAIN.x - 0.9, CHAIN.z - 0.5);
      return true;
    }
    if (
      !e.axe &&
      cd > 12 &&
      ai.alert <= 0 &&
      e.seat == null &&
      !ents.some((o) => o.role === "runner" && o.alive && o.axe)
    ) {
      if (ai.axer === undefined)
        ai.axer = Math.random() < 0.35 + 0.4 * LVL.smart;
      if (ai.axer) {
        let it = null,
          bd = 1e9;
        for (const k of items)
          if (k.type === "axe" && k.y < 1) {
            const d = hyp(k.x - e.pos.x, k.z - e.pos.z);
            if (d < bd) {
              bd = d;
              it = k;
            }
          }
        if (it) {
          e.run = bd > 25;
          if (e.stance) setStance(e, 0);
          if (
            !ai.path ||
            !ai.goal ||
            hyp(ai.goal.x - it.x, ai.goal.z - it.z) > 1
          )
            goTo(e, it.x, it.z);
          if (!follow(e)) moveTo(e, it.x, it.z);
          stuckCheck(e, dt);
          return true;
        }
      }
    }
  }
  if (e.hidden) {
    ai.hideWait -= dt;
    e.wx = e.wz = 0;
    if ((ai.hideWait <= 0 && cd > 12) || ai.hideWait < -12) unhide(e);
    return true;
  }
  if (inv.medkit && e.hp < 55 && cd > 9) useMedkit(e);
  if (ai.alert > 0) {
    if (inv.banana && cd < 6 && Math.random() < dt * 1.2) dropBanana(e);
    if (
      e.kit.length &&
      cd < 13 &&
      cd > 4 &&
      e.onGround &&
      Math.random() < dt * 0.6
    ) {
      if (placeTrap(e, e.kit[e.kit.length - 1])) e.kit.pop();
    }
    if (inv.smoke && cd < 9 && Math.random() < dt * 0.7 * (0.3 + LVL.smart))
      useSmoke(e);
    if (
      inv.decoy &&
      cd < 15 &&
      cd > 5 &&
      Math.random() < dt * 0.5 * (0.3 + LVL.smart)
    )
      useDecoy(e);
  }
  if (shipReady() && !CHAIN.on && (cd > 4 || e.pos.x > 116)) {
    toDock(e, dt);
    return true;
  } // the ship is ready: boarding beats everything else
  if (ai.hero === undefined) ai.hero = Math.random() < 0.4 + 0.4 * LVL.smart;
  {
    let tr = null,
      bd = 45;
    for (const r of ents)
      if (r !== e && r.role === "runner" && r.alive && r.stun && r.stun.held) {
        const d = hyp(r.pos.x - e.pos.x, r.pos.z - e.pos.z);
        if (d < bd) {
          bd = d;
          tr = r;
        }
      }
    if (tr && (ai.hero || bd < 16) && (cd > 8 || bd < 6) && !e.fuel) {
      e.run = true;
      if (e.stance) setStance(e, 0);
      if (bd < 2.0) {
        e.wx = e.wz = 0;
        doPush(e);
      } else navTo(e, tr.pos.x, tr.pos.z, dt);
      return true;
    }
  }
  if (ai.hero && !e.fuel) {
    let pr = null,
      bd = 1e9;
    for (const r of JAIL.slots)
      if (r && r.healed) {
        const d = hyp(r.pos.x - e.pos.x, r.pos.z - e.pos.z);
        if (d < bd) {
          bd = d;
          pr = r;
        }
      }
    if (pr && (cd > 9 || bd < 6)) {
      e.run = true;
      if (e.stance) setStance(e, 0);
      if (bd < 1.3) e.wx = e.wz = 0;
      else jailTo(e, dt, pr.pos.x, pr.pos.z);
      return true;
    }
  }
  if (shipReady() && cd > 4) {
    toDock(e, dt);
    return true;
  }
  const wLeft = WOOD_NEED - woodDone,
    iLeft = IRON_SHIP - ironDone;
  if (
    (e.fuel ||
      e.sail ||
      (e.iron || 0) > 0 ||
      (e.wood || 0) >= Math.min(WOOD_MAX, Math.max(1, wLeft))) &&
    !noShip &&
    ai.alert <= 0
  ) {
    if (!dryFirst(e, dt)) toDock(e, dt);
    return true;
  }
  if (ai.fan === undefined) {
    ai.fan = Math.random() < 0.72 + 0.28 * LVL.smart;
    ai.job = Math.random() < 0.72 ? "wood" : "fuel";
  }
  if (ai.fan && !noShip && !e.fuel && ai.alert <= 0 && cd > 11 && !ai.hideGo) {
    let it = null,
      bd = 1e9;
    const near = (x, z, o) => {
      const d = hyp(x - e.pos.x, z - e.pos.z) + (o.wet ? 35 : 0);
      if (d < bd) {
        bd = d;
        it = o;
      }
    }; // soaked planks are a last choice: they cost a trip to a campfire
    const job =
      ai.job === "wood" && wLeft <= 0
        ? "fuel"
        : ai.job === "fuel" && fuelDone >= 3
          ? "wood"
          : ai.job;
    const wCar = ents.reduce(
        (n, o) => n + (o.role === "runner" && o.alive ? o.wood || 0 : 0),
        0,
      ),
      iCar = ents.reduce(
        (n, o) => n + (o.role === "runner" && o.alive ? o.iron || 0 : 0),
        0,
      );
    for (const k of items)
      if (
        k.y < 1 &&
        ((k.type === "fuel" && fuelDone < 3) ||
          (k.type === "wood" &&
            job === "wood" &&
            woodDone + wCar < WOOD_NEED &&
            (e.wood || 0) < WOOD_MAX) ||
          (k.type === "iron" &&
            ironDone + iCar < IRON_SHIP &&
            hyp(k.x - e.pos.x, k.z - e.pos.z) < 60) ||
          (k.type === "sail" &&
            !e.sail &&
            sailDone +
              ents.reduce(
                (n, o) =>
                  n + (o.role === "runner" && o.alive ? o.sail || 0 : 0),
                0,
              ) <
              SAIL_NEED &&
            hyp(k.x - e.pos.x, k.z - e.pos.z) < 60))
      )
        near(k.x, k.z, k);
    if (!it && (e.wood || 0) > 0) {
      if (!dryFirst(e, dt)) toDock(e, dt);
      return true;
    }
    if (e.shovel && job === "fuel" && fuelDone < 3)
      for (const L of leaks)
        if (
          !L.dug &&
          !ents.some(
            (o) =>
              o !== e &&
              o.alive &&
              o.shovel &&
              hyp(o.pos.x - L.x, o.pos.z - L.z) < 1.5,
          )
        )
          near(L.x, L.z, L);
    if (it) {
      if (bd < 0.9 && it.dig !== undefined) {
        e.wx = e.wz = 0;
        return true;
      } // stand still and dig
      e.run = bd > 30;
      if (e.stance) setStance(e, 0);
      if (!ai.path || !ai.goal || hyp(ai.goal.x - it.x, ai.goal.z - it.z) > 1)
        goTo(e, it.x, it.z);
      if (!follow(e)) moveTo(e, it.x, it.z);
      stuckCheck(e, dt);
      return true;
    }
  }
  if (ai.hideGo) {
    const s = ai.hideGo,
      d = hyp(s.x - e.pos.x, s.z - e.pos.z);
    ai.hideT -= dt;
    if (s.occ || cd < 6 || ai.hideT < 0) ai.hideGo = null;
    else if (d < 1.6) {
      hideIn(e, s);
      ai.hideGo = null;
      ai.hideWait = rnd(4, 8.5);
      return true;
    } else {
      e.run = true;
      if (!ai.path || !ai.goal || hyp(ai.goal.x - s.x, ai.goal.z - s.z) > 0.1)
        goTo(e, s.x, s.z);
      if (!follow(e)) moveTo(e, s.x, s.z);
      stuckCheck(e, dt);
      return true;
    }
  } else if (
    LVL.smart > 0 &&
    !(e.hideCd > 0) &&
    !e.fuel &&
    cd > 10 &&
    cd < 45 &&
    ai.alert > 0 &&
    Math.random() < dt * 0.5 * LVL.smart
  ) {
    let best = null,
      bd = 10;
    for (const s of spots) {
      const d = hyp(s.x - e.pos.x, s.z - e.pos.z);
      if (!s.occ && d < bd && hyp(s.x - c.pos.x, s.z - c.pos.z) > d + 4) {
        bd = d;
        best = s;
      }
    }
    if (
      best &&
      !los(c.pos.x, c.pos.y + 1.6, c.pos.z, e.pos.x, e.pos.y + 1.2, e.pos.z)
    ) {
      ai.hideGo = best;
      ai.hideT = 5;
      ai.path = null;
    }
  }
  return false;
}
function chaserExtras(e, dt, tgt) {
  if (phase !== "game") return false;
  const ai = e.ai,
    t = tgt && isPrey(tgt) ? tgt : null;
  {
    const r = chaserCapture(e, dt, tgt);
    if (r !== null) return r;
  }
  if (
    e.chain &&
    !CHAIN.on &&
    !(t && hyp(t.pos.x - e.pos.x, t.pos.z - e.pos.z) < 7)
  ) {
    pierTo(e, dt, CHAIN.x - 0.9, CHAIN.z - 0.5);
    return true;
  } // carry the chain to the dock
  if (ai.smith === undefined) {
    const bots = chasers.filter((c) => !c.isPlayer);
    ai.smith = e === bots[bots.length - 1];
  }
  if (
    ai.smith &&
    !t &&
    !shipGone &&
    !CHAIN.on &&
    chainsMade < 3 &&
    !chasers.some((c) => c.chain)
  ) {
    // one chaser makes it his job to forge the chain and lock the ship
    let it = null,
      bd = 1e9;
    for (const k of items)
      if (k.type === "iron" && k.y < 1) {
        const d = hyp(k.x - e.pos.x, k.z - e.pos.z);
        if (d < bd) {
          bd = d;
          it = k;
        }
      }
    if (it) {
      e.run = true;
      ai.search = null;
      navTo(e, it.x, it.z, dt);
      return true;
    }
  }
  if (ai.chainGo > 0 && !t) {
    ai.chainGo -= dt;
    if (!CHAIN.on) ai.chainGo = 0;
    else {
      pierTo(e, dt, CHAIN.x - 1.5, CHAIN.z - 0.6);
      return true;
    }
  } // someone is chopping the chain
  if (!t)
    for (const r of ents)
      if (
        isPrey(r) &&
        r.moving > 5.5 &&
        r.stance === 0 &&
        r.onGround &&
        Math.abs(r.pos.y - e.pos.y) < 3 &&
        hyp(r.pos.x - e.pos.x, r.pos.z - e.pos.z) < 6 + 7 * LVL.smart
      ) {
        ai.tgt = r;
        ai.mem = Math.max(ai.mem, 2.5);
        ai.last = { x: r.pos.x, z: r.pos.z };
        break;
      } // heard footsteps
  if (t) {
    const dx = t.pos.x - e.pos.x,
      dz = t.pos.z - e.pos.z,
      d = hyp(dx, dz);
    if (
      e.chargeCd <= 0 &&
      d > 4 &&
      d < 9 &&
      Math.abs(t.pos.y - e.pos.y) < 1 &&
      e.onGround &&
      Math.random() < dt * 0.5 * LVL.gadget &&
      !crossesRiver(e.pos.x, e.pos.z, t.pos.x, t.pos.z) &&
      los(e.pos.x, e.pos.y + 1, e.pos.z, t.pos.x, t.pos.y + 1, t.pos.z)
    ) {
      e.yaw = Math.atan2(dx, dz);
      doCharge(e);
    }
    ai.search = null;
    return false;
  }
  if (tgt) return false; // still chasing from memory — if you hid in plain sight he walks up and kicks the spot
  if (e.roarCd <= 0 && Math.random() < dt * 0.1 * LVL.gadget) doRoar(e);
  if (!ai.burn && Math.random() < dt * 0.04 * (0.3 + LVL.smart)) {
    let bd = 70;
    for (const L of leaks)
      if (!L.dug) {
        const d = hyp(L.x - e.pos.x, L.z - e.pos.z);
        if (d < bd) {
          bd = d;
          ai.burn = L;
          ai.burnT = 0;
        }
      }
  }
  if (ai.burn) {
    const L = ai.burn;
    ai.burnT += dt;
    if (L.dug || ai.burnT > 30) ai.burn = null;
    else {
      if (hyp(L.x - e.pos.x, L.z - e.pos.z) < 0.9) e.wx = e.wz = 0;
      else navTo(e, L.x, L.z, dt);
      return true;
    }
  }
  if (shipReady()) {
    if (hyp(e.pos.x - DOCKGO.x, e.pos.z - DOCKGO.z) > 6) {
      if (
        !ai.path ||
        !ai.goal ||
        hyp(ai.goal.x - DOCKGO.x, ai.goal.z - DOCKGO.z) > 1
      )
        goTo(e, DOCKGO.x, DOCKGO.z);
      follow(e);
      stuckCheck(e, dt);
      return true;
    }
    return false;
  }
  if (!ai.search && Math.random() < dt * 0.05 * (0.4 + LVL.smart)) {
    let best = null,
      bd = 20;
    for (const s of spots) {
      const d = hyp(s.x - e.pos.x, s.z - e.pos.z);
      if (d < bd && !(clock - s.chk < 25)) {
        bd = d;
        best = s;
      }
    }
    if (best) {
      ai.search = best;
      ai.searchT = 0;
      ai.path = null;
    }
  }
  if (ai.search) return doSearch(e, dt);
  return false;
}

/* ---------- player actions / keys ---------- */
function extraAction(p, a) {
  if (a === "jump") {
    if (p.raft != null) {
      if (!RAFT.go) raftOff(p, null, true);
      return true;
    }
    if (p.seat != null) {
      leaveSeat(p);
      setStatus("");
      return true;
    }
    if (p.hidden) {
      unhide(p);
      return true;
    }
    if (p.zip) {
      p.zip = null;
      p.zipCd = 1.5;
      return true;
    }
    if (p.boat) {
      leaveBoat(p);
      return true;
    }
    return false;
  }
  if (p.hidden || p.zip || p.boat) {
    if (a === "hide" && p.hidden) unhide(p);
    return true;
  }
  if (p.role !== "chaser") {
    if (a === "hide") {
      tryHide(p);
      return true;
    }
    if (a === "bolt") {
      useBolt(p);
      return true;
    }
    if (a === "smoke") {
      useSmoke(p);
      return true;
    }
    if (a === "decoy") {
      useDecoy(p);
      return true;
    }
    if (a === "banana") {
      dropBanana(p);
      return true;
    }
    if (a === "medkit") {
      useMedkit(p);
      return true;
    }
    if (a === "throw" && !p.held && p.kit.length) {
      const ty = p.kit[p.kit.length - 1];
      if (placeTrap(p, ty)) {
        p.kit.pop();
        if (SUBJ)
          netStatus(SUBJ, `You set a ${TRAP_N[ty]} for the chasers 😈`, 2);
        else msg(`You set a ${TRAP_N[ty]} for the chasers 😈`);
        beep(220, 0.15, "triangle", 0.07);
      }
      return true;
    }
  } else {
    if (a === "roar") {
      doRoar(p);
      return true;
    }
    if (a === "charge") {
      doCharge(p);
      return true;
    }
  }
  return false;
}
function extraKey(code) {
  if (!player) return null;
  if (player.role === "chaser")
    return { Digit4: "bear", KeyT: "roar", KeyV: "charge" }[code];
  return {
    Digit1: "smoke",
    Digit2: "decoy",
    Digit3: "banana",
    Digit4: "medkit",
    KeyH: "hide",
    KeyX: "bolt",
  }[code];
}

/* ---------- per-frame systems ---------- */
let cine = null;
function endTaunt() {
  // the chasers won: they jump about on the prison and tease, the title stands on the left
  if (cine) return;
  document.body.classList.add("cine");
  $("sndpanel").classList.add("hide");
  $("end").classList.add("esc");
  $("obj").innerHTML = "";
  cine = {
    kind: "ch",
    t: 0,
    sayT: 0.6,
    n: 0,
    ch: chasers.slice(0, 5),
    mine: player.role === "chaser",
  };
}
function tauntUpdate(dt) {
  const C = cine;
  C.t += dt;
  const n = C.ch.length,
    P = JAIL,
    fz = P.z + 5.1;
  C.ch.forEach((c, i) => {
    const V = c.v,
      w = Math.sin(C.t * 12 + i * 2.1),
      hop = Math.abs(Math.sin(C.t * 6.2 + i * 1.3)) * 0.75;
    c.stun = null;
    c.atk = null;
    c.pos.set(P.x + (i - (n - 1) / 2) * 1.75, P.y + hop, fz);
    c.vy = 0;
    c.yaw = Math.sin(C.t * 2 + i) * 0.25;
    V.g.position.copy(c.pos);
    V.g.rotation.y = c.yaw;
    V.body.position.set(0, 0, 0);
    V.body.scale.set(1, 1, 1);
    V.body.rotation.set(0, 0, w * 0.1);
    V.head.rotation.z = w * 0.16;
    V.legL.rotation.x = hop > 0.3 ? -0.7 : 0;
    V.legR.rotation.x = hop > 0.3 ? 0.5 : 0;
    if ((i + Math.floor(C.t / 2.2)) % 2) {
      V.armL.rotation.x = Math.PI + w * 0.45;
      V.armR.rotation.x = Math.PI - w * 0.45;
      V.armL.rotation.z = -0.3;
      V.armR.rotation.z = 0.3;
    } // both arms up
    else {
      V.armR.rotation.x = -1.5 + w * 0.12;
      V.armR.rotation.z = 0;
      V.armL.rotation.x = 0.3;
      V.armL.rotation.z = -0.5;
    } // pointing at you
    if (c.label) c.label.visible = true;
  });
  C.sayT -= dt;
  if (C.sayT <= 0 && n) {
    C.sayT = C.t < 8 ? 0.85 : 1.7;
    const c = C.ch[C.n++ % n],
      L = C.mine
        ? [
            "WE WIN! 🎉",
            "GOT THEM ALL!",
            "NOBODY ESCAPES!",
            "TOO EASY! 😜",
            "HA HA HA!",
            "WHO IS NEXT?",
          ]
        : [
            "YOU LOSE! 😜",
            "TOO SLOW! 😝",
            "GOT YOU ALL!",
            "HA HA HA!",
            "NOWHERE TO RUN!",
            "NICE TRY! 👋",
            "BETTER LUCK NEXT TIME!",
          ];
    popText(
      L[Math.floor(rnd(L.length))],
      c.pos.x,
      P.y + 3.0 + rnd(0.5),
      c.pos.z,
      "#ff8a80",
      1.0,
    );
    beep(300 + rnd(240), 0.14, "square", 0.04, 160);
  }
  const k = Math.min(1, C.t / 6),
    sm = k * k * (3 - 2 * k);
  camera.position.set(
    P.x + Math.sin(C.t * 0.25) * 0.8,
    P.y + 2.3 - sm * 0.5,
    fz + 8.2 - sm * 2.2,
  );
  camera.lookAt(P.x, P.y + 1.25, fz);
  {
    const W = innerWidth,
      Hh = innerHeight,
      wide = W > 760 && W > Hh,
      kx = wide ? 0.3 * sm : 0,
      ky = wide ? 0 : 0.16 * sm;
    if (kx || ky) camera.setViewOffset(W, Hh, -W * kx, -Hh * ky, W, Hh);
    else if (camera.view) camera.clearViewOffset();
  } // chasers framed on the right (below on phones)
  sun.position.set(P.x + 30, 70, fz + 40);
  sun.target.position.set(P.x, 0, fz);
  sun.target.updateMatrixWorld();
}
function endEscape(list) {
  if (NET.guest && !NET.endOk) return;
  if (NET.host)
    netEnd(
      "e",
      list.map((e) => e.nid),
    );
  phase = "end";
  $("pause").classList.add("hide");
  if (document.exitPointerLock) document.exitPointerLock();
  const me = list.includes(player);
  musPlay(player.role === "runner" && me ? "victory" : "defeat");
  $("endt").textContent = "🚤 ESCAPED BY BOAT!";
  $("endp").textContent =
    `${list.map((e) => e.name).join(", ")} sailed away from the island.` +
    (player.role === "chaser"
      ? " You lose."
      : me
        ? " You win! 🎉"
        : " (…but the boat left without you.)");
  // cutscene: the ship pulls away, the runners wave and tease, the chasers rage on the dock
  document.body.classList.add("cine");
  $("sndpanel").classList.add("hide");
  cine = {
    t: 0,
    off: 0,
    sayT: 0.4,
    riders: list.map((e) => ({
      e,
      ox: e.pos.x - SHIP.x,
      oz: e.pos.z - SHIP.z,
      face: e.yaw,
    })),
    ch: chasers.slice(0, 4),
  };
  for (const r of cine.riders)
    if (r.e.seat != null) {
      SEATS[r.e.seat].occ = null;
      r.e.seat = null;
    }
  CHAIN.g.visible = false;
  if (SHIPFX.sign) SHIPFX.sign.visible = false;
  setStatus("");
  $("obj").innerHTML = "";
}
function cineUpdate(dt) {
  if (cine.kind === "ch") {
    tauntUpdate(dt);
    return;
  }
  if (cine.kind === "raft") {
    raftCine(dt);
    return;
  }
  const C = cine;
  C.t += dt;
  if (C.t > 4.5 && !C.shown) {
    C.shown = true;
    $("end").classList.add("esc");
    $("end").classList.remove("hide");
  }
  const v =
      C.t < 9 ? Math.min(6.5, C.t * 1.6) : Math.max(2.2, 6.5 - (C.t - 9) * 1.1),
    dx = v * dt;
  C.off += dx;
  for (const m of SHIPFX.meshes) {
    m.position.x += dx;
    m.position.y += Math.sin(C.t * 2.2) * 0.0015;
  }
  C.riders.forEach((r, i) => {
    const e = r.e,
      V = e.v,
      w = Math.sin(C.t * 10 + i * 1.7);
    e.pos.set(SHIP.x + r.ox + C.off, 0.3, SHIP.z + r.oz);
    e.vy = 0;
    e.yaw = -Math.PI / 2;
    V.g.position.copy(e.pos);
    V.g.rotation.y = e.yaw;
    V.body.position.y = -0.3;
    V.body.rotation.set(0, 0, 0);
    V.legL.rotation.x = V.legR.rotation.x = -1.45;
    V.armR.rotation.x = Math.PI + w * 0.25;
    V.armR.rotation.z = -0.25 + w * 0.35;
    V.armL.rotation.x = i % 2 ? Math.PI - w * 0.25 : -0.4;
    V.armL.rotation.z = i % 2 ? 0.25 - w * 0.35 : 0;
    V.head.rotation.z = w * 0.15;
  });
  C.ch.forEach((c, i) => {
    const V = c.v,
      w = Math.sin(C.t * 13 + i * 2.1),
      px = Math.min(139.2, 135.2 + i * 1.25 + C.t * 0.9),
      pz = DOCK.z + (i % 2 ? 1 : -0.9) + (i > 1 ? 0.4 : 0);
    c.pos.set(px, 0.3 + Math.abs(Math.sin(C.t * 7 + i)) * 0.35, pz);
    c.vy = 0;
    c.stun = null;
    c.yaw = Math.PI / 2 + (SHIP.z - pz) * 0.02;
    V.g.position.copy(c.pos);
    V.g.rotation.y = c.yaw;
    V.body.rotation.set(0.15, 0, 0);
    V.armL.rotation.x = Math.PI + w * 0.5;
    V.armR.rotation.x = Math.PI - w * 0.5;
    V.armL.rotation.z = V.armR.rotation.z = 0;
    V.legL.rotation.x = w * 0.5;
    V.legR.rotation.x = -w * 0.5;
    V.head.rotation.z = w * 0.12;
  });
  C.sayT -= dt;
  if (C.sayT <= 0 && (C.t < 7.4 || C.riders.length)) {
    C.sayT = C.t < 7.4 ? 0.75 : 1.6;
    if (C.t >= 7.4) C.n = 0;
    C.n = (C.n || 0) + 1;
    if (C.n % 3 && C.riders.length) {
      const r = C.riders[Math.floor(rnd(C.riders.length))].e;
      popText(
        [
          "BYE BYE! 👋",
          "TOO SLOW! 😜",
          "SEE YA!",
          "CATCH US NOW!",
          "NA NA NA! 😝",
          "HA HA HA!",
        ][Math.floor(rnd(6))],
        r.pos.x,
        2.9 + rnd(0.6),
        r.pos.z,
        "#7dffa0",
        1.0,
      );
      beep(520 + rnd(260), 0.12, "sine", 0.05, 200);
    } else if (C.ch.length) {
      const c = C.ch[Math.floor(rnd(C.ch.length))];
      popText(
        ["NOOO!", "COME BACK!", "GRRRR! 😡", "NEXT TIME!"][Math.floor(rnd(4))],
        c.pos.x,
        3.2,
        c.pos.z,
        "#ff8a80",
        1.0,
      );
      beep(150, 0.25, "sawtooth", 0.05, -40);
    }
  }
  if (C.t > 0.2 && C.t < 0.3) beep(196, 1.4, "sawtooth", 0.09, -6); // ship horn
  const sm = clamp((C.t - 4) / 3.5, 0, 1),
    s2 = sm * sm * (3 - 2 * sm); // after the send-off the camera sails along with the ship
  const cx = SHIP.x + C.off * (0.55 + 0.45 * s2),
    a = Math.min(1, C.t / 7);
  camera.position.set(
    cx + 13 - a * 5 - s2 * 2,
    5.2 + a * 2.5 - s2 * 1.2,
    DOCK.z - 13 - a * 3 - s2 * 2,
  );
  camera.lookAt(
    SHIP.x + C.off * (0.72 + 0.28 * s2) - 2 - s2 * 2,
    1.3,
    SHIP.z - 0.5,
  );
  {
    const W = innerWidth,
      Hh = innerHeight,
      wide = W > 760 && W > Hh,
      k = wide ? 0.27 * s2 : 0,
      ky = wide ? 0 : 0.16 * s2;
    if (k || ky) camera.setViewOffset(W, Hh, -W * k, -Hh * ky, W, Hh);
    else if (camera.view) camera.clearViewOffset();
  } // ship framed on the right (below on phones)
  if (Math.random() < dt * 14)
    puff(
      SHIP.x + C.off - 9 + rnd(-1, 1),
      -0.15,
      SHIP.z + rnd(-1.6, 1.6),
      0xffffff,
      2,
      1.5,
    ); // wake
  sun.position.set(cx + 40, 70, DOCK.z + 25);
  sun.target.position.set(cx, 0, DOCK.z);
  sun.target.updateMatrixWorld();
}
function updateExtras(dt) {
  for (let i = ents.length - 1; i >= 0; i--)
    if (ents[i].dead) {
      scene.remove(ents[i].v.g);
      ents.splice(i, 1);
    }
  for (let i = smokes.length - 1; i >= 0; i--) {
    const s = smokes[i];
    s.t += dt;
    const k = Math.min(1, s.t / 0.6);
    s.g.scale.set(k, k, k);
    s.sm.opacity = 0.8 * Math.min(1, (s.life - s.t) / 2);
    if (s.t >= s.life) {
      scene.remove(s.g);
      smokes.splice(i, 1);
    }
  }
  for (const s of spots)
    if (s.wig > 0) {
      s.wig -= dt;
      s.m.rotation.z = s.wig > 0 ? Math.sin(clock * 32) * 0.09 : 0;
    }
  for (const b of boats) {
    b.m.position.set(b.x, 0.06 + Math.sin(clock * 2 + b.ri) * 0.04, b.z);
    const p = riverAt(b.ri, b.s);
    b.m.rotation.y = Math.atan2(p.dx, p.dz);
  }
  updateFinalFx(dt);
  if (phase !== "game") return;
  updateCaptives(dt);
  for (const r of ents) {
    // a runner caught in a trap stays caught until a teammate pushes them out (40 s safety limit)
    if (r.trapImm > 0) r.trapImm -= dt;
    if (
      r.role !== "runner" ||
      !r.stun ||
      !["pit", "hang", "bear"].includes(r.stun.type)
    )
      continue;
    if (!r.stun.held) {
      r.stun.held = true;
      r.stun.t = 40;
      msg(
        `🪤 ${r.name} is trapped — a teammate must PUSH them out!`,
        r.isPlayer || player.role === "runner" ? "alarm" : undefined,
      );
    }
    if (r.hum)
      statusTo(
        r,
        `🪤 TRAPPED — only a teammate's PUSH can free you (${Math.ceil(r.stun.t)}s)`,
        0.3,
      );
    else if (
      player.role === "runner" &&
      player.alive &&
      !player.stun &&
      hyp(player.pos.x - r.pos.x, player.pos.z - r.pos.z) < 3.2 &&
      statusT > 900
    )
      setStatus(`🤝 Press G (PUSH) to free ${r.name} from the trap`, 0.3);
  }
  {
    // sneak attack: touch a chaser's back while he has not seen you -> frozen in ice for 3 s
    let hint = "";
    for (const c of chasers) {
      if (c.stun || c.carryLock) continue;
      const fresh = 3 + 5 * LVL.smart - 1.0; // ai.mem is refilled every frame he sees his target
      for (const r of ents) {
        if (
          r.role !== "runner" ||
          !r.alive ||
          r.stun ||
          r.hidden ||
          r.seat != null
        )
          continue;
        const dx = r.pos.x - c.pos.x,
          dz = r.pos.z - c.pos.z,
          d = hyp(dx, dz);
        if (d > 7 || Math.abs(r.pos.y - c.pos.y) > 1.3) continue;
        const behind = dx * Math.sin(c.yaw) + dz * Math.cos(c.yaw) < -0.25 * d; // in the 150° arc behind him
        const aware = c.isPlayer ? false : c.ai.tgt === r && c.ai.mem > fresh; // looked at you within the last second
        const quiet = r.stance >= 1 || r.moving < 5.5; // crouching, prone or walking — not sprinting
        if (r.isPlayer && behind && !aware && d > 1.75)
          hint =
            c.freezeImm > 0
              ? `🧊 ${c.name} cannot be frozen again for ${Math.ceil(c.freezeImm)}s`
              : quiet
                ? `🤫 ${c.name} has not noticed you — touch his back to FREEZE him`
                : `🤫 ${c.name} has not noticed you — CROUCH or walk (running is too loud), then touch his back`;
        if (d > 1.75 || !behind || aware || !quiet || c.freezeImm > 0) continue;
        if (c.carry) dropCarried(c);
        c.stun = { type: "freeze", t: 3 };
        c.freezeImm = 15;
        c.atk = null;
        c.charge = null;
        c.kx = c.kz = 0;
        c.wx = c.wz = 0;
        if (c.ai) {
          c.ai.tgt = null;
          c.ai.mem = 0;
          c.ai.path = null;
        }
        popText("FROZEN!", c.pos.x, c.pos.y + 2.9, c.pos.z, "#9fe0ff", 1.3);
        puff(c.pos.x, c.pos.y + 1.2, c.pos.z, 0x9fe0ff, 22, 4);
        sndAt(c, { f: 900, slide: 500, d: 0.35, type: "triangle", v: 0.25 });
        msg(`🥶 ${r.name} sneaked up behind ${c.name} — frozen for 3 seconds!`);
        if (c.hum)
          statusTo(c, "🥶 Someone touched you from behind — FROZEN for 3s!", 4);
        if (r.isPlayer) {
          hint = "";
          setStatus("🥶 Got him! He is frozen for 5 seconds — RUN", 2.5);
        }
        break;
      }
    }
    if (hint && statusT > 900) setStatus(hint, 0.3);
    for (const c of chasers) {
      // the ice block and its countdown
      const fz = c.stun && c.stun.type === "freeze";
      if (fz && !c.ice) {
        const m = new THREE.Mesh(
          BOX,
          new THREE.MeshLambertMaterial({
            color: 0xa8e4ff,
            transparent: true,
            opacity: 0.5,
            depthWrite: false,
          }),
        );
        m.scale.set(1.25, 2.15, 1.25);
        m.position.y = 1.08;
        c.v.g.add(m);
        c.ice = m;
      }
      if (c.ice) {
        c.ice.visible = !!fz;
        if (fz) {
          c.iceT = (c.iceT || 0) - dt;
          if (c.iceT <= 0) {
            c.iceT = 1;
            popText(
              String(Math.ceil(c.stun.t)),
              c.pos.x,
              c.pos.y + 2.6,
              c.pos.z,
              "#d6f3ff",
              0.8,
            );
          }
          if (c.stun.t < 0.25 && !c.iceBroke) {
            c.iceBroke = true;
            puff(c.pos.x, c.pos.y + 1.1, c.pos.z, 0xd6f3ff, 18, 5);
          }
        } else {
          c.iceT = 0;
          c.iceBroke = false;
        }
      }
    }
  }
  for (const L of leaks) {
    const st = L.burnt ? "burnt" : L.dug ? "empty" : "fuel",
      near = hyp(camera.position.x - L.x, camera.position.z - L.z) < 20;
    if (hyp(player.pos.x - L.x, player.pos.z - L.z) < 16) L.known = st; // the map only updates once you have been there
    for (const k in L.tags) L.tags[k].visible = near && k === st;
    if (L.burnt && near) {
      L.smk = (L.smk || 0) - dt;
      if (L.smk <= 0) {
        L.smk = 0.5;
        puff(L.x, 0.3, L.z, 0x444444, 2, 1.2);
      }
    }
  }
  // digging: a runner with a shovel standing still on an oil leak digs up a fuel can
  for (const L of leaks) {
    if (L.dug) continue;
    const cz = chasers.find(
      (c) =>
        !c.stun &&
        !c.carry &&
        c.pos.y < 0.5 &&
        hyp(c.pos.x - L.x, c.pos.z - L.z) < 1.5,
    );
    if (cz) {
      if (cz.moving > 1) {
        if (cz.hum)
          statusTo(cz, "🔥 Fuel is buried here — stand still to BURN it", 0.3);
        continue;
      }
      L.burn = (L.burn || 0) + dt;
      L.puffT -= dt;
      if (L.puffT <= 0) {
        L.puffT = 0.3;
        puff(L.x, 0.3, L.z, 0xff7a1a, 6, 3);
      }
      if (cz.hum)
        statusTo(
          cz,
          `🔥 Burning the fuel… ${Math.min(99, Math.round((L.burn / 4) * 100))}%`,
          0.3,
        );
      if (L.burn >= 4) {
        L.dug = true;
        L.burnt = true;
        L.g.children.forEach((m) => {
          m.material = new THREE.MeshBasicMaterial({ color: 0x2a2a2a });
        });
        puff(L.x, 0.5, L.z, 0xff3b1a, 22, 5);
        popText("BURNED!", L.x, 2.4, L.z, "#ff7a1a", 1.1);
        msg(`🔥 ${cz.name} burned a buried fuel can!`);
        beep(140, 0.5, "sawtooth", 0.09, 200);
      }
      continue;
    }
    const e = ents.find(
      (r) =>
        r.role === "runner" &&
        r.alive &&
        !r.stun &&
        !r.hidden &&
        r.pos.y < 0.5 &&
        hyp(r.pos.x - L.x, r.pos.z - L.z) < 1.5,
    );
    if (!e) {
      L.dig = Math.max(0, L.dig - dt);
      continue;
    }
    if (!e.shovel) {
      if (e.hum)
        statusTo(
          e,
          "🛢 Oil is leaking here — a fuel can is buried! You need a SHOVEL to dig",
          0.3,
        );
      continue;
    }
    if (e.fuel) {
      if (e.hum) statusTo(e, "Deliver the can you are carrying first", 0.3);
      continue;
    }
    if (e.moving > 1) {
      if (e.hum) statusTo(e, "⛏ Stand still on the oil leak to dig", 0.3);
      continue;
    }
    if (L.dig < 1.2 && L.dig + dt >= 1.2 && !(L.noiseCd > clock)) {
      // the digging is loud: the nearest chaser hears it
      L.noiseCd = clock + 15;
      let c = null,
        bd = 80;
      for (const k of chasers) {
        const d = hyp(k.pos.x - L.x, k.pos.z - L.z);
        if (!k.carry && d < bd) {
          bd = d;
          c = k;
        }
      }
      if (c && !c.isPlayer) {
        c.ai.goPt = { x: L.x, z: L.z, t: 16 };
        c.ai.path = null;
      }
      if (player.role === "chaser") {
        msg(
          "⛏ You hear digging — someone is after the fuel! (flashing dot on the map)",
          "alarm",
        );
        L.ping = clock + 8;
      } else if (e.isPlayer)
        msg("⛏ Digging is loud — a chaser may have heard you");
    }
    L.dig += dt;
    e.digging = 0.2;
    e.tool = "shovel";
    L.puffT -= dt;
    if (L.puffT <= 0) {
      L.puffT = 0.45;
      puff(L.x, 0.2, L.z, 0x7a5533, 5, 2.5);
      if (e.isPlayer) beep(150, 0.06, "square", 0.04);
    }
    if (e.hum)
      statusTo(
        e,
        `⛏ Digging… ${Math.min(99, Math.round((L.dig / DIG_T) * 100))}%`,
        0.3,
      );
    if (L.dig >= DIG_T) {
      L.dug = true;
      L.g.children.forEach((m) => {
        m.material = new THREE.MeshBasicMaterial({ color: 0x3a2716 });
      });
      e.fuel = true;
      popText("FUEL!", L.x, 2.4, L.z, "#ffb020", 1.1);
      msg(`⛽ ${e.name} dug up a fuel can!`);
      beep(600, 0.25, "sine", 0.07, 300);
      if (e.hum)
        statusTo(
          e,
          "⛽ Got it! The can is heavy (you are slower and show on the chasers' map) — get it to the DOCK",
          5,
        );
    }
  }
  // fuel delivery + boat departure
  for (const e of ents)
    if (
      e.role === "runner" &&
      e.alive &&
      (e.fuel || e.wood || e.iron || e.sail) &&
      !shipGone
    ) {
      // the parts must be carried ABOARD, and fitting each one takes a moment
      const dry = (e.wood || 0) - (e.wet || 0),
        has = e.fuel || dry > 0 || e.iron || e.sail,
        near = hyp(e.pos.x - DOCK.x, e.pos.z - DOCK.z) < 11;
      if (!has || !onShip(e) || e.stun) {
        e.shipT = 0;
        if (e.hum && near && !e.stun)
          statusTo(
            e,
            has
              ? onShip(e)
                ? ""
                : "🛠 Carry it ABOARD the ship — step onto the deck to fit it"
              : "💧 Wet planks will not hold — dry them at a CAMPFIRE first (🔥 on the map)",
            0.4,
          );
        continue;
      }
      const kind =
          dry > 0 ? "wood" : e.iron ? "iron" : e.sail ? "sail" : "fuel",
        T = SHIP_T[kind];
      e.shipT = (e.shipT || 0) + dt;
      e.shipP = (e.shipP || 0) - dt;
      if (e.shipP <= 0) {
        e.shipP = 0.42;
        const hI = Math.min(
            SHIPFX.holes.length - 1,
            Math.floor((woodDone * SHIPFX.holes.length) / WOOD_NEED),
          ),
          hp =
            kind === "wood" && SHIPFX.holes[hI]
              ? SHIPFX.holes[hI].hole.position
              : null;
        puff(
          hp ? hp.x : e.pos.x + Math.sin(e.yaw) * 0.6,
          hp ? hp.y : 0.9,
          hp ? hp.z : e.pos.z + Math.cos(e.yaw) * 0.6,
          kind === "fuel" ? 0xffb020 : kind === "sail" ? 0xffffff : 0xdcb878,
          4,
          2,
        );
        sndAt(
          e,
          kind === "fuel"
            ? { f: 240, d: 0.12, type: "sine", v: 0.05, slide: 120 }
            : { f: 170, d: 0.05, type: "square", v: 0.06 },
        );
      }
      if (e.hum)
        statusTo(
          e,
          (kind === "wood"
            ? "🪵 Nailing a plank over a hole… "
            : kind === "iron"
              ? "🔩 Fitting the iron… "
              : kind === "sail"
                ? "⛵ Rigging the sail cloth… "
                : "⛽ Pouring fuel into the engine… ") +
            Math.min(99, Math.round((e.shipT / T) * 100)) +
            "%  (stay on the ship)",
          0.3,
        );
      if (e.shipT < T) continue;
      e.shipT = 0;
      beep(700, 0.3, "sine", 0.08, 300);
      if (kind === "wood") {
        woodDone = Math.min(WOOD_NEED, woodDone + 1);
        e.wood--;
        e.shipN = (e.shipN || 0) + 1;
        if (e.wood - (e.wet || 0) <= 0 || woodDone >= WOOD_NEED) {
          msg(
            `🪵 ${e.name} nailed ${e.shipN} plank${e.shipN > 1 ? "s" : ""} onto the ship (${woodDone}/${WOOD_NEED})`,
          );
          e.shipN = 0;
          if (woodDone >= WOOD_NEED) e.wood = e.wet || 0;
        }
      } else if (kind === "iron") {
        ironDone = Math.min(IRON_SHIP, ironDone + 1);
        e.iron--;
        if (ironDone >= IRON_SHIP) e.iron = 0;
        if (!e.iron)
          msg(
            `🔩 ${e.name} fitted iron into the ship (${ironDone}/${IRON_SHIP})`,
          );
      } else if (kind === "sail") {
        sailDone = Math.min(SAIL_NEED, sailDone + 1);
        e.sail = 0;
        msg(
          `⛵ ${e.name} rigged sail cloth on the ship (${sailDone}/${SAIL_NEED})`,
        );
      } else {
        e.fuel = false;
        fuelDone++;
        msg(
          `⛽ ${e.name} filled fuel into the engine (${Math.min(fuelDone, 3)}/3)`,
        );
      }
    }
  if (shipReady() && !readyTold) {
    readyTold = true;
    boatT = 25;
    msg(
      `🚤 The ship is rebuilt and fuelled! 60% of the runners (${NEED()}) must sit on it at the dock — it leaves in 25 seconds`,
      "alarm",
    );
    beep(880, 0.6, "square", 0.08);
  }
  updateShipFx();
  if (!shipReady()) updateChain(dt);
  if (shipReady()) {
    for (const e of ents)
      if (
        e.role === "runner" &&
        e.alive &&
        !e.stun &&
        e.seat == null &&
        !(e.seatCd > 0) &&
        onShip(e) &&
        !(CHAIN.on && e.axe && !e.isPlayer)
      ) {
        let k = -1,
          bd = 1e9;
        SEATS.forEach((S, i) => {
          const d = hyp(S.x - e.pos.x, S.z - e.pos.z);
          if (!S.occ && d < bd) {
            bd = d;
            k = i;
          }
        });
        if (k < 0) continue;
        SEATS[k].occ = e;
        e.seat = k;
        e.stance = 0;
        const n = SEATS.filter((S) => S.occ).length;
        msg(`🚤 ${e.name} sat down on the ship (${n}/${NEED()})`);
        if (e.hum)
          statusTo(
            e,
            "🚤 You are aboard — waiting for the others (JUMP to stand up)",
            4,
          );
      }
    boatT -= dt;
    {
      const n = SEATS.filter((S) => S.occ).length;
      if (n >= NEED() && n >= freeRunners()) boatT = 0;
    } // every free runner is aboard: no need to wait
    updateChain(dt);
    if (boatT <= 0 && CHAIN.on) {
      boatT = 0.5;
      if (!CHAIN.told) {
        CHAIN.told = true;
        msg(
          "⛓ The ship cannot leave — it is CHAINED to the dock. A runner with an AXE must chop the chain",
          "alarm",
        );
      }
    } else if (boatT <= 0) {
      const esc = SEATS.filter((S) => S.occ).map((S) => S.occ);
      if (esc.length >= NEED()) endEscape(esc);
      else {
        boatT = 0.5;
        if (!shipWait) {
          shipWait = true;
          msg(
            `🚤 The ship is ready but only ${esc.length} of the ${NEED()} needed runners are seated — it waits`,
          );
        }
      }
    }
  }
  // disarm chaser traps by crouching next to them
  for (let i = traps.length - 1; i >= 0; i--) {
    const t = traps[i];
    if (t.sprung || t.owner !== "chaser") continue;
    const e = ents.find(
      (r) =>
        r.role === "runner" &&
        r.alive &&
        r.isPlayer &&
        r.stance >= 1 &&
        !r.stun &&
        !r.hidden &&
        hyp(r.pos.x - t.x, r.pos.z - t.z) < t.rad + 1.6,
    );
    if (!e) {
      t.dis = 0;
      continue;
    }
    t.dis = (t.dis || 0) + dt;
    setStatus(
      `🛠 Disarming the ${TRAP_N[t.type]}… ${Math.min(99, Math.round((t.dis / 1.8) * 100))}%  (stay crouched)`,
      0.3,
    );
    if (t.dis >= 1.8) {
      scene.remove(t.g);
      traps.splice(i, 1);
      e.kit.push(t.type);
      puff(t.x, 0.3, t.z, 0x35c8ff, 10, 3);
      beep(600, 0.2, "triangle", 0.07, 300);
      msg(`🛠 ${e.name} disarmed a ${TRAP_N[t.type]} — and stole it!`);
      setStatus(
        `You stole the ${TRAP_N[t.type]}! Press F to set it for the chaser`,
        3.5,
      );
    }
  }
  // hint
  const p = player;
  if (
    p.alive &&
    p.role === "runner" &&
    !p.hidden &&
    !p.stun &&
    statusT > 900 &&
    spots.some(
      (s) =>
        !s.occ &&
        hyp(s.x - p.pos.x, s.z - p.pos.z) < 2.2 &&
        Math.abs(p.pos.y) < 1,
    )
  )
    setStatus("Press H to hide here", 0.25);
}
function updateChain(dt) {
  if (shipGone) return;
  const A = CHAIN,
    near = (e) =>
      e.alive &&
      !e.stun &&
      !e.hidden &&
      e.pos.y > -0.2 &&
      e.pos.y < 1.2 &&
      hyp(e.pos.x - A.x, e.pos.z - A.z) < 2.6;
  if (!A.on) {
    const c = chasers.find((c) => c.chain && !c.carry && near(c));
    if (!c) {
      A.fix = Math.max(0, A.fix - dt);
      if (player.chain && statusT > 900)
        setStatus(
          "⛓ You carry the chain — take it to the far END OF THE DOCK (east shore)",
          0.3,
        );
      return;
    }
    A.fix += dt;
    A.hitT -= dt;
    if (A.hitT <= 0) {
      A.hitT = 0.5;
      puff(A.x, 0.9, A.z, 0x8a919b, 5, 2);
      sndAt(A, { f: 190, d: 0.07, type: "square", v: 0.05 });
    }
    if (c.hum)
      statusTo(
        c,
        `⛓ Locking the chain… ${Math.min(99, Math.round((A.fix / FIX_T) * 100))}%  (stay here)`,
        0.3,
      );
    if (A.fix >= FIX_T) {
      c.chain = false;
      A.on = true;
      A.fix = 0;
      A.chop = 0;
      A.told = false;
      A.g.visible = true;
      puff(A.x, 1, A.z, 0xffc21a, 18, 4);
      popText("CHAINED!", A.x, 2.8, A.z, "#ffd23f", 1.2);
      msg(
        player.role === "chaser"
          ? `⛓ ${c.name} chained the ship to the dock — it cannot leave until a runner chops the chain`
          : `⛓ ${c.name} CHAINED the ship! It cannot leave — find an AXE inside a building and chop the chain at the end of the dock`,
        "alarm",
      );
      beep(120, 0.6, "sawtooth", 0.08, 90);
    }
    return;
  }
  const e =
    ents.find(
      (r) => r.role === "runner" && r.seat == null && r.axe && near(r),
    ) || ents.find((r) => r.role === "runner" && r.seat == null && near(r));
  if (!e) return;
  if (!e.axe) {
    if (e.hum)
      statusTo(
        e,
        "⛓ A heavy chain locks the ship — you need an AXE (look inside the buildings)",
        0.3,
      );
    return;
  }
  if (e.moving > 1) {
    if (e.hum)
      statusTo(e, "🪓 Stand still by the bollard to chop the chain", 0.3);
    return;
  }
  if (!(A.noiseCd > clock)) {
    // chopping rings across the island
    A.noiseCd = clock + 12;
    A.ping = clock + 8;
    chasers
      .filter((k) => !k.isPlayer && !k.carry && !k.stun)
      .sort(
        (a, b) =>
          hyp(a.pos.x - A.x, a.pos.z - A.z) - hyp(b.pos.x - A.x, b.pos.z - A.z),
      )
      .slice(0, 2)
      .forEach((k) => {
        k.ai.chainGo = 18;
        k.ai.path = null;
      });
    if (player.role === "chaser")
      msg(
        "🪓 Someone is chopping the chain at the dock! (flashing dot on the map)",
        "alarm",
      );
    else if (e.isPlayer) msg("🪓 Chopping is loud — the chasers are coming");
  }
  A.chop += dt;
  e.digging = 0.2;
  e.tool = "axe";
  A.hitT -= dt;
  if (A.hitT <= 0) {
    A.hitT = 0.55;
    puff(A.x, 0.9, A.z, 0xffd27a, 7, 3.5);
    sndAt(A, { f: 520, d: 0.05, type: "square", v: 0.06, slide: 260 });
    if (e.isPlayer) shake = 0.08;
  }
  if (e.hum)
    statusTo(
      e,
      `🪓 Chopping the chain… ${Math.min(99, Math.round((A.chop / CHOP_T) * 100))}%`,
      0.3,
    );
  if (A.chop >= CHOP_T) {
    A.on = false;
    A.chop = 0;
    A.g.visible = false;
    A.told = false;
    shipWait = false;
    puff(A.x, 1, A.z, 0xc8ced6, 26, 5);
    popText("CHAIN BROKEN!", A.x, 2.8, A.z, "#7fe3ff", 1.2);
    msg(`🪓 ${e.name} chopped the chain — the ship is free again!`, "alarm");
    beep(700, 0.35, "triangle", 0.08, 1100);
    for (const k of chasers) if (k.ai) k.ai.chainGo = 0;
  }
}
function updateShipFx() {
  if (shipGone) return;
  const ready = shipReady(),
    key = `${ready ? "R" : ""}${woodDone}|${ironDone}|${fuelDone}|${sailDone}`;
  if (SHIPFX.sail)
    SHIPFX.sail.forEach((m, i) => {
      m.visible = SHIPFX.sailS[i].visible = i >= 3 - sailDone;
    });
  if (key === SHIPFX.key) return;
  SHIPFX.key = key;
  {
    const wn = Math.floor((woodDone * SHIPFX.holes.length) / WOOD_NEED),
      inn = Math.floor((ironDone * SHIPFX.iron.length) / IRON_SHIP);
    SHIPFX.holes.forEach((h, i) => {
      h.hole.visible = i >= wn;
      h.patch.visible = i < wn;
    });
    SHIPFX.iron.forEach((m, i) => {
      m.visible = i < inn;
    });
  }
  if (SHIPFX.sign) {
    scene.remove(SHIPFX.sign);
    SHIPFX.sign.material.map.dispose();
    SHIPFX.sign.material.dispose();
  }
  const tick = (a, b) => (a >= b ? "✅" : `${a}/${b}`);
  const t = textSprite(
    ready
      ? "🚤 SHIP REPAIRED — get aboard and sit down!"
      : `🛠 WRECKED SHIP needs:  🪵 planks ${tick(woodDone, WOOD_NEED)}   🔩 iron ${tick(ironDone, IRON_SHIP)}   ⛵ sail ${tick(sailDone, SAIL_NEED)}   ⛽ fuel ${tick(fuelDone, 3)}`,
    ready ? "#7dffa0" : "#ffd23f",
    40,
    "rgba(15,20,28,.88)",
  );
  t.scale.set(0.62 * t.userData.aspect, 0.62, 1);
  t.position.set(SHIP.x - 1, 4.6, SHIP.z);
  scene.add(t);
  SHIPFX.sign = t;
}
function hudExtras(p) {
  const q = (a) => document.querySelector(`#btns [data-a=${a}]`),
    set = (el, text, off) => {
      if (el.firstChild.textContent !== text) el.firstChild.textContent = text;
      el.classList.toggle("off", !!off);
    };
  if (p.role === "chaser") {
    set(
      q("roar"),
      p.roarCd > 0 ? `ROAR ${Math.ceil(p.roarCd)}s` : "ROAR",
      p.roarCd > 0,
    );
    set(
      q("charge"),
      p.chargeCd > 0 ? `CHARGE ${Math.ceil(p.chargeCd)}s` : "CHARGE",
      p.chargeCd > 0,
    );
  } else {
    for (const k of RITEMS)
      set(q(k), `${k.toUpperCase()} ×${p.inv[k]}`, !p.inv[k]);
    set(q("hide"), p.hidden ? "COME OUT" : "HIDE", false);
    if (!p.held && p.kit.length)
      set(
        $("bthrow"),
        `SET ${p.kit[p.kit.length - 1].toUpperCase()} ×${p.kit.length}`,
        false,
      );
  }
  {
    const car =
      (p.wood ? ` 🪵×${p.wood}` : "") +
      (p.iron ? ` 🔩×${p.iron}` : "") +
      (p.fuel ? " ⛽" : "");
    $("left").innerHTML +=
      (shipGone
        ? "<br>Ship: 🌊 swept away — raft on the shore"
        : `<br>Ship: 🪵 <b>${woodDone}</b>/${WOOD_NEED} · 🔩 <b>${ironDone}</b>/${IRON_SHIP} · ⛽ <b>${Math.min(3, fuelDone)}</b>/3`) +
      (car ? ` <b style="color:#ffd23f">(carrying${car})</b>` : "");
  }
  $("left").innerHTML +=
    (p.role === "chaser"
      ? p.chain
        ? ' · <b style="color:#ffd23f">⛓ carrying chain</b>'
        : chainsMade >= 3
          ? ""
          : ` · ⛓ parts <b>${ironN}</b>/${IRON_NEED}`
      : p.axe
        ? " · 🪓"
        : "") +
    (CHAIN.on ? ' · <b style="color:#ff8a80">⛓ ship chained</b>' : "");
  {
    // clean HUD: small labelled chips under the timer, plus one short line only when something special is going on
    const isCh = p.role === "chaser",
      need = NEED(),
      alive = ents.filter((e) => e.role === "runner" && e.alive).length;
    const chip = (cap, ic, txt, cls = "") =>
        `<span class="chip ${cls}"><small>${cap}</small><span>${ic} <b>${txt}</b></span></span>`,
      sep = "<i></i>";
    let c = chip(
        "FREE",
        "🏃",
        `${alive}/${nRunners}`,
        phase === "game" && alive < need ? "bad" : "",
      ),
      o = "";
    if (phase === "game" && FIN.on) {
      const ab = raftCrew().length;
      c =
        chip(
          "ALIVE",
          "🏃",
          `${alive}/${nRunners}`,
          alive < FIN.need ? "bad" : "",
        ) +
        sep +
        chip(
          "ON THE RAFT",
          "🛟",
          `${ab}/${RSEAT.length}`,
          ab >= FIN.need ? "ok" : "warn",
        ) +
        chip("WATER", "🐊", "deadly", "bad");
      o = RAFT.go
        ? isCh
          ? '<b style="color:#ffd23f">🛟 Raft away</b> — swim after it and throw <b>everyone</b> off'
          : p.raft != null
            ? p.rcap
              ? '<b style="color:#ffd23f">🛟 You steer</b> — out to sea, away from the chasers'
              : '<b style="color:#ffd23f">🛟 Rowing</b> — hold on'
            : "The raft left without you"
        : isCh
          ? "Knock them off the posts — <b>one</b> runner on the raft is enough for them"
          : FIN.cast > 0
            ? '<b style="color:#ffd23f">🛟 Casting off in ' +
              Math.max(0, Math.ceil(CAST_T - FIN.cast)) +
              "s</b>"
            : p.raft != null
              ? "Waiting for <b>" + Math.max(0, FIN.need - ab) + "</b> more"
              : "Jump post to post to the <b>raft</b> — not through the water";
    } else if (phase === "game") {
      if (!shipGone && !noShip)
        c +=
          sep +
          chip(
            "PLANKS",
            "🪵",
            `${woodDone}/${WOOD_NEED}`,
            woodDone >= WOOD_NEED ? "ok" : "",
          ) +
          chip(
            "IRON",
            "🔩",
            `${ironDone}/${IRON_SHIP}`,
            ironDone >= IRON_SHIP ? "ok" : "",
          ) +
          chip(
            "SAIL",
            "⛵",
            `${sailDone}/${SAIL_NEED}`,
            sailDone >= SAIL_NEED ? "ok" : "",
          ) +
          chip(
            "FUEL",
            "⛽",
            `${Math.min(3, fuelDone)}/3`,
            fuelDone >= 3 ? "ok" : "",
          );
      else
        c +=
          sep + chip(shipGone ? "SHIP GONE" : "NO FUEL", "🛟", "raft", "warn");
      const el = ROUND_TIME - roundT;
      if (!shipGone) {
        if (el < TIDE_START)
          c += sep + chip("TIDE RISES IN", "🌊", fmt(TIDE_START - el));
        else if (shipGoneT)
          c +=
            sep +
            chip(
              "SHIP SWEPT IN",
              "🌊",
              fmt(Math.max(0, shipGoneT - el)),
              "bad",
            );
      }
      if (stormK > 0) c += chip("STORM", "⛈", "slippery", "warn");
      if (CHAIN.on)
        o =
          '<b style="color:#ff8a80">⛓ Ship chained</b> — ' +
          (isCh
            ? "guard the bollard at the end of the dock"
            : p.axe
              ? "chop the chain at the end of the dock"
              : "find an axe in a building") +
          (shipReady()
            ? ` · ${SEATS.filter((S) => S.occ).length}/${need} seated`
            : "");
      else if (shipReady()) {
        const ab = SEATS.filter((S) => S.occ).length;
        o =
          `<b style="color:#ffd23f">🚤 Ship ready</b> — <b>${ab}/${need}</b> seated · ` +
          (shipWait
            ? `waiting for <b>${Math.max(0, need - ab)}</b> more`
            : `leaves in <b>${Math.ceil(boatT)}s</b>`) +
          (isCh ? " — stop them!" : "");
      } else if (noShip)
        o = isCh
          ? "Catch runners before the flood — then keep them off the <b>raft</b>"
          : "Stay free until the flood — then get to the <b>raft</b>";
    }
    if (isCh)
      c +=
        sep +
        chip("TRAPS", "🪤", trapBudget, trapBudget ? "" : "bad") +
        (chainsMade >= 3
          ? ""
          : chip("CHAIN PARTS", "⛓", `${ironN}/${IRON_NEED}`));
    const car =
      (p.wood ? ` 🪵×${p.wood}` + (p.wet ? ` 💧${p.wet} wet` : "") : "") +
      (p.iron ? ` 🔩×${p.iron}` : "") +
      (p.sail ? " ⛵" : "") +
      (p.fuel ? " ⛽" : "") +
      (p.chain ? " ⛓" : "") +
      (p.axe ? " 🪓" : "");
    if (!FIN.on && phase === "game" && roundT <= 60)
      c +=
        sep +
        chip(
          "RAFT",
          "🛟",
          `${raftCrew().length}/${RSEAT.length}`,
          raftCrew().length >= RSEAT.length ? "ok" : "warn",
        );
    if (car && !FIN.on) c += sep + chip("CARRYING", "", car.trim(), "warn");
    if (NET.on && NET.ping != null)
      c +=
        sep +
        chip(
          "PING",
          "",
          Math.round(NET.ping) + " ms",
          NET.ping > 250 ? "bad" : NET.ping > 120 ? "warn" : "ok",
        );
    if ($("chips")._h !== c) {
      $("chips")._h = c;
      $("chips").innerHTML = c;
    }
    if ($("obj")._h !== o) {
      $("obj")._h = o;
      $("obj").innerHTML = o;
    }
  }
}
function mapExtras(dot, p, isCh) {
  mctx.fillStyle = "#ffb020";
  mctx.fillRect(mp(DOCK.x) - 3, mp(DOCK.z) - 2, 9, 4);
  mctx.fillStyle = "#4a4a55";
  mctx.fillRect(mp(JAIL.x) - 4, mp(JAIL.z) - 4, 8, 8);
  mctx.strokeStyle = "#ff8a80";
  mctx.lineWidth = 1;
  mctx.strokeRect(mp(JAIL.x) - 4, mp(JAIL.z) - 4, 8, 8);
  for (const r of JAIL.slots)
    if (r)
      dot(
        r.pos.x,
        r.pos.z,
        r.healed && Math.sin(clock * 8) > 0 ? "#ffd23f" : "#999",
        2.2,
      );
  if (!isCh) {
    for (const t of traps)
      if (t.owner === "runner") dot(t.x, t.z, "#35c8ff", 2);
  }
  for (const e of ents)
    if (e.fuel && e !== p) dot(e.pos.x, e.pos.z, "#ff7a1a", 3.2); // a fuel carrier is visible to everyone
  for (const L of leaks)
    if (L.ping > clock && Math.sin(clock * 10) > 0)
      dot(L.x, L.z, "#ff2d2d", 4.5);
  {
    const r0 = Math.abs(mp(tideR) - mp(0)),
      r1 = Math.abs(mp(R_ISLAND) - mp(0)),
      jx = mp(JAIL.x),
      jz = mp(JAIL.z);
    mctx.save();
    mctx.beginPath();
    mctx.arc(mp(0), mp(0), r1, 0, 7);
    mctx.clip();
    mctx.fillStyle = "rgba(47,134,201,.6)";
    mctx.beginPath();
    mctx.rect(0, 0, mctx.canvas.width, mctx.canvas.height);
    mctx.arc(jx, jz, r0, 0, 6.2832, true);
    mctx.fill("evenodd");
    mctx.strokeStyle = "rgba(255,255,255,.8)";
    mctx.lineWidth = 1;
    mctx.beginPath();
    mctx.arc(jx, jz, r0, 0, 7);
    mctx.stroke();
    mctx.restore();
    if (JAIL.life) dot(JAIL.life.x, JAIL.life.z, "#ff7a1a", 2.6);
  }
  for (const b of boats) dot(b.x, b.z, "#7a4a26", 2);
  for (const F of FIRES)
    if (F.lit) {
      const hot = F.ping > clock && Math.sin(clock * 10) > 0;
      if (!isCh || hot) {
        dot(F.x, F.z, "#2a1206", 3.4);
        dot(F.x, F.z, hot ? "#ff2d2d" : "#ff9a2e", 2.3);
      }
    }
  if (FIN.on || shipGone || noShip)
    for (const q of COURSE) dot(q.x, q.z, "#ffd23f", 1.3);
  {
    dot(RAFT.x, RAFT.z, "#111", 4.4);
    dot(
      RAFT.x,
      RAFT.z,
      FIN.on && Math.sin(clock * 8) > 0 ? "#fff" : "#ff7a1a",
      3.1,
    );
  }
  if (MT.on) {
    mctx.fillStyle = "#fff";
    mctx.font = "9px sans-serif";
    mctx.textAlign = "center";
    mctx.fillText("⛰", mp(MT.x), mp(MT.z) + 3);
    if (!MT.taken) dot(MT.x, MT.z, clock % 1 < 0.5 ? "#ffe14d" : "#fff", 2.2);
  }
  for (const c of crocs) {
    dot(c.x, c.z, "#0d2b0d", 3.4);
    dot(c.x, c.z, "#63d14a", 2.2);
  }
  if (CHAIN.on) {
    dot(CHAIN.x, CHAIN.z, "#111", 4.2);
    dot(
      CHAIN.x,
      CHAIN.z,
      CHAIN.ping > clock && Math.sin(clock * 10) > 0 ? "#ff2d2d" : "#ffd23f",
      2.8,
    );
  }
  for (const it of items)
    if (it.type === "wood" && !isCh && hyp(it.x - p.pos.x, it.z - p.pos.z) < 50)
      dot(it.x, it.z, it.wet ? "#5aa9e6" : "#c48a4a", 2.2);
  for (const it of items)
    if (
      it.type === "iron" ||
      ((it.type === "axe" || it.type === "sail") && !isCh)
    ) {
      if (hyp(it.x - p.pos.x, it.z - p.pos.z) < 30)
        dot(
          it.x,
          it.z,
          it.type === "iron"
            ? "#ff7a7a"
            : it.type === "sail"
              ? "#ffffff"
              : "#7fe3ff",
          2.4,
        );
    }
  for (const L of leaks) {
    const X = mp(L.x),
      Z = mp(L.z);
    if (L.known === "fuel") {
      dot(L.x, L.z, "#1a1a1a", 3.6);
      dot(L.x, L.z, "#ffb020", 2.4);
    } else if (L.known === "burnt") {
      mctx.strokeStyle = "#ff3b30";
      mctx.lineWidth = 1.8;
      mctx.beginPath();
      mctx.moveTo(X - 3, Z - 3);
      mctx.lineTo(X + 3, Z + 3);
      mctx.moveTo(X + 3, Z - 3);
      mctx.lineTo(X - 3, Z + 3);
      mctx.stroke();
    } else {
      mctx.strokeStyle = "#9aa3ab";
      mctx.lineWidth = 1.3;
      mctx.beginPath();
      mctx.arc(X, Z, 2.6, 0, 7);
      mctx.stroke();
    }
  }
}
/* ================= capture: beaten down -> carried -> tied at the prison -> rescue ================= */
const JAIL = { x: 0, z: 22, y: 1.6, slots: [], life: null };
const NEED = () => Math.ceil(nRunners * 0.6);
const freeRunners = () =>
  ents.filter((e) => e.role === "runner" && e.alive).length;
let noShip = false;
function buildJail() {
  search: for (let r = 0; r <= 80; r += 3)
    for (let a = 0; a < 6.28; a += 0.3) {
      const x = Math.cos(a) * r,
        z = 22 + Math.sin(a) * r;
      if (
        hyp(x, z) > R_GRASS - 15 ||
        colliders.some(
          (b) =>
            !b.nonav &&
            x + 11 > b.x0 &&
            x - 11 < b.x1 &&
            z + 11 > b.z0 &&
            z - 11 < b.z1 &&
            b.y0 < 3 &&
            b.y1 > 0,
        ) ||
        riverDist(x, z) < 12 ||
        hyp(x, z - 8) < 14 ||
        hyp(x - LOBBY.x, z - LOBBY.z) < LOBBY.r + 14
      )
        continue;
      JAIL.x = x;
      JAIL.z = z;
      break search;
    }
  const { x, z } = JAIL,
    Y = JAIL.y;
  addBox(x, 0, z, 11, Y, 11, 0x5a544c);
  addBox(x, Y - 0.3, z, 11.25, 0.16, 11.25, 0x6e675d, false);
  for (const [sx, sz] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ])
    for (let k = 1; k <= 7; k++) {
      // a staircase on every side (low steps so walking up is smooth)
      const o = 5.5 + 0.2 + (k - 1) * 0.4 + 0.004 * k;
      addBox(
        x + sx * o,
        0,
        z + sz * o,
        sx ? 0.4 : 3.2 - k * 0.012,
        Y - k * 0.2,
        sx ? 3.2 - k * 0.012 : 0.4,
        k % 2 ? 0x8a8378 : 0x9b9488,
      );
    }
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * 6.283;
    addBox(
      x + Math.cos(a) * 4,
      Y,
      z + Math.sin(a) * 4,
      0.25,
      2.5,
      0.25,
      0x4a3a28,
      false,
    );
  }
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    addBox(x + sx * 5.3, Y, z + sz * 5.3, 0.4, 3.2, 0.4, 0x3a3f4a, false);
    addBox(x + sx * 5.3, Y + 3.2, z + sz * 5.3, 0.6, 0.3, 0.6, 0xc9302c, false);
  }
  addBox(x, Y, z, 1.2, 0.5, 1.2, 0x3a3f4a, false);
  const sign = textSprite("⛓ PRISON", "#ff8a80", 44, "rgba(20,20,25,.85)");
  sign.scale.set(0.7 * sign.userData.aspect, 0.7, 1);
  sign.position.set(x, Y + 4.1, z);
  scene.add(sign);
  // parkour: crates, pillars and planks around the prison — the last things above water when the island floods
  const cols = [0x8a5a2b, 0x7d7468, 0x9a7446, 0x6d6459];
  let n = 0;
  const pill = (px, pz, w, h) => {
    if (
      hit(px, 0, pz, w / 2 + 0.9, 4) ||
      riverDist(px, pz) < 3 ||
      hyp(px, pz) > R_GRASS - 6 ||
      hyp(px - LOBBY.x, pz - LOBBY.z) < LOBBY.r + 3.5
    )
      return false;
    addBox(px, 0, pz, w, h, w, cols[n++ % 4]);
    addBox(px, h, pz, w + 0.15, 0.08, w + 0.15, 0xd8c9a0, false);
    return true;
  };
  for (let k = 0; k < 8; k++) {
    const a = Math.PI / 8 + (k * Math.PI) / 4;
    pill(
      x + Math.cos(a) * 11.2,
      z + Math.sin(a) * 11.2,
      1.7,
      k % 2 ? 1.2 : 2.0,
    );
  }
  for (let k = 0; k < 12; k++) {
    const a = (k * Math.PI) / 6 + 0.26;
    pill(
      x + Math.cos(a) * 15.6,
      z + Math.sin(a) * 15.6,
      1.5,
      [0.9, 1.7, 2.5][k % 3],
    );
  }
  for (let k = 0; k < 14; k++) {
    const a = (k * Math.PI) / 7 + 0.1;
    pill(
      x + Math.cos(a) * 20.6,
      z + Math.sin(a) * 20.6,
      1.4,
      [1.3, 2.1, 0.9, 2.9][k % 4],
    );
  }
  for (let k = 0; k < 16; k++) {
    const a = (k * Math.PI) / 8 + 0.2;
    pill(
      x + Math.cos(a) * 26,
      z + Math.sin(a) * 26,
      1.6,
      [1.0, 1.8, 2.6, 1.4][k % 4],
    );
  }
  // the lifeboat: last way out, floats off when the island is under water
  if (0)
    for (const [sx, sz] of [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ]) {
      const bx = x + sx * 8.0,
        bz = z + sz * 8.0;
      if (hit(bx, 0, bz, 2.4, 3)) continue;
      const g = new THREE.Group(),
        mk = (w, h, d, c, px, py, pz) => {
          const m = new THREE.Mesh(BOX, mat(c));
          m.scale.set(w, h, d);
          m.position.set(px, py, pz);
          m.castShadow = true;
          g.add(m);
        };
      mk(4.2, 0.5, 1.7, 0xe8632c, 0, 0.45, 0);
      mk(4.4, 0.16, 1.9, 0xffffff, 0, 0.74, 0);
      mk(0.9, 0.42, 1.2, 0xe8632c, 2.5, 0.5, 0);
      mk(0.5, 0.34, 0.7, 0xe8632c, 3.1, 0.55, 0);
      mk(0.5, 0.1, 1.6, 0xb08a55, -1, 0.72, 0);
      mk(0.5, 0.1, 1.6, 0xb08a55, 0.6, 0.72, 0);
      mk(0.5, 0.3, 3.0, 0x4a3a28, -1.3, 0.1, 0);
      mk(0.5, 0.3, 3.0, 0x4a3a28, 1.3, 0.1, 0);
      g.position.set(bx, 0, bz);
      g.rotation.y = Math.atan2(sx, sz);
      scene.add(g);
      const t = textSprite(
        "🛟 LIFEBOAT — floats off when the island is flooded",
        "#ffd23f",
        38,
        "rgba(15,20,28,.85)",
      );
      t.scale.set(0.45 * t.userData.aspect, 0.45, 1);
      t.position.set(bx, 2.6, bz);
      scene.add(t);
      JAIL.life = { x: bx, z: bz, g, t };
      break;
    }
}
function jailTo(e, dt, x, z) {
  // reach a point on the raised prison: path to the nearest staircase, then straight up it
  const dx = e.pos.x - JAIL.x,
    dz = e.pos.z - JAIL.z,
    ax = Math.abs(dx),
    az = Math.abs(dz);
  if (ax < 5.6 && az < 5.6 && e.pos.y > JAIL.y - 0.5) {
    moveTo(e, x, z);
    return;
  }
  const sx = ax > az ? Math.sign(dx) || 1 : 0,
    sz = sx ? 0 : Math.sign(dz) || 1,
    lat = sx ? az : ax,
    lon = sx ? ax : az;
  if (lat < 1.25 && lon < 11.2) {
    e.run = true;
    if (e.stance) setStance(e, 0);
    moveTo(e, JAIL.x + sx * 4.4, JAIL.z + sz * 4.4);
    return;
  }
  navTo(e, JAIL.x + sx * 10.2, JAIL.z + sz * 10.2, dt);
}
function navTo(e, x, z, dt) {
  const ai = e.ai;
  if (nav[cellOf(z) * N + cellOf(x)] && hyp(x - e.pos.x, z - e.pos.z) < 18) {
    moveTo(e, x, z);
    stuckCheck(e, dt);
    return;
  } // target is off the path grid (in the sea, on the pier): go straight
  if (!ai.path || !ai.goal || hyp(ai.goal.x - x, ai.goal.z - z) > 1.5)
    goTo(e, x, z);
  if (!follow(e)) moveTo(e, x, z);
  stuckCheck(e, dt);
}
function pickUp(c, r) {
  c.carry = r;
  r.cap = "carried";
  r.by = c;
  r.claim = null;
  r.claimT = 0;
  msg(`💪 ${c.name} is carrying ${r.name} to the prison`);
  if (r.hum) statusTo(r, "💫 You are being carried to the prison…", 3);
}
function dropCarried(c) {
  const r = c.carry;
  c.carry = null;
  if (!r) return;
  r.cap = "down";
  r.by = null;
  r.capT = 0;
  r.pos.set(c.pos.x, c.pos.y, c.pos.z);
  r.vy = 0;
  msg(`${c.name} dropped ${r.name}!`);
}
function tieUp(c) {
  const r = c.carry;
  c.carry = null;
  let i = JAIL.slots.findIndex((s) => !s);
  if (i < 0) i = JAIL.slots.length;
  if (i > 13) i = 13;
  const a = (i / 14) * 6.283;
  JAIL.slots[i] = r;
  r.slot = i;
  r.cap = "tied";
  r.by = null;
  r.capT = 0;
  r.healed = false;
  r.resc = 0;
  r.pos.set(JAIL.x + Math.cos(a) * 3.6, JAIL.y, JAIL.z + Math.sin(a) * 3.6);
  r.yaw = Math.atan2(-Math.cos(a), -Math.sin(a));
  r.vy = 0;
  msg(`⛓ ${c.name} tied ${r.name} up at the prison`);
  beep(180, 0.3, "square", 0.07, -60);
}
function freeCaptive(r, by) {
  JAIL.slots[r.slot] = null;
  r.cap = null;
  r.alive = true;
  r.hp = Math.max(r.hp, 60);
  r.stun = null;
  r.healed = false;
  r.resc = 0;
  r.ai.alert = 8;
  r.ai.path = null;
  r.ai.hideGo = null;
  r.stance = 0;
  popText("FREE!", r.pos.x, 2.8, r.pos.z, "#6fe08a", 1.2);
  msg(`🔓 ${by.name} rescued ${r.name}!`);
  beep(700, 0.3, "sine", 0.08, 300);
  say(r, THANKS);
  if (r.hum) statusTo(r, "🔓 You are FREE — run!", 3);
}
function cough(e) {
  unhide(e);
  e.hideCd = 6;
  e.revealT = 5;
  popText("*cough!*", e.pos.x, e.pos.y + 2.5, e.pos.z, "#ffffff", 1);
  msg(`🤧 ${e.name} coughed and gave the hiding spot away!`);
  beep(240, 0.18, "sawtooth", 0.08, -120);
  if (e.hum)
    statusTo(e, "🤧 You coughed — you can only hide for 10 seconds!", 2.5);
  for (const c of chasers)
    if (
      !c.isPlayer &&
      !c.carry &&
      hyp(c.pos.x - e.pos.x, c.pos.z - e.pos.z) < 45
    ) {
      c.ai.tgt = e;
      c.ai.mem = 4;
      c.ai.last = { x: e.pos.x, z: e.pos.z };
      c.ai.path = null;
    }
}
function doSearch(e, dt) {
  // walk to a hiding spot and kick it
  const ai = e.ai,
    s = ai.search,
    d = hyp(s.x - e.pos.x, s.z - e.pos.z);
  ai.searchT = (ai.searchT || 0) + dt;
  e.run = true;
  if (ai.searchT > 12) {
    ai.search = null;
    return false;
  }
  if (d < 2) {
    e.yaw = Math.atan2(s.x - e.pos.x, s.z - e.pos.z);
    e.wx = e.wz = 0;
    if (!e.atk && e.cd <= 0) {
      startAttack(e, "kick");
      ai.search = null;
      ai.path = null;
    }
    return true;
  }
  navTo(e, s.x, s.z, dt);
  return true;
}
function chaserCapture(e, dt, tgt) {
  // bot chaser: carry, fetch downed runners, guard the prison. returns true when it took over the movement
  const ai = e.ai;
  if (e.carry) {
    e.run = true;
    ai.search = null;
    jailTo(e, dt, JAIL.x, JAIL.z);
    return true;
  }
  let dn = null,
    bd = 60;
  for (const r of ents)
    if (
      r.cap === "down" &&
      (!r.claim ||
        r.claim === e ||
        r.claim.stun ||
        r.claim.carry ||
        r.claim.isPlayer)
    ) {
      const d = hyp(r.pos.x - e.pos.x, r.pos.z - e.pos.z);
      if (d < bd) {
        bd = d;
        dn = r;
      }
    }
  if (dn) {
    dn.claim = e;
    dn.claimT = (dn.claimT || 0) + dt;
    e.run = true;
    if (
      (bd < 2.6 && dn.claimT > 3) ||
      (dn.claimT > 14 && bd < 12) ||
      dn.claimT > 28
    )
      pickUp(e, dn); // reach up to a roof / down into water if needed
    else navTo(e, dn.pos.x, dn.pos.z, dt);
    return true;
  }
  if (ai.search && ai.search.known && ai.search.occ) return doSearch(e, dt); // he SAW you climb in
  if (ai.goPt) {
    // heard digging
    const G = ai.goPt;
    G.t -= dt;
    if (
      G.t <= 0 ||
      hyp(e.pos.x - G.x, e.pos.z - G.z) < 4 ||
      (tgt && isPrey(tgt))
    )
      ai.goPt = null;
    else {
      e.run = true;
      navTo(e, G.x, G.z, dt);
      return true;
    }
  }
  if (
    shipReady() &&
    SEATS.some((S) => S.occ) &&
    !(
      tgt &&
      isPrey(tgt) &&
      tgt.seat == null &&
      hyp(tgt.pos.x - e.pos.x, tgt.pos.z - e.pos.z) < 8
    )
  ) {
    // storm the ship
    e.run = true;
    const onPier = e.pos.x > 116 && Math.abs(e.pos.z - DOCK.z) < 6.5;
    if (!onPier && !onShip(e)) {
      navTo(e, DOCKGO.x, DOCKGO.z, dt);
      return true;
    }
    let r = null,
      bd = 1e9;
    for (const S of SEATS)
      if (S.occ) {
        const d = hyp(S.x - e.pos.x, S.z - e.pos.z);
        if (d < bd) {
          bd = d;
          r = S.occ;
        }
      }
    if (bd > 1.7) {
      if (e.pos.x < 130.5 && !onShip(e)) moveTo(e, 131.5, DOCK.z);
      else moveTo(e, r.pos.x, r.pos.z);
      return true;
    }
    e.wx = e.wz = 0;
    e.yaw = Math.atan2(r.pos.x - e.pos.x, r.pos.z - e.pos.z);
    if (!(e.pushCd > 0)) shoveOff(e, r);
    else if (!e.atk && e.cd <= 0) startAttack(e, "punch");
    return true;
  }
  if (ai.alarm > 0) {
    // answering the prison alarm
    ai.alarm -= dt;
    const dj = hyp(e.pos.x - JAIL.x, e.pos.z - JAIL.z);
    if (
      (tgt &&
        isPrey(tgt) &&
        hyp(tgt.pos.x - e.pos.x, tgt.pos.z - e.pos.z) < 14) ||
      dj < 5
    )
      ai.alarm = 0;
    else {
      e.run = true;
      jailTo(e, dt, JAIL.x, JAIL.z);
      return true;
    }
  }
  if (ai.guard && JAIL.slots.some(Boolean)) {
    if (tgt && isPrey(tgt) && hyp(tgt.pos.x - JAIL.x, tgt.pos.z - JAIL.z) < 22)
      return false; // chase off rescuers
    ai.tgt = null;
    ai.ga = (ai.ga || 0) + dt * 0.22;
    const far = hyp(e.pos.x - JAIL.x, e.pos.z - JAIL.z) > 12;
    e.run = far;
    navTo(e, JAIL.x + Math.cos(ai.ga) * 7, JAIL.z + Math.sin(ai.ga) * 7, dt);
    return true;
  }
  return null;
}
function updateCaptives(dt) {
  for (const c of chasers) {
    if (c.carry) {
      if (c.stun && c.stun.type !== "stagger") dropCarried(c);
      else if (
        hyp(c.pos.x - JAIL.x, c.pos.z - JAIL.z) < 4.6 &&
        Math.abs(c.pos.y - JAIL.y) < 0.6
      )
        tieUp(c);
      else if (c.hum)
        statusTo(
          c,
          "💪 Carry them to the PRISON (grey square on the map)",
          0.3,
        );
    } else if (!c.stun)
      for (const r of ents)
        if (
          r.cap === "down" &&
          r.capT > 0.8 &&
          hyp(r.pos.x - c.pos.x, r.pos.z - c.pos.z) < 1.5 &&
          Math.abs(r.pos.y - c.pos.y) < 1.6
        ) {
          pickUp(c, r);
          break;
        }
  }
  for (const r of ents) {
    if (!r.cap) continue;
    r.capT += dt;
    if (r.cap === "out") {
      if (r.hum)
        statusTo(r, "🌊 The flood took you — you can only watch now", 0.3);
      continue;
    }
    if (r.cap === "down" && r.hum)
      statusTo(
        r,
        "💫 You are beaten down — a chaser will carry you to the prison",
        0.3,
      );
    if (r.cap !== "tied") continue;
    if (r.capT < 30) {
      if (r.hum)
        statusTo(
          r,
          `⛓ Tied up — teammates can rescue you in ${Math.ceil(30 - r.capT)}s`,
          0.3,
        );
      continue;
    }
    if (!r.healed) {
      r.healed = true;
      r.hp = 60;
      popText("HELP!", r.pos.x, 3, r.pos.z, "#ffd23f", 1.1);
      msg(`🆘 ${r.name} has recovered — untie them at the prison!`);
    }
    const h = ents.find(
      (o) =>
        o.role === "runner" &&
        o.alive &&
        !o.stun &&
        !o.hidden &&
        hyp(o.pos.x - r.pos.x, o.pos.z - r.pos.z) < 1.9 &&
        Math.abs(o.pos.y - r.pos.y) < 1.5,
    );
    if (h && !(r.alarmCd > 0)) {
      // the chasers get an alarm the moment someone starts on the ropes
      r.alarmCd = 12;
      msg(`🚨 ALARM — ${h.name} is untying ${r.name} at the prison!`, "alarm");
      if (player.role === "chaser")
        setStatus("🚨 A runner is freeing a prisoner — get to the PRISON!", 4);
      const bots = chasers
        .filter((c) => !c.isPlayer && !c.carry)
        .sort(
          (a, b) =>
            hyp(a.pos.x - JAIL.x, a.pos.z - JAIL.z) -
            hyp(b.pos.x - JAIL.x, b.pos.z - JAIL.z),
        );
      bots.slice(0, chasers.length > 3 ? 2 : 1).forEach((c) => {
        c.ai.alarm = 14;
        c.ai.path = null;
      });
    }
    if (r.alarmCd > 0) r.alarmCd -= dt;
    if (h) {
      r.resc += dt;
      if (h.hum)
        statusTo(
          h,
          `🔓 Untying ${r.name}… ${Math.min(99, Math.round((r.resc / 2.5) * 100))}%  (stay close)`,
          0.3,
        );
      if (r.hum) statusTo(r, `🔓 ${h.name} is untying you…`, 0.3);
      if (r.resc >= 2.5) freeCaptive(r, h);
    } else {
      r.resc = Math.max(0, r.resc - dt);
      if (r.hum) statusTo(r, "🆘 Waiting for a teammate to untie you…", 0.3);
    }
  }
  // is the ship still possible?
  if (!noShip && fuelDone < 3) {
    const left =
      fuelDone +
      leaks.filter((L) => !L.dug).length +
      items.filter((i) => i.type === "fuel").length +
      ents.filter((e) => e.fuel).length;
    if (left < 3) {
      noShip = true;
      msg(
        player.role === "chaser"
          ? "🔥 All the fuel is gone — the ship can never leave. Catch EVERY runner before the island floods, or they make for the raft"
          : "🔥 All the fuel is gone — the ship can never leave. Stay free until the island floods: the RAFT on the far shore is the last way out",
        "alarm",
      );
    }
  }
}
function showEnd(title, text) {
  phase = "end";
  $("pause").classList.add("hide");
  if (document.exitPointerLock) document.exitPointerLock();
  $("endt").textContent = title;
  $("endp").textContent = text;
  setTimeout(() => $("end").classList.remove("hide"), 1200);
}
function endRescue() {
  if (NET.guest && !NET.endOk) return;
  if (NET.host) netEnd("r");
  // 0:00 — only the prison is above water; the lifeboat floats off with every runner who is still free
  const free = ents.filter((e) => e.role === "runner" && e.alive),
    isCh = player.role === "chaser";
  if (JAIL.life) {
    JAIL.life.g.position.y = 0.25;
  }
  musPlay(!isCh && player.alive ? "victory" : "defeat");
  showEnd(
    "🛟 THE LIFEBOAT GOT AWAY — RUNNERS WIN",
    `The island is under water. ${free.map((e) => e.name).join(", ")} ${free.length > 1 ? "were" : "was"} still free and escaped on the lifeboat.` +
      (isCh
        ? " You had to catch them all — you lose."
        : player.alive
          ? " You win! 🎉"
          : " Your team wins — but you stayed tied up."),
  );
}
/* ================= background sound: surf + a light island tune (all generated, no files) ================= */
const SNDV = { ocean: 0.7, rain: 0.7, notif: 0.7, music: 0.8, voice: 0.8 };
try {
  Object.assign(SNDV, JSON.parse(localStorage.getItem("ic_snd") || "{}"));
} catch (e) {}
const BGM = {
  on: true,
  started: false,
  master: null,
  ocean: null,
  oceanLp: null,
  rain: null,
};
/* ---- music tracks (public/music/): menu loop, in-game loop, one-shot victory / defeat ---- */
const MUS = { cur: "", a: {} };
function musMake(name, loop, vol) {
  const probe = document.createElement("audio"),
    ogg = probe.canPlayType && probe.canPlayType('audio/ogg; codecs="vorbis"');
  const a = new Audio(`music/${name}.${ogg ? "ogg" : "mp3"}`);
  a.loop = loop;
  a.preload = "auto";
  a._v = vol;
  a.volume = vol * SNDV.music;
  MUS.a[name] = a;
}
musMake("menu", true, 0.5);
musMake("ingame", true, 0.42);
musMake("victory", false, 0.7);
musMake("defeat", false, 0.7);
/* ---- YOUR hit sound: replace public/music/hit.mp3 with your own file (keep the name hit.mp3,
   or delete hit.mp3 and use hit.ogg / hit.wav instead). Plays when a chaser beats a runner. ---- */
const HIT = {
  a: new Audio(),
  i: 0,
  last: 0,
  files: ["music/hit.mp3", "music/hit.ogg", "music/hit.wav"],
};
HIT.a.preload = "auto";
HIT.a.addEventListener("error", () => {
  HIT.i++;
  if (HIT.i < HIT.files.length) {
    HIT.a.src = HIT.files[HIT.i];
    HIT.a.load();
  }
});
HIT.a.src = HIT.files[0];
function voiceFile(name) {
  const v = {
    a: new Audio(),
    i: 0,
    files: [`music/${name}.mp3`, `music/${name}.ogg`, `music/${name}.wav`],
  };
  v.a.preload = "auto";
  v.a.addEventListener("error", () => {
    v.i++;
    if (v.i < v.files.length) {
      v.a.src = v.files[v.i];
      v.a.load();
    }
  });
  v.a.src = v.files[0];
  return v;
}
/* ---- more of YOUR voice files (same deal: replace the .mp3 in public/music/, or use .ogg/.wav):
   thanks.mp3 = a rescued runner thanks their rescuer - comehere.mp3 = a chaser who has been
   chasing for 4+ seconds shouts it every 4 s - jiggle.mp3 = you wiggling the stick / mashing jump ---- */
const THANKS = voiceFile("thanks"),
  COME = voiceFile("comehere"),
  JIG = voiceFile("jiggle");
const SLIP = voiceFile("slip"),
  HAH = voiceFile("hah"); // slip.mp3 = anyone slips - hah.mp3 = the chaser laughs when he catches a runner
function say(e, v, vol = 1) {
  const ok = playVoiceAt(v.a, e, vol);
  const d = v.a.duration;
  e.sayT = isFinite(d) && d > 0 ? Math.min(4, d) : 1.2;
  return ok;
}
/* ---- the beat loop: your hit.mp3 (3-4 s) keeps looping while a runner is being beaten ---- */
const BEAT = { e: null, last: 0 };
function playHit(r) {
  if (!BGM.on || !r) return;
  BEAT.e = r;
  BEAT.last = performance.now();
}
function loopNodes(v) {
  if (v._ln || !actx || !actx.createMediaElementSource) return;
  try {
    v._src = actx.createMediaElementSource(v.a);
    v._gain = actx.createGain();
    v._gain.gain.value = 0;
    if (actx.createStereoPanner) {
      v._pan = actx.createStereoPanner();
      v._gain.connect(v._pan);
      v._pan.connect(actx.destination);
    } else v._gain.connect(actx.destination);
    v._src.connect(v._gain);
    v._ln = true;
  } catch (e) {}
}
function loopPlay(v, e, vol) {
  if (!BGM.on || !e) return;
  v.a.loop = true;
  loopNodes(v);
  const sx = e.pos ? e.pos.x : e.x,
    sz = e.pos ? e.pos.z : e.z,
    dx = camera.position.x - sx,
    dz = camera.position.z - sz,
    dist = hyp(dx, dz),
    near = e === player;
  const att = near ? 1 : 1 / (1 + (dist / 16) * (dist / 16));
  if (att < 0.03) {
    loopStop(v);
    return;
  }
  let dop = 1;
  if (!near && dist > 1) {
    const sv = velOf(e.pos ? e : null),
      lv = velOf(player),
      vr = ((sv[0] - lv[0]) * dx + (sv[1] - lv[1]) * dz) / dist;
    dop = clamp(1 + vr / SND_C, 0.7, 1.45);
  }
  v.a.playbackRate = dop;
  v.a.preservesPitch = false;
  const vv = Math.min(1, att * vol * (SNDV.voice != null ? SNDV.voice : 0.8));
  if (v._gain) {
    v._gain.gain.value = vv;
    if (v._pan)
      v._pan.pan.value = near
        ? 0
        : clamp(
            (-dx * Math.cos(camYaw) + dz * Math.sin(camYaw)) /
              Math.max(dist, 4),
            -1,
            1,
          ) * 0.9;
  } else v.a.volume = vv;
  if (v.a.paused) {
    const pr = v.a.play();
    if (pr && pr.catch) pr.catch(() => {});
  }
}
function loopStop(v, reset) {
  if (!v.a.paused) v.a.pause();
  if (reset)
    try {
      v.a.currentTime = 0;
    } catch (e) {}
  if (v._gain) v._gain.gain.value = 0;
}
function beatTick() {
  const v = HIT;
  if (!BEAT.e || (phase !== "game" && phase !== "lobby")) {
    loopStop(v);
    return;
  }
  const e = BEAT.e,
    age = performance.now() - BEAT.last;
  const near = chasers.some(
    (c) =>
      c.alive &&
      hyp(c.pos.x - e.pos.x, c.pos.z - e.pos.z) < 2.9 &&
      Math.abs(c.pos.y - e.pos.y) < 2.2,
  );
  if (age > 1100 || (!near && age > 300)) {
    BEAT.e = null;
    loopStop(v);
    return;
  } // the beating stopped: the sound stops at once
  loopPlay(v, e, 0.95);
}
function chaseTick(dt) {
  // only a LONG chase: 8 s of closing in on the same runner, then "come here" every 4 s
  if (phase !== "game") return;
  for (const c of chasers) {
    if (!c.alive || c.stun) {
      c.chaseT = 0;
      continue;
    }
    let best =
        c.ai &&
        c.ai.tgt &&
        c.ai.tgt.role === "runner" &&
        c.ai.tgt.alive &&
        !c.ai.tgt.cap
          ? c.ai.tgt
          : null,
      bd = best ? hyp(best.pos.x - c.pos.x, best.pos.z - c.pos.z) : 1e9;
    if (!best)
      for (const r of ents)
        if (r.role === "runner" && r.alive && !r.cap && r.raft == null) {
          const d = hyp(r.pos.x - c.pos.x, r.pos.z - c.pos.z);
          if (d < bd) {
            bd = d;
            best = r;
          }
        }
    let toward = false;
    if (best && bd > 0.5) {
      const sv = velOf(c);
      toward =
        (sv[0] * (best.pos.x - c.pos.x) + sv[1] * (best.pos.z - c.pos.z)) / bd >
        1.5;
    }
    if (best && bd < 14 && bd > 2.0 && c.moving > 4.2 && toward) {
      c.chaseT = (c.chaseT || 0) + dt;
      c.chaseOff = 0;
      c.comeT = (c.comeT || 0) - dt;
      if (c.chaseT >= 8 && c.comeT <= 0) {
        say(c, COME);
        c.comeT = 4;
      }
    } else {
      c.chaseOff = (c.chaseOff || 0) + dt;
      if (c.chaseOff > 0.75) c.chaseT = 0;
      c.comeT = 0;
    }
  }
}
const JIGS = { dir: 0, rev: [], lastRev: 0 };
function jigTick() {
  // ONLY continuous left-right wiggling: the sound starts, stops 1 s after you let go, and restarts from the beginning
  const v = JIG,
    p = player;
  if (!p || phase !== "game" || p.role !== "runner") {
    loopStop(v, true);
    return;
  }
  const now = performance.now();
  const dir =
      (keys.KeyD || keys.ArrowRight ? 1 : 0) -
      (keys.KeyA || keys.ArrowLeft ? 1 : 0) +
      joy.x,
    sg = dir > 0.3 ? 1 : dir < -0.3 ? -1 : 0;
  if (sg) {
    if (JIGS.dir && sg !== JIGS.dir) {
      JIGS.rev.push(now);
      JIGS.lastRev = now;
    }
    JIGS.dir = sg;
  } // neutral frames between the two keys must not wipe the last direction
  while (JIGS.rev.length && now - JIGS.rev[0] > 3000) JIGS.rev.shift();
  if (JIGS.rev.length >= 3 && now - JIGS.lastRev < 1000) loopPlay(v, p, 0.8);
  else loopStop(v, true);
}
/* ---- YOUR "help me" sound: replace public/music/help.mp3 with your own file (keep the name
   help.mp3, or delete help.mp3 and use help.ogg / help.wav). A trapped or imprisoned runner
   calls it every few seconds; it is positional - distance, stereo pan and Doppler pitch. ---- */
const HELP = {
  a: new Audio(),
  i: 0,
  last: 0,
  files: ["music/help.mp3", "music/help.ogg", "music/help.wav"],
};
HELP.a.preload = "auto";
HELP.a.addEventListener("error", () => {
  HELP.i++;
  if (HELP.i < HELP.files.length) {
    HELP.a.src = HELP.files[HELP.i];
    HELP.a.load();
  }
});
HELP.a.src = HELP.files[0];
function playVoiceAt(base, e, vol) {
  // play a voice file as if it comes from entity e
  if (!BGM.on || !e) return false;
  const sx = e.pos ? e.pos.x : e.x,
    sz = e.pos ? e.pos.z : e.z,
    dx = camera.position.x - sx,
    dz = camera.position.z - sz,
    dist = hyp(dx, dz),
    near = e === player;
  const att = near ? 1 : 1 / (1 + (dist / 16) * (dist / 16));
  if (att < 0.03) return false;
  let dop = 1; // Doppler: pitch rises while the runner (or you) close in, falls as you separate
  if (!near && dist > 1) {
    const sv = velOf(e.pos ? e : null),
      lv = velOf(player),
      vr = ((sv[0] - lv[0]) * dx + (sv[1] - lv[1]) * dz) / dist;
    dop = clamp(1 + vr / SND_C, 0.7, 1.45);
  }
  try {
    const s = base.cloneNode();
    s.playbackRate = dop;
    s.preservesPitch = false;
    s.webkitPreservesPitch = false;
    const v = Math.min(1, att * vol * (SNDV.voice != null ? SNDV.voice : 0.8));
    if (actx && actx.createMediaElementSource) {
      if (actx.state === "suspended") actx.resume();
      const src = actx.createMediaElementSource(s),
        g = actx.createGain();
      g.gain.value = v;
      let out = g;
      if (actx.createStereoPanner && !near) {
        const pn = actx.createStereoPanner();
        pn.pan.value =
          clamp(
            (-dx * Math.cos(camYaw) + dz * Math.sin(camYaw)) /
              Math.max(dist, 4),
            -1,
            1,
          ) * 0.9;
        g.connect(pn);
        out = pn;
      }
      src.connect(g);
      out.connect(actx.destination);
      s.addEventListener("ended", () => {
        try {
          src.disconnect();
          g.disconnect();
        } catch (err) {}
      });
    } else s.volume = v;
    const pr = s.play();
    if (pr && pr.catch) pr.catch(() => {});
    return true;
  } catch (err) {
    return false;
  }
}
function helpTick(dt) {
  // trapped (net / pit / bear trap / hanging) or down, carried or tied in the prison: the runner calls for help
  if (phase !== "game") return;
  for (const e of ents) {
    if (e.role !== "runner" || e.role === "decoy") continue;
    const caught =
      e.cap === "carried" ||
      e.cap === "down" ||
      (e.cap === "tied" && e.capT >= 30) ||
      (e.stun &&
        (e.stun.type === "net" ||
          e.stun.type === "pit" ||
          e.stun.type === "bear" ||
          e.stun.type === "hang"));
    if (
      !caught ||
      (!e.alive && e.cap !== "down" && e.cap !== "tied" && e.cap !== "carried")
    ) {
      e.helpT = 0;
      continue;
    }
    e.helpT = (e.helpT || 0) - dt;
    if (e.helpT <= 0) {
      e.helpT = 3.5 + rnd(2.5);
      const now = performance.now();
      if (now - HELP.last < 1200) continue; // one call at a time
      if (playVoiceAt(HELP.a, e, 1)) HELP.last = now;
      if (hyp(camera.position.x - e.pos.x, camera.position.z - e.pos.z) < 45) {
        const d = HELP.a.duration;
        e.sayT = isFinite(d) && d > 0 ? Math.min(4, d) : 1.2;
        popText("HELP ME!", e.pos.x, e.pos.y + 2.6, e.pos.z, "#ffd23f", 1.1);
      }
    }
  }
}
function musApply() {
  for (const k in MUS.a) {
    const a = MUS.a[k];
    a.volume = a._v * (SNDV.music != null ? SNDV.music : 0.8);
    if (k !== MUS.cur && !a.paused) a.pause();
  }
  const a = MUS.a[MUS.cur];
  if (a && BGM.on && !paused && !document.hidden) {
    const pr = a.play();
    if (pr && pr.catch) pr.catch(() => {});
  }
}
function musPlay(k) {
  MUS.cur = k || "";
  const a = MUS.a[MUS.cur];
  if (a && !a.loop) a.currentTime = 0;
  musApply();
}
function musKick() {
  if (phase === "menu") musPlay("menu");
  else if (phase === "lobby" || phase === "game") musPlay("ingame");
}
addEventListener("visibilitychange", musApply);
function startBgm() {
  if (BGM.started) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === "suspended") actx.resume();
    BGM.started = true;
    const A = actx,
      M = (BGM.master = A.createGain());
    M.gain.value = BGM.on ? 1 : 0;
    M.connect(A.destination);
    const nb = A.createBuffer(1, A.sampleRate * 4, A.sampleRate),
      d = nb.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      last = (last + 0.03 * (Math.random() * 2 - 1)) / 1.03;
      d[i] = last * 3.2;
    }
    const noise = () => {
      const n = A.createBufferSource();
      n.buffer = nb;
      n.loop = true;
      n.start();
      return n;
    };
    {
      const lp = (BGM.oceanLp = A.createBiquadFilter());
      lp.type = "lowpass";
      lp.frequency.value = 520;
      const g = A.createGain();
      g.gain.value = 0.3;
      const lfo = A.createOscillator(),
        lg = A.createGain();
      lfo.frequency.value = 0.11;
      lg.gain.value = 0.2;
      lfo.connect(lg).connect(g.gain);
      lfo.start();
      const og = (BGM.ocean = A.createGain());
      og.gain.value = 0;
      noise().connect(lp).connect(g).connect(og).connect(M);
    } // surf: waves swell in and out
    {
      const bp = A.createBiquadFilter();
      bp.type = "highpass";
      bp.frequency.value = 900;
      const g = (BGM.rain = A.createGain());
      g.gain.value = 0;
      noise().connect(bp).connect(g).connect(M);
    } // rain, only in the storm
    setInterval(bgmTick, 120);
  } catch (e) {}
}
function waterDist() {
  // how far the listener is from the nearest sea / flood water
  if (phase === "menu" || !player) return 25;
  const x = camera.position.x,
    z = camera.position.z;
  let d = Math.max(0, R_GRASS - hyp(x, z));
  if (typeof tideR === "number" && phase !== "lobby")
    d = Math.min(d, Math.max(0, tideR - hyp(x - JAIL.x, z - JAIL.z)));
  return d;
}
function bgmTick() {
  if (!BGM.started || !actx) return;
  const t = actx.currentTime,
    quiet = !BGM.on || document.hidden || (paused && phase !== "menu");
  const d = waterDist(),
    k = 0.07 + 0.93 / (1 + (d / 22) * (d / 22)); // loud on the beach, a faint murmur in the middle of the island
  BGM.ocean.gain.setTargetAtTime(quiet ? 0 : SNDV.ocean * k * 0.9, t, 0.25);
  BGM.oceanLp.frequency.setTargetAtTime(260 + 900 / (1 + d / 18), t, 0.25); // far away only the low rumble is left
  BGM.rain.gain.setTargetAtTime(quiet ? 0 : 0.34 * stormK * SNDV.rain, t, 0.25);
}
function setSoundUi() {
  const b = $("sndbtn");
  if (b) b.textContent = BGM.on ? "🔊 Sound" : "🔇 Sound";
  for (const k of ["ocean", "rain", "notif", "music", "voice"]) {
    const r = $("sv_" + k);
    if (r) r.value = Math.round(SNDV[k] * 100);
  }
  const m = $("sv_mute");
  if (m) m.checked = !BGM.on;
}
function toggleSound() {
  BGM.on = !BGM.on;
  startBgm();
  if (BGM.master) BGM.master.gain.value = BGM.on ? 1 : 0;
  musApply();
  setSoundUi();
}
addEventListener("pointerdown", () => {
  startBgm();
  musKick();
});
addEventListener("keydown", (ev) => {
  if (ev.code === "KeyM" && document.activeElement.tagName !== "INPUT")
    toggleSound();
  else {
    startBgm();
    musKick();
  }
});
if ($("sndbtn")) {
  const stop = (ev) => ev.stopPropagation();
  $("sndbtn").addEventListener("click", (ev) => {
    stop(ev);
    $("sndpanel").classList.toggle("hide");
    if (document.exitPointerLock) document.exitPointerLock();
  });
  for (const n of [
    "pointerdown",
    "mousedown",
    "touchstart",
    "click",
    "keydown",
  ])
    $("sndpanel").addEventListener(n, stop);
  for (const k of ["ocean", "rain", "notif", "music", "voice"])
    $("sv_" + k).addEventListener("input", (ev) => {
      SNDV[k] = ev.target.value / 100;
      try {
        localStorage.setItem("ic_snd", JSON.stringify(SNDV));
      } catch (e) {}
      if (k === "notif") {
        chimeT = 0;
        chime();
      }
      if (k === "music") musApply();
    });
  $("sv_mute").addEventListener("change", () => toggleSound());
  setSoundUi();
}
/* ================= rising tide (the round timer) + storm in the second half ================= */
const TIDE1 = 9,
  TIDE_START = 270,
  TIDE_POW = 1.25;
let TIDE0 = 126,
  tideTold = false;
let tideR = TIDE0,
  stormK = 0,
  stormOn = false,
  boltT = 12,
  flashT = 0,
  tideWarn = 0;
const tideMesh = new THREE.Mesh(
  new THREE.RingGeometry(1, 60, 80, 1),
  new THREE.MeshLambertMaterial({
    color: 0x2f86c9,
    transparent: true,
    opacity: 0.8,
    side: THREE.DoubleSide,
    depthWrite: false,
  }),
);
tideMesh.rotation.x = -Math.PI / 2;
tideMesh.position.y = 0.11;
tideMesh.renderOrder = 2;
scene.add(tideMesh);
const foamMesh = new THREE.Mesh(
  new THREE.RingGeometry(1, 1.012, 80, 1),
  new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.75,
    side: THREE.DoubleSide,
    depthWrite: false,
  }),
);
foamMesh.rotation.x = -Math.PI / 2;
foamMesh.position.y = 0.13;
foamMesh.renderOrder = 3;
scene.add(foamMesh);

function floodDepth(x, z) {
  return hyp(x, z) > R_GRASS
    ? 0
    : Math.max(0, hyp(x - JAIL.x, z - JAIL.z) - tideR);
} // how far past the waterline (0 on dry land, on the dock and in the open sea)
function tideSlow(e) {
  if (e.pos.y > 0.4 || e.boat || e.zip || (FIN.on && e.role === "chaser"))
    return 1; // in the flood finale the chasers swim at full speed
  const d = floodDepth(e.pos.x, e.pos.z);
  return d <= 0 ? 1 : Math.max(0.5, 0.82 - d * 0.02);
}
const indoors = (x, z) =>
  interiors.some(
    (b) => Math.abs(x - b.x) < b.w / 2 && Math.abs(z - b.z) < b.d / 2,
  );
const RAIN_N = 1100,
  rainPos = new Float32Array(RAIN_N * 6),
  rainSeed = [];
for (let i = 0; i < RAIN_N; i++)
  rainSeed.push([
    Math.random() * 70 - 35,
    Math.random() * 34,
    Math.random() * 70 - 35,
    20 + Math.random() * 10,
  ]);
const rainGeo = new THREE.BufferGeometry();
rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
const rain = new THREE.LineSegments(
  rainGeo,
  new THREE.LineBasicMaterial({
    color: 0xcfe6f5,
    transparent: true,
    opacity: 0.55,
  }),
);
rain.frustumCulled = false;
rain.visible = false;
scene.add(rain);
const SKY0 = new THREE.Color(0x8fd0f5),
  SKY1 = new THREE.Color(0x56636e),
  FLASH = new THREE.Color(0xe8f2ff),
  skyC = new THREE.Color();
function thunder() {
  try {
    beep(70, 1.3, "sawtooth", 0.11, -35);
    setTimeout(() => beep(48, 1.6, "sawtooth", 0.08, -20), 180);
  } catch (e) {}
}
/* ---- thunder mountain: a spiral path to the top, monsters on the way, one lightning orb on the summit ---- */
const MT = {
  on: false,
  x: 0,
  z: 0,
  N: 84,
  sh: 0.25,
  r0: 14,
  r1: 3.6,
  R: 16.6,
  da: (Math.PI * 6) / 84,
  a0: 0,
  mons: [],
  taken: false,
  orb: null,
};
const mtP = (u) => {
  const k = clamp(u, -1.5, MT.N - 1),
    a = MT.a0 + k * MT.da,
    r = MT.r0 - ((MT.r0 - MT.r1) * k) / (MT.N - 1);
  return {
    x: MT.x + Math.cos(a) * r,
    z: MT.z + Math.sin(a) * r,
    y: Math.max(0, (Math.round(k) + 1) * MT.sh),
  };
};
const mtU = (e) => clamp(Math.round(e.pos.y / MT.sh) - 1, -1, MT.N);
function buildMountain() {
  const R = MT.R;
  let best = null,
    bn = 1e9;
  for (let ad = 0; ad < 360; ad += 2)
    for (const rc of [119, 122]) {
      // on the shore: half on the beach, half in the sea
      const x = Math.cos((ad * Math.PI) / 180) * rc,
        z = Math.sin((ad * Math.PI) / 180) * rc;
      if (
        riverDist(x, z) < R + 3 ||
        hyp(x - DOCK.x, z - DOCK.z) < R + 22 ||
        hyp(x - LOBBY.x, z - LOBBY.z) < R + 14 ||
        hyp(x - JAIL.x, z - JAIL.z) < R + 16
      )
        continue;
      const near = (a, c, m = 2) => hyp(a - x, c - z) < R + m;
      if (
        spots.some((s) => near(s.x, s.z)) ||
        tramps.some((t) => near(t.x0, t.z0, 4)) ||
        crawls.some((t) => near(t.x, t.z, 3)) ||
        zips.some((t) => near(t.ax, t.az, 3)) ||
        ladders.some((t) => near(t.x, t.z, 3)) ||
        towers.some((t) => near(t.x, t.z, 9)) ||
        boats.some((t) => near(t.x, t.z, 4))
      )
        continue;
      let n = 0,
        bad = false;
      for (const c of colliders)
        if (c.x1 > x - R && c.x0 < x + R && c.z1 > z - R && c.z0 < z + R) {
          n++;
          if (c.x1 - c.x0 > 4.2 || c.z1 - c.z0 > 4.2 || c.y1 > 4.5) {
            bad = true;
            break;
          }
        }
      if (bad) continue;
      if (n < bn) {
        bn = n;
        best = [x, z];
      }
    }
  if (!best) return;
  const [X, Z] = best;
  MT.x = X;
  MT.z = Z;
  MT.on = true;
  MT.a0 = Math.atan2(-Z, -X) + 0.25; // the path starts on the side facing the middle of the island
  // clear the few small things (trees, crates) standing there
  for (let i = colliders.length - 1; i >= 0; i--) {
    const c = colliders[i];
    if (c.x1 > X - R && c.x0 < X + R && c.z1 > Z - R && c.z0 < Z + R)
      colliders.splice(i, 1);
  }
  for (const m of scene.children)
    if (
      (m.isMesh || m.isGroup) &&
      m.position.y > -0.5 &&
      Math.abs(m.position.x - X) < R + 0.6 &&
      Math.abs(m.position.z - Z) < R + 0.6 &&
      Math.max(m.scale.x, m.scale.z) < 9 &&
      (m.position.x || m.position.z)
    )
      m.visible = false;
  const colAt = (h) =>
    h > 18
      ? 0xf2f6fa
      : h > 15.5
        ? 0xd9dfe5
        : h > 9
          ? Math.random() < 0.5
            ? 0x7d776e
            : 0x8a8479
          : h > 4
            ? Math.random() < 0.5
              ? 0x6f7a55
              : 0x7f7a66
            : Math.random() < 0.5
              ? 0x6b8f4e
              : 0x7a7364;
  for (let k = 0; k < MT.N; k++) {
    const a = MT.a0 + k * MT.da,
      r = MT.r0 - ((MT.r0 - MT.r1) * k) / (MT.N - 1),
      h = (k + 1) * MT.sh,
      w = clamp(r * MT.da + 0.55, 2.6, 3.8);
    const stepCol = colAt(h); // v51: both blocks of a step are level with each other, so they must share one colour or the path flickers
    addBox(
      X + Math.cos(a) * r,
      -1.3,
      Z + Math.sin(a) * r,
      w,
      h + 1.3,
      w,
      stepCol,
    );
    addBox(
      X + Math.cos(a) * (r - 1.7),
      -1.3,
      Z + Math.sin(a) * (r - 1.7),
      w,
      h + 1.297,
      w,
      stepCol,
    );
    if (k % 5 === 2 && k < MT.N - 6)
      addBox(
        X + Math.cos(a) * (r + w / 2 - 0.2),
        h,
        Z + Math.sin(a) * (r + w / 2 - 0.2),
        0.45,
        0.5 + srand() * 0.5,
        0.45,
        0x5b564e,
        false,
      ); // loose rocks on the outer edge
  }
  const top = MT.N * MT.sh;
  MT.top = top;
  addBox(X, -1.3, Z, 6.6, top + 1.3, 6.6, 0xf2f6fa);
  for (const [ox, oz, hh] of [
    [-2.3, -2.3, 1.6],
    [2.3, -2.2, 1.1],
    [-2.2, 2.3, 0.9],
  ])
    addBox(X + ox, top, Z + oz, 0.9, hh, 0.9, 0xcfd6dd); // snowy crags
  // the orb
  const g = new THREE.Group(),
    ym = new THREE.MeshBasicMaterial({ color: 0xffe14d }),
    mk = (w, h, d, px, py, rz) => {
      const m = new THREE.Mesh(BOX, ym);
      m.scale.set(w, h, d);
      m.position.set(px, py, 0);
      m.rotation.z = rz;
      g.add(m);
    };
  mk(0.22, 0.75, 0.12, 0.12, 0.38, -0.45);
  mk(0.5, 0.16, 0.12, 0, 0.05, 0);
  mk(0.22, 0.75, 0.12, -0.12, -0.3, -0.45);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.75, 0.06, 6, 20),
    new THREE.MeshBasicMaterial({ color: 0x9fe0ff }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -0.85;
  g.add(ring);
  g.position.set(X, top + 1.4, Z);
  scene.add(g);
  MT.orb = g;
  const lab = textSprite("⚡ LIGHTNING ORB", "#ffe14d");
  lab.position.set(X, top + 3, Z);
  scene.add(lab);
  MT.lab = lab;
  // monsters
  for (const u of [9, 20, 31, 42, 53, 64, 75]) {
    const m = new THREE.Group(),
      bx = (w, h, d, c, px, py, pz, par = m) => {
        const q = new THREE.Mesh(
          BOX,
          c === 1 ? new THREE.MeshBasicMaterial({ color: 0xff3020 }) : mat(c),
        );
        q.scale.set(w, h, d);
        q.position.set(px, py, pz);
        q.castShadow = true;
        par.add(q);
        return q;
      };
    bx(1.0, 1.0, 0.8, 0x4b2d6b, 0, 0.75, 0);
    bx(0.7, 0.55, 0.65, 0x5c3a82, 0, 1.5, 0.05);
    bx(0.14, 0.1, 0.05, 1, -0.17, 1.58, 0.39);
    bx(0.14, 0.1, 0.05, 1, 0.17, 1.58, 0.39);
    bx(0.4, 0.07, 0.05, 0x111111, 0, 1.36, 0.39);
    for (const sx of [-0.2, 0.2]) {
      bx(0.1, 0.14, 0.06, 0xffffff, sx * 0.6, 1.3, 0.4);
      bx(0.14, 0.3, 0.14, 0xd8d0c0, sx * 1.3, 1.9, 0);
      bx(0.34, 0.3, 0.4, 0x3a2254, sx * 1.2, 0.14, 0);
    }
    const arms = [-1, 1].map((sx) => {
      const A = new THREE.Group();
      A.position.set(sx * 0.68, 1.15, 0);
      m.add(A);
      bx(0.3, 0.9, 0.3, 0x5c3a82, 0, -0.4, 0, A);
      bx(0.38, 0.3, 0.38, 0x3a2254, 0, -0.9, 0, A);
      return A;
    });
    scene.add(m);
    MT.mons.push({
      u,
      home: u,
      g: m,
      arms,
      cd: 0,
      wind: 0,
      dir: 1,
      yaw: 0,
      fall: null,
      hp: 2,
      stag: 0,
    });
  }
}
function mtnNav(e, tgt, dt) {
  // bot chaser: walk the spiral towards the runner (or back down)
  const ai = e.ai,
    onIt = e.pos.y > 0.15 && hyp(e.pos.x - MT.x, e.pos.z - MT.z) < MT.R + 0.5;
  ai.path = null;
  ai.climbPt = null;
  e.run = true;
  if (!onIt) {
    const p0 = mtP(-1.4);
    if (hyp(p0.x - e.pos.x, p0.z - e.pos.z) > 1.2) navTo(e, p0.x, p0.z, dt);
    else {
      const p = mtP(0);
      moveTo(e, p.x, p.z);
    }
    return;
  }
  const u = mtU(e),
    tu = tgt ? mtU(tgt) : -1;
  if (tgt && Math.abs(tu - u) <= 1) {
    moveTo(e, tgt.pos.x, tgt.pos.z);
    return;
  }
  if (u >= MT.N - 1 && tu > u - 1) {
    moveTo(e, tgt ? tgt.pos.x : MT.x, tgt ? tgt.pos.z : MT.z);
    return;
  }
  const p = mtP(clamp(u + (tu > u ? 1.6 : -1.6), -1.4, MT.N - 1));
  moveTo(e, p.x, p.z);
}
function updateMountain(dt) {
  if (!MT.on) return;
  if (MT.orb.visible) {
    MT.orb.rotation.y += dt * 2.5;
    MT.orb.position.y = MT.top + 1.4 + Math.sin(clock * 3) * 0.15;
    for (const e of ents)
      if (
        e.role === "runner" &&
        e.alive &&
        !e.stun &&
        !e.cap &&
        Math.abs(e.pos.y - MT.top) < 1 &&
        hyp(e.pos.x - MT.x, e.pos.z - MT.z) < 1.6
      ) {
        MT.taken = true;
        MT.orb.visible = false;
        MT.lab.visible = false;
        e.bolt = true;
        puff(MT.x, MT.top + 1.3, MT.z, 0xffe14d, 24, 5);
        beep(880, 0.5, "triangle", 0.09, 900);
        msg(
          `⚡ ${e.name} took the LIGHTNING ORB from the mountain top!`,
          "alarm",
        );
        if (e.hum)
          statusTo(
            e,
            "⚡ LIGHTNING ORB! Press X (⚡ button) to freeze EVERY chaser for 3 s — one use only",
            6,
          );
        break;
      }
  }
  for (const e of ents)
    if (e.bolt && !e.isPlayer && e.alive && !e.stun) {
      const c = nearestChaser(e);
      if (c && hyp(c.pos.x - e.pos.x, c.pos.z - e.pos.z) < 5) useBolt(e);
    }
  const b = $("bbolt");
  if (b) b.classList.toggle("off", !(player && player.bolt));
  if (phase !== "game") {
    for (const m of MT.mons) {
      const p = mtP(m.u);
      m.g.position.set(p.x, p.y, p.z);
    }
    return;
  }
  const sp = MT.r0 * MT.da; // metres per step (roughly)
  for (const m of MT.mons) {
    if (m.fall) {
      const f = m.fall;
      f.t += dt; // shoved off the path: tumbles down the mountain, climbs back after a while
      if (f.t < 1.6) {
        f.vy -= 22 * dt;
        f.x += f.vx * dt;
        f.z += f.vz * dt;
        f.y = Math.max(f.gy, f.y + f.vy * dt);
        if (f.y <= f.gy && !f.hit) {
          f.hit = true;
          f.vx = f.vz = 0;
          puff(f.x, f.gy + 0.3, f.z, 0x9a8f80, 14, 4);
          sndAt(
            { x: f.x, z: f.z },
            { f: 70, d: 0.3, type: "square", v: 0.2, slide: -30 },
          );
        }
        m.g.position.set(f.x, f.y, f.z);
        m.g.rotation.x += dt * (f.hit ? 0 : 9);
        if (f.hit) m.g.rotation.x = Math.PI / 2;
      } else if (f.t > 8) {
        m.fall = null;
        m.hp = 2;
        m.u = m.home;
        m.g.rotation.x = 0;
        m.g.visible = true;
        m.cd = 1;
        const q = mtP(m.u);
        puff(q.x, q.y + 1, q.z, 0x5c3a82, 14, 3);
      } else if (f.t > 4) m.g.visible = false;
      continue;
    }
    if (m.stag > 0) {
      m.stag -= dt;
      m.wind = 0;
      m.g.rotation.z = m.stag > 0 ? Math.sin(clock * 22) * 0.16 : 0;
      continue;
    }
    m.cd -= dt;
    const p = mtP(m.u);
    let tgt = null,
      bd = 12;
    for (const r of ents) {
      if (r.role !== "runner" || !r.alive || r.cap) continue;
      const d = hyp(r.pos.x - p.x, r.pos.y - p.y, r.pos.z - p.z);
      if (d < bd && Math.abs(r.pos.y - p.y) < 1.7) {
        bd = d;
        tgt = r;
      }
    }
    let want = 0;
    if (tgt) {
      const tu = mtU(tgt);
      want = Math.sign(tu - m.u) * (Math.abs(tu - m.u) > 0.6 ? 1 : 0);
      if (tgt.isPlayer && statusT > 900 && bd < 7)
        setStatus(
          "👹 A mountain monster! shove it TWICE (G) or sprint past before it smashes you",
          0.4,
        );
    } else {
      if (Math.abs(m.u - m.home) > 3) m.dir = Math.sign(m.home - m.u);
      want = m.dir * 0.35;
    }
    if (m.wind > 0) {
      m.wind -= dt;
      want = 0;
      if (m.wind <= 0) {
        m.cd = 0.95;
        if (tgt && bd < 2.4) {
          const dx = tgt.pos.x - p.x,
            dz = tgt.pos.z - p.z,
            l = hyp(dx, dz) || 1;
          damage(tgt, 14, dx / l, dz / l, 13, "SMASH!");
          sndAt(tgt, { f: 90, d: 0.25, type: "square", v: 0.22, slide: -40 });
          if (tgt.isPlayer) shake = 0.4;
        }
      }
    } else if (tgt && bd < 2.1 && m.cd <= 0) {
      m.wind = 0.3;
      sndAt(p, { f: 160, d: 0.3, type: "sawtooth", v: 0.16, slide: 120 });
    }
    m.u = clamp(
      m.u + ((want * 3.8) / sp) * dt,
      Math.max(1, m.home - 9),
      Math.min(MT.N - 4, m.home + 9),
    );
    const q = mtP(m.u),
      q2 = mtP(m.u + 0.5 * (want < 0 ? -1 : 1));
    let ty = tgt
        ? Math.atan2(tgt.pos.x - q.x, tgt.pos.z - q.z)
        : Math.atan2(q2.x - q.x, q2.z - q.z),
      da = ty - m.yaw;
    while (da > Math.PI) da -= 6.283;
    while (da < -Math.PI) da += 6.283;
    m.yaw += da * Math.min(1, dt * 6);
    m.g.position.set(
      q.x,
      q.y + Math.abs(Math.sin(clock * 5 + m.home)) * 0.08,
      q.z,
    );
    m.g.rotation.y = m.yaw;
    const sw = Math.sin(clock * 5 + m.home) * 0.4;
    m.arms[0].rotation.x = m.wind > 0 ? -2.6 : sw;
    m.arms[1].rotation.x = m.wind > 0 ? -2.6 : -sw;
  }
}
function useBolt_(e) {
  // one use: lightning hits every chaser and freezes him for 3 seconds
  if (!e.bolt || !e.alive || phase !== "game") return;
  e.bolt = false;
  const wm = new THREE.MeshBasicMaterial({ color: 0xfff7b0 });
  for (const c of chasers) {
    if (c.carry) dropCarried(c);
    c.stun = { type: "freeze", t: 3 };
    c.atk = null;
    c.charge = null;
    c.kx = c.kz = 0;
    c.wx = c.wz = 0;
    if (c.ai) {
      c.ai.tgt = null;
      c.ai.mem = 0;
      c.ai.path = null;
    }
    const segs = [];
    let px = c.pos.x,
      py = c.pos.y + 1.5,
      pz = c.pos.z;
    for (let i = 0; i < 9; i++) {
      const nx = c.pos.x + rnd(-1.6, 1.6) * (i + 1) * 0.4,
        ny = py + 4.5,
        nz = c.pos.z + rnd(-1.6, 1.6) * (i + 1) * 0.4,
        len = hyp(nx - px, ny - py, nz - pz),
        m = new THREE.Mesh(BOX, wm);
      m.scale.set(0.22, 0.22, len);
      m.position.set((px + nx) / 2, (py + ny) / 2, (pz + nz) / 2);
      m.lookAt(nx, ny, nz);
      scene.add(m);
      segs.push(m);
      px = nx;
      py = ny;
      pz = nz;
    }
    fx.push({
      t: 0,
      life: 0.45,
      up(k) {
        for (const m of segs) m.visible = Math.random() < 0.75;
      },
      end() {
        for (const m of segs) scene.remove(m);
      },
    });
    popText("⚡ FROZEN!", c.pos.x, c.pos.y + 3, c.pos.z, "#ffe14d", 1.4);
    puff(c.pos.x, c.pos.y + 1.2, c.pos.z, 0xfff7b0, 26, 6);
  }
  let w = $("wflash");
  if (!w) {
    w = document.createElement("div");
    w.id = "wflash";
    w.style.cssText =
      "position:fixed;inset:0;background:#fff;pointer-events:none;z-index:9;opacity:0;transition:opacity .35s";
    document.body.appendChild(w);
  }
  w.style.transition = "none";
  w.style.opacity = 0.85;
  setTimeout(() => {
    w.style.transition = "opacity .5s";
    w.style.opacity = 0;
  }, 90);
  shake = 0.5;
  thunder();
  beep(1400, 0.25, "sawtooth", 0.1, -1200);
  msg(
    `⚡ ${e.name} called down LIGHTNING — every chaser is frozen for 3 seconds!`,
    "alarm",
  );
  setStatus(
    player.role === "chaser"
      ? "⚡ LIGHTNING! You are frozen for 3 seconds"
      : "⚡ LIGHTNING! Every chaser is frozen for 3 seconds — GO!",
    3,
  );
}
/* ---- crocodiles: they come in with the flood once half the island is under water ---- */
const crocs = [];
const crocWater = (x, z) => floodDepth(x, z) > 1.2 && !hit(x, 0, z, 0.6, 0.6);
function makeCroc(x, z, sea) {
  const g = new THREE.Group(),
    mk = (w, h, d, c, px, py, pz, par = g) => {
      const m = new THREE.Mesh(BOX, mat(c));
      m.scale.set(w, h, d);
      m.position.set(px, py, pz);
      m.castShadow = true;
      par.add(m);
      return m;
    };
  mk(0.75, 0.34, 2.1, 0x3f6b2e, 0, 0.12, 0);
  mk(0.6, 0.3, 0.8, 0x47772f, 0, 0.12, 1.35);
  mk(0.44, 0.14, 0.85, 0x47772f, 0, 0.1, 2.05);
  const jaw = new THREE.Group();
  jaw.position.set(0, 0.2, 1.6);
  g.add(jaw);
  mk(0.44, 0.1, 0.85, 0x3f6b2e, 0, 0.04, 0.45, jaw);
  for (let k = 0; k < 4; k++)
    for (const sx of [-0.19, 0.19])
      mk(0.05, 0.08, 0.05, 0xffffff, sx, -0.03, 0.15 + k * 0.2, jaw);
  for (const sx of [-0.2, 0.2]) {
    mk(0.14, 0.14, 0.14, 0x47772f, sx, 0.34, 1.5);
    mk(0.07, 0.07, 0.04, 0xffe14d, sx, 0.35, 1.58);
  }
  for (let k = 0; k < 5; k++)
    mk(0.16, 0.12, 0.2, 0x2f5222, 0, 0.34, -0.8 + k * 0.42);
  const tail = new THREE.Group();
  tail.position.set(0, 0.12, -1.05);
  g.add(tail);
  mk(0.5, 0.26, 0.9, 0x3f6b2e, 0, 0, -0.45, tail);
  mk(0.28, 0.2, 0.9, 0x355c27, 0, 0, -1.3, tail);
  g.position.set(x, -0.08, z);
  scene.add(g);
  return {
    x,
    z,
    yaw: rnd(6.283),
    g,
    jaw,
    tail,
    biteCd: 0,
    tgt: null,
    wx: x,
    wz: z,
    think: 0,
    sea: sea === true || sea === 1,
    riv: sea === 2,
  };
}
const rivWater = (x, z) => riverDist(x, z) < -0.7 && hyp(x, z) < R_ISLAND - 3;
function spawnCrocs() {
  if (NET.guest) return;
  for (let i = 0, tries = 0; i < 9 && tries < 500; tries++) {
    const a = rnd(6.283),
      r = tideR + rnd(5, 30),
      x = JAIL.x + Math.cos(a) * r,
      z = JAIL.z + Math.sin(a) * r;
    if (!crocWater(x, z) || crocs.some((c) => hyp(c.x - x, c.z - z) < 14))
      continue;
    crocs.push(makeCroc(x, z, false));
    i++;
  }
  if (crocs.some((c) => !c.sea))
    msg(
      "🐊 CROCODILES have come in with the flood — stay out of the water!",
      "alarm",
    );
}
const seaWater = (x, z) => {
  const r = hyp(x, z);
  return (
    r > R_ISLAND + 1.5 && r < R_ISLAND + 13.5 && !hit(x, -0.8, z, 0.6, 1.2)
  );
};
let seaCrocsOn = false;
function spawnSeaCrocs() {
  seaCrocsOn = true;
  if (NET.guest) return;
  const n0 = crocs.length;
  spawnCrocs.sea = true;
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * 6.283 + 0.4,
      r = R_ISLAND + 8,
      x = Math.cos(a) * r,
      z = Math.sin(a) * r;
    if (seaWater(x, z)) crocs.push(makeCroc(x, z, true));
  }
  for (const [ri, f] of [
    [0, 0.13],
    [0, 0.3],
    [0, 0.47],
    [0, 0.66],
    [0, 0.85],
    [1, 0.3],
    [1, 0.62],
  ]) {
    const q = riverAt(ri, RLEN[ri][RLEN[ri].length - 1] * f);
    if (rivWater(q.x, q.z)) crocs.push(makeCroc(q.x, q.z, 2));
  } // the rivers have their own crocodiles
}
function updateCrocs(dt) {
  if (!seaCrocsOn && phase === "game") spawnSeaCrocs();
  let warn = false;
  for (const c of crocs) {
    c.biteCd -= dt;
    c.think -= dt;
    if (c.think <= 0) {
      c.think = FIN.on ? 0.2 : 0.4;
      c.tgt = null;
      let bd = FIN.on ? 30 : 17;
      if (c.sea) bd = 34;
      if (c.riv && FIN.on) c.riv = false;
      if (c.riv) bd = 16;
      for (const r of ents) {
        if (
          r.role !== "runner" ||
          !r.alive ||
          r.hidden ||
          r.cap ||
          r.boat ||
          r.seat != null ||
          r.raft != null ||
          r.hop ||
          (c.riv
            ? r.pos.y > -0.25 ||
              riverDist(r.pos.x, r.pos.z) > -0.2 ||
              hyp(r.pos.x, r.pos.z) > R_ISLAND - 2
            : c.sea
              ? r.pos.y > -0.25 || hyp(r.pos.x, r.pos.z) < R_ISLAND + 1.5
              : r.pos.y > 0.7 || floodDepth(r.pos.x, r.pos.z) < 0.4)
        )
          continue;
        const d = hyp(r.pos.x - c.x, r.pos.z - c.z);
        if (d < bd) {
          bd = d;
          c.tgt = r;
        }
      }
      const okW = c.riv ? rivWater : c.sea ? seaWater : crocWater;
      if (
        !c.tgt &&
        (hyp(c.wx - c.x, c.wz - c.z) < 1.5 ||
          !okW(c.wx, c.wz) ||
          Math.random() < 0.05)
      ) {
        for (let k = 0; k < 8; k++) {
          const a = rnd(6.283),
            r = rnd(4, 16),
            x = c.x + Math.cos(a) * r,
            z = c.z + Math.sin(a) * r;
          if (okW(x, z)) {
            c.wx = x;
            c.wz = z;
            break;
          }
        }
      }
      if (!c.sea && !c.riv && !crocWater(c.x, c.z)) {
        const dx = c.x - JAIL.x,
          dz = c.z - JAIL.z,
          l = hyp(dx, dz) || 1;
        c.wx = c.x + (dx / l) * 6;
        c.wz = c.z + (dz / l) * 6;
      } // the water moved on: follow it out
    }
    const tx = c.tgt ? c.tgt.pos.x : c.wx,
      tz = c.tgt ? c.tgt.pos.z : c.wz,
      dx = tx - c.x,
      dz = tz - c.z,
      d = hyp(dx, dz),
      sp = c.tgt ? (FIN.on ? 7.3 : c.sea ? 6.2 : 5.4) : 1.6;
    if (d > 0.9) {
      const nx = c.x + (dx / d) * sp * dt,
        nz = c.z + (dz / d) * sp * dt,
        free = c.riv
          ? (x, z) => riverDist(x, z) < -0.45 && hyp(x, z) < R_ISLAND - 2
          : c.sea
            ? (x, z) => hyp(x, z) > R_ISLAND + 0.8 && !hit(x, -0.8, z, 0.5, 1.2)
            : (x, z) => floodDepth(x, z) > 0.3 && !hit(x, 0, z, 0.5, 0.6);
      if (free(nx, nz)) {
        c.x = nx;
        c.z = nz;
      } else if (free(nx, c.z)) c.x = nx;
      else if (free(c.x, nz)) c.z = nz;
      let da = Math.atan2(dx, dz) - c.yaw;
      while (da > Math.PI) da -= 6.283;
      while (da < -Math.PI) da += 6.283;
      c.yaw += da * Math.min(1, dt * 5);
    }
    if (c.tgt && d < 1.9 && c.biteCd <= 0 && c.tgt.alive) {
      c.biteCd = FIN.on ? 1.6 : 2.4;
      c.jawT = 0.35;
      damage(c.tgt, FIN.on ? 12 : 6, dx / (d || 1), dz / (d || 1), 7, "CHOMP!");
      sndAt(c.tgt, { f: 110, d: 0.2, type: "sawtooth", v: 0.2, slide: -50 });
      puff(c.tgt.pos.x, 0.3, c.tgt.pos.z, 0xbfe6ff, 10, 4);
      if (c.tgt.isPlayer) {
        shake = 0.35;
        setStatus(
          c.riv
            ? "🐊 A crocodile bit you — get out of the river!"
            : c.sea
              ? "🐊 A crocodile bit you — the ocean is theirs, swim back to shore!"
              : "🐊 A crocodile bit you — get out of the water!",
          2.5,
        );
      }
    }
    if (c.tgt && c.tgt.isPlayer && d < 12) warn = true;
    c.jawT = (c.jawT || 0) - dt;
    c.jaw.rotation.x =
      c.jawT > 0
        ? -0.7
        : c.tgt && d < 5
          ? -0.3 - Math.sin(clock * 9) * 0.15
          : 0;
    c.tail.rotation.y = Math.sin(clock * (c.tgt ? 9 : 3) + c.x) * 0.5;
    c.g.position.set(
      c.x,
      (c.sea ? -0.42 : -0.08) + Math.sin(clock * 2 + c.z) * 0.03,
      c.z,
    );
    c.g.rotation.y = c.yaw;
  }
  if (warn && statusT > 900)
    setStatus(
      hyp(player.pos.x, player.pos.z) > R_ISLAND
        ? "🐊 Crocodiles hunt in the ocean — get back to the shore!"
        : "🐊 A crocodile is coming for you — climb onto something dry!",
      0.4,
    );
}
function blowShip() {
  // half the island is under water: the storm tears the ship from the dock
  shipGone = true;
  noShip = true;
  SHIPFX.driftT = 14;
  spawnCrocs();
  CHAIN.on = false;
  CHAIN.g.visible = false;
  shipWait = false;
  for (const e of ents) {
    if (e.role !== "runner") {
      e.chain = false;
      continue;
    }
    const aboard = e.seat != null || onShip(e);
    if (e.seat != null) leaveSeat(e);
    if (aboard) {
      e.pos.set(DOCK.x + rnd(-3, 5), 0.35, DOCK.z + rnd(-1.2, 1.2));
      e.vy = 0;
      if (e.alive && !e.stun) e.stun = { type: "slip", t: 1.2 };
    }
    e.wood = 0;
    e.wet = 0;
    e.iron = 0;
    e.sail = 0;
    e.fuel = false;
    if (e.ai) e.ai.path = null;
  }
  for (let i = colliders.length - 1; i >= 0; i--) {
    const b = colliders[i];
    if (
      Math.abs(b.x0 - (SHIP.x - 6)) < 0.01 &&
      Math.abs(b.z0 - (SHIP.z - 2)) < 0.01 &&
      Math.abs(b.y1 - 0.3) < 0.01
    )
      colliders.splice(i, 1);
  }
  if (SHIPFX.sign) {
    scene.remove(SHIPFX.sign);
    SHIPFX.sign = null;
  }
  msg(
    player.role === "chaser"
      ? "🌊 Half the island is under water — the SHIP was swept away! Catch every runner you can before the flood — then keep them off the raft"
      : "🌊 Half the island is under water — the SHIP was swept away! Stay free until the flood: the RAFT on the far shore is the last way out",
    "alarm",
  );
  setStatus("🌊 The ship is gone!", 3);
  thunder();
  flashT = 0.3;
}
function updateWeather(dt) {
  const el = ROUND_TIME - roundT,
    p = el / ROUND_TIME,
    p2 = Math.min(
      1,
      Math.max(0, (el - TIDE_START) / (ROUND_TIME - TIDE_START)),
    );
  // ---- tide: slow at first, faster and faster ----
  tideR = TIDE0 - (TIDE0 - TIDE1) * Math.pow(p2, TIDE_POW);
  if (!shipGoneT)
    shipGoneT =
      TIDE_START +
      (ROUND_TIME - TIDE_START) *
        Math.pow((TIDE0 - R_ISLAND * 0.7071) / (TIDE0 - TIDE1), 1 / TIDE_POW); // moment the dry circle is half the island
  if (!tideTold && el >= TIDE_START) {
    tideTold = true;
    msg(
      "🌊 The TIDE is coming in! The island shrinks towards the prison — and once half of it is under water the ship is swept away",
      "alarm",
    );
    beep(110, 0.9, "sine", 0.09, 60);
  }
  if (!shipGone && el >= shipGoneT) blowShip();
  if (!tideTold30 && roundT < 30 && roundT > 0) {
    tideTold30 = true;
    msg(
      player.role === "chaser"
        ? "🌊 30 seconds to the flood — the prison will burst open and every runner will make for the RAFT (orange on the map)"
        : "🌊 30 seconds to the flood — get near the prison: the posts from there lead to the RAFT (orange on the map)",
      "alarm",
    );
  }
  if (shipGone && SHIPFX.driftT > 0) {
    SHIPFX.driftT -= dt;
    for (const m of SHIPFX.meshes) {
      m.position.x += Math.min(8, (14 - SHIPFX.driftT) * 1.4) * dt;
      m.position.z += 0.6 * dt;
      if (SHIPFX.driftT <= 0) m.visible = false;
    }
  }
  updateCrocs(dt);
  updateMountain(dt);
  tideMesh.scale.set(tideR, tideR, 1);
  foamMesh.scale.set(tideR, tideR, 1);
  foamMesh.material.opacity = 0.6 + Math.sin(clock * 2.2) * 0.2;
  tideMesh.position.y = 0.11 + Math.sin(clock * 1.3) * 0.02;
  for (const L of leaks)
    if (!L.dug && hyp(L.x - JAIL.x, L.z - JAIL.z) > tideR + 1.5) {
      // the sea reaches a buried can: it floats up at the waterline
      L.dug = true;
      L.known = "empty";
      L.g.visible = false;
      for (const k in L.tags) L.tags[k].visible = false;
      const r = hyp(L.x - JAIL.x, L.z - JAIL.z),
        k = Math.max(12, tideR - 5) / r,
        qx = JAIL.x + (L.x - JAIL.x) * k,
        qz = JAIL.z + (L.z - JAIL.z) * k;
      let q = randFree(qx, qz, 0, 5) || { x: qx, z: qz };
      spawnItem("fuel", q.x, q.z);
      msg(
        "🌊 The tide washed a buried fuel can loose — it floats at the waterline",
        "alarm",
      );
    }
  {
    const pl = player,
      d = floodDepth(pl.pos.x, pl.pos.z);
    tideWarn -= dt;
    if (pl.alive && d > 0 && pl.pos.y < 0.4 && tideWarn <= 0 && statusT > 900) {
      tideWarn = 14;
      setStatus(
        "🌊 You are wading through the tide — everyone is slower in the water",
        2.5,
      );
    }
  }
  // ---- storm: second half of the round ----
  if (!stormOn && p >= 0.5) {
    stormOn = true;
    rain.visible = true;
    msg(
      "⛈ A STORM hits the island — the ground is slippery. Anyone who runs can slip; walking and crouching are safe",
      "alarm",
    );
    setStatus("⛈ STORM! Running on wet ground can make you slip", 4);
    thunder();
    flashT = 0.25;
  }
  if (stormOn) {
    stormK = Math.min(1, stormK + dt / 10);
    const c = camera.position,
      wind = 7;
    for (let i = 0; i < RAIN_N; i++) {
      const s = rainSeed[i];
      s[1] -= s[3] * dt;
      s[0] += wind * dt;
      if (s[1] < 0) {
        s[1] += 34;
        s[0] = Math.random() * 70 - 35;
        s[2] = Math.random() * 70 - 35;
      }
      if (s[0] > 35) s[0] -= 70;
      const x = c.x + s[0],
        y = s[1],
        z = c.z + s[2],
        o = i * 6;
      rainPos[o] = x;
      rainPos[o + 1] = y;
      rainPos[o + 2] = z;
      rainPos[o + 3] = x + 0.28;
      rainPos[o + 4] = y + 1.1;
      rainPos[o + 5] = z;
    }
    rainGeo.attributes.position.needsUpdate = true;
    rain.material.opacity = 0.55 * stormK;
    boltT -= dt;
    if (boltT <= 0) {
      boltT = rnd(8, 20);
      flashT = 0.22;
      setTimeout(thunder, 300 + Math.random() * 900);
    }
    flashT -= dt;
    const fl = flashT > 0 ? 1 : 0;
    skyC.copy(SKY0).lerp(SKY1, stormK);
    if (fl) skyC.lerp(FLASH, 0.8);
    scene.background.copy(skyC);
    scene.fog.color.copy(skyC);
    scene.fog.near = 90 - 45 * stormK;
    scene.fog.far = 300 - 120 * stormK;
    hemi.intensity = 1.5 - 0.6 * stormK + fl * 1.6;
    sun.intensity = 2.2 - 1.3 * stormK + fl * 1.5;
    for (const e of ents) {
      // wet ground: runners and chasers alike can lose their footing
      e.slipCd = (e.slipCd || 0) - dt;
      if (
        e.role === "decoy" ||
        !e.alive ||
        e.stun ||
        e.slipCd > 0 ||
        !e.onGround ||
        !e.run ||
        e.stance !== 0 ||
        e.moving < 6 ||
        e.hidden ||
        e.zip ||
        e.boat ||
        e.seat != null ||
        e.pos.y > 0.5 ||
        e.cap
      )
        continue;
      if (indoors(e.pos.x, e.pos.z) || Math.random() > dt * 0.04 * stormK)
        continue;
      e.stun = { type: "slip", t: 1.1 };
      e.slipCd = 7;
      playVoiceAt(SLIP.a, e, 1);
      e.kx = Math.sin(e.yaw) * 7;
      e.kz = Math.cos(e.yaw) * 7;
      e.atk = null;
      e.charge = null;
      popText("SLIPPED!", e.pos.x, e.pos.y + 2.4, e.pos.z, "#9fe0ff", 0.9);
      puff(e.pos.x, 0.2, e.pos.z, 0xbfe6ff, 8, 3);
      sndAt(e, { f: 300, d: 0.18, type: "sine", v: 0.06, slide: -180 });
      if (e.hum)
        statusTo(
          e,
          "⛈ You slipped on the wet ground — walk or crouch to stay on your feet",
          2.5,
        );
    }
  }
}
/* ================= positional sound (distance, stereo, muffling, delay, doppler) ================= */
const SND_C = 45; // exaggerated "speed of sound" so the doppler shift is audible at running speeds
function velOf(e) {
  return e && e.moving !== undefined
    ? [
        Math.sin(e.yaw) * e.moving + (e.kx || 0),
        Math.cos(e.yaw) * e.moving + (e.kz || 0),
      ]
    : [0, 0];
}
function sndAt(src, o) {
  // src: entity or {x,z}; o: {f, d, type, v, slide, noise}
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const sx = src.pos ? src.pos.x : src.x,
      sz = src.pos ? src.pos.z : src.z,
      L = camera.position;
    const dx = L.x - sx,
      dz = L.z - sz,
      dist = hyp(dx, dz),
      near = src === player;
    const att = near ? 1 : 1 / (1 + (dist / 16) * (dist / 16));
    if (att < 0.012) return;
    let dop = 1;
    if (!near && dist > 1) {
      const sv = velOf(src.pos ? src : null),
        lv = velOf(player),
        vr = ((sv[0] - lv[0]) * dx + (sv[1] - lv[1]) * dz) / dist;
      dop = clamp(1 + vr / SND_C, 0.7, 1.45);
    }
    const t0 = actx.currentTime + (near ? 0 : Math.min(0.5, dist / 220)),
      d = o.d || 0.1,
      f = (o.f || 200) * dop;
    const g = actx.createGain(),
      lp = actx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = near ? 9000 : Math.max(350, 7000 / (1 + dist / 14));
    const peak = (o.v || 0.08) * att;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + (o.atk || 0.008));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
    let out = lp;
    g.connect(lp);
    if (actx.createStereoPanner && !near) {
      const p = actx.createStereoPanner();
      p.pan.value =
        clamp(
          (-dx * Math.cos(camYaw) + dz * Math.sin(camYaw)) / Math.max(dist, 4),
          -1,
          1,
        ) * 0.9;
      lp.connect(p);
      out = p;
    }
    out.connect(actx.destination);
    const osc = actx.createOscillator();
    osc.type = o.type || "sine";
    osc.frequency.setValueAtTime(f, t0);
    if (o.slide)
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(30, f + o.slide * dop),
        t0 + d,
      );
    osc.connect(g);
    osc.start(t0);
    osc.stop(t0 + d + 0.02);
    if (o.noise) {
      const n = Math.floor(actx.sampleRate * (o.nd || Math.min(d, 0.12))),
        buf = actx.createBuffer(1, n, actx.sampleRate),
        ch = buf.getChannelData(0);
      for (let i = 0; i < n; i++)
        ch[i] =
          (Math.random() * 2 - 1) *
          (1 - i / n) *
          (1 - i / n) *
          Math.min(1, i / 40);
      const s = actx.createBufferSource(),
        ng = actx.createGain(),
        nf = actx.createBiquadFilter();
      s.buffer = buf;
      s.playbackRate.value = dop;
      nf.type = o.ntype || "lowpass";
      nf.frequency.value = o.nfreq || 700;
      nf.Q.value = 0.7;
      ng.gain.value = o.noise * att;
      s.connect(nf).connect(ng).connect(lp);
      s.start(t0);
    }
  } catch (err) {}
}
const thud = (src, k = 1) =>
  sndAt(src, {
    f: k > 1.1 ? 78 : 96,
    slide: -40,
    d: 0.12,
    type: "sine",
    v: 0.2 * k,
    noise: 0.55 * k,
    nfreq: k > 1.1 ? 800 : 1300,
    ntype: "bandpass",
    nd: 0.07,
    atk: 0.006,
  }); // soft smack
const whoosh = (src) =>
  sndAt(src, { f: 260, slide: -140, d: 0.09, type: "sine", v: 0.05 });
function footstep(e, dt) {
  if (
    !e.onGround ||
    e.moving < 5.5 ||
    e.stance !== 0 ||
    e.hidden ||
    e.pos.y < -0.2
  )
    return; // crouching / walking is silent
  e.stepT = (e.stepT || 0) - dt;
  if (e.stepT > 0) return;
  if (
    e !== player &&
    hyp(e.pos.x - camera.position.x, e.pos.z - camera.position.z) > 42
  )
    return;
  e.stepT = e.role === "chaser" ? 0.3 : 0.27;
  const wet =
    Math.max(
      stormK,
      (typeof floodDepth === "function" && floodDepth(e.pos.x, e.pos.z) > 0) ||
        inRiver(e.pos.x, e.pos.z)
        ? 1
        : 0,
    ) * SNDV.rain;
  if (wet > 0.05) {
    // wet ground: a splash and a squelch instead of a dry thud
    const me = e === player,
      v = (me ? 0.06 : e.role === "chaser" ? 0.3 : 0.17) * (0.5 + 0.5 * wet);
    sndAt(e, {
      f: 190 + rnd(60),
      slide: -120,
      d: 0.06,
      type: "sine",
      v: v * 0.45,
      noise: v * 2.2,
      nfreq: 2300 + rnd(900),
      ntype: "bandpass",
      nd: 0.13,
      atk: 0.004,
    });
    if (Math.random() < 0.5)
      sndAt(e, {
        f: 520 + rnd(200),
        slide: 260,
        d: 0.05,
        type: "sine",
        v: v * 0.25,
      }); // droplet "plip"
    if (me && Math.random() < 0.3)
      puff(e.pos.x, e.pos.y + 0.1, e.pos.z, 0xbfe6ff, 3, 1.6);
    return;
  }
  if (e === player)
    sndAt(e, { f: 95, slide: -40, d: 0.05, v: 0.035, noise: 0.03 });
  else
    sndAt(
      e,
      e.role === "chaser"
        ? { f: 72, slide: -30, d: 0.08, v: 0.34, noise: 0.2 }
        : { f: 110, slide: -45, d: 0.06, v: 0.16, noise: 0.1 },
    );
}
/* ---------- crawl walls: only passable crouched (yellow) or prone (orange) ---------- */
const crawls = [];
function buildCrawl() {
  let tries = 0;
  while (crawls.length < 22 && tries++ < 60000) {
    const a = srand() * 6.283,
      r = 14 + Math.sqrt(srand()) * (R_GRASS - 34),
      x = Math.cos(a) * r,
      z = Math.sin(a) * r,
      ax = srand() < 0.5,
      prone = crawls.length % 3 === 2;
    if (
      hit(x, 0, z, ax ? 7.6 : 1.2, 3) ||
      hit(x, 0, z, ax ? 1.2 : 7.6, 3) ||
      hit(x - (ax ? 5 : 0), 0, z - (ax ? 0 : 5), 3, 3) ||
      hit(x + (ax ? 5 : 0), 0, z + (ax ? 0 : 5), 3, 3) ||
      hit(x, 0, z, 3.6, 3) ||
      riverDist(x, z) < 8.5 ||
      hyp(x - JAIL.x, z - JAIL.z) < 20 ||
      hyp(x - LOBBY.x, z - LOBBY.z) < LOBBY.r + 15 ||
      hyp(x, z - 8) < 14 ||
      hyp(x - DOCK.x, z - DOCK.z) < 25 ||
      crawls.some((c) => hyp(c.x - x, c.z - z) < 13)
    )
      continue;
    const len = 14,
      hw = 1.5,
      gh = prone ? 0.62 : 1.16,
      H_ = 2.7,
      t = 0.5,
      off = (srand() - 0.5) * 6,
      col = 0x8d8f86,
      seg = (c0, c1, y, h, cl) => {
        const m = (c0 + c1) / 2,
          l = c1 - c0;
        if (ax) addBox(x + m, y, z, l, h, t, cl);
        else addBox(x, y, z + m, t, h, l, cl);
      };
    seg(-len / 2, off - hw / 2, 0, H_, col);
    seg(off + hw / 2, len / 2, 0, H_, col);
    seg(off - hw / 2, off + hw / 2, gh, H_ - gh, prone ? 0xe08a1e : 0xe2c23b);
    crawls.push({
      x,
      z,
      ax,
      prone,
      hx: ax ? x + off : x,
      hz: ax ? z : z + off,
    });
  }
}

/* ================= v45: campfires for wet planks + the flood finale (parkour course to a raft) ================= */
const FIRES = [],
  DRY_T = 10,
  FIN_T = 120;
const FIN = { on: false, t: 0, need: 1, cast: 0 },
  CAST_T = 8;
const RAFT = {
  x: 0,
  z: 0,
  yaw: 0,
  v: 0,
  go: false,
  g: null,
  sign: null,
  oars: [],
};
const COURSE = [],
  RSEAT = [
    [0, -1.55],
    [-0.75, 0.95],
    [0.75, 0.95],
    [-0.75, -0.25],
    [0.75, -0.25],
  ];
const raftCrew = () => ents.filter((e) => e.raft != null && e.alive);
function buildFinal() {
  // ---- campfires: four of them, each a fair walk from the beaches ----
  for (const ad of [40, 130, 215, 310]) {
    let F = null;
    search: for (let r = 0; r <= 16; r += 2)
      for (let a = 0; a < 6.28; a += 0.5) {
        const x = Math.cos((ad * Math.PI) / 180) * 66 + Math.cos(a) * r,
          z = Math.sin((ad * Math.PI) / 180) * 66 + Math.sin(a) * r;
        if (
          hit(x, 0, z, 2.2, 3) ||
          riverDist(x, z) < 5 ||
          hyp(x - LOBBY.x, z - LOBBY.z) < LOBBY.r + 6 ||
          hyp(x - JAIL.x, z - JAIL.z) < 30 ||
          (MT.on && hyp(x - MT.x, z - MT.z) < MT.R + 4)
        )
          continue;
        F = { x, z };
        break search;
      }
    if (!F) continue;
    const g = new THREE.Group(),
      mk = (w, h, d, c, px, py, pz, ry = 0, basic = false) => {
        const m = new THREE.Mesh(
          BOX,
          basic ? new THREE.MeshBasicMaterial({ color: c }) : mat(c),
        );
        m.scale.set(w, h, d);
        m.position.set(px, py, pz);
        m.rotation.y = ry;
        g.add(m);
        return m;
      };
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * 6.283;
      mk(
        0.34,
        0.24,
        0.34,
        i % 2 ? 0x8a8479 : 0x6f6a61,
        Math.cos(a) * 0.85,
        0.12,
        Math.sin(a) * 0.85,
        a,
      );
    }
    mk(1.3, 0.16, 0.2, 0x5a3a1c, 0, 0.14, 0, 0.5);
    mk(1.3, 0.16, 0.2, 0x4a2f16, 0, 0.2, 0, -0.7);
    mk(1.2, 0.16, 0.2, 0x5a3a1c, 0, 0.26, 0, 1.9);
    const fl = new THREE.Group();
    fl.position.y = 0.3;
    g.add(fl);
    const q = (w, h, c, px, pz) => {
      const m = new THREE.Mesh(BOX, new THREE.MeshBasicMaterial({ color: c }));
      m.scale.set(w, h, w);
      m.position.set(px, h / 2, pz);
      fl.add(m);
    };
    q(0.55, 0.7, 0xff7a1a, 0, 0);
    q(0.36, 1.0, 0xffb020, 0.08, -0.05);
    q(0.2, 1.25, 0xffe14d, -0.05, 0.06);
    g.position.set(F.x, 0, F.z);
    scene.add(g);
    const t = textSprite(
      "🔥 CAMPFIRE — dries wet planks",
      "#ffb020",
      38,
      "rgba(15,20,28,.85)",
    );
    t.scale.set(0.42 * t.userData.aspect, 0.42, 1);
    t.position.set(F.x, 2.3, F.z);
    scene.add(t);
    FIRES.push({
      x: F.x,
      z: F.z,
      lit: true,
      use: 0,
      ping: 0,
      told: -99,
      g,
      fl,
      t,
    });
  }
  // ---- the course: posts from the prison straight to the shore, along the clearest line ----
  const J = JAIL;
  let best = 0,
    bs = 1e9;
  for (let d = 0; d < 360; d += 5) {
    const a = (d * Math.PI) / 180;
    let bad = 0,
      len = 0;
    for (let r = 9; r < 220; r++) {
      const x = J.x + Math.cos(a) * r,
        z = J.z + Math.sin(a) * r;
      if (hyp(x, z) > R_GRASS - 5) break;
      len = r;
      if (r > 28 && hit(x, 0, z, 1.3, 3)) bad++;
      if (
        riverDist(x, z) < 3.5 ||
        hyp(x - LOBBY.x, z - LOBBY.z) < LOBBY.r + 5 ||
        (MT.on && hyp(x - MT.x, z - MT.z) < MT.R + 5) ||
        hyp(x - DOCK.x, z - DOCK.z) < 40 ||
        FIRES.some((F) => hyp(F.x - x, F.z - z) < 4)
      )
        bad += 40;
    }
    const sc = bad * 100 + Math.abs(len - 82);
    if (sc < bs) {
      bs = sc;
      best = a;
    }
  }
  const ca = Math.cos(best),
    sa = Math.sin(best),
    HS = [1.4, 1.1, 1.5, 1.2, 1.6, 1.0, 1.4, 1.2],
    cols = [0x8a5a2b, 0x9a7446, 0x7d7468, 0x6d6459];
  let r = 8.7,
    k = 0,
    lr = 8.7;
  for (; r < 220; r += 3.9) {
    const zig = k % 2 ? 0.6 : -0.6;
    let ok = null;
    for (const o of [0, 1.7, -1.7, 2.5, -2.5]) {
      const x = J.x + ca * r - sa * (zig + o),
        z = J.z + sa * r + ca * (zig + o);
      if (hyp(x, z) > R_GRASS - 5.5) {
        ok = 0;
        break;
      }
      if (!hit(x, 0, z, 1.0, 3) && riverDist(x, z) > 2) {
        ok = { x, z };
        break;
      }
    }
    if (ok === 0) break;
    if (!ok) continue;
    const h = HS[k % HS.length];
    addBox(ok.x, 0, ok.z, 1.5, h, 1.5, cols[k % 4]);
    addBox(ok.x, h, ok.z, 1.62, 0.08, 1.62, 0xffd23f, false);
    addBox(ok.x, h * 0.5, ok.z, 1.56, 0.12, 1.56, 0xc9302c, false);
    COURSE.push({ x: ok.x, z: ok.z, y: h });
    k++;
    lr = r;
  }
  // ---- the raft, moored past the last post ----
  RAFT.x = RAFT.x0 = J.x + ca * (lr + 3.7);
  RAFT.z = RAFT.z0 = J.z + sa * (lr + 3.7);
  RAFT.yaw = Math.atan2(RAFT.x, RAFT.z);
  const g = new THREE.Group(),
    mk = (w, h, d, c, px, py, pz, par = g) => {
      const m = new THREE.Mesh(BOX, mat(c));
      m.scale.set(w, h, d);
      m.position.set(px, py, pz);
      m.castShadow = true;
      par.add(m);
      return m;
    };
  for (let i = 0; i < 6; i++)
    mk(0.5, 0.34, 4.6, i % 2 ? 0x8a5a2b : 0x7a4d24, -1.3 + i * 0.52, 0.17, 0);
  mk(3.3, 0.1, 0.3, 0x4a3a28, 0, 0.38, 1.7);
  mk(3.3, 0.1, 0.3, 0x4a3a28, 0, 0.38, -1.7);
  mk(3.3, 0.1, 0.3, 0x4a3a28, 0, 0.38, 0);
  for (const sx of [-1.75, 1.75])
    for (const sz of [-1.3, 1.3]) mk(0.5, 0.5, 0.9, 0xe8632c, sx, 0.2, sz); // floats
  mk(0.12, 2.6, 0.12, 0x5a3a1c, 0, 1.6, 0.4);
  mk(0.9, 0.55, 0.04, 0xff7a1a, 0.5, 2.5, 0.4); // mast + pennant
  mk(0.12, 0.9, 0.12, 0x5a3a1c, 0, 0.8, -2.1);
  mk(0.1, 0.1, 1.0, 0x5a3a1c, 0, 1.2, -1.75); // tiller
  for (const [sx, sz] of [
    [-1, 0.95],
    [1, 0.95],
    [-1, -0.25],
    [1, -0.25],
  ]) {
    const o = new THREE.Group();
    o.position.set(sx * 1.55, 0.5, sz);
    g.add(o);
    mk(1.7, 0.08, 0.1, 0xd8c9a0, sx * 0.6, -0.15, 0, o);
    mk(0.1, 0.34, 0.5, 0xd8c9a0, sx * 1.4, -0.25, 0, o);
    o.userData.sx = sx;
    RAFT.oars.push(o);
  }
  g.position.set(RAFT.x, 0.02, RAFT.z);
  g.rotation.y = RAFT.yaw;
  scene.add(g);
  RAFT.g = g;
  const t = textSprite(
    "🛟 RAFT — the last way out when the island floods",
    "#ffd23f",
    38,
    "rgba(15,20,28,.85)",
  );
  t.scale.set(0.5 * t.userData.aspect, 0.5, 1);
  t.position.set(RAFT.x, 3.6, RAFT.z);
  scene.add(t);
  RAFT.sign = t;
}
function nearestFire(e, max = 1e9) {
  let b = null,
    bd = max;
  for (const F of FIRES) {
    if (!F.lit) continue;
    const d = hyp(F.x - e.pos.x, F.z - e.pos.z);
    if (d < bd) {
      bd = d;
      b = F;
    }
  }
  return b;
}
function dryFirst(e, dt) {
  // a bot with soaked planks walks to a campfire first; false = nothing to dry (or no fire left)
  if (!(e.wet > 0)) return false;
  const F = nearestFire(e);
  if (!F) {
    e.wood -= e.wet;
    e.wet = 0;
    return false;
  } // every fire is under water: the wet planks are useless
  e.run = true;
  if (e.stance) setStance(e, 0);
  if (hyp(F.x - e.pos.x, F.z - e.pos.z) < 2.0) e.wx = e.wz = 0;
  else navTo(e, F.x, F.z, dt);
  return true;
}
function updateFinalFx(dt) {
  // everything here is looks + the drying rule; runs on every screen
  for (const F of FIRES) {
    if (
      !NET.guest &&
      F.lit &&
      phase === "game" &&
      hyp(F.x - JAIL.x, F.z - JAIL.z) > tideR + 0.5
    ) {
      F.lit = false;
      msg("🌊 The tide put out a campfire");
    }
    F.fl.visible = F.lit;
    F.t.visible = F.lit;
    const busy = F.lit && F.use > clock;
    if (F.lit) {
      const k = 0.85 + Math.sin(clock * 13 + F.x) * 0.15 + (busy ? 0.7 : 0);
      F.fl.scale.set(k, k * (1 + Math.sin(clock * 9 + F.z) * 0.15), k);
    }
    if (busy) {
      F.g.userData.pT = (F.g.userData.pT || 0) - dt;
      if (F.g.userData.pT <= 0) {
        F.g.userData.pT = 0.22;
        const y = 2 + ((clock * 5) % 14);
        puff(F.x + rnd(-0.4, 0.4), y, F.z + rnd(-0.4, 0.4), 0x4a4a4a, 4, 1.4);
        puff(F.x, 1.2, F.z, 0x777777, 2, 1.2);
      }
    }
  }
  if (!NET.guest && phase === "game" && !FIN.on)
    for (const e of ents) {
      if (e.role !== "runner" || !e.alive || !(e.wet > 0) || e.stun) continue;
      const F = nearestFire(e, 2.9);
      if (!F) {
        if (e.hum && e.dryT > 0) e.dryT = Math.max(0, e.dryT - dt);
        continue;
      }
      e.dryT = (e.dryT || 0) + dt;
      F.use = clock + 0.5;
      F.ping = clock + 5;
      if (!e.hum && !e.scared) e.pryT = clock + 0.25;
      if (e.hum)
        statusTo(
          e,
          `🔥 Drying the planks… ${Math.max(1, Math.ceil(DRY_T - e.dryT))}s — the smoke can be seen from far away`,
          0.5,
        );
      if (clock - F.told > 25) {
        F.told = clock;
        msg(
          "💨 Smoke is rising from a campfire — someone is drying planks there",
          "alarm",
        );
        const bots = chasers
          .filter((c) => !c.isPlayer && !c.rid && !c.carry && !c.ai.tgt)
          .sort(
            (a, b) =>
              hyp(a.pos.x - F.x, a.pos.z - F.z) -
              hyp(b.pos.x - F.x, b.pos.z - F.z),
          );
        if (
          bots[0] &&
          Math.random() < 0.35 + 0.5 * LVL.smart &&
          hyp(bots[0].pos.x - F.x, bots[0].pos.z - F.z) < 90
        )
          bots[0].ai.smoke = { x: F.x, z: F.z, t: clock + 20 };
      }
      if (e.dryT >= DRY_T) {
        e.wet = 0;
        e.dryT = 0;
        popText("DRY!", e.pos.x, e.pos.y + 2.5, e.pos.z, "#ffb020", 1);
        beep(520, 0.2, "sine", 0.07, 200);
        msg(`🔥 ${e.name} dried planks at a campfire`);
        if (e.hum)
          statusTo(e, "🪵 The planks are dry — carry them to the DOCK", 3);
      }
    }
  // the raft
  if (RAFT.g) {
    const sea = hyp(RAFT.x, RAFT.z) > R_ISLAND;
    RAFT.g.position.set(
      RAFT.x,
      (FIN.on ? 0.12 : 0.02) +
        (sea ? -0.3 : 0) +
        (FIN.on ? Math.sin(clock * 2.1) * 0.05 : 0),
      RAFT.z,
    );
    RAFT.g.rotation.y = RAFT.yaw;
    RAFT.g.rotation.z = FIN.on ? Math.sin(clock * 1.7) * 0.03 : 0;
    RAFT.sign.visible = !RAFT.go;
    const row = RAFT.go ? Math.sin(clock * 6) : 0;
    for (const o of RAFT.oars) o.rotation.y = row * 0.5 * o.userData.sx;
  }
}
function raftOn(e) {
  const used = new Set(raftCrew().map((o) => o.raft));
  let i = 0;
  while (used.has(i)) i++;
  if (i >= RSEAT.length) return false;
  const first = !used.size;
  e.raft = i;
  e.rcap = first || !raftCrew().some((o) => o.rcap && o !== e);
  e.hop = null;
  e.ci = undefined;
  e.stance = 0;
  e.kx = e.kz = 0;
  const n = used.size + 1;
  msg(
    `🛟 ${e.name} is on the raft (${n}/${RSEAT.length})` +
      (e.rcap ? " — and steers it" : ""),
    n === 1 ? "alarm" : undefined,
  );
  beep(620, 0.2, "sine", 0.07, 200);
  if (e.hum)
    statusTo(
      e,
      e.rcap
        ? "🛟 You are the CAPTAIN — when the raft leaves, steer it out to sea with the stick / keys"
        : "🛟 You are on the raft — you row when it leaves. PUSH (G) shoves a chaser away · JUMP = get off",
      4,
    );
  return true;
}
function raftOff(e, by, self) {
  if (e.raft == null) return;
  const side = (e.raft % 2 ? -1 : 1) * (self ? 1 : 1),
    cs = Math.cos(RAFT.yaw),
    sn = Math.sin(RAFT.yaw);
  e.raft = null;
  e.raftCd = 3;
  const wasCap = e.rcap;
  e.rcap = false;
  const x = RAFT.x + cs * side * 2.6,
    z = RAFT.z - sn * side * 2.6;
  e.pos.set(x, groundY(x, z), z);
  e.vy = 0;
  e.onGround = false;
  e.wetAt = clock;
  if (!self) {
    if (e.alive && !e.stun) e.stun = { type: "slip", t: 1.2 };
    popText("SPLASH!", x, 2.2, z, "#9fe0ff", 1.1);
    puff(x, 0.3, z, 0xbfe6ff, 16, 5);
    sndAt(e, { f: 240, d: 0.3, type: "sine", v: 0.14, slide: -160 });
    msg(
      `🌊 ${by ? by.name + " threw " + e.name : e.name + " was knocked"} off the raft!`,
    );
    if (e.hum)
      statusTo(e, "🌊 You are in the water — the crocodiles are coming!", 2.5);
  }
  if (wasCap) {
    const o = raftCrew()[0];
    if (o) {
      o.rcap = true;
      msg(`🛟 ${o.name} takes the tiller`);
      if (o.hum)
        statusTo(
          o,
          "🛟 You are the CAPTAIN now — steer the raft out to sea",
          3,
        );
    }
  }
}
let finCrocsDone = false,
  tideTold30 = false;
function finCrocs() {
  // four more crocodiles along the course (same places on every screen)
  if (finCrocsDone || NET.guest) return;
  finCrocsDone = true;
  for (let i = 0; i < 6; i++) {
    const p = COURSE[Math.min(COURSE.length - 1, 2 + i * 3)],
      q = COURSE[Math.max(0, Math.min(COURSE.length - 1, 2 + i * 3) - 1)];
    if (!p) break;
    const dx = p.x - q.x,
      dz = p.z - q.z,
      l = hyp(dx, dz) || 1,
      sd = i % 2 ? 9 : -9,
      x = p.x - (dz / l) * sd,
      z = p.z + (dx / l) * sd;
    if (!hit(x, 0, z, 0.8, 0.8)) crocs.push(makeCroc(x, z, false));
  }
}
function finStart() {
  FIN.on = true;
  FIN.t = FIN_T;
  FIN.need = 1;
  noShip = true;
  for (const c of chasers) {
    if (c.carry) {
      const r = c.carry;
      c.carry = null;
      r.cap = "down";
      r.by = null;
      r.pos.set(c.pos.x, c.pos.y, c.pos.z);
    }
    c.chain = false;
    if (c.ai) {
      c.ai.path = null;
      c.ai.alarm = 0;
      c.ai.smoke = null;
    }
  }
  for (const r of ents) {
    if (r.role !== "runner") continue;
    if (r.hidden) unhide(r);
    if (r.seat != null) leaveSeat(r);
    if (r.boat) leaveBoat(r);
    r.zip = null;
    if (r.cap) {
      r.cap = null;
      r.by = null;
      r.alive = true;
      r.hp = Math.max(r.hp, 70);
      r.stun = null;
      r.healed = false;
      r.resc = 0;
      r.stance = 0;
      popText("FREE!", r.pos.x, r.pos.y + 2.8, r.pos.z, "#6fe08a", 1.2);
      if (r.hum)
        statusTo(r, "🔓 The flood burst the prison open — get to the RAFT!", 4);
    }
    r.wood = r.iron = r.sail = r.wet = 0;
    r.fuel = false;
    if (r.raft == null) {
      r.ci = undefined;
      r.hop = null;
    }
    if (r.ai) {
      r.ai.path = null;
      r.ai.hideGo = null;
      r.ai.tower = null;
      r.ai.alert = 0;
    }
  }
  JAIL.slots.length = 0;
  finCrocs();
  msg(
    player.role === "chaser"
      ? "🌊 THE ISLAND IS FLOODED — the prison burst open! Knock the runners off the posts into the water before they reach the RAFT"
      : "🌊 THE ISLAND IS FLOODED — the prison burst open! Jump from post to post to the RAFT (orange on the map). Stay out of the water",
    "alarm",
  );
  setStatus(
    player.role === "chaser"
      ? "🌊 FLOOD! You swim fast now — throw them in the water"
      : "🌊 FLOOD! Parkour over the posts to the RAFT",
    4,
  );
  thunder();
  flashT = 0.3;
  beep(110, 0.9, "sine", 0.09, 60);
}
function raftBoard(dt, live) {
  for (const e of live) {
    e.raftCd = (e.raftCd || 0) - dt;
    if (e.raft != null || e.hop) continue;
    if (e.pos.y < 0.3) e.wetAt = clock;
    if (
      e.hum &&
      !RAFT.go &&
      e.raftCd <= 0 &&
      !e.stun &&
      e.pos.y > 0.5 &&
      clock - (e.wetAt || 0) > 0.8 &&
      hyp(e.pos.x - RAFT.x, e.pos.z - RAFT.z) < 3.1
    )
      raftOn(e);
    else if (
      e.hum &&
      !RAFT.go &&
      e.pos.y < 0.5 &&
      hyp(e.pos.x - RAFT.x, e.pos.z - RAFT.z) < 3.1
    )
      statusTo(
        e,
        "🛟 You cannot climb aboard from here — jump over from the last post",
        0.4,
      );
  }
}
function raftGo(crew) {
  const n = crew.length;
  RAFT.go = true;
  RAFT.v = 0;
  RAFT.yaw = Math.atan2(RAFT.x, RAFT.z);
  msg(
    `🛟 THE RAFT IS AWAY with ${n} aboard — ` +
      (player.role === "chaser"
        ? "swim after it and throw them off!"
        : "row for the open sea!"),
    "alarm",
  );
  beep(880, 0.5, "square", 0.08);
  for (const e of crew)
    if (e.hum)
      statusTo(
        e,
        e.rcap
          ? "🛟 GO! Steer out to sea — away from the chasers"
          : "🛟 GO! You are rowing",
        3,
      );
}
function raftMove(dt, crew) {
  const n = crew.length,
    cap = crew.find((e) => e.rcap) || crew[0];
  let want = RAFT.yaw;
  if (cap.hum) {
    if (hyp(cap.wx, cap.wz) > 0.3) want = Math.atan2(cap.wx, cap.wz);
  } else {
    want = Math.atan2(RAFT.x, RAFT.z);
    let c = null,
      bd = 16;
    for (const o of chasers) {
      const d = hyp(o.pos.x - RAFT.x, o.pos.z - RAFT.z);
      if (d < bd && !o.stun) {
        bd = d;
        c = o;
      }
    }
    if (c) {
      let da = Math.atan2(RAFT.x - c.pos.x, RAFT.z - c.pos.z) - want;
      while (da > Math.PI) da -= 6.283;
      while (da < -Math.PI) da += 6.283;
      want += clamp(da, -1, 1) * 0.5;
    }
  }
  let da = want - RAFT.yaw;
  while (da > Math.PI) da -= 6.283;
  while (da < -Math.PI) da += 6.283;
  RAFT.yaw += clamp(da, -1.2 * dt, 1.2 * dt);
  const sp = 5.4 + 0.7 * Math.min(4, n - 1);
  RAFT.v += (sp - RAFT.v) * Math.min(1, dt * 1.3);
  const nx = RAFT.x + Math.sin(RAFT.yaw) * RAFT.v * dt,
    nz = RAFT.z + Math.cos(RAFT.yaw) * RAFT.v * dt;
  if (hyp(nx, nz) > R_GRASS - 7 && !hit(nx, 0, nz, 1.7, 1)) {
    RAFT.x = nx;
    RAFT.z = nz;
  } else RAFT.v *= 0.4;
  if (hyp(RAFT.x, RAFT.z) > R_ISLAND + 40) endFinal(false, "w");
}
function raftEarly(dt) {
  // the last minute before the flood: the raft may leave already, but only with a full crew of five
  if (!RAFT.open) {
    RAFT.open = true;
    RAFT.hx = RAFT.x;
    RAFT.hz = RAFT.z;
    msg(
      player.role === "chaser"
        ? "🛟 LAST MINUTE — the raft can leave now if 5 runners get aboard. Guard the posts!"
        : "🛟 LAST MINUTE — the raft can leave NOW if 5 runners get aboard (at the flood one is enough)",
      "alarm",
    );
    beep(660, 0.3, "square", 0.07);
  }
  raftBoard(
    dt,
    ents.filter((e) => e.role === "runner" && e.alive),
  );
  const crew = raftCrew(),
    n = crew.length;
  if (!RAFT.go) {
    const full = n >= RSEAT.length;
    if (full && !(FIN.cast > 0)) {
      FIN.cast = 0.01;
      msg(
        `🛟 Five runners are on the raft — it casts off in ${CAST_T} seconds!`,
        "alarm",
      );
      beep(660, 0.3, "square", 0.07);
    }
    if (!full) FIN.cast = 0;
    else FIN.cast += dt;
    if (FIN.cast >= CAST_T) raftGo(crew);
    return;
  }
  if (!n) {
    RAFT.go = false;
    RAFT.x = RAFT.hx;
    RAFT.z = RAFT.hz;
    RAFT.v = 0;
    FIN.cast = 0;
    msg("🛟 The empty raft drifted back to the shore");
    return;
  }
  raftMove(dt, crew);
}
function finTick(dt) {
  if (!FIN.on) finStart();
  FIN.t -= dt;
  const live = ents.filter((e) => e.role === "runner" && e.alive);
  raftBoard(dt, live);
  const crew = raftCrew(),
    n = crew.length;
  for (const e of crew)
    if (!e.hum && !(e.pushCd > 0) && Math.random() < dt * (1 + 2 * LVL.smart)) {
      const c = nearestChaser(e);
      if (
        c &&
        !c.stun &&
        hyp(c.pos.x - e.pos.x, c.pos.z - e.pos.z) < 2.3 &&
        Math.abs(c.pos.y - e.pos.y) < 1.45
      )
        doPush(e);
    }
  if (!RAFT.go) {
    const full = n >= 1; // at the flood one runner aboard is enough: the raft casts off 8 seconds after the first one jumps on (sooner when it is full)
    if (full && !(FIN.cast > 0)) {
      FIN.cast = 0.01;
      msg(
        `🛟 A runner is on the raft — it casts off in ${CAST_T} seconds!`,
        "alarm",
      );
      beep(660, 0.3, "square", 0.07);
    }
    if (FIN.cast > 0 && (n >= RSEAT.length || n >= live.length || FIN.t <= 0))
      FIN.cast = Math.max(FIN.cast, CAST_T - 2);
    if (!full && FIN.t > 0) FIN.cast = 0;
    else if (FIN.cast > 0) FIN.cast += dt;
    if (FIN.cast >= CAST_T && n > 0) raftGo(crew);
    else if (FIN.t <= 0 && !n) endFinal(true, "t");
    return;
  }
  if (!n) {
    endFinal(true, "e");
    return;
  }
  raftMove(dt, crew);
}
function endFinal(chWon, why) {
  if (NET.guest && !NET.endOk) return;
  if (NET.host) netEnd("f", [chWon ? 1 : 0, why]);
  const crew = raftCrew(),
    isCh = player.role === "chaser";
  musPlay(
    chWon
      ? isCh
        ? "victory"
        : "defeat"
      : !isCh && player.raft != null
        ? "victory"
        : "defeat",
  );
  if (chWon) endTaunt();
  if (chWon)
    showEnd(
      "👊 CHASERS WIN",
      (why === "t"
        ? "Nobody was on the raft when the rope snapped — it drifted away empty."
        : "Every runner was thrown off the raft before it reached the open sea.") +
        (isCh ? " You win! 🎉" : " You lose."),
    );
  else {
    // v52: the same kind of send-off as the ship — the raft rows away, the crew wave and tease, the chasers rage in the water
    phase = "end";
    $("pause").classList.add("hide");
    if (document.exitPointerLock) document.exitPointerLock();
    $("endt").textContent = "🛟 ESCAPED BY RAFT!";
    $("endp").textContent =
      `${crew.map((e) => e.name).join(", ")} rowed out to the open sea.` +
      (isCh
        ? " You lose."
        : player.raft != null
          ? " You win! 🎉"
          : " (…but the raft left without you.)");
    if (cine) return;
    document.body.classList.add("cine");
    $("sndpanel").classList.add("hide");
    setStatus("");
    $("obj").innerHTML = "";
    const out = Math.atan2(RAFT.x, RAFT.z),
      ch = chasers
        .slice()
        .sort(
          (a, b) =>
            hyp(a.pos.x - RAFT.x, a.pos.z - RAFT.z) -
            hyp(b.pos.x - RAFT.x, b.pos.z - RAFT.z),
        )
        .slice(0, 4);
    cine = {
      kind: "raft",
      t: 0,
      sayT: 0.4,
      n: 0,
      out,
      riders: crew.slice(),
      ch,
      cp: ch.map((c, i) => ({
        x:
          RAFT.x -
          Math.sin(out) * (6.5 + (i >> 1) * 2.2) +
          Math.cos(out) * (i % 2 ? 1.5 : -1.5) * (1 + (i >> 1) * 0.5),
        z:
          RAFT.z -
          Math.cos(out) * (6.5 + (i >> 1) * 2.2) -
          Math.sin(out) * (i % 2 ? 1.5 : -1.5) * (1 + (i >> 1) * 0.5),
      })),
    };
  }
}
function raftCine(dt) {
  const C = cine;
  C.t += dt;
  if (C.t > 4.5 && !C.shown) {
    C.shown = true;
    $("end").classList.add("esc");
    $("end").classList.remove("hide");
  }
  let da = C.out - RAFT.yaw;
  while (da > Math.PI) da -= 6.283;
  while (da < -Math.PI) da += 6.283;
  RAFT.yaw += clamp(da, -0.9 * dt, 0.9 * dt);
  const v =
      C.t < 9
        ? Math.min(6, 2.5 + C.t * 1.2)
        : Math.max(2.2, 6 - (C.t - 9) * 1.1),
    sn = Math.sin(RAFT.yaw),
    cs = Math.cos(RAFT.yaw);
  RAFT.x += sn * v * dt;
  RAFT.z += cs * v * dt;
  if (RAFT.g) {
    RAFT.g.position.set(RAFT.x, RAFT.g.position.y, RAFT.z);
    RAFT.g.rotation.y = RAFT.yaw;
  }
  const ry = RAFT.g ? RAFT.g.position.y + 0.6 : 0.42;
  C.riders.forEach((e, i) => {
    const o = RSEAT[(e.raft != null ? e.raft : i) % RSEAT.length],
      V = e.v,
      w = Math.sin(C.t * 10 + i * 1.7);
    e.pos.set(
      RAFT.x + o[0] * cs + o[1] * sn,
      ry,
      RAFT.z - o[0] * sn + o[1] * cs,
    );
    e.vy = 0;
    e.stun = null;
    e.yaw = RAFT.yaw + Math.PI;
    V.g.visible = true;
    V.g.position.copy(e.pos);
    V.g.rotation.y = e.yaw; // they look back at the island
    V.body.position.set(0, 0, 0);
    V.body.rotation.set(0, 0, 0);
    V.body.scale.set(1, 1, 1);
    V.legL.rotation.x = w * 0.15;
    V.legR.rotation.x = -w * 0.15;
    V.armR.rotation.x = Math.PI + w * 0.25;
    V.armR.rotation.z = -0.25 + w * 0.35;
    V.armL.rotation.x = i % 2 ? Math.PI - w * 0.25 : -0.4;
    V.armL.rotation.z = i % 2 ? 0.25 - w * 0.35 : 0;
    V.head.rotation.z = w * 0.15;
  });
  C.ch.forEach((c, i) => {
    const V = c.v,
      w = Math.sin(C.t * 13 + i * 2.1),
      q = C.cp[i];
    c.pos.set(q.x, ry - 1.75 + Math.abs(Math.sin(C.t * 5 + i)) * 0.35, q.z);
    c.vy = 0;
    c.stun = null;
    c.yaw = Math.atan2(RAFT.x - q.x, RAFT.z - q.z);
    V.g.visible = true;
    V.g.position.copy(c.pos);
    V.g.rotation.y = c.yaw; // up to the chest in the water, shaking their fists
    V.body.position.set(0, 0, 0);
    V.body.rotation.set(0.1, 0, 0);
    V.body.scale.set(1, 1, 1);
    V.armL.rotation.x = Math.PI + w * 0.5;
    V.armR.rotation.x = Math.PI - w * 0.5;
    V.armL.rotation.z = V.armR.rotation.z = 0;
    V.legL.rotation.x = w * 0.4;
    V.legR.rotation.x = -w * 0.4;
    V.head.rotation.z = w * 0.12;
    if (Math.random() < dt * 5)
      puff(
        q.x + rnd(-0.6, 0.6),
        ry - 0.35,
        q.z + rnd(-0.6, 0.6),
        0xffffff,
        2,
        1.6,
      );
  });
  C.sayT -= dt;
  if (C.sayT <= 0) {
    C.sayT = C.t < 7.4 ? 0.75 : 1.6;
    C.n++;
    if (C.n % 3 && C.riders.length) {
      const r = C.riders[Math.floor(rnd(C.riders.length))];
      popText(
        [
          "BYE BYE! 👋",
          "TOO SLOW! 😜",
          "SEE YA!",
          "CATCH US NOW!",
          "NA NA NA! 😝",
          "HA HA HA!",
          "ROW ROW ROW!",
        ][Math.floor(rnd(7))],
        r.pos.x,
        ry + 2.6 + rnd(0.6),
        r.pos.z,
        "#7dffa0",
        1.0,
      );
      beep(520 + rnd(260), 0.12, "sine", 0.05, 200);
    } else if (C.ch.length) {
      const c = C.ch[Math.floor(rnd(C.ch.length))];
      popText(
        ["NOOO!", "COME BACK!", "GRRRR! 😡", "NEXT TIME!", "BLUB BLUB!"][
          Math.floor(rnd(5))
        ],
        c.pos.x,
        ry + 1.6,
        c.pos.z,
        "#ff8a80",
        1.0,
      );
      beep(150, 0.25, "sawtooth", 0.05, -40);
    }
  }
  const sm = clamp((C.t - 4) / 3.5, 0, 1),
    s2 = sm * sm * (3 - 2 * sm),
    a = Math.min(1, C.t / 7); // first the send-off with the chasers in view, then the camera travels with the raft
  const so = Math.sin(C.out),
    co = Math.cos(C.out),
    back = 5.5 * (1 - s2) - 1.5 * s2,
    side = 11 + a * 2 - s2 * 2;
  camera.position.set(
    RAFT.x - so * back + co * side,
    ry + 4.2 + a * 2 - s2 * 1.2,
    RAFT.z - co * back - so * side,
  );
  camera.lookAt(
    RAFT.x - so * (3.2 * (1 - s2)),
    ry + 0.9,
    RAFT.z - co * (3.2 * (1 - s2)),
  );
  {
    const W = innerWidth,
      Hh = innerHeight,
      wide = W > 760 && W > Hh,
      k = wide ? 0.27 * s2 : 0,
      ky = wide ? 0 : 0.16 * s2;
    if (k || ky) camera.setViewOffset(W, Hh, -W * k, -Hh * ky, W, Hh);
    else if (camera.view) camera.clearViewOffset();
  }
  if (Math.random() < dt * 14)
    puff(
      RAFT.x - sn * 2.4 + rnd(-0.8, 0.8),
      ry - 0.35,
      RAFT.z - cs * 2.4 + rnd(-0.8, 0.8),
      0xffffff,
      2,
      1.5,
    ); // wake
  sun.position.set(RAFT.x + 40, 70, RAFT.z + 25);
  sun.target.position.set(RAFT.x, 0, RAFT.z);
  sun.target.updateMatrixWorld();
}
function aiRunnerFin(e, dt) {
  // bot runner in the flood: get onto the posts, hop along them, board the raft
  const ai = e.ai;
  e.run = true;
  if (e.stance) setStance(e, 0);
  if (e.raft != null || e.hop) {
    e.wx = e.wz = 0;
    return;
  }
  const n = COURSE.length,
    taken = (k) =>
      ents.some(
        (o) =>
          o !== e &&
          o.role === "runner" &&
          o.alive &&
          (o.ci === k || (o.hop && o.hop.ci === k)),
      );
  const hop = (tx, ty, tz, ci, raft) => {
    const d = hyp(tx - e.pos.x, tz - e.pos.z);
    e.hop = {
      fx: e.pos.x,
      fy: e.pos.y,
      fz: e.pos.z,
      tx,
      ty,
      tz,
      t: 0,
      dur: 0.34 + d * 0.045,
      arc: 0.9 + d * 0.08,
      ci,
      raft: !!raft,
    };
    e.wx = e.wz = 0;
  };
  let ci = e.ci;
  if (ci != null) {
    const p = COURSE[ci];
    if (
      !p ||
      hyp(e.pos.x - p.x, e.pos.z - p.z) > 1.0 ||
      Math.abs(e.pos.y - p.y) > 0.35
    )
      ci = e.ci = undefined;
  }
  if (ci != null) {
    e.wx = e.wz = 0;
    ai.hopW = (ai.hopW || 0) - dt;
    if (ai.hopW > 0) return;
    ai.hopW = rnd(0.15, 0.55) * (1.5 - 0.6 * LVL.smart);
    if (ci === n - 1) {
      if (RAFT.go || raftCrew().length >= RSEAT.length || e.raftCd > 0) return;
      hop(RAFT.x, 0.42, RAFT.z, -1, true);
      return;
    }
    if (taken(ci + 1)) return;
    const q = COURSE[ci + 1];
    if (Math.random() < 0.08 - 0.05 * LVL.smart) {
      const dx = q.x - e.pos.x,
        dz = q.z - e.pos.z,
        l = hyp(dx, dz) || 1,
        sd = Math.random() < 0.5 ? 1.5 : -1.5;
      hop(q.x - (dz / l) * sd, 0, q.z + (dx / l) * sd, -1);
    } // misjudged it
    else hop(q.x, q.y, q.z, ci + 1);
    return;
  }
  const onJail = e.pos.y > 1.2 && hyp(e.pos.x - JAIL.x, e.pos.z - JAIL.z) < 8;
  let k = 0,
    bd = 1e9;
  if (!onJail)
    for (let i = 0; i < n; i++) {
      const d = hyp(COURSE[i].x - e.pos.x, COURSE[i].z - e.pos.z) - i * 0.4;
      if (d < bd) {
        bd = d;
        k = i;
      }
    }
  const p = COURSE[k],
    d = hyp(p.x - e.pos.x, p.z - e.pos.z);
  if (ai.wand && ai.wand.t > 0) {
    ai.wand.t -= dt;
    e.wx = Math.cos(ai.wand.a);
    e.wz = Math.sin(ai.wand.a);
    if (e.onGround && Math.random() < dt * 2) e.wantJump = true;
    return;
  }
  ai.fsT = (ai.fsT || 0) + dt;
  if (ai.fsT > 1.6) {
    if (ai.fsP && hyp(e.pos.x - ai.fsP.x, e.pos.z - ai.fsP.z) < 1 && d > 3) {
      ai.wand = {
        a: Math.atan2(p.z - e.pos.z, p.x - e.pos.x) + rnd(-1.7, 1.7),
        t: 1.3,
      };
      ai.path = null;
    }
    ai.fsT = 0;
    ai.fsP = { x: e.pos.x, z: e.pos.z };
  }
  if (d < 2.8 && e.onGround) {
    if (!taken(k)) hop(p.x, p.y, p.z, k);
    else if (
      k < n - 1 &&
      hyp(COURSE[k + 1].x - e.pos.x, COURSE[k + 1].z - e.pos.z) < 4.6 &&
      !taken(k + 1)
    )
      hop(COURSE[k + 1].x, COURSE[k + 1].y, COURSE[k + 1].z, k + 1);
    else e.wx = e.wz = 0;
  } else if (onJail || d < 14) {
    moveTo(e, p.x, p.z);
    stuckCheck(e, dt);
  } else navTo(e, p.x, p.z, dt);
}
function aiChaserFin(e, dt) {
  // bot chaser in the flood: swim to the nearest runner and knock him into the water; once the raft is away, go for the raft
  const ai = e.ai;
  e.run = true;
  ai.climb = false;
  if (e.stance) setStance(e, 0);
  let tgt = null,
    bd = 1e9;
  for (const r of ents) {
    if (r.role !== "runner" || !r.alive) continue;
    let d = hyp(r.pos.x - e.pos.x, r.pos.z - e.pos.z);
    if (r.raft != null) d -= RAFT.go ? 60 : 8;
    else if (RAFT.go) d += 40;
    if (r === ai.tgt) d -= 3;
    if (chasers.some((o) => o !== e && o.ai && o.ai.tgt === r) && !RAFT.go)
      d += 7;
    if (d < bd) {
      bd = d;
      tgt = r;
    }
  }
  ai.tgt = tgt;
  if (!tgt) {
    e.wx = e.wz = 0;
    return;
  }
  const dx = tgt.pos.x - e.pos.x,
    dz = tgt.pos.z - e.pos.z,
    d = hyp(dx, dz) || 0.01,
    dy = tgt.pos.y - e.pos.y;
  if (d < 2.2 && Math.abs(dy) < 1.65) {
    e.wx = (dx / d) * 0.2;
    e.wz = (dz / d) * 0.2;
    if (!e.atk) e.yaw = Math.atan2(dx, dz);
    if (ai.react <= 0 && !e.atk && e.cd <= 0) {
      ai.react = rnd(LVL.react[0], LVL.react[1]) + 0.35;
      if (
        e.pushCd <= 0 &&
        Math.abs(dy) < 1.45 &&
        (tgt.raft != null || Math.random() < 0.45) &&
        !chasers.some(
          (o) => o !== e && hyp(o.pos.x - e.pos.x, o.pos.z - e.pos.z) < d,
        )
      )
        doPush(e);
      else startAttack(e, Math.random() < 0.5 ? "kick" : "punch");
    }
    return;
  }
  if (d < 3.2 && dy > 1.0 && e.onGround) e.wantJump = true;
  if (
    d < 22 ||
    hyp(e.pos.x, e.pos.z) > R_GRASS - 10 ||
    hyp(tgt.pos.x, tgt.pos.z) > R_GRASS - 3
  ) {
    e.wx = dx / d;
    e.wz = dz / d;
    stuckCheck(e, dt);
  } else navTo(e, tgt.pos.x, tgt.pos.z, dt);
}
buildWorld();
buildExtras();
buildLobby();
buildMountain();
buildFinal();
buildNav();
buildNavC();
TIDE0 = R_ISLAND + hyp(JAIL.x, JAIL.z) + 2;
tideR = TIDE0;
tideMesh.position.x = foamMesh.position.x = JAIL.x;
tideMesh.position.z = foamMesh.position.z = JAIL.z;
tideMesh.scale.set(TIDE0, TIDE0, 1);
foamMesh.scale.set(TIDE0, TIDE0, 1);
camera.position.set(30, 30, 110);
camera.lookAt(0, 0, 0);
let lastT = performance.now(),
  menuA = 0;
/* ---- menu backdrop: a chaser beating a runner (fists and kicks) on the beach, framed in the space right of the menu ---- */
const MENU = {
  g: null,
  c: null,
  r: null,
  col: -1,
  hat: "",
  name: null,
  lab: null,
  t: 0,
  n: 0,
  hitDone: false,
  x: 0,
  z: 123.5,
  txt: null,
  txtT: 0,
  star: null,
};
const MENU_MOVES = ["punchR", "punchL", "kick", "punchL", "punchR", "kick"];
function menuScene(dt, stop) {
  if (stop) {
    if (MENU.txt) {
      MENU.g.remove(MENU.txt);
    }
    scene.remove(MENU.g);
    MENU.g = null;
    camera.clearViewOffset();
    camera.updateProjectionMatrix();
    return;
  }
  if (!MENU.g) {
    MENU.g = new THREE.Group();
    MENU.g.position.set(MENU.x, -0.03, MENU.z);
    scene.add(MENU.g);
    MENU.c = makeChar(0xc9302c, true);
    MENU.c.g.rotation.y = Math.PI / 2;
    MENU.g.add(MENU.c.g);
    MENU.star = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.13, 0),
      new THREE.MeshBasicMaterial({ color: 0xffe14d }),
    );
    MENU.star.visible = false;
    MENU.g.add(MENU.star);
  }
  if (MENU.col !== custom.color || MENU.hat !== custom.hat) {
    // the runner wears what you pick in the menu
    if (MENU.r) MENU.g.remove(MENU.r.g);
    MENU.col = custom.color;
    MENU.hat = custom.hat;
    MENU.r = makeChar(custom.color, false);
    MENU.r.g.rotation.y = -Math.PI / 2;
    MENU.g.add(MENU.r.g);
    addHat({ v: MENU.r }, custom.hat);
    MENU.name = null;
  }
  {
    const nm = (($("pname").value || "").trim() || "You").slice(0, 12);
    if (nm !== MENU.name) {
      MENU.name = nm;
      if (MENU.lab) {
        MENU.lab.parent && MENU.lab.parent.remove(MENU.lab);
        MENU.lab.material.map.dispose();
        MENU.lab.material.dispose();
      }
      const l = textSprite(nm, "#ffffff", 48);
      l.scale.set(0.5 * l.userData.aspect, 0.5, 1);
      MENU.lab = l;
    }
    if (MENU.lab.parent !== MENU.r.g) MENU.r.g.add(MENU.lab);
    MENU.lab.position.y =
      { tophat: 2.85, party: 2.95, crown: 2.7, helmet: 2.6, cap: 2.5 }[
        custom.hat
      ] || 2.4;
  }
  const c = MENU.c,
    r = MENU.r,
    mv = MENU_MOVES[MENU.n % MENU_MOVES.length],
    kick = mv === "kick",
    T = kick ? 0.95 : 0.6,
    HIT = kick ? 0.36 : 0.3;
  MENU.t += dt;
  if (MENU.t > T) {
    MENU.t -= T;
    MENU.hitDone = false;
    MENU.n++;
  }
  const k = MENU.t / T,
    sw = k < HIT ? k / HIT : Math.max(0, 1 - (k - HIT) / 0.4),
    rec = k < HIT ? 0 : Math.max(0, 1 - (k - HIT) / 0.55),
    side = mv === "punchL" ? -1 : 1;
  // chaser
  c.browL.rotation.z = -0.35;
  c.browR.rotation.z = 0.35;
  c.mouth.scale.set(0.2, 0.09, 0.03);
  c.armL.rotation.x = -0.8;
  c.armR.rotation.x = -0.8;
  c.legL.rotation.x = 0.35;
  c.legR.rotation.x = -0.35;
  c.body.rotation.set(0.12, 0, 0);
  c.g.position.set(-0.78, 0, 0);
  if (kick) {
    c.legR.rotation.x = -1.7 * sw;
    c.legL.rotation.x = 0.15;
    c.body.rotation.x = -0.32 * sw;
    c.armL.rotation.x = -0.3;
    c.armR.rotation.x = 0.5 * sw;
    c.g.position.x = -0.78 + 0.2 * sw;
  } else {
    (side > 0 ? c.armR : c.armL).rotation.x = -1.65 * sw;
    (side > 0 ? c.armL : c.armR).rotation.x = -0.75 + 0.3 * sw;
    c.body.rotation.x = 0.12 + 0.2 * sw;
    c.body.rotation.y = -side * 0.35 * sw;
    c.g.position.x = -0.78 + 0.16 * sw;
  }
  // runner
  r.browL.rotation.z = 0.4;
  r.browR.rotation.z = -0.4;
  r.mouth.scale.set(0.14, 0.14, 0.03);
  r.armL.rotation.z = 0.35;
  r.armR.rotation.z = -0.35;
  r.legR.rotation.x = 0.3;
  if (kick) {
    r.body.rotation.x = -0.1 + 0.75 * rec;
    r.head.rotation.x = 0.3 * rec;
    r.head.rotation.z = 0;
    r.armL.rotation.x = r.armR.rotation.x = -2.4 + 1.5 * rec;
    r.legL.rotation.x = -0.3 + 0.5 * rec;
    r.g.position.set(0.78 + 0.55 * rec, Math.sin(rec * Math.PI) * 0.22, 0);
  } else {
    r.body.rotation.x = -0.12 - 0.5 * rec;
    r.head.rotation.x = -0.5 * rec;
    r.head.rotation.z = side * 0.35 * rec;
    r.armL.rotation.x = r.armR.rotation.x = -2.5 + 0.5 * rec;
    r.legL.rotation.x = -0.3 - 0.3 * rec;
    r.g.position.set(0.78 + 0.3 * rec, Math.sin(rec * Math.PI) * 0.08, 0);
  }
  // impact: one star flash and ONE word at a time
  if (k >= HIT && !MENU.hitDone) {
    MENU.hitDone = true;
    MENU.star.position.set(0.3, kick ? 0.95 : 1.5, 0.05);
    MENU.starT = 0.16;
    if (MENU.txt) {
      MENU.g.remove(MENU.txt);
      MENU.txt.material.map.dispose();
      MENU.txt.material.dispose();
    }
    const words = kick
        ? ["KICK!", "OOF!", "THUD!"]
        : ["POW!", "BAM!", "WHACK!", "OUCH!"],
      t = textSprite(
        words[Math.floor(Math.random() * words.length)],
        kick ? "#ff9a3d" : "#ffe14d",
      );
    t.userData.s = 0.62;
    t.position.set(-0.55, 3.0, 0);
    MENU.g.add(t);
    MENU.txt = t;
    MENU.txtT = 0;
  }
  if (MENU.starT > 0) {
    MENU.starT -= dt;
    MENU.star.visible = true;
    const q = 1 + (0.16 - MENU.starT) * 9;
    MENU.star.scale.set(q, q, q);
    MENU.star.rotation.z += dt * 9;
  } else MENU.star.visible = false;
  if (MENU.txt) {
    MENU.txtT += dt;
    const q = MENU.txtT,
      sc =
        MENU.txt.userData.s *
        (q < 0.1 ? 0.5 + q * 6 : 1.1 - Math.min(0.1, (q - 0.1) * 0.5));
    MENU.txt.scale.set(sc * MENU.txt.userData.aspect, sc, 1);
    MENU.txt.position.y = 3.0 + q * 0.35;
    MENU.txt.material.opacity = q < 0.3 ? 1 : Math.max(0, 1 - (q - 0.3) / 0.22);
  }
  // camera: subject centred in the free space right of the menu card
  const card = document.querySelector("#menu .card"),
    wide = innerWidth > 820,
    right = wide && card ? card.getBoundingClientRect().right : 0;
  const a = Math.sin(menuA * 2.2) * 0.3 + 0.2,
    dist = wide ? 6.6 : 8;
  camera.position.set(
    MENU.x + Math.sin(a) * dist,
    2.0,
    MENU.z + Math.cos(a) * dist,
  );
  camera.lookAt(MENU.x, wide ? 0.75 : 1.3, MENU.z);
  if (wide)
    camera.setViewOffset(
      innerWidth,
      innerHeight,
      -right / 2,
      0,
      innerWidth,
      innerHeight,
    );
  else camera.clearViewOffset();
  sun.position.set(MENU.x + 40, 80, MENU.z + 30);
  sun.target.position.set(MENU.x, 0, MENU.z);
  sun.target.updateMatrixWorld();
}
function frame(now, bg) {
  if (!bg) requestAnimationFrame(frame);
  const rawDt = (now - lastT) / 1000,
    dt = Math.max(0, Math.min(0.05, rawDt));
  lastT = now;
  clock += dt;
  qTick(rawDt);
  if (phase === "menu") {
    menuA += dt * 0.1;
    menuScene(dt);
    renderer.render(scene, camera);
    return;
  }
  if (MENU.g) menuScene(0, true);
  if ((paused && !NET.guest) || (NET.guest && NET.hp)) {
    renderer.render(scene, camera);
    return;
  }
  if (NET.guest) netGuestFrame(dt);
  helpTick(dt);
  beatTick();
  chaseTick(dt);
  jigTick();
  if (phase === "lobby") {
    lobbyT -= dt;
    if (lobbyT <= 0) {
      phase = "game";
      scene.remove(lobbyGroup);
      trapBudget = Math.min(trapBudget, 4);
      msg("🚨 The lobby is OPEN — RUN!");
      setStatus(
        player.role === "chaser" ? "🚨 HUNT THEM DOWN!" : "🚨 RUN!",
        2.5,
      );
      beep(880, 0.4, "square", 0.08);
    }
  } else if (phase === "game") {
    if (!XP.on || XP.run) roundT -= dt;
    trapRegen += dt;
    if (XP.on) {
      if (player.hp < 40) player.hp = 100;
      if (XP.fast) player.boost = 0.5;
    }
    if (trapRegen > 22) {
      trapRegen = 0;
      if (trapBudget < 4) trapBudget++;
    }
    if (!ents.some((e) => e.role === "runner" && e.alive)) endGame(true);
    else {
      if (roundT <= 0) {
        roundT = 0;
        if (!NET.guest) finTick(dt);
      } else if (roundT <= 60 && !NET.guest) raftEarly(dt);
      if (phase === "game") updateWeather(dt);
    }
  }
  for (const e of ents) {
    if (XP.on && !e.isPlayer && e.role !== "decoy") {
      if (e.v.g.visible) {
        e.v.g.visible = false;
        e.pos.set(400, 90, 400);
        e.wx = e.wz = 0;
      }
      continue;
    } // explore mode: nobody else is on the island
    if (NET.guest) {
      if (e.isPlayer) {
        if (e.alive && phase !== "end") playerInput(e);
        else e.wx = e.wz = 0;
        NET.wx = e.wx;
        NET.wz = e.wz;
        if (NET.pred) netPredict(e, dt);
      }
      footstep(e, dt);
      updateVisual(e, dt);
      continue;
    }
    if (!e.alive || phase === "end") {
      e.wx = e.wz = 0;
    } else if (e.isPlayer) playerInput(e);
    else if (e.rid) {
      const i = NET.inp[e.rid];
      if (i) {
        e.wx = i.wx;
        e.wz = i.wz;
        e.run = i.run;
      } else e.wx = e.wz = 0;
    } else if (e.role === "chaser") aiChaser(e, dt);
    else if (e.role === "decoy") aiDecoy(e, dt);
    else aiRunner(e, dt);
    if (e.role === "runner") {
      const wl = hyp(e.wx, e.wz);
      if (wl > 0.3) {
        const jx = e.wx / wl,
          jz = e.wz / wl;
        if (
          e.jx !== undefined &&
          jx * e.jx + jz * e.jz < 0.2 &&
          clock - (e.jT || 0) < 0.6
        )
          e.jig = clock;
        if (e.jx === undefined || jx * e.jx + jz * e.jz < 0.9) {
          e.jx = jx;
          e.jz = jz;
          e.jT = clock;
        }
      }
      const c = nearestChaser(e);
      e.scared =
        phase === "game" && hyp(c.pos.x - e.pos.x, c.pos.z - e.pos.z) < 16;
    }
    if (e.pryT > clock) e.wx = e.wz = 0; // a bot stands at the crate until it is open
    stepEnt(e, dt);
    updateVisual(e, dt);
  }
  updateTraps(dt);
  updateItems(dt);
  updateProjs(dt);
  updateExtras(dt);
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i];
    f.t += dt;
    f.up(dt);
    if (f.t >= f.life) {
      f.end();
      fx.splice(i, 1);
    }
  }
  if (statusT < 900) {
    statusT -= dt;
    if (statusT <= 0) {
      $("status").textContent = "";
      $("status")._t = "";
      statusT = 999;
    }
  }
  if (cine) cineUpdate(dt);
  else updateCamera(dt);
  updateHud(dt);
  if (NET.host) netHostFrame(dt);
  renderer.render(scene, camera);
}
/* ================= multiplayer: the room creator's browser runs the round, everyone else mirrors it ================= */
const NSKIP = new Set([
  "shipT",
  "shipP",
  "shipN",
  "pryT",
  "hop",
  "ci",
  "wetAt",
  "raftCd",
  "dryT",
  "v",
  "label",
  "ai",
  "walk",
  "stepT",
  "isPlayer",
  "rid",
  "hum",
  "pid",
  "nid",
  "cy",
  "seen",
  "name",
  "role",
  "color",
  "hat",
  "hat0",
  "stTxt",
  "stAt",
  "heldMesh",
]);
const NOPE = Symbol("nope"),
  r3 = (v) =>
    Number.isFinite(v)
      ? Math.round(v * 1000) / 1000
      : v > 0
        ? 1e9
        : v < 0
          ? -1e9
          : 0;
const isEnt = (v) => v.pos && v.inv && v.label && v.v;
function netNew(e) {
  e.nid = ++NET.nid;
  NET.byId.set(e.nid, e);
  if (NET.host)
    NET.ev.push(["ne", e.nid, e.name, e.role, e.color, e.hat || "none"]);
}
function nenc(v, d) {
  if (v === null) return null;
  if (v === undefined) return undefined;
  const t = typeof v;
  if (t === "number") return r3(v);
  if (t === "string" || t === "boolean") return v;
  if (t !== "object") return NOPE;
  if (isEnt(v)) {
    if (!v.nid) netNew(v);
    return { $e: v.nid };
  }
  if (v.isVector3) return { $v: [r3(v.x), r3(v.y), r3(v.z)] };
  const rg = NET.regIdx.get(v);
  if (rg) return { $r: rg };
  if (d > 2) return NOPE;
  if (Array.isArray(v)) {
    if (v.length > 24) return NOPE;
    const a = [];
    for (const x of v) {
      const q = nenc(x, d + 1);
      if (q === NOPE) return NOPE;
      a.push(q === undefined ? null : q);
    }
    return a;
  }
  if (Object.getPrototypeOf(v) !== Object.prototype) return NOPE;
  const o = {};
  for (const k in v) {
    const q = nenc(v[k], d + 1);
    if (q === NOPE) return NOPE;
    if (q !== undefined) o[k] = q;
  }
  return o;
}
function ndec(q, cur) {
  if (q === null || typeof q !== "object") return q;
  if (q.$u) return undefined;
  if (q.$e) return NET.byId.get(q.$e) || null;
  if (q.$v)
    return cur && cur.isVector3
      ? cur.set(q.$v[0], q.$v[1], q.$v[2])
      : new THREE.Vector3(q.$v[0], q.$v[1], q.$v[2]);
  if (q.$r) {
    const a = NET.reg[q.$r[0]];
    return a ? a[q.$r[1]] : null;
  }
  if (Array.isArray(q)) return q.map((x) => ndec(x));
  const o = {};
  for (const k in q) o[k] = ndec(q[k]);
  return o;
}
function nfull(o) {
  const d = {};
  for (const k of Object.keys(o)) {
    if (NSKIP.has(k)) continue;
    const q = nenc(o[k], 1);
    if (q !== NOPE && q !== undefined) d[k] = q;
  }
  return d;
}
function ndelta(key, o) {
  // only what changed since the last time
  let c = NET.cache.get(key);
  if (!c) NET.cache.set(key, (c = {}));
  let d = null;
  for (const k of Object.keys(o)) {
    if (NSKIP.has(k)) continue;
    const q = nenc(o[k], 1);
    if (q === NOPE) continue;
    const s =
      q === undefined
        ? "u"
        : typeof q === "object" && q !== null
          ? JSON.stringify(q)
          : q;
    if (c[k] !== s) {
      c[k] = s;
      (d || (d = {}))[k] = q === undefined ? { $u: 1 } : q;
    }
  }
  return d;
}
const NG = {
  get() {
    return {
      lobbyT,
      roundT,
      trapBudget,
      shipWait,
      ironN,
      fuelDone,
      boatT,
      woodDone,
      ironDone,
      sailDone,
      chainsMade,
      readyTold,
      shipGone,
      shipGoneT,
      noShip,
      tideR,
      stormK,
      stormOn,
      boltT,
      flashT,
      tideWarn,
      seaCrocsOn,
      crocS: crocs.map((c) => (c.riv ? 2 : c.sea ? 1 : 0)).join(""),
    };
  },
  set(o) {
    const h = (k) => k in o && (o[k] === null || typeof o[k] !== "object");
    if (h("lobbyT")) lobbyT = o.lobbyT;
    if (h("roundT")) roundT = o.roundT;
    if (h("trapBudget")) trapBudget = o.trapBudget;
    if (h("shipWait")) shipWait = o.shipWait;
    if (h("ironN")) ironN = o.ironN;
    if (h("crocS"))
      for (let i = crocs.length; i < o.crocS.length; i++)
        crocs.push(makeCroc(0, -500, +o.crocS[i])); // crocodiles exist on the host first; every other screen gets the same ones
    if (h("fuelDone")) fuelDone = o.fuelDone;
    if (h("boatT")) boatT = o.boatT;
    if (h("woodDone")) woodDone = o.woodDone;
    if (h("ironDone")) ironDone = o.ironDone;
    if (h("sailDone")) sailDone = o.sailDone;
    if (h("chainsMade")) chainsMade = o.chainsMade;
    if (h("readyTold")) readyTold = o.readyTold;
    if (h("shipGone")) shipGone = o.shipGone;
    if (h("shipGoneT")) shipGoneT = o.shipGoneT;
    if (h("noShip")) noShip = o.noShip;
    if (h("tideR")) tideR = o.tideR;
    if (h("stormK")) stormK = o.stormK;
    if (h("stormOn")) stormOn = o.stormOn;
    if (h("boltT")) boltT = o.boltT;
    if (h("flashT")) flashT = o.flashT;
    if (h("tideWarn")) tideWarn = o.tideWarn;
    if (h("seaCrocsOn")) seaCrocsOn = o.seaCrocsOn;
  },
};
function netHuman(e, h, mp) {
  if (!h) return;
  e.pid = h.id;
  e.hat0 = h.hat;
  if (mp.host && h.id !== mp.you) {
    e.rid = h.id;
    e.hum = true;
    e.cy = 0;
  }
}
function netBegin(mp) {
  NET.nid = 0;
  NET.byId = new Map();
  for (const e of ents) {
    e.nid = ++NET.nid;
    NET.byId.set(e.nid, e);
  }
  if (!mp) return;
  NET.on = true;
  NET.host = !!mp.host;
  NET.guest = !mp.host;
  NET.run = true;
  NET.ev = [];
  NET.cache = new Map();
  NET.mir = new Map();
  NET.wmir = new Map();
  NET.gm = {};
  NET.inp = {};
  NET.acts = [];
  NET.reg = {
    SEATS,
    leaks,
    boats,
    zips,
    crocs,
    spots,
    tramps,
    ladders,
    towers,
    mons: MT.mons,
    fires: FIRES,
    one: [CHAIN, JAIL, SHIP, MT, SHIPFX, FIN, RAFT],
  };
  NET.regIdx = new Map();
  for (const n in NET.reg)
    NET.reg[n].forEach((o, i) => {
      if (o && typeof o === "object") NET.regIdx.set(o, [n, i]);
    });
  document.body.classList.add("mp");
  const h1 = document.querySelector("#paused h1");
  if (h1)
    h1.textContent = NET.host
      ? "⏸ PAUSED — for everyone"
      : "☰ MENU — only the host can pause the round";
  const eb = document.querySelector("#end button");
  if (eb) eb.textContent = "Back to the room";
  if (NET.host && !NET.bg) {
    try {
      NET.bg = new Worker(
        URL.createObjectURL(
          new Blob(["setInterval(()=>postMessage(0),40)"], {
            type: "text/javascript",
          }),
        ),
      );
      NET.bg.onmessage = () => {
        if (NET.host && document.hidden && phase !== "menu")
          frame(performance.now(), true);
      };
    } catch (e) {}
  }
}
/* --- wire --- */
const NZ =
  typeof CompressionStream !== "undefined" &&
  typeof DecompressionStream !== "undefined";
async function nzip(str) {
  const raw = new TextEncoder().encode(str);
  if (!NZ) {
    const b = new Uint8Array(raw.length + 1);
    b[0] = 0;
    b.set(raw, 1);
    return b;
  }
  const cs = new CompressionStream("deflate-raw"),
    w = cs.writable.getWriter();
  w.write(raw);
  w.close();
  const z = new Uint8Array(await new Response(cs.readable).arrayBuffer()),
    b = new Uint8Array(z.length + 1);
  b[0] = 1;
  b.set(z, 1);
  return b;
}
async function nunzip(buf) {
  const b = new Uint8Array(buf);
  if (b[0] === 0) return new TextDecoder().decode(b.subarray(1));
  const ds = new DecompressionStream("deflate-raw"),
    w = ds.writable.getWriter();
  w.write(b.subarray(1));
  w.close();
  return await new Response(ds.readable).text();
}
const netSend = (o) => {
  if (NET.ws && NET.ws.readyState === 1) NET.ws.send(JSON.stringify(o));
};
/* --- host side --- */
function netHostFrame(dt) {
  const nowT = performance.now();
  if (NET.tS > 0 && nowT - NET.tS < 48) return;
  if (NET.ws && NET.ws.bufferedAmount > 60000 && NET.tS > 0) return; // slow connection: wait instead of piling up old news (changes are kept for the next update)
  NET.tS = nowT;
  NET.tick = (NET.tick || 0) + 1;
  const o = { c: r3(clock), ph: phase };
  for (const e of ents) if (!e.nid) netNew(e);
  const E = {};
  for (const e of ents) {
    const d = ndelta("e" + e.nid, e);
    if (d) E[e.nid] = d;
  }
  o.e = E;
  if (NET.tick % 3 === 0) {
    const W = {};
    for (const n in NET.reg) {
      const arr = NET.reg[n];
      for (let i = 0; i < arr.length; i++) {
        const d = ndelta(n + "#" + i, arr[i]);
        if (d) (W[n] || (W[n] = {}))[i] = d;
      }
    }
    o.w = W;
  }
  const g = ndelta("G", NG.get());
  if (g) o.g = g;
  const its = items.map((i) => [
      i.type,
      r3(i.x),
      r3(i.z),
      r3(i.y),
      i.crate ? 1 : 0,
      i.wet ? 1 : 0,
    ]),
    isg = JSON.stringify(its);
  if (isg !== NET.itSig) {
    NET.itSig = isg;
    o.it = its;
  }
  const trs = traps.map((t) => [
      t.type,
      r3(t.x),
      r3(t.z),
      t.owner,
      t.sprung ? 1 : 0,
    ]),
    tsg = JSON.stringify(trs);
  if (tsg !== NET.trSig) {
    NET.trSig = tsg;
    o.tr = trs;
  }
  o.ev = NET.ev;
  NET.ev = [];
  const s = JSON.stringify(o);
  NET.q = NET.q
    .then(() => nzip(s))
    .then((b) => {
      if (NET.ws && NET.ws.readyState === 1 && NET.ws.bufferedAmount < 2e6)
        NET.ws.send(b);
    })
    .catch(() => {});
}
function netCall(name, fn, e, a) {
  // things that put something new into the world (a flying net, smoke, a banana peel…) are repeated on every screen
  if (!NET.host) return fn(e, ...a);
  const st = nfull(e),
    sig = projs.length + fx.length + smokes.length + peels.length,
    r = fn(e, ...a);
  if (projs.length + fx.length + smokes.length + peels.length !== sig)
    NET.ev.push(["c", name, e.nid, st]);
  return r;
}
function netStatus(e, t, dur) {
  const now = performance.now();
  if (e.stTxt === t && now - e.stAt < 400) return;
  e.stTxt = t;
  e.stAt = now;
  NET.ev.push(["st", e.rid, t, dur || 0]);
}
function statusTo(e, t, dur) {
  if (e.isPlayer) setStatus(t, dur);
  else if (NET.host && e.rid) netStatus(e, t, dur);
}
function netEnd(kind, arg) {
  NET.ev.push(["end", kind, arg]);
  NET.tS = 0;
  netSend({ t: "over" });
}
function netInput(m) {
  const e = ents.find((x) => x.rid === m.id);
  if (!e) return;
  const l = Math.hypot(m.wx, m.wz),
    k = l > 1 ? 1 / l : 1;
  NET.inp[m.id] = { wx: m.wx * k, wz: m.wz * k, run: m.run, cy: m.cy };
  e.cy = m.cy;
  for (const a of m.a) {
    if (phase === "menu" || phase === "end" || paused) break;
    if (a === "skip") continue;
    SUBJ = e;
    try {
      actFor(e, a);
    } catch (err) {
      console.warn(err);
    }
    SUBJ = null;
  }
}
function netGone(id) {
  const e = ents.find((x) => x.rid === id);
  if (!e) return;
  e.rid = null;
  e.hum = false;
  delete NET.inp[id];
  if (phase !== "end") msg(`👋 ${e.name} left — a bot takes over`);
}
/* --- guest side --- */
function netApplyEnt(e, m, dt, snap, skip) {
  for (const k in m) {
    const q = m[k];
    if (skip && NPRED.has(k)) {
      if (k === "pos" && q.$v) NET.hpos = q.$v;
      continue;
    }
    if (k === "pos") {
      const p = q.$v;
      if (!p) continue;
      const d =
        Math.abs(p[0] - e.pos.x) +
        Math.abs(p[1] - e.pos.y) +
        Math.abs(p[2] - e.pos.z);
      if (snap || d > 7) e.pos.set(p[0], p[1], p[2]);
      else {
        const a = Math.min(1, dt * 15);
        e.pos.x += (p[0] - e.pos.x) * a;
        e.pos.y += (p[1] - e.pos.y) * a;
        e.pos.z += (p[2] - e.pos.z) * a;
      }
      continue;
    }
    if (k === "yaw" && !snap) {
      const d = q - e.yaw;
      e.yaw += Math.atan2(Math.sin(d), Math.cos(d)) * Math.min(1, dt * 13);
      continue;
    }
    e[k] = q !== null && typeof q === "object" ? ndec(q, e[k]) : q;
  }
}
function netApplyObj(n, t, d) {
  for (const k in d) {
    const q = d[k];
    t[k] = q !== null && typeof q === "object" ? ndec(q, t[k]) : q;
  }
  if (
    n === "leaks" &&
    t.g &&
    (t.g.position.x !== t.x || t.g.position.z !== t.z)
  ) {
    t.g.position.set(t.x, 0, t.z);
    if (t.tags) for (const k in t.tags) t.tags[k].position.set(t.x, 1.5, t.z);
  }
}
const NPRED = new Set([
  "pos",
  "yaw",
  "vy",
  "onGround",
  "moving",
  "wantJump",
  "wx",
  "wz",
  "run",
  "kx",
  "kz",
]);
function netFree(e) {
  return (
    e.alive &&
    !e.stun &&
    !e.cap &&
    e.seat == null &&
    e.raft == null &&
    !e.zip &&
    !e.boat &&
    !e.hidden &&
    !e.climbing &&
    !e.charge &&
    !e.onLadder &&
    !e.digging &&
    phase !== "end"
  );
}
function netPredict(e, dt) {
  // your own character moves at once on your screen; the host's answer only corrects it when the two drift apart
  e.run = NET.run;
  let wx = e.wx,
    wz = e.wz,
    wl = hyp(wx, wz);
  if (wl > 1) {
    wx /= wl;
    wz /= wl;
    wl = 1;
  }
  const inWater = e.pos.y < -0.2;
  let sp = (e.run ? (e.role === "chaser" ? 8.4 : 8.0) : 4.3) * SPD[e.stance];
  if (e.fuel) sp *= 0.82;
  if (e.chain) sp *= 0.88;
  if (e.sail) sp *= 0.9;
  if (e.wood) sp *= 1 - 0.035 * e.wood;
  if (e.iron) sp *= 1 - 0.05 * e.iron;
  sp *= tideSlow(e);
  if (e.run) sp *= 1 - 0.08 * stormK;
  if (e.slow > 0) sp *= 0.5;
  if (e.boost > 0) sp *= 1.6;
  if (inWater)
    sp *=
      hyp(e.pos.x, e.pos.z) > R_ISLAND
        ? e.role === "chaser"
          ? FIN.on
            ? 0.8
            : 0.6
          : 0.45
        : e.role === "chaser"
          ? FIN.on
            ? 0.9
            : 0.5
          : 0.5;
  if (e.atk) sp *= 0.35;
  if (wl > 0.05 && !e.atk) {
    const ty = Math.atan2(wx, wz);
    let d = ty - e.yaw;
    while (d > Math.PI) d -= 6.283;
    while (d < -Math.PI) d += 6.283;
    e.yaw += d * Math.min(1, dt * 14);
  }
  if (NET.jump && e.onGround && e.stance === 0) {
    e.vy = JUMP;
    e.onGround = false;
    beep(300, 0.1, "sine", 0.05, 200);
  }
  NET.jump = false;
  const ox = e.pos.x,
    oz = e.pos.z;
  if (wx) tryMove(e, e.pos.x + wx * sp * dt, e.pos.z);
  if (wz) tryMove(e, e.pos.x, e.pos.z + wz * sp * dt);
  if (phase === "lobby") {
    const dx = e.pos.x - LOBBY.x,
      dz = e.pos.z - LOBBY.z,
      d = hyp(dx, dz) || 1;
    if (e.role === "runner" && d > LOBBY.r - 0.5) {
      e.pos.x = LOBBY.x + (dx / d) * (LOBBY.r - 0.5);
      e.pos.z = LOBBY.z + (dz / d) * (LOBBY.r - 0.5);
    }
    if (e.role === "chaser" && d < LOBBY.r + 1.2) {
      e.pos.x = LOBBY.x + (dx / d) * (LOBBY.r + 1.2);
      e.pos.z = LOBBY.z + (dz / d) * (LOBBY.r + 1.2);
    }
  }
  const rr = hyp(e.pos.x, e.pos.z),
    rmax = R_ISLAND + (FIN.on || RAFT.go ? 46 : 14);
  if (rr > rmax) {
    e.pos.x *= rmax / rr;
    e.pos.z *= rmax / rr;
  }
  e.vy -= GRAV * dt;
  let ny = e.pos.y + e.vy * dt;
  if (e.vy <= 0) {
    let floor = groundY(e.pos.x, e.pos.z);
    const r = RAD * 0.9,
      x = e.pos.x,
      z = e.pos.z;
    for (let i = 0; i < colliders.length; i++) {
      const b = colliders[i];
      if (
        x + r > b.x0 &&
        x - r < b.x1 &&
        z + r > b.z0 &&
        z - r < b.z1 &&
        b.y1 <= e.pos.y + 0.05 &&
        b.y1 > floor
      )
        floor = b.y1;
    }
    if (ny <= floor) {
      ny = floor;
      e.vy = 0;
      e.onGround = true;
    } else e.onGround = false;
  } else {
    if (hit(e.pos.x, ny, e.pos.z, RAD, H[e.stance])) {
      ny = e.pos.y;
      e.vy = 0;
    }
    e.onGround = false;
  }
  e.pos.y = ny;
  e.moving = hyp(e.pos.x - ox, e.pos.z - oz) / Math.max(dt, 1e-4);
  const h = NET.hpos;
  if (h) {
    const dx = h[0] - e.pos.x,
      dz = h[2] - e.pos.z,
      d = hyp(dx, dz),
      lim = 1.2 + sp * 0.4;
    NET.stillT = wl < 0.05 ? (NET.stillT || 0) + dt : 0;
    if (d > 10) {
      e.pos.set(h[0], h[1], h[2]);
      e.vy = 0;
    } else if (d > lim || (NET.stillT > 0.45 && d > 0.12)) {
      const a = Math.min(1, dt * (d > lim ? 8 : 6));
      e.pos.x += dx * a;
      e.pos.z += dz * a;
    }
    const dy = h[1] - e.pos.y;
    if (Math.abs(dy) > 1.3) {
      e.pos.y += dy * Math.min(1, dt * 10);
      e.vy = 0;
    }
  }
}
function netGuestFrame(dt) {
  for (const e of ents) {
    const m = NET.mir.get(e.nid),
      capWas = e.cap;
    if (m) {
      if (e.isPlayer) {
        netApplyEnt(e, m, dt, false, true);
        NET.pred = netFree(e);
        if (!NET.pred) {
          netApplyEnt(
            e,
            {
              pos: m.pos,
              yaw: m.yaw,
              vy: m.vy,
              onGround: m.onGround,
              moving: m.moving,
            },
            dt,
          );
          NET.stillT = 0;
        }
      } else netApplyEnt(e, m, dt);
    }
    if (capWas === "tied" && !e.cap && e.role === "runner") say(e, THANKS);
    if (
      capWas !== "down" &&
      capWas !== "tied" &&
      (e.cap === "down" || e.cap === "tied") &&
      e.role === "runner"
    ) {
      let bc = null,
        bd = 1e9;
      for (const c of chasers) {
        const d = hyp(c.pos.x - e.pos.x, c.pos.z - e.pos.z);
        if (d < bd) {
          bd = d;
          bc = c;
        }
      }
      if (bc) say(bc, HAH);
    }
    if (e.stun && e.stun.type === "net" && !e.netMesh) {
      e.netMesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1.05, 1),
        new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true }),
      );
      e.netMesh.position.y = 0.95;
      e.v.g.add(e.netMesh);
    }
  }
  if (player) {
    if (NET.myHp !== undefined && player.hp < NET.myHp - 0.5) {
      playHit(player);
      $("flash").style.opacity = 1;
      setTimeout(() => ($("flash").style.opacity = 0), 160);
      shake = 0.35;
    }
    NET.myHp = player.hp;
  }
  NET.healT -= dt;
  if (NET.healT <= 0) {
    NET.healT = 1;
    NG.set(NET.gm);
    for (const [key, m] of NET.wmir) {
      const i = key.lastIndexOf("#"),
        n = key.slice(0, i),
        t = NET.reg[n] && NET.reg[n][+key.slice(i + 1)];
      if (t) netApplyObj(n, t, m);
    }
  }
  {
    // controls go out the moment they change (at most 30 times a second)
    const p = player,
      live = p && p.alive && phase !== "end",
      o = {
        t: "in",
        wx: live ? r3(NET.wx) : 0,
        wz: live ? r3(NET.wz) : 0,
        run: NET.run,
        cy: Math.round(camYaw * 20) / 20,
        a: NET.acts,
      };
    const s = JSON.stringify(o),
      nowT = performance.now();
    if (
      NET.acts.length ||
      (s !== NET.lastIn && nowT - NET.tI > 33) ||
      nowT - NET.tI > 300
    ) {
      NET.lastIn = s;
      NET.tI = nowT;
      netSend(o);
      NET.acts = [];
    }
  }
}
const NCALL = {};
function netEvent(ev) {
  const k = ev[0];
  if (k === "ne") {
    if (!NET.byId.has(ev[1])) {
      const d = mkEnt(ev[2], ev[3], false, ev[4]);
      d.nid = ev[1];
      NET.byId.set(d.nid, d);
      NET.nid = Math.max(NET.nid, d.nid);
      addHat(d, ev[5]);
    }
  } else if (k === "m") {
    NET.rx = true;
    try {
      msg(ev[1], ev[2]);
    } finally {
      NET.rx = false;
    }
  } else if (k === "p") {
    NET.rx = true;
    try {
      popText(ev[1], ev[2], ev[3], ev[4], ev[5], ev[6]);
    } finally {
      NET.rx = false;
    }
  } else if (k === "pz") {
    NET.hp = !!ev[1];
    paused = NET.hp;
    const h1 = document.querySelector("#paused h1");
    if (h1)
      h1.textContent = NET.hp
        ? "⏸ PAUSED BY THE HOST"
        : "☰ MENU — only the host can pause the round";
    $("resume").classList.toggle("hide", NET.hp);
    $("paused").classList.toggle("hide", !NET.hp);
    if (NET.hp) {
      for (const q in keys) keys[q] = false;
      if (document.exitPointerLock) document.exitPointerLock();
    }
    lastT = performance.now();
  } else if (k === "st") {
    if (ev[1] === NET.you) setStatus(ev[2], ev[3]);
  } else if (k === "c") {
    const e = NET.byId.get(ev[2]);
    if (e && NCALL[ev[1]]) {
      netApplyEnt(e, ev[3], 0, true);
      NCALL[ev[1]](e);
    }
  } else if (k === "end") {
    NET.endOk = true;
    try {
      if (ev[1] === "g") endGame(ev[2]);
      else if (ev[1] === "r") endRescue();
      else if (ev[1] === "f") endFinal(!!ev[2][0], ev[2][1]);
      else if (ev[1] === "e")
        endEscape(ev[2].map((i) => NET.byId.get(i)).filter(Boolean));
    } finally {
      NET.endOk = false;
    }
  }
}
function netItems(list) {
  const key = (t, x, z, y) =>
      t +
      "|" +
      Math.round(x * 5) +
      "|" +
      Math.round(z * 5) +
      "|" +
      Math.round(y * 5),
    want = new Map();
  for (const a of list) want.set(key(a[0], a[1], a[2], a[3]), a);
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i],
      kk = key(it.type, it.x, it.z, it.y);
    if (want.has(kk)) {
      if (!want.get(kk)[4] && it.crate) openCrate(it);
      want.delete(kk);
    } else {
      scene.remove(it.g);
      items.splice(i, 1);
    }
  }
  for (const a of want.values())
    spawnItem(a[0], a[1], a[2], a[3], !!a[4], !!a[5]);
}
function netTraps(list) {
  const used = new Set();
  for (const a of list) {
    let t = traps.find(
      (q) =>
        !used.has(q) &&
        q.type === a[0] &&
        Math.abs(q.x - a[1]) < 0.05 &&
        Math.abs(q.z - a[2]) < 0.05,
    );
    if (!t) {
      const n0 = traps.length,
        tb = trapBudget;
      trapBudget = 9;
      placeTrap(
        {
          role: a[3],
          isPlayer: false,
          stun: null,
          onGround: true,
          pos: { x: a[1], y: 0, z: a[2] },
          yaw: 0,
        },
        a[0],
        { x: a[1], z: a[2], force: true },
      );
      trapBudget = tb;
      if (traps.length > n0) t = traps[traps.length - 1];
    }
    if (!t) continue;
    used.add(t);
    if (a[4] && !t.sprung) {
      t.sprung = true;
      t.t = 999;
      t.camo.material = new THREE.MeshBasicMaterial(
        a[0] === "water"
          ? { color: 0x4fb3e8, transparent: true, opacity: 0.8 }
          : { color: 0x1a120a },
      );
      t.g.children.forEach((c) => {
        if (c.isSprite) c.visible = false;
      });
      puff(t.x, 0.2, t.z, a[0] === "water" ? 0xbfe6ff : 0x7a5533, 14, 3);
      beep(120, 0.3, "sawtooth", 0.1, 300);
    }
  }
  for (let i = traps.length - 1; i >= 0; i--)
    if (!used.has(traps[i])) {
      scene.remove(traps[i].g);
      traps.splice(i, 1);
    }
}
function netRecv(o) {
  if (!NET.guest || phase === "menu") return;
  for (const ev of o.ev || []) {
    try {
      netEvent(ev);
    } catch (err) {
      console.warn("net event", ev[0], err);
    }
  }
  if (o.e)
    for (const id in o.e) {
      let m = NET.mir.get(+id);
      if (!m) NET.mir.set(+id, (m = {}));
      Object.assign(m, o.e[id]);
    }
  if (o.w)
    for (const n in o.w)
      for (const i in o.w[n]) {
        const key = n + "#" + i;
        let m = NET.wmir.get(key);
        if (!m) NET.wmir.set(key, (m = {}));
        Object.assign(m, o.w[n][i]);
        const t = NET.reg[n] && NET.reg[n][+i];
        if (t) netApplyObj(n, t, o.w[n][i]);
      }
  if (o.g) {
    Object.assign(NET.gm, o.g);
    NG.set(o.g);
  }
  if (o.it) netItems(o.it);
  if (o.tr) netTraps(o.tr);
  if (Math.abs(clock - o.c) > 0.3) clock = o.c;
  if (o.ph === "game" && phase === "lobby") lobbyT = 0;
}
/* --- rooms (menu) --- */
function netConnect(first) {
  if (NET.ws && NET.ws.readyState <= 1) {
    if (NET.ws.readyState === 1) netSend(first);
    else NET.first = first;
    return;
  }
  const base =
    (window.IC_SERVER || "").replace(/\/$/, "").replace(/^http/, "ws") ||
    (location.protocol === "https:" ? "wss://" : "ws://") + location.host;
  let ws;
  try {
    ws = new WebSocket(base + "/ws");
  } catch (e) {
    netErr("Could not reach the game server.");
    return;
  }
  ws.binaryType = "arraybuffer";
  NET.ws = ws;
  NET.first = first;
  netErr("Connecting…");
  ws.onopen = () => {
    netErr("");
    netSend(NET.first);
    clearInterval(NET.pgT);
    NET.pgT = setInterval(
      () => netSend({ t: "pg", n: performance.now() }),
      2000,
    );
  };
  ws.onerror = () => {
    if (!NET.room)
      netErr(
        "Could not reach the game server. Multiplayer needs the Node server (npm start).",
      );
  };
  ws.onclose = () => {
    if (NET.ws !== ws) return;
    NET.ws = null;
    if (NET.leaving) return;
    if (phase === "menu") {
      if (NET.room) {
        netErr("Connection lost — reconnecting…");
        setTimeout(netRejoin, 1500);
      }
    } else if (NET.on && phase !== "end")
      netAbort("The connection to the server was lost, so the round stopped.");
  };
  ws.onmessage = (ev) => {
    if (typeof ev.data !== "string") {
      NET.q = NET.q
        .then(() => nunzip(ev.data))
        .then((s) => netRecv(JSON.parse(s)))
        .catch((err) => console.warn("net", err));
      return;
    }
    let m;
    try {
      m = JSON.parse(ev.data);
    } catch (e) {
      return;
    }
    if (m.t === "pg") {
      const ms = performance.now() - m.n;
      NET.ping = NET.ping == null ? ms : NET.ping * 0.6 + ms * 0.4;
    } else if (m.t === "in") {
      if (NET.host) netInput(m);
    } else if (m.t === "gone") {
      if (NET.host) netGone(m.id);
    } else if (m.t === "joined") {
      NET.you = m.you;
      try {
        sessionStorage.setItem(
          "ic_room",
          JSON.stringify({ code: m.code, key: m.key }),
        );
      } catch (e) {}
    } else if (m.t === "room") {
      NET.room = m.room;
      NET.you = m.you;
      if (phase === "menu") netRoomUi();
    } else if (m.t === "err") {
      netErr(m.msg);
      if (m.gone) {
        try {
          sessionStorage.removeItem("ic_room");
        } catch (e) {}
        NET.room = null;
        netRoomUi();
      }
    } else if (m.t === "closed") {
      try {
        sessionStorage.removeItem("ic_room");
      } catch (e) {}
      NET.room = null;
      NET.leaving = true;
      if (phase === "menu") {
        netRoomUi();
        netErr(m.why || "The room was closed.");
        NET.leaving = false;
      } else netAbort(m.why || "The room was closed.");
    } else if (m.t === "abort") {
      if (phase !== "menu" && phase !== "end") netAbort(m.why);
    } else if (m.t === "start") {
      if (phase === "menu") start(null, m);
    }
  };
}
function netAbort(why) {
  phase = "end";
  musPlay("");
  $("pause").classList.add("hide");
  $("paused").classList.add("hide");
  if (document.exitPointerLock) document.exitPointerLock();
  $("endt").textContent = "🔌 ROUND STOPPED";
  $("endp").textContent = why || "The round was stopped.";
  $("end").classList.remove("hide");
}
function netErr(t) {
  const el = $("mperr");
  if (el) el.textContent = t || "";
  const e2 = $("rerr");
  if (e2) e2.textContent = t || "";
}
function netMe() {
  const me = {
    name: ($("pname").value.trim() || "Player").slice(0, 12),
    color: custom.color,
    hat: custom.hat,
  };
  try {
    sessionStorage.setItem("ic_me", JSON.stringify(me));
  } catch (e) {}
  return me;
}
function netRejoin() {
  let s = null;
  try {
    s = JSON.parse(sessionStorage.getItem("ic_room") || "null");
  } catch (e) {}
  if (s && s.code)
    netConnect({ t: "join", code: s.code, key: s.key, ...netMe() });
}
function netRoomUi() {
  const R = NET.room,
    m1 = $("m1"),
    m2 = $("m2"),
    m3 = $("m3");
  if (!m3) return;
  if (!R) {
    m3.style.display = "none";
    if (m2.style.display === "none") m1.style.display = "";
    return;
  }
  m1.style.display = "none";
  m2.style.display = "none";
  m3.style.display = "";
  const host = R.host === NET.you,
    rnd_ = R.mode === "random";
  $("rcode").textContent = R.code;
  $("rnch").textContent = R.ch;
  $("rnru").textContent = R.ru;
  $("rlevel").value = R.level;
  $("rlevel").disabled = !host;
  document.querySelectorAll("#m3 [data-rs]").forEach((b) => {
    b.disabled = !host || R.playing;
  });
  document.querySelectorAll("#m3 [data-mode]").forEach((b) => {
    b.classList.toggle("on", b.dataset.mode === R.mode);
    b.disabled = !host || R.playing;
  });
  const list = $("rlist");
  list.textContent = "";
  let nc = 0,
    nr = 0;
  for (const p of R.players) {
    const row = document.createElement("div");
    row.className = "prow" + (p.on ? "" : " off");
    const dot = document.createElement("i");
    dot.style.background = "#" + (p.color >>> 0).toString(16).padStart(6, "0");
    const nm = document.createElement("span");
    nm.className = "pn";
    nm.textContent = p.name + (p.id === NET.you ? " (you)" : "");
    const tag = document.createElement("em");
    tag.textContent =
      (p.id === R.host ? "⭐ host" : "") +
      (!p.on ? " · offline" : !p.ready ? " · still in the last round" : "");
    const seg = document.createElement("span");
    seg.className = "seg";
    if (rnd_) {
      const q = document.createElement("b");
      q.textContent = "🎲 secret";
      seg.appendChild(q);
    } else
      for (const [r, txt] of [
        ["runner", "🏃 Runner"],
        ["chaser", "👊 Chaser"],
      ]) {
        const b = document.createElement("button");
        b.textContent = txt;
        b.className = (p.role === r ? "on " : "") + r;
        b.disabled = p.id !== NET.you;
        if (p.id === NET.you)
          b.addEventListener("click", () => netSend({ t: "role", role: r }));
        seg.appendChild(b);
      }
    if (p.role === "chaser") nc++;
    else nr++;
    row.append(dot, nm, tag, seg);
    list.appendChild(row);
  }
  const n = R.players.length;
  let info = `${n}/${R.max} players · `;
  if (rnd_)
    info += `roles are dealt in secret when the round starts · bots fill the other ${R.ch + R.ru - n} places`;
  else {
    const c = Math.min(nc, R.ch),
      r = Math.min(n - c, R.ru);
    info +=
      `bots fill the rest: ${R.ch - c} chaser${R.ch - c === 1 ? "" : "s"}, ${Math.max(0, R.ru - r)} runner${R.ru - r === 1 ? "" : "s"}` +
      (nc > R.ch
        ? ` · only ${R.ch} can be chasers — the last to pick will run`
        : "");
  }
  $("rinfo").textContent = info;
  $("rstart").classList.toggle("hide", !host);
  $("rclose").classList.toggle("hide", !host);
  $("rleave").classList.toggle("hide", host);
  $("rstart").disabled = R.playing;
  $("rwait").textContent = R.playing
    ? "⏳ A round is being played — you join the next one."
    : host
      ? ""
      : "Waiting for the host to start…";
}
function netInitUi() {
  if (!$("m3")) return;
  let me = null;
  try {
    me = JSON.parse(sessionStorage.getItem("ic_me") || "null");
  } catch (e) {}
  if (me) {
    $("pname").value = me.name === "Player" ? "" : me.name;
    if (typeof me.color === "number") custom.color = me.color;
    if (me.hat) custom.hat = me.hat;
  }
  const qc = new URLSearchParams(location.search).get("room");
  if (qc) $("mpcode").value = qc.toUpperCase().slice(0, 5);
  $("mpcreate").addEventListener("click", () =>
    netConnect({ t: "create", ...netMe() }),
  );
  const join = () => {
    const c = $("mpcode").value.trim().toUpperCase();
    if (c.length < 4) {
      netErr("Type the room code your friend sent you.");
      return;
    }
    netConnect({ t: "join", code: c, ...netMe() });
  };
  $("mpjoin").addEventListener("click", join);
  $("mpcode").addEventListener("keydown", (e) => {
    if (e.key === "Enter") join();
    e.stopPropagation();
  });
  document.querySelectorAll("#m3 [data-rs]").forEach((b) =>
    b.addEventListener("click", () => {
      const R = NET.room;
      if (!R) return;
      const k = b.dataset.rs;
      netSend({ t: "set", [k]: R[k] + +b.dataset.d });
    }),
  );
  document
    .querySelectorAll("#m3 [data-mode]")
    .forEach((b) =>
      b.addEventListener("click", () =>
        netSend({ t: "set", mode: b.dataset.mode }),
      ),
    );
  $("rlevel").addEventListener("change", (e) =>
    netSend({ t: "set", level: e.target.value }),
  );
  $("rstart").addEventListener("click", () => netSend({ t: "start" }));
  const out = (t) => {
    NET.leaving = true;
    netSend({ t });
    try {
      sessionStorage.removeItem("ic_room");
    } catch (e) {}
    NET.room = null;
    setTimeout(() => {
      if (NET.ws) NET.ws.close();
      NET.leaving = false;
      netRoomUi();
      netErr("");
      history.replaceState(null, "", location.pathname);
    }, 150);
  };
  $("rleave").addEventListener("click", () => out("leave"));
  $("rclose").addEventListener("click", () => {
    if (confirm("Close the room for everyone?")) out("close");
  });
  $("rcopy").addEventListener("click", () => {
    const R = NET.room;
    if (!R) return;
    const url = location.origin + location.pathname + "?room=" + R.code;
    const done = () => {
      $("rcopy").textContent = "✓ Link copied";
      setTimeout(() => ($("rcopy").textContent = "🔗 Copy invite link"), 1500);
    };
    if (navigator.clipboard)
      navigator.clipboard
        .writeText(url)
        .then(done, () => prompt("Copy this link:", url));
    else prompt("Copy this link:", url);
  });
  netRejoin();
}
netInitUi();
function useNet(e, ...a) {
  return netCall("useNet", useNet_, e, a);
}
NCALL.useNet = useNet_;
function useHook(e, ...a) {
  return netCall("useHook", useHook_, e, a);
}
NCALL.useHook = useHook_;
function throwHeld(e, ...a) {
  return netCall("throwHeld", throwHeld_, e, a);
}
NCALL.throwHeld = throwHeld_;
function useSmoke(e, ...a) {
  return netCall("useSmoke", useSmoke_, e, a);
}
NCALL.useSmoke = useSmoke_;
function dropBanana(e, ...a) {
  return netCall("dropBanana", dropBanana_, e, a);
}
NCALL.dropBanana = dropBanana_;
function doRoar(e, ...a) {
  return netCall("doRoar", doRoar_, e, a);
}
NCALL.doRoar = doRoar_;
function useBolt(e, ...a) {
  return netCall("useBolt", useBolt_, e, a);
}
NCALL.useBolt = useBolt_;
requestAnimationFrame(frame);
window.__game = {
  colliders,
  bridges,
  spots,
  tramps,
  riverDist,
  NET,
  MENU,
  FIN,
  RAFT,
  COURSE,
  FIRES,
  raftCrew,
  LVL: () => LVL,
  sim(n) {
    const rr = renderer.render;
    renderer.render = () => {};
    try {
      for (let i = 0; i < n && phase !== "end"; i++) {
        lastT = performance.now() - 50;
        frame(performance.now(), true);
      }
    } finally {
      renderer.render = rr;
    }
  },
  get sailDone() {
    return sailDone;
  },
  set sailDone(v) {
    sailDone = v;
  },
  get clock() {
    return clock;
  },
  doPush,
  MT,
  mtP,
  useBolt,
  crocs,
  get cine() {
    return cine;
  },
  BGM,
  MUS,
  HIT,
  HELP,
  THANKS,
  COME,
  JIG,
  SLIP,
  HAH,
  BEAT,
  Q,
  JIGS,
  playHit,
  playVoiceAt,
  say,
  get shipGone() {
    return shipGone;
  },
  get shipGoneT() {
    return shipGoneT;
  },
  shipReady,
  SHIPFX,
  get woodDone() {
    return woodDone;
  },
  set woodDone(v) {
    woodDone = v;
  },
  get ironDone() {
    return ironDone;
  },
  set ironDone(v) {
    ironDone = v;
  },
  get tideR() {
    return tideR;
  },
  get stormK() {
    return stormK;
  },
  floodDepth,
  CHAIN,
  get ironN() {
    return ironN;
  },
  SEATS,
  SHIP,
  set fuelDone(v) {
    fuelDone = v;
  },
  crawls,
  sees,
  JAIL,
  chasers,
  tieUp,
  pickUp,
  get roundT() {
    return roundT;
  },
  set roundT(v) {
    roundT = v;
  },
  leaks,
  get player() {
    return player;
  },
  set camYaw(v) {
    camYaw = v;
  },
  hit,
  spots,
  zips,
  tramps,
  ladders,
  boats,
  peels,
  smokes,
  DOCK,
  custom,
  placeTrap,
  spawnItem,
  action,
  get fuelDone() {
    return fuelDone;
  },
  get boatT() {
    return boatT;
  },
  set boatT(v) {
    boatT = v;
  },
  towers,
  FH,
  findPath,
  navC,
  nav,
  N,
  cellOf,
  stepEnt,
  aiChaser,
  updateVisual,
  R_ISLAND,
  chokes,
  colliders,
  riverDist,
  bridges,
  settings,
  ents,
  traps,
  items,
  keys,
  get phase() {
    return phase;
  },
  start,
  skip() {
    lobbyT = 0.05;
  },
};
