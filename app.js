import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createHeightField, groundMeta, mapPoint, navcamVerticalFov,worldFromCoordinates} from './terrain.js';
import {planRoute, terrainSlope} from './route.js';
import {DRIVE, advanceDrive, createFollower, routeCommand, allowedPosition, stoppingArcAllowed} from './drive.js';
import {createMissionUI} from './mission.js';
import {createTutorial} from './tutorial.js';
import {createConditionsUI} from './conditions.js';
import {createRegionalWeather} from './regional-weather.js';
import {compareDirect} from './route-comparison.js';

const $ = id => document.getElementById(id);
const clamp = THREE.MathUtils.clamp, rad = THREE.MathUtils.degToRad, deg = THREE.MathUtils.radToDeg;
const state = {ready: false, x: -12, z: 22, heading: 0, speed: 0, steer: 0,
  distance: 0, pitch: 0, roll: 0, mode: 'chase', fast: false, frames: 0, simulationTime: 0};
const keys = new Set(), touch = new Set();
let meta, field, renderer, scene, camera, rover, roverMeta, terrain, sun, sunTarget, sky;
let wheels = [], trail = [], lastTrail, toastTimer, frameId;
let orbitYaw = -.35, orbitPitch = .27, orbitDistance = 6.7, mastYaw = 0, mastPitch = -.22;
let sensorExposure = 1.05, surfaceDetail = true;
let catalog, activeSite, activeManifest, switchingSite = false;
let plannedRoute, routeVisual, directVisual, routePlanning = false, followingRoute = false, routeDistance = 0, routeGeneration = 0;
let follower = createFollower(), navigationBraking = false, routePending = false;
let cameraSnap = true, elapsed = 0, accumulator = 0, lastFrame = performance.now(), uiElapsed = 0;
let mapLayer = 'optical', mapZoom = 2, mapCenter = {x: 0, z: 0}, mapMarker = {x: 0, y: 0};
const images = {}, mapCanvas = $('map'), ctx = mapCanvas.getContext('2d');
const desiredCamera = new THREE.Vector3(), desiredTarget = new THREE.Vector3(), cameraTarget = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);
let mission, tutorial, conditions, regional, weatherPack, weatherPackHash, sciencePack, sciencePackHash, scienceVisual, scienceMarkerKey='';

function toast(message) {
  clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false;
  toastTimer = setTimeout(() => {$('toast').hidden = true;}, 4200);
}
function clearInput() {keys.clear(); touch.clear(); document.querySelectorAll('#touch-drive .active').forEach(e => e.classList.remove('active'));}
function modalOpen() {return !!document.querySelector('dialog[open]');}
function setProgress(value, message) {$('load-progress').value = value; $('loading-text').textContent = message;}
async function json(url) {const r = await fetch(url); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json();}
async function imageFile(url) {const i = new Image(); i.src = url; await i.decode(); return i;}

function groundTextures() {
  // Orbital brightness includes the source Sun/shadows; it is not elevation or
  // a calibrated albedo. Compress that baked contrast before relighting it.
  const canvas = document.createElement('canvas'); canvas.width = images.optical.width; canvas.height = images.optical.height;
  const context = canvas.getContext('2d', {willReadFrequently: true}); context.drawImage(images.optical, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const value = 120 + pixels.data[i] * .43;
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value;
  }
  context.putImageData(pixels, 0, 0);
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  // Seeded micro-normal shading makes a matte granular material. It adds no
  // height, collision or measured rock detail; original data remains untouched.
  const size = 256, noise = new Float32Array(size * size), normals = new Uint8Array(size * size * 4);
  let seed = 492071;
  for (let i = 0; i < noise.length; i++) {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; noise[i] = seed / 4294967296;}
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const value = (xx, yy) => noise[((yy + size) % size) * size + (xx + size) % size];
    const nx = (value(x - 1, y) - value(x + 1, y)) * .7, ny = (value(x, y - 1) - value(x, y + 1)) * .7;
    const length = Math.hypot(nx, ny, 1), offset = (y * size + x) * 4;
    normals.set([(nx / length * .5 + .5) * 255, (ny / length * .5 + .5) * 255, (.5 / length + .5) * 255, 255], offset);
  }
  const normalMap = new THREE.DataTexture(normals, size, size);
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping; normalMap.repeat.set(meta.width_m / 4, meta.depth_m / 4);
  normalMap.magFilter = THREE.LinearFilter; normalMap.minFilter = THREE.LinearMipmapLinearFilter;
  normalMap.generateMipmaps = true; normalMap.anisotropy = map.anisotropy; normalMap.needsUpdate = true;
  return {map, normalMap};
}

function buildSurface(heights) {
  const {cols, rows, width_m: width, depth_m: depth, height_base_m: base} = meta;
  const positions = new Float32Array(cols * rows * 3), uv = new Float32Array(cols * rows * 2);
  const indices = new Uint32Array((cols - 1) * (rows - 1) * 6);
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const i = row * cols + col;
    positions.set([(col / (cols - 1) - .5) * width, heights[i] - base,
      (row / (rows - 1) - .5) * depth], i * 3);
    uv.set([col / (cols - 1), 1 - row / (rows - 1)], i * 2);
  }
  let j = 0;
  for (let row = 0; row < rows - 1; row++) for (let col = 0; col < cols - 1; col++) {
    const a = row * cols + col, b = a + cols, c = a + 1, d = b + 1;
    indices.set([a, b, c, b, d, c], j); j += 6;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  const {map, normalMap} = groundTextures();
  terrain = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({map, normalMap,
    normalScale: new THREE.Vector2(surfaceDetail ? .42 : 0, surfaceDetail ? .42 : 0), color: 0xc2aa8f, roughness: .98, metalness: 0}));
  terrain.castShadow = true; terrain.receiveShadow = true; scene.add(terrain);
}

function initScene() {
  renderer = new THREE.WebGLRenderer({antialias: true, powerPreference: 'high-performance'});
  renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = sensorExposure;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('aria-label', 'Mars surface. W S to drive, A D to steer, space to brake.');
  $('viewport').append(renderer.domElement);
  scene = new THREE.Scene(); scene.background = new THREE.Color(0xb5967e);
  scene.fog = new THREE.Fog(0xb5967e, 130, 370);
  scene.add(new THREE.HemisphereLight(0xe9d5bb, 0x514034, .85));
  sun = new THREE.DirectionalLight(0xffedda, 2.7); sun.position.set(-24, 14, -18);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {left: -13, right: 13, top: 13, bottom: -13, near: .5, far: 90});
  sun.shadow.bias = -.00025; sun.shadow.normalBias = .018;
  sunTarget = new THREE.Object3D(); sun.target = sunTarget; scene.add(sunTarget, sun);
  sky = new THREE.Mesh(new THREE.SphereGeometry(450, 24, 12), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, uniforms: {},
    vertexShader: 'varying vec3 direction; void main(){direction=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: `varying vec3 direction;
      void main(){float elevation=max(0.0,normalize(direction).y);
      vec3 horizon=vec3(.48,.32,.22), zenith=vec3(.21,.145,.105);
      gl_FragColor=vec4(mix(horizon,zenith,pow(elevation,.48)),1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`}));
  sky.renderOrder = -1; scene.add(sky);
  camera = new THREE.PerspectiveCamera(57, 1, .08, 600);
}

function resize() {
  if (!renderer) return;
  const {width: w, height: h} = $('viewport').getBoundingClientRect();
  let rw, rh, cw, ch;
  if (state.mode === 'navcam') {
    [rw, rh] = $('sensor-resolution').value === 'native' ? [5120, 3840] : [1280, 960];
    ch = Math.min(h, w * 3 / 4); cw = ch * 4 / 3;
    camera.aspect = 4 / 3; camera.fov = navcamVerticalFov;
  } else {
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    rw = Math.round(w * dpr); rh = Math.round(h * dpr); cw = w; ch = h;
    camera.aspect = w / h; camera.fov = 57;
  }
  renderer.setSize(rw, rh, false);
  renderer.domElement.style.width = `${cw}px`; renderer.domElement.style.height = `${ch}px`;
  camera.updateProjectionMatrix(); $('sensor-pixels').textContent = `${rw} × ${rh}`;
}

function setMode(mode) {
  if (!state.ready) return;
  state.mode = mode; document.body.dataset.camera = mode;
  $('chase-mode').setAttribute('aria-pressed', mode === 'chase');
  $('navcam-mode').setAttribute('aria-pressed', mode === 'navcam');
  for (const id of ['sensor-panel', 'reticle', 'sensor-stamp']) $(id).hidden = mode !== 'navcam';
  $('camera-hint').textContent = mode === 'chase' ? 'Drag to orbit · Scroll to zoom · C to switch camera'
    : 'Drag to aim the mast · W / S to drive · C to return to chase';
  // Keep the virtual sensor clear of the concept model's uncalibrated camera housing.
  rover.visible = mode === 'chase'; cameraSnap = true; resize();
  renderer.toneMappingExposure = mode === 'navcam' ? sensorExposure : 1.05;
}

function updatePose() {
  const c = Math.cos(state.heading), s = Math.sin(state.heading), h = {};
  for (const [name, spec] of Object.entries(roverMeta.wheels)) {
    const [lx, , lz] = spec.center;
    h[name] = field.height(state.x + c * lx - s * lz, state.z + s * lx + c * lz);
  }
  state.pitch = Math.atan2((h.FL + h.FR - h.BL - h.BR) / 2, 1.736);
  state.roll = Math.atan2((h.FR + h.BR - h.FL - h.BL) / 2, 1.647);
  rover.position.set(state.x, (h.FL + h.FR + h.BL + h.BR) / 4, state.z);
  rover.rotation.set(state.pitch, -state.heading, state.roll, 'YXZ');
  rover.updateMatrixWorld(true);
  for (const wheel of wheels) {
    // A small visual suspension correction keeps each wheel at the same rendered surface.
    const world = wheel.pivot.getWorldPosition(new THREE.Vector3());
    const local = rover.worldToLocal(new THREE.Vector3(world.x, field.height(world.x, world.z) + wheel.radius, world.z));
    wheel.pivot.position.y = clamp(local.y, wheel.centerY - .2, wheel.centerY + .2);
  }
  sun.position.set(state.x - 24, rover.position.y + 14, state.z - 18);
  sunTarget.position.copy(rover.position);
}

function reset() {
  clearRoute();
  mission?.routeChanged(null);
  mission?.resetMotionSample();
  clearInput(); Object.assign(state, {x: -12, z: 22, heading: 0, speed: 0, steer: 0, distance: 0, simulationTime: 0});
  trail = [{x: state.x, z: state.z}]; lastTrail = {...trail[0]};
  for (const w of wheels) {w.spin.rotation.x = 0; w.pivot.rotation.y = 0;}
  orbitYaw = -.35; orbitPitch = .27; orbitDistance = 6.7; mastYaw = 0; mastPitch = -.22;
  if ($('sensor-aim')) $('sensor-aim').value = 'traverse';
  mapCenter = {x: 0, z: 0}; updatePose(); cameraSnap = true; updateUI();
}

function input(name) {
  const binding = {forward: ['KeyW', 'ArrowUp'], reverse: ['KeyS', 'ArrowDown'],
    left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'], brake: ['Space']}[name];
  return touch.has(name) || binding.some(k => keys.has(k));
}
function step(dt) {
  if (modalOpen() || switchingSite || routePending) return;
  state.simulationTime += dt;
  if (followingRoute) {
    if (['forward', 'reverse', 'left', 'right', 'brake'].some(input)) {
      stopFollowing('Manual control. Click the map to choose another destination.'); navigationBraking = false;
    }
    else {previewRoute(dt); return;}
  }
  const throttle = Number(input('forward')) - Number(input('reverse'));
  if (throttle || input('left') || input('right')) navigationBraking = false;
  const brake = input('brake') || navigationBraking;
  const next = {...state};
  let travel = advanceDrive(next, {speed: brake ? 0 : throttle * (state.fast ? 4 : 1.5),
    steer: navigationBraking ? state.steer : (Number(input('right')) - Number(input('left'))) * DRIVE.maxSteer,
    brake, coast: !throttle && !brake}, dt);
  if (!allowedPosition(meta, field, next, navigationBraking ? plannedRoute?.limit : undefined)) {
    state.speed = 0;
    if (throttle && elapsed > 4) {toast('Edge of this measured crop. Turn back to continue.'); elapsed = 0;}
    travel = 0;
  } else Object.assign(state, next);
  if (state.speed === 0) navigationBraking = false;
  finishMotion(travel,dt);
}

function finishMotion(travel,dt) {
  for (const w of wheels) {w.spin.rotation.x -= travel / w.radius; w.pivot.rotation.y = w.front ? -state.steer : 0;}
  if (Math.hypot(state.x - lastTrail.x, state.z - lastTrail.z) > .35) {
    trail.push({x: state.x, z: state.z}); lastTrail = trail.at(-1);
    if (trail.length > 4096) trail.shift();
  }
  updatePose();
  mission?.trackMotion(travel,dt);
}

function updateCamera(dt) {
  if (state.mode === 'navcam') {
    desiredCamera.set(...roverMeta.camera_mount_m); rover.localToWorld(desiredCamera);
    const direction = new THREE.Vector3(Math.sin(mastYaw) * Math.cos(mastPitch), Math.sin(mastPitch), -Math.cos(mastYaw) * Math.cos(mastPitch));
    desiredTarget.copy(desiredCamera).add(direction.applyQuaternion(rover.quaternion));
  } else {
    const yaw = state.heading + orbitYaw;
    desiredTarget.set(state.x, rover.position.y + .78, state.z);
    desiredCamera.set(state.x - Math.sin(yaw) * Math.cos(orbitPitch) * orbitDistance,
      desiredTarget.y + Math.sin(orbitPitch) * orbitDistance,
      state.z + Math.cos(yaw) * Math.cos(orbitPitch) * orbitDistance);
    desiredCamera.y = Math.max(desiredCamera.y, field.height(desiredCamera.x, desiredCamera.z) + .45);
  }
  const blend = cameraSnap ? 1 : 1 - Math.exp(-9 * dt);
  camera.position.lerp(desiredCamera, blend); cameraTarget.lerp(desiredTarget, blend);
  camera.up.copy(up); if (state.mode === 'navcam') camera.up.applyQuaternion(rover.quaternion);
  camera.lookAt(cameraTarget); cameraSnap = false;
  sky.position.copy(camera.position);
}

function drawMap() {
  const size = mapCanvas.width, extent = meta.depth_m / mapZoom;
  // Pan only near an edge so the marker visibly travels through the north-up map.
  if (Math.abs(state.x - mapCenter.x) > extent * .37 || Math.abs(state.z - mapCenter.z) > extent * .37) {
    const limitX = Math.max(0,(meta.width_m - extent) / 2),limitZ=(meta.depth_m-extent)/2;
    mapCenter = {x: clamp(state.x, -limitX, limitX), z: clamp(state.z, -limitZ, limitZ)};
  }
  const img = images[mapLayer], fx = img.width / meta.width_m, fz=img.height/meta.depth_m;
  const sx = (mapCenter.x - extent / 2 + meta.width_m / 2) * fx;
  const sy = (mapCenter.z - extent / 2 + meta.depth_m / 2) * fz;
  ctx.fillStyle='#15221b';ctx.fillRect(0,0,size,size);
  ctx.drawImage(img, sx, sy, extent * fx, extent * fz, 0, 0, size, size);
  ctx.fillStyle = '#16251b24'; ctx.fillRect(0, 0, size, size);
  regional?.paintMini(ctx,{meta,center:mapCenter,extent,size});
  // Deliberate absence of a weather raster: only one dated station is loaded.
  // Hatching means unmeasured space, not dust/cloud classes or a coverage radius.
  if(conditions?.marker().overlay){
    ctx.save();ctx.strokeStyle='#c7d1c33b';ctx.lineWidth=1;
    for(let x=-size;x<size;x+=32){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x+size,size);ctx.stroke();}ctx.restore();
  }
  ctx.strokeStyle = '#fff3'; ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {ctx.beginPath(); ctx.moveTo(i * size / 4, 0); ctx.lineTo(i * size / 4, size); ctx.moveTo(0, i * size / 4); ctx.lineTo(size, i * size / 4); ctx.stroke();}
  ctx.beginPath(); trail.forEach((p, i) => {const q = mapPoint(p.x, p.z, mapCenter, extent, size); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);});
  ctx.strokeStyle = '#bff8dc'; ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.stroke();
  const direct=plannedRoute?.comparison?.direct;
  if(direct?.status==='rejected'){
    ctx.save();ctx.setLineDash([12,9]);ctx.strokeStyle='#ff7f7f';ctx.lineWidth=3;ctx.beginPath();
    direct.samples.forEach((s,i)=>{const p=mapPoint(s.x,s.z,mapCenter,extent,size);i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y);});ctx.stroke();ctx.restore();
  }
  if (plannedRoute?.status === 'ready') {
    for (let i = 1; i < plannedRoute.samples.length; i++) {
      const a = plannedRoute.samples[i - 1], b = plannedRoute.samples[i];
      const p = mapPoint(a.x, a.z, mapCenter, extent, size), q = mapPoint(b.x, b.z, mapCenter, extent, size);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y);
      ctx.strokeStyle = '#8fe0a4'; ctx.lineWidth = 4; ctx.stroke();
    }
    const p = mapPoint(plannedRoute.goal.x, plannedRoute.goal.z, mapCenter, extent, size);
    ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, Math.PI * 2); ctx.fillStyle = '#74dcff'; ctx.fill();
    ctx.strokeStyle = '#13251d'; ctx.lineWidth = 3; ctx.stroke();
  }
  const markers=mission?.markers()||[];
  for(const marker of markers){
    const p=mapPoint(marker.x,marker.z,mapCenter,extent,size);
    ctx.beginPath();ctx.arc(p.x,p.y,12,0,Math.PI*2);ctx.fillStyle=marker.selected?'#f5bf80':'#d7e6de';ctx.fill();
    ctx.strokeStyle='#17261e';ctx.lineWidth=2;ctx.stroke();ctx.fillStyle='#17261e';ctx.font='bold 15px Consolas,monospace';
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(marker.label,p.x,p.y);ctx.textAlign='start';ctx.textBaseline='alphabetic';
  }
  updateScienceMarkers(markers);
  if(conditions){
    const station=conditions.marker(),p=mapPoint(station.x,station.z,mapCenter,extent,size);
    if(Math.abs(station.x)<=meta.width_m/2&&Math.abs(station.z)<=meta.depth_m/2){
      if(station.overlay){ctx.beginPath();ctx.arc(p.x,p.y,15,0,Math.PI*2);ctx.fillStyle=station.status==='gap'?'#79827d':'#e8ac64';ctx.fill();ctx.strokeStyle='#17251d';ctx.lineWidth=3;ctx.stroke();}
      ctx.strokeStyle='#f8be7e';ctx.lineWidth=3;ctx.strokeRect(p.x-8,p.y-8,16,16);
      ctx.fillStyle='#f8be7e';ctx.font='bold 14px Consolas';ctx.fillText('W',p.x+12,p.y-12);
    }
  }
  mapMarker = mapPoint(state.x, state.z, mapCenter, extent, size);
  ctx.save(); ctx.translate(mapMarker.x, mapMarker.y); ctx.rotate(state.heading + (state.mode === 'navcam' ? mastYaw : 0));
  ctx.fillStyle = '#c6f7db34'; ctx.strokeStyle = '#d9ffe58c'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, state.mode === 'navcam' ? 75 : 48, -Math.PI / 2 - rad(48), -Math.PI / 2 + rad(48)); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
  ctx.save(); ctx.translate(mapMarker.x, mapMarker.y); ctx.rotate(state.heading);
  ctx.shadowColor = '#101e17'; ctx.shadowBlur = 7; ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(9, 11); ctx.lineTo(0, 7); ctx.lineTo(-9, 11); ctx.closePath();
  ctx.fillStyle = '#e8b17c'; ctx.strokeStyle = '#20392c'; ctx.lineWidth = 2.5; ctx.fill(); ctx.stroke(); ctx.restore();
  const scale = extent > 150 ? 50 : 20;
  $('map-scale-text').textContent = `${scale} m`;
  document.querySelector('.map-scale i').style.width = `${scale / extent * mapCanvas.getBoundingClientRect().width}px`;
}

function updateUI() {
  $('speed').textContent = Math.abs(state.speed).toFixed(2);
  $('distance').textContent = `${state.distance.toFixed(1)} m`;
  $('attitude').textContent = `${deg(state.pitch).toFixed(1)}° / ${deg(state.roll).toFixed(1)}°`;
  $('elevation').textContent = `${field.absoluteHeight(state.x, state.z).toFixed(1)} m`;
  const heading = (deg(state.heading) % 360 + 360) % 360;
  const cardinal = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(heading / 45) % 8];
  $('heading-text').textContent = `${String(Math.round(heading) % 360).padStart(3, '0')}° ${cardinal}`;
  const coord = field.coordinates(state.x, state.z);
  $('latitude').textContent = `${Math.abs(coord.latitude).toFixed(5)}° ${coord.latitude < 0 ? 'S' : 'N'}`; $('longitude').textContent = `${coord.longitude.toFixed(5)}° E`;
  $('drive-status').textContent = modalOpen() ? 'Paused in menu' : followingRoute ? 'Navigating to map destination' : input('brake') ? 'Braking' : Math.abs(state.speed) < .01 ? 'Ready to explore' : state.speed < 0 ? 'Reversing' : 'Traversing measured terrain';
  drawMap();
  mission?.update();
  conditions?.update();
  regional?.update();
  tutorial?.update();
}

function updateScienceMarkers(markers) {
  const key=activeSite+JSON.stringify(markers);if(key===scienceMarkerKey)return;scienceMarkerKey=key;
  if(scienceVisual){scene.remove(scienceVisual);scienceVisual.traverse(o=>{o.geometry?.dispose();o.material?.map?.dispose();o.material?.dispose();});}
  scienceVisual=new THREE.Group();scene.add(scienceVisual);
  for(const m of markers){
    const color=m.selected?'#f5bf80':'#d7e6de';
    const ring=new THREE.Mesh(new THREE.TorusGeometry(4,.025,4,48),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.65}));
    ring.rotation.x=Math.PI/2;ring.position.set(m.x,field.height(m.x,m.z)+.1,m.z);scienceVisual.add(ring);
    const c=document.createElement('canvas');c.width=c.height=64;const g=c.getContext('2d');
    g.fillStyle='#203028dd';g.beginPath();g.arc(32,32,28,0,Math.PI*2);g.fill();g.fillStyle=color;g.font='bold 34px Consolas';g.textAlign='center';g.textBaseline='middle';g.fillText(m.label,32,34);
    const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;
    const label=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthTest:false}));label.position.set(m.x,field.height(m.x,m.z)+2,m.z);label.scale.set(1,1,1);scienceVisual.add(label);
  }
}

function frame(now) {
  const dt = Math.min((now - lastFrame) / 1000, .1); lastFrame = now; elapsed += dt;
  accumulator += dt;
  while (accumulator >= 1 / 60) {step(1 / 60); accumulator -= 1 / 60;}
  updateCamera(dt); renderer.render(scene, camera); state.frames++;
  uiElapsed += dt; if (uiElapsed >= .08) {updateUI(); uiElapsed = 0;}
  frameId = requestAnimationFrame(frame);
}

async function capture() {
  const button = $('capture-frame'); button.disabled = true;
  const captureCamera = camera.clone(); captureCamera.aspect = 4 / 3; captureCamera.fov = navcamVerticalFov; captureCamera.updateProjectionMatrix();
  try {
    // The display framebuffer applies the same ACES/sRGB conversion as the live
    // view. A raw render target is linear and bypasses that display transform.
    renderer.setSize(5120, 3840, false); renderer.render(scene, captureCamera);
    // toBlob snapshots the canvas bitmap at invocation. Restore the live buffer
    // immediately, before waiting, so later animation frames keep their view.
    const encoded = new Promise(resolve => renderer.domElement.toBlob(resolve, 'image/png'));
    resize(); renderer.render(scene, camera);
    const blob = await encoded; if (!blob) throw new Error('PNG encoding failed');
    const link = document.createElement('a'), url = URL.createObjectURL(blob);
    link.href = url; link.download = `TerrainSurf_${activeSite}_Navcam_${Date.now()}.png`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000); toast('5120 × 3840 virtual camera image captured.');
  } catch (error) {console.error(error); toast('Capture failed. Try preview resolution and capture again.');}
  finally {resize(); button.disabled = false;}
}

function stopFollowing(message, {immediate = false} = {}) {
  followingRoute = false; navigationBraking = Math.abs(state.speed) > 0;
  if (immediate) {state.speed = 0; navigationBraking = false;}
  $('route-follow').textContent = 'Drive to destination';
  if (message) $('route-status').textContent = message;
  if (message) mission?.navigationStopped(message);
}

function startFollowing() {
  if (plannedRoute?.status !== 'ready' || switchingSite) return;
  clearInput(); followingRoute = true; navigationBraking = false; routeDistance = 0; follower = createFollower();
  $('route-follow').textContent = 'Pause navigation';
  $('route-status').textContent = 'Navigating to your destination. Space stops; click the map to change course.';
}

function clearRoute({preserveMotion = false} = {}) {
  routeGeneration++;
  stopFollowing(undefined, {immediate: !preserveMotion}); plannedRoute = null; routeDistance = 0;
  follower = createFollower(); routePending = false;
  if (routeVisual) {
    scene.remove(routeVisual); routeVisual.geometry.dispose(); routeVisual.material.dispose(); routeVisual = null;
  }
  if(directVisual){scene.remove(directVisual);directVisual.geometry.dispose();directVisual.material.dispose();directVisual=null;}
  $('route-comparison-legend').hidden=true;
  $('route-results').hidden = true;
  $('route-status').textContent = 'Click the orbital map to choose a destination.';
}

function togglePlanner(value) {
  if(value)mission?.show(false);
  routePlanning = value; $('route-panel').hidden = !value;
  document.body.classList.toggle('route-planning', value);
  $('route-open').setAttribute('aria-pressed', value);
  if (value) clearInput();
}

function drawProfile(canvas = $('route-profile')) {
  const c = canvas.getContext('2d'), p = plannedRoute;
  const w = canvas.width, h = canvas.height, low = p.minElevation, span = Math.max(.1, p.maxElevation - low);
  const x = s => 15 + s.distance / Math.max(.01, p.length) * (w - 30);
  const y = s => h - 35 - (s.elevation - low) / span * (h - 65);
  c.clearRect(0, 0, w, h); c.strokeStyle = '#ffffff22'; c.lineWidth = 1;
  c.beginPath(); c.moveTo(15, h - 35); c.lineTo(w - 15, h - 35); c.stroke();
  for (let i = 1; i < p.samples.length; i++) {
    c.beginPath(); c.moveTo(x(p.samples[i - 1]), y(p.samples[i - 1])); c.lineTo(x(p.samples[i]), y(p.samples[i]));
    c.strokeStyle = p.samples[i].slope > p.limit * .8 ? '#ffc087' : '#74dcff'; c.lineWidth = 3; c.stroke();
  }
  c.font = '17px Consolas,monospace'; c.fillStyle = '#cfddd2';
  c.fillText(`${p.maxElevation.toFixed(1)} m`, 15, 19);
  c.fillText(`${p.minElevation.toFixed(1)} m`, 15, h - 12);
  c.textAlign = 'right'; c.fillText(`${p.length.toFixed(0)} m distance`, w - 15, h - 12); c.textAlign = 'left';
}

function requestRoute(goal, {navigate = false, owner = null} = {}) {
  if (switchingSite) return;
  clearRoute({preserveMotion: true}); clearInput(); routePending = true;
  mission?.routeChanged(owner);
  $('route-status').textContent = 'Checking measured slopes along possible routes…';
  // Yield once so the planning status can paint before the bounded search.
  const site = activeSite, generation = routeGeneration;
  setTimeout(() => {
    if (site !== activeSite || generation !== routeGeneration || switchingSite) return;
    plannedRoute = planRoute(meta, field, {x: state.x, z: state.z}, goal, Number($('route-grade').value));
    plannedRoute.comparison=compareDirect(meta,field,{x:state.x,z:state.z},goal,Number($('route-grade').value),plannedRoute);
    const comparison=plannedRoute.comparison;
    $('route-comparison-legend').hidden=!comparison;
    if(comparison){
      const d=comparison.direct,rejected=d.status==='rejected',p=comparison.proposed;
      $('route-direct-key').hidden=!rejected;$('route-proposed-key').hidden=p.status!=='ready';
      $('route-comparison-text').textContent=`Direct: ${d.length.toFixed(1)} m, peak ${d.maxSlope.toFixed(1)}° ${rejected?`exceeds ${comparison.limit}° assumption`:'within slope assumption'}. `+
        (p.status==='ready'?`Proposed: ${p.length.toFixed(1)} m (+${p.extra_distance_m.toFixed(1)} m), peak ${p.maxSlope.toFixed(1)}°, climb ${p.ascent.toFixed(1)} m.`:'No proposed route found under this assumption.');
      if(rejected){
        const points=d.samples.map(p=>new THREE.Vector3(p.x,field.height(p.x,p.z)+.08,p.z));
        directVisual=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineDashedMaterial({color:'#ff7f7f',dashSize:1.5,gapSize:1}));
        directVisual.computeLineDistances();scene.add(directVisual);
      }
    }
    routePending = false;
    mission?.routePlanned(plannedRoute,owner);
    if (plannedRoute.status !== 'ready') {stopFollowing(plannedRoute.message); drawMap(); return;}
    const positions = [], colors = [];
    for (let i = 1; i < plannedRoute.samples.length; i++) {
      for (const p of [plannedRoute.samples[i - 1], plannedRoute.samples[i]]) {
        positions.push(p.x, field.height(p.x, p.z) + .05, p.z);
        const color = new THREE.Color('#8fe0a4');
        colors.push(color.r, color.g, color.b);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    routeVisual = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({vertexColors: true})); scene.add(routeVisual);
    const p = plannedRoute;
    $('route-results').hidden = false;
    $('route-status').textContent = 'Proposed route ready. Click another destination to compare.';
    $('route-stats').innerHTML = `<div><span>ROUTE LENGTH</span>${p.length.toFixed(1)} m</div><div><span>ASCENT / DESCENT</span>+${p.ascent.toFixed(1)} / −${p.descent.toFixed(1)} m</div><div><span>MAX TERRAIN SLOPE</span>${p.maxSlope.toFixed(1)}°</div><div><span>TIME AT ASSUMED 0.5 m/s</span>${(p.length / .5 / 60).toFixed(1)} min</div>`;
    $('route-warning').textContent = p.flagged ? 'Amber sections approach the selected slope limit. This is a terrain warning; slip and astronaut safety are not predicted.'
      : 'No sampled slope exceeds the chosen limit. Soil strength, small obstacles and crew mobility still need assessment.';
    $('route-warning').textContent += ' Navigation brakes within 2.5 m of the marker.';
    drawProfile();drawProfile($('mission-profile')); drawMap();
    if (navigate) startFollowing();
  }, 0);
}

function previewRoute(dt) {
  const p = plannedRoute, command = routeCommand(state, p, follower);
  if (!follower.blocked && !stoppingArcAllowed(meta, field, state, command, p.limit)) follower.blocked = true;
  if (follower.blocked) {command.speed = 0; command.brake = true; follower.targetSpeed = 0;}
  const next = {...state}; let travel = advanceDrive(next, command, dt);
  if (allowedPosition(meta, field, next, p.limit)) Object.assign(state, next);
  else {follower.blocked = true; state.speed = 0; travel = 0;}
  routeDistance = follower.progress; finishMotion(travel,dt);
  $('route-status').textContent = `${follower.arriving ? 'Braking near destination' : 'Navigating'} · ${routeDistance.toFixed(0)} / ${p.length.toFixed(0)} m. Space stops; click the map to change course.`;
  if (follower.blocked && state.speed === 0) stopFollowing('Paused: this turning arc reaches the slope limit or field edge. Choose another route or take manual control.');
  else if (follower.arriving && state.speed === 0) stopFollowing('Destination reached within the 2.5 m arrival area. Click the map to travel somewhere else.');
}

async function loadField(id) {
  const entry = catalog.sites.find(s => s.id === id); if (!entry) throw new Error('Unknown field');
  switchingSite = true; clearInput(); stopFollowing();
  const select = $('site-select'); select.disabled = true;
  const manifest = new URL(entry.manifest, location.href);
  try {
    const next = await json(manifest);
    // Current data-pack contract is a bounded, square, equatorial Mars grid.
    if (next.body !== 'Mars' || next.width_m !== next.depth_m || next.cols !== next.rows
      || next.projection !== 'Equirectangular; standard parallel 0, central meridian 0'
      || !(next.spacing_m > 0)) throw new Error('Unsupported field grid or coordinate frame');
    const [buffer, optical] = await Promise.all([
      fetch(new URL(next.height_file, manifest)).then(r => {if (!r.ok) throw new Error('Elevation download failed'); return r.arrayBuffer();}),
      imageFile(new URL(next.image_file, manifest))]);
    const heights = new Float32Array(buffer), nextMeta=groundMeta(next), nextField = createHeightField(nextMeta, heights);
    // Regenerate the overlay from the same ground-metre gradient as the planner.
    // The historical projected-slope raster remains an unchanged source artifact.
    const slope=document.createElement('canvas');slope.width=next.cols;slope.height=next.rows;
    const slopeContext=slope.getContext('2d'),pixels=slopeContext.createImageData(slope.width,slope.height);
    for(let row=0;row<next.rows;row++)for(let col=0;col<next.cols;col++){
      const value=terrainSlope(nextField,(col/(next.cols-1)-.5)*nextMeta.width_m,(row/(next.rows-1)-.5)*nextMeta.depth_m);
      const t=Math.min(1,value/20),i=(row*next.cols+col)*4;
      pixels.data.set([Math.round(65+170*t),Math.round(145-65*t),Math.round(120-50*t),255],i);
    }
    slopeContext.putImageData(pixels,0,0);
    // Commit only after all inputs are readable and the measured grid is valid.
    clearRoute();
    const previous = terrain;
    meta = nextMeta; field = nextField; images.optical = optical; images.slope = slope;
    activeSite = id; activeManifest = entry.manifest; buildSurface(heights);
    mission?.fieldChanged();
    if (previous) {scene.remove(previous); previous.geometry.dispose(); previous.material.map.dispose(); previous.material.normalMap.dispose(); previous.material.dispose();}
    select.value = id; $('route-site').textContent = entry.name;
    $('map-caption').textContent = mapLayer === 'optical' ? 'Your route, on real Mars imagery.' : 'Slope derived from measured elevation.';
    document.querySelector('.site-card h1').textContent = entry.name;
    document.querySelector('.site-card p').textContent = 'Drive the surface. Plan your traverse.';
    document.querySelector('.site-meta span').textContent = `${meta.width_m.toFixed(0)} × ${meta.depth_m.toFixed(0)} m`;
    $('field-location').textContent = `${next.site.split('·')[0].trim()}, MARS`;
    document.querySelector('.detail-note').textContent = `${next.spacing_m} m source posts · grain shading illustrative`;
    const sourceRows = document.querySelectorAll('.source-row');
    sourceRows[0].querySelector('p').textContent = `Measured Mars elevation · ${next.dem.source_pixel_m} m projected source posts; ${meta.ground_frame.spacing_east_m.toFixed(3)} m east / ${meta.ground_frame.spacing_north_m.toFixed(3)} m north in the local ground frame. Heights unchanged. Local map-scale approximation error is below ${(meta.ground_frame.maximum_scale_error_bound*100).toFixed(4)}%; source accuracy is separate.`;
    for (let i = 0; i < 2; i++) sourceRows[i].querySelector('a').href = next.sources[i];
    document.querySelector('.manifest-link').href = entry.manifest;
    document.querySelector('#sources-dialog > p').textContent = `${next.site}. A ${meta.width_m.toFixed(1)} × ${meta.depth_m} m ground footprint from a ${next.width_m} m projected crop. Scene, map, routes and rover share ground metres; source projection stays recorded in the manifest.`;
    document.title = `Terrain.Surf · ${entry.name}`;
    if (rover) {reset(); resize(); updateCamera(1); updateUI(); toast(`${entry.name} loaded. A fresh traverse has started.`);}
  } finally {switchingSite = false; select.disabled = false;}
}

function controls() {
  $('chase-mode').onclick = () => setMode('chase'); $('navcam-mode').onclick = () => setMode('navcam');
  $('sensor-resolution').onchange = () => {resize(); toast($('sensor-resolution').value === 'native' ? 'Full sensor frame. Preview is faster on smaller devices.' : '1280 × 960 live preview. Native capture stays available.');};
  $('capture-frame').onclick = capture; $('reset-rover').onclick = reset;
  $('site-select').onchange = () => loadField($('site-select').value).catch(error => {
    $('site-select').value = activeSite; toast(`Field could not load: ${error.message}. Previous field retained.`);
  });
  $('route-open').onclick = () => togglePlanner(!routePlanning);
  $('route-close').onclick = () => togglePlanner(false);
  $('route-clear').onclick = () => {clearRoute();mission?.routeChanged(null);};
  $('route-grade').onchange = () => {$('mission-grade').value=$('route-grade').value;if (plannedRoute?.goal) requestRoute({...plannedRoute.goal}, {navigate: followingRoute});};
  $('route-auto').onchange = () => {
    if (!$('route-auto').checked) stopFollowing('Route inspection only. Click the map to compare destinations, then Drive to destination when ready.');
    $('map-click-hint').textContent = $('route-auto').checked ? 'Click the map to drive there · Space stops' : 'Click the map to inspect a route';
  };
  $('route-follow').onclick = () => {
    if (followingRoute) {stopFollowing('Navigation paused. Drive to destination resumes from here.'); return;}
    if (plannedRoute?.status !== 'ready') return;
    if (Math.hypot(state.x - plannedRoute.start.x, state.z - plannedRoute.start.z) > .01) {
      requestRoute({...plannedRoute.goal}, {navigate: true,owner:mission?.read().target}); return;
    }
    startFollowing();
  };
  mapCanvas.addEventListener('click', e => {
    if (!state.ready || switchingSite || e.button !== 0) return;
    // Resolve against the displayed map before opening the panel changes the
    // narrow-screen layout. The click and rover use the same coordinate frame.
    const box = mapCanvas.getBoundingClientRect(), extent = meta.depth_m / mapZoom;
    const goal = {x: mapCenter.x + ((e.clientX - box.left) / box.width - .5) * extent,
      z: mapCenter.z + ((e.clientY - box.top) / box.height - .5) * extent};
    const marker=mission?.markers().find(m=>m.id!=='return'&&Math.hypot(m.x-goal.x,m.z-goal.z)<extent*12/box.width);
    if(marker){mission.show(true);mission.select(marker.id);return;}
    togglePlanner(true);
    requestRoute(goal, {navigate: $('route-auto').checked});
  });
  $('sensor-aim').onchange = () => {mastPitch = {traverse: -.22, ground: -.52, horizon: 0}[$('sensor-aim').value]; cameraSnap = true;};
  $('sensor-exposure').oninput = () => {
    sensorExposure = Number($('sensor-exposure').value); $('exposure-value').textContent = `${sensorExposure.toFixed(2)}×`;
    if (state.mode === 'navcam') renderer.toneMappingExposure = sensorExposure;
  };
  $('surface-detail').onclick = () => {
    surfaceDetail = !surfaceDetail; terrain.material.normalScale.setScalar(surfaceDetail ? .42 : 0);
    $('surface-detail').setAttribute('aria-pressed', surfaceDetail);
    $('surface-detail').textContent = `Granular shading: ${surfaceDetail ? 'on' : 'off'}`;
  };
  $('speed-mode').onclick = () => {state.fast = !state.fast; $('speed-mode').setAttribute('aria-pressed', state.fast); toast(state.fast ? 'Explore speed · up to 4 m/s (virtual rover)' : 'Survey speed · up to 1.5 m/s (virtual rover)');};
  for (const layer of ['optical', 'slope']) $(`${layer}-map`).onclick = () => {
    mapLayer = layer; for (const l of ['optical', 'slope']) $(`${l}-map`).setAttribute('aria-pressed', l === layer);
    $('map-caption').textContent = layer === 'slope' ? 'DEM slope · teal gentler, red steeper.' : 'Your route, on real Mars imagery.'; drawMap();
  };
  $('map-zoom').onclick = () => {mapZoom = mapZoom === 1 ? 2 : mapZoom === 2 ? 4 : 1; mapCenter = {x: 0, z: 0}; $('map-zoom').textContent = `${mapZoom}×`; drawMap();};
  function openDialog(id) {clearInput(); state.speed = 0; $(id).showModal();}
  $('help-open').onclick = () => openDialog('help-dialog'); $('sources-open').onclick = () => openDialog('sources-dialog');
  $('help-done').onclick = () => $('help-dialog').close();
  document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => $(b.dataset.close).close());
  window.addEventListener('keydown', e => {
    if (modalOpen() || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    const driveCodes = ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];
    if (driveCodes.includes(e.code)) {e.preventDefault(); keys.add(e.code);}
    if (!e.repeat) {
      if (e.code === 'Digit1') setMode('chase');
      if (e.code === 'Digit2') setMode('navcam');
      if (e.code === 'KeyC') setMode(state.mode === 'chase' ? 'navcam' : 'chase');
      if (e.code === 'KeyR') reset();
    }
  });
  window.addEventListener('keyup', e => keys.delete(e.code)); window.addEventListener('blur', clearInput);
  document.addEventListener('visibilitychange', () => {if (document.hidden) {clearInput(); state.speed = 0;} lastFrame = performance.now();});
  window.addEventListener('resize', resize);
  const canvas = renderer.domElement; let dragging;
  canvas.addEventListener('pointerdown', e => {if (e.button !== 0) return; canvas.focus({preventScroll: true}); canvas.setPointerCapture(e.pointerId); dragging = {id: e.pointerId, x: e.clientX, y: e.clientY};});
  canvas.addEventListener('pointermove', e => {
    if (!dragging || dragging.id !== e.pointerId) return;
    const dx = e.clientX - dragging.x, dy = e.clientY - dragging.y; dragging.x = e.clientX; dragging.y = e.clientY;
    if (state.mode === 'chase') {orbitYaw -= dx * .006; orbitPitch = clamp(orbitPitch + dy * .005, .07, 1.25);}
    else {mastYaw = clamp(mastYaw + dx * .004, -rad(110), rad(110)); mastPitch = clamp(mastPitch - dy * .003, -rad(45), rad(30));}
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, () => {dragging = null;});
  canvas.addEventListener('wheel', e => {e.preventDefault(); if (state.mode === 'chase') orbitDistance = clamp(orbitDistance * Math.exp(e.deltaY * .001), 3.3, 18);}, {passive: false});
  document.querySelectorAll('[data-drive]').forEach(b => {
    b.addEventListener('pointerdown', e => {e.preventDefault(); b.setPointerCapture(e.pointerId); touch.add(b.dataset.drive); b.classList.add('active');});
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(event, () => {touch.delete(b.dataset.drive); b.classList.remove('active');});
  });
}

async function boot() {
  initScene(); setProgress(15, 'Reading the Jezero crop and coordinate frame…');
  catalog = await json('data/sites.json');
  for (const site of catalog.sites) {const option = document.createElement('option'); option.value = site.id; option.textContent = site.name; $('site-select').append(option);}
  const [, spec, packText, weatherText,regionalText,maps] = await Promise.all([loadField(catalog.default), json('assets/rover.json'),
    fetch('data/science_v006/science.json').then(r=>{if(!r.ok)throw new Error('Science data unavailable');return r.text();}),
    fetch('data/weather_v009/weather.json').then(r=>{if(!r.ok)throw new Error('Historical conditions unavailable');return r.text();}),
    fetch('data/regional_v011/regional.json').then(r=>{if(!r.ok)throw new Error('Regional dust history unavailable');return r.text();}),
    Promise.all(catalog.sites.map(async s=>({...s,meta:await json(s.manifest)})))]); roverMeta = spec;
  sciencePack=JSON.parse(packText);
  sciencePackHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(packText)))).map(b=>b.toString(16).padStart(2,'0')).join('');
  weatherPack=JSON.parse(weatherText);
  weatherPackHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(weatherText)))).map(b=>b.toString(16).padStart(2,'0')).join('');
  setProgress(48, 'Loading your optimized rover and its four wheel pivots…');
  const gltf = await new GLTFLoader().loadAsync('assets/rover.glb', e => {
    if (e.total) setProgress(48 + e.loaded / e.total * 42, 'Loading the rover’s geometry and materials…');
  });
  rover = new THREE.Group(); rover.add(gltf.scene); scene.add(rover);
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(o => {if (o.isMesh) {o.castShadow = true; o.receiveShadow = true;}});
  // Rigid groups make steering and rolling independent of imported mesh rotations.
  for (const [name, spec] of Object.entries(roverMeta.wheels)) {
    const mesh = gltf.scene.getObjectByName(spec.node); if (!mesh) throw new Error(`Missing wheel ${spec.node}`);
    const position = mesh.getWorldPosition(new THREE.Vector3()), quaternion = mesh.getWorldQuaternion(new THREE.Quaternion());
    const scale = mesh.getWorldScale(new THREE.Vector3());
    const pivot = new THREE.Group(), spin = new THREE.Group(); pivot.position.copy(position); pivot.add(spin); rover.add(pivot);
    spin.add(mesh); mesh.position.set(0, 0, 0); mesh.quaternion.copy(quaternion); mesh.scale.copy(scale);
    wheels.push({pivot, spin, radius: spec.radius_m, centerY: position.y, front: name.startsWith('F')});
  }
  setProgress(96, 'Joining the rover, camera and overhead map…');
  state.ready = true; controls(); reset(); setMode('chase'); updateCamera(1); updateUI();
  mission=createMissionUI(sciencePack,{site:()=>activeSite,meta:()=>meta,field:()=>field,
    pose:()=>({x:state.x,z:state.z,speed:state.speed,heading:state.heading,distance:state.distance,simulationTime:state.simulationTime}),
    following:()=>followingRoute,planning:()=>routePending,limit:()=>Number($('route-grade').value),setLimit:v=>{$('route-grade').value=String(v);},
    plan:planRoute,request:requestRoute,clearInput,toast,load:loadField,packHash:sciencePackHash,slope:(x,z)=>terrainSlope(field,x,z),
    pause:(options)=>stopFollowing('Scout paused. Review the route before continuing.',options),
    drive:()=>$('route-follow').click(),closePlanner:()=>togglePlanner(false),conditions:()=>conditions.read(),regional:()=>regional.read()});
  conditions=createConditionsUI(weatherPack,{clearInput,pause:()=>stopFollowing('Paused to review historical conditions.',{immediate:true}),
    plan:()=>mission.environmentalPlan(),redraw:drawMap,openMission:()=>mission.show(true),
    context:()=>({meta,field,pose:state,route:plannedRoute,stop:sciencePack.stops.find(s=>s.id===mission.selected()),hash:weatherPackHash})});
  const regionalHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(regionalText)))).map(b=>b.toString(16).padStart(2,'0')).join('');
  regional=createRegionalWeather(JSON.parse(regionalText),{maps,hash:regionalHash,world:worldFromCoordinates,redraw:drawMap,clearInput,
    pause:()=>stopFollowing('Paused to inspect regional dust history.',{immediate:true}),plan:()=>mission.environmentalPlan(),
    openMission:()=>mission.show(true),context:()=>({meta,field,pose:state,route:plannedRoute,site:activeSite})});
  renderer.render(scene, camera); $('loading').hidden = true;
  tutorial=createTutorial({mission,clearInput,pause:options=>stopFollowing('Tutorial paused the scout. Your route and notebook are retained.',options),
    world:()=>({following:followingRoute,speed:state.speed,camera:state.mode,regionalHome:regional.read().scout_cell.cell_index}),
    interfaceUI:{
      read:()=>({camera:state.mode,panel:routePlanning?'route':mission.visible()?'mission':null,conditions:$('conditions-dialog').open,regional:$('regional-dialog').open}),
      show:({camera:mode='chase',panel=null,sources=false,conditions:showConditions=false,regional:showRegional=false})=>{
        if(state.mode!==mode)setMode(mode);
        if(mission.visible()!==(panel==='mission'))mission.show(panel==='mission');
        if(routePlanning!==(panel==='route'))togglePlanner(panel==='route');
        // During orientation the source panel shares Driver's document layer.
        // Normal Data & sources still uses its original native modal dialog.
        const dialog=$('sources-dialog');
        if(sources&&!dialog.open)dialog.show();else if(!sources&&dialog.open)dialog.close();
        conditions.showForTour(showConditions);
        regional.showForTour(showRegional);
      },
    }});
  lastFrame = performance.now(); frameId = requestAnimationFrame(frame);
  window.terrainSurf = Object.freeze({
    readState: () => ({...state, headingDegrees: (deg(state.heading) % 360 + 360) % 360,
      coordinates: field.coordinates(state.x, state.z), elevation: field.absoluteHeight(state.x, state.z),
      drawingBuffer: {width: renderer.domElement.width, height: renderer.domElement.height},
      map: {marker: {...mapMarker}, center: {...mapCenter}, extent: meta.depth_m / mapZoom, pixels: mapCanvas.width, layer: mapLayer,weatherOverlay:conditions?.marker().overlay||false},
      groundFrame:meta.ground_frame,footprint:{width:meta.width_m,depth:meta.depth_m},
      camera: {position: camera.position.toArray(), fov: camera.fov, aspect: camera.aspect, mastYaw, mastPitch, exposure: renderer.toneMappingExposure},
      surface: {spacing_m: meta.spacing_m, normalDetail: surfaceDetail, heightExaggeration: 1},
      site: {id: activeSite, manifest: activeManifest, name: meta.site, switching: switchingSite},
      route: {status: plannedRoute?.status || 'none', planning: routePlanning, following: followingRoute,
        length: plannedRoute?.length, progress: routeDistance, maxSlope: plannedRoute?.maxSlope, limit: plannedRoute?.limit,
        arrivalRadius: DRIVE.arrivalRadius, arriving: follower.arriving, blocked: follower.blocked,
        targetSpeed: follower.targetSpeed, bearing: follower.bearing, target: follower.target ? {...follower.target} : null},
      drive: {model: 'kinematic bicycle / lunar waypoint policy', wheelbase: DRIVE.wheelbase,
        maxSteer: DRIVE.maxSteer, frontWheelYaw: wheels.filter(w => w.front).map(w => w.pivot.rotation.y)},
      wheels: wheels.length, trailPoints: trail.length, terrainVertices: meta.cols * meta.rows,
      renderer: {calls: renderer.info.render.calls, triangles: renderer.info.render.triangles}}),
    readRoute: () => plannedRoute ? structuredClone(plannedRoute) : null,
    readMission: () => mission.read(),
    readConditions: () => conditions.read(),
    readRegionalWeather: () => regional.read(),
    readTutorial: () => tutorial.read(),
    sampleHeight: (x, z) => field.height(x, z),
    // Independent browser smoke can raycast the exact rendered geometry.
    raycastSurface: (x, z) => new THREE.Raycaster(new THREE.Vector3(x, meta.height_max_m - meta.height_base_m + 100, z), new THREE.Vector3(0, -1, 0)).intersectObject(terrain)[0]?.point.y,
  });
}

window.addEventListener('pagehide', () => {clearInput(); if (frameId) cancelAnimationFrame(frameId);});
window.addEventListener('pageshow', e => {if (e.persisted && state.ready) {lastFrame = performance.now(); frameId = requestAnimationFrame(frame);}});
boot().catch(error => {console.error(error); $('loading-text').textContent = `Could not open this field: ${error.message}. Start the local server, then reload.`; $('load-progress').value = 0;});
