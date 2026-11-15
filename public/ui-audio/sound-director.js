/*
 * Stadium Sound Director 0.3.9.
 * Coordinates real V16.6 animation/score/referee events; owns timing policy,
 * never plays or cancels audio directly. Separate music and WebAudio mixers
 * report their currently audible layers. No UI or original-game modifications.
 */
(() => {
  'use strict';
  if (window.__vmSoundDirector) return;
  const now = () => performance.now();
  const state = {
    phase:'menu', rally:false, started:false, paused:false, pointCount:0,
    lastPointAt:-Infinity, lastWhistleAt:-Infinity, lastChantAt:-Infinity,
    chantUntil:-Infinity, nextChantAt:7, lastSpeechAt:-Infinity,
    pointType:'', winner:null, chants:0, points:0, whistles:0,
    reactions:0, droppedEvents:0
  };
  const voices = new Map();
  const history = [];
  let debug = null;
  let pausedPhase = null;
  function trace(type, detail='') {
    history.push({at:Math.round(now()),type,detail});
    if (history.length>120) history.shift();
  }
  function note(layer, sample, duration=0) {
    if (!layer || !sample) return;
    voices.set(layer,{sample,until:now()+Math.max(0,duration)*1000});
    trace(layer,sample);
  }
  function activeVoices() {
    return Object.fromEntries([...voices].filter(([,v])=>v.until>now())
      .map(([k,v])=>[k,{sample:v.sample,remaining:Math.round((v.until-now())/100)/10}]));
  }
  function start() {
    pausedPhase=null;
    state.started=true;state.paused=false;state.phase='waiting';state.rally=false;
    state.pointCount=0;state.nextChantAt=5;state.chantUntil=-Infinity;
    state.lastWhistleAt=-Infinity;state.lastSpeechAt=-Infinity;state.lastChantAt=-Infinity;
    state.pointType='';state.winner=null;voices.clear();
    trace('match','start');
  }
  function whistle() {
    if (!state.started || state.paused) return;
    state.phase='rally';state.rally=true;
    state.lastWhistleAt=now();state.whistles++;
    trace('referee','serve whistle');
  }
  function pause() {
    if (!state.started || state.paused) return;
    pausedPhase={phase:state.phase,rally:state.rally,at:now()};
    state.paused=true;
    state.phase='paused';
    state.rally=false;
    state.chantUntil=-Infinity;
    voices.clear();
    trace('match','effects paused; music independent');
  }
  function resume() {
    if (!state.started || !state.paused) return;
    state.paused=false;
    state.phase=pausedPhase?.phase??'waiting';
    state.rally=pausedPhase?.rally??false;
    // Freeze the director's rally timing across the user's manual pause.
    if (state.rally && Number.isFinite(state.lastWhistleAt))
      state.lastWhistleAt+=Math.max(0,now()-(pausedPhase?.at??now()));
    pausedPhase=null;
    trace('match','effects resumed');
  }
  function kindOf(point) {
    const s=String(point?.lastKind || '').toLowerCase();
    if (/serve.?error|service.?error|fault|missedserve/.test(s)) return 'serve-error';
    if (/attack.?error|spike.?error|hit.?out|out|net.?error/.test(s)) return 'attack-error';
    if (/block/.test(s)) return point?.won?'winning-block':'blocked';
    if (/ace/.test(s)) return 'ace';
    if (/kill|spike|attack/.test(s)) return 'spike';
    if (point?.spectacular) return 'long-rally';
    return 'ordinary';
  }
  function point(point) {
    if (!state.started) start();
    if (!point || ![0,1].includes(point.winner)) {
      state.droppedEvents++;return null;
    }
    state.phase='after-point';state.rally=false;
    state.lastPointAt=now();state.points++;state.pointCount++;
    state.pointType=kindOf(point);state.winner=point.winner;
    trace('point',state.pointType+' '+(point.won?'won':'lost'));
    return state.pointType;
  }
  function requestChant(point) {
    if (!state.started || state.paused || state.rally ||
        state.pointCount<state.nextChantAt || now()<state.chantUntil ||
        now()-state.lastChantAt<12000 || point?.setFinished) return null;
    const duration=point?.clutch?12:8+Math.round(Math.random()*4);
    state.chantUntil=now()+duration*1000;
    state.lastChantAt=now();
    state.pointCount=0;state.nextChantAt=4+Math.floor(Math.random()*3);
    state.chants++;
    trace('supporters','chant '+duration+'s');
    return {duration,side:point.home<point.away?0:point.away<point.home?1:-1};
  }
  function cancelChant() {
    state.chantUntil=-Infinity;
    state.pointCount=Math.max(state.pointCount,state.nextChantAt-1);
    state.chants=Math.max(0,state.chants-1);
  }
  function chantActive() { return state.started && now()<state.chantUntil; }
  function ambienceLevel() {
    if (!state.started || state.paused) return 0;
    if (chantActive()) return .26; // audible, but under a clearly foreground chant
    if (!state.rally) return 1;
    const since=now()-state.lastWhistleAt;
    // Fade naturally from the whistle: the audience settles after ~3 seconds.
    return Math.max(.30,1-.7*Math.min(1,Math.max(0,since-350)/2900));
  }
  function reaction(point) {
    const type=kindOf(point);
    if (!point.won) {
      if (['serve-error','attack-error','blocked'].includes(type)) return 'disappointment';
      return point.closeCall?'disappointment':'opponent';
    }
    if (type==='ace') return 'ace';
    if (type==='winning-block') return 'block';
    if (point.spectacular||point.setFinished||point.clutch) return 'big-cheer';
    return 'normal-cheer';
  }
  function commentary(point) {
    if (!state.started || state.paused || state.rally || now()-state.lastSpeechAt<45000)
      return null;
    const classification=reaction(point);
    const odds=classification==='normal-cheer'||classification==='opponent'?.09:.24;
    if (Math.random()>=odds) return null;
    const phrases={
      'serve-error':['Unlucky!','Next one!'],
      'attack-error':['So close!','Next one!'],
      'blocked':['Tough block!','Shake it off!'],
      'disappointment':['Unlucky!','Next one!'],
      'opponent':['Keep going!'],
      'ace':['What a serve!','Brilliant serve!'],
      'block':['What a block!','Well done!'],
      'big-cheer':['What a hit!','Fantastic!'],
      'normal-cheer':['Nice one!','Well done!']
    };
    const key=classification==='disappointment' && phrases[kindOf(point)]
      ? kindOf(point):classification;
    const options=phrases[key]||phrases['normal-cheer'];
    const phrase=options[Math.floor(Math.random()*options.length)];
    state.lastSpeechAt=now();
    state.reactions++;trace('commentary',phrase);
    return phrase;
  }
  function end() {
    pausedPhase=null;
    state.phase='menu';state.started=false;state.paused=false;state.rally=false;
    state.chantUntil=-Infinity;voices.clear();trace('match','end');
  }
  function view() {
    if (!debug) return;
    const active=activeVoices();
    const e=Object.entries(active).map(([layer,v])=>
      layer.padEnd(12)+' '+v.sample+' ('+v.remaining+'s)');
    debug.textContent=[
      'STADIUM SOUND DIRECTOR 0.3.9',
      'Phase: '+state.phase+'  Murmur level: '+Math.round(ambienceLevel()*100)+'%',
      'Chant: '+(chantActive()?'active':'idle')+'   Points: '+state.points,
      ...e.slice(-12),'',
      ...history.slice(-5).map(x=>x.type+': '+x.detail)
    ].join('\n');
  }
  function toggleMonitor() {
    if (debug) { debug.remove();debug=null;return false; }
    if (!document.body) return false;
    debug=document.createElement('pre');
    debug.setAttribute('data-vm-audio-debug','true');
    debug.style.cssText='position:fixed;z-index:2147483647;right:12px;bottom:12px;'+
      'max-width:450px;width:42vw;max-height:55vh;overflow:auto;'+
      'background:#101e32eb;color:#e6efff;padding:12px;border:1px solid #58789a;'+
      'border-radius:8px;font:12px/1.5 monospace;pointer-events:none;white-space:pre-wrap;';
    document.body.appendChild(debug);view();return true;
  }
  document.addEventListener('keydown',e=>{
    if (e.ctrlKey&&e.shiftKey&&e.code==='F9') {
      e.preventDefault();toggleMonitor();
    }
  });
  setInterval(()=>{if(debug)view();},600);
  window.__vmEvents?.on?.('match:pause', pause);
  window.__vmEvents?.on?.('match:resume', resume);
  window.__vmSoundDirector=Object.freeze({
    version:'0.3.9',start,whistle,pause,resume,point,requestChant,chantActive,
    ambienceLevel,reaction,kindOf,commentary,note,end,cancelChant,toggleMonitor,
    getState:()=>({...state,chantActive:chantActive(),
      ambienceLevel:ambienceLevel(),active:activeVoices()}),
    history:()=>history.slice()
  });
})();
