/* Durable per-category operation queue used by the guarded candidate app.
 * The category persistence feature remains disabled by default until live
 * authenticated browser/mobile integration tests pass.
 */
(function(root){
  'use strict';
  const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
  class CategorySyncQueue{
    constructor({adapter,client,clubId,storage,key='badmintonTournamentManager.categoryQueue.v1'}){
      if(!adapter||!client||!clubId||!storage)throw new Error('Queue requires adapter, client, club ID and storage.');
      this.adapter=adapter;this.client=client;this.clubId=clubId;this.storage=storage;this.key=key;this.busy=false;this.revisions={};
    }
    read(){try{const q=JSON.parse(this.storage.getItem(this.key)||'[]');return Array.isArray(q)?q:[];}catch{return [];}}
    write(queue){this.storage.setItem(this.key,JSON.stringify(queue));}
    enqueueCategory(category,{expectedRevision=0,sortOrder=0}={}){
      if(!category||!String(category.id||'').trim())throw new Error('Category ID is required.');
      const queue=this.read();const id=String(category.id);const index=queue.findIndex(op=>op.type==='category'&&op.categoryId===id);
      const previous=index>=0?queue[index]:null;
      const operation={type:'category',categoryId:id,clubId:this.clubId,category:clone(category),sortOrder:Number(sortOrder)||0,
        expectedRevision:previous?Number(previous.expectedRevision||0):Number(expectedRevision||0),
        opId:previous?.opId||((globalThis.crypto?.randomUUID?.())||`${Date.now()}-${Math.random()}`),
        generation:(Number(previous?.generation)||0)+1,queuedAt:Date.now()};
      if(index>=0)queue[index]=operation;else queue.push(operation);
      this.write(queue);return {queued:true,pending:queue.length,categoryId:id};
    }
    enqueueMasterReplacement(master,{sharedData={}}={}){
      if(!master||!Array.isArray(master.categories)||!master.categories.length)throw new Error('A full master replacement requires at least one category.');
      const queue=this.read();const previous=queue.find(op=>op.type==='master'&&op.clubId===this.clubId);
      const operation={type:'master',categoryId:'__master__',clubId:this.clubId,master:clone(master),sharedData:clone(sharedData),
        opId:previous?.opId||((globalThis.crypto?.randomUUID?.())||`${Date.now()}-${Math.random()}`),generation:(Number(previous?.generation)||0)+1,queuedAt:Date.now()};
      // An explicit import/category-list replacement supersedes earlier queued
      // entity operations because it defines the complete intended category set.
      this.write([operation]);return {queued:true,pending:1,entity:'master'};
    }
    enqueueClubMetadata({clubName,sharedData={}}={}){
      const queue=this.read();const index=queue.findIndex(op=>op.type==='club'&&op.clubId===this.clubId);const previous=index>=0?queue[index]:null;
      const operation={type:'club',categoryId:'__club__',clubId:this.clubId,clubName:String(clubName||''),sharedData:clone(sharedData),
        opId:previous?.opId||((globalThis.crypto?.randomUUID?.())||`${Date.now()}-${Math.random()}`),generation:(Number(previous?.generation)||0)+1,queuedAt:Date.now()};
      if(index>=0)queue[index]=operation;else queue.unshift(operation);
      this.write(queue);return {queued:true,pending:queue.length,entity:'club'};
    }
    pendingCount(){return this.read().length;}
    async flush(){
      if(this.busy)return {status:'busy',pending:this.pendingCount()};
      this.busy=true;let saved=0;
      try{
        while(true){
          const queue=this.read();if(!queue.length)return {status:'synced',saved,pending:0};
          const operation=queue[0];
          try{
            let result;
            if(operation.type==='club')result=await this.adapter.saveClubMetadata(this.client,{clubId:this.clubId,clubName:operation.clubName,sharedData:operation.sharedData});
            else if(operation.type==='master')result=await this.adapter.replaceMaster(this.client,{clubId:this.clubId,master:operation.master,sharedData:operation.sharedData});
            else result=await this.adapter.saveCategory(this.client,{clubId:this.clubId,category:operation.category,sortOrder:operation.sortOrder,expectedRevision:operation.expectedRevision});
            if(operation.type==='category')this.revisions[operation.categoryId]=Number(result.revision||operation.expectedRevision||0);
            if(operation.type==='master'){const loaded=await this.adapter.loadMaster(this.client,this.clubId,operation.master.activeCategoryId);this.revisions={...(loaded.revisions||{})};}
            const current=this.read();const index=current.findIndex(op=>op.opId===operation.opId);
            if(index<0){saved++;continue;}
            if(current[index].generation===operation.generation){current.splice(index,1);saved++;}
            else {if(operation.type==='category')current[index].expectedRevision=Number(result.revision||operation.expectedRevision);current.push(current.splice(index,1)[0]);}
            this.write(current);
          }catch(error){return {status:'pending',saved,pending:this.pendingCount(),error:String(error?.message||error)};}
        }
      }finally{this.busy=false;}
    }
  }
  root.BADMINTON_CATEGORY_SYNC_QUEUE=CategorySyncQueue;
  if(typeof module!=='undefined'&&module.exports)module.exports=CategorySyncQueue;
})(typeof window!=='undefined'?window:globalThis);
