/* ================================================================
   BADMINTON APP — AUTHENTICATION
   Owns Supabase authentication, session/profile state, approval gating,
   password recovery/change, sign-out, and administrator approval UI.
   Storage/sync remains in storage.js.
   ================================================================ */
(function(){
  "use strict";

  const AUTH = {
    APP_URL: "https://megerdin.github.io/badminton-tournament-manager/",
    INACTIVITY_MS: 30*60*1000,
    activityTimer:null,
    activityBound:false,
    activityUserId:null,
    activityKey(userId){ return "badmintonTournamentManager.lastActivity.v1."+String(userId||""); },
    async init(){
      const cloud=window.BADMINTON_CLOUD;
      if(!cloud?.configured?.() || !cloud.client){
        this.gate(false);
        return;
      }

      document.getElementById('cloudLoginBtn')?.addEventListener('click',()=>this.login());
      document.getElementById('cloudSignupBtn')?.addEventListener('click',()=>this.signup());
      document.getElementById('cloudLoginModeBtn')?.addEventListener('click',()=>this.setAuthMode('login'));
      document.getElementById('cloudSignupModeBtn')?.addEventListener('click',()=>this.setAuthMode('signup'));
      // Keep the mode switch robust even if the auth shell is re-rendered.
      document.getElementById('cloudAuthForm')?.addEventListener('click',(event)=>{
        const id=event.target?.id;
        if(id==='cloudLoginModeBtn')this.setAuthMode('login');
        if(id==='cloudSignupModeBtn')this.setAuthMode('signup');
      });
      this.setAuthMode('login');
      document.getElementById('cloudSignoutBtn')?.addEventListener('click',()=>this.signout());
      document.getElementById('cloudSignoutApp')?.addEventListener('click',()=>this.signout());
      document.getElementById('cloudKeepLocalBtn')?.addEventListener('click',()=>window.BADMINTON_CLOUD?.resolveConflictKeepLocal?.());
      document.getElementById('cloudUseCloudBtn')?.addEventListener('click',()=>window.BADMINTON_CLOUD?.resolveConflictUseCloud?.());
      document.getElementById('cloudForgotPasswordBtn')?.addEventListener('click',()=>this.resetPassword());
      document.getElementById('cloudChangePasswordBtn')?.addEventListener('click',()=>this.changePassword());
      document.getElementById('cloudChangePasswordApp')?.addEventListener('click',()=>this.showAppPasswordPanel(true));
      document.getElementById('cloudChangePasswordBtnApp')?.addEventListener('click',()=>this.changeAppPassword());
      document.getElementById('cloudCancelPasswordBtnApp')?.addEventListener('click',()=>this.showAppPasswordPanel(false));
      document.getElementById('cloudCancelPasswordBtn')?.addEventListener('click',()=>this.showPasswordPanel(false));
      document.getElementById('cloudChangePasswordLink')?.addEventListener('click',()=>this.showPasswordPanel(true));

      const r=await cloud.client.auth.getSession();
      if(r.error) throw r.error;
      cloud.session=r.data.session;

      if(cloud.session){
        if(this.sessionInactive(cloud.session.user.id)){
          await this.expireInactiveSession(true);
          this.gate(true);
          this.message('Session expired after 30 minutes of inactivity. Please sign in again.');
          return;
        }
        this.recordActivity();
        try{ await this.loadProfile(); }
        catch(e){
          const cached=cloud.profileCacheRead?.(cloud.session.user.id);
          if(cached&&cached.approval_status==='approved'){
            cloud.profile=cached;
            this.renderSignedIn();
            this.gate(false);
            cloud.status('Offline — using saved tournament data');
            if(cloud.appReady) cloud.loadLocalFallback?.();
          }else throw e;
        }
      }else this.gate(true);

      cloud.client.auth.onAuthStateChange((event,session)=>{
        cloud.session=session;
        if(event==='PASSWORD_RECOVERY'){
          cloud.profile=null;
          this.gate(true);
          this.showPasswordPanel(true);
          this.message('Enter your new password.');
          return;
        }
        if(session){
          // Do not await Supabase calls inside onAuthStateChange; keep the
          // callback lightweight so Auth can finish its internal state update.
          // INITIAL_SESSION can overlap the explicit getSession()/loadProfile()
          // path above, so only start another profile load when the session is
          // not already represented by the current profile.
          setTimeout(()=>{
            const sameUser=cloud.profile?.id===session.user?.id;
            if(!sameUser)this.loadProfile().catch(e=>cloud.message?.(e.message||String(e)));
          },0);
        }else{
          cloud.profile=null;
          cloud.cloudVersion=0;
          this.gate(true);
          this.renderSignedOut();
        }
      });
    },

    gate(v){ document.getElementById('cloudAuthGate')?.classList.toggle('hidden',!v); },

    setAuthMode(mode){
      const signup=mode==='signup';
      const fields=document.getElementById('cloudSignupFields');
      const loginBtn=document.getElementById('cloudLoginBtn');
      const signupBtn=document.getElementById('cloudSignupBtn');
      const forgot=document.getElementById('cloudForgotPasswordBtn');
      const password=document.getElementById('cloudPassword');
      const loginMode=document.getElementById('cloudLoginModeBtn');
      const signupMode=document.getElementById('cloudSignupModeBtn');
      if(fields)fields.hidden=!signup;
      if(loginBtn)loginBtn.hidden=signup;
      if(signupBtn)signupBtn.hidden=!signup;
      if(forgot)forgot.hidden=signup;
      if(password)password.autocomplete=signup?'new-password':'current-password';
      if(loginMode)loginMode.hidden=!signup;
      if(signupMode)signupMode.hidden=signup;
      if(loginMode)loginMode.setAttribute('aria-hidden',String(!signup));
      if(signupMode)signupMode.setAttribute('aria-hidden',String(signup));
      const first=signup
        ? document.getElementById('cloudDisplayName')
        : document.getElementById('cloudEmail');
      if(first)first.focus();
    },

    message(t){ window.BADMINTON_CLOUD?.message?.(t); },
    getSession(){ return window.BADMINTON_CLOUD?.session || null; },
    getProfile(){ return window.BADMINTON_CLOUD?.profile || null; },

    renderSignedOut(){
      this.stopInactivityMonitor();
      // Always return the gate to the normal sign-in view and clear
      // credentials left in the form after sign-out/session expiry.
      this.setAuthMode('login');
      ['cloudPassword','cloudNewPassword','cloudNewPasswordConfirm','cloudNewPasswordApp','cloudNewPasswordConfirmApp'].forEach(id=>{
        const el=document.getElementById(id);
        if(el)el.value='';
      });
      document.getElementById('cloudAuthForm')?.removeAttribute('hidden');
      document.getElementById('cloudSignedIn')?.setAttribute('hidden','');
      document.getElementById('cloudAuthAdmin')?.setAttribute('hidden','');
      const appBar=document.getElementById('cloudAccountBar');
      if(appBar)appBar.hidden=true;
      const admin=document.getElementById('cloudAdminPanelApp');
      if(admin)admin.hidden=true;
      const appUser=document.getElementById('cloudAccountUser');
      if(appUser)appUser.textContent='';
      const profileCard=document.getElementById('cloudProfileCard');
      if(profileCard)profileCard.hidden=true;
    },

    syncAppStatus(){
      const el=document.getElementById('cloudSyncStatusApp');
      const source=document.getElementById('cloudSyncStatus');
      if(el)el.textContent=source?.textContent||'Cloud connected';
      const panel=document.getElementById('cloudConflictPanel');
      if(panel)panel.hidden=!Boolean(window.BADMINTON_CLOUD?.syncConflict);
    },

    renderProfileCard(){
      const cloud=window.BADMINTON_CLOUD;
      const profile=cloud?.profile;
      const card=document.getElementById('cloudProfileCard');
      if(!card||!profile)return;
      const user=cloud?.session?.user;
      const set=(id,value)=>{const el=document.getElementById(id);if(el)el.textContent=value||'—';};
      set('cloudProfileName',profile.display_name||user?.user_metadata?.display_name);
      set('cloudProfileClub',profile.club_name||user?.user_metadata?.club_name||window.BADMINTON_APP_STATE?.getTournament?.()?.clubName);
      set('cloudProfileCity',profile.city||user?.user_metadata?.city);
      set('cloudProfileEmail',profile.email||user?.email);
      set('cloudProfileStatus',profile.approval_status||'—');
      set('cloudProfileRole',profile.role==='master_admin'?'Admin':profile.role==='user'?'User':(profile.role||'User'));
      const versionEl=document.getElementById('cloudLoginVersion');
      if(versionEl && typeof APP_VERSION!=='undefined') versionEl.textContent=`V${APP_VERSION}`;
      card.hidden=false;
    },

    recordActivity(){
      const uid=window.BADMINTON_CLOUD?.session?.user?.id;
      if(!uid)return;
      const now=Date.now();
      this.activityUserId=uid;
      try{localStorage.setItem(this.activityKey(uid),String(now));}catch{}
      this.scheduleInactivityCheck();
    },

    lastActivity(userId){
      try{
        const value=Number(localStorage.getItem(this.activityKey(userId))||0);
        return Number.isFinite(value)&&value>0?value:0;
      }catch{return 0;}
    },

    sessionInactive(userId){
      const last=this.lastActivity(userId);
      return Boolean(last&&Date.now()-last>=this.INACTIVITY_MS);
    },

    scheduleInactivityCheck(){
      clearTimeout(this.activityTimer);
      const uid=this.activityUserId;
      if(!uid||!window.BADMINTON_CLOUD?.session)return;
      const last=this.lastActivity(uid)||Date.now();
      const remaining=Math.max(1000,this.INACTIVITY_MS-(Date.now()-last));
      this.activityTimer=setTimeout(()=>this.checkInactivity(),Math.min(remaining,60*1000));
    },

    async checkInactivity(){
      const cloud=window.BADMINTON_CLOUD;
      const uid=cloud?.session?.user?.id;
      if(!uid){this.stopInactivityMonitor();return;}
      if(this.sessionInactive(uid)){
        await this.expireInactiveSession(false);
        return;
      }
      this.scheduleInactivityCheck();
    },

    async expireInactiveSession(initialCheck){
      const cloud=window.BADMINTON_CLOUD;
      this.stopInactivityMonitor();
      try{localStorage.removeItem(this.activityKey(cloud?.session?.user?.id));}catch{}
      const r=await cloud?.client?.auth.signOut({scope:'local'});
      if(r?.error)console.error('Automatic inactivity sign-out failed:',r.error);
      this.renderSignedOut();
      this.gate(true);
      if(!initialCheck)this.message('Session expired after 30 minutes of inactivity. Please sign in again.');
    },

    stopInactivityMonitor(){
      clearTimeout(this.activityTimer);
      this.activityTimer=null;
      this.activityUserId=null;
      if(!this.activityBound)return;
      ['pointerdown','keydown','touchstart','scroll'].forEach(type=>
        document.removeEventListener(type,this._activityHandler,{passive:true})
      );
      document.removeEventListener('visibilitychange',this._visibilityHandler);
      this.activityBound=false;
    },

    startInactivityMonitor(){
      const uid=window.BADMINTON_CLOUD?.session?.user?.id;
      if(!uid)return;
      this.activityUserId=uid;
      if(!this.activityBound){
        this._activityHandler=()=>this.recordActivity();
        this._visibilityHandler=()=>{
          if(document.visibilityState==='visible')this.checkInactivity();
        };
        ['pointerdown','keydown','touchstart','scroll'].forEach(type=>
          document.addEventListener(type,this._activityHandler,{passive:true})
        );
        document.addEventListener('visibilitychange',this._visibilityHandler);
        this.activityBound=true;
      }
      if(!this.lastActivity(uid))this.recordActivity();
      this.scheduleInactivityCheck();
    },

    renderSignedIn(){
      const cloud=window.BADMINTON_CLOUD;
      const accountName=cloud?.profile?.display_name||cloud?.session?.user?.email||'Signed in';
      document.getElementById('cloudAuthForm')?.setAttribute('hidden','');
      document.getElementById('cloudSignedIn')?.removeAttribute('hidden');
      const e=document.getElementById('cloudSignedInUser');
      if(e)e.textContent=accountName;

      // The application account bar is the primary signed-in control surface.
      // It must be shown whenever a valid session/profile is known, including
      // while cloud data is loading, so users never lose access to Sign out.
      const appBar=document.getElementById('cloudAccountBar');
      if(appBar)appBar.hidden=false;
      const appUser=document.getElementById('cloudAccountUser');
      if(appUser)appUser.textContent=accountName;
      this.renderProfileCard();
      this.startInactivityMonitor();
    },

    async loadProfile(){
      const cloud=window.BADMINTON_CLOUD;
      const session=cloud?.session;
      if(!cloud?.client||!session?.user?.id) return;
      const r=await cloud.client.from('profiles').select('*').eq('id',session.user.id).single();
      if(r.error) throw r.error;
      cloud.profile=r.data;
      cloud.profileCacheWrite?.(cloud.profile);
      this.renderSignedIn();

      if(cloud.profile.approval_status!=='approved'){
        this.gate(true);
        this.message(cloud.profile.approval_status==='pending'?'Awaiting for Admin approval.':'Account is '+cloud.profile.approval_status+'.');
        return;
      }

      if(cloud.profile.role==='master_admin') await this.renderAdmin();
      await cloud.prepareCloudRecord();
      const pending=cloud.queueRead();
      if(pending){
        const synced=await cloud.syncPending();
        if(synced.status==='conflict'){
          this.gate(false);
          cloud.status('Sync conflict — cloud changed. Local changes were kept.');
          window.showMessage?.('Cloud sync conflict: local changes were kept. Resolve before making further changes.');
          return;
        }
        // A failed/offline sync leaves the queue intact. Do not load the remote
        // snapshot here or it would overwrite the user's local tournament and
        // the pending queue could be lost on the next load.
        if(cloud.queueRead()){
          this.gate(false);
          cloud.status(navigator.onLine?'Cloud sync pending — local changes kept':'Offline — changes saved locally');
          return;
        }
      }
      if(cloud.appReady) await cloud.loadRemoteIntoApp(); else this.gate(false);
      if(cloud.profile.role==='master_admin') await this.renderAdmin();
    },

    async signup(){
      const cloud=window.BADMINTON_CLOUD;
      const email=document.getElementById('cloudEmail')?.value.trim();
      const password=document.getElementById('cloudPassword')?.value;
      const name=document.getElementById('cloudDisplayName')?.value.trim();
      const clubName=document.getElementById('cloudClubName')?.value.trim();
      const city=document.getElementById('cloudCity')?.value.trim();
      if(!name||!clubName||!city||!email||!password)return this.message('Name, club name, city, email and password are required.');
      this.message('Creating account…');
      const r=await cloud.client.auth.signUp({email,password,options:{data:{display_name:name,club_name:clubName,city},emailRedirectTo:this.APP_URL}});
      if(r.error){
        const msg=String(r.error.message||r.error);
        if(/rate limit|too many requests/i.test(msg))return this.message('Email service rate limit reached. Please wait before trying again.');
        return this.message(msg);
      }
      this.message(r.data.session
        ? 'Account created. Awaiting approval.'
        : 'Account created. Check your email to confirm your account, then await approval.');
    },

    async login(){
      const cloud=window.BADMINTON_CLOUD;
      const email=document.getElementById('cloudEmail')?.value.trim();
      const password=document.getElementById('cloudPassword')?.value;
      if(!email||!password)return this.message('Email and password are required.');
      this.message('Signing in…');
      const r=await cloud.client.auth.signInWithPassword({email,password});
      if(r.error)this.message(r.error.message);
    },

    async resetPassword(){
      const cloud=window.BADMINTON_CLOUD;
      const email=document.getElementById('cloudEmail')?.value.trim();
      if(!email)return this.message('Enter your email address first.');
      this.message('Sending password reset email…');
      const r=await cloud.client.auth.resetPasswordForEmail(email,{redirectTo:this.APP_URL});
      if(r.error){
        const msg=String(r.error.message||r.error);
        if(/rate limit|too many requests/i.test(msg))return this.message('Email service rate limit reached. Please wait before trying again.');
        return this.message(msg);
      }
      this.message('If that email has an account, a password reset link has been sent.');
    },

    showPasswordPanel(show=true){
      const p=document.getElementById('cloudPasswordPanel');
      if(p)p.hidden=!show;
      if(show)document.getElementById('cloudNewPassword')?.focus();
    },

    async changePassword(){
      const cloud=window.BADMINTON_CLOUD;
      const a=document.getElementById('cloudNewPassword')?.value||'';
      const b=document.getElementById('cloudNewPasswordConfirm')?.value||'';
      if(!a||!b)return this.message('Enter and confirm your new password.');
      if(a!==b)return this.message('The new passwords do not match.');
      if(a.length<6)return this.message('Password must meet the Supabase password requirements.');
      this.message('Updating password…');
      const r=await cloud.client.auth.updateUser({password:a});
      if(r.error)return this.message(r.error.message);
      document.getElementById('cloudNewPassword').value='';
      document.getElementById('cloudNewPasswordConfirm').value='';
      this.showPasswordPanel(false);
      this.message('Password updated successfully.');
    },

    showAppPasswordPanel(show=true){
      const p=document.getElementById('cloudPasswordPanelApp');
      if(p)p.hidden=!show;
      if(show)document.getElementById('cloudNewPasswordApp')?.focus();
    },

    async changeAppPassword(){
      const cloud=window.BADMINTON_CLOUD;
      const a=document.getElementById('cloudNewPasswordApp')?.value||'';
      const b=document.getElementById('cloudNewPasswordConfirmApp')?.value||'';
      if(!a||!b)return this.message('Enter and confirm your new password.');
      if(a!==b)return this.message('The new passwords do not match.');
      if(a.length<6)return this.message('Password must meet the Supabase password requirements.');
      this.message('Updating password…');
      const r=await cloud.client.auth.updateUser({password:a});
      if(r.error)return this.message(r.error.message);
      document.getElementById('cloudNewPasswordApp').value='';
      document.getElementById('cloudNewPasswordConfirmApp').value='';
      this.showAppPasswordPanel(false);
      this.message('Password updated successfully.');
    },

    async signout(){
      this.showPasswordPanel(false);
      this.showAppPasswordPanel(false);
      const r=await window.BADMINTON_CLOUD?.client?.auth.signOut({scope:'local'});
      if(r?.error){
        this.message(r.error.message);
        return;
      }
      // Do not wait for the asynchronous auth-state callback to update the UI.
      this.renderSignedOut();
      this.gate(true);
      this.message('Signed out.');
    },

    async renderAdmin(){
      const cloud=window.BADMINTON_CLOUD;
      if(!cloud?.client||cloud.profile?.role!=='master_admin'||cloud.profile?.approval_status!=='approved')return;
      const box=document.getElementById('cloudAuthAdmin'), list=document.getElementById('cloudPendingUsers');
      const appBox=document.getElementById('cloudAdminPanelApp'), appList=document.getElementById('cloudPendingUsersApp');
      if(!box&&!appBox)return;
      if(box)box.hidden=false; if(appBox)appBox.hidden=false;
      if(list)list.textContent='Loading…'; if(appList)appList.textContent='Loading…';
      const r=await cloud.client.from('profiles').select('id,email,display_name,club_name,city,role,approval_status,created_at').order('created_at',{ascending:true});
      if(r.error){const msg='Admin user list could not be loaded: '+r.error.message;if(list)list.textContent=msg;if(appList)appList.textContent=msg;this.message(msg);return;}
      if(list)list.textContent=''; if(appList)appList.textContent='';
      const users=r.data||[];
      if(!users.length){if(list)list.textContent='No users found.';if(appList)appList.textContent='No users found.';return;}
      const renderInto=target=>{if(!target)return;users.forEach(u=>{
        const row=document.createElement('div');row.className='cloud-pending-user';
        const details=document.createElement('div');details.className='cloud-pending-details';
        const name=document.createElement('strong');name.textContent=u.display_name||'Name not provided';
        const meta=document.createElement('span');meta.textContent=[u.club_name,u.city,u.email].filter(Boolean).join(' · ')||u.id;
        const status=document.createElement('span');status.className='cloud-user-status';status.textContent=(u.role==='master_admin'?'Admin':u.role==='user'?'User':u.role)+' · '+u.approval_status;
        details.append(name,meta,status);
        const actions=document.createElement('div');actions.className='cloud-pending-actions';
        const runAction=(label,action,cls)=>{const btn=document.createElement('button');btn.type='button';btn.textContent=label;btn.className=cls||'';btn.onclick=async()=>{
          if(action==='delete'&&!window.confirm('Delete this user account permanently? Their club and tournament data will also be removed.'))return;
          btn.disabled=true;const old=btn.textContent;btn.textContent=label+'…';
          const x=action==='delete'?await cloud.client.rpc('admin_delete_user',{p_user_id:u.id}):await cloud.client.rpc('admin_set_approval',{p_user_id:u.id,p_status:action});
          if(x.error){btn.disabled=false;btn.textContent=old;this.message(label+' failed: '+x.error.message);return;}
          if(action!=='delete'){const v=await cloud.client.from('profiles').select('approval_status').eq('id',u.id).single();if(v.error||v.data?.approval_status!==action){btn.disabled=false;btn.textContent=old;this.message(label+' was not confirmed by the server.');return;}}
          this.message((u.display_name||u.email||'User')+' '+(action==='delete'?'deleted.':action+'.'));await this.renderAdmin();
        };actions.append(btn);};
        if(u.id!==cloud.session?.user?.id){
          if(u.approval_status!=='approved')runAction('Approve','approved','cloud-action-approve');
          if(u.approval_status!=='rejected')runAction('Reject','rejected','cloud-action-reject');
          if(u.approval_status==='approved')runAction('Suspend','suspended','cloud-action-suspend');
          runAction('Delete','delete','cloud-action-delete');
        }
        row.append(details,actions);target.append(row);
      });};
      renderInto(list);renderInto(appList);
    }
  };

  window.BADMINTON_AUTH=AUTH;
})();
