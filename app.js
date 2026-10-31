const DB_NAME = 'tmr-copia-ficticia-integracion-v2', STORE = 'data';
const $ = id => document.getElementById(id);
const TURNS = [{id:'1', hours:'15:00 a 17:00'}, {id:'2', hours:'17:00 a 19:00'}, {id:'3', hours:'19:00 a 21:00'}];
const turnId = value => String(value || '3');
const validTurn = value => TURNS.some(t => t.id === String(value));
const turnLabel = value => {const t = TURNS.find(t => t.id === turnId(value)); return `Turno ${t.id} · ${t.hours}`;};
const todayISO = () => {const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const monthISO = () => todayISO().slice(0,7);
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(new Date(value+'T12:00:00').valueOf()) && new Date(value+'T12:00:00').toISOString().slice(0,10) === value;
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
const esc = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const alpha = (a,b) => a.name.localeCompare(b.name,'es');
const fmtDate = date => new Date(date+'T12:00:00').toLocaleDateString('es-AR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
const sessionDates = month => {const [y,m]=month.split('-').map(Number),out=[];for(let d=new Date(y,m-1,1);d.getMonth()===m-1;d.setDate(d.getDate()+1))if([1,3,5].includes(d.getDay()))out.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);return out;};
let state = {schemaVersion:8, players:[], sessions:[], dayTurns:[], trainingPlans:[], exercises:[]};
let currentTurn='3', currentView='home', selectedDate=todayISO(), selectedPlayerId=null;
let exerciseImageLoading=false, exerciseImageRequest=0;
let exerciseCategory='', editingExerciseId=null, exerciseImage='', exerciseFormDirty=false, detailExerciseId=null, exerciseUsageExpanded=false;
let attendanceExpanded=null;
let attendanceDraft=null, attendanceDirty=false, pairDraft=null, pairDirty=false, editingPlayerId=null, busy=false, ready=false;
let editingTrainingNoteId=null, trainingNoteDirty=false, trainingNoteBaseline='';
let attendancePromptOpen=false;
let absenceThreshold=3, followupExpanded=false, followupNoticeEnabled=true;
try{followupNoticeEnabled=localStorage.getItem('tmr-followup-notice-enabled-v1')!=='false';}catch{}
try{const saved=Number(localStorage.getItem('tmr-absence-threshold-v1'));if(Number.isInteger(saved)&&saved>=1&&saved<=10)absenceThreshold=saved;}catch{}
let planDraft=null, planDirty=false, planLoading=false;
try {const saved=localStorage.getItem('tmr-selected-turn');if(validTurn(saved))currentTurn=saved;} catch {}
const getSession = (date, turn=currentTurn, data=state) => data.sessions.find(s => s.date===date && turnId(s.turnId)===turnId(turn));
const sortPlayers = (turn=currentTurn) => state.players.filter(p => !p.guest && p.active!==false && turnId(p.turnId)===turnId(turn)).sort(alpha);
const statusFor = (date,id,turn=currentTurn) => getSession(date,turn)?.attendance?.[id] || '';
function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,1);req.onupgradeneeded=()=>{req.result.createObjectStore(STORE);const queue=req.result.createObjectStore('cola',{keyPath:'id'});queue.createIndex('fechaJugador',['fecha','jugador'],{unique:true})};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
function normalizeState(raw) {
  if (!raw || !Array.isArray(raw.players) || !Array.isArray(raw.sessions) || (raw.schemaVersion && raw.schemaVersion>8)) throw Error('Formato no compatible');
  const players=raw.players.map(p => {
    if(!p || typeof p.id!=='string' || !p.id || ['__proto__','constructor','prototype'].includes(p.id) || typeof p.name!=='string' || !p.name.trim() || !validTurn(turnId(p.turnId)))throw Error('Jugador inválido');
    if(p.trainingNotes!==undefined&&!Array.isArray(p.trainingNotes))throw Error('Notas inválidas');
    const noteIds=new Set();
    const trainingNotes=(p.trainingNotes||[]).map(n=>{
      if(!n||typeof n.id!=='string'||!n.id||noteIds.has(n.id)||!validDate(n.date)||typeof n.text!=='string'||!n.text.trim()||n.text.length>2000)throw Error('Nota de entrenamiento inválida');
      noteIds.add(n.id);return {...n};
    });
    if(p.guest!==undefined&&typeof p.guest!=='boolean')throw Error('Invitado inválido');
    if(p.regularFrom!==undefined&&!validDate(p.regularFrom))throw Error('Inicio de jugador habitual inválido');
    return {...p,guest:!!p.guest,active:p.guest?false:p.active,turnId:turnId(p.turnId),trainingNotes};
  });
  const ids=new Set(players.map(p=>p.id));if(ids.size!==players.length)throw Error('Jugadores duplicados');
  const seen=new Set();
  const sessions=raw.sessions.map(s => {
    if(!s || !validDate(s.date) || !validTurn(turnId(s.turnId)))throw Error('Sesión inválida');
    const turn=turnId(s.turnId), key=`${s.date}/${turn}`;if(seen.has(key))throw Error('Sesión duplicada');seen.add(key);
    const attendance={...(s.attendance || {})};
    for(const [id,mark] of Object.entries(attendance))if(!ids.has(id) || !['present','absent','justified',''].includes(mark))throw Error('Marca inválida');
    // El formato anterior no tenía turnos ni padrón por sesión: corresponde al turno 3.
    const legacy=s.turnId===undefined;
    if(s.roster!==undefined&&!Array.isArray(s.roster))throw Error('Lista de sesión inválida');
    const roster=[...new Set([...(s.roster || (legacy ? players.filter(p=>p.active!==false).map(p=>p.id) : [])),...Object.keys(attendance)])];
    if(roster.some(id=>!ids.has(id)))throw Error('Jugador desconocido');
    if(s.pairing && (!Array.isArray(s.pairing.pairs) || s.pairing.pairs.some(p=>!Array.isArray(p)||p.length!==2||p.some(id=>!ids.has(id)))))throw Error('Parejas inválidas');
    if(s.pairing?.activities!==undefined){const a=s.pairing.activities;if(!a||typeof a!=='object'||Array.isArray(a)||Object.keys(a).some(k=>!['multiball','rebounder','serves'].includes(k)))throw Error('Actividades inválidas');for(const list of Object.values(a))if(!Array.isArray(list)||new Set(list).size!==list.length||list.some(id=>typeof id!=='string'||!ids.has(id)))throw Error('Jugadores de actividad inválidos');}
    if(s.guestIds!==undefined&&!Array.isArray(s.guestIds))throw Error('Invitados de sesión inválidos');
    const guestIds=[...new Set(s.guestIds||[])];
    if(guestIds.some(id=>!roster.includes(id))||roster.some(id=>players.find(p=>p.id===id).guest&&!guestIds.includes(id)))throw Error('Invitado fuera de su sesión');
    const ratings=normalizeRatings(s.ratings,roster,attendance,ids);
    return {...s,turnId:turn,attendance,roster,guestIds,ratings,note:String(s.note || ''),cancelled:!!s.cancelled};
  });
  if(raw.dayTurns!==undefined&&!Array.isArray(raw.dayTurns))throw Error('Cambios de turno inválidos');
  const overrides=new Set();
  const dayTurns=(raw.dayTurns || []).map(o=>{const key=`${o.date}/${o.playerId}`;if(!validDate(o.date)||!ids.has(o.playerId)||!validTurn(o.turnId)||overrides.has(key))throw Error('Cambio de turno inválido');overrides.add(key);return {...o,turnId:String(o.turnId)};});
  const rosterKeys=new Set();
  for(const s of sessions)for(const id of s.roster){const key=`${s.date}/${id}`;if(rosterKeys.has(key))throw Error('Jugador en dos turnos de la misma fecha');rosterKeys.add(key);const override=dayTurns.find(o=>o.date===s.date&&o.playerId===id);if(override&&override.turnId!==s.turnId)throw Error('Cambio de turno inconsistente');}
  if(raw.exercises!==undefined&&!Array.isArray(raw.exercises))throw Error('Ejercicios inválidos');
  const exerciseIds=new Set();
  const exercises=(raw.exercises||[]).map(e=>{
    const title=typeof e?.title==='string'?e.title.trim():'';
    const cats=Array.isArray(e?.cats)?e.cats.map(c=>typeof c==='string'?c.trim():null):null;
    const dur=e?.dur??null, image=e?.image??'';
    if(!e||typeof e.id!=='string'||!e.id||exerciseIds.has(e.id)||!title||title.length>100||typeof e.goal!=='string'||e.goal.length>100||typeof e.desc!=='string'||e.desc.length>2000||!cats||cats.some(c=>c===null||!c||c.length>30)||new Set(cats).size!==cats.length||cats.length>5||!(dur===null||(Number.isInteger(dur)&&dur>=1&&dur<=240))||!(image===''||validPlanImage(image)))throw Error('Ejercicio inválido');
    exerciseIds.add(e.id);
    return {id:e.id,title,goal:e.goal.trim(),desc:e.desc.trim(),dur,cats,image,createdAt:String(e.createdAt||''),updatedAt:String(e.updatedAt||'')};
  });
  if(raw.trainingPlans!==undefined&&!Array.isArray(raw.trainingPlans))throw Error('Planes inválidos');
  const planKeys=new Set();
  const trainingPlans=(raw.trainingPlans||[]).map(p=>{
    const exIds=p?.exerciseIds??[];
    if(!p||!validDate(p.date)||!validTurn(p.turnId)||typeof p.observation!=='string'||p.observation.length>2000||(p.image!==''&&!validPlanImage(p.image))||!Array.isArray(exIds)||exIds.some(id=>!exerciseIds.has(id))||new Set(exIds).size!==exIds.length)throw Error('Plan de entrenamiento inválido');
    const key=p.date+'/'+p.turnId;if(planKeys.has(key))throw Error('Plan duplicado');planKeys.add(key);
    return {date:p.date,turnId:String(p.turnId),image:p.image,observation:p.observation,exerciseIds:[...exIds]};
  }).filter(planHasContent);
  return {schemaVersion:8,players,sessions,dayTurns,trainingPlans,exercises};
}
// Solo esta copia usa el estado por cuenta de la cola de ensayo.
const labCliente=crearClienteSupabaseLab(), labPuente=crearPuenteColaLab({cliente:labCliente,almacen:tmrAlmacenIntegradoLab});
let labRevision=null,labCurrent=null;
function aplicarEstadoLab(row){
 const snap=row.snapshot;if(!snap||snap.fecha!=='2026-11-02'||snap.jugadores.length!==2)throw Error('Estado de prueba inválido');
 const jugadores=snap.jugadores.map(p=>({id:p.id,name:p.nombre,turnId:String(p.turno),active:true}));
 if(jugadores.some(p=>p.turnId!=='1'))throw Error('Turno de prueba inválido');
 const puntajes=row.puntajes??Object.fromEntries(snap.jugadores.map(p=>[p.id,p.puntaje]));const ratings=Object.fromEntries(snap.jugadores.filter(p=>Number.isInteger(puntajes[p.id])&&row.marcas[p.id]==='present').map(p=>[p.id,puntajes[p.id]]));
 state=normalizeState({schemaVersion:8,players:jugadores,sessions:[{id:'sesion-ficticia',date:snap.fecha,turnId:'1',roster:jugadores.map(p=>p.id),guestIds:[],attendance:row.marcas,ratings,note:'',cancelled:false}],dayTurns:[],trainingPlans:[],exercises:[]});
 labRevision=row.revision;labCurrent=row;currentTurn='1';selectedDate=snap.fecha;attendanceDraft=null;attendanceDirty=false;ready=true;renderAll();
}
async function contarLab(){if(!labCurrent)return;const op=await tmrAlmacenIntegradoLab.primeraPendiente(labCurrent.ambito);$('lab-status').textContent=op?(op.estado==='conflict'?'Hay un conflicto pendiente; no vuelvas a marcar este jugador.':'Hay cambios pendientes de envío.'):'Sin cambios pendientes.';}
async function loadState(){ready=false;document.querySelector('main').inert=true;document.querySelector('nav').inert=true;}
async function persist(data=state){let db;try{db=await openDB();await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(data,'main');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error || Error('Guardado interrumpido'));});return true;}catch{alert('No se pudieron guardar los datos. Los cambios anteriores se conservan; volvé a intentar.');return false;}finally{db?.close();}}
async function commit(next){
  alert('Esta copia experimental solo permite ensayar asistencia.');return false;
  if(busy || !ready)return false;
  busy=true;document.querySelector('main').inert=true;document.querySelector('nav').inert=true;
  try {if(!await persist(next))return false;state=next;return true;}
  finally{busy=false;document.querySelector('main').inert=false;document.querySelector('nav').inert=false;}
}
// Copia experimental sin conexión a Supabase. No usar datos reales.
async function commitAsistenciaLab(next,draft){
 if(busy||!ready||!labCurrent)return false;
 const before=getSession(draft.date,draft.turnId,state),after=getSession(draft.date,draft.turnId,next);
 if(!before||draft.date!=='2026-11-02'||draft.turnId!=='1'||draft.newGuests?.length||JSON.stringify(before.ratings||{})!==JSON.stringify(after.ratings||{})||before.note!==after.note||before.cancelled!==after.cancelled){alert('Esta prueba solo permite cambiar marcas sin modificar puntajes, notas ni invitados.');return false;}
 busy=true;document.querySelector('main').inert=true;document.querySelector('nav').inert=true;
 try{const row=await labPuente.guardar({revision:labRevision,marcas:after.attendance});aplicarEstadoLab(row);await contarLab();return true;}
 catch(e){alert('No se guardó: '+(e.message||'error')+'. Los cambios previos se conservan.');return false;}
 finally{busy=false;document.querySelector('main').inert=!ready;document.querySelector('nav').inert=!ready;}
}

function effectiveTurn(player,date,data=state){
  const override=data.dayTurns.find(o=>o.playerId===player.id&&o.date===date);if(override)return override.turnId;
  // Una sesión guardada conserva su padrón aunque luego cambie el turno fijo.
  const recorded=data.sessions.find(s=>s.date===date&&(s.roster.includes(player.id)||Object.hasOwn(s.attendance,player.id)));
  return recorded ? recorded.turnId : player.turnId;
}
function rosterFor(date,turn=currentTurn,data=state){
  const s=getSession(date,turn,data);
  const ids=s ? new Set(s.roster) : null;
  return data.players.filter(p=>ids?.has(p.id) || (!p.guest && p.active!==false && (!p.regularFrom||date>=p.regularFrom) && effectiveTurn(p,date,data)===turnId(turn))).sort(alpha);
}
function newSession(date,turn=currentTurn,data=state){return {id:uid(),date,turnId:turnId(turn),roster:rosterFor(date,turn,data).map(p=>p.id),attendance:{},guestIds:[],ratings:{},note:'',cancelled:false,updatedAt:new Date().toISOString()};}
function withSession(data,session){return {...data,sessions:[...data.sessions.filter(s=>!(s.date===session.date&&s.turnId===session.turnId)),session]};}
function optionsTurns(selected){return TURNS.map(t=>`<option value="${t.id}" ${t.id===selected?'selected':''}>${turnLabel(t.id)}</option>`).join('');}
function updateConnection(){const el=$('connection');el.textContent=navigator.onLine?'En línea':'Sin internet · guardado local';el.className='pill '+(navigator.onLine?'online':'offline');}
function guardDrafts(){
  if(busy||attendancePromptOpen||planLoading)return false;
  if((attendanceDirty||pairDirty||trainingNoteDirty||planDirty) && !confirm('Hay cambios sin guardar en asistencia, parejas, notas o el plan del entrenamiento. ¿Descartarlos para continuar?'))return false;
  attendanceDraft=null;attendanceDirty=false;pairDraft=null;pairDirty=false;planDraft=null;planDirty=false;resetTrainingNoteEditor();return true;
}
function showView(name){
  if(!ready||busy)return;
  if(name!==currentView && !guardDrafts())return;
  currentView=name;
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${name}`));
  document.querySelectorAll('[data-nav]').forEach(b=>b.classList.toggle('active',b.dataset.nav===(['player','followup'].includes(name)?'players':name)));
  if(name==='followup'||name==='home')renderFollowup();
  if(name==='exercises')renderExercises();
  if(name==='attendance')renderAttendance();if(name==='ratings')renderRatings();if(name==='pairs')renderPairs();if(name==='players')renderPlayers();if(name==='history')renderHistory();if(name==='stats')renderStats();if(name==='player')renderPlayerProfile();window.scrollTo(0,0);
}
function renderHome(){
  $('total-players').textContent=sortPlayers().length;
  $('total-sessions').textContent=state.sessions.filter(s=>s.turnId===currentTurn&&s.date.startsWith(monthISO())&&s.date<=todayISO()&&!s.cancelled).length;
  const d=new Date(todayISO()+'T12:00:00');while(![1,3,5].includes(d.getDay()))d.setDate(d.getDate()+1);
  const date=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  $('next-session').innerHTML=`<strong>${esc(fmtDate(date))}</strong><br><span class="muted">${turnLabel(currentTurn)}</span><button class="primary full home-open-list" id="home-take-attendance">Abrir lista <span aria-hidden="true">→</span></button>`;
  $('home-take-attendance').onclick=()=>openAttendance(date);
  renderLastSession();
  renderFollowup();
}
// Se consultan las marcas guardadas de todos los turnos; nunca se generan faltas.
function absenceFollowup(asOf=todayISO(),data=state){
  const records=new Map();
  for(const session of data.sessions){
    if(session.cancelled||session.date>asOf||![1,3,5].includes(new Date(session.date+'T12:00:00').getDay()))continue;
    for(const [id,status] of Object.entries(session.attendance)){
      if(!['present','absent','justified'].includes(status))continue;
      if(!records.has(id))records.set(id,new Map());
      const dates=records.get(id),previous=dates.get(session.date);
      // Un único registro por fecha. En datos inconsistentes, prevalece la presencia.
      if(!previous||status==='present'||(status==='justified'&&previous!=='present'))dates.set(session.date,status);
    }
  }
  return data.players.filter(player=>!player.guest&&player.active!==false).map(player=>{
    const dates=[...(records.get(player.id)||new Map())].sort((a,b)=>b[0].localeCompare(a[0]));
    let count=0,lastAbsence=null;
    for(const [date,status] of dates){if(status!=='absent')break;if(!lastAbsence)lastAbsence=date;count++;}
    const lastPresent=dates.find(([,status])=>status==='present')?.[0]||null;
    return {player,count,lastPresent,lastAbsence};
  }).filter(row=>row.count>0).sort((a,b)=>b.count-a.count||(a.lastPresent||'').localeCompare(b.lastPresent||'')||alpha(a.player,b.player));
}
function renderFollowup(){
  $('followup-threshold').value=String(absenceThreshold);
  const rows=absenceFollowup().filter(row=>row.count>=absenceThreshold),visible=followupExpanded?rows:rows.slice(0,5);
  $('followup-count').textContent=String(rows.length);
  $('followup-notice').hidden=!followupNoticeEnabled||rows.length===0;
  $('followup-notice-enabled').checked=followupNoticeEnabled;
  $('followup-notice-text').textContent=`${rows.length===1?'1 jugador':rows.length+' jugadores'} con ${absenceThreshold} o más faltas seguidas · todos los turnos.`;
  $('followup-summary').textContent=rows.length?`${rows.length===1?'1 jugador para revisar':rows.length+' jugadores para revisar'} · todos los turnos.`:`No hay jugadores activos con ${absenceThreshold} o más faltas seguidas en las marcas guardadas.`;
  const shortDate=date=>new Date(date+'T12:00:00').toLocaleDateString('es-AR');
  $('followup-list').innerHTML=visible.map(row=>`<article class="followup-row"><div class="followup-heading"><button type="button" class="player-profile-link" data-search-profile="${esc(row.player.id)}">${esc(row.player.name)}<span>Ver ficha →</span></button><span class="followup-streak">${row.count} ${row.count===1?'falta':'faltas'} seguidas</span></div><p class="hint">Habitual: ${turnLabel(row.player.turnId)}</p><p class="hint">Última asistencia: ${row.lastPresent?esc(shortDate(row.lastPresent)):'sin asistencias registradas'}.<br>Última falta registrada: ${esc(shortDate(row.lastAbsence))}.</p></article>`).join('');
  $('followup-expand').hidden=rows.length<=5;
  $('followup-expand').textContent=followupExpanded?'Mostrar menos':`Ver los ${rows.length} jugadores`;
  $('followup-expand').setAttribute('aria-expanded',String(followupExpanded));
}
function openAttendance(date){if(!guardDrafts())return;selectedDate=date;showView('attendance');}
function loadAttendanceDraft(){
  const s=getSession(selectedDate) || newSession(selectedDate);
  attendanceDraft={...s,roster:rosterFor(selectedDate).map(p=>p.id),guestIds:[...(s.guestIds||[])],newGuests:[],attendance:{...s.attendance},ratings:{...(s.ratings||{})}};attendanceDirty=false;
  $('guest-message').textContent='';$('guest-name').value='';$('guest-existing').value='';
}
function attendanceCounts(session=attendanceDraft){
  const counts={present:0,absent:0,justified:0,unmarked:0};
  for(const player of attendancePlayers(session)){
    const status=session.attendance[player.id];
    if(['present','absent','justified'].includes(status))counts[status]++;else counts.unmarked++;
  }
  return counts;
}
function renderAttendanceSummary(){
  const c=attendanceCounts();
  const items=[['present',`${c.present} ${c.present===1?'presente':'presentes'}`],['absent',`${c.absent} ${c.absent===1?'falta':'faltas'}`],['justified',`${c.justified} ${c.justified===1?'justificada':'justificadas'}`],['unmarked',`${c.unmarked} sin marcar`]];
  $('attendance-summary').innerHTML=items.map(([kind,text])=>`<span class="attendance-count ${kind}">${text}</span>`).join(' ');
  $('attendance-summary-note').textContent=attendanceDraft?.cancelled?'Sesión cancelada: no cuenta como falta.':c.unmarked?'Sin marcar no cuenta como falta.':'';
}
function confirmIncompleteAttendance(session,counts){
  const pending=attendancePlayers(session).filter(p=>!['present','absent','justified'].includes(session.attendance[p.id]));
  const text=`${counts.unmarked===1?'Queda 1 jugador sin marcar':`Quedan ${counts.unmarked} jugadores sin marcar`}. Podés completar la lista o guardarla así. Sin marcar no cuenta como falta.`;
  const dialog=$('attendance-pending-dialog');
  if(typeof dialog.showModal!=='function')return Promise.resolve(confirm(text+'\n\nAceptar: guardar igual. Cancelar: volver a completar.'));
  attendancePromptOpen=true;
  $('attendance-pending-context').textContent=`${fmtDate(session.date)} · ${turnLabel(session.turnId)}`;
  $('attendance-pending-text').textContent=text;
  $('attendance-pending-names').textContent='Sin marcar: '+pending.map(p=>p.name).join(', ')+'.';
  return new Promise(resolve=>{
    let settled=false;
    const finish=save=>{
      if(settled)return;settled=true;
      dialog.onclose=null;dialog.oncancel=null;
      $('attendance-pending-save').onclick=null;$('attendance-pending-complete').onclick=null;
      if(dialog.open)dialog.close();
      attendancePromptOpen=false;resolve(save);
    };
    $('attendance-pending-save').onclick=()=>finish(true);
    $('attendance-pending-complete').onclick=()=>finish(false);
    dialog.oncancel=event=>{event.preventDefault();finish(false);};
    dialog.onclose=()=>{if(!dialog.open)finish(false);};
    try{dialog.showModal();$('attendance-pending-complete').focus();}
    catch{finish(confirm(text+'\n\nAceptar: guardar igual. Cancelar: volver a completar.'));}
  });
}
function focusFirstUnmarked(session){
  const player=attendancePlayers(session).find(p=>!['present','absent','justified'].includes(session.attendance[p.id]));
  const button=player?[...document.querySelectorAll('#attendance-list [data-expand-player]')].find(b=>b.dataset.expandPlayer===player.id):null;
  if(button){button.scrollIntoView({block:'center',behavior:'smooth'});button.focus({preventScroll:true});}
}
function renderAttendance(){
  if(!attendanceDraft||attendanceDraft.date!==selectedDate||attendanceDraft.turnId!==currentTurn)loadAttendanceDraft();
  const s=attendanceDraft;
  $('session-date').value=selectedDate;$('session-note').value=s.note;$('session-cancelled').checked=s.cancelled;
  const players=attendancePlayers(s);
  $('attendance-list').innerHTML=players.length ? players.map(p=>{
    const st=s.attendance[p.id]||'';
    const label=({present:'Presente',absent:'Falta',justified:'Justificada'})[st]||'Sin marcar', expanded=attendanceExpanded===p.id;
    return `<div class="person-row compact-player"><button type="button" class="attendance-person" data-expand-player="${esc(p.id)}" aria-expanded="${expanded}"><span class="person-name">${esc(p.name)}${s.guestIds.includes(p.id)?'<span class="guest-label">Invitado por el día</span>':p.turnId!==currentTurn?`<span class="guest-label">Habitual: Turno ${esc(p.turnId)}</span>`:p.active===false?'<span class="guest-label">Inactivo · registro histórico</span>':''}</span><span class="badge ${st}">${label}</span><span aria-hidden="true">${expanded?'▴':'▾'}</span></button><div class="status-buttons" ${expanded?'':'hidden'}>${[['present','Presente'],['absent','Falta'],['justified','Justificada']].map(([v,l])=>`<button type="button" class="status-btn ${st===v?'selected '+v:''}" data-player="${esc(p.id)}" data-status="${v}" aria-label="${l}: ${esc(p.name)}" aria-pressed="${st===v}">${l}</button>`).join('')}</div>${s.guestIds.includes(p.id)&&expanded?`<button type="button" class="secondary guest-remove" data-remove-guest="${esc(p.id)}">Quitar de esta fecha</button>`:''}</div>`;
  }).join('') : '<div class="empty">No hay jugadores para este turno y fecha. Agregalos en Jugadores o traé uno con Cambio de turno por esta fecha.</div>';
  $('save-message').textContent=attendanceDirty?'Cambios sin guardar.':'';
  renderAttendanceSummary();
  renderGuestOptions();
  renderDayMoves();
  renderPlan();
}
const PLAN_IMAGE_LIMIT=3500000;
function validPlanImage(image){return typeof image==='string'&&image.length<=PLAN_IMAGE_LIMIT&&/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image);}
function getPlan(date,turn=currentTurn){return (state.trainingPlans||[]).find(p=>p.date===date&&p.turnId===turn);}
// El borrador no debe compartir objetos con el estado guardado: un cambio sin guardar no debe llegar a una copia exportada.
// Los planes vacíos no contienen trabajo que conservar; aceptar y limpiar los de copias 1.19.1.
function planHasContent(plan){return !!(plan.image||plan.observation.trim()||plan.exerciseIds.length);}
const planCopy = plan => ({...plan,exerciseIds:[...plan.exerciseIds]});
function renderPlan(){
  if(!planDraft||planDraft.date!==selectedDate||planDraft.turnId!==currentTurn){planDraft=planCopy(getPlan(selectedDate)||{date:selectedDate,turnId:currentTurn,image:'',observation:'',exerciseIds:[]});planDirty=false;}
  $('plan-context').textContent=`${fmtDate(selectedDate)} · ${turnLabel(currentTurn)}`;
  $('plan-observation').value=planDraft.observation;
  const image=$('plan-thumbnail');image.hidden=!planDraft.image;
  if(planDraft.image)image.src=planDraft.image;else image.removeAttribute('src');
  $('plan-view').hidden=!planDraft.image&&!planDraft.observation.trim()&&!planDraft.exerciseIds.length;renderPlanExercises();$('plan-view').textContent=planDraft.image?'Ver imagen ampliada':'Ver plan';$('plan-remove').hidden=!getPlan(selectedDate)&&!planDraft.image;
  $('plan-file-label').textContent=planDraft.image?'Reemplazar imagen':'Subir imagen';
  $('plan-save').disabled=planLoading||!planDirty;
  $('plan-observation').disabled=planLoading;
  $('plan-message').textContent=planLoading?'Preparando imagen…':planDirty?'Plan sin guardar.':getPlan(selectedDate)?'Plan guardado en este dispositivo.':'Podés guardar el plan antes de pasar asistencia.';
}
async function preparePlanImage(file){
  if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Elegí una imagen JPG, PNG o WebP.');
  if(file.size>15*1024*1024)throw Error('La imagen supera los 15 MB. Elegí una versión más liviana.');
  const url=URL.createObjectURL(file);
  try{
    const image=new Image();image.src=url;try{await image.decode();}catch{throw Error('No se pudo leer la imagen. Probá con otro archivo JPG, PNG o WebP.');}
    if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth*image.naturalHeight>50000000)throw Error('La imagen es demasiado grande. Elegí una versión más pequeña.');
    const scale=Math.min(1,2400/Math.max(image.naturalWidth,image.naturalHeight)),canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
    const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
    const result=canvas.toDataURL('image/jpeg',0.9);
    if(!validPlanImage(result))throw Error('No se pudo preparar una imagen liviana. Probá con una de menor tamaño.');
    return result;
  }finally{URL.revokeObjectURL(url);}
}
async function choosePlanImage(event){
  const file=event.target.files[0];event.target.value='';if(!file||busy||planLoading||!planDraft)return;
  planLoading=true;renderPlan();
  try{const image=await preparePlanImage(file);planDraft.image=image;planDirty=true;planLoading=false;renderPlan();}
  catch(error){planLoading=false;renderPlan();$('plan-message').textContent=error.message||'No se pudo abrir la imagen. Probá con otra.';}
}
async function savePlan(){
  if(busy||planLoading||!planDraft||!planDirty)return;
  const plan={...planDraft,observation:$('plan-observation').value.trim()};
  if(!plan.image&&!plan.observation&&!plan.exerciseIds.length){$('plan-message').textContent='Escribí una observación, subí una imagen o agregá ejercicios para guardar el plan.';return;}
  const next={...state,trainingPlans:[...(state.trainingPlans||[]).filter(p=>!(p.date===plan.date&&p.turnId===plan.turnId)),plan]};
  if(await commit(next)){planDraft=planCopy(plan);planDirty=false;renderAll();}
  else $('plan-message').textContent='No se pudo guardar el plan. La imagen y la observación siguen aquí para reintentar.';
}
async function removePlan(){
  if(busy||planLoading||!planDraft||!confirm('¿Eliminar el plan de esta fecha y turno? La asistencia y las parejas se conservan.'))return;
  const next={...state,trainingPlans:(state.trainingPlans||[]).filter(p=>!(p.date===selectedDate&&p.turnId===currentTurn))};
  if(await commit(next)){planDraft=null;planDirty=false;renderAll();}
}
const getExercise = id => (state.exercises||[]).find(e => e.id === id);
const monthsBefore = (iso, months) => {const d = new Date(iso+'T12:00:00'); d.setMonth(d.getMonth()-months); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const planExerciseList = ids => ids.map(getExercise).filter(Boolean);
const exerciseMatches = (e, query) => {const text = searchName([e.title, e.goal, ...e.cats].join(' ')); return searchName(query).split(/\s+/).filter(Boolean).every(w => text.includes(w));};
const exerciseOrder = (a, b) => a.title.localeCompare(b.title, 'es');
function renderPlanExercises(){
  const items=planExerciseList(planDraft?.exerciseIds||[]);
  $('plan-exercise-list').innerHTML=items.length?items.map((e,i)=>`<div class="plan-exercise"><span>${i+1}. ${esc(e.title)}${e.dur?` · ${e.dur} min`:''}</span><div class="plan-exercise-buttons"><button type="button" class="secondary" aria-label="Subir ${esc(e.title)}" data-plan-exercise-move="${esc(e.id)}" data-dir="-1" ${i===0?'disabled':''}>↑</button><button type="button" class="secondary" aria-label="Bajar ${esc(e.title)}" data-plan-exercise-move="${esc(e.id)}" data-dir="1" ${i===items.length-1?'disabled':''}>↓</button><button type="button" class="secondary" data-plan-exercise-remove="${esc(e.id)}">Quitar</button></div></div>`).join(''):'<p class="hint">Todavía no hay ejercicios en este plan.</p>';
  const total=items.reduce((sum,e)=>sum+(e.dur||0),0);
  $('plan-exercise-total').textContent=items.length?`Total de ejercicios: ${total} min`:'';
}
function movePlanExercise(id,dir){
  if(!planDraft||busy||planLoading)return;
  const ids=[...planDraft.exerciseIds], i=ids.indexOf(id), j=i+dir;
  if(i<0||j<0||j>=ids.length)return;
  [ids[i],ids[j]]=[ids[j],ids[i]];
  planDraft.exerciseIds=ids;planDirty=true;
  renderPlan();
}
function openPlanCopy(){
  if(!planDraft||busy||planLoading)return;
  const sources=(state.trainingPlans||[]).filter(p=>p.turnId===currentTurn&&p.date!==selectedDate&&p.exerciseIds.length).sort((a,b)=>b.date.localeCompare(a.date));
  $('plan-copy-list').innerHTML=sources.length?sources.map(p=>`<div class="exercise-pick"><div><strong>${esc(fmtDate(p.date))}</strong><div class="hint">${planExerciseList(p.exerciseIds).length} ejercicios</div></div><button type="button" class="primary" data-copy-plan="${esc(p.date)}">Copiar</button></div>`).join(''):'<p class="hint">Este turno no tiene planes con ejercicios en otras fechas.</p>';
  $('plan-copy-dialog').showModal();
}
function copyPlanExercises(date){
  const source=getPlan(date);if(!planDraft||!source||busy||planLoading)return;
  if(planDraft.exerciseIds.length&&!confirm('¿Reemplazar los ejercicios de este plan por los de la fecha elegida? La observación y la imagen no cambian.'))return;
  planDraft.exerciseIds=[...source.exerciseIds];planDirty=true;
  $('plan-copy-dialog').close();renderPlan();
}
function removePlanExercise(id){
  if(!planDraft||busy||planLoading)return;
  planDraft.exerciseIds=planDraft.exerciseIds.filter(x=>x!==id);planDirty=true;
  renderPlan();
}
function openExercisePicker(){
  if(!planDraft||busy||planLoading)return;
  $('exercise-picker-search').value='';renderExercisePicker();$('exercise-picker').showModal();$('exercise-picker-search').focus();
}
function renderExercisePicker(){
  const chosen=new Set(planDraft?.exerciseIds||[]), all=state.exercises||[], query=$('exercise-picker-search').value;
  const items=all.filter(e=>!chosen.has(e.id)&&(!query.trim()||exerciseMatches(e,query))).sort(exerciseOrder);
  $('exercise-picker-list').innerHTML=items.length?items.map(e=>`<div class="exercise-pick"><div><strong>${esc(e.title)}</strong><div class="hint">${[e.goal,e.dur?`${e.dur} min`:''].filter(Boolean).map(esc).join(' · ')}</div></div><button type="button" class="primary" data-pick-exercise="${esc(e.id)}">Agregar</button></div>`).join(''):`<p class="hint">${all.length?'No hay ejercicios disponibles con esa búsqueda.':'La biblioteca está vacía.'}</p>`;
}
function pickExercise(id){
  if(!planDraft||busy||planLoading||planDraft.exerciseIds.includes(id))return;
  planDraft.exerciseIds=[...planDraft.exerciseIds,id];planDirty=true;
  renderPlan();renderExercisePicker();
}
function renderExercises(){
  const all=state.exercises||[];
  const cats=[...new Set(all.flatMap(e=>e.cats))].sort((a,b)=>a.localeCompare(b,'es'));
  if(exerciseCategory&&!cats.includes(exerciseCategory))exerciseCategory='';
  $('exercise-filters').innerHTML=['',...cats].map(c=>`<button type="button" class="chip${c===exerciseCategory?' on':''}" data-exercise-category="${esc(c)}">${c?esc(c):'Todas'}</button>`).join('');
  const query=$('exercise-search').value;
  const items=all.filter(e=>(!exerciseCategory||e.cats.includes(exerciseCategory))&&(!query.trim()||exerciseMatches(e,query))).sort(exerciseOrder);
  $('exercise-count').textContent=`${items.length} ${items.length===1?'ejercicio':'ejercicios'}`;
  $('exercise-list').innerHTML=items.length?items.map(e=>`<button type="button" class="secondary full exercise-item" data-exercise-detail="${esc(e.id)}"><span class="exercise-title">${esc(e.title)}</span><span class="exercise-meta">${[e.goal,e.dur?`${e.dur} min`:'',e.cats.join(', ')].filter(Boolean).map(esc).join(' · ')}</span></button>`).join(''):`<p class="hint">${all.length?'Ningún ejercicio coincide con la búsqueda.':'Todavía no hay ejercicios. Usá «Nuevo ejercicio» para agregar el primero.'}</p>`;
}
function openExerciseDetail(id){
  const e=getExercise(id);if(!e||busy)return;
  detailExerciseId=id;
  $('exercise-detail-title').textContent=e.title;
  $('exercise-detail-info').textContent=[e.goal,e.dur?`${e.dur} min`:'',e.cats.join(', ')].filter(Boolean).join(' · ');
  $('exercise-detail-desc').textContent=e.desc;$('exercise-detail-desc').hidden=!e.desc;
  $('exercise-detail-image').hidden=!e.image;if(e.image)$('exercise-detail-image').src=e.image;else $('exercise-detail-image').removeAttribute('src');
  exerciseUsageExpanded=false;renderExerciseUsage(id);
  $('exercise-detail').showModal();
}
// Muestra las últimas 4 fechas; con el botón, las de los últimos 2 meses.
function renderExerciseUsage(id){
  const usedIn=(state.trainingPlans||[]).filter(p=>p.exerciseIds.includes(id)).sort((a,b)=>b.date.localeCompare(a.date));
  if(!usedIn.length){$('exercise-detail-use').textContent='No está en ningún plan guardado.';return;}
  const cutoff=monthsBefore(todayISO(),2);
  const recent=usedIn.filter(p=>p.date>=cutoff);
  const shown=exerciseUsageExpanded?recent:usedIn.slice(0,4);
  const line=p=>`<br>${esc(fmtDate(p.date))} · ${esc(turnLabel(p.turnId))}`;
  $('exercise-detail-use').innerHTML=`<strong>Usado en ${usedIn.length} ${usedIn.length===1?'plan':'planes'}</strong>${exerciseUsageExpanded?`<br>En los últimos 2 meses: ${recent.length}`:''}${shown.length?shown.map(line).join(''):'<br>No hubo usos en los últimos 2 meses.'}${usedIn.length>4?`<br><button type="button" class="secondary" data-exercise-usage-toggle="${esc(id)}">${exerciseUsageExpanded?'Ver solo las últimas 4':'Ver últimos 2 meses'}</button>`:''}`;
}
function renderExerciseImage(){
  $('exercise-thumb').hidden=!exerciseImage;if(exerciseImage)$('exercise-thumb').src=exerciseImage;else $('exercise-thumb').removeAttribute('src');
  $('exercise-file-label').textContent=exerciseImage?'Reemplazar imagen':'Subir imagen';
  $('exercise-image-remove').hidden=!exerciseImage;
  $('exercise-image-remove').disabled=exerciseImageLoading;
  $('exercise-save').disabled=exerciseImageLoading;
  $('exercise-file-label').textContent=exerciseImageLoading?'Preparando imagen…':exerciseImage?'Reemplazar imagen':'Subir imagen';
}
function openExerciseForm(id){
  if(busy)return;
  const e=id?getExercise(id):null;
  exerciseImageRequest++;exerciseImageLoading=false;
  editingExerciseId=e?e.id:null;exerciseImage=e?.image||'';exerciseFormDirty=false;
  $('exercise-form-heading').textContent=e?'Editar ejercicio':'Nuevo ejercicio';
  $('exercise-title').value=e?.title||'';$('exercise-goal').value=e?.goal||'';$('exercise-desc').value=e?.desc||'';$('exercise-dur').value=e?.dur||'';$('exercise-cats').value=e?e.cats.join(', '):'';
  $('exercise-form-message').textContent='';renderExerciseImage();
  $('exercise-form-dialog').showModal();$('exercise-title').focus();
}
function closeExerciseForm(){
  if(busy)return;
  if(exerciseFormDirty&&!confirm('¿Descartar los cambios del ejercicio sin guardar?'))return;
  exerciseImageRequest++;exerciseImageLoading=false;
  exerciseFormDirty=false;editingExerciseId=null;$('exercise-form-dialog').close();
}
async function chooseExerciseImage(event){
  const file=event.target.files[0];event.target.value='';if(!file||busy||!$('exercise-form-dialog').open)return;
  const request=++exerciseImageRequest;exerciseImageLoading=true;exerciseFormDirty=true;
  renderExerciseImage();$('exercise-form-message').textContent='Preparando imagen… Esperá antes de guardar.';
  try{
    const image=await preparePlanImage(file);
    if(request!==exerciseImageRequest||!$('exercise-form-dialog').open)return;
    exerciseImage=image;$('exercise-form-message').textContent='';
  }catch(error){
    if(request!==exerciseImageRequest||!$('exercise-form-dialog').open)return;
    $('exercise-form-message').textContent=error.message||'No se pudo abrir la imagen. Probá con otra.';
  }finally{
    if(request===exerciseImageRequest&&$('exercise-form-dialog').open){exerciseImageLoading=false;renderExerciseImage();}
  }
}
async function saveExercise(event){
  event.preventDefault();if(busy||!$('exercise-form-dialog').open)return;
  const message=$('exercise-form-message');
  if(exerciseImageLoading){message.textContent='Esperá a que termine de prepararse la imagen antes de guardar.';return;}
  const title=$('exercise-title').value.trim(), goal=$('exercise-goal').value.trim(), desc=$('exercise-desc').value.trim();
  const durText=$('exercise-dur').value.trim(), dur=durText?Number(durText):null;
  const cats=[...new Set($('exercise-cats').value.split(',').map(c=>c.trim()).filter(Boolean))];
  if(!title||title.length>100){message.textContent='El título es obligatorio y tiene hasta 100 caracteres.';return;}
  if(goal.length>100){message.textContent='El objetivo tiene hasta 100 caracteres.';return;}
  if(desc.length>2000){message.textContent='La descripción tiene hasta 2000 caracteres.';return;}
  if(dur!==null&&!(Number.isInteger(dur)&&dur>=1&&dur<=240)){message.textContent='La duración debe ser un número entero de 1 a 240 minutos.';return;}
  if(cats.length>5||cats.some(c=>c.length>30)){message.textContent='Hasta 5 categorías, de 30 caracteres cada una.';return;}
  const now=new Date().toISOString();
  const existing=editingExerciseId?getExercise(editingExerciseId):null;
  const item={id:existing?existing.id:uid(),title,goal,desc,dur,cats,image:exerciseImage,createdAt:existing?existing.createdAt:now,updatedAt:now};
  const next={...state,exercises:existing?state.exercises.map(e=>e.id===existing.id?item:e):[...(state.exercises||[]),item]};
  if(await commit(next)){exerciseFormDirty=false;editingExerciseId=null;$('exercise-form-dialog').close();renderExercises();renderPlanExercises();}
  else message.textContent='No se pudo guardar. El ejercicio sigue en el formulario para reintentar.';
}
async function deleteExercise(id){
  const e=getExercise(id);if(!e||busy)return;
  const uses=(state.trainingPlans||[]).filter(p=>p.exerciseIds.includes(id)).length;
  if(!confirm(`¿Eliminar «${e.title}»?${uses?` Se quita de ${uses} plan${uses===1?'':'es'} guardado${uses===1?'':'s'}.`:''} Las asistencias y parejas no cambian.`))return;
  const next={...state,exercises:state.exercises.filter(x=>x.id!==id),trainingPlans:(state.trainingPlans||[]).map(p=>({...p,exerciseIds:p.exerciseIds.filter(x=>x!==id)})).filter(planHasContent)};
  if(await commit(next)){if(planDraft)planDraft.exerciseIds=planDraft.exerciseIds.filter(x=>x!==id);detailExerciseId=null;$('exercise-detail').close();renderExercises();renderPlan();}
}
function viewPlan(plan){
  if(!plan||(!plan.image&&!plan.observation.trim()&&!plan.exerciseIds.length))return;
  $('plan-viewer-title').textContent=`Plan · ${fmtDate(plan.date)} · ${turnLabel(plan.turnId)}`;
  $('plan-viewer-scroll').hidden=!plan.image;$('plan-zoom').hidden=!plan.image;
  if(plan.image)$('plan-viewer-image').src=plan.image;else $('plan-viewer-image').removeAttribute('src');
  const exercises=planExerciseList(plan.exerciseIds);
  $('plan-viewer-observation').style.whiteSpace='pre-line';
  $('plan-viewer-observation').textContent=[plan.observation.trim(),exercises.length?'Ejercicios:':'',...exercises.map(e=>`• ${e.title}${e.dur?` (${e.dur} min)`:''}`)].filter(Boolean).join('\n');
  $('plan-viewer-scroll').classList.remove('zoomed');$('plan-zoom').textContent='Ampliar';
  $('plan-viewer').showModal();
}
function renderDayMoves(){
  const available=state.players.filter(p=>!p.guest&&p.active!==false).sort(alpha);
  const previous=$('day-player').value;
  $('day-player').innerHTML='<option value="">Elegí un jugador</option>'+available.map(p=>`<option value="${esc(p.id)}">${esc(p.name)} · Turno ${effectiveTurn(p,selectedDate)} hoy (habitual ${p.turnId})</option>`).join('');
  if(available.some(p=>p.id===previous))$('day-player').value=previous;
  $('day-destination').innerHTML=optionsTurns(currentTurn);
  const changes=state.dayTurns.filter(o=>o.date===selectedDate);
  $('day-changes').innerHTML=changes.length ? changes.map(o=>{const p=state.players.find(p=>p.id===o.playerId);return `<div>${esc(p.name)} → Turno ${o.turnId} (habitual ${p.turnId})</div>`;}).join('') : 'Sin cambios de turno para esta fecha.';
}
async function saveAttendance(){
  if(busy||attendancePromptOpen||!attendanceDraft)return;
  const s={...attendanceDraft,note:$('session-note').value.trim(),cancelled:$('session-cancelled').checked,updatedAt:new Date().toISOString()};
  if(!validDate(s.date))return;
  const counts=attendanceCounts(s);
  if(!s.cancelled&&counts.unmarked>0&&!await confirmIncompleteAttendance(s,counts)){
    $('save-message').textContent=`Quedan ${counts.unmarked} sin marcar. Completá la lista o tocá Guardar asistencia para elegir guardar igual.`;
    focusFirstUnmarked(s);return;
  }
  const {newGuests=[],...savedSession}=s;
  savedSession.ratings=cleanRatings(s);
  const previous=getSession(s.date,s.turnId,state);
  const unchanged=previous&&!newGuests.length&&previous.note===savedSession.note&&previous.cancelled===savedSession.cancelled&&JSON.stringify(previous.ratings||{})===JSON.stringify(savedSession.ratings||{})&&Object.keys({...previous.attendance,...savedSession.attendance}).every(id=>(previous.attendance[id]||'')===(savedSession.attendance[id]||''))&&JSON.stringify(previous.guestIds||[])===JSON.stringify(savedSession.guestIds||[])&&JSON.stringify(previous.roster||[])===JSON.stringify(savedSession.roster||[])&&JSON.stringify(previous.pairing||null)===JSON.stringify(savedSession.pairing||null);
  if(unchanged){attendanceDirty=false;$('save-message').textContent='No hay cambios nuevos para guardar. Las marcas anteriores se conservan.';return;}
  const next=withSession({...state,players:[...state.players,...newGuests],dayTurns:state.dayTurns.filter(o=>!(o.date===s.date&&s.guestIds.includes(o.playerId)))},savedSession);
  if(await commitAsistenciaLab(next,s)){attendanceDraft=null;attendanceDirty=false;renderAll();$('save-message').textContent='Prueba ficticia guardada en este dispositivo; cambios pendientes en la cola local.'+(pairingIssues(s).length?' Revisá Parejas: hay un emparejamiento que requiere corregir asistencia o cancelación.':'');}
  else $('save-message').textContent='No se pudo guardar. Los cambios siguen aquí para reintentar.';
}
function renderPlayers(){
  $('player-count').textContent=sortPlayers().length+' activos';
  const all=state.players.filter(p=>!p.guest&&p.turnId===currentTurn).sort(alpha);
  $('players-list').innerHTML=all.length?all.map(p=>`<div class="person-row"><div class="person-name"><button class="player-profile-link" data-player-profile="${esc(p.id)}">${esc(p.name)}<span>Ver ficha →</span></button><div class="muted">Turno ${p.turnId}${p.active===false?' · Inactivo':''}</div></div><div class="player-actions"><button class="secondary" data-edit-player="${esc(p.id)}">Editar datos</button><button class="secondary" data-toggle-player="${esc(p.id)}">${p.active===false?'Reactivar':'Dar de baja'}</button><button class="secondary danger" data-delete-player="${esc(p.id)}">Eliminar</button></div></div>`).join(''):'<div class="empty">Todavía no hay jugadores en este turno.</div>';
  renderPlayerSearch();
  renderGuestCatalog();
}
const searchName=value=>String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es').trim();
function findPlayers(query){
  const tokens=searchName(query).split(/\s+/).filter(Boolean);
  return tokens.length?state.players.filter(p=>tokens.every(token=>searchName(p.name).includes(token))).sort(alpha):[];
}
function renderPlayerSearch(){
  const query=$('player-search').value.trim(),players=findPlayers(query);
  $('player-search-clear').hidden=!query;$('player-search-date-panel').hidden=!query;
  const date=$('player-search-date').value;
  $('player-search-date-summary').textContent=validDate(date)?new Date(date+'T12:00:00').toLocaleDateString('es-AR'):'Elegir fecha';
  $('player-search-message').textContent=!query?'Escribí parte del nombre para buscar en los tres turnos.':players.length?`${players.length} resultado${players.length===1?'':'s'} en todos los turnos.`:'No se encontraron jugadores con ese nombre.';
  $('player-search-results').innerHTML=players.map(p=>`<article class="person-row search-player-row"><div class="person-name">${esc(p.name)}<div class="search-player-turn">${p.guest?'Invitado · sin turno fijo':'Habitual: '+turnLabel(p.turnId)}</div></div><div class="quick-actions search-player-actions"><button class="secondary" type="button" data-search-profile="${esc(p.id)}">Ver ficha</button>${p.guest?'':`<button class="secondary" type="button" data-search-day-move="${esc(p.id)}" ${p.active===false?'disabled':''}>Cambiar turno por esta fecha</button>`}</div></article>`).join('');
}
function openSearchPlayerProfile(id){
  const player=state.players.find(p=>p.id===id);
  if(!ready||busy||!player||!guardDrafts())return;
  currentTurn=player.turnId;try{localStorage.setItem('tmr-selected-turn',currentTurn);}catch{}
  closePlayerEditor();$('player-turn').innerHTML=optionsTurns(currentTurn);renderAll();openPlayerProfile(id);
}
function prepareSearchDayMove(id){
  const player=state.players.find(p=>p.id===id),date=$('player-search-date').value;
  if(!ready||busy||!player||player.guest||player.active===false)return;
  if(!validDate(date)){$('player-search-message').textContent='Elegí una fecha válida antes de preparar el cambio de turno.';return;}
  if(!guardDrafts())return;
  closePlayerEditor();selectedDate=date;showView('attendance');
  $('day-player').value=id;$('day-destination').value=currentTurn;$('day-move-panel').open=true;
  $('day-message').textContent=`Seleccionado: ${player.name}. Elegí el turno de destino y confirmá con «Aplicar cambio solo por esta fecha».`;
  $('day-move-panel').scrollIntoView({block:'start',behavior:'smooth'});
}

const validRating=value=>Number.isInteger(value)&&value>=1&&value<=10;
const ratingText=value=>value===null?'Sin puntuar':Number(value).toLocaleString('es-AR',{minimumFractionDigits:1,maximumFractionDigits:1});
function normalizeRatings(raw,roster,attendance,ids){
  if(raw===undefined)return {};
  if(raw===null||typeof raw!=='object'||Array.isArray(raw))throw Error('Puntajes inválidos');
  const entries=Object.entries(raw);
  for(const [id,value] of entries)if(!ids.has(id)||!roster.includes(id)||attendance[id]!=='present'||!validRating(value))throw Error('Puntaje fuera de su entrenamiento');
  return Object.fromEntries(entries);
}
function cleanRatings(session){return Object.fromEntries(Object.entries(session.ratings||{}).filter(([id,value])=>session.roster.includes(id)&&session.attendance[id]==='present'&&validRating(value)));}
function scoredSessions(month,turn=currentTurn,data=state){
  return data.sessions.filter(s=>!s.cancelled&&s.date<=todayISO()&&(!month||s.date.startsWith(month))&&(turn==='all'||s.turnId===turn)&&[1,3,5].includes(new Date(s.date+'T12:00:00').getDay()));
}
function ratingSummary(id,month,turn=currentTurn,data=state){
  const sessions=scoredSessions(month,turn,data).filter(s=>s.roster.includes(id)&&s.attendance[id]==='present');
  const values=sessions.map(s=>s.ratings?.[id]).filter(validRating);
  return {ratedCount:values.length,trainingCount:sessions.length,mean:values.length?values.reduce((a,b)=>a+b,0)/values.length:null};
}
function turnRatingSummary(month,turn=currentTurn,data=state){
  const ids=new Set(data.players.map(p=>p.id)),values=[];let scoredClasses=0;
  for(const s of scoredSessions(month,turn,data)){const scores=Object.entries(s.ratings||{}).filter(([id,value])=>ids.has(id)&&s.roster.includes(id)&&s.attendance[id]==='present'&&validRating(value));if(scores.length)scoredClasses++;values.push(...scores.map(([,value])=>value));}
  return {ratedCount:values.length,scoredClasses,mean:values.length?values.reduce((a,b)=>a+b,0)/values.length:null};
}
function validStatsPairs(session,data=state){
  const pairs=session.pairing?.pairs||[],ids=new Set(data.players.map(p=>p.id)),occurrences=new Map();
  for(const pair of pairs)if(Array.isArray(pair))for(const id of pair)occurrences.set(id,(occurrences.get(id)||0)+1);
  return pairs.filter(pair=>Array.isArray(pair)&&pair.length===2&&pair[0]!==pair[1]&&pair.every(id=>ids.has(id)&&session.roster.includes(id)&&session.attendance[id]==='present'&&occurrences.get(id)===1));
}
function partnerStats(id,month='',turn='all',data=state){
  const rows=new Map();
  for(const s of scoredSessions(month,turn,data))for(const pair of validStatsPairs(s,data)){
    if(!pair.includes(id))continue;
    const other=pair.find(value=>value!==id),player=data.players.find(p=>p.id===other);
    const row=rows.get(other)||{id:other,name:player.name,count:0,ratedCount:0,sum:0,lastDate:s.date};
    row.count++;if(s.date>row.lastDate)row.lastDate=s.date;
    const value=s.ratings?.[id];if(validRating(value)){row.ratedCount++;row.sum+=value;}
    rows.set(other,row);
  }
  return [...rows.values()].map(row=>({...row,mean:row.ratedCount?row.sum/row.ratedCount:null})).sort((a,b)=>b.count-a.count||b.lastDate.localeCompare(a.lastDate)||alpha(a,b));
}
const activityLabel=kind=>({multiball:'Multibolas',rebounder:'Reboteador',serves:'Saques'})[kind]||'Actividad';
function activityStats(id,month='',turn='all',data=state){
  return ['multiball','rebounder','serves'].map(kind=>{const sessions=scoredSessions(month,turn,data).filter(s=>s.roster.includes(id)&&s.attendance[id]==='present'&&(s.pairing?.activities?.[kind]||[]).includes(id)&&!validStatsPairs(s,data).some(pair=>pair.includes(id)));const scores=sessions.map(s=>s.ratings?.[id]).filter(validRating);return {kind,count:sessions.length,ratedCount:scores.length,mean:scores.length?scores.reduce((a,b)=>a+b,0)/scores.length:null};});
}
function renderPartnerStats(){
  const month=$('partner-period').value==='month'?$('player-profile-month').value:'';
  const turn=$('partner-turn').value==='current'?currentTurn:'all';
  const player=state.players.find(p=>p.id===selectedPlayerId);if(!player)return;
  $('partner-context').textContent=`${month||'Todo el historial'} · ${turn==='all'?'Todos los turnos':'Turno '+turn}. Promedio de ${player.name}.`;
  const rows=partnerStats(player.id,month,turn);
  $('activity-stats').innerHTML=activityStats(player.id,month,turn).map(r=>`<article class="partner-item"><div><strong>${activityLabel(r.kind)}</strong><p class="hint">${r.count} ${r.count===1?'entrenamiento':'entrenamientos'} · ${r.ratedCount} con puntaje</p></div><div class="partner-score"><strong>${ratingText(r.mean)}</strong>${r.mean===null?'':'<small>sobre 10</small>'}</div></article>`).join('');
  $('partner-list').innerHTML=rows.length?rows.map(row=>`<article class="partner-item"><div><strong>${esc(row.name)}</strong><p class="hint">${row.count} ${row.count===1?'vez pareja':'veces pareja'} · ${row.ratedCount} con puntaje</p><p class="hint">Última vez: ${esc(fmtDate(row.lastDate))}</p></div><div class="partner-score"><strong>${ratingText(row.mean)}</strong>${row.mean===null?'':'<small>sobre 10</small>'}</div></article>`).join(''):'<p class="empty">Sin parejas registradas para estos filtros.</p>';
}
let ratingPlayerId=null,ratingContext=null,ratingExpanded=null;
function openRatingDialog(id){
  if(busy||!ready||!attendanceDraft||attendanceDraft.cancelled||attendanceDraft.attendance[id]!=='present'||!attendanceDraft.roster.includes(id))return;
  const player=attendancePlayers().find(p=>p.id===id);if(!player)return;
  ratingPlayerId=id;ratingContext=attendanceDraft.date+'/'+attendanceDraft.turnId;
  $('rating-context').textContent=`${player.name} · ${fmtDate(attendanceDraft.date)} · ${turnLabel(attendanceDraft.turnId)}`;
  $('rating-options').innerHTML=Array.from({length:10},(_,i)=>`<button type="button" data-rating-value="${i+1}" class="${attendanceDraft.ratings?.[id]===i+1?'selected':''}" aria-label="${i+1} de 10">${i+1}</button>`).join('');
  $('rating-dialog').showModal();
}
function applyRatingValue(raw){
  if(busy||!attendanceDraft||attendanceDraft.cancelled||ratingContext!==attendanceDraft.date+'/'+attendanceDraft.turnId||attendanceDraft.attendance[ratingPlayerId]!=='present')return;
  const value=raw===''?null:Number(raw);if(value!==null&&!validRating(value))return;
  const ratings={...(attendanceDraft.ratings||{})};if(value===null)delete ratings[ratingPlayerId];else ratings[ratingPlayerId]=value;
  attendanceDraft={...attendanceDraft,ratings};attendanceDirty=true;if($('rating-dialog').open)$('rating-dialog').close();ratingExpanded=null;if(currentView==='ratings')renderRatings();else renderAttendance();
  [...document.querySelectorAll('[data-rate-player]')].find(b=>b.dataset.ratePlayer===ratingPlayerId)?.focus();
}

function renderRatings(){
  const saved=getSession(selectedDate,currentTurn);
  $('ratings-date').value=selectedDate;
  if(!saved||saved.cancelled){attendanceDraft=null;attendanceDirty=false;$('ratings-info').textContent=saved?.cancelled?'Entrenamiento cancelado.':'Guardá primero la asistencia de esta fecha y turno.';$('ratings-list').innerHTML='';$('ratings-save').disabled=true;return;}
  if(!attendanceDraft||attendanceDraft.date!==selectedDate||attendanceDraft.turnId!==currentTurn){attendanceDraft={...saved,roster:[...saved.roster],guestIds:[...(saved.guestIds||[])],newGuests:[],attendance:{...saved.attendance},ratings:{...(saved.ratings||{})}};attendanceDirty=false;}
  const players=attendancePlayers(attendanceDraft).filter(p=>attendanceDraft.attendance[p.id]==='present');
  $('ratings-info').textContent=players.length?`${players.length} ${players.length===1?'presente':'presentes'} · ${turnLabel(currentTurn)}`:'No hay jugadores presentes en este entrenamiento.';
  $('ratings-list').innerHTML=players.map(p=>`<div class="rating-row"><button type="button" class="attendance-person" data-rate-expand="${esc(p.id)}" aria-expanded="${ratingExpanded===p.id}"><span class="person-name">${esc(p.name)}</span><span class="badge">${validRating(attendanceDraft.ratings[p.id])?attendanceDraft.ratings[p.id]+' / 10':'Sin puntuar'}</span><span aria-hidden="true">${ratingExpanded===p.id?'▴':'▾'}</span></button>${ratingExpanded===p.id?`<div class="rating-grid">${Array.from({length:10},(_,i)=>`<button type="button" data-rating-value="${i+1}" class="${attendanceDraft.ratings[p.id]===i+1?'selected':''}" aria-label="${i+1} de 10 para ${esc(p.name)}">${i+1}</button>`).join('')}</div><button type="button" class="secondary full" data-rating-value="">Dejar sin puntaje</button>`:''}</div>`).join('');
  $('ratings-save').disabled=!attendanceDirty;$('ratings-message').textContent=attendanceDirty?'Puntajes sin guardar.':'';
}
async function saveRatings(){
  if(!ready||busy||!attendanceDraft||!attendanceDirty)return;
  const saved=getSession(selectedDate,currentTurn);if(!saved||saved.cancelled){$('ratings-message').textContent='La asistencia ya no está disponible. No se guardaron los puntajes.';return;}
  const nextSession={...saved,ratings:cleanRatings({...saved,ratings:{...attendanceDraft.ratings}}),updatedAt:new Date().toISOString()};
  busy=true;document.querySelector('main').inert=true;document.querySelector('nav').inert=true;
  try{const row=await labPuente.guardarPuntajes({revision:labRevision,puntajes:nextSession.ratings});aplicarEstadoLab(row);await contarLab();$('ratings-message').textContent='Puntajes guardados en este dispositivo; pendientes de envío.';}
  catch(e){$('ratings-message').textContent='No se guardaron los puntajes: '+(e.message||'error')+'. Los cambios previos se conservan.';}
  finally{busy=false;document.querySelector('main').inert=!ready;document.querySelector('nav').inert=!ready;}
}
$('ratings-save').onclick=saveRatings;
$('ratings-discard').onclick=()=>{if(!busy&&(!attendanceDirty||confirm('¿Descartar los puntajes sin guardar?'))){attendanceDirty=false;attendanceDraft=null;renderRatings();}};

function renderLastSession(){
  const last=state.sessions.filter(s=>s.turnId===currentTurn&&!s.cancelled&&s.date<=todayISO()).sort((a,b)=>b.date.localeCompare(a.date))[0];
  $('last-session-content').innerHTML=last?`<strong>${esc(fmtDate(last.date))}</strong><div class="attendance-summary">${[['present','presentes'],['absent','faltas'],['justified','justificadas']].map(([kind,label])=>`<span class="attendance-count ${kind}">${Object.values(last.attendance).filter(mark=>mark===kind).length} ${label}</span>`).join('')}</div><button type="button" class="secondary full" data-edit-date="${esc(last.date)}">Ver entrenamiento</button>`:'<p class="hint">Cuando guardes asistencia, acá verás el último entrenamiento del turno.</p>';
}

function relevantSessions(month,turn=currentTurn){return sessionDates(month).map(date=>getSession(date,turn)).filter(Boolean);}
function belongsInSession(player,s){return s.roster.includes(player.id)||Object.hasOwn(s.attendance,player.id);}
function calcPlayerStats(player,month){
  let present=0,absent=0,justified=0,unmarked=0;
  relevantSessions(month).filter(s=>!s.cancelled&&belongsInSession(player,s)).forEach(s=>{const st=s.attendance[player.id];if(st==='present')present++;else if(st==='absent')absent++;else if(st==='justified')justified++;else unmarked++;});
  const denominator=present+absent+justified;
  const rating=ratingSummary(player.id,month,currentTurn);
  return {name:player.name,present,absent,justified,unmarked,denominator,pct:denominator?Math.round(present/denominator*100):0,...rating};
}
function statsPlayers(month){const sessions=relevantSessions(month);return state.players.filter(p=>(!p.guest&&p.turnId===currentTurn&&p.active!==false)||sessions.some(s=>belongsInSession(p,s))).sort(alpha);}
function calcStats(month){return statsPlayers(month).map(p=>calcPlayerStats(p,month));}
function renderHistory(){
  const month=$('history-month').value||monthISO();$('history-month').value=month;
  const sessions=relevantSessions(month),plans=(state.trainingPlans||[]).filter(p=>p.turnId===currentTurn&&p.date.startsWith(month));
  const dates=[...new Set([...sessions.map(s=>s.date),...plans.map(p=>p.date)])].sort().reverse();
  $('history-list').innerHTML=dates.length?dates.map(date=>{
    const s=sessions.find(s=>s.date===date),plan=plans.find(p=>p.date===date),marks=Object.values(s?.attendance||{}),count=v=>marks.filter(x=>x===v).length;
    return `<div class="history-card"><div class="history-date">${esc(fmtDate(date))}</div><div class="history-meta">${turnLabel(currentTurn)}</div><div class="history-meta">${!s?'Asistencia sin guardar':s.cancelled?'<span class="badge cancelled">Cancelado</span>':`${count('present')} presentes · ${count('absent')} faltas · ${count('justified')} justificadas`}</div>${s?.note?`<p class="history-meta profile-note">${esc(s.note)}</p>`:''}${plan?.observation?`<p class="history-meta profile-note">${esc(plan.observation)}</p>`:''}${plan?.exerciseIds?.length?`<p class="history-meta profile-note">Ejercicios: ${planExerciseList(plan.exerciseIds).map(e=>esc(e.title)).join(', ')}</p>`:''}<div class="quick-actions"><button class="secondary" data-edit-date="${date}">Ver / corregir</button>${s?`<button class="secondary" data-pairs-date="${date}">Ver parejas</button>`:''}${plan?`<button class="secondary" data-view-plan="${date}">Ver plan</button>`:''}</div></div>`;
  }).join(''):'<div class="empty">No hay sesiones ni planes guardados de este turno para este mes.</div>';
}
function renderStats(){
  const month=$('stats-month').value||monthISO();$('stats-month').value=month;
  const sessions=relevantSessions(month).filter(s=>!s.cancelled),rows=calcStats(month);
  const count=k=>rows.reduce((n,r)=>n+r[k],0);
  $('stats-summary').innerHTML=[['Sesiones realizadas',sessions.length],['Asistencias registradas',count('present')],['Faltas sin justificar',count('absent')],['Faltas justificadas',count('justified')],['Promedio del turno',ratingText(turnRatingSummary(month).mean)],['Valoraciones individuales',turnRatingSummary(month).ratedCount]].map(([l,n])=>`<article class="stat"><span>${l}</span><strong>${n}</strong></article>`).join('');
  const query=searchName($('stats-search').value||''), shown=rows.filter(r=>!query||searchName(r.name).includes(query));
  $('stats-search-message').textContent=query?`${shown.length} ${shown.length===1?'jugador':'jugadores'} de ${rows.length}.`:'';
  $('stats-table').innerHTML=shown.map(r=>`<tr><td>${esc(r.name)}${r.unmarked?`<div class="muted">${r.unmarked} sin marcar</div>`:''}</td><td>${r.present}</td><td>${r.absent}</td><td>${r.justified}</td><td>${r.denominator?r.pct+'%':'—'}</td><td>${ratingText(r.mean)}</td><td>${r.ratedCount} de ${r.trainingCount}</td></tr>`).join('')||'<tr><td colspan="7">No hay jugadores ni registros en este turno.</td></tr>';
  // En celular, una tarjeta por jugador en lugar de la tabla ancha.
  $('stats-cards').innerHTML=shown.map(r=>`<article class="stats-card"><div class="stats-card-name"><strong>${esc(r.name)}</strong>${r.unmarked?`<span class="muted">${r.unmarked} sin marcar</span>`:''}</div><dl class="stats-card-grid"><div><dt>Presentes</dt><dd>${r.present}</dd></div><div><dt>Faltas</dt><dd>${r.absent}</dd></div><div><dt>Justificadas</dt><dd>${r.justified}</dd></div><div><dt>Porcentaje</dt><dd>${r.denominator?r.pct+'%':'—'}</dd></div><div><dt>Promedio /10</dt><dd>${ratingText(r.mean)}</dd></div><div><dt>Puntuadas</dt><dd>${r.ratedCount} de ${r.trainingCount}</dd></div></dl></article>`).join('')||'<p class="empty">No hay jugadores ni registros en este turno.</p>';
}
function openPlayerProfile(id){if(!state.players.some(p=>p.id===id)||!guardDrafts())return;selectedPlayerId=id;$('training-notes-panel').open=false;$('player-profile-month').value=monthISO();showView('player');}
function renderPlayerProfile(){
  const p=state.players.find(p=>p.id===selectedPlayerId);if(!p){showView('players');return;}
  const month=$('player-profile-month').value||monthISO();$('player-profile-month').value=month;
  $('player-profile-name').textContent=p.name;$('player-profile-state').textContent=p.guest?`Invitado · sin turno fijo · Consultando Turno ${currentTurn}`:`${p.active===false?'Inactivo':'Activo'} · Habitual: ${turnLabel(p.turnId)} · Consultando Turno ${currentTurn}`;
  $('guest-promotion').hidden=!p.guest;
  $('guest-regular-turn').innerHTML=optionsTurns(currentTurn);
  $('guest-promotion-message').textContent='';
  const s=calcPlayerStats(p,month);
  $('player-profile-summary').innerHTML=[['Presentes',s.present],['Faltas',s.absent],['Justificadas',s.justified],['Asistencia',s.denominator?s.pct+'%':'—'],['Promedio individual',ratingText(s.mean)],['Clases puntuadas',s.ratedCount+' de '+s.trainingCount]].map(([l,n])=>`<article class="stat"><span>${l}</span><strong>${n}</strong></article>`).join('');
  $('player-profile-unmarked').textContent=s.unmarked?`${s.unmarked} sesión/es sin marcar. No cuentan como falta ni entran en el porcentaje.`:'';
  const labels={present:'Presente',absent:'Falta',justified:'Justificada'};
  const sessions=relevantSessions(month).filter(s=>belongsInSession(p,s)).sort((a,b)=>b.date.localeCompare(a.date));
  $('player-profile-history').innerHTML=sessions.length?sessions.map(s=>{const st=s.attendance[p.id],label=s.cancelled?'Sesión cancelada':labels[st]||'Sin marcar',badge=s.cancelled?'cancelled':labels[st]?st:'unmarked';return `<div class="history-card"><div class="history-date">${esc(fmtDate(s.date))}</div><div class="history-meta"><span class="badge ${badge}">${label}</span>${!s.cancelled&&st==='present'&&validRating(s.ratings?.[p.id])?` <span class="badge rated">Puntaje: ${s.ratings[p.id]} / 10</span>`:''}</div>${s.note?`<p class="history-meta profile-note">${esc(s.note)}</p>`:''}</div>`;}).join(''):'<div class="empty">Sin registros de este jugador en el turno y mes seleccionados.</div>';
  renderPartnerStats();
  renderTrainingNotes();
}
function trainingNoteSignature(){return $('training-note-date').value+'\n'+$('training-note-text').value;}
function resetTrainingNoteEditor(){
  editingTrainingNoteId=null;trainingNoteDirty=false;
  $('training-note-date').value=todayISO();$('training-note-text').value='';
  $('training-note-heading').textContent='Agregar nota';$('training-note-save').textContent='Guardar nota';
  $('training-note-message').textContent='';trainingNoteBaseline=trainingNoteSignature();
}
function renderTrainingNotes(){
  const player=state.players.find(p=>p.id===selectedPlayerId),notes=[...(player?.trainingNotes||[])].sort((a,b)=>b.date.localeCompare(a.date)||(b.updatedAt||b.createdAt||'').localeCompare(a.updatedAt||a.createdAt||''));
  $('training-notes-count').textContent=notes.length?`(${notes.length})`:'';
  $('training-notes-list').innerHTML=notes.length?notes.map(n=>`<article class="history-card"><div class="history-date">${esc(fmtDate(n.date))}</div><p class="training-note-text">${esc(n.text)}</p><div class="quick-actions training-note-actions"><button class="secondary" type="button" data-edit-training-note="${esc(n.id)}">Editar nota</button><button class="secondary danger" type="button" data-delete-training-note="${esc(n.id)}">Eliminar nota</button></div></article>`).join(''):'<div class="empty">Todavía no hay notas de entrenamiento. Podés usar esta sección cuando te sirva.</div>';
}
function openTrainingNoteEditor(id){
  if(busy)return;
  const note=state.players.find(p=>p.id===selectedPlayerId)?.trainingNotes?.find(n=>n.id===id);if(!note)return;
  if(trainingNoteDirty&&!confirm('Hay una nota sin guardar. ¿Descartarla para editar esta otra?'))return;
  editingTrainingNoteId=id;$('training-note-date').value=note.date;$('training-note-text').value=note.text;
  $('training-note-heading').textContent='Editar nota';$('training-note-save').textContent='Guardar cambios';
  $('training-note-message').textContent='';trainingNoteDirty=false;trainingNoteBaseline=trainingNoteSignature();
  $('training-notes-panel').open=true;$('training-note-form').scrollIntoView({block:'center',behavior:'smooth'});$('training-note-text').focus();
}
async function saveTrainingNote(event){
  event.preventDefault();if(busy||!ready)return;
  const player=state.players.find(p=>p.id===selectedPlayerId);if(!player)return;
  const date=$('training-note-date').value,text=$('training-note-text').value.trim();
  if(!validDate(date)||!text||text.length>2000){$('training-note-message').textContent='Elegí una fecha válida y escribí una nota de entre 1 y 2000 caracteres.';return;}
  const notes=player.trainingNotes||[],existing=notes.find(n=>n.id===editingTrainingNoteId);
  if(editingTrainingNoteId&&!existing){$('training-note-message').textContent='Esta nota ya no está disponible. Cancelá la edición y volvé a intentar.';return;}
  const now=new Date().toISOString(),note={...(existing||{id:uid(),createdAt:now}),date,text,updatedAt:now};
  const trainingNotes=existing?notes.map(n=>n.id===existing.id?note:n):[...notes,note];
  const next={...state,players:state.players.map(p=>p.id===player.id?{...p,trainingNotes}:p)};
  if(await commit(next)){resetTrainingNoteEditor();renderTrainingNotes();$('training-note-message').textContent=existing?'Nota actualizada.':'Nota guardada en este dispositivo.';}
  else $('training-note-message').textContent='No se pudo guardar. El texto sigue aquí para reintentar.';
}
async function deleteTrainingNote(id){
  if(busy||!ready)return;
  const player=state.players.find(p=>p.id===selectedPlayerId),note=player?.trainingNotes?.find(n=>n.id===id);if(!note)return;
  const editingThis=editingTrainingNoteId===id;
  if(!confirm(`¿Eliminar la nota del ${fmtDate(note.date)} de ${player.name}? Esta acción no se puede deshacer desde la app.${editingThis&&trainingNoteDirty?' También se descartarán los cambios sin guardar de esta nota.':''}`))return;
  const next={...state,players:state.players.map(p=>p.id===player.id?{...p,trainingNotes:p.trainingNotes.filter(n=>n.id!==id)}:p)};
  if(await commit(next)){if(editingThis)resetTrainingNoteEditor();renderTrainingNotes();$('training-note-message').textContent='Nota eliminada.';}
  else $('training-note-message').textContent='No se pudo eliminar. La nota se conserva; volvé a intentar.';
}
$('training-note-form').onsubmit=saveTrainingNote;
for(const id of ['training-note-date','training-note-text'])$(id).addEventListener('input',()=>{
  if(!busy){trainingNoteDirty=trainingNoteSignature()!==trainingNoteBaseline;$('training-note-message').textContent=trainingNoteDirty?'Nota sin guardar.':'';}
});
$('training-note-cancel').onclick=()=>{if(!busy&&(!trainingNoteDirty||confirm('¿Descartar los cambios de esta nota sin guardar?')))resetTrainingNoteEditor();};
function renderAll(){
  $('turn-selector').innerHTML=optionsTurns(currentTurn);$('turn-context').textContent='Lunes, miércoles y viernes';
  renderHome();renderPlayers();renderHistory();renderStats();
  if(currentView==='attendance')renderAttendance();if(currentView==='ratings')renderRatings();if(currentView==='pairs')renderPairs();if(currentView==='player')renderPlayerProfile();if(currentView==='exercises')renderExercises();updateConnection();
}
function closePlayerEditor(){if(busy)return;editingPlayerId=null;$('player-edit-panel').hidden=true;$('player-edit-message').textContent='';}
function openPlayerEditor(id){if(busy)return;const p=state.players.find(p=>p.id===id);if(!p)return;editingPlayerId=id;$('player-edit-name').value=p.name;$('player-edit-turn').innerHTML=optionsTurns(p.turnId);$('player-edit-message').textContent='';$('player-edit-panel').hidden=false;$('player-edit-panel').scrollIntoView({block:'center',behavior:'smooth'});$('player-edit-name').focus();}
async function savePlayerName(event){
  event.preventDefault();if(busy)return;
  const p=state.players.find(p=>p.id===editingPlayerId);if(!p)return;
  const name=$('player-edit-name').value.trim(),turn=$('player-edit-turn').value,message=$('player-edit-message');
  if(!name||name.length>100||!validTurn(turn)){message.textContent='Ingresá un nombre de 1 a 100 caracteres y un turno válido.';return;}
  if(state.players.some(x=>x.id!==p.id&&x.active!==false&&x.name.toLocaleLowerCase('es')===name.toLocaleLowerCase('es'))){message.textContent='Ya hay otro jugador activo con ese nombre.';return;}
  if(name===p.name&&turn===p.turnId){closePlayerEditor();return;}
  const next={...state,players:state.players.map(x=>x.id===p.id?{...x,name,turnId:turn}:x)};
  if(!await commit(next)){message.textContent='No se pudo guardar. Los datos anteriores se conservan; reintentá.';return;}
  closePlayerEditor();attendanceDraft=null;pairDraft=null;renderAll();$('player-message').textContent=`Datos actualizados: ${name} · ${turnLabel(turn)}. Sus registros anteriores conservan su turno.`;
}
async function deletePlayer(id){
  if(busy)return;const p=state.players.find(p=>p.id===id);if(!p)return;
  if(!confirm(`¿Eliminar definitivamente a «${p.name}»? Se borrarán sus marcas, puntajes, parejas y notas de entrenamiento de todos los turnos y fechas. Sus compañeros quedarán sin pareja. Las sesiones, notas y otros jugadores se conservan. Esta acción no se puede deshacer desde la app.`))return;
  const next={...state,players:state.players.filter(x=>x.id!==id),dayTurns:state.dayTurns.filter(o=>o.playerId!==id),sessions:state.sessions.map(s=>{const attendance={...s.attendance},ratings={...(s.ratings||{})};delete attendance[id];delete ratings[id];return {...s,attendance,ratings,roster:s.roster.filter(x=>x!==id),guestIds:(s.guestIds||[]).filter(x=>x!==id),...(s.pairing?{pairing:{...s.pairing,pairs:s.pairing.pairs.filter(pair=>!pair.includes(id)),...(s.pairing.activities?{activities:Object.fromEntries(Object.entries(s.pairing.activities).map(([k,ids])=>[k,ids.filter(x=>x!==id)]))}:{})}}:{})};})};
  if(await commit(next)){if(editingPlayerId===id)closePlayerEditor();attendanceDraft=null;pairDraft=null;renderAll();$('player-message').textContent=`Se eliminó a ${p.name} y sus registros individuales.`;}
}
function buildDayMove(data,id,date,destination){
  const player=data.players.find(p=>p.id===id);if(!player||player.guest||player.active===false||!validDate(date)||!validTurn(destination))throw Error('Elegí un jugador, una fecha y un turno válidos.');
  const source=effectiveTurn(player,date,data);if(source===destination)throw Error('El jugador ya está asignado a ese turno en esta fecha.');
  if(getSession(date,destination,data)?.cancelled)throw Error('El turno de destino está cancelado en esta fecha. Corregí primero la cancelación.');
  let mark='',rating=null;
  const sessions=data.sessions.map(s=>{
    if(s.date!==date)return s;
    if(s.attendance[id])mark=s.attendance[id];
    if(validRating(s.ratings?.[id]))rating=s.ratings[id];
    const attendance={...s.attendance},ratings={...(s.ratings||{})};delete attendance[id];delete ratings[id];
    return {...s,attendance,ratings,roster:s.roster.filter(x=>x!==id),guestIds:(s.guestIds||[]).filter(x=>x!==id),...(s.pairing?{pairing:{...s.pairing,pairs:s.pairing.pairs.filter(pair=>!pair.includes(id)),...(s.pairing.activities?{activities:Object.fromEntries(Object.entries(s.pairing.activities).map(([k,ids])=>[k,ids.filter(x=>x!==id)]))}:{})}}:{}),updatedAt:new Date().toISOString()};
  });
  let next={...data,sessions,dayTurns:[...data.dayTurns.filter(o=>!(o.date===date&&o.playerId===id)),{date,playerId:id,turnId:destination}]};
  const target=getSession(date,destination,next) || newSession(date,destination,next);
  const attendance={...target.attendance},ratings={...(target.ratings||{})};if(mark)attendance[id]=mark;
  if(mark==='present'&&validRating(rating))ratings[id]=rating;
  next=withSession(next,{...target,roster:[...new Set([...target.roster,id])],attendance,ratings,updatedAt:new Date().toISOString()});
  return next;
}
async function applyDayMove(){
  if(busy)return;
  if(attendanceDirty){$('day-message').textContent='Guardá o descartá la asistencia pendiente antes de cambiar un jugador de turno.';return;}
  const id=$('day-player').value,destination=$('day-destination').value,p=state.players.find(p=>p.id===id);
  let next;try{next=buildDayMove(state,id,selectedDate,destination);}catch(e){$('day-message').textContent=e.message;return;}
  if(!confirm(`¿Asignar a ${p.name} al ${turnLabel(destination)} solo el ${fmtDate(selectedDate)}?\nSu turno habitual sigue siendo el ${p.turnId}. Si tenía una marca en esta fecha se trasladará; si tenía pareja, se quitará ese emparejamiento para poder armar uno nuevo. No quedará como ausente en el turno de origen.`))return;
  if(await commit(next)){attendanceDraft=null;pairDraft=null;renderAll();$('day-message').textContent=`${p.name}: ${turnLabel(destination)} solo por esta fecha. Revisá su asistencia en ese turno.`;}
  else $('day-message').textContent='No se pudo aplicar el cambio. Se conservó la asignación anterior.';
}
function presentPlayers(session){return state.players.filter(p=>session?.attendance?.[p.id]==='present').sort(alpha);}
function pairingIssues(session,pairs=session?.pairing?.pairs||[],activities=session?.pairing?.activities||{}){
  const issues=[],used=new Set();if(session?.cancelled&&pairs.length)issues.push('La sesión está cancelada.');
  for(const pair of pairs){if(!Array.isArray(pair)||pair.length!==2){issues.push('Pareja incompleta.');continue;}for(const id of pair){const p=state.players.find(p=>p.id===id);if(!p||session?.attendance?.[id]!=='present')issues.push(`${p?.name||'Jugador eliminado'} no figura presente.`);if(used.has(id))issues.push('Un jugador aparece más de una vez.');used.add(id);}}
  for(const [kind,ids] of Object.entries(activities))for(const id of ids)if(session?.cancelled||session?.attendance?.[id]!=='present'||!session?.roster?.includes(id))issues.push(`${state.players.find(p=>p.id===id)?.name||'Jugador'}: revisá ${activityLabel(kind)}.`);
  return [...new Set(issues)];
}
function loadPairDraft(date=selectedDate){const s=getSession(date),a=s?.pairing?.activities||{};pairDraft={date,turnId:currentTurn,pairs:(s?.pairing?.pairs||[]).map(p=>[...p]),activities:{multiball:[...(a.multiball||[])],rebounder:[...(a.rebounder||[])],serves:[...(a.serves||[])]},note:s?.pairing?.note||''};pairDirty=false;}
function availableForPairs(){const used=new Set([...pairDraft.pairs.flat(),...(pairDraft.activities?.multiball||[]),...(pairDraft.activities?.rebounder||[]),...(pairDraft.activities?.serves||[])]);return presentPlayers(getSession(pairDraft.date,pairDraft.turnId)).filter(p=>!used.has(p.id));}
function previousPairDate(date){return state.sessions.filter(s=>s.turnId===currentTurn&&s.date<date&&!s.cancelled&&(s.pairing||Object.values(s.attendance).includes('present'))).map(s=>s.date).sort().pop();}
// Consulta histórica: ignora la fecha que se está editando y sesiones posteriores.
function lastPartner(playerId,beforeDate){
  const sessions=state.sessions.filter(s=>s.date<beforeDate&&!s.cancelled&&s.pairing).sort((a,b)=>b.date.localeCompare(a.date));
  for(const s of sessions){
    const pair=s.pairing.pairs.find(pair=>pair.length===2&&pair[0]!==pair[1]&&pair.includes(playerId)&&pair.every(id=>s.attendance[id]==='present'&&state.players.some(p=>p.id===id)));
    if(pair){const partner=state.players.find(p=>p.id===pair.find(id=>id!==playerId));return {partnerId:partner.id,name:partner.name,date:s.date,turnId:s.turnId};}
  }
  return null;
}
function repeatedPartners(a,b,date){return !!(a&&b&&(lastPartner(a,date)?.partnerId===b||lastPartner(b,date)?.partnerId===a));}
function renderPairMemory(){
  const date=pairDraft?.date||selectedDate;
  for(const [select,hint] of [['pairs-first','pairs-first-memory'],['pairs-second','pairs-second-memory']]){
    const id=$(select).value,last=id?lastPartner(id,date):null;
    $(hint).textContent=!id?'':last?`Última pareja registrada: ${last.name} · ${fmtDate(last.date)} · ${turnLabel(last.turnId)}.`:'Sin parejas anteriores registradas antes de esta fecha.';
  }
  const warning=$('pairs-repeat-warning'),repeated=repeatedPartners($('pairs-first').value,$('pairs-second').value,date);
  warning.hidden=!repeated;
  if(!repeated){warning.textContent='';return;}
  const a=$('pairs-first').value,b=$('pairs-second').value,lastA=lastPartner(a,date),lastB=lastPartner(b,date);
  const name=id=>state.players.find(p=>p.id===id)?.name||'Este jugador';
  const description=lastA?.partnerId===b&&lastB?.partnerId===a?'Ya entrenaron juntos en su último emparejamiento registrado.':lastA?.partnerId===b?`${name(a)} tuvo a ${name(b)} como última pareja registrada.`:`${name(b)} tuvo a ${name(a)} como última pareja registrada.`;
  warning.textContent=description+' Podés repetir la pareja y guardar igual.';
}
function renderPairOptions(){
  const available=availableForPairs(),first=$('pairs-first').value,second=$('pairs-second').value;
  $('pairs-first').innerHTML='<option value="">Elegí un jugador</option>'+available.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');if(available.some(p=>p.id===first))$('pairs-first').value=first;
  const selected=$('pairs-first').value;
  $('pairs-second').innerHTML='<option value="">Elegí su compañero</option>'+available.filter(p=>p.id!==selected).map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  if(available.some(p=>p.id===second)&&second!==selected)$('pairs-second').value=second;
  $('pairs-add').disabled=available.length<2;
  $('pairs-unassigned').textContent=available.length?`Sin asignar (${available.length}): ${available.map(p=>p.name).join(', ')}. Podés guardar aunque queden jugadores sin pareja.`:'No quedan presentes sin asignar.';
  renderPairMemory();
}
function renderPairs(){
  if(!pairDraft||pairDraft.turnId!==currentTurn||pairDraft.date!==selectedDate)loadPairDraft();
  const s=getSession(pairDraft.date),editable=!!s&&!s.cancelled;
  $('pairs-date').value=pairDraft.date;$('pairs-previous').disabled=!previousPairDate(pairDraft.date);$('pairs-editor').hidden=!editable;
  $('pairs-info').textContent=!s?'Guardá la asistencia para armar parejas.':s.cancelled?'Sesión cancelada · solo consulta.':`${presentPlayers(s).length} presentes · ${s.pairing?'Armado guardado':'Sin armado guardado'}.`;
  const name=id=>state.players.find(p=>p.id===id)?.name||'Jugador eliminado';
  $('pairs-list').innerHTML=pairDraft.pairs.length?pairDraft.pairs.map((pair,i)=>`<div class="person-row"><div class="person-name"><span class="muted">Pareja ${i+1}</span><div>${pair.map(id=>esc(name(id))).join(' + ')}</div></div>${editable?`<button class="secondary" data-remove-pair="${i}">Quitar</button>`:''}</div>`).join(''):'<div class="empty">Sin parejas en esta fecha.</div>';
  if(s?.cancelled&&pairDraft.note)$('pairs-list').innerHTML+=`<p class="hint profile-note">${esc(pairDraft.note)}</p>`;
  $('activity-summary').innerHTML=['multiball','rebounder','serves'].map(kind=>`<p class="activity-summary-line"><strong>${activityLabel(kind)}:</strong> ${pairDraft.activities[kind].length?pairDraft.activities[kind].map(id=>esc(name(id))).join(', '):'Sin asignar'}</p>`).join('');
  const paired=new Set(pairDraft.pairs.flat());
  for(const [kind,id] of [['multiball','activity-multiball'],['rebounder','activity-rebounder'],['serves','activity-serves']]){const selected=pairDraft.activities[kind],all=state.players.filter(p=>(s?.attendance?.[p.id]==='present'&&!paired.has(p.id))||selected.includes(p.id)).sort(alpha);$(id).innerHTML=all.length?all.map(p=>`<label class="activity-option"><input type="checkbox" data-activity="${kind}" data-activity-player="${esc(p.id)}" ${selected.includes(p.id)?'checked':''} ${paired.has(p.id)&&!selected.includes(p.id)?'disabled':''}><span>${esc(p.name)}</span></label>`).join(''):'<p class="hint">Sin jugadores presentes.</p>';}
  $('activity-readonly').innerHTML=s?.cancelled?['multiball','rebounder','serves'].map(kind=>{const ids=pairDraft.activities[kind];return ids.length?`<p>${activityLabel(kind)}: ${ids.map(id=>esc(name(id))).join(', ')}</p>`:'';}).join(''):'';
  $('pairs-note').value=pairDraft.note;$('pairs-discard').disabled=!pairDirty;
  $('pairs-message').textContent=[...pairingIssues(s,pairDraft.pairs,pairDraft.activities),pairDirty?'Cambios sin guardar.':''].join('\n');renderPairOptions();
}
function addPair(){
  if(busy||!pairDraft||!getSession(pairDraft.date)||getSession(pairDraft.date).cancelled)return;
  const a=$('pairs-first').value,b=$('pairs-second').value,ids=new Set(availableForPairs().map(p=>p.id));
  if(!a||!b||a===b||!ids.has(a)||!ids.has(b)){$('pairs-message').textContent='Elegí dos presentes distintos que estén disponibles en este turno.';return;}
  pairDraft.pairs.push([a,b]);pairDirty=true;renderPairs();
}
async function savePairs(){
  if(busy||!pairDraft)return;
  const s=getSession(pairDraft.date,pairDraft.turnId);if(!s||s.cancelled)return;
  const issues=pairingIssues(s,pairDraft.pairs,pairDraft.activities);for(const [kind,ids] of Object.entries(pairDraft.activities)){for(const id of ids)if(s.attendance[id]!=='present'||!s.roster.includes(id)||pairDraft.pairs.flat().includes(id))issues.push(`${state.players.find(p=>p.id===id)?.name||'Jugador'}: revisá ${activityLabel(kind)} y su asistencia o pareja.`);}if(issues.length){$('pairs-message').textContent=issues.join('\n')+'\nQuitá las parejas señaladas o corregí la asistencia.';return;}
  const pairing={pairs:pairDraft.pairs.map(p=>[...p]),activities:{multiball:[...pairDraft.activities.multiball],rebounder:[...pairDraft.activities.rebounder],serves:[...pairDraft.activities.serves]},note:pairDraft.note.trim(),updatedAt:new Date().toISOString()};
  if(await commit(withSession(state,{...s,pairing}))){pairDirty=false;renderPairs();$('pairs-message').textContent='Parejas guardadas en este dispositivo.';}
  else $('pairs-message').textContent='No se pudo guardar. Tus cambios siguen aquí para reintentar.';
}
let exportingFile=false;
async function download(blob,name){
  if(exportingFile)return false;
  exportingFile=true;
  try{
    if(window.tmrSaveFile){
      const mime=blob.type.split(';')[0];let text=await blob.text();
      if(mime==='text/csv'&&!text.startsWith('\ufeff'))text='\ufeff'+text;
      const result=await window.tmrSaveFile({filename:name,mime,text});
      if(result?.cancelled)return false;
      if(result?.verified!==true||!Number.isSafeInteger(result.bytesWritten)||result.bytesWritten<=0)throw Error('No se pudo verificar el archivo guardado.');
      return true;
    }
    if(window.Capacitor?.isNativePlatform?.())throw Error('Guardado Android no disponible.');
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return true;
  }finally{exportingFile=false;}
}
function setFollowupNotice(enabled){
  followupNoticeEnabled=enabled;
  try{localStorage.setItem('tmr-followup-notice-enabled-v1',String(enabled));$('followup-notice-setting-message').textContent='';}
  catch{$('followup-notice-setting-message').textContent='El cambio se aplica ahora, pero no se pudo conservar para la próxima apertura.';}
  renderFollowup();
}
// Los invitados conservan identidad e historial, pero solo participan con alta explícita por fecha.
function attendancePlayers(session=attendanceDraft){
  const players=[...state.players,...(session?.newGuests||[])];
  return players.filter(p=>session?.roster.includes(p.id)).sort(alpha);
}
function renderGuestOptions(){
  const previous=$('guest-existing').value;
  const available=state.players.filter(p=>(p.guest||p.active===false)&&!attendanceDraft.roster.includes(p.id)).sort(alpha);
  const group=(title,players)=>players.length?`<optgroup label="${title}">${players.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</optgroup>`:'';
  $('guest-existing').innerHTML='<option value="">Nuevo invitado</option>'+group('Invitados anteriores',available.filter(p=>p.guest))+group('Jugadores inactivos',available.filter(p=>!p.guest));
  if(available.some(p=>p.id===previous))$('guest-existing').value=previous;
  $('guest-name-field').hidden=!!$('guest-existing').value;
  $('guest-name').required=!$('guest-existing').value;
  $('guest-context').textContent=`${fmtDate(selectedDate)} · ${turnLabel(currentTurn)}`;
  $('guest-add').disabled=attendanceDraft.cancelled;
}
function buildGuestDraft(draft,existingId,name,data=state){
  if(!draft||draft.cancelled)throw Error('La sesión está cancelada. Corregí primero la cancelación.');
  let player;
  if(existingId){
    player=data.players.find(p=>p.id===existingId);
    if(!player||(!player.guest&&player.active!==false))throw Error('Elegí un invitado anterior o un jugador inactivo. Para jugadores activos usá el cambio de turno.');
  }else{
    name=String(name).trim();
    if(!name||name.length>100)throw Error('Escribí un nombre de 1 a 100 caracteres.');
    const normalize=n=>searchName(n).replace(/\s+/g,' ');
    const same=[...data.players,...(draft.newGuests||[])].find(p=>normalize(p.name)===normalize(name));
    if(same)throw Error(same.guest||same.active===false?'Ese nombre ya está guardado. Elegilo entre invitados anteriores o jugadores inactivos; si ya está en esta lista no hace falta agregarlo otra vez.':'Ese jugador ya es habitual. Usá Cambio de turno por esta fecha si viene a otro horario.');
    player={id:uid(),name,guest:true,active:false,turnId:draft.turnId,trainingNotes:[],createdAt:new Date().toISOString()};
  }
  if(draft.roster.includes(player.id))throw Error('El jugador ya está en la lista de esta fecha y turno.');
  const other=data.sessions.find(s=>s.date===draft.date&&s.turnId!==draft.turnId&&(s.roster.includes(player.id)||Object.hasOwn(s.attendance,player.id)));
  if(other)throw Error(`Ya está incluido en el Turno ${other.turnId} de esta fecha. Quitalo de allí y guardá antes de agregarlo en este turno.`);
  return {...draft,roster:[...draft.roster,player.id],guestIds:[...(draft.guestIds||[]),player.id],newGuests:existingId?[...(draft.newGuests||[])]:[...(draft.newGuests||[]),player],attendance:{...draft.attendance,[player.id]:'present'}};
}
async function addDayGuest(event){
  event.preventDefault();if(busy||!ready||attendancePromptOpen)return;
  try{
    attendanceDraft=buildGuestDraft(attendanceDraft,$('guest-existing').value,$('guest-name').value);
    attendanceDirty=true;$('guest-name').value='';$('guest-existing').value='';
    renderAttendance();$('guest-message').textContent='Agregado como presente. Tocá Guardar asistencia para conservarlo.';
  }catch(error){$('guest-message').textContent=error.message;}
}
function removeDayGuest(id){
  if(busy||!attendanceDraft?.guestIds.includes(id))return;
  const paired=attendanceDraft.pairing?.pairs.some(pair=>pair.includes(id));const assigned=Object.values(attendanceDraft.pairing?.activities||{}).some(ids=>ids.includes(id));
  if(!confirm('¿Quitar a este invitado solo de esta fecha y turno?'+(paired?' También se quitará su pareja de este entrenamiento.':'')+(assigned?' También se quitará de sus actividades.':'')+' Tocá Guardar asistencia para confirmar.'))return;
  const attendance={...attendanceDraft.attendance},ratings={...(attendanceDraft.ratings||{})};delete attendance[id];delete ratings[id];
  attendanceDraft={...attendanceDraft,ratings,roster:attendanceDraft.roster.filter(x=>x!==id),guestIds:attendanceDraft.guestIds.filter(x=>x!==id),newGuests:attendanceDraft.newGuests.filter(p=>p.id!==id),attendance,...(attendanceDraft.pairing?{pairing:{...attendanceDraft.pairing,pairs:attendanceDraft.pairing.pairs.filter(pair=>!pair.includes(id)),...(attendanceDraft.pairing.activities?{activities:Object.fromEntries(Object.entries(attendanceDraft.pairing.activities).map(([k,ids])=>[k,ids.filter(x=>x!==id)]))}:{})}}:{})};
  attendanceDirty=true;renderAttendance();$('guest-message').textContent='Quitado de la lista. Guardá la asistencia para confirmar el cambio.';
}
function renderGuestCatalog(){
  const guests=state.players.filter(p=>p.guest).sort(alpha);
  $('guest-catalog-count').textContent=`(${guests.length})`;
  $('guest-catalog').innerHTML=guests.length?guests.map(p=>{
    const visits=state.sessions.filter(s=>!s.cancelled&&s.attendance[p.id]==='present').sort((a,b)=>b.date.localeCompare(a.date));
    const last=visits[0];
    return `<article class="person-row"><div class="person-name"><button type="button" class="player-profile-link" data-search-profile="${esc(p.id)}">${esc(p.name)}<span>Ver ficha →</span></button><p class="hint">Invitado · sin turno fijo<br>${last?'Última visita: '+esc(fmtDate(last.date))+' · Turno '+last.turnId:'Sin visitas como presente guardadas.'}</p></div><button type="button" class="secondary danger" data-delete-player="${esc(p.id)}">Eliminar</button></article>`;
  }).join(''):'<p class="hint">Todavía no hay invitados guardados.</p>';
}
async function promoteGuest(){
  if(busy||!ready)return;
  const player=state.players.find(p=>p.id===selectedPlayerId),turn=$('guest-regular-turn').value;
  if(!player?.guest||!validTurn(turn))return;
  if(state.players.some(p=>p.id!==player.id&&!p.guest&&p.active!==false&&searchName(p.name)===searchName(player.name))){$('guest-promotion-message').textContent='Ya hay un jugador activo con ese nombre. Revisá las fichas antes de continuar.';return;}
  if(!confirm(`¿Convertir a ${player.name} en jugador habitual del ${turnLabel(turn)} desde hoy? Se conservan sus asistencias, parejas y notas anteriores.`)||!guardDrafts())return;
  const next={...state,players:state.players.map(p=>p.id===player.id?{...p,guest:false,active:true,turnId:turn,regularFrom:todayISO()}:p)};
  if(!await commit(next)){$('guest-promotion-message').textContent='No se pudo guardar. El jugador sigue como invitado; volvé a intentar.';return;}
  currentTurn=turn;try{localStorage.setItem('tmr-selected-turn',turn);}catch{}
  renderAll();$('guest-promotion-message').textContent='';$('app-message').textContent=`${player.name} ya es habitual del Turno ${turn}. Se conservó su historial.`;
}
$('guest-form').onsubmit=addDayGuest;
$('guest-existing').onchange=()=>{renderGuestOptions();$('guest-message').textContent='';};
$('guest-promote').onclick=promoteGuest;

$('followup-notice-hide').onclick=()=>setFollowupNotice(false);
$('followup-notice-enabled').onchange=()=>setFollowupNotice($('followup-notice-enabled').checked);
$('followup-threshold').onchange=()=>{
  const next=Number($('followup-threshold').value);if(!Number.isInteger(next)||next<1||next>10)return;
  absenceThreshold=next;followupExpanded=false;
  try{localStorage.setItem('tmr-absence-threshold-v1',String(next));$('followup-setting-message').textContent='';}
  catch{$('followup-setting-message').textContent='El mínimo se aplica ahora, pero no se pudo conservar para la próxima apertura.';}
  renderFollowup();
};
$('followup-expand').onclick=()=>{followupExpanded=!followupExpanded;renderFollowup();};
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&ready&&!busy)renderFollowup();});
// Navegación y acciones: cada sesión se identifica por fecha + turno.
$('player-search').oninput=()=>{if(ready&&!busy)renderPlayerSearch();};
$('player-search-clear').onclick=()=>{if(!busy){$('player-search').value='';renderPlayerSearch();$('player-search').focus();}};
$('player-search-date').value=todayISO();
$('player-search-date').onchange=()=>{if(ready&&!busy)renderPlayerSearch();};
$('turn-selector').onchange=()=>{
  const turn=$('turn-selector').value;
  if(!ready||!validTurn(turn)||!guardDrafts()){$('turn-selector').value=currentTurn;return;}
  currentTurn=turn;try{localStorage.setItem('tmr-selected-turn',turn);}catch{}
  closePlayerEditor();$('player-turn').innerHTML=optionsTurns(turn);
  $('app-message').textContent='';$('player-message').textContent='';$('day-message').textContent='';
  renderAll();
};
$('ratings-date').onchange=()=>{const date=$('ratings-date').value;if(!validDate(date)||!guardDrafts()){$('ratings-date').value=selectedDate;return;}selectedDate=date;renderRatings();};
$('session-date').onchange=()=>{const date=$('session-date').value;if(!validDate(date)||!guardDrafts()){$('session-date').value=selectedDate;return;}selectedDate=date;renderAttendance();};
$('session-note').oninput=()=>{if(attendanceDraft&&!busy){attendanceDraft.note=$('session-note').value;attendanceDirty=true;$('save-message').textContent='Cambios sin guardar.';}};
$('session-cancelled').onchange=()=>{if(attendanceDraft&&!busy){attendanceDraft.cancelled=$('session-cancelled').checked;attendanceDirty=true;renderAttendanceSummary();renderGuestOptions();}};
$('plan-file').onchange=choosePlanImage;
$('plan-observation').oninput=()=>{if(!busy&&!planLoading&&planDraft){planDraft.observation=$('plan-observation').value;planDirty=true;$('plan-save').disabled=false;$('plan-message').textContent='Plan sin guardar.';}};
$('plan-save').onclick=savePlan;$('plan-remove').onclick=removePlan;
$('plan-discard').onclick=()=>{if(!busy&&!planLoading&&(!planDirty||confirm('¿Descartar los cambios del plan sin guardar?'))){planDraft=null;planDirty=false;renderPlan();}};
$('plan-view').onclick=()=>viewPlan(planDraft);
$('plan-viewer-close').onclick=()=>$('plan-viewer').close();
$('plan-zoom').onclick=()=>{const zoomed=$('plan-viewer-scroll').classList.toggle('zoomed');$('plan-zoom').textContent=zoomed?'Ajustar al ancho':'Ampliar';};
$('save-attendance').onclick=saveAttendance;
$('clear-attendance').onclick=()=>{if(busy||!attendanceDraft||!confirm('¿Limpiar las marcas de esta fecha y turno? Tocá Guardar asistencia para confirmar el cambio.'))return;attendanceDraft.attendance={};attendanceDirty=true;renderAttendance();};
$('discard-attendance').onclick=()=>{if(!busy&&(!attendanceDirty||confirm('¿Descartar los cambios de asistencia sin guardar?'))){attendanceDraft=null;attendanceDirty=false;renderAttendance();}};
$('day-apply').onclick=applyDayMove;
$('player-edit-form').onsubmit=savePlayerName;$('cancel-player-edit').onclick=closePlayerEditor;
$('player-form').onsubmit=async event=>{
  event.preventDefault();if(busy||!ready)return;
  const name=$('player-name').value.trim(),turn=$('player-turn').value;if(!name||name.length>100||!validTurn(turn))return;
  if(state.players.some(p=>(p.guest||p.active!==false)&&searchName(p.name)===searchName(name))){alert('Ese jugador ya está registrado. Buscalo en Jugadores; si es invitado podés convertirlo en habitual desde su ficha.');return;}
  const next={...state,players:[...state.players,{id:uid(),name,turnId:turn,active:true,trainingNotes:[],createdAt:new Date().toISOString()}]};
  if(await commit(next)){$('player-name').value='';renderAll();$('player-message').textContent=`Agregado: ${name} · ${turnLabel(turn)}.`;}
};
$('history-month').value=monthISO();$('history-month').onchange=renderHistory;
$('stats-month').value=monthISO();$('stats-month').onchange=renderStats;$('stats-search').oninput=renderStats;
$('player-profile-month').onchange=renderPlayerProfile;
$('pairs-first').onchange=renderPairOptions;$('pairs-second').onchange=renderPairMemory;$('pairs-add').onclick=addPair;$('pairs-save').onclick=savePairs;
$('pairs-note').oninput=()=>{if(pairDraft&&!busy){pairDraft.note=$('pairs-note').value;pairDirty=true;$('pairs-discard').disabled=false;$('pairs-message').textContent='Cambios sin guardar.';}};
$('pairs-discard').onclick=()=>{if(!busy&&(!pairDirty||confirm('¿Descartar los cambios de parejas sin guardar?'))){loadPairDraft();renderPairs();}};
$('pairs-date').onchange=()=>{const date=$('pairs-date').value;if(!validDate(date)||!guardDrafts()){$('pairs-date').value=selectedDate;return;}selectedDate=date;renderPairs();};
$('pairs-previous').onclick=()=>{const date=previousPairDate(selectedDate);if(date&&guardDrafts()){selectedDate=date;renderPairs();}};
$('pairs-attendance').onclick=()=>openAttendance(selectedDate);
$('export-json').onclick=async()=>{
  if(!ready||busy||exportingFile)return;
  try{const saved=await download(new Blob([JSON.stringify({...state,exportedAt:new Date().toISOString()},null,2)],{type:'application/json'}),`respaldo-TMR-${todayISO()}.json`);$('backup-message').textContent=saved?'Copia de todos los turnos guardada. Solo incluye cambios guardados.':'Guardado cancelado. Los datos de la app se conservan.';}
  catch{$('backup-message').textContent='No se pudo guardar la copia. Los datos de la app se conservan; volvé a intentar.';}
};
$('import-json').onchange=async event=>{
  const f=event.target.files[0];if(!f||busy||!ready)return;
  try{const next=normalizeState(JSON.parse(await f.text()));if(!confirm('Esto reemplazará TODOS los turnos y datos de este dispositivo. Las copias anteriores a los turnos se cargarán en Turno 3. ¿Continuar?'))return;if(!guardDrafts())return;if(await commit(next)){attendanceDraft=null;pairDraft=null;planDraft=null;planDirty=false;closePlayerEditor();selectedPlayerId=null;if(currentView==='player')showView('players');renderAll();$('backup-message').textContent='Copia de todos los turnos restaurada.';}}
  catch{alert('El archivo no es una copia compatible de TMR. No se reemplazaron los datos.');}finally{event.target.value='';}
};
$('export-csv').onclick=async()=>{if(!ready||busy||exportingFile)return;const month=$('stats-month').value||monthISO(),rows=calcStats(month),lines=[['Turno','Horario','Jugador','Presentes','Faltas','Justificadas','Sin marcar','Porcentaje','Promedio individual','Clases puntuadas','Clases presentes para puntuar'],...rows.map(r=>[currentTurn,TURNS.find(t=>t.id===currentTurn).hours,r.name,r.present,r.absent,r.justified,r.unmarked,r.denominator?r.pct+'%':'',r.mean===null?'':ratingText(r.mean),r.ratedCount,r.trainingCount])];try{const saved=await download(new Blob(['\ufeff'+lines.map(row=>row.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'}),`TMR-turno-${currentTurn}-${month}.csv`);$('stats-export-message').textContent=saved?'Estadísticas guardadas.':'Guardado cancelado.';}catch{$('stats-export-message').textContent='No se pudo guardar el CSV. Volvé a intentar.';}};
document.addEventListener('change',event=>{const el=event.target.closest('[data-activity]');if(!el||busy||!pairDraft)return;const kind=el.dataset.activity,id=el.dataset.activityPlayer,session=getSession(pairDraft.date,pairDraft.turnId);if(!['multiball','rebounder','serves'].includes(kind)||!session||session.cancelled)return;const selected=pairDraft.activities[kind];if(el.checked){if(session.attendance[id]!=='present'||!session.roster.includes(id)||pairDraft.pairs.flat().includes(id)){renderPairs();return;}if(!selected.includes(id))selected.push(id);}else pairDraft.activities[kind]=selected.filter(x=>x!==id);pairDirty=true;renderPairs();});
document.addEventListener('click',async event=>{
  if(busy||!ready)return;const target=event.target;
  const nav=target.closest('[data-nav]');if(nav){if($('menu-dialog').open)$('menu-dialog').close();showView(nav.dataset.nav);return;}
  const searchProfile=target.closest('[data-search-profile]');if(searchProfile){openSearchPlayerProfile(searchProfile.dataset.searchProfile);return;}
  const searchMove=target.closest('[data-search-day-move]');if(searchMove){prepareSearchDayMove(searchMove.dataset.searchDayMove);return;}
  const profile=target.closest('[data-player-profile]');if(profile){openPlayerProfile(profile.dataset.playerProfile);return;}
  const edit=target.closest('[data-edit-player]');if(edit){openPlayerEditor(edit.dataset.editPlayer);return;}
  const editNote=target.closest('[data-edit-training-note]');if(editNote){openTrainingNoteEditor(editNote.dataset.editTrainingNote);return;}
  const deleteNote=target.closest('[data-delete-training-note]');if(deleteNote){await deleteTrainingNote(deleteNote.dataset.deleteTrainingNote);return;}
  const del=target.closest('[data-delete-player]');if(del){await deletePlayer(del.dataset.deletePlayer);return;}
  const toggle=target.closest('[data-toggle-player]');if(toggle){const id=toggle.dataset.togglePlayer;const next={...state,players:state.players.map(p=>p.id===id?{...p,active:p.active===false}:p)};if(await commit(next))renderAll();return;}
  const expand=target.closest('[data-expand-player]');if(expand){attendanceExpanded=attendanceExpanded===expand.dataset.expandPlayer?null:expand.dataset.expandPlayer;renderAttendance();return;}
  const rateExpand=target.closest('[data-rate-expand]');if(rateExpand&&attendanceDraft){const id=rateExpand.dataset.rateExpand;ratingExpanded=ratingExpanded===id?null:id;ratingPlayerId=id;ratingContext=attendanceDraft.date+'/'+attendanceDraft.turnId;renderRatings();return;}
  const rate=target.closest('[data-rate-player]');if(rate){openRatingDialog(rate.dataset.ratePlayer);return;}
  const score=target.closest('[data-rating-value]');if(score){applyRatingValue(score.dataset.ratingValue);return;}
  const removeGuest=target.closest('[data-remove-guest]');if(removeGuest){removeDayGuest(removeGuest.dataset.removeGuest);return;}
  const status=target.closest('[data-status]');if(status&&attendanceDraft){const id=status.dataset.player;if(!attendanceDraft.roster.includes(id))return;attendanceDraft.attendance[id]=status.dataset.status;attendanceExpanded=null;attendanceDirty=true;renderAttendance();return;}
  const exerciseCat=target.closest('[data-exercise-category]');if(exerciseCat){exerciseCategory=exerciseCat.dataset.exerciseCategory;renderExercises();return;}
  const exerciseDetail=target.closest('[data-exercise-detail]');if(exerciseDetail){openExerciseDetail(exerciseDetail.dataset.exerciseDetail);return;}
  const usageToggle=target.closest('[data-exercise-usage-toggle]');if(usageToggle){exerciseUsageExpanded=!exerciseUsageExpanded;renderExerciseUsage(usageToggle.dataset.exerciseUsageToggle);return;}
  const planExercise=target.closest('[data-plan-exercise-remove]');if(planExercise){removePlanExercise(planExercise.dataset.planExerciseRemove);return;}
  const planMove=target.closest('[data-plan-exercise-move]');if(planMove){movePlanExercise(planMove.dataset.planExerciseMove,Number(planMove.dataset.dir));return;}
  const copyPlan=target.closest('[data-copy-plan]');if(copyPlan){copyPlanExercises(copyPlan.dataset.copyPlan);return;}
  const pick=target.closest('[data-pick-exercise]');if(pick){pickExercise(pick.dataset.pickExercise);return;}
  const plan=target.closest('[data-view-plan]');if(plan){viewPlan(getPlan(plan.dataset.viewPlan));return;}
  const date=target.closest('[data-edit-date]');if(date){openAttendance(date.dataset.editDate);return;}
  const pairDate=target.closest('[data-pairs-date]');if(pairDate&&guardDrafts()){selectedDate=pairDate.dataset.pairsDate;showView('pairs');return;}
  const remove=target.closest('[data-remove-pair]');if(remove&&pairDraft&&!getSession(pairDraft.date)?.cancelled){pairDraft.pairs.splice(Number(remove.dataset.removePair),1);pairDirty=true;renderPairs();}
});
let updateNoticeDismissed=false;
function showUpdateNotice(){
  if(updateNoticeDismissed||$('update-notice'))return;
  const notice=document.createElement('div');notice.id='update-notice';notice.setAttribute('role','status');
  const text=document.createElement('p');text.textContent='Nueva versión disponible. Guardá tus cambios antes de recargar.';
  const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','Cerrar aviso de actualización');
  close.onclick=()=>{updateNoticeDismissed=true;notice.remove();};notice.append(text,close);document.querySelector('main').prepend(notice);
}
window.addEventListener('online',updateConnection);window.addEventListener('offline',updateConnection);
window.addEventListener('beforeunload',event=>{if(attendanceDirty||pairDirty||trainingNoteDirty||planDirty||exerciseFormDirty||exerciseImageLoading){event.preventDefault();event.returnValue='';}});
// Sin service worker en esta copia de laboratorio.
$('rating-close').onclick=()=>$('rating-dialog').close();
$('exercise-search').oninput=renderExercises;
$('exercise-new').onclick=()=>openExerciseForm();
$('exercise-form').addEventListener('input',()=>{exerciseFormDirty=true;});
$('exercise-form').onsubmit=saveExercise;
$('exercise-cancel').onclick=closeExerciseForm;
$('exercise-form-dialog').addEventListener('cancel',event=>{event.preventDefault();closeExerciseForm();});
$('exercise-form-dialog').addEventListener('close',()=>{exerciseImageRequest++;exerciseImageLoading=false;});
$('exercise-file').onchange=chooseExerciseImage;
$('exercise-image-remove').onclick=()=>{if(busy||exerciseImageLoading)return;exerciseImage='';exerciseFormDirty=true;renderExerciseImage();};
$('exercise-detail-close').onclick=()=>$('exercise-detail').close();
$('exercise-detail-edit').onclick=()=>{if(busy)return;const id=detailExerciseId;$('exercise-detail').close();openExerciseForm(id);};
$('exercise-detail-delete').onclick=()=>deleteExercise(detailExerciseId);
$('plan-exercise-open').onclick=openExercisePicker;
$('plan-copy-open').onclick=openPlanCopy;
$('plan-copy-close').onclick=()=>$('plan-copy-dialog').close();
$('exercise-picker-search').oninput=renderExercisePicker;
$('exercise-picker-close').onclick=()=>$('exercise-picker').close();
$('rating-clear').onclick=()=>applyRatingValue('');
$('partner-period').onchange=renderPartnerStats;$('partner-turn').onchange=renderPartnerStats;
$('menu-open').onclick=()=>{if(ready&&!busy)$('menu-dialog').showModal();};$('menu-close').onclick=()=>$('menu-dialog').close();
$('menu-dialog').addEventListener('click',event=>{if(event.target===$('menu-dialog'))$('menu-dialog').close();});
$('player-turn').innerHTML=optionsTurns(currentTurn);
$('lab-login-form').onsubmit=async e=>{e.preventDefault();if(busy)return;busy=true;$('lab-login-message').textContent='Ingresando…';try{await labPuente.ingresar($('lab-email').value.trim(),$('lab-password').value);const row=await labPuente.inicializar();aplicarEstadoLab(row);$('lab-login').hidden=true;$('lab-controls').hidden=false;document.querySelector('main').inert=false;document.querySelector('nav').inert=false;await contarLab();}catch(err){labPuente.salirLocal();$('lab-login-message').textContent='No se pudo iniciar la prueba: '+(err.message||'error');}finally{$('lab-password').value='';busy=false;}};
$('lab-send').onclick=async()=>{if(busy||!ready)return;if(!guardDrafts())return;busy=true;document.querySelector('main').inert=true;document.querySelector('nav').inert=true;try{const r=await labPuente.sincronizar();if(r.estado==='completa'){const row=await labPuente.inicializar();aplicarEstadoLab(row);$('lab-status').textContent='Envío completo. Sin cambios pendientes.';}else $('lab-status').textContent=r.estado==='conflicto'?'Envío detenido por conflicto. El cambio se conserva; falta revisión.':r.estado==='ocupada'?'Otra pestaña está enviando.':'Envío pausado. Los cambios se conservan: '+(r.motivo||'reintentá');}catch(e){$('lab-status').textContent='No se pudo completar el envío; los cambios se conservan.';}finally{busy=false;document.querySelector('main').inert=!ready;document.querySelector('nav').inert=!ready;}};
let labReview=null;
function labMarkLabel(m){return ({present:'Presente',absent:'Falta',justified:'Justificada'})[m]||'Sin marcar';}
$('lab-update').onclick=async()=>{if(busy||!ready)return;if(!guardDrafts())return;busy=true;try{const row=await labPuente.actualizar();aplicarEstadoLab(row);await contarLab();}catch(e){$('lab-status').textContent='No se pudo actualizar. Los pendientes se conservan.';}finally{busy=false;}};
$('lab-review').onclick=async()=>{if(busy||!ready)return;if(!guardDrafts())return;busy=true;try{labReview=await labPuente.revisar();$('lab-conflict-text').textContent=labReview.tipo==='puntaje'?'Jugador '+labReview.jugador+' · Asistencia en Supabase: '+labMarkLabel(labReview.remoto.marca)+' · Puntaje en Supabase: '+(labReview.remoto.puntaje??'sin puntaje')+' · Tu puntaje: '+(labReview.local??'sin puntaje'):'Jugador '+labReview.jugador+' · Supabase: '+labMarkLabel(labReview.remoto.marca)+' · Tu cambio: '+labMarkLabel(labReview.local);$('lab-conflict').hidden=false;}catch(e){labReview=null;$('lab-conflict').hidden=true;$('lab-status').textContent='No se pudo revisar: '+e.message;}finally{busy=false;}};
async function labResolver(eleccion){if(busy||!labReview)return;busy=true;try{const row=await labPuente.resolver(labReview,eleccion);aplicarEstadoLab(row);labReview=null;$('lab-conflict').hidden=true;$('lab-status').textContent=eleccion==='local'?'Cambio conservado, pendiente de envío.':'Marca remota conservada.';}catch(e){labReview=null;$('lab-conflict').hidden=true;$('lab-status').textContent='No se resolvió: '+e.message+'. Revisá nuevamente.';}finally{busy=false;}}
$('lab-local').onclick=()=>labResolver('local');$('lab-remote').onclick=()=>labResolver('remoto');
$('lab-exit').onclick=()=>{if(busy)return;if(!guardDrafts())return;labReview=null;$('lab-conflict').hidden=true;labPuente.salirLocal();labCurrent=null;labRevision=null;ready=false;attendanceDraft=null;state={schemaVersion:8,players:[],sessions:[],dayTurns:[],trainingPlans:[],exercises:[]};renderAll();document.querySelector('main').inert=true;document.querySelector('nav').inert=true;$('lab-controls').hidden=true;$('lab-login').hidden=false;$('lab-login-message').textContent='Salida local; no se confirmó cierre en Supabase. Los pendientes siguen para la misma cuenta.';};
loadState();
