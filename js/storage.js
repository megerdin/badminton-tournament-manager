/* ================================================================ */
/* BADMINTON APP — STORAGE / CLOUD                                  */
/* Sections: Cloud Config, Supabase/Auth, Local Cache, Persistence  */
/* ================================================================ */

/* ====================== cloud-config.js ====================== */
/*
  Safe browser configuration.
  The Supabase publishable key is designed for browser use.
  NEVER put a Supabase service_role/secret key here.
*/
window.BADMINTON_CLOUD_CONFIG = {
  url: "https://tumqpsbwelmwawbkqtjh.supabase.co",
  publishableKey: "sb_publishable_CcmUtzpRMlCqEY8o5yXdGQ_7Otmu4t4"
};

/* ====================== cloud.js ====================== */
window.BADMINTON_CLOUD_CONFIG=window.BADMINTON_CLOUD_CONFIG||{url:"",publishableKey:""};
window.BADMINTON_CLOUD={
 client:null,session:null,profile:null,tournamentId:null,clubId:null,saveTimer:null,appReady:false,cloudVersion:0,syncBusy:false,syncConflict:false,
 retryTimer:null,retryAttempt:0,
 queueKey:"badmintonTournamentManager.cloudQueue.v3",
 configured(){const c=window.BADMINTON_CLOUD_CONFIG||{};return Boolean(c.url&&c.publishableKey&&window.supabase);},
 message(t){const e=document.getElementById('cloudAuthMessage');if(e)e.textContent=t||'';},
 gate(v){document.getElementById('cloudAuthGate')?.classList.toggle('hidden',!v);},
 status(t){const e=document.getElementById('cloudSyncStatus');if(e)e.textContent=t||'';window.BADMINTON_AUTH?.syncAppStatus?.();},
 queueRead(){
  try{
   const x=JSON.parse(localStorage.getItem(this.queueKey)||'null');
   if(!x||typeof x!=='object')return null;
   if(this.session?.user?.id && x.userId && x.userId!==this.session.user.id)return null;
   if(this.tournamentId && x.tournamentId && x.tournamentId!==this.tournamentId)return null;
   return x;
  }catch{return null;}
 },
 queueWrite(snapshot,baseVersion){
  try{
   localStorage.setItem(this.queueKey,JSON.stringify({snapshot,baseVersion:Number(baseVersion||0),userId:this.session?.user?.id||null,tournamentId:this.tournamentId||null,queuedAt:Date.now(),queueId:(globalThis.crypto?.randomUUID?.()||String(Date.now())+"-"+Math.random())}));
  }catch(e){console.warn('Cloud queue could not be stored:',e);}
 },
 queueClear(){try{localStorage.removeItem(this.queueKey);}catch(e){}},
 queueUpdate(patch){
  try{
   const current=this.queueRead()||{};
   const next={...current,...(patch&&typeof patch==='object'?patch:{}),userId:this.session?.user?.id||current.userId||null,tournamentId:this.tournamentId||current.tournamentId||null};
   localStorage.setItem(this.queueKey,JSON.stringify(next));
  }catch(e){console.warn('Cloud queue could not be updated:',e);}
 },
 async resolveConflictKeepLocal(){
  if(this.syncBusy||!this.client||!this.session||this.profile?.approval_status!=='approved'||!this.tournamentId)return {status:'idle'};
  const q=this.queueRead();
  if(!q)return {status:'clean'};
  if(!navigator.onLine){this.status('Offline — local changes remain queued');return {status:'offline'};}
  this.syncBusy=true;this.status('Preparing local changes…');
  try{
   const remote=await this.client.from('tournaments').select('version').eq('id',this.tournamentId).single();
   if(remote.error)throw remote.error;
   this.cloudVersion=Number(remote.data.version||1);
   if(!this.queueRead())return {status:'clean'};
   this.queueUpdate({baseVersion:this.cloudVersion,attempts:0,lastError:null});
   this.syncConflict=false;this.status('Sync pending…');
  }catch(e){this.status('Sync conflict — cloud changed. Local changes were kept.');throw e;}
  finally{this.syncBusy=false;}
  return this.syncPending();
 },
 async resolveConflictUseCloud(){
  if(this.syncBusy||!this.client||!this.session||this.profile?.approval_status!=='approved'||!this.tournamentId)return {status:'idle'};
  if(!navigator.onLine){this.status('Offline — cannot load cloud version');return {status:'offline'};}
  this.syncBusy=true;this.status('Loading cloud version…');
  try{
   const r=await this.client.from('tournaments').select('data,version,updated_at').eq('id',this.tournamentId).single();
   if(r.error)throw r.error;
   this.cloudVersion=Number(r.data.version||1);
   if(r.data?.data&&Object.keys(r.data.data).length)window.BADMINTON_CLOUD.applySnapshot(r.data.data);
   this.queueClear();this.syncConflict=false;this.status('Cloud synced');this.gate(false);
   if(window.renderAll)window.renderAll();
   return {status:'loaded',version:this.cloudVersion};
  }catch(e){this.status('Sync conflict — cloud changes were not loaded.');throw e;}
  finally{this.syncBusy=false;}
 },
 scheduleRetry(){
  clearTimeout(this.retryTimer);
  if(!this.queueRead()||!navigator.onLine)return;
  const delay=Math.min(60000,Math.max(2000,2000*Math.pow(2,Math.min(this.retryAttempt++,5))));
  this.retryTimer=setTimeout(()=>this.syncPending().catch(()=>{}),delay);
 },
 async init(){
  if(!this.configured()){this.gate(false);return;}
  this.client=window.supabase.createClient(window.BADMINTON_CLOUD_CONFIG.url,window.BADMINTON_CLOUD_CONFIG.publishableKey,{auth:{autoRefreshToken:true,persistSession:true,detectSessionInUrl:true}});
  window.addEventListener('online',()=>{this.retryAttempt=0;this.syncPending().catch(()=>{});});
  window.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&navigator.onLine)this.syncPending().catch(()=>{});});
  window.addEventListener('focus',()=>{if(navigator.onLine)this.syncPending().catch(()=>{});});
  this.gate(false);
  if(window.BADMINTON_AUTH?.init) await window.BADMINTON_AUTH.init();
 },
 profileCacheKey(userId){return 'badmintonTournamentManager.profile.v1.'+String(userId||'');},
 profileCacheRead(userId){try{return JSON.parse(localStorage.getItem(this.profileCacheKey(userId))||'null');}catch{return null;}},
 profileCacheWrite(profile){try{if(profile?.id)localStorage.setItem(this.profileCacheKey(profile.id),JSON.stringify(profile));}catch{}},
 loadLocalFallback(){
  try{
   if(typeof window.loadLocal==='function')window.loadLocal();
   if(typeof window.renderAll==='function')window.renderAll();
  }catch(e){console.warn('Offline local fallback failed:',e);}
 },
 async prepareCloudRecord(){
  const uid=this.session.user.id;let r=await this.client.from('clubs').select('id').eq('owner_id',uid).order('created_at',{ascending:true}).limit(1).maybeSingle();if(r.error)throw r.error;let club=r.data;
  if(!club){r=await this.client.from('clubs').insert({owner_id:uid,name:'Your club name'}).select('id').single();if(r.error)throw r.error;club=r.data;}this.clubId=club.id;
  r=await this.client.from('tournaments').select('id,version').eq('club_id',this.clubId).order('created_at',{ascending:true}).limit(1).maybeSingle();if(r.error)throw r.error;let t=r.data;
  if(!t){r=await this.client.from('tournaments').insert({club_id:this.clubId,name:'Badminton Tournament Manager',data:{},version:1,updated_by:uid}).select('id,version').single();if(r.error)throw r.error;t=r.data;r=await this.client.from('tournament_members').insert({tournament_id:t.id,user_id:uid,role:'owner'});if(r.error&&r.error.code!=='23505')throw r.error;}
  this.tournamentId=t.id;this.cloudVersion=Number(t.version||1);
  // Existing tournaments must also have an owner membership. Without this
  // row, a normal approved owner can see the club but RLS will deny access to
  // the tournament. This is especially important for records created before
  // membership enforcement was hardened.
  const member=await this.client.from('tournament_members').select('tournament_id').eq('tournament_id',t.id).eq('user_id',uid).maybeSingle();
  if(member.error)throw member.error;
  if(!member.data){
    const addMember=await this.client.from('tournament_members').insert({tournament_id:t.id,user_id:uid,role:'owner'});
    if(addMember.error&&addMember.error.code!=='23505')throw addMember.error;
  }
 },
 async loadRemoteIntoApp(){
  if(!this.tournamentId)return {status:'idle'};
  // Never replace the live local tournament while a newer local snapshot is
  // waiting to reach the cloud. This protects offline/poor-connection work
  // during startup and after transient network failures.
  if(this.queueRead()){
   this.status(navigator.onLine?'Cloud sync pending — local changes kept':'Offline — changes saved locally');
   this.gate(false);
   return {status:'pending-local'};
  }
  const r=await this.client.from('tournaments').select('data,version,updated_at').eq('id',this.tournamentId).single();if(r.error)throw r.error;
  this.cloudVersion=Number(r.data.version||1);if(r.data?.data&&Object.keys(r.data.data).length)window.BADMINTON_CLOUD.applySnapshot(r.data.data);this.status('Cloud synced');this.gate(false);if(window.renderAll)window.renderAll();
  return {status:'loaded',version:this.cloudVersion};
 },
 queueSave(snapshot){
  if(!this.configured()||!this.client||!this.session||this.profile?.approval_status!=='approved'||!this.tournamentId)return Promise.resolve({status:'local-only'});
  clearTimeout(this.saveTimer);this.queueWrite(snapshot,this.cloudVersion);this.status('Sync pending…');
  return new Promise(resolve=>{this.saveTimer=setTimeout(async()=>{const r=await this.syncPending();resolve(r);},400);});
 },
 async syncPending(){
  if(this.syncBusy||!this.client||!this.session||this.profile?.approval_status!=='approved'||!this.tournamentId)return {status:'idle'};
  const q=this.queueRead();if(!q)return {status:'clean'};if(!navigator.onLine){this.status('Offline — changes saved locally');return {status:'offline'};}
  const queueId=q.queueId||String(q.queuedAt||"");
  this.syncBusy=true;this.status('Syncing…');
  try{
   const remote=await this.client.from('tournaments').select('version,data').eq('id',this.tournamentId).single();if(remote.error)throw remote.error;
   const remoteVersion=Number(remote.data.version||1),baseVersion=Number(q.baseVersion||0);
   if(remoteVersion!==baseVersion){
    this.syncConflict=true;
    this.status('Sync conflict — cloud changed. Local changes were kept.');
    if(typeof window.showMessage==='function')window.showMessage('Cloud sync conflict: cloud data changed before these local changes were uploaded.');
    return {status:'conflict',remoteVersion,baseVersion};
   }
   const next=remoteVersion+1;
   const w=await this.client.from('tournaments').update({data:q.snapshot,version:next,updated_by:this.session.user.id}).eq('id',this.tournamentId).eq('version',remoteVersion).select('version').single();
   if(w.error)throw w.error;
   this.cloudVersion=Number(w.data.version||next);this.syncConflict=false;
   // A user may save again while this network write is in flight. Only clear
   // the queue when it is still the exact snapshot that we just uploaded.
   const latest=this.queueRead();
   if(latest?.queueId===queueId){
    this.queueClear();
    this.status('Cloud synced');
    return {status:'synced',version:this.cloudVersion};
   }
   // The newer queue entry is based on the state immediately after the
   // snapshot we just uploaded. Rebase its expected cloud version onto the
   // version we just committed so sequential local saves do not become a
   // false conflict with the user's own preceding upload. A genuinely
   // external cloud change is still detected by the version check above.
   const rebased=this.queueRead();
   if(rebased?.queueId!==queueId){
    this.queueUpdate({baseVersion:this.cloudVersion,attempts:0,lastError:null});
   }
   this.status('Cloud synced; newer local changes pending…');
   this.scheduleRetry(0);
   return {status:'synced-with-pending',version:this.cloudVersion};
  }catch(e){console.warn('Cloud sync deferred:',e);this.queueUpdate({attempts:Number(this.queueRead()?.attempts||0)+1,lastError:String(e?.message||e)});this.status(navigator.onLine?'Cloud sync pending — will retry':'Offline — changes saved locally');this.scheduleRetry();return {status:'pending',error:e};}
  finally{this.syncBusy=false;}
 },
 finishAppStartup(){this.appReady=true;if(this.profile?.approval_status==='approved')this.loadRemoteIntoApp().catch(e=>this.message('Cloud load failed: '+e.message));}
};
window.BADMINTON_CLOUD.applySnapshot=s=>{if(typeof window.applyCloudSnapshotInternal==='function')window.applyCloudSnapshotInternal(s);};
document.addEventListener('DOMContentLoaded',()=>BADMINTON_CLOUD.init().catch(e=>BADMINTON_CLOUD.message(e.message||String(e))));

/* ====================== local.js ====================== */
/*
 Badminton Tournament Manager — local persistence adapter
 Phase 9 / v5.3.16

 This module owns only the tournament document's localStorage boundary.
 It deliberately does not own authentication, the cloud sync queue, or
 tournament calculations.
*/
(function(){
  "use strict";

  const STORAGE_KEY = "badmintonTournamentManager.v1";

  function read(){
    try{
      return localStorage.getItem(STORAGE_KEY);
    }catch(error){
      console.warn("Local tournament storage could not be read:", error);
      return null;
    }
  }

  function write(value){
    try{
      localStorage.setItem(STORAGE_KEY, String(value));
      return true;
    }catch(error){
      console.warn("Local tournament storage could not be written:", error);
      return false;
    }
  }

  function remove(){
    try{
      localStorage.removeItem(STORAGE_KEY);
      return true;
    }catch(error){
      console.warn("Local tournament storage could not be removed:", error);
      return false;
    }
  }

  window.BADMINTON_LOCAL = Object.freeze({
    key: STORAGE_KEY,
    read,
    write,
    remove
  });
})();

/* ====================== persistence.js ====================== */
/*
 Badminton Tournament Manager — persistence boundary
 Phase 19 / v5.3.26

 Owns the tournament document persistence workflow: settings synchronization,
 migration/normalization on local load, and local/cloud save dispatch.
 Tournament calculations and rendering remain outside this module.
*/
"use strict";

function saveLocal(silent=false){
  // Persistence is intentionally separate from rendering. The active category
  // is calculated/saved exactly as before, then copied into the master record.
  // Other category subsets are untouched.
  syncSettings();
  clearCalculationCache();
  // Ranking calculation can create a lottery order for exact global-metric
  // ties. Calculate it before serialization so a newly created lottery is
  // persisted together with the active category state.
  if(typeof calculateAndStoreGroupGlobalMetrics==="function")
    calculateAndStoreGroupGlobalMetrics();
  if(typeof calculateTournamentRanking==="function")
    calculateTournamentRanking();
  saveActiveCategoryToMaster();
  const snapshot = deepClone(masterTournament||tournament);

  // Local cache remains immediate and reliable. Cloud persistence is queued
  // separately so a slow/broken network never blocks tournament operation.
  window.BADMINTON_LOCAL?.write(JSON.stringify(snapshot));
  if(window.BADMINTON_CLOUD?.queueSave){
    window.BADMINTON_CLOUD.queueSave(snapshot).catch(err=>{
      console.warn("Cloud save deferred:", err);
    });
  }

  if(!silent) showMessage(
    window.BADMINTON_CLOUD?.configured?.()
      ? "Tournament saved locally; cloud sync queued."
      : "Tournament saved locally."
  );
}

// Tournament settings remain editable after results exist so the admin can correct
// setup mistakes without locking the tournament to its original scoring configuration.
function syncSettings(){
  tournament.clubName=$("clubName").value.trim();
  tournament.date=$("tournamentDate").value;
  syncCategorySettingsFromUI();
  if($("tournamentMode")){
    const mode=$("tournamentMode").value;
    tournament.settings.mode=["doubles","singles","multiplayer"].includes(mode)?mode:"doubles";
  }else if(!["doubles","singles","multiplayer"].includes(tournament.settings.mode)){
    tournament.settings.mode="doubles";
  }
  // Legacy format settings are retained for imported JSON compatibility only.
  // Tournament mode is the sole active format authority from V5.1.2 onward.
  const activeFormat=modeToTeamFormat(tournament.settings.mode);
  tournament.settings.defaultFormat=activeFormat;
  tournament.settings.entryFormat=activeFormat;
  tournament.settings.allowedFormats=[activeFormat];
  tournament.settings.defaultQualifiers=Math.max(0,Number($("defaultQualifiers")?.value ?? tournament.settings.defaultQualifiers ?? 2)||0);
  tournament.settings.bestOf=Number($("bestOf").value);
  tournament.settings.pointsTarget=Math.max(1,Number($("pointsTarget").value)||21);
}

function migrateTournamentData(data){
  if(!data || typeof data!=="object" || Array.isArray(data)) throw new Error("Invalid tournament data");
  const migrated=JSON.parse(JSON.stringify(data));
  const version=Number(migrated.schemaVersion||1);
  if(!Number.isInteger(version) || version<1 || version>3) throw new Error("Unsupported schema version");
  migrated.settings=(migrated.settings&&typeof migrated.settings==="object"&&!Array.isArray(migrated.settings))?migrated.settings:{};

  // Convert pre-Player-Pool field names once when loading older saved data.
  if(migrated.playerPoolPlayers===undefined && Array.isArray(migrated.specialTeamEntryPlayers))
    migrated.playerPoolPlayers=migrated.specialTeamEntryPlayers;
  if(migrated.playerPoolGeneratedTeams===undefined && Array.isArray(migrated.specialGeneratedTeams))
    migrated.playerPoolGeneratedTeams=migrated.specialGeneratedTeams;
  if(migrated.playerPoolDistributionComplete===undefined && migrated.specialTeamDistributionComplete!==undefined)
    migrated.playerPoolDistributionComplete=!!migrated.specialTeamDistributionComplete;
  if(migrated.playerPoolDistributionCounts===undefined && migrated.specialTeamDistributionCounts!==undefined)
    migrated.playerPoolDistributionCounts=migrated.specialTeamDistributionCounts;
  if(migrated.playerPoolDistributionGroups===undefined && migrated.specialTeamDistributionGroups!==undefined)
    migrated.playerPoolDistributionGroups=migrated.specialTeamDistributionGroups;

  // v3: Player Pool entries use persistent IDs. Names are display data only;
  // duplicate real-world names are valid and must remain distinct.
  if(!Array.isArray(migrated.playerPoolPlayers))migrated.playerPoolPlayers=[];
  migrated.playerPoolPlayers=migrated.playerPoolPlayers.map(pool=>
    (Array.isArray(pool)?pool:[]).map(entry=>{
      if(entry && typeof entry === "object" && !Array.isArray(entry))
        return {id:String(entry.id||id("playerPoolEntry")),name:String(entry.name??"").trim()};
      return {id:id("playerPoolEntry"),name:String(entry??"").trim()};
    })
  );

  // Upgrade generated Player Pool source references from pool/index to the
  // persistent entry ID.
  if(Array.isArray(migrated.teams) && Array.isArray(migrated.players)){
    migrated.teams.forEach(team=>{
      if(!team || !Array.isArray(team.playerIds))return;
      team.playerIds.forEach(playerId=>{
        const player=migrated.players.find(p=>String(p?.id)===String(playerId));
        const source=player?.playerPoolSource;
        if(!player || !source || source.entryId)return;
        const pool=Number(source.pool);
        const index=Number(source.index);
        const entry=migrated.playerPoolPlayers?.[pool]?.[index];
        if(entry?.id){
          source.entryId=entry.id;
          source.pool=pool;
          delete source.index;
        }
      });
    });
  }

  migrated.teams=(Array.isArray(migrated.teams)?migrated.teams:[]).map(team=>{
    if(team && team.playerPoolGenerated===undefined && team.specialTeamEntry!==undefined)
      team.playerPoolGenerated=!!team.specialTeamEntry;
    if(team && team.specialTeamEntry!==undefined)delete team.specialTeamEntry;
    return team;
  });
  migrated.groups=(Array.isArray(migrated.groups)?migrated.groups:[]).map(group=>{
    if(group && group.specialTeamEntry!==undefined)delete group.specialTeamEntry;
    if(group && group.specialTeamPoolCount!==undefined)delete group.specialTeamPoolCount;
    return group;
  });
  delete migrated.specialTeamEntryPlayers;
  delete migrated.specialGeneratedTeams;
  delete migrated.specialTeamDistributionComplete;
  delete migrated.specialTeamDistributionCounts;
  delete migrated.specialTeamDistributionGroups;
  delete migrated.specialTeamEntryActive;
  delete migrated.specialTeamPoolCount;
  if(migrated.clubName===undefined)migrated.clubName=typeof migrated.name==="string"?migrated.name:"";
  delete migrated.name;
  if(!["doubles","singles","multiplayer"].includes(migrated.settings.mode)){
    const legacyModeFormat=String(migrated.settings.entryFormat||migrated.settings.defaultFormat||"").toLowerCase();
    migrated.settings.mode=["singles","doubles"].includes(legacyModeFormat)
      ? legacyModeFormat
      : legacyModeFormat==="team" ? "multiplayer" : "doubles";
  }
  const defaults=blankTournament();
  for(const key of Object.keys(defaults.settings)){
    if(migrated.settings[key]===undefined)migrated.settings[key]=defaults.settings[key];
  }
  if(!Array.isArray(migrated.settings.categories) || !migrated.settings.categories.length)
    migrated.settings.categories=[{id:id("category"),name:"Internal"}];
  migrated.settings.categories=migrated.settings.categories.map((category,index)=>({
    id:String(category?.id||id("category")),
    name:String(category?.name||((index===0)?"Internal":`Category ${index+1}`)).trim()
  }));
  for(const key of ["players","teams","groups","history","fixtures","results"]){
    if(!Array.isArray(migrated[key]))migrated[key]=[];
  }
  // Legacy BYE/exception qualification fields are no longer part of the active model.
  // Per-group directQualifiers and qualifierOverridden remain the supported custom qualification controls.
  migrated.groups.forEach(group=>{
    if(!group || typeof group!=="object")return;
    delete group.qualificationMode;
    delete group.exceptionQualifiers;
    delete group.exceptionTeamIds;
  });
  if(migrated.thirdPlacePlayoff===undefined)migrated.thirdPlacePlayoff=null;
  if(!migrated.stageBuildState || typeof migrated.stageBuildState!=="object" || Array.isArray(migrated.stageBuildState))
    migrated.stageBuildState={};
  if(!migrated.stageBuildState.groupFixtures || typeof migrated.stageBuildState.groupFixtures!=="object" || Array.isArray(migrated.stageBuildState.groupFixtures))
    migrated.stageBuildState.groupFixtures={};
  if(migrated.stageBuildState.preliminary===undefined)migrated.stageBuildState.preliminary=null;
  if(migrated.stageBuildState.mainKnockout===undefined)migrated.stageBuildState.mainKnockout=null;
  if(migrated.stageBuildState.thirdPlace===undefined)migrated.stageBuildState.thirdPlace=null;
  if(version===1){
    // v1 data used the same active competition fields but did not declare
    // a schema migration boundary. Preserve all user data and initialise
    // only fields introduced by the current model.
    if(migrated.globalRankingLottery===undefined)migrated.globalRankingLottery=null;
    if(migrated.manualKnockoutTeams===undefined)migrated.manualKnockoutTeams=[];
    if(migrated.preliminaryRound===undefined)migrated.preliminaryRound=null;
    if(migrated.mainKnockoutEntries===undefined)migrated.mainKnockoutEntries=[];
    if(migrated.mainKnockoutEntriesUpdatedAt===undefined)migrated.mainKnockoutEntriesUpdatedAt=null;
    if(migrated.mainKnockoutDraw===undefined)migrated.mainKnockoutDraw=null;
  }
  if(!["doubles","singles","multiplayer"].includes(migrated.settings.mode))migrated.settings.mode="doubles";
  if(!Array.isArray(migrated.settings.teamPoolEntries))migrated.settings.teamPoolEntries=[];
  migrated.settings.teamPoolEntries=migrated.settings.teamPoolEntries.map((entry,index)=>{
    const names=Array.isArray(entry?.playerNames)
      ? entry.playerNames.map(x=>String(x??"").trim()).filter(Boolean)
      : [entry?.player1,entry?.player2].map(x=>String(x??"").trim()).filter(Boolean);
    const normalized={...entry, id:String(entry?.id||id("teamPoolEntry")), number:Number(entry?.number)||index+1, name:String(entry?.name||`Team ${index+1}`), playerNames:names};
    if(names.length)normalized.player1=names[0]||"";
    if(names.length>1)normalized.player2=names[1]||"";
    return normalized;
  });
  if(migrated.settings.teamPoolDistributionComplete){
    migrated.settings.teamPoolLotteryInputSignature=JSON.stringify({
      mode:String(migrated.settings.mode||"doubles"),
      teams:migrated.settings.teamPoolEntries.map(entry=>({
        id:String(entry.id||""),
        playerNames:entry.playerNames.map(name=>String(name).trim())
      })),
      groups:(migrated.groups||[]).map(group=>({id:String(group.id||""),name:String(group.name||"")}))
    });
  }
  if(!Array.isArray(migrated.settings.teamPoolNames))migrated.settings.teamPoolNames=[];
  if(!Array.isArray(migrated.settings.teamPoolCommittedIds))migrated.settings.teamPoolCommittedIds=[];
  if(migrated.settings.teamPoolDistributionComplete===undefined)migrated.settings.teamPoolDistributionComplete=false;
  if(migrated.settings.teamPoolLotteryInputSignature===undefined)migrated.settings.teamPoolLotteryInputSignature='';
  if(migrated.settings.playerPoolBuildInputSignature===undefined)migrated.settings.playerPoolBuildInputSignature='';
  if(migrated.settings.teamPoolDistributionComplete && !migrated.settings.teamPoolLotteryInputSignature){
    migrated.settings.teamPoolLotteryInputSignature=JSON.stringify({
      teams:(migrated.settings.teamPoolEntries||[]).map(entry=>({
        id:String(entry.id||''),player1:String(entry.player1||'').trim(),player2:String(entry.player2||'').trim()
      })),
      groups:(migrated.groups||[]).map(group=>({
        id:String(group.id||''),name:String(group.name||''),teamCount:Number(group.teamCount)||0
      }))
    });
  }
  migrated.schemaVersion=3;
  return migrated;
}

function loadLocal(){
  const raw=window.BADMINTON_LOCAL?.read();
  if(!raw) return;
  try{
    const parsed=JSON.parse(raw);
    masterTournament=normalizeMasterRecord(parsed);
    const active=getActiveCategoryRecord();
    tournament=migrateTournamentData(active.data);
    tournament.clubName=masterTournament.clubName||"";
    tournament.settings=tournament.settings||{};
    tournament.settings.categories=[{id:String(active.id),name:String(active.name||"Internal").trim()||"Internal"}];
    syncThirdPlacePlayoffFromMainKnockout();
    saveActiveCategoryToMaster();
    window.BADMINTON_LOCAL?.write(JSON.stringify(masterTournament));
  }catch(e){
    console.error(e);
    showMessage("Saved tournament data could not be loaded.","warning");
  }
}



