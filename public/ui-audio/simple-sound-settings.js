/* 0.4.0 — Two sound sections. Legacy V16.6 settings are hidden ONLY
 * while the Sound tab is active; no original React/assets are modified.
 */
(() => {
  'use strict';
  if(window.__vmSimpleSoundSettings)return;
  const KEY='vm.v040.simpleAudioMigrated';
  const clamp=(v,a=0,b=100)=>Math.min(b,Math.max(a,v));
  const get=(key,def)=>{try{return localStorage.getItem(key)??def;}catch{return def;}};
  const put=(key,value)=>{try{localStorage.setItem(key,String(value));}catch{}};
  const menu=()=>window.__vmMenuScore;
  const match=()=>window.__vmMatchAudio;
  const pa=()=>window.__vmStadiumMusic;
  let group=null,panel=null,inputs=null,restored=new Map(),migrated=false;
  const translations={
    es:['Música de los menús','Canciones que cambian suavemente al navegar',
      'Sonidos del partido','Balón, público, silbatos y esfuerzos',
      'Volumen','Ahora suena: ','Cargando música…','Música desactivada','Error al cargar música local','Lista: empieza al navegar'],
    en:['Menu music','Gentle songs that rotate while browsing',
      'Match sounds','Ball, crowd, whistles and effort',
      'Volume','Now playing: ','Loading music…','Music disabled','Could not load local music','Ready: starts when browsing'],
    pt:['Música dos menus','Canções com transições suaves durante a navegação',
      'Sons do jogo','Bola, público, apitos e esforço',
      'Volume','A tocar: ','A carregar música…','Música desligada','Erro ao abrir música local','Pronta: começa ao navegar']
  };
  function words(){return translations[get('vm.language','en')]||translations.en;}
  function matchEnabled(){return get('vm.sound','on')!=='off';}
  function matchVolume(){
    const v=Number(get('vm.soundVolume','1'));
    return clamp(Number.isFinite(v)?Math.round(v*100):100);
  }
  function setMatchEnabled(value){
    put('vm.sound',value?'on':'off');
    if(value&&matchVolume()===0)put('vm.soundVolume',.8);
    match()?.setEnabled?.(value);
    pa()?.setEnabled?.(value);
    if(value&&pa()?.getState?.().volume===0)pa()?.setVolume?.(45);
    refresh();
  }
  function setMatchVolume(n){
    const level=clamp(Number(n)||0);
    put('vm.soundVolume',(level/100).toFixed(2));
    if(level===0)setMatchEnabled(false);
    else if(!matchEnabled())setMatchEnabled(true);
    refresh();
  }
  function migrate(){
    if(migrated||!menu()||!match()||!pa())return;
    migrated=true;
    if(get(KEY,'no')!=='yes'){
      if(matchEnabled()){
        match().setEnabled(true);
        for(const [name,level] of Object.entries({
          ambience:33,crowd:72,ball:75,voice:48
        }))match().setGain(name,level);
        pa().setEnabled(true);
        pa().setVolume(47);
      }
      put(KEY,'yes');
    }
  }
  function restore(){
    for(const [item,old] of restored){
      try{
        item.style.display=old.display;
        if(old.aria===null)item.removeAttribute('aria-hidden');
        else item.setAttribute('aria-hidden',old.aria);
      }catch{}
    }
    restored.clear();group=null;panel=null;inputs=null;
  }
  function hideOthers(target){
    for(const child of [...target.children]){
      if(child===panel)continue;
      if(!restored.has(child)){
        restored.set(child,{display:child.style.display,
          aria:child.getAttribute('aria-hidden')});
      }
      if(child.style.display!=='none')child.style.display='none';
      if(child.getAttribute('aria-hidden')!=='true')
        child.setAttribute('aria-hidden','true');
    }
  }
  function card(title,summary,id){
    const area=document.createElement('section');
    area.style.cssText='display:flex;flex-direction:column;gap:15px;padding:20px 22px;'+
      'border:1px solid #665746;border-radius:10px;background:#302820;';
    if(id==='match'){
      area.style.borderColor='#506c64';
      area.style.background='#23312e';
    }
    const headline=document.createElement('label');
    headline.style.cssText='display:flex;justify-content:space-between;align-items:center;'+
      'gap:14px;color:#f1f5fb;cursor:pointer;';
    const caption=document.createElement('span');
    caption.style.cssText='display:flex;flex-direction:column;gap:5px;min-width:0;';
    const h=document.createElement('strong');h.textContent=title;
    h.style.cssText='font-size:16px;font-weight:700;';
    const desc=document.createElement('small');desc.textContent=summary;
    desc.style.cssText='font-size:12px;line-height:1.5;color:#adbdce;';
    caption.append(h,desc);
    const toggle=document.createElement('input');toggle.type='checkbox';
    toggle.id='vm-simple-'+id+'-toggle';
    toggle.style.cssText='width:21px;height:21px;flex-shrink:0;accent-color:#f5b935;cursor:pointer;';
    headline.append(caption,toggle);
    const row=document.createElement('label');
    row.style.cssText='display:flex;flex-direction:column;gap:8px;'+
      'font-size:13px;color:#c6d6e7;';
    const sliderLabel=document.createElement('span');
    sliderLabel.style.cssText='display:flex;justify-content:space-between;gap:10px;';
    const labelText=document.createElement('span');labelText.textContent=words()[4];
    const amount=document.createElement('span');amount.style.cssText='font-variant-numeric:tabular-nums;';
    sliderLabel.append(labelText,amount);
    const slider=document.createElement('input');slider.type='range';
    slider.min='0';slider.max='100';slider.step='1';
    slider.style.cssText='display:block;width:100%;max-width:100%;accent-color:#f5b935;cursor:pointer;';
    row.append(sliderLabel,slider);
    const status=document.createElement('small');
    status.style.cssText='display:block;color:#95acc2;font-size:12px;line-height:1.5;min-height:18px;';
    area.append(headline,row,status);
    return {area,toggle,slider,amount,status};
  }
  function create(target){
    const lang=words();
    panel=document.createElement('div');
    panel.dataset.vmSimpleSound='1';
    panel.style.cssText='display:flex;flex-direction:column;gap:12px;'+
      'width:100%;max-width:100%;box-sizing:border-box;margin-top:8px;';
    const m=card(lang[0],lang[1],'menu');
    const p=card(lang[2],lang[3],'match');
    m.toggle.addEventListener('change',()=>menu()?.setEnabled(m.toggle.checked));
    m.slider.addEventListener('input',()=>menu()?.setVolume(Number(m.slider.value)));
    p.toggle.addEventListener('change',()=>setMatchEnabled(p.toggle.checked));
    p.slider.addEventListener('input',()=>setMatchVolume(Number(p.slider.value)));
    panel.append(m.area,p.area);
    target.prepend(panel);
    inputs={m,p};
    refresh();
  }
  function textIfChanged(element,value){
    if(element&&element.textContent!==value)element.textContent=value;
  }
  function refresh(){
    migrate();
    if(!inputs)return;
    const state=menu()?.getState?.(),m=inputs.m,p=inputs.p;
    m.toggle.checked=state?.enabled??false;
    m.slider.value=String(state?.volume??65);
    textIfChanged(m.amount,String(state?.volume??65)+'%');
    m.slider.disabled=!m.toggle.checked;
    const t=words();
    const names={
      comastudio:'Soft Minimal Contemporary · ComaStudio',
      lofi:'Chill Background Lo-Fi · whvle',
      corporate:'Corporate Technology · DELOSound'
    };
    const status=!state?.enabled?t[7]:state?.status==='error'?
      t[8]+(state.lastError?': '+state.lastError:''):state?.status==='loading'?
      t[6]:state?.playing?t[5]+(names[state?.track||state?.selected]||names.comastudio):t[9];
    textIfChanged(m.status,status);
    p.toggle.checked=matchEnabled();
    p.slider.value=String(matchVolume());
    textIfChanged(p.amount,matchVolume()+'%');
    p.slider.disabled=!p.toggle.checked;
    textIfChanged(p.status,'');
  }
  function settings(){
    const target=(document.getElementsByClassName('prefs-panel').length?document.querySelector('.prefs-panel .settings-group'):null);
    const tab=(document.getElementsByClassName('prefs-tabs').length?document.querySelector('.prefs-tabs [role="tab"][aria-selected="true"]'):null);
    const selected=!!(target&&tab&&/sound|sonido|som/i.test(tab.textContent||''));
    if(!selected){if(group)restore();return;}
    if(group&&group!==target)restore();
    group=target;
    if(!panel||panel.parentElement!==target)create(target);
    hideOthers(target);
    refresh();
  }
  function ready(){
    if(!document.body)return;
    new MutationObserver(settings).observe(document.body,{subtree:true,childList:true});
    settings();
  }
  if(document.readyState==='loading')
    document.addEventListener('DOMContentLoaded',ready,{once:true});
  else ready();
  setInterval(()=>{migrate();if(panel)refresh();},1200);
  window.__vmSimpleSoundSettings=Object.freeze({version:'0.4.0',refresh,
    getState:()=>({visible:!!panel,menu:menu()?.getState?.(),
      matchEnabled:matchEnabled(),matchVolume:matchVolume()})});
})();
