/* ================================================================ */
/* BADMINTON APP — UI / PRESENTATION                               */
/* Sections: Rendering, Events, Reports                             */
/* ================================================================ */

/* ====================== rendering.js ====================== */
// Phase 11: extracted rendering helpers.


function renderWorkspaceStatusIndicators(){
  const teams=Array.isArray(tournament?.teams)?tournament.teams:[];
  const fixtures=Array.isArray(tournament?.fixtures)?tournament.fixtures:[];
  const results=Array.isArray(tournament?.results)?tournament.results:[];
  const ranking=typeof calculateTournamentRanking==="function" ? calculateTournamentRanking() : [];
  const completedFixtures=fixtures.filter(f=>isFixtureResultComplete(f)).length;
  const preliminaryMatches=Array.isArray(tournament?.preliminaryRound?.matches)?tournament.preliminaryRound.matches:[];
  const preliminaryComplete=preliminaryMatches.length>0 && preliminaryMatches.every(isGeneratedMatchResultComplete);
  const preliminaryRequired=preliminaryMatches.length>0;
  const knockoutBuilt=!!tournament?.knockout?.rounds?.length || !!tournament?.stageBuildState?.mainKnockout;
  const states={
    playerTeamEntryCard:teams.length?{kind:"done",text:"✓"}:{kind:"pending",text:"1"},
    fixturesCard:(fixtures.length && completedFixtures===fixtures.length)?{kind:"done",text:"✓"}:fixtures.length?{kind:"active",text:"2"}:{kind:"pending",text:"2"},
    qualificationCard:ranking.length?{kind:"done",text:"✓"}:{kind:"pending",text:"3"},
    tournamentRanking:ranking.length?{kind:"done",text:"✓"}:{kind:"pending",text:"4"},
    preliminaryRound:preliminaryComplete||!preliminaryRequired?{kind:"done",text:"✓"}:preliminaryMatches.length?{kind:"active",text:String(preliminaryMatches.filter(m=>!isGeneratedMatchResultComplete(m)).length||preliminaryMatches.length)}:{kind:"pending",text:"5"},
    knockoutCard:knockoutBuilt?{kind:"done",text:"✓"}:{kind:"pending",text:"6"},
    podiumSection:(()=>{
      const draw=getActiveMainKnockoutDraw();
      const final=draw?.rounds?.[draw.rounds.length-1]?.matches?.[0];
      return final&&isGeneratedMatchResultComplete(final)?{kind:"done",text:"✓"}:{kind:"pending",text:"7"};
    })()
  };
  Object.entries(states).forEach(([target,state])=>{
    const host=target==="tournamentRanking" ? document.getElementById("tournamentRanking") : target==="preliminaryRound" ? document.getElementById("preliminaryRound") : document.getElementById(target);
    const details=host?.tagName?.toLowerCase()==="details" ? host : host?.querySelector("details.card");
    const summary=details?.querySelector(":scope > summary");
    const strong=summary?.querySelector(":scope > strong");
    if(!summary||!strong)return;
    let badge=summary.querySelector(":scope > .workspace-summary-status");
    if(!badge){badge=document.createElement("span");badge.className="workspace-summary-status";summary.insertBefore(badge,strong);}
    badge.className="workspace-summary-status "+state.kind;
    badge.textContent=state.text;
  });
}

function renderLandingDashboard(){
  const teams=Array.isArray(tournament?.teams)?tournament.teams:[];
  const groups=Array.isArray(tournament?.groups)?tournament.groups:[];
  const fixtures=Array.isArray(tournament?.fixtures)?tournament.fixtures:[];
  const results=Array.isArray(tournament?.results)?tournament.results:[];
  const completedGroupFixtures=fixtures.filter(f=>isFixtureResultComplete(f)).length;

  // Predict the complete tournament match count from the current structure,
  // even before fixtures or knockout stages have been built. Group matches are
  // determined directly from the number of teams assigned to each group.
  const projectedGroupFixtures=groups.reduce((sum,group)=>{
    const n=teams.filter(t=>String(t.groupId)===String(group.id)).length;
    return sum+(n*(n-1)/2);
  },0);
  const totalFixtures=Math.max(fixtures.length,projectedGroupFixtures);
  const ranking=typeof calculateTournamentRanking==="function" ? calculateTournamentRanking() : [];
  const knockoutBuilt=!!tournament?.mainKnockoutDraw?.rounds?.length || !!tournament?.stageBuildState?.mainKnockout;
  const preliminaryBuilt=!!tournament?.preliminaryRound?.matches?.length || !!tournament?.stageBuildState?.preliminary;
  const setText=(id,value)=>{const el=document.getElementById(id);if(el)el.textContent=value;};

  // Full tournament match accounting:
  // Group fixtures + Pre-Knockout + Main Knockout + 3rd-place playoff.
  // For a power-of-two Main Knockout of size M, the Main Knockout has M-1
  // matches. Pre-Knockout has qualifiedCount-M matches. The 3rd-place playoff
  // adds one match when the Main Knockout has at least 4 teams.
  // Qualification is intentionally gated until a group is complete, so
  // getQualifiedTeamIds() is not suitable for predicting the tournament size.
  // For the dashboard we can project the maximum automatic qualifiers from
  // the current team/group structure immediately. This mirrors the actual
  // qualification rule: no group can contribute more qualifiers than it has
  // teams. Manual knockout entries are added because they are explicit
  // tournament entries even before group results exist.
  const projectedQualifiedIds=new Set();
  groups.forEach(group=>{
    const groupTeamIds=teams
      .filter(t=>String(t.groupId)===String(group.id))
      .map(t=>String(t.id));
    const count=Math.min(qualificationCountForGroup(group),groupTeamIds.length);
    groupTeamIds.slice(0,count).forEach(id=>projectedQualifiedIds.add(id));
  });
  (tournament.manualKnockoutTeams||[]).forEach(id=>{
    if(teams.some(t=>String(t.id)===String(id)))projectedQualifiedIds.add(String(id));
  });
  const qualifiedCount=projectedQualifiedIds.size;
  let expectedPreliminaryMatches=0;
  let expectedMainKnockoutMatches=0;
  let expectedThirdPlaceMatches=0;
  if(qualifiedCount>=2){
    const structure=typeof calculateKnockoutStructure==="function"
      ? calculateKnockoutStructure(qualifiedCount) : null;
    const mainSize=Number(structure?.mainKnockoutSize)||0;
    expectedPreliminaryMatches=Number(structure?.preliminaryMatches)||0;
    expectedMainKnockoutMatches=Math.max(0,mainSize-1);
    expectedThirdPlaceMatches=mainSize>=4 ? 1 : 0;
  }

  const preliminaryMatches=Array.isArray(tournament?.preliminaryRound?.matches)
    ? tournament.preliminaryRound.matches : [];
  const completedPreliminaryMatches=preliminaryMatches.filter(isGeneratedMatchResultComplete).length;

  const mainRounds=Array.isArray(tournament?.mainKnockoutDraw?.rounds)
    ? tournament.mainKnockoutDraw.rounds : [];
  const mainMatches=mainRounds.flatMap(round=>Array.isArray(round?.matches)?round.matches:[]);
  const completedMainMatches=mainMatches.filter(isGeneratedMatchResultComplete).length;

  const thirdPlace=tournament?.thirdPlacePlayoff||null;
  const completedThirdPlaceMatches=isThirdPlaceResultComplete(thirdPlace) ? 1 : 0;

  const completedTournamentMatches=
    completedGroupFixtures + completedPreliminaryMatches +
    completedMainMatches + completedThirdPlaceMatches;

  const totalTournamentMatches=
    totalFixtures + expectedPreliminaryMatches +
    expectedMainKnockoutMatches + expectedThirdPlaceMatches;

  const tournamentProgress=totalTournamentMatches>0
    ? Math.min(100,Math.round(100*completedTournamentMatches/totalTournamentMatches))
    : 0;

  const knockoutCompletedMatches=completedPreliminaryMatches + completedMainMatches + completedThirdPlaceMatches;
  const knockoutTotalMatches=expectedPreliminaryMatches + expectedMainKnockoutMatches + expectedThirdPlaceMatches;

  setText("dashboardTeamCount",teams.length);
  setText("dashboardGroupCount",groups.length);
  setText("dashboardFixtureProgress",completedTournamentMatches+"/"+totalTournamentMatches);
  setText("dashboardEntryHint","");
  setText("dashboardGroupMeta",groups.length ? (projectedGroupFixtures ? completedGroupFixtures+"/"+projectedGroupFixtures+" matches" : "0/0 matches") : "0/0 matches");
  setText("dashboardRankingMeta","");
  setText("dashboardKnockoutMeta",knockoutTotalMatches ? knockoutCompletedMatches+"/"+knockoutTotalMatches+" matches" : "0/0 matches");

  const bar=document.getElementById("dashboardProgressBar");
  if(bar)bar.style.width=tournamentProgress+"%";
  setText("dashboardProgressText",tournamentProgress);
  const progressCategory=ui$("dashboardProgressCategory");
  if(progressCategory){
    const category=getActiveCategoryRecord()||normalizeCategories()[0]||{name:"Internal"};
    const categoryName=String(category.name||"Internal").trim()||"Internal";
    progressCategory.textContent=`[  ${categoryName}  ]`;
    progressCategory.style.color=getCategoryReflectiveColor(categoryName);
  }
}

function renderHeaderClubName(){
  const el=document.getElementById("headerTournamentName");
  if(!el)return;
  const name=masterTournament?.clubName||tournament?.clubName||"Your club name";
  el.textContent=name;
  const active=getActiveCategoryRecord();
  const categoryName=String(active?.name||normalizeCategories()[0]?.name||"Internal").trim()||"Internal";
  el.setAttribute("aria-label",`Switch category. Current category: ${categoryName}`);
  const versionEl=document.getElementById("appVersion");
  if(versionEl)versionEl.textContent=`V${escapeHtml(APP_VERSION)}`;
}

function bindCategorySwitcher(){
  const el=document.querySelector(".app-header");
  if(!el||el.dataset.categorySwitcherBound==="1")return;
  el.dataset.categorySwitcherBound="1";
  el.addEventListener("keydown",e=>{
    if(e.key!=="Enter"&&e.key!==" ")return;
    e.preventDefault();
    cycleCategory();
  });
}


// Phase 12: extracted summary and podium rendering.

function renderPodium(){
  const el=ui$("podiumCard");
  if(!el)return;
  const draw=getActiveMainKnockoutDraw();
  const final=draw?.rounds?.[draw.rounds.length-1]?.matches?.[0];
  if(!final||!isGeneratedMatchResultComplete(final)){
    el.innerHTML="";
    return;
  }
  const third=tournament.thirdPlacePlayoff;
  const clubName=tournament?.clubName?.trim()||"Tournament";
  const category=getActiveCategoryRecord()||normalizeCategories()[0]||{name:"Internal"};
  const categoryName=String(category.name||"Internal").trim()||"Internal";
  const categoryColor=getCategoryReflectiveColor(categoryName);
  el.innerHTML=`<div class="result-box">
    <div class="podium-content">
    <div class="podium-club-category">${escapeHtml(clubName)} <span class="category-reflective" style="color:${categoryColor}">[  ${escapeHtml(categoryName)}  ]</span></div>
    <div class="podium-title">Champions</div>
    <div class="podium-list">
      <div class="podium-item"><span class="podium-medal">🥇</span><strong>${knockoutDisplayLabel(final.winnerTeamId)}</strong></div>
      <div class="podium-item"><span class="podium-medal">🥈</span><span>${knockoutDisplayLabel(final.loserTeamId)}</span></div>
      ${isThirdPlaceResultComplete(third)?`<div class="podium-item"><span class="podium-medal">🥉</span><span>${knockoutDisplayLabel(third.winnerTeamId)}</span></div>`:""}
    </div>
    </div>
  </div>`;
}

function renderSummary(){
  const el=ui$("summary");
  if(!el)return;

  // Tournament Status is the single intentional cross-category view.
  // Every other dashboard/workspace indicator is rendered from the active
  // category subset only. Keep Team Pool entries separate from actual
  // tournament teams so setup input is not mistaken for active teams.
  const categories=getMasterCategories();
  const rows=categories.map(category=>{
    const d=category?.data||{};
    const settings=d.settings&&typeof d.settings==="object"?d.settings:{};
    const players=Array.isArray(d.players)?d.players.length:0;
    const teams=Array.isArray(d.teams)?d.teams.length:0;
    const teamPool=Array.isArray(settings.teamPoolEntries)?settings.teamPoolEntries.length:0;
    const groups=Array.isArray(d.groups)?d.groups.length:0;
    const fixtures=Array.isArray(d.fixtures)?d.fixtures.length:0;
    const results=Array.isArray(d.results)?d.results.length:0;
    return {
      id:String(category?.id||""),
      name:String(category?.name||"Internal").trim()||"Internal",
      players,teams,teamPool,groups,fixtures,results
    };
  });

  const totals=rows.reduce((a,row)=>{
    a.players+=row.players;a.teams+=row.teams;a.teamPool+=row.teamPool;
    a.groups+=row.groups;a.fixtures+=row.fixtures;a.results+=row.results;
    return a;
  },{players:0,teams:0,teamPool:0,groups:0,fixtures:0,results:0});

  const activeId=String(masterTournament?.activeCategoryId||"");
  const rowHtml=rows.map(row=>`
    <div class="result-box" style="margin-top:8px">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap">
        <strong>${escapeHtml(row.name)}</strong>
        ${row.id===activeId?'<span class="muted">Active</span>':''}
      </div>
      <div class="small-grid" style="margin-top:8px">
        <div><strong>${row.players}</strong><div class="muted">Players</div></div>
        <div><strong>${row.teams}</strong><div class="muted">Teams</div></div>
        <div><strong>${row.teamPool}</strong><div class="muted">Team Pool</div></div>
        <div><strong>${row.groups}</strong><div class="muted">Groups</div></div>
        <div><strong>${row.fixtures}</strong><div class="muted">Fixtures</div></div>
        <div><strong>${row.results}</strong><div class="muted">Results</div></div>
      </div>
    </div>`).join("");

  el.innerHTML=`
    <div><strong>All Categories</strong></div>
    ${rowHtml||'<div class="muted" style="margin-top:8px">No categories.</div>'}
    <div class="result-box" style="margin-top:10px">
      <strong>Club Total</strong>
      <div class="small-grid" style="margin-top:8px">
        <div><strong>${totals.players}</strong><div class="muted">Players</div></div>
        <div><strong>${totals.teams}</strong><div class="muted">Teams</div></div>
        <div><strong>${totals.teamPool}</strong><div class="muted">Team Pool</div></div>
        <div><strong>${totals.groups}</strong><div class="muted">Groups</div></div>
        <div><strong>${totals.fixtures}</strong><div class="muted">Fixtures</div></div>
        <div><strong>${totals.results}</strong><div class="muted">Results</div></div>
      </div>
    </div>
    <hr>
    <div class="muted">This section is the cross-category summary. The landing dashboard and tournament workspace show only the active category.</div>`;
}


/* ====================== events.js ====================== */
"use strict";

const ui$ = id => document.getElementById(id);

// Global event bindings are installed once when the application script loads.
// Player Pool remains fully implemented and persisted; Singles only deactivates
// its entry UI.
ui$("createPlayerPoolsBtn")?.addEventListener("click",()=>{
  const input=ui$("playerPoolCountSetting");
  const feedback=ui$("playerPoolCreateFeedback");
  const count=Math.max(2,Math.min(52,Number(input?.value)||2));
  const changed=resizePlayerPoolCount(count);
  if(input)input.value=String(window.BADMINTON_APP_STATE.getTournament().settings.playerPoolCount||count);
  if(changed){
    saveLocal(true);
    refreshControlled("settings-change");
    renderPlayerPools();
    renderPlayerPoolBuildArea();
  }
  if(feedback){
    feedback.textContent=changed
      ? `${count} player pool${count===1?"":"s"} configured. Existing pool data preserved.`
      : `${count} player pool${count===1?"":"s"} unchanged.`;
    feedback.style.display="block";
  }
});
ui$("playerPools")?.addEventListener("keydown",e=>{
  if(e.key!=="Enter"||e.target.id!=="playerPoolPlayerName")return;
  e.preventDefault();
  e.stopImmediatePropagation();
  addPoolPlayerFromEntry();
});
ui$("playerPools")?.addEventListener("blur",e=>{
  if(e.target.id!=="playerPoolPlayerName"||!e.target.value.trim())return;
  addPoolPlayerFromEntry();
},true);

ui$("teamPoolAddBtn")?.addEventListener("click",addTeamPoolEntry);
ui$("teamPoolLotteryBtn")?.addEventListener("click",runTeamPoolLottery);
ui$("createGroupsBtn").addEventListener("click",createGroups);
ui$("createCategoriesBtn").addEventListener("click",createCategories);
ui$("addTeamBtn").addEventListener("click",addTeam);
ui$("generateFixturesBtn").addEventListener("click",()=>{
  const gid=ui$("fixtureGroupFilter")?.value;
  if(gid)generateGroupFixtures(gid);
});
ui$("printFixturesBtn")?.addEventListener("click",exportGroupFixturesPdf);
ui$("fixtureGroupFilter").addEventListener("change",renderFixtures);
ui$("resultGroupFilter").addEventListener("change",renderResultEditor);

ui$("qualificationGroupFilter").addEventListener("change",renderQualification);
ui$("buildKnockoutBtn").addEventListener("click",()=>{
  buildMainKnockout();
});
ui$("tournamentMode")?.addEventListener("change",()=>{
  const previousMode=window.BADMINTON_APP_STATE.getTournament().settings.mode;
  syncSettings();
  if(previousMode!==window.BADMINTON_APP_STATE.getTournament().settings.mode){
    // Preserve every existing Team Pool entry and every manually-created team.
    // Only the generated Team Pool distribution is derived from the mode and
    // therefore needs invalidation before it can be rebuilt.
    invalidateTeamPoolLottery();
    window.BADMINTON_APP_STATE.getTournament().settings.teamPoolEntries.forEach(entry=>{
      entry.playerNames=Array.isArray(entry.playerNames)?entry.playerNames.slice():[];
      entry.player1=entry.playerNames[0]||"";
      entry.player2=entry.playerNames[1]||"";
    });
    addHistory("Tournament mode changed",`${previousMode||"doubles"} → ${window.BADMINTON_APP_STATE.getTournament().settings.mode}`);
  }
  saveLocal(true);
  renderAll();
});
ui$("playerEntryFields").addEventListener("keydown",e=>{
  if(e.key!=="Enter")return;
  const target=e.target;
  if(!target.classList.contains("player-entry"))return;
  e.preventDefault();
  e.stopImmediatePropagation();

  const inputs=[...ui$("playerEntryFields").querySelectorAll(".player-entry")];
  const index=inputs.indexOf(target);

  // Enter advances through the player fields. Enter on the final
  // player field adds/saves the team, then addTeam() returns focus
  // to the first player-entry field.
  if(index>=0 && index<inputs.length-1){
    inputs[index+1].focus();
    if(typeof inputs[index+1].select==="function")inputs[index+1].select();
    return;
  }

  addTeam();
});
// Team Pool uses delegated Enter handling because its player fields are
// recreated by renderTeamPoolEntryFields(). Enter advances through the
// players; Enter on the final player submits the team and addTeamPoolEntry()
// returns focus to the first player field. beforeinput covers mobile IMEs
// that do not expose Enter through keydown, while blur is the final safety net
// for keyboards that dismiss focus without delivering an Enter event.
let teamPoolEnterGuard=null;
function handleTeamPoolEnter(target){
  if(!target?.classList.contains("team-pool-player-input"))return false;
  const now=Date.now();
  if(teamPoolEnterGuard && teamPoolEnterGuard.target===target && now-teamPoolEnterGuard.at<250)return true;
  teamPoolEnterGuard={target,at:now};
  setTimeout(()=>{if(teamPoolEnterGuard?.target===target)teamPoolEnterGuard=null;},300);
  const inputs=[...ui$("teamPoolPlayerFields").querySelectorAll(".team-pool-player-input")];
  const index=inputs.indexOf(target);
  if(index>=0&&index<inputs.length-1){inputs[index+1].focus();inputs[index+1].select?.();return true;}
  addTeamPoolEntry();
  return true;
}
ui$("teamPoolPanel").addEventListener("beforeinput",e=>{
  if(e.inputType!=="insertLineBreak")return;
  if(!e.target.classList.contains("team-pool-player-input"))return;
  e.preventDefault();
  e.stopImmediatePropagation();
  handleTeamPoolEnter(e.target);
});
ui$("teamPoolPanel").addEventListener("keydown",e=>{
  if(e.key!=="Enter" && e.keyCode!==13)return;
  const target=e.target;
  if(!target.classList.contains("team-pool-player-input"))return;
  e.preventDefault();
  e.stopImmediatePropagation();
  handleTeamPoolEnter(target);
});
ui$("teamPoolPanel").addEventListener("blur",e=>{
  if(!e.target.classList.contains("team-pool-player-input"))return;
  if(!e.target.value.trim())return;
  setTimeout(()=>{
    const active=document.activeElement;
    if(active && ui$("teamPoolPanel").contains(active))return;
    // If an Enter/beforeinput path already handled this input, do not submit it again.
    if(teamPoolEnterGuard?.target===e.target && Date.now()-teamPoolEnterGuard.at<500)return;
    addTeamPoolEntry();
  },0);
},true);
ui$("saveBtn").addEventListener("click",()=>saveLocal());
ui$("newBtn").addEventListener("click",newTournament);
ui$("exportBtn").addEventListener("click",exportJson);
ui$("importBtn").addEventListener("click",openImportFile);
ui$("importFile").addEventListener("change",e=>importTournamentFile(e.target.files?.[0]));

ui$("defaultQualifiers").addEventListener("change",()=>{
  window.BADMINTON_APP_STATE.getTournament().settings.defaultQualifiers=Math.max(0,Number(ui$("defaultQualifiers").value)||0);
  saveLocal(true);
});

["clubName","tournamentDate","bestOf","pointsTarget"].forEach(key=>{
  ui$(key).addEventListener("change",()=>{syncSettings();saveLocal(true);});
});


/* ====================== reports.js ====================== */
function fixturePdfTeamLabel(team){
  if(!team)return "";
  const names=(team.playerIds||[])
    .map(pid=>tournament.players.find(p=>String(p.id)===String(pid))?.name||"")
    .filter(Boolean);
  return names.join(", ") || String(team.name||"");
}

function sanitizePdfFilenamePart(value,fallback){
  const cleaned=String(value??fallback??"")
    .replace(/[\\/:*?"<>|\x00-\x1F]/g,"-")
    .replace(/\s+/g," ")
    .trim()
    .replace(/[. ]+$/g,"");
  return cleaned||String(fallback||"Export");
}

function buildGroupFixturePdfData(){
  const groups=Array.isArray(tournament?.groups)?tournament.groups:[];
  const teamsAll=Array.isArray(tournament?.teams)?tournament.teams:[];
  const clubName=String(tournament?.clubName||"Tournament").trim()||"Tournament";
  const category=getActiveCategoryRecord()||normalizeCategories()[0]||{name:"Internal"};
  const categoryName=String(category.name||"Internal").trim()||"Internal";
  const pages=[];
  let totalFixtureCount=0;

  groups.forEach(group=>{
    const teams=teamsAll
      .filter(t=>String(t.groupId)===String(group.id))
      .sort((a,b)=>Number(a.number||0)-Number(b.number||0));
    const matchCount=teams.length*(teams.length-1)/2;
    totalFixtureCount+=matchCount;
    pages.push({
      groupName:String(group.name||"Group"),
      teams,
      matchCount,
      clubName,
      categoryName
    });
  });
  return {pages,fixtures:totalFixtureCount};
}

function pdfWrapText(ctx,text,maxWidth){
  const value=String(text??"");
  if(!value)return [""];
  const words=value.split(/\s+/);
  const lines=[];
  let line="";
  const pushBrokenWord=word=>{
    let part="";
    for(const ch of word){
      const test=part+ch;
      if(part && ctx.measureText(test).width>maxWidth){lines.push(part);part=ch;}
      else part=test;
    }
    return part;
  };
  words.forEach(word=>{
    const test=line?`${line} ${word}`:word;
    if(ctx.measureText(test).width<=maxWidth){line=test;return;}
    if(line)lines.push(line);
    line="";
    const broken=pushBrokenWord(word);
    line=broken;
  });
  if(line)lines.push(line);
  return lines.length?lines:[""];
}

function pdfDrawCenteredText(ctx,text,x,y,maxWidth,font,weight="400",lineHeight=1.15){
  ctx.font=`${weight} ${font}px Arial,Helvetica,sans-serif`;
  const lines=pdfWrapText(ctx,text,maxWidth);
  const h=font*lineHeight;
  const start=y-((lines.length-1)*h)/2;
  lines.forEach((line,i)=>ctx.fillText(line,x,start+i*h));
  return lines.length*h;
}

function pdfDrawLeftText(ctx,text,x,y,maxWidth,font,weight="400",lineHeight=1.15){
  ctx.font=`${weight} ${font}px Arial,Helvetica,sans-serif`;
  const previousTextAlign=ctx.textAlign;
  ctx.textAlign="left";
  const lines=pdfWrapText(ctx,text,maxWidth);
  const h=font*lineHeight;
  const start=y-((lines.length-1)*h)/2;
  lines.forEach((line,i)=>ctx.fillText(line,x,start+i*h));
  ctx.textAlign=previousTextAlign;
  return lines.length*h;
}

function drawGroupFixturePdfPage(pageData,canvas,scale){
  const ctx=canvas.getContext("2d");
  const mm=scale/25.4;
  const pageW=297*mm;
  const pageH=210*mm;
  const margin=10*mm;
  const contentW=pageW-(margin*2);
  const contentH=pageH-(margin*2);
  const teams=pageData.teams;
  const n=teams.length;

  ctx.fillStyle="#fff";
  ctx.fillRect(0,0,pageW,pageH);
  ctx.fillStyle="#111";
  ctx.textAlign="center";
  ctx.textBaseline="middle";

  let y=margin+12*mm;
  ctx.font=`700 ${16*scale/72}px Arial,Helvetica,sans-serif`;
  pdfDrawCenteredText(ctx,pageData.clubName,pageW/2,y,contentW,16*scale/72,"700");
  y+=7*mm;
  ctx.font=`700 ${11*scale/72}px Arial,Helvetica,sans-serif`;
  pdfDrawCenteredText(ctx,`[  ${pageData.categoryName}  ]`,pageW/2,y,contentW,11*scale/72,"700");
  y+=10*mm;
  ctx.font=`700 ${18*scale/72}px Arial,Helvetica,sans-serif`;
  pdfDrawCenteredText(ctx,`${pageData.groupName} — Group Fixtures`,pageW/2,y,contentW,18*scale/72,"700");
  y+=7*mm;
  ctx.font=`400 ${9*scale/72}px Arial,Helvetica,sans-serif`;
  ctx.fillStyle="#444";
  ctx.fillText(`${n} teams · ${pageData.matchCount} matches · Round robin`,pageW/2,y);

  const tableTop=y+7*mm;
  const footerSpace=9*mm;
  const tableAvailable=contentH-(tableTop-margin)-footerSpace;
  const rowH=Math.max(8*mm,Math.min(13*mm,tableAvailable/Math.max(2,n+1)));
  const axisW=Math.max(30*mm,Math.min(42*mm,contentW*0.14));
  const cellW=(contentW-axisW)/Math.max(1,n);
  const fontPx=Math.max(10,Math.min(18,cellW*0.16));
  const smallPx=Math.max(8,Math.min(13,fontPx*0.72));
  const left=margin;

  ctx.textAlign="center";
  ctx.textBaseline="middle";
  ctx.lineWidth=Math.max(1,scale/180);
  ctx.strokeStyle="#555";
  ctx.fillStyle="#f1f1f1";
  ctx.fillRect(left,tableTop,axisW,rowH);
  ctx.strokeRect(left,tableTop,axisW,rowH);
  ctx.fillStyle="#111";
  pdfDrawLeftText(ctx,"Team",left+5,tableTop+rowH/2,axisW-10,fontPx,"700");

  teams.forEach((team,i)=>{
    const x=left+axisW+i*cellW;
    ctx.fillStyle="#f1f1f1";
    ctx.fillRect(x,tableTop,cellW,rowH);
    ctx.strokeStyle="#555";
    ctx.strokeRect(x,tableTop,cellW,rowH);
    ctx.fillStyle="#111";
    pdfDrawCenteredText(ctx,fixturePdfTeamLabel(team),x+cellW/2,tableTop+rowH/2,cellW-10,fontPx,"700");
  });

  teams.forEach((rowTeam,rowIndex)=>{
    const y0=tableTop+(rowIndex+1)*rowH;
    ctx.fillStyle="#fff";
    ctx.strokeStyle="#555";
    ctx.fillRect(left,y0,axisW,rowH);
    ctx.strokeRect(left,y0,axisW,rowH);
    ctx.fillStyle="#111";
    pdfDrawLeftText(ctx,fixturePdfTeamLabel(rowTeam),left+5,y0+rowH/2,axisW-10,fontPx,"600");

    teams.forEach((colTeam,colIndex)=>{
      const x=left+axisW+colIndex*cellW;
      const isSelf=rowIndex===colIndex;
      ctx.fillStyle=isSelf?"#e9e9e9":"#fff";
      ctx.fillRect(x,y0,cellW,rowH);
      ctx.strokeStyle="#555";
      ctx.strokeRect(x,y0,cellW,rowH);
      if(isSelf){
        ctx.fillStyle="#777";
        ctx.font=`400 ${fontPx}px Arial,Helvetica,sans-serif`;
        ctx.fillText("—",x+cellW/2,y0+rowH/2);
        return;
      }
      // Fixture cells are intentionally blank. The PDF is a clean
      // cross-table template; fixture numbers and scores belong in the
      // tournament workspace, not on the printed fixture sheet.
    });
  });

  ctx.fillStyle="#555";
  ctx.font=`400 ${8*scale/72}px Arial,Helvetica,sans-serif`;
  ctx.textAlign="center";
  ctx.fillText("Blank cells are provided for fixture entries.",pageW/2,pageH-margin/2);
  return canvas;
}

function canvasToJpegBytes(canvas,quality=0.92){
  const dataUrl=canvas.toDataURL("image/jpeg",quality);
  const base64=dataUrl.split(",")[1]||"";
  const binary=atob(base64);
  const bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return bytes;
}

function buildImagePdf(jpegPages,width,height){
  const chunks=[];
  let length=0;
  const addText=text=>{
    const bytes=new TextEncoder().encode(text);
    chunks.push(bytes);length+=bytes.length;
  };
  const addBytes=bytes=>{chunks.push(bytes);length+=bytes.length;};
  const objects=[];
  const addObject=()=>objects.push(objects.length+1);

  const catalogObj=addObject();
  const pagesObj=addObject();
  const imageObjs=[];
  const contentObjs=[];
  const pageObjs=[];
  jpegPages.forEach(()=>{
    imageObjs.push(addObject());
    contentObjs.push(addObject());
    pageObjs.push(addObject());
  });
  const infoObj=addObject();

  const bodyMap=new Map();
  bodyMap.set(catalogObj,`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);
  bodyMap.set(pagesObj,`<< /Type /Pages /Kids [${pageObjs.map(n=>`${n} 0 R`).join(" ")}] /Count ${pageObjs.length} >>`);
  pageObjs.forEach((pageObj,i)=>{
    const pageWidthPt=841.8898;
    const pageHeightPt=595.2756;
    const content=`q\n${pageWidthPt} 0 0 ${pageHeightPt} 0 0 cm\n/Im${i+1} Do\nQ\n`;
    bodyMap.set(contentObjs[i],`<< /Length ${content.length} >>\nstream\n${content}endstream`);
    bodyMap.set(pageObj,`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 841.8898 595.2756] /Resources << /XObject << /Im${i+1} ${imageObjs[i]} 0 R >> >> /Contents ${contentObjs[i]} 0 R >>`);
  });
  bodyMap.set(infoObj,`<< /Producer (Badminton Tournament Manager) /Title (Group Fixtures) >>`);

  addText("%PDF-1.3\n% Badminton Tournament Manager\n");
  const xrefOffsets=[];
  for(const objNum of objects){
    xrefOffsets[objNum]=length;
    addText(`${objNum} 0 obj\n`);
    const imageIndex=imageObjs.indexOf(objNum);
    if(imageIndex>=0){
      const jpeg=jpegPages[imageIndex];
      addText(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
      addBytes(jpeg);
      addText("\nendstream");
    }else{
      addText(bodyMap.get(objNum)||"<< >>");
    }
    addText("\nendobj\n");
  }
  const xrefStart=length;
  addText(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`);
  for(let i=1;i<=objects.length;i++)addText(`${String(xrefOffsets[i]).padStart(10,"0")} 00000 n \n`);
  addText(`trailer\n<< /Size ${objects.length+1} /Root ${catalogObj} 0 R /Info ${infoObj} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);
  const out=new Uint8Array(length);let pos=0;
  for(const chunk of chunks){out.set(chunk,pos);pos+=chunk.length;}
  return out;
}

async function exportGroupFixturesPdf(){
  const data=buildGroupFixturePdfData();
  if(!data.pages.length){
    openTournamentSettings("groupCount");
    return;
  }
  if(typeof document.createElement!=="function" || !document.createElement("canvas").getContext){
    alert("PDF export is not supported by this browser.");
    return;
  }

  const button=ui$("printFixturesBtn");
  const previousText=button?.textContent||"Download A4 Fixtures PDF";
  if(button){button.disabled=true;button.textContent="Generating PDF…";}
  try{
    const dpi=160;
    const width=Math.round(297/25.4*dpi);
    const height=Math.round(210/25.4*dpi);
    const jpegPages=[];
    for(const pageData of data.pages){
      const canvas=document.createElement("canvas");
      canvas.width=width;canvas.height=height;
      drawGroupFixturePdfPage(pageData,canvas,dpi);
      jpegPages.push(canvasToJpegBytes(canvas,0.92));
    }
    const pdfBytes=buildImagePdf(jpegPages,width,height);
    const blob=new Blob([pdfBytes],{type:"application/pdf"});
    const category=sanitizePdfFilenamePart(data.pages[0].categoryName,"Internal");
    const club=sanitizePdfFilenamePart(data.pages[0].clubName,"Tournament");
    const filename=`${category}-${club}.pdf`;
    const url=URL.createObjectURL(blob);
    const link=document.createElement("a");
    link.href=url;link.download=filename;link.style.display="none";
    document.body.appendChild(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),2000);
    const status=ui$("printFixturesStatus");
    if(status)status.textContent=`Downloaded ${filename} · ${data.pages.length} A4 landscape page${data.pages.length===1?"":"s"} · ${data.fixtures} group matches.`;
  }catch(error){
    console.error("Fixture PDF export failed",error);
    alert("The fixture PDF could not be generated. Please try again.");
  }finally{
    if(button){button.disabled=false;button.textContent=previousText;}
  }
}

function renderPrintFixturesStatus(){
  const el=ui$("printFixturesStatus");
  if(!el)return;
  const groups=Array.isArray(tournament?.groups)?tournament.groups:[];
  if(!groups.length){
    el.textContent="Declare groups first.";
    return;
  }
  const teams=Array.isArray(tournament?.teams)?tournament.teams:[];
  const groupsWithTeams=groups.filter(g=>teams.some(t=>String(t.groupId)===String(g.id))).length;
  const matchCount=groups.reduce((sum,g)=>{
    const n=teams.filter(t=>String(t.groupId)===String(g.id)).length;
    return sum+(n*(n-1)/2);
  },0);
  el.textContent=groupsWithTeams===groups.length
    ? `${groups.length} group${groups.length===1?"":"s"} ready · ${matchCount} fixture cells · A4 landscape PDF.`
    : `${groupsWithTeams} of ${groups.length} groups have teams assigned. Assign teams to the remaining groups before exporting.`;
}










