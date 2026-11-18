// Admin login: password + 6-digit TOTP code. The server sets an HttpOnly session cookie.
const form=document.getElementById('login'),message=document.getElementById('message');
const show=text=>{message.textContent=text;message.hidden=!text;};
form.addEventListener('submit',async event=>{
 event.preventDefault();show('');const button=form.querySelector('button');button.disabled=true;
 try{
  const response=await fetch('/api/admin/login',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Sonnenpfad-Admin':'1'},body:JSON.stringify({password:form.password.value,code:form.code.value.trim()})});
  if(response.ok){location.href='/admin/';return;}
  const data=await response.json().catch(()=>({}));
  show(data.error==='locked'?'Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.':data.error==='not-configured'?'Die Verwaltung ist noch nicht eingerichtet.':'Passwort oder Code falsch. Hinweis: Jeder Code gilt nur einmal.');
 }catch{show('Keine Verbindung. Bitte erneut versuchen.');}
 finally{button.disabled=false;form.code.value='';form.password.value='';}
});
