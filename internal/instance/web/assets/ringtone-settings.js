(() => {
  "use strict";
  const install=root=>{root=root.querySelector?.("[data-community-ringtone]")||root;if(!root?.matches?.("[data-community-ringtone]")||root.dataset.ringtoneReady)return;root.dataset.ringtoneReady="true";
  const file=root.querySelector("[data-ringtone-file]"),remove=root.querySelector("[data-ringtone-remove]"),status=root.querySelector("[data-ringtone-status]"),notice=root.querySelector("[data-ringtone-notice]");
  const csrf=()=>decodeURIComponent(document.cookie.split("; ").find(item=>item.startsWith("allchat_csrf="))?.split("=").slice(1).join("=")||"");
  file.onchange=async()=>{const selected=file.files?.[0];if(!selected)return;try{const type=selected.type||(/\.ogg$/i.test(selected.name)?"audio/ogg":/\.wav$/i.test(selected.name)?"audio/wav":"audio/mpeg"),response=await fetch("/api/v1/admin/community-ringtone",{method:"PUT",headers:{"Content-Type":type,"X-CSRF-Token":csrf()},body:selected});if(!response.ok)throw new Error((await response.json().catch(()=>({}))).error||"Could not save ringtone");status.textContent="Custom Community ringtone";remove.hidden=false;notice.textContent="Ringtone saved."}catch(error){notice.textContent=error.message||"Could not save ringtone."}};
  remove.onclick=async()=>{try{const response=await fetch("/api/v1/admin/community-ringtone",{method:"DELETE",headers:{"X-CSRF-Token":csrf()}});if(!response.ok)throw new Error("Could not remove ringtone");status.textContent="Generated tone";remove.hidden=true;notice.textContent="Custom ringtone removed."}catch(error){notice.textContent=error.message||"Could not remove ringtone."}};
  };
  window.installAllChatRingtoneSettings=install;install(document);
})();
