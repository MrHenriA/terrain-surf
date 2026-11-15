// Browser adaptation of BP_MR_Rover's accepted v005 waypoint/bearing policy.
// Kinematic bicycle motion: no Chaos contact, traction or soil prediction.
import {terrainSlope} from './route.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const radians = Math.PI / 180;
export const DRIVE = Object.freeze({
  wheelbase: 1.736, maxSteer: 30 * radians, bearingGain: 25 * radians,
  lookAhead: 4, arrivalRadius: 2.5, cruiseSpeed: 3.6,
  // Web response tuning. These are not measured Martian soil properties.
  steerRate: .8, steerResponse: 5.5, acceleration: .65,
  deceleration: .9, braking: 1.4, coast: .16, turnAcceleration: .85,
});
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const angle = a => Math.atan2(Math.sin(a), Math.cos(a));

export function advanceDrive(state, command, dt) {
  const oldSpeed = state.speed, oldSteer = state.steer;
  const target = command.speed;
  const slowing = oldSpeed * target < 0 || Math.abs(target) < Math.abs(oldSpeed);
  const rate = command.brake ? DRIVE.braking : command.coast ? DRIVE.coast
    : slowing ? DRIVE.deceleration : DRIVE.acceleration;
  state.speed += clamp(target - oldSpeed, -rate * dt, rate * dt);
  if (Math.abs(state.speed) < .00001) state.speed = 0;
  const steerLimit = Math.min(DRIVE.maxSteer,
    Math.atan(DRIVE.wheelbase * DRIVE.turnAcceleration / Math.max(.01, oldSpeed ** 2)));
  const steer = clamp(command.steer, -steerLimit, steerLimit);
  const change = (steer - oldSteer) * (1 - Math.exp(-DRIVE.steerResponse * dt));
  state.steer += clamp(change, -DRIVE.steerRate * dt, DRIVE.steerRate * dt);
  const travel = (oldSpeed + state.speed) * .5 * dt;
  const yaw = travel / DRIVE.wheelbase * Math.tan((oldSteer + state.steer) * .5);
  const mid = state.heading + yaw * .5;
  const chord = Math.abs(yaw) < 1e-8 ? travel : travel * Math.sin(yaw * .5) / (yaw * .5);
  state.x += Math.sin(mid) * chord; state.z -= Math.cos(mid) * chord;
  state.heading += yaw; state.distance += Math.abs(travel);
  return travel;
}

export function createFollower() {
  return {progress: 0, arriving: false, blocked: false, turnSide: 0,
    targetSpeed: 0, bearing: 0, target: null};
}

function pathPoint(route, progress) {
  const points = route.samples;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (b.distance < progress) continue;
    const t = clamp((progress - a.distance) / Math.max(1e-9, b.distance - a.distance), 0, 1);
    return {x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t};
  }
  return route.goal;
}

export function routeCommand(state, route, follower) {
  // Progress comes from the driven pose, never from an animated path cursor.
  // Limit the search window so a crossing cannot skip a distant part of a route.
  let nearest = Infinity, progress = follower.progress;
  for (let i = 1; i < route.samples.length; i++) {
    const a = route.samples[i - 1], b = route.samples[i];
    if (b.distance < follower.progress - 2) continue;
    if (a.distance > follower.progress + 12) break;
    const dx = b.x - a.x, dz = b.z - a.z, squared = dx * dx + dz * dz;
    const t = clamp(((state.x - a.x) * dx + (state.z - a.z) * dz) / Math.max(1e-9, squared), 0, 1);
    const d = Math.hypot(state.x - a.x - t * dx, state.z - a.z - t * dz);
    if (d < nearest) {nearest = d; progress = a.distance + t * (b.distance - a.distance);}
  }
  follower.progress = Math.max(follower.progress, progress);
  follower.target = pathPoint(route, follower.progress + DRIVE.lookAhead);
  const goalDistance = distance(state, route.goal);
  if (goalDistance < DRIVE.arrivalRadius && route.length - follower.progress < DRIVE.lookAhead)
    follower.arriving = true;
  let bearing = angle(Math.atan2(follower.target.x - state.x, -(follower.target.z - state.z)) - state.heading);
  // A target directly behind has two equally valid turns. Keep the chosen side.
  if (Math.abs(bearing) > 2.8) {
    if (!follower.turnSide) follower.turnSide = Math.sign(bearing) || 1;
    bearing = Math.abs(bearing) * follower.turnSide;
  } else if (Math.abs(bearing) < 2.4) follower.turnSide = 0;
  follower.bearing = bearing;
  const desiredSteer = DRIVE.maxSteer * clamp(bearing / DRIVE.bearingGain, -1, 1);
  let speed = clamp(goalDistance * .35, .6, DRIVE.cruiseSpeed);
  if (Math.abs(bearing) > 60 * radians) speed *= .5;
  // Slow before tight bends; retain the lunar rover's wider turns at speed.
  const curvature = Math.abs(Math.tan(desiredSteer) / DRIVE.wheelbase);
  speed = Math.min(speed, Math.sqrt(DRIVE.turnAcceleration / Math.max(.0001, curvature)));
  if (follower.arriving || follower.blocked) speed = 0;
  const speedSteer = Math.atan(DRIVE.wheelbase * DRIVE.turnAcceleration / Math.max(.01, state.speed ** 2));
  follower.targetSpeed = speed;
  return {speed, steer: clamp(desiredSteer, -speedSteer, speedSteer),
    brake: follower.arriving || follower.blocked};
}

export function allowedPosition(meta, field, pose, limit = Infinity) {
  if (Math.abs(pose.x) >= meta.width_m / 2 - 5 || Math.abs(pose.z) >= meta.depth_m / 2 - 5) return false;
  const slope = terrainSlope(field, pose.x, pose.z);
  return Number.isFinite(slope) && slope <= limit;
}

export function stoppingArcAllowed(meta, field, state, command, limit) {
  // Inspect the actual curved stopping arc, not an unchecked straight shortcut.
  const probe = {...state};
  const duration = Math.abs(state.speed) / DRIVE.braking + .35;
  for (let t = 0; t < duration; t += .1) {
    advanceDrive(probe, {...command, speed: 0, brake: true}, .1);
    if (!allowedPosition(meta, field, probe, limit)) return false;
  }
  return true;
}
