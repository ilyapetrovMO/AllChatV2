(() => {
  const token = location.hash.slice(1);
  const headers = {Authorization: `Activity ${token}`, "Content-Type": "application/json"};
  const grid = document.getElementById("board-grid");
  const status = document.getElementById("activity-status");
  const workspace = document.getElementById("board-workspace");
  const canvas = document.getElementById("sketch-canvas");
  const context = canvas.getContext("2d");
  const colorInput = document.getElementById("stroke-color");
  const sizeInput = document.getElementById("stroke-size");
  const textInput = document.getElementById("element-text");
  const textTool = document.querySelector(".text-tool");
  const elements = new Map();
  const order = [];
  let socket = null;
  let board = null;
  let sequence = 0;
  let localMemberID = "";
  let tool = "pen";
  let gesture = null;
  let participants = [];
  const cursorPositions = new Map();
  let cursorAnimation = 0;
  let undoStack = [];
  let redoStack = [];
  let clearTimer;
  const camera = {x: 0, y: 0, zoom: 1};

  const api = async (path, options = {}) => {
    const response = await fetch(path, {...options, headers: {...headers, ...options.headers}});
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Activity request failed");
    return response.status === 204 ? null : response.json();
  };
  const randomID = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const sendAction = (action) => {
    if (socket?.readyState !== WebSocket.OPEN) { status.textContent = "Sketchboard is not connected yet."; return false; }
    socket.send(JSON.stringify({type: "operation", kind: "stroke", payload: action}));
    return true;
  };
  const addLocal = (element, record = true) => {
    if (!elements.has(element.id)) order.push(element.id);
    elements.set(element.id, element);
    if (record) { undoStack.push(element); redoStack = []; }
    redraw();
  };
  const removeLocal = (ids) => { ids.forEach(id => elements.delete(id)); redraw(); };
  const applyOperation = (operation) => {
    if (operation.kind === "clear") { elements.clear(); order.splice(0); undoStack = []; redoStack = []; status.textContent = ""; redraw(); return; }
    const payload = operation.payload || {};
    if (payload.action === "add" && payload.element) addLocal(payload.element, false);
    else if (payload.action === "remove" && Array.isArray(payload.ids)) removeLocal(payload.ids);
    else if (Array.isArray(payload.points)) addLocal({id: `legacy-${operation.sequence}`, type: "path", points: payload.points, color: payload.color || "#111", size: payload.size || 4, opacity: 1}, false);
  };

  function drawGrid(target) {
    target.save(); target.strokeStyle = "#e8e9ec"; target.lineWidth = 1 / camera.zoom;
    for (let x = -camera.x % 40; x < canvas.width / camera.zoom; x += 40) { target.beginPath(); target.moveTo(x, -camera.y); target.lineTo(x, canvas.height / camera.zoom - camera.y); target.stroke(); }
    for (let y = -camera.y % 40; y < canvas.height / camera.zoom; y += 40) { target.beginPath(); target.moveTo(-camera.x, y); target.lineTo(canvas.width / camera.zoom - camera.x, y); target.stroke(); }
    target.restore();
  }
  function drawElement(target, element) {
    target.save(); target.globalAlpha = element.opacity ?? 1; target.strokeStyle = element.color || "#111"; target.fillStyle = element.color || "#111"; target.lineWidth = element.size || 4; target.lineCap = "round"; target.lineJoin = "round";
    if (element.type === "path" || element.type === "line") {
      const points = element.points || []; if (points.length < 2) { target.restore(); return; }
      target.beginPath(); target.moveTo(points[0][0], points[0][1]);
      for (let index = 1; index < points.length - 1; index++) { const midpoint = [(points[index][0] + points[index + 1][0]) / 2, (points[index][1] + points[index + 1][1]) / 2]; target.quadraticCurveTo(points[index][0], points[index][1], midpoint[0], midpoint[1]); }
      target.lineTo(points.at(-1)[0], points.at(-1)[1]); target.stroke();
    } else if (element.type === "rectangle") target.strokeRect(element.x, element.y, element.w, element.h);
    else if (element.type === "ellipse") { target.beginPath(); target.ellipse(element.x + element.w / 2, element.y + element.h / 2, Math.abs(element.w / 2), Math.abs(element.h / 2), 0, 0, Math.PI * 2); target.stroke(); }
    else if (element.type === "text") { target.font = `${Math.max(16, (element.size || 4) * 5)}px system-ui`; target.fillText(element.text, element.x, element.y); }
    else if (element.type === "note") { target.globalAlpha = .92; target.fillStyle = element.color || "#fee75c"; target.fillRect(element.x, element.y, 220, 140); target.globalAlpha = 1; target.fillStyle = "#202225"; target.font = "20px system-ui"; wrapText(target, element.text, element.x + 14, element.y + 30, 192, 25); }
    target.restore();
  }
  function wrapText(target, text, x, y, width, lineHeight) {
    let line = ""; for (const word of String(text).split(/\s+/)) { const next = line ? `${line} ${word}` : word; if (target.measureText(next).width > width && line) { target.fillText(line, x, y); line = word; y += lineHeight; } else line = next; } if (line) target.fillText(line, x, y);
  }
  function renderScene(target, includeCursors = true) {
    target.clearRect(0, 0, canvas.width, canvas.height); target.fillStyle = "#fff"; target.fillRect(0, 0, canvas.width, canvas.height); target.save(); target.scale(camera.zoom, camera.zoom); target.translate(camera.x, camera.y); drawGrid(target); order.forEach(id => { const element = elements.get(id); if (element) drawElement(target, element); });
    if (gesture?.element) drawElement(target, gesture.element);
    if (includeCursors) participants.forEach(person => { const cursor = cursorPositions.get(person.member_id); if (!cursor) return; const palette = ["#5865f2", "#e83e8c", "#16866f", "#d97706", "#7c3aed"]; const hash = [...person.member_id].reduce((value, character) => value + character.charCodeAt(0), 0); target.fillStyle = palette[hash % palette.length]; target.beginPath(); target.arc(cursor.x, cursor.y, 6 / camera.zoom, 0, Math.PI * 2); target.fill(); target.font = `${12 / camera.zoom}px system-ui`; target.fillText(`${person.name} · ${person.tool || "viewing"}`, cursor.x + 9 / camera.zoom, cursor.y - 8 / camera.zoom); });
    target.restore();
  }
  const redraw = () => renderScene(context);
  const animateCursors = () => { cursorAnimation = 0; let moving = false; cursorPositions.forEach(cursor => { const dx = cursor.targetX - cursor.x, dy = cursor.targetY - cursor.y; if (Math.abs(dx) + Math.abs(dy) > .2) { cursor.x += dx * .24; cursor.y += dy * .24; moving = true; } else { cursor.x = cursor.targetX; cursor.y = cursor.targetY; } }); redraw(); if (moving) cursorAnimation = requestAnimationFrame(animateCursors); };
  const updateCursors = items => { const active = new Set(); items.forEach(person => { if (person.member_id === localMemberID || person.cursor_x == null || person.cursor_y == null) return; active.add(person.member_id); const cursor = cursorPositions.get(person.member_id); if (cursor) { cursor.targetX = person.cursor_x; cursor.targetY = person.cursor_y; } else cursorPositions.set(person.member_id, {x: person.cursor_x, y: person.cursor_y, targetX: person.cursor_x, targetY: person.cursor_y}); }); cursorPositions.forEach((_, id) => { if (!active.has(id)) cursorPositions.delete(id); }); if (!cursorAnimation) cursorAnimation = requestAnimationFrame(animateCursors); };
  const point = (event) => { const rect = canvas.getBoundingClientRect(); return [(event.clientX - rect.left) * canvas.width / rect.width / camera.zoom - camera.x, (event.clientY - rect.top) * canvas.height / rect.height / camera.zoom - camera.y]; };
  const bounds = (start, end) => ({x: Math.min(start[0], end[0]), y: Math.min(start[1], end[1]), w: Math.abs(end[0] - start[0]), h: Math.abs(end[1] - start[1])});
  const elementAt = ([x, y]) => [...order].reverse().map(id => elements.get(id)).find(element => { if (!element) return false; if (element.type === "path" || element.type === "line") return element.points.some(point => Math.hypot(point[0] - x, point[1] - y) < Math.max(14, element.size * 2)); const w = element.type === "note" ? 220 : element.w || 0, h = element.type === "note" ? 140 : element.h || 0; return x >= element.x - 10 && x <= element.x + w + 10 && y >= element.y - 30 && y <= element.y + h + 10; });

  function begin(event) {
    event.preventDefault(); canvas.setPointerCapture(event.pointerId); const start = point(event);
    if (tool === "eraser") { const target = elementAt(start); if (target && sendAction({action: "remove", ids: [target.id]})) removeLocal([target.id]); return; }
    if (tool === "text" || tool === "note") { const text = textInput.value.trim(); if (!text) { status.textContent = "Type content before placing it."; textInput.focus(); return; } const element = {id: randomID(), type: tool, x: start[0], y: start[1], text, color: tool === "note" ? colorInput.value : colorInput.value, size: Number(sizeInput.value)}; if (sendAction({action: "add", element})) { addLocal(element); textInput.value = ""; } return; }
    if (tool === "pan" || event.button === 1 || event.altKey) { gesture = {type: "pan", start: [event.clientX, event.clientY], camera: [camera.x, camera.y]}; return; }
    const element = {id: randomID(), type: tool === "pen" || tool === "highlighter" ? "path" : tool, points: [start], color: colorInput.value, size: Number(sizeInput.value), opacity: tool === "highlighter" ? .3 : 1}; gesture = {start, element}; redraw();
  }
  function move(event) {
    const location = point(event); if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({type: "cursor", board_id: board?.id, payload: {x: location[0], y: location[1], tool}}));
    if (!gesture) return; event.preventDefault();
    if (gesture.type === "pan") { camera.x = gesture.camera[0] + (event.clientX - gesture.start[0]) / camera.zoom; camera.y = gesture.camera[1] + (event.clientY - gesture.start[1]) / camera.zoom; redraw(); return; }
    if (gesture.element.type === "path") { const previous = gesture.element.points.at(-1), distance = Math.hypot(location[0] - previous[0], location[1] - previous[1]), steps = Math.max(1, Math.ceil(distance / 8)); for (let step = 1; step <= steps; step++) gesture.element.points.push([previous[0] + (location[0] - previous[0]) * step / steps, previous[1] + (location[1] - previous[1]) * step / steps]); }
    else if (gesture.element.type === "line") gesture.element.points = [gesture.start, location];
    else Object.assign(gesture.element, bounds(gesture.start, location));
    redraw();
  }
  function end() { if (!gesture) return; if (gesture.type === "pan") { gesture = null; return; } const element = gesture.element; gesture = null; const meaningful = element.type === "path" ? element.points.length > 1 : element.type === "line" ? element.points.length === 2 : element.w > 3 && element.h > 3; if (meaningful && sendAction({action: "add", element})) addLocal(element); else redraw(); }

  const participantText = items => items.length ? items.map(item => item.name).join(", ") : "Nobody is drawing right now";
  const renderBoards = boards => { grid.replaceChildren(); for (const item of boards) { const card = document.createElement("article"); card.className = "board-card"; const title = document.createElement("h2"), owner = document.createElement("p"), people = document.createElement("div"), footer = document.createElement("footer"), enter = document.createElement("button"); title.textContent = item.name; owner.textContent = `Owned by ${item.owner_name}`; people.className = "participant-chips"; (item.participants || []).forEach(person => { const chip = document.createElement("span"); chip.textContent = person.name; people.append(chip); }); if (!people.childElementCount) { const empty = document.createElement("small"); empty.textContent = "No active participants"; people.append(empty); } enter.textContent = "Enter"; enter.onclick = () => openBoard(item); footer.append(enter); if (item.can_delete) { const remove = document.createElement("button"); remove.className = "delete-board"; remove.textContent = "Delete"; remove.onclick = async () => { if (remove.dataset.armed !== "true") { remove.dataset.armed = "true"; remove.textContent = "Confirm delete"; setTimeout(() => { if (remove.isConnected) { remove.dataset.armed = "false"; remove.textContent = "Delete"; } }, 4000); return; } remove.disabled = true; try { await api(`/api/v1/activities/sketchboard/boards/${item.id}`, {method: "DELETE"}); await loadBoards(); } catch (error) { status.textContent = error.message; remove.disabled = false; } }; footer.append(remove); } card.append(title, owner, people, footer); grid.append(card); } if (!boards.length) grid.textContent = "No sketchboards yet. Create the first one."; };
  const loadBoards = async () => { try { const value = await api("/api/v1/activities/sketchboard/boards"); renderBoards(value.boards || []); status.textContent = ""; } catch (error) { status.textContent = error.message; } };
  const openBoard = async item => { board = item; grid.hidden = true; document.querySelector(".sketchboard-heading").hidden = true; workspace.hidden = false; document.getElementById("board-title").textContent = item.name; elements.clear(); order.splice(0); undoStack = []; redoStack = []; const state = await api(`/api/v1/activities/sketchboard/boards/${item.id}`); sequence = 0; (state.operations || []).forEach(operation => { applyOperation(operation); sequence = Math.max(sequence, operation.sequence); }); redraw(); connect(); };
  const connect = () => { socket?.close(); const protocol = location.protocol === "https:" ? "wss:" : "ws:"; socket = new WebSocket(`${protocol}//${location.host}/api/v1/activities/sketchboard/realtime`); socket.onopen = () => socket.send(JSON.stringify({type: "authenticate", token, board_id: board.id, after: sequence})); socket.onmessage = event => { const frame = JSON.parse(event.data); if (frame.type === "ready") { localMemberID = frame.member_id; cursorPositions.delete(localMemberID); return; } if (frame.type === "state") (frame.operations || []).forEach(operation => { if (operation.sequence > sequence) { applyOperation(operation); sequence = operation.sequence; } }); if (frame.type !== "state" && frame.type !== "presence") return; participants = frame.participants || []; updateCursors(participants); document.getElementById("board-participants").textContent = participantText(participants); redraw(); }; socket.onclose = () => { if (board) status.textContent = "Sketchboard disconnected."; }; };

  document.querySelectorAll("[data-tool]").forEach(button => button.onclick = () => { tool = button.dataset.tool; document.querySelectorAll("[data-tool]").forEach(item => item.classList.toggle("active", item === button)); textTool.hidden = tool !== "text" && tool !== "note"; canvas.style.cursor = tool === "pan" ? "grab" : tool === "eraser" ? "cell" : "crosshair"; });
  canvas.addEventListener("pointerdown", begin); canvas.addEventListener("pointermove", move); canvas.addEventListener("pointerup", end); canvas.addEventListener("pointercancel", end);
  const syncCanvasSize = () => { const rect = canvas.getBoundingClientRect(); const width = Math.max(1, Math.round(rect.width)), height = Math.max(1, Math.round(rect.height)); if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; redraw(); } };
  new ResizeObserver(syncCanvasSize).observe(canvas); syncCanvasSize();
  const clearButton = document.getElementById("clear-board"); const resetClear = () => { clearButton.dataset.armed = "false"; clearButton.textContent = "Clear"; if (clearTimer) clearTimeout(clearTimer); clearTimer = undefined; }; clearButton.onclick = () => { if (clearButton.dataset.armed !== "true") { clearButton.dataset.armed = "true"; clearButton.textContent = "Confirm clear"; status.textContent = "Press Confirm clear to erase the board for everyone."; clearTimer = setTimeout(() => { resetClear(); status.textContent = ""; }, 4000); return; } resetClear(); if (socket?.readyState !== WebSocket.OPEN) { status.textContent = "Sketchboard is not connected yet."; return; } status.textContent = "Clearing board…"; socket.send(JSON.stringify({type: "operation", kind: "clear", payload: {}})); };
  document.getElementById("back-to-boards").onclick = () => { resetClear(); board = null; socket?.close(); workspace.hidden = true; grid.hidden = false; document.querySelector(".sketchboard-heading").hidden = false; loadBoards(); };
  const createForm = document.getElementById("create-board"), createBoard = async () => { if (!createForm.reportValidity()) return; const button = document.getElementById("create-board-button"); button.disabled = true; status.textContent = "Creating board…"; try { const name = new FormData(createForm).get("name"); await api("/api/v1/activities/sketchboard/boards", {method: "POST", body: JSON.stringify({name})}); createForm.reset(); await loadBoards(); } catch (error) { status.textContent = error.message; } finally { button.disabled = false; } }; document.getElementById("create-board-button").onclick = () => void createBoard(); createForm.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); void createBoard(); } });
  document.getElementById("undo").onclick = () => { const element = undoStack.pop(); if (!element || !sendAction({action: "remove", ids: [element.id]})) return; removeLocal([element.id]); redoStack.push(element); };
  document.getElementById("redo").onclick = () => { const element = redoStack.pop(); if (!element || !sendAction({action: "add", element})) return; addLocal(element); };
  const setZoom = value => { camera.zoom = Math.min(3, Math.max(.25, value)); document.getElementById("zoom-level").textContent = `${Math.round(camera.zoom * 100)}%`; redraw(); };
  document.getElementById("zoom-in").onclick = () => setZoom(camera.zoom * 1.25); document.getElementById("zoom-out").onclick = () => setZoom(camera.zoom / 1.25); document.getElementById("reset-view").onclick = () => { camera.x = 0; camera.y = 0; setZoom(1); };
  document.getElementById("export-board").onclick = () => { const output = document.createElement("canvas"); output.width = canvas.width; output.height = canvas.height; const target = output.getContext("2d"); const saved = {...camera}; camera.x = 0; camera.y = 0; camera.zoom = 1; renderScene(target, false); Object.assign(camera, saved); const link = document.createElement("a"); link.download = `${board?.name || "sketchboard"}.png`; link.href = output.toDataURL("image/png"); link.click(); redraw(); };
  window.addEventListener("keydown", event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); (event.shiftKey ? document.getElementById("redo") : document.getElementById("undo")).click(); } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") { event.preventDefault(); document.getElementById("redo").click(); } else if (!event.ctrlKey && !event.metaKey && !event.altKey && document.activeElement?.tagName !== "INPUT") { const shortcuts = {p: "pen", h: "highlighter", l: "line", r: "rectangle", o: "ellipse", t: "text", n: "note", e: "eraser"}; const target = shortcuts[event.key.toLowerCase()]; if (target) document.querySelector(`[data-tool="${target}"]`).click(); } });
  loadBoards();
})();
