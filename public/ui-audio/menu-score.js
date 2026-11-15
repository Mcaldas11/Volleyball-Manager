/* 0.4.0 — Single menu soundtrack, deliberately based on V16.4's proven
 * fetch() + decodeAudioData() pipeline. Native <audio src="app://..."> media
 * streaming from Electron ASAR is NOT reliable and caused 0.3.9 silence.
 * Each source is the original, local, SHA-verified MP3 in the derived ASAR.
 */
(() => {
  'use strict';
  if(window.__vmMenuScore)return;
  const ROOT=new URL('../',document.currentScript?.src||document.baseURI);
  const LIVE='.content-live,.md-live,.lv-content,.lv-game,.match-live,.match-screen,.match-view';
  const KEY='vm.v039.menuMusic.';
  const TRACKS=Object.freeze([
    {id:'comastudio',name:'Soft Minimal Contemporary — ComaStudio',
      file:'match-v168/menu-comastudio.mp3',onset:.26,end:121.08,level:.45},
    {id:'lofi',name:'Chill Background Lo-Fi — whvle',
      file:'match-v168/menu-lofi.mp3',onset:.02,end:138.18,level:.55},
    {id:'corporate',name:'Corporate Technology — DELOSound',
      file:'match-v168/menu-corporate.mp3',onset:2.10,end:123.04,level:1.0}
  ]);
  const read=(key,def)=>{try{return localStorage.getItem(KEY+key)??def;}catch{return def;}};
  const save=(key,v)=>{try{localStorage.setItem(KEY+key,String(v));}catch{}};
  const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
  let enabled=read('enabled','on')!=='off';
  let volume=clamp(Number(read('volume',65))||0,0,100);
  let ctx=null,master=null,active=null,ui=null,selected=0,gestureUnlocked=false;
  let mutedByFocus=false,pausedForMatch=false,starts=0,crossfades=0,errors=0;
  let status='idle',lastError='',requestSeq=0,resumeIndex=0,resumeOffset=null;
  const cache=new Map(),inflight=new Map(),unavailable=new Set();
  function inMatch(){
    // The V16.6 team-selection/tactics screen is already match preparation.
    // Fade menu score before the stadium presentation music begins.
    return !!document.querySelector(LIVE) ||
      !!document.querySelector('button[data-tour="kickoff"]');
  }
  function allowed(){return enabled&&volume>0&&!document.hidden&&!mutedByFocus&&!inMatch();}
  // Keep V16.4's five OGG songs in the ASAR as historical assets, but do not
  // run TWO menu soundtracks at once. Disable the original controller once.
  function silenceLegacy(){
    try{
      const previous=window.__vmMusic;
      if(previous?.getState?.().enabled)previous.setEnabled(false);
      if(window.__vmChillBed?.getState?.().enabled)
        window.__vmChillBed.setEnabled(false);
    }catch{}
  }
  function init(){
    if(ctx)return ctx;
    const C=window.AudioContext||window.webkitAudioContext;
    if(!C){lastError='WebAudio unavailable';status='error';return null;}
    try{
      ctx=new C();
      master=ctx.createGain();master.gain.value=1;
      const limiter=ctx.createDynamicsCompressor();
      limiter.threshold.value=-15;limiter.ratio.value=3;limiter.knee.value=12;
      limiter.attack.value=.01;limiter.release.value=.35;
      master.connect(limiter).connect(ctx.destination);
      return ctx;
    }catch(e){errors++;lastError=String(e);status='error';return null;}
  }
  function getVolume(track){return clamp(volume/100*.64*track.level,0,.6);}
  function hold(param,time){
    if(typeof param.cancelAndHoldAtTime==='function'){
      try{param.cancelAndHoldAtTime(time);return;}catch{}
    }
    param.cancelScheduledValues(time);
    param.setValueAtTime(Math.max(.00001,param.value),time);
  }
  function blend(voice,target,seconds){
    const t=ctx.currentTime;
    hold(voice.gain.gain,t);
    voice.gain.gain.linearRampToValueAtTime(Math.max(.00001,target),t+seconds);
    voice.target=target;
  }
  async function decode(index){
    if(cache.has(index))return cache.get(index);
    if(inflight.has(index))return inflight.get(index);
    const track=TRACKS[index];
    const promise=(async()=>{
      if(!init())throw new Error('AudioContext unavailable');
      // The V16.4 engine decodes local OGG exactly this way. A streaming
      // HTMLAudioElement cannot be trusted in ASAR (even when it says "playing").
      const response=await fetch(new URL(track.file,ROOT),{cache:'force-cache'});
      if(!response.ok)throw new Error('Local track unavailable: '+response.status+' '+track.id);
      const raw=await response.arrayBuffer();
      if(raw.byteLength<10000)throw new Error('Local track is empty: '+track.id);
      const buffer=await ctx.decodeAudioData(raw.slice(0));
      if(!buffer || buffer.duration<8)throw new Error('Track decoding failed: '+track.id);
      cache.set(index,buffer);return buffer;
    })().catch(e=>{
      unavailable.add(index);errors++;lastError=String(e);
      status='error';return null;
    }).finally(()=>inflight.delete(index));
    inflight.set(index,promise);return promise;
  }
  function begin(index,buffer,{fade=2.4,offset=null}={}){
    if(!allowed()||!ctx||!buffer)return false;
    const track=TRACKS[index],t=ctx.currentTime;
    const usableEnd=Math.min(buffer.duration-.03,track.end);
    let from=offset===null?track.onset:Math.max(track.onset,offset);
    if(from>usableEnd-.6)from=track.onset;
    const duration=usableEnd-from;
    if(duration<.5)return false;
    const source=ctx.createBufferSource();
    source.buffer=buffer;
    const gain=ctx.createGain();gain.gain.value=.00001;
    source.connect(gain).connect(master);
    const voice={source,gain,index,offset:from,startedAt:t,endAt:t+duration,
      target:getVolume(track),fading:false};
    const prior=active;
    active=voice;selected=index;resumeIndex=index;resumeOffset=null;
    gain.gain.setValueAtTime(.00001,t);
    gain.gain.linearRampToValueAtTime(voice.target,t+Math.min(duration*.6,fade));
    try{
      source.start(t,from);
      // Stop only AFTER the measured audible tail; no source is interrupted
      // at a timer that guesses the length of an MP3.
      source.stop(voice.endAt+.04);
    }catch(e){errors++;lastError=String(e);active=prior;return false;}
    source.onended=()=>{
      try{source.disconnect();gain.disconnect();}catch{}
      if(active===voice){active=null;status='idle';}
    };
    if(prior&&prior!==voice){
      prior.fading=true;
      blend(prior,0,Math.min(fade,prior.endAt-t));
      // A scheduled second stop is legal in WebAudio and merely advances it.
      // Never stop before the end of the fade.
      try{prior.source.stop(t+Math.min(fade,Math.max(.04,prior.endAt-t))+.04);}catch{}
      crossfades++;
    }
    starts++;status='playing';pausedForMatch=false;updateUI();
    return true;
  }
  function nextIndex(){return (selected+1)%TRACKS.length;}
  async function start(index=selected,fade=2.6,offset=null){
    if(!allowed()||!gestureUnlocked)return false;
    const token=++requestSeq;
    status='loading';
    const buffer=await decode(index);
    if(token!==requestSeq||!allowed()){
      if(token===requestSeq)status='paused';
      return false;
    }
    if(!buffer){
      if(unavailable.size>=TRACKS.length){status='error';updateUI();return false;}
      return start((index+1)%TRACKS.length,2.5,null);
    }
    if(ctx.state==='suspended')await ctx.resume().catch(()=>{});
    if(token!==requestSeq||!allowed()){
      if(token===requestSeq)status='paused';
      return false;
    }
    return begin(index,buffer,{fade,offset});
  }
  function fadeAndRemember(seconds=3.2){
    requestSeq++; // no stale network completion may revive the soundtrack
    if(!active){status='paused';pausedForMatch=inMatch();updateUI();return;}
    const voice=active,now=ctx.currentTime;
    const consumed=Math.max(0,now-voice.startedAt);
    resumeIndex=voice.index;
    resumeOffset=voice.offset+consumed+Math.min(seconds,
      Math.max(0,voice.endAt-now));
    voice.fading=true;blend(voice,0,seconds);
    try{voice.source.stop(now+seconds+.045);}catch{}
    active=null;status='paused';pausedForMatch=inMatch();updateUI();
  }
  function monitor(){
    silenceLegacy();
    if(!allowed()){
      if(active)fadeAndRemember(3.2);
      return;
    }
    if(!gestureUnlocked)return;
    if(!active){
      if(status!=='loading')void start(resumeOffset!==null?resumeIndex:selected,
        2.5,resumeOffset);
      return;
    }
    if(active.fading)return;
    const now=ctx.currentTime,remaining=active.endAt-now;
    if(remaining<23 && unavailable.size<TRACKS.length)
      void decode(nextIndex()); // pre-decode during current song, no gap
    if(remaining<=5.0 && status!=='loading'){
      // The next theme arrives while the previous audible tail is fading.
      void start(nextIndex(),Math.max(1.0,Math.min(4.5,remaining)),null);
      return;
    }
    const target=getVolume(TRACKS[active.index]);
    if(Math.abs(target-active.target)>.006)blend(active,target,1.2);
  }
  function unlock(){
    gestureUnlocked=true;
    silenceLegacy();
    if(!allowed())return;
    const c=init();
    if(c?.state==='suspended')void c.resume().catch(()=>{});
    monitor();
  }
  function setEnabled(value){
    enabled=!!value;save('enabled',enabled?'on':'off');
    if(!enabled)fadeAndRemember(2.5);
    else{gestureUnlocked=true;monitor();}
    updateUI();
  }
  function setVolume(value){
    volume=clamp(Number(value)||0,0,100);save('volume',volume);
    if(volume===0)fadeAndRemember(2.5);
    else{if(active)blend(active,getVolume(TRACKS[active.index]),1.2);monitor();}
    updateUI();
  }
  // The only visible settings UI is owned by simple-sound-settings.js.
  function updateUI(){window.__vmSimpleSoundSettings?.refresh?.();}
  document.addEventListener('pointerdown',unlock,{capture:true,passive:true});
  document.addEventListener('keydown',unlock,{capture:true});
  window.addEventListener('blur',()=>{mutedByFocus=true;monitor();});
  window.addEventListener('focus',()=>{mutedByFocus=false;monitor();});
  document.addEventListener('visibilitychange',monitor);
  window.__vmEvents?.on?.('match:start',()=>fadeAndRemember(3.2));
  silenceLegacy();
  setInterval(monitor,650);
  window.__vmMenuScore=Object.freeze({
    version:'0.4.0',setEnabled,setVolume,monitor,start:unlock,
    getState:()=>({enabled,volume,track:active?.index!=null?TRACKS[active.index].id:null,
      selected:TRACKS[selected].id,playing:!!active&&!active.fading,
      pausedForMatch,starts,crossfades,errors,status,lastError,
      ready:[...cache.keys()].map(i=>TRACKS[i].id),
      unavailable:[...unavailable].map(i=>TRACKS[i].id)})
  });
})();