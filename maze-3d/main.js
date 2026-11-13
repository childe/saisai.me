// 3D 迷宫：three.js 场景、状态机、相机与界面。纯逻辑在 game-logic.js。
import * as THREE from './vendor/three.module.js';
import { MazeGenerator } from './maze-core.js';
import {
  parseSeed,
  parseSize,
  wallSegments,
  floorKind,
  followOffset,
  isInFogView,
  clampRadius,
  findPath,
  wallInView,
  fogRing,
  groundFogFarMax,
  groundHalfExtent,
  followFogRange,
  summarizeFrames,
  createFrameMeter,
  shouldDowngrade,
} from './game-logic.js';
import {
  THEMES,
  parseTheme,
  blockColorIndex,
  wallShade,
  paintWall,
  paintWallTop,
  paintFloor,
  paintGround,
  mixHex,
} from './themes.js';
import { wallGroupLayout, applyWallUvs } from './wall-geometry.js';
import {
  PLAYER_RADIUS,
  WALL_LENGTH,
  WALL_HEIGHT,
  WALL_THICKNESS,
  PLAYER_PARTS,
  playerModelScale,
  wallBoxes,
  segmentBoxes,
  createBoxGrid,
  cellOf,
  stepPlayer,
  TARGET_HEIGHT,
  FOLLOW_PITCH,
  FIRST_PITCH,
  ZOOM_MIN,
  ZOOM_MAX,
  wallBoxes3d,
  followCameraPos,
  cameraPullIn,
  liftPitch,
  smoothCameraDistance,
  TURN_SPEED,
  LOOK_SPEED,
  inputFromKeys,
  inputFromStick,
  applyKeyEvent,
  createPointerRouter,
} from './movement.js';
import {
  startYaw,
  LOOK_AHEAD,
  lookAheadTarget,
  SHADOW_RADIUS,
  shadowLook,
  FOOT_STRIP_WIDTH,
  wallFootStrips,
  BEAM_RADIUS,
  BEAM_HEIGHT,
  SPARK_COUNT,
  beamPulse,
  CONFETTI_COUNT,
  createConfetti,
  confettiStep,
  segmentBlocked,
  HINT_INSET,
  BEAM_SAMPLE_HEIGHTS,
  edgeArrow,
  endHintMode,
} from './effects.js';

const EYE_HEIGHT = 0.45;
const STICK_RADIUS = 50; // 虚拟摇杆底座半径，CSS 像素
const WARM_FRAMES = 16; // 开局预热帧数，见 start() 末尾
const WARM_HINT_FRAMES = 8; // 预热帧中前几帧同时显示（几乎透明的）终点方向提示

// 墙、普通地板格、视野外格子、背景色由主题决定（themes.js）
const COLORS = {
  start: 0x4caf50,
  end: 0xe53935,
  path: 0xffd740, // 金黄；与终点红区分（见 design 第 6 节）
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
}

// 主题在建 renderer 之前读出，renderer 清屏色要用主题的雾色
let themeId = parseTheme(storageGet('maze3d.theme'));

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
  r.setClearColor(THEMES[themeId].fogColor);
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
  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 200);
  const hemi = new THREE.HemisphereLight();
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.0);
  sun.position.set(5, 10, 7);
  scene.add(sun);

  // 外围地面：一整块平面，中心跟随相机按整格移动；半边长保证视锥内的地面边缘都在雾终点之外。
  // 这几个变量必须在首次 resize() 之前声明（resize 会调用 updateGroundExtent）
  let currentTextures = null;
  let groundE = 0;
  const groundMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshLambertMaterial({ color: 0xffffff }),
  );
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.position.y = -0.045;
  groundMesh.frustumCulled = false;
  scene.add(groundMesh);

  function updateGroundExtent() {
    groundE = groundHalfExtent(groundFogFarMax(size, ZOOM_MAX, LOOK_AHEAD), camera.fov, camera.aspect);
    groundMesh.scale.set(2 * groundE, 2 * groundE, 1);
    if (currentTextures) currentTextures.ground.repeat.set(2 * groundE, 2 * groundE);
  }

  function syncGround() {
    groundMesh.position.x = Math.round(camera.position.x);
    groundMesh.position.z = Math.round(camera.position.z);
  }

  // 墙：墙面（侧面与两端）用材质 0，墙顶用材质 1；UV 按世界尺寸缩放，纹理不被拉伸
  const wallGeometry = buildWallGeometry();
  const wallMaterials = [
    new THREE.MeshLambertMaterial({ color: 0xffffff }),
    new THREE.MeshLambertMaterial({ color: 0xffffff }),
  ];
  const floorGeometry = new THREE.BoxGeometry(1, 0.05, 1);
  const floorMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });

  function buildWallGeometry() {
    const geo = new THREE.BoxGeometry(WALL_LENGTH, WALL_HEIGHT, WALL_THICKNESS);
    applyWallUvs(geo.attributes.uv.array, { w: WALL_LENGTH, h: WALL_HEIGHT, d: WALL_THICKNESS });
    geo.attributes.uv.needsUpdate = true;
    const { index, groups } = wallGroupLayout(geo.index.array);
    geo.setIndex(index);
    geo.clearGroups();
    for (const g of groups) geo.addGroup(g.start, g.count, g.materialIndex);
    return geo;
  }

  const { player, bodyGroup } = buildPlayer();
  scene.add(player);

  // 画面效果用的纹理：启动时各建一次，不随主题重建，不计入 liveTextures
  const radialTex = makeRadialTexture();

  // 小人脚下的圆形软阴影：直接挂在 scene 下（不继承模型缩放与起伏），每帧跟随小人
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(2 * SHADOW_RADIUS, 2 * SHADOW_RADIUS),
    new THREE.MeshBasicMaterial({ map: radialTex, color: 0x000000, transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0.5, 0.005, 0.5);
  shadow.renderOrder = 1;
  scene.add(shadow);

  // 墙脚暗边：每条是贴地的窄条，墙根一侧 0.3 不透明度的黑色渐变到外侧透明。
  // 几何本地 +y（纹理顶端、深色边）rotateX 后落到 −z，实例旋转 rotY 后深色边朝向墙根
  const stripGeometry = new THREE.PlaneGeometry(WALL_LENGTH, FOOT_STRIP_WIDTH);
  stripGeometry.rotateX(-Math.PI / 2);
  const stripMaterial = new THREE.MeshBasicMaterial({
    map: makeStripTexture(),
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  let footStrips = [];
  let feet = null;

  // 1×64 竖向渐变：顶端（v = 1，墙根）rgba(0,0,0,0.3) → 底端透明；按 (1 − u)² 衰减，
  // 暗色集中在墙根附近，条带外侧几乎不压暗地板（地板语义色仍可分辨）
  function makeStripTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 64);
    for (let i = 0; i <= 16; i++) {
      const u = i / 16;
      grad.addColorStop(u, `rgba(0,0,0,${(0.3 * (1 - u) * (1 - u)).toFixed(4)})`);
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1, 64);
    return new THREE.CanvasTexture(canvas);
  }

  // 终点光柱：开口圆柱，金黄，底部 0.45 不透明度渐变到顶部透明，加法混合、不写深度、不受雾影响；
  // 透明度倍率随时间脉动。不受迷雾隐藏
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(BEAM_RADIUS, BEAM_RADIUS, BEAM_HEIGHT, 24, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffd54f,
      map: makeBeamTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
    }),
  );
  beam.frustumCulled = false;
  beam.renderOrder = 2;
  scene.add(beam);

  // 光柱周围上升的闪光粒子：位置相对终点格中心，到顶从底部重生
  const sparkData = [];
  const sparkPos = new Float32Array(SPARK_COUNT * 3);
  for (let i = 0; i < SPARK_COUNT; i++) {
    sparkData.push({
      angle: Math.random() * Math.PI * 2,
      radius: 0.15 + Math.random() * 0.35,
      speed: 0.6 + Math.random() * 0.6,
      y: Math.random() * BEAM_HEIGHT,
    });
  }
  const sparkGeometry = new THREE.BufferGeometry();
  sparkGeometry.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparks = new THREE.Points(
    sparkGeometry,
    new THREE.PointsMaterial({
      map: radialTex,
      color: 0xfff3b0,
      size: 0.12,
      sizeAttenuation: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }),
  );
  sparks.frustumCulled = false;
  sparks.renderOrder = 3;
  scene.add(sparks);
  let beamTime = 0;
  let beamPaused = false; // setBeamForTest 用：暂停脉动与粒子
  writeSparks();

  function writeSparks() {
    for (let i = 0; i < SPARK_COUNT; i++) {
      const p = sparkData[i];
      sparkPos[i * 3] = Math.cos(p.angle) * p.radius;
      sparkPos[i * 3 + 1] = p.y;
      sparkPos[i * 3 + 2] = Math.sin(p.angle) * p.radius;
    }
    sparkGeometry.attributes.position.needsUpdate = true;
  }

  function updateBeam(dt) {
    if (beamPaused) return;
    beamTime += dt;
    beam.material.opacity = beamPulse(beamTime);
    for (const p of sparkData) {
      p.y += p.speed * dt;
      if (p.y > BEAM_HEIGHT) p.y -= BEAM_HEIGHT;
    }
    writeSparks();
  }

  // 1×64 竖向渐变：底端（v = 0）alpha 0.45 → 顶端透明
  function makeBeamTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(1, 'rgba(255,255,255,0.45)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1, 64);
    return new THREE.CanvasTexture(canvas);
  }

  // 64×64 白色径向渐变：中心 alpha 0.35、边缘 0；阴影与终点粒子共用
  function makeRadialTexture() {
    const n = 64;
    const canvas = document.createElement('canvas');
    canvas.width = n;
    canvas.height = n;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    grad.addColorStop(0, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, n, n);
    return new THREE.CanvasTexture(canvas);
  }
  const star = buildStar();
  scene.add(star);

  let connections = null;
  let segments = [];
  let boxes = [];
  let grid = createBoxGrid([], 1);
  let boxes3d = [];
  let walls = null;
  let floor = null;
  let generation = 0;
  let state = 'idle'; // 'idle'（游戏中）| 'won'
  let view = 'follow';
  // 小人连续位置与速度（世界单位，1 格 = 1）；display 是小人所在格
  let playerState = { x: 0.5, z: 0.5, vx: 0, vz: 0 };
  const display = { row: 0, col: 0 };
  let yaw = Math.PI; // 视角水平朝向，约定见 movement.js
  let pitch = FOLLOW_PITCH.def;
  let cameraZoom = 1;
  let walkPhase = 0;

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

  // 小人：按 PLAYER_PARTS 建球体（身体、眼睛、瞳孔），整体缩放到碰撞半径内；
  // 起伏动画作用在内层 bodyGroup，外层 player 管位置与朝向
  function buildPlayer() {
    const g = new THREE.Group();
    const body = new THREE.Group();
    const materials = [
      new THREE.MeshLambertMaterial({ color: COLORS.player }),
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
      new THREE.MeshBasicMaterial({ color: 0x111111 }),
    ];
    const geoCache = new Map();
    PLAYER_PARTS.forEach((p, i) => {
      const kind = i === 0 ? 0 : i <= 2 ? 1 : 2;
      const detail = [
        [24, 16],
        [12, 8],
        [8, 6],
      ][kind];
      const key = `${p.r}`;
      if (!geoCache.has(key)) geoCache.set(key, new THREE.SphereGeometry(p.r, detail[0], detail[1]));
      const mesh = new THREE.Mesh(geoCache.get(key), materials[kind]);
      mesh.position.set(p.x, p.y, p.z);
      body.add(mesh);
    });
    g.add(body);
    g.scale.setScalar(playerModelScale());
    return { player: g, bodyGroup: body };
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

  function disposeMaze() {
    for (const m of [walls, floor, feet]) {
      if (m) {
        scene.remove(m);
        m.dispose();
      }
    }
    walls = null;
    floor = null;
    feet = null;
  }

  // ---------- 通关彩带 ----------
  // 2D canvas 盖在整个画面上；只在判胜那一刻启动，重建迷宫时立即取消
  const confettiCanvas = $('confetti');
  const confettiCtx = confettiCanvas.getContext('2d');
  let confettiActive = false;
  let confetti = null;

  function startConfetti() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const dpr = window.devicePixelRatio || 1;
    confettiCanvas.width = Math.max(1, Math.round(window.innerWidth * dpr));
    confettiCanvas.height = Math.max(1, Math.round(window.innerHeight * dpr));
    confetti = createConfetti(CONFETTI_COUNT, confettiCanvas.width, confettiCanvas.height);
    confettiActive = true;
  }

  function cancelConfetti() {
    confettiActive = false;
    confetti = null;
    confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
  }

  function drawConfetti(dt) {
    if (!confettiActive) return;
    const W = confettiCanvas.width;
    const H = confettiCanvas.height;
    confetti = confettiStep(confetti, dt, H);
    confettiCtx.clearRect(0, 0, W, H);
    if (confetti.done) {
      confettiActive = false;
      confetti = null;
      return;
    }
    confettiCtx.globalAlpha = confetti.alpha;
    for (const p of confetti.pieces) {
      if (p.y < -p.h || p.y > H + p.h) continue;
      confettiCtx.setTransform(1, 0, 0, 1, p.x, p.y);
      confettiCtx.rotate(p.rot);
      confettiCtx.fillStyle = p.color;
      confettiCtx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    }
    confettiCtx.setTransform(1, 0, 0, 1, 0, 0);
    confettiCtx.globalAlpha = 1;
  }

  function buildMaze(newSeed, newSize) {
    cancelConfetti();
    $('win').hidden = true;
    seed = newSeed;
    size = newSize;
    disposeMaze();
    connections = new MazeGenerator(size, size, seed).generate().connections;
    segments = wallSegments(connections);
    boxes = wallBoxes(segments, size);
    grid = createBoxGrid(boxes, size);
    boxes3d = wallBoxes3d(segmentBoxes(segments)); // 相机只避让看得见的墙，不含开口封口

    walls = new THREE.InstancedMesh(wallGeometry, wallMaterials, segments.length);
    walls.frustumCulled = false;
    colorWalls();
    scene.add(walls);

    footStrips = wallFootStrips(segments);
    feet = new THREE.InstancedMesh(stripGeometry, stripMaterial, footStrips.length);
    feet.frustumCulled = false;
    scene.add(feet);

    floor = new THREE.InstancedMesh(floorGeometry, floorMaterial, size * size);
    floor.frustumCulled = false;
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        tmpMatrix.makeTranslation(col + 0.5, -0.025, row + 0.5);
        floor.setMatrixAt(row * size + col, tmpMatrix);
        floor.setColorAt(row * size + col, tmpColor.setHex(THEMES[themeId].floorBase));
      }
    }
    floor.instanceMatrix.needsUpdate = true;
    scene.add(floor);

    generation += 1;
    resetPlayer();
    resetInput();
    state = 'idle';

    star.position.set(size - 0.5, 0.6, size - 0.5);
    beam.position.set(size - 0.5, BEAM_HEIGHT / 2, size - 0.5);
    sparks.position.set(size - 0.5, 0, size - 0.5);

    document.querySelectorAll('.size-btn').forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.size) === size);
    });

    updateSceneFog();
    recomputeFog();
    updateGroundExtent();
    snapCamera();
  }

  // 回到起点格中心，速度清零，朝迷宫中心
  function resetPlayer() {
    playerState = { x: 0.5, z: 0.5, vx: 0, vz: 0 };
    display.row = 0;
    display.col = 0;
    yaw = startYaw(size);
    walkPhase = 0;
    player.position.set(playerState.x, 0, playerState.z);
    player.rotation.y = -yaw;
    bodyGroup.position.y = 0;
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
    miniBaseDirty = true;
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
    const segVisible = new Array(segments.length);
    const visibleSegs = [];
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      const visible = !fogOn || wallInView(s, display, fogRadius);
      segVisible[i] = visible;
      if (visible) visibleSegs.push(s);
      tmpPos.set(s.x, WALL_HEIGHT / 2, s.z);
      tmpQuat.setFromAxisAngle(yAxis, s.along === 'z' ? Math.PI / 2 : 0);
      tmpScale.setScalar(visible ? 1 : 0);
      tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
      walls.setMatrixAt(i, tmpMatrix);
    }
    walls.instanceMatrix.needsUpdate = true;
    // 暗边跟随所属墙段的可见性
    for (let i = 0; i < footStrips.length; i++) {
      const st = footStrips[i];
      tmpPos.set(st.x, 0.003, st.z);
      tmpQuat.setFromAxisAngle(yAxis, st.rotY);
      tmpScale.setScalar(segVisible[st.seg] ? 1 : 0);
      tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
      feet.setMatrixAt(i, tmpMatrix);
    }
    feet.instanceMatrix.needsUpdate = true;
    // 终点方向提示的遮挡判断只算看得见的墙（不外扩）
    hintBoxes = wallBoxes3d(segmentBoxes(visibleSegs), WALL_HEIGHT, 0);
  }

  // ---------- 终点方向提示 ----------
  // 光柱采样点都看不见时提示终点方向：都在画面外 → 边框箭头；在画面内但被墙挡住 → 标记
  let hintBoxes = [];
  const endArrowEl = $('end-arrow');
  const endArrowHead = endArrowEl.querySelector('.end-arrow-head');
  const endMarkerEl = $('end-marker');
  const endDistEls = [...document.querySelectorAll('#end-arrow .end-dist, #end-marker .end-dist')];
  const endHint = { mode: 'hidden', x: 0, y: 0, angle: 0, distance: 0 };
  let shownHintMode = null;
  let shownHintDist = null;
  const hintWorld = new THREE.Vector3();
  const hintCam = new THREE.Vector3();
  const hintNdc = new THREE.Vector3();

  // 在 updateCamera 之后、render 之前调用
  function updateEndHint() {
    const W = stage.clientWidth;
    const H = stage.clientHeight;
    const ex = size - 0.5;
    const ez = size - 0.5;
    camera.updateMatrixWorld();
    const samples = [];
    let low = null; // 高度 0.4 的采样点在相机空间的坐标，供 edgeArrow
    let top = null; // 画面内最高采样点的 CSS 像素位置，供标记
    for (const h of BEAM_SAMPLE_HEIGHTS) {
      hintWorld.set(ex, h, ez);
      hintCam.copy(hintWorld).applyMatrix4(camera.matrixWorldInverse);
      if (low === null) low = { x: hintCam.x, y: hintCam.y, z: hintCam.z };
      let inView = false;
      if (-hintCam.z > camera.near) {
        hintNdc.copy(hintCam).applyMatrix4(camera.projectionMatrix);
        inView = Math.abs(hintNdc.x) <= 1 && Math.abs(hintNdc.y) <= 1;
        if (inView) top = { x: ((hintNdc.x + 1) / 2) * W, y: ((1 - hintNdc.y) / 2) * H };
      }
      samples.push({ inView, occluded: segmentBlocked(camera.position, hintWorld, hintBoxes) });
    }
    const mode = state === 'won' ? 'hidden' : endHintMode(samples);
    const arrow = edgeArrow(low, W, H, HINT_INSET);
    endHint.mode = mode;
    endHint.angle = arrow.angle;
    endHint.distance = Math.round(Math.hypot(ex - playerState.x, ez - playerState.z));
    if (mode === 'marker' && top) {
      endHint.x = Math.min(W - HINT_INSET, Math.max(HINT_INSET, top.x));
      endHint.y = Math.min(H - HINT_INSET, Math.max(HINT_INSET, top.y));
    } else {
      endHint.x = arrow.x;
      endHint.y = arrow.y;
    }

    if (mode !== shownHintMode) {
      endArrowEl.hidden = mode !== 'edge';
      endMarkerEl.hidden = mode !== 'marker';
      shownHintMode = mode;
    }
    if (endHint.distance !== shownHintDist) {
      for (const el of endDistEls) el.textContent = `${endHint.distance} 格`;
      shownHintDist = endHint.distance;
    }
    const at = `translate(${endHint.x}px, ${endHint.y}px) translate(-50%, -50%)`;
    if (mode === 'edge') {
      endArrowEl.style.transform = at;
      endArrowHead.style.transform = `rotate(${endHint.angle}rad)`;
    } else if (mode === 'marker') {
      endMarkerEl.style.transform = at;
    }
  }

  function kindAt(row, col) {
    const path = onPathSet();
    return floorKind({ row, col }, size, {
      inView: cellVisible(row, col),
      onPath: path ? path.has(row * size + col) : false,
      edge: fogOn && fogRing(display, { row, col }, fogRadius),
    });
  }

  function applyFloorColors() {
    const theme = THEMES[themeId];
    const byKind = {
      floor: theme.floorBase,
      fog: theme.fogFloor,
      fogEdge: mixHex(theme.floorBase, theme.fogFloor, 0.5),
    };
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const kind = kindAt(row, col);
        floor.setColorAt(row * size + col, tmpColor.setHex(byKind[kind] ?? COLORS[kind]));
      }
    }
    floor.instanceColor.needsUpdate = true;
  }

  // 每段墙的实例色：积木主题按调色板取色，其他主题是主题底色乘一点明暗变化
  function colorWalls() {
    const theme = THEMES[themeId];
    const palette = theme.blockPalette;
    for (let i = 0; i < segments.length; i++) {
      if (palette) tmpColor.setHex(palette[blockColorIndex(i, palette.length)]);
      else tmpColor.setHex(theme.wallTint).multiplyScalar(wallShade(i));
      walls.setColorAt(i, tmpColor);
    }
    if (walls.instanceColor) walls.instanceColor.needsUpdate = true;
  }

  // ---------- 相机 ----------
  // 跟随视角：观察点 = 小人前方 LOOK_AHEAD 格（偏移平滑），高度 TARGET_HEIGHT；
  // 先用 liftPitch 求实际俯角（观察点与相机之间有墙、收近后小人会占满画面时抬高俯角），
  // 理想位置由 yaw / 实际俯角 / 距离算出并平滑插值；再沿平滑后的方向做三维避障，
  // 实际距离 dCur 比安全距离远就立即收近，比它近就慢慢恢复（smoothCameraDistance）。
  // 前瞻只影响构图，不影响碰撞；第一人称不用前瞻
  const smoothCam = new THREE.Vector3();
  const camTarget = new THREE.Vector3();
  const lookOff = new THREE.Vector3(); // 平滑后的前瞻偏移，y 恒为 0
  const tmpWant = new THREE.Vector3();
  let dCur = 0;
  let camPitch = 0;

  function idealDistance() {
    const o = followOffset(fogOn ? fogRadius : 10);
    return Math.hypot(o.h, o.d) * cameraZoom;
  }

  function pitchRange() {
    return view === 'first' ? FIRST_PITCH : FOLLOW_PITCH;
  }

  function clampPitch(p) {
    const r = pitchRange();
    return Math.min(r.max, Math.max(r.min, p));
  }

  function placeFollow(k, snap) {
    // 平滑的是偏移向量而不是观察点本身：长度始终 ≤ LOOK_AHEAD，小人移动时观察点不拖尾
    const want = lookAheadTarget({ x: 0, z: 0 }, yaw, LOOK_AHEAD);
    tmpWant.set(want.x, 0, want.z);
    if (snap) lookOff.copy(tmpWant);
    else lookOff.lerp(tmpWant, k);
    camTarget.set(playerState.x + lookOff.x, TARGET_HEIGHT, playerState.z + lookOff.z);
    const dist = idealDistance();
    camPitch = liftPitch(camTarget, yaw, pitch, dist, boxes3d);
    const ideal = followCameraPos(camTarget, yaw, camPitch, dist);
    tmpPos.set(ideal.x, ideal.y, ideal.z);
    if (snap) smoothCam.copy(tmpPos);
    else smoothCam.lerp(tmpPos, k);
    tmpDir.subVectors(smoothCam, camTarget);
    const dWant = tmpDir.length();
    if (dWant > 1e-9) tmpDir.divideScalar(dWant);
    else tmpDir.set(0, 1, 0);
    const dSafe = cameraPullIn(camTarget, smoothCam, boxes3d);
    dCur = snap ? dSafe : smoothCameraDistance(dCur, dWant, dSafe, k);
    camera.position.copy(camTarget).addScaledVector(tmpDir, dCur);
    camera.lookAt(camTarget);
  }

  function placeFirstPerson() {
    camera.position.set(playerState.x, EYE_HEIGHT, playerState.z);
    camera.rotation.set(-pitch, -yaw, 0, 'YXZ');
  }

  function snapCamera() {
    if (view === 'first') placeFirstPerson();
    else placeFollow(1, true);
    syncGround();
  }

  // dt 单位秒
  function updateCamera(dt) {
    if (view === 'first') {
      placeFirstPerson();
      return;
    }
    placeFollow(1 - Math.pow(0.001, dt), false);
  }

  // 距离雾：第一人称按视野半径；跟随视角整个迷宫都在 near 以内，只让外围地面向地平线渐隐。
  // 每帧调用（只改两个数字），缩放、切视角、迷雾开关、尺寸变化都会立即生效
  let sceneFogEnabled = true; // setSceneFogForTest 用
  function updateSceneFog() {
    if (!sceneFogEnabled) {
      scene.fog = null;
      return;
    }
    let near;
    let far;
    if (view === 'first') {
      near = 0.5;
      far = fogOn ? fogRadius + 0.5 : size * 1.5;
    } else {
      // 相机平滑收近期间实际距离 dCur 会大于理想距离，取两者较大者，过渡中迷宫也不被染色
      ({ near, far } = followFogRange(Math.max(idealDistance(), dCur), size, LOOK_AHEAD));
    }
    if (scene.fog) {
      scene.fog.near = near;
      scene.fog.far = far;
    } else {
      scene.fog = new THREE.Fog(THEMES[themeId].fogColor, near, far);
    }
  }

  // 切换视角保留 yaw，pitch 改为该视角的默认值
  function setView(next) {
    view = next;
    const first = view === 'first';
    pitch = first ? FIRST_PITCH.def : FOLLOW_PITCH.def;
    $('view-btn').textContent = first ? '切换到跟随视角' : '切换到第一人称';
    $('minimap').hidden = !first;
    player.visible = !first;
    shadow.visible = !first;
    updateSceneFog();
    snapCamera();
    if (first) drawMinimap();
  }

  $('view-btn').addEventListener('click', () => {
    setView(view === 'first' ? 'follow' : 'first');
  });

  // ---------- 小地图 ----------
  // 底图（地块、墙）只在迷雾重算时画进离屏 canvas；第一人称每帧贴底图再画小人与朝向
  const minimap = $('minimap');
  const miniCtx = minimap.getContext('2d');
  const miniBase = document.createElement('canvas');
  let miniBaseDirty = true;

  function miniLayout() {
    const dpr = window.devicePixelRatio || 1;
    const css = minimap.clientWidth || 140;
    const px = Math.round(css * dpr);
    const pad = 6 * dpr;
    return { dpr, px, pad, cell: (px - pad * 2) / size };
  }

  function drawMinimapBase(lay) {
    const { dpr, px, pad, cell } = lay;
    miniBase.width = px;
    miniBase.height = px;
    const ctx = miniBase.getContext('2d');
    ctx.clearRect(0, 0, px, px);
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
    miniBaseDirty = false;
  }

  function drawMinimap() {
    if (minimap.hidden || !connections) return;
    const lay = miniLayout();
    const { dpr, px, pad, cell } = lay;
    if (minimap.width !== px || minimap.height !== px) {
      minimap.width = px;
      minimap.height = px;
    }
    if (miniBaseDirty || miniBase.width !== px) drawMinimapBase(lay);
    const ctx = miniCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, px, px);
    ctx.drawImage(miniBase, 0, 0);
    const cx = pad + playerState.x * cell;
    const cy = pad + playerState.z * cell;
    const r = Math.max(2.5 * dpr, cell * PLAYER_RADIUS);
    ctx.fillStyle = '#ff9800';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    const fx = Math.sin(yaw);
    const fy = -Math.cos(yaw);
    const tip = r * 2.2;
    ctx.fillStyle = '#d84315';
    ctx.beginPath();
    ctx.moveTo(cx + fx * tip, cy + fy * tip);
    ctx.lineTo(cx + fy * r * 0.9 + fx * r * 0.6, cy - fx * r * 0.9 + fy * r * 0.6);
    ctx.lineTo(cx - fy * r * 0.9 + fx * r * 0.6, cy + fx * r * 0.9 + fy * r * 0.6);
    ctx.closePath();
    ctx.fill();
  }

  // ---------- 输入 ----------
  const keys = new Set();
  const router = createPointerRouter();
  const stickEl = $('stick');
  const knobEl = $('stick-knob');
  let testInput = null; // setInputForTest 注入的输入（仅 ?debug=1）

  // 清空按键、指针角色、摇杆与捏合状态；失焦、切后台、重建迷宫时调用
  function resetInput() {
    keys.clear();
    router.reset();
    stickEl.hidden = true;
  }

  function onKey(e) {
    const known = applyKeyEvent(keys, e);
    if (known && e.type === 'keydown' && e.code.startsWith('Arrow') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
    }
  }
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  window.addEventListener('blur', resetInput);

  // 指针监听绑在 #stage 上：降画质会替换 canvas，绑在 canvas 上的监听会丢
  function sideOf(clientX) {
    const r = stage.getBoundingClientRect();
    return clientX - r.left < r.width / 2 ? 'left' : 'right';
  }

  stage.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const ok = router.down({
      id: e.pointerId,
      kind: e.pointerType || 'mouse',
      x: e.clientX,
      y: e.clientY,
      side: sideOf(e.clientX),
    });
    if (!ok) return;
    try {
      stage.setPointerCapture(e.pointerId);
    } catch {
      // 指针已失效时 setPointerCapture 会抛异常，忽略
    }
    e.preventDefault();
  });
  stage.addEventListener('pointermove', (e) => {
    router.move({ id: e.pointerId, x: e.clientX, y: e.clientY });
  });

  // 按该指针的角色清除状态；pointerup / pointercancel / lostpointercapture 都走这里，重复调用无副作用
  function releasePointer(id) {
    router.up(id);
  }
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    stage.addEventListener(type, (e) => releasePointer(e.pointerId));
  }

  stage.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      cameraZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, cameraZoom * Math.exp(e.deltaY * 0.001)));
    },
    { passive: false },
  );

  // 摇杆显示：底座中心在按下点，摇杆头偏移钳到底座半径
  function updateStick() {
    const st = router.stick;
    if (!st.active) {
      if (!stickEl.hidden) stickEl.hidden = true;
      return;
    }
    const r = stage.getBoundingClientRect();
    stickEl.hidden = false;
    stickEl.style.left = `${st.originX - r.left}px`;
    stickEl.style.top = `${st.originY - r.top}px`;
    const len = Math.hypot(st.dx, st.dy);
    const f = len > STICK_RADIUS ? STICK_RADIUS / len : 1;
    knobEl.style.transform = `translate(${st.dx * f}px, ${st.dy * f}px)`;
  }

  // ---------- 全屏 ----------
  const fsBtn = $('fullscreen-btn');
  if (document.fullscreenEnabled) fsBtn.hidden = false;
  fsBtn.addEventListener('click', () => {
    const p = document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen();
    if (p && p.catch) p.catch(() => {});
  });
  document.addEventListener('fullscreenchange', () => {
    fsBtn.textContent = document.fullscreenElement ? '退出全屏' : '全屏';
  });

  function currentInput() {
    if (testInput) {
      return { forward: testInput.forward || 0, strafe: testInput.strafe || 0, turn: testInput.turn || 0 };
    }
    const k = inputFromKeys(keys);
    const st = router.stick;
    const s = st.active ? inputFromStick(st.dx, st.dy, STICK_RADIUS) : { forward: 0, strafe: 0 };
    return { forward: k.forward + s.forward, strafe: k.strafe + s.strafe, turn: k.turn };
  }

  // ---------- 移动 ----------
  function newSeed() {
    return Date.now() + Math.floor(Math.random() * 1000);
  }

  function shortestDelta(from, to) {
    let delta = (to - from) % (Math.PI * 2);
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    return delta;
  }

  // 每帧：读输入 → 转视角 → stepPlayer → 所在格变化时重算迷雾 / 判胜 → 更新模型
  function updatePlayer(dt) {
    const look = router.consume();
    yaw += look.look.dx * LOOK_SPEED;
    pitch = clampPitch(pitch + look.look.dy * LOOK_SPEED);
    cameraZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, cameraZoom * look.zoom));
    if (!connections) return;
    if (state !== 'won') {
      const input = currentInput();
      yaw += input.turn * TURN_SPEED * dt;
      playerState = stepPlayer(playerState, input, yaw, dt, grid);
      const c = cellOf(playerState);
      c.row = Math.min(size - 1, Math.max(0, c.row));
      c.col = Math.min(size - 1, Math.max(0, c.col));
      if (c.row !== display.row || c.col !== display.col) {
        display.row = c.row;
        display.col = c.col;
        recomputeFog();
        if (c.row === size - 1 && c.col === size - 1) {
          state = 'won';
          playerState = { ...playerState, vx: 0, vz: 0 };
          $('win').hidden = false;
          startConfetti();
        }
      }
    }
    player.position.set(playerState.x, 0, playerState.z);
    const speed = Math.hypot(playerState.vx, playerState.vz);
    if (speed > 0.05) {
      walkPhase += speed * dt * 2 * Math.PI;
      bodyGroup.position.y = 0.03 * Math.abs(Math.sin(walkPhase));
      const target = -Math.atan2(playerState.vx, -playerState.vz);
      const k = 1 - Math.pow(0.001, dt);
      player.rotation.y += shortestDelta(player.rotation.y, target) * k;
    } else {
      walkPhase = 0;
      bodyGroup.position.y = 0;
    }
    updateShadow();
  }

  function updateShadow() {
    shadow.position.x = playerState.x;
    shadow.position.z = playerState.z;
    const look = shadowLook(bodyGroup.position.y * playerModelScale());
    shadow.scale.set(look.scale, look.scale, 1);
    shadow.material.opacity = look.opacity;
  }

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
    updateGroundExtent();
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
    // 新 renderer 会重新上传纹理；低画质下不再开各向异性过滤
    if (currentTextures) {
      for (const t of [currentTextures.wall, currentTextures.top, currentTextures.floor, currentTextures.ground]) {
        t.anisotropy = 1;
        t.needsUpdate = true;
      }
    }
    meter.reset();
  }

  // ---------- 主题 ----------
  const TEX_SIZE = 256;
  let liveTextures = 0;
  const textureStats = { builds: 0, lastMs: 0 };

  function textureAnisotropy() {
    return quality === 'high' ? Math.min(4, renderer.capabilities.getMaxAnisotropy()) : 1;
  }

  function makeCanvasTexture(paint) {
    const canvas = document.createElement('canvas');
    canvas.width = TEX_SIZE;
    canvas.height = TEX_SIZE;
    paint(canvas.getContext('2d'), TEX_SIZE);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = textureAnisotropy();
    liveTextures += 1;
    return tex;
  }

  function hexCss(c) {
    return '#' + c.toString(16).padStart(6, '0');
  }

  // 等距柱状天空：纵向对应世界仰角。上半部从天顶 sky.top 渐变到地平线 sky.bottom，
  // 下半部是纯雾色，与远处雾化的地面接上，不随相机俯仰在屏幕上移动
  function makeSkyTexture(theme) {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = TEX_SIZE;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, TEX_SIZE);
    grad.addColorStop(0, hexCss(theme.sky.top));
    grad.addColorStop(0.5, hexCss(theme.sky.bottom));
    grad.addColorStop(1, hexCss(theme.fogColor));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 8, TEX_SIZE);
    const tex = new THREE.CanvasTexture(canvas);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    liveTextures += 1;
    return tex;
  }

  function ensureTextures(id) {
    if (currentTextures && currentTextures.id === id) return;
    const t0 = performance.now();
    const next = {
      id,
      wall: makeCanvasTexture((ctx, n) => paintWall(id, ctx, n)),
      top: makeCanvasTexture((ctx, n) => paintWallTop(id, ctx, n)),
      floor: makeCanvasTexture((ctx, n) => paintFloor(id, ctx, n)),
      ground: makeCanvasTexture((ctx, n) => paintGround(id, ctx, n)),
      sky: makeSkyTexture(THEMES[id]),
    };
    textureStats.builds += 1;
    textureStats.lastMs = performance.now() - t0;
    if (currentTextures) {
      for (const key of ['wall', 'top', 'floor', 'ground', 'sky']) {
        currentTextures[key].dispose();
        liveTextures -= 1;
      }
    }
    currentTextures = next;
  }

  // 只换外观，不碰游戏状态（动画、位置、视角、迷雾、道路）
  function applyTheme(id) {
    id = parseTheme(id);
    themeId = id;
    ensureTextures(id);
    const theme = THEMES[id];
    const tex = currentTextures;
    const groundMaterial = groundMesh.material;
    const changed =
      wallMaterials[0].map !== tex.wall ||
      wallMaterials[1].map !== tex.top ||
      floorMaterial.map !== tex.floor ||
      groundMaterial.map !== tex.ground;
    wallMaterials[0].map = tex.wall;
    wallMaterials[1].map = tex.top;
    floorMaterial.map = tex.floor;
    groundMaterial.map = tex.ground;
    tex.ground.repeat.set(2 * groundE, 2 * groundE);
    if (changed) {
      for (const m of [wallMaterials[0], wallMaterials[1], floorMaterial, groundMaterial]) m.needsUpdate = true;
    }
    scene.background = tex.sky;
    renderer.setClearColor(theme.fogColor);
    if (scene.fog) scene.fog.color.setHex(theme.fogColor);
    hemi.color.setHex(theme.hemi.sky);
    hemi.groundColor.setHex(theme.hemi.ground);
    hemi.intensity = theme.hemi.intensity;
    sun.color.setHex(theme.sun.color);
    sun.intensity = theme.sun.intensity;
    if (walls) colorWalls();
    if (floor) applyFloorColors();
    document.querySelectorAll('.theme-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.theme === id);
    });
    storageSet('maze3d.theme', id);
  }

  document.querySelectorAll('.theme-btn').forEach((btn) => {
    btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
  });

  let lastTime = performance.now();
  let loopStart = lastTime;
  function frame(now) {
    rafId = null;
    // 主线程刚被长任务（如首帧前的预渲染）卡住时，紧接着的 rAF 时间戳可能早于 startLoop()，
    // 用它做基准会把那次卡顿算进帧时间；这类时间戳不计入统计
    if (now >= loopStart) meter.tick(now);
    if (quality === 'high' && shouldDowngrade(meter.window())) downgrade();
    if (slowMs > 0) {
      const t0 = performance.now();
      while (performance.now() - t0 < slowMs) {
        // 忙等，模拟慢设备
      }
    }
    const dt = Math.max(0, Math.min(now - lastTime, 100)) / 1000;
    lastTime = now;
    updatePlayer(dt);
    updateStick();
    star.rotation.y += dt;
    updateBeam(dt);
    updateCamera(dt);
    syncGround();
    updateSceneFog();
    updateEndHint();
    if (view === 'first') drawMinimap();
    renderer.render(scene, camera);
    drawConfetti(dt);
    rafId = requestAnimationFrame(frame);
  }

  function startLoop() {
    if (rafId !== null) return;
    meter.reset();
    lastTime = performance.now();
    loopStart = lastTime;
    rafId = requestAnimationFrame(frame);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      resetInput();
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

  applyTheme(themeId);
  buildMaze(seed, size);
  // 首帧前先渲染一次：着色器编译、纹理上传、天空转立方体贴图都在这里完成，
  // 不计入帧时间统计，避免启动时的一次性开销误触发降画质
  syncGround();
  updateSceneFog();
  renderer.render(scene, camera);

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

  function instanceHidden(mesh, i) {
    mesh.getMatrixAt(i, tmpMatrix);
    // 不用 decompose：r187 对行列式为 0 的矩阵直接返回缩放 1
    const e = tmpMatrix.elements;
    const scale = Math.hypot(e[0], e[1], e[2]) * Math.hypot(e[4], e[5], e[6]);
    return scale * Math.hypot(e[8], e[9], e[10]) === 0;
  }

  function isPlayerPart(obj) {
    for (let o = obj; o; o = o.parent) if (o === player) return true;
    return false;
  }

  const raycaster = new THREE.Raycaster();

  // 地板格顶面上 5 个取样点（格心与四个内缩点）中，相机看得到、没被墙 / 星星 / 小人 / 光柱挡住的点；
  // 返回相对 renderer canvas 左上角的 CSS 像素坐标
  function floorSamplePoints(row, col) {
    camera.updateMatrixWorld();
    walls.boundingSphere = null;
    const canvas = renderer.domElement;
    const out = [];
    const offsets = [
      [0, 0],
      [-0.3, -0.3],
      [0.3, -0.3],
      [-0.3, 0.3],
      [0.3, 0.3],
    ];
    for (const [dx, dz] of offsets) {
      const point = new THREE.Vector3(col + 0.5 + dx, 0.001, row + 0.5 + dz);
      const ndc = point.clone().project(camera);
      if (Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1 || ndc.z > 1) continue;
      const dist = camera.position.distanceTo(point);
      const dir = point.clone().sub(camera.position).normalize();
      raycaster.set(camera.position, dir);
      raycaster.far = dist;
      // 光柱是加法混合，会改变它后面地板的颜色：被光柱覆盖的点也不取样
      const hits = raycaster.intersectObjects([walls, star, player, beam], true);
      const blocked = hits.some((h) => {
        if (h.distance >= dist - 0.01) return false;
        if (h.object === beam && !beam.visible) return false;
        if (!player.visible && isPlayerPart(h.object)) return false;
        if (h.object === walls && h.instanceId !== undefined && instanceHidden(walls, h.instanceId)) return false;
        return true;
      });
      if (blocked) continue;
      out.push({ x: ((ndc.x + 1) / 2) * canvas.clientWidth, y: ((1 - ndc.y) / 2) * canvas.clientHeight });
    }
    return out;
  }

  // 画面上一点（相对 canvas 左上角的 CSS 像素）是否落在迷宫物体上：未隐藏的墙、地板、星星、可见的小人
  function screenHitsScene(x, y) {
    camera.updateMatrixWorld();
    walls.boundingSphere = null;
    const canvas = renderer.domElement;
    const ndc = new THREE.Vector2((x / canvas.clientWidth) * 2 - 1, 1 - (y / canvas.clientHeight) * 2);
    raycaster.setFromCamera(ndc, camera);
    raycaster.far = Infinity;
    const hits = raycaster.intersectObjects([walls, floor, star, player], true);
    return hits.some((h) => {
      if (!player.visible && isPlayerPart(h.object)) return false;
      if (h.object === walls && h.instanceId !== undefined && instanceHidden(walls, h.instanceId)) return false;
      return true;
    });
  }

  // 画面中心 50% 区域 16×16 网格取样：不同颜色数、亮度总体标准差、5%–95% 分位差
  function wallContrast() {
    renderer.render(scene, camera);
    const gl = renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const px = new Uint8Array(4);
    const seen = new Set();
    const lumas = [];
    for (let i = 0; i < 16; i++) {
      for (let j = 0; j < 16; j++) {
        const x = Math.floor(w * (0.25 + (0.5 * (i + 0.5)) / 16));
        const y = Math.floor(h * (0.25 + (0.5 * (j + 0.5)) / 16));
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        seen.add((px[0] << 16) | (px[1] << 8) | px[2]);
        lumas.push(0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2]);
      }
    }
    const mean = lumas.reduce((a, b) => a + b, 0) / lumas.length;
    const std = Math.sqrt(lumas.reduce((a, b) => a + (b - mean) ** 2, 0) / lumas.length);
    lumas.sort((a, b) => a - b);
    const spread = lumas[Math.floor(0.95 * 255)] - lumas[Math.floor(0.05 * 255)];
    return { colors: seen.size, std, spread };
  }

  const debugApi = {
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
      return { row: display.row, col: display.col };
    },
    get display() {
      return { row: display.row, col: display.col };
    },
    get playerCell() {
      return { row: display.row, col: display.col };
    },
    get playerPos() {
      return { x: playerState.x, z: playerState.z };
    },
    get yaw() {
      return yaw;
    },
    get startYaw() {
      return startYaw(size);
    },
    get pitch() {
      return pitch;
    },
    get cameraZoom() {
      return cameraZoom;
    },
    // 跟随视角实际使用的相机距离；第一人称为 0
    get cameraDistance() {
      return view === 'first' ? 0 : dCur;
    },
    // 跟随视角实际使用的俯角（可能被 liftPitch 抬高）；第一人称等于 pitch
    get cameraPitch() {
      return view === 'first' ? pitch : camPitch;
    },
    get cameraIdealDistance() {
      return idealDistance();
    },
    get cameraPos() {
      return { x: camera.position.x, y: camera.position.y, z: camera.position.z };
    },
    // 跟随视角返回实际观察点（小人前方的前瞻点）；第一人称返回小人位置
    get cameraTarget() {
      if (view === 'first') return { x: playerState.x, y: TARGET_HEIGHT, z: playerState.z };
      return { x: camTarget.x, y: camTarget.y, z: camTarget.z };
    },
    get lookAhead() {
      return LOOK_AHEAD;
    },
    get wallBoxes3d() {
      return boxes3d.map((b) => ({ ...b }));
    },
    get playerVisible() {
      return player.visible;
    },
    get shadow() {
      return {
        x: shadow.position.x,
        z: shadow.position.z,
        visible: shadow.visible,
        scale: shadow.scale.x,
        opacity: shadow.material.opacity,
      };
    },
    get segments() {
      return segments;
    },
    // 光柱对象的 visible 开关（不代表屏幕上看得见）
    get beamEnabled() {
      return beam.visible;
    },
    get confettiActive() {
      return confettiActive;
    },
    // 终点方向提示的最近一次结果；x、y 为相对 #stage 左上角的 CSS 像素
    get endHint() {
      return { ...endHint };
    },
    get footStripCount() {
      return footStrips.length;
    },
    footStripsVisible() {
      return footStrips.map((st, i) => ({ seg: st.seg, visible: !instanceHidden(feet, i) }));
    },
    wallsVisible() {
      const out = [];
      for (let i = 0; i < segments.length; i++) out.push(!instanceHidden(walls, i));
      return out;
    },
    floorKindAt(row, col) {
      return kindAt(row, col);
    },
    floorSamplePoints,
    wallContrast,
    get sceneFog() {
      if (!scene.fog) return null;
      return { near: scene.fog.near, far: scene.fog.far, color: '#' + scene.fog.color.getHexString() };
    },
    screenHitsScene,
    floorColorHex(row, col) {
      floor.getColorAt(row * size + col, tmpColor);
      return '#' + tmpColor.getHexString();
    },
    wallColorHex(i) {
      walls.getColorAt(i, tmpColor);
      return '#' + tmpColor.getHexString();
    },
    get theme() {
      return themeId;
    },
    get textureCount() {
      return liveTextures;
    },
    get textureStats() {
      return { builds: textureStats.builds, lastMs: textureStats.lastMs };
    },
    // 当前墙面、墙顶、地板、外围地面纹理的各向异性过滤级别
    get textureAnisotropy() {
      if (!currentTextures) return [];
      const t = currentTextures;
      return [t.wall, t.top, t.floor, t.ground].map((x) => x.anisotropy);
    },
    get ground() {
      const map = groundMesh.material.map;
      return {
        cx: groundMesh.position.x,
        cz: groundMesh.position.z,
        y: groundMesh.position.y,
        halfExtent: groundE,
        repeat: map ? [map.repeat.x, map.repeat.y] : null,
        mapUuid: map ? map.uuid : null,
      };
    },
    get cameraState() {
      camera.updateMatrixWorld();
      camera.getWorldDirection(tmpDir);
      return {
        pos: [camera.position.x, camera.position.y, camera.position.z],
        forward: [tmpDir.x, tmpDir.y, tmpDir.z],
        fov: camera.fov,
        aspect: camera.aspect,
        near: camera.near,
        far: camera.far,
        view: Array.from(camera.matrixWorldInverse.elements),
      };
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

  // 测试钩子：非 null 时用它的 forward / strafe / turn 替代键盘与摇杆；yaw、pitch 为数字时直接赋值
  if (debug) {
    debugApi.setInputForTest = (v) => {
      if (v === null || v === undefined) {
        testInput = null;
        return;
      }
      testInput = { forward: v.forward || 0, strafe: v.strafe || 0, turn: v.turn || 0 };
      if (typeof v.yaw === 'number') yaw = v.yaw;
      if (typeof v.pitch === 'number') pitch = clampPitch(v.pitch);
    };
    // 把小人放到指定格中心，速度清零，迷雾按新格重算，相机立即就位
    debugApi.teleportForTest = (row, col) => {
      playerState = { x: col + 0.5, z: row + 0.5, vx: 0, vz: 0 };
      display.row = row;
      display.col = col;
      player.position.set(playerState.x, 0, playerState.z);
      recomputeFog();
      snapCamera();
    };
    debugApi.setSceneFogForTest = (enabled) => {
      sceneFogEnabled = Boolean(enabled);
      updateSceneFog();
    };
    // visible 只切光柱圆柱（不切粒子）；paused 为真时光柱脉动与粒子位置停止推进
    debugApi.setBeamForTest = (v = {}) => {
      if (typeof v.visible === 'boolean') beam.visible = v.visible;
      if (typeof v.paused === 'boolean') beamPaused = v.paused;
    };
    debugApi.setZoomForTest = (z) => {
      cameraZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
    };
  }

  // ---------- 开局预热帧 ----------
  // 预渲染之后还有两笔一次性开销（软件渲染下明显，同一浏览器进程只发生一次），
  // 只 render 不上屏、或者读回像素都提前不了，只能靠真正上屏的帧付掉：
  // 1. 开头几帧上屏的画面里 GPU 端还要再卡几次（第 4、7、8 帧各 70–400ms）；
  // 2. 终点方向提示（箭头带 drop-shadow、标记、「N 格」文字）第一次显示和第一次隐藏时，
  //    浏览器光栅化它们要卡一帧（约 140ms 和 70ms）。
  // 所以先按 requestAnimationFrame 原样渲染 WARM_FRAMES 帧（不处理输入、不计帧时间）：
  // 前 WARM_HINT_FRAMES 帧把箭头和标记以不透明度 0.01 显示（完全透明会被跳过），然后隐藏，
  // 剩下的帧让隐藏的开销也落在预热里。之后启动计时的渲染循环，并挂出调试对象 window.__maze3d（就绪标志）
  function setWarmHint(on) {
    for (const el of [endArrowEl, endMarkerEl]) {
      el.hidden = !on;
      el.style.opacity = on ? '0.01' : '';
      el.style.transform = on ? `translate(${HINT_INSET}px, ${HINT_INSET}px) translate(-50%, -50%)` : '';
    }
    for (const el of endDistEls) el.textContent = on ? '0123456789 格' : '';
    shownHintMode = null;
    shownHintDist = null;
  }

  let warmDone = 0;
  function warmFrame() {
    renderer.render(scene, camera);
    warmDone += 1;
    if (warmDone === WARM_HINT_FRAMES) setWarmHint(false);
    if (warmDone < WARM_FRAMES) {
      requestAnimationFrame(warmFrame);
      return;
    }
    startLoop();
    window.__maze3d = debugApi;
  }
  setWarmHint(true);
  requestAnimationFrame(warmFrame);
}
