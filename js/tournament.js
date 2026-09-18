const APP_VERSION = '5.3.39';

"use strict";

/*
 APPLICATION ARCHITECTURE

 Authoritative state: teams, players, groups, fixtures and recorded results.
 Derived state: standings, qualification, tournament ranking and podium.
 Generated structures: group fixtures, Pre-Knockout, Main Knockout draw and
 3rd-place playoff. Generated structures carry a compact build signature so
 structural changes can be detected without silently rebuilding competition data.

 Rendering is split into broad synchronization (renderAll) and controlled
 downstream refresh flows. Result changes propagate through the dependency chain;
 structural rebuilds remain explicit operator actions.
*/

const $ = id => document.getElementById(id);

function showMessage(text, type="notice"){
  $("message").innerHTML = '<div class="' + type + '">' + escapeHtml(text) + '</div>';
  setTimeout(() => $("message").innerHTML="", 3500);
}


function escapeHtml(value){
  return String(value ?? "")
    .replaceAll("&","&amp;").replaceAll("<","&lt;")
    .replaceAll(">","&gt;").replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

/*
 GENERATED-STAGE VALIDITY

 Derived views never become stale; they recalculate from authoritative state.
 Only generated competition structures carry build state. Each build signature
 contains only the structural inputs that define that generated artifact.
*/
function addHistory(action, details=""){
  tournament.history.push({
    id:id("history"),
    timestamp:new Date().toISOString(),
    action,
    details
  });
}

function bindMergedFixtureScoreControls(){
  const group=$("fixtureGroupFilter");
  const resultGroup=$("resultGroupFilter");
  const resultFixture=$("resultFixtureFilter");
  if(!group||!resultGroup||!resultFixture||group.dataset.mergedBound==="1")return;
  group.dataset.mergedBound="1";

  const sync=()=>{
    resultGroup.value=group.value;
    renderResultFixtureFilter();
    const pending=[...resultFixture.options].find(o=>{
      const f=(tournament.fixtures||[]).find(x=>String(x.id)===String(o.value));
      return f && !isFixtureResultComplete(f);
    });
    if(pending)resultFixture.value=pending.value;
    else if(resultFixture.options.length)resultFixture.value=resultFixture.options[0].value;
    renderResultEditor();
  };
  group.addEventListener("change",sync);
  resultFixture.addEventListener("change",renderResultEditor);
  sync();
}


function inlineMatchScoreLabel(){
  const area=document.querySelector(".merged-match-score");
  const title=area?.querySelector(".merged-match-score-title");
  const editor=$("resultEditor");
  if(!area||!title||!editor)return;
  if(title.dataset.inlineDone==="1")return;
  title.dataset.inlineDone="1";
  const line=editor.querySelector(".result-match-line");
  if(line)line.parentNode.insertBefore(title,line);
}



/* CALCULATION LAYER — Raw metrics derived from authoritative completed group matches. */
const GLOBAL_METRIC_MULTIPLIER = 1000000;
/* PERFORMANCE ARCHITECTURE — runtime indexes, cached calculations and targeted Main Knockout updates */
const calculationCache={
  standings:new Map(),
  globalH2H:new Map(),
  indexes:null
};
function getCalculationIndexes(){
  if(calculationCache.indexes)return calculationCache.indexes;
  const fixtures=tournament.fixtures||[];
  const results=tournament.results||[];
  const teams=tournament.teams||[];
  const teamById=new Map(teams.map(t=>[String(t.id),t]));
  const fixtureById=new Map(fixtures.map(f=>[String(f.id),f]));
  const resultsByGroup=new Map();
  results.forEach(r=>{
    const fixture=fixtureById.get(String(r.fixtureId));
    if(!fixture)return;
    const gid=String(fixture.groupId);
    if(!resultsByGroup.has(gid))resultsByGroup.set(gid,[]);
    resultsByGroup.get(gid).push({result:r,fixture});
  });
  calculationCache.indexes={teamById,fixtureById,resultsByGroup};
  return calculationCache.indexes;
}
function clearCalculationCache(){
  calculationCache.standings.clear();
  calculationCache.globalH2H.clear();
  calculationCache.indexes=null;
}
function calculateAndStoreGroupGlobalMetrics(){
  const standingsByGroup=new Map();
  (tournament.teams||[]).forEach(team=>{
    const groupKey=String(team.groupId);
    if(!standingsByGroup.has(groupKey)){
      standingsByGroup.set(groupKey,typeof calculateGroupStandings==="function"
        ? calculateGroupStandings(team.groupId) : []);
    }
  });
  const rowsByTeam=new Map();
  standingsByGroup.forEach(rows=>rows.forEach(row=>{
    rowsByTeam.set(String(row.team?.id??row.teamId??row.id),row);
  }));

  (tournament.teams||[]).forEach(team=>{
    const row=rowsByTeam.get(String(team.id));
    if(!row)return;

    const wins=Number(row.wins)||0;
    const lostPoints=Number(row.lostScore??row.lostPoints??row.lost)||0;
    const h2hComponent=calculateGlobalH2HComponent(team.id);

    team.globalMetric=calculateGlobalMetric(wins,h2hComponent,lostPoints);
    team.globalMetricWins=wins;
    team.globalMetricH2H=h2hComponent;
    team.globalMetricLostPoints=lostPoints;
  });
}



// Tournament ranking consumes per-team metrics directly; no separate
// calculate-all wrapper is required by the active application.

/* CALCULATION LAYER — Tournament-wide ranking
   Scope: qualified teams only.
   Rules:
   1. Tournament wins — higher is better.
   2. Head-to-head wins within the same tournament-win cohort — higher is better.
   3. Tournament losing points — higher is better.
   4. Lottery — only when still exactly tied.
   Group rank is deliberately NOT used. */

function getQualifiedTeamSourceRecords(){
  const records=[];
  const seen=new Set();
  (tournament.groups||[]).forEach(group=>{
    calculateQualifications(group.id).filter(r=>r.qualifier).forEach(r=>{
      const teamId=String(r.team.id);
      if(seen.has(teamId))return;
      seen.add(teamId);
      records.push({
        teamId:r.team.id,
        groupId:group.id,
        groupLetter:String(group.name||"").replace(/^Group\s+/i,"").trim().charAt(0),
        groupRank:r.position
      });
    });
  });
  return records;
}

function renderTournamentRanking(){
  const host=document.getElementById("tournamentRanking");
  if(!host)return;

  const rows=calculateTournamentRanking();
  const directCount=rows.length;

  host.innerHTML=`
    <details class="card tournament-ranking-card">
      <summary><strong><span class="workspace-summary-icon" aria-hidden="true">🏆</span>Tournament Ranking</strong></summary>
      <div class="tournament-ranking-table">
        <div class="tournament-ranking-row tournament-ranking-head">
          <span>Rank</span>
          <span title="Source">From</span>
          <span>Players Name</span>
          <span>Points</span>
          <span title="Tie-break">TB</span>
        </div>
        ${rows.map(r=>{
          const source=r.groupLetter&&r.groupRank!=null
            ? `${r.groupLetter}${r.groupRank}` : "—";
          const players=typeof preliminaryTeamPlayers==="function"
            ? preliminaryTeamPlayers(r.team) : "";
          return `<div class="tournament-ranking-row">
            <span>${r.tournamentRank}.</span>
            <span class="tournament-source">${source}</span>
            <span class="participant-label">${players||"—"}</span>
            <span class="tournament-metric">${r.globalMetric}</span>
            <span>${r.tiebreakRequired?"Lottery":""}</span>
          </div>`;
        }).join("")}
      </div>
    </details>`;
}

function renderDownstreamFromGroupResult(){
  // Group stage is the authoritative source for everything below it.
  renderFixtures();
  renderResultEditor();
  renderStandings();
  renderQualification();
  renderPreliminaryRound();
  renderTournamentRanking();
  renderWorkspaceStatusIndicators();
  renderMainKnockoutAllocation();
  renderMainKnockoutBracket();
  renderKnockoutResultEditor(selectedKnockoutResultMatchType==="third-place"?"thirdPlace":selectedMainKnockoutMatchId);
  renderPodium();
  renderLandingDashboard();
}

function renderDownstreamFromPreliminaryResult(){
  // The Preliminary winner feeds a specific Main Knockout entry slot.
  renderPreliminaryRound();
  renderMainKnockoutAllocation();
  renderMainKnockoutBracket();
  renderKnockoutResultEditor(selectedKnockoutResultMatchType==="third-place"?"thirdPlace":selectedMainKnockoutMatchId);
  renderPodium();
  renderLandingDashboard();
}

function renderDownstreamFromKnockoutResult(context={}){
  // Main Knockout winners/losers feed later rounds and the 3rd-place playoff.
  refreshMainKnockoutBracketFromResult(context.matchId,context.changedMatchIds||[]);
  renderKnockoutResultEditor(selectedKnockoutResultMatchType==="third-place"?"thirdPlace":selectedMainKnockoutMatchId);
  renderPodium();
  renderLandingDashboard();
}

function renderDownstreamFromThirdPlaceResult(){
  // The 3rd-place playoff is a separate match entity, so its bracket row is
  // not covered by refreshMainKnockoutBracketFromResult(). Refresh that row
  // explicitly whenever its own result changes.
  const list=$("knockoutList");
  const thirdSection=list?.querySelector(".main-ko-third-place-round");
  if(thirdSection)thirdSection.outerHTML=renderThirdPlaceBracketSection();
  renderKnockoutResultEditor(selectedKnockoutResultMatchType==="third-place"?"thirdPlace":selectedMainKnockoutMatchId);
  bindKnockoutMatchSelection();
  renderPodium();
  renderLandingDashboard();
}

// Controlled UI refresh pipeline. Each flow explicitly follows the tournament
// dependency chain instead of hiding downstream work inside renderKnockout().
function refreshControlled(flow,context={}){
  switch(flow){
    case "group-result":
      renderDownstreamFromGroupResult();
      return;

    case "preliminary-result":
      renderDownstreamFromPreliminaryResult();
      return;

    case "knockout-result":
      renderDownstreamFromKnockoutResult(context);
      return;

    case "third-place-result":
      renderDownstreamFromThirdPlaceResult();
      return;

    case "team-change":
      // Teams are foundational state. Refresh the entry/group UI first, then
      // walk the complete competition dependency chain.
      renderGroups();
      renderGroupSelect();
      renderPlayerEntryFields();
      renderTeamList();
      renderDownstreamFromGroupResult();
      renderSummary();
      return;

    case "group-change":
      // Groups are foundational state. Existing fixtures and every stage below
      // them may change, so follow the complete chain.
      renderGroups();
      renderGroupSelect();
      renderTeamPool();
      renderTeamList();
      renderDownstreamFromGroupResult();
      renderSummary();
      return;

    case "settings-change":
      renderHeaderClubName();
      renderGroupSelect();
      renderPlayerEntryFields();
      renderGroups();
      renderDownstreamFromGroupResult();
      renderSummary();
      return;

    default:
      renderAll();
  }
}

function refreshAfterGroupResult(groupId){
  refreshControlled("group-result",{groupId});
}

function refreshAfterPreliminaryResult(){
  refreshControlled("preliminary-result");
}

function refreshAfterKnockoutResult(matchId,changedMatchIds=[]){
  refreshControlled("knockout-result",{matchId,changedMatchIds});
}

function refreshAfterThirdPlaceResult(){
  refreshControlled("third-place-result");
}

function renderPlayerPoolEntryAvailability(){
  const btn=$("openPlayerPoolBtn");
  const panel=$("playerPoolPanel");
  const disabled=tournament.settings?.mode==="singles";
  if(btn){
    btn.hidden=disabled;
    btn.disabled=disabled;
    btn.setAttribute("aria-hidden",disabled?"true":"false");
  }
  if(disabled && panel && !panel.hidden){
    switchEntryTab("teamPool");
  }
}

function renderAll(){
  clearCalculationCache();
  // renderAll is the central UI refresh pipeline. Normalize state before
  // controls are populated, then render each feature from authoritative state.
  renderPlayerPool();
  renderTeamPool();
  const fixturesCardOpen=$("fixturesCard")?.open ?? false;
  const knockoutCardOpen=$("knockoutCard")?.open ?? false;
  renderHeaderClubName();
  calculateAndStoreGroupGlobalMetrics();
  renderLandingDashboard();
  if(!Array.isArray(tournament.manualKnockoutTeams))tournament.manualKnockoutTeams=[];
  if(!Array.isArray(tournament.fixtures))tournament.fixtures=[];

  // Normalize only missing settings. These defaults are intentionally kept
  // here because older imported/local data may not contain newer settings.
  if(!["doubles","singles","multiplayer"].includes(tournament.settings.mode)){
    const legacy=String(tournament.settings.entryFormat||tournament.settings.defaultFormat||"doubles");
    tournament.settings.mode=legacy==="team"?"multiplayer":(["singles","doubles"].includes(legacy)?legacy:"doubles");
  }
  tournament.settings.defaultFormat=modeToTeamFormat(tournament.settings.mode);
  tournament.settings.entryFormat=tournament.settings.defaultFormat;
  tournament.settings.allowedFormats=[tournament.settings.defaultFormat];
  if(!tournament.settings.bestOf)tournament.settings.bestOf=1;
  if(!tournament.settings.pointsTarget)tournament.settings.pointsTarget=21;

  $("clubName").value=tournament.clubName||"";
  $("tournamentDate").value=tournament.date||"";
  renderCategories();
  if($("tournamentMode"))$("tournamentMode").value=tournament.settings.mode;
  renderPlayerPoolEntryAvailability();
  $("bestOf").value=String(tournament.settings?.bestOf ?? 1);
  $("pointsTarget").value=String(tournament.settings?.pointsTarget||21);
  if($("playerPoolCountSetting"))$("playerPoolCountSetting").value=String(Math.max(2,Math.min(52,Number(tournament.settings?.playerPoolCount)||2)));
  $("groupCount").value=tournament.groups.length||1;
  if($("defaultQualifiers"))$("defaultQualifiers").value=String(tournament.settings?.defaultQualifiers ?? 2);
  renderGroups();
  renderFixtures();
  renderResultEditor();
  renderStandings();
  renderQualification();
  renderKnockout();
  renderPodium();
  renderPrintFixturesStatus();
  renderGroupSelect();
  renderPlayerEntryFields();
  renderTeamList();
  renderSummary();
  bindMergedFixtureScoreControls();
  inlineMatchScoreLabel();
  renderPreliminaryRound();
  renderTournamentRanking();
  renderWorkspaceStatusIndicators();
  if($("fixturesCard"))$("fixturesCard").open=fixturesCardOpen;
  if($("knockoutCard"))$("knockoutCard").open=knockoutCardOpen;
}

function groupLabel(index){
  let n=index+1, s="";
  while(n>0){n--;s=String.fromCharCode(65+(n%26))+s;n=Math.floor(n/26);}
  return "Group "+s;
}



function normalizeCategories(){
  if(!masterTournament){
    if(!tournament.settings)tournament.settings={};
    if(!Array.isArray(tournament.settings.categories) || !tournament.settings.categories.length)
      tournament.settings.categories=[{id:id("category"),name:"Internal"}];
    return tournament.settings.categories;
  }
  if(!Array.isArray(masterTournament.categories) || !masterTournament.categories.length){
    const category={id:id("category"),name:"Internal"};
    masterTournament.categories=[makeBlankCategoryRecord(category.id,category.name)];
    masterTournament.activeCategoryId=category.id;
  }
  masterTournament.categories=masterTournament.categories.map((category,index)=>{
    const cid=String(category?.id||id("category"));
    const name=String(category?.name||((index===0)?"Internal":`Category ${index+1}`)).trim()||`Category ${index+1}`;
    category.id=cid; category.name=name;
    return category;
  });
  return masterTournament.categories;
}

function syncCategorySettingsFromUI(){
  const list=$("categoriesList");
  if(!list)return;
  const current=normalizeCategories();
  const inputs=[...list.querySelectorAll("[data-category-id]")];
  if(!inputs.length)return;
  const names=new Map(inputs.map(input=>[String(input.dataset.categoryId),input.value.trim()]));
  current.forEach(category=>{
    if(names.has(String(category.id))){
      category.name=names.get(String(category.id))||"Internal";
      if(category.data?.settings)category.data.settings.categories=[{id:String(category.id),name:category.name}];
    }
  });
  const active=getActiveCategoryRecord();
  if(active){
    tournament.settings=tournament.settings||{};
    tournament.settings.categories=[{id:String(active.id),name:String(active.name||"Internal").trim()||"Internal"}];
  }
}

function renderCategories(){
  const list=$("categoriesList");
  const countInput=$("categoryCount");
  if(!list)return;
  const categories=normalizeCategories();
  if(countInput)countInput.value=String(categories.length);
  list.innerHTML=categories.map((category,index)=>`
    <div class="settings-category-row">
      <strong>Category ${index+1}</strong>
      <input type="text" data-category-id="${escapeHtml(category.id)}" value="${escapeHtml(category.name)}" placeholder="Category name">
      <button class="btn btn-danger btn-small" type="button" onclick="removeCategory('${escapeHtml(category.id)}')" title="Remove category">×</button>
    </div>`).join("");
  list.querySelectorAll("[data-category-id]").forEach(input=>{
    input.addEventListener("change",()=>{
      const category=normalizeCategories().find(item=>String(item.id)===String(input.dataset.categoryId));
      if(!category)return;
      category.name=input.value.trim()||"Internal";
      input.value=category.name;
      if(category.data?.settings)category.data.settings.categories=[{id:String(category.id),name:category.name}];
      if(String(masterTournament?.activeCategoryId)===String(category.id))
        tournament.settings.categories=[{id:String(category.id),name:category.name}];
      saveLocal(true);
      renderAll();
    });
  });
}

function createCategories(){
  const input=$("categoryCount");
  const count=Math.max(1,Math.min(52,Number(input?.value)||1));
  syncCategorySettingsFromUI();
  const categories=normalizeCategories();
  while(categories.length<count){
    const index=categories.length;
    const category={id:id("category"),name:index===0?"Internal":`Category ${index+1}`};
    categories.push(makeBlankCategoryRecord(category.id,category.name));
  }
  if(categories.length>count){
    const removed=categories.slice(count);
    const hasData=removed.some(categoryHasCompetitionData);
    if(hasData && !confirm("Reducing the category count will permanently remove data from the removed categories. Continue?"))return;
    const activeId=String(masterTournament.activeCategoryId||"");
    const activeWillBeRemoved=removed.some(c=>String(c.id)===activeId);
    // Save the current subset before changing the master category list/pointer.
    syncSettings();
    clearCalculationCache();
    if(typeof calculateAndStoreGroupGlobalMetrics==="function")calculateAndStoreGroupGlobalMetrics();
    if(typeof calculateTournamentRanking==="function")calculateTournamentRanking();
    saveActiveCategoryToMaster();
    categories.length=count;
    masterTournament.categories=categories;
    if(activeWillBeRemoved)masterTournament.activeCategoryId=categories[0].id;
  }
  masterTournament.categories=categories;
  addHistory("Categories created",String(count));
  saveLocal(true);
  const active=getActiveCategoryRecord();
  tournament=migrateTournamentData(active.data);
  tournament.clubName=masterTournament.clubName||"";
  renderAll();
}

function removeCategory(categoryId){
  const categories=normalizeCategories();
  if(categories.length<=1)return;
  const target=categories.find(category=>String(category.id)===String(categoryId));
  if(!target)return;
  if(categoryHasCompetitionData(target) && !confirm(`Remove category "${target.name}" and all of its tournament data?`))return;
  const wasActive=String(masterTournament.activeCategoryId)===String(categoryId);
  if(wasActive){
    // Capture the current subset while the active pointer still references it.
    syncSettings();
    clearCalculationCache();
    if(typeof calculateAndStoreGroupGlobalMetrics==="function")calculateAndStoreGroupGlobalMetrics();
    if(typeof calculateTournamentRanking==="function")calculateTournamentRanking();
    saveActiveCategoryToMaster();
  }
  masterTournament.categories=categories.filter(category=>String(category.id)!==String(categoryId));
  if(wasActive)masterTournament.activeCategoryId=masterTournament.categories[0].id;
  addHistory("Category removed",target.name);
  window.BADMINTON_LOCAL?.write(JSON.stringify(masterTournament));
  if(wasActive){
    const active=getActiveCategoryRecord();
    tournament=migrateTournamentData(active.data);
    tournament.clubName=masterTournament.clubName||"";
  }
  renderAll();
}

function resizePlayerPoolCount(requested){
  const count=Math.max(2,Math.min(52,Number(requested)||2));
  const previous=Math.max(2,Math.min(52,Number(tournament.settings?.playerPoolCount)||2));
  if(count===previous){
    ensurePlayerPoolState(count);
    return false;
  }
  if(!Array.isArray(tournament.playerPoolPlayers))tournament.playerPoolPlayers=[];

  if(count<previous){
    const removedPools=tournament.playerPoolPlayers.slice(count);
    const removedEntries=removedPools.reduce((n,pool)=>n+(Array.isArray(pool)?pool.filter(entry=>String(entry?.name??entry??"").trim()).length:0),0);
    if(removedEntries && !confirm(
      `Reducing Player pools from ${previous} to ${count} will remove the last ${previous-count} pool${previous-count===1?"":"s"}`+
      ` containing ${removedEntries} player entr${removedEntries===1?"y":"ies"}. Continue?`)){
      $("playerPoolCountSetting").value=String(previous);
      return false;
    }
    tournament.playerPoolPlayers.length=count;
  }else{
    while(tournament.playerPoolPlayers.length<count)tournament.playerPoolPlayers.push([]);
  }

  // Pool contents are authoritative input and survive resizing. Generated
  // teams are derived from that input, so only the generated/distributed result
  // is invalidated when the pool structure changes.
  tournament.settings.playerPoolCount=count;
  invalidatePlayerPoolBuild();
  tournament.settings.playerPoolsCreated=true;
  addHistory("Player pool count changed",`${previous} → ${count}`);
  return true;
}

function renderPlayerPool(){
  const options=$("playerPoolOptions");
  if(!options)return;
  options.style.display="block";

  if(!tournament.settings)tournament.settings={};
  if(!Number.isFinite(Number(tournament.settings.playerPoolCount)))
    tournament.settings.playerPoolCount=2;

  renderPlayerPools();
  renderPlayerPoolBuildArea();
  renderPlayerPoolGeneratedPreview();
}

function ensurePlayerPoolState(count){
  count=Math.max(2,Math.min(52,Number(count)||2));
  if(!tournament.settings)tournament.settings={};
  tournament.settings.playerPoolCount=count;
  if(!Array.isArray(tournament.playerPoolPlayers))
    tournament.playerPoolPlayers=[];
  while(tournament.playerPoolPlayers.length<count)
    tournament.playerPoolPlayers.push([]);
  if(tournament.playerPoolPlayers.length>count)
    tournament.playerPoolPlayers.length=count;
  return count;
}

function playerPoolBuildInputSignature(){
  ensurePlayerPoolState(Number(tournament.settings?.playerPoolCount)||2);
  const count=Math.max(2,Math.min(52,Number(tournament.settings?.playerPoolCount)||2));
  const pools=Array.from({length:count},(_,i)=>
    (Array.isArray(tournament.playerPoolPlayers?.[i])
      ? tournament.playerPoolPlayers[i]
      : []).map(entry=>String(entry?.name??entry??"").trim())
  );
  return JSON.stringify({count,pools});
}

function renderGroups(){
  const el=$("groupsCompact");
  if(!tournament.groups.length){
    el.innerHTML='<div class="empty directional-message" role="button" tabindex="0" onclick="openTournamentSettings()" onkeydown="handleDirectionalKey(event,openTournamentSettings)">No groups created yet.</div>';
    return;
  }
  const groups=tournament.groups;
  el.innerHTML=groups.map(g=>{
    const teams=tournament.teams.filter(t=>t.groupId===g.id);
    return `<div class="group" style="padding:8px 9px">
      <div style="display:flex;gap:5px;align-items:center;justify-content:space-between">
        <strong>${escapeHtml(g.name)}</strong>
        <div style="display:flex;gap:4px;align-items:center;justify-content:flex-end">
          <label style="margin:0;font-size:10px">Teams</label>
          <input style="width:54px;padding:6px" type="number" min="${teams.length}" value="${Math.max(g.teamCount||teams.length,teams.length)}" onchange="changeGroupTeamCount('${g.id}',this.value)">
          <label style="margin:0;font-size:10px">Qualify</label>
          <input style="width:54px;padding:6px" type="number" min="0" value="${g.directQualifiers||0}" onchange="changeGroupQualifiers('${g.id}',this.value)">
          <span class="badge">${g.qualifierOverridden?'Override':'Default'}</span>
          <button class="btn btn-danger btn-small" onclick="removeGroup('${g.id}')" title="Remove group">×</button>
        </div>
      </div>
    </div>`;
  }).join("");
}
function handleDirectionalKey(event,action){
  if(event.key==="Enter"||event.key===" "){
    event.preventDefault();
    action();
  }
}

function openTournamentSettings(targetId="groupCount"){
  const card=$("tournamentSettingsCard");
  if(!card)return;
  card.open=true;
  requestAnimationFrame(()=>{
    const input=$(targetId)||$("groupCount");
    card.scrollIntoView({behavior:"smooth",block:"start"});
    if(input){
      input.focus();
      input.scrollIntoView({behavior:"smooth",block:"center"});
    }
  });
}

function handleDirectionalEntryGroup(el){
  if(!tournament.groups.length&&!el.value)openTournamentSettings();
}

function openGroupTable(){
  const card=$("fixturesCard");
  if(!card)return;
  card.open=true;
  requestAnimationFrame(()=>{
    card.scrollIntoView({behavior:"smooth",block:"start"});
    const btn=$("generateFixturesBtn");
    if(btn)btn.focus();
  });
}

function openAddTeam(){
  if(typeof openManualTeamEntry==="function")openManualTeamEntry();
}

function renderGroupSelect(){
  const el=$("entryGroup");
  const manualEntryLine=$("addTeamPanel")?.querySelector(".entry-line");
  if(!tournament.groups.length){
    el.innerHTML='<option value="">Declare groups first</option>';
    el.disabled=true;
    $("addTeamBtn").disabled=true;
    if(manualEntryLine)manualEntryLine.style.display="none";
    const teamList=$("selectedGroupTeams");
    if(teamList)teamList.innerHTML='<div class="empty directional-message" role="button" tabindex="0" onclick="openTournamentSettings()" onkeydown="handleDirectionalKey(event,openTournamentSettings)">Declare groups first.</div>';
    return;
  }
  if(manualEntryLine)manualEntryLine.style.display="";
  const current=el.value;
  el.disabled=false;
  $("addTeamBtn").disabled=false;
  el.innerHTML=tournament.groups.map(g=>`<option value="${g.id}">${escapeHtml(g.name)}</option>`).join("");
  if(current && tournament.groups.some(g=>g.id===current)) el.value=current;
}

function modeToTeamFormat(mode){
  return mode==="multiplayer"?"team":mode==="singles"?"singles":"doubles";
}

function modePlayerCount(mode){
  return mode==="singles"?1:mode==="doubles"?2:null;
}

function renderTeamPoolEntryFields(){
  const container=$("teamPoolPlayerFields");
  if(!container)return;
  const mode=tournament.settings?.mode||"doubles";
  const fixedCount=modePlayerCount(mode);
  const count=fixedCount||1;
  const button=mode==="multiplayer"?'<button type="button" class="btn btn-secondary btn-small add-team-pool-player" onclick="addTeamPoolPlayerField()">+ Player</button>':"";
  container.innerHTML=Array.from({length:count},(_,i)=>`<input class="team-pool-player-input" data-player-index="${i+1}" placeholder="Player ${i+1}" aria-label="Player ${i+1}">`).join("")+button;
}

function addTeamPoolPlayerField(){
  if((tournament.settings?.mode||"doubles")!=="multiplayer")return;
  const container=$("teamPoolPlayerFields");
  if(!container)return;
  const inputs=[...container.querySelectorAll(".team-pool-player-input")];
  const input=document.createElement("input");
  input.className="team-pool-player-input";
  input.dataset.playerIndex=String(inputs.length+1);
  input.placeholder="Player "+(inputs.length+1);
  input.setAttribute("aria-label","Player "+(inputs.length+1));
  container.insertBefore(input,container.querySelector(".add-team-pool-player"));
  input.focus();
}

function renderPlayerEntryFields(){
  const el=$("playerEntryFields");
  const format=modeToTeamFormat(tournament.settings?.mode||"doubles");
  if(format==="singles"){
    el.innerHTML='<input class="player-entry" data-player-index="1" placeholder="Player name" aria-label="Player name">';
    return;
  }
  if(format==="doubles"){
    el.innerHTML=`<div class="player-entry-row">
      <input class="player-entry" data-player-index="1" placeholder="Player 1" aria-label="Player 1">
      <input class="player-entry" data-player-index="2" placeholder="Player 2" aria-label="Player 2">
    </div>`;
    return;
  }
  el.innerHTML=`<div class="player-entry-row">
    <input class="player-entry" data-player-index="1" placeholder="Player 1" aria-label="Player 1">
    <button type="button" class="btn btn-secondary btn-small add-player" onclick="addEntryPlayerField()">+ Player</button>
  </div>`;
}

function addEntryPlayerField(){
  const container=$("playerEntryFields");
  const inputs=[...container.querySelectorAll(".player-entry")];
  const n=inputs.length+1;
  const row=container.querySelector(".player-entry-row")||container;
  const input=document.createElement("input");
  input.className="player-entry";
  input.dataset.playerIndex=n;
  input.placeholder="Player "+n;
  input.setAttribute("aria-label","Player "+n);
  row.insertBefore(input,row.querySelector(".add-player"));
  input.focus();
}
function renderTeamList(){
  const el=$("selectedGroupTeams");
  if(!el)return;

  const groupId=$("entryGroup")?.value;
  const group=tournament.groups.find(g=>String(g.id)===String(groupId));
  if(!group){
    el.innerHTML=tournament.groups.length
      ? '<div class="muted" style="padding:7px 4px">Select a group to view its teams.</div>'
      : '<div class="empty directional-message" role="button" tabindex="0" onclick="openTournamentSettings()" onkeydown="handleDirectionalKey(event,openTournamentSettings)">Declare groups first.</div>';
    return;
  }

  const teams=tournament.teams
    .filter(t=>String(t.groupId)===String(group.id))
    .sort((a,b)=>b.number-a.number);

  let html=`<div class="live-group">`;

  if(teams.length){
    teams.forEach(t=>{
      const names=t.playerIds.map(pid=>tournament.players.find(p=>p.id===pid)?.name||"").filter(Boolean);
      html+=`<div class="live-team">
        <div class="live-team-number">Team ${t.number}</div>
        <div class="live-team-players manual-team-player-list">${names.length?escapeHtml(names.join(", ")):'<span class="muted">No players</span>'}</div>
        <div class="live-actions">
          <button class="btn btn-secondary btn-small" onclick="editTeam('${t.id}')">Edit</button>
          <button class="btn btn-danger btn-small" onclick="removeTeam('${t.id}')">×</button>
        </div>
      </div>`;
    });
  }else{
    html+='<div class="muted" style="padding:7px 4px">No teams yet.</div>';
  }

  html+="</div>";
  el.innerHTML=html;
}

function gameCountForMatch(){
  return Math.max(1,Number(tournament.settings?.bestOf||1));
}

function pointsTargetForMatch(){
  return Math.max(1,Number(tournament.settings?.pointsTarget||21));
}


function teamDisplayLabel(team){
  if(!team)return "";
  const names=(team.playerIds||[])
    .map(pid=>tournament.players.find(p=>String(p.id)===String(pid))?.name||"")
    .filter(Boolean);
  return escapeHtml(names.join(", "));
}

function fixtureDisplayLabel(fixture){
  if(!fixture)return "Unknown fixture";
  const group=tournament.groups.find(g=>String(g.id)===String(fixture.groupId));
  const a=tournament.teams.find(t=>String(t.id)===String(fixture.teamAId));
  const b=tournament.teams.find(t=>String(t.id)===String(fixture.teamBId));
  const prefix=group ? `${escapeHtml(group.name.replace(/^Group\s+/i,"").charAt(0))}${fixture.number}` : `F${fixture.number}`;
  return `${prefix}: ${teamDisplayLabel(a)} vs ${teamDisplayLabel(b)}`;
}

function fixtureResult(fixtureId){
  if(!Array.isArray(tournament.results))tournament.results=[];
  return tournament.results.find(r=>String(r.fixtureId)===String(fixtureId))||null;
}

/* AUTHORITATIVE MATCH COMPLETION
   A fixture's status is derived UI state; the recorded result is the source of
   truth for whether a match actually has a valid outcome. This prevents stale
   or legacy fixture.status values from making an unplayed/missing-result match
   count as completed in progress, qualification, or navigation. */
function isFixtureResultComplete(fixture){
  if(!fixture)return false;
  const result=fixtureResult(fixture.id);
  if(!result)return false;
  const winner=String(result.winnerTeamId??"");
  const loser=String(result.loserTeamId??"");
  if(!winner||!loser||winner===loser)return false;
  const a=String(fixture.teamAId??fixture.team1Id??fixture.homeTeamId??"");
  const b=String(fixture.teamBId??fixture.team2Id??fixture.awayTeamId??"");
  if(!((winner===a&&loser===b)||(winner===b&&loser===a)))return false;
  return result.status==="completed" || result.walkover===true;
}

/* AUTHORITATIVE GENERATED-MATCH COMPLETION
   Generated stages store their result directly on the match object rather than
   in tournament.results. Completion therefore follows the same invariant as
   group fixtures: the match must be marked completed AND have a valid winner
   and loser drawn from its actual participants. This prevents stale/malformed
   imported state from inflating dashboard progress or advancing a feeder. */
function isGeneratedMatchResultComplete(match){
  if(!match || match.status!=="completed")return false;
  const winner=String(match.winnerTeamId??match.result?.winnerTeamId??"");
  const loser=String(match.loserTeamId??match.result?.loserTeamId??"");
  if(!winner||!loser||winner===loser)return false;
  const a=String(match.teamAId??match.team1Id??"");
  const b=String(match.teamBId??match.team2Id??"");
  if(!a||!b)return false;
  return (winner===a&&loser===b)||(winner===b&&loser===a);
}

function isThirdPlaceResultComplete(match){
  return isGeneratedMatchResultComplete(match);
}

function renderResultGroupFilter(){
  const el=$("resultGroupFilter");
  if(!el)return;
  const current=el.value;
  el.innerHTML=tournament.groups.map(g=>`<option value="${g.id}">${escapeHtml(g.name)}</option>`).join("");
  if(current&&tournament.groups.some(g=>g.id===current))el.value=current;
  else if(tournament.groups[0])el.value=tournament.groups[0].id;
}

function renderResultFixtureFilter(){
  const el=$("resultFixtureFilter");
  if(!el)return;
  const gid=$("resultGroupFilter")?.value;
  const current=el.value;
  const fixtures=tournament.fixtures
    .filter(f=>String(f.groupId)===String(gid))
    .sort((a,b)=>a.number-b.number);

  el.innerHTML=fixtures.map(f=>`<option value="${f.id}">${fixtureDisplayLabel(f)}</option>`).join("");
  if(current&&fixtures.some(f=>String(f.id)===String(current)))el.value=current;
  else if(fixtures[0])el.value=String(fixtures[0].id);
}


function nextPendingGroupFixture(groupId,currentFixtureId){
  const pending=(tournament.fixtures||[])
    .filter(f=>String(f.groupId)===String(groupId))
    .filter(f=>!isFixtureResultComplete(f))
    .sort((a,b)=>a.number-b.number);
  return pending[0]||null;
}

function advanceGroupResultSelection(groupId){
  const next=nextPendingGroupFixture(groupId);
  if(!next)return false;
  const select=$("resultFixtureFilter");
  if(!select)return false;
  select.value=String(next.id);
  openFloatingScorecard("group",next.id,null,true);
  return true;
}

function focusFirstGroupScoreField(){
  const editor=document.querySelector("#floatingScorecard");
  const first=editor?.querySelector('.result-score[data-side="a"]');
  if(first){
    first.focus();
    if(typeof first.select==="function")first.select();
  }
}


/* SCOREBOARD — neutral view-model adapters
   These adapters are presentation-layer only. They translate each stage's
   existing match model into the same scoreboard shape without changing the
   tournament data, persistence, selection, or downstream result logic. */
function createScoreboardViewModel({stage,matchId,matchNumber,stageLabel,teamAId,teamBId,teamALabel,teamBLabel,games,bestOf,pointsTarget,completed,save,walkoverA,walkoverB,clear}){
  return {
    stage:String(stage||""),
    matchId:String(matchId??""),
    matchNumber:matchNumber??null,
    stageLabel:String(stageLabel||""),
    teamAId:teamAId??null,
    teamBId:teamBId??null,
    teamALabel:teamALabel||"",
    teamBLabel:teamBLabel||"",
    games:Array.isArray(games)?games:[],
    bestOf:Math.max(1,Number(bestOf)||1),
    pointsTarget:Math.max(1,Number(pointsTarget)||21),
    completed:!!completed,
    walkover:null,
    actions:{save,walkoverA,walkoverB,clear}
  };
}

function getGroupScoreboardViewModel(fixtureId){
  const fixture=(tournament.fixtures||[]).find(f=>String(f.id)===String(fixtureId));
  if(!fixture||!fixture.teamAId||!fixture.teamBId)return null;
  const group=(tournament.groups||[]).find(g=>String(g.id)===String(fixture.groupId));
  const a=(tournament.teams||[]).find(t=>String(t.id)===String(fixture.teamAId));
  const b=(tournament.teams||[]).find(t=>String(t.id)===String(fixture.teamBId));
  if(!a||!b)return null;
  const result=fixtureResult(fixture.id);
  const model=createScoreboardViewModel({
    stage:"group",
    matchId:fixture.id,
    matchNumber:fixture.number,
    stageLabel:group?.name||"Group",
    teamAId:fixture.teamAId,
    teamBId:fixture.teamBId,
    teamALabel:teamDisplayLabel(a),
    teamBLabel:teamDisplayLabel(b),
    games:Array.isArray(result?.games)&&result.games.length?result.games:[],
    bestOf:gameCountForMatch(),
    pointsTarget:pointsTargetForMatch(),
    completed:isFixtureResultComplete(fixture),
    save:{type:"group-result",matchId:String(fixture.id)},
    walkoverA:{type:"group-walkover",matchId:String(fixture.id),winnerTeamId:fixture.teamAId,loserTeamId:fixture.teamBId},
    walkoverB:{type:"group-walkover",matchId:String(fixture.id),winnerTeamId:fixture.teamBId,loserTeamId:fixture.teamAId},
    clear:result?{type:"group-clear",matchId:String(fixture.id)}:null
  });
  if(result?.walkover){
    model.walkover={
      winnerTeamId:result.winnerTeamId,
      loserTeamId:result.loserTeamId
    };
  }
  return model;
}

function getPreliminaryScoreboardViewModel(matchId){
  const match=getPreliminaryMatch(matchId);
  if(!match||!match.teamAId||!match.teamBId)return null;
  const a=preliminaryTeamById(match.teamAId),b=preliminaryTeamById(match.teamBId);
  if(!a||!b)return null;
  const result=match.result;
  return createScoreboardViewModel({
    stage:"preliminary",
    matchId:match.id,
    matchNumber:match.matchNumber,
    stageLabel:"Pre-Knockout",
    teamAId:match.teamAId,
    teamBId:match.teamBId,
    teamALabel:preliminaryTeamDisplay(a),
    teamBLabel:preliminaryTeamDisplay(b),
    games:Array.isArray(result?.games)&&result.games.length?result.games:[],
    bestOf:1,
    pointsTarget:21,
    completed:isGeneratedMatchResultComplete(match),
    save:{type:"preliminary-result",matchId:String(match.id)},
    walkoverA:{type:"preliminary-walkover",matchId:String(match.id),winnerTeamId:match.teamAId},
    walkoverB:{type:"preliminary-walkover",matchId:String(match.id),winnerTeamId:match.teamBId},
    clear:result?{type:"preliminary-clear",matchId:String(match.id)}:null
  });
}

function getMainKnockoutScoreboardViewModel(matchId){
  const match=mainKnockoutMatchById(matchId);
  if(!match||!match.team1Id||!match.team2Id)return null;
  const a=(tournament.teams||[]).find(t=>String(t.id)===String(match.team1Id));
  const b=(tournament.teams||[]).find(t=>String(t.id)===String(match.team2Id));
  if(!a||!b)return null;
  const result=match.result;
  const title=match.roundName||match.round||knockoutRoundTitle(match.roundSize);
  return createScoreboardViewModel({
    stage:"main",
    matchId:match.id,
    matchNumber:match.number??match.matchNumber,
    stageLabel:title,
    teamAId:match.team1Id,
    teamBId:match.team2Id,
    teamALabel:mainKnockoutScorePlayerLabel(match,1),
    teamBLabel:mainKnockoutScorePlayerLabel(match,2),
    games:Array.isArray(result?.games)&&result.games.length?result.games:[],
    bestOf:gameCountForMatch(),
    pointsTarget:pointsTargetForMatch(),
    completed:isGeneratedMatchResultComplete(match),
    save:{type:"main-result",matchId:String(match.id)},
    walkoverA:{type:"main-walkover",matchId:String(match.id),winnerTeamId:match.team1Id,loserTeamId:match.team2Id},
    walkoverB:{type:"main-walkover",matchId:String(match.id),winnerTeamId:match.team2Id,loserTeamId:match.team1Id},
    clear:result?{type:"main-clear",matchId:String(match.id)}:null
  });
}

function getThirdPlaceScoreboardViewModel(){
  const match=tournament.thirdPlacePlayoff;
  const desired=getThirdPlaceDesiredState();
  if(!match||!desired.ready)return null;
  const teamAId=desired.teamAId;
  const teamBId=desired.teamBId;
  const a=(tournament.teams||[]).find(t=>String(t.id)===String(teamAId));
  const b=(tournament.teams||[]).find(t=>String(t.id)===String(teamBId));
  if(!a||!b)return null;
  const result=match.result;
  return createScoreboardViewModel({
    stage:"third-place",
    matchId:match.id||"thirdPlace",
    matchNumber:null,
    stageLabel:"3rd-place playoff",
    teamAId:teamAId,
    teamBId:teamBId,
    teamALabel:knockoutDisplayLabel(teamAId),
    teamBLabel:knockoutDisplayLabel(teamBId),
    games:Array.isArray(result?.games)&&result.games.length?result.games:[],
    bestOf:gameCountForMatch(),
    pointsTarget:pointsTargetForMatch(),
    completed:isThirdPlaceResultComplete(match),
    save:{type:"third-place-result",matchId:String(match.id||"thirdPlace")},
    walkoverA:{type:"third-place-walkover",winnerTeamId:teamAId,loserTeamId:teamBId},
    walkoverB:{type:"third-place-walkover",winnerTeamId:teamBId,loserTeamId:teamAId},
    clear:result?{type:"third-place-clear",matchId:String(match.id||"thirdPlace")}:null
  });
}

/* SCOREBOARD — common renderer
   Presentation-only renderer for the neutral scoreboard view model. It does
   not mutate tournament state and does not decide how a stage saves results.
   Stage-specific action bridges and host migration are intentionally deferred
   to later scoreboard-unification steps. */
function renderScoreboardViewModel(host,model,options={}){
  if(typeof host==="string")host=$(host);
  if(!host||!model)return false;
  if(!model.teamAId||!model.teamBId)return false;

  const inputClass=options.inputClass||"scoreboard-score-input";
  const inputIdA=options.inputIdA||"";
  const inputIdB=options.inputIdB||"";
  const cardClass=options.cardClass||"group-result-editor-card";
  const actionClass=options.actionClass||"group-result-actions";
  const saveButtonClass=options.saveButtonClass||"";
  const saveButtonId=options.saveButtonId||"";
  const walkoverWrapClass=options.walkoverWrapClass||"";
  const walkoverButtonClass=options.walkoverButtonClass||"";
  const walkoverButtonIdA=options.walkoverButtonIdA||"";
  const walkoverButtonIdB=options.walkoverButtonIdB||"";
  const clearButtonId=options.clearButtonId||"";
  const contextTitle=options.contextTitle||"";
  const bestOf=Math.max(1,Number(model.bestOf)||1);
  const target=Math.max(1,Number(model.pointsTarget)||21);

  host.dataset.scoreboardStage=String(model.stage||"");
  host.dataset.scoreboardMatchId=String(model.matchId||"");

  if(model.walkover){
    const winner=String(model.walkover.winnerTeamId)===String(model.teamAId)?model.teamALabel:model.teamBLabel;
    const loser=String(model.walkover.loserTeamId)===String(model.teamAId)?model.teamALabel:model.teamBLabel;
    host.innerHTML=`<div class="floating-scorecard-shell"><button type="button" class="floating-scorecard-close" aria-label="Close scorecard" title="Close scorecard">×</button><div class="result-box compact-result">
      <div class="result-match-line">
        <strong class="winner-team">${escapeHtml(winner||"")}</strong>
        <span class="match-vs">WO vs</span>
        <strong class="loser-team">${escapeHtml(loser||"")}</strong>
        <span class="badge">Walkover</span>
        <button class="btn btn-secondary btn-small" data-scoreboard-action="clear">Clear</button>
      </div>
      <div class="notice compact-notice">Walkover = loss. No score recorded.</div>
    </div></div>`;
    host.querySelector(".floating-scorecard-close")?.addEventListener("click",event=>{event.stopPropagation();closeFloatingScorecard();});
    return true;
  }

  const games=Array.isArray(model.games)&&model.games.length
    ? model.games
    : Array.from({length:bestOf},()=>({a:"",b:""}));
  const completedGames=games.filter(g=>g&&g.a!==""&&g.b!=="");
  let aWins=0,bWins=0;
  completedGames.forEach(g=>{if(Number(g.a)>Number(g.b))aWins++;else if(Number(g.b)>Number(g.a))bWins++;});
  const aWinner=!!model.completed&&aWins>bWins;
  const bWinner=!!model.completed&&bWins>aWins;
  const label=model.matchNumber!==null&&model.matchNumber!==undefined
    ? `Game ${escapeHtml(String(model.matchNumber))} <span class="score-stage-label">(${escapeHtml(model.stageLabel||"")}):</span>`
    : `${escapeHtml(model.stageLabel||"")}:`;
  const meta=`${bestOf===1?"Best of 1":"Best of "+bestOf} · ${target} points`;

  const rows=games.map((g,i)=>{
    const a=g?.a??"",b=g?.b??"";
    const aGameWin=a!==""&&b!==""&&Number(a)>Number(b);
    const bGameWin=b!==""&&a!==""&&Number(b)>Number(a);
    const idA=i===0&&inputIdA?` id="${escapeHtml(inputIdA)}"`:"";
    const idB=i===0&&inputIdB?` id="${escapeHtml(inputIdB)}"`:"";
    return `<div class="group-score-game-row">
      <div class="group-game-number score-game-heading"><span>${label}</span><span class="muted result-meta">${meta}</span></div>
      <div class="group-score-center">
        <strong class="${aWinner||aGameWin?'winner-team':''}">${escapeHtml(model.teamALabel||"")}</strong>
        <input${idA} class="result-score ${escapeHtml(inputClass)}" data-score-scope="${escapeHtml(model.stage||"")}" data-game="${i}" data-side="a" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" autocomplete="off" placeholder="${target}" value="${escapeHtml(String(a))}">
        <span>–</span>
        <input${idB} class="result-score ${escapeHtml(inputClass)}" data-score-scope="${escapeHtml(model.stage||"")}" data-game="${i}" data-side="b" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" autocomplete="off" placeholder="${target}" value="${escapeHtml(String(b))}">
        <strong class="${bWinner||bGameWin?'winner-team':''}">${escapeHtml(model.teamBLabel||"")}</strong>
      </div>
    </div>`;
  }).join("");

  const actions=[];
  if(model.actions?.save){
    const id=saveButtonId?` id="${escapeHtml(saveButtonId)}"`:"";
    const cls=saveButtonClass?` ${escapeHtml(saveButtonClass)}`:"";
    actions.push(`<button${id} class="btn btn-primary btn-small${cls}" data-scoreboard-action="save">${model.completed?"Correct & Save":"Save"}</button>`);
  }
  const walkovers=[];
  if(model.actions?.walkoverA){
    const id=walkoverButtonIdA?` id="${escapeHtml(walkoverButtonIdA)}"`:"";
    const cls=walkoverButtonClass?` ${escapeHtml(walkoverButtonClass)}`:"";
    walkovers.push(`<button${id} class="btn btn-secondary btn-small${cls}" data-scoreboard-action="walkover-a">${escapeHtml(model.teamALabel||"")} WO</button>`);
  }
  if(model.actions?.walkoverB){
    const id=walkoverButtonIdB?` id="${escapeHtml(walkoverButtonIdB)}"`:"";
    const cls=walkoverButtonClass?` ${escapeHtml(walkoverButtonClass)}`:"";
    walkovers.push(`<button${id} class="btn btn-secondary btn-small${cls}" data-scoreboard-action="walkover-b">${escapeHtml(model.teamBLabel||"")} WO</button>`);
  }
  if(walkovers.length){
    const cls=walkoverWrapClass?` ${escapeHtml(walkoverWrapClass)}`:"";
    actions.push(`<div class="scoreboard-walkover-wrap${cls}">${walkovers.join("")}</div>`);
  }
  if(model.actions?.clear){
    const id=clearButtonId?` id="${escapeHtml(clearButtonId)}"`:"";
    actions.push(`<button${id} class="btn btn-danger btn-small" data-scoreboard-action="clear">Clear</button>`);
  }

  host.innerHTML=`<div class="floating-scorecard-shell">${contextTitle?`<div class="ko-result-context-title">${escapeHtml(contextTitle)}</div>`:""}<button type="button" class="floating-scorecard-close" aria-label="Close scorecard" title="Close scorecard">×</button><div class="card ${cardClass}">
    <div class="group-score-games">${rows}</div>
    <div class="result-actions group-result-actions ${actionClass}">${actions.join("")}</div>
  </div></div>`;
  host.querySelector(".floating-scorecard-close")?.addEventListener("click",event=>{event.stopPropagation();closeFloatingScorecard();});
  return true;
}

function bindScoreboardActionBridge(host,model){
  if(!host||!model)return;
  host.querySelectorAll("[data-scoreboard-action]").forEach(button=>{
    button.addEventListener("click",()=>{
      const action=button.dataset.scoreboardAction;
      const id=String(model.matchId||"");
      if(model.stage==="group"){
        if(action==="save"&&model.actions?.save)saveMatchResult(id);
        else if(action==="walkover-a"&&model.actions?.walkoverA)saveWalkover(id,model.actions.walkoverA.winnerTeamId,model.actions.walkoverA.loserTeamId);
        else if(action==="walkover-b"&&model.actions?.walkoverB)saveWalkover(id,model.actions.walkoverB.winnerTeamId,model.actions.walkoverB.loserTeamId);
        else if(action==="clear"&&model.actions?.clear)clearMatchResult(id);
      }else if(model.stage==="main"){
        if(action==="save"&&model.actions?.save)saveKnockoutResult(id);
        else if(action==="walkover-a"&&model.actions?.walkoverA)saveKnockoutWalkover(id,model.actions.walkoverA.winnerTeamId,model.actions.walkoverA.loserTeamId);
        else if(action==="walkover-b"&&model.actions?.walkoverB)saveKnockoutWalkover(id,model.actions.walkoverB.winnerTeamId,model.actions.walkoverB.loserTeamId);
        else if(action==="clear"&&model.actions?.clear)clearKnockoutResult(id);
      }else if(model.stage==="third-place"){
        if(action==="save"&&model.actions?.save)saveThirdPlaceResult(host);
        else if(action==="walkover-a"&&model.actions?.walkoverA)saveThirdPlaceWalkover(model.actions.walkoverA.winnerTeamId,model.actions.walkoverA.loserTeamId);
        else if(action==="walkover-b"&&model.actions?.walkoverB)saveThirdPlaceWalkover(model.actions.walkoverB.winnerTeamId,model.actions.walkoverB.loserTeamId);
        else if(action==="clear"&&model.actions?.clear)clearThirdPlaceResult();
      }
    });
  });
}


/* SCOREBOARD — one keyboard controller for every stage.
   The scoreboard DOM is common; only the persistence/selection operation varies
   by stage. This keeps Enter behaviour consistent without merging the stages'
   underlying data models. */
function bindScoreboardKeyboard(host,model){
  if(!host||!model)return;
  const inputs=host.querySelectorAll('input[data-score-scope][data-side][data-game]');
  inputs.forEach(input=>{
    if(input.dataset.scoreboardKeyboardBound==="1")return;
    input.dataset.scoreboardKeyboardBound="1";
    input.addEventListener("keydown",e=>{
      if(e.key!=="Enter")return;
      e.preventDefault();
      e.stopImmediatePropagation();

      const game=Number(input.dataset.game||0);
      const side=input.dataset.side;
      const scoreSelector=`input[data-score-scope="${CSS.escape(String(model.stage))}"]`;

      if(side==="a"){
        const b=host.querySelector(`${scoreSelector}[data-game="${game}"][data-side="b"]`);
        if(b){b.focus();b.select?.();}
        return;
      }

      const bestOf=Math.max(1,Number(model.bestOf)||1);
      const nextGame=game+1;
      if(nextGame<bestOf){
        const nextA=host.querySelector(`${scoreSelector}[data-game="${nextGame}"][data-side="a"]`);
        if(nextA){nextA.focus();nextA.select?.();return;}
      }

      const id=String(model.matchId||"");
      if(model.stage==="group"){
        saveMatchResult(id);
        return;
      }

      if(model.stage==="preliminary"){
        host.querySelector('[data-scoreboard-action="save"]')?.click();
        return;
      }

      if(model.stage==="third-place"){
        saveThirdPlaceResult(host);
        return;
      }

      if(model.stage==="main"){
        const nextId=nextPlayableKnockoutMatchId(id);
        saveKnockoutResult(id);
        setTimeout(()=>{
          const current=mainKnockoutMatchById(id);
          if(current&&isGeneratedMatchResultComplete(current)){
            if(nextId&&!isGeneratedMatchResultComplete(mainKnockoutMatchById(nextId)))selectMainKnockoutMatch(nextId,true);
            else{
              const first=$("floatingScorecard")?.querySelector('.ko-result-score[data-game="0"][data-side="a"]');
              if(first){first.focus();first.select?.();}
            }
          }
        },40);
      }
    });
  });
}


function renderResultEditor(){
  renderResultGroupFilter();
  renderResultFixtureFilter();
  const state=floatingScorecardState;
  const el=$("floatingScorecard");
  if(!el)return;
  if(state.stage!=="group")return;
  const fixtureSelect=$("resultFixtureFilter");
  const fixtureValue=fixtureSelect?.value;
  if(String(state.matchId)!==String(fixtureValue)){
    if((tournament.fixtures||[]).some(f=>String(f.id)===String(state.matchId)))fixtureSelect.value=String(state.matchId);
  }

  const fixture=tournament.fixtures.find(f=>String(f.id)===String(fixtureValue));

  if(!fixture){
    const gid=$("resultGroupFilter")?.value;
    const available=tournament.fixtures.filter(f=>String(f.groupId)===String(gid)).sort((a,b)=>a.number-b.number);
    if(available.length){
      fixtureSelect.value=String(available[0].id);
      return renderResultEditor();
    }
    closeFloatingScorecard();
    return;
  }

  const model=getGroupScoreboardViewModel(fixture.id);
  if(!model){
    el.innerHTML='<div class="empty">Unable to load this match.</div>';
    return;
  }

  renderScoreboardViewModel(el,model,{
    inputClass:"group-score-input",
    cardClass:"group-result-editor-card",
    actionClass:"group-result-actions"
  });
  bindScoreboardActionBridge(el,model);
  bindScoreboardKeyboard(el,model);
}

function normalizeMatchGames(games,bestOf){
  const targetGames=Math.max(1,Number(bestOf)||1);
  const needed=Math.floor(targetGames/2)+1;
  const normalized=[];
  let aWins=0,bWins=0;

  for(let i=0;i<targetGames;i++){
    const g=games[i]||{a:"",b:""};
    const a=g.a===""?"":Number(g.a);
    const b=g.b===""?"":Number(g.b);

    if(a===""||b==="")break;
    if(!Number.isFinite(a)||!Number.isFinite(b)||a<0||b<0||a===b)
      return {valid:false,error:"Each completed game needs valid, non-tied scores."};

    normalized.push({a,b});
    if(a>b)aWins++;else bWins++;
    if(aWins>=needed||bWins>=needed)break;
  }

  if(normalized.length===0)
    return {valid:false,error:"Enter at least one complete game score."};

  const winner=aWins>=needed?"a":bWins>=needed?"b":null;
  if(!winner)
    return {valid:false,error:`A Best of ${targetGames} match requires ${needed} game wins.`};

  // Scores after the decisive game are not part of the result. Treat them as
  // invalid input rather than silently accepting contradictory extra games.
  for(let i=normalized.length;i<targetGames;i++){
    const g=games[i];
    if(g && g.a!=="" && g.b!=="")
      return {valid:false,error:"Do not enter games after the match has already been decided."};
  }

  return {valid:true,games:normalized,winner};
}

function saveMatchResult(fixtureId){
  const fixture=tournament.fixtures.find(f=>f.id===fixtureId);
  if(!fixture)return;
  const inputs=[...document.querySelectorAll(".result-score")];
  const bestOf=gameCountForMatch();
  const games=Array.from({length:bestOf},(_,i)=>{
    const a=document.querySelector(`.result-score[data-game="${i}"][data-side="a"]`)?.value??"";
    const b=document.querySelector(`.result-score[data-game="${i}"][data-side="b"]`)?.value??"";
    return {a:a===""?"":Number(a),b:b===""?"":Number(b)};
  });

  const normalized=normalizeMatchGames(games,bestOf);
  if(!normalized.valid){
    showMessage(normalized.error);
    return;
  }
  const winner=normalized.winner;
  const completedGames=normalized.games;

  if(!Array.isArray(tournament.results))tournament.results=[];
  const old=fixtureResult(fixtureId);
  const result={
    fixtureId,
    status:"completed",
    walkover:false,
    winnerTeamId:winner==="a"?fixture.teamAId:fixture.teamBId,
    loserTeamId:winner==="a"?fixture.teamBId:fixture.teamAId,
    games:completedGames,
    updatedAt:Date.now()
  };
  if(old){
    Object.assign(old,result);
  }else{
    tournament.results.push(result);
  }
  fixture.status="completed";
  fixture.resultId=fixtureId;
  fixture.updatedAt=Date.now();

  addHistory("Match result saved",`Fixture ${fixture.number}`);
  invalidateCompetitionStagesFrom("group-fixtures","A group result changed the qualification and tournament-ranking inputs.");
  saveLocal(true);
  refreshAfterGroupResult(fixture.groupId);
  showMessage("Match result saved.");
  advanceGroupResultSelection(fixture.groupId);
}

function saveWalkover(fixtureId,winnerTeamId,loserTeamId){
  const fixture=tournament.fixtures.find(f=>f.id===fixtureId);
  if(!fixture)return;
  if(!Array.isArray(tournament.results))tournament.results=[];
  const old=fixtureResult(fixtureId);
  const result={
    fixtureId,
    status:"completed",
    walkover:true,
    winnerTeamId,
    loserTeamId,
    games:[],
    updatedAt:Date.now()
  };
  if(old)Object.assign(old,result); else tournament.results.push(result);
  fixture.status="completed";
  fixture.resultId=fixtureId;
  fixture.updatedAt=Date.now();
  addHistory("Walkover recorded",`Fixture ${fixture.number}`);
  invalidateCompetitionStagesFrom("group-fixtures","A group result changed the qualification and tournament-ranking inputs.");
  saveLocal(true);
  refreshAfterGroupResult(fixture.groupId);
  showMessage("Walkover recorded. No score added.");
  advanceGroupResultSelection(fixture.groupId);
}

function clearMatchResult(fixtureId){
  tournament.results=(tournament.results||[]).filter(r=>r.fixtureId!==fixtureId);
  const fixture=tournament.fixtures.find(f=>f.id===fixtureId);
  if(fixture){
    fixture.status="pending";
    delete fixture.resultId;
    fixture.updatedAt=Date.now();
  }
  invalidateCompetitionStagesFrom("group-fixtures","A group result was cleared, changing the qualification and tournament-ranking inputs.");
  saveLocal(true);
  refreshAfterGroupResult(fixture?.groupId);
  showMessage("Match result cleared.");
}


function teamLostScore(teamId,groupId){
  let total=0;
  const {resultsByGroup}=getCalculationIndexes();
  const groupResults=resultsByGroup.get(String(groupId))||[];
  groupResults.forEach(({result:r,fixture:f})=>{
    if(r.walkover||String(r.loserTeamId)!==String(teamId))return;
    (r.games||[]).forEach(g=>{
      const score=String(r.loserTeamId)===String(f.teamAId)?Number(g.a):Number(g.b);
      if(Number.isFinite(score))total+=score;
    });
  });
  return total;
}

function headToHeadWinner(teamAId,teamBId,groupId){
  const {resultsByGroup}=getCalculationIndexes();
  const groupResults=resultsByGroup.get(String(groupId))||[];
  const wanted=[String(teamAId),String(teamBId)].sort();
  for(const {result:r,fixture:f} of groupResults){
    if(r.walkover)continue;
    const pair=[String(f.teamAId),String(f.teamBId)].sort();
    if(pair[0]===wanted[0]&&pair[1]===wanted[1]&&r.winnerTeamId){
      return String(r.winnerTeamId);
    }
  }
  return null;
}

function groupLostScoreAgainstTied(teamId,tiedIds,groupId){
  let total=0;
  const tied=new Set(tiedIds.map(String));
  const {resultsByGroup}=getCalculationIndexes();
  const groupResults=resultsByGroup.get(String(groupId))||[];
  groupResults.forEach(({result:r,fixture:f})=>{
    if(r.walkover)return;
    const a=String(f.teamAId),b=String(f.teamBId);
    if(!tied.has(a)||!tied.has(b)||String(r.loserTeamId)!==String(teamId))return;
    (r.games||[]).forEach(g=>{
      const score=String(r.loserTeamId)===a?Number(g.a):Number(g.b);
      if(Number.isFinite(score))total+=score;
    });
  });
  return total;
}

/* CALCULATION LAYER — Group ranking
   Rules:
   1. Match wins: higher is better.
   2. Head-to-head: direct result for a two-team tie; for 3+ tied teams,
      build a mini-table using only matches among the tied teams.
   3. Total losing points: higher is better.
   4. If still unresolved, do NOT invent a winner. Mark the tie as requiring
      an operator lottery/playoff decision. */
function buildGroupH2HMiniTable(tiedRows,groupId){
  const ids=new Set(tiedRows.map(r=>String(r.team.id)));
  const mini=new Map(tiedRows.map(r=>[String(r.team.id),{
    h2hWins:0,
    h2hPlayed:0,
    h2hLossPoints:0
  }]));

  const {resultsByGroup}=getCalculationIndexes();
  const groupResults=resultsByGroup.get(String(groupId))||[];
  groupResults.forEach(({result:r,fixture:f})=>{
    if(r.walkover||!r.winnerTeamId||!r.loserTeamId)return;
    const a=String(f.teamAId),b=String(f.teamBId);
    if(!ids.has(a)||!ids.has(b))return;

    const winner=mini.get(String(r.winnerTeamId));
    const loser=mini.get(String(r.loserTeamId));
    if(!winner||!loser)return;

    winner.h2hWins++;
    winner.h2hPlayed++;
    loser.h2hPlayed++;

    // Retain the losing points inside the mini-table as diagnostic data.
    // This is not used ahead of the agreed overall losing-points rule.
    (r.games||[]).forEach(g=>{
      const score=String(r.loserTeamId)===a?Number(g.a):Number(g.b);
      if(Number.isFinite(score))loser.h2hLossPoints+=score;
    });
  });

  return mini;
}

function renderStandingsGroupFilter(){
  const el=$("standingsGroupFilter");
  if(!el)return;
  const current=el.value;
  el.innerHTML=tournament.groups.map(g=>`<option value="${g.id}">${escapeHtml(g.name)}</option>`).join("");
  if(current&&tournament.groups.some(g=>String(g.id)===String(current)))el.value=current;
  else if(tournament.groups[0])el.value=String(tournament.groups[0].id);
}

function renderStandings(){
  renderStandingsGroupFilter();
  const el=$("standingsList");
  if(!el)return;
  const gid=$("standingsGroupFilter")?.value;
  const group=tournament.groups.find(g=>String(g.id)===String(gid));
  if(!group){
    el.innerHTML='<div class="empty directional-message" role="button" tabindex="0" onclick="openTournamentSettings()" onkeydown="handleDirectionalKey(event,openTournamentSettings)">Create groups first.</div>';
    return;
  }

  const rows=calculateGroupStandings(gid);
  if(!rows.length){
    el.innerHTML='<div class="empty directional-message" role="button" tabindex="0" onclick="openAddTeam()" onkeydown="handleDirectionalKey(event,openAddTeam)">No teams in this group.</div>';
    return;
  }

  const q=Math.max(0,Number(group.directQualifiers||0));
  el.innerHTML=`<div class="standings-table">
    <div class="standing-row standing-head">
      <span>Group Rank</span><span>Team</span><span>W</span><span>L</span><span>Lost</span><span>Points</span>
    </div>
    ${rows.map(r=>{
      const names=(r.team.playerIds||[]).map(pid=>tournament.players.find(p=>String(p.id)===String(pid))?.name||"").filter(Boolean);
      const label=names.length?escapeHtml(names.join(", ")):"";
      return `<div class="standing-row">
        <span>${r.position}</span>
        <span class="standing-team">${label}</span>
        <span>${r.wins}</span>
        <span>${r.losses}</span>
        <span>${r.lostScore}</span><span class="group-metric">${Number(r.team?.globalMetric??0)}</span>
      </div>`;
    }).join("")}
  </div>`;
}

function qualificationCountForGroup(group){
  return Math.max(0,Number(group?.directQualifiers||0));
}

/* QUALIFICATION GATE — Automatic qualification is only available after every
   required fixture in the respective group has a completed outcome. This is
   intentionally enforced here, at the qualification source, so Tournament
   Ranking, Pre-Knockout and Main Knockout continue to consume one consistent
   qualification result without needing separate completion checks.
   A normal result and a recorded walkover both count as completed fixtures. */
function isGroupQualificationReady(groupId){
  const fixtures=(tournament.fixtures||[])
    .filter(f=>String(f.groupId)===String(groupId));

  if(!fixtures.length)return false;

  return fixtures.every(f=>isFixtureResultComplete(f));
}

function renderQualificationGroupFilter(){
  const el=$("qualificationGroupFilter");
  if(!el)return;
  const current=el.value;
  el.innerHTML=tournament.groups.map(g=>`<option value="${g.id}">${escapeHtml(g.name)}</option>`).join("");
  if(current&&tournament.groups.some(g=>String(g.id)===String(current)))el.value=current;
  else if(tournament.groups[0])el.value=String(tournament.groups[0].id);
}

function qualificationTeamLabel(team){
  if(!team)return "";
  const names=(team.playerIds||[])
    .map(pid=>tournament.players.find(p=>String(p.id)===String(pid))?.name||"")
    .filter(Boolean);
  return escapeHtml(names.join(", "));
}

function renderQualification(){
  renderQualificationGroupFilter();
  const el=$("qualificationList");
  const actions=$("qualificationActions");
  const help=$("qualificationHelp");
  if(!el)return;
  const gid=$("qualificationGroupFilter")?.value;
  const group=tournament.groups.find(g=>String(g.id)===String(gid));

  if(!group){
    el.innerHTML='<div class="empty directional-message" role="button" tabindex="0" onclick="openTournamentSettings()" onkeydown="handleDirectionalKey(event,openTournamentSettings)">Create groups first.</div>';
    if(actions)actions.innerHTML="";
    if(help)help.textContent="";
    return;
  }

  const rows=calculateQualifications(gid);
  if(help)help.textContent="Top teams qualify automatically according to each group’s qualifier setting.";
  el.innerHTML=`<div class="standings-table group-ranking-table">
    <div class="standing-row standing-head">
      <span>Pos</span><span>Team</span><span>W</span><span>L</span><span>Lost</span><span>Qualify</span><span class="group-metric-head">Points</span>
    </div>
    ${rows.map(r=>`<div class="standing-row ${r.qualifier?'qualifier-row':''}">
      <span>${r.position}</span><span class="standing-team">${qualificationTeamLabel(r.team)}</span>
      <span>${r.wins}</span><span>${r.losses}</span><span>${r.lostScore}</span>
      <span>${r.qualifier?'✓':'—'}</span><span class="group-metric">${Number(r.team?.globalMetric??0)}</span>
    </div>`).join("")}
  </div>`;
  if(actions)actions.innerHTML=`<div class="muted">Direct qualifiers: <strong>${qualificationCountForGroup(group)}</strong>${group.qualifierOverridden?' · Group override active':' · Using tournament default'}</div>`;
}

function getQualifiedTeamIds(){
  const records=[];
  const seen=new Set();
  tournament.groups.forEach(group=>{
    calculateQualifications(group.id).filter(r=>r.qualifier).forEach(r=>{
      const id=String(r.team.id);
      if(seen.has(id))return;
      seen.add(id);
      records.push({
        teamId:r.team.id,
        groupId:group.id,
        groupLetter:group.name.replace(/^Group\s+/i,"").charAt(0),
        rank:r.position
      });
    });
  });
  (tournament.manualKnockoutTeams||[]).forEach(id=>{
    const key=String(id);
    if(seen.has(key))return;
    const team=tournament.teams.find(t=>String(t.id)===key);
    if(!team)return;
    const group=tournament.groups.find(g=>String(g.id)===String(team.groupId));
    const standings=group?calculateGroupStandings(group.id):[];
    const rank=standings.findIndex(r=>String(r.team.id)===key)+1;
    seen.add(key);
    records.push({
      teamId:team.id,
      groupId:team.groupId,
      groupLetter:group?.name.replace(/^Group\s+/i,"").charAt(0)||"?",
      rank:rank>0?rank:null,
      manual:true
    });
  });
  // IMPORTANT: this function reports the authoritative qualified-team set.
  // Do not pass the records through seededKnockoutTeamIds(): that helper creates
  // pairing slots and may add a null placeholder for an odd number of teams.
  // A pairing slot is not a qualified team. For example, 7 qualified teams must
  // remain a count of 7 so calculateKnockoutStructure() selects a 4-team bracket
  // with 3 Pre-Knockout matches.
  return records.map(record=>record.teamId);
}

function seededKnockoutTeamIds(records){
  const remaining=[...records].sort((a,b)=>{
    const ra=Number(a.rank)||9999, rb=Number(b.rank)||9999;
    if(ra!==rb)return ra-rb;
    return String(a.groupLetter).localeCompare(String(b.groupLetter),undefined,{numeric:true});
  });
  const pairs=[];
  while(remaining.length>=2){
    const strong=remaining.shift();
    let partnerIndex=remaining.length-1;
    for(let i=remaining.length-1;i>=0;i--){
      if(String(remaining[i].groupId)!==String(strong.groupId)){
        partnerIndex=i; break;
      }
    }
    pairs.push([strong,remaining.splice(partnerIndex,1)[0]]);
  }
  if(remaining.length===1)pairs.push([remaining[0],null]);
  return pairs.flatMap(pair=>[pair[0]?.teamId||null,pair[1]?.teamId||null]);
}


function buildMainKnockout(){
  const preflightPlan=buildMainKnockoutEntryPlan();
  const preflight=validateMainKnockoutEntryPlan(preflightPlan);
  if(!preflight.valid){
    const message=`Main Knockout cannot be built. ${preflight.errors.join(" ")}`;
    showMessage(message,"error");
    renderKnockout();
    return {valid:false,error:message,validationErrors:preflight.errors};
  }
  const stale=getStageStaleInfo("main-knockout");
  const existing=getActiveMainKnockoutDraw();
  if(existing?.rounds?.length && !stale.stale){
    showMessage("Main Knockout is already built. No rebuild is required.");
    renderKnockout();
    return {valid:false,error:"main_knockout_already_built"};
  }
  if(existing?.rounds?.length && stale.stale){
    const completed=existing.rounds.flatMap(r=>r.matches||[]).filter(isGeneratedMatchResultComplete).length;
    const message=completed
      ? `⚠ Rebuild Main Knockout?\n\n${completed} completed Main Knockout match${completed===1?" has":"es have"} recorded results. Rebuilding will replace the draw and remove those recorded knockout results.\n\nThis cannot be undone automatically. Continue?`
      : `Rebuild Main Knockout?\n\n${stale.reason}\n\nThe existing draw will be replaced. Continue?`;
    if(!confirm(message))return {valid:false,error:"main_knockout_rebuild_cancelled"};
  }
  const result=applyMainKnockoutDraw();
  if(!result.valid){
    showMessage(result.error||"Main Knockout draw could not be generated.");
    renderKnockout();
    return result;
  }
  addHistory("Main Knockout draw generated",`${result.knockoutSize}-team draw`);
  renderKnockout();
  showMessage(`${result.knockoutSize}-team Main Knockout draw generated.`);
  return result;
}

function knockoutDisplayLabel(teamId){
  const team=tournament.teams.find(t=>String(t.id)===String(teamId));
  if(!team)return "";
  return teamDisplayLabel(team);
}

function knockoutRoundTitle(roundSize){
  return roundSize===2?"Final":
    roundSize===4?"Semi-final":
    roundSize===8?"Quarter-final":`Round of ${roundSize}`;
}

let selectedMainKnockoutMatchId=null;
let selectedKnockoutResultMatchType="main";

function getActiveMainKnockoutMatches(){
  const draw=getActiveMainKnockoutDraw();
  if(!draw?.rounds)return [];
  const matches=[];
  draw.rounds.forEach((round,roundIndex)=>{
    (round.matches||[]).forEach(match=>{
      matches.push({...match,roundIndex,roundName:round.name});
    });
  });
  return matches;
}

function getPlayableKnockoutMatches(){
  return getActiveMainKnockoutMatches().filter(m=>m.team1Id&&m.team2Id);
}

function mainKnockoutMatchById(matchId){
  const draw=getActiveMainKnockoutDraw();
  if(!draw?.rounds)return null;
  for(const round of draw.rounds){
    const match=(round.matches||[]).find(m=>String(m.id)===String(matchId));
    if(match)return match;
  }
  return null;
}

function renderKnockoutMatchSelector(playable,currentId){
  const el=$("knockoutMatchSelector");
  if(!el)return;
  el.innerHTML=playable.map(m=>{
    const a=mainKnockoutSlotLabel(m,1);
    const b=mainKnockoutSlotLabel(m,2);
    const selected=String(m.id)===String(currentId)?"selected":"";
    return `<option value="${escapeHtml(String(m.id))}" ${selected}>${escapeHtml(m.roundName||m.round||knockoutRoundTitle(m.roundSize))} · ${m.number||m.matchNumber}: ${a} vs ${b}</option>`;
  }).join("");
}

function nextPlayableKnockoutMatchId(currentId){
  const playable=getPlayableKnockoutMatches();
  const index=playable.findIndex(m=>String(m.id)===String(currentId));
  const ordered=index>=0?playable.slice(index+1).concat(playable.slice(0,index)):playable;
  return ordered.find(m=>!isGeneratedMatchResultComplete(m))?.id ?? null;
}

function selectMainKnockoutMatch(matchId,focusScore=true){
  const match=mainKnockoutMatchById(matchId);
  if(!match||!match.team1Id||!match.team2Id)return;
  selectedMainKnockoutMatchId=String(match.id);
  selectedKnockoutResultMatchType="main";
  renderMainKnockoutBracket();
  openFloatingScorecard("main",match.id,null,focusScore);
}

function selectThirdPlaceMatch(focusScore=true){
  const match=tournament.thirdPlacePlayoff;
  const desired=getThirdPlaceDesiredState();
  const stale=getStageStaleInfo("third-place");
  if(!match||!desired.ready||stale.stale||!desired.teamAId||!desired.teamBId)return;
  selectedKnockoutResultMatchType="third-place";
  renderMainKnockoutBracket();
  openFloatingScorecard("third-place",match.id||"thirdPlace", "third-place", focusScore);
}

function bindKnockoutMatchSelection(){
  const list=$("knockoutList");
  if(!list)return;
  list.querySelectorAll("[data-main-ko-match-id]").forEach(row=>{
    if(row.dataset.boundMainKo==="1")return;
    row.dataset.boundMainKo="1";
    row.addEventListener("click",()=>selectMainKnockoutMatch(row.dataset.mainKoMatchId));
    row.addEventListener("keydown",e=>{
      if(e.key!=="Enter"&&e.key!==" ")return;
      e.preventDefault();
      selectMainKnockoutMatch(row.dataset.mainKoMatchId);
    });
  });

  const thirdRow=list.querySelector("[data-third-place-match]");
  if(thirdRow && thirdRow.dataset.boundThirdPlace!=="1"){
    thirdRow.dataset.boundThirdPlace="1";
    thirdRow.addEventListener("click",()=>selectThirdPlaceMatch());
    thirdRow.addEventListener("keydown",e=>{
      if(e.key!=="Enter"&&e.key!==" ")return;
      e.preventDefault();
      selectThirdPlaceMatch();
    });
  }

  const selector=$("knockoutMatchSelector");
  if(selector && selector.dataset.boundMainKo!=="1"){
    selector.dataset.boundMainKo="1";
    selector.addEventListener("change",()=>selectMainKnockoutMatch(selector.value));
  }
}


function renderKnockoutResultEditor(selectedMatchId){
  const el=$("floatingScorecard");
  if(!el)return;
  if(floatingScorecardState.stage!=="main"&&floatingScorecardState.stage!=="third-place")return;

  const third=tournament.thirdPlacePlayoff;
  const thirdStale=getStageStaleInfo("third-place");

  if(floatingScorecardState.stage==="third-place" && selectedKnockoutResultMatchType==="third-place" && third&&!thirdStale.stale&&third.teamAId&&third.teamBId){
    const model=getThirdPlaceScoreboardViewModel();
    if(!model){closeFloatingScorecard();return;}
    el.dataset.matchId=String(model.matchId);
    el.dataset.matchType="third-place";
    renderScoreboardViewModel(el,model,{
      inputClass:"ko-third-score",
      cardClass:"group-result-editor-card ko-result-editor-card",
      actionClass:"ko-result-actions",
      contextTitle:"Knockout scoring / results:"
    });
    bindScoreboardActionBridge(el,model);
    bindScoreboardKeyboard(el,model);
    return;
  }

  const draw=getActiveMainKnockoutDraw();
  if(!draw?.rounds?.length){closeFloatingScorecard();return;}
  const playable=getPlayableKnockoutMatches();
  if(!playable.length){closeFloatingScorecard();return;}
  const desiredId=String(floatingScorecardState.matchId||selectedMatchId||"");
  const match=playable.find(m=>String(m.id)===desiredId);
  if(!match){closeFloatingScorecard();return;}
  selectedMainKnockoutMatchId=String(match.id);
  selectedKnockoutResultMatchType="main";

  const model=getMainKnockoutScoreboardViewModel(match.id);
  if(!model){el.innerHTML="";return;}
  el.dataset.matchId=String(model.matchId);
  el.dataset.matchType="main";
  renderScoreboardViewModel(el,model,{
    inputClass:"ko-result-score",
    cardClass:"group-result-editor-card ko-result-editor-card",
    actionClass:"ko-result-actions",
    contextTitle:"Knockout scoring / results:"
  });
  bindScoreboardActionBridge(el,model);
  bindScoreboardKeyboard(el,model);
}

function clearKnockoutResult(matchId){
  const match=mainKnockoutMatchById(matchId);
  if(!match)return;
  match.result=null;
  match.winnerTeamId=null;
  match.loserTeamId=null;
  match.score1=null;
  match.score2=null;
  match.status="pending";
  match.updatedAt=Date.now();

  // Recalculate every downstream match from its feeder results. This also
  // removes any winner that this match had previously propagated forward.
  const changedMatchIds=propagateMainKnockoutWinner(match);
  const draw=getActiveMainKnockoutDraw();
  if(draw)draw.updatedAt=Date.now();
  if(mainKnockoutResultAffectsThirdPlace(match.id,changedMatchIds)){
    invalidateCompetitionStagesFrom("main-knockout-result","A Main Knockout result changed the semifinal dependency chain.");
    syncThirdPlacePlayoffFromMainKnockout();
  }
  addHistory("Main Knockout result cleared",`Match ${match.number||match.matchNumber}`);
  saveLocal(true);
  refreshAfterKnockoutResult(match.id,changedMatchIds);
  showMessage("Knockout result cleared.");
}

function saveKnockoutResult(matchId){
  const match=mainKnockoutMatchById(matchId);
  if(!match||!match.team1Id||!match.team2Id)return;

  const bestOf=gameCountForMatch();
  const games=Array.from({length:bestOf},(_,i)=>{
    const a=$("floatingScorecard")?.querySelector(`.ko-result-score[data-game="${i}"][data-side="a"]`)?.value??"";
    const b=$("floatingScorecard")?.querySelector(`.ko-result-score[data-game="${i}"][data-side="b"]`)?.value??"";
    return {a:a===""?"":Number(a),b:b===""?"":Number(b)};
  });

  const normalized=normalizeMatchGames(games,bestOf);
  if(!normalized.valid){showMessage(normalized.error);return;}
  const winner=normalized.winner;
  const completedGames=normalized.games;

  match.result={games:completedGames,winnerSide:winner,updatedAt:Date.now()};
  match.winnerTeamId=winner==="a"?match.team1Id:match.team2Id;
  match.loserTeamId=winner==="a"?match.team2Id:match.team1Id;
  match.score1=completedGames[0]?.a??null;
  match.score2=completedGames[0]?.b??null;
  match.status="completed";
  match.updatedAt=Date.now();

  const changedMatchIds=propagateMainKnockoutWinner(match);
  const draw=getActiveMainKnockoutDraw();
  if(draw)draw.updatedAt=Date.now();
  if(mainKnockoutResultAffectsThirdPlace(match.id,changedMatchIds)){
    invalidateCompetitionStagesFrom("main-knockout-result","A Main Knockout result changed the semifinal dependency chain.");
  }
  syncThirdPlacePlayoffFromMainKnockout();
  addHistory("Main Knockout result saved",`Match ${match.number||match.matchNumber}`);
  saveLocal(true);
  refreshAfterKnockoutResult(match.id,changedMatchIds);
  showMessage("Knockout result saved. Winner progressed.");
}

function saveKnockoutWalkover(matchId,winnerTeamId,loserTeamId){
  const match=mainKnockoutMatchById(matchId);
  if(!match||!match.team1Id||!match.team2Id)return;
  if(String(winnerTeamId)!==String(match.team1Id)&&String(winnerTeamId)!==String(match.team2Id))return;

  match.winnerTeamId=winnerTeamId;
  match.loserTeamId=loserTeamId;
  match.result={games:[],walkover:true,updatedAt:Date.now()};
  match.status="completed";
  match.updatedAt=Date.now();

  const changedMatchIds=propagateMainKnockoutWinner(match);
  const draw=getActiveMainKnockoutDraw();
  if(draw)draw.updatedAt=Date.now();
  if(mainKnockoutResultAffectsThirdPlace(match.id,changedMatchIds)){
    invalidateCompetitionStagesFrom("main-knockout-result","A Main Knockout result changed the semifinal dependency chain.");
  }
  syncThirdPlacePlayoffFromMainKnockout();
  addHistory("Main Knockout walkover recorded",`Match ${match.number||match.matchNumber}`);
  saveLocal(true);
  refreshAfterKnockoutResult(match.id,changedMatchIds);
  showMessage("Walkover recorded. Winner progressed.");
}

function getThirdPlaceDesiredState(){
  const draw=getActiveMainKnockoutDraw();
  if(!draw?.rounds||draw.rounds.length<2)
    return {ready:false,reason:"main_knockout_not_available"};

  const semiRound=draw.rounds[draw.rounds.length-2];
  const semis=semiRound?.matches||[];
  if(semis.length!==2)
    return {ready:false,reason:"invalid_semifinal_structure"};

  const losers=semis.map(m=>isGeneratedMatchResultComplete(m)?m.loserTeamId||null:null);
  return {
    ready:Boolean(losers[0]&&losers[1]),
    teamAId:losers[0],
    teamBId:losers[1],
    signature:buildSignature(getThirdPlaceBuildInputs()),
    semis
  };
}

// Synchronisation is a mutation boundary. Rendering must not create, rewrite,
// or "bless" a generated playoff as current. This function is called after
// controlled Main Knockout changes and when explicitly building the stage.
function syncThirdPlacePlayoffFromMainKnockout(){
  const desired=getThirdPlaceDesiredState();
  const existing=tournament.thirdPlacePlayoff||null;
  const state=ensureStageBuildState();

  // The 3rd-place participants are derived data: they are always the current
  // losers of the two Main Knockout semifinals. If either semifinal becomes
  // unresolved, the playoff must no longer retain the old participants/result.
  if(!desired.ready){
    if(existing){
      const hadDerivedData=Boolean(existing.teamAId||existing.teamBId||existing.result||existing.winnerTeamId||existing.loserTeamId);
      existing.teamAId=null;
      existing.teamBId=null;
      existing.status="pending";
      existing.winnerTeamId=null;
      existing.loserTeamId=null;
      existing.result=null;
      existing.score1=null;
      existing.score2=null;
      existing.updatedAt=Date.now();
      if(hadDerivedData){
        state.thirdPlace={
          signature:null,
          invalidatedAt:Date.now(),
          invalidatedReason:"The Main Knockout semifinal losers are not both known yet."
        };
      }
    }
    return {changed:Boolean(existing),ready:false};
  }

  if(!existing){
    tournament.thirdPlacePlayoff={
      id:id("thirdPlace"),
      teamAId:desired.teamAId,
      teamBId:desired.teamBId,
      status:"pending",
      winnerTeamId:null,
      loserTeamId:null,
      result:null,
      createdAt:Date.now(),
      updatedAt:Date.now()
    };
    state.thirdPlace={
      signature:desired.signature,
      generatedAt:Date.now()
    };
    return {changed:true,ready:true,created:true};
  }

  const participantsMatch=
    String(existing.teamAId??"")===String(desired.teamAId??"") &&
    String(existing.teamBId??"")===String(desired.teamBId??"");

  if(!participantsMatch){
    // Upstream semifinal losers changed. Replace the derived participants
    // immediately and discard only the now-invalid 3rd-place result. The
    // 3rd-place playoff remains a separate domain object from Main Knockout.
    existing.teamAId=desired.teamAId;
    existing.teamBId=desired.teamBId;
    existing.status="pending";
    existing.winnerTeamId=null;
    existing.loserTeamId=null;
    existing.result=null;
    existing.score1=null;
    existing.score2=null;
    existing.updatedAt=Date.now();
    state.thirdPlace={
      signature:desired.signature,
      generatedAt:Date.now()
    };
    return {changed:true,ready:true,participantsChanged:true};
  }

  state.thirdPlace={
    signature:desired.signature,
    generatedAt:state.thirdPlace?.generatedAt||Date.now()
  };
  return {changed:false,ready:true};
}

function rebuildThirdPlacePlayoff(){
  const existing=tournament.thirdPlacePlayoff;
  if(!existing)return {valid:false,error:"third_place_not_available"};
  const completed=isThirdPlaceResultComplete(existing);
  const message=completed
    ? `⚠ Rebuild 3rd-place playoff?\n\nThe current 3rd-place result is based on an older Main Knockout semifinal structure. Rebuilding will clear its recorded result.\n\nThis cannot be undone automatically. Continue?`
    : `Rebuild 3rd-place playoff?\n\nThe playoff participants will be updated from the current Main Knockout semifinal structure. Continue?`;
  if(!confirm(message))return {valid:false,error:"third_place_rebuild_cancelled"};

  const desired=getThirdPlaceDesiredState();
  if(!desired.ready)return {valid:false,error:desired.reason||"third_place_not_ready"};
  existing.teamAId=desired.teamAId;
  existing.teamBId=desired.teamBId;
  existing.status="pending";
  existing.winnerTeamId=null;
  existing.loserTeamId=null;
  existing.result=null;
  existing.updatedAt=Date.now();
  ensureStageBuildState().thirdPlace={
    signature:buildSignature(getThirdPlaceBuildInputs()),
    generatedAt:Date.now()
  };
  addHistory("3rd-place playoff rebuilt","Current Main Knockout semifinal structure");
  saveLocal(true);
  refreshAfterThirdPlaceResult();
  showMessage("3rd-place playoff rebuilt.");
  return {valid:true};
}


function saveThirdPlaceResult(editor){
  const m=tournament.thirdPlacePlayoff;
  editor=editor||$("floatingScorecard");
  if(!editor)return;
  if(!m||!m.teamAId||!m.teamBId)return;

  const bestOf=gameCountForMatch();
  const games=Array.from({length:bestOf},(_,i)=>({
    a:(editor.querySelector(`.ko-third-score[data-game="${i}"][data-side="a"]`)?.value??"")===""?"":Number(editor.querySelector(`.ko-third-score[data-game="${i}"][data-side="a"]`)?.value),
    b:(editor.querySelector(`.ko-third-score[data-game="${i}"][data-side="b"]`)?.value??"")===""?"":Number(editor.querySelector(`.ko-third-score[data-game="${i}"][data-side="b"]`)?.value)
  }));

  const normalized=normalizeMatchGames(games,bestOf);
  if(!normalized.valid){showMessage(normalized.error);return;}
  const winner=normalized.winner;
  const completedGames=normalized.games;

  m.result={games:completedGames,winnerSide:winner,updatedAt:Date.now()};
  m.winnerTeamId=winner==="a"?m.teamAId:m.teamBId;
  m.loserTeamId=winner==="a"?m.teamBId:m.teamAId;
  m.status="completed";
  m.updatedAt=Date.now();
  addHistory("3rd-place result saved","Third-place playoff");
  saveLocal(true);
  refreshAfterThirdPlaceResult();
  showMessage("3rd-place result saved.");
}

function saveThirdPlaceWalkover(winnerTeamId,loserTeamId){
  const m=tournament.thirdPlacePlayoff;
  if(!m||!m.teamAId||!m.teamBId)return;
  if(String(winnerTeamId)!==String(m.teamAId)&&String(winnerTeamId)!==String(m.teamBId))return;

  m.result={games:[],walkover:true,updatedAt:Date.now()};
  m.winnerTeamId=winnerTeamId;
  m.loserTeamId=loserTeamId;
  m.status="completed";
  m.updatedAt=Date.now();
  addHistory("3rd-place walkover recorded","Third-place playoff");
  saveLocal(true);
  refreshAfterThirdPlaceResult();
  showMessage("3rd-place walkover recorded.");
}

function clearThirdPlaceResult(){
  const m=tournament.thirdPlacePlayoff;
  if(!m)return;
  m.result=null;
  m.winnerTeamId=null;
  m.loserTeamId=null;
  m.status="pending";
  m.updatedAt=Date.now();
  addHistory("3rd-place result cleared","Third-place playoff");
  saveLocal(true);
  refreshAfterThirdPlaceResult();
  showMessage("3rd-place result cleared.");
}

function getCategoryReflectiveColor(categoryName){
  const text=String(categoryName||"Internal");
  let hash=0;
  for(let i=0;i<text.length;i++)hash=((hash<<5)-hash)+text.charCodeAt(i)|0;
  const hue=Math.abs(hash)%360;
  return `hsl(${hue} 72% 62%)`;
}



function mainKnockoutTeamLabel(team, rankingRow, sourceLabel=""){
  if(!team&&!rankingRow)return "";
  const resolvedTeam=rankingRow?.team||team||null;
  const players=resolvedTeam&&typeof preliminaryTeamPlayers==="function"
    ? preliminaryTeamPlayers(resolvedTeam)
    : (resolvedTeam&&Array.isArray(resolvedTeam.players)?resolvedTeam.players.join(", "):(resolvedTeam?.playerNames||resolvedTeam?.playersText||""));
  const source=sourceLabel||((rankingRow?.groupLetter&&rankingRow?.groupRank!=null)
    ? `${rankingRow.groupLetter}${rankingRow.groupRank}` : "");
  return source ? (players ? `${source} ${players}` : source) : (players||"");
}

function mainKnockoutSourceLabel(match,side){
  if(!match)return "Waiting";
  const source=side===1?(match.source1Label||"Waiting"):(match.source2Label||"Waiting");
  return mainKnockoutFeederLabel(source);
}
function mainKnockoutFeederLabel(id){
  const s=String(id||"");
  return s.replace(/^R\d+-/,"");
}

function mainKnockoutScorePlayerLabel(match,side){
  if(!match)return "Waiting";
  const teamId=side===1?match.team1Id:match.team2Id;
  if(!teamId)return mainKnockoutSourceLabel(match,side);
  const team=tournament.teams.find(t=>String(t.id)===String(teamId));
  if(!team)return mainKnockoutSourceLabel(match,side);
  const players=preliminaryTeamPlayers(team);
  return escapeHtml(players||"Waiting");
}

function mainKnockoutSlotLabel(match,side){
  if(!match)return "Waiting";
  const teamId=side===1?match.team1Id:match.team2Id;
  const source=mainKnockoutSourceLabel(match,side);
  if(!teamId)return source;
  const team=tournament.teams.find(t=>String(t.id)===String(teamId));
  if(!team)return source;
  return mainKnockoutTeamLabel(team,null,source);
}

function propagateMainKnockoutWinner(match){
  const draw=getActiveMainKnockoutDraw();
  if(!draw?.rounds||!match)return [];
  const location=getMainKnockoutMatchLocation(match.id);
  if(!location)return [];
  const changedMatchIds=[];
  for(let r=location.roundIndex+1;r<draw.rounds.length;r++){
    const previous=draw.rounds[r-1].matches||[];
    const current=draw.rounds[r].matches||[];
    current.forEach((nextMatch,index)=>{
      const feederA=previous[index*2],feederB=previous[index*2+1];
      if(!feederA||!feederB)return;
      const nextTeam1=isGeneratedMatchResultComplete(feederA)?(feederA.winnerTeamId||null):null;
      const nextTeam2=isGeneratedMatchResultComplete(feederB)?(feederB.winnerTeamId||null):null;
      const source1=knockoutSourceForMatch(r-1,feederA);
      const source2=knockoutSourceForMatch(r-1,feederB);
      const changed=String(nextMatch.team1Id??"")!==String(nextTeam1??"")||String(nextMatch.team2Id??"")!==String(nextTeam2??"")||nextMatch.source1Label!==source1||nextMatch.source2Label!==source2;
      nextMatch.feederMatch1Id=feederA.id;nextMatch.feederMatch2Id=feederB.id;
      nextMatch.source1Type="MATCH";nextMatch.source2Type="MATCH";
      nextMatch.source1Id=feederA.id;nextMatch.source2Id=feederB.id;
      nextMatch.source1Label=source1;nextMatch.source2Label=source2;
      if(changed){
        nextMatch.team1Id=nextTeam1;nextMatch.team2Id=nextTeam2;
        nextMatch.status="pending";nextMatch.winnerTeamId=null;nextMatch.loserTeamId=null;nextMatch.result=null;nextMatch.score1=null;nextMatch.score2=null;
        changedMatchIds.push(String(nextMatch.id));
      }
      nextMatch.updatedAt=Date.now();
    });
  }
  return changedMatchIds;
}
function getMainKnockoutMatchLocation(matchId){
  const draw=getActiveMainKnockoutDraw();
  if(!draw?.rounds)return null;
  for(let roundIndex=0;roundIndex<draw.rounds.length;roundIndex++){
    const matchIndex=(draw.rounds[roundIndex].matches||[]).findIndex(m=>String(m.id)===String(matchId));
    if(matchIndex>=0)return {roundIndex,matchIndex};
  }
  return null;
}

function renderMainKnockoutAllocation(){
  const host=$("mainKnockoutAllocation");if(!host)return;
  const plan=buildMainKnockoutEntryPlan();
  if(!plan.knockoutSize){host.innerHTML="";return;}
  const feed=syncMainKnockoutEntries();
  const feedBySlot=new Map((feed.entries||[]).map(e=>[Number(e.slot),e]));
  const direct=plan.directEntries,preliminary=plan.preliminaryEntries;
  const ranking=calculateTournamentRanking();
  const rankingByTeamId=new Map(ranking.map(r=>[String(r.teamId??r.id),r]));
  const displayTeam=entry=>{
    const fed=feedBySlot.get(Number(entry.slot));
    if(fed?.teamId){
      const row=rankingByTeamId.get(String(fed.teamId));
      if(row)return mainKnockoutTeamLabel(row.team||null,row,entry.sourceLabel);
    }
    return entry.sourceLabel||"Waiting";
  };
  let html=`<details class="card main-ko-allocation-card"><summary><strong>🎯 Main Knockout allocation</strong></summary><div class="main-ko-allocation-content"><div class="muted">${plan.knockoutSize}-team Main Knockout · ${direct.length} advanced teams · ${preliminary.length} Pre-Knockout winners</div><div class="main-ko-allocation-section"><strong>Advanced to knockout</strong><div class="main-ko-allocation-list">`;
  html+=direct.length?direct.map(entry=>`<div class="main-ko-allocation-row"><span class="main-ko-slot">${entry.slot}.</span><span class="main-ko-team">${escapeHtml(displayTeam(entry))}</span><span class="main-ko-source"></span></div>`).join(""):"<div class='muted'>No teams advanced to knockout.</div>";
  html+=`</div></div><div class="main-ko-allocation-section"><strong>Pre-Knockout winners</strong><div class="main-ko-allocation-list">`;
  html+=preliminary.length?preliminary.map(entry=>`<div class="main-ko-allocation-row"><span class="main-ko-slot">${entry.slot}.</span><span class="main-ko-team">${escapeHtml(displayTeam(entry))}</span><span class="main-ko-source">${entry.sourceLabel}</span></div>`).join(""):"<div class='muted'>No Pre-Knockout allocation required.</div>";
  html+=`</div></div><div class="main-ko-allocation-note muted">This is the Main Knockout entry allocation only. The final knockout draw is not performed here.</div></div></details>`;
  host.innerHTML=html;
}

function renderMainKnockoutMatchElement(match){
  if(!match)return null;
  const playable=Boolean(match.team1Id&&match.team2Id);
  const selected=String(match.id)===String(selectedMainKnockoutMatchId);
  const completed=isGeneratedMatchResultComplete(match);
  const winnerId=completed&&match.winnerTeamId?String(match.winnerTeamId):"";
  const aWin=completed&&winnerId===String(match.team1Id);
  const bWin=completed&&winnerId===String(match.team2Id);
  const html=`<div class="fixture-number main-ko-match-number">${match.number}.</div><div class="fixture-teams"><strong class="participant-label ${aWin?"winner-team":""}">${escapeHtml(mainKnockoutSlotLabel(match,1))}</strong><span class="match-vs">VS</span><strong class="participant-label ${bWin?"winner-team":""}">${escapeHtml(mainKnockoutSlotLabel(match,2))}</strong></div><span class="badge main-ko-status">${completed?"✓":"—"}</span>`;
  return {html,playable,selected};
}

function updateMainKnockoutMatchElement(match){
  const host=$("knockoutList");
  if(!host||!match)return;
  const el=host.querySelector(`[data-main-ko-match-id="${CSS.escape(String(match.id))}"]`);
  const rendered=renderMainKnockoutMatchElement(match);
  if(!el||!rendered)return;
  el.className=`fixture-row main-ko-match ${rendered.playable?"main-ko-match-selectable":""} ${rendered.selected?"main-ko-match-selected":""}`;
  el.setAttribute("role",rendered.playable?"button":"presentation");
  el.setAttribute("tabindex",rendered.playable?"0":"-1");
  el.innerHTML=rendered.html;
}

function renderThirdPlaceBracketSection(){
  const desired=getThirdPlaceDesiredState();
  const m=tournament.thirdPlacePlayoff||null;
  const teamAId=desired.teamAId||null;
  const teamBId=desired.teamBId||null;
  const completed=m?isThirdPlaceResultComplete(m):false;
  const a=teamAId?knockoutDisplayLabel(teamAId):"TBD";
  const b=teamBId?knockoutDisplayLabel(teamBId):"TBD";
  const aWin=completed&&String(m.winnerTeamId)===String(teamAId);
  const bWin=completed&&String(m.winnerTeamId)===String(teamBId);
  const status=completed?"✓":"—";
  const selectable=Boolean(teamAId&&teamBId&&!getStageStaleInfo("third-place").stale);
  const selected=selectedKnockoutResultMatchType==="third-place";
  return `<section class="main-ko-round main-ko-third-place-round"><h4>3rd-place</h4><div class="fixture-row main-ko-match ${selectable?"main-ko-match-selectable":""} ${selected?"main-ko-match-selected":""}" data-third-place-match="1" role="${selectable?"button":"presentation"}" tabindex="${selectable?"0":"-1"}">
    <div class="fixture-number main-ko-match-number">1.</div><div class="fixture-teams"><strong class="participant-label ${aWin?"winner-team":""}">${escapeHtml(a)}</strong><span class="match-vs">VS</span><strong class="participant-label ${bWin?"winner-team":""}">${escapeHtml(b)}</strong></div><span class="badge main-ko-status">${status}</span>
  </div></section>`;
}

function renderMainKnockoutBracket(){
  const draw=getActiveMainKnockoutDraw();
  const list=$("knockoutList");
  if(!list)return;
  if(!draw){
    list.innerHTML=`<div class="muted knockout-draw-pending">Main Knockout draw has not been generated yet.</div>`;
    return;
  }
  const rounds=[];
  draw.rounds.forEach(round=>{
    rounds.push(`<section class="main-ko-round" data-main-ko-round-index="${round.index??""}"><h4>${escapeHtml(round.name)}</h4>${(round.matches||[]).map(m=>{const rendered=renderMainKnockoutMatchElement(m);return `<div class="fixture-row main-ko-match ${rendered.playable?"main-ko-match-selectable":""} ${rendered.selected?"main-ko-match-selected":""}" data-main-ko-match-id="${escapeHtml(String(m.id))}" role="${rendered.playable?"button":"presentation"}" tabindex="${rendered.playable?"0":"-1"}">${rendered.html}</div>`;}).join("")}</section>`);
  });
  // 3rd place is a separate tournament entity, but it is displayed after the
  // Main Knockout Final so the winner path remains visually contiguous.
  rounds.push(renderThirdPlaceBracketSection());
  list.innerHTML=rounds.join("");
  bindKnockoutMatchSelection();
}

function refreshMainKnockoutBracketFromResult(matchId,changedMatchIds=[]){
  const draw=getActiveMainKnockoutDraw();
  const list=$("knockoutList");
  if(!draw||!list){renderMainKnockoutBracket();return;}
  const ids=new Set([String(matchId),...changedMatchIds.map(String)]);
  ids.forEach(id=>{
    const match=mainKnockoutMatchById(id);
    if(match)updateMainKnockoutMatchElement(match);
  });

  // Main Knockout results can change the semifinal losers that feed the
  // separate 3rd-place playoff. Reconcile the dependency first, then replace
  // only the 3rd-place bracket section so the UI reflects the new participants
  // without rebuilding the whole Main Knockout bracket.
  if(mainKnockoutResultAffectsThirdPlace(matchId,changedMatchIds)){
    syncThirdPlacePlayoffFromMainKnockout();
  }
  const thirdSection=list.querySelector(".main-ko-third-place-round");
  if(thirdSection)thirdSection.outerHTML=renderThirdPlaceBracketSection();
  bindKnockoutMatchSelection();
}

function renderKnockout(){
  syncMainKnockoutEntries();
  const structure=getKnockoutStructure();
  const stageStale=getStageStaleInfo("main-knockout");
  const info=$("knockoutStructureInfo");
  if(info){
    if(structure.mainKnockoutSize){
      const q=Number(structure.qualifiedTeams)||0;
      const direct=Number(structure.directTeams)||0;
      const prelim=Number(structure.preliminaryTeams)||0;
      info.textContent=`${structure.mainKnockoutSize}-team bracket · ${q} qualified · ${direct} advanced teams · ${prelim} Pre-Knockout`;
    }else{
      info.textContent="Waiting for qualification";
    }
  }
  const validationPlan=buildMainKnockoutEntryPlan();
  const validation=validateMainKnockoutEntryPlan(validationPlan);
  const buildBtn=$("buildKnockoutBtn");
  const existingDraw=getActiveMainKnockoutDraw();
  if(buildBtn){
    // Main Knockout is an action only when a complete, valid entry plan is
    // actually available. Do not show a disabled Build button while waiting
    // for qualification or unresolved Pre-Knockout winners.
    const showBuildAction=validation.valid && (!existingDraw || stageStale.stale);
    buildBtn.style.display=showBuildAction ? "" : "none";
    buildBtn.textContent=stageStale.stale && existingDraw ? "Rebuild Knockout" : "Build Knockout";
    buildBtn.disabled=!showBuildAction;
    buildBtn.title=!validation.valid
      ? validation.errors.join(" ")
      : stageStale.stale
        ? (stageStale.reason||"The generated Main Knockout is stale.")
        : existingDraw ? "Main Knockout is already built." : "Build the Main Knockout draw";
  }
  const staleParent=info?.parentElement;
  if(staleParent){
    staleParent.querySelector(".stage-build-warning")?.remove();
    if(stageStale.stale){
      const warning=document.createElement("div");
      warning.className="preliminary-regenerate-warning stage-build-warning";
      warning.innerHTML=`<strong>⚠ Main Knockout needs rebuilding</strong><div class="muted">${escapeHtml(stageStale.reason)}</div>`;
      staleParent.appendChild(warning);
    }
  }
  renderMainKnockoutAllocation();
  renderMainKnockoutBracket();
  const editor=$("knockoutResultEditor");
  if(editor){
    const draw=getActiveMainKnockoutDraw();
    if(!draw)editor.innerHTML=`<div class="muted knockout-scoring-pending">Main Knockout scoring will be available after the Main Knockout draw is generated.</div>`;
    else renderKnockoutResultEditor(selectedKnockoutResultMatchType==="third-place"?"thirdPlace":selectedMainKnockoutMatchId);
  }
  const bye=$("knockoutByeResolution");
  if(bye)bye.innerHTML="";
}



function resetCompetitionState(){
  // Groups/teams/players are foundational state. Rebuilding them invalidates
  // every downstream competition artifact derived from those entities.
  tournament.fixtures=[];
  tournament.results=[];
  tournament.globalRankingLottery={};
  tournament.manualKnockoutTeams=[];
  tournament.preliminaryRound=null;
  tournament.mainKnockoutEntries=[];
  tournament.mainKnockoutEntriesUpdatedAt=null;
  tournament.mainKnockoutDraw=null;
  tournament.thirdPlacePlayoff=null;
  // Team Pool entries are setup input and must survive group creation/rebuild.
  // Rebuilding groups invalidates only the committed distribution into those groups.
  tournament.settings.teamPoolCommittedIds=[];
  tournament.settings.teamPoolDistributionComplete=false;
  tournament.settings.teamPoolDistributionCounts={};
  tournament.settings.teamPoolLotteryInputSignature='';
  tournament.stageBuildState={
    groupFixtures:{},
    preliminary:null,
    mainKnockout:null,
    thirdPlace:null
  };
}

function createGroups(){
  const requested=Math.max(1,Math.min(52,Number($("groupCount").value)||1));
  const current=tournament.groups||[];
  const currentCount=current.length;
  const previousDefaultQualifiers=Math.max(0,Number(tournament.settings?.defaultQualifiers)||0);
  const defaultQualifiers=Math.max(0,Number($("defaultQualifiers")?.value)||0);
  const qualifiersChanged=defaultQualifiers!==previousDefaultQualifiers;

  // Group count is structural configuration, not a "rebuild everything" command.
  // Existing groups keep their IDs, teams, players, fixtures and results. Only
  // newly-added groups are created, or trailing groups are removed when the
  // count is reduced.
  if(requested===currentCount){
    tournament.settings.defaultQualifiers=defaultQualifiers;
    if(qualifiersChanged){
      tournament.groups.forEach(g=>{
        g.directQualifiers=defaultQualifiers;
        g.qualifierOverridden=false;
        g.updatedAt=Date.now();
      });
    }
    addHistory("Group settings saved",`${requested} group${requested===1?"":"s"}${qualifiersChanged?` · qualifiers ${defaultQualifiers}`:""}`);
    saveLocal(true);
    refreshControlled("group-change");
    const feedback=$("groupCreateFeedback");
    if(feedback){feedback.textContent=`${requested} group${requested===1?"":"s"} unchanged.`;feedback.style.display="block";}
    return;
  }

  if(requested>currentCount){
    if(qualifiersChanged){
      tournament.groups.forEach(g=>{
        g.directQualifiers=defaultQualifiers;
        g.qualifierOverridden=false;
        g.updatedAt=Date.now();
      });
    }
    for(let i=currentCount;i<requested;i++){
      tournament.groups.push({
        id:id("group"),
        name:groupLabel(i),
        teamCount:0,
        updatedAt:Date.now()+i,
        directQualifiers:defaultQualifiers,
        qualifierOverridden:false,
        teams:[],
        fixtures:[],
        results:[],
        knockout:[],
        rules:{roundRobin:"once"}
      });
    }
    tournament.settings.defaultQualifiers=defaultQualifiers;
    addHistory("Group added",`${currentCount} → ${requested}`);
  }else{
    const removedGroups=current.slice(requested);
    const teamsToRemove=tournament.teams.filter(team=>removedGroups.some(group=>String(group.id)===String(team.groupId)));
    const removedTeamIds=new Set(teamsToRemove.map(team=>String(team.id)));
    const removedPlayerIds=new Set(teamsToRemove.flatMap(team=>Array.isArray(team.playerIds)?team.playerIds:[]).map(String));
    const removedFixtureIds=new Set((tournament.fixtures||[])
      .filter(f=>removedGroups.some(group=>String(group.id)===String(f.groupId)))
      .map(f=>String(f.id)));

    if((teamsToRemove.length||removedFixtureIds.size) && !confirm(
      `Reducing groups from ${currentCount} to ${requested} will remove ${removedGroups.length} trailing group${removedGroups.length===1?"":"s"}`+
      `${teamsToRemove.length?` and ${teamsToRemove.length} team${teamsToRemove.length===1?"":"s"}`:""}`+
      `${removedFixtureIds.size?` plus ${removedFixtureIds.size} group fixture${removedFixtureIds.size===1?"":"s"}`:""}. Continue?`)){
      $("groupCount").value=String(currentCount);
      return;
    }

    tournament.teams=tournament.teams.filter(team=>!removedTeamIds.has(String(team.id)));
    tournament.players=tournament.players.filter(player=>!removedPlayerIds.has(String(player.id)));
    tournament.fixtures=(tournament.fixtures||[]).filter(f=>!removedFixtureIds.has(String(f.id)));
    tournament.results=(tournament.results||[]).filter(r=>!removedFixtureIds.has(String(r.fixtureId)));
    tournament.groups=current.slice(0,requested);
    tournament.settings.defaultQualifiers=defaultQualifiers;
    if(qualifiersChanged){
      tournament.groups.forEach(g=>{
        g.directQualifiers=defaultQualifiers;
        g.qualifierOverridden=false;
        g.updatedAt=Date.now();
      });
    }

    // A group-count change alters qualification/distribution structure. Preserve
    // all remaining teams and Team Pool input, but invalidate derived stages.
    ensureTeamPoolState();
    tournament.settings.teamPoolCommittedIds=(tournament.settings.teamPoolCommittedIds||[])
      .filter(teamId=>tournament.teams.some(team=>String(team.id)===String(teamId)));
    tournament.settings.teamPoolDistributionComplete=false;
    tournament.settings.teamPoolDistributionCounts={};
    tournament.settings.teamPoolLotteryInputSignature='';
    tournament.groups.forEach(group=>{
      group.teamCount=tournament.teams.filter(team=>String(team.groupId)===String(group.id)).length;
      group.updatedAt=Date.now();
    });
    addHistory("Group removed",`${currentCount} → ${requested}`);
  }

  invalidateCompetitionStagesFrom("group-fixtures","Group structure changed; remaining groups and teams were preserved.");
  saveLocal(true);
  refreshControlled("group-change");
  const feedback=$("groupCreateFeedback");
  if(feedback){feedback.textContent=`${requested} group${requested===1?"":"s"} configured. Existing data preserved.`;feedback.style.display="block";}
}

function changeGroupTeamCount(groupId,value){
  const g=tournament.groups.find(x=>x.id===groupId);
  if(!g)return;
  const requested=Math.max(0,Number(value)||0);
  const existing=tournament.teams.filter(t=>t.groupId===groupId).sort((a,b)=>a.number-b.number);

  if(requested<existing.length){
    if(!confirm("Reducing this group will remove the last "+(existing.length-requested)+" team(s) and their players. Continue?")){
      refreshControlled("group-change");return;
    }
    const removeIds=existing.slice(requested).map(t=>t.id);
    const removed=tournament.teams.filter(t=>removeIds.includes(t.id));
    const playerIds=removed.flatMap(t=>t.playerIds);
    tournament.teams=tournament.teams.filter(t=>!removeIds.includes(t.id));
    tournament.players=tournament.players.filter(p=>!playerIds.includes(p.id));
  }

  g.teamCount=requested;
  g.updatedAt=Date.now();
  const remaining=tournament.teams.filter(t=>t.groupId===groupId);
  for(let n=1;n<=requested;n++){
    if(!remaining.some(t=>t.number===n)){
      tournament.teams.push({
        id:id("team"),number:n,name:"Team "+n,displayName:"",
        format:modeToTeamFormat(tournament.settings?.mode||"doubles"),playerIds:[],groupId
      });
    }
  }
  addHistory("Group team count changed",g.name+" → "+requested);
  invalidateGroupFixtureStage(groupId,"Group membership changed; rebuild affected generated stages before continuing.");
  saveLocal(true);refreshControlled("group-change");
}

function applyDefaultQualifiers(){
  const value=Math.max(0,Number($("defaultQualifiers").value)||0);
  tournament.settings.defaultQualifiers=value;
  tournament.groups.forEach(g=>{
    g.directQualifiers=value;
    g.qualifierOverridden=false;
  });
  addHistory("Default qualifiers applied",String(value));
  saveLocal(true);
  refreshControlled("settings-change");
  showMessage("Default qualifier applied to all groups.");
}

function changeGroupQualifiers(groupId,value){
  const g=tournament.groups.find(x=>x.id===groupId);
  if(!g)return;
  g.directQualifiers=Math.max(0,Number(value)||0);
  g.qualifierOverridden=true;
  g.updatedAt=Date.now();
  addHistory("Group qualifier override",g.name+" → "+g.directQualifiers);
  invalidateCompetitionStagesFrom("group-fixtures","Group qualification settings changed.");
  saveLocal(true);refreshControlled("group-change");
}

function removeGroup(groupId){
  const g=tournament.groups.find(x=>x.id===groupId);
  if(!g)return;
  const teams=tournament.teams.filter(t=>t.groupId===groupId);
  const message=teams.length
    ? "Remove "+g.name+" and its "+teams.length+" team(s) and players?"
    : "Remove "+g.name+"?";
  if(!confirm(message))return;

  const playerIds=teams.flatMap(t=>t.playerIds);
  tournament.teams=tournament.teams.filter(t=>t.groupId!==groupId);
  tournament.players=tournament.players.filter(p=>!playerIds.includes(p.id));
  tournament.groups=tournament.groups.filter(x=>x.id!==groupId);

  addHistory("Group removed",g.name);
  invalidateCompetitionStagesFrom("group-fixtures","A group was removed.");
  saveLocal(true);
  refreshControlled("group-change");
}

function addTeam(){
  const groupId=$("entryGroup").value;
  const format=modeToTeamFormat(tournament.settings?.mode||"doubles");
  if(!groupId){showMessage("Create and select a group first.","warning");return;}

  const inputs=[...document.querySelectorAll(".player-entry")];
  const names=inputs.map(i=>i.value.trim()).filter(Boolean);

  if(format==="singles" && names.length!==1){
    showMessage("Singles requires exactly one player.","warning");return;
  }
  if(format==="doubles" && names.length!==2){
    showMessage("Doubles requires exactly two players.","warning");return;
  }
  if(format==="team" && names.length<1){
    showMessage("Enter at least one player.","warning");return;
  }

  const group=tournament.groups.find(g=>g.id===groupId);
  const existing=tournament.teams.filter(t=>t.groupId===groupId);
  const number=(existing.length?Math.max(...existing.map(t=>t.number)):0)+1;

  const playerIds=names.map(name=>{
    const p={id:id("player"),name};
    tournament.players.push(p);
    return p.id;
  });

  tournament.teams.push({
    id:id("team"),number,name:"Team "+number,displayName:"",
    format,playerIds,groupId,createdAt:Date.now(),updatedAt:Date.now()
  });
  group.teamCount=Math.max(group.teamCount||0,existing.length+1);
  group.updatedAt=Date.now();

  addHistory("Team added",`${group.name} / Team ${number}`);
  invalidateGroupFixtureStage(groupId,"A team was added to the group.");
  saveLocal(true);
  refreshControlled("team-change");

  // Keep group and format selected; clear the player fields for rapid entry.
  $("entryGroup").value=groupId;
  renderPlayerEntryFields();
  const first=document.querySelector(".player-entry");
  if(first)first.focus();
}

function editTeam(teamId){
  const t=tournament.teams.find(x=>x.id===teamId);
  if(!t)return;

  // All tournament teams use the same player-editing UX, regardless of origin.
  // Team Pool teams are synchronised back to their source entry below so there
  // is only one logical set of player names for the team.
  const current=t.playerIds.map(pid=>tournament.players.find(p=>p.id===pid)?.name||"").filter(Boolean).join(", ");
  const entered=prompt("Edit player names for Team "+t.number+". Separate names with commas.",current);
  if(entered===null)return;
  const names=entered.split(",").map(x=>x.trim()).filter(Boolean);
  if(t.format==="singles" && names.length!==1){showMessage("Singles requires exactly one player.","warning");return;}
  if(t.format==="doubles" && names.length!==2){showMessage("Doubles requires exactly two players.","warning");return;}
  if(t.format==="team" && names.length<1){showMessage("A team needs at least one player.","warning");return;}

  const oldIds=new Set(t.playerIds);
  const oldPlayers=t.playerIds.map(pid=>tournament.players.find(p=>p.id===pid)).filter(Boolean);
  const oldNames=oldPlayers.map(p=>p.name||"");
  const changed=names.length!==oldNames.length || names.some((name,i)=>name!==oldNames[i]);

  // Player Pool is the source of truth. If a generated team is edited,
  // synchronize the exact source entry by persistent ID first, then invalidate
  // the generated teams so the next lottery uses the edited input. Never match
  // by player name because duplicate names are valid.
  if(changed && t.playerPoolGenerated){
    const sources=oldPlayers.map(p=>p.playerPoolSource);
    const validSources=sources.length===oldPlayers.length && sources.every(source=>{
      if(!source?.entryId)return false;
      return (tournament.playerPoolPlayers||[]).some(pool=>
        Array.isArray(pool)&&pool.some(entry=>String(entry?.id)===String(source.entryId))
      );
    });
    if(!validSources){
      showMessage("This Player Pool team has no valid source mapping. Edit the Player Pool entry directly before running the lottery again.","warning");
      return;
    }

    sources.forEach((source,index)=>{
      for(const pool of (tournament.playerPoolPlayers||[])){
        const entry=Array.isArray(pool)?pool.find(item=>String(item?.id)===String(source.entryId)):null;
        if(entry){entry.name=names[index];break;}
      }
    });

    invalidatePlayerPoolBuild();
    addHistory("Player Pool team edited",t.name);
    saveLocal(true);
    refreshControlled("team-change");
    renderPlayerPools();
    renderPlayerPoolBuildArea();
    return;
  }

  if(changed && t.teamPoolEntry){
    ensureTeamPoolState();
    const entry=tournament.settings.teamPoolEntries.find(x=>String(x.id)===String(t.teamPoolEntryId));
    if(entry){
      entry.playerNames=[...names];
      entry.player1=names[0]||"";
      entry.player2=names[1]||"";
      entry.updatedAt=Date.now();
    }
    // Editing a Team Pool-derived team changes the lottery input dataset.
    // Invalidate the previous distribution so the lottery must be run again.
    invalidateTeamPoolLottery();
  }

  tournament.players=tournament.players.filter(p=>!oldIds.has(p.id));
  t.playerIds=names.map(name=>{
    const p={id:id("player"),name};
    tournament.players.push(p);
    return p.id;
  });
  t.updatedAt=Date.now();
  const editedGroup=tournament.groups.find(g=>g.id===t.groupId);
  if(editedGroup)editedGroup.updatedAt=Date.now();
  addHistory("Team players edited",t.name);
  saveLocal(true);
  refreshControlled("team-change");
  renderTeamPool();
}

function removeTeam(teamId){
  const t=tournament.teams.find(x=>x.id===teamId);
  if(!t)return;
  if(!confirm("Remove Team "+t.number+" and its players?"))return;
  const ids=new Set(t.playerIds);
  tournament.players=tournament.players.filter(p=>!ids.has(p.id));
  tournament.teams=tournament.teams.filter(x=>x.id!==teamId);
  ensureTeamPoolState();
  if(t.teamPoolEntry){
    tournament.settings.teamPoolCommittedIds=tournament.settings.teamPoolCommittedIds.filter(id=>String(id)!==String(teamId));
    tournament.settings.teamPoolNames=tournament.settings.teamPoolNames.filter(name=>String(name).trim().toLowerCase().replace(/\s+/g," ")!==String(t.name||"").trim().toLowerCase().replace(/\s+/g," "));
    if(!tournament.settings.teamPoolCommittedIds.length){
      tournament.settings.teamPoolDistributionComplete=false;
    }
  }
  const g=tournament.groups.find(x=>x.id===t.groupId);
  if(g){
    const remaining=tournament.teams
      .filter(x=>x.groupId===g.id)
      .sort((a,b)=>a.number-b.number);
    remaining.forEach((team,index)=>{
      team.number=index+1;
      if(!team.teamPoolEntry)team.name="Team "+team.number;
      team.updatedAt=Date.now();
    });
    g.teamCount=remaining.length;
    g.updatedAt=Date.now();
  }
  addHistory("Team removed",t.name);
  invalidateGroupFixtureStage(t.groupId,"A team was removed from the group.");
  saveLocal(true);refreshControlled("team-change");
}

function newTournament(){
  if(!confirm("Start a new tournament? Unsaved local data in all categories will be replaced."))return;
  tournament=blankTournament();
  masterTournament=buildMasterFromLegacy(tournament);
  window.BADMINTON_LOCAL?.write(JSON.stringify(masterTournament));
  renderAll();
  showMessage("New tournament created.");
}

function importTournamentFile(file){
  if(!file)return;
  if(!confirm("Importing this JSON will replace the current tournament data. Continue?"))return;
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const parsed=JSON.parse(String(reader.result||""));
      if(!parsed || typeof parsed!=="object" || Array.isArray(parsed))throw new Error("Invalid JSON object");
      // Master exports use masterSchemaVersion; legacy single-category exports use schemaVersion.
      // normalizeMasterRecord() handles both formats, so do not reject a valid master export here.
      if(parsed.type!=="badmintonTournamentManagerMaster" && !parsed.schemaVersion)
        throw new Error("Missing tournament schema version");
      masterTournament=normalizeMasterRecord(parsed);
      const active=getActiveCategoryRecord();
      tournament=migrateTournamentData(active.data);
      tournament.clubName=masterTournament.clubName||"";
      tournament.settings=tournament.settings||{};
      tournament.settings.categories=[{id:String(active.id),name:String(active.name||"Internal").trim()||"Internal"}];
      syncThirdPlacePlayoffFromMainKnockout();
      // Do not call saveLocal() here: saveLocal() reads the current form controls.
      // Restore the imported master directly, then render the selected category.
      saveActiveCategoryToMaster();
      window.BADMINTON_LOCAL?.write(JSON.stringify(masterTournament));
      renderAll();
      showMessage("Tournament master JSON imported.");
    }catch(e){
      console.error(e);
      showMessage("Tournament JSON could not be imported.","warning");
    }finally{
      const input=$("importFile");
      if(input)input.value="";
    }
  };
  reader.onerror=()=>{
    const input=$("importFile");
    if(input)input.value="";
    showMessage("Tournament JSON could not be read.","warning");
  };
  reader.readAsText(file);
}

function openImportFile(){
  const input=$("importFile");
  if(!input)return;
  input.value="";
  input.click();
}

function exportJson(){
  syncSettings();
  addHistory("Tournament exported");
  saveLocal(true);
  const exportData=deepClone(masterTournament||buildMasterFromLegacy(tournament));
  const blob=new Blob([JSON.stringify(exportData,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;
  a.download=(masterTournament?.clubName||tournament.clubName||"badminton-tournament").replace(/[^a-z0-9_-]+/gi,"_")+".json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showMessage("Tournament master JSON exported.");
}

window.applyCloudSnapshotInternal=function(snapshot){if(!snapshot||typeof snapshot!=='object')return;try{masterTournament=normalizeMasterRecord(deepClone(snapshot));tournament=loadActiveCategoryFromMaster();if(!tournament)tournament=buildDefaultTournament();window.BADMINTON_LOCAL?.write(JSON.stringify(masterTournament));}catch(e){console.warn('Cloud snapshot could not be applied:',e);}};


function scrollToPlayerTeamEntryHeader(){
  const card=$("playerTeamEntryCard");
  const header=card?.querySelector(":scope > summary");
  if(!header)return;

  const stickyHeader=document.querySelector("body > header, .app > header, header");
  const headerHeight=stickyHeader?.getBoundingClientRect().height||0;
  const targetY=window.scrollY+header.getBoundingClientRect().top-headerHeight-8;
  window.scrollTo({top:Math.max(0,targetY),behavior:"smooth"});
}

function openDashboardSection(id){
  const el=document.getElementById(id);
  if(!el)return;

  // Tournament Ranking is rendered inside its own <details> element.
  // Open that section before scrolling so the dashboard card behaves like
  // the other expandable sections instead of landing on a collapsed container.
  if(id==="tournamentRanking"){
    const rankingDetails=el.querySelector("details.tournament-ranking-card") || el.querySelector("details");
    if(rankingDetails)rankingDetails.open=true;
    requestAnimationFrame(()=>{
      (rankingDetails||el).scrollIntoView({behavior:"smooth",block:"start"});
    });
    return;
  }

  if(el.tagName.toLowerCase()==="details")el.open=true;
  requestAnimationFrame(()=>{
    if(id==="playerTeamEntryCard")scrollToPlayerTeamEntryHeader();
    else el.scrollIntoView({behavior:"smooth",block:"start"});
  });
}
/* ================================================================ */
/* BADMINTON APP — CORE / TOURNAMENT ENGINE                        */
/* Sections: Utilities, State, Categories, Calculations,          */
/*          Knockout, Preliminary, Entry/Pool, Groups              */
/* ================================================================ */

/* ====================== utils.js ====================== */
"use strict";

function deepClone(value){
  return JSON.parse(JSON.stringify(value));
}

function id(prefix){
  return prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2,8);
}



/* ====================== state.js ====================== */
"use strict";

const STORAGE_KEY = "badmintonTournamentManager.v1";
const MASTER_SCHEMA_VERSION = 1;

// The active `tournament` object remains the existing tournament engine.
// A master record owns the club identity and one independent tournament subset
// per category. Only the active subset is loaded into the engine at a time.
let masterTournament = null;

function blankTournament(){
  return {
    schemaVersion: 3,
    id: id("tournament"),
    clubName: "",
    date: "",
    settings: {
      mode:"doubles",
      defaultFormat:"doubles",
      entryFormat:"doubles",
      allowedFormats:["doubles"],
      defaultQualifiers: 2,
      categories: [{id:id("category"),name:"Internal"}],
      playerPoolCount: 2,
      playerPoolBuildInputSignature:'',
      teamPoolEntries:[],
      teamPoolCommittedIds:[],
      teamPoolDistributionComplete:false,
      teamPoolLotteryInputSignature:'',
      bestOf:1,
      pointsTarget:21
    },
    playerPoolPlayers: [],
    playerPoolGeneratedTeams: [],
    playerPoolDistributionComplete: false,
    playerPoolDistributionCounts: {},
    playerPoolDistributionGroups: [],
    players: [],
    teams: [],
    groups: [],
    history: [],
    thirdPlacePlayoff: null,
    stageBuildState: {
      groupFixtures: {},
      preliminary: null,
      mainKnockout: null,
      thirdPlace: null
    }
  };
}

let tournament = blankTournament();

window.BADMINTON_APP_STATE={getTournament:()=>tournament};

function ensureStageBuildState(){
  if(!tournament.stageBuildState || typeof tournament.stageBuildState!=="object" || Array.isArray(tournament.stageBuildState))
    tournament.stageBuildState={};
  if(!tournament.stageBuildState.groupFixtures || typeof tournament.stageBuildState.groupFixtures!=="object" || Array.isArray(tournament.stageBuildState.groupFixtures))
    tournament.stageBuildState.groupFixtures={};
  if(tournament.stageBuildState.preliminary===undefined)tournament.stageBuildState.preliminary=null;
  if(tournament.stageBuildState.mainKnockout===undefined)tournament.stageBuildState.mainKnockout=null;
  if(tournament.stageBuildState.thirdPlace===undefined)tournament.stageBuildState.thirdPlace=null;
  return tournament.stageBuildState;
}

function canonicalizeBuildValue(value){
  if(Array.isArray(value))return value.map(canonicalizeBuildValue);
  if(value && typeof value==="object"){
    return Object.keys(value).sort().reduce((out,key)=>{
      out[key]=canonicalizeBuildValue(value[key]);
      return out;
    },{});
  }
  return value;
}

function buildSignature(value){
  return JSON.stringify(canonicalizeBuildValue(value));
}

function getGroupFixtureBuildInputs(groupId){
  const group=tournament.groups.find(g=>String(g.id)===String(groupId));
  if(!group)return null;
  const teams=tournament.teams
    .filter(t=>String(t.groupId)===String(groupId))
    .sort((a,b)=>(Number(a.number)||0)-(Number(b.number)||0)||String(a.id).localeCompare(String(b.id)));
  return {
    groupId:String(group.id),
    rules:group.rules||{roundRobin:"once"},
    teamIds:teams.map(t=>String(t.id))
  };
}

function getPreliminaryBuildInputs(){
  const plan=calculateKnockoutEntryPlan();
  return {
    mainKnockoutSize:Number(plan.mainKnockoutSize)||0,
    directTeamIds:(plan.directTeams||[]).map(row=>String(row.teamId)),
    preliminaryTeams:(plan.preliminaryTeams||[]).map(row=>({
      teamId:String(row.teamId),
      groupId:String(row.groupId??row.team?.groupId??""),
      groupLetter:String(row.groupLetter??""),
      groupRank:row.groupRank??null,
      tournamentRank:Number(row.tournamentRank??0)
    }))
  };
}

function getMainKnockoutBuildInputs(){
  const plan=buildMainKnockoutEntryPlan();
  if(!plan.knockoutSize)return null;
  return {
    knockoutSize:Number(plan.knockoutSize),
    entries:(plan.entries||[]).map(entry=>{
      const row=entry.rankingRow||{};
      return {
        slot:Number(entry.slot),
        sourceType:String(entry.sourceType||""),
        sourceId:String(entry.sourceId||""),
        sourceLabel:String(entry.sourceLabel||""),
        preliminaryMatchId:entry.preliminaryMatchId?String(entry.preliminaryMatchId):null,
        teamId:entry.sourceType==="DIRECT" && entry.teamId!=null ? String(entry.teamId) : null,
        tournamentRank:entry.sourceType==="DIRECT" ? Number(row.position??row.rank??0) : null,
        groupLetter:entry.sourceType==="DIRECT" ? String(row.groupLetter??"") : ""
      };
    })
  };
}

function getThirdPlaceBuildInputs(){
  const draw=getActiveMainKnockoutDraw();
  if(!draw?.rounds||draw.rounds.length<2)return null;
  const semiRound=draw.rounds[draw.rounds.length-2];
  const semis=semiRound?.matches||[];
  return {
    knockoutSize:Number(draw.knockoutSize||0),
    // A 3rd-place playoff depends on the actual semifinal state, not merely
    // the existence/order of the semifinal matches. Include participants and
    // outcomes so a corrected upstream result makes the playoff stale.
    semifinalMatches:semis.map(m=>({
      id:String(m.id),
      team1Id:m.team1Id!=null?String(m.team1Id):null,
      team2Id:m.team2Id!=null?String(m.team2Id):null,
      status:String(m.status||"pending"),
      winnerTeamId:m.winnerTeamId!=null?String(m.winnerTeamId):null,
      loserTeamId:m.loserTeamId!=null?String(m.loserTeamId):null
    }))
  };
}

function mainKnockoutResultAffectsThirdPlace(matchId,changedMatchIds=[]){
  const draw=getActiveMainKnockoutDraw();
  if(!draw?.rounds||draw.rounds.length<2)return false;
  const semifinalRoundIndex=draw.rounds.length-2;
  const semifinalIds=new Set((draw.rounds[semifinalRoundIndex]?.matches||[]).map(m=>String(m.id)));
  if(semifinalIds.has(String(matchId)))return true;
  return (changedMatchIds||[]).some(id=>semifinalIds.has(String(id)));
}

function invalidateCompetitionStagesFrom(stage,reason=""){
  const state=ensureStageBuildState();
  const clear=(key)=>{
    if(state[key]){
      state[key].signature=null;
      state[key].invalidatedAt=Date.now();
      state[key].invalidatedReason=reason||"The upstream tournament state changed.";
    }
  };

  if(stage==="group-fixtures"){
    clear("preliminary");
    clear("mainKnockout");
    clear("thirdPlace");
  }else if(stage==="preliminary"){
    clear("preliminary");
    clear("mainKnockout");
    clear("thirdPlace");
  }else if(stage==="preliminary-result"){
    // A result changes which team resolves into a Main Knockout slot, but it
    // does not change the Pre-Knockout pairing structure itself. Keep the
    // Pre-Knockout stage CURRENT and invalidate only its downstream stages.
    clear("mainKnockout");
    clear("thirdPlace");
  }else if(stage==="main-knockout"){
    clear("mainKnockout");
    clear("thirdPlace");
  }else if(stage==="main-knockout-result"){
    // A Main Knockout result does not change the generated Main Knockout
    // structure. Only invalidate the 3rd-place playoff when this result, or
    // its propagation, changes a semifinal dependency.
    clear("thirdPlace");
  }else if(stage==="third-place"){
    clear("thirdPlace");
  }

  return state;
}

function invalidateGroupFixtureStage(groupId,reason=""){
  const state=ensureStageBuildState();
  const key=String(groupId);
  if(state.groupFixtures[key]){
    state.groupFixtures[key].signature=null;
    state.groupFixtures[key].invalidatedAt=Date.now();
    state.groupFixtures[key].invalidatedReason=reason||"The group structure changed.";
  }
  invalidateCompetitionStagesFrom("group-fixtures",reason);
}

function getStageBuildState(stage,context={}){
  const state=ensureStageBuildState();
  if(stage==="group-fixtures")return state.groupFixtures[String(context.groupId)]||null;
  if(stage==="preliminary")return state.preliminary||null;
  if(stage==="main-knockout")return state.mainKnockout||null;
  if(stage==="third-place")return state.thirdPlace||null;
  return null;
}

function getStageCurrentSignature(stage,context={}){
  let inputs=null;
  if(stage==="group-fixtures")inputs=getGroupFixtureBuildInputs(context.groupId);
  else if(stage==="preliminary")inputs=getPreliminaryBuildInputs();
  else if(stage==="main-knockout")inputs=getMainKnockoutBuildInputs();
  else if(stage==="third-place")inputs=getThirdPlaceBuildInputs();
  return inputs==null?null:buildSignature(inputs);
}

function getStageStaleInfo(stage,context={}){
  const stored=getStageBuildState(stage,context);
  const currentSignature=getStageCurrentSignature(stage,context);
  if(stage==="group-fixtures"){
    if(!(tournament.fixtures||[]).some(f=>String(f.groupId)===String(context.groupId)))
      return {exists:false,stale:false,reason:""};
  }else if(stage==="preliminary"){
    if(!tournament.preliminaryRound?.matches?.length)return {exists:false,stale:false,reason:""};
  }else if(stage==="main-knockout"){
    if(!tournament.mainKnockoutDraw?.rounds?.length)return {exists:false,stale:false,reason:""};
  }else if(stage==="third-place"){
    if(!tournament.thirdPlacePlayoff)return {exists:false,stale:false,reason:""};
  }
  if(!stored?.signature)
    return {exists:true,stale:true,reason:stored?.invalidatedReason||"The generated build state is not recorded. Rebuild this stage once to establish its current structure."};
  if(currentSignature===null)
    return {exists:true,stale:true,reason:"The current tournament structure can no longer produce the generated stage."};
  if(stored.signature!==currentSignature){
    const reasons={
      "group-fixtures":"The teams or fixture rules for this group changed after these fixtures were generated.",
      "preliminary":"The current qualification / tournament-ranking allocation differs from the generated Pre-Knockout.",
      "main-knockout":"The current Main Knockout allocation differs from the generated draw.",
      "third-place":"The Main Knockout semifinal structure differs from the structure used for this 3rd-place playoff."
    };
    return {exists:true,stale:true,reason:reasons[stage]||"The generated stage no longer matches the current tournament structure."};
  }
  return {exists:true,stale:false,reason:""};
}


/* ====================== categories.js ====================== */
function getMasterCategories(){
  if(!masterTournament || !Array.isArray(masterTournament.categories))return [];
  return masterTournament.categories;
}

function getActiveCategoryRecord(){
  const categories=getMasterCategories();
  return categories.find(c=>String(c.id)===String(masterTournament?.activeCategoryId))||categories[0]||null;
}

function saveActiveCategoryToMaster(){
  if(!masterTournament)return;
  const active=getActiveCategoryRecord();
  if(!active)return;
  const snapshot=deepClone(tournament);
  // Club name is master-level shared metadata. The active category's current
  // settings value is authoritative when saving, so a changed club name must
  // update the master rather than being overwritten by the previous master name.
  snapshot.clubName=String(tournament.clubName||"").trim();
  snapshot.settings=snapshot.settings||{};
  snapshot.settings.categories=[{id:String(active.id),name:String(active.name||"Internal").trim()||"Internal"}];
  active.name=String(active.name||"Internal").trim()||"Internal";
  active.data=snapshot;
  masterTournament.clubName=snapshot.clubName;
}

function categoryHasCompetitionData(record){
  const d=record?.data||{};
  return [d.players,d.teams,d.groups,d.fixtures,d.results,d.preliminaryRound,d.mainKnockoutDraw,d.thirdPlacePlayoff]
    .some(value=>Array.isArray(value)?value.length>0:!!value);
}

function makeBlankCategoryRecord(categoryId,categoryName){
  const data=blankTournament();
  data.clubName=masterTournament?.clubName||"";
  data.settings.categories=[{id:String(categoryId),name:String(categoryName||"Internal").trim()||"Internal"}];
  return {id:String(categoryId),name:String(categoryName||"Internal").trim()||"Internal",data};
}

function buildMasterFromLegacy(legacy){
  const categories=Array.isArray(legacy?.settings?.categories)&&legacy.settings.categories.length
    ? legacy.settings.categories
    : [{id:id("category"),name:"Internal"}];
  const normalized=categories.map((category,index)=>({
    id:String(category?.id||id("category")),
    name:String(category?.name||((index===0)?"Internal":`Category ${index+1}`)).trim()||`Category ${index+1}`
  }));
  const master={
    masterSchemaVersion:MASTER_SCHEMA_VERSION,
    type:"badmintonTournamentManagerMaster",
    clubName:String(legacy?.clubName||""),
    activeCategoryId:normalized[0].id,
    categories:[]
  };
  normalized.forEach((category,index)=>{
    if(index===0){
      const data=deepClone(legacy);
      data.settings=data.settings||{};
      data.settings.categories=[{id:category.id,name:category.name}];
      data.clubName=master.clubName;
      master.categories.push({id:category.id,name:category.name,data});
    }else{
      master.categories.push(makeBlankCategoryRecord(category.id,category.name));
    }
  });
  return master;
}

function normalizeMasterRecord(raw){
  if(!raw || typeof raw!=="object" || Array.isArray(raw))throw new Error("Invalid master tournament data");
  if(raw.type!=="badmintonTournamentManagerMaster" || !Array.isArray(raw.categories) || !raw.categories.length)
    return buildMasterFromLegacy(migrateTournamentData(raw));
  const master={
    masterSchemaVersion:MASTER_SCHEMA_VERSION,
    type:"badmintonTournamentManagerMaster",
    clubName:String(raw.clubName||""),
    activeCategoryId:String(raw.activeCategoryId||raw.categories[0]?.id||""),
    categories:[]
  };
  raw.categories.forEach((category,index)=>{
    const cid=String(category?.id||id("category"));
    const name=String(category?.name||((index===0)?"Internal":`Category ${index+1}`)).trim()||`Category ${index+1}`;
    let data;
    if(category?.data && typeof category.data==="object" && !Array.isArray(category.data))
      data=migrateTournamentData(category.data);
    else
      data=makeBlankCategoryRecord(cid,name).data;
    data.clubName=master.clubName;
    data.settings=data.settings||{};
    data.settings.categories=[{id:cid,name}];
    master.categories.push({id:cid,name,data});
  });
  if(!master.categories.some(c=>String(c.id)===master.activeCategoryId))
    master.activeCategoryId=master.categories[0].id;
  return master;
}

function activateCategory(categoryId,{message=true}={}){
  if(!masterTournament)return;
  const target=masterTournament.categories.find(c=>String(c.id)===String(categoryId));
  if(!target)return;
  const currentId=String(masterTournament.activeCategoryId||"");
  if(currentId===String(target.id)){
    renderAll();
    return;
  }
  // Capture the current subset before changing the active pointer.
  syncSettings();
  clearCalculationCache();
  if(typeof calculateAndStoreGroupGlobalMetrics==="function")calculateAndStoreGroupGlobalMetrics();
  if(typeof calculateTournamentRanking==="function")calculateTournamentRanking();
  saveActiveCategoryToMaster();

  masterTournament.activeCategoryId=String(target.id);
  tournament=migrateTournamentData(target.data||makeBlankCategoryRecord(target.id,target.name).data);
  tournament.clubName=masterTournament.clubName||"";
  tournament.settings=tournament.settings||{};
  tournament.settings.categories=[{id:String(target.id),name:String(target.name||"Internal").trim()||"Internal"}];
  target.data=deepClone(tournament);
  window.BADMINTON_LOCAL?.write(JSON.stringify(masterTournament));
  renderAll();
  window.scrollTo({top:0,behavior:"instant"});
  if(message)showMessage(`Switched to ${target.name}.`);
}

function cycleCategory(){
  const categories=getMasterCategories();
  if(categories.length<2)return;
  const index=Math.max(0,categories.findIndex(c=>String(c.id)===String(masterTournament?.activeCategoryId)));
  activateCategory(categories[(index+1)%categories.length].id);
}



/* ====================== calculations.js ====================== */
/*
 * Badminton Tournament Manager — calculation layer
 * Extracted from the application engine in v5.3.17.
 * This file intentionally uses the existing global application state and
 * helpers so tournament behaviour remains unchanged.
 */

function calculateGlobalMetric(wins,h2hComponent,lostPoints){
  return (Number(wins)||0)*1000000+
         (Number(h2hComponent)||0)*1000+
         (Number(lostPoints)||0);
}

function calculateGlobalH2HComponent(teamId){
  const teamIdStr=String(teamId);
  if(calculationCache.globalH2H.has(teamIdStr))
    return calculationCache.globalH2H.get(teamIdStr);

  // Find this team's group from the authoritative team/group relationship.
  const {teamById,resultsByGroup}=getCalculationIndexes();
  const team=teamById.get(teamIdStr);
  if(!team)return 0;

  const groupId=team.groupId;
  if(groupId==null)return 0;

  // Group Standings is authoritative for the overall win total.
  const groupRows=calculateGroupStandings(groupId)||[];
  const me=groupRows.find(r=>String(r.team?.id??r.teamId??r.id)===teamIdStr);
  if(!me)return 0;

  // H2H applies only inside the same-win cohort.
  const tiedIds=new Set(
    groupRows
      .filter(r=>Number(r.wins)===Number(me.wins))
      .map(r=>String(r.team?.id??r.teamId??r.id))
  );
  if(tiedIds.size<2){
    calculationCache.globalH2H.set(teamIdStr,0);
    return 0;
  }

  let h2hWins=0;

  // The app stores completed match outcomes in tournament.results and
  // resolves their fixture through tournament.fixtures.
  const groupResults=resultsByGroup.get(String(groupId))||[];
  groupResults.forEach(({result,fixture})=>{
    const aId=String(fixture.teamAId??fixture.team1Id??fixture.homeTeamId);
    const bId=String(fixture.teamBId??fixture.team2Id??fixture.awayTeamId);

    if(aId===bId || !tiedIds.has(aId) || !tiedIds.has(bId))return;
    if(aId!==teamIdStr && bId!==teamIdStr)return;
    if(!result.winnerTeamId)return;

    if(String(result.winnerTeamId)===teamIdStr)h2hWins++;
  });

  calculationCache.globalH2H.set(teamIdStr,h2hWins);
  return h2hWins;
}

function calculateTeamRawMetrics(teamId){
  const m={teamId,groupWins:0,groupLossPoints:0,groupPointsFor:0,groupPointsAgainst:0,groupGamesWon:0,groupGamesLost:0,groupPointDifference:0,groupGameDifference:0,tournamentWins:0,tournamentLossPoints:0,tournamentPointsFor:0,tournamentPointsAgainst:0,tournamentGamesWon:0,tournamentGamesLost:0,tournamentPointDifference:0,tournamentGameDifference:0};
  (tournament.groups||[]).forEach(group=>{
    const matches=group.matches||group.fixtures||[];
    matches.forEach(match=>{
      const aId=match.teamAId ?? match.team1Id ?? match.homeTeamId;
      const bId=match.teamBId ?? match.team2Id ?? match.awayTeamId;
      if(String(aId)!==String(teamId)&&String(bId)!==String(teamId))return;
      const result=match.result;
      if(!result || (match.status&&match.status!=="completed"))return;
      const winnerId=match.winnerTeamId ?? result.winnerTeamId ?? null;
      if(winnerId&&String(winnerId)===String(teamId)){m.groupWins++;m.tournamentWins++;}
      const isWO=!!(result.walkover||result.wo||match.walkover);
      if(isWO)return;
      const games=Array.isArray(result.games)?result.games:[];
      const isA=String(aId)===String(teamId);
      games.forEach(g=>{
        const ra=Number(g.a),rb=Number(g.b);
        if(!Number.isFinite(ra)||!Number.isFinite(rb)||ra<0||rb<0||ra===rb)return;
        const own=isA?ra:rb,opp=isA?rb:ra;
        m.groupPointsFor+=own;m.groupPointsAgainst+=opp;m.tournamentPointsFor+=own;m.tournamentPointsAgainst+=opp;
        if(own>opp){m.groupGamesWon++;m.tournamentGamesWon++;}
        else{m.groupGamesLost++;m.tournamentGamesLost++;m.groupLossPoints+=own;m.tournamentLossPoints+=own;}
      });
    });
  });
  m.groupPointDifference=m.groupPointsFor-m.groupPointsAgainst;
  m.groupGameDifference=m.groupGamesWon-m.groupGamesLost;
  m.tournamentPointDifference=m.tournamentPointsFor-m.tournamentPointsAgainst;
  m.tournamentGameDifference=m.tournamentGamesWon-m.tournamentGamesLost;
  return m;
}

function calculateTournamentRanking(){
  const qualifiedRecords=getQualifiedTeamSourceRecords();
  const qualifiedById=new Map(qualifiedRecords.map(r=>[String(r.teamId),r]));
  const rows=[];

  (tournament.teams||[]).forEach(team=>{
    const source=qualifiedById.get(String(team.id));
    if(!source)return;
    const wins=Number(team.globalMetricWins)||0;
    const lostPoints=Number(team.globalMetricLostPoints)||0;
    const h2hComponent=Number(team.globalMetricH2H)||0;


    rows.push({
      team,
      teamId:team.id,
      groupId:source.groupId??team.groupId??null,
      groupLetter:source.groupLetter??"",
      groupRank:source.groupRank??null,
      tournamentWins:wins,
      tournamentLossPoints:lostPoints,
      h2hComponent,
      globalMetric:Number(team.globalMetric)||0,
      tiebreakRequired:false,
      tiebreakMethod:null
    });
  });

  rows.sort((a,b)=>b.globalMetric-a.globalMetric);

  const lottery=tournament.globalRankingLottery||{};
  const grouped=new Map();
  rows.forEach(r=>{
    const key=String(r.globalMetric);
    if(!grouped.has(key))grouped.set(key,[]);
    grouped.get(key).push(r);
  });

  let rank=1;
  grouped.forEach(tied=>{
    let ordered=tied;
    if(tied.length>1){
      const key=String(tied[0].globalMetric);
      const ids=tied.map(r=>String(r.teamId));
      const saved=Array.isArray(lottery[key])?lottery[key].map(String):[];
      const valid=saved.length===ids.length&&saved.every(id=>ids.includes(id));

      if(valid){
        const byId=new Map(tied.map(r=>[String(r.teamId),r]));
        ordered=saved.map(id=>byId.get(id)).filter(Boolean);
      }else{
        ordered=[...tied];
        for(let i=ordered.length-1;i>0;i--){
          const j=Math.floor(Math.random()*(i+1));
          [ordered[i],ordered[j]]=[ordered[j],ordered[i]];
        }
        if(!tournament.globalRankingLottery)tournament.globalRankingLottery={};
        tournament.globalRankingLottery[key]=ordered.map(r=>r.teamId);
      }

      ordered.forEach(r=>{
        r.tiebreakRequired=true;
        r.tiebreakMethod="Lottery";
      });
    }
    ordered.forEach(r=>r.tournamentRank=rank++);
  });

  return rows.sort((a,b)=>a.tournamentRank-b.tournamentRank);
}

function calculateGroupStandings(groupId){
  const cacheKey=String(groupId);
  const cached=calculationCache.standings.get(cacheKey);
  if(cached)return cached;

  const teams=tournament.teams.filter(t=>String(t.groupId)===cacheKey);
  const rows=teams.map(team=>({
    team,
    wins:0,
    losses:0,
    lostScore:0,
    played:0,
    h2hWins:0,
    h2hPlayed:0,
    h2hLossPoints:0,
    tiebreakRequired:false,
    tiebreakMethod:null
  }));

  const byId=new Map(rows.map(r=>[String(r.team.id),r]));
  const {resultsByGroup}=getCalculationIndexes();
  const groupResults=resultsByGroup.get(String(groupId))||[];
  groupResults.forEach(({result:r,fixture:f})=>{
    if(!r.winnerTeamId||!r.loserTeamId)return;
    const w=byId.get(String(r.winnerTeamId));
    const l=byId.get(String(r.loserTeamId));
    if(!w||!l)return;
    w.wins++;
    w.played++;
    l.losses++;
    l.played++;
    if(!r.walkover){
      (r.games||[]).forEach(g=>{
        const score=String(r.loserTeamId)===String(f.teamAId)?Number(g.a):Number(g.b);
        if(Number.isFinite(score))l.lostScore+=score;
      });
    }
  });

  // Primary metric: wins, higher is better.
  rows.sort((a,b)=>b.wins-a.wins);

  const resolved=[];
  let i=0;

  while(i<rows.length){
    let j=i+1;
    while(j<rows.length&&rows[j].wins===rows[i].wins)j++;
    const tied=rows.slice(i,j);

    if(tied.length===1){
      resolved.push(tied[0]);
      i=j;
      continue;
    }

    // Two-team tie: direct head-to-head first.
    if(tied.length===2){
      const h=headToHeadWinner(tied[0].team.id,tied[1].team.id,groupId);
      if(h){
        const winner=tied.find(x=>String(x.team.id)===String(h));
        const loser=tied.find(x=>String(x.team.id)!==String(h));
        resolved.push(winner,loser);
      }else{
        // If H2H cannot resolve it, use total losing points.
        tied.sort((a,b)=>b.lostScore-a.lostScore);
        if(tied[0].lostScore!==tied[1].lostScore){
          resolved.push(...tied);
        }else{
          tied.forEach(r=>{
            r.tiebreakRequired=true;
            r.tiebreakMethod="lottery_or_playoff";
          });
          resolved.push(...tied);
        }
      }
      i=j;
      continue;
    }

    // 3+ team tie: build an H2H mini-table among ONLY the tied teams.
    const mini=buildGroupH2HMiniTable(tied,groupId);
    tied.forEach(r=>{
      const m=mini.get(String(r.team.id));
      if(m){
        r.h2hWins=m.h2hWins;
        r.h2hPlayed=m.h2hPlayed;
        r.h2hLossPoints=m.h2hLossPoints;
      }
    });

    // H2H mini-table is the second ranking layer.
    tied.sort((a,b)=>b.h2hWins-a.h2hWins);

    let k=0;
    while(k<tied.length){
      let m=k+1;
      while(m<tied.length&&tied[m].h2hWins===tied[k].h2hWins)m++;
      const sub=tied.slice(k,m);

      // If the H2H mini-table separates them, accept that order.
      if(sub.length===1){
        resolved.push(sub[0]);
        k=m;
        continue;
      }

      // H2H still tied: use TOTAL losing points, higher is better.
      sub.sort((a,b)=>b.lostScore-a.lostScore);

      let p=0;
      while(p<sub.length){
        let q=p+1;
        while(q<sub.length&&sub[q].lostScore===sub[p].lostScore)q++;
        const unresolved=sub.slice(p,q);

        if(unresolved.length>1){
          unresolved.forEach(r=>{
            r.tiebreakRequired=true;
            r.tiebreakMethod="lottery_or_playoff";
          });
        }
        resolved.push(...unresolved);
        p=q;
      }
      k=m;
    }

    i=j;
  }

  const finalRows=resolved.map((r,index)=>({
    ...r,
    position:index+1,
    qualifier:false
  }));
  calculationCache.standings.set(cacheKey,finalRows);
  return finalRows;
}

function calculateQualifications(groupId){
  const group=tournament.groups.find(g=>String(g.id)===String(groupId));
  if(!group)return [];
  const standings=calculateGroupStandings(groupId);

  // Do not expose automatic qualifiers until this group itself is complete.
  if(!isGroupQualificationReady(groupId)){
    return standings.map(r=>({...r,qualifier:false}));
  }

  const count=qualificationCountForGroup(group);
  return standings.map((r,i)=>({...r,qualifier:i<count}));
}

/* ====================== knockout.js ====================== */
/* Phase 20 — Knockout engine extraction. Moved unchanged from app.js. */
/* CALCULATION LAYER — Knockout structure calculation
   Determines the main knockout size and Pre-Knockout requirement.
   No teams are assigned and no bracket is built in this step.
   Rule: use the largest power-of-two main stage that does not exceed the
   qualified-team count. All excess teams are handled through Pre-Knockout. */
function calculateKnockoutStructure(qualifiedCount){
  const n=Number(qualifiedCount);
  if(!Number.isInteger(n)||n<2){
    return {
      qualifiedTeams:n,
      mainKnockoutSize:null,
      preliminaryMatches:0,
      preliminaryTeams:0,
      directTeams:0
    };
  }

  let main=1;
  while((main*2)<=n)main*=2;

  const eliminatedToReachMain=n-main;
  const preliminaryMatches=eliminatedToReachMain;
  const preliminaryTeams=preliminaryMatches*2;
  const directTeams=main-preliminaryMatches;

  return {
    qualifiedTeams:n,
    mainKnockoutSize:main,
    preliminaryMatches,
    preliminaryTeams,
    directTeams
  };
}

function getKnockoutStructure(){
  const qualifiedIds=typeof getQualifiedTeamIds==="function"
    ? getQualifiedTeamIds()
    : [];
  return calculateKnockoutStructure(qualifiedIds.length);
}


/* CALCULATION LAYER — Advanced vs Pre-Knockout entry allocation
   Uses the already-calculated tournament ranking and the already-calculated
   knockout structure. This step classifies teams only; it does not build
   either draw and does not alter knockout scoring. */
function calculateKnockoutEntryPlan(){
  const ranking=calculateTournamentRanking();
  const structure=getKnockoutStructure();
  const ranked=ranking.slice().sort((a,b)=>{
    const ar=a.tournamentRank??Number.MAX_SAFE_INTEGER;
    const br=b.tournamentRank??Number.MAX_SAFE_INTEGER;
    return ar-br;
  });

  const directCount=Math.max(0,Number(structure.directTeams)||0);
  const preliminaryCount=Math.max(0,Number(structure.preliminaryTeams)||0);

  return {
    qualifiedTeams:structure.qualifiedTeams,
    mainKnockoutSize:structure.mainKnockoutSize,
    directTeams:ranked.slice(0,directCount).map((row,index)=>({
      ...row,
      knockoutEntryType:"direct",
      knockoutEntryRank:index+1
    })),
    preliminaryTeams:ranked.slice(directCount,directCount+preliminaryCount).map((row,index)=>({
      ...row,
      knockoutEntryType:"preliminary",
      knockoutEntryRank:directCount+index+1
    })),
    tournamentRanking:ranked
  };
}

/* GENERATED STAGE — Pre-Knockout draw planning
   Builds pairings for preliminary entrants only.
   Policy:
   1. Pair stronger tournament seeds against weaker seeds.
   2. Prefer different groups.
   3. Never create a BYE.
   4. If a same-group pairing is mathematically unavoidable, allow it rather
      than creating an invalid/empty opponent.
   5. This function only proposes a draw; it does not mutate the knockout. */
function buildPreliminaryDrawPlan(){
  const plan=calculateKnockoutEntryPlan();
  const entrants=plan.preliminaryTeams.slice().sort(
    (a,b)=>(a.tournamentRank??999999)-(b.tournamentRank??999999)
  );

  if(entrants.length===0)return {
    qualifiedTeams:plan.qualifiedTeams,
    mainKnockoutSize:plan.mainKnockoutSize,
    directTeams:plan.directTeams,
    preliminaryTeams:[],
    matches:[]
  };

  if(entrants.length%2!==0){
    return {
      error:"invalid_preliminary_count",
      message:"Pre-Knockout requires an even number of teams.",
      preliminaryTeams:entrants,
      matches:[]
    };
  }

  /*
   * Pre-Knockout uses the same universal ranked draw engine as Direct and
   * Main/Combined Knockout. The stage only supplies its entrants; pairing
   * policy is centralized in buildRankedKnockoutPairings().
   */
  const rankedEntries=entrants.map((entry,index)=>({
    ...entry,
    tournamentRank:Number(entry.tournamentRank ?? index+1),
    groupLetter:entry.team?.groupId ?? entry.groupId ?? "",
    group:entry.team?.groupId ?? entry.groupId ?? ""
  }));
  const pairings=buildRankedKnockoutPairings(rankedEntries);

  const matches=pairings.map((pair,index)=>{
    const strong=pair[0],weak=pair[1];
    return {
      matchNumber:index+1,
      teamA:strong,
      teamB:weak,
      sameGroup:String(strong.team?.groupId ?? strong.groupId ?? "")===
        String(weak.team?.groupId ?? weak.groupId ?? ""),
      seedA:strong.tournamentRank,
      seedB:weak.tournamentRank,
      status:"pending"
    };
  });

  return {
    qualifiedTeams:plan.qualifiedTeams,
    mainKnockoutSize:plan.mainKnockoutSize,
    directTeams:plan.directTeams,
    preliminaryTeams:entrants,
    matches
  };
}

/* GENERATED STAGE — Pre-Knockout bracket construction
   Commits the proposed Pre-Knockout draw into tournament state.
   The existing knockout bracket is deliberately untouched.
   A preliminary winner will later feed a main-knockout slot; this step only
   creates and stores the Pre-Knockout matches. */
function buildPreliminaryRound(){
  const plan=buildPreliminaryDrawPlan();
  if(plan.error)return plan;
  if(!plan.matches.length){
    return {
      ...plan,
      created:false,
      message:"No Pre-Knockout is required."
    };
  }

  const existing=tournament.preliminaryRound;
  if(existing?.matches?.length){
    return {
      ...plan,
      created:false,
      existing:true,
      matches:existing.matches,
      message:"Pre-Knockout already exists."
    };
  }

  const matches=plan.matches.map(m=>({
    id:`prelim-${Date.now()}-${m.matchNumber}`,
    matchNumber:m.matchNumber,
    teamAId:m.teamA.teamId,
    teamBId:m.teamB.teamId,
    seedA:m.seedA,
    seedB:m.seedB,
    groupLetterA:preliminarySourceInfo(m.teamA).group,
    groupLetterB:preliminarySourceInfo(m.teamB).group,
    groupRankA:preliminarySourceInfo(m.teamA).rank,
    groupRankB:preliminarySourceInfo(m.teamB).rank,
    tournamentRankA:m.teamA.tournamentRank??null,
    tournamentRankB:m.teamB.tournamentRank??null,
    sameGroup:m.sameGroup,
    status:"pending",
    winnerTeamId:null,
    loserTeamId:null,
    result:null
  }));

  tournament.preliminaryRound={
    mainKnockoutSize:plan.mainKnockoutSize,
    qualifiedTeams:plan.qualifiedTeams,
    directTeamIds:plan.directTeams.map(x=>x.teamId),
    preliminaryTeamIds:plan.preliminaryTeams.map(x=>x.teamId),
    matches,
    createdAt:Date.now()
  };
  ensureStageBuildState().preliminary={
    signature:buildSignature(getPreliminaryBuildInputs()),
    generatedAt:Date.now()
  };

  saveLocal(true);
  return {
    ...plan,
    created:true,
    matches
  };
}

function getPreliminaryRound(){
  return tournament.preliminaryRound||null;
}

let selectedPreliminaryMatchId=null;

/* FLOATING SCORECARD — one interaction surface for Group, Pre-Knockout, Main Knockout and 3rd-place. */
let floatingScorecardState={stage:null,matchId:null,type:null};
function getFloatingScorecardHost(){return $("floatingScorecard");}
function closeFloatingScorecard(){
  floatingScorecardState={stage:null,matchId:null,type:null};
  const host=getFloatingScorecardHost();
  if(host){host.classList.remove("is-open");host.innerHTML="";delete host.dataset.scoreboardStage;delete host.dataset.scoreboardMatchId;}
}
function openFloatingScorecard(stage,matchId,type=null,focusScore=true){
  const host=getFloatingScorecardHost();
  if(!host)return;
  floatingScorecardState={stage:String(stage),matchId:String(matchId),type:type?String(type):null};
  host.classList.add("is-open");
  renderFloatingScorecard();
  if(focusScore)setTimeout(()=>{
    const first=host.querySelector('input[data-score-scope][data-side="a"]');
    if(first){first.focus();first.select?.();}
  },30);
}
function renderFloatingScorecard(){
  const host=getFloatingScorecardHost();
  if(!host)return;
  const state=floatingScorecardState;
  if(!state.stage){closeFloatingScorecard();return;}
  if(state.stage==="group")renderResultEditor();
  else if(state.stage==="preliminary")renderPreliminaryResultEditor(state.matchId);
  else if(state.stage==="main"||state.stage==="third-place")renderKnockoutResultEditor(state.matchId);
  else closeFloatingScorecard();
}

function bindFloatingScorecardDismissal(){
  if(document.documentElement.dataset.floatingScorecardBound==="1")return;
  document.documentElement.dataset.floatingScorecardBound="1";
  document.addEventListener("click",event=>{
    const host=getFloatingScorecardHost();
    if(!host?.classList.contains("is-open"))return;
    if(event.target.closest("#floatingScorecard"))return;
    if(event.target.closest(".group-fixture-selectable,.ko-prelim-match,.main-ko-match-selectable"))return;
    closeFloatingScorecard();
  });
  document.addEventListener("keydown",event=>{
    if(event.key==="Escape"&&getFloatingScorecardHost()?.classList.contains("is-open"))closeFloatingScorecard();
  });
}

function selectPreliminaryMatch(matchId){
  const match=getPreliminaryMatch(matchId);
  if(!match)return;
  selectedPreliminaryMatchId=String(match.id);
  openFloatingScorecard("preliminary",match.id,null,true);
  renderPreliminaryRound();
}


/* GENERATED STAGE — Main Knockout entry slots and dynamic bracket engine
   Teams keep permanent identity/player membership. Bracket positions carry
   their current source: group seed, Pre-Knockout slot, or previous match. */

/* Universal knockout draw engine.
   Tournament ranking determines strength. Different-group opponents are
   preferred, but same-group pairing is allowed when unavoidable. A small
   backtracking search prevents an early greedy choice from creating a
   dead-end later in the same draw. */
function buildRankedKnockoutPairings(entries){
  const list=(entries||[]).map((entry,index)=>({
    ...entry,
    __drawIndex:index,
    __rank:Number(entry.tournamentRank ?? entry.rank ?? index+1)
  })).sort((a,b)=>a.__rank-b.__rank);

  function groupOf(e){
    return String(e.groupLetter ?? e.group ?? e.sourceGroup ?? "").toUpperCase();
  }

  function legal(a,b){
    const ga=groupOf(a), gb=groupOf(b);
    return !ga || !gb || ga!==gb;
  }

  function candidateScore(a,b){
    // Lower score is better: maximise ranking separation, then prefer
    // different groups. Same-group is a last resort.
    const separation=Math.abs(a.__rank-b.__rank);
    const same=groupOf(a) && groupOf(a)===groupOf(b) ? 1 : 0;
    return {same,separation};
  }

  function canFinish(remaining){
    if(!remaining.length)return true;
    if(remaining.length===2)return true;

    const a=remaining[0];
    const legalOpponents=remaining.slice(1).filter(b=>legal(a,b));
    if(!legalOpponents.length)return false;

    // Try weakest legal opponents first; recurse to ensure completion.
    legalOpponents.sort((x,y)=>{
      const sx=candidateScore(a,x), sy=candidateScore(a,y);
      return sx.same-sy.same || sy.separation-sx.separation;
    });

    for(const b of legalOpponents){
      const next=remaining.filter(e=>e!==a&&e!==b);
      if(canFinish(next))return true;
    }
    return false;
  }

  function solve(remaining,pairs){
    if(!remaining.length)return pairs;
    if(remaining.length===2){
      // If this is the unavoidable final pairing, allow same-group.
      return pairs.concat([[remaining[0],remaining[1]]]);
    }

    const a=remaining[0];

    // Prefer the weakest remaining legal opponent.
    const candidates=remaining.slice(1).sort((x,y)=>{
      const sx=candidateScore(a,x), sy=candidateScore(a,y);
      return sx.same-sy.same || sy.separation-sx.separation;
    });

    for(const b of candidates){
      const isLegal=legal(a,b);
      if(!isLegal){
        // Same-group pairings are only allowed when no complete
        // different-group solution remains.
        continue;
      }
      const next=remaining.filter(e=>e!==a&&e!==b);
      if(!canFinish(next))continue;
      return solve(next,pairs.concat([[a,b]]));
    }

    // No fully separated solution exists. Fall back to the weakest
    // remaining opponent so the bracket is always complete.
    const fallback=candidates[0];
    const next=remaining.filter(e=>e!==a&&e!==fallback);
    return solve(next,pairs.concat([[a,fallback]]));
  }

  return solve(list,[]);
}

function buildMainKnockoutEntryPlan(){
  const structure=getKnockoutStructure();
  const knockoutSize=Number(structure.mainKnockoutSize);
  if(!Number.isInteger(knockoutSize)||knockoutSize<2){
    return {valid:false,error:"Main Knockout size is not available from the current qualification structure.",knockoutSize:0,directCount:0,preliminaryCount:0,directEntries:[],preliminaryEntries:[],entries:[]};
  }
  const entryPlan=calculateKnockoutEntryPlan();
  const directRequired=Math.max(0,Number(structure.directTeams)||0);
  const preliminaryRequired=Math.max(0,Number(structure.preliminaryMatches)||0);
  const directTeams=Array.isArray(entryPlan.directTeams)?entryPlan.directTeams:[];
  const matches=Array.isArray(tournament.preliminaryRound?.matches)?tournament.preliminaryRound.matches:[];

  const directEntries=directTeams.slice(0,directRequired).map((row,index)=>{
    const teamId=row.teamId??row.id;
    const sourceLabel=(row.groupLetter&&row.groupRank!=null)
      ? `${row.groupLetter}${row.groupRank}`
      : `Seed${index+1}`;
    return {
      slot:index+1,
      sourceType:"DIRECT",
      sourceId:String(teamId),
      sourceLabel,
      teamId,
      team:row.team||row,
      rankingRow:row,
      status:"ready"
    };
  });

  const preliminaryEntries=matches.slice(0,preliminaryRequired).map((match,index)=>{
    const winnerId=match.winnerTeamId??match.result?.winnerTeamId??null;
    const winnerRow=winnerId!=null?(entryPlan.tournamentRanking||[]).find(row=>String(row.teamId??row.id)===String(winnerId))||null:null;
    return {
      slot:directEntries.length+index+1,
      sourceType:"PRELIMINARY",
      sourceId:String(match.id),
      sourceLabel:`PR${index+1}`,
      preliminaryMatchId:match.id,
      teamId:winnerId,
      team:winnerRow?(winnerRow.team||winnerRow):null,
      rankingRow:winnerRow,
      status:winnerRow?"ready":"awaiting_preliminary"
    };
  });

  const entries=[...directEntries,...preliminaryEntries];
  const errors=[];
  if(directEntries.length!==directRequired)errors.push(`Direct allocation contains ${directEntries.length} of ${directRequired} required direct team(s).`);
  if(preliminaryEntries.length!==preliminaryRequired)errors.push(`Pre-Knockout allocation contains ${preliminaryEntries.length} of ${preliminaryRequired} required Pre-Knockout winner slot(s).`);
  if(entries.length!==knockoutSize)errors.push(`Main Knockout allocation contains ${entries.length} of ${knockoutSize} required entries.`);
  return {valid:errors.length===0,error:errors.join(" "),qualifiedTeams:Number(structure.qualifiedTeams)||0,knockoutSize,directCount:directEntries.length,preliminaryCount:preliminaryEntries.length,directEntries,preliminaryEntries,entries};
}

function validateQualifiedTeamSet(){
  const ids=typeof getQualifiedTeamIds==="function" ? getQualifiedTeamIds() : [];
  const list=Array.isArray(ids)?ids:[];
  const teamIds=new Set((tournament.teams||[]).map(t=>String(t.id)));
  const missing=list.filter(id=>id==null || String(id)==="" || !teamIds.has(String(id)));
  const seen=new Set(),duplicates=[];
  list.forEach(id=>{if(id==null || String(id)==="")return;const key=String(id);if(seen.has(key))duplicates.push(key);seen.add(key);});
  const emptySlots=list.filter(id=>id==null || String(id)==="").length;
  const errors=[];
  if(!Array.isArray(ids))errors.push("The qualified-team calculation did not return a valid team list.");
  if(emptySlots)errors.push(`${emptySlots} empty knockout slot(s) were returned as qualified teams; empty pairing slots must not count toward qualification.`);
  if(missing.length && missing.length!==emptySlots)errors.push(`${missing.length-emptySlots} qualified team ID(s) do not exist in the current tournament team list.`);
  if(duplicates.length)errors.push("The qualified-team calculation contains duplicate team IDs.");
  return {valid:errors.length===0,errors,ids:list,qualifiedCount:list.length-emptySlots};
}

function validateMainKnockoutEntryPlan(plan){
  const errors=[];
  if(!plan || !Number.isInteger(Number(plan.knockoutSize)) || Number(plan.knockoutSize)<2){
    errors.push("Main Knockout is not ready: qualification/entry structure is not available.");
  }
  const qualified=validateQualifiedTeamSet();
  const qualifiedTeamIds=qualified.ids.filter(id=>id!=null && String(id)!=="");
  errors.push(...qualified.errors);

  if(plan?.knockoutSize && qualifiedTeamIds.length!==Number(plan.qualifiedTeams)){
    errors.push(`Qualified-team count mismatch: ${Number(plan.qualifiedTeams)||0} calculated, ${qualifiedTeamIds.length} valid team ID(s) available.`);
  }
  if(plan?.knockoutSize && (plan.entries||[]).length!==Number(plan.knockoutSize)){
    errors.push(`Main Knockout requires ${Number(plan.knockoutSize)} entry slots, but ${plan.entries?.length||0} are currently available.`);
  }
  return {valid:errors.length===0,errors,qualifiedCount:qualifiedTeamIds.length};
}

function syncMainKnockoutEntries(){
  const plan=buildMainKnockoutEntryPlan();
  if(!plan.knockoutSize)return {valid:false,error:plan.error||"Main Knockout size is unavailable.",entries:[]};
  const entries=plan.entries.map(entry=>{
    const match=entry.sourceType==="PRELIMINARY"
      ? (tournament.preliminaryRound?.matches||[]).find(m=>String(m.id)===String(entry.preliminaryMatchId))
      : null;
    const winnerId=entry.sourceType==="PRELIMINARY"
      ? (isGeneratedMatchResultComplete(match) ? (match.winnerTeamId??match.result?.winnerTeamId??null) : null)
      : (entry.teamId??null);
    return {
      slot:entry.slot,sourceType:entry.sourceType,sourceId:entry.sourceId,
      sourceLabel:entry.sourceLabel,preliminaryMatchId:entry.preliminaryMatchId??null,
      teamId:winnerId,status:winnerId?"resolved":entry.sourceType==="DIRECT"?"resolved":"awaiting_preliminary"
    };
  });
  const seen=new Set(),duplicates=new Set();
  entries.forEach(e=>{if(!e.teamId)return;const id=String(e.teamId);if(seen.has(id))duplicates.add(id);seen.add(id);});
  const errors=[];
  if(duplicates.size)errors.push("A team is assigned to more than one Main Knockout entry slot.");
  tournament.mainKnockoutEntries=entries;
  tournament.mainKnockoutEntriesUpdatedAt=Date.now();
  return {valid:errors.length===0,error:errors.join(" "),knockoutSize:plan.knockoutSize,directCount:plan.directCount,preliminaryCount:plan.preliminaryCount,entries};
}
function feedPreliminaryWinnersIntoMainKnockout(){const result=syncMainKnockoutEntries();if(result.valid)saveLocal(true);return result;}

function knockoutRoundName(size){
  if(size===2)return "Final";
  if(size===4)return "Semi-final";
  if(size===8)return "Quarter-final";
  return `Round of ${size}`;
}
function knockoutSourceCode(size){
  if(size===8)return "Q";
  if(size===4)return "S";
  if(size===2)return "F";
  return "M";
}
function knockoutSourceForMatch(roundIndex,match){
  return `R${roundIndex+1}-${knockoutSourceCode(match.roundSize)}${match.number}`;
}

function getMainKnockoutDrawEntries(){
  const feed=syncMainKnockoutEntries();
  const entries=(feed.entries||[]).map(entry=>{
    const resolved=entry.teamId?calculateTournamentRanking().find(r=>String(r.teamId??r.id)===String(entry.teamId)):null;
    return {...entry,slot:Number(entry.slot),teamId:entry.teamId??null,team:resolved?.team??null,rankingRow:resolved??null};
  });
  return {valid:feed.valid,error:feed.error||"",knockoutSize:Number(feed.knockoutSize||0),entries};
}

function createMainKnockoutDraw(){
  const state=getMainKnockoutDrawEntries();
  if(!canBuildMainKnockout()){
    const status=getPreliminaryCompletionStatus();
    return {valid:false,error:`Main Knockout draw cannot be generated until all Pre-Knockout matches are completed (${status.completed}/${status.total}).`,rounds:[]};
  }
  if(!state.knockoutSize)return {valid:false,error:"Main Knockout size is unavailable.",rounds:[]};
  if(state.error)return {valid:false,error:state.error,rounds:[]};
  if(state.entries.length!==state.knockoutSize)return {valid:false,error:`Main Knockout requires ${state.knockoutSize} entry slots; ${state.entries.length} are available.`,rounds:[]};
  const unresolved=state.entries.filter(e=>!e.teamId);
  if(unresolved.length)return {valid:false,error:`${unresolved.length} Main Knockout entry slot(s) are still waiting for Pre-Knockout winners.`,unresolvedSlots:unresolved.map(e=>e.slot),rounds:[]};
  const seen=new Set(),duplicateSlots=[];
  state.entries.forEach(e=>{const id=String(e.teamId);if(seen.has(id))duplicateSlots.push(e.slot);seen.add(id);});
  if(duplicateSlots.length)return {valid:false,error:"The Main Knockout draw cannot be generated because a team appears in more than one entry slot.",duplicateSlots,rounds:[]};

  const n=state.knockoutSize;

  // Universal first-round draw:
  // Tournament Ranking defines strength; different-group opponents are
  // preferred, but a same-group pairing is allowed when no complete
  // different-group draw exists. Pre-Knockout entries are treated exactly
  // like every other entrant; there is no special PR-vs-PR prohibition.
  const rankedEntries=state.entries.map((entry,index)=>({
    ...entry,
    tournamentRank:Number(entry.rankingRow?.position ?? entry.rankingRow?.rank ?? index+1),
    groupLetter:entry.rankingRow?.groupLetter ?? entry.team?.groupLetter ?? entry.team?.group ?? "",
    group:entry.rankingRow?.groupLetter ?? entry.team?.groupLetter ?? entry.team?.group ?? ""
  }));
  const pairings=buildRankedKnockoutPairings(rankedEntries);
  if(pairings.length!==n/2){
    return {valid:false,error:"The Main Knockout draw could not produce the required number of first-round matches.",rounds:[]};
  }

  const round0=[];
  for(let i=0;i<pairings.length;i++){
    const a=pairings[i][0],b=pairings[i][1];
    round0.push({
      id:`R1-M${i+1}`,number:i+1,round:knockoutRoundName(n),roundSize:n,status:"pending",
      team1Id:a.teamId,team2Id:b.teamId,
      source1Slot:a.slot,source2Slot:b.slot,
      source1Type:a.sourceType,source2Type:b.sourceType,
      source1Id:a.sourceId,source2Id:b.sourceId,
      source1Label:a.sourceLabel,source2Label:b.sourceLabel,
      winnerTeamId:null,loserTeamId:null,score1:null,score2:null,result:null
    });
  }
  const rounds=[{name:knockoutRoundName(n),roundSize:n,matches:round0}];
  let previous=round0,roundSize=n/2,roundIndex=1;
  while(roundSize>=2){
    const currentSize=roundSize;
    const name=knockoutRoundName(currentSize);
    const matches=[];
    for(let i=0;i<currentSize/2;i++){
      const left=previous[i*2],right=previous[i*2+1];
      matches.push({
        id:`R${roundIndex+1}-M${i+1}`,number:i+1,round:name,roundSize:currentSize,status:"pending",
        team1Id:null,team2Id:null,
        feederMatch1Id:left.id,feederMatch2Id:right.id,
        source1Type:"MATCH",source2Type:"MATCH",source1Id:left.id,source2Id:right.id,
        source1Label:knockoutSourceForMatch(roundIndex-1,left),
        source2Label:knockoutSourceForMatch(roundIndex-1,right),
        winnerTeamId:null,loserTeamId:null,score1:null,score2:null,result:null
      });
    }
    rounds.push({name,roundSize:currentSize,matches});
    previous=matches;roundSize=currentSize/2;roundIndex++;
  }
  return {valid:true,error:"",knockoutSize:n,entries:state.entries,rounds};
}

function applyMainKnockoutDraw(){
  const result=createMainKnockoutDraw();
  if(!result.valid)return result;
  // Replacing the Main Knockout changes the semifinal dependency used by the
  // 3rd-place playoff. Never allow an older playoff to remain current.
  invalidateCompetitionStagesFrom("main-knockout","The Main Knockout draw was rebuilt.");
  tournament.mainKnockoutDraw={
    version:2,generatedAt:Date.now(),knockoutSize:result.knockoutSize,
    entrySlots:result.entries.map(e=>({slot:e.slot,teamId:e.teamId,sourceType:e.sourceType,sourceId:e.sourceId,sourceLabel:e.sourceLabel,preliminaryMatchId:e.preliminaryMatchId??null})),
    rounds:result.rounds
  };
  ensureStageBuildState().mainKnockout={
    signature:buildSignature(getMainKnockoutBuildInputs()),
    generatedAt:Date.now()
  };
  saveLocal(true);return result;
}
function getActiveMainKnockoutDraw(){return tournament.mainKnockoutDraw||null;}
function clearMainKnockoutDraw(){
  delete tournament.mainKnockoutDraw;
  ensureStageBuildState().mainKnockout=null;
  ensureStageBuildState().thirdPlace=null;
  tournament.thirdPlacePlayoff=null;
  saveLocal(true);
}

/* PRE-KNOCKOUT — Playability and completion
   The Pre-Knockout is a real playable stage. Admin can build it once,
   select any pending Pre-Knockout match, enter its score through the existing
   knockout-style result editor, and save it. A completed winner then feeds
   the corresponding main-knockout slot. This step does not build the main
   knockout draw yet. */
function getPreliminaryMatch(matchId){
  const matches=tournament.preliminaryRound?.matches||[];
  return matches.find(m=>String(m.id)===String(matchId))||null;
}

// Pre-Knockout is intentionally Best of 1; its UI supplies one game score.

/* ====================== preliminary.js ====================== */
function savePreliminaryResult(matchId,games,walkover=false,winnerTeamId=null){
  const match=getPreliminaryMatch(matchId);
  if(!match)return {error:"preliminary_match_not_found"};
  if(!match.teamAId||!match.teamBId)return {error:"preliminary_match_has_vacant_team"};

  let winner=winnerTeamId;
  if(!winner && !walkover){
    const totals={};
    totals[match.teamAId]=0;
    totals[match.teamBId]=0;
    (games||[]).forEach(g=>{
      const a=Number(g.a),b=Number(g.b);
      if(Number.isFinite(a)&&Number.isFinite(b)&&a!==b){
        if(a>b)totals[match.teamAId]++;
        else totals[match.teamBId]++;
      }
    });
    if(totals[match.teamAId]===totals[match.teamBId]){
      return {error:"preliminary_result_has_no_winner"};
    }
    winner=totals[match.teamAId]>totals[match.teamBId]
      ?match.teamAId:match.teamBId;
  }

  if(!winner)return {error:"preliminary_winner_required"};
  if(String(winner)!==String(match.teamAId)&&
     String(winner)!==String(match.teamBId)){
    return {error:"invalid_preliminary_winner"};
  }

  const loser=String(winner)===String(match.teamAId)
    ?match.teamBId:match.teamAId;

  match.result={
    games:Array.isArray(games)?games:[],
    walkover:!!walkover,
    winnerTeamId:winner,
    loserTeamId:loser,
    savedAt:Date.now()
  };
  match.winnerTeamId=winner;
  match.loserTeamId=loser;
  match.status="completed";
  match.updatedAt=Date.now();

  if(tournament.preliminaryRound){
    tournament.preliminaryRound.updatedAt=Date.now();
    tournament.preliminaryRound.winners=(tournament.preliminaryRound.matches||[])
      .filter(isGeneratedMatchResultComplete)
      .map(m=>m.winnerTeamId);
  }

  syncMainKnockoutEntries();
  // A Pre-Knockout result changes the resolved Main Knockout entry allocation.
  // Preserve any existing draw/results, but explicitly mark downstream stages
  // stale so they cannot silently be treated as current.
  invalidateCompetitionStagesFrom("preliminary-result","The Pre-Knockout result changed the Main Knockout allocation.");
  saveLocal(true);
  refreshAfterPreliminaryResult();
  return {ok:true,match,corrected:true};
}
function clearPreliminaryResult(matchId){
  const match=getPreliminaryMatch(matchId);
  if(!match)return;
  match.result=null;
  match.winnerTeamId=null;
  match.loserTeamId=null;
  match.status="pending";
  match.updatedAt=Date.now();

  if(tournament.preliminaryRound){
    tournament.preliminaryRound.updatedAt=Date.now();
    tournament.preliminaryRound.winners=(tournament.preliminaryRound.matches||[])
      .filter(isGeneratedMatchResultComplete)
      .map(m=>m.winnerTeamId);
  }

  syncMainKnockoutEntries();
  invalidateCompetitionStagesFrom("preliminary-result","The Pre-Knockout result was cleared, changing the Main Knockout allocation.");
  saveLocal(true);
  refreshAfterPreliminaryResult();
  showMessage("Pre-Knockout result cleared.");
}
function getPreliminaryCompletionStatus(){
  const matches=tournament.preliminaryRound?.matches||[];
  return {
    total:matches.length,
    completed:matches.filter(isGeneratedMatchResultComplete).length,
    pending:matches.filter(m=>!isGeneratedMatchResultComplete(m)).length,
    allCompleted:matches.length>0 &&
      matches.every(isGeneratedMatchResultComplete)
  };
}
function canBuildMainKnockout(){
  const status=getPreliminaryCompletionStatus();
  return status.allCompleted || status.total===0;
}


/* PRE-KNOCKOUT — UI and isolated score entry */
function preliminaryTeamById(id){
  return (tournament.teams||[]).find(t=>String(t.id)===String(id))||null;
}
function preliminaryTeamPlayers(team){
  if(!team)return"";
  return (team.playerIds||[]).map(pid=>
    (tournament.players||[]).find(p=>String(p.id)===String(pid))
  ).filter(Boolean).map(p=>p.name||p.displayName||"").filter(Boolean).join(", ");
}
function preliminaryTeamDisplay(team){
  if(!team)return "";
  const names=(team.playerIds||[])
    .map(pid=>tournament.players.find(p=>String(p.id)===String(pid))?.name||"")
    .filter(Boolean);
  return escapeHtml(names.join(", "));
}
function nextPendingPreliminaryMatchId(currentId){
  const matches=tournament.preliminaryRound?.matches||[];
  const index=matches.findIndex(m=>String(m.id)===String(currentId));
  const ordered=index>=0?matches.slice(index+1).concat(matches.slice(0,index)):matches;
  return ordered.find(m=>!isGeneratedMatchResultComplete(m))?.id ?? null;
}
function renderPreliminaryRound(){
  const host=$("preliminaryRound");
  if(!host)return;
  const previousDetails=host.querySelector(".preliminary-round-card");
  const previousOpen=previousDetails ? previousDetails.open : false;
  const plan=calculateKnockoutEntryPlan();
  const existing=getPreliminaryRound();
  const status=getPreliminaryCompletionStatus();
  const qualifiedCount=plan.qualifiedTeams||0;
  const directCount=plan.directTeams.length;
  const preliminaryCount=plan.preliminaryTeams.length;
  const expectedMatchCount=Math.floor(preliminaryCount/2);
  const existingMatchCount=existing?.matches?.length||0;
  const stageStale=getStageStaleInfo("preliminary");
  const preliminaryNeedsRebuild=stageStale.stale || (!!existing && existingMatchCount!==expectedMatchCount);
  const matchCount=preliminaryNeedsRebuild?expectedMatchCount:existingMatchCount;
  let html=`<details class="card preliminary-round-card">
    <summary><strong><span class="workspace-summary-icon" aria-hidden="true">🏸</span>Pre-Knockout</strong></summary>
    <div class="preliminary-round-content">
    <div class="muted">Qualified teams: ${qualifiedCount} || Knockout: ${plan.mainKnockoutSize||"—"} teams || Pre-Knockout teams: ${preliminaryCount} || Matches: ${matchCount}</div>
    <div class="ko-prelim-direct">
      <div class="ko-prelim-direct-title">Advanced to knockout: ${directCount}</div>
      <div id="preliminaryDirectList"></div>
    </div>
    <hr>
    <div><strong>Pre-Knockout matches:</strong></div>`;
  if(!existing?.matches?.length || preliminaryNeedsRebuild){
    if(!plan.preliminaryTeams.length){
      html+=`<div class="muted">No Pre-Knockout is required.</div>`;
    }else{
      if(preliminaryNeedsRebuild){
        html+=`<div class="preliminary-regenerate-warning">
          <strong>⚠ Pre-Knockout needs rebuilding</strong>
          <div class="muted">${escapeHtml(stageStale.reason||"The current Pre-Knockout structure differs from the generated pairings.")} Rebuilding will replace the existing Pre-Knockout pairings${status.completed>0?" and remove their recorded scores/results":""}.</div>
          <button class="btn btn-primary btn-small" id="regeneratePreliminaryRoundBtn">Regenerate Pre-Knockout</button>
        </div>`;
      }else{
        html+=`<button class="btn btn-primary" id="buildPreliminaryRoundBtn">Build Pre-Knockout</button>`;
      }
    }
  }else{
    html+=`<div class="ko-prelim-list">`;
    existing.matches.forEach(m=>{
      const a=preliminaryTeamById(m.teamAId),b=preliminaryTeamById(m.teamBId);
      const aInfo=preliminarySourceInfo(a);
      const bInfo=preliminarySourceInfo(b);
      const aSource=a?`${preliminarySourceInfo(a).source} ${preliminaryTeamDisplay(a)}`.trim():"—";
      const bSource=b?`${preliminarySourceInfo(b).source} ${preliminaryTeamDisplay(b)}`.trim():"—";
      const matchWinnerId=m.winnerTeamId?String(m.winnerTeamId):"";
      const aWinner=isGeneratedMatchResultComplete(m) && matchWinnerId===String(m.teamAId);
      const bWinner=isGeneratedMatchResultComplete(m) && matchWinnerId===String(m.teamBId);
      const aDisplay=`<span class="ko-prelim-team ${aWinner?"winner-team":""}"><span class="prelim-source">${escapeHtml(aInfo.source)}</span><span class="prelim-player">${preliminaryTeamDisplay(a)}</span></span>`;
      const bDisplay=`<span class="ko-prelim-team ${bWinner?"winner-team":""}"><span class="prelim-source">${escapeHtml(bInfo.source)}</span><span class="prelim-player">${preliminaryTeamDisplay(b)}</span></span>`;
      const selected=String(selectedPreliminaryMatchId||"")===String(m.id);
      html+=`<div class="fixture-row ko-prelim-match${selected?" selected-prelim-match":""}" data-prelim-match="${m.id}" role="button" tabindex="0" title="Select this Pre-Knockout match for scoring">
        <div class="fixture-number ko-prelim-match-number">${m.matchNumber}.</div>
        <div class="fixture-teams">${aDisplay}<span class="match-vs">VS</span>${bDisplay}</div>
        <span class="badge ko-prelim-status">${isGeneratedMatchResultComplete(m)?"✓":"—"}</span>
      </div>`;
    });
    html+=`</div>`;
  }
  html+=`  </div></details>`;
  host.innerHTML=html;
  const currentDetails=host.querySelector(".preliminary-round-card");
  if(currentDetails)currentDetails.open=previousOpen;

  const directHost=$("preliminaryDirectList");
  if(directHost){
    directHost.innerHTML=`
      <div class="ko-prelim-direct-table">
        <div class="ko-prelim-direct-row ko-prelim-direct-head">
          <span>Rank</span>
          <span title="Source">From</span>
          <span>Players Name</span>
        </div>
        ${plan.directTeams.map(row=>{
          const src=preliminarySourceInfo(row.team);
          const players=preliminaryTeamPlayers(row.team);
          return `<div class="ko-prelim-direct-row">
            <span>${row.tournamentRank??"—"}.</span>
            <span class="prelim-source">${src.source}</span>
            <span class="prelim-players participant-label winner-team">${players||"—"}</span>
          </div>`;
        }).join("")}
      </div>`;
  }

  const buildBtn=$("buildPreliminaryRoundBtn");
  if(buildBtn)buildBtn.onclick=()=>{
    const result=buildPreliminaryRound();
    if(result.error){alert(result.message||"Unable to build Pre-Knockout.");return;}
    renderAll();
  };

  const regenerateBtn=$("regeneratePreliminaryRoundBtn");
  if(regenerateBtn)regenerateBtn.onclick=()=>{
    const completed=status.completed>0;
    const message=completed
      ? `⚠ Regenerate Pre-Knockout?\n\n${status.completed} Pre-Knockout match${status.completed===1?" has":"es have"} completed results.\n\nRegenerating will replace the existing pairings and permanently remove their recorded scores and results.\n\nThis cannot be undone automatically.`
      : `Regenerate Pre-Knockout?\n\nThis will replace the existing Pre-Knockout pairings.\n\nNo completed match results are currently recorded.`;
    if(!confirm(message))return;

    const result=rebuildPreliminaryRound({force:true});
    if(result.error){
      alert(result.message||"Unable to regenerate Pre-Knockout.");
      return;
    }
    renderAll();
  };

  host.querySelectorAll("[data-prelim-match]").forEach(row=>{
    const selectMatch=()=>selectPreliminaryMatch(row.dataset.prelimMatch);
    row.addEventListener("click",selectMatch);
    row.addEventListener("keydown",e=>{
      if(e.key==="Enter"||e.key===" "){
        e.preventDefault();
        selectMatch();
      }
    });
  });

  // Only keep the floating scorecard open when the operator explicitly selected
  // a Pre-Knockout match. Rendering the stage must never open a scorecard by itself.
  if(existing?.matches?.length && floatingScorecardState.stage==="preliminary"){
    const selected=existing.matches.find(m=>String(m.id)===String(floatingScorecardState.matchId));
    if(selected)renderPreliminaryResultEditor(selected.id);
    else closeFloatingScorecard();
  }
}
function renderPreliminaryResultEditor(matchId){
  const host=$("floatingScorecard");
  if(!host)return;
  if(floatingScorecardState.stage!=="preliminary")return;
  const model=getPreliminaryScoreboardViewModel(matchId);
  if(!model){
    closeFloatingScorecard();
    return;
  }

  selectedPreliminaryMatchId=String(model.matchId);
  renderScoreboardViewModel(host,model,{
    inputClass:"prelim-score-input",
    inputIdA:"prelimScoreA",
    inputIdB:"prelimScoreB",
    saveButtonClass:"prelim-save-btn",
    saveButtonId:"savePreliminaryScoreBtn",
    walkoverWrapClass:"prelim-wo-row",
    walkoverButtonIdA:"prelimWoABtn",
    walkoverButtonIdB:"prelimWoBBtn",
    clearButtonId:"clearPreliminaryScoreBtn",
    cardClass:"group-result-editor-card prelim-result-editor-card",
    actionClass:"group-result-actions prelim-result-actions"
  });
  bindPreliminaryScoreboardActionBridge(host,model);
  bindScoreboardKeyboard(host,model);

  // After the final Enter/save action, return the cursor to the first
  // Pre-Knockout score field so the operator can immediately enter the next
  // result.
  if(!host.dataset.prelimFocusBound){
    host.dataset.prelimFocusBound="1";
    host.addEventListener("preliminary:focus-score-a",()=>{
      setTimeout(()=>{
        const input=$("prelimScoreA");
        if(input){input.focus();input.select();}
      },0);
    });
  }
}
function bindPreliminaryScoreboardActionBridge(host,model){
  if(!host||!model)return;
  host.querySelectorAll("[data-scoreboard-action]").forEach(button=>{
    button.addEventListener("click",()=>{
      const action=button.dataset.scoreboardAction;
      const id=String(model.matchId||"");

      if(action==="save"&&model.actions?.save){
        const av=Number($("prelimScoreA")?.value),bv=Number($("prelimScoreB")?.value);
        if(!Number.isFinite(av)||!Number.isFinite(bv)||av<0||bv<0||av===bv){
          alert("Enter a valid score with a winner.");
          return;
        }
        const result=savePreliminaryResult(id,[{a:av,b:bv}],false);
        if(result.error){alert(result.error);return;}
        const nextId=nextPendingPreliminaryMatchId(id);
        if(nextId){
          floatingScorecardState={stage:"preliminary",matchId:String(nextId),type:null};
          selectedPreliminaryMatchId=String(nextId);
        }
        renderPreliminaryRound();
        renderMainKnockoutAllocation();
        if(nextId)renderPreliminaryResultEditor(nextId);
        else if(!floatingScorecardState.matchId)closeFloatingScorecard();
        setTimeout(()=>{
          const first=$("prelimScoreA");
          if(first){first.focus();first.select();}
        },40);
      }else if(action==="walkover-a"&&model.actions?.walkoverA){
        const result=savePreliminaryResult(id,[],true,model.actions.walkoverA.winnerTeamId);
        if(result.error)alert(result.error);
        else{
          renderPreliminaryRound();
          renderMainKnockoutAllocation();
        }
      }else if(action==="walkover-b"&&model.actions?.walkoverB){
        const result=savePreliminaryResult(id,[],true,model.actions.walkoverB.winnerTeamId);
        if(result.error)alert(result.error);
        else{
          renderPreliminaryRound();
          renderMainKnockoutAllocation();
        }
      }else if(action==="clear"&&model.actions?.clear){
        clearPreliminaryResult(id);
      }
    });
  });
}
function rebuildPreliminaryRound(options={}){
  const existing=tournament.preliminaryRound;
  const force=options?.force===true;
  if(existing?.matches?.some(isGeneratedMatchResultComplete) && !force){
    return {error:"preliminary_round_has_completed_matches"};
  }
  if(existing){
    invalidateCompetitionStagesFrom("preliminary","The Pre-Knockout was rebuilt.");
    tournament.preliminaryRound=null;
  }
  const result=buildPreliminaryRound();
  if(!result.error)saveLocal(true);
  return result;
}
function getPreliminarySourceRecord(teamId){
  return getQualifiedTeamSourceRecords().find(
    r=>String(r.teamId)===String(teamId)
  )||null;
}
function preliminarySourceInfo(team){
  if(!team)return {group:"—",rank:"—",source:"—"};
  const record=getPreliminarySourceRecord(team.id);
  const group=String(record?.groupLetter||"").trim()||"—";
  const rank=record?.groupRank??"—";
  return {group,rank,source:`${group}${rank}`};
}

// DOWNSTREAM RENDERING ARCHITECTURE.
//
// The competition is a dependency chain. A mutation must refresh the changed
// stage first, then only the stages that consume its output:
//
//   Group result
//     -> Group standings
//     -> Qualification
//     -> Tournament ranking
//     -> Pre-Knockout
//     -> Main Knockout allocation
//     -> Main Knockout bracket
//     -> Main Knockout result editor
//     -> 3rd-place playoff
//     -> Podium
//
//   Pre-Knockout result
//     -> Main Knockout allocation
//     -> Main Knockout bracket
//     -> Main Knockout result editor
//     -> 3rd-place playoff
//     -> Podium
//
//   Main Knockout result
//     -> Main Knockout bracket
//     -> Main Knockout result editor
//     -> 3rd-place playoff
//     -> Podium
//
//   3rd-place result
//     -> Podium
//
// Persistence invalidates the calculation cache before these flows run, so
// targeted rendering can reuse the calculations already prepared by saveLocal().

/* ====================== entry.js ====================== */
// Badminton Tournament Manager — entry/player-pool/team-pool workflow
function invalidatePlayerPoolBuild(){
  ensurePlayerPoolState(Number(tournament.settings?.playerPoolCount)||2);
  const generatedIds=new Set((Array.isArray(tournament.playerPoolGeneratedTeams)
    ? tournament.playerPoolGeneratedTeams : []).map(String));

  if(generatedIds.size){
    const removedTeams=tournament.teams.filter(t=>generatedIds.has(String(t.id)));
    const removedPlayerIds=new Set(removedTeams.flatMap(t=>Array.isArray(t.playerIds)?t.playerIds:[]).map(String));

    tournament.teams=tournament.teams.filter(t=>!generatedIds.has(String(t.id)));
    tournament.players=tournament.players.filter(p=>!removedPlayerIds.has(String(p.id)));

    (tournament.groups||[]).forEach(group=>{
      if(Array.isArray(group.teamIds))
        group.teamIds=group.teamIds.filter(id=>!generatedIds.has(String(id)));
      if(Array.isArray(group.teams))
        group.teams=group.teams.filter(id=>!generatedIds.has(String(id)));
      group.teamCount=tournament.teams.filter(t=>String(t.groupId)===String(group.id)).length;
      group.updatedAt=Date.now();
    });

    // Generated teams may already have reached fixtures/results. Those records
    // are derived from the invalidated teams and must not survive the rebuild.
    const affectedFixtures=new Set((tournament.fixtures||[])
      .filter(f=>generatedIds.has(String(f.teamAId))||generatedIds.has(String(f.teamBId)))
      .map(f=>String(f.id)));
    tournament.fixtures=(tournament.fixtures||[]).filter(f=>!affectedFixtures.has(String(f.id)));
    tournament.results=(tournament.results||[]).filter(r=>!affectedFixtures.has(String(r.fixtureId)));
  }

  tournament.playerPoolGeneratedTeams=[];
  tournament.playerPoolDistributionComplete=false;
  tournament.playerPoolDistributionCounts={};
  tournament.playerPoolDistributionGroups=[];
  tournament.settings.playerPoolBuildInputSignature='';
}

function renderPlayerPools(){
  const wrap=$("playerPools");
  if(!wrap)return;

  const count=Math.max(2,Math.min(52,Number(tournament.settings?.playerPoolCount)||2));
  const pools=Array.isArray(tournament.playerPoolPlayers)?tournament.playerPoolPlayers:[];

  const poolsCreated=!!tournament.settings?.playerPoolsCreated ||
    pools.some(pool=>Array.isArray(pool)&&pool.some(x=>String(x?.name??x??"").trim()));

  if(!poolsCreated){
    wrap.innerHTML='<div class="empty directional-message" role="button" tabindex="0" onclick="openTournamentSettings(&quot;playerPoolCountSetting&quot;)" onkeydown="handleDirectionalKey(event,()=>openTournamentSettings(&quot;playerPoolCountSetting&quot;))">Declare pool first.</div>';
    return;
  }

  while(pools.length<count)pools.push([]);
  if(pools.length>count)pools.length=count;
  tournament.playerPoolPlayers=pools;

  let current=Number($("playerPoolEntrySelect")?.value);
  if(!Number.isInteger(current)||current<0||current>=count)current=0;

  let n=current+1,letter="";
  while(n>0){
    n--;
    letter=String.fromCharCode(65+(n%26))+letter;
    n=Math.floor(n/26);
  }

  const players=pools[current]||[];

  wrap.innerHTML=`<div class="entry-line">
    <select id="playerPoolEntrySelect" aria-label="Pool">
      ${Array.from({length:count},(_,i)=>{
        let n=i+1,l="";
        while(n>0){n--;l=String.fromCharCode(65+(n%26))+l;n=Math.floor(n/26);}
        return `<option value="${i}" ${i===current?"selected":""}>Pool ${l}</option>`;
      }).join("")}
    </select>
    <input id="playerPoolPlayerName" type="text" autocomplete="off" placeholder="Player name" aria-label="Player name" class="player-pool-player-name">
    <button type="button" class="btn btn-primary btn-small" id="addPoolPlayerBtn">Submit</button>
  </div>
  <div class="player-pool-entry-list" style="margin-top:0">
    ${players.length
      ? players.slice().reverse().map((entry,displayIndex)=>{
          const originalIndex=players.length-1-displayIndex;
          const name=String(entry?.name??entry??"");
          return `<div class="player-pool-entry-player" style="display:flex;align-items:center;gap:6px;margin-top:4px">
            <span style="width:24px;min-width:24px;font-weight:700;text-align:right">${originalIndex+1}.</span>
            <span class="player-pool-entry-player-name">${escapeHtml(name)}</span>
            <button type="button" class="btn btn-secondary btn-small" onclick="editPlayerPoolEntry(${current},${originalIndex})">Edit</button>
            <button type="button" class="btn btn-danger btn-small" onclick="removePlayerPoolEntry(${current},${originalIndex})" aria-label="Remove player">×</button>
          </div>`;
        }).join("")
      : '<div class="muted">No players added yet.</div>'}
  </div>`;

  bindPlayerPoolEntry();
}

function bindPlayerPoolEntry(){
  const add=$("addPoolPlayerBtn");
  const select=$("playerPoolEntrySelect");
  if(!add||!select)return;
  add.onclick=addPoolPlayerFromEntry;
  select.onchange=()=>{
    renderPlayerPools();
    $("playerPoolPlayerName")?.focus();
  };
}

function createPlayerPoolEntry(name){
  // Player names are display data only. Duplicate names are explicitly allowed.
  // Identity belongs to the persistent entry ID, which must be unique even when
  // two real-world players have exactly the same name.
  let entryId;
  do{ entryId=id("playerPoolEntry"); }
  while((tournament.playerPoolPlayers||[]).some(pool=>
    Array.isArray(pool)&&pool.some(entry=>String(entry?.id||"")===entryId)
  ));
  return {id:entryId,name:String(name||"").trim()};
}

function addPoolPlayerFromEntry(){
  const select=$("playerPoolEntrySelect");
  const input=$("playerPoolPlayerName");
  if(!select||!input)return;
  const pool=Number(select.value)||0;
  const name=input.value.trim();
  if(!name){
    input.focus();
    return;
  }

  const count=Math.max(2,Math.min(52,Number(tournament.settings?.playerPoolCount)||2));
  if(!Array.isArray(tournament.playerPoolPlayers))
    tournament.playerPoolPlayers=[];
  while(tournament.playerPoolPlayers.length<count)
    tournament.playerPoolPlayers.push([]);

  // Do NOT check the name for uniqueness. The same name may legitimately occur
  // multiple times in one pool or across different pools.
  invalidatePlayerPoolBuild();
  tournament.playerPoolPlayers[pool].push(createPlayerPoolEntry(name));
  tournament.settings.playerPoolsCreated=true;
  saveLocal(true);
  input.value="";
  renderPlayerPools();
  renderPlayerPoolBuildArea();
  $("playerPoolPlayerName")?.focus();
}

function editPlayerPoolEntry(pool,index){
  const players=tournament.playerPoolPlayers?.[pool];
  if(!Array.isArray(players)||index<0||index>=players.length)return;

  const entry=players[index];
  const current=String(entry?.name??entry??"").trim();
  const next=prompt("Edit player name.",current);
  if(next===null)return;

  const name=String(next).trim();
  if(!name){
    showMessage("Player name cannot be empty.","warning");
    return;
  }
  if(name===current)return;

  invalidatePlayerPoolBuild();
  if(entry && typeof entry === "object" && !Array.isArray(entry)) entry.name=name;
  else players[index]={id:id("playerPoolEntry"),name};
  saveLocal(true);
  renderPlayerPools();
  renderPlayerPoolBuildArea();
  $("playerPoolPlayerName")?.focus();
}

function removePlayerPoolEntry(pool,index){
  const players=tournament.playerPoolPlayers?.[pool];
  if(!Array.isArray(players)||index<0||index>=players.length)return;

  const name=String(players[index]?.name??players[index]??"").trim();
  if(!confirm(`Remove "${name}" from this player pool?`))return;

  invalidatePlayerPoolBuild();
  players.splice(index,1);
  saveLocal(true);
  renderPlayerPools();
  renderPlayerPoolBuildArea();
  $("playerPoolPlayerName")?.focus();
}

function ensureTeamPoolState(){
  if(!tournament.settings)tournament.settings={};
  if(!Array.isArray(tournament.settings.teamPoolEntries))tournament.settings.teamPoolEntries=[];
  tournament.settings.teamPoolEntries.forEach((entry,index)=>{
    if(!Array.isArray(entry.playerNames)){
      entry.playerNames=[entry.player1,entry.player2].map(x=>String(x??"").trim()).filter(Boolean);
    }
    entry.playerNames=entry.playerNames.map(x=>String(x??"").trim()).filter(Boolean);
    entry.number=Number(entry.number)||index+1;
    entry.name=String(entry.name||`Team ${index+1}`);
  });
  if(!Array.isArray(tournament.settings.teamPoolCommittedIds))tournament.settings.teamPoolCommittedIds=[];
  if(tournament.settings.teamPoolDistributionComplete===undefined)tournament.settings.teamPoolDistributionComplete=false;
  if(tournament.settings.teamPoolLotteryInputSignature===undefined)tournament.settings.teamPoolLotteryInputSignature='';
}

function teamPoolInputSignature(){
  ensureTeamPoolState();
  return JSON.stringify({
    mode:String(tournament.settings.mode||"doubles"),
    teams:tournament.settings.teamPoolEntries.map(entry=>({
      id:String(entry.id||''),
      playerNames:entry.playerNames.map(name=>String(name).trim())
    })),
    groups:(tournament.groups||[]).map(group=>({
      id:String(group.id||''),
      name:String(group.name||'')
    }))
  });
}

function invalidateTeamPoolLottery(){
  ensureTeamPoolState();
  const committedIds=new Set(tournament.settings.teamPoolCommittedIds.map(String));
  if(committedIds.size){
    const removedTeams=tournament.teams.filter(team=>committedIds.has(String(team.id)));
    const removedPlayerIds=new Set(removedTeams.flatMap(team=>Array.isArray(team.playerIds)?team.playerIds:[]).map(String));
    tournament.teams=tournament.teams.filter(team=>!committedIds.has(String(team.id)));
    tournament.players=tournament.players.filter(player=>!removedPlayerIds.has(String(player.id)));
    (tournament.groups||[]).forEach(group=>{
      if(Array.isArray(group.teamIds))group.teamIds=group.teamIds.filter(id=>!committedIds.has(String(id)));
      if(Array.isArray(group.teams))group.teams=group.teams.filter(id=>!committedIds.has(String(id)));
      group.teamCount=tournament.teams.filter(team=>String(team.groupId)===String(group.id)).length;
      group.updatedAt=Date.now();
    });
  }
  tournament.settings.teamPoolCommittedIds=[];
  tournament.settings.teamPoolDistributionComplete=false;
  tournament.settings.teamPoolDistributionCounts={};
  tournament.settings.teamPoolLotteryInputSignature='';
}

function renderTeamPool(){
  const list=$("teamPoolList"), summary=$("teamPoolSummary"), lotteryBtn=$("teamPoolLotteryBtn"), entryLine=$("teamPoolEntryLine");
  if(!list||!summary)return;
  ensureTeamPoolState();
  const groups=tournament.groups||[];
  if(!groups.length){
    if(entryLine){
      entryLine.style.display="";
      entryLine.innerHTML='<div class="empty directional-message" role="button" tabindex="0" onclick="openTournamentSettings()" onkeydown="handleDirectionalKey(event,openTournamentSettings)">Declare groups first.</div>';
    }
    list.innerHTML="";
    summary.textContent="";
    if(lotteryBtn)lotteryBtn.style.display="none";
    return;
  }
  if(entryLine){
    entryLine.style.display="";
    entryLine.innerHTML='<div id="teamPoolPlayerFields" style="display:contents"></div><button type="button" class="btn btn-primary btn-small" id="teamPoolAddBtn" onclick="addTeamPoolEntry()">Submit</button>';
  }
  renderTeamPoolEntryFields();
  const entries=tournament.settings.teamPoolEntries;
  const displayEntries=[...entries].reverse();
  if(lotteryBtn)lotteryBtn.style.display="none";
  if(!entries.length){
    list.innerHTML="";
    summary.textContent="";
  }else{
    list.innerHTML=displayEntries.map((entry,index)=>{
      const players=entry.playerNames.filter(Boolean).join(", ");
      return `<div class="live-team">
        <div class="live-team-number">${escapeHtml(entry.name||"Team "+(index+1))}</div>
        <div class="live-team-players team-pool-player-list">${players?escapeHtml(players):'<span class="muted">No players</span>'}</div>
        <div class="live-actions">
          <button type="button" class="btn btn-secondary btn-small" onclick="editTeamPoolEntry('${escapeHtml(entry.id)}')">Edit</button>
          <button type="button" class="btn btn-danger btn-small" onclick="removeTeamPoolEntry('${escapeHtml(entry.id)}')">×</button>
        </div>
      </div>`;
    }).join("");
  }
  const distributionComplete=!!tournament.settings.teamPoolDistributionComplete && tournament.settings.teamPoolLotteryInputSignature===teamPoolInputSignature();
  const distributionCounts=tournament.settings.teamPoolDistributionCounts||{};
  if(lotteryBtn){
    const lotteryReady=entries.length>0 && (tournament.groups||[]).length>0 && !distributionComplete;
    lotteryBtn.style.display=lotteryReady?"":"none";
    lotteryBtn.disabled=false;
    lotteryBtn.textContent="🎲 Lottery / Distribute";
  }
  if(distributionComplete){
    const distributed=tournament.groups.map(group=>`${group.name||"Group"}: ${Number(distributionCounts[String(group.id)])||0}`).filter((_,i)=>Number(distributionCounts[String(tournament.groups[i]?.id)])>0);
    summary.textContent=`Distributed · ${distributed.join(" · ")}`;
  }else if(entries.length){
    summary.textContent=`${entries.length} team${entries.length===1?"":"s"} in Team Pool.`;
  }
}

function addTeamPoolEntry(){
  ensureTeamPoolState();
  const mode=tournament.settings?.mode||"doubles";
  const inputs=[...document.querySelectorAll("#teamPoolPlayerFields .team-pool-player-input")];
  const names=inputs.map(i=>i.value.trim()).filter(Boolean);
  const required=modePlayerCount(mode);
  if(required!==null && names.length!==required){showMessage(`${mode==="singles"?"Singles requires exactly one player.":"Doubles requires exactly two players."}`,"warning");return;}
  if(mode==="multiplayer" && names.length<1){showMessage("Enter at least one player.","warning");return;}
  if(inputs.length!==names.length){
    const first=inputs.find(i=>!i.value.trim());
    showMessage("Complete all player fields or remove unused fields.","warning");
    first?.focus();
    return;
  }
  invalidateTeamPoolLottery();
  const number=tournament.settings.teamPoolEntries.length+1;
  tournament.settings.teamPoolEntries.push({id:id('teamPoolEntry'),number,name:`Team ${number}`,playerNames:names,player1:names[0]||"",player2:names[1]||"",createdAt:Date.now(),updatedAt:Date.now()});
  tournament.settings.teamPoolDistributionComplete=false;
  saveLocal(true);
  renderTeamPool();
  const first=document.querySelector("#teamPoolPlayerFields .team-pool-player-input");
  first?.focus();
}

function editTeamPoolEntry(entryId){
  ensureTeamPoolState();
  const entry=tournament.settings.teamPoolEntries.find(x=>String(x.id)===String(entryId));
  if(!entry)return;
  const mode=tournament.settings?.mode||"doubles";
  const current=entry.playerNames.join(", ");
  const entered=prompt(`Edit player names for ${entry.name||("Team "+entry.number)}. Separate names with commas.`,current);
  if(entered===null)return;
  const names=entered.split(",").map(x=>x.trim()).filter(Boolean);
  const required=modePlayerCount(mode);
  if(required!==null && names.length!==required){showMessage(mode==="singles"?"Singles requires exactly one player.":"Doubles requires exactly two player names separated by commas.","warning");return;}
  if(mode==="multiplayer" && names.length<1){showMessage("A team needs at least one player.","warning");return;}
  const changed=JSON.stringify(entry.playerNames)!==JSON.stringify(names);
  if(changed)invalidateTeamPoolLottery();
  entry.playerNames=names;
  entry.player1=names[0]||"";
  entry.player2=names[1]||"";
  entry.updatedAt=Date.now();
  tournament.settings.teamPoolDistributionComplete=false;
  addHistory("Team Pool entry edited",entry.name||("Team "+entry.number));
  saveLocal(true);
  renderTeamPool();
}

function removeTeamPoolEntry(entryId){
  ensureTeamPoolState();
  const entries=tournament.settings.teamPoolEntries;
  const index=entries.findIndex(x=>String(x.id)===String(entryId));
  if(index<0)return;
  const entry=entries[index];
  if(!confirm(`Remove ${entry.name||("Team "+(index+1))} from Team Pool?`))return;
  invalidateTeamPoolLottery();
  entries.splice(index,1);
  entries.forEach((item,i)=>{item.number=i+1;item.name=`Team ${i+1}`;item.updatedAt=Date.now();});
  tournament.settings.teamPoolDistributionComplete=false;
  addHistory("Team Pool entry removed",entry.name||("Team "+(index+1)));
  saveLocal(true);
  renderTeamPool();
}

function runTeamPoolLottery(){
  ensureTeamPoolState();
  const entries=tournament.settings.teamPoolEntries, groups=tournament.groups||[];
  if(!entries.length){showMessage("Add at least one team to Team Pool first.","warning");return;}
  if(!groups.length){showMessage("Create groups first.","warning");openTournamentSettings();return;}
  const mode=tournament.settings?.mode||"doubles";
  const required=modePlayerCount(mode);
  const invalidEntry=entries.find(entry=>{
    const count=Array.isArray(entry.playerNames)?entry.playerNames.filter(Boolean).length:0;
    return required!==null ? count!==required : count<1;
  });
  if(invalidEntry){
    showMessage(mode==="singles"
      ? `${invalidEntry.name||"A Team Pool entry"} must contain exactly one player.`
      : mode==="doubles"
        ? `${invalidEntry.name||"A Team Pool entry"} must contain exactly two players.`
        : `${invalidEntry.name||"A Team Pool entry"} must contain at least one player.`,"warning");
    return;
  }
  const currentSignature=teamPoolInputSignature();
  const lotteryLocked=!!tournament.settings.teamPoolDistributionComplete && tournament.settings.teamPoolLotteryInputSignature===currentSignature;
  if(lotteryLocked){showMessage("Lottery already completed. Change the Team Pool input data to run the lottery again.","warning");renderTeamPool();return;}
  const hasCommittedTeams=Array.isArray(tournament.settings.teamPoolCommittedIds)&&tournament.settings.teamPoolCommittedIds.length>0;
  if(tournament.settings.teamPoolDistributionComplete||hasCommittedTeams)invalidateTeamPoolLottery();
  const committedIds=Array.isArray(tournament.settings.teamPoolCommittedIds)?tournament.settings.teamPoolCommittedIds:[];
  const committedTeams=committedIds.map(teamId=>tournament.teams.find(t=>String(t.id)===String(teamId))).filter(Boolean);
  const entryById=new Map(entries.map(entry=>[String(entry.id),entry]));
  let poolTeams=committedTeams.filter(team=>entryById.has(String(team.teamPoolEntryId)));
  const now=Date.now();
  entries.forEach(entry=>{
    if(poolTeams.some(team=>String(team.teamPoolEntryId)===String(entry.id)))return;
    const playerIds=entry.playerNames.map(name=>{const player={id:id("player"),name};tournament.players.push(player);return player.id;});
    poolTeams.push({id:id("team"),number:null,name:entry.name||(`Team ${entry.number}`),displayName:"",format:modeToTeamFormat(tournament.settings?.mode||"doubles"),playerIds,groupId:null,teamPoolEntry:true,teamPoolEntryId:entry.id,createdAt:now,updatedAt:now});
    tournament.teams.push(poolTeams[poolTeams.length-1]);
  });
  tournament.settings.teamPoolCommittedIds=poolTeams.map(team=>team.id);
  poolTeams.forEach(team=>{
    groups.forEach(group=>{
      if(Array.isArray(group.teamIds))group.teamIds=group.teamIds.filter(id=>String(id)!==String(team.id));
      if(Array.isArray(group.teams))group.teams=group.teams.filter(id=>String(id)!==String(team.id));
    });
    team.groupId=null;team.number=null;
  });
  const shuffled=shuffleArray(poolTeams), allocations=groups.map(group=>({group,teams:[]}));
  shuffled.forEach((team,index)=>allocations[index%allocations.length].teams.push(team));
  allocations.forEach(({group,teams})=>{
    const existingNumbers=tournament.teams.filter(team=>String(team.groupId)===String(group.id)&&!poolTeams.some(poolTeam=>String(poolTeam.id)===String(team.id))).map(team=>Number(team.number)).filter(Number.isFinite);
    let nextNumber=existingNumbers.length?Math.max(...existingNumbers)+1:1;
    if(!Array.isArray(group.teamIds))group.teamIds=[];
    if(!Array.isArray(group.teams))group.teams=[];
    teams.forEach(team=>{team.groupId=group.id;team.number=nextNumber++;team.name=`Team ${team.number}`;team.updatedAt=Date.now();if(!group.teamIds.some(id=>String(id)===String(team.id)))group.teamIds.push(team.id);if(!group.teams.some(id=>String(id)===String(team.id)))group.teams.push(team.id);});
    group.teamCount=tournament.teams.filter(team=>String(team.groupId)===String(group.id)).length;group.updatedAt=Date.now();
  });
  tournament.settings.teamPoolDistributionComplete=true;
  tournament.settings.teamPoolLotteryInputSignature=currentSignature;
  tournament.settings.teamPoolDistributionCounts={};
  allocations.forEach(({group,teams})=>tournament.settings.teamPoolDistributionCounts[String(group.id)]=teams.length);
  addHistory("Team Pool distributed",`${poolTeams.length} team${poolTeams.length===1?"":"s"} across ${groups.length} group${groups.length===1?"":"s"}`);
  saveLocal(true);refreshControlled("team-change");renderTeamPool();
  const counts=allocations.filter(x=>x.teams.length).map(x=>`${x.group.name||"Group"}: ${x.teams.length}`);
  showMessage(`Team Pool distributed. ${counts.join(" · ")}`);
}

function switchEntryTab(tab){
  const teamPoolPanel=$("teamPoolPanel");
  const manualPanel=$("addTeamPanel");
  const playerPoolPanel=$("playerPoolPanel");
  const teamPoolBtn=$("teamPoolTabBtn");
  const playerPoolBtn=$("openPlayerPoolBtn");
  const manualBtn=$("manualTeamEntryBtn");
  const isTeamPool=tab==="teamPool";
  const isPlayerPool=tab==="pool";

  // Player Pool remains part of the application and persisted tournament data.
  // It is only deactivated as an entry workflow for Singles tournaments.
  if(isPlayerPool && tournament.settings?.mode==="singles")tab="teamPool";

  const showTeamPool=tab==="teamPool";
  const showPlayerPool=tab==="pool";
  if(teamPoolPanel)teamPoolPanel.hidden=!showTeamPool;
  if(playerPoolPanel)playerPoolPanel.hidden=!showPlayerPool;
  if(manualPanel)manualPanel.hidden=true;

  if(teamPoolBtn){teamPoolBtn.classList.toggle("active",showTeamPool);teamPoolBtn.setAttribute("aria-selected",showTeamPool?"true":"false");}
  if(playerPoolBtn){playerPoolBtn.classList.toggle("active",showPlayerPool);playerPoolBtn.classList.toggle("btn-primary",showPlayerPool);playerPoolBtn.classList.toggle("btn-secondary",!showPlayerPool);playerPoolBtn.setAttribute("aria-selected",showPlayerPool?"true":"false");}
  if(manualBtn){manualBtn.classList.remove("active");manualBtn.classList.remove("btn-primary");manualBtn.classList.add("btn-secondary");manualBtn.setAttribute("aria-selected","false");}
  if(showTeamPool)renderTeamPool();
  if(showPlayerPool)renderPlayerPool();
}

function openManualTeamEntry(){
  const teamPoolPanel=$("teamPoolPanel"), manualPanel=$("addTeamPanel"), playerPoolPanel=$("playerPoolPanel"), teamPoolBtn=$("teamPoolTabBtn"), playerPoolBtn=$("openPlayerPoolBtn"), manualBtn=$("manualTeamEntryBtn");
  if(teamPoolPanel)teamPoolPanel.hidden=true;
  if(playerPoolPanel)playerPoolPanel.hidden=true;
  if(manualPanel)manualPanel.hidden=false;
  if(teamPoolBtn){teamPoolBtn.classList.remove("active");teamPoolBtn.setAttribute("aria-selected","false");}
  if(playerPoolBtn){playerPoolBtn.classList.remove("active");playerPoolBtn.classList.remove("btn-primary");playerPoolBtn.classList.add("btn-secondary");playerPoolBtn.setAttribute("aria-selected","false");}
  if(manualBtn){manualBtn.classList.add("active");manualBtn.classList.remove("btn-secondary");manualBtn.classList.add("btn-primary");manualBtn.setAttribute("aria-selected","true");}
  requestAnimationFrame(()=>{scrollToPlayerTeamEntryHeader();$("entryGroup")?.focus({preventScroll:true});});
}

function initEntryTabs(){
  const teamPoolBtn=$("teamPoolTabBtn"), manualBtn=$("manualTeamEntryBtn");
  if(!teamPoolBtn||!manualBtn)return;
  teamPoolBtn.onclick=()=>switchEntryTab("teamPool");
  manualBtn.onclick=openManualTeamEntry;
  switchEntryTab("teamPool");
}

function shuffleArray(arr){
  const a=[...arr];
  for(let i=a.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}

function distributePlayerPoolTeams(generated){
  const groups=tournament.groups||[];
  if(!groups.length)return [];

  // The lottery already randomized the generated-team order. Distribution is
  // deterministic from that lottery result; do not perform a second shuffle.
  generated.forEach(team=>{
    (tournament.groups||[]).forEach(group=>{
      if(Array.isArray(group.teamIds))
        group.teamIds=group.teamIds.filter(id=>String(id)!==String(team.id));
      if(Array.isArray(group.teams))
        group.teams=group.teams.filter(id=>String(id)!==String(team.id));
    });
    team.groupId=null;
    team.number=null;
  });

  const allocations=groups.map(group=>({group,teams:[]}));
  generated.forEach((team,index)=>{
    allocations[index%allocations.length].teams.push(team);
  });

  allocations.forEach(({group,teams})=>{
    const existingNumbers=tournament.teams
      .filter(team=>String(team.groupId)===String(group.id)&&!generated.some(g=>String(g.id)===String(team.id)))
      .map(team=>Number(team.number))
      .filter(Number.isFinite);
    let nextNumber=existingNumbers.length?Math.max(...existingNumbers)+1:1;

    if(!Array.isArray(group.teamIds))group.teamIds=[];
    if(!Array.isArray(group.teams))group.teams=[];

    teams.forEach(team=>{
      team.groupId=group.id;
      team.number=nextNumber++;
      team.name=`Team ${team.number}`;
      team.updatedAt=Date.now();
      if(!group.teamIds.some(id=>String(id)===String(team.id)))group.teamIds.push(team.id);
      if(!group.teams.some(id=>String(id)===String(team.id)))group.teams.push(team.id);
    });

    group.teamCount=tournament.teams.filter(team=>String(team.groupId)===String(group.id)).length;
    group.updatedAt=Date.now();
  });

  tournament.playerPoolDistributionComplete=true;
  tournament.playerPoolDistributionCounts={};
  tournament.playerPoolDistributionGroups=groups.map(group=>group.id);
  allocations.forEach(({group,teams})=>{
    tournament.playerPoolDistributionCounts[String(group.id)]=teams.length;
  });

  return allocations;
}

function renderPlayerPoolBuildArea(){
  const area=$("playerPoolBuildArea");
  if(!area)return;
  area.style.display="block";

  const pools=Array.isArray(tournament.playerPoolPlayers)?tournament.playerPoolPlayers:[];
  const count=Math.max(2,Number(tournament.settings?.playerPoolCount)||2);
  const completeCount=Math.min(...Array.from({length:count},(_,i)=>
    Array.isArray(pools[i])?pools[i].filter(entry=>String(entry?.name??entry??"").trim()).length:0
  ));
  const generatedIds=Array.isArray(tournament.playerPoolGeneratedTeams)?tournament.playerPoolGeneratedTeams:[];
  let generated=generatedIds.map(gid=>
    tournament.teams.find(t=>String(t.id)===String(gid))
  ).filter(t=>t&&t.playerPoolGenerated);

  if(!generated.length){
    generated=(tournament.teams||[]).filter(t=>t&&t.playerPoolGenerated&&!t.groupId);
    if(generated.length){
      tournament.playerPoolGeneratedTeams=generated.map(t=>t.id);
    }else{
      tournament.playerPoolGeneratedTeams=[];
      tournament.playerPoolDistributionComplete=false;
    }
  }else if(generated.length!==generatedIds.length){
    tournament.playerPoolGeneratedTeams=generated.map(t=>t.id);
  }

  const currentSignature=playerPoolBuildInputSignature();
  const buildLocked=generated.length>0 && tournament.settings.playerPoolBuildInputSignature===currentSignature && !!tournament.playerPoolDistributionComplete;
  const staleBuild=generated.length>0 && tournament.settings.playerPoolBuildInputSignature!==currentSignature;
  const summary=$("playerPoolBuildSummary");

  if(summary){
    if(buildLocked && tournament.playerPoolDistributionComplete){
      const groups=tournament.groups||[];
      const counts=groups
        .map(group=>({group,count:generated.filter(t=>String(t.groupId)===String(group.id)).length}))
        .filter(x=>x.count>0)
        .map(x=>`${x.group.name||"Group"}: ${x.count}`);
      summary.textContent=`${generated.length} team${generated.length===1?"":"s"} built and distributed${counts.length?" · "+counts.join(" · "):""}.`;
    }else if(buildLocked){
      summary.textContent=`${generated.length} team${generated.length===1?"":"s"} built. Ready for distribution.`;
    }else if(staleBuild){
      summary.textContent="Player Pool changed. Run the lottery again.";
    }else if(completeCount){
      summary.textContent=`${completeCount} complete team${completeCount===1?"":"s"} can be built.`;
    }else{
      summary.textContent="";
    }
  }

  const btn=$("playerPoolLotteryBtn");
  if(btn){
    // Show the action only when every player pool has at least one player,
    // groups exist for distribution, and the previous build is not locked.
    // An interrupted same-input build remains actionable so distribution can
    // be completed without drawing a new lottery.
    const poolsReady=Array.from({length:count},(_,i)=>Array.isArray(pools[i])&&pools[i].some(entry=>String(entry?.name??entry??"").trim())).every(Boolean);
    const resumableBuild=generated.length>0 && tournament.settings.playerPoolBuildInputSignature===currentSignature && !tournament.playerPoolDistributionComplete;
    const lotteryReady=(tournament.groups||[]).length>0 && !buildLocked && (poolsReady || resumableBuild);
    btn.style.display=lotteryReady?"":"none";
    btn.disabled=false;
    btn.textContent="🎲 Lottery / Build Teams / Distribute Teams";
  }
}
function renderPlayerPoolGeneratedPreview(){
  const el=$("playerPoolGeneratedPreview");
  if(!el)return;
  const ids=Array.isArray(tournament.playerPoolGeneratedTeams)?tournament.playerPoolGeneratedTeams:[];
  const teams=ids.map(tid=>tournament.teams.find(t=>t.id===tid)).filter(Boolean);
  if(!teams.length){
    el.innerHTML="";
    return;
  }
  el.innerHTML=`<div class="player-pool-build-summary"><strong>Generated Teams</strong></div>`+
    teams.map((t,i)=>{
      const names=(t.playerIds||[]).map(pid=>tournament.players.find(p=>p.id===pid)?.name||"").filter(Boolean);
      return `<div class="player-pool-generated-team" style="padding:5px 0;border-top:1px solid #e5e7eb"><strong class="player-pool-generated-team-number">${i+1}.</strong>${escapeHtml(names.join(" + "))}</div>`;
    }).join("");
}
function runPlayerPoolLottery(){
  // Player Pool is an atomic workflow: lottery, build, then automatic
  // distribution across every existing group. A group setup is therefore
  // required before the lottery starts.
  try{
    const groups=tournament.groups||[];
    if(!groups.length){
      showMessage("Create groups first.","warning");
      openTournamentSettings();
      return;
    }

    const currentSignature=playerPoolBuildInputSignature();
    const generatedIds=Array.isArray(tournament.playerPoolGeneratedTeams)?tournament.playerPoolGeneratedTeams:[];
    const sameInput=generatedIds.length>0 && tournament.settings.playerPoolBuildInputSignature===currentSignature;
    const buildLocked=sameInput && !!tournament.playerPoolDistributionComplete;
    if(buildLocked){
      showMessage("Lottery already completed. Change the Player Pool input data to run the lottery again.","warning");
      return;
    }

    // If a previous build was interrupted after team creation, finish its
    // distribution instead of drawing a new lottery. Only changed input can
    // invalidate the existing result.
    if(sameInput && generatedIds.length){
      const existingGenerated=generatedIds.map(gid=>
        tournament.teams.find(t=>String(t.id)===String(gid))
      ).filter(t=>t&&t.playerPoolGenerated);
      if(existingGenerated.length===generatedIds.length){
        const allocations=distributePlayerPoolTeams(existingGenerated);
        tournament.settings.playerPoolBuildInputSignature=currentSignature;
        addHistory("Player Pool teams distributed",`${existingGenerated.length} team${existingGenerated.length===1?"":"s"} across ${(tournament.groups||[]).length} groups`);
        saveLocal(true);
        renderPlayerPools();
        renderPlayerPoolBuildArea();
        renderPlayerPoolGeneratedPreview();
        const counts=allocations.map(x=>`${x.group.name||"Group"}: ${x.teams.length}`);
        showMessage(`Teams built and distributed. ${counts.join(" · ")}`);
        refreshControlled("team-change");
        return;
      }
    }

    if(generatedIds.length)invalidatePlayerPoolBuild();

    const count=Math.max(2,Math.min(52,Number(tournament.settings?.playerPoolCount)||2));
    const pools=Array.from({length:count},(_,i)=>(
      Array.isArray(tournament.playerPoolPlayers?.[i])
        ? tournament.playerPoolPlayers[i]
        : []
    ).map(entry=>({id:String(entry?.id||""),name:String(entry?.name??entry??"").trim()})).filter(entry=>entry.name));

    if(pools.some(p=>p.length===0)){
      showMessage("Every player pool must contain at least one player.","warning");
      return;
    }

    const teamCount=Math.min(...pools.map(p=>p.length));
    // This is the single lottery. The resulting order is then dealt
    // round-robin across all existing groups without another random shuffle.
    // Keep each shuffled player paired with its persistent Player Pool entry.
    // Player names are display data only; duplicate names are valid.
    const shuffled=pools.map(pool=>shuffleArray(pool));
    const generated=[];
    const now=Date.now();

    for(let i=0;i<teamCount;i++){
      const selections=shuffled.map(pool=>pool[i]);
      const playerIds=selections.map(selection=>{
        const p={
          id:id("player"),
          name:selection.name,
          playerPoolSource:{
            entryId:selection.id
          }
        };
        tournament.players.push(p);
        return p.id;
      });
      generated.push({
        id:id("team"),
        number:null,
        name:`Team ${i+1}`,
        displayName:"",
        format:"team",
        playerIds,
        groupId:null,
        playerPoolGenerated:true,
        createdAt:now,
        updatedAt:now
      });
    }

    tournament.playerPoolGeneratedTeams=generated.map(t=>t.id);
    tournament.settings.playerPoolBuildInputSignature=currentSignature;
    tournament.teams.push(...generated);

    const allocations=distributePlayerPoolTeams(generated);
    const counts=allocations.map(x=>`${x.group.name||"Group"}: ${x.teams.length}`);

    addHistory("Player Pool teams built and distributed",`${teamCount} team${teamCount===1?"":"s"} across ${groups.length} group${groups.length===1?"":"s"}`);
    saveLocal(true);
    renderPlayerPools();
    renderPlayerPoolBuildArea();
    renderPlayerPoolGeneratedPreview();

    const btn=$("playerPoolLotteryBtn");
    if(btn){
      btn.disabled=true;
      btn.textContent="✓ Lottery completed";
    }

    showMessage(`Lottery completed. ${teamCount} team${teamCount===1?"":"s"} built and distributed. ${counts.join(" · ")}`);
    refreshControlled("team-change");
  }catch(error){
    console.error("Player Pool lottery/build/distribute failed:",error);
    showMessage(`Could not complete lottery: ${error?.message||"Unexpected error."}`,"warning");
  }
}



/* ====================== groups.js ====================== */
function fixtureId(groupId,aId,bId){
  return [groupId,aId,bId].sort().join("_");
}
function generateGroupFixtures(groupId,force=false){
  const group=tournament.groups.find(g=>g.id===groupId);
  if(!group)return;
  const teams=tournament.teams.filter(t=>t.groupId===groupId).sort((a,b)=>a.number-b.number);
  if(teams.length<2){
    showMessage("At least 2 teams are required to generate fixtures.");
    return;
  }

  const stale=getStageStaleInfo("group-fixtures",{groupId});
  const groupFixtures=tournament.fixtures.filter(f=>String(f.groupId)===String(groupId));
  const completedResults=groupFixtures.filter(f=>!!fixtureResult(f.id)).length;
  if(stale.stale && groupFixtures.length && !force){
    const message=completedResults
      ? `⚠ Rebuild ${group.name} fixtures?\n\n${completedResults} existing fixture result${completedResults===1?" is":"s are"} recorded in this group. Results for pairings that no longer exist will be removed. Existing matching fixture results will be preserved where possible.\n\nContinue?`
      : `Rebuild ${group.name} fixtures?\n\n${stale.reason}\n\nContinue?`;
    if(!confirm(message))return;
  }
  const existing=tournament.fixtures.filter(f=>f.groupId!==groupId);
  const generated=[];
  let n=1;

  for(let i=0;i<teams.length;i++){
    for(let j=i+1;j<teams.length;j++){
      const a=teams[i],b=teams[j];
      const id=fixtureId(groupId,a.id,b.id);
      const old=tournament.fixtures.find(f=>f.id===id);
      generated.push(old||{
        id,
        groupId,
        stage:"group",
        number:n,
        teamAId:a.id,
        teamBId:b.id,
        status:"pending",
        result:null,
        createdAt:Date.now()+n
      });
      n++;
    }
  }

  tournament.fixtures=existing.concat(generated);
  ensureStageBuildState().groupFixtures[String(groupId)]={
    signature:buildSignature(getGroupFixtureBuildInputs(groupId)),
    generatedAt:Date.now()
  };
  addHistory("Group fixtures generated",group.name+" ("+generated.length+" matches)");
  saveLocal(true);
  renderFixtures();
  renderSummary();
  showMessage(generated.length+" fixtures generated for "+group.name+".");
}
function generateAllGroupFixtures(){
  if(!tournament.groups.length){
    showMessage("Create groups first.");
    return;
  }
  let total=0;
  tournament.groups.forEach(g=>{
    const teams=tournament.teams.filter(t=>t.groupId===g.id);
    if(teams.length>=2){
      generateGroupFixturesSilent(g.id);
      total+=teams.length*(teams.length-1)/2;
    }
  });
  addHistory("All group fixtures generated",String(total)+" matches");
  saveLocal(true);
  renderFixtures();
  renderSummary();
  showMessage(total+" group fixtures generated.");
}
function generateGroupFixturesSilent(groupId){
  const group=tournament.groups.find(g=>g.id===groupId);
  const teams=tournament.teams.filter(t=>t.groupId===groupId).sort((a,b)=>a.number-b.number);
  const existing=tournament.fixtures.filter(f=>f.groupId!==groupId);
  const generated=[];
  let n=1;
  for(let i=0;i<teams.length;i++){
    for(let j=i+1;j<teams.length;j++){
      const a=teams[i],b=teams[j];
      const id=fixtureId(groupId,a.id,b.id);
      const old=tournament.fixtures.find(f=>f.id===id);
      generated.push(old||{
        id,groupId,stage:"group",number:n,teamAId:a.id,teamBId:b.id,
        status:"pending",result:null,createdAt:Date.now()+n
      });
      n++;
    }
  }
  tournament.fixtures=existing.concat(generated);
  ensureStageBuildState().groupFixtures[String(groupId)]={
    signature:buildSignature(getGroupFixtureBuildInputs(groupId)),
    generatedAt:Date.now()
  };
}
function renderFixtureGroupFilter(){
  const el=$("fixtureGroupFilter");
  if(!el)return;
  const current=el.value;
  el.innerHTML=tournament.groups.map(g=>`<option value="${g.id}">${escapeHtml(g.name)}</option>`).join("");
  if(current&&tournament.groups.some(g=>g.id===current))el.value=current;
  else if(tournament.groups[0])el.value=tournament.groups[0].id;
}
function renderFixtures(){
  renderFixtureGroupFilter();
  const el=$("fixturesList");
  if(!el)return;
  const gid=$("fixtureGroupFilter")?.value;
  const generateBtn=$("generateFixturesBtn");
  if(!gid){
    if(generateBtn)generateBtn.textContent="Generate Matches";
    el.innerHTML='<div class="empty directional-message" role="button" tabindex="0" onclick="openTournamentSettings()" onkeydown="handleDirectionalKey(event,openTournamentSettings)">Create groups first.</div>';
    return;
  }
  const fixtures=tournament.fixtures
    .filter(f=>String(f.groupId)===String(gid))
    .sort((a,b)=>a.number-b.number);

  const group=tournament.groups.find(g=>String(g.id)===String(gid));
  const stale=getStageStaleInfo("group-fixtures",{groupId:gid});
  if(generateBtn)generateBtn.textContent=stale.stale
    ? `Rebuild ${group?.name||"group"} fixtures`
    : "Generate Matches";
  const warningHtml=stale.stale
    ? `<div class="preliminary-regenerate-warning">
        <strong>⚠ ${escapeHtml(group?.name||"Group")} fixtures need rebuilding</strong>
        <div class="muted">${escapeHtml(stale.reason)}</div>
        <div class="muted" style="margin-top:3px">The Group Table will continue to reflect the current teams and recorded results until the fixtures are rebuilt.</div>
      </div>`
    : "";

  if(!fixtures.length){
    el.innerHTML=warningHtml+'<div class="empty">No fixtures generated for this group.</div>';
    return;
  }

  el.innerHTML=warningHtml+fixtures.map(f=>{
    const a=tournament.teams.find(t=>String(t.id)===String(f.teamAId));
    const b=tournament.teams.find(t=>String(t.id)===String(f.teamBId));
    const group=tournament.groups.find(g=>String(g.id)===String(f.groupId));
    const letter=group ? group.name.replace(/^Group\s+/i,"").charAt(0) : "F";
    const labelA=teamDisplayLabel(a);
    const labelB=teamDisplayLabel(b);
    const result=fixtureResult(f.id);
    const resultComplete=isFixtureResultComplete(f);
    const winner=resultComplete?result?.winnerTeamId:null;
    const aWin=winner&&String(winner)===String(f.teamAId);
    const bWin=winner&&String(winner)===String(f.teamBId);
    const selected=String($("resultFixtureFilter")?.value||"")===String(f.id);
    return `<div class="fixture-row group-fixture-selectable${selected?" selected-fixture":""}" data-fixture-id="${f.id}" role="button" tabindex="0" title="Select this fixture for scoring">
      <div class="fixture-number">${letter}${f.number}</div>
      <div class="fixture-teams">
        <strong class="participant-label ${aWin?'winner-team':''}">${labelA}</strong>
        <span class="match-vs">VS</span>
        <strong class="participant-label ${bWin?'winner-team':''}">${labelB}</strong>
      </div>
      <span class="badge">${resultComplete?(result?.walkover?'WO':'✓'):'—'}</span>
    </div>`;
  }).join("");

  el.querySelectorAll(".group-fixture-selectable").forEach(row=>{
    const selectFixture=()=>selectGroupFixture(row.dataset.fixtureId);
    row.addEventListener("click",selectFixture);
    row.addEventListener("keydown",e=>{
      if(e.key==="Enter"||e.key===" "){
        e.preventDefault();
        selectFixture();
      }
    });
  });
}
function selectGroupFixture(fixtureId){
  const fixture=tournament.fixtures.find(f=>String(f.id)===String(fixtureId));
  if(!fixture)return;
  const groupSelect=$("resultGroupFilter");
  const fixtureSelect=$("resultFixtureFilter");
  if(groupSelect)groupSelect.value=String(fixture.groupId);
  if(fixtureSelect)fixtureSelect.value=String(fixture.id);
  openFloatingScorecard("group",fixture.id,null,true);
}
