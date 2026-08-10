// AllChat is free software under the GNU Affero General Public License v3.0 or later.
export function installSoundboardAdmin(root = document) {
  const form = root.querySelector?.("#sound-upload");
  if (!form || form.dataset.soundboardReady === "true") return;
  form.dataset.soundboardReady = "true";

  const list = root.querySelector("#sound-list");
  const status = root.querySelector("#sound-status");
  const settings = root.querySelector("#sound-settings");
  const csrf = form.querySelector('[name="csrf_token"]').value;
  const uploadButton = form.querySelector('button[type="submit"]');

  const requestError = async (response, fallback) => {
    const text = (await response.text()).trim();
    try { return JSON.parse(text).error || fallback; } catch (_) { return text || fallback; }
  };
  const load = async () => {
    const response = await fetch("/api/v1/soundboard");
    if (!response.ok) throw new Error(await requestError(response, "Could not load sounds."));
    const value = await response.json();
    settings.elements.seconds.value = value.settings.max_duration_ms / 1000;
    list.replaceChildren();
    for (const sound of value.sounds || []) {
      const row = document.createElement("article");
      row.className = "card sound-card";
      row.innerHTML = '<button type="button" class="sound-preview" aria-label="Preview sound"></button><span class="sound-card-details"><strong></strong><small></small></span><button type="button" class="button-danger">Delete</button>';
      row.querySelector(".sound-preview").textContent = sound.emoji || "▶";
      row.querySelector("strong").textContent = sound.name;
      row.querySelector("small").textContent = `${(sound.duration_ms / 1000).toFixed(1)}s`;
      row.querySelector(".sound-preview").onclick = async () => {
        try { await new Audio(sound.audio_url).play(); } catch (_) { status.textContent = "Audio preview could not be played."; }
      };
      row.querySelector(".button-danger").onclick = async event => {
        event.currentTarget.disabled = true;
        const response = await fetch(`/api/v1/soundboard/${sound.id}`, {method: "DELETE", headers: {"X-CSRF-Token": csrf}});
        if (!response.ok) { event.currentTarget.disabled = false; status.textContent = await requestError(response, "Could not delete sound."); return; }
        status.textContent = "Sound deleted.";
        await load();
      };
      list.append(row);
    }
    if (!list.children.length) {
      const empty = document.createElement("p");
      empty.className = "muted soundboard-empty";
      empty.textContent = "No Community sounds have been added yet.";
      list.append(empty);
    }
  };

  form.addEventListener("submit", async event => {
    event.preventDefault();
    uploadButton.disabled = true;
    status.textContent = "Uploading sound…";
    try {
      const response = await fetch("/api/v1/soundboard", {method: "POST", headers: {"X-CSRF-Token": csrf}, body: new FormData(form)});
      if (!response.ok) throw new Error(await requestError(response, "Could not upload sound."));
      form.reset();
      status.textContent = "Sound uploaded.";
      await load();
    } catch (error) {
      status.textContent = error.message || "Could not upload sound.";
    } finally {
      uploadButton.disabled = false;
    }
  });
  settings.addEventListener("submit", async event => {
    event.preventDefault();
    const button = settings.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const response = await fetch("/api/v1/soundboard/settings", {method: "PUT", headers: {"Content-Type": "application/json", "X-CSRF-Token": csrf}, body: JSON.stringify({max_duration_ms: Number(settings.elements.seconds.value) * 1000})});
      status.textContent = response.ok ? "Sound duration limit saved." : await requestError(response, "Could not save the duration limit.");
    } finally {
      button.disabled = false;
    }
  });
  load().catch(error => { list.textContent = ""; status.textContent = error.message || "Could not load sounds."; });
}
