// 3D 迷宫：three.js 场景、状态机、相机与界面。纯逻辑在 game-logic.js。
import * as THREE from './vendor/three.module.js';
import { MazeGenerator } from './maze-core.js';
import {
  DIRS,
  parseSeed,
  parseSize,
  facingYaw,
  wallSegments,
  floorKind,
  findNextIntersection,
  resolveInput,
  followOffset,
  isInFogView,
  clampRadius,
  findPath,
  wallInView,
  summarizeFrames,
  createFrameMeter,
  shouldDowngrade,
} from './game-logic.js';

const STEP_MS = 120;
const TURN_MS = 200;
const EYE_HEIGHT = 0.45;

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

// localStorage 在隐私模式等情况下可能抛异常，读写都要兜住
function storageGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 保存失败不影响游戏
  }
}
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
  // 调试参数：?debug=1 显示帧统计；&slow=<ms> 每帧在渲染前忙等，用来真实触发降画质
  const debug = params.get('debug') === '1';
  const slowMs = debug ? Math.max(0, parseInt(params.get('slow'), 10) || 0) : 0;

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

  // ---------- 迷雾与道路 ----------
  let fogOn = storageGet('maze3d.fogOn') !== '0';
  let fogRadius = clampRadius(storageGet('maze3d.fogRadius') ?? 5);
  let showPath = false;
  let pathSet = null;
  let fogRecomputeCount = 0;

  const tmpMatrix = new THREE.Matrix4();
  const tmpColor = new THREE.Color();
  const tmpDir = new THREE.Vector3();
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
    cancelAnimation();
    $('win').hidden = true;
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

    camYaw = facingYaw(pos.facing);
    updateSceneFog();
    recomputeFog();
    snapCamera();
  }

  function placePlayer(v) {
    player.position.set(v.x, 0, v.z);
  }

  function cellVisible(row, col) {
    return !fogOn || isInFogView(display, { row, col }, fogRadius);
  }

  function onPathSet() {
    return pathSet;
  }

  // 唯一的迷雾重算入口：只在显示格变化、视野 / 开关 / 道路变化、重建迷宫时调用
  function recomputeFog() {
    fogRecomputeCount += 1;
    if (showPath) {
      const path = findPath(connections, display, { row: size - 1, col: size - 1 });
      pathSet = new Set(path.map(([r, c]) => r * size + c));
    } else {
      pathSet = null;
    }
    applyWallVisibility();
    applyFloorColors();
    drawMinimap();
  }

  function updateFogUi() {
    $('fog-btn').textContent = fogOn ? '迷雾：开' : '迷雾：关';
    $('fog-radius').textContent = `视野 ${fogRadius}`;
    $('fog-minus').disabled = fogRadius <= 1;
    $('fog-plus').disabled = fogRadius >= 25;
  }

  function setFog(on, radius) {
    fogOn = on;
    fogRadius = clampRadius(radius);
    storageSet('maze3d.fogOn', fogOn ? '1' : '0');
    storageSet('maze3d.fogRadius', String(fogRadius));
    updateFogUi();
    updateSceneFog();
    recomputeFog();
  }

  $('fog-btn').addEventListener('click', () => setFog(!fogOn, fogRadius));
  $('fog-minus').addEventListener('click', () => setFog(fogOn, fogRadius - 1));
  $('fog-plus').addEventListener('click', () => setFog(fogOn, fogRadius + 1));
  $('show-path-btn').addEventListener('click', () => {
    showPath = true;
    recomputeFog();
  });
  $('hide-path-btn').addEventListener('click', () => {
    showPath = false;
    recomputeFog();
  });
  updateFogUi();

  function applyWallVisibility() {
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      const visible = !fogOn || wallInView(s, display, fogRadius);
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
  // 跟随中心平滑追赶小人，偏移（高度、向南距离）平滑追赶视野半径对应的值；
  // 相机位置与观察点都由「中心 + 偏移」得出，偏移没有东西分量，所以水平朝向始终朝北
  const followCenter = new THREE.Vector3();
  const followOff = { h: 0, d: 0 };

  function currentFollowOffset() {
    return followOffset(fogOn ? fogRadius : 10);
  }

  function placeFollow() {
    camera.position.set(followCenter.x, followCenter.y + followOff.h, followCenter.z + followOff.d);
    camera.lookAt(followCenter);
  }

  // 第一人称当前显示的偏航角（转身动画期间在旧值与新值之间插值）
  let camYaw = 0;

  function placeFirstPerson() {
    camera.position.set(player.position.x, EYE_HEIGHT, player.position.z);
    camera.rotation.set(0, camYaw, 0);
  }

  function snapCamera() {
    if (view === 'first') {
      placeFirstPerson();
      return;
    }
    followCenter.copy(player.position);
    Object.assign(followOff, currentFollowOffset());
    placeFollow();
  }

  function updateCamera(dt) {
    if (view === 'first') {
      placeFirstPerson();
      return;
    }
    const k = 1 - Math.pow(0.001, dt / 1000);
    const want = currentFollowOffset();
    followCenter.lerp(player.position, k);
    followOff.h += (want.h - followOff.h) * k;
    followOff.d += (want.d - followOff.d) * k;
    placeFollow();
  }

  function updateSceneFog() {
    if (view !== 'first') {
      scene.fog = null;
      return;
    }
    const far = fogOn ? fogRadius + 0.5 : size * 1.5;
    if (scene.fog) {
      scene.fog.near = 0.5;
      scene.fog.far = far;
    } else {
      scene.fog = new THREE.Fog(COLORS.background, 0.5, far);
    }
  }

  function setView(next) {
    view = next;
    const first = view === 'first';
    $('view-btn').textContent = first ? '切换到跟随视角' : '切换到第一人称';
    $('minimap').hidden = !first;
    player.visible = !first;
    camYaw = facingYaw(pos.facing);
    updateSceneFog();
    snapCamera();
    if (first) drawMinimap();
  }

  $('view-btn').addEventListener('click', () => {
    cancelAnimation();
    setView(view === 'first' ? 'follow' : 'first');
  });

  // ---------- 小地图 ----------
  const minimap = $('minimap');
  const miniCtx = minimap.getContext('2d');

  function drawMinimap() {
    if (minimap.hidden || !connections) return;
    const dpr = window.devicePixelRatio || 1;
    const css = minimap.clientWidth || 140;
    const px = Math.round(css * dpr);
    if (minimap.width !== px || minimap.height !== px) {
      minimap.width = px;
      minimap.height = px;
    }
    const ctx = miniCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, px, px);
    const pad = 6 * dpr;
    const cell = (px - pad * 2) / size;
    ctx.fillStyle = '#f2efe6';
    ctx.fillRect(pad, pad, cell * size, cell * size);
    ctx.fillStyle = '#e53935';
    ctx.fillRect(pad + (size - 1) * cell, pad + (size - 1) * cell, cell, cell);
    ctx.strokeStyle = '#7e57c2';
    ctx.lineWidth = Math.max(1, 1.5 * dpr);
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const seg of segments) {
      if (fogOn && !wallInView(seg, display, fogRadius)) continue;
      if (seg.along === 'x') {
        ctx.moveTo(pad + (seg.x - 0.5) * cell, pad + seg.z * cell);
        ctx.lineTo(pad + (seg.x + 0.5) * cell, pad + seg.z * cell);
      } else {
        ctx.moveTo(pad + seg.x * cell, pad + (seg.z - 0.5) * cell);
        ctx.lineTo(pad + seg.x * cell, pad + (seg.z + 0.5) * cell);
      }
    }
    ctx.stroke();
    const cx = pad + (display.col + 0.5) * cell;
    const cy = pad + (display.row + 0.5) * cell;
    const r = Math.max(2.5 * dpr, cell * 0.3);
    ctx.fillStyle = '#ff9800';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    const [dr, dc] = DIRS[pos.facing];
    const tip = r * 2.2;
    ctx.fillStyle = '#d84315';
    ctx.beginPath();
    ctx.moveTo(cx + dc * tip, cy + dr * tip);
    ctx.lineTo(cx + dr * r * 0.9 + dc * r * 0.6, cy - dc * r * 0.9 + dr * r * 0.6);
    ctx.lineTo(cx - dr * r * 0.9 + dc * r * 0.6, cy + dc * r * 0.9 + dr * r * 0.6);
    ctx.closePath();
    ctx.fill();
  }

  // ---------- 移动与状态机 ----------
  let anim = null;

  function newSeed() {
    return Date.now() + Math.floor(Math.random() * 1000);
  }

  function onDisplayCellChanged() {
    recomputeFog();
  }

  function cancelAnimation() {
    anim = null;
    if (!connections) return;
    pos.row = display.row;
    pos.col = display.col;
    placePlayer(cellCenter(display.row, display.col, tmpPos));
    player.rotation.y = facingYaw(pos.facing);
    camYaw = facingYaw(pos.facing);
    if (state === 'moving' || state === 'turning') state = 'idle';
  }

  function shortestYaw(from, to) {
    let delta = (to - from) % (Math.PI * 2);
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    return from + delta;
  }

  function handleDirection(key) {
    if (state !== 'idle' || !connections) return;
    const action = resolveInput(view, pos.facing, key);
    if (action.type === 'turn') {
      const fromYaw = camYaw;
      pos.facing = action.facing;
      state = 'turning';
      anim = {
        generation,
        kind: 'turn',
        fromYaw,
        toYaw: shortestYaw(fromYaw, facingYaw(action.facing)),
        startTime: performance.now(),
      };
      drawMinimap();
      return;
    }
    const dest = findNextIntersection(connections, pos, action.dir);
    if (!dest) return;
    const [dr, dc] = DIRS[action.dir];
    const cells = [{ row: pos.row, col: pos.col }];
    let r = pos.row;
    let c = pos.col;
    while (r !== dest.row || c !== dest.col) {
      r += dr;
      c += dc;
      cells.push({ row: r, col: c });
    }
    pos.facing = action.dir;
    player.rotation.y = facingYaw(pos.facing);
    camYaw = facingYaw(pos.facing);
    state = 'moving';
    anim = { generation, kind: 'move', cells, startTime: performance.now(), reached: 0 };
  }

  function stepAnimation(now) {
    if (!anim) return;
    if (anim.generation !== generation) {
      anim = null;
      return;
    }
    if (anim.kind === 'turn') {
      const t = Math.min((now - anim.startTime) / TURN_MS, 1);
      camYaw = anim.fromYaw + (anim.toYaw - anim.fromYaw) * t;
      player.rotation.y = camYaw;
      if (t >= 1) {
        anim = null;
        camYaw = facingYaw(pos.facing);
        player.rotation.y = camYaw;
        state = 'idle';
      }
      return;
    }
    const { cells } = anim;
    const last = cells.length - 1;
    const t = Math.min((now - anim.startTime) / STEP_MS, last);
    const reached = Math.floor(t);
    while (anim.reached < reached) {
      anim.reached += 1;
      display.row = cells[anim.reached].row;
      display.col = cells[anim.reached].col;
      onDisplayCellChanged();
    }
    if (t >= last) {
      const end = cells[last];
      anim = null;
      pos.row = end.row;
      pos.col = end.col;
      placePlayer(cellCenter(end.row, end.col, tmpPos));
      if (end.row === size - 1 && end.col === size - 1) {
        state = 'won';
        $('win').hidden = false;
      } else {
        state = 'idle';
      }
      return;
    }
    const a = cells[reached];
    const b = cells[reached + 1];
    const f = t - reached;
    player.position.set(
      a.col + 0.5 + (b.col - a.col) * f,
      0,
      a.row + 0.5 + (b.row - a.row) * f,
    );
  }

  // ---------- 输入 ----------
  const KEY_DIRS = {
    ArrowUp: 'up',
    w: 'up',
    W: 'up',
    ArrowDown: 'down',
    s: 'down',
    S: 'down',
    ArrowLeft: 'left',
    a: 'left',
    A: 'left',
    ArrowRight: 'right',
    d: 'right',
    D: 'right',
  };

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const dir = KEY_DIRS[e.key];
    if (!dir) return;
    if (e.key.startsWith('Arrow')) e.preventDefault();
    handleDirection(dir);
  });

  document.querySelectorAll('.dpad button[data-dir]').forEach((btn) => {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handleDirection(btn.dataset.dir);
    });
  });

  document.querySelectorAll('.size-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const newSize = parseSize(btn.dataset.size);
      writeUrl({ size: newSize });
      buildMaze(seed, newSize);
    });
  });

  function regenerate() {
    const s = newSeed();
    writeUrl({ seed: s });
    buildMaze(s, size);
  }
  $('regen-btn').addEventListener('click', regenerate);
  $('again-btn').addEventListener('click', regenerate);

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
  let meter = createFrameMeter();
  let quality = 'high';
  let downgradeCount = 0;
  let rafId = null;

  // 换成不抗锯齿、像素比 1 的新 renderer；只执行一次
  function downgrade() {
    const old = renderer;
    let next;
    try {
      next = createRenderer(false);
    } catch {
      quality = 'low';
      return;
    }
    next.setPixelRatio(1);
    next.setSize(stage.clientWidth, stage.clientHeight, true);
    stage.replaceChild(next.domElement, old.domElement);
    old.dispose();
    renderer = next;
    quality = 'low';
    downgradeCount += 1;
    meter.reset();
  }

  let lastTime = performance.now();
  function frame(now) {
    rafId = null;
    meter.tick(now);
    if (quality === 'high' && shouldDowngrade(meter.window())) downgrade();
    if (slowMs > 0) {
      const t0 = performance.now();
      while (performance.now() - t0 < slowMs) {
        // 忙等，模拟慢设备
      }
    }
    const dt = Math.max(0, Math.min(now - lastTime, 100));
    lastTime = now;
    stepAnimation(performance.now());
    star.rotation.y += (dt / 1000) * 1;
    updateCamera(dt);
    renderer.render(scene, camera);
    rafId = requestAnimationFrame(frame);
  }

  function startLoop() {
    if (rafId !== null) return;
    meter.reset();
    lastTime = performance.now();
    rafId = requestAnimationFrame(frame);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
    } else {
      startLoop();
    }
  });

  if (debug) {
    const perf = $('perf');
    perf.hidden = false;
    setInterval(() => {
      const st = summarizeFrames(meter.deltas());
      perf.textContent = `帧时间 平均 ${st.avg.toFixed(1)} ms · p95 ${st.p95.toFixed(1)} ms · 画质 ${quality}`;
    }, 500);
  }

  function rendererName() {
    try {
      const gl = renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '') : '';
    } catch {
      return '';
    }
  }

  buildMaze(seed, size);
  startLoop();

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
        // 不用 decompose：r187 对行列式为 0 的矩阵直接返回缩放 1
        const e = tmpMatrix.elements;
        const scale = Math.hypot(e[0], e[1], e[2]) * Math.hypot(e[4], e[5], e[6]);
        out.push(scale * Math.hypot(e[8], e[9], e[10]) !== 0);
      }
      return out;
    },
    floorColorHex(row, col) {
      floor.getColorAt(row * size + col, tmpColor);
      return '#' + tmpColor.getHexString();
    },
    sampleDistinctColors,
    get fog() {
      return { on: fogOn, radius: fogRadius };
    },
    get showPath() {
      return showPath;
    },
    get fogRecomputeCount() {
      return fogRecomputeCount;
    },
    frameStats() {
      return summarizeFrames(meter.deltas());
    },
    resetFrameStats() {
      meter = createFrameMeter();
    },
    get quality() {
      return quality;
    },
    get downgradeCount() {
      return downgradeCount;
    },
    get rendererName() {
      return rendererName();
    },
    get threeRevision() {
      return THREE.REVISION;
    },
    // 相机视线在水平面上偏离正北（−z）的角度，弧度；朝北为 0
    get cameraYaw() {
      camera.getWorldDirection(tmpDir);
      return Math.atan2(-tmpDir.x, -tmpDir.z);
    },
  };
}
