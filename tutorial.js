import {driver} from './vendor/driver-1.3.6/driver.js.mjs';
import {interfaceChapters} from './interface-tour.js';
import {createWalkthrough} from './walkthrough.js';

// Driver owns the spotlight. The existing mission owns actions and truth.
export function createTutorial({mission,world,pause,clearInput,interfaceUI}) {
  const $=id=>document.getElementById(id), seenKey='terrain-surf-tutorial-v1';
  const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let mode=null, key='', silent=false, initialRecords=new Set(), completed=false;
  let interfaceSteps=[], interfaceIndex=0, interfaceContext=null, interfaceTarget='';
  let workflow=null;
  const seen=()=>{try{return localStorage.getItem(seenKey)==='seen';}catch{return false;}};
  const remember=()=>{try{localStorage.setItem(seenKey,'seen');}catch{/* A blocked store must never block the app. */}};
  const tour=driver({
    animate:false,smoothScroll:false,overlayOpacity:.42,stagePadding:7,stageRadius:7,
    allowKeyboardControl:false,allowClose:true,popoverClass:'terrain-tour',popoverOffset:14,
    onDestroyed:()=>{if(!silent)end();},
    onPopoverRender:p=>{
      p.closeButton.setAttribute('aria-label','Exit tutorial');
      p.wrapper.setAttribute('aria-modal','true');
      workflow?.decorate(p);
    },
  });
  function clearSpotlight(){silent=true;tour.destroy();silent=false;key='';}
  function end() {
    if(workflow?.active()){workflow.end();return;}
    mode=null;clearSpotlight();document.body.classList.remove('tutorial-mission','tutorial-controls');
    document.body.classList.remove('tutorial-interface');delete document.body.dataset.tourRegion;
    if(interfaceContext){
      interfaceUI.show(interfaceContext.view);
      for(const [element,open] of interfaceContext.details)element.open=open;
      for(const [element,top] of interfaceContext.scroll)element.scrollTop=top;
      interfaceContext=null;
    }
    clearInput();pause({immediate:true});remember();$('help-open').focus({preventScroll:true});
  }
  function menu() {
    if(workflow?.active())workflow.end();
    if(mode)end();
    pause({immediate:true});clearInput();$('tutorial-dialog').showModal();
  }
  function startMission() {
    $('tutorial-dialog').close();clearSpotlight();completed=false;mode='mission';
    tour.setConfig({...tour.getConfig(),showProgress:false,showButtons:['close'],steps:[]});
    pause({immediate:true});clearInput();mission.show(true);
    initialRecords=new Set(Object.keys(mission.read().records));
    document.body.classList.add('tutorial-mission');update();
  }
  function finish() {
    completed=true;key='complete';pause({immediate:true});clearInput();
    tour.highlight({popover:{title:'Your first stop is recorded.',
      description:'You saved a sourced observation. Next, check the historical regional dust map, its dates and coverage.<br><br>Your position and notebook stay intact. You can also keep exploring and return to weather from <b>Tutorial</b>.',
      showButtons:['next','close'],nextBtnText:'Review regional weather →',
      onNextClick:()=>{end();startInterface('regional');},onCloseClick:end}});
  }
  function update() {
    workflow?.update();
    if(workflow?.active())return;
    if(mode!=='mission'||completed)return;
    // Native dialogs occupy the browser top layer: remove the spotlight/focus
    // trap while evidence is open, then resume from real state after it closes.
    if(document.querySelector('dialog[open]')){if(tour.isActive())clearSpotlight();return;}
    const state=mission.read();
    if(Object.keys(state.records).some(id=>!initialRecords.has(id))){finish();return;}
    if(!state.visible){end();return;}
    const g=mission.guidance(), nextKey=`${g.key}:${state.selected}:${state.target}`;
    if(nextKey===key)return;
    key=nextKey;
    const element=document.querySelector(g.element);
    if(!element||element.hidden){end();return;}
    element.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
    tour.highlight({element,disableActiveInteraction:g.disabled,popover:{
      title:g.title,
      description:`<span class="tour-progress">${g.phase?`FIRST STOP · ${g.phase} OF 5`:'YOUR MARSWALK'}</span>${escape(g.detail)}<span class="tour-exit-hint">Use the highlighted control. Esc exits the guide.</span>`,
      side:'right',align:'start',showButtons:['close'],onCloseClick:end,
    }});
    // The panel may scroll independently of window scroll.
    requestAnimationFrame(()=>tour.refresh());
  }
  function controls() {
    $('tutorial-dialog').close();clearSpotlight();mode='controls';completed=false;
    pause({immediate:true});clearInput();mission.show(false);
    document.body.classList.add('tutorial-controls');
    tour.setConfig({...tour.getConfig(),showProgress:true,progressText:'CONTROLS · {{current}} / {{total}}',
      nextBtnText:'Next →',prevBtnText:'Back',doneBtnText:'Try it myself',showButtons:['next','previous','close'],
      steps:[
        {element:'.map-panel',disableActiveInteraction:true,popover:{title:'Click a destination on the map',description:'After this tour, click any unnumbered point on the orbital map. The rover checks the measured slopes and drives there. A new click changes the destination. <b>Space stops it.</b><br><br>Numbered science markers select a stop; use <b>Plan this stop</b> before sending the scout.'}},
        {element:'.camera-switch',disableActiveInteraction:true,popover:{title:'Choose your viewpoint',description:'<b>Chase</b> follows the rover. Drag the terrain to orbit and scroll to zoom. <b>Rover camera</b> looks through the mast; drag to aim it. Press <b>1 / 2</b> or <b>C</b> to switch.'}},
        {element:matchMedia('(pointer: coarse)').matches?'#touch-drive':'.drive-panel',disableActiveInteraction:true,popover:{title:'You can take the wheel',description:'Click the terrain, then use <b>W / S</b> to drive and reverse, <b>A / D</b> to steer, and <b>Space</b> to brake. On touchscreens, hold the arrow buttons.<br><br>Manual driving interrupts an automatic route. <b>R</b> resets the rover position; it does not erase your notebook.'}},
        {element:'#mission-open',disableActiveInteraction:true,popover:{title:'Turn a drive into a science visit',description:'Open <b>Plan a Marswalk</b> for science stops and a notebook. Follow its <b>Next step</b> prompt, or choose <b>Guide my first stop</b> from Tutorial. <b>Data & sources</b> explains the real datasets and the virtual rover’s limitations.',onNextClick:()=>{completed=true;end();}}},
      ]});
    tour.drive();
  }
  function showInterface(index) {
    if(index<0)return;
    if(index>=interfaceSteps.length){completed=true;end();return;}
    interfaceIndex=index;const item=interfaceSteps[index];key=`interface:${item.chapter.id}:${item.id}`;
    clearInput();interfaceUI.show(item.view);
    if(item.view.details)document.querySelector(item.view.details).open=true;
    const coarse=matchMedia('(pointer: coarse)').matches;
    let element=document.querySelector(coarse&&item.view.touchElement?item.view.touchElement:item.element);
    const visible=e=>{if(!e||e.hidden||getComputedStyle(e).display==='none')return false;
      const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};
    if(!visible(element))element=document.querySelector(item.view.fallback||'#route-status');
    const region=element.closest('#mission-panel')?'mission':element.closest('#route-panel')?'route':
      element.closest('#sensor-panel')?'sensor':element.closest('#sources-dialog')?'sources':element.closest('#conditions-dialog')?'conditions':element.closest('#regional-dialog')?'regional':
      element.closest('.map-panel')?'map':element.closest('.drive-panel,#touch-drive')?'drive':
      element.closest('.site-card')?'site':element.closest('.camera-switch')?'camera':
      element.closest('.heading-strip')?'heading':'header';
    document.body.dataset.tourRegion=region;
    // Reveal the mobile topic region before measuring/scrolling the real target.
    element.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
    interfaceTarget=element.id?`#${element.id}`:item.element;
    const last=index===interfaceSteps.length-1;
    const chapterEnd=!last&&interfaceSteps[index+1].chapter!==item.chapter;
    tour.highlight({element,disableActiveInteraction:true,popover:{
      title:item.title,
      description:`<span class="tour-progress">${escape(item.chapter.title)} · ${item.chapterIndex+1} / ${item.chapter.steps.length}</span>${item.description}<span class="tour-exit-hint">${index+1} / ${interfaceSteps.length} in this tour · Back / Next to browse · Esc exits. Controls stay paused during orientation.</span>`,
      side:region==='map'?'left':'right',align:'start',showButtons:index?['previous','next','close']:['next','close'],
      nextBtnText:last?'Finish tour':chapterEnd?'Next topic →':'Next →',prevBtnText:'Back',
      onNextClick:()=>showInterface(index+1),onPrevClick:()=>showInterface(index-1),onCloseClick:end,
    }});
    requestAnimationFrame(()=>tour.refresh());
  }
  function startInterface(chapterId=null) {
    $('tutorial-dialog').close();clearSpotlight();mode='interface';completed=false;
    pause({immediate:true});clearInput();
    interfaceContext={view:interfaceUI.read(),details:[...document.querySelectorAll('#mission-panel details,#route-panel details,#conditions-dialog details,#regional-dialog details')].map(e=>[e,e.open]),
      scroll:[...document.querySelectorAll('#mission-panel,#route-panel,#sensor-panel,#sources-dialog,#conditions-dialog,#regional-dialog')].map(e=>[e,e.scrollTop])};
    const chapters=chapterId==='regional'?
      interfaceChapters.filter(c=>c.id==='conditions').map(c=>({...c,id:'regional',title:'Regional weather',steps:c.steps.filter(s=>s.id.startsWith('regional-'))})):
      interfaceChapters.filter(c=>!chapterId||c.id===chapterId);
    interfaceSteps=chapters.flatMap(chapter=>chapter.steps.map((item,chapterIndex)=>({...item,chapter,chapterIndex})));
    document.body.classList.add('tutorial-interface');
    tour.setConfig({...tour.getConfig(),showProgress:false,showButtons:['next','previous','close'],steps:[]});
    showInterface(0);
  }
  $('help-open').onclick=menu;
  $('tutorial-start').onclick=startMission;
  $('tutorial-walkthrough')?.addEventListener('click',()=>workflow.start(false));
  $('tutorial-controls').onclick=controls;
  $('tutorial-interface').onclick=()=>startInterface();
  document.querySelectorAll('[data-tutorial-chapter]').forEach(b=>b.onclick=()=>startInterface(b.dataset.tutorialChapter));
  $('tutorial-explore').onclick=()=>$('tutorial-dialog').close();
  $('tutorial-dialog').addEventListener('close',remember);
  for(const id of ['mission-panel','route-panel','sensor-panel','sources-dialog','conditions-dialog','regional-dialog'])$(id).addEventListener('scroll',()=>{if(mode&&tour.isActive())tour.refresh();},{passive:true});
  $('mission-export').addEventListener('click',()=>{if(mode==='mission')finish();});
  window.addEventListener('keydown',e=>{
    if(!mode||(mode!=='interface'&&document.querySelector('dialog[open]')))return;
    if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();end();return;}
    if(mode==='interface'){
      if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();e.stopImmediatePropagation();showInterface(interfaceIndex+(e.key==='ArrowRight'?1:-1));return;}
      if((e.key!=='Tab'&&!e.target.closest?.('.driver-popover'))||['KeyW','KeyS','KeyA','KeyD','KeyR','KeyC','Digit1','Digit2','ArrowUp','ArrowDown'].includes(e.code)){
        e.preventDefault();e.stopImmediatePropagation();return;
      }
    }
    // Let Space activate focused tutorial/mission buttons instead of the
    // world's driving handler consuming their keyboard activation.
    if(e.code==='Space'&&e.target.closest?.('button'))e.stopPropagation();
  },true);
  workflow=createWalkthrough({tour,clearSpotlight,mission,world,pause,clearInput,interfaceUI,remember,onComplete:()=>{completed=true;}});
  if(new URLSearchParams(location.search).get('walkthrough')==='demo')workflow.start(true);
  else if(!seen())menu();
  return {update,read:()=>({active:!!mode||workflow.active(),mode:workflow.active()?'walkthrough':mode,
    step:workflow.active()?`walkthrough:${workflow.read().step}`:key,completed,workflow:workflow.read(),menuOpen:$('tutorial-dialog').open,seen:seen(),
    interface:mode==='interface'?{index:interfaceIndex,total:interfaceSteps.length,chapter:interfaceSteps[interfaceIndex].chapter.id,
      id:interfaceSteps[interfaceIndex].id,target:interfaceTarget,covers:interfaceSteps[interfaceIndex].covers}:null})};
}
