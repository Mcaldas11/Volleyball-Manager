/* Volleyball Manager V16.4 — resilient music playback for Electron ASAR.
 * Electron file:// ASAR byte-range media streaming is unreliable; fetch + WebAudio decode
 * follows the same successful loading path as the short interface sounds.
 * Decode one local OGG at a time, no remote requests. A user gesture unlocks audio.
 */
(() => {
 'use strict';
 if(window.__vmMusic)return;
 const DIR=new URL('./',document.currentScript?.src || document.baseURI);
 const TRACKS=[['antes-del-saque','Antes del saque'],['tarde-de-pabellon','Tarde de pabellón'],['luces-del-vestuario','Luces del vestuario'],['dia-de-descanso','Día de descanso'],['ultima-rotacion','Última rotación']];
 const KEY_ENABLED='vm.musicEnabled',KEY_VOL='vm.musicVolume';
 const loadBool=(k,def)=>{try{return localStorage.getItem(k)!=='off'}catch{return def}};
 const loadNum=(k,def)=>{try{let n=Number(localStorage.getItem(k)??def);return Number.isFinite(n)?Math.max(0,Math.min(100,n)):def}catch{return def}};
 const save=(k,v)=>{try{localStorage.setItem(k,String(v))}catch{}};
 const state={enabled:loadBool(KEY_ENABLED,true),volume:loadNum(KEY_VOL,24),activated:false,manualPause:false,
   index:0,playing:false,match:false,settingsInjected:0,errors:0,loading:false,status:'ready',error:'',offset:0,startedAt:0};
 let ctx=null,master=null,source=null,currentBuffer=null,loadTask=null,generation=0,ui=null,windowFocused=true;
 const cached=new Map();
 const clip=i=>new URL(`music/${TRACKS[i][0]}.ogg`,DIR);
 function inMatch(){return !!document.querySelector('.content-live,.md-live,.lv-content,.lv-game,.match-live,.match-screen,.match-view')}
 function eligible(){return state.enabled&&state.volume>0&&state.activated&&!state.manualPause&&!document.hidden&&windowFocused&&!inMatch()}
 function gain(){return state.volume/100*.85}
 function ensureContext(){
   if(ctx)return ctx;
   const C=window.AudioContext||window.webkitAudioContext;
   if(!C){state.error='WebAudio unavailable';state.status='error';return null}
   try{ctx=new C();master=ctx.createGain();master.gain.value=gain();master.connect(ctx.destination);return ctx}
   catch(e){state.error=String(e);state.status='error';return null}
 }
 function unlock(){state.activated=true;const c=ensureContext();if(c&&c.state==='suspended')void c.resume().catch(()=>{});return c}
 async function loadTrack(i){
   if(cached.has(i))return cached.get(i);
   if(loadTask?.i===i)return loadTask.promise;
   const c=ensureContext();if(!c)throw Error('No AudioContext');
   state.loading=true;state.status='loading';updateControls();
   const task=(async()=>{
     const response=await fetch(clip(i).href,{cache:'force-cache'});
     if(!response.ok)throw Error(`Track ${i+1}: HTTP ${response.status}`);
     const raw=await response.arrayBuffer();
     if(raw.byteLength<1000)throw Error('Empty music track');
     const buffer=await c.decodeAudioData(raw);
     cached.set(i,buffer);
     while(cached.size>2)cached.delete(cached.keys().next().value);
     return buffer;
   })();
   loadTask={i,promise:task};
   try{return await task}
   finally{if(loadTask?.promise===task)loadTask=null;state.loading=false;updateControls()}
 }
 function stop({keepOffset=true}={}){
   ++generation;
   if(source){
     if(keepOffset&&ctx&&state.playing&&currentBuffer){state.offset=(ctx.currentTime-state.startedAt)%currentBuffer.duration}
     const s=source;source=null;s.onended=null;try{s.stop()}catch{}try{s.disconnect()}catch{}
   }
   state.playing=false;
 }
 async function play(){
   if(!eligible()){if(source)stop();state.match=inMatch();updateControls();return false}
   const c=unlock();if(!c)return false;
   if(ctx.state==='suspended'){try{await ctx.resume()}catch(e){state.error=String(e);state.status='error';updateControls();return false}}
   if(source&&state.playing)return true;
   const token=++generation,idx=state.index;
   try{
     const buffer=await loadTrack(idx);
     if(token!==generation||!eligible()||idx!==state.index)return false;
     currentBuffer=buffer;
     const s=ctx.createBufferSource();s.buffer=buffer;s.connect(master);
     const offset=state.offset%buffer.duration;
     s.onended=()=>{if(source!==s)return;source=null;state.playing=false;state.offset=0;state.index=(state.index+1)%TRACKS.length;currentBuffer=null;updateControls();void play()};
     source=s;state.startedAt=ctx.currentTime-offset;master.gain.value=gain();
     s.start(0,offset);state.playing=true;state.status='playing';state.error='';updateControls();return true;
   }catch(e){
     if(token!==generation)return false;
     state.errors++;state.status='error';state.error=String(e?.message||e);state.playing=false;updateControls();return false;
   }
 }
 function pause(){state.manualPause=true;stop();state.status='paused';updateControls()}
 function resume(){state.manualPause=false;unlock();void play();updateControls()}
 function setEnabled(v){state.enabled=!!v;save(KEY_ENABLED,state.enabled?'on':'off');if(!v){stop();state.status='disabled'}else{state.manualPause=false;unlock();void play()}updateControls()}
 function setVolume(v){state.volume=Math.max(0,Math.min(100,Number(v)||0));save(KEY_VOL,state.volume);if(master)master.gain.value=gain();if(!state.volume){stop();state.status='paused'}else if(eligible()&&!source)void play();updateControls()}
 function next(){stop({keepOffset:false});state.index=(state.index+1)%TRACKS.length;state.offset=0;state.manualPause=false;unlock();void play();updateControls()}
 function retry(){stop({keepOffset:false});cached.delete(state.index);state.error='';state.offset=0;state.manualPause=false;unlock();void play()}
 let lastEligible=false;
 function monitor(){state.match=inMatch();const allowed=eligible();if(!allowed){if(source)stop();if(state.match){state.status='paused';updateControls()}lastEligible=false;return}if(!lastEligible||(!source&&!state.loading&&state.status!=='error'))void play();lastEligible=true}
 document.addEventListener('pointerdown',e=>{if(!e.isTrusted)return;unlock();if(eligible()&&!state.playing)void play()},{capture:true,passive:true});
 document.addEventListener('keydown',e=>{if(!e.isTrusted||e.repeat)return;unlock();if(eligible()&&!state.playing)void play()},{capture:true});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();else monitor()});
 window.addEventListener('blur',()=>{windowFocused=false;if(source)stop();state.status='paused';updateControls()});
 window.addEventListener('focus',()=>{windowFocused=true;monitor()});
 setInterval(monitor,350);
 function tr(){let l='en';try{l=localStorage.getItem('vm.language')||'en'}catch{};return ({
   en:{title:'Background music',enabled:'Relaxing background music',hint:'Five original instrumental tracks. Silent during matches.',vol:'Music volume',now:'Track',next:'Next track',pause:'Pause music',resume:'Play music',retry:'Retry playback',loading:'Loading audio…',playing:'Playing',error:'Cannot play this track',ready:'Ready to play',note:'Music plays outside live matches only. Your changes are saved automatically.'},
   es:{title:'Música ambiental',enabled:'Música relajante de fondo',hint:'Cinco temas originales. Se detiene durante los partidos.',vol:'Volumen de música',now:'Canción',next:'Siguiente canción',pause:'Pausar música',resume:'Reproducir música',retry:'Reintentar audio',loading:'Cargando audio…',playing:'Reproduciendo',error:'No se puede reproducir',ready:'Lista para escuchar',note:'Solo suena fuera de los partidos. Los cambios se guardan automáticamente.'},
   pt:{title:'Música ambiente',enabled:'Música relaxante de fundo',hint:'Cinco temas originais. Pausa durante os jogos.',vol:'Volume da música',now:'Música',next:'Próxima música',pause:'Pausar música',resume:'Reproduzir música',retry:'Tentar novamente',loading:'A carregar áudio…',playing:'A tocar',error:'Não foi possível reproduzir',ready:'Pronta para ouvir',note:'Só toca fora dos jogos. As alterações são guardadas automaticamente.'}
 })[l]||({en:{}}).en}
 function updateControls(){if(!ui?.section.isConnected)return;const t=tr();ui.enabled.checked=state.enabled;ui.range.disabled=!state.enabled;ui.range.value=String(state.volume);ui.pct.textContent=state.volume+'%';ui.track.textContent=`${t.now}: ${TRACKS[state.index][1]} (${state.index+1}/${TRACKS.length})`;
 ui.status.textContent=state.status==='error'?`${t.error}: ${state.error}`:state.loading?t.loading:state.playing?t.playing:t.ready;
 ui.status.classList.toggle('vm-music-error',state.status==='error');ui.next.disabled=!state.enabled;ui.pause.disabled=!state.enabled;ui.pause.textContent=state.manualPause||!state.playing?t.resume:t.pause;ui.retry.hidden=state.status!=='error'}
 function maybeSettings(){const group=document.querySelector('.prefs-panel .settings-group'),tab=document.querySelector('.prefs-tabs [role="tab"][aria-selected="true"]');if(!group||!tab||!/sound|sonido|som/i.test(tab.textContent||'')){ui=null;return}if(group.querySelector('[data-vm-music]'))return;const t=tr(),section=document.createElement('section');section.dataset.vmMusic='1';section.className='vm-music-settings';section.setAttribute('aria-label',t.title);
 const h=document.createElement('h4');h.textContent=t.title;section.append(h);
 const label=document.createElement('label');label.className='settings-row vm-music-check';const txt=document.createElement('span');txt.textContent=t.enabled;const hint=document.createElement('small');hint.textContent=t.hint;txt.append(hint);const enabled=document.createElement('input');enabled.type='checkbox';enabled.checked=state.enabled;enabled.addEventListener('change',()=>setEnabled(enabled.checked));label.append(txt,enabled);section.append(label);
 const line=document.createElement('div');line.className='settings-row';const lt=document.createElement('span');lt.textContent=t.vol;const pct=document.createElement('small');pct.textContent=state.volume+'%';lt.append(pct);const range=document.createElement('input');range.type='range';range.className='prefs-range';range.min='0';range.max='100';range.step='2';range.value=String(state.volume);range.addEventListener('input',()=>setVolume(range.value));line.append(lt,range);section.append(line);
 const track=document.createElement('p');track.className='vm-music-track';section.append(track);
 const status=document.createElement('p');status.className='vm-music-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');section.append(status);
 const controls=document.createElement('div');controls.className='vm-music-buttons';const pauseBtn=document.createElement('button');pauseBtn.type='button';pauseBtn.className='sm';pauseBtn.addEventListener('click',()=>state.playing?pause():resume());
 const nextBtn=document.createElement('button');nextBtn.type='button';nextBtn.className='sm';nextBtn.textContent=t.next;nextBtn.addEventListener('click',next);const retryBtn=document.createElement('button');retryBtn.type='button';retryBtn.className='sm';retryBtn.textContent=t.retry;retryBtn.addEventListener('click',retry);controls.append(pauseBtn,nextBtn,retryBtn);section.append(controls);
 const note=document.createElement('small');note.className='vm-music-note';note.textContent=t.note;section.append(note);group.append(section);ui={section,enabled,range,pct,track,status,pause:pauseBtn,next:nextBtn,retry:retryBtn};state.settingsInjected++;updateControls()}
 function observe(){if(!document.body)return;new MutationObserver(maybeSettings).observe(document.body,{childList:true,subtree:true});maybeSettings()}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',observe,{once:true});else observe();
 window.__vmMusic={getState:()=>({...state,bufferReady:!!currentBuffer,contextState:ctx?.state||'not-created',sourceActive:!!source}),setEnabled,setVolume,next,play:resume,pause,sync:monitor,retry,tracks:TRACKS.map(t=>({file:t[0]+'.ogg',name:t[1]}))};
})();