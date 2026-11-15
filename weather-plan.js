// Historical station context beside a hypothetical excursion; never route weather.
export const SOL_SECONDS=88775.244;
export const TIME_SOURCE='https://www.giss.nasa.gov/tools/mars24/help/notes.html';
export const elapsedToLMSTMinutes=seconds=>seconds*1440/SOL_SECONDS;
export function lmstLabel(minute,sol=16) {
  const total=Math.round(minute*60),day=Math.floor(total/86400),time=((total%86400)+86400)%86400;
  const part=n=>String(n).padStart(2,'0');
  return `sol ${sol+day} ${part(Math.floor(time/3600))}:${part(Math.floor(time%3600/60))}:${part(time%60)} LMST`;
}
export function stationRecordAt(pack,minute) {
  const slots=pack.slots;
  if(minute<slots[0].minute||minute>slots.at(-1).minute)return {status:'outside',sample:null,selected_index:null,offset_lmst_minutes:null};
  // The nearest retained 15-minute slot is context only. A missing slot stays missing.
  let index=0;for(let i=1;i<slots.length;i++)if(Math.abs(slots[i].minute-minute)<Math.abs(slots[index].minute-minute))index=i;
  const sample=slots[index];
  const offset=sample.lmst?sample.minute+(sample.offset_from_requested_lmst_seconds||0)/60-minute:null;
  return {status:sample.status,sample,selected_index:index,offset_lmst_minutes:offset};
}
export function excursionWeather(pack,brief,{departureMinute,speed,dwellMinutes,supported=true}) {
  const basis={departure_minute_lmst:departureMinute,departure:lmstLabel(departureMinute,pack.sol),
    speed_mps:speed,dwell_minutes_per_stop:dwellMinutes,mean_sol_earth_seconds:SOL_SECONDS,time_source:TIME_SOURCE,
    meaning:'Hypothetical excursion timing with nearby historical records at one MEDA station; not weather measured or predicted at each stop',
    sample_policy:'Nearest retained 15-minute slot inside the qualified interval; gaps retained, no interpolation. Exact source time and offset are reported.'};
  if(!supported||!brief)return {...basis,status:'prerequisite',events:[]};
  if(brief.status!=='ready')return {...basis,status:'blocked',events:[]};
  let elapsed=0;const events=[];
  const add=(name,kind,position)=>{
    const minute=departureMinute+elapsedToLMSTMinutes(elapsed);
    events.push({name,kind,position,elapsed_earth_seconds:elapsed,minute_lmst:minute,
      time:lmstLabel(minute,pack.sol),station_reference:stationRecordAt(pack,minute)});
  };
  add('Departure','departure',null);
  for(const leg of brief.legs){
    elapsed+=leg.length/speed;add(leg.stop==='return'?'Return to start':`Arrive ${leg.name}`,leg.stop==='return'?'return':'arrival',leg.goal);
    if(leg.stop!=='return'){elapsed+=dwellMinutes*60;add(`Leave ${leg.name}`,'leave',leg.goal);}
  }
  const end=departureMinute+elapsedToLMSTMinutes(elapsed);
  const slots=pack.slots.filter(s=>s.minute>=departureMinute&&s.minute<=end);
  const observed=slots.filter(s=>s.status==='observed');
  const values=key=>observed.map(s=>s[key]).filter(Number.isFinite);
  const range=key=>{const v=values(key);return v.length?{min:Math.min(...v),max:Math.max(...v)}:null;};
  return {...basis,status:'ready',duration_earth_seconds:elapsed,return_minute_lmst:end,return_time:lmstLabel(end,pack.sol),events,
    window:{selected_indices:slots.map(s=>pack.slots.indexOf(s)),observed:observed.length,gaps:slots.length-observed.length,
      beyond_qualified_interval:end>pack.slots.at(-1).minute,pressure_pa:range('pressure_pa'),ats1_kelvin:range('ats1_kelvin'),
      meaning:'Retained station samples whose requested times fall in this excursion window; not continuous coverage or a spatial route range'}};
}
