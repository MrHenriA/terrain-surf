import {routeProfile} from './route.js';
// Compare the actual straight line to the same slope assumption as the planner.
// A straight line is never labelled rejected merely because A* chose a detour.
export function compareDirect(meta,field,start,goal,limit,proposed){
  const inside=p=>Number.isFinite(p.x)&&Number.isFinite(p.z)&&Math.abs(p.x)<=meta.width_m/2-5&&Math.abs(p.z)<=meta.depth_m/2-5;
  if(!inside(start)||!inside(goal)||Math.hypot(start.x-goal.x,start.z-goal.z)<1)return null;
  const direct=routeProfile(field,[start,goal],limit),exceeded=direct.samples.filter(p=>!Number.isFinite(p.slope)||p.slope>limit).length;
  return {kind:'Measured-DEM slope comparison; individual rock clearance unverified',limit,
    direct:{...direct,status:exceeded?'rejected':'within_limit',exceeded_samples:exceeded,start:{...start},goal:{...goal}},
    proposed:proposed.status==='ready'?{status:'ready',length:proposed.length,ascent:proposed.ascent,descent:proposed.descent,maxSlope:proposed.maxSlope,
      extra_distance_m:proposed.length-direct.length}: {status:proposed.status},
    limitations:'Slope is sampled at about1 m; no mapped boulder exclusions, soil traction, calibrated rover mobility or certified safe route.'};
}
