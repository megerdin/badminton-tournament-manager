/* ================================================================
   BADMINTON APP — APPLICATION ORCHESTRATION
   V6.1.1 — Club + Category architecture
   Startup order is deliberate: cloud/auth must initialise before the
   application is rendered or authentication controls are used.
   ================================================================ */
(function(){
  "use strict";

  async function start(){
    try{
      const cloud=window.BADMINTON_CLOUD;
      const online=navigator.onLine;

      // Cloud is authoritative whenever an internet connection exists.
      // storage.init() creates the Supabase client and then initialises auth.
      // Do not render the application as ready until that process has run.
      if(online && cloud?.init){
        await cloud.init();
      }else if(!online){
        // Offline mode is deliberately local-only. There is no cloud login
        // attempt while disconnected, so recover the last offline snapshot.
        if(typeof loadLocal === "function") loadLocal();
        cloud?.status?.("Offline — local data mode");
      }

      if(typeof ensurePlayerPoolState === "function") ensurePlayerPoolState(tournament.settings?.playerPoolCount);
      if(typeof bindFloatingScorecardDismissal === "function") bindFloatingScorecardDismissal();
      if(typeof bindCategorySwitcher === "function") bindCategorySwitcher();
      if(typeof renderAll === "function") renderAll();
      cloud?.finishAppStartup?.();
    }catch(error){
      console.error("Application startup failed:", error);
      if(typeof showMessage === "function") showMessage("Application startup failed. Please refresh the page.","warning");
      window.BADMINTON_CLOUD?.status?.("Cloud startup failed");
    }
  }

  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded",()=>{start();},{once:true});
  else start();
})();
