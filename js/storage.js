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
  publishableKey: "sb_publishable_CcmUtzpRMlCqEY8o5yXdGQ_7Otmu4t4",
  categoryScopedPersistence: true
};

/* ====================== cloud.js ====================== */
window.BADMINTON_CLOUD_CONFIG=window.BADMINTON_CLOUD_CONFIG||{url:"",publishableKey:""};
window.BADMINTON_CLOUD={
 client:null,session:null,profile:null,tournamentId:null,clubId:null,saveTimer:null,appReady:false,cloudHydrated:false,pageSessionId:(globalThis.crypto?.randomUUID?.()||String(Date.now())+'-'+Math.random()),cloudVersion:0,cloudBaseSnapshot:null,syncBusy:false,syncConflict:false,categoryQueue:null,categoryRevisions:{},categorySharedData:{},categorySaveWaiters:[],
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
   localStorage.setItem(this.queueKey,JSON.stringify({snapshot,baseSnapshot:this.cloudBaseSnapshot?JSON.parse(JSON.stringify(this.cloudBaseSnapshot)):null,baseVersion:Number(baseVersion||0),userId:this.session?.user?.id||null,tournamentId:this.tournamentId||null,queuedAt:Date.now(),queueId:(globalThis.crypto?.randomUUID?.()||String(Date.now())+"-"+Math.random()),pageSessionId:this.pageSessionId,requiresReview:!this.cloudHydrated}));
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
 scheduleRetry(){
  clearTimeout(this.retryTimer);
  if(!this.queueRead()||!navigator.onLine)return;
  const delay=Math.min(60000,Math.max(2000,2000*Math.pow(2,Math.min(this.retryAttempt++,5))));
  this.retryTimer=setTimeout(()=>this.syncPending().catch(()=>{}),delay);
 },
 async init(){
  if(!this.configured()){this.gate(false);return;}
  this.client=window.supabase.createClient(window.BADMINTON_CLOUD_CONFIG.url,window.BADMINTON_CLOUD_CONFIG.publishableKey,{auth:{autoRefreshToken:true,persistSession:true,detectSessionInUrl:true}});
  window.addEventListener('online',()=>{this.retryAttempt=0;this.resumeCloudSync().catch(()=>{});});
  window.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&navigator.onLine)this.resumeCloudSync().catch(()=>{});});
  window.addEventListener('focus',()=>{if(navigator.onLine)this.resumeCloudSync().catch(()=>{});});
  this.gate(false);
  if(window.BADMINTON_AUTH?.init) await window.BADMINTON_AUTH.init();
 },
 async resumeCloudSync(){
  if(!this.session||this.profile?.approval_status!=='approved')return {status:'not-ready'};
  if(this.categoryModeEnabled()&&this.appReady&&(!this.clubId||!this.cloudHydrated)){
   if(!this.clubId)await this.prepareCloudRecord();
   return this.completeCloudStartup();
  }
  return this.syncPending();
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
  if(!t){r=await this.client.rpc('create_initial_tournament',{p_club_id:this.clubId});if(r.error)throw r.error;t=Array.isArray(r.data)?r.data[0]:r.data;if(!t?.id)throw new Error('Initial tournament could not be created.');}
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
 categoryModeEnabled(){return Boolean(window.BADMINTON_CLOUD_CONFIG?.categoryScopedPersistence&&window.BADMINTON_CATEGORY_PERSISTENCE&&window.BADMINTON_CATEGORY_SYNC_QUEUE);},
 categoryUserStorageKey(kind){
  const uid=String(this.session?.user?.id||'').replace(/[^a-zA-Z0-9_-]/g,'_');
  return uid?`badmintonTournamentManager.${kind}.v1.${uid}`:null;
 },
 readCategoryBaseline(){try{const key=this.categoryUserStorageKey('categoryBaseline');return key?JSON.parse(localStorage.getItem(key)||'null'):null;}catch{return null;}},
 writeCategoryBaseline(master){try{const key=this.categoryUserStorageKey('categoryBaseline');if(key&&master)localStorage.setItem(key,JSON.stringify(master));}catch(e){console.warn('Category cloud baseline could not be stored:',e);}},
 readCategoryBootstrapQueue(){try{const key=this.categoryUserStorageKey('categoryBootstrapQueue');return key?JSON.parse(localStorage.getItem(key)||'null'):null;}catch{return null;}},
 writeCategoryBootstrapQueue(entry){try{const key=this.categoryUserStorageKey('categoryBootstrapQueue');if(!key||!entry)return false;localStorage.setItem(key,JSON.stringify(entry));return true;}catch(e){console.warn('Offline category recovery record could not be stored:',e);return false;}},
 clearCategoryBootstrapQueue(){try{const key=this.categoryUserStorageKey('categoryBootstrapQueue');if(key)localStorage.removeItem(key);}catch{}},
 ensureCategoryQueue(){
  if(!this.categoryQueue){
   const uid=String(this.session?.user?.id||'user').replace(/[^a-zA-Z0-9_-]/g,'_');
   const cid=String(this.clubId||'club').replace(/[^a-zA-Z0-9_-]/g,'_');
   this.categoryQueue=new window.BADMINTON_CATEGORY_SYNC_QUEUE({adapter:window.BADMINTON_CATEGORY_PERSISTENCE,client:this.client,clubId:this.clubId,storage:localStorage,key:`badmintonTournamentManager.categoryQueue.v1.${uid}.${cid}`});
  }
  return this.categoryQueue;
 },
 scheduleCategoryRetry(){
  clearTimeout(this.retryTimer);
  if(!this.categoryQueue?.pendingCount()||!navigator.onLine)return;
  const delay=Math.min(60000,Math.max(2000,2000*Math.pow(2,Math.min(this.retryAttempt++,5))));
  this.retryTimer=setTimeout(()=>this.flushCategoryQueue().catch(()=>{}),delay);
 },
 async loadCategoryScopedIntoApp(){
  if(!this.clubId)return {status:'idle'};
  const adapter=window.BADMINTON_CATEGORY_PERSISTENCE;
  let loaded=await adapter.loadMaster(this.client,this.clubId,masterTournament?.activeCategoryId);
  this.categorySharedData={...(loaded.sharedData||{})};
  if(!loaded.master.categories.length){
   const legacyResult=await this.client.from('tournaments').select('data,version').eq('id',this.tournamentId).single();
   if(legacyResult.error)throw legacyResult.error;
   let seed=null;const legacy=legacyResult.data?.data;
   if(legacy&&typeof legacy==='object'&&Object.keys(legacy).length){
    if(legacy.type==='badmintonTournamentManagerMaster'&&Array.isArray(legacy.categories)&&legacy.categories.length)seed=legacy;
    else if(typeof window.applyCloudSnapshotInternal==='function'){
     window.BADMINTON_CLOUD.applySnapshot(legacy);
     if(typeof saveActiveCategoryToMaster==='function')saveActiveCategoryToMaster();
     seed=masterTournament;
    }
   }
   // Never replace a non-empty but unrecognized legacy cloud snapshot with
   // this browser's local copy during first-time migration. That could silently
   // overwrite valid cloud data with stale local data. Local seeding is allowed
   // only when the legacy cloud snapshot is genuinely empty.
   const legacyIsEmpty=!legacy||typeof legacy!=='object'||Array.isArray(legacy)||Object.keys(legacy).length===0;
   if(!seed&&legacyIsEmpty&&masterTournament?.categories?.length)seed=masterTournament;
   if(!seed&&!legacyIsEmpty)throw new Error('The legacy cloud snapshot is non-empty but is not a supported master-category snapshot. No migration was performed; existing cloud and local data have been preserved.');
   if(seed?.categories?.length){
    await adapter.replaceMaster(this.client,{clubId:this.clubId,master:seed,sharedData:{...(loaded.sharedData||{}),date:String(seed.date||''),categoryPersistenceVersion:1}});
    loaded=await adapter.loadMaster(this.client,this.clubId,seed.activeCategoryId);
   this.categorySharedData={...(loaded.sharedData||{})};
   }
  }
  const bootstrap=this.readCategoryBootstrapQueue();
  const queue=this.ensureCategoryQueue();
  const explicitReplacementPending=Boolean(bootstrap?.replaceAll||queue.read().some(op=>op.type==='master'));
  if(loaded.master.categories.length&&Number(loaded.sharedData?.categoryPersistenceVersion)!==1&&!explicitReplacementPending){
   throw new Error('Category storage is present but has no completed-migration marker. The legacy tournament data has been preserved; refusing to load a potentially incomplete category set.');
  }
  queue.revisions={...(loaded.revisions||{})};this.categoryRevisions={...(loaded.revisions||{})};
  if(bootstrap?.snapshot&&Array.isArray(bootstrap.snapshot.categories)){
   if(bootstrap.replaceAll){
    queue.enqueueMasterReplacement(bootstrap.snapshot,{sharedData:{...this.categorySharedData,date:String(bootstrap.snapshot.date||''),categoryPersistenceVersion:1,allowEmptyOverwrite:Boolean(bootstrap.allowEmptyOverwrite),allowCategoryRemoval:Boolean(bootstrap.allowCategoryRemoval)}});
    this.clearCategoryBootstrapQueue();
   }else if(bootstrap.baseSnapshot&&Array.isArray(bootstrap.baseSnapshot.categories)){
    // Reconcile only categories changed locally since the last known cloud
    // baseline. Cloud-only changes remain untouched; conflicting edits to the
    // same category use the single-user policy: local wins.
    const diff=adapter.diffMasterAgainstBaseline(bootstrap.snapshot,bootstrap.baseSnapshot);
    if(diff.clubChanged)queue.enqueueClubMetadata({clubName:bootstrap.snapshot.clubName,sharedData:{...this.categorySharedData,date:String(bootstrap.snapshot.date||''),categoryPersistenceVersion:1}});
    diff.changedCategories.forEach(item=>queue.enqueueCategory(item.category,{expectedRevision:Number(queue.revisions[String(item.category.id)]||0),sortOrder:item.sortOrder}));
    this.clearCategoryBootstrapQueue();
   }else{
    // Without a trustworthy baseline, differences alone cannot prove which
    // copy is newer. Keep the local recovery record and stop automatic sync;
    // never silently discard local edits or overwrite cloud data.
    const localDiff=adapter.diffMasterAgainstBaseline(bootstrap.snapshot,loaded.master);
    if(!localDiff.clubChanged&&!localDiff.changedCategories.length){
     this.clearCategoryBootstrapQueue();
    }else{
     this.status('Local recovery data needs review: no saved cloud baseline exists. Cloud and local copies have been preserved. Export a local backup before continuing.');
     throw new Error('Local recovery data has no trustworthy baseline. Neither copy was overwritten; the local recovery record has been preserved.');
    }
   }
  }
  if(queue.pendingCount()){
   const sync=await queue.flush();
   if(sync.status!=='synced'){
    this.status('Category changes saved locally; cloud sync pending.');
    this.scheduleCategoryRetry();
    return {status:'pending',error:sync.error};
   }
   loaded=await adapter.loadMaster(this.client,this.clubId,masterTournament?.activeCategoryId);
   this.categorySharedData={...(loaded.sharedData||{})};
   if(loaded.master.categories.length&&Number(loaded.sharedData?.categoryPersistenceVersion)!==1)throw new Error('Category migration marker is missing after sync; local data has been preserved.');
   queue.revisions={...(loaded.revisions||{})};this.categoryRevisions={...(loaded.revisions||{})};
  }
  if(!loaded.master.categories.length){this.status('Cloud has no category data yet; local data preserved.');return {status:'empty-cloud'};}
  this.cloudBaseSnapshot=JSON.parse(JSON.stringify(loaded.master));
  this.writeCategoryBaseline(loaded.master);
  this.cloudHydrated=true;this.syncConflict=false;
  this.applySnapshot(loaded.master);
  this.status('Cloud synced — categories loaded');this.gate(false);
  if(window.renderAll)window.renderAll();
  return {status:'loaded',categoryCount:loaded.master.categories.length};
 },
 async queueCategoryScopedSave(snapshot,options={}){
  if(!this.configured()||!this.client||!this.session||this.profile?.approval_status!=='approved')return {status:'local-only'};
  const master=snapshot&&Array.isArray(snapshot.categories)?snapshot:masterTournament;
  if(!master||!Array.isArray(master.categories)||!master.categories.length)return {status:'local-only'};
  if(!this.clubId){
   const previous=this.readCategoryBootstrapQueue();
   const baseline=previous?.baseSnapshot||this.readCategoryBaseline();
   const stored=this.writeCategoryBootstrapQueue({snapshot:JSON.parse(JSON.stringify(master)),baseSnapshot:baseline?JSON.parse(JSON.stringify(baseline)):null,replaceAll:Boolean(options?.replaceAll||previous?.replaceAll),allowEmptyOverwrite:Boolean(options?.allowEmptyOverwrite||previous?.allowEmptyOverwrite),allowCategoryRemoval:Boolean(options?.allowCategoryRemoval||previous?.allowCategoryRemoval),queuedAt:Date.now()});
   if(!stored){this.status('Local data saved, but offline cloud queue could not be stored. Export a backup.');return {status:'queue-failed'};}
   this.status('Saved on this device; cloud setup pending.');
   return {status:'cloud-not-loaded'};
  }
  const queue=this.ensureCategoryQueue();
  const activeId=String(master?.activeCategoryId||'');
  const category=(master?.categories||[]).find(c=>String(c.id)===activeId);
  if(!category)return {status:'pending',error:'Active category is missing from the master snapshot.'};
  try{
   if(options?.replaceAll){
    queue.enqueueMasterReplacement(master,{sharedData:{...this.categorySharedData,date:String(master.date||''),categoryPersistenceVersion:1,allowEmptyOverwrite:Boolean(options?.allowEmptyOverwrite),allowCategoryRemoval:Boolean(options?.allowCategoryRemoval)}});
   }else{
    queue.enqueueClubMetadata({clubName:master.clubName,sharedData:{...this.categorySharedData,date:String(master.date||''),categoryPersistenceVersion:1}});
    // A master snapshot can contain unsynced edits in more than the active
    // category (for example after a category switch or recovery). Reconcile it
    // against the last confirmed cloud baseline so an ordinary Save cannot
    // silently leave another locally changed category behind on this device.
    const baseline=this.cloudBaseSnapshot||this.readCategoryBaseline();
    const changed=baseline&&Array.isArray(baseline.categories)
      ?window.BADMINTON_CATEGORY_PERSISTENCE.diffMasterAgainstBaseline(master,baseline).changedCategories
      :[];
    const pendingById=new Map(changed.map(item=>[String(item.category.id),item]));
    // Always include the active category: Save is an explicit request to persist
    // its current in-memory state, even if normalization makes it compare equal.
    pendingById.set(activeId,{category,sortOrder:(master.categories||[]).findIndex(c=>String(c.id)===activeId)});
    for(const item of pendingById.values()){
     const id=String(item.category.id);
     queue.enqueueCategory(item.category,{expectedRevision:Number(queue.revisions[id]||this.categoryRevisions[id]||0),sortOrder:item.sortOrder});
    }
   }
  }catch(error){this.status('Local data saved, but cloud queue could not be stored. Export a backup.');return {status:'queue-failed',error:String(error?.message||error)};}
  this.status('Category save queued; syncing to cloud…');
  return new Promise(resolve=>{
   // Coalesce rapid autosaves without abandoning earlier callers (especially
   // the manual Save button) when a newer edit resets the debounce timer.
   this.categorySaveWaiters.push(resolve);
   clearTimeout(this.saveTimer);
   this.saveTimer=setTimeout(async()=>{
    this.saveTimer=null;
    const waiters=this.categorySaveWaiters.splice(0);
    let result;
    try{
     result=await this.flushCategoryQueue();
    }catch(error){
     const message=String(error?.message||error);
     this.status('Category changes saved locally; cloud sync pending: '+message);
     this.scheduleCategoryRetry();
     result={status:'pending',error:message};
    }
    waiters.forEach(resolveSave=>resolveSave(result));
   },300);
  });
 },
 async flushCategoryQueue(){
  if(!this.categoryModeEnabled()||!this.client||!this.session||this.profile?.approval_status!=='approved'||!this.clubId)return {status:'idle'};
  const queue=this.ensureCategoryQueue();
  if(!navigator.onLine){this.status('Offline — category changes saved locally; cloud retry pending.');return {status:'offline'};}
  const result=await queue.flush();
  this.categoryRevisions={...queue.revisions};
  if(result.status==='synced'){
   clearTimeout(this.retryTimer);this.retryAttempt=0;
   this.cloudHydrated=true;
   // Refresh the baseline only after the queue confirms all writes. This keeps
   // future diffs anchored to a full, confirmed cloud snapshot rather than an
   // older startup snapshot.
   try{
    const loaded=await window.BADMINTON_CATEGORY_PERSISTENCE.loadMaster(this.client,this.clubId,masterTournament?.activeCategoryId);
    this.cloudBaseSnapshot=JSON.parse(JSON.stringify(loaded.master));
    this.writeCategoryBaseline(loaded.master);
    this.categoryRevisions={...(loaded.revisions||{})};
    if(this.categoryQueue)this.categoryQueue.revisions={...(loaded.revisions||{})};
    this.categorySharedData={...(loaded.sharedData||{})};
   }catch(error){
    // The writes themselves are confirmed. If baseline refresh fails, retain
    // the previous baseline; the next save can safely retry reconciliation.
    console.warn('Cloud saved; category baseline refresh deferred:',error);
   }
   this.status('Cloud synced — category changes saved');
   return {status:'synced',saved:result.saved};
  }
  this.status('Category changes saved locally; cloud sync pending'+(result.error?': '+result.error:''));
  this.scheduleCategoryRetry();
  return {status:'pending',error:result.error};
 },
 async loadRemoteIntoApp(){
  if(!this.tournamentId)return {status:'idle'};
  if(this.categoryModeEnabled())return this.loadCategoryScopedIntoApp();
  // Pending local changes are resolved automatically by syncPending().
  // With no pending queue, the cloud is the authoritative startup snapshot.
  if(this.queueRead()){
   const pending=await this.syncPending();
   if(!['synced','clean','cloud-won'].includes(pending.status))return pending;
   if(pending.status==='cloud-won')return pending;
  }
  const r=await this.client.from('tournaments').select('data,version,updated_at').eq('id',this.tournamentId).single();if(r.error)throw r.error;
  this.cloudVersion=Number(r.data.version||1);if(r.data?.data&&Object.keys(r.data.data).length){this.cloudBaseSnapshot=JSON.parse(JSON.stringify(r.data.data));window.BADMINTON_CLOUD.applySnapshot(r.data.data);}this.cloudHydrated=true;this.syncConflict=false;this.status('Cloud synced');this.gate(false);if(window.renderAll)window.renderAll();
  return {status:'loaded',version:this.cloudVersion};
 },
 queueSave(snapshot,options={}){
  if(this.categoryModeEnabled())return this.queueCategoryScopedSave(snapshot,options);
  if(!this.configured()||!this.client||!this.session||this.profile?.approval_status!=='approved'||!this.tournamentId)return Promise.resolve({status:'local-only'});
  if(!this.cloudHydrated){this.queueWrite(snapshot,this.cloudVersion);if(options?.replaceAll)this.queueUpdate({replaceAll:true,requiresReview:false});this.status('Cloud not loaded — local changes kept; review required before upload.');return Promise.resolve({status:'cloud-not-loaded'});}
  clearTimeout(this.saveTimer);this.queueWrite(snapshot,this.cloudVersion);if(options?.replaceAll)this.queueUpdate({replaceAll:true,requiresReview:false});this.status('Sync pending…');
  return new Promise(resolve=>{this.saveTimer=setTimeout(async()=>{const r=await this.syncPending();resolve(r);},400);});
 },
 async syncPending(){
  if(this.categoryModeEnabled())return this.flushCategoryQueue();
  if(this.syncBusy||!this.client||!this.session||this.profile?.approval_status!=='approved'||!this.tournamentId)return {status:'idle'};
  const q=this.queueRead();if(!q)return {status:'clean'};if(!navigator.onLine){this.status('Offline — changes saved locally');return {status:'offline'};}
  const queueId=q.queueId||String(q.queuedAt||"");
  this.syncBusy=true;this.status('Syncing…');
  try{
   const remote=await this.client.from('tournaments').select('version,data').eq('id',this.tournamentId).single();if(remote.error)throw remote.error;
   // A save may have replaced the queue while the remote read was in flight.
   // Never resolve or clear the older queue over a newer local edit.
   const newestQueue=this.queueRead();
   if(newestQueue?.queueId!==queueId){
    if(newestQueue)this.scheduleRetry();
    return {status:newestQueue?'superseded':'clean'};
   }
   const remoteVersion=Number(remote.data.version||1),baseVersion=Number(q.baseVersion||0);
   const remoteSnapshot=remote.data.data;
   let uploadSnapshot=q.snapshot;
   const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
   const stable=value=>{
    if(value===undefined)return 'undefined';
    if(value===null||typeof value!=='object')return JSON.stringify(value);
    if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
    return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}';
   };
   const same=(a,b)=>stable(a)===stable(b);
   const applyCloudWins=()=>{
    this.cloudVersion=remoteVersion;
    this.cloudBaseSnapshot=clone(remoteSnapshot);
    this.queueClear();
    this.applySnapshot(remoteSnapshot);
    this.cloudHydrated=true;this.syncConflict=false;
    if(window.renderAll)window.renderAll();
    this.status('Cloud synced — latest cloud data loaded');
    return {status:'cloud-won',version:remoteVersion};
   };
   // A snapshot queued before cloud hydration has no trustworthy baseline.
   // Never let it overwrite an established cloud record, even if the revision
   // number happens to match.
   if((q.requiresReview||!q.baseSnapshot)&&!q.replaceAll)return applyCloudWins();
   if(remoteVersion!==baseVersion&&!q.replaceAll){
    // Reconcile whole-master snapshots by category. A local edit to category A
    // must not replace a newer cloud copy of category B with stale data.
    // For the same category changed on both sides, the pending local edit wins
    // automatically under the current single-user last-save-wins policy.
    const base=q.baseSnapshot,local=q.snapshot,remoteData=remoteSnapshot;
    if(!Array.isArray(base?.categories)||!Array.isArray(local?.categories)||!Array.isArray(remoteData?.categories))
      return applyCloudWins();
    const byId=list=>new Map(list.map(item=>[String(item?.id||''),item]));
    const bCats=byId(base.categories),lCats=byId(local.categories),rCats=byId(remoteData.categories);
    const ids=new Set([...bCats.keys(),...lCats.keys(),...rCats.keys()]);
    const mergedCats=[];
    for(const cid of ids){
     const b=bCats.get(cid),l=lCats.get(cid),r=rCats.get(cid);
     const localChanged=!same(l,b);
     const chosen=localChanged?l:r;
     if(chosen!==undefined)mergedCats.push(clone(chosen));
    }
    const merged=clone(remoteData);
    const keys=new Set([...Object.keys(base),...Object.keys(local),...Object.keys(remoteData)]);
    keys.delete('categories');keys.delete('activeCategoryId');
    for(const key of keys){
     if(!same(local[key],base[key])){
      if(local[key]===undefined)delete merged[key];else merged[key]=clone(local[key]);
     }
    }
    merged.categories=mergedCats;
    const activeLocal=String(local.activeCategoryId||'');
    const activeRemote=String(remoteData.activeCategoryId||'');
    merged.activeCategoryId=mergedCats.some(c=>String(c.id)===activeLocal)?activeLocal:
      (mergedCats.some(c=>String(c.id)===activeRemote)?activeRemote:String(mergedCats[0]?.id||''));
    if(same(merged,remoteData))return applyCloudWins();
    uploadSnapshot=merged;
    // Rebase the queued snapshot on the exact remote revision being merged.
    // If the conditional write loses another race, the next retry merges again.
    this.queueUpdate({snapshot:clone(uploadSnapshot),baseSnapshot:clone(remoteData),baseVersion:remoteVersion,requiresReview:false,attempts:0,lastError:null});
   }
   const next=remoteVersion+1;
   const w=await this.client.from('tournaments').update({data:uploadSnapshot,version:next,updated_by:this.session.user.id}).eq('id',this.tournamentId).eq('version',remoteVersion).select('version').single();
   if(w.error)throw w.error;
   this.cloudVersion=Number(w.data.version||next);this.cloudBaseSnapshot=JSON.parse(JSON.stringify(uploadSnapshot));this.syncConflict=false;
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
    this.queueUpdate({baseSnapshot:JSON.parse(JSON.stringify(uploadSnapshot)),baseVersion:this.cloudVersion,attempts:0,lastError:null});
   }
   this.status('Cloud synced; newer local changes pending…');
   this.scheduleRetry(0);
   return {status:'synced-with-pending',version:this.cloudVersion};
  }catch(e){const reason=String(e?.message||e||'Unknown cloud error').slice(0,140);console.warn('Cloud sync deferred:',e);this.queueUpdate({attempts:Number(this.queueRead()?.attempts||0)+1,lastError:reason});this.status(navigator.onLine?'Cloud sync failed — retrying: '+reason:'Offline — changes saved locally; cloud retry pending');this.scheduleRetry();return {status:'pending',error:e};}
  finally{this.syncBusy=false;}
 },
 async completeCloudStartup(){
  if(!this.appReady||this.profile?.approval_status!=='approved'||!this.tournamentId)return {status:'not-ready'};
  if(this.categoryModeEnabled())return this.loadRemoteIntoApp();
  const q=this.queueRead();
  if(q){
   const synced=await this.syncPending();
   if(!['synced','clean','cloud-won'].includes(synced.status)){this.gate(false);return synced;}
   if(synced.status==='cloud-won')return synced;
  }
  return this.loadRemoteIntoApp();
 },
 finishAppStartup(){this.appReady=true;if(this.profile?.approval_status==='approved')this.completeCloudStartup().catch(e=>{this.status('Cloud load failed — local data kept.');this.message('Cloud load failed: '+e.message);this.gate(false);});}
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

function saveLocal(silent=false,options={}){
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

  // Persist the complete master record immediately. A cloud queue is not a
  // successful cloud save, so the user-facing message must wait for the actual
  // sync result instead of claiming success before the network write completes.
  const localSaved=window.BADMINTON_LOCAL?.write(JSON.stringify(snapshot))!==false;
  const cloud=window.BADMINTON_CLOUD;
  if(!localSaved && !silent)showMessage("Local save failed. Check browser storage space or permissions.","warning");
  if(cloud?.queueSave){
    if(!silent && localSaved)showMessage("Saved on this device; syncing to cloud…");
    Promise.resolve(cloud.queueSave(snapshot,options)).then(result=>{
      if(silent)return;
      const status=result?.status||"pending";
      if(status==="synced")showMessage("Tournament saved and synced to cloud.","success");
      else if(status==="cloud-won")showMessage("Latest cloud copy loaded; this local copy was outdated.","warning");
      else if(status==="offline")showMessage("Saved on this device; offline. Cloud sync will retry.","warning");
      else if(status==="cloud-not-loaded")showMessage("Saved on this device; waiting for cloud data to load.","warning");
      else if(status==="queue-failed")showMessage("Saved locally, but cloud retry could not be queued. Export a backup and check browser storage space.","warning");
      else if(status==="local-only")showMessage("Saved on this device only; cloud sync is not ready.","warning");
      else if(status==="clean")showMessage("Tournament is already synced with the cloud.","success");
      else showMessage("Saved on this device; cloud sync has not completed and will retry.","warning");
    }).catch(err=>{
      console.warn("Cloud save deferred:",err);
      if(!silent)showMessage("Saved on this device; cloud sync failed and will retry.","warning");
    });
  }else if(!silent && localSaved){
    showMessage("Tournament saved on this device.");
  }
}

// Tournament settings remain editable after results exist so the admin can correct
// setup mistakes without locking the tournament to its original scoring configuration.
function syncSettings(){
  tournament.clubName=$("clubName").value.trim();
  tournament.date=$("tournamentDate").value;
  if(masterTournament)masterTournament.date=tournament.date;
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
  const nextBestOf=Math.max(1,Number($("bestOf").value)||1);
  const previousBestOf=Math.max(1,Number(tournament.settings.bestOf)||1);
  if(nextBestOf!==previousBestOf&&typeof markLegacyMatchFormatsBeforeDefaultChange==="function")
    markLegacyMatchFormatsBeforeDefaultChange(previousBestOf);
  tournament.settings.bestOf=nextBestOf;
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



