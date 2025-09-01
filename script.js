// --- Sovelluksen tila ---
const state = {
  players: [],
  totals: {},
  placementPoints: [],
  events: [],
  currentEventIndex: 0,
  timer: { running: false, startTs: 0, elapsedMs: 0, intervalId: null },
  started: false
};

// --- Persistointi ---
function saveState() {
  const payload = {
    players:           state.players,
    totals:            state.totals,
    placementPoints:   state.placementPoints,
    events:            state.events,
    currentEventIndex: state.currentEventIndex,
    started:           state.started
  };

  const raw = JSON.stringify(payload);
  // 1) Tallennus localStorageen
  localStorage.setItem('pistelaskuri', raw);

  // 2) Automaattinen “vienti” URL-hashiin base64-muodossa
  //    => selaimen osoiteriville ilmestyy #<base64(json)>
  try {
    const b64 = btoa(raw);
    window.location.hash = b64;
  } catch(e) {
    console.warn('Hash-päivitys epäonnistui:', e);
  }
}

// Lisäät loadStateen hash-tuonnin, jos localStorage on tyhjä
function loadState() {
  let raw = localStorage.getItem('pistelaskuri');

  // jos ei löytynyt, katsotaan onko hashissa tallennettu
  if (!raw && window.location.hash.length > 1) {
    try {
      const b64  = window.location.hash.slice(1);
      raw = atob(b64);
      // validoidaan että on kelvollinen JSON
      JSON.parse(raw);
      // laitetaan localStorageen, niin muutkin funktiot löytävät sen
      localStorage.setItem('pistelaskuri', raw);
      // Voit myös tyhjentää hashin, jos et halua näyttää sitä osoiterivillä:
      window.history.replaceState(null,null, window.location.pathname);
      console.info('Status ladattu hashista');
    } catch(e) {
      console.error('Hashista lataus epäonnistui:', e);
    }
  }

  if (!raw) return;
  try {
    const obj = JSON.parse(raw);
    state.players           = obj.players           || [];
    state.totals            = obj.totals            || {};
    state.placementPoints   = obj.placementPoints   || [];
    state.events            = obj.events            || [];
    state.currentEventIndex = obj.currentEventIndex || 0;
    state.started           = obj.started           || false;
  } catch {
    // tyhjä jos virhe
  }
}

// --- Apurit ---
const qs  = (s, r=document) => r.querySelector(s);
const qsa = (s, r=document) => Array.from(r.querySelectorAll(s));
const pad2 = n => String(n).padStart(2,'0');
const pad3 = n => String(n).padStart(3,'0');

function showToast(msg, type='') {
  const t = qs('#toast');
  t.textContent = msg;
  t.className = `toast ${type}`;
  t.hidden = false;
  setTimeout(()=> t.hidden = true, 2200);
}

function isTimeFormat(v)    { return /^\d{1,2}\.\d{2}\.\d{1,3}$/.test(v.trim()); }
function isIntegerStr(v)    { return /^-?\d+$/.test(v.trim()); }
function timeToMs(str) {
  const [m,s,ms] = str.split('.').map(x=>parseInt(x,10));
  return (m||0)*60000 + (s||0)*1000 + (ms||0);
}
function msToDisplay(ms) {
  const m = Math.floor(ms/60000);
  const s = Math.floor((ms%60000)/1000);
  const mi = ms % 1000;
  return `${pad2(m)}.${pad2(s)}.${pad3(mi)}`;
}

// --- Tilankäsittely ja synkronointi ---
function updatePlacementPoints(){
  const n = state.players.length;
  state.placementPoints = Array.from({length:n}, (_,i)=>n - i);
}

function ensureTotalsForPlayers(){
  state.players.forEach(p=> { if (!(p in state.totals)) state.totals[p] = 0; });
  Object.keys(state.totals).forEach(p=> {
    if (!state.players.includes(p)) delete state.totals[p];
  });
}

function syncEventsPlayers(){
  state.events.forEach(ev => {
    state.players.forEach(p => {
      if (!(p in ev.results)) ev.results[p] = '';
      if (!(p in ev.locks))   ev.locks[p]   = false;
    });
    Object.keys(ev.results).forEach(p => {
      if (!state.players.includes(p)) {
        delete ev.results[p];
        delete ev.locks[p];
      }
    });
  });
}

function currentEvent() {
  return state.events[state.currentEventIndex];
}

// --- UI Helpers ---
function resetAll() {
  state.players           = [];
  state.events            = [];
  state.totals            = {};
  state.currentEventIndex = 0;
  state.started           = false;
  clearInterval(state.timer.intervalId);
  state.timer.running     = false;
  state.timer.elapsedMs   = 0;

  ensureTotalsForPlayers();
  updatePlacementPoints();
  syncEventsPlayers();

  // lukitaan lisäysnapit
  qs('#addPlayerBtn').disabled   = false;
  qs('#newPlayerName').disabled  = false;
  qs('#addEventBtn').disabled    = false;
  qs('#newEventName').disabled   = false;

  renderSettings();
  renderTotals();
  qsa('header .topnav button').forEach(b=> {
    if (b.id === 'endGameBtn') return;
    b.disabled = true
  });
  qs('#mainHeader').hidden = true;
  switchView('homeView');
  saveState();
}

// --- Alustus ---
document.addEventListener('DOMContentLoaded', () => {
  loadState();

  // jos jatketaan tallennetusta
  if (state.started) {
    qs('#mainHeader').hidden = false;
    // lukitaan lisäysnapit
    qs('#addPlayerBtn').disabled   = true;
    qs('#newPlayerName').disabled  = true;
    qs('#addEventBtn').disabled    = true;
    qs('#newEventName').disabled   = true;
    qsa('header .topnav button').forEach(b => b.disabled = false);
  }

  // HOME–nappi
  qs('#homeStartBtn').addEventListener('click', () => {
    qs('#mainHeader').hidden = false;
    switchView('settingsView');
  });

  // NAV
  qsa('header .topnav button').forEach(btn => {
    const v = btn.dataset.view;
    if (v && v !== 'settingsView') btn.disabled = !state.started;
    btn.addEventListener('click', () => {
      if (btn.id === 'endGameBtn') return;  // oma käsittelijä alla
      if (v === 'eventsView') {
        renderEventsHeader();
        renderEventInputs();
      } else if (v === 'timerView') {
        renderTimerSelectors();
      } else if (v === 'totalsView') {
        renderTotals();
      }
      switchView(v);
    });
  });

  // PELIN LOPETUS
  qs('#endGameBtn').addEventListener('click', () => {
    qs('#confirmOverlay').hidden = false;
  });
  qs('#confirmYes').addEventListener('click', () => {
    qs('#confirmOverlay').hidden = true;
    localStorage.removeItem('pistelaskuri');
    resetAll();
  });
  qs('#confirmNo').addEventListener('click', () => {
    qs('#confirmOverlay').hidden = true;
  });

  // ASETUKSET
  qs('#addPlayerBtn').addEventListener('click', addPlayer);
  qs('#newPlayerName').addEventListener('keypress', e => {
    if (e.key === 'Enter') addPlayer();
  });
  qs('#addEventBtn').addEventListener('click', addEvent);
  qs('#newEventName').addEventListener('keypress', e => {
    if (e.key === 'Enter') addEvent();
  });

  qs('#goToEventsBtn').addEventListener('click', () => {
    if (!state.players.length || !state.events.length) {
      showToast('Lisää vähintään yksi pelaaja ja yksi tapahtuma', 'error');
      return;
    }
    state.started = true;
    ensureTotalsForPlayers();
    updatePlacementPoints();
    syncEventsPlayers();

    // lukitaan lisäysnapit
    qs('#addPlayerBtn').disabled   = true;
    qs('#newPlayerName').disabled  = true;
    qs('#addEventBtn').disabled    = true;
    qs('#newEventName').disabled   = true;

    qsa('header .topnav button').forEach(b => b.disabled = false);

    renderSettings();
    renderEventsHeader();
    renderEventInputs();
    renderTimerSelectors();
    saveState();
    switchView('eventsView');
  });

  qs('#loadHashBtn').addEventListener('click', () => {
    // uudelleenladataan tila joko hashista tai localStoragesta
    loadState();
    ensureTotalsForPlayers();
    updatePlacementPoints();
    syncEventsPlayers();
  
    renderSettings();
    renderTotals();
  
    if (state.started) {
      // jos pelikin on jo käynnissä, avaamme Events-näkymän
      switchView('eventsView');
      renderEventsHeader();
      renderEventInputs();
      renderTimerSelectors();
    } else {
      // muuten jäämme Settings-näkymään
      switchView('settingsView');
    }
  
    showToast('Peli ladattu', 'success');
  });

  // TAPAHTUMAT-NAV
  qs('#prevEventBtn').addEventListener('click', () => jumpEvent(-1));
  qs('#nextEventBtn').addEventListener('click', () => jumpEvent(1));
  qs('#orderSelect').addEventListener('change', () => {
    currentEvent().order = qs('#orderSelect').value;
    renderEventInputs();
    saveState();
  });
  qs('#saveEventBtn').addEventListener('click', saveCurrentEvent);

  // tallennetaan käsin syötetyt arvot heti focusoutissa
  qs('#eventInputs').addEventListener('focusout', e => {
    if (!e.target.matches('input')) return;
    const ev = currentEvent(), p = e.target.dataset.player, v = e.target.value.trim();
    if (ev.locks[p]) {
      e.target.value = ev.results[p] || '';
      showToast('Kenttä jo lukittu', 'error');
    } else {
      ev.results[p] = v;
      saveState();
    }
    renderEventInputs();
  });

  // SEKUNTIKELLO
  qs('#startTimerBtn').addEventListener('click',   startTimer);
  qs('#stopTimerBtn').addEventListener('click',    stopTimer);
  qs('#resetTimerBtn').addEventListener('click',   resetTimer);
  qs('#timerEventSelect').addEventListener('change', resetTimer);
  qs('#timerPlayerSelect').addEventListener('change', resetTimer);

  renderSettings();
  renderTotals();

  // Aloitettu jo aikaisemmin?
  if (state.started) {
    switchView('eventsView');
  } else {
    switchView('homeView');
  }
});

function switchView(viewId) {
  qsa('.view').forEach(v => v.hidden = true);
  const el = qs(`#${viewId}`);
  if (el) el.hidden = false;
}

// --- ASETUKSET ---
function addPlayer() {
  const val = qs('#newPlayerName').value.trim();
  if (!val) return;
  if (state.players.includes(val)) {
    showToast('Pelaaja jo olemassa','error');
    return;
  }
  state.players.push(val);
  qs('#newPlayerName').value = '';
  ensureTotalsForPlayers();
  updatePlacementPoints();
  syncEventsPlayers();
  renderSettings();
  saveState();
}

function removePlayer(name) {
  state.players = state.players.filter(p => p!==name);
  delete state.totals[name];
  ensureTotalsForPlayers();
  updatePlacementPoints();
  syncEventsPlayers();
  renderSettings();
  renderTotals();
  saveState();
}

function addEvent() {
  const val = qs('#newEventName').value.trim() || `Tapahtuma ${state.events.length+1}`;
  state.events.push({
    name: val,
    results: Object.fromEntries(state.players.map(p=>[p,''])),
    locks:   Object.fromEntries(state.players.map(p=>[p,false])),
    order:   'desc',
    committed:false,
    points: {}
  });
  qs('#newEventName').value = '';
  renderSettings();
  saveState();
}

function renameEvent(i) {
  const old = state.events[i]?.name || `Tapahtuma ${i+1}`;
  const nu  = prompt('Uusi nimi:', old);
  if (nu) {
    state.events[i].name = nu.trim();
    renderSettings();
    renderEventsHeader();
    saveState();
  }
}

function deleteEvent(i) {
  state.events.splice(i,1);
  state.currentEventIndex = Math.min(state.currentEventIndex, state.events.length-1);
  renderSettings();
  renderEventsHeader();
  saveState();
}

function renderSettings(){
  const disableEdit = state.started;
  const disableOpen = !state.started;

  // Pelaajat
  const pl = qs('#playersList');
  pl.innerHTML = '';
  state.players.forEach(p=>{
    const d=document.createElement('div'); d.className='item';
    d.innerHTML = `<span class="name">${p}</span>
      <button class="ghost" data-action="remove">Poista</button>`;
    const btn = d.querySelector('[data-action="remove"]');
    btn.disabled = disableEdit;
    btn.addEventListener('click',()=>removePlayer(p));
    pl.append(d);
  });

  // Tapahtumat
  const evl = qs('#eventNamesList');
  evl.innerHTML = '';
  state.events.forEach((ev,i)=>{
    const d=document.createElement('div'); d.className='item';
    d.innerHTML = `
      <button class="ghost event-name" data-action="open">${ev.name}</button>
      <div class="event-actions">
        <button class="ghost" data-action="rename">Nimeä uudelleen</button>
        <button class="ghost" data-action="delete">Poista</button>
      </div>
    `;

    // Avaa-painike (kiinni ennen aloitusta)
    const openBtn = d.querySelector('[data-action="open"]');
    openBtn.disabled = disableOpen;
    openBtn.addEventListener('click', ()=>{
      if (!state.started) return;
      state.currentEventIndex = i;
      renderEventsHeader();
      renderEventInputs();
      switchView('eventsView');
    });

    const rbtn = d.querySelector('[data-action="rename"]');
    rbtn.disabled = disableEdit;
    rbtn.addEventListener('click',()=>renameEvent(i));

    const dbtn = d.querySelector('[data-action="delete"]');
    dbtn.disabled = disableEdit;
    dbtn.addEventListener('click',()=>deleteEvent(i));

    evl.append(d);
  });
}

// --- TAPAHTUMAT ---
function renderEventsHeader(){
  const title     = qs('#eventTitle');
  const saveBtn   = qs('#saveEventBtn');
  const prevBtn   = qs('#prevEventBtn');
  const nextBtn   = qs('#nextEventBtn');
  const orderSel  = qs('#orderSelect');
  const ev        = currentEvent();

  if (!state.events.length){
    title.textContent = 'Ei tapahtumia';
    prevBtn.disabled  = true;
    nextBtn.disabled  = true;
    saveBtn.disabled  = true;
    orderSel.disabled = true;
    qs('#eventStatus').textContent = '';
    return;
  }

  title.textContent = ev.name;
  prevBtn.disabled  = state.currentEventIndex === 0;
  nextBtn.disabled  = state.currentEventIndex >= state.events.length - 1;
  saveBtn.disabled  = ev.committed;
  orderSel.disabled = ev.committed;
  qs('#eventStatus').textContent = ev.committed ? 'Tallennettu' : '';
}

function jumpEvent(delta){
  if (!state.events.length) return;
  state.currentEventIndex = Math.max(0,
    Math.min(state.events.length-1, state.currentEventIndex+delta)
  );
  renderEventsHeader();
  renderEventInputs();
  saveState();
}

function renderEventInputs(){
  const c = qs('#eventInputs');
  c.innerHTML = '';
  const ev = currentEvent();
  if (!ev) {
    c.innerHTML = '<p class="hint">Lisää tapahtumia.</p>';
    return;
  }

  const sorted = [...state.players].sort((a,b)=>{
    const ra = ev.results[a]||'', rb = ev.results[b]||'';
    const ha = ra!=='', hb = rb!=='';
    if(!ha&&!hb) return 0;
    if(!ha) return 1;
    if(!hb) return -1;
    const va = isTimeFormat(ra)?timeToMs(ra):parseInt(ra,10);
    const vb = isTimeFormat(rb)?timeToMs(rb):parseInt(rb,10);
    return ev.order==='asc'?va-vb:vb-va;
  });

  updatePlacementPoints();

  sorted.forEach(p=>{
    const rid = `evt${state.currentEventIndex}_${p.replace(/\s+/g,'_')}`;
    const lbl = document.createElement('label');
    lbl.setAttribute('for',rid);
    lbl.textContent = p;

    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    const inp  = document.createElement('input');
    inp.type        = 'text';
    inp.id          = rid;
    inp.name        = rid;
    inp.placeholder = 'mm.ss.mmm tai luku';
    inp.value       = ev.results[p] || '';
    inp.readOnly    = !!ev.locks[p];
    inp.dataset.player = p;

    const lockTag = document.createElement('span');
    lockTag.className = 'locktag';
    lockTag.textContent = 'Lukittu';
    lockTag.style.display = ev.locks[p] ? 'inline-block' : 'none';

    const pt = document.createElement('span');
    pt.className = 'pointtag';
    if (ev.committed && p in ev.points) {
      pt.textContent = `+${ev.points[p]}`;
      pt.style.display = 'inline-block';
    } else {
      pt.style.display = 'none';
    }

    wrap.append(inp, lockTag, pt);
    c.append(lbl, wrap);
  });
}

function saveCurrentEvent(){
  const ev = currentEvent();
  if (!ev || ev.committed) {
    if (ev?.committed) showToast('Tapahtuma on jo tallennettu','error');
    return;
  }

  const vals = state.players.map(p=>(ev.results[p]||'').trim());
  if (vals.some(v=>!v||'0123456789'.indexOf(v[0])<0)) {
    showToast('Kelvottomat arvot','error');
    return;
  }

  const types = vals.map(v=>isTimeFormat(v)?'time':isIntegerStr(v)?'int':'invalid');
  if (types.includes('invalid')) {
    showToast('Muoto väärä','error');
    return;
  }
  if (new Set(types).size > 1) {
    showToast('Ei yhtenäinen muoto','error');
    return;
  }

  const isTime = types[0] === 'time';
  const dir    = ev.order === 'asc' ? 1 : -1;
  const rows   = state.players.map(p=>({
    p,
    score: isTime? timeToMs(ev.results[p]): parseInt(ev.results[p],10)
  })).sort((a,b)=>(a.score - b.score)*dir);

  updatePlacementPoints();
  rows.forEach((r,i)=>{
    ev.points[r.p]     = state.placementPoints[i];
    state.totals[r.p] += state.placementPoints[i];
  });
  ev.committed = true;

  renderEventsHeader();
  renderEventInputs();
  renderTotals();
  saveState();
  showToast('Tallennettu','success');
}

function renderTotals(){
  const tb = qs('#leaderboardBodyTotals');
  tb.innerHTML = '';
  ensureTotalsForPlayers();
  const allDone = state.events.length > 0 && state.events.every(e=>e.committed);
  const sorted = Object.entries(state.totals).sort((a,b)=>b[1]-a[1]);

  sorted.forEach(([p,pts], i)=>{
    const tr = document.createElement('tr');
    if (allDone) {
      if (i===0) tr.classList.add('gold');
      else if (i===1) tr.classList.add('silver');
      else if (i===2) tr.classList.add('bronze');
    }
    tr.innerHTML = `<td>${p}</td><td>${pts}</td>`;
    tb.append(tr);
  });
}

// --- Sekuntikello ---
function renderTimerSelectors(){
  const evSel = qs('#timerEventSelect'),
        plSel = qs('#timerPlayerSelect');
  evSel.innerHTML = '';
  state.events.forEach((ev,i)=> evSel.append(new Option(ev.name,i)));
  evSel.value = state.currentEventIndex;

  plSel.innerHTML = '';
  state.players.forEach(p => plSel.append(new Option(p,p)));
}

function updateTimerDisplay(){
  qs('#timerDisplay').textContent = msToDisplay(state.timer.elapsedMs);
}

function startTimer(){
  if (state.timer.running) return;
  state.timer.running = true;
  state.timer.startTs = performance.now() - state.timer.elapsedMs;
  state.timer.intervalId = setInterval(()=>{
    state.timer.elapsedMs = Math.floor(performance.now() - state.timer.startTs);
    updateTimerDisplay();
  }, 16);
}

function stopTimer(){
  if (!state.timer.running) return;
  clearInterval(state.timer.intervalId);
  state.timer.running = false;

  const eIdx = parseInt(qs('#timerEventSelect').value, 10),
        pl   = qs('#timerPlayerSelect').value;
  if (isNaN(eIdx) || !state.events[eIdx]) {
    qs('#timerNotice').textContent = 'Valitse tapahtuma';
    return;
  }
  if (!pl) {
    qs('#timerNotice').textContent = 'Valitse pelaaja';
    return;
  }

  const t  = msToDisplay(state.timer.elapsedMs),
        ev = state.events[eIdx];
  ev.results[pl] = t;
  ev.locks[pl]   = true;

  renderEventInputs();
  qs('#timerNotice').textContent = `${pl}: ${t}`;
  saveState();
  showToast('Aika tallennettu','success');
}

function resetTimer(){
  clearInterval(state.timer.intervalId);
  state.timer.running   = false;
  state.timer.elapsedMs = 0;
  updateTimerDisplay();
  qs('#timerNotice').textContent = '';
}
