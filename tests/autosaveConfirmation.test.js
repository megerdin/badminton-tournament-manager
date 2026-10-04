const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

(async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../js/storage.js'),'utf8');
  const context={
    console,
    navigator:{onLine:true},
    localStorage:{getItem(){return null;},setItem(){},removeItem(){}},
    document:{addEventListener(){},getElementById(){return null;}},
    window:{BADMINTON_CLOUD_CONFIG:{url:'https://example.supabase.co',publishableKey:'publishable-test-key'}},
    setTimeout,clearTimeout
  };
  context.globalThis=context;
  vm.runInNewContext(source,context,{filename:'js/storage.js'});
  const cloud=context.window.BADMINTON_CLOUD;
  cloud.configured=()=>true;
  cloud.client={};
  cloud.session={user:{id:'test-user'}};
  cloud.profile={approval_status:'approved'};
  cloud.clubId='test-club';
  let queued=0,flushes=0;
  cloud.ensureCategoryQueue=()=>({
    enqueueClubMetadata(){queued++;},
    enqueueCategory(){queued++;}
  });
  cloud.status=()=>{};
  cloud.flushCategoryQueue=async()=>{flushes++;return {status:'synced',saved:2};};
  cloud.scheduleCategoryRetry=()=>{};
  const snapshot={clubName:'Test Club',date:'2026-10-04',activeCategoryId:'A',categories:[{id:'A',name:'A',data:{teams:[],results:[]}}]};
  const first=cloud.queueCategoryScopedSave(snapshot);
  const second=cloud.queueCategoryScopedSave(snapshot);
  const results=await Promise.all([first,second]);
  assert.equal(queued,4,'each save request queues shared metadata and the active category');
  assert.equal(flushes,1,'rapid save requests share one debounced cloud flush');
  assert.deepEqual(results.map(result=>result.status),['synced','synced'],'all coalesced callers receive the confirmed cloud result');
  console.log('PASS: rapid autosaves coalesce into one cloud flush and resolve every waiting caller');
})().catch(error=>{console.error(error);process.exit(1);});
