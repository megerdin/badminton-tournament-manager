/* ================================================================
   BADMINTON APP — AUTHENTICATION
   Owns Supabase authentication, session/profile state, approval gating,
   password recovery/change, sign-out, and master-admin approval UI.
   Storage/sync remains in storage.js.
   ================================================================ */
(function(){
  "use strict";

  const AUTH = {
    APP_URL: "https://megerdin.github.io/badminton-tournament-manager/",
    async init(){
      const cloud=window.BADMINTON_CLOUD;
      if(!cloud?.configured?.() || !cloud.client){
        this.gate(false);
        return;
      }

      document.getElementById('cloudLoginBtn')?.addEventListener('click',()=>this.login());
      document.getElementById('cloudSignupBtn')?.addEventListener('click',()=>this.signup());
      document.getElementById('cloudSignoutBtn')?.addEventListener('click',()=>this.signout());
      document.getElementById('cloudForgotPasswordBtn')?.addEventListener('click',()=>this.resetPassword());
      document.getElementById('cloudChangePasswordBtn')?.addEventListener('click',()=>this.changePassword());
      document.getElementById('cloudCancelPasswordBtn')?.addEventListener('click',()=>this.showPasswordPanel(false));
      document.getElementById('cloudChangePasswordLink')?.addEventListener('click',()=>this.showPasswordPanel(true));

      const r=await cloud.client.auth.getSession();
      if(r.error) throw r.error;
      cloud.session=r.data.session;

      if(cloud.session){
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

      cloud.client.auth.onAuthStateChange(async(event,session)=>{
        cloud.session=session;
        if(event==='PASSWORD_RECOVERY'){
          cloud.profile=null;
          this.gate(true);
          this.showPasswordPanel(true);
          this.message('Enter your new password.');
          return;
        }
        if(session){
          try{ await this.loadProfile(); }
          catch(e){ cloud.message?.(e.message||String(e)); }
        }else{
          cloud.profile=null;
          cloud.cloudVersion=0;
          this.gate(true);
          this.renderSignedOut();
        }
      });
    },

    gate(v){ document.getElementById('cloudAuthGate')?.classList.toggle('hidden',!v); },
    message(t){ window.BADMINTON_CLOUD?.message?.(t); },
    getSession(){ return window.BADMINTON_CLOUD?.session || null; },
    getProfile(){ return window.BADMINTON_CLOUD?.profile || null; },

    renderSignedOut(){
      document.getElementById('cloudAuthForm')?.removeAttribute('hidden');
      document.getElementById('cloudSignedIn')?.setAttribute('hidden','');
      document.getElementById('cloudAuthAdmin')?.setAttribute('hidden','');
    },

    renderSignedIn(){
      document.getElementById('cloudAuthForm')?.setAttribute('hidden','');
      document.getElementById('cloudSignedIn')?.removeAttribute('hidden');
      const e=document.getElementById('cloudSignedInUser');
      if(e)e.textContent=window.BADMINTON_CLOUD?.profile?.display_name||window.BADMINTON_CLOUD?.session?.user?.email||'Signed in';
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
        this.message(cloud.profile.approval_status==='pending'?'Awaiting master-admin approval.':'Account is '+cloud.profile.approval_status+'.');
        if(cloud.profile.role==='master_admin') await this.renderAdmin();
        return;
      }

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
      }
      if(cloud.appReady) await cloud.loadRemoteIntoApp(); else this.gate(false);
      if(cloud.profile.role==='master_admin') await this.renderAdmin();
    },

    async signup(){
      const cloud=window.BADMINTON_CLOUD;
      const email=document.getElementById('cloudEmail')?.value.trim();
      const password=document.getElementById('cloudPassword')?.value;
      const name=document.getElementById('cloudDisplayName')?.value.trim();
      if(!email||!password)return this.message('Email and password are required.');
      this.message('Creating account…');
      const r=await cloud.client.auth.signUp({email,password,options:{data:{display_name:name},emailRedirectTo:this.APP_URL}});
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

    async signout(){
      this.showPasswordPanel(false);
      await window.BADMINTON_CLOUD?.client?.auth.signOut();
    },

    async renderAdmin(){
      const cloud=window.BADMINTON_CLOUD;
      if(!cloud?.client||cloud.profile?.role!=='master_admin'||cloud.profile?.approval_status!=='approved')return;
      const box=document.getElementById('cloudAuthAdmin');
      const list=document.getElementById('cloudPendingUsers');
      if(!box)return;
      box.hidden=false;
      list.textContent='Loading…';
      const r=await cloud.client.from('profiles').select('id,email,display_name,approval_status').order('created_at',{ascending:true});
      if(r.error){list.textContent=r.error.message;return;}
      list.textContent='';
      const pending=(r.data||[]).filter(x=>x.approval_status==='pending');
      if(!pending.length){list.textContent='No pending users.';return;}
      pending.forEach(u=>{
        const row=document.createElement('div');
        row.className='cloud-pending-user';
        const label=document.createElement('span');
        label.textContent=u.display_name||u.email||u.id;
        const b=document.createElement('button');
        b.textContent='Approve';
        b.onclick=async()=>{
          b.disabled=true;
          const x=await cloud.client.rpc('admin_set_approval',{target_user_id:u.id,new_status:'approved'});
          if(x.error){this.message(x.error.message);b.disabled=false;}
          else await this.renderAdmin();
        };
        row.append(label,b);
        list.append(row);
      });
    }
  };

  window.BADMINTON_AUTH=Object.freeze(AUTH);
})();
