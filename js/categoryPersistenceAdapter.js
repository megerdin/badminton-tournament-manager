/*
 * Category-scoped persistence prototype.
 * Not wired into the production app by default. Keep behind explicit opt-in
 * until the SQL is applied to a staging Supabase project and integration tests pass.
 */
(function(root){
  'use strict';
  const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
  const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
  function makeError(message){return new Error(message);}

  async function checked(query){const result=await query;if(result?.error)throw result.error;return result?.data;}

  async function loadMaster(client,clubId,activeCategoryId){
    if(!client||!clubId)throw makeError('A Supabase client and club ID are required.');
    const [clubRows,categoryRows]=await Promise.all([
      checked(client.from('clubs').select('id,name,shared_data').eq('id',clubId).limit(1)),
      checked(client.from('categories').select('legacy_category_id,name,sort_order,data,revision').eq('club_id',clubId).order('sort_order',{ascending:true}).order('legacy_category_id',{ascending:true}))
    ]);
    const club=clubRows?.[0];
    if(!club)throw makeError('Club not found or access denied.');
    const categories=(categoryRows||[]).map(row=>({id:String(row.legacy_category_id),name:String(row.name||'Category'),data:clone(row.data||{})}));
    const desired=String(activeCategoryId||'');
    const active=categories.some(c=>c.id===desired)?desired:String(categories[0]?.id||'');
    const date=String(club.shared_data?.date||categories[0]?.data?.date||'');
    categories.forEach(c=>{c.data=c.data&&typeof c.data==='object'&&!Array.isArray(c.data)?c.data:{};c.data.clubName=String(club.name||'');if(date)c.data.date=date;c.data.settings=c.data.settings||{};c.data.settings.categories=[{id:c.id,name:c.name}];});
    return {master:{type:'badmintonTournamentManagerMaster',masterSchemaVersion:1,clubName:String(club.name||''),date,activeCategoryId:active,categories},
      revisions:Object.fromEntries((categoryRows||[]).map(row=>[String(row.legacy_category_id),Number(row.revision||1)])),sharedData:clone(club.shared_data||{})};
  }

  async function saveCategory(client,{clubId,category,sortOrder=0,expectedRevision=0,maxRetries=4}){
    if(!category||!String(category.id||'').trim()||!object(category.data))throw makeError('A category ID and object data are required.');
    const payload=clone(category.data);
    payload.settings=payload.settings||{};
    payload.settings.categories=[{id:String(category.id),name:String(category.name||'Category')}];
    let revision=Number(expectedRevision||0),attempt=0;
    while(attempt++<maxRetries){
      const response=await checked(client.rpc('save_category_data',{
        p_club_id:clubId,p_legacy_category_id:String(category.id),p_name:String(category.name||'Category'),p_sort_order:Number(sortOrder)||0,
        p_data:clone(payload),p_expected_revision:revision
      }));
      const row=Array.isArray(response)?response[0]:response;
      if(row?.status==='saved')return {status:'saved',revision:Number(row.revision),data:clone(row.data)};
      if(row?.status==='conflict'){
        // Current single-user policy: automatically retry the intended local
        // category payload against the latest category revision. No user prompt.
        revision=Number(row.revision||0);
        continue;
      }
      throw makeError('Unexpected response from save_category_data.');
    }
    throw makeError('Category changed repeatedly while saving; local queue must remain pending.');
  }

  async function saveClubMetadata(client,{clubId,clubName,sharedData={}}){
    if(!client||!clubId)throw makeError('A Supabase client and club ID are required.');
    if(!object(sharedData))throw makeError('Shared club metadata must be an object.');
    // Server-side RPC preserves the migration marker as-is. Ordinary metadata
    // saves must never mark an incomplete category migration as complete.
    const response=await checked(client.rpc('save_club_metadata',{
      p_club_id:clubId,p_club_name:String(clubName||'Your club name'),p_shared_data:clone(sharedData)
    }));
    const row=Array.isArray(response)?response[0]:response;
    if(row?.status!=='saved'||!row.club)throw makeError('Club metadata was not saved; access may be denied.');
    return {status:'saved',club:clone(row.club)};
  }

  async function replaceMaster(client,{clubId,master,sharedData={}}){
    if(!master||!Array.isArray(master.categories)||!master.categories.length)throw makeError('A master import must contain at least one category.');
    const seen=new Set();
    const categories=master.categories.map((category,index)=>{
      const id=String(category?.id||'').trim();
      if(!id||seen.has(id)||!object(category?.data))throw makeError('Import contains a missing/duplicate category ID or invalid category data.');
      seen.add(id);
      return {id,name:String(category.name||`Category ${index+1}`),sortOrder:index,data:clone(category.data)};
    });
    const shared={...(object(sharedData)?clone(sharedData):{}),date:String(master.date||''),categoryPersistenceVersion:1};
    const response=await checked(client.rpc('replace_club_master',{
      p_club_id:clubId,p_club_name:String(master.clubName||''),p_shared_data:shared,p_categories:categories
    }));
    const row=Array.isArray(response)?response[0]:response;
    if(row?.status!=='replaced'||Number(row.category_count)!==categories.length)throw makeError('The database did not confirm the complete master replacement.');
    return {status:'replaced',categoryCount:categories.length};
  }

  function diffMasterAgainstBaseline(local,baseline){
    if(!local||!baseline||!Array.isArray(local.categories)||!Array.isArray(baseline.categories))throw makeError('Local and baseline masters must both contain category arrays.');
    const stable=value=>{
      if(value===undefined)return 'undefined';if(value===null||typeof value!=='object')return JSON.stringify(value);
      if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
      return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
    };
    const comparable=category=>{const value=clone(category||{});if(object(value.data)){delete value.data.clubName;delete value.data.date;}return value;};
    const baseById=new Map(baseline.categories.map(c=>[String(c.id),c]));
    const changedCategories=[];
    local.categories.forEach((category,index)=>{const before=baseById.get(String(category.id));if(!before||stable(comparable(category))!==stable(comparable(before)))changedCategories.push({category:clone(category),sortOrder:index});});
    return {changedCategories,clubChanged:String(local.clubName||'')!==String(baseline.clubName||'')||String(local.date||'')!==String(baseline.date||'')};
  }

  async function migrateLegacyTournament(client,{clubId,replaceExisting=false,sharedData={}}){
    if(!client||!clubId)throw makeError('A Supabase client and club ID are required.');
    const legacyRows=await checked(client.from('tournaments').select('data,version').eq('club_id',clubId).limit(1));
    const legacy=legacyRows?.[0]?.data;
    if(!legacy||legacy.type!=='badmintonTournamentManagerMaster'||!Array.isArray(legacy.categories)||!legacy.categories.length)
      throw makeError('The legacy tournament row does not contain a valid master-category snapshot.');
    const currentRows=await checked(client.from('categories').select('legacy_category_id').eq('club_id',clubId));
    if((currentRows||[]).length&&!replaceExisting)return {status:'skipped-existing-categories',existingCount:currentRows.length,legacyVersion:legacyRows[0].version};
    const categorySummary=legacy.categories.map(c=>({id:String(c.id),name:String(c.name||'Category'),teams:Array.isArray(c.data?.teams)?c.data.teams.length:0,players:Array.isArray(c.data?.players)?c.data.players.length:0,groups:Array.isArray(c.data?.groups)?c.data.groups.length:0,fixtures:Array.isArray(c.data?.fixtures)?c.data.fixtures.length:0,results:Array.isArray(c.data?.results)?c.data.results.length:0}));
    const result=await replaceMaster(client,{clubId,master:legacy,sharedData:{...sharedData,date:String(legacy.date||'')}});
    return {...result,status:'migrated',legacyVersion:legacyRows[0].version,categories:categorySummary};
  }

  const api={loadMaster,saveCategory,saveClubMetadata,replaceMaster,migrateLegacyTournament,diffMasterAgainstBaseline};
  root.BADMINTON_CATEGORY_PERSISTENCE=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
