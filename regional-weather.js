// Original observation-based MCS bins: no interpolation, forecast or dose model.
const DAY=86400000,MJD_EPOCH=Date.UTC(1858,10,17),RAD=Math.PI/180;
export function regionalCell(pack,position){
  const g=pack.grid,lat=position?.latitude;
  if(!Number.isFinite(lat)||Math.abs(lat)>90||!Number.isFinite(position?.longitude))return null;
  const lon=((position.longitude-g.west)%360+360)%360+g.west;
  const col=Math.floor((lon-g.west)/g.longitude_step_degrees);
  const row=Math.min(g.rows-1,Math.floor((g.north-lat)/g.latitude_step_degrees));
  if(col<0||col>=g.columns||row<0||row>=g.rows)return null;
  return row*g.columns+col;
}
export function regionalBounds(pack,index){
  const g=pack.grid,row=Math.floor(index/g.columns),col=index%g.columns;
  return {west:g.west+col*g.longitude_step_degrees,east:g.west+(col+1)*g.longitude_step_degrees,
    north:g.north-row*g.latitude_step_degrees,south:g.north-(row+1)*g.latitude_step_degrees};
}
export function regionalSample(pack,frameIndex,cellIndex){
  const f=pack.frames[frameIndex],c=f?.cells[cellIndex];
  if(!f||!c||cellIndex===null)return {status:'outside',value:null};
  return {...c,status:c.value===null?'gap':'gridded',cell_index:cellIndex,bounds:regionalBounds(pack,cellIndex),
    representative_utc:f.representative_utc,
    effective_utc:c.mjd_anomaly===null?null:new Date(MJD_EPOCH+(f.representative_mjd+c.mjd_anomaly)*DAY).toISOString()};
}
export function regionalChange(pack,index,cell){
  const a=regionalSample(pack,index-1,cell),b=regionalSample(pack,index,cell);
  return {status:a.value!==null&&b.value!==null?'available':'gap',
    delta:a.value!==null&&b.value!==null?b.value-a.value:null,
    previous_utc:index>0?pack.frames[index-1].representative_utc:null,
    meaning:'Difference from previous dated map, not a forecast or significance test; observation windows can overlap.'};
}
export function terrainBounds(source){
  const d=180/Math.PI/source.mars_radius_m,[w,s,e,n]=source.projected_bounds_m;
  return {west:w*d,east:e*d,south:s*d,north:n*d};
}
export function regionalCoverage(pack,bounds){
  const cells=[];
  for(let i=0;i<pack.grid.rows*pack.grid.columns;i++){
    const b=regionalBounds(pack,i);
    if(b.north<=bounds.south||b.south>=bounds.north)continue;
    if([-360,0,360].some(k=>b.east+k>bounds.west&&b.west+k<bounds.east))cells.push(i);
  }
  return cells;
}
export function dustColour(value){
  if(value===null)return '#35483f';
  const t=Math.min(1,Math.max(0,value/.3)),a=[116,171,161],b=[233,171,93];
  return `rgb(${a.map((v,i)=>Math.round(v+(b[i]-v)*t)).join(',')})`;
}

export function createRegionalWeather(pack,api){
  const $=id=>document.getElementById(id),dialog=$('regional-dialog');
  let index=pack.default_index,cell=null,playing=null,wide=false,overlay=false,key='';
  const maps=api.maps.map(s=>({...s,bounds:terrainBounds(s.meta),cells:regionalCoverage(pack,terrainBounds(s.meta))}));
  const active=()=>maps.find(s=>s.id===api.context().site);
  const scout=()=>{const c=api.context();return c.field.coordinates(c.pose.x,c.pose.z);};
  const home=()=>regionalCell(pack,scout());cell=home();
  const frame=()=>pack.frames[index];
  const date=s=>s?`${s.slice(0,10)} ${s.slice(11,16)} UTC`:'Unavailable';
  const num=v=>v===null?'Unavailable':v.toFixed(3);
  const text=(id,value)=>{if($(id).textContent!==value)$(id).textContent=value;};
  const mapRows=()=>maps.map(s=>{const available=s.cells.filter(i=>regionalSample(pack,index,i).value!==null).length;
    return {id:s.id,name:s.name,manifest:s.manifest,bounds:s.bounds,cell_indices:s.cells,
      observed_bins:available,total_bins:s.cells.length,status:available===0?'gap':available===s.cells.length?'covered':'partial'};});
  function routeContext(){
    const c=api.context(),plan=api.plan(),positions=[];
    if(c.route?.status==='ready')positions.push(...c.route.samples);
    if(plan.supported)for(const leg of plan.brief?.legs||[])positions.push(...leg.samples||[],...(leg.goal?[leg.goal]:[]));
    const cells=[...new Set(positions.map(p=>regionalCell(pack,c.field.coordinates(p.x,p.z))))];
    return {status:cells.length?'planned':'no_route',cells,samples:cells.map(i=>regionalSample(pack,index,i)),
      meaning:'Historical regional context for the selected date over the entire map; route samples do not create finer weather resolution or an exposure dose.'};
  }
  function read(){const {cells:unused,...selectedFrame}=frame();return {kind:pack.kind,pack_id:pack.id,pack_sha256:api.hash,selected_index:index,
    selected_frame:selectedFrame,selected_cell:regionalSample(pack,index,cell),
    scout_cell:regionalSample(pack,index,home()),past_change:regionalChange(pack,index,cell),
    map_coverage:mapRows(),route_context:routeContext(),overlay,playing:playing!==null,view:wide?'global':'regional',
    source:pack.source,variable:pack.variable,license:pack.license,limitations:pack.limitations,
    prediction:{status:'not_provided',reason:'Historical multi-sol averages do not establish a validated forecast.'}};}
  const view=()=>wide?{west:-183,east:177,north:90,south:-90}:pack.grid.default_view;
  const point=(p,v,w,h)=>({x:42+(p.longitude-v.west)/(v.east-v.west)*(w-56),y:16+(v.north-p.latitude)/(v.north-v.south)*(h-46)});
  function draw(){
    const canvas=$('regional-map'),ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height,v=view();
    ctx.clearRect(0,0,w,h);ctx.fillStyle='#14241c';ctx.fillRect(0,0,w,h);
    ctx.save();ctx.beginPath();ctx.rect(42,16,w-56,h-46);ctx.clip();
    for(let i=0;i<frame().cells.length;i++){
      const b=regionalBounds(pack,i);if(b.east<=v.west||b.west>=v.east||b.north<=v.south||b.south>=v.north)continue;
      const p=point({longitude:b.west,latitude:b.north},v,w,h),q=point({longitude:b.east,latitude:b.south},v,w,h);
      const value=frame().cells[i].value;ctx.fillStyle=dustColour(value);ctx.fillRect(p.x,p.y,q.x-p.x,q.y-p.y);
      ctx.strokeStyle='#14241c60';ctx.lineWidth=.6;ctx.strokeRect(p.x,p.y,q.x-p.x,q.y-p.y);
      if(value===null){ctx.save();ctx.beginPath();ctx.rect(p.x,p.y,q.x-p.x,q.y-p.y);ctx.clip();ctx.strokeStyle='#a1b4a479';
        for(let x=p.x-(q.y-p.y);x<q.x;x+=9){ctx.beginPath();ctx.moveTo(x,p.y);ctx.lineTo(x+q.y-p.y,q.y);ctx.stroke();}ctx.restore();}
      if(i===cell){ctx.strokeStyle='#fff';ctx.lineWidth=2.5;ctx.strokeRect(p.x+1,p.y+1,q.x-p.x-2,q.y-p.y-2);}
    }
    // Exact footprints are smaller than a pixel here. The locator is enlarged,
    // explicitly labelled, and never used as a weather coverage radius.
    for(const [i,m] of maps.entries()){
      const p=point({longitude:(m.bounds.west+m.bounds.east)/2,latitude:(m.bounds.north+m.bounds.south)/2},v,w,h);
      ctx.strokeStyle=m.id===api.context().site?'#fff':'#1d3024';ctx.lineWidth=2;ctx.strokeRect(p.x-4,p.y-4,8,8);
      if(m.id===api.context().site){ctx.fillStyle='#11271d';ctx.font='bold 13px Segoe UI';ctx.fillText(m.name,p.x+11,p.y-10);}
    }
    const p=point(scout(),v,w,h);ctx.strokeStyle='#fff';ctx.lineWidth=1.8;ctx.beginPath();ctx.arc(p.x,p.y,9,0,Math.PI*2);ctx.stroke();
    ctx.restore();ctx.font='11px Consolas';ctx.fillStyle='#d5e5d8';
    for(let i=0;i<=4;i++){
      const lon=v.west+(v.east-v.west)*i/4,lat=v.north-(v.north-v.south)*i/4;
      ctx.textAlign='center';ctx.fillText(`${Math.round(lon)}°`,42+(w-56)*i/4,h-10);
      ctx.textAlign='right';ctx.fillText(`${Math.round(lat)}°`,37,20+(h-46)*i/4);
    }
    canvas.setAttribute('aria-label',`Historical dust grid ${date(frame().representative_utc)}. Select a bin to inspect it. Hatched cells are missing.`);
  }
  function chart(){
    const canvas=$('regional-history'),ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
    const values=pack.frames.map((f,i)=>regionalSample(pack,i,cell).value),finite=values.filter(v=>v!==null);
    const lo=Math.max(0,finite.length?Math.min(...finite)*.85:0),hi=Math.max(lo+.05,finite.length?Math.max(...finite)*1.15:1);
    const t0=Date.parse(pack.frames[0].representative_utc),t1=Date.parse(pack.frames.at(-1).representative_utc);
    const p=i=>({x:40+(Date.parse(pack.frames[i].representative_utc)-t0)/(t1-t0)*(w-56),y:12+(1-(values[i]-lo)/(hi-lo))*(h-42)});
    ctx.fillStyle='#17261e';ctx.fillRect(0,0,w,h);ctx.strokeStyle='#acc8b7';ctx.lineWidth=2;ctx.beginPath();let pen=false;
    values.forEach((v,i)=>{if(v===null){pen=false;return;}const q=p(i);if(pen)ctx.lineTo(q.x,q.y);else ctx.moveTo(q.x,q.y);pen=true;});ctx.stroke();
    values.forEach((v,i)=>{if(v===null)return;const q=p(i);ctx.beginPath();ctx.arc(q.x,q.y,i===index?5:2.5,0,Math.PI*2);ctx.fillStyle=i===index?'#f5bd7d':'#c6dfcf';ctx.fill();});
    const x=p(index).x;ctx.strokeStyle='#f5bd7d88';ctx.beginPath();ctx.moveTo(x,8);ctx.lineTo(x,h-28);ctx.stroke();
    ctx.fillStyle='#c2d4c6';ctx.font='11px Consolas';ctx.fillText(hi.toFixed(2),3,17);ctx.fillText(lo.toFixed(2),3,h-28);
    ctx.fillText(pack.frames[0].representative_utc.slice(5,10),40,h-7);ctx.textAlign='right';ctx.fillText(pack.frames.at(-1).representative_utc.slice(5,10),w-10,h-7);ctx.textAlign='left';
  }
  function update(force=false){
    const c=api.context();
    $('dust-map').setAttribute('aria-pressed',String(overlay));$('dust-map-legend').hidden=!overlay;
    const s=regionalSample(pack,index,home());
    text('dust-map-reading',`${frame().representative_utc.slice(0,10)} · regional dust ${num(s.value)}${s.value===null?' · coverage gap':''}`);
    if(!dialog.open&&!force)return;
    const next=JSON.stringify([index,cell,wide,c.site,Math.round(c.pose.x),Math.round(c.pose.z),c.route?.goal,api.plan().brief?.planned_utc]);
    if(!force&&next===key)return;key=next;
    const r=read(),s1=r.selected_cell,b=s1.bounds;
    $('regional-date').value=String(index);$('regional-prev').disabled=index===0;$('regional-next').disabled=index===pack.frames.length-1;
    text('regional-play',playing===null?'Play history ▶':'Pause history');$('regional-play').setAttribute('aria-pressed',String(playing!==null));
    $('regional-wide').setAttribute('aria-pressed',String(wide));text('regional-wide',wide?'Show Jezero region':'Show whole Mars');
    text('regional-date-note',`Map ${index+1} / ${pack.frames.length} · MY36 sol ${frame().sol_of_year} · representative ${date(frame().representative_utc)}. Daily averages, with overlapping multi-sol observations.`);
    text('regional-value',s1.value===null?'Unavailable':num(s1.value));
    text('regional-cell',b?`Selected bin: ${b.south}–${b.north}° latitude, ${b.west}–${b.east}° east longitude`:'Outside source grid');
    text('regional-cell-detail',s1.value===null?'No dust estimate in this cell/date. The map hatch and history gaps remain missing.':
      `Source uncertainty ±${num(s1.uncertainty)} · effective ${date(s1.effective_utc)} · window ${s1.window_sols.toFixed(1)} sols · mean contributing observations ${s1.observation_count.toFixed(1)} · source reliability ${s1.reliability.toFixed(2)}.`);
    const change=r.past_change;
    text('regional-change',change.delta===null?'Change unavailable: this or the previous dated cell is missing.':
      `Change from ${date(change.previous_utc)}: ${change.delta>=0?'+':''}${change.delta.toFixed(3)}. Overlapping observations; not a forecast or significance test.`);
    const rows=$('regional-fields');rows.replaceChildren();
    for(const [i,m] of r.map_coverage.entries()){
      const row=document.createElement('li'),a=document.createElement('b'),t=document.createElement('span');
      a.textContent=`${i+1}. ${m.name}${m.id===c.site?' · active':''}`;
      t.textContent=`${m.status==='covered'?'Full map assigned to source bins':m.status==='gap'?'Weather missing on this date':'Partial weather coverage'} · ${m.observed_bins}/${m.total_bins} bins have estimates. ${m.bounds.south.toFixed(5)}–${m.bounds.north.toFixed(5)}° N, ${m.bounds.west.toFixed(5)}–${m.bounds.east.toFixed(5)}° E.`;
      row.append(a,t);rows.append(row);
    }
    text('regional-route',r.route_context.status==='no_route'?'No route planned. Weather coverage already applies to both full terrain maps; plan a route only to inspect its regional bins.':
      `${r.route_context.cells.length} source bin(s) intersect your planned route/excursion. ${r.route_context.cells.length===1?'Every point shares one regional dust estimate at this scale.':'Each bin retains its own estimate or gap.'} No dose or surface visibility is calculated.`);
    text('regional-scale','Source bins are 6° longitude × 5° latitude (about 337 × 296 km here). Each loaded field is about 486 × 512 m. Map locators are enlarged for visibility, not weather coverage circles.');
    draw();chart();
  }
  function stop(){if(playing!==null)clearInterval(playing);playing=null;}
  function select(value){index=Math.max(0,Math.min(pack.frames.length-1,value));update(true);api.redraw();}
  function show(tour=false){api.pause();api.clearInput();if(!dialog.open)tour?dialog.show():dialog.showModal();update(true);}
  for(const [i,f] of pack.frames.entries()){const o=document.createElement('option');o.value=i;o.textContent=`${f.representative_utc.slice(0,10)} · MY36 sol ${f.sol_of_year}`;$('regional-date').append(o);}
  $('regional-date').onchange=e=>{stop();select(Number(e.target.value));};
  $('regional-prev').onclick=()=>{stop();select(index-1);};$('regional-next').onclick=()=>{stop();select(index+1);};
  $('regional-play').onclick=()=>{
    if(playing!==null){stop();update(true);return;}if(index===pack.frames.length-1)index=0;
    playing=setInterval(()=>{if(!dialog.open||index===pack.frames.length-1){stop();update();return;}select(index+1);},900);update(true);
  };
  $('regional-wide').onclick=()=>{wide=!wide;update(true);};$('regional-home').onclick=()=>{cell=home();update(true);};
  $('regional-map').onclick=e=>{
    const canvas=e.currentTarget,b=canvas.getBoundingClientRect(),x=(e.clientX-b.left)/b.width*canvas.width,y=(e.clientY-b.top)/b.height*canvas.height;
    if(x<42||x>=canvas.width-14||y<16||y>=canvas.height-30)return;
    const v=view();cell=regionalCell(pack,{longitude:v.west+(x-42)/(canvas.width-56)*(v.east-v.west),latitude:v.north-(y-16)/(canvas.height-46)*(v.north-v.south)});update(true);
  };
  $('regional-bin').onchange=e=>{cell=Number(e.target.value);update(true);};
  // A keyboard alternative to canvas hit testing covers every actual source bin.
  for(let i=0;i<pack.frames[0].cells.length;i++){const b=regionalBounds(pack,i),o=document.createElement('option');o.value=i;o.textContent=`${b.south}–${b.north}° lat · ${b.west}–${b.east}° lon`;$('regional-bin').append(o);}
  $('regional-home').addEventListener('click',()=>$('regional-bin').value=String(cell));
  $('regional-map').addEventListener('click',()=>$('regional-bin').value=String(cell));
  $('regional-open').onclick=()=>show();
  $('conditions-regional').onclick=()=>{$('conditions-dialog').close();show();};
  $('regional-plan').onclick=()=>{dialog.close();api.openMission();};
  $('dust-map').onclick=()=>{overlay=!overlay;update();api.redraw();};
  dialog.addEventListener('close',()=>{stop();update();});
  // Native close events are queued; stop synchronously on the initiating input.
  dialog.querySelector('[data-close]').addEventListener('click',stop);
  dialog.addEventListener('cancel',stop);
  for(const [id,key] of [['regional-source','documentation_url'],['regional-method','paper_url'],['regional-nasa','nasa_instrument_url']])$(id).href=pack.source[key];
  text('regional-credit',pack.license.credit);$('regional-bin').value=String(cell);update();
  return {read,update,showForTour:open=>{if(open)show(true);else if(dialog.open)dialog.close();},
    paintMini(ctx,{meta,center,extent,size}){
      if(!overlay)return;
      const pos=p=>({x:((p.x-center.x)/extent+.5)*size,y:((p.z-center.z)/extent+.5)*size});
      const a=pos({x:-meta.width_m/2,z:-meta.depth_m/2}),b=pos({x:meta.width_m/2,z:meta.depth_m/2});
      ctx.save();ctx.beginPath();ctx.rect(a.x,a.y,b.x-a.x,b.y-a.y);ctx.clip();
      for(const i of active()?.cells||[]){const s=regionalSample(pack,index,i),bounds=s.bounds;
        const p=pos(api.world(meta,{longitude:bounds.west,latitude:bounds.north})),q=pos(api.world(meta,{longitude:bounds.east,latitude:bounds.south}));
        ctx.fillStyle=dustColour(s.value);ctx.globalAlpha=.35;ctx.fillRect(p.x,p.y,q.x-p.x,q.y-p.y);
        if(s.value===null){ctx.globalAlpha=.75;ctx.strokeStyle='#cbd7cb';ctx.lineWidth=1;for(let x=-size;x<size;x+=22){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x+size,size);ctx.stroke();}}
      }ctx.restore();
    }};
}
