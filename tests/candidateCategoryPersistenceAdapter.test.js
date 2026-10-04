const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const adapter=require('../candidate-app/js/categoryPersistenceAdapter.js');

function queryFor(rows,filters=[],orders=[],updates=null){
  const q={select(){return q;},eq(k,v){filters.push([k,v]);return q;},order(k,o){orders.push([k,o]);return q;},limit(n){q._limit=n;return q;},update(values){updates=values;return q;},then(resolve,reject){try{let out=rows.filter(row=>filters.every(([k,v])=>row[k]===v));if(updates){out.forEach(row=>Object.assign(row,structuredClone(updates)));}for(const [k,o] of orders.slice().reverse())out.sort((a,b)=>{const av=a[k],bv=b[k];const cmp=av===bv?0:av<bv?-1:1;return o?.ascending===false?-cmp:cmp;});if(q._limit!=null)out=out.slice(0,q._limit);resolve({data:structuredClone(out),error:null});}catch(e){reject(e);}}};return q;
}
class MockSupabase{
 constructor(){this.clubs=[{id:'club-1',name:'Example Club',shared_data:{date:'2026-10-04'}}];this.categories=[];this.tournaments=[];this.conflictNext=false;this.rpcCalls=[];}
 from(table){return queryFor(table==='clubs'?this.clubs:table==='tournaments'?this.tournaments:this.categories);}
 async rpc(name,args){this.rpcCalls.push({name,args:structuredClone(args)});
  if(name==='save_category_data'){
   let row=this.categories.find(x=>x.club_id===args.p_club_id&&x.legacy_category_id===args.p_legacy_category_id);
   if(this.conflictNext){this.conflictNext=false;if(row)row.revision++;return {data:{status:'conflict',revision:row?.revision||0,data:row?.data||null},error:null};}
   if((row?.revision||0)!==Number(args.p_expected_revision||0))return {data:{status:'conflict',revision:row?.revision||0,data:row?.data||null},error:null};
   if(row){row={...row,name:args.p_name,sort_order:args.p_sort_order,data:structuredClone(args.p_data),revision:row.revision+1};this.categories[this.categories.findIndex(x=>x.id===row.id)]=row;}
   else {row={id:'db-'+args.p_legacy_category_id,club_id:args.p_club_id,legacy_category_id:args.p_legacy_category_id,name:args.p_name,sort_order:args.p_sort_order,data:structuredClone(args.p_data),revision:1};this.categories.push(row);}
   return {data:{status:'saved',revision:row.revision,data:structuredClone(row.data),id:row.id},error:null};
  }
  if(name==='save_club_metadata'){
   const club=this.clubs.find(x=>x.id===args.p_club_id);if(!club)return {data:null,error:new Error('club not found')};
   const marker=club.shared_data?.categoryPersistenceVersion;club.name=args.p_club_name;club.shared_data=structuredClone(args.p_shared_data||{});delete club.shared_data.categoryPersistenceVersion;
   if(marker!==undefined)club.shared_data.categoryPersistenceVersion=marker;
   return {data:{status:'saved',club:structuredClone(club)},error:null};
  }
  if(name==='replace_club_master'){
   const club=this.clubs.find(x=>x.id===args.p_club_id);if(!club)return {data:null,error:new Error('club not found')};
   club.name=args.p_club_name;club.shared_data=structuredClone(args.p_shared_data);
   const incoming=new Set(args.p_categories.map(x=>x.id));
   this.categories=this.categories.filter(x=>x.club_id!==args.p_club_id||incoming.has(x.legacy_category_id));
   for(const item of args.p_categories){let row=this.categories.find(x=>x.club_id===args.p_club_id&&x.legacy_category_id===item.id);if(row){row.name=item.name;row.sort_order=item.sortOrder;row.data=structuredClone(item.data);row.revision++;}else this.categories.push({id:'db-'+item.id,club_id:args.p_club_id,legacy_category_id:item.id,name:item.name,sort_order:item.sortOrder,data:structuredClone(item.data),revision:1});}
   return {data:{status:'replaced',category_count:args.p_categories.length},error:null};
  }
  throw new Error('Unexpected RPC '+name);
 }
}
const cat=(id,n)=>({id,name:id,data:{teams:[{id:'t'+id,name:n}],results:[{winner:n}],settings:{bestOf:3}}});
(async()=>{
 const db=new MockSupabase();
 await adapter.replaceMaster(db,{clubId:'club-1',master:{clubName:'Example Club',date:'2026-10-04',categories:[cat('AB','Alpha'),cat('CD','Charlie')]}});
 assert.equal(db.categories.length,2,'whole-master import writes two category rows');
 const beforeCD=structuredClone(db.categories.find(x=>x.legacy_category_id==='CD'));
 await adapter.saveCategory(db,{clubId:'club-1',category:cat('AB','Alpha edited'),expectedRevision:1});
 const afterCD=db.categories.find(x=>x.legacy_category_id==='CD');
 assert.deepEqual(afterCD,beforeCD,'saving AB leaves CD row, payload and revision untouched');
 assert.equal(db.categories.find(x=>x.legacy_category_id==='AB').revision,2,'saved category revision increments');
 const loaded=await adapter.loadMaster(db,'club-1','CD');
 assert.equal(loaded.master.categories.length,2,'load assembles every category');
 assert.equal(loaded.master.activeCategoryId,'CD','active category preference is preserved when present');
 assert.equal(loaded.master.categories.find(x=>x.id==='CD').data.teams[0].name,'Charlie','inactive category data round-trips');
 assert.equal(loaded.revisions.CD,1,'per-category revision metadata stays outside the export contract');
 assert.equal(loaded.master.categories.find(x=>x.id==='CD').data.settings.categories[0].id,'CD','category metadata is restored into legacy JSON contract');
 const metadata=await adapter.saveClubMetadata(db,{clubId:'club-1',clubName:'Renamed Club',sharedData:{date:'2026-10-05',categoryPersistenceVersion:1}});
 assert.equal(metadata.club.name,'Renamed Club','shared club metadata saves independently');
 assert.equal(metadata.club.shared_data.categoryPersistenceVersion,1,'routine metadata save preserves an existing completion marker');
 const freshDb=new MockSupabase();
 await adapter.saveClubMetadata(freshDb,{clubId:'club-1',clubName:'New Name',sharedData:{date:'2026-10-05',categoryPersistenceVersion:1}});
 assert.equal(freshDb.clubs[0].shared_data.categoryPersistenceVersion,undefined,'routine metadata save cannot create a false migration-complete marker');
 db.conflictNext=true;
 const result=await adapter.saveCategory(db,{clubId:'club-1',category:cat('AB','Alpha local wins'),expectedRevision:2});
 assert.equal(result.status,'saved','revision race retries automatically');
 assert.equal(db.categories.find(x=>x.legacy_category_id==='AB').data.teams[0].name,'Alpha local wins','retry writes intended local payload');
 db.tournaments=[{club_id:'club-1',version:642,data:{type:'badmintonTournamentManagerMaster',clubName:'Example Club',date:'2026-10-04',activeCategoryId:'AB',categories:[cat('AB','Legacy Alpha'),cat('CD','Legacy Charlie')]}}];
 const skipped=await adapter.migrateLegacyTournament(db,{clubId:'club-1'});
 assert.equal(skipped.status,'skipped-existing-categories','migration does not replace existing category data by default');
 const bad={clubName:'X',categories:[cat('AB','One'),cat('AB','Duplicate')]};
 const callsBefore=db.rpcCalls.length;
 await assert.rejects(()=>adapter.replaceMaster(db,{clubId:'club-1',master:bad}),/duplicate category ID/);
 assert.equal(db.rpcCalls.length,callsBefore,'invalid import is rejected before any database call');
 await adapter.replaceMaster(db,{clubId:'club-1',master:{clubName:'Example Club',date:'2026-10-04',categories:[cat('AB','Only category')]},sharedData:{city:'Test'}});
 assert.equal(db.categories.length,1,'explicit whole-master import intentionally removes omitted categories');
 const baseline={clubName:'Example Club',date:'2026-10-04',categories:[cat('AB','Base Alpha'),cat('CD','Base Charlie')]};
 const local={clubName:'Renamed Club',date:'2026-10-05',categories:[cat('AB','Local Alpha'),cat('CD','Base Charlie')]};
 local.categories[1].data.clubName='Example Club';local.categories[1].data.date='2026-10-04';
 const diff=adapter.diffMasterAgainstBaseline(local,baseline);
 assert.deepEqual(diff.changedCategories.map(x=>x.category.id),['AB'],'offline diff only queues the category with actual tournament changes');
 assert.equal(diff.clubChanged,true,'offline diff detects shared metadata changes separately');
 const migrationDb=new MockSupabase();migrationDb.tournaments=[{club_id:'club-1',version:642,data:{type:'badmintonTournamentManagerMaster',clubName:'Example Club',date:'2026-10-04',activeCategoryId:'AB',categories:[cat('AB','Migrated Alpha'),cat('CD','Migrated Charlie')]}}];
 const migrated=await adapter.migrateLegacyTournament(migrationDb,{clubId:'club-1'});
 assert.equal(migrated.status,'migrated','legacy snapshot migrates when the target category table is empty');
 assert.deepEqual(migrated.categories.map(c=>c.id),['AB','CD'],'migration reports every original category');
 assert.equal(migrationDb.categories.length,2,'migration preserves all category rows');
 console.log('PASS: whole-master import writes isolated category rows');
 console.log('PASS: category save does not alter another category data or revision');
 console.log('PASS: loader reconstructs full master and active category');
 console.log('PASS: revision race retries automatically');
 console.log('PASS: club metadata saves independently of category payloads');
 console.log('PASS: invalid import rejected before database call');
 console.log('PASS: explicit full import replaces category set atomically at adapter contract');
 console.log('PASS: legacy migration skips existing category rows unless explicitly authorized');
 console.log('PASS: legacy migration seeds every category when the target table is empty');
 console.log('PASS: offline baseline diff isolates changed category from unchanged category despite shared-field drift');
 console.log('NOTE: mock client tests adapter behaviour only; PostgreSQL/RLS/live Supabase not exercised.');
})().catch(e=>{console.error(e);process.exit(1);});
