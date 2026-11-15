// Measured-DEM route planning. No soil model or certified mobility limits.
const degrees = 180 / Math.PI;
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

class MinHeap {
  items = [];
  push(item) {
    let i = this.items.length; this.items.push(item);
    while (i) {const p = (i - 1) >> 1; if (this.items[p].f <= item.f) break;
      this.items[i] = this.items[p]; i = p;} this.items[i] = item;
  }
  pop() {
    const first = this.items[0], last = this.items.pop();
    if (this.items.length) {
      let i = 0;
      while (i * 2 + 1 < this.items.length) {
        let j = i * 2 + 1;
        if (j + 1 < this.items.length && this.items[j + 1].f < this.items[j].f) j++;
        if (this.items[j].f >= last.f) break;
        this.items[i] = this.items[j]; i = j;
      } this.items[i] = last;
    } return first;
  }
}

export function terrainSlope(field, x, z) {
  const dx = (field.height(x + .5, z) - field.height(x - .5, z));
  const dz = (field.height(x, z + .5) - field.height(x, z - .5));
  return Math.atan(Math.hypot(dx, dz)) * degrees;
}

export function routeProfile(field, points, limit) {
  const samples = [], startHeight = field.absoluteHeight(points[0].x, points[0].z);
  let length = 0, ascent = 0, descent = 0, maxSlope = 0, flagged = 0, previous = startHeight;
  function sample(p) {
    const elevation = field.absoluteHeight(p.x, p.z), slope = terrainSlope(field, p.x, p.z);
    const delta = elevation - previous;
    ascent += Math.max(0, delta); descent += Math.max(0, -delta); previous = elevation;
    maxSlope = Math.max(maxSlope, slope); if (slope > limit * .8) flagged++;
    samples.push({...p, distance: length, elevation, slope});
  }
  sample(points[0]);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], segment = distance(a, b), count = Math.max(1, Math.ceil(segment));
    for (let j = 1; j <= count; j++) {
      length += segment / count;
      sample({x: a.x + (b.x - a.x) * j / count, z: a.z + (b.z - a.z) * j / count});
    }
  }
  return {samples, length, ascent, descent, maxSlope, flagged,
    minElevation: Math.min(...samples.map(p => p.elevation)),
    maxElevation: Math.max(...samples.map(p => p.elevation))};
}

export function planRoute(meta, field, start, goal, limit = 15) {
  const begin = performance.now(), margin = 5, spacing = 4;
  const nx = Math.floor((meta.width_m - margin * 2) / spacing) + 1;
  const nz = Math.floor((meta.depth_m - margin * 2) / spacing) + 1;
  const left = -meta.width_m / 2 + margin, top = -meta.depth_m / 2 + margin;
  const inside = p => p.x >= left && p.x <= -left && p.z >= top && p.z <= -top;
  if (!inside(start) || !inside(goal)) return {status: 'outside', message: 'Choose a point inside the measured field, away from its edge.'};
  if (distance(start, goal) < 1) return {status: 'nearby', message: 'That point is already within one metre. Choose a more distant destination.'};
  const point = id => ({x: left + id % nx * spacing, z: top + Math.floor(id / nx) * spacing});
  const index = p => Math.min(nz - 1, Math.round((p.z - top) / spacing)) * nx
    + Math.min(nx - 1, Math.round((p.x - left) / spacing));
  const first = index(start), target = index(goal), count = nx * nz;
  const g = new Float64Array(count); g.fill(Infinity);
  const parent = new Int32Array(count); parent.fill(-1);
  const closed = new Uint8Array(count), heap = new MinHeap();
  function edge(a, b) {
    const d = distance(a, b), steps = Math.max(1, Math.ceil(d)); let worst = 0;
    for (let j = 0; j <= steps; j++) {
      const slope = terrainSlope(field, a.x + (b.x - a.x) * j / steps, a.z + (b.z - a.z) * j / steps);
      if (!Number.isFinite(slope) || slope > limit) return Infinity;
      worst = Math.max(worst, slope);
    }
    return d * (1 + 3 * (worst / limit) ** 2);
  }
  const startEdge = edge(start, point(first)), endEdge = edge(point(target), goal);
  if (!Number.isFinite(startEdge + endEdge)) return {status: 'blocked', message: 'Start or destination exceeds the selected slope limit. Choose another point or change the planning assumption.'};
  g[first] = startEdge; heap.push({id: first, f: startEdge + distance(point(first), goal)});
  let expanded = 0, found = false;
  while (heap.items.length) {
    const {id} = heap.pop(); if (closed[id]) continue;
    closed[id] = 1; expanded++; if (id === target) {found = true; break;}
    const x = id % nx, z = Math.floor(id / nx), a = point(id);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if ((!dx && !dz) || x + dx < 0 || x + dx >= nx || z + dz < 0 || z + dz >= nz) continue;
      const next = (z + dz) * nx + x + dx; if (closed[next]) continue;
      const b = point(next), cost = g[id] + edge(a, b);
      if (cost < g[next]) {g[next] = cost; parent[next] = id; heap.push({id: next, f: cost + distance(b, goal)});}
    }
  }
  if (!found) return {status: 'blocked', message: 'No route found within the selected slope limit. This does not establish that the terrain is impassable.', expanded};
  const path = []; for (let id = target; id !== -1; id = parent[id]) path.push(point(id));
  path.reverse(); path.unshift({...start}); path.push({...goal});
  // Remove only duplicate points: shortcuts would bypass measured-slope checks.
  const points = path.filter((p, i) => !i || distance(p, path[i - 1]) > .001);
  const profile = routeProfile(field, points, limit);
  return {status: 'ready', points, ...profile, limit, spacing, expanded, milliseconds: performance.now() - begin,
    directDistance: distance(start, goal), start: {...start}, goal: {...goal}};
}
