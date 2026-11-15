// Convert the equatorial equirectangular source grid to local ground metres.
// Original raster samples and elevations stay unchanged. The crop-centre cosine
// approximation has a recorded scale bound and an independent geodesic test.
export function groundMeta(source) {
  if (source.ground_frame) return source;
  const latitude=source.origin_projected_m[1]/source.mars_radius_m;
  const eastScale=Math.cos(latitude);
  return {...source,width_m:source.width_m*eastScale,
    source_grid:{width_m:source.width_m,depth_m:source.depth_m,spacing_m:source.spacing_m},
    ground_frame:{version:1,kind:'Local spherical ground metres at crop centre',
      east_scale:eastScale,origin_latitude_degrees:latitude*180/Math.PI,
      spacing_east_m:source.spacing_m*eastScale,spacing_north_m:source.spacing_m,
      distance_kind:'Horizontal local ground distance; not 3D surface arc length',
      maximum_scale_error_bound:Math.max(...[-1,1].map(sign=>Math.abs(eastScale/Math.cos(latitude+sign*source.depth_m/2/source.mars_radius_m)-1))),
      limitations:'Local spherical approximation; source georeferencing/elevation errors remain. No terrain safety certification.'}};
}
export function worldFromCoordinates(meta,position) {
  return {x:(meta.mars_radius_m*position.longitude*Math.PI/180-meta.origin_projected_m[0])*(meta.ground_frame?.east_scale||1),
    z:meta.origin_projected_m[1]-meta.mars_radius_m*position.latitude*Math.PI/180};
}

// Metres throughout. X east, Y up, Z south; row zero is the north edge.
export function createHeightField(meta, heights) {
  const {cols, rows, width_m: width, depth_m: depth, height_base_m: base} = meta;
  if (heights.length !== cols * rows || !heights.every(Number.isFinite)) {
    throw new Error('Invalid measured elevation grid');
  }
  function absoluteHeight(x, z) {
    const gx = Math.max(0, Math.min(cols - 1, (x / width + .5) * (cols - 1)));
    const gz = Math.max(0, Math.min(rows - 1, (z / depth + .5) * (rows - 1)));
    const ix = Math.min(cols - 2, Math.floor(gx)), iz = Math.min(rows - 2, Math.floor(gz));
    const u = gx - ix, v = gz - iz, i = iz * cols + ix;
    const a = heights[i], b = heights[i + cols], c = heights[i + 1], d = heights[i + cols + 1];
    // These are exactly the two rendered triangles, rather than a bilinear surface.
    return u + v <= 1 ? a + (c - a) * u + (b - a) * v
      : d + (b - d) * (1 - u) + (c - d) * (1 - v);
  }
  function coordinates(x, z) {
    const [east, north] = meta.origin_projected_m;
    const degrees = 180 / Math.PI / meta.mars_radius_m;
    return {latitude: (north - z) * degrees, longitude: (east + x/(meta.ground_frame?.east_scale||1)) * degrees};
  }
  return {absoluteHeight, height: (x, z) => absoluteHeight(x, z) - base, coordinates};
}

export function mapPoint(x, z, center, extent, pixels) {
  return {x: ((x - center.x) / extent + .5) * pixels,
    y: ((z - center.z) / extent + .5) * pixels};
}

export const navcamVerticalFov = 2 * Math.atan(Math.tan(96 * Math.PI / 360) / (4 / 3)) * 180 / Math.PI;
