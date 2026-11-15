import {worldFromCoordinates} from './terrain.js';
import {excursionWeather,lmstLabel} from './weather-plan.js';

export function separationMetres(a,b,radius=3396190) {
  const rad=Math.PI/180,lat1=a.latitude*rad,lat2=b.latitude*rad;
  const h=Math.sin((lat2-lat1)/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin((b.longitude-a.longitude)*rad/2)**2;
  return 2*radius*Math.asin(Math.sqrt(Math.min(1,Math.max(0,h))));
}

export function conditionsEvidence(pack,index,{meta,field,pose,route,stop,hash}) {
  const sample=pack.slots[index],station=pack.location.position;
  const distances=route?.status==='ready'?route.samples.map(p=>separationMetres(field.coordinates(p.x,p.z),station,meta.mars_radius_m)):[];
  const scienceClock=Number(stop?.observations?.[0]?.sclk);
  return {kind:'Historical point reference; not local current conditions or route weather prediction',
    pack_id:pack.id,pack_sha256:hash,selected_index:index,sol:pack.sol,date_label:pack.date_label,
    source_utc_coverage:pack.source_utc_coverage,selected_interval_lmst:pack.selected_interval_lmst,
    time_basis:pack.time_basis,sample:structuredClone(sample),
    temperature_celsius:sample.ats1_kelvin===null?null:sample.ats1_kelvin-273.15,
    virtual_scout_separation_m:separationMetres(field.coordinates(pose.x,pose.z),station,meta.mars_radius_m),
    route_separation_m:distances.length?{min:Math.min(...distances),max:Math.max(...distances),
      meaning:'Distance of planned route samples from the historical reference station; not a coverage or accuracy radius'}:null,
    science_time_separation:sample.sclk!==null&&Number.isFinite(scienceClock)?{
      stop_id:stop.id,science_sclk:scienceClock,weather_sclk:sample.sclk,
      weather_minus_science_sclk_seconds:sample.sclk-scienceClock,
      meaning:'Recorded spacecraft-clock separation; unrelated to current browser time or simulated route ETA'}:null,
    location:pack.location,quality:pack.quality,variables:pack.variables,sources:pack.sources,limitations:pack.limitations};
}

export function createConditionsUI(pack,api) {
  const $=id=>document.getElementById(id),dialog=$('conditions-dialog');
  let index=pack.slots.findIndex(s=>s.minute===720&&s.status==='observed');if(index<0)index=pack.slots.findIndex(s=>s.status==='observed');
  let alternate=pack.slots.findIndex(s=>s.minute===600),weatherVisible=false,planKey='';
  const comparison=()=>{
    const p=api.plan();
    return {primary:excursionWeather(pack,p.brief,{...p,departureMinute:pack.slots[index].minute}),
      alternate:excursionWeather(pack,p.brief,{...p,departureMinute:pack.slots[alternate].minute})};
  };
  const read=()=>({...conditionsEvidence(pack,index,api.context()),excursion_comparison:comparison(),
    map_overlay:{visible:weatherVisible,type:'Historical station observations; surrounding area unmeasured',coverage_radius_m:null}});
  const readings=s=>!s?'Outside qualified interval':s.status==='gap'?'Gap — no observation':
    `${s.ats1_kelvin===null?'Temperature unavailable':`${(s.ats1_kelvin-273.15).toFixed(1)} °C`} · ${s.pressure_pa===null?'pressure unavailable':`${s.pressure_pa.toFixed(2)} Pa`}`;
  function updateMap(){
    const s=pack.slots[index];$('weather-map').setAttribute('aria-pressed',weatherVisible);
    $('weather-map-legend').hidden=!weatherVisible;
    $('weather-map-reading').textContent=`${lmstLabel(s.minute,pack.sol)} · W: ${readings(s)}`;
  }
  function updateComparison(){
    const context=api.plan(),key=JSON.stringify([index,alternate,context.brief?.planned_utc,context.supported,context.speed,context.dwellMinutes]);
    if(key===planKey)return;planKey=key;
    const c=comparison(),ready=c.primary.status==='ready';
    $('conditions-compare').value=alternate;$('conditions-timeline-wrap').hidden=!ready;
    $('conditions-plan-link').hidden=ready;
    $('conditions-plan-hint').textContent=ready?'The same assumed excursion, compared at two historical departures. Times below are estimates; readings stay at the W station.':
      c.primary.status==='blocked'?'An excursion leg is blocked. Open Marswalk assumptions and revise the plan before comparing departures.':'First choose Plan a Marswalk → Begin excursion here in the landing field. Its two-stop and return plan supplies the travel distances.';
    const summary=p=>{
      const w=p.window,range=(r,offset=0)=>r?`${(r.min-offset).toFixed(1)} to ${(r.max-offset).toFixed(1)}`:'unavailable';
      return `${p.departure} → ${p.return_time} · ${(p.duration_earth_seconds/60).toFixed(1)} Earth min assumed. ${w.observed} retained station readings, ${w.gaps} gaps in this time window. Mast air ${range(w.ats1_kelvin,273.15)} °C; pressure ${range(w.pressure_pa)} Pa.${w.beyond_qualified_interval?' Return extends past 13:45: later conditions unavailable.':''}`;
    };
    $('conditions-primary-summary').textContent=ready?summary(c.primary):'';
    $('conditions-alternate-summary').textContent=ready?summary(c.alternate):'';
    const body=$('conditions-timeline');body.replaceChildren();if(!ready)return;
    for(let i=0;i<c.primary.events.length;i++){
      const row=document.createElement('tr');
      for(const value of [c.primary.events[i].name,...[c.primary,c.alternate].map(p=>{
        const e=p.events[i],r=e.station_reference;
        return `${e.time}\n${readings(r.sample)}${r.sample?.lmst?`\nSource ${r.sample.lmst} · offset ${r.offset_lmst_minutes.toFixed(1)} LMST min`:''}`;
      })]){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}
      body.append(row);
    }
  }
  function update(){
    const evidence=read(),s=evidence.sample;
    $('conditions-date').textContent=`Perseverance / MEDA · sol ${pack.sol} · ${pack.date_label}`;
    $('conditions-time').value=index;$('conditions-time').max=pack.slots.length-1;
    $('conditions-time').setAttribute('aria-valuetext',`${s.requested_lmst}${s.status==='gap'?' · no observation':''}`);
    $('conditions-time-label').textContent=`${s.requested_lmst.replace('16M','')} LMST`;
    $('conditions-actual-time').textContent=s.lmst?`Record: ${s.lmst} LMST · ${s.ltst} LTST`:'No observation within 60 seconds of this selected time.';
    $('conditions-status').textContent=s.status==='gap'?'Gap — values unavailable':'Archived observation · historical reference';
    $('conditions-status').dataset.state=s.status;
    $('conditions-pressure').textContent=s.pressure_pa===null?'Unavailable':`${s.pressure_pa.toFixed(2)} Pa`;
    $('conditions-temperature').textContent=s.ats1_kelvin===null?'Unavailable':`${evidence.temperature_celsius.toFixed(2)} °C`;
    $('conditions-kelvin').textContent=s.ats1_kelvin===null?'ATS1 has no value at this time':`${s.ats1_kelvin.toFixed(2)} K · source value`;
    const p=pack.location.position;
    $('conditions-location').textContent=`Reference station: ${p.latitude.toFixed(6)}° N, ${p.longitude.toFixed(6)}° E. ${evidence.virtual_scout_separation_m.toFixed(1)} m from your virtual scout.`;
    const d=evidence.route_separation_m;
    $('conditions-route').textContent=d?`Your planned route runs ${d.min.toFixed(1)}–${d.max.toFixed(1)} m from this station. No weather differences along the route are inferred.`:'Plan a route to see its distance from this observation station. The W map marker locates the station when it is in view.';
    const t=evidence.science_time_separation;
    $('conditions-epoch').textContent=t?`Relative to ${api.context().stop.name} imagery: ${(Math.abs(t.weather_minus_science_sclk_seconds)/3600).toFixed(2)} spacecraft-clock hours ${t.weather_minus_science_sclk_seconds>=0?'later':'earlier'}. This is not a future departure forecast.`:'Time separation from the science image is unavailable in a data gap.';
    $('conditions-coverage').textContent=`00:00–13:45 LMST only, before the rover’s later drive. ${pack.counts.observed} of ${pack.slots.length} sampled times have values; ${pack.counts.gaps} are gaps. One stationary observation location, with unquantified map registration error.`;
    $('conditions-quality').textContent=pack.quality;
    updateComparison();updateMap();
  }
  function show(){api.pause();api.clearInput();update();dialog.showModal();}
  for(const id of ['conditions-open','mission-conditions','route-conditions'])$(id).onclick=show;
  $('conditions-time').oninput=e=>{index=Number(e.target.value);update();};
  $('conditions-prev').onclick=()=>{index=Math.max(0,index-1);update();};
  $('conditions-next').onclick=()=>{index=Math.min(pack.slots.length-1,index+1);update();};
  for(const [i,s] of pack.slots.entries()){
    const option=document.createElement('option');option.value=i;option.textContent=`${lmstLabel(s.minute,pack.sol)}${s.status==='gap'?' · gap':''}`;$('conditions-compare').append(option);
  }
  $('conditions-compare').onchange=e=>{alternate=Number(e.target.value);update();};
  $('conditions-plan-link').onclick=()=>{dialog.close();api.openMission();};
  $('weather-map').onclick=()=>{weatherVisible=!weatherVisible;updateMap();api.redraw();};
  $('weather-map-details').onclick=show;
  for(const [id,key] of [['conditions-pressure-source','pressure'],['conditions-temperature-source','temperature'],['conditions-location-source','geometry']])$(id).href=pack.sources[key].url;
  update();
  return {read,update:()=>{updateMap();if(dialog.open)update();},marker:()=>({...worldFromCoordinates(api.context().meta,pack.location.position),label:'W',
      overlay:weatherVisible,status:pack.slots[index].status}),
    showForTour:open=>{if(open){update();if(!dialog.open)dialog.show();}else if(dialog.open)dialog.close();}};
}
