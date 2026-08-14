const imageKinds = {
  avatar: {label: "Avatar", aspect: 1, width: 512, height: 512, url: "/api/v1/profile/avatar"},
  banner: {label: "Profile banner", aspect: 300 / 86, width: 1200, height: 344, url: "/api/v1/profile/banner"},
};

const imageFromFile = file => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file), image = new Image();
  image.onload = () => resolve({image, url});
  image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("This image could not be opened.")); };
  image.src = url;
});

async function cropImage(file, kind) {
  const config = imageKinds[kind], loaded = await imageFromFile(file);
  const dialog = document.createElement("dialog"), canvas = document.createElement("canvas"), zoom = document.createElement("input");
  dialog.className = "image-crop-dialog";
  canvas.width = config.width; canvas.height = config.height; canvas.className = `image-crop-canvas image-crop-${kind}`;
  zoom.type = "range"; zoom.min = "1"; zoom.max = "3"; zoom.step = "0.01"; zoom.value = "1"; zoom.setAttribute("aria-label", "Zoom image");
  dialog.innerHTML = `<form method="dialog"><header><div><h2>Crop ${config.label}</h2><p>Drag to reposition, then zoom until it fits.</p></div><button class="button-ghost" value="cancel" aria-label="Cancel crop">×</button></header><div class="image-crop-stage"></div><label>Zoom</label><footer><button class="button-ghost" value="cancel">Cancel</button><button value="apply">Apply crop</button></footer></form>`;
  dialog.querySelector(".image-crop-stage").append(canvas);
  dialog.querySelector("label").append(zoom);
  document.body.append(dialog);
  const context = canvas.getContext("2d"), cover = Math.max(config.width / loaded.image.naturalWidth, config.height / loaded.image.naturalHeight);
  let offsetX = 0, offsetY = 0, dragging = false, lastX = 0, lastY = 0;
  const clamp = () => {
    const scale = cover * Number(zoom.value), width = loaded.image.naturalWidth * scale, height = loaded.image.naturalHeight * scale;
    offsetX = Math.max((config.width - width) / 2, Math.min((width - config.width) / 2, offsetX));
    offsetY = Math.max((config.height - height) / 2, Math.min((height - config.height) / 2, offsetY));
  };
  const draw = () => {
    clamp(); const scale = cover * Number(zoom.value), width = loaded.image.naturalWidth * scale, height = loaded.image.naturalHeight * scale;
    context.clearRect(0, 0, config.width, config.height);
    context.drawImage(loaded.image, (config.width - width) / 2 + offsetX, (config.height - height) / 2 + offsetY, width, height);
  };
  zoom.oninput = draw;
  canvas.onpointerdown = event => { dragging = true; lastX = event.clientX; lastY = event.clientY; canvas.setPointerCapture(event.pointerId); };
  canvas.onpointermove = event => { if (!dragging) return; const scaleX = canvas.width / canvas.clientWidth, scaleY = canvas.height / canvas.clientHeight; offsetX += (event.clientX - lastX) * scaleX; offsetY += (event.clientY - lastY) * scaleY; lastX = event.clientX; lastY = event.clientY; draw(); };
  canvas.onpointerup = canvas.onpointercancel = () => { dragging = false; };
  canvas.onwheel = event => { event.preventDefault(); zoom.value = String(Math.max(1, Math.min(3, Number(zoom.value) - event.deltaY * .002))); draw(); };
  draw(); dialog.showModal();
  return new Promise(resolve => dialog.addEventListener("close", () => {
    const apply = dialog.returnValue === "apply";
    const finish = blob => { URL.revokeObjectURL(loaded.url); dialog.remove(); resolve(blob); };
    apply ? canvas.toBlob(finish, "image/webp", .9) : finish(null);
  }, {once: true}));
}

function imageControl(kind, profileForm, csrf) {
  const config = imageKinds[kind], url = profileForm.dataset[`${kind}Url`];
  const control = document.createElement("fieldset");
  control.dataset[`${kind}Control`] = "";
  control.innerHTML = `<legend>${config.label}</legend><div class="profile-image-editor profile-${kind}-editor"><div class="profile-image-preview profile-${kind}-preview"><img alt="Current ${config.label.toLowerCase()}" hidden><span class="member-avatar-fallback">?</span></div><label>Choose image<input type="file" accept="image/png,image/jpeg,image/webp"></label><div class="profile-image-actions"><button type="button" data-image-save data-${kind}-save>Upload ${kind}</button><button type="button" class="button-ghost danger-text" data-image-remove data-${kind}-remove>Remove ${kind}</button></div></div><p class="muted" data-${kind}-status aria-live="polite"></p>`;
  const file = control.querySelector('input[type="file"]'), image = control.querySelector("img"), fallback = control.querySelector("span"), status = control.querySelector(`[data-${kind}-status]`);
  let cropped = null, previewURL = "";
  const preview = source => { image.src = source; image.hidden = false; fallback.hidden = true; };
  if (url) preview(url);
  file.onchange = async () => {
    if (!file.files[0]) return;
    status.textContent = "";
    try {
      cropped = await cropImage(file.files[0], kind);
      if (!cropped) { file.value = ""; return; }
      if (previewURL) URL.revokeObjectURL(previewURL);
      previewURL = URL.createObjectURL(cropped); preview(previewURL); status.textContent = `${config.label} crop ready to upload.`;
    } catch (error) { status.textContent = error.message; file.value = ""; }
  };
  control.querySelector("[data-image-save]").onclick = async () => {
    if (!cropped) { status.textContent = "Choose and crop an image first."; return; }
    const response = await fetch(config.url, {method: "PUT", headers: {"X-CSRF-Token": csrf, "Content-Type": cropped.type}, body: cropped});
    status.textContent = response.ok ? `${config.label} updated.` : `Could not update ${kind}.`;
    if (response.ok) { cropped = null; file.value = ""; }
  };
  control.querySelector("[data-image-remove]").onclick = async () => {
    const response = await fetch(config.url, {method: "DELETE", headers: {"X-CSRF-Token": csrf}});
    status.textContent = response.ok ? `${config.label} removed.` : `Could not remove ${kind}.`;
    if (response.ok) { cropped = null; file.value = ""; image.hidden = true; fallback.hidden = false; }
  };
  return control;
}

export function installProfileImageControls(root = document) {
  const profileForm = root.querySelector?.('form[action="/profile"]');
  if (!profileForm || profileForm.querySelector("[data-avatar-control]")) return;
  const csrf = profileForm.querySelector('[name="csrf_token"]').value, anchor = profileForm.firstElementChild?.nextElementSibling || profileForm.firstElementChild;
  profileForm.insertBefore(imageControl("avatar", profileForm, csrf), anchor);
  profileForm.insertBefore(imageControl("banner", profileForm, csrf), anchor);
}
