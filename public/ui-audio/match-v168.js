/* Volleyball Manager Dev 0.3.6 — independent live-match effects under Stadium Sound Director.
 * Synchronised by four audited V16.6 bundle hooks; no screen or engine changes.
 * Sources: existing in-game CC0 volleyball recordings; optional Mixkit crowd
 * sounds added to the packaged ASAR by fetch_optional_audio.py.
 * If this module or its files fail, original sounds remain the fallback.
 * V16.10: reaction score and real rally contact count drive supporter reactions.
 * No voices are synthesised; "Come on!" plays only when a licensed sample exists.
 * V16.9: real pose names from the original rally timeline choose per-action hits,
 * with rare low-level human effort only on genuine strenuous actions.
 */
(() => {
  'use strict';
  if (window.__vmMatchAudio) return;
  const ROOT = new URL('../', document.currentScript?.src || document.baseURI);
  const LIVE = '.content-live';
  const BANK = {
    whistle: 'sounds/whistle.wav',
    buzzer: 'sounds/buzzer.wav',
    spike1: 'sounds/spike-1.wav',
    spike2: 'sounds/spike-2.wav',
    touch1: 'sounds/touch-1.wav',
    touch2: 'sounds/touch-2.wav',
    touch3: 'sounds/touch-3.wav',
    crowd: 'sounds/crowd.wav',
    light: 'match-v168/crowd-light.wav',
    victory: 'match-v168/crowd-victory.wav',
    chant: 'match-v168/crowd-chant.wav',
    setTap: 'match-v168/ball-tap.wav',
    effort: 'match-v168/effort-strike.wav',
    chantStadium: 'match-v168/chant-stadium.mp3',
    chantResponse: 'match-v168/chant-response.mp3',
    crowdStomp: 'match-v168/crowd-stomp.mp3',
    crowdGasp: 'match-v168/crowd-gasp.mp3',
    supporterDrum: 'match-v168/supporter-drum.mp3',
    comeOn: 'match-v168/come-on.mp3',
    victoryWoo: 'match-v168/victory-woohoo.mp3',
    stadiumMurmur: 'match-v168/stadium-murmur.mp3',
    stadiumDistant: 'match-v168/stadium-distant.mp3',
    stadiumTense: 'match-v168/stadium-tense.mp3',
    stadiumWhistle: 'match-v168/stadium-whistles.mp3',
    stadiumCheer: 'match-v168/stadium-cheer.mp3',
    stadiumApplause: 'match-v168/stadium-applause.mp3',
    stadiumBoo: 'match-v168/stadium-boo.mp3',
    stadiumDisappointed: 'match-v168/stadium-disappointed.mp3',
    stadiumOoh: 'match-v168/stadium-ooh.mp3',
    stadiumAww: 'match-v168/stadium-aww.mp3',
    stadiumHorn: 'match-v168/stadium-horn.mp3',
    stadiumDistantCheer: 'match-v168/stadium-distant-cheer.mp3',
    stadiumBigApplause: 'match-v168/stadium-big-applause.mp3',
    mixDrums: 'match-v168/crowd-drums.wav',
    mixWhistles: 'match-v168/crowd-whistles.wav',
    mixAngry: 'match-v168/crowd-angry.wav',
    mixAudience: 'match-v168/crowd-audience.wav',
    mixClapping: 'match-v168/crowd-clapping.wav',
    mixAuditorium: 'match-v168/crowd-auditorium.wav',
    userApplauseLong: 'match-v168/user-long-applause.mp3',
    userEncouragement: 'match-v168/user-encouragement.mp3',
    userMistake: 'match-v168/user-crowd-error.mp3'
  };
  const KEY = 'vm.v168.audio.';
  const channels = ['ambience', 'crowd', 'ball', 'voice'];
  const defaults = { ambience: 25, crowd: 65, ball: 72, voice: 32 };
  const read = (name, fallback) => { try { return localStorage.getItem(KEY + name) ?? fallback; } catch { return fallback; } };
  const save = (name, value) => { try { localStorage.setItem(KEY + name, String(value)); } catch {} };
  const clamp = (x, low = 0, high = 1) => Math.max(low, Math.min(high, x));
  const setting = (name) => clamp(Number(read(name, defaults[name])) || 0, 0, 100);
  const state = {
    enabled: read('enabled', 'on') !== 'off',
    gains: Object.fromEntries(channels.map(k => [k, setting(k)])),
    ready: false, started: false, active: false, optionalLoaded: 0,
    last: {}, lastHit: '', lastPose: '', effortCount: 0, errors: 0, matchStart: null,
    lastPointKey: '', lastSupportName: '', lastSupportAt: -Infinity,
    trailingRallies: 0, chantsPlayed: 0, bigRallies: 0,
    gaspsPlayed: 0, encouragementsPlayed: 0, lastPoint: null,
    reviewActive: false, pendingIntro: false, reviewSeq: null,
    lastCueAt: -Infinity, lastChantAt: -Infinity, ambientUntil: 0,
    recentCues: [], ambientName: '', lastCue: '',
    cueCounts: {}, stadiumCues: 0, reviewCues: 0,
    supportingSide: null, lastCueKind: '', pointCheers: 0, layeredChants: 0, ambienceSwaps: 0,
    ballContacts: 0, ballFallbacks: 0, joyfulShouts: 0, ralliesSinceChant: 0,
    ambientNextAt: 0, ambientPauses: 0, lastCueByKind: {},
    paused: false, pauseEvents: 0, localLibraryLoaded: 0,
    measuredStarts: 0, crossfades: 0
  };
  let ctx = null, master = null, buses = {}, ambience = null, buffers = new Map();
  let loading = null, raw = new Map(), ui = null, mutedByFocus = false;
  const libraryProfiles=new Map();
  const reactiveSounds = new Set();
  const applauseVoices = new Set();
  const liveVoices = new Set();
  const director = () => window.__vmSoundDirector;
  let speaking = null;
  state.commentaryEnabled = read('commentaryEnabled','off') === 'on';
  state.commentaryPlayed = 0;
  state.applauseFades = 0;
  state.lastApplause = '';
  const isLive = () => !!document.querySelector(LIVE);
  const baseEnabled = () => {
    try {
      if (localStorage.getItem('vm.sound') === 'off') return false;
      const value = Number(localStorage.getItem('vm.soundVolume') ?? '1');
      return Number.isFinite(value) && value > 0;
    } catch { return true; }
  };
  const fullGain = () => {
    try { return clamp(Number(localStorage.getItem('vm.soundVolume') ?? '1')); }
    catch { return 1; }
  };
  const allowed = () => state.matchStart !== null && isLive() && !state.paused &&
    !document.hidden && !mutedByFocus && baseEnabled() && state.enabled;

  // All 25 known SFX and 4 music files are SHA-checked during packaging.
  // Read the copied catalog once on launch. Never fetch from external providers.
  const fetching=(async()=>{
    const entries=Object.entries(BANK);
    try {
      const response=await fetch(new URL('match-v168/library-manifest.json',ROOT),
        {cache:'force-cache'});
      if(response.ok){
        const catalog=await response.json();
        if(catalog.version==='0.3.9'&&Array.isArray(catalog.assets)){
          for(const profile of catalog.assets){
            if(profile.enabled!==true || !['ambience','crowd','voice','referee','court']
                .includes(profile.role) || !profile.key ||
                typeof profile.target!=='string' ||
                !profile.target.startsWith('dist/match-v168/library/'))continue;
            libraryProfiles.set(profile.key,profile);
            entries.push([profile.key,profile.target.slice(5)]);
          }
        }
      }
    }catch{state.errors++;}
    await Promise.all(entries.map(async ([key,path])=>{
      try {
        const response=await fetch(new URL(path,ROOT),{cache:'force-cache'});
        if(!response.ok)return;
        const data=await response.arrayBuffer();
        if(data.byteLength<250)return;
        raw.set(key,data);
      }catch{/* Original bundled effects are always available as fallback. */}
    }));
    state.localLibraryLoaded=[...libraryProfiles.keys()]
      .filter(name=>raw.has(name)).length;
  })();
  function profileGain(name){
    const profile=libraryProfiles.get(name);
    if(!profile)return 1;
    const targets={ambience:-23,crowd:-21,voice:-24,referee:-24,court:-27};
    const desired=targets[profile.role]??-22;
    const rms=Number(profile.rms_dbfs);
    const corrected=Number.isFinite(rms)?Math.pow(10,(desired-rms)/20):1;
    // Quiet samples get lifted, but peak guard prevents unexpected clipping.
    const peak=Number(profile.peak_dbfs);
    const peakLimit=Number.isFinite(peak)?Math.pow(10,(-2-peak)/20):2.2;
    return clamp(Math.min(corrected,peakLimit,2.2),.4,2.2);
  }
  function usefulEnd(name,buffer){
    const profile=libraryProfiles.get(name);
    const audible=Number(profile?.audible_end_s);
    return Math.max(.12,Math.min(buffer.duration-.01,
      Number.isFinite(audible)&&audible>0?audible:buffer.duration-.01));
  }
  function audibleStart(name){
    const value=Number(libraryProfiles.get(name)?.onset_s??0);
    return Number.isFinite(value)?clamp(value,0,2):0;
  }
  function context() {
    if (ctx) return ctx;
    const Constructor = window.AudioContext || window.webkitAudioContext;
    if (!Constructor) return null;
    try {
      ctx = new Constructor();
      master = ctx.createGain();
      master.gain.value = fullGain() * 0.85;
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -14;
      limiter.knee.value = 16;
      limiter.ratio.value = 3;
      limiter.attack.value = .005;
      limiter.release.value = .22;
      master.connect(limiter).connect(ctx.destination);
      for (const name of channels) {
        const gain = ctx.createGain();
        gain.gain.value = state.gains[name] / 100;
        gain.connect(master);
        buses[name] = gain;
      }
      return ctx;
    } catch {
      state.errors++; ctx = null; return null;
    }
  }
  function decode() {
    if (state.ready) return Promise.resolve(true);
    if (loading) return loading;
    const c = context();
    if (!c) return Promise.resolve(false);
    loading = (async () => {
      await fetching;
      const entries = await Promise.all([...raw].map(async ([name, data]) => {
        try { return [name, await c.decodeAudioData(data.slice(0))]; }
        catch { return [name, null]; }
      }));
      for (const [name, buffer] of entries) if (buffer) buffers.set(name, buffer);
      state.optionalLoaded = ['light', 'victory', 'chant'].filter(name => buffers.has(name)).length;
      // Decode channels independently. A missing whistle/ball file must not
      // disable a perfectly valid crowd sample; each handler has its own
      // original-game fallback if its particular sample is missing.
      state.ready = buffers.size > 0;
      return state.ready;
    })().catch(() => { state.errors++; return false; }).finally(() => { loading = null; });
    return loading;
  }
  function unlock() {
    state.started = true;
    const c = context();
    if (c?.state === 'suspended') void c.resume().catch(() => {});
    if (c) void decode();
    return c;
  }
  function source(name, bus, volume, options = {}) {
    const buffer = buffers.get(name), c = ctx;
    if (!buffer || !c || !buses[bus]) return null;
    const end=usefulEnd(name,buffer);
    const from=clamp(Math.max(options.from??0,
      options.trim===false?0:audibleStart(name)),0,Math.max(0,end-.08));
    const duration=Math.min(options.length??end-from,end-from);
    if (duration <= .03) return null;
    const player = c.createBufferSource();
    player.buffer = buffer;
    player.playbackRate.value = options.rate ?? 1;
    player.loop = !!options.loop;
    const envelope = c.createGain();
    const now = c.currentTime + Math.max(0, options.delay ?? 0);
    const target = clamp(volume*profileGain(name),.0001,.82);
    let endsAt=Infinity;
    if(libraryProfiles.has(name))state.measuredStarts++;
    if (player.loop) {
      envelope.gain.setValueAtTime(.0001, now);
      envelope.gain.linearRampToValueAtTime(target, now + (options.fadeIn ?? 2.0));
      player.loopStart=from;
      player.loopEnd=Math.max(from+.09,end-.04);
      player.start(now,from);
    } else {
      const actual = duration / player.playbackRate.value;
      endsAt=now+actual;
      const attack=Math.min(options.fadeIn??.06,actual/4);
      const release=Math.min(actual*.8,options.fadeOut??.16);
      envelope.gain.setValueAtTime(.0001, now);
      envelope.gain.linearRampToValueAtTime(target,now+attack);
      envelope.gain.setValueAtTime(target,Math.max(now+attack,endsAt-release));
      envelope.gain.linearRampToValueAtTime(.0001,endsAt);
      player.start(now, from, duration);
    }
    player.connect(envelope).connect(buses[bus]);
    const voice = { player, envelope, endsAt };
    liveVoices.add(voice);
    player.onended = () => {
      liveVoices.delete(voice);
      try { player.disconnect(); envelope.disconnect(); } catch {}
    };
    return voice;
  }
  const between = (a, b) => a + Math.random() * (b - a);
  const throttle = (key, millis) => {
    const now = performance.now();
    if (now - (state.last[key] ?? -Infinity) < millis) return false;
    state.last[key] = now; return true;
  };
  function canIntercept() {
    if (!isLive()) return false; // Splash screen and menus keep existing audio.
    if (state.paused) return true; // Suppress original fallback during manual pause.
    if (!state.enabled || !baseEnabled() || document.hidden || mutedByFocus) return true;
    unlock();
    if (!state.ready || !ctx || ctx.state !== 'running') return false; // Original fallback until ready.
    return true;
  }
  // A point with three contacts needs a short reaction; a long rally or a
  // decisive set point deserves sustained applause. These are real simulation
  // contact counts, not animation duration inferred from a UI timer.
  function applauseTiming(point) {
    const n=Number.isFinite(point?.contacts)?point.contacts:0;
    if(point?.setFinished)return {duration:7.8,release:3.0,whistle:1.8};
    if(point?.spectacular||n>=9)return {duration:6.2,release:2.5,whistle:1.55};
    if(point?.clutch||n>=6)return {duration:4.9,release:2.1,whistle:1.3};
    if(n>=4)return {duration:3.9,release:1.65,whistle:1.05};
    return {duration:2.9,release:1.3,whistle:.85};
  }
  function fadeApplause() {
    if (!ctx || !applauseVoices.size) return;
    const now = ctx.currentTime;
    for (const voice of [...applauseVoices]) {
      const end=now+(voice.whistleFade??.85);
      // An earlier natural fade must never be extended by a late whistle.
      if(end>=voice.endsAt)continue;
      try {
        const gain=voice.envelope.gain;
        if (typeof gain.cancelAndHoldAtTime==='function')
          gain.cancelAndHoldAtTime(now);
        else {
          gain.cancelScheduledValues(now);
          gain.setValueAtTime(Math.max(.0001, gain.value), now);
        }
        gain.linearRampToValueAtTime(.0001,end);
        voice.player.stop(end);
        state.applauseFades++;
      } catch {}
    }
    applauseVoices.clear();
  }
  function whistle(kind='serve') {
    if(kind==='serve'){
      director()?.whistle?.();
      fadeApplause();
    }
    if (!canIntercept()) return false;
    if (!allowed() || !state.ready || !throttle('whistle', 170)) return true;
    const sample=buffers.has('refWhistle') && Math.random()<.30
      ? 'refWhistle' : 'whistle';
    const played=source(sample,'ball',between(.075,.095),
      {rate:between(.96,1.03),fadeIn:.008,fadeOut:.18});
    if(played)director()?.note?.('referee',kind==='review'?'review whistle':'whistle',.5);
    return !!played;
  }
  // The game calls this with the actor's real animated pose, not just "hard".
  // Defensive contacts are short and dry, while a jump spike has a lower pitch
  // and greater attack. Only genuinely strong actions may produce effort voices.
  const CONTACTS = {
    receive: { pool: ['touch1','touch3'], gain: [.16,.22], rate: [.96,1.08] },
    pass:    { pool: ['touch1','touch2'], gain: [.15,.21], rate: [.96,1.09] },
    set:     { pool: ['touch2','touch3','setTap'], gain: [.12,.17], rate: [1.01,1.14] },
    dig:     { pool: ['touch1','touch3'], gain: [.18,.24], rate: [.88,1.02] },
    block:   { pool: ['spike2','touch3'], gain: [.20,.28], rate: [.87,1.00] },
    spike:   { pool: ['spike1','spike2'], gain: [.30,.41], rate: [.91,1.07] },
    serve:   { pool: ['spike1','spike2'], gain: [.23,.31], rate: [.95,1.09] },
    jump:    { pool: ['spike1','spike2'], gain: [.26,.35], rate: [.94,1.06] },
    jumpFloat: { pool: ['touch2','spike1'], gain: [.20,.28], rate: [.96,1.08] },
    float:   { pool: ['touch2','spike1'], gain: [.17,.25], rate: [1.00,1.12] }
  };
  const classifyPose = (hard, pose) =>
    Object.hasOwn(CONTACTS, pose) ? pose : (hard ? 'spike' : 'pass');
  function effort(pose) {
    // A human effort grunt should be a small accent, not a shout on every touch.
    // The optional Mixkit "Kung fu strike with effort" contains a brief human
    // exertion vocalisation: play it quietly and only on selected spike/digs.
    // Human exertion must be occasionally recognisable above ball and crowd.
    const chance = pose === 'spike' ? .28 : pose === 'jump' ? .16 :
      pose === 'dig' ? .08 : pose === 'block' ? .12 : 0;
    if(chance===0||state.gains.voice<=0||Math.random()>=chance||!throttle('effort',2100))return;
    const names=['gruntA','gruntB','effort'].filter(name=>buffers.has(name));
    if(!names.length)return;
    const sample=pickSound(names)??names[0];
    const played=source(sample,'voice',between(.22,.29),{
      rate:between(.95,1.06),
      length:Math.min(.9,usefulEnd(sample,buffers.get(sample))-.04),
      fadeIn:.025,fadeOut:.18
    });
    if(played)state.effortCount++;
  }
  function courtFootstep(action) {
    if(!['receive','dig','spike','jump','block','serve'].includes(action) ||
        Math.random()>.38 || !throttle('shoe',650))return;
    const samples=['sneakerSharp','sneakerStop','sneakerCourt'].filter(x=>buffers.has(x));
    if(!samples.length)return;
    const name=pickSound(samples)||samples[0];
    const clip=buffers.get(name);
    source(name,'ball',between(.065,.105),{
      length:Math.min(name==='sneakerSharp'?.38:1.1,
        usefulEnd(name,clip)-audibleStart(name)-.015),
      fadeIn:.025,fadeOut:.22,delay:.015
    });
  }
  function hit(hard, pose) {
    // Every simulated contact must have an audible transient. The old 60-82ms
    // global throttle discarded quick contacts and returned true (silence).
    // WebAudio buffer sources naturally support overlapping contacts.
    if (!canIntercept()) return false;
    if (!allowed() || !state.ready) return true;
    const action = classifyPose(hard, pose);
    const spec = CONTACTS[action];
    state.lastPose = action;
    const pool = spec.pool.filter(name => buffers.has(name));
    if (!pool.length) { state.ballFallbacks++; return false; }
    let name = pool[Math.floor(Math.random() * pool.length)];
    if (name === state.lastHit && pool.length > 1) {
      name = pool[(pool.indexOf(name)+1)%pool.length];
    }
    state.lastHit = name;
    let played=source(name,'ball',between(...spec.gain), {
      rate:between(...spec.rate),fadeIn:.003,fadeOut:.055,
      length:Math.min(name==='setTap'?.23:.38,buffers.get(name).duration-.02)
    });
    // Fail open to the original game's ball sound if the selected source did
    // not start; never swallow a contact just because an optional sample failed.
    if (!played && buffers.has('touch1')) {
      name='touch1';
      played=source(name,'ball',between(.19,.24),
        {rate:between(.97,1.08),fadeIn:.003,fadeOut:.055,length:Math.min(.38,buffers.get(name).duration-.02)});
    }
    if (!played) { state.ballFallbacks++;return false; }
    courtFootstep(action);
    state.ballContacts++;
    effort(action);
    return true;
  }

  // Only valid match-result data can trigger contextual sounds. These are the
  // real before-rally scores and winner, never OCR or guessed scoreboard text.
  function assessPoint(info) {
    if (!info || !Array.isArray(info.scoreBefore) ||
        info.scoreBefore.length !== 2 || typeof info.userIsHome !== 'boolean' ||
        !Number.isInteger(info.winner) || ![0, 1].includes(info.winner) ||
        !info.scoreBefore.every(n => Number.isInteger(n) && n >= 0) ||
        !Number.isInteger(info.set) || info.set < 1) return null;
    const user = info.userIsHome ? 0 : 1;
    const beforeOwn = info.scoreBefore[user], beforeOpp = info.scoreBefore[1 - user];
    const own = beforeOwn + (info.winner === user ? 1 : 0);
    const opponent = beforeOpp + (info.winner !== user ? 1 : 0);
    const beforeGap = beforeOpp - beforeOwn;
    const gap = opponent - own;
    const won = info.winner === user;
    const contacts = Number.isInteger(info.contacts)
      ? Math.max(0, Math.min(35, info.contacts)) : 0;
    const target = info.setTarget ?? (info.set >= 5 ? 15 : 25);
    const clutch = Math.max(own, opponent) >= target - 3 &&
                   Math.abs(own - opponent) <= 2;
    const setFinished = info.setFinished ?? (Math.max(own, opponent) >= target &&
                        Math.abs(own - opponent) >= 2);
    const spectacular = contacts >= 8 || (contacts >= 6 && clutch);
    const trailingFour = gap >= 4 && !setFinished;
    return {
      key: [info.set, ...info.scoreBefore, info.winner].join(':'),
      set: info.set, own, opponent, gap, beforeGap, won, contacts,
      clutch, spectacular, trailingFour, setFinished,
      crossedFour: beforeGap < 4 && gap >= 4,
      home: info.scoreBefore[0] + (info.winner === 0 ? 1 : 0),
      away: info.scoreBefore[1] + (info.winner === 1 ? 1 : 0),
      winner: info.winner,
      lastKind: typeof info.lastKind === 'string' ? info.lastKind : '',
      closeCall: info.closeCall === true
    };
  }
  // END_SCORE_RULES

  function reactiveSource(name, bus, level, options, layer='reaction') {
    const voice = source(name, bus, level, options);
    if (voice) {
      reactiveSounds.add(voice);
      if (layer==='applause') applauseVoices.add(voice);
      voice.player.addEventListener('ended', () => {
        reactiveSounds.delete(voice);
        applauseVoices.delete(voice);
      },{once:true});
      director()?.note?.(layer,name,options?.loop ?
        Math.max(1,options?.length||15) :
        (options?.length||buffers.get(name)?.duration||1));
    }
    return voice;
  }
  function clearReactive(fade=2.2) {
    if (!ctx || !reactiveSounds.size) return;
    const now = ctx.currentTime;
    for (const voice of reactiveSounds) {
      try {
        voice.envelope.gain.cancelScheduledValues(now);
        voice.envelope.gain.setValueAtTime(Math.max(.0001,voice.envelope.gain.value),now);
        voice.envelope.gain.linearRampToValueAtTime(.0001,now+fade);
        voice.player.stop(now+fade+.1);
      } catch {}
    }
    reactiveSounds.clear();
    applauseVoices.clear();
  }
  function manualPause() {
    if (state.paused) return;
    state.paused=true;
    state.pauseEvents++;
    // A rapid global effects-only gate prevents any sound from leaking into
    // the pause. The stadium PA and chill bed use different audio contexts.
    if (master && ctx) master.gain.setTargetAtTime(0,ctx.currentTime,.008);
    if (ctx) {
      const now=ctx.currentTime;
      for (const voice of [...liveVoices]) {
        try {
          const gain=voice.envelope.gain;
          if (typeof gain.cancelAndHoldAtTime==='function')
            gain.cancelAndHoldAtTime(now);
          else {
            gain.cancelScheduledValues(now);
            gain.setValueAtTime(Math.max(.0001,gain.value),now);
          }
          gain.linearRampToValueAtTime(.0001,now+.045);
          voice.player.stop(now+.055);
        } catch {}
      }
    }
    liveVoices.clear();
    reactiveSounds.clear();
    applauseVoices.clear();
    ambience=null;
    state.ambientUntil=0;
    state.ambientNextAt=0;
    if (speaking || window.speechSynthesis?.speaking) {
      window.speechSynthesis?.cancel();
      speaking=null;
    }
    director()?.note?.('game','paused: effects silent',0);
  }
  function manualResume() {
    if (!state.paused) return;
    state.paused=false;
    if (master && ctx)
      master.gain.setTargetAtTime(fullGain()*.85,ctx.currentTime,.08);
    state.ambientNextAt=0; // Restart only ambient bed; never old applause.
  }
  // V16.11: one contextual reaction for home, away, highlights and referee VAR.
  const STADIUM_POOLS = {
    intro:['chantRise','stadiumApplauseLocal','mixAuditorium','mixDrums','mixClapping'],
    chant:['userEncouragement','chantGroup','chantRise','chantStadium',
      'chantResponse','crowdStomp','supporterDrum','mixDrums'],
    homePoint:['stadiumApplauseLocal','bigCheer','mixClapping','stadiumCheer'],
    awayPoint:['awayCheer','stadiumDistantCheer','mixAudience','crowd'],
    mistake:['userMistake','groan','groanSoft','disappointedAww',
      'stadiumAwwLocal','stadiumBooLocal','stadiumDisappointed'],
    spectacular:['gasp','ooh','stadiumOoh','crowdGasp','mixWhistles'],
    reviewStart:['stadiumWhistlesLocal','stadiumTenseLocal','mixAngry','stadiumOoh'],
    reviewBoo:['stadiumBooLocal','groan','mixAngry','stadiumWhistle'],
    reviewCheer:['stadiumApplauseLocal','bigCheer','mixClapping','light'],
    finalPoint:['bigCheer','stadiumApplauseLocal','mixDrums','stadiumHorn','airHorn']
  };
  function pickSound(pool) {
    const avail = pool.filter(n => buffers.has(n));
    if (!avail.length) return null;
    const fresh = avail.filter(n => !state.recentCues.slice(-3).includes(n));
    const options = fresh.length ? fresh : avail.filter(n => n !== state.lastCue);
    const chosen = options.length ? options : avail;
    return chosen[Math.floor(Math.random() * chosen.length)];
  }
  function cue(category, gain, duration=2.2, minGap=1450, delay=0) {
    if(!allowed()||!state.ready||state.gains.crowd<=0||
        performance.now()-(state.lastCueByKind[category]??-Infinity)<minGap)return false;
    const chant=category==='chant';
    const all=(STADIUM_POOLS[category]||[]).filter(x=>buffers.has(x));
    if(!all.length)return false;
    // Supporter songs need multiple *different* recordings crossfaded into
    // each other. Hard looping a 4s shout creates an obvious repeating click.
    const starts=[];
    let when=delay,previous='',n=0;
    while(n<(chant?4:1) && when<duration+.02){
      const eligible=all.filter(x=>x!==previous);
      const sample=chant && n===0 && state.chantsPlayed%3===0 &&
          buffers.has('userEncouragement') ? 'userEncouragement' :
        category==='mistake' && buffers.has('groan') && Math.random()<.27 ? 'groan' :
        pickSound(eligible.length?eligible:all);
      if(!sample)break;
      const playable=usefulEnd(sample,buffers.get(sample))-audibleStart(sample);
      const span=Math.min(playable,chant?duration-when+1.7:duration);
      if(span<.15)break;
      const fade=Math.min(span*.67,chant?2.05:Math.max(.65,duration*.65));
      const played=reactiveSource(sample,'crowd',gain,{
        length:span,loop:false,delay:when,fadeIn:chant?.38:.07,
        fadeOut:fade,rate:1
      },chant?'chant':'special');
      if(!played)break;
      starts.push(sample);
      previous=sample;
      // Interleave successive fan voices. The previous one releases *after*
      // the next one has risen, rather than a silent delay between chants.
      when+=chant?Math.max(1.2,span-1.75):duration;
      n++;
    }
    if(!starts.length)return false;
    state.lastCue=starts[0];
    state.lastCueKind=category;
    state.lastCueAt=performance.now();
    state.lastCueByKind[category]=state.lastCueAt;
    state.recentCues.push(...starts);
    if(state.recentCues.length>5)state.recentCues.splice(0,state.recentCues.length-5);
    state.stadiumCues++;
    state.cueCounts[category]=(state.cueCounts[category]||0)+1;
    return true;
  }
  function supportEitherSide(point) {
    // Central director decides when supporters begin. Music and applause
    // cannot cancel this voice: it owns an independent WebAudio source.
    const policy=director();
    const plan=policy?.requestChant?.(point);
    state.ralliesSinceChant++;
    if (policy && !plan) return false;
    const gap=Math.abs(point.home-point.away);
    if (!policy &&
        (state.ralliesSinceChant<(point.clutch||gap>=4?6:8) ||
         performance.now()-state.lastChantAt<12000)) return false;
    const trailing=plan?.side ?? (point.home<point.away?0:point.away<point.home?1:-1);
    const seconds=plan?.duration ?? between(9,14);
    const made=cue('chant',trailing===1?between(.25,.33):between(.29,.37),
      seconds,0,.35);
    if (!made) {
      policy?.cancelChant?.();
      return false;
    }
    state.lastChantAt=performance.now();
    state.ralliesSinceChant=0;
    state.supportingSide=trailing;
    state.chantsPlayed++;
    state.layeredChants++;
    return true;
  }
  function pointApplause(point) {
    // Each scored rally gets one true clapping sample. Select by *audible*
    // duration, not the MP3 container or a late artificial play delay.
    const applause=['stadiumApplauseLocal','userApplauseLong','applauseSoft',
      'mixClapping','stadiumApplause','stadiumBigApplause','victory','light']
      .filter(name=>buffers.has(name));
    const backups=['mixAuditorium','crowd'].filter(name=>buffers.has(name));
    const options=applause.length?applause:backups;
    if(!options.length)return false;
    const {duration,release,whistle}=applauseTiming(point);
    const viable=options.filter(name=>{
      const clip=buffers.get(name);
      return usefulEnd(name,clip)-audibleStart(name)>=duration-.25;
    });
    const choices=viable.length?viable:options;
    const recent=choices.filter(name=>!state.recentCues.slice(-2).includes(name));
    const pool=recent.length?recent:choices;
    const name=pickSound(pool);
    if(!name)return false;
    const home=point.winner===0;
    const intensity=point.setFinished?.40:point.spectacular?.32:point.clutch?.27:.20;
    const gain=home?intensity:intensity*.83;
    const clip=buffers.get(name);
    const playFrom=audibleStart(name);
    const playable=usefulEnd(name,clip)-playFrom;
    const length=Math.min(duration,Math.max(.11,playable));
    const played=reactiveSource(name,'crowd',gain,{
      fadeIn:.07,length,
      fadeOut:Math.min(release,length*.65),rate:1
    },'applause');
    if(!played)return false;
    played.whistleFade=whistle;
    state.pointCheers++;
    state.lastApplause=name;state.lastCue=name;
    state.recentCues.push(name);
    if(state.recentCues.length>5)state.recentCues.shift();
    return true;
  }
  function occasionalVictoryShout(point) {
    // Solo human reaction on SOME points: separate from the exertion voice.
    // Prefer CC0 "Woohoo!" (#557125); existing CC0 Come On! is a fallback.
    const excited=point.spectacular||point.clutch||point.setFinished;
    if (Math.random()>=(excited?.31:.13) ||
        !throttle('joyfulShout',18000) || state.gains.voice<=0) return false;
    const name=buffers.has('victoryWoo')?'victoryWoo':
      buffers.has('comeOn')?'comeOn':null;
    if (!name) return false;
    const buffer=buffers.get(name);
    const played=reactiveSource(name,'voice',between(.20,.28),
      {from:0,length:Math.min(1.35,buffer.duration-.04),delay:.23,
        rate:between(.94,1.07)},'human');
    if (played) state.joyfulShouts++;
    return !!played;
  }
  function smallCommentary(point) {
    // Use ONLY installed/local English voices, never cloud TTS or external
    // services. Speech is optional and very rare to avoid robotic repetition.
    if (!state.commentaryEnabled || state.gains.voice<=0 ||
        !allowed() || typeof window.speechSynthesis==='undefined' ||
        typeof window.SpeechSynthesisUtterance!=='function') return false;
    const synthesis=window.speechSynthesis;
    if(synthesis.speaking || speaking)return false;
    const voice=synthesis.getVoices().find(v=>
      /^en[-_]/i.test(v.lang||'') && v.localService!==false);
    if(!voice)return false;
    const phrase=director()?.commentary?.(point);
    if(!phrase)return false;
    try {
      const utterance=new window.SpeechSynthesisUtterance(phrase);
      utterance.voice=voice;utterance.lang=voice.lang;
      utterance.rate=.94;utterance.pitch=.95;
      utterance.volume=clamp(state.gains.voice/100*fullGain()*.34,0,.35);
      speaking=utterance;
      utterance.onend=()=>{if(speaking===utterance)speaking=null;};
      utterance.onerror=()=>{if(speaking===utterance)speaking=null;};
      synthesis.speak(utterance);
      state.commentaryPlayed++;
      director()?.note?.('commentary',phrase,2.2);
      return true;
    } catch { speaking=null;return false;}
  }
  function scenePoint(point) {
    director()?.point?.(point);
    const home=point.winner===0;
    const category=director()?.reaction?.(point) ||
      (point.won?'normal-cheer':'opponent');
    const error=/Error$/.test(point.lastKind) ||
      ['serve-error','attack-error','blocked'].includes(
        director()?.kindOf?.(point));
    // Layer 1 — always audible, including away and ordinary points.
    const celebrated=pointApplause(point);
    // Layer 2 — exceptional rally, referee or final point.
    if (point.setFinished) {
      cue('finalPoint',home?.27:.22,3.5,850,.22);
    } else if (['ace','block','big-cheer'].includes(category) || point.spectacular) {
      if (Math.random()<.52)cue('spectacular',home?.18:.14,2.1,1300,.25);
      state.bigRallies++;
    } else if(category==='opponent' && Math.random()<.20){
      // Visiting supporters sometimes add a natural low cheer in addition to
      // the every-point clapping; never force it over a bigger reaction.
      cue('awayPoint',.15,2.5,2400,.10);
    } else if (category==='disappointment' && Math.random()<.68) {
      cue('mistake',.17,2.0,2800,.18);
    } else if (point.closeCall && Math.random()<.35) {
      cue('spectacular',.14,1.5,950,.2);
    } else if (error && !point.won && Math.random()<.45) {
      cue('mistake',.14,1.6,2800,.2);
    }
    // Layer 3 — independent drum/chant, regardless of point applause.
    if(!point.setFinished)supportEitherSide(point);
    if(point.contacts>=9 && Math.random()<.22 && buffers.has('breathing') &&
       state.gains.voice>0){
      source('breathing','voice',.14,{
        length:Math.min(3.1,usefulEnd('breathing',buffers.get('breathing'))),
        fadeIn:.17,fadeOut:1.55,delay:.65
      });
    }
    // Layer 4 — an occasional nearby player or fan celebrating.
    if (celebrated && point.won) occasionalVictoryShout(point);
    if (celebrated) smallCommentary(point);
    return celebrated;
  }
  function crowd(loud, info) {
    if (!canIntercept()) return false;
    if (!allowed() || !state.ready) return true;
    const point=assessPoint(info);
    if (!point) {
      const sample=pickSound(['light','crowd']);
      if (sample) return !!reactiveSource(sample,'crowd',.20,{length:1.35});
      return false;
    }
    if (point.key===state.lastPointKey) return true;
    state.lastPointKey=point.key;
    state.lastPoint=point;
    // Let the original audio engine play if the new crowd sample cannot start.
    if (!state.reviewActive) {
      const ok=scenePoint(point);
      if (!ok) state.lastPointKey='';
      return ok;
    }
    return true;
  }
  function phase(kind) {
    if (kind !== 'start') return;
    state.matchStart=performance.now();
    state.last={};
    director()?.start?.();
    state.pendingIntro=true;
    state.paused=false;
    state.reviewActive=false;
    state.reviewSeq=null;
    state.lastPointKey='';
    state.lastPoint=null;
    state.lastCueAt=-Infinity;
    state.lastChantAt=-Infinity;
    state.recentCues.length=0;
    state.ralliesSinceChant=0;
    state.lastCueByKind={};
    state.ambientUntil=0;
    state.ambientNextAt=0;
  }
  function review(kind,details) {
    if (kind === 'end') {
      state.reviewActive=false;
      state.reviewSeq=null;
      state.ambientUntil=0;
      return;
    }
    if (kind === 'start') {
      if (details?.seq===state.reviewSeq) return;
      state.reviewSeq=details?.seq??null;
      state.reviewActive=true;
      state.ambientUntil=0;
      if (cue('reviewStart',.12,2.2,800,.18)) state.reviewCues++;
      return;
    }
    if (kind === 'result') {
      state.reviewActive=false;
      state.ambientUntil=0;
      // The referee's overturned decision helps the challenger. A call that
      // stands helps the other team. Home and away supporters react differently.
      const homeHappy=details?.overturned===true ?
        details?.team===0 : details?.team===1;
      if (cue(homeHappy?'reviewCheer':'reviewBoo',
          homeHappy?.22:.18,2.25,500,.15)) state.reviewCues++;
    }
  }
  function hooter() {
    if (!canIntercept()) return false;
    if (!allowed() || !state.ready || !throttle('buzzer', 450)) return true;
    // A missing individual clip must not suppress the original game's buzzer.
    return !!source('buzzer', 'ball', .095);
  }
  function endAmbience(fade=3.3) {
    if(!ambience||!ctx)return;
    const old=ambience;ambience=null;
    try{
      const now=ctx.currentTime;
      const gain=old.envelope.gain;
      if(typeof gain.cancelAndHoldAtTime==='function')
        gain.cancelAndHoldAtTime(now);
      else{
        gain.cancelScheduledValues(now);
        gain.setValueAtTime(Math.max(.0001,gain.value),now);
      }
      gain.linearRampToValueAtTime(.0001,now+fade);
      old.player.stop(now+fade+.12);
    }catch{}
  }
  const BEDS=['stadiumMurmurLocal','stadiumDistantLocal','stadiumMurmur',
    'stadiumDistant','mixAudience','crowd'];
  function chooseBed() {
    // Prefer the two user-owned long beds so a short WAV cannot turn into a
    // repeated hard-loop click. Fallback to previous sounds only if absent.
    const priority=(state.reviewActive
      ? ['stadiumTenseLocal','stadiumMurmurLocal']
      : ['stadiumMurmurLocal','stadiumDistantLocal'])
      .filter(name=>buffers.has(name));
    const fallback=(state.reviewActive
      ? ['stadiumTense','mixAngry','stadiumMurmur','mixAudience','crowd']
      : BEDS).filter(name=>buffers.has(name));
    const pool=priority.length?priority:fallback;
    if(!pool.length)return null;
    const changed=pool.filter(name=>name!==state.ambientName);
    const choices=changed.length?changed:pool;
    return choices[Math.floor(Math.random()*choices.length)];
  }
  function monitor() {
    const active=allowed();
    const wasActive=state.active;
    state.active=active;
    if(master&&ctx)master.gain.setTargetAtTime(active?fullGain()*.85:0,
      ctx.currentTime,active?.12:.04);
    if(!isLive()&&state.matchStart!==null){
      state.matchStart=null;
      state.pendingIntro=false;
      director()?.end?.();
    }
    if (!active || !state.ready || !ctx || ctx.state!=='running') {
      if(wasActive){endAmbience(.12);clearReactive(.12);}
      if (speaking) {
        window.speechSynthesis.cancel();speaking=null;
      }
      state.ambientUntil=0;
      return;
    }
    if (state.pendingIntro && state.gains.crowd>0) {
      state.pendingIntro=false;
      cue('intro',between(.21,.29),4.2,0,.2);
    }
    if (state.gains.ambience<=0) { endAmbience();return; }
    const now=performance.now();
    if(ambience && now>=state.ambientUntil){
      // Start the next atmosphere IMMEDIATELY, while the previous one is
      // still fading: old -> new crossfade is 3.3 seconds, never dead air.
      endAmbience(3.3);
      state.ambientNextAt=now;
      state.crossfades++;
    }
    if(!ambience && now>=state.ambientNextAt){
      const name=chooseBed();
      if(!name)return;
      const buffer=buffers.get(name);
      const quiet=['stadiumMurmurLocal','stadiumDistantLocal',
        'stadiumMurmur','stadiumDistant'].includes(name);
      const volume=quiet?.24:.18;
      const usable=usefulEnd(name,buffer)-audibleStart(name);
      // A naturally long recording is kept as ONE shot. Short backup loops
      // only until the next 3.3s crossfade takes over.
      const looping=usable<3.7;
      const voice=source(name,'ambience',volume,{
        loop:looping,from:0,fadeIn:3.3,fadeOut:3.3
      });
      if(voice){
        const low=ctx.createBiquadFilter();
        const mix=ctx.createGain();
        mix.gain.value=director()?.ambienceLevel?.()??1;
        low.type='lowpass';
        low.frequency.value=quiet?2250:1600;
        voice.player.disconnect();
        voice.player.connect(low).connect(mix).connect(voice.envelope);
        voice.mix=mix;
        voice.player.addEventListener('ended',()=>{low.disconnect();mix.disconnect();},{once:true});
        ambience=voice;
        state.ambientName=name;
        state.ambienceSwaps++;
        // Transition before the *actual* last audible sample.
        const nextSeconds=looping?4.5:Math.min(20,Math.max(1.2,usable-3.6));
        state.ambientUntil=now+nextSeconds*1000;
      }else state.ambientNextAt=now+600;
    }
    if(ambience){
      const level=director()?.ambienceLevel?.()??1;
      ambience.mix.gain.setTargetAtTime(level,ctx.currentTime,.65);
    }
  }

  function setGain(name, value) {
    if (!channels.includes(name)) return;
    state.gains[name] = clamp(Number(value) || 0, 0, 100);
    save(name, state.gains[name]);
    if (ctx && buses[name]) buses[name].gain.setTargetAtTime(state.gains[name] / 100, ctx.currentTime, .05);
    if (name === 'ambience') monitor();
    if (name === 'voice' && !state.gains.voice && speaking && window.speechSynthesis) {
      window.speechSynthesis.cancel();speaking=null;
    }
  }
  function setEnabled(enabled) {
    state.enabled = !!enabled;
    save('enabled', state.enabled ? 'on' : 'off');
    monitor();
  }
  function tr() {
    let language = 'en';
    try { language = localStorage.getItem('vm.language') ?? 'en'; } catch {}
    return ({
      en: ['Match audio', 'Enhanced stadium atmosphere', 'Ambient hall', 'Crowd reactions', 'Ball and referee', 'Player effort voices', 'Natural ball contacts, applause faded by referee, full chants and occasional local English voice.'],
      es: ['Sonido de los partidos', 'Ambiente de pabellón mejorado', 'Ambiente del pabellón', 'Reacciones del público', 'Balón y árbitro', 'Voces de esfuerzo', 'Contactos, aplausos con fundido, cánticos completos y frases ocasionales en inglés.'],
      pt: ['Som dos jogos', 'Ambiente de pavilhão melhorado', 'Ambiente do pavilhão', 'Reações do público', 'Bola e árbitro', 'Vozes de esforço', 'Toques diferentes e vozes de esforço ocasionais. Apenas durante os jogos.']
    })[language] || ({
      en: ['Match audio', 'Enhanced stadium atmosphere', 'Ambient hall', 'Crowd reactions', 'Ball and referee', 'Player effort voices', 'Only during matches.']
    }).en;
  }
  function settings() {
    const group = (document.getElementsByClassName('prefs-panel').length?document.querySelector('.prefs-panel .settings-group'):null);
    const selected = (document.getElementsByClassName('prefs-tabs').length?document.querySelector('.prefs-tabs [role="tab"][aria-selected="true"]'):null);
    if (!group || !selected || !/sound|sonido|som/i.test(selected.textContent || '')) { ui = null; return; }
    if (group.querySelector('[data-vm-match-audio]')) return;
    const lang = tr(), section = document.createElement('section');
    section.dataset.vmMatchAudio = '1';
    section.style.cssText = 'border-top:1px solid #37516b;margin-top:12px;padding-top:12px;';
    const heading = document.createElement('h4');
    heading.textContent = lang[0]; section.append(heading);
    const toggle = document.createElement('label');
    toggle.className = 'settings-row';
    const label = document.createElement('span');
    label.textContent = lang[1]; toggle.append(label);
    const checked = document.createElement('input');
    checked.type = 'checkbox'; checked.checked = state.enabled;
    checked.addEventListener('change', () => setEnabled(checked.checked));
    toggle.append(checked); section.append(toggle);
    const sliders = {};
    const titles = { ambience: lang[2], crowd: lang[3], ball: lang[4], voice: lang[5] };
    for (const name of channels) {
      const row = document.createElement('label');
      row.className = 'settings-row';
      const caption = document.createElement('span');
      caption.textContent = titles[name];
      const percentage = document.createElement('small');
      percentage.textContent = state.gains[name] + '%';
      caption.append(percentage);
      const input = document.createElement('input');
      input.type = 'range'; input.min = '0'; input.max = '100'; input.step = '1';
      input.value = String(state.gains[name]);
      input.setAttribute('aria-label', titles[name]);
      input.addEventListener('input', () => {
        setGain(name, Number(input.value)); percentage.textContent = state.gains[name] + '%';
      });
      row.append(caption, input); section.append(row);
      sliders[name] = input;
    }
    const commentRow=document.createElement('label');
    commentRow.className='settings-row';
    const commentLabel=document.createElement('span');
    commentLabel.textContent=(localStorage.getItem('vm.language')==='es' ?
      'Frases ocasionales en inglés (voz local)' : 'Occasional English phrases (local voice)');
    const commentCheck=document.createElement('input');commentCheck.type='checkbox';
    commentCheck.checked=state.commentaryEnabled;
    commentCheck.addEventListener('change',()=>{
      state.commentaryEnabled=commentCheck.checked;
      save('commentaryEnabled',state.commentaryEnabled?'on':'off');
    });
    commentRow.append(commentLabel,commentCheck);section.append(commentRow);
    const note = document.createElement('small');
    note.textContent = lang[6]; section.append(note);
    group.append(section);
    ui = { section, checked, sliders };
  }
  let observation;
  function begin() {
    if (!document.body || observation) return;
    observation = new MutationObserver(settings);
    observation.observe(document.body, { childList: true, subtree: true });
    settings();
  }
  const unlockGesture = () => { if (baseEnabled()) unlock(); };
  document.addEventListener('pointerdown', unlockGesture, { capture: true, passive: true });
  document.addEventListener('keydown', unlockGesture, { capture: true });
  document.addEventListener('visibilitychange', monitor);
  window.addEventListener('blur', () => { mutedByFocus = true; monitor(); });
  window.addEventListener('focus', () => { mutedByFocus = false; monitor(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', begin, { once: true });
  else begin();
  setInterval(monitor, 450);
  // One handler for the real animated contact emitted by the V16.6 timeline.
  // Returning false tells the dispatcher to let the ORIGINAL game play its hit.
  window.__vmEvents?.on?.('match:contact', (event) => hit(event.hard, event.pose));
  window.__vmEvents?.on?.('match:pause', manualPause);
  window.__vmEvents?.on?.('match:resume', manualResume);
  window.__vmMatchAudio = {
    whistle, hit, crowd, hooter, phase, review, setGain, setEnabled, classifyPose, assessPoint,
    getState: () => ({
      enabled: state.enabled, active: state.active, ready: state.ready,
      paused: state.paused, pauseEvents: state.pauseEvents, activeFx: liveVoices.size,
      optionalLoaded: state.optionalLoaded, samplesLoaded: buffers.size,
      localLibraryLoaded: state.localLibraryLoaded,
      localLibrarySamples: [...libraryProfiles.keys()].filter(k=>buffers.has(k)),
      measuredStarts: state.measuredStarts, crossfades: state.crossfades,
      gains: { ...state.gains }, errors: state.errors, ambientPlaying: !!ambience,
      lastPose: state.lastPose, effortCount: state.effortCount,
      pointCheers: state.pointCheers, layeredChants: state.layeredChants,
      ambienceSwaps: state.ambienceSwaps, ambientPauses: state.ambientPauses,
      ballContacts: state.ballContacts, ballFallbacks: state.ballFallbacks,
      joyfulShouts: state.joyfulShouts, ralliesSinceChant: state.ralliesSinceChant,
      lastPoint: state.lastPoint, chantsPlayed: state.chantsPlayed,
      bigRallies: state.bigRallies, gaspsPlayed: state.gaspsPlayed,
      encouragementsPlayed: state.encouragementsPlayed,
      supportClipsLoaded: STADIUM_POOLS.chant.filter(x => buffers.has(x)).length,
      userClipsLoaded: ['userApplauseLong','userEncouragement','userMistake']
        .filter(x=>buffers.has(x)),
      comeOnLoaded: buffers.has('comeOn'), victoryWooLoaded: buffers.has('victoryWoo'),
      stadiumClipsLoaded: Object.keys(BANK).filter(k=>k.startsWith('stadium')&&buffers.has(k)),
      mixkitExtrasLoaded: ['mixDrums','mixWhistles','mixAngry','mixAudience','mixClapping','mixAuditorium'].filter(k=>buffers.has(k)),
      ambientName: state.ambientName, reviewActive: state.reviewActive,
      lastCue: state.lastCue, lastCueKind: state.lastCueKind,
      stadiumCues: state.stadiumCues, reviewCues: state.reviewCues,
      supportingSide: state.supportingSide,
      applauseFades: state.applauseFades, lastApplause: state.lastApplause,
      commentaryPlayed: state.commentaryPlayed, commentaryEnabled: state.commentaryEnabled,
      cueCounts: { ...state.cueCounts },
      effortSampleLoaded: buffers.has('effort'), setTapLoaded: buffers.has('setTap')
    })
  };
})();
