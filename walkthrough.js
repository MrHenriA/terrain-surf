import './vendor/motion-14.14.0/dom-mini.js';

// The pointer illustrates actions. The existing UI and mission remain the only
// owners of route planning, arrival, observations and export.
export function createWalkthrough({tour,clearSpotlight,mission,world,pause,clearInput,interfaceUI,remember,onComplete}) {
  const $=id=>document.getElementById(id), query=s=>document.querySelector(s);
  const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let active=false,demo=false,paused=false,completed=false,index=0,steps=[],generation=0;
  let context=null,cursor=null,movement=null,ripple=null,restoreDrive=false,exported=false,error='';
  let pointer={x:innerWidth/2,y:innerHeight/2},actions=[],stepStart=null;
  const abort=()=>new DOMException('Walkthrough stopped','AbortError');
  const valid=token=>{if(!active||token!==generation)throw abort();};
  const current=()=>steps[index];
  const click=selector=>({selector,kind:'click'});
  const close=id=>click(`[data-close="${id}"]`);
  const confirm=(id,chapter,title,target,detail,extra={})=>({id,chapter,title,target,detail,confirm:true,...extra});
  const step=(id,chapter,title,target,detail,done,action,extra={})=>({id,chapter,title,target,detail,done,action,...extra});
  function build() {
    const state=mission.read(),pending=['maaz','yeehgo'].filter(id=>!state.records[id]);
    const result=[confirm('welcome','Start','Plan a science visit, then bring back evidence','#mission-title',
      demo?'Watch the pointer operate this example session. Your original visit stays in its other tab. Pause at any time; the rover, pointer and next action all wait.':'You will plan, check historical conditions, scout both science stops, record observations and return with a report. Your existing start, drafts and recorded observations are retained.')];
    if(!state.supported)result.push(step('load','Start','Load the science field','#mission-load',
      'These NASA observations are registered to the landing field. Load it before planning; this preserves your notebook.',()=>mission.read().supported,click('#mission-load')));
    if(!state.started)result.push(step('begin','Plan','Mark the place you will return to','#mission-begin',
      'Choose Begin excursion here. Selecting a science site alone does not create an excursion. This action also checks the two-stop round trip.',()=>mission.read().started,click('#mission-begin')));
    let weatherAdded=false;
    for(const id of pending) {
      const name=id==='maaz'?'Máaz':'Yeehgo';
      result.push(step(`select-${id}`,'Plan',`Choose ${name}`,`[data-science-stop="${id}"]`,
        id==='maaz'?'Visit a sourced rock-observation station to compare visible textures and ask a science question. The numbered marker represents an approximate observation area.':'Compare this second observation with your first. Changing the selected stop requires planning its own route.',()=>mission.read().selected===id,click(`[data-science-stop="${id}"]`)));
      result.push(step(`plan-${id}`,'Plan',`Check the route to ${name}`,'#mission-plan',
        'Plan this stop checks the measured elevation grid before anything moves. Wait for a route result; a blocked route needs revised assumptions, not a forced drive.',
        ()=>mission.read().target===id&&['ready','nearby'].includes(mission.read().current_route?.status),click('#mission-plan')));
      if(!weatherAdded){
        result.push(confirm('profile','Plan','Read the terrain before sending the scout','#mission-profile',
          'The profile shows measured elevation along this leg. Distance, climbing and peak sampled slope describe the route. The assumed slope limit is adjustable; small-rock clearance and wheel traction remain unresolved.',{fallback:'#mission-route-reason'}));
        result.push(confirm('assumptions','Plan','Check your time and slope assumptions','#mission-assumptions',
          'The round trip includes both stops and the return. Travel speed and time at each stop determine estimated timing. These are your planning assumptions, not measured astronaut limits.',
          {prepare:()=>{$('mission-assumptions').open=true;}}));
        addWeather(result);weatherAdded=true;
      }
      result.push(step(`drive-${id}`,'Scout',`Send the scout toward ${name}`,'#mission-drive',
        'Scout this route starts the actual virtual rover controller. It follows the checked route with gradual steering. Pause scout and Space brake it independently of reverse.',
        ()=>world().following||mission.read().near_selected,click('#mission-drive'),{skipAction:()=>mission.read().near_selected}));
      result.push(step(`arrive-${id}`,'Scout',`Follow the trip to ${name}`,'#mission-status',
        'Watch the rover and its live distance, attitude and elevation. Continue unlocks only when it is stopped within the observation area. The motion is terrain-following kinematics, not calibrated Mars wheel physics.',
        ()=>mission.read().near_selected&&!world().following&&Math.abs(world().speed)<.03,null,{wait:true}));
      if(id===pending[0]){
        result.push(step('camera','Scout','Look through the rover camera','#navcam-mode',
          'Switch from Chase to the mast viewpoint. Drag the scene to aim the camera; Chase lets you orbit. This is a virtual Navcam-inspired view, separate from the archived NASA evidence you will inspect next.',
          ()=>world().camera==='navcam',click('#navcam-mode')));
      }
      result.push(step(`evidence-${id}`,'Observe',`Open the NASA evidence for ${name}`,'#mission-evidence',
        'Open the archived observation. The image, source links, date and location notes explain what you can support scientifically.',
        ()=>$('observation-dialog').open,click('#mission-evidence')));
      result.push(step(`inspect-${id}`,'Observe','Inspect the source before interpreting it','#observation-content img',
        'Look at visible textures and read what the source supports. The mission uses archived NASA observations; driving here does not create a new Mars measurement. Close the image when you are ready to write.',
        ()=>!$('observation-dialog').open,close('observation-dialog'),{modal:'observation-dialog',hold:3200,fallback:'#observation-content'}));
      result.push(step(`note-${id}`,'Observe',`Write your ${name} observation`,'#mission-note',
        demo?'This example note is explicitly labelled. In practice, write your own visible feature, comparison or unanswered science question.':'Write a visible feature or science question in your own words. A note and a stopped scout within 4 m are both required before Record observation becomes available.',
        ()=>!!$('mission-note').value.trim(),{selector:'#mission-note',kind:'input',value:id==='maaz'?
          'Tutorial example: visible mottled textures at Máaz. Compare with the second observation; composition evidence is needed to explain the formation.':
          'Tutorial example: compare Yeehgo’s close-up textures with Máaz and the wider context. What additional composition evidence would distinguish their formation?'}));
      result.push(step(`record-${id}`,'Observe',`Save the sourced ${name} note`,'#mission-record',
        'Record observation saves this note with the NASA source identifiers and the scout’s actual stopped location. A draft alone is not a recorded observation.',
        ()=>!!mission.read().records[id],click('#mission-record')));
    }
    if(!weatherAdded)addWeather(result);
    result.push(step('return-plan','Return','Plan the route back to your start','#mission-return',
      'Use the start you declared at the beginning. Check the return route before driving. Your observations stay recorded.',
      ()=>mission.read().returned||(mission.read().target==='return'&&['ready','nearby'].includes(mission.read().current_route?.status)),click('#mission-return'),{skipAction:()=>mission.read().returned}));
    result.push(step('return-drive','Return','Send the scout home','#mission-drive',
      'The return is a real planned leg. Scout this route starts it; the walkthrough waits for a stopped arrival rather than jumping the rover home.',
      ()=>mission.read().returned||world().following,click('#mission-drive'),{skipAction:()=>mission.read().returned}));
    result.push(step('returned','Return','Wait for the return report','#mission-status',
      'The mission is complete after both observations are recorded and the scout stops at its declared start. Live traveled distance and sampled slopes remain in the report.',
      ()=>mission.read().returned&&!!mission.read().completed_utc&&!world().following,null,{wait:true}));
    result.push(step('export','Report','Save the mission brief and its sources','#mission-export',
      'Export downloads a JSON brief containing recorded notes, routes, assumptions, weather selections, missing coverage and source references. Save it before refreshing; page-local notes do not survive a reload.',
      ()=>exported,click('#mission-export')));
    result.push(confirm('complete','Report','You have completed a sourced Marswalk','#mission-scout-report',
      demo?'The example visited both stations, recorded labelled notes and returned through the app’s real controller. Your downloaded example brief preserves the evidence. Finish to explore this example yourself, or replay it in a fresh example session.':'You planned a visit, inspected historical conditions, recorded NASA-backed observations, returned and exported your brief. Finish to keep exploring. Tutorial also contains the full controls tour.',{final:true}));
    return result;
  }
  function addWeather(list) {
    list.push(step('regional-open','Conditions','Inspect dust over your terrain field','#regional-open',
      'Regional weather opens dated MRO/MCS dust bins. This is different from Weather, which marks one historical MEDA station. Both support planning at different spatial scales.',
      ()=>$('regional-dialog').open,click('#regional-open'),{region:'map'}));
    list.push(step('regional-bin','Conditions','Locate the source bin covering your field','#regional-home',
      'Select the active map’s bin. Both Jezero fields occupy the same 6° × 5° source bin: this regional value covers the whole field, not separate local readings at every stop.',
      ()=>$('regional-bin').value===String(world().regionalHome),click('#regional-home'),{modal:'regional-dialog'}));
    list.push(step('regional-date','Conditions','Compare a historical dust map','#regional-prev',
      'Choose Previous or another date, then inspect the value and history. Colour represents column dust optical depth. Hatching means missing data; overlapping observation windows are not independent daily weather or a forecast.',
      ()=>$('regional-date').value!==stepStart.date,click('#regional-prev'),{modal:'regional-dialog',capture:()=>({date:$('regional-date').value}),
        alternative:'#regional-next'}));
    list.push(confirm('regional-history','Conditions','Read the history and the coverage','#regional-cell',
      'The selected bin retains its uncertainty, effective observation date and gaps. The coverage list below applies to every available terrain field, even without a route. Nearby stops share one regional estimate.',{modal:'regional-dialog'}));
    list.push(step('regional-close','Conditions','Return from the regional map','[data-close="regional-dialog"]',
      'Close regional weather to continue. Dust selections are retained and included in the exported mission reference.',()=>!$('regional-dialog').open,close('regional-dialog'),{modal:'regional-dialog'}));
    list.push(step('station-open','Conditions','Check the historical station readings','#mission-conditions',
      'Open the MEDA sol 16 reference. It provides historical mast air temperature and pressure at one recorded station, with explicit time and location separation from your visit.',
      ()=>$('conditions-dialog').open,click('#mission-conditions')));
    list.push(step('station-time','Conditions','Inspect another station time','#conditions-prev',
      'Step through the archived readings. Missing values remain gaps. These values describe the W station and its timestamp; moving the scout does not turn them into weather measurements along the path.',
      ()=>$('conditions-time').value!==stepStart.time,click('#conditions-prev'),{modal:'conditions-dialog',capture:()=>({time:$('conditions-time').value}),alternative:'#conditions-next'}));
    list.push(step('departures','Conditions','Choose a second historical departure','#conditions-compare',
      'Departure A follows the time slider; choose B here. The same assumed excursion supplies arrival, dwell and return times. Comparing historical readings can illustrate timing tradeoffs, not predict a safe future departure.',
      ()=>$('conditions-compare').value!==stepStart.alternate,{selector:'#conditions-compare',kind:'select',value:()=>String((Number($('conditions-compare').value)+1)%$('conditions-compare').options.length)},
      {modal:'conditions-dialog',capture:()=>({alternate:$('conditions-compare').value})}));
    list.push(confirm('timeline','Conditions','Read what the timing comparison means','#conditions-primary-summary',
      'Compare the two departure summaries and arrival/return table. Readings remain at the station, with their original time offsets and gaps. There is no inferred local weather gradient, ionizing-radiation dose or certified EVA duration.',{modal:'conditions-dialog'}));
    list.push(step('station-close','Conditions','Keep the references and return to your route','[data-close="conditions-dialog"]',
      'Close the weather reference. Your route, selected dust bin/date and station comparison stay available. Now send the rover scout.',()=>!$('conditions-dialog').open,close('conditions-dialog'),{modal:'conditions-dialog'}));
  }
  function visibleTarget(item) {
    let element=query(item.target);
    const r=element?.getBoundingClientRect();
    if(!element||element.hidden||!r?.width||!r?.height)element=query(item.fallback||'#mission-route-reason');
    return element;
  }
  function render() {
    if(!active)return;
    const item=current();clearInput();clearSpotlight();
    item.prepare?.();stepStart=item.capture?.()||{};
    const element=visibleTarget(item),modal=element.closest('dialog[open]');
    const region=item.region||(modal?'dialog':element.closest('.map-panel')?'map':element.closest('.camera-switch')?'camera':
      element.closest('.drive-panel')?'drive':'mission');
    document.body.dataset.walkthroughRegion=region;
    document.querySelectorAll('[data-walkthrough-target]').forEach(e=>e.removeAttribute('data-walkthrough-target'));
    element.setAttribute('data-walkthrough-target','');element.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
    tour.setConfig({...tour.getConfig(),showProgress:false,showButtons:['next','previous','close'],steps:[]});
    tour.highlight({element,disableActiveInteraction:false,popover:{title:item.title,side:region==='map'?'left':'right',align:'start',
      description:`<span class="tour-progress">${escape(item.chapter)} · ${index+1} / ${steps.length}</span>${escape(item.detail)}<span id="walkthrough-hint" class="tour-exit-hint" role="status"></span><div class="walkthrough-controls"><button id="walkthrough-pause" type="button">Pause</button><button id="walkthrough-restart" type="button">${demo?'Replay example':'Restart guide'}</button></div>`,
      showButtons:index?['previous','next','close']:['next','close'],prevBtnText:'Back',nextBtnText:item.final?'Finish':item.wait?'Waiting for arrival…':'Continue →',
      onNextClick:()=>{if(allowed())advance();},onPrevClick:()=>back(),onCloseClick:end}});
    update();
    requestAnimationFrame(()=>{if(active){tour.refresh();update();}});
  }
  function decorate(popover) {
    if(!active)return;
    popover.wrapper.classList.add('walkthrough-tour');
    const controls=popover.wrapper.querySelector('.walkthrough-controls'),footer=popover.wrapper.querySelector('.driver-popover-footer');
    if(controls&&footer)footer.before(controls);
    const modal=query('dialog[open]');
    if(modal)modal.append(popover.wrapper);
    // The visible cursor lives in the same browser layer as a native dialog.
    if(cursor)(modal||document.body).append(cursor);
    $('walkthrough-pause').onclick=togglePause;$('walkthrough-restart').onclick=restart;
  }
  function allowed(){const item=current();return !paused&&!error&&(item.confirm||!!item.done?.());}
  function update() {
    if(!active)return;
    const host=query('dialog[open]')||document.body,popover=query('.driver-popover');
    if(popover&&popover.parentElement!==host)host.append(popover);
    if(cursor&&cursor.parentElement!==host)host.append(cursor);
    const item=current(),button=query('.driver-popover-next-btn'),hint=$('walkthrough-hint');
    if(button){button.disabled=demo&&!item.final||!allowed();button.textContent=item.final?'Finish':paused?'Paused':item.wait&&!item.done()?'Waiting for arrival…':'Continue →';}
    if(hint)hint.textContent=error|| (paused?'Paused. Resume continues from this step; no pending action runs while paused.':
      item.final?'Finish keeps your current visit. Replay starts only a fresh example.':
      demo?(item.wait?'Waiting for the scout’s actual stopped arrival.':'Watching an example · the pointer shows the next action.'):
      item.confirm?'Inspect this information, then choose Continue.':item.done?.()?'Step complete. Choose Continue.':'Use the highlighted control first; Continue unlocks when its prerequisite is satisfied.');
    const b=$('walkthrough-pause');if(b){b.textContent=paused?'Resume':'Pause';b.setAttribute('aria-pressed',String(paused));}
  }
  function advance() {
    if(!active||paused)return;
    if(current().final){completed=true;onComplete();end();return;}
    index++;generation++;error='';movement?.cancel();ripple?.cancel();render();
    if(demo)void run(generation);
  }
  function back(){if(index>0&&active){pause({immediate:true});restoreDrive=false;index--;generation++;error='';movement?.cancel();render();if(demo)void run(generation);}}
  async function delay(ms,token) {
    let left=ms,last=performance.now();
    while(left>0){await new Promise(resolve=>setTimeout(resolve,50));valid(token);const now=performance.now();if(!paused)left-=Math.min(100,now-last);last=now;}
    while(paused){await new Promise(resolve=>setTimeout(resolve,50));valid(token);}
  }
  async function moveTo(element,token) {
    valid(token);element.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});tour.refresh();
    await delay(100,token);
    const rect=element.getBoundingClientRect(),next={x:rect.x+rect.width/2,y:rect.y+rect.height/2};
    const host=element.closest('dialog[open]')||document.body;host.append(cursor);cursor.hidden=false;
    const duration=reduced.matches?0:.55;
    movement=globalThis.Motion.animate(cursor,{transform:[`translate(${pointer.x}px,${pointer.y}px)`,`translate(${next.x}px,${next.y}px)`]},
      {duration,ease:'easeInOut',fill:'forwards'});
    if(paused)movement.pause();await delay(duration*1000+50,token);movement.complete();pointer=next;
  }
  async function perform(action,token) {
    let selector=action.selector;
    if(query(selector)?.disabled&&current().alternative)selector=current().alternative;
    const element=query(selector);if(!element||element.disabled)throw new Error('The highlighted action is unavailable. Review its prerequisite, then replay or continue in practice.');
    await moveTo(element,token);valid(token);await delay(200,token);
    ripple=globalThis.Motion.animate(cursor.querySelector('i'),{opacity:[.9,0],transform:['scale(.3)','scale(1.8)']},{duration:reduced.matches?0:.4});
    const value=typeof action.value==='function'?action.value():action.value;
    // Visual pointer motion and application actions are deliberately separate.
    if(action.kind==='click')element.click();
    else {element.focus({preventScroll:true});element.value=value;element.dispatchEvent(new Event(action.kind==='input'?'input':'change',{bubbles:true}));}
    actions.push({step:current().id,selector,kind:action.kind,utc:new Date().toISOString()});
    if(actions.length>128)actions.shift();
  }
  async function run(token) {
    try{
      const item=current();if(item.final)return;
      await delay(item.hold||1800,token);
      if(item.action&&!item.skipAction?.())await perform(item.action,token);
      let elapsed=0;
      while(!item.confirm&&!item.done?.()){
        await delay(200,token);elapsed+=200;
        if(elapsed>300000)throw new Error('This step is taking longer than expected. Pause and inspect the route result; replay when ready.');
      }
      await delay(650,token);valid(token);advance();
    }catch(reason){if(reason.name!=='AbortError'){error=reason.message;paused=true;pause({immediate:true});movement?.pause();update();}}
  }
  function togglePause(){
    if(!active||error)return;
    paused=!paused;
    if(paused){restoreDrive=world().following;pause({immediate:true});clearInput();movement?.pause();ripple?.pause();}
    else {movement?.play();ripple?.play();if(restoreDrive&&!world().following){restoreDrive=false;$('mission-drive').click();}}
    update();
  }
  function start(isDemo=false) {
    if(active)end();
    $('tutorial-dialog').close();pause({immediate:true});clearInput();clearSpotlight();
    context={view:interfaceUI.read(),details:[...document.querySelectorAll('#mission-panel details')].map(e=>[e,e.open]),scroll:$('mission-panel').scrollTop};
    demo=isDemo;active=true;paused=false;completed=false;index=0;exported=false;error='';actions=[];generation++;
    document.body.classList.add('tutorial-walkthrough');document.body.classList.toggle('walkthrough-example',demo);
    mission.show(true);steps=build();
    cursor=document.createElement('div');cursor.id='walkthrough-cursor';cursor.hidden=true;cursor.setAttribute('aria-hidden','true');
    cursor.innerHTML='<i></i><svg viewBox="0 0 32 40"><path d="M3 2v29l8-7 6 13 6-3-6-12 11-1Z"/></svg>';
    document.body.append(cursor);render();if(demo)void run(generation);
  }
  function end() {
    if(!active)return;
    active=false;generation++;movement?.cancel();ripple?.cancel();cursor?.remove();cursor=null;
    clearSpotlight();pause({immediate:true});clearInput();restoreDrive=false;
    for(const id of ['regional-dialog','conditions-dialog','observation-dialog'])if($(id).open)$(id).close();
    document.body.classList.remove('tutorial-walkthrough','walkthrough-example');delete document.body.dataset.walkthroughRegion;
    document.querySelectorAll('[data-walkthrough-target]').forEach(e=>e.removeAttribute('data-walkthrough-target'));
    if(context){interfaceUI.show(context.view);for(const [e,open] of context.details)e.open=open;$('mission-panel').scrollTop=context.scroll;context=null;}
    remember();$('help-open').focus({preventScroll:true});
  }
  function restart(){if(demo){pause({immediate:true});end();location.reload();}else {end();start(false);}}
  $('mission-export').addEventListener('click',()=>{if(active&&!$('mission-export').disabled)exported=true;});
  document.addEventListener('visibilitychange',()=>{if(active&&document.hidden&&!paused)togglePause();});
  window.addEventListener('keydown',e=>{
    if(!active)return;
    if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();end();return;}
    if(e.code==='Space'&&e.target.closest?.('button')){e.stopPropagation();return;}
    if(e.target.closest?.('input,textarea,select'))return;
    if(['KeyW','KeyS','KeyA','KeyD','KeyR','KeyC','Digit1','Digit2','ArrowUp','ArrowDown'].includes(e.code)){e.preventDefault();e.stopImmediatePropagation();}
  },true);
  window.addEventListener('pagehide',()=>{if(active)end();});
  return {start,end,update,decorate,active:()=>active,
    read:()=>({active,demo,paused,completed,index,total:steps.length,step:current()?.id||null,chapter:current()?.chapter||null,
      ready:active&&allowed(),error,exported,actions:[...actions],pointer:{...pointer,visible:!!cursor&&!cursor.hidden,reducedMotion:reduced.matches}})};
}
