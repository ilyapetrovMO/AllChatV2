(() => {
  'use strict';
  if (window.AllChatDesign) return;
  const paths = {
    mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',
    headphones:
      '<path d="M3 14v-3a9 9 0 0 1 18 0v3"/><rect x="3" y="12" width="4" height="9" rx="2"/><rect x="17" y="12" width="4" height="9" rx="2"/>',
    camera: '<rect x="2" y="5" width="14" height="14" rx="2"/><path d="m16 9 6-3v12l-6-3"/>',
    activity: '<path d="m8 2 2 5 5 2-5 2-2 5-2-5-5-2 5-2ZM18 12l2 3 3 2-3 2-2 3-2-3-3-2 3-2Z"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
  };
  function button(label, icon, action) {
    const value = document.createElement('button');
    value.type = 'button';
    value.title = label;
    value.setAttribute('aria-label', label);
    if (paths[icon])
      value.innerHTML = `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[icon]}</svg>`;
    else window.allchatSetIcon?.(value, icon);
    if (action) value.onclick = action;
    return value;
  }
  function place(popover, anchor) {
    const rect = anchor.getBoundingClientRect();
    popover.style.left = `${Math.max(8, Math.min(innerWidth - popover.offsetWidth - 8, rect.left))}px`;
    popover.style.top = `${Math.max(8, Math.min(innerHeight - popover.offsetHeight - 8, rect.top - popover.offsetHeight - 8))}px`;
  }
  function dismissible(popover, anchor) {
    const close = (event) => {
      if (event.type === 'keydown' && event.key !== 'Escape') return;
      if (event.type === 'keydown') {
        event.preventDefault();
        event.stopPropagation();
      }
      if (
        event.type === 'pointerdown' &&
        (popover.contains(event.target) || anchor?.contains(event.target))
      )
        return;
      popover.remove();
    };
    const controller = new AbortController();
    document.addEventListener('pointerdown', close, { signal: controller.signal });
    document.addEventListener('keydown', close, { signal: controller.signal });
    const observer = new MutationObserver(() => {
      if (!popover.isConnected) {
        controller.abort();
        observer.disconnect();
      }
    });
    observer.observe(popover.parentNode, { childList: true });
  }
  let muted = false,
    deafened = false;
  let audioUpdate = Promise.resolve();
  addEventListener('allchat:voice-settings', (event) => {
    const settings = event.detail;
    audioUpdate = audioUpdate
      .catch(() => {})
      .then(() => mediaAdapter()?.settings?.(settings))
      .catch((error) => {
        const status = document.querySelector('.member-connection-heading strong');
        if (status) status.textContent = error.message || 'Could not change microphone.';
      });
  });
  const mediaAdapter = () => window.allchatCallControls || window.allchatVoiceControls;
  async function audioMenu(kind, anchor) {
    document.querySelector('.audio-popover')?.remove();
    if (!window.AllChatVoiceSettings) await import('/assets/voice-settings.js');
    const api = window.AllChatVoiceSettings,
      popover = document.createElement('div');
    popover.className = 'audio-popover';
    popover.role = 'dialog';
    popover.setAttribute('aria-label', kind === 'input' ? 'Input controls' : 'Output controls');
    const settings = api.load(),
      input = kind === 'input',
      device = document.createElement('label'),
      select = document.createElement('select');
    device.append(input ? 'Input Device' : 'Output Device', select);
    const defaultOption = new Option('System Default', '');
    select.append(defaultOption);
    try {
      for (const item of await navigator.mediaDevices.enumerateDevices())
        if (item.kind === (input ? 'audioinput' : 'audiooutput'))
          select.append(
            new Option(
              item.label || `${input ? 'Microphone' : 'Speaker'} ${select.options.length}`,
              item.deviceId,
            ),
          );
    } catch {}
    const deviceKey = input ? 'microphoneID' : 'speakerID';
    select.value = settings[deviceKey];
    select.onchange = () => api.save({ ...api.load(), [deviceKey]: select.value });
    popover.append(device);
    if (input) {
      const profile = document.createElement('label'),
        choices = document.createElement('select');
      profile.append('Input Profile', choices);
      for (const [value, label] of [
        ['off', 'Original'],
        ['standard', 'Standard'],
        ['enhanced', 'Enhanced'],
      ])
        choices.append(new Option(label, value));
      choices.value = settings.noiseSuppressionMode;
      choices.onchange = () => api.save({ ...api.load(), noiseSuppressionMode: choices.value });
      popover.append(profile);
    }
    const volume = document.createElement('label'),
      slider = document.createElement('input'),
      output = document.createElement('output');
    volume.append(input ? 'Input Volume' : 'Output Volume', output, slider);
    slider.type = 'range';
    slider.min = '0';
    slider.max = input ? '2' : '1';
    slider.step = '.01';
    const key = input ? 'inputGain' : 'outputVolume';
    slider.value = settings[key];
    slider.setAttribute('aria-label', input ? 'Input Volume' : 'Output Volume');
    const refresh = () => {
      output.value = `${Math.round(Number(slider.value) * 100)}%`;
    };
    slider.oninput = () => {
      api.save({ ...api.load(), [key]: Number(slider.value) });
      refresh();
    };
    refresh();
    popover.append(volume);
    if (input) {
      const label = document.createElement('label'),
        meter = document.createElement('meter');
      label.append('Input Level', meter);
      meter.min = 0;
      meter.max = 1;
      popover.append(label);
      const controller = new AbortController();
      addEventListener(
        'allchat:microphone-level',
        (event) => {
          if (!popover.isConnected) {
            controller.abort();
            return;
          }
          meter.value = Math.max(0, (event.detail.db + 60) / 60);
        },
        { signal: controller.signal },
      );
    }
    const link = document.createElement('a');
    link.href = '/voice-video';
    link.textContent = 'Voice Settings';
    link.onclick = (event) => {
      if (window.allchatNavigate) {
        event.preventDefault();
        window.allchatNavigate(link.href);
      }
      popover.remove();
    };
    popover.append(link);
    document.body.append(popover);
    place(popover, anchor);
    dismissible(popover, anchor);
  }
  let memberRequest;
  const pendingPanels = new WeakSet();
  function fillMissingMemberPanels() {
    document.querySelectorAll('.channel-sidebar').forEach((sidebar) => {
      if (sidebar.querySelector('.member-panel') || pendingPanels.has(sidebar)) return;
      pendingPanels.add(sidebar);
      memberRequest ||= fetch('/api/v1/mobile/bootstrap')
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null);
      memberRequest.then((data) => {
        const member = data?.member;
        if (!member || !sidebar.isConnected || sidebar.querySelector('.member-panel')) return;
        const panel = document.createElement('div');
        panel.className = 'member-panel';
        const summary = document.createElement('a');
        summary.className = 'member-summary';
        summary.href = '/profile';
        summary.setAttribute('aria-label', 'My account');
        const avatar = document.createElement(member.avatar_url ? 'img' : 'span');
        avatar.className = 'member-avatar member-avatar-fallback';
        if (member.avatar_url) {
          avatar.src = member.avatar_url;
          avatar.alt = '';
        } else
          avatar.textContent = (member.display_name || member.username || '?')
            .slice(0, 1)
            .toUpperCase();
        const dot = document.createElement('span');
        dot.className = 'member-presence online';
        const identity = document.createElement('span');
        identity.className = 'member-identity';
        const name = document.createElement('strong'),
          username = document.createElement('small');
        name.textContent = member.display_name || member.username;
        username.textContent = '@' + member.username;
        identity.append(name, username);
        summary.append(avatar, dot, identity);
        const settings = document.createElement('a');
        settings.href = '/profile';
        settings.className = 'member-settings';
        settings.setAttribute('aria-label', 'User Settings');
        window.allchatSetIcon?.(settings, 'settings');
        panel.append(summary, settings);
        sidebar.append(panel);
        if (!document.body.dataset.memberId) {
          document.body.dataset.memberId = member.id;
          import('/assets/call.js');
        }
        schedule();
      });
    });
  }

  function installMemberPanels() {
    fillMissingMemberPanels();
    document.querySelectorAll('.channel-sidebar .member-panel').forEach((panel) => {
      if (!panel.closest('.floating-member-panel')) {
        const wrap = document.createElement('div');
        wrap.className = 'floating-member-panel';
        panel.before(wrap);
        wrap.append(panel);
      }
      const wrapper = panel.parentElement,
        voice = wrapper.parentElement.querySelector(':scope > .voice-connection-panel');
      if (voice) wrapper.prepend(voice);
      if (panel.querySelector('.audio-button-group')) return;
      for (const [kind, icon, label] of [
        ['input', 'mic', 'Mute microphone'],
        ['output', 'headphones', 'Deafen'],
      ]) {
        const group = document.createElement('div');
        group.className = 'audio-button-group';
        const toggle = button(label, icon, () => {
          if (kind === 'input') {
            muted = !muted;
            mediaAdapter()?.mute(muted);
          } else {
            deafened = !deafened;
            document.querySelectorAll('audio').forEach((audio) => (audio.muted = deafened));
          }
          syncAudio();
        });
        toggle.dataset.audioToggle = kind;
        const chevron = button(
          kind === 'input' ? 'Input controls' : 'Output controls',
          'chevron',
          () => audioMenu(kind, chevron),
        );
        group.append(toggle, chevron);
        panel.querySelector('.member-settings')?.before(group);
      }
    });
    syncAudio();
  }
  function syncAudio() {
    document.querySelectorAll('[data-audio-toggle]').forEach((toggle) => {
      const input = toggle.dataset.audioToggle === 'input',
        active = input ? muted : deafened;
      toggle.setAttribute('aria-pressed', String(active));
      toggle.setAttribute(
        'aria-label',
        input ? (active ? 'Unmute microphone' : 'Mute microphone') : active ? 'Undeafen' : 'Deafen',
      );
    });
  }
  function connectionPanel(panel, adapter) {
    if (panel.dataset.designReady) return;
    panel.dataset.designReady = 'true';
    const identity = panel.firstElementChild,
      actions = panel.querySelector('.voice-connection-actions,.call-controls');
    if (!identity || !actions) return;
    const heading = document.createElement('div');
    heading.className = 'member-connection-heading';
    const signal = document.createElement('div');
    signal.className = 'connection-signal';
    signal.dataset.quality = 'unknown';
    signal.tabIndex = 0;
    signal.innerHTML = '<i></i><i></i><i></i><i></i>';
    signal.title = 'Connecting';
    heading.append(signal, identity);
    const leave = actions.querySelector('[data-voice-leave],[data-call-end]');
    if (leave) {
      leave.setAttribute(
        'aria-label',
        leave.matches('[data-call-end]') ? 'End call' : 'Disconnect voice',
      );
      window.allchatSetIcon?.(leave, 'phone');
      heading.append(leave);
    }
    const mute = actions.querySelector('[data-voice-mute],[data-call-mute]');
    if (mute) mute.hidden = true;
    const row = document.createElement('div');
    row.className = 'member-call-actions';
    row.append(
      button('Start camera share', 'camera', async (event) => {
        const target = event.currentTarget;
        try {
          await adapter.camera();
          target.classList.toggle('active');
        } catch (error) {
          identity.querySelector('strong').textContent = error.message;
        }
      }),
    );
    const screen = actions.querySelector('[data-voice-screen],[data-call-screen]');
    if (screen) {
      screen.setAttribute('aria-label', 'Share screen');
      window.allchatSetIcon?.(screen, 'monitor');
      row.append(screen);
    }
    row.append(button('Open Activities', 'activity', () => openActivities(adapter)));
    const soundboard =
      actions.querySelector('[data-voice-soundboard]') ||
      button('Open soundboard', 'music', (event) => adapter.soundboard(event.currentTarget));
    row.append(soundboard);
    panel.prepend(heading);
    panel.append(row);
    const retry = actions.querySelector('[data-voice-retry]');
    if (retry) heading.append(retry);
    actions.hidden = true;
    let statsBusy = false;
    const timer = setInterval(async () => {
      if (!panel.isConnected) {
        clearInterval(timer);
        return;
      }
      if (statsBusy) return;
      statsBusy = true;
      try {
        const peer = adapter.peer();
        const stats = await peer?.getStats();
        let ping;
        stats?.forEach((item) => {
          if (
            item.type === 'candidate-pair' &&
            item.state === 'succeeded' &&
            (item.nominated || item.selected) &&
            Number.isFinite(item.currentRoundTripTime)
          )
            ping = Math.round(item.currentRoundTripTime * 1000);
        });
        signal.title =
          ping === undefined
            ? peer?.connectionState === 'connected'
              ? 'Connected'
              : 'Connecting'
            : `${ping} ms`;
        signal.setAttribute('aria-label', signal.title);
        signal.dataset.quality =
          ping === undefined ? 'unknown' : ping < 150 ? 'good' : ping < 300 ? 'poor' : 'bad';
      } catch {
      } finally {
        statsBusy = false;
      }
    }, 1000);
    if (muted) adapter.mute(true);
  }
  async function openActivities(adapter) {
    await adapter.open?.();
    const dialog = document.createElement('dialog');
    dialog.className = 'activity-design-dialog';
    dialog.innerHTML =
      '<header><strong>Activities</strong><button type="button" aria-label="Close Activities">×</button></header><div class="activity-design-list"></div>';
    document.body.append(dialog);
    dialog.querySelector('button').onclick = () => dialog.close();
    dialog.onclose = () => dialog.remove();
    dialog.showModal();
    const list = dialog.querySelector('.activity-design-list');
    try {
      const response = await fetch('/api/v1/activities');
      if (!response.ok) throw new Error('Activities unavailable.');
      const data = await response.json();
      for (const item of data.activities || []) {
        if (!item.enabled) continue;
        const start = document.createElement('button');
        start.textContent = item.manifest?.name || item.name || item.id;
        start.onclick = async () => {
          try {
            const csrf = decodeURIComponent(
              document.cookie
                .split('; ')
                .find((v) => v.startsWith('allchat_csrf='))
                ?.slice(13) || '',
            );
            const result = await fetch(
              `/api/v1/activities/${encodeURIComponent(item.manifest?.id || item.id)}/launch`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
                body: '{}',
              },
            );
            if (!result.ok) throw new Error('Could not start Activity.');
            const launch = await result.json();
            const frame = document.createElement('iframe');
            frame.title = start.textContent;
            frame.sandbox = 'allow-scripts';
            frame.src = launch.runtime_url + '#' + encodeURIComponent(launch.token);
            list.replaceChildren(frame);
          } catch (error) {
            start.textContent = error.message;
          }
        };
        list.append(start);
      }
      if (!list.children.length) list.textContent = 'No Activities available.';
    } catch (error) {
      list.textContent = error.message;
    }
  }
  const observedGrids = new Map(),
    colors = new Map();
  let queued = false;
  function layoutGrid(grid) {
    const count = [...grid.children].filter((tile) => tile.matches('.participant-tile')).length;
    if (!count) return;
    const gap = innerWidth <= 760 ? 8 : 12,
      width = grid.clientWidth,
      height = grid.clientHeight;
    let best = 0;
    for (let columns = 1; columns <= count; columns++) {
      const rows = Math.ceil(count / columns);
      best = Math.max(
        best,
        Math.min(
          (width - gap * (columns - 1)) / columns,
          (((height - gap * (rows - 1)) / rows) * 16) / 9,
        ),
      );
    }
    grid.style.setProperty('--cell-width', `${Math.max(1, best - 0.1)}px`);
    grid.style.setProperty('--cell-height', `${Math.max(1, ((best - 0.1) * 9) / 16)}px`);
  }
  function colorAvatar(img) {
    const tile = img.closest('.participant-tile');
    if (!tile || !img.complete || !img.naturalWidth) return;
    const source = img.currentSrc;
    let color = colors.get(source);
    if (!color) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 32;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        ctx.drawImage(
          img,
          (img.naturalWidth - side) / 2,
          (img.naturalHeight - side) / 2,
          side,
          side,
          0,
          0,
          32,
          32,
        );
        const data = ctx.getImageData(0, 0, 32, 32).data,
          buckets = new Map();
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 128) continue;
          const key = (data[i] >> 5) * 64 + (data[i + 1] >> 5) * 8 + (data[i + 2] >> 5),
            bucket = buckets.get(key) || [0, 0, 0, 0];
          bucket[0]++;
          for (let c = 0; c < 3; c++) bucket[c + 1] += data[i + c];
          buckets.set(key, bucket);
        }
        const top = [...buckets.values()].sort((a, b) => b[0] - a[0])[0];
        if (!top) return;
        color = top.slice(1).map((c) => Math.round(c / top[0]));
        colors.set(source, color);
      } catch {
        return;
      }
    }
    tile.style.setProperty('--participant-color', `rgb(${color.join(',')})`);
    const linear = color
        .map((c) => c / 255)
        .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)),
      lum = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    tile.style.setProperty(
      '--participant-label',
      (lum + 0.05) / 0.05 > 1.05 / (lum + 0.05) ? '#000' : '#fff',
    );
  }
  function installGrids() {
    for (const [grid, observer] of observedGrids)
      if (!grid.isConnected) {
        observer.disconnect();
        observedGrids.delete(grid);
      }
    document.querySelectorAll('[data-media-stage-grid]').forEach((grid) => {
      if (!observedGrids.has(grid)) {
        const observer = new ResizeObserver(() => layoutGrid(grid));
        observer.observe(grid);
        observedGrids.set(grid, observer);
      }
      layoutGrid(grid);
      grid.querySelectorAll('img').forEach(colorAvatar);
    });
  }
  function installChat() {
    document.querySelectorAll('.direct-call-workspace').forEach((workspace) => {
      if (workspace.querySelector('.call-chat-toggle')) return;
      const chat = workspace.querySelector('.direct-call-chat'),
        stage = workspace.querySelector('.direct-call-stage');
      if (!chat || !stage) return;
      const title = document.createElement('div');
      title.className = 'call-chat-heading';
      title.textContent = 'Chat';
      chat.prepend(title);
      const toggle = button('Hide chat', 'chevron');
      toggle.className = 'call-chat-toggle';
      toggle.textContent = '›';
      toggle.setAttribute('aria-expanded', 'true');
      toggle.onclick = () => {
        chat.hidden = !chat.hidden;
        workspace.classList.toggle('chat-collapsed', chat.hidden);
        toggle.textContent = chat.hidden ? '‹' : '›';
        toggle.setAttribute('aria-expanded', String(!chat.hidden));
        toggle.setAttribute('aria-label', chat.hidden ? 'Show chat' : 'Hide chat');
      };
      stage.append(toggle);
    });
  }
  function install() {
    document.querySelectorAll('.message').forEach((row) => {
      const images = [...row.querySelectorAll(':scope > .message-image-button')];
      if (images.length > 1) {
        const grid = document.createElement('div');
        grid.className = 'message-image-grid';
        images[0].before(grid);
        grid.append(...images);
      }
      row.querySelectorAll('.message-image-grid:empty').forEach((grid) => grid.remove());
    });
    document.querySelectorAll('[data-call-event]').forEach((row) => {
      try {
        renderCallEvent(JSON.parse(row.dataset.callEvent));
      } catch {
        delete row.dataset.callEvent;
      }
    });
    document.querySelectorAll('audio').forEach((audio) => {
      audio.muted = deafened;
    });
    installMemberPanels();
    installGrids();
    installChat();
    document.querySelectorAll('.header-search input').forEach((input) => {
      if (input.placeholder === 'Search')
        input.placeholder = `Search ${document.querySelector('.community-header')?.textContent.trim() || 'Messages'}`;
    });
  }
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      install();
    });
  }
  function renderCallEvent(message) {
    const call = message.call_event;
    if (!call || message.channel_id !== document.body.dataset.channelId) return;
    const caller = call.caller_id === document.body.dataset.memberId,
      other =
        document.querySelector('.dm-profile-card h2')?.textContent.trim() ||
        document.querySelector('.content-header h1')?.textContent.trim() ||
        'Member';
    let label;
    switch (call.state) {
      case 'ringing':
        label = caller ? `You called ${other}` : `Incoming call from ${other}`;
        break;
      case 'accepted':
        label = caller ? `${other} accepted the call` : 'You accepted the call';
        break;
      case 'missed':
        label = caller ? `No answer from ${other}` : `Missed call from ${other}`;
        break;
      case 'declined':
        label = caller ? `${other} declined the call` : 'You declined the call';
        break;
      default:
        label = call.accepted_at ? 'Call finished' : 'Call cancelled';
        if (call.accepted_at && call.finished_at) {
          const seconds = Math.max(
            0,
            Math.floor((Date.parse(call.finished_at) - Date.parse(call.accepted_at)) / 1000),
          );
          if (Number.isFinite(seconds)) label += ` · ${Math.floor(seconds / 60)}m ${seconds % 60}s`;
        }
    }
    let row = document.getElementById(`message-${message.id}`);
    if (!row) {
      row = document.createElement('article');
      row.id = `message-${message.id}`;
      document.getElementById('messages')?.append(row);
    }
    row.className = 'message call-history-event';
    row.dataset.sequence = message.sequence;
    row.dataset.tone = call.state;
    delete row.dataset.callEvent;
    const time = document.createElement('time');
    time.dateTime = message.created_at;
    time.textContent = new Date(message.created_at).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
    const divider = document.createElement('div'),
      text = document.createElement('span');
    divider.className = 'call-history-divider';
    text.className = 'call-history-label';
    const icon = document.createElement('span');
    window.allchatSetIcon?.(icon, 'phone');
    text.append(icon, label);
    divider.append(text);
    row.replaceChildren(time, divider);
  }

  let closeEditor;
  function editMessage(trigger) {
    closeEditor?.();
    const row = trigger.closest('.message'),
      body = row?.querySelector('.body');
    if (!body) return;
    const form = document.createElement('form'),
      input = document.createElement('textarea'),
      actions = document.createElement('div'),
      status = document.createElement('span');
    form.className = 'inline-message-editor';
    input.setAttribute('aria-label', 'Edit message');
    input.value = trigger.dataset.messageBody || body.textContent;
    actions.className = 'inline-edit-actions';
    actions.append(
      'escape to ',
      button('Cancel editing', '', () => close()),
      ' · enter to ',
    );
    const save = document.createElement('button');
    save.type = 'submit';
    save.textContent = 'Save';
    actions.append(save, status);
    status.role = 'status';
    form.append(input, actions);
    body.hidden = true;
    body.after(form);
    const cancel = actions.querySelector('button');
    cancel.textContent = 'Cancel';
    let busy = false;
    function close() {
      if (busy) return;
      body.hidden = false;
      form.remove();
      closeEditor = null;
      trigger.focus();
    }
    closeEditor = close;
    input.onkeydown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        form.requestSubmit();
      }
    };
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (busy) return;
      busy = true;
      save.disabled = true;
      status.textContent = 'Saving…';
      try {
        const csrf = document.querySelector('#composer [name="csrf_token"]')?.value || '';
        const response = await fetch(
          `/api/v1/messages/${encodeURIComponent(trigger.dataset.messageId)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
            body: JSON.stringify({ body: input.value }),
          },
        );
        if (!response.ok) throw new Error('Could not save. Try again.');
        const message = await response.json();
        window.renderAllChatMessage?.(message, 'message.edited');
        trigger.dataset.messageBody = input.value;
        busy = false;
        close();
      } catch (error) {
        status.textContent = error.message;
      } finally {
        busy = false;
        save.disabled = false;
      }
    };
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
  async function pngBlob(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Image unavailable.');
    const blob = await response.blob();
    if (blob.type === 'image/png') return blob;
    const bitmap = await createImageBitmap(blob),
      canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close();
    return new Promise((resolve, reject) =>
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error('Could not copy image.'))),
        'image/png',
      ),
    );
  }
  document.addEventListener('contextmenu', (event) => {
    const preview = event.target.closest?.('.message-image-button'),
      expanded = event.target.closest?.('.message-image-dialog img');
    if (!preview && !expanded) return;
    event.preventDefault();
    document.querySelector('.image-context-menu')?.remove();
    const source = preview || expanded,
      url = preview?.dataset.originalSrc || expanded.src,
      name = source.dataset.imageName || preview?.querySelector('img')?.alt || 'image',
      size = Number(source.dataset.imageSize || 0);
    const menu = document.createElement('div');
    menu.className = 'image-context-menu';
    menu.role = 'menu';
    menu.setAttribute('aria-label', 'Image actions');
    const heading = document.createElement('header'),
      title = document.createElement('strong'),
      metadata = document.createElement('small');
    title.textContent = name;
    metadata.textContent = size ? `${(size / 1024).toFixed(1)} KB` : '';
    heading.append(title, metadata);
    menu.append(heading);
    for (const action of ['Copy image', 'Download']) {
      const item = document.createElement('button');
      item.type = 'button';
      item.role = 'menuitem';
      item.textContent = action;
      item.onclick = async () => {
        try {
          if (action === 'Copy image') {
            if (!navigator.clipboard?.write || !window.ClipboardItem)
              throw new Error('Copy unavailable in this browser.');
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob(url) })]);
          } else {
            const response = await fetch(url);
            if (!response.ok) throw new Error('Download failed.');
            const blob = URL.createObjectURL(await response.blob()),
              link = document.createElement('a');
            link.href = blob;
            link.download = name;
            link.click();
            setTimeout(() => URL.revokeObjectURL(blob), 1000);
          }
          menu.remove();
        } catch (error) {
          metadata.textContent = error.message;
          metadata.role = 'alert';
        }
      };
      menu.append(item);
    }
    (expanded?.closest('dialog') || document.body).append(menu);
    menu.style.left = `${Math.max(8, Math.min(innerWidth - menu.offsetWidth - 8, event.clientX))}px`;
    menu.style.top = `${Math.max(8, Math.min(innerHeight - menu.offsetHeight - 8, event.clientY))}px`;
    dismissible(menu);
    menu.querySelector('button').focus();
  });

  window.AllChatDesign = {
    renderCallEvent,
    applyMute: () => mediaAdapter()?.mute(muted),
    editMessage,
    connectionPanel,
    button,
    place,
    dismissible,
    layoutGrid,
    openActivities,
  };
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  document.addEventListener(
    'load',
    (event) => {
      if (event.target.matches?.('.participant-tile img')) colorAvatar(event.target);
    },
    true,
  );
  document.addEventListener('allchat:view-swapped', schedule);
  install();
})();
