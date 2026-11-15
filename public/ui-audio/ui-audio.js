/* Volleyball Manager V16.1 - standalone, non-invasive UI audio.
 * Original short tones stored in ./sfx/. All normal game modules and match sounds are unchanged.
 * Only reacts to actual UI activation (not hover, scroll, or React renders).
 */
(() => {
  'use strict';
  if (window.__vmUiSound) return;
  const DIR = new URL('./', document.currentScript?.src || document.baseURI);
  const KEY_ON = 'vm.uiAudioEnabled';
  const KEY_VOL = 'vm.uiAudioVolume';
  const CUES = ['tap','navigate','select','open','close','toggle','confirm','warning','notify'];
  const GAIN = {tap:.58,navigate:.59,select:.58,open:.52,close:.5,toggle:.53,confirm:.65,warning:.55,notify:.64};
  const MIN_GAP = {tap:65,navigate:95,select:65,open:70,close:70,toggle:65,confirm:140,warning:200,notify:1400};
  const state = {enabled:readOn(),volume:readVolume(),ctx:null,master:null,bank:new Map(),ready:false,
    last:new Map(),lastInteraction:0,lastToastText:'',settingsInjected:0};
  let raw = new Map();
  let initializing = null;

  function readOn(){try{return localStorage.getItem(KEY_ON)!=='off';}catch{return true;}}
  function readVolume(){try{const x=Number(localStorage.getItem(KEY_VOL)??'24');return Number.isFinite(x)?Math.max(0,Math.min(100,x)):24;}catch{return 24;}}
  function write(k,v){try{localStorage.setItem(k,String(v));}catch{}}
  function setEnabled(b){state.enabled=!!b;write(KEY_ON,b?'on':'off');}
  function setVolume(n){state.volume=Math.max(0,Math.min(100,Number(n)||0));write(KEY_VOL,state.volume);if(state.master)state.master.gain.value=state.volume/100*.58;}

  // Prefetch local sounds without asking for audio permissions or playing anything.
  async function fetchAll(){
    const files = await Promise.all(CUES.map(async name => {
      try {const r=await fetch(new URL(`sfx/${name}.ogg`,DIR));
        return [name,r.ok?await r.arrayBuffer():null];} catch {return [name,null];}
    }));
    raw = new Map(files.filter(([,v])=>v!==null));
  }
  const fetchPromise=fetchAll();
  function ensureContext(){
    if(state.ctx)return state.ctx;
    const Audio=window.AudioContext || window.webkitAudioContext;
    if(!Audio)return null;
    try{
      const ctx=new Audio();const master=ctx.createGain();
      master.gain.value=state.volume/100*.58;
      master.connect(ctx.destination);
      state.ctx=ctx;state.master=master;
      return ctx;
    }catch{return null;}
  }
  async function decode(){
    if(state.ready)return;
    if(initializing)return initializing;
    const ctx=ensureContext();if(!ctx)return;
    initializing=(async()=>{
      await fetchPromise;
      const results=await Promise.all([...raw].map(async([name,bytes])=>{
        try{return[name,await ctx.decodeAudioData(bytes.slice(0))]}catch{return[name,null]}
      }));
      for(const [name,buffer] of results){if(buffer)state.bank.set(name,buffer)}
      state.ready=true;
    })();
    try{await initializing}catch{}finally{initializing=null;}
  }
  // No fallback beep if files are missing: a silent UI is better than a broken or annoying one.
  async function playCue(name,{force=false}={}){
    if(!CUES.includes(name)||!state.enabled||state.volume<=0||document.hidden)return;
    const now=performance.now();
    if(!force && now-(state.last.get(name)||-Infinity)<MIN_GAP[name])return;
    state.last.set(name,now);
    const ctx=ensureContext();if(!ctx)return;
    // Called synchronously by real user clicks; resume the context inside the gesture.
    if(ctx.state==='suspended')void ctx.resume();
    await decode();
    const buffer=state.bank.get(name);
    if(!buffer||!state.master)return;
    const src=ctx.createBufferSource(),gain=ctx.createGain();
    src.buffer=buffer;
    // Match action sounds should never compete with existing whistle/ball/crowd recordings.
    const inMatch=document.querySelector('.content-live,.lv-game,.lv-content,.md-live')!==null;
    gain.gain.value=(GAIN[name]||.5)*(inMatch?.42:1);
    src.connect(gain).connect(state.master);
    try{src.start(0)}catch{}
  }
  function chooseSound(el){
    const button=el.closest('button,[role="button"],[role="tab"],[role="option"],[role="menuitem"],a[href],input[type="checkbox"],select,[role="switch"],tr.clickable,.player-link,.cal-cell');
    if(!button || button.closest('[data-vm-uiaudio]'))return null;
    if(button.disabled || button.getAttribute('aria-disabled')==='true')return null;
    const cl=button.classList;
    const text=(button.getAttribute('aria-label')||button.getAttribute('title')||button.textContent||'').trim().slice(0,70).toLowerCase();
    if(button.matches('input[type="checkbox"],select,[role="switch"]') || cl.contains('seg')|| cl.contains('seg-btn'))return 'toggle';
    if(button.matches('[role="option"],tr.clickable,.player-link') || cl.contains('search-row') || cl.contains('dd-option'))return 'select';
    if(cl.contains('vm-primary-main')||button.matches('[role="menuitem"],.vm-nav-pop button')||cl.contains('prefs-tab')||cl.contains('side-item')||cl.contains('hdr-tab')||
       button.matches('[data-tour^="tab-"],.side-nav button,.hdr-tabs button,.cal-nav')||
       /^(home|inicio|plantilla|squad|cantera|academy|tácticas|tactics|finances|finanzas|training|entrenamiento|calendario|calendar|inbox|mensajes)$/.test(text))return 'navigate';
    if(cl.contains('dropdown')||cl.contains('dd-trigger')||cl.contains('select-trigger')||button.getAttribute('aria-haspopup'))return 'open';
    if(cl.contains('danger')||cl.contains('alert-bad')||/^(delete|remove|release|dismiss|eliminar|despedir|borrar)\b/.test(text))return 'warning';
    if(cl.contains('continue')||cl.contains('primary')||/^(confirm|accept|sign|save|confirmar|aceptar|guardar|fichar|continuar|continue|play match|jugar partido)\b/.test(text))return 'confirm';
    if(cl.contains('icon-btn') && /^(close|cerrar|back|atrás)/.test(text))return 'close';
    if(cl.contains('on')||button.getAttribute('aria-pressed')!==null)return 'toggle';
    return 'tap';
  }
  document.addEventListener('click',e=>{
    if(!state.enabled)return;
    if(!(e.target instanceof Element))return;
    const cue=chooseSound(e.target);
    if(!cue)return;
    state.lastInteraction=performance.now();
    void playCue(cue);
  },true);

  // A toast/new notification after a user action gets one soft chime; never during initial load.
  let initialQuiet=true;
  setTimeout(()=>{initialQuiet=false},2500);
  let observing=false;
  function observe(){
    if(observing||!document.body)return;
    observing=true;
    const mo=new MutationObserver(()=>{
      maybeSettings();
      const toast=document.querySelector('.toast[role="status"],.toast,.notification-toast');
      const message=toast?.textContent?.trim().slice(0,120)||'';
      if(!initialQuiet&&message&&message!==state.lastToastText&&performance.now()-state.lastInteraction<3000){
        state.lastToastText=message;
        void playCue('notify');
      }
      if(!message)state.lastToastText='';
    });
    mo.observe(document.body,{childList:true,subtree:true,characterData:false});
    maybeSettings();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',observe,{once:true});else observe();

  function locale(){try{return localStorage.getItem('vm.language')||'en'}catch{return 'en'}}
  function i18n(){const lang=locale();const translations={
    en:{title:'Interface sounds',on:'Menu sound effects',hint:'Soft clicks, navigation, selection and notifications.',vol:'Interface volume',test:'Test sound',quiet:'Independent from match volume. No sound while the app is in the background.'},
    es:{title:'Sonidos de interfaz',on:'Efectos de los menús',hint:'Clics suaves, navegación, selección y notificaciones.',vol:'Volumen de la interfaz',test:'Probar sonido',quiet:'Independiente del volumen del partido. Sin audio en segundo plano.'},
    pt:{title:'Sons da interface',on:'Efeitos sonoros dos menus',hint:'Cliques suaves, navegação, seleção e notificações.',vol:'Volume da interface',test:'Testar som',quiet:'Independente do volume do jogo. Sem áudio em segundo plano.'}
  };return translations[lang]||translations.en}
  function maybeSettings(){
    const group=document.querySelector('.prefs-panel .settings-group');
    const tab=document.querySelector('.prefs-tabs [role="tab"][aria-selected="true"]');
    if(!group||!tab||!/sound|sonido|som/i.test(tab.textContent||''))return;
    if(group.querySelector('[data-vm-uiaudio]'))return;
    const t=i18n();
    const section=document.createElement('section');section.className='vm-ui-sound-settings';section.dataset.vmUiaudio='1';
    section.setAttribute('aria-label',t.title);
    const title=document.createElement('h4');title.textContent=t.title;section.append(title);
    const check=document.createElement('label');check.className='settings-row vm-ui-check';
    const text=document.createElement('span');text.textContent=t.on;
    const small=document.createElement('small');small.textContent=t.hint;text.append(small);
    const enabled=document.createElement('input');enabled.type='checkbox';enabled.checked=state.enabled;
    enabled.addEventListener('change',()=>{setEnabled(enabled.checked);slider.disabled=!state.enabled;test.disabled=!state.enabled;if(state.enabled)void playCue('toggle',{force:true})});
    check.append(text,enabled);section.append(check);
    const volrow=document.createElement('div');volrow.className='settings-row';
    const vl=document.createElement('span');vl.textContent=t.vol;
    const vh=document.createElement('small');vh.textContent=state.volume+'%';vl.append(vh);
    const slider=document.createElement('input');slider.type='range';slider.className='prefs-range';slider.min='0';slider.max='100';slider.step='5';slider.value=String(state.volume);slider.disabled=!state.enabled;
    slider.setAttribute('aria-label',t.vol);
    slider.addEventListener('input',()=>{setVolume(Number(slider.value));vh.textContent=state.volume+'%'});
    slider.addEventListener('change',()=>void playCue('select',{force:true}));
    volrow.append(vl,slider);section.append(volrow);
    const footer=document.createElement('div');footer.className='vm-ui-sound-foot';
    const note=document.createElement('small');note.textContent=t.quiet;
    const test=document.createElement('button');test.type='button';test.className='sm';test.textContent=t.test;test.disabled=!state.enabled;
    test.addEventListener('click',()=>void playCue('confirm',{force:true}));
    footer.append(note,test);section.append(footer);
    group.append(section);
    state.settingsInjected++;
  }
  window.__vmUiSound={play:playCue,setEnabled,setVolume,getState:()=>({enabled:state.enabled,volume:state.volume,loaded:[...state.bank.keys()],settingsInjected:state.settingsInjected}),
    cues:[...CUES]};
})();
