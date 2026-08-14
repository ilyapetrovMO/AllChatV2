(() => {
  "use strict";
  const install = (scope = document) => {
  const root = scope.querySelector?.("[data-admin-dashboard]") || (scope.matches?.("[data-admin-dashboard]") ? scope : null);
  if (!root || root.dataset.dashboardReady) return;
  root.dataset.dashboardReady = "true";
  const resourceHistory = []; let previous;
  const formatBytes = value => {
    const units = ["B", "KiB", "MiB", "GiB", "TiB"];
    let size = Number(value || 0), index = 0;
    while (size >= 1024 && index < units.length - 1) { size /= 1024; index++; }
    return `${size.toFixed(index ? 1 : 0)} ${units[index]}`;
  };
  const formatDuration = seconds => {
    const value = Math.max(0, Number(seconds || 0));
    const days = Math.floor(value / 86400), hours = Math.floor(value % 86400 / 3600), minutes = Math.floor(value % 3600 / 60);
    return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
  };
  const stat = (label, value, detail = "") => `<article class="card dashboard-stat"><span>${label}</span><strong>${value}</strong>${detail ? `<small>${detail}</small>` : ""}</article>`;
  const lineChart = (series, {formatter = String, suffix = ""} = {}) => {
    const width = 620, height = 190, pad = 28, values = series.flatMap(item => item.values).filter(Number.isFinite), maximum = Math.max(1, ...values);
    const x = index => pad + index * (width - pad * 2) / Math.max(1, series[0]?.values.length - 1);
    const y = value => height - pad - value / maximum * (height - pad * 2);
    const colors = ["#6d75e8", "#35b978", "#d9a441"];
    const lines = series.map((item, seriesIndex) => `<polyline fill="none" stroke="${colors[seriesIndex]}" stroke-width="2.5" vector-effect="non-scaling-stroke" points="${item.values.map((value, index) => `${x(index)},${y(value)}`).join(" ")}"/>`).join("");
    const legend = series.map((item, index) => `<span style="--chart-color:${colors[index]}">${item.label}: <strong>${formatter(item.values.at(-1) || 0)}${suffix}</strong></span>`).join("");
    return `<div class="dashboard-chart-legend">${legend}</div><svg class="dashboard-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${series.map(item => item.label).join(" and ")} history"><line x1="${pad}" y1="${height-pad}" x2="${width-pad}" y2="${height-pad}"/><line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height-pad}"/><text x="${pad+4}" y="${pad+4}">${formatter(maximum)}${suffix}</text><text x="${pad+4}" y="${height-pad-5}">0</text>${lines}</svg>`;
  };
  const render = value => {
    const resources = value.resources, counts = value.counts;
    let cpu = 0;
    if (previous) {
      const elapsed = (new Date(value.checked_at) - new Date(previous.checked_at)) / 1000;
      if (elapsed > 0) cpu = Math.min(100, Math.max(0, (resources.cpu_seconds - previous.resources.cpu_seconds) / elapsed / Math.max(1, resources.cpu_cores) * 100));
    }
    previous = value;
    resourceHistory.push({cpu, memory: resources.memory_bytes, disk: resources.app_storage_bytes});
    if (resourceHistory.length > 60) resourceHistory.shift();
    root.querySelector("[data-dashboard-stats]").innerHTML = [
      stat("Members", counts.members.toLocaleString(), `${counts.online_members} online`),
      stat("Messages", counts.messages.toLocaleString(), `${value.message_rate.messages_per_minute} in the last minute`),
      stat("Attachments", counts.attachments.toLocaleString()),
      stat("Process memory", formatBytes(resources.memory_bytes), `${formatBytes(resources.heap_bytes)} active heap`),
      stat("CPU", `${cpu.toFixed(1)}%`, `${resources.cpu_cores} logical cores`),
      stat("App storage", formatBytes(resources.app_storage_bytes), `${formatBytes(resources.disk_available_bytes)} disk available`),
      stat("Uptime", formatDuration(value.uptime_seconds)),
      stat("Relay", value.health.relay, `SFU ${value.health.sfu}`),
    ].join("");
    root.querySelector("[data-resource-chart]").innerHTML = `<div class="dashboard-resource-chart">${lineChart([
      {label: "CPU", values: resourceHistory.map(item => item.cpu)},
    ], {formatter: number => Number(number).toFixed(1), suffix: "%"})}</div><div class="dashboard-resource-chart">${lineChart([
      {label: "Memory", values: resourceHistory.map(item => item.memory / 1048576)},
      {label: "App storage", values: resourceHistory.map(item => item.disk / 1048576)},
    ], {formatter: number => Number(number).toFixed(1), suffix: " MiB"})}</div>`;
    root.querySelector("[data-message-chart]").innerHTML = lineChart([{label: "Messages/min", values: value.message_rate.buckets.map(item => item.count)}], {formatter: number => Math.round(number)});
    const maximumSource = Math.max(1, ...value.storage_sources.map(item => item.bytes));
    root.querySelector("[data-dashboard-storage]").innerHTML = value.storage_sources.map(item => `<div class="dashboard-storage-row"><span>${item.name}</span><div><i style="width:${item.bytes/maximumSource*100}%"></i></div><strong>${formatBytes(item.bytes)}</strong></div>`).join("");
    root.querySelector("[data-dashboard-health]").innerHTML = Object.entries(value.health).map(([name, status]) => `<div><span class="dashboard-health-dot ${status === "ready" || status === "embedded" || status === "external" ? "ready" : status}"></span><strong>${name.replaceAll("_", " ")}</strong><span>${status}</span></div>`).join("");
    root.querySelector("[data-dashboard-updated]").textContent = `Updated ${new Date(value.checked_at).toLocaleTimeString()}`;
    root.querySelector("[data-dashboard-error]").hidden = true;
  };
  const refresh = async () => {
    try {
      const response = await fetch("/api/v1/admin/dashboard");
      if (!response.ok) throw new Error(`Dashboard request failed (${response.status})`);
      render(await response.json());
    } catch (error) {
      const notice = root.querySelector("[data-dashboard-error]");
      notice.textContent = error.message; notice.hidden = false;
    }
  };
  refresh();
  const timer = setInterval(refresh, 5000);
  const stop = event => { if (!event.detail?.root || event.detail.root.contains(root)) clearInterval(timer); };
  document.addEventListener("allchat:before-conversation-swap", stop, {once: true});
  document.addEventListener("allchat:before-overlay-close", stop, {once: true});
  };
  window.installAllChatAdminDashboard = install;
  install(document);
})();
