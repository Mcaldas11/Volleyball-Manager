/**
 * Volleyball Manager Dev 0.3.6 — full-length non-interrupting PA tracks.
 * Independent from the original match sounds and DOM. Two licensed tracks are
 * inserted into the DERIVED app.asar during packaging, never streamed online.
 * The menu soundtrack runs separately. The stadium introduction can continue
 * quietly into play. Timeout and set-break cues use shorter excerpts.
 */
(() => {
  'use strict';
  if (window.__vmStadiumMusic) return;

  const ROOT = new URL('../', document.currentScript?.src || document.baseURI);
  const LIVE = '.content-live';
  const TRACKS = Object.freeze({
    rock: new URL('match-v168/pa-rock.mp3',ROOT).href,
    drums: new URL('match-v168/pa-drums.mp3',ROOT).href,
    sport: new URL('match-v168/pa-sport.mp3',ROOT).href
  });
  const STORAGE = 'vm.v032.stadiumMusic.';
  // PA-specific attenuation; never touch applause, balls or player voices.
  const PA_MIX_SCALE = .50;
  const LIVE_BACKGROUND_SCALE = .40;
  const INTRO_TRACKS = Object.freeze(['drums','sport','rock']);
  const get = (key, fallback) => { try { return localStorage.getItem(STORAGE+key) ?? fallback; } catch { return fallback; } };
  const save = (key,value) => { try { localStorage.setItem(STORAGE+key,String(value)); } catch {} };
  const clamp = (n,min,max) => Math.min(max,Math.max(min,n));
  const state = {
    enabled: get('enabled','on') !== 'off',
    volume: clamp(Number(get('volume',35)) || 0,0,100),
    current: null, playing: false, cue: '', introCount: 0,
    cues: 0, denied: 0, errors: 0, lastStarted: -Infinity,
    setBreaks: 0, previews: 0, loaded: {}, lastPoint: null, live: false,
    preparedCount: 0, firstWhistleDucks: 0, preparing: false,
    introTrack: null, firstWhistleSeen: false
  };
  let ctx = null;
  let bus = null;
  let volumeGain = null;
  let active = null;
  let pending = null;
  let previewUI = null;
  let mutedByFocus = false;
  let rallyActive = false;
  const buffers=new Map(),loading=new Map();
  let voice=null,loadSeq=0,reviewActive=false,introIssued=false;
  state.lastError='';

  function globalAllowed() {
    if (!state.enabled || state.volume<=0 || document.hidden || mutedByFocus) return false;
    try {
      if (localStorage.getItem('vm.sound')==='off') return false;
      return Number(localStorage.getItem('vm.soundVolume')??'1') > 0;
    } catch { return true; }
  }
  function crowdDucking() {
    // Intelligibility: keep continuous music playing, merely make space for
    // applause and supporter chants through a slow sidechain volume ramp.
    const layers=window.__vmSoundDirector?.getState?.().active || {};
    return layers.chant?.35:layers.applause?.60:1;
  }
  function globalLevel() {
    try { return clamp(Number(localStorage.getItem('vm.soundVolume') ?? '1')||0,0,1); }
    catch { return 1; }
  }
  function live() { return !!document.querySelector(LIVE); }
  function preMatch() {
    // Actual V16.6 team-selection flow; data-tour="kickoff" is present on the
    // tactical/lineup setup screen, NOT on a normal club management screen.
    return !!document.querySelector('button[data-tour="kickoff"]');
  }
  function musicLevel(track) {
    // PaulYudin used to be arbitrarily .72x; the user reports it too quiet.
    return .32*PA_MIX_SCALE*(track==='sport'?.98:1);
  }
  function mixBus(){
    if(!ctx||!bus||active===null)return;
    const duck=crowdDucking();
    const duringPlay=state.firstWhistleSeen&&(rallyActive||!voice?.excerpt)?LIVE_BACKGROUND_SCALE:1;
    const target=globalAllowed()?globalLevel()*duck*duringPlay*(reviewActive?.24:1):0;
    bus.gain.setTargetAtTime(target,ctx.currentTime,target===0?.035:rallyActive?.45:.8);
  }
  function chooseIntro(){
    const value=Number(get('introRotation','0'));
    const index=Number.isFinite(value)?((Math.trunc(value)%3)+3)%3:0;
    save('introRotation',(index+1)%INTRO_TRACKS.length);
    state.introTrack=INTRO_TRACKS[index];
    return state.introTrack;
  }

  function init() {
    if (ctx) return ctx;
    const Ctor=window.AudioContext||window.webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx=new Ctor();
      bus=ctx.createGain();
      bus.gain.value=1;
      volumeGain=ctx.createGain();
      volumeGain.gain.value=state.volume/100;
      const filter=ctx.createBiquadFilter();
      filter.type='lowpass';
      filter.frequency.value=5200; // slightly muffled, as if from PA speakers
      const limiter=ctx.createDynamicsCompressor();
      limiter.threshold.value=-16;
      limiter.knee.value=16;
      limiter.ratio.value=3;
      limiter.attack.value=.01;
      limiter.release.value=.25;
      bus.connect(volumeGain).connect(filter).connect(limiter).connect(ctx.destination);
      return ctx;
    } catch {
      state.errors++;
      return null;
    }
  }
  // V16.4's proved local fetch()+decodeAudioData() path. Native media
  // streaming from the packed Electron ASAR is unreliable.
  async function load(track){
    if(buffers.has(track))return buffers.get(track);
    if(loading.has(track))return loading.get(track);
    const task=(async()=>{
      const c=init();if(!c)throw new Error('No AudioContext');
      const response=await fetch(TRACKS[track],{cache:'force-cache'});
      if(!response.ok)throw new Error('Music '+track+' HTTP '+response.status);
      const data=await response.arrayBuffer();
      if(data.byteLength<10000)throw new Error('Music '+track+' empty');
      const buffer=await c.decodeAudioData(data.slice(0));
      if(!buffer||buffer.duration<6)throw new Error('Music '+track+' decoding failed');
      buffers.set(track,buffer);state.loaded[track]=true;return buffer;
    })().catch(e=>{
      state.errors++;state.loaded[track]=false;state.lastError=String(e);
      return null;
    }).finally(()=>loading.delete(track));
    loading.set(track,task);return task;
  }
  function fadeVoice(old,seconds=2.5){
    if(!old||!ctx)return;
    const now=ctx.currentTime,g=old.envelope.gain;
    if(typeof g.cancelAndHoldAtTime==='function'){
      try{g.cancelAndHoldAtTime(now);}catch{g.cancelScheduledValues(now);}
    }else{
      g.cancelScheduledValues(now);
      g.setValueAtTime(Math.max(.00001,g.value),now);
    }
    g.linearRampToValueAtTime(.00001,now+Math.max(.1,seconds));
    try{old.source.stop(now+Math.max(.1,seconds)+.04);}catch{}
  }
  function clearPending(){
    if(pending!==null){clearTimeout(pending);pending=null;}
  }
  function stop(fade=2.5){
    clearPending();
    loadSeq++;
    const previous=voice;voice=null;active=null;
    state.current=null;state.playing=false;state.cue='';
    if(previous)fadeVoice(previous,fade);
    updateUI();
  }
  function play(track,name,seconds=null,{preview=false}={}){
    if(!Object.hasOwn(TRACKS,track))return false;
    if(!globalAllowed()||(!preview&&!live()&&!preMatch())||(!preview&&rallyActive)){
      state.denied++;return false;
    }
    if(active!==null&&!preview)return false;
    if(active!==null)stop(2.2);
    const c=init();if(!c)return false;
    active=track;state.current=track;state.cue=name;
    state.lastStarted=performance.now();state.playing=false;
    const token=++loadSeq;
    void load(track).then(async buffer=>{
      if(token!==loadSeq||active!==track)return;
      if(!buffer){stop();return;}
      try{
        if(c.state==='suspended')await c.resume();
        if(token!==loadSeq||active!==track)return;
        if(!globalAllowed()){stop(.12);return;}
        if(!preview&&(!live()&&!preMatch()||rallyActive)){
          // A decode that finishes after the next serve must not start a
          // presentation song in the middle of a rally.
          stop();return;
        }
        const source=c.createBufferSource();source.buffer=buffer;
        const envelope=c.createGain();envelope.gain.value=.00001;
        source.connect(envelope).connect(bus);
        const excerpt=!preview&&Number.isFinite(seconds);
        voice={source,envelope,track,excerpt};
        const now=c.currentTime;
        const level=musicLevel(track);
        envelope.gain.setValueAtTime(.00001,now);
        envelope.gain.linearRampToValueAtTime(Math.max(.00001,level),now+1.6);
        source.start(now);
        if(preview||excerpt){
          const end=Math.min(preview?12:seconds,buffer.duration-.1);
          const fade=Math.min(2.3,end*.35);
          envelope.gain.setValueAtTime(Math.max(.00001,level),now+end-fade);
          envelope.gain.linearRampToValueAtTime(.00001,now+end);
          source.stop(now+end+.04);
        }else source.stop(now+buffer.duration+.04);
        source.onended=()=>{
          try{source.disconnect();envelope.disconnect();}catch{}
          if(voice?.source!==source)return;
          voice=null;active=null;state.current=null;state.playing=false;
          state.cue='';state.lastStarted=performance.now();updateUI();
        };
        state.playing=true;state.cues++;if(preview)state.previews++;
        mixBus();
        updateUI();
      }catch(error){
        state.errors++;state.lastError=String(error);
        stop();
      }
    });
    updateUI();return true;
  }
  function enqueue(track,name,seconds,delay) {
    clearPending();
    pending=setTimeout(()=>{
      pending=null;
      if (globalAllowed() && (live()||preMatch()) && active===null) play(track,name,seconds);
    },delay);
  }

  function prepare(){
    if(introIssued || !preMatch() || !globalAllowed())return false;
    introIssued=true;
    state.preparing=true;
    state.firstWhistleSeen=false;
    state.preparedCount++;
    rallyActive=false;
    const track=chooseIntro();
    if(active===null&&pending===null)enqueue(track,'prematch-intro',null,90);
    return true;
  }
  function start() {
    // Kickoff occurs AFTER the tactic/starting-six selection, often with the
    // two 6.5s player-introduction panels. Keep the same song and position.
    state.introCount++;
    state.preparing=false;
    rallyActive=false;
    if(!introIssued){
      introIssued=true;
      state.firstWhistleSeen=false;
      const chosen=chooseIntro();
      if(active===null&&pending===null)enqueue(chosen,'presentation',null,250);
    }
  }
  function rallyStart() {
    rallyActive=true;
    clearPending();
    if(!state.firstWhistleSeen){
      state.firstWhistleSeen=true;
      state.preparing=false;
      state.firstWhistleDucks++;
    }
    mixBus();
  }
  function point(info) {
    rallyActive=false;
    state.lastPoint=info;
  }
  function setBreak() {
    rallyActive=false;
    state.setBreaks++;
    if(active===null&&pending===null)enqueue('sport','set-break',12,650);
  }
  function breakSignal() {
    if (!live() || !globalAllowed() || rallyActive) return false;
    if (performance.now()-state.lastStarted<45000 || pending!==null || active!==null) return false;
    enqueue('sport','timeout',9,750);
    return true;
  }
  function setEnabled(value) {
    state.enabled=!!value;
    save('enabled',state.enabled?'on':'off');
    if (!state.enabled){mixBus();stop(.12);}
    updateUI();
  }
  function setVolume(value) {
    state.volume=clamp(Number(value)||0,0,100);
    save('volume',state.volume);
    if(ctx&&volumeGain)volumeGain.gain.setTargetAtTime(state.volume/100,ctx.currentTime,.12);
    if (state.volume===0){mixBus();stop(.12);}
    updateUI();
  }
  function preview(track) {
    // Direct settings-button gesture: playable even outside a match.
    return play(track,'preview-'+track,null,{preview:true});
  }
  function monitor() {
    const inSetup=preMatch(),inGame=live()&&!inSetup;
    state.live=inGame;
    if(inSetup && !introIssued)prepare();
    if(!inGame&&!inSetup){
      // A user's explicit Rock/Drums preview can run from Settings even
      // outside a match. Only automatically started PA must stop here.
      if(!state.cue.startsWith('preview-') &&
         (active!==null || pending!==null))stop(3.0);
      introIssued=false;
      state.preparing=false;
      state.firstWhistleSeen=false;
      reviewActive=false;
      rallyActive=false;
    }
    if(!globalAllowed()&&(active!==null||pending!==null)){mixBus();stop(.12);}
    if(active!==null)mixBus();
  }
  const lexicon={
    es:['Música del pabellón','Megafonía musical','Volumen de la música',
      'Probar rock','Probar tambores','Detener','La música de presentación baja al empezar el juego. Las pausas tienen fragmentos breves.'],
    en:['Stadium PA music','Enable arena music','Music volume',
      'Test rock','Test drums','Stop','Presentation music fades into the background during play. Breaks use short excerpts.'],
    pt:['Música do pavilhão','Ativar música','Volume da música',
      'Testar rock','Testar tambores','Parar','A música de apresentação baixa durante o jogo. Os intervalos usam excertos curtos.']
  };
  function words() {
    let lang='en';
    try { lang=localStorage.getItem('vm.language')||'en'; } catch {}
    return lexicon[lang]||lexicon.en;
  }
  function updateUI() {
    if (!previewUI) return;
    previewUI.enabled.checked=state.enabled;
    previewUI.slider.value=String(state.volume);
    previewUI.percentage.textContent=state.volume+'%';
    previewUI.stop.disabled=!active;
    previewUI.rock.disabled=!state.enabled||state.volume===0;
    previewUI.drums.disabled=!state.enabled||state.volume===0;
  }
  function settings() {
    const group=(document.getElementsByClassName('prefs-panel').length?document.querySelector('.prefs-panel .settings-group'):null);
    const tab=(document.getElementsByClassName('prefs-tabs').length?document.querySelector('.prefs-tabs [role="tab"][aria-selected="true"]'):null);
    if (!group || !tab || !/sound|sonido|som/i.test(tab.textContent||'')) {
      previewUI=null; return;
    }
    if (group.querySelector('[data-vm-stadium-music]')) return;
    const lang=words();
    const section=document.createElement('section');
    section.dataset.vmStadiumMusic='1';
    section.style.cssText='border-top:1px solid #37516b;margin-top:12px;padding-top:12px;';
    const h=document.createElement('h4');h.textContent=lang[0];section.append(h);
    const onLabel=document.createElement('label');onLabel.className='settings-row';
    const onTitle=document.createElement('span');onTitle.textContent=lang[1];
    const toggle=document.createElement('input');toggle.type='checkbox';
    toggle.checked=state.enabled;
    toggle.addEventListener('change',()=>setEnabled(toggle.checked));
    onLabel.append(onTitle,toggle);section.append(onLabel);
    const volumeLabel=document.createElement('label');volumeLabel.className='settings-row';
    const volTitle=document.createElement('span');volTitle.textContent=lang[2];
    const percentage=document.createElement('small');
    volTitle.append(percentage);
    const slider=document.createElement('input');slider.type='range';
    slider.min='0';slider.max='100';slider.step='1';
    slider.setAttribute('aria-label',lang[2]);
    slider.addEventListener('input',()=>setVolume(slider.value));
    volumeLabel.append(volTitle,slider);section.append(volumeLabel);
    const buttons=document.createElement('div');
    buttons.style.cssText='display:flex;gap:8px;flex-wrap:wrap;margin:10px 0;';
    const makeButton=(label,click)=>{
      const b=document.createElement('button');b.type='button';b.textContent=label;
      b.style.cssText='padding:6px 12px;border-radius:7px;border:1px solid #46617f;color:inherit;background:transparent;cursor:pointer;';
      b.addEventListener('click',click);buttons.append(b);return b;
    };
    const rock=makeButton(lang[3],()=>preview('rock'));
    const drums=makeButton(lang[4],()=>preview('drums'));
    const stopButton=makeButton(lang[5],()=>stop(.15));
    section.append(buttons);
    const note=document.createElement('small');note.textContent=lang[6];section.append(note);
    group.append(section);
    previewUI={enabled:toggle,slider,percentage,rock,drums,stop:stopButton};
    updateUI();
  }
  const startObserve=()=>{
    if (!document.body) return;
    const observer=new MutationObserver(settings);
    observer.observe(document.body,{subtree:true,childList:true});
    settings();
  };
  if (document.readyState==='loading')
    document.addEventListener('DOMContentLoaded',startObserve,{once:true});
  else startObserve();

  // Prime the context on a user gesture (Electron Chromium autoplay policies).
  document.addEventListener('pointerdown',()=>{if (globalAllowed()) init()?.resume().catch(()=>{});},
    {capture:true,passive:true});
  document.addEventListener('keydown',()=>{if (globalAllowed()) init()?.resume().catch(()=>{});},
    {capture:true});
  window.addEventListener('blur',()=>{mutedByFocus=true;monitor();});
  window.addEventListener('focus',()=>{mutedByFocus=false;monitor();});
  document.addEventListener('visibilitychange',monitor);
  setInterval(monitor,400);

  // Real, validated events from the game bundle, NOT time guessed from DOM text.
  const events=window.__vmEvents;
  if (events) {
    events.on('match:start',start);
    events.on('match:point',point);
    events.on('match:set-break',setBreak);
    events.on('match:review:start',()=>{reviewActive=true;monitor();});
    events.on('match:review:end',()=>{reviewActive=false;monitor();});
  }
  window.__vmStadiumMusic=Object.freeze({
    version:'0.4.1', prepare, start, point, rallyStart, breakSignal, preview, stop,
    setEnabled, setVolume,
    getState:()=>Object.freeze({
      ...state,loaded:{...state.loaded}, musicFiles:Object.keys(TRACKS),
      bufferReady:[...buffers.keys()],loading:[...loading.keys()],
      decodedPlayback:true,reviewActive
    })
  });
})();
