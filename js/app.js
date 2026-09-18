/* ================================================================
   BADMINTON APP — APPLICATION ORCHESTRATION
   Keeps startup and top-level lifecycle wiring in one small place.
   Tournament logic lives in tournament.js; UI in ui.js; persistence/auth
   in storage.js/auth.js.
   ================================================================ */
(function(){
  "use strict";
  function start(){
    try{
      if(typeof loadLocal === "function") loadLocal();
      if(typeof ensurePlayerPoolState === "function") ensurePlayerPoolState(tournament.settings?.playerPoolCount);
      if(typeof bindFloatingScorecardDismissal === "function") bindFloatingScorecardDismissal();
      if(typeof bindCategorySwitcher === "function") bindCategorySwitcher();
      if(typeof renderAll === "function") renderAll();
      window.BADMINTON_CLOUD?.finishAppStartup?.();
    }catch(error){
      console.error("Application startup failed:", error);
      if(typeof showMessage === "function") showMessage("Application startup failed. Please refresh the page.","warning");
    }
  }
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded",start,{once:true});
  else start();
})();
