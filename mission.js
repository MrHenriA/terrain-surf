// Crew excursion state and evidence. The existing rover remains a virtual scout.
import {worldFromCoordinates} from './terrain.js';
export function worldFromGeo(meta, position) {
  return worldFromCoordinates(meta,position);
}
export function atStation(pose, goal, radius = 4) {
  return !!goal && Math.hypot(pose.x-goal.x,pose.z-goal.z) <= radius && Math.abs(pose.speed) < .03;
}
export function buildExcursion(pack, meta, field, start, limit, planner) {
  let point={x:start.x,z:start.z}; const legs=[];
  for(const stop of [...pack.stops,{id:'return',name:'Return to start',position:field.coordinates(start.x,start.z)}]) {
    const goal=worldFromGeo(meta,stop.position), route=planner(meta,field,point,goal,limit);
    // A crew can already be standing at a station. This does not invent a path.
    if(route.status==='nearby') legs.push({stop:stop.id,name:stop.name,status:'nearby',length:0,ascent:0,descent:0,maxSlope:0,samples:[],goal});
    else legs.push({stop:stop.id,name:stop.name,...route});
    point=goal;
  }
  const ready=legs.every(l=>l.status==='ready'||l.status==='nearby');
  return {status:ready?'ready':'blocked',limit,legs,
    length:legs.reduce((n,l)=>n+(l.length||0),0),ascent:legs.reduce((n,l)=>n+(l.ascent||0),0),
    descent:legs.reduce((n,l)=>n+(l.descent||0),0),maxSlope:Math.max(...legs.map(l=>l.maxSlope||0))};
}

export function createMissionUI(pack, api) {
  const $=id=>document.getElementById(id), now=()=>new Date().toISOString();
  const model={schema:2,id:pack.id,started:false,started_utc:null,completed_utc:null,selected:pack.stops[0].id,
    home:null,records:{},drafts:{},route_history:[],events:[],brief:null,returned:false,
    scout_report:{distance_ground_m:0,moving_simulation_seconds:0,ascent_m:0,descent_m:0,max_sampled_slope_degrees:0,
      provenance:'Virtual scout motion sampled on the measured DEM; not physical wheel/soil measurements'}};
  let visible=false, target=null, currentRoute=null, routeOwner=null, lastArrival=null;
  let previousElevation=null;
  const reviewed=new Set();
  const stop=()=>pack.stops.find(s=>s.id===model.selected);
  const inField=()=>api.site()===pack.site_id;
  const station=id=>id==='return'?model.home:pack.stops.find(s=>s.id===id)?.position;
  const goal=id=>{const p=station(id);return p?worldFromGeo(api.meta(),p):null;};
  function event(type,detail={}){model.events.push({utc:now(),type,...detail});if(model.events.length>256)model.events.shift();}
  function text(id,value){if($(id).textContent!==value)$(id).textContent=value;}
  function select(id) {
    if(!pack.stops.some(s=>s.id===id))return;
    if(model.started&&id!==model.selected){api.pause();target=null;currentRoute=null;routeOwner=null;lastArrival=null;}
    model.selected=id;$('mission-note').value=model.drafts[id]||model.records[id]?.note||'';
    $('mission-task').textContent=stop().task;update();
  }
  function show(value) {
    visible=value; $('mission-panel').hidden=!value;
    document.body.classList.toggle('mission-open',value);$('mission-open').setAttribute('aria-pressed',value);
    if(value){api.closePlanner();api.clearInput();}update();
  }
  function begin() {
    if(!inField()||model.started)return;
    api.pause({immediate:true});const p=api.pose();model.started=true;model.started_utc=now();
    model.home={...api.field().coordinates(p.x,p.z),label:'User-declared excursion start; not a NASA habitat',x:p.x,z:p.z};
    previousElevation=api.field().absoluteHeight(p.x,p.z);
    event('excursion_started',{position:{...model.home}});planBrief();update();
  }
  function planBrief() {
    if(!model.started||!inField())return;
    model.brief=buildExcursion(pack,api.meta(),api.field(),worldFromGeo(api.meta(),model.home),api.limit(),api.plan);
    model.brief.planned_utc=now();event('excursion_planned',{status:model.brief.status,limit:api.limit()});update();
  }
  function planTarget(id) {
    if(!model.started||!inField())return;
    target=id;lastArrival=null;model.returned=false;model.completed_utc=null;
    api.request(goal(id),{navigate:false,owner:id});
    event('leg_requested',{target:id});update();
  }
  function routeChanged(owner) {
    routeOwner=owner;currentRoute=null;
    if(owner!==target)target=null;
    update();
  }
  function routePlanned(route,owner) {
    if(!model.started||!owner||owner!==target)return;
    currentRoute=structuredClone(route);
    model.route_history.push({utc:now(),target:owner,source_site:api.site(),route:structuredClone(route)});
    if(model.route_history.length>64)model.route_history.shift();
    event('leg_planned',{target:owner,status:route.status});update();
  }
  function navigationStopped(reason) {
    if(model.started&&target)event('navigation_stopped',{target,reason,pose:api.pose()});
  }
  function record() {
    if(!model.started||!inField()||!atStation(api.pose(),goal(model.selected)))return;
    const note=$('mission-note').value.trim();if(!note)return;
    model.records[model.selected]={stop:model.selected,note,utc:now(),
      scout_pose:{...api.pose(),...api.field().coordinates(api.pose().x,api.pose().z)},
      kind:'User observation of archived NASA evidence during a virtual visit; not a new Mars measurement',
      source_ids:stop().source_ids,sol:stop().sol,photojournal_id:stop().photojournal_id};
    event('observation_recorded',{stop:model.selected});
    api.toast(`Observation saved for ${stop().name}.`);update();
  }
  function evidence() {
    const s=stop(), container=$('observation-content');container.replaceChildren();
    const make=(tag,content,className)=>{const e=document.createElement(tag);e.textContent=content;if(className)e.className=className;container.append(e);return e;};
    make('h2',`${s.name} · Sol ${s.sol}`);
    make('p',`${s.instrument} · ${s.photojournal_id}`,'fine');
    const img=document.createElement('img');img.src=s.image;img.alt=`NASA ${s.name} archived observation ${s.photojournal_id}`;container.append(img);
    make('p',s.credit,'fine');make('h3','What the source supports');make('p',s.finding);
    make('h3','Your science question');make('p',s.task);make('p',s.limit,'fine');
    make('h3','Where and when');make('p',`${s.position.latitude.toFixed(7)}° N, ${s.position.longitude.toFixed(7)}° E · approximate rover observation station.`);
    make('p',s.location_basis,'fine');make('p',s.position.registration,'fine');make('p',s.date_note,'fine');
    make('p',`PDS spacecraft event time: ${Array.isArray(s.pds_scet)?s.pds_scet.join(' / '):s.pds_scet}`,'fine');
    make('p',`Target range ${s.target_range_m} m; ${s.image_field_cm} cm per close-up field. The 4 m visit radius is an interface convention, not a location error estimate.`,'fine');
    const names={maaz_page:'NASA Máaz image and interpretation',yeehgo_page:'NASA Yeehgo image and context',maaz_image:'Original NASA image',yeehgo_image:'Original NASA context image',observations:'PDS SuperCam observation log',places:'PDS rover localization table',places_sis:'PDS coordinate and localization specification'};
    for(const id of s.source_ids){const a=make('a',(names[id]||id)+' ↗','evidence-link');a.href=pack.sources[id].url;a.target='_blank';a.rel='noopener';}
    const a=make('a','Inspect exact rows, joins and SHA-256 hashes ↗','evidence-link');a.href='data/science_v006/science.json';a.target='_blank';a.rel='noopener';
    api.pause({immediate:true});api.clearInput();reviewed.add(s.id);$('observation-dialog').showModal();
  }
  // One next action derived from the same mission/controller state as the UI.
  // This is guidance, never a second mission controller or a synthetic visit.
  function guidance() {
    const s=stop(), count=Object.keys(model.records).length;
    const hint=(key,phase,title,detail,element,label,action,disabled=false)=>({key,phase,title,detail,element,label,action,disabled});
    if(!inField())return hint('field',0,'Load the science field','These observations belong to the landing field. Loading it retains your notebook.','#mission-load','Load the landing field',()=>$('mission-load').click());
    if(!model.started)return hint('begin',1,'Mark your starting point','Choose Begin excursion here. This marks the place you will return to.','#mission-begin','Begin excursion here',()=>$('mission-begin').click());
    if(model.completed_utc)return hint('export',0,'Save your mission brief','Both science stops and the return are complete. Export the notebook, route and sources before leaving this page.','#mission-export','Export mission brief',()=>$('mission-export').click());
    if(api.following())return hint('driving',3,'Watch the scout travel','The rover is following the checked route. Wait for it to stop, or choose Pause scout. Space also brakes.','#mission-drive','Pause scout',()=>$('mission-drive').click());
    if(api.planning())return hint('planning',2,'Checking the route','Finding a route within the selected slope limit. The scout stays stopped until you send it.','#mission-plan','Checking route…',()=>{},true);
    if(target==='return'&&currentRoute?.status==='ready'&&!model.returned)return hint('return-drive',0,'Drive back to your start','The return route is ready. Send the scout, then export your brief when it arrives.','#mission-drive','Scout this route',()=>$('mission-drive').click());
    if(count===pack.stops.length)return hint('return-plan',0,'Plan the way home','Both observations are recorded. Plan the return route before sending the rover back.','#mission-return','Plan return to start',()=>$('mission-return').click());
    const next=pack.stops.find(p=>!model.records[p.id]);
    if(model.records[s.id]&&next)return hint('next-stop',0,'Continue to the next stop',`${s.name} is recorded. Select ${next.name}, then plan a fresh route.`,`[data-science-stop="${next.id}"]`,`Select ${next.name}`,()=>document.querySelector(`[data-science-stop="${next.id}"]`).click());
    if(atStation(api.pose(),goal(s.id))) {
      if(!reviewed.has(s.id))return hint('evidence',4,`Look at ${s.name}`,'You have arrived. Open the archived NASA observation, inspect the image, then close it to write your note.','#mission-evidence','Open NASA observation',()=>$('mission-evidence').click());
      return hint('note',5,'Record what you notice','Write a visible feature or a science question, then choose Record observation. The rover must remain stopped nearby.','#mission-notebook','Write your observation',()=>{$('mission-note').scrollIntoView({block:'center'});$('mission-note').focus();});
    }
    if(currentRoute&&target&&currentRoute.status!=='ready'&&currentRoute.status!=='nearby')return hint('blocked',2,'Review the route limit',`The route is unavailable: ${currentRoute.message||'no permitted path'}. Review the assumptions or choose another stop. A higher limit is not a safety guarantee.`,'#mission-assumptions','Review assumptions',()=>{$('mission-assumptions').open=true;$('mission-grade').focus();});
    if(currentRoute?.status==='ready'&&routeOwner===s.id)return hint('drive',3,'Send the scout',`The route to ${s.name} is ready. Check the elevation profile below, then choose Scout this route.`,'#mission-drive','Scout this route',()=>$('mission-drive').click());
    return hint('plan',2,`Plan the route to ${s.name}`,'Choose Plan this stop. It checks the measured terrain and shows the route before the rover moves.','#mission-plan','Plan this stop',()=>$('mission-plan').click());
  }
  function download() {
    const data={...structuredClone(model),exported_utc:now(),app:'Terrain.Surf v011',
      purpose:pack.objective,epoch:pack.epoch,missions:pack.missions,
      current_scout:{site:api.site(),...api.pose()},
      assumptions:{slope_limit_degrees:api.limit(),travel_speed_mps:Number($('mission-speed').value),
        dwell_minutes_per_stop:Number($('mission-dwell').value),observation_radius_m:4,
        duration_kind:'Horizontal ground-distance travel estimate plus entered dwell; not validated EVA duration',
        model:'Kinematic scout; no wheel slip, soil resistance, energy or crew consumables'},
      data:{terrain:api.meta(),science_pack:pack,science_pack_sha256:api.packHash},
      environmental_reference:api.conditions(),regional_weather_reference:api.regional(),
      limitations:[...pack.limits,'v009 route metrics use horizontal local ground metres; historical projected-distance descriptions in the original science pack are superseded.'],requirements:pack.requirements};
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download='terrain-surf-marswalk-brief.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function showPrerequisite(button,label,id) {
    button.hidden=!id;button.textContent=label;
    button.onclick=()=>{
      const control=$(id);
      if(control.closest('details'))control.closest('details').open=true;
      control.scrollIntoView({block:'center',behavior:'instant'});control.focus({preventScroll:true});
    };
  }
  function update() {
    const supported=inField(),s=stop(),p=api.pose(),near=supported&&atStation(p,goal(s.id));
    const count=Object.keys(model.records).length;
    if(model.started&&supported&&target&&atStation(p,goal(target))&&lastArrival!==target) {
      lastArrival=target;event('station_reached',{target,pose:p,radius_m:4});
      if(target==='return'){model.returned=true;if(count===pack.stops.length)model.completed_utc=now();}
    }
    $('mission-coverage').hidden=supported;
    $('mission-begin').hidden=model.started;$('mission-begin').disabled=!supported;
    $('mission-load').hidden=supported;
    $('mission-plan').disabled=!model.started||!supported;
    $('mission-drive').disabled=!supported||!model.started||currentRoute?.status!=='ready'||routeOwner!==target;
    $('mission-return').disabled=!supported||!model.started;
    $('mission-replan').disabled=!supported||!model.started;
    $('mission-record').disabled=!supported||!model.started||!near||!$('mission-note').value.trim();
    $('mission-export').disabled=!model.started;
    $('mission-profile').hidden=currentRoute?.status!=='ready';
    text('mission-leg-stats',currentRoute?.status==='ready'?`${currentRoute.length.toFixed(1)} ground m planned (${currentRoute.directDistance.toFixed(1)} m straight) · peak slope ${currentRoute.maxSlope.toFixed(1)}° · +${currentRoute.ascent.toFixed(1)} / −${currentRoute.descent.toFixed(1)} m. Small obstacles and traction are unresolved.`:'');
    text('mission-count',`${count} / ${pack.stops.length} observations recorded`);
    const r=model.scout_report;
    text('mission-scout-report',model.started?`Scout report · ${r.distance_ground_m.toFixed(1)} ground m traveled · +${r.ascent_m.toFixed(1)} / −${r.descent_m.toFixed(1)} m · highest sampled slope ${r.max_sampled_slope_degrees.toFixed(1)}°. Virtual motion on measured terrain; no slip or energy estimate.`:'');
    text('mission-selected',`${s.number.toString().padStart(2,'0')} / ${s.name}`);
    text('mission-drive',api.following()?'Pause scout':'Scout this route');
    text('mission-record',model.records[s.id]?'Update observation':'Record observation');
    for(const b of document.querySelectorAll('[data-science-stop]')){
      b.setAttribute('aria-pressed',b.dataset.scienceStop===s.id);
      b.querySelector('small').textContent=model.records[b.dataset.scienceStop]?'Recorded':'Observation station';
    }
    let status='Declare your current position as the excursion start.';
    if(!supported)status='This field has no qualified science stops. Return to the landing field to continue; your notes are retained.';
    else if(model.completed_utc)status='Excursion complete. Both observations recorded and scout back at the start.';
    else if(model.returned)status='Back at the start. Some science observations are still unrecorded.';
    else if(api.following()&&target)status=`Scouting toward ${target==='return'?'the start':pack.stops.find(t=>t.id===target).name}. Space pauses.`;
    else if(model.started&&near)status=`At ${s.name} observation area. Open the NASA image, then write and record your observation.`;
    else if(model.started&&currentRoute?.status==='ready')status='Route checked against measured slopes. Review the profile, then send the scout.';
    else if(model.started&&currentRoute&&currentRoute.status!=='ready'&&currentRoute.status!=='nearby')status=`Route unavailable: ${currentRoute.message}`;
    else if(model.started)status='Choose a science stop and plan the leg. Manual driving remains available.';
    text('mission-status',status);
    const g=guidance();
    text('mission-next-step',g.phase?`NEXT STEP · ${g.phase} / 5`:'NEXT STEP');
    text('mission-next-title',g.title);text('mission-next-detail',g.detail);text('mission-next-action',g.label);
    $('mission-next').dataset.step=g.key;$('mission-next-action').disabled=g.disabled;
    let routeReason='',routeRequired=null,routeLink='';
    if(!supported){routeReason='Load the landing field before planning or scouting these science stops.';routeRequired='mission-load';routeLink='Go to Load the landing field →';}
    else if(!model.started){routeReason='First, mark your starting point with Begin excursion here. Selecting a stop does not start the excursion.';routeRequired='mission-begin';routeLink='Go to Begin excursion here →';}
    else if(api.planning())routeReason='Checking the route. Wait for the result before sending the scout.';
    else if(api.following())routeReason='The scout is traveling. Pause scout stops it; wait for arrival before recording.';
    else if(near&&target!=='return'){routeReason='You are already stopped at this station. No driving is needed; inspect its NASA observation and record a note.';routeRequired='mission-evidence';routeLink='Go to NASA observation →';}
    else if(currentRoute?.status==='ready'&&routeOwner===target)routeReason=`Route ready for ${target==='return'?'the return to start':pack.stops.find(t=>t.id===target)?.name||s.name}. Scout this route sends the rover.`;
    else if(currentRoute&&currentRoute.status!=='nearby'){routeReason=`No route is ready: ${currentRoute.message||'review the selected slope limit'}.`;routeRequired='mission-grade';routeLink='Review route assumptions →';}
    else {routeReason=`Plan this stop before scouting to ${s.name}. Choosing a different stop requires a new route.`;routeRequired='mission-plan';routeLink='Go to Plan this stop →';}
    text('mission-route-reason',routeReason);showPrerequisite($('mission-route-prerequisite'),routeLink,routeRequired);
    $('mission-plan').title=$('mission-plan').disabled?routeReason:'Check a route to the selected science stop';
    $('mission-drive').title=$('mission-drive').disabled?routeReason:api.following()?'Pause this scout trip':'Start the checked route';
    let recordReason='',recordRequired=null,recordLink='';
    if(!supported){recordReason='Load the landing field before recording at these stations. Your draft stays here.';recordRequired='mission-load';recordLink='Go to Load the landing field →';}
    else if(!model.started){recordReason='Begin the excursion before recording. You can write a draft now.';recordRequired='mission-begin';recordLink='Go to Begin excursion here →';}
    else if(!near){
      recordReason=`Arrive and stop within 4 m of ${s.name} before recording. ${Math.hypot(p.x-goal(s.id).x,p.z-goal(s.id).z).toFixed(1)} ground m away; drafts are kept.`;
      if(!api.following()&&!api.planning()){
        recordRequired=currentRoute?.status==='ready'&&routeOwner===s.id?'mission-drive':'mission-plan';
        recordLink=recordRequired==='mission-drive'?'Go to Scout this route →':'Go to Plan this stop →';
      }
    }else if(!$('mission-note').value.trim()){recordReason='You are stopped at the station. Write a note before choosing Record observation.';recordRequired='mission-note';recordLink='Write a note →';}
    else recordReason='Ready to record: a note is entered and the scout is stopped within the observation area.';
    text('mission-near',recordReason);$('mission-record').title=recordReason;
    showPrerequisite($('mission-record-prerequisite'),recordLink,recordRequired);
    text('mission-footer-help',!model.started?'Begin excursion here first. It defines the return point and creates the mission brief.':!supported?'Load the landing field to plan a return. You can still export your existing brief.':'Return uses your declared start. Export saves the notes recorded so far, including an unfinished excursion.');
    if(model.brief){
      const b=model.brief, speed=Number($('mission-speed').value), dwell=Number($('mission-dwell').value);
      text('mission-summary',b.status==='ready'?`${b.length.toFixed(1)} ground m round trip · +${b.ascent.toFixed(1)} / −${b.descent.toFixed(1)} m · peak ${b.maxSlope.toFixed(1)}° · ${(b.length/speed/60+dwell*pack.stops.length).toFixed(1)} min assumed`:'At least one excursion leg is blocked by the current terrain limit. Review the route before scouting.');
    }
  }
  $('mission-title').textContent=pack.title;$('mission-objective').textContent=pack.objective;
  for(const s of pack.stops){const b=document.createElement('button');b.dataset.scienceStop=s.id;
    const title=document.createElement('span');title.textContent=`${s.number.toString().padStart(2,'0')} · ${s.name}`;
    const small=document.createElement('small');b.append(title,small);b.onclick=()=>select(s.id);$('mission-stops').append(b);}
  $('mission-open').onclick=()=>show(!visible);$('mission-close').onclick=()=>show(false);
  $('mission-next-action').onclick=()=>guidance().action();
  $('mission-begin').onclick=begin;$('mission-plan').onclick=()=>planTarget(model.selected);
  $('mission-drive').onclick=()=>{if(api.following())api.pause();else api.drive();update();};
  $('mission-return').onclick=()=>planTarget('return');$('mission-evidence').onclick=evidence;
  $('mission-record').onclick=record;$('mission-export').onclick=download;$('mission-replan').onclick=planBrief;
  $('mission-note').oninput=()=>{model.drafts[model.selected]=$('mission-note').value;update();};
  $('mission-speed').onchange=update;$('mission-dwell').onchange=update;
  $('mission-grade').onchange=()=>{api.setLimit(Number($('mission-grade').value));planBrief();if(target)planTarget(target);};
  $('mission-load').onclick=()=>api.load(pack.site_id).catch(e=>api.toast(`Field could not load: ${e.message}`));
  select(model.selected);
  return {update,show,routeChanged,routePlanned,navigationStopped,guidance,
    trackMotion(travel,dt){
      if(!model.started||!inField()||!travel||model.completed_utc)return;
      const p=api.pose(),h=api.field().absoluteHeight(p.x,p.z),r=model.scout_report;
      r.distance_ground_m+=Math.abs(travel);r.moving_simulation_seconds+=dt;
      if(previousElevation!==null){r.ascent_m+=Math.max(0,h-previousElevation);r.descent_m+=Math.max(0,previousElevation-h);}
      r.max_sampled_slope_degrees=Math.max(r.max_sampled_slope_degrees,api.slope(p.x,p.z));previousElevation=h;
    },
    resetMotionSample(){previousElevation=null;},
    fieldChanged(){target=null;currentRoute=null;routeOwner=null;lastArrival=null;previousElevation=null;event('field_changed',{site:api.site()});update();},
    visible:()=>visible, selected:()=>model.selected, select,
    environmentalPlan:()=>({brief:model.brief,supported:model.started&&inField(),speed:Number($('mission-speed').value),dwellMinutes:Number($('mission-dwell').value)}),
    markers:()=>inField()&&(visible||model.started)?[...pack.stops.map(s=>({id:s.id,label:String(s.number),...worldFromGeo(api.meta(),s.position),selected:s.id===model.selected})),
      ...(model.home?[{id:'return',label:'S',...worldFromGeo(api.meta(),model.home),selected:target==='return'}]:[])]:[],
    read:()=>({...structuredClone(model),visible,supported:inField(),target,route_owner:routeOwner,near_selected:inField()&&atStation(api.pose(),goal(model.selected)),
      current_route:currentRoute?structuredClone(currentRoute):null,markers:inField()?pack.stops.map(s=>({id:s.id,...goal(s.id)})):[]})};
}
