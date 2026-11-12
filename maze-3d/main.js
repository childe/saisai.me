// 3D 迷宫：three.js 场景、状态机、相机与界面。纯逻辑在 game-logic.js。
import * as THREE from './vendor/three.module.js';
import { MazeGenerator } from './maze-core.js';
import {
  parseSeed,
  parseSize,
  facingYaw,
  wallSegments,
  floorKind,
} from './game-logic.js';

const COLORS = {
  background: 0xbfe3ff,
  floor: 0xf2efe6,
  start: 0x4caf50,
  end: 0xe53935,
  path: 0xff6b6b,
  fog: 0x333333,
  wall: 0x7e57c2,
  player: 0xff9800,
  star: 0xffd600,
};

const $ = (id) => document.getElementById(id);
const stage = $('stage');

// ---------- WebGL 探测与降级 ----------
function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

function showNoWebGL() {
  $('no-webgl').hidden = false;
  stage.style.display = 'none';
  document.querySelector('.dpad').style.display = 'none';
}

let renderer = null;
if (hasWebGL()) {
  try {
    renderer = createRenderer(true);
  } catch {
    renderer = null;
  }
}

function createRenderer(antialias) {
  const r = new THREE.WebGLRenderer({ antialias });
  r.setClearColor(COLORS.background);
  return r;
}

if (!renderer) {
  showNoWebGL();
} else {
  start();
}

function start() {
  // ---------- URL 参数 ----------
  const params = new URLSearchParams(location.search);
  let seed = parseSeed(params.get('seed'));
  if (seed === null) {
    seed = Date.now();
    writeUrl({ seed });
  }
  let size = parseSize(params.get('size'));

  function writeUrl(values) {
    const url = new URL(location.href);
    for (const [k, v] of Object.entries(values)) url.searchParams.set(k, String(v));
    history.replaceState(null, '', url);
  }

  // ---------- 场景 ----------
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  stage.insertBefore(renderer.domElement, stage.firstChild);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.background);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 200);
  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const sun = new THREE.DirectionalLight(0xffffff, 1.0);
  sun.position.set(5, 10, 7);
  scene.add(sun);

  const wallGeometry = new THREE.BoxGeometry(1.1, 0.8, 0.1);
  const wallMaterial = new THREE.MeshLambertMaterial({ color: COLORS.wall });
  const floorGeometry = new THREE.BoxGeometry(1, 0.05, 1);
  const floorMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });

  const player = buildPlayer();
  scene.add(player);
  const star = buildStar();
  scene.add(star);

  let connections = null;
  let segments = [];
  let walls = null;
  let floor = null;
  let generation = 0;
  let state = 'idle';
  let view = 'follow';
  const pos = { row: 0, col: 0, facing: 'down' };
  const display = { row: 0, col: 0 };

  const tmpMatrix = new THREE.Matrix4();
  const tmpColor = new THREE.Color();
  const tmpPos = new THREE.Vector3();
  const tmpQuat = new THREE.Quaternion();
  const tmpScale = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0);

  function buildPlayer() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 24, 16),
      new THREE.MeshLambertMaterial({ color: COLORS.player }),
    );
    body.position.y = 0.3;
    g.add(body);
    const white = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const black = new THREE.MeshBasicMaterial({ color: 0x111111 });
    const eyeGeo = new THREE.SphereGeometry(0.08, 12, 8);
    const pupilGeo = new THREE.SphereGeometry(0.04, 8, 6);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeo, white);
      eye.position.set(side * 0.11, 0.4, -0.25);
      g.add(eye);
      const pupil = new THREE.Mesh(pupilGeo, black);
      pupil.position.set(side * 0.11, 0.4, -0.32);
      g.add(pupil);
    }
    return g;
  }

  function buildStar() {
    const shape = new THREE.Shape();
    const outer = 0.25;
    const inner = 0.1;
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const a = Math.PI / 2 + (i * Math.PI) / 5;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: false });
    geo.center();
    return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: COLORS.star }));
  }

  function cellCenter(row, col, out = new THREE.Vector3()) {
    return out.set(col + 0.5, 0, row + 0.5);
  }

  function disposeMaze() {
    for (const m of [walls, floor]) {
      if (m) {
        scene.remove(m);
        m.dispose();
      }
    }
    walls = null;
    floor = null;
  }

  function buildMaze(newSeed, newSize) {
    seed = newSeed;
    size = newSize;
    disposeMaze();
    connections = new MazeGenerator(size, size, seed).generate().connections;
    segments = wallSegments(connections);

    walls = new THREE.InstancedMesh(wallGeometry, wallMaterial, segments.length);
    walls.frustumCulled = false;
    scene.add(walls);

    floor = new THREE.InstancedMesh(floorGeometry, floorMaterial, size * size);
    floor.frustumCulled = false;
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        tmpMatrix.makeTranslation(col + 0.5, -0.025, row + 0.5);
        floor.setMatrixAt(row * size + col, tmpMatrix);
        floor.setColorAt(row * size + col, tmpColor.setHex(COLORS.floor));
      }
    }
    floor.instanceMatrix.needsUpdate = true;
    scene.add(floor);

    generation += 1;
    pos.row = 0;
    pos.col = 0;
    pos.facing = 'down';
    display.row = 0;
    display.col = 0;
    state = 'idle';

    star.position.set(size - 0.5, 0.6, size - 0.5);
    placePlayer(cellCenter(0, 0, tmpPos));
    player.rotation.y = facingYaw(pos.facing);

    document.querySelectorAll('.size-btn').forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.size) === size);
    });

    applyWallVisibility();
    applyFloorColors();
    snapCamera();
  }

  function placePlayer(v) {
    player.position.set(v.x, 0, v.z);
  }

  function cellVisible() {
    return true;
  }

  function onPathSet() {
    return null;
  }

  function applyWallVisibility() {
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      const visible = s.cells.some(([row, col]) => cellVisible(row, col));
      tmpPos.set(s.x, 0.4, s.z);
      tmpQuat.setFromAxisAngle(yAxis, s.along === 'z' ? Math.PI / 2 : 0);
      tmpScale.setScalar(visible ? 1 : 0);
      tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
      walls.setMatrixAt(i, tmpMatrix);
    }
    walls.instanceMatrix.needsUpdate = true;
  }

  function applyFloorColors() {
    const path = onPathSet();
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const kind = floorKind({ row, col }, size, {
          inView: cellVisible(row, col),
          onPath: path ? path.has(row * size + col) : false,
        });
        floor.setColorAt(row * size + col, tmpColor.setHex(COLORS[kind]));
      }
    }
    floor.instanceColor.needsUpdate = true;
  }

  // ---------- 相机 ----------
  const FOLLOW_OFFSET = { h: 7, d: 5 };
  const camTarget = new THREE.Vector3();

  function followTarget(out) {
    return out.set(
      player.position.x,
      player.position.y + FOLLOW_OFFSET.h,
      player.position.z + FOLLOW_OFFSET.d,
    );
  }

  function snapCamera() {
    followTarget(camera.position);
    camera.lookAt(player.position);
  }

  // ---------- 尺寸 ----------
  function resize() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, true);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(stage);
  resize();

  // ---------- 渲染循环 ----------
  let lastTime = performance.now();
  function frame(now) {
    const dt = Math.min(now - lastTime, 100);
    lastTime = now;
    star.rotation.y += (dt / 1000) * 1;
    followTarget(camTarget);
    camera.position.copy(camTarget);
    camera.lookAt(player.position);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  buildMaze(seed, size);
  requestAnimationFrame(frame);

  // ---------- 调试对象 ----------
  function sampleDistinctColors() {
    renderer.render(scene, camera);
    const gl = renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const px = new Uint8Array(4);
    const seen = new Set();
    for (let i = 0; i < 32; i++) {
      for (let j = 0; j < 32; j++) {
        const x = Math.floor(((i + 0.5) / 32) * w);
        const y = Math.floor(((j + 0.5) / 32) * h);
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        seen.add((px[0] << 16) | (px[1] << 8) | px[2]);
      }
    }
    return seen.size;
  }

  window.__maze3d = {
    get seed() {
      return seed;
    },
    get size() {
      return size;
    },
    get connections() {
      return connections;
    },
    get generation() {
      return generation;
    },
    get state() {
      return state;
    },
    get view() {
      return view;
    },
    get player() {
      return { row: pos.row, col: pos.col, facing: pos.facing };
    },
    get display() {
      return { row: display.row, col: display.col };
    },
    get playerVisible() {
      return player.visible;
    },
    get segments() {
      return segments;
    },
    wallsVisible() {
      const out = [];
      for (let i = 0; i < segments.length; i++) {
        walls.getMatrixAt(i, tmpMatrix);
        tmpMatrix.decompose(tmpPos, tmpQuat, tmpScale);
        out.push(tmpScale.x !== 0 || tmpScale.y !== 0 || tmpScale.z !== 0);
      }
      return out;
    },
    floorColorHex(row, col) {
      floor.getColorAt(row * size + col, tmpColor);
      return '#' + tmpColor.getHexString();
    },
    sampleDistinctColors,
    get threeRevision() {
      return THREE.REVISION;
    },
  };
}
