import * as THREE from 'three';
import { rbox, box, cyl, put, cached } from './weapons.js';
import { toon } from './textures.js';

// Дополнительные материалы создаются один раз на модуль.
let extra = null;
function xm() {
  if (!extra) {
    extra = {
      white: toon({ color: 0xf1f4f8 }),
      light: toon({ color: 0xc3ccda }),
      trim: toon({ color: 0x323a4c }),
      oliveDark: toon({ color: 0x55702f }),
      warhead: toon({ color: 0x6f8a3c }),
      cyan: new THREE.MeshBasicMaterial({ color: 0x45f2ff }),
      cyanCore: new THREE.MeshBasicMaterial({ color: 0xd8feff }),
      exhaust: new THREE.MeshBasicMaterial({ color: 0xffc040 }),
      bore: new THREE.MeshBasicMaterial({ color: 0x14121a }),
    };
  }
  return extra;
}

function sphere(r, mat, ws = 14, hs = 10) {
  return new THREE.Mesh(cached(`s${r},${ws},${hs}`, () => new THREE.SphereGeometry(r, ws, hs)), mat);
}

// Тор в плоскости XY (кольцо смотрит вдоль Z).
function torus(r, tube, mat, arc = Math.PI * 2, seg = 24) {
  return new THREE.Mesh(cached(`t${r},${tube},${arc},${seg}`, () => new THREE.TorusGeometry(r, tube, 8, seg, arc)), mat);
}

// Тело вращения: профиль [r, t], t растёт к носу, ось смотрит в -Z.
function lathe(key, pts, mat, seg = 20) {
  const g = cached(key, () => new THREE.LatheGeometry(pts.map(([r, t]) => new THREE.Vector2(r, t)), seg).rotateX(-Math.PI / 2));
  return new THREE.Mesh(g, mat);
}

// Половина кольца под стволом — спусковая скоба.
function guard(parent, r, mat, x, y, z) {
  return put(parent, torus(r, 0.003, mat, Math.PI, 16), x, y, z, 0, Math.PI / 2, Math.PI);
}

// Боевая часть выстрела РПГ: основание в z = 0, нос в -Z.
const WARHEAD = [
  [0, 0], [0.019, 0], [0.021, 0.03], [0.03, 0.06], [0.046, 0.09], [0.052, 0.11],
  [0.052, 0.165], [0.046, 0.2], [0.034, 0.235], [0.021, 0.262], [0.014, 0.275], [0, 0.276],
];
function warhead(m) {
  const x = xm();
  const g = new THREE.Group();
  put(g, lathe('warhead', WARHEAD, x.warhead, 22), 0, 0, 0);
  put(g, cyl(0.0535, 0.0535, 0.014, m.brass, 22), 0, 0, -0.125);
  put(g, cyl(0.0535, 0.0535, 0.006, m.rubber, 22), 0, 0, -0.152);
  put(g, cyl(0.014, 0.009, 0.03, m.steel, 14), 0, 0, -0.288);
  put(g, sphere(0.009, m.bright, 12, 8), 0, 0, -0.302);
  put(g, cyl(0.02, 0.02, 0.012, m.darkSteel, 16), 0, 0, -0.006);
  return g;
}

export const rpg = (m) => {
  const g = new THREE.Group();
  const AX = 0.09;
  // Труба: передняя часть, деревянный теплозащитный кожух, задняя часть и раструб.
  put(g, cyl(0.03, 0.03, 0.62, m.darkSteel), 0, AX, -0.29);
  put(g, cyl(0.036, 0.036, 0.04, m.steel), 0, AX, -0.58);
  put(g, cyl(0.032, 0.032, 0.004, xm().bore), 0, AX, -0.6);
  put(g, cyl(0.044, 0.044, 0.3, m.wood, 22), 0, AX, -0.12);
  for (const z of [-0.272, -0.12, 0.032]) put(g, cyl(0.047, 0.047, 0.014, m.steel, 22), 0, AX, z);
  put(g, cyl(0.03, 0.03, 0.21, m.darkSteel), 0, AX, 0.135);
  put(g, cyl(0.041, 0.041, 0.11, m.wood, 22), 0, AX, 0.155);
  put(g, cyl(0.044, 0.044, 0.01, m.steel, 22), 0, AX, 0.205);
  put(g, cyl(0.064, 0.031, 0.15, m.darkSteel, 22), 0, AX, 0.315);
  put(g, cyl(0.068, 0.068, 0.014, m.steel, 22), 0, AX, 0.392);
  put(g, cyl(0.056, 0.056, 0.004, xm().bore, 22), 0, AX, 0.4);
  // Пистолетная рукоять со скобой.
  put(g, box(0.024, 0.03, 0.07, m.darkSteel), 0, 0.048, 0.0);
  put(g, rbox(0.034, 0.105, 0.048, 0.013, m.polymer), 0, -0.012, 0.03, -0.3);
  for (let i = 0; i < 3; i++) put(g, box(0.036, 0.004, 0.03, m.darkSteel), 0, -0.002 - i * 0.025, 0.035 + i * 0.008, -0.3);
  put(g, rbox(0.036, 0.012, 0.052, 0.004, m.darkSteel), 0, -0.064, 0.047, -0.3);
  guard(g, 0.028, m.steel, 0, 0.05, -0.028);
  put(g, box(0.005, 0.024, 0.006, m.accent), 0, 0.034, -0.026, 0.25);
  // Передняя рукоять.
  put(g, box(0.022, 0.024, 0.05, m.darkSteel), 0, 0.048, -0.2);
  put(g, rbox(0.032, 0.09, 0.042, 0.013, m.polymer), 0, 0.0, -0.205, -0.15);
  put(g, rbox(0.034, 0.012, 0.046, 0.004, m.darkSteel), 0, -0.045, -0.198, -0.15);
  // Открытый прицел по оси: мушка спереди, целик над кожухом.
  put(g, rbox(0.018, 0.018, 0.026, 0.004, m.darkSteel), 0, 0.124, -0.5);
  put(g, box(0.006, 0.046, 0.006, m.darkSteel), 0, 0.147, -0.5);
  put(g, box(0.0045, 0.0045, 0.002, m.glowGreen), 0, 0.167, -0.5035);
  put(g, rbox(0.034, 0.014, 0.03, 0.004, m.darkSteel), 0, 0.139, -0.04);
  for (const s of [-1, 1]) {
    put(g, box(0.008, 0.038, 0.008, m.darkSteel), s * 0.011, 0.162, -0.04);
    put(g, box(0.003, 0.003, 0.002, m.glowGreen), s * 0.0085, 0.172, -0.0355);
  }
  // Оптика слева сверху.
  put(g, box(0.03, 0.016, 0.05, m.darkSteel), -0.05, 0.112, -0.07);
  put(g, rbox(0.012, 0.04, 0.04, 0.004, m.darkSteel), -0.066, 0.124, -0.07);
  put(g, cyl(0.016, 0.016, 0.12, m.olive), -0.07, 0.15, -0.06);
  put(g, cyl(0.016, 0.021, 0.035, m.olive), -0.07, 0.15, -0.135);
  put(g, cyl(0.018, 0.018, 0.004, m.glass), -0.07, 0.15, -0.153);
  put(g, cyl(0.022, 0.017, 0.035, m.rubber), -0.07, 0.15, 0.012);
  put(g, cyl(0.009, 0.009, 0.016, m.darkSteel, 12), -0.07, 0.169, -0.07, Math.PI / 2);
  put(g, cyl(0.009, 0.009, 0.016, m.darkSteel, 12), -0.089, 0.15, -0.07, 0, Math.PI / 2);
  // Выстрел в стволе.
  const rocket = warhead(m);
  put(g, rocket, 0, AX, -0.6);
  return {
    group: g, muzzle: new THREE.Vector3(0, AX, -0.64), sightY: 0.172, mag: rocket, rocket,
    eject: new THREE.Vector3(0, AX, -0.64),
  };
};

export const minigun = (m) => {
  const x = xm();
  const g = new THREE.Group();
  const AX = 0.045;
  // Вращающийся блок стволов.
  const barrels = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    const bx = Math.cos(a) * 0.026, by = Math.sin(a) * 0.026;
    put(barrels, cyl(0.0085, 0.0085, 0.44, m.darkSteel, 10), bx, by, -0.02);
    put(barrels, cyl(0.0105, 0.0105, 0.02, m.steel, 10), bx, by, -0.235);
    put(barrels, cyl(0.0055, 0.0055, 0.004, x.bore, 10), bx, by, -0.246);
  }
  put(barrels, cyl(0.012, 0.012, 0.44, m.steel, 12), 0, 0, -0.02);
  for (const z of [-0.2, -0.04]) {
    put(barrels, cyl(0.043, 0.043, 0.018, m.steel, 6), 0, 0, z).rotation.z = Math.PI / 6;
  }
  put(barrels, rbox(0.012, 0.01, 0.016, 0.003, m.accent), 0, 0.044, -0.2);
  put(barrels, cyl(0.046, 0.046, 0.07, m.darkSteel, 18), 0, 0, 0.17);
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3 + Math.PI / 6;
    put(barrels, box(0.008, 0.008, 0.074, m.steel), Math.cos(a) * 0.044, Math.sin(a) * 0.044, 0.17, 0, 0, a);
  }
  put(g, barrels, 0, AX, -0.36);
  // Корпус мотора.
  put(g, rbox(0.11, 0.12, 0.22, 0.03, m.polymer), 0, AX, 0.0);
  put(g, rbox(0.114, 0.022, 0.18, 0.008, m.accent), 0, AX + 0.035, 0.0);
  for (const s of [-1, 1]) {
    put(g, rbox(0.006, 0.062, 0.12, 0.003, m.darkSteel), s * 0.056, AX - 0.015, 0.0);
    for (let i = 0; i < 4; i++) put(g, box(0.008, 0.006, 0.1, m.steel), s * 0.058, AX - 0.035 + i * 0.014, 0.0);
  }
  put(g, cyl(0.052, 0.052, 0.03, m.darkSteel, 20), 0, AX, -0.125);
  put(g, cyl(0.042, 0.05, 0.05, m.steel, 20), 0, AX, 0.13);
  put(g, cyl(0.02, 0.02, 0.02, m.bright, 14), 0, AX, 0.162);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    put(g, box(0.006, 0.006, 0.05, m.darkSteel), Math.cos(a) * 0.046, AX + Math.sin(a) * 0.046, 0.13, 0, 0, a);
  }
  // Ручка для переноски с прицелом.
  for (const z of [-0.075, 0.07]) put(g, rbox(0.022, 0.06, 0.022, 0.006, m.darkSteel), 0, 0.12, z);
  put(g, rbox(0.03, 0.02, 0.18, 0.008, m.rubber), 0, 0.157, -0.002);
  put(g, rbox(0.018, 0.022, 0.012, 0.003, m.darkSteel), 0, 0.172, -0.085);
  put(g, box(0.004, 0.012, 0.004, m.darkSteel), 0, 0.186, -0.085);
  put(g, box(0.0036, 0.0036, 0.002, m.glowGreen), 0, 0.189, -0.0875);
  for (const s of [-1, 1]) {
    put(g, box(0.007, 0.024, 0.01, m.darkSteel), s * 0.009, 0.178, 0.075);
    put(g, box(0.003, 0.003, 0.002, m.glowGreen), s * 0.0068, 0.187, 0.0695);
  }
  // Задняя пистолетная рукоять и передняя рукоять.
  put(g, rbox(0.034, 0.1, 0.046, 0.013, m.rubber), 0, -0.045, 0.06, -0.3);
  put(g, rbox(0.036, 0.012, 0.05, 0.004, m.darkSteel), 0, -0.094, 0.075, -0.3);
  guard(g, 0.026, m.darkSteel, 0, -0.012, 0.012);
  put(g, box(0.006, 0.022, 0.007, m.accent), 0, -0.022, 0.01, 0.2);
  put(g, rbox(0.04, 0.03, 0.05, 0.008, m.darkSteel), 0, -0.022, -0.12);
  put(g, rbox(0.034, 0.1, 0.042, 0.013, m.rubber), 0, -0.078, -0.13, -0.12);
  put(g, rbox(0.04, 0.012, 0.048, 0.004, m.darkSteel), 0, -0.128, -0.124, -0.12);
  // Короб с лентой слева.
  const mag = new THREE.Group();
  put(mag, rbox(0.07, 0.11, 0.15, 0.012, m.olive), -0.09, -0.04, -0.01);
  put(mag, rbox(0.074, 0.016, 0.154, 0.005, x.oliveDark), -0.09, 0.015, -0.01);
  put(mag, rbox(0.004, 0.05, 0.08, 0.004, m.tan), -0.126, -0.045, -0.01);
  put(mag, rbox(0.03, 0.01, 0.04, 0.003, m.darkSteel), -0.09, 0.025, -0.01);
  for (const z of [-0.06, 0.04]) put(mag, box(0.076, 0.008, 0.012, m.darkSteel), -0.09, -0.04, z);
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    const bx = -0.085 + t * 0.03, by = 0.03 + Math.sin(t * Math.PI * 0.5) * 0.04 - t * t * 0.01;
    const link = put(mag, box(0.012, 0.006, 0.05, m.darkSteel), bx, by, -0.01, 0, 0, 0.9 - t * 0.6);
    put(link, cyl(0.0045, 0.0045, 0.05, m.brass, 8), 0, 0.005, -0.004);
    put(link, cyl(0.0045, 0.002, 0.012, m.brass, 8), 0, 0.005, -0.035);
  }
  put(g, mag, 0, 0, 0);
  return {
    group: g, muzzle: new THREE.Vector3(0, AX, -0.61), sightY: 0.19, mag, barrels,
    eject: new THREE.Vector3(0.06, AX + 0.02, -0.05),
  };
};

export const laser = (m) => {
  const x = xm();
  const g = new THREE.Group();
  const AX = 0.045;
  // Ствольная коробка и кожух.
  put(g, rbox(0.054, 0.074, 0.3, 0.022, x.white), 0, 0.035, -0.06);
  put(g, rbox(0.058, 0.02, 0.22, 0.008, x.light), 0, 0.012, -0.08);
  put(g, rbox(0.044, 0.024, 0.2, 0.01, x.light), 0, 0.078, -0.07);
  put(g, rbox(0.046, 0.054, 0.16, 0.02, x.white), 0, AX, -0.27);
  put(g, rbox(0.032, 0.014, 0.14, 0.006, m.accent), 0, 0.073, -0.27);
  put(g, rbox(0.05, 0.016, 0.12, 0.006, x.trim), 0, 0.016, -0.27);
  // Светящиеся полосы и окна с энергоячейками.
  for (const s of [-1, 1]) {
    put(g, box(0.003, 0.006, 0.22, x.cyan), s * 0.0275, 0.05, -0.08);
    put(g, box(0.003, 0.005, 0.12, x.cyan), s * 0.0235, 0.05, -0.27);
    put(g, rbox(0.004, 0.026, 0.07, 0.003, x.trim), s * 0.027, 0.026, 0.03);
    for (let i = 0; i < 3; i++) put(g, box(0.003, 0.016, 0.014, x.cyanCore), s * 0.0285, 0.026, 0.008 + i * 0.022);
  }
  // Излучатель на дуле.
  put(g, cyl(0.02, 0.026, 0.04, x.trim, 20), 0, AX, -0.37);
  put(g, cyl(0.016, 0.016, 0.06, x.light, 20), 0, AX, -0.41);
  put(g, torus(0.021, 0.0045, x.cyan, Math.PI * 2, 24), 0, AX, -0.44);
  put(g, cyl(0.023, 0.023, 0.012, m.accent, 20), 0, AX, -0.452);
  put(g, cyl(0.012, 0.012, 0.004, x.cyanCore, 16), 0, AX, -0.459);
  for (let i = 0; i < 3; i++) {
    const a = Math.PI / 2 + (i * Math.PI * 2) / 3;
    const p = put(g, rbox(0.01, 0.01, 0.07, 0.003, x.white), Math.cos(a) * 0.026, AX + Math.sin(a) * 0.026, -0.47, 0, 0, a);
    put(p, box(0.004, 0.004, 0.02, x.cyan), 0, 0, -0.03);
  }
  // Голографический кольцевой прицел.
  put(g, rbox(0.03, 0.01, 0.07, 0.004, x.trim), 0, 0.092, -0.05);
  for (const s of [-1, 1]) put(g, rbox(0.006, 0.03, 0.016, 0.003, x.white), s * 0.018, 0.108, -0.06);
  put(g, torus(0.016, 0.0035, x.light, Math.PI * 2, 24), 0, 0.112, -0.06);
  put(g, torus(0.0125, 0.0012, x.cyan, Math.PI * 2, 24), 0, 0.112, -0.062);
  put(g, box(0.0025, 0.0025, 0.001, x.cyan), 0, 0.112, -0.063);
  // Рукоять, скоба, спуск.
  put(g, rbox(0.032, 0.098, 0.044, 0.014, x.trim), 0, -0.045, 0.06, -0.32);
  put(g, rbox(0.034, 0.03, 0.03, 0.006, m.accent), 0, -0.088, 0.075, -0.32);
  guard(g, 0.025, x.light, 0, -0.008, 0.02);
  put(g, box(0.005, 0.02, 0.006, m.accent), 0, -0.012, 0.018, 0.2);
  // Приклад с вырезом под большой палец.
  put(g, rbox(0.044, 0.03, 0.2, 0.012, x.white), 0, 0.058, 0.17, -0.12);
  put(g, rbox(0.04, 0.03, 0.2, 0.012, x.light), 0, -0.022, 0.195, 0.16);
  put(g, rbox(0.046, 0.11, 0.035, 0.014, x.white), 0, 0.02, 0.29);
  put(g, rbox(0.048, 0.1, 0.014, 0.005, m.accent), 0, 0.02, 0.31);
  put(g, box(0.003, 0.004, 0.12, x.cyan), 0.0235, 0.058, 0.17, -0.12);
  // Батарея.
  const mag = new THREE.Group();
  put(mag, rbox(0.03, 0.08, 0.05, 0.01, x.trim), 0, -0.04, -0.075, -0.12);
  put(mag, box(0.032, 0.05, 0.012, x.cyan), 0, -0.038, -0.077, -0.12);
  put(mag, rbox(0.034, 0.016, 0.054, 0.005, m.accent), 0, -0.082, -0.07, -0.12);
  put(g, mag, 0, 0, 0);
  const muzzle = new THREE.Vector3(0, AX, -0.47);
  return { group: g, muzzle, sightY: 0.112, mag, eject: muzzle.clone() };
};

function bladeGeometry() {
  return cached('knifeBlade', () => {
    const s = new THREE.Shape();
    s.moveTo(0, 0.012);
    s.lineTo(0.112, 0.012);
    s.quadraticCurveTo(0.15, 0.011, 0.178, 0.001);
    s.quadraticCurveTo(0.156, -0.019, 0.1, -0.017);
    s.lineTo(0.016, -0.016);
    s.lineTo(0.008, -0.01);
    s.lineTo(0, -0.01);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.005, bevelEnabled: false, curveSegments: 10 });
    g.translate(0, 0, -0.0025).rotateY(Math.PI / 2);
    return g;
  });
}

function edgeGeometry() {
  return cached('knifeEdge', () => {
    const s = new THREE.Shape();
    s.moveTo(0.016, -0.016);
    s.lineTo(0.1, -0.017);
    s.quadraticCurveTo(0.156, -0.019, 0.178, 0.001);
    s.quadraticCurveTo(0.15, -0.007, 0.1, -0.008);
    s.lineTo(0.018, -0.007);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.0064, bevelEnabled: false, curveSegments: 10 });
    g.translate(0, 0, -0.0032).rotateY(Math.PI / 2);
    return g;
  });
}

export const knife = (m) => {
  const g = new THREE.Group();
  const BZ = -0.052;
  // Клинок со светлой режущей кромкой и долом.
  put(g, new THREE.Mesh(bladeGeometry(), m.steel), 0, 0.004, BZ);
  put(g, new THREE.Mesh(edgeGeometry(), m.bright), 0, 0.004, BZ);
  put(g, box(0.0058, 0.0035, 0.075, m.darkSteel), 0, 0.009, BZ - 0.055);
  // Гарда, рукоять, навершие.
  put(g, rbox(0.016, 0.062, 0.012, 0.004, m.darkSteel), 0, -0.002, -0.046);
  put(g, rbox(0.024, 0.016, 0.014, 0.004, m.darkSteel), 0, 0.002, -0.036);
  put(g, rbox(0.024, 0.03, 0.1, 0.01, m.rubber), 0, 0, 0.012);
  for (let i = 0; i < 4; i++) put(g, rbox(0.026, 0.032, 0.006, 0.003, m.polymer), 0, 0, -0.02 + i * 0.019);
  put(g, rbox(0.027, 0.033, 0.01, 0.003, m.accent), 0, 0, 0.056);
  put(g, rbox(0.026, 0.03, 0.016, 0.006, m.darkSteel), 0, 0, 0.069);
  put(g, cyl(0.004, 0.004, 0.028, m.bright, 8), 0, -0.004, 0.069, 0, Math.PI / 2);
  const mag = new THREE.Group();
  g.add(mag);
  const muzzle = new THREE.Vector3(0, 0.005, BZ - 0.178);
  return { group: g, muzzle, sightY: 0.03, mag, eject: muzzle.clone() };
};

export const grenade = (m) => {
  const x = xm();
  const g = new THREE.Group();
  const A = 0.031, B = 0.037, CY = -0.014;
  const pts = [];
  for (let i = 0; i <= 12; i++) {
    const t = -Math.PI / 2 + (i / 12) * Math.PI;
    pts.push(new THREE.Vector2(Math.max(0.0001, Math.cos(t) * A), Math.sin(t) * B));
  }
  put(g, new THREE.Mesh(cached('grenBody', () => new THREE.LatheGeometry(pts, 18)), x.oliveDark), 0, CY, 0);
  // Насечки «ананаса».
  for (let r = 0; r < 5; r++) {
    const y = -0.026 + r * 0.013;
    const R = A * Math.sqrt(Math.max(0, 1 - (y / B) ** 2));
    const phi = Math.atan2(y / (B * B), R / (A * A));
    const w = Math.max(0.008, R * 0.62);
    for (let j = 0; j < 8; j++) {
      const a = (j * Math.PI) / 4 + (r % 2) * 0.0;
      const tile = put(g, rbox(w, 0.0105, 0.007, 0.0025, m.olive), Math.sin(a) * R, CY + y, Math.cos(a) * R);
      tile.rotation.order = 'YXZ';
      tile.rotation.set(-phi, a, 0);
    }
  }
  // Запал, рычаг и кольцо чеки.
  put(g, cyl(0.014, 0.014, 0.01, m.darkSteel, 16), 0, CY + B + 0.002, 0, Math.PI / 2);
  put(g, cyl(0.011, 0.011, 0.014, m.steel, 16), 0, CY + B + 0.013, 0, Math.PI / 2);
  put(g, cyl(0.008, 0.008, 0.008, m.bright, 14), 0, CY + B + 0.024, 0, Math.PI / 2);
  put(g, rbox(0.03, 0.005, 0.011, 0.002, m.steel), 0.01, CY + B + 0.022, 0);
  put(g, rbox(0.005, 0.05, 0.009, 0.002, m.steel), 0.028, CY + B - 0.004, 0, 0, 0, 0.24);
  put(g, rbox(0.005, 0.014, 0.009, 0.002, m.steel), 0.033, CY + B - 0.032, 0, 0, 0, -0.12);
  put(g, cyl(0.002, 0.002, 0.03, m.brass, 6), -0.012, CY + B + 0.012, 0, 0, Math.PI / 2);
  put(g, torus(0.011, 0.0022, m.brass, Math.PI * 2, 18), -0.034, CY + B + 0.012, 0, 0, Math.PI / 2, 0);
  return g;
};

export const rocketModel = (m) => {
  const x = xm();
  const g = new THREE.Group();
  const head = warhead(m);
  put(g, head, 0, 0, 0.05);
  put(g, cyl(0.021, 0.021, 0.18, m.darkSteel, 14), 0, 0, 0.14);
  put(g, cyl(0.024, 0.024, 0.012, m.steel, 14), 0, 0, 0.1);
  put(g, cyl(0.026, 0.018, 0.03, m.steel, 14), 0, 0, 0.235);
  put(g, cyl(0.016, 0.016, 0.004, x.exhaust, 14), 0, 0, 0.251);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    const fin = put(g, new THREE.Group(), 0, 0, 0.19, 0, 0, a);
    put(fin, rbox(0.004, 0.045, 0.07, 0.0018, m.olive), 0, 0.04, 0.01);
    put(fin, rbox(0.005, 0.01, 0.075, 0.002, m.accent), 0, 0.061, 0.012);
  }
  return g;
};
