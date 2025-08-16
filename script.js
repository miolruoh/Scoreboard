// --- Sovelluksen tila ---
const state = {
  players: [],
  totals: {},
  placementPoints: [],
  events: [],
  currentEventIndex: 0,
  timer: { running:false, startTs:0, elapsedMs:0, intervalId:null }
};

// --- Apurit ---
const qs  = (s,r=document) => r.querySelector(s);
const qsa = (s,r=document) => Array.from(r.querySelectorAll(s));
const pad2 = n => String(n).padStart(2,'0');
const pad3 = n => String(n).padStart(3,'0');

function showToast(msg,type=''){
  const el = qs('#toast');
  if(!el) return;
  el.textContent=msg;
  el.className=`toast ${type}`;
  el.hidden=false;
  setTimeout(()=>el.hidden=true,2200);
}

function isTimeFormat(v){ return /^\d{1,2}\.\d{2}\.\d{1,3}$/.test(v.trim()); }
function isIntegerStr(v){ return /^-?\d+$/.test(v.trim()); }
function timeToMs(str){
  const [m,s,ms]=str.split('.').map(x=>parseInt(x,10));
  return (m||0)*60000 + (s||0)*1000 + (ms||0);
}
function msToDisplay(ms){
  const m=Math.floor(ms/60000), s=Math.floor((ms%60000)/1000), milli=ms%1000;
  return `${pad2(m)}.${pad2(s)}.${pad3(milli)}`;
}

function updatePlacementPoints(){
  const n=state.players.length;
  state.placementPoints=Array.from({length:n},(_,i)=>n-i);
}
function ensureTotalsForPlayers(){
  state.players.forEach(p=>{ if(!(p in state.totals)) state.totals[p]=0 });
  Object.keys(state.totals).forEach(p=>{ if(!state.players.includes(p)) delete state.totals[p] });
}
function syncEventsPlayers(){
  state.events.forEach(ev=>{
    state.players.forEach(p=>{
      if(!(p in ev.results)) ev.results[p]='';
      if(!(p in ev.locks))   ev.locks[p]=false;
    });
    Object.keys(ev.results).forEach(p=>{
      if(!state.players.includes(p)){
        delete ev.results[p];
        delete ev.locks[p];
      }
    });
  });
}

// --- Alustus ---
document.addEventListener('DOMContentLoaded',()=>{
  // Aloita-nappi
  qs('#homeStartBtn')?.addEventListener('click',()=>{
    qs('header').hidden=false;
    switchView('settingsView');
  });

  // Topnav
  qsa('header .topnav button').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));

  // Settings-painikkeet
  qs('#addPlayerBtn')?.addEventListener('click',addPlayer);
  qs('#newPlayerName')?.addEventListener('keypress',e=>{ if(e.key==='Enter') addPlayer(); });

  qs('#addEventBtn')?.addEventListener('click',addEvent);
  qs('#newEventName')?.addEventListener('keypress',e=>{ if(e.key==='Enter') addEvent(); });

  qs('#goToEventsBtn')?.addEventListener('click',()=>{
    // Lukitaan lisäyslomakkeet
    qs('#addPlayerBtn').disabled=true;
    qs('#newPlayerName').disabled=true;
    qs('#addEventBtn').disabled=true;
    qs('#newEventName').disabled=true;
    switchView('eventsView');
  });

  qs('#resetBtn')?.addEventListener('click',()=>{
    // Nollaa tila
    state.players=[]; state.events=[]; state.totals={}; state.currentEventIndex=0;
    ensureTotalsForPlayers(); updatePlacementPoints();
    syncEventsPlayers();
    // Palauta asetukset
    qs('#addPlayerBtn').disabled=false;
    qs('#newPlayerName').disabled=false;
    qs('#addEventBtn').disabled=false;
    qs('#newEventName').disabled=false;
    renderSettings();
    renderTimerSelectors();
    renderTotals();
    qs('header').hidden=true;
    switchView('homeView');
  });

  // Tapahtumanavigointi
  qs('#prevEventBtn')?.addEventListener('click',()=>jumpEvent(-1));
  qs('#nextEventBtn')?.addEventListener('click',()=>jumpEvent(1));
  qs('#orderSelect')?.addEventListener('change',()=>{
    currentEvent().order = qs('#orderSelect').value;
    renderEventInputs();
  });
  qs('#saveEventBtn')?.addEventListener('click',saveCurrentEvent);

  // Syötekenttien blur -> lopullinen tallennus + järjestys
  qs('#eventInputs')?.addEventListener('focusout',e=>{
    if(!e.target.matches('input')) return;
    const ev=currentEvent(), p=e.target.dataset.player, v=e.target.value.trim();
    if(ev.locks[p]){
      e.target.value = ev.results[p]||'';
      showToast('Kenttä lukittu','error');
    } else {
      ev.results[p] = v;
    }
    renderEventInputs();
  });

  // Sekuntikello
  qs('#startTimerBtn')?.addEventListener('click',startTimer);
  qs('#stopTimerBtn')?.addEventListener('click', stopTimer);
  qs('#resetTimerBtn')?.addEventListener('click',resetTimer);
  qs('#timerEventSelect')?.addEventListener('change', resetTimer);
  qs('#timerPlayerSelect')?.addEventListener('change',resetTimer);

  // Alku
  renderSettings();
  renderEventsHeader();
  renderTimerSelectors();
  renderTotals();
  switchView('homeView');
});

function switchView(viewId){
  qsa('.view').forEach(v=>v.hidden=true);
  const viewEl = qs(`#${viewId}`);
  if (viewEl) viewEl.hidden = false;
}

// --- Asetukset ---
function addPlayer(){
  const val=qs('#newPlayerName')?.value.trim();
  if(!val) return;
  if(state.players.includes(val)){ showToast('Pelaaja jo olemassa','error'); return; }
  state.players.push(val);
  ensureTotalsForPlayers(); updatePlacementPoints(); syncEventsPlayers();
  qs('#newPlayerName').value='';
  renderSettings();
}
function removePlayer(name){
  state.players=state.players.filter(p=>p!==name);
  delete state.totals[name];
  ensureTotalsForPlayers(); updatePlacementPoints(); syncEventsPlayers();
  renderSettings(); renderTotals();
}
function renameEvent(i){
  const old=state.events[i]?.name||`Tapahtuma ${i+1}`;
  const nu=prompt('Uusi nimi:',old); if(!nu) return;
  state.events[i].name=nu.trim();
  renderSettings(); renderEventsHeader();
}
function deleteEvent(i){
  state.events.splice(i,1);
  state.currentEventIndex=Math.min(state.currentEventIndex, state.events.length-1);
  renderSettings(); renderEventsHeader(); renderEventInputs(); renderTimerSelectors();
}
function addEvent(){
  const val=qs('#newEventName')?.value.trim()||`Tapahtuma ${state.events.length+1}`;
  state.events.push({
    name:val,
    results:Object.fromEntries(state.players.map(p=>[p,''])),
    locks:  Object.fromEntries(state.players.map(p=>[p,false])),
    order: 'desc',
    committed:false,
    points: {}
  });
  qs('#newEventName').value='';
  renderSettings(); renderTimerSelectors();
}

// --- Renderöinti asetuksissa ---
function renderSettings(){
  const pl=qs('#playersList');
  if(pl){
    pl.innerHTML='';
    state.players.forEach(p=>{
      const d=document.createElement('div'); d.className='item';
      d.innerHTML=`
        <span class="name">${p}</span>
        <button class="ghost" data-action="remove">Poista</button>
      `;
      d.querySelector('[data-action="remove"]')
        .addEventListener('click',()=>removePlayer(p));
      pl.append(d);
    });
  }
  const evl=qs('#eventNamesList');
  if(evl){
    evl.innerHTML='';
    state.events.forEach((ev,i)=>{
      const d=document.createElement('div'); d.className='item';
      const tag=ev.committed?'<span class="locktag">Tallennettu</span>':'';
      d.innerHTML=`
        <button class="ghost" data-action="open">${ev.name}</button>
        ${tag}<span style="flex:1"></span>
        <button class="ghost" data-action="rename">Nimeä</button>
        <button class="ghost" data-action="delete">Poista</button>
      `;
      d.querySelector('[data-action="open"]')
        .addEventListener('click',()=>{
          renderEventsHeader(); renderEventInputs(); switchView('eventsView');
        });
      d.querySelector('[data-action="rename"]')
        .addEventListener('click',()=>renameEvent(i));
      d.querySelector('[data-action="delete"]')
        .addEventListener('click',()=>deleteEvent(i));
      evl.append(d);
    });
  }
}

// --- Tapahtumat ---
function renderEventsHeader(){
  const title=qs('#eventTitle');
  if(!title) return;
  if(!state.events.length){
    title.textContent='Ei tapahtumia';
    qs('#prevEventBtn').disabled=true;
    qs('#nextEventBtn').disabled=true;
    return;
  }
  const ev = state.events[state.currentEventIndex];
  title.textContent = ev.name;
  qs('#prevEventBtn').disabled = state.currentEventIndex===0;
  qs('#nextEventBtn').disabled = state.currentEventIndex>=state.events.length-1;
  qs('#orderSelect').value = ev.order;
}
function jumpEvent(d){
  if(!state.events.length) return;
  state.currentEventIndex = Math.max(0, Math.min(state.events.length-1, state.currentEventIndex + d));
  renderEventsHeader();
  renderEventInputs();
}

function renderEventInputs(){
  const c=qs('#eventInputs');
  if(!c) return;
  c.innerHTML='';
  const ev=currentEvent();
  if(!ev){ c.innerHTML='<p class="hint">Lisää tapahtumia.</p>'; return; }

  // Lajittele siten, että tyhjät viimeiseksi
  const sorted=[...state.players].sort((a,b)=>{
    const ra=ev.results[a]||'', rb=ev.results[b]||'';
    const ha=ra!=='', hb=rb!=='';
    if(!ha&& !hb) return 0;
    if(!ha) return 1;
    if(!hb) return -1;
    const va=isTimeFormat(ra)?timeToMs(ra):parseInt(ra,10);
    const vb=isTimeFormat(rb)?timeToMs(rb):parseInt(rb,10);
    return ev.order==='asc'?va-vb:vb-va;
  });

  updatePlacementPoints();
  sorted.forEach(p=>{
    const rid = `evt${state.currentEventIndex}_${p.replace(/\s+/g,'_')}`;
    const lbl=document.createElement('label');
    lbl.setAttribute('for', rid);
    lbl.textContent=p;

    const wrap=document.createElement('div');
    const inp=document.createElement('input');
    inp.type='text'; inp.id=rid;
    inp.name=`res_${rid}`; inp.placeholder='mm.ss.mmm tai luku';
    inp.value=ev.results[p]||''; inp.readOnly=!!ev.locks[p];
    inp.dataset.player=p;

    const lockTag=document.createElement('span');
    lockTag.className='locktag'; lockTag.textContent='Lukittu';
    lockTag.style.display=ev.locks[p]?'inline-block':'none';

    const pt=document.createElement('span');
    pt.className='pointtag';
    if(ev.committed && (p in ev.points)){
      pt.textContent=`+${ev.points[p]}`;
      pt.style.display='inline-block';
    } else pt.style.display='none';

    wrap.append(inp, lockTag, pt);
    c.append(lbl, wrap);
  });
}

function saveCurrentEvent(){
  const ev=currentEvent();
  if(!ev || ev.committed){
    if(ev?.committed) showToast('Jo tallennettu','error');
    return;
  }
  const vals=state.players.map(p=>(ev.results[p]||'').trim());
  if(vals.some(v=>'0123456789'.indexOf(v[0])<0)){
    showToast('Syötä vähintään yksi merkki','error');
    return;
  }
  const types=vals.map(v=>isTimeFormat(v)?'time':isIntegerStr(v)?'int':'invalid');
  if(types.includes('invalid')){
    showToast('Muoto väärä','error');return;
  }
  if(new Set(types).size>1){
    showToast('Yhtenäinen muoto','error');return;
  }
  const isTime=types[0]==='time', dir=ev.order==='asc'?1:-1;
  const rows=state.players.map(p=>({p,score:isTime?timeToMs(ev.results[p]):parseInt(ev.results[p],10)}));
  rows.sort((a,b)=>(a.score-b.score)*dir);
  updatePlacementPoints();
  rows.forEach((r,i)=>{
    ev.points[r.p]=state.placementPoints[i];
    state.totals[r.p] = (state.totals[r.p]||0) + state.placementPoints[i];
  });
  ev.committed=true;
  renderEventsHeader();
  renderEventInputs();
  renderTotals();
  showToast('Tallennettu','success');
}

// --- Sekuntikello ---
function renderTimerSelectors(){
  const evSel=qs('#timerEventSelect'),
        plSel=qs('#timerPlayerSelect');
  if(evSel){
    evSel.innerHTML='';
    if(!state.events.length){
      evSel.append(new Option('Ei tapahtumia',''));
    } else {
      state.events.forEach((ev,i)=>evSel.append(new Option(ev.name,i)));
      evSel.value=state.currentEventIndex;
    }
  }
  if(plSel){
    plSel.innerHTML='';
    if(!state.players.length){
      plSel.append(new Option('Ei pelaajia',''));
    } else {
      state.players.forEach(p=>plSel.append(new Option(p,p)));
    }
  }
}

function updateTimerDisplay(){
  qs('#timerDisplay').textContent = msToDisplay(state.timer.elapsedMs);
}

function startTimer(){
  if(state.timer.running) return;
  state.timer.running = true;
  state.timer.startTs = performance.now() - state.timer.elapsedMs;
  state.timer.intervalId = setInterval(()=>{
    state.timer.elapsedMs = Math.floor(performance.now() - state.timer.startTs);
    updateTimerDisplay();
  },16);
}

function stopTimer(){
  if(!state.timer.running) return;
  clearInterval(state.timer.intervalId);
  state.timer.running = false;

  const eIdx = parseInt(qs('#timerEventSelect').value,10),
        pl   = qs('#timerPlayerSelect').value;
  if(isNaN(eIdx) || !state.events[eIdx]){
    qs('#timerNotice').textContent='Valitse tapahtuma';return;
  }
  if(!pl){
    qs('#timerNotice').textContent='Valitse pelaaja';return;
  }

  const t   = msToDisplay(state.timer.elapsedMs),
        ev  = state.events[eIdx];
  ev.results[pl]=t; ev.locks[pl]=true;

  renderEventInputs();
  qs('#timerNotice').textContent=`${pl}: ${t}`;
  showToast('Aika tallennettu','success');
}

function resetTimer(){
  clearInterval(state.timer.intervalId);
  state.timer.running   = false;
  state.timer.elapsedMs = 0;
  updateTimerDisplay();
  qs('#timerNotice')?.textContent='';
}

// --- Kokonaispisteet ---
function renderTotals(){
  ensureTotalsForPlayers();
  const tb=qs('#leaderboardBodyTotals');
  if(!tb) return;
  tb.innerHTML='';
  Object.entries(state.totals)
    .sort((a,b)=>b[1]-a[1])
    .forEach(([p,pts])=>{
      const tr=document.createElement('tr');
      tr.innerHTML=`<td>${p}</td><td>${pts}</td>`;
      tb.append(tr);
    });
}
