/* ================================================================
   BADMINTON APP — STORAGE / CLOUD
   V6.0.0 — Club + Category persistence model
   Cloud is authoritative whenever online. LocalStorage is offline-only
   recovery/cache and is never uploaded merely because it is newer locally.
   ================================================================ */

window.BADMINTON_CLOUD_CONFIG = {
  url: "https://tumqpsbwelmwawbkqtjh.supabase.co",
  publishableKey: "sb_publishable_CcmUtzpRMlCqEY8o5yXdGQ_7Otmu4t4"
};

window.BADMINTON_CLOUD_CONFIG=window.BADMINTON_CLOUD_CONFIG||{url:"",publishableKey:""};
window.BADMINTON_CLOUD={
  client:null,session:null,profile:null,clubId:null,cloudVersion:0,cloudHydrated:false,appReady:false,syncBusy:false,pendingSnapshot:null,saveTimer:null,
  configured(){const c=window.BADMINTON_CLOUD_CONFIG||{};return Boolean(c.url&&c.publishableKey&&window.supabase);},
  message(t){const e=document.getElementById('cloudAuthMessage');if(e)e.textContent=t||'';},
  gate(v){document.getElementById('cloudAuthGate')?.classList.toggle('hidden',!v);},
  status(t){const e=document.getElementById('cloudSyncStatus');if(e)e.textContent=t||'';window.BADMINTON_AUTH?.syncAppStatus?.();},
  profileCacheKey(userId){return 'badmintonTournamentManager.profile.v1.'+String(userId||'');},
  profileCacheRead(userId){try{return JSON.parse(localStorage.getItem(this.profileCacheKey(userId))||'null');}catch{return null;}},
  profileCacheWrite(profile){try{if(profile?.id)localStorage.setItem(this.profileCacheKey(profile.id),JSON.stringify(profile));}catch{}},
  loadLocalFallback(){try{if(typeof window.loadLocal==='function')window.loadLocal();if(typeof window.renderAll==='function')window.renderAll();}catch(e){console.warn('Offline local fallback failed:',e);}},
  async init(){
    if(!this.configured()){this.gate(false);return;}
    this.client=window.supabase.createClient(window.BADMINTON_CLOUD_CONFIG.url,window.BADMINTON_CLOUD_CONFIG.publishableKey,{auth:{autoRefreshToken:true,persistSession:true,detectSessionInUrl:true}});
    window.addEventListener('online',()=>{this.status('Internet available — loading cloud data…');if(this.appReady&&this.profile?.approval_status==='approved')this.completeCloudStartup().catch(e=>this.status('Cloud load failed: '+e.message));});
    window.addEventListener('offline',()=>{this.status('Offline — local data mode');});
    this.gate(false);
    if(window.BADMINTON_AUTH?.init) await window.BADMINTON_AUTH.init();
  },
  async prepareCloudRecord(){
    const uid=this.session?.user?.id;if(!uid)throw new Error('Cloud session is not available.');
    let r=await this.client.from('clubs').select('id,name,shared_settings,version').eq('owner_id',uid).order('created_at',{ascending:true}).limit(1).maybeSingle();
    if(r.error)throw r.error;
    let club=r.data;
    if(!club){
      const requestedName=String(this.profile?.club_name||'Your club name').trim()||'Your club name';
      r=await this.client.from('clubs').insert({owner_id:uid,name:requestedName,shared_settings:{},version:1}).select('id,name,shared_settings,version').single();
      if(r.error)throw r.error;club=r.data;
    }
    this.clubId=club.id;
    const member=await this.client.from('club_members').select('club_id').eq('club_id',this.clubId).eq('user_id',uid).maybeSingle();
    if(member.error)throw member.error;
    if(!member.data){const addMember=await this.client.from('club_members').insert({club_id:this.clubId,user_id:uid,role:'owner'});if(addMember.error&&addMember.error.code!=='23505')throw addMember.error;}
    this.cloudVersion=Number(club.version||1);
    let cats=await this.client.from('categories').select('id,category_key,name,data,settings,sort_order').eq('club_id',this.clubId).order('sort_order',{ascending:true}).order('created_at',{ascending:true});
    if(cats.error)throw cats.error;
    if(!cats.data?.length){
      const fresh=blankTournament();
      const categoryId=id('category');
      const categoryName='Internal';
      fresh.clubName=String(club.name||'');
      fresh.settings=fresh.settings||{};
      fresh.settings.categories=[{id:categoryId,name:categoryName}];
      const ins=await this.client.from('categories').insert({id:crypto.randomUUID(),club_id:this.clubId,category_key:categoryId,name:categoryName,settings:fresh.settings,data:fresh,sort_order:0}).select('id,category_key,name,data,settings,sort_order').single();
      if(ins.error)throw ins.error;
      cats={data:[ins.data],error:null};
    }
    this.cloudCategories=cats.data||[];
    this.cloudClub=club;
    return {club,categories:this.cloudCategories};
  },
  buildSnapshot(club,categories){
    const name=String(club?.name||'').trim();
    const shared=club?.shared_settings&&typeof club.shared_settings==='object'?club.shared_settings:{};
    const list=(categories||[]).map((c,index)=>{
      const data=(c?.data&&typeof c.data==='object'&&!Array.isArray(c.data))?JSON.parse(JSON.stringify(c.data)):blankTournament();
      const cid=String(c.category_key||c.id||id('category'));
      const cname=String(c.name||`Category ${index+1}`).trim()||`Category ${index+1}`;
      data.clubName=name;
      if(shared.date!==undefined)data.date=String(shared.date||'');
      data.settings=data.settings||{};
      data.settings.categories=[{id:cid,name:cname}];
      return {id:cid,name:cname,data};
    });
    const master={masterSchemaVersion:MASTER_SCHEMA_VERSION,type:'badmintonTournamentManagerMaster',clubName:name,date:String(shared.date||list[0]?.data?.date||''),activeCategoryId:String(list[0]?.id||''),categories:list};
    return normalizeMasterRecord(master);
  },
  async loadRemoteIntoApp(){
    if(!this.clubId)return {status:'idle'};
    const clubR=await this.client.from('clubs').select('id,name,shared_settings,version,updated_at').eq('id',this.clubId).single();
    if(clubR.error)throw clubR.error;
    const catsR=await this.client.from('categories').select('id,category_key,name,data,settings,sort_order,updated_at').eq('club_id',this.clubId).order('sort_order',{ascending:true}).order('created_at',{ascending:true});
    if(catsR.error)throw catsR.error;
    if(!catsR.data?.length){await this.prepareCloudRecord();return this.loadRemoteIntoApp();}
    const snapshot=this.buildSnapshot(clubR.data,catsR.data);
    this.cloudVersion=Number(clubR.data.version||1);
    window.BADMINTON_CLOUD.applySnapshot(snapshot);
    window.BADMINTON_LOCAL?.write(JSON.stringify(snapshot));
    this.cloudHydrated=true;
    this.status('Cloud synced');
    this.gate(false);
    if(window.renderAll)window.renderAll();
    return {status:'loaded',version:this.cloudVersion};
  },
  async saveSnapshot(snapshot){
    if(!this.cloudHydrated||!this.clubId||!this.session?.user?.id)return {status:'cloud-not-loaded'};
    const categories=(snapshot?.categories||[]).map((c,index)=>({id:String(c.id||id('category')),name:String(c.name||`Category ${index+1}`).trim()||`Category ${index+1}`,settings:c.data?.settings||{},data:c.data||{},sort_order:index}));
    const shared={date:String(snapshot?.date||'')};
    const r=await this.client.rpc('save_club_snapshot',{p_club_id:this.clubId,p_name:String(snapshot?.clubName||'').trim()||'Your club name',p_shared_settings:shared,p_categories:categories});
    if(r.error)throw r.error;
    const row=Array.isArray(r.data)?r.data[0]:r.data;
    this.cloudVersion=Number(row?.version||this.cloudVersion+1);
    window.BADMINTON_LOCAL?.write(JSON.stringify(snapshot));
    return {status:'synced',version:this.cloudVersion};
  },
  async queueSave(snapshot){
    if(!this.configured()||!this.client||!this.session||this.profile?.approval_status!=='approved')return {status:'local-only'};
    if(!navigator.onLine)return {status:'offline'};
    if(!this.cloudHydrated)return {status:'cloud-not-loaded'};
    if(this.syncBusy){this.pendingSnapshot=JSON.parse(JSON.stringify(snapshot));return {status:'pending'};}
    this.syncBusy=true;this.status('Saving to cloud…');
    try{
      const result=await this.saveSnapshot(snapshot);
      this.status('Cloud synced');
      return result;
    }catch(e){
      this.status('Cloud save failed — data remains in memory.');
      return {status:'cloud-error',error:e};
    }finally{
      this.syncBusy=false;
      const pending=this.pendingSnapshot;this.pendingSnapshot=null;
      if(pending&&navigator.onLine&&this.cloudHydrated)this.queueSave(pending).catch(()=>{});
    }
  },
  async completeCloudStartup(){
    if(!this.appReady||this.profile?.approval_status!=='approved')return {status:'not-ready'};
    if(!navigator.onLine){this.loadLocalFallback();return {status:'offline'};}
    try{return await this.loadRemoteIntoApp();}
    catch(e){this.status('Cloud load failed — switching to local offline data.');this.loadLocalFallback();return {status:'offline-fallback',error:e};}
  },
  finishAppStartup(){
    this.appReady=true;
    if(this.profile?.approval_status==='approved')this.completeCloudStartup().catch(e=>this.status('Cloud startup failed: '+e.message));
  }
};
window.BADMINTON_CLOUD.applySnapshot=s=>{if(typeof window.applyCloudSnapshotInternal==='function')window.applyCloudSnapshotInternal(s);};

/* ====================== local.js ====================== */
(function(){
  "use strict";
  const STORAGE_KEY='badmintonTournamentManager.v6.offline';
  function read(){try{return localStorage.getItem(STORAGE_KEY);}catch{return null;}}
  function write(value){try{localStorage.setItem(STORAGE_KEY,String(value));return true;}catch(e){console.warn('Local storage write failed:',e);return false;}}
  function remove(){try{localStorage.removeItem(STORAGE_KEY);return true;}catch{return false;}}
  window.BADMINTON_LOCAL=Object.freeze({key:STORAGE_KEY,read,write,remove});
})();

function saveLocal(silent=false){
  syncSettings();
  clearCalculationCache();
  if(typeof calculateAndStoreGroupGlobalMetrics==='function')calculateAndStoreGroupGlobalMetrics();
  if(typeof calculateTournamentRanking==='function')calculateTournamentRanking();
  saveActiveCategoryToMaster();
  const snapshot=deepClone(masterTournament||tournament);
  const cloud=window.BADMINTON_CLOUD;
  const online=Boolean(navigator.onLine&&cloud?.client&&cloud?.session&&cloud?.profile?.approval_status==='approved');
  if(online){
    if(silent){
      clearTimeout(cloud.saveTimer);
      cloud.saveTimer=setTimeout(()=>cloud.queueSave(snapshot).catch(()=>{}),300);
      return;
    }
    Promise.resolve(cloud.queueSave(snapshot)).then(result=>{
      if(silent)return;
      const status=result?.status;
      if(status==='synced')showMessage('Tournament saved and synced to cloud.','success');
      else if(status==='cloud-not-loaded')showMessage('Cloud data is still loading. Please save again after sync completes.','warning');
      else if(status==='cloud-error')showMessage('Cloud save failed. Nothing was overwritten locally.','warning');
      else if(status==='pending')showMessage('Cloud save already in progress.','warning');
      else showMessage('Cloud save is not ready.','warning');
    });
    return;
  }
  const localSaved=window.BADMINTON_LOCAL?.write(JSON.stringify(snapshot))!==false;
  if(!silent)showMessage(localSaved?'Saved locally for offline use.':'Local save failed.','warning');
}

function syncSettings(){
  tournament.clubName=$('clubName').value.trim();
  tournament.date=$('tournamentDate').value;
  if(masterTournament)masterTournament.date=tournament.date;
  syncCategorySettingsFromUI();
  if($('tournamentMode')){
    const mode=$('tournamentMode').value;
    tournament.settings.mode=['doubles','singles','multiplayer'].includes(mode)?mode:'doubles';
  }else if(!['doubles','singles','multiplayer'].includes(tournament.settings.mode))tournament.settings.mode='doubles';
  const activeFormat=modeToTeamFormat(tournament.settings.mode);
  tournament.settings.defaultFormat=activeFormat;
  tournament.settings.entryFormat=activeFormat;
  tournament.settings.allowedFormats=[activeFormat];
  tournament.settings.defaultQualifiers=Math.max(0,Number($('defaultQualifiers')?.value??tournament.settings.defaultQualifiers??2)||0);
  const nextBestOf=Math.max(1,Number($('bestOf').value)||1);
  const previousBestOf=Math.max(1,Number(tournament.settings.bestOf)||1);
  if(nextBestOf!==previousBestOf&&typeof markLegacyMatchFormatsBeforeDefaultChange==='function')markLegacyMatchFormatsBeforeDefaultChange(previousBestOf);
  tournament.settings.bestOf=nextBestOf;
  tournament.settings.pointsTarget=Math.max(1,Number($('pointsTarget').value)||21);
}

function initializeBlankCloudFirstState(){
  try{
    const fresh=blankTournament();
    masterTournament=buildMasterFromLegacy(fresh);
    tournament=migrateTournamentData(masterTournament.categories[0].data);
  }catch(e){console.warn('Blank startup state failed:',e);}
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
  if(!raw)return;
  try{
    const parsed=JSON.parse(raw);
    masterTournament=normalizeMasterRecord(parsed);
    const active=getActiveCategoryRecord();
    tournament=migrateTournamentData(active.data);
    tournament.clubName=masterTournament.clubName||'';
    tournament.date=masterTournament.date||tournament.date||'';
    tournament.settings=tournament.settings||{};
    tournament.settings.categories=[{id:String(active.id),name:String(active.name||'Internal').trim()||'Internal'}];
    syncThirdPlacePlayoffFromMainKnockout();
  }catch(e){console.error(e);showMessage('Saved offline tournament data could not be loaded.','warning');}
}
