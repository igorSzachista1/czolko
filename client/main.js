import { io } from "socket.io-client";

const socket = io("https://czolko-0stu.onrender.com", {
  transports: ["websocket"],
});


let localStream = null;
let currentRoomId = null;
let myId = null;
let myPlayerToken = null;
let currentGameData = null; // store current round data

// Fancy animations on load
window.addEventListener('load', () => {
  createParticles();
  animateCamerasOnGameStart();
});

// Create floating particles
function createParticles() {
  const particlesContainer = document.getElementById('particles');
  for (let i = 0; i < 50; i++) {
    const particle = document.createElement('div');
    particle.className = 'particle';
    particle.style.left = Math.random() * 100 + '%';
    particle.style.width = Math.random() * 5 + 2 + 'px';
    particle.style.height = particle.style.width;
    particle.style.animationDelay = Math.random() * 6 + 's';
    particle.style.animationDuration = (Math.random() * 4 + 6) + 's';
    particlesContainer.appendChild(particle);
  }
}

// Animate cameras with stagger
function animateCamerasOnGameStart() {
  // This will be called when game starts, but for now, just prepare
  // In renderPlayers, add class scale-in with delay
}

// Przykładowa lista graczy (w praktyce podpinamy socket)
const playerListEl = document.getElementById('player-list');
const adminEl = document.getElementById('admin');

let lobbyPlayers = [];

// Aktualizacja lobby
function updateLobby() {
  playerListEl.innerHTML = '';
  const me = lobbyPlayers.find(p => p.id === myId);
  lobbyPlayers.forEach((player, index) => {
    const li = document.createElement('li');
    li.textContent = player.nick;
    if(player.isHost) li.classList.add('host');
    li.classList.add('new-player');
    li.style.animationDelay = (index * 0.1) + 's';

    // Admin controls for host
    if (me?.isHost && player.id !== myId) {
      const kickBtn = document.createElement('button');
      kickBtn.textContent = 'Wyrzuć';
      kickBtn.style.background = '#ff4444';
      kickBtn.onclick = () => kickPlayer(player.id);
      li.appendChild(kickBtn);
    }

    playerListEl.appendChild(li);
  });

  // Start gry tylko dla hosta
  if(me?.isHost) {
    adminEl.innerHTML = `<button onclick="startGame()">▶️ Start gry</button>`;
  } else {
    adminEl.innerHTML = '';
  }
}

// Kick player (host only)
function kickPlayer(playerId) {
  socket.emit('kick-player', { roomId: currentRoomId, playerId });
}

// Give hint (host only)
function giveHint() {
  socket.emit('give-hint', { roomId: currentRoomId });
}

// (players-update handled below with UI updates)



// Przechowuj połączenia: peerId -> { pc, stream }
const connections = new Map();

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:19302" },
    {
      urls: "turn:turn.anyfirewall.com:443?transport=tcp",
      username: "webrtc",
      credential: "webrtc"
    },
    {
      urls: "turn:relay.backups.cz",
      username: "webrtc",
      credential: "webrtc"
    }
  ]
};

// ======================
// INICJALIZACJA KAMERY
// ======================
async function initCamera() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ 
      video: true, 
      audio: true 
    });
    console.log("✅ Kamera OK");
    return true;
  } catch (err) {
    console.error("❌ Błąd kamery:", err);
    alert("Brak dostępu do kamery/mikrofonu!");
    return false;
  }
}

// Inicjalizuj kamerę od razu
initCamera();

// ======================
// LOBBY
// ======================
// UI handlers called from HTML
function createRoom() {
  const nickEl = document.getElementById('nick');
  const nickVal = (nickEl && nickEl.value) ? nickEl.value.trim() : 'Player';
  socket.emit("create-room", {
    nick: nickVal,
    maxPlayers: 6
  });
}

function joinRoom() {
  const nickEl = document.getElementById('nick');
  const roomIdEl = document.getElementById('roomIdInput');
  const nickVal = (nickEl && nickEl.value) ? nickEl.value.trim() : 'Player';
  const roomIdVal = roomIdEl && roomIdEl.value ? roomIdEl.value.trim().toUpperCase() : null;
  if (!roomIdVal) {
    alert('Wpisz kod pokoju');
    return;
  }

  currentRoomId = roomIdVal;
  socket.emit("join-room", {
    roomId: roomIdVal,
    nick: nickVal
  });

  // show lobby (server will emit players-update)
  const lobby = document.getElementById('lobby');
  const joinSection = document.getElementById('join-section');
  if (lobby && joinSection) {
    joinSection.classList.add('hidden');
    lobby.classList.remove('hidden');
    document.getElementById('roomCode').innerText = roomIdVal;
  }
}

socket.on("room-created", id => {
  // server returns { roomId, playerToken }
  const roomId = typeof id === 'object' ? id.roomId : id;
  const token = typeof id === 'object' ? id.playerToken : null;
  currentRoomId = roomId;
  myId = socket.id;
  if (token) {
    myPlayerToken = token;
    localStorage.setItem('cz_roomId', roomId);
    localStorage.setItem('cz_playerToken', token);
    const nickEl = document.getElementById('nick');
    if (nickEl) localStorage.setItem('cz_nick', nickEl.value || 'Player');
  }

  const lobby = document.getElementById('lobby');
  const joinSection = document.getElementById('join-section');
  if (lobby && joinSection) {
    joinSection.classList.add('hidden');
    lobby.classList.remove('hidden');
    document.getElementById('roomCode').innerText = roomId;
  }
  alert("Kod pokoju: " + roomId);
});

socket.on('joined', ({ roomId, playerToken }) => {
  currentRoomId = roomId;
  myPlayerToken = playerToken;
  myId = socket.id;
  localStorage.setItem('cz_roomId', roomId);
  localStorage.setItem('cz_playerToken', playerToken);
  const nickEl = document.getElementById('nick');
  if (nickEl) localStorage.setItem('cz_nick', nickEl.value || 'Player');

  const lobby = document.getElementById('lobby');
  const joinSection = document.getElementById('join-section');
  if (lobby && joinSection) {
    joinSection.classList.add('hidden');
    lobby.classList.remove('hidden');
    document.getElementById('roomCode').innerText = roomId;
  }
});

// Update lobby players list and admin controls
socket.on("players-update", players => {
  myId = socket.id;
  lobbyPlayers = players;
  updateLobby();
  const me = players.find(p => p.id === myId);
  console.log("Me:", me);
  document.getElementById("admin").innerHTML = me?.isHost
    ? `<button onclick="startGame()">▶️ Start gry</button>`
    : "";

  // Update word input based on my ready status
  const wordInput = document.getElementById('wordInput');
  const wordBtn = document.getElementById('wordInput')?.nextElementSibling;
  if (me?.ready) {
    if (wordInput) wordInput.disabled = true;
    if (wordBtn && wordBtn.tagName === 'BUTTON') wordBtn.disabled = true;
  } else {
    if (wordInput) {
      wordInput.disabled = false;
      wordInput.value = ''; // clear
    }
    if (wordBtn && wordBtn.tagName === 'BUTTON') wordBtn.disabled = false;
  }
});

// Attempt reconnect if we have saved token
async function attemptReconnect() {
  const savedRoom = localStorage.getItem('cz_roomId');
  const savedToken = localStorage.getItem('cz_playerToken');
  const savedNick = localStorage.getItem('cz_nick');
  if (savedRoom && savedToken) {
    currentRoomId = savedRoom;
    // show lobby while reconnecting
    const lobby = document.getElementById('lobby');
    const joinSection = document.getElementById('join-section');
    if (lobby && joinSection) {
      joinSection.classList.add('hidden');
      lobby.classList.remove('hidden');
      document.getElementById('roomCode').innerText = savedRoom;
    }

    // ensure camera is initialized before reconnecting
    if (!localStream) {
      await initCamera();
    }

    socket.emit('reconnect-room', { roomId: savedRoom, playerToken: savedToken, nick: savedNick });
  }
}

socket.on('connect', () => {
  myId = socket.id;
  attemptReconnect();
});

// handle server errors (e.g. invalid token on reconnect)
socket.on('error', msg => {
  try {
    if (typeof msg === 'string' && msg.includes('token')) {
      // clear saved session if token invalid
      localStorage.removeItem('cz_roomId');
      localStorage.removeItem('cz_playerToken');
      localStorage.removeItem('cz_nick');
    }
  } catch (e) {}
  console.warn('Server error:', msg);
  alert('Błąd: ' + (typeof msg === 'string' ? msg : JSON.stringify(msg)));
});

socket.on('kicked', () => {
  alert('Zostałeś wyrzucony z pokoju!');
  leaveLobby();
});

socket.on('hint-update', hints => {
  hints.forEach(h => {
    if (h.id === myId) {
      document.getElementById('myWordHint').innerText = h.hint;
    }
  });
});

// Submit word from lobby
function submitWord() {
  const input = document.getElementById('wordInput');
  if (!input) return;
  const val = input.value.trim();
  if (!val) {
    alert('Wpisz hasło');
    return;
  }
  socket.emit('submit-word', { roomId: currentRoomId, word: val });
  // disable input to prevent changes
  input.disabled = true;
  const btn = input.nextElementSibling;
  if (btn && btn.tagName === 'BUTTON') btn.disabled = true;
}

function submitGuess() {
  const guessInput = document.getElementById('guessInput');
  if (!guessInput) return;
  const guess = guessInput.value.trim().toUpperCase();
  if (!guess) {
    alert('Wpisz hasło');
    return;
  }

  if (!currentGameData) {
    alert('Brak danych gry');
    return;
  }

  const myPlayer = currentGameData.players.find(p => p.id === myId);
  if (!myPlayer) {
    alert('Nie znaleziono gracza');
    return;
  }

  if (myPlayer.guessed) {
    alert('Już zgadłeś swoje hasło!');
    return;
  }

  if (guess === myPlayer.assignedWord) {
    socket.emit('guess-correct', { roomId: currentRoomId });
  } else {
    alert('Złe hasło! Spróbuj ponownie.');
  }
}

// Close and clean up peer connections
function cleanupConnections(stopLocal = false) {
  for (const [peerId, conn] of connections.entries()) {
    try {
      conn.pc.close();
    } catch (e) {}
  }
  connections.clear();

  if (stopLocal && localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
}

// Leave lobby UI + notify server
function leaveLobby() {
  if (currentRoomId) socket.emit('leave-room', { roomId: currentRoomId });

  // UI reset
  const lobby = document.getElementById('lobby');
  const joinSection = document.getElementById('join-section');
  if (lobby) lobby.classList.add('hidden');
  if (joinSection) joinSection.classList.remove('hidden');
  document.getElementById('roomCode').innerText = '----';

  // reset input
  const input = document.getElementById('wordInput');
  if (input) { input.disabled = false; input.value = ''; const btn = input.nextElementSibling; if (btn && btn.tagName === 'BUTTON') btn.disabled = false; }

  currentRoomId = null;
  lobbyPlayers = [];
  updateLobby();

  // Close connections but keep camera active
  cleanupConnections(false);
  // remove saved session
  localStorage.removeItem('cz_roomId');
  localStorage.removeItem('cz_playerToken');
  localStorage.removeItem('cz_nick');
}

// Leave the active game and return to join screen
function leaveGame() {
  if (currentRoomId) socket.emit('leave-room', { roomId: currentRoomId });

  const gameSection = document.getElementById('game-section');
  const joinSection = document.getElementById('join-section');
  if (gameSection) gameSection.classList.add('hidden');
  if (joinSection) joinSection.classList.remove('hidden');

  // reset camera grid
  const grid = document.getElementById('camera-grid');
  if (grid) grid.innerHTML = '';

  // stop camera and close connections
  cleanupConnections(true);

  currentRoomId = null;
  lobbyPlayers = [];
  updateLobby();
  currentGameData = null;
  // remove saved session
  localStorage.removeItem('cz_roomId');
  localStorage.removeItem('cz_playerToken');
  localStorage.removeItem('cz_nick');
}

function startGame() {
  socket.emit("start-game", currentRoomId);
}

// ======================
// RENDER GRACZY
// ======================
socket.on("round-start", async data => {
  console.log("🎮 Runda rozpoczęta");

  // Ensure camera is initialized
  if (!localStream) {
    await initCamera();
  }

  // Ukryj lobby, pokaż sekcję gry
  const lobby = document.getElementById('lobby');
  const gameSection = document.getElementById('game-section');
  if (lobby) lobby.classList.add('hidden');
  if (gameSection) gameSection.classList.remove('hidden');

  // Pokaż grid kamer
  const cameraGrid = document.getElementById('camera-grid');
  if (cameraGrid) cameraGrid.classList.remove('hidden');

  currentGameData = data; // store for guessing

  await renderPlayers(data.players);

  // Show hint for my word (first letter)
  const myPlayer = data.players.find(p => p.id === myId);
  if (myPlayer) {
    document.getElementById('myWordHint').innerText = myPlayer.assignedWord.charAt(0).toUpperCase() + '...';
    // If already guessed, disable input
    if (myPlayer.guessed) {
      const guessInput = document.getElementById('guessInput');
      const guessBtn = document.getElementById('guessBtn');
      if (guessInput) guessInput.disabled = true;
      if (guessBtn) guessBtn.disabled = true;
    }
  }

  // Host controls
  const me = data.players.find(p => p.id === myId);
  const hostControls = document.getElementById('host-controls');
  if (me?.isHost && hostControls) {
    hostControls.innerHTML = `<button onclick="giveHint()">💡 Daj podpowiedź</button>`;
  } else if (hostControls) {
    hostControls.innerHTML = '';
  }
});


async function renderPlayers(players) {
  const grid = document.getElementById("camera-grid");
  grid.innerHTML = "";

  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    const index = i;
    const wrapper = document.createElement("div");
    wrapper.className = "video scale-in";
    wrapper.id = `player-${player.id}`;
    wrapper.style.animationDelay = (index * 0.1) + 's'; // stagger

    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    video.id = `video-${player.id}`;

    const nick = document.createElement("div");
    nick.className = "player-nick";
    nick.innerText = player.nick;

    wrapper.appendChild(video);

    // Show assigned word for OTHER players only; hide your own assigned word
    if (player.id !== myId && player.assignedWord) {
      const word = document.createElement("div");
      word.className = "word";
      word.innerText = player.assignedWord;
      wrapper.appendChild(word);
    }

    wrapper.appendChild(nick);
    grid.appendChild(wrapper);

    // Create connection if not exists
    if (player.id !== myId && !connections.has(player.id)) {
      const me = players.find(p => p.id === myId);
      const caller = me.isHost;
      await createConnection(player.id, caller);
    }

    // Przypisz strumienie
    if (player.id === myId) {
      video.srcObject = localStream;
      video.muted = true;
      console.log("📹 Moja kamera przypisana");
    } else {
      const conn = connections.get(player.id);
      if (conn && conn.stream) {
        video.srcObject = conn.stream;
        console.log("📹 Strumień od", player.nick, "przypisany");
      } else {
        console.log("⏳ Czekam na strumień od", player.nick);
      }
    }
  }
}

// ======================
// WEBRTC - NOWE POŁĄCZENIE
// ======================

// Gdy dołączamy do pokoju - dostajemy listę istniejących graczy
socket.on("existing-players", async playerIds => {
  console.log("📋 Istniejący gracze:", playerIds);
  
  if (!localStream) {
    await initCamera();
  }
  
  // Połącz się z każdym jako CALLER
  for (const playerId of playerIds) {
    await createConnection(playerId, true);
  }
});

// Gdy ktoś nowy dołącza - czekamy na jego offer
socket.on("user-joined", async userId => {
  console.log("🔔 Nowy gracz:", userId);
  // Nie robimy nic - czekamy aż on wyśle offer
});

// Gdy ktoś wychodzi
socket.on("user-left", userId => {
  console.log("👋 Gracz wyszedł:", userId);
  const conn = connections.get(userId);
  if (conn) {
    conn.pc.close();
    connections.delete(userId);
  }
});

// ======================
// TWORZENIE POŁĄCZENIA
// ======================
async function createConnection(peerId, isCaller) {
  console.log(`🔗 Tworzę połączenie z ${peerId} (caller: ${isCaller})`);

  if (!localStream) {
    console.log("⏳ Czekam na kamerę...");
    setTimeout(() => createConnection(peerId, isCaller), 500);
    return;
  }

  if (connections.has(peerId)) {
    console.log("⚠️ Połączenie już istnieje");
    return;
  }

  const pc = new RTCPeerConnection(rtcConfig);
  const connData = { pc, stream: null };
  connections.set(peerId, connData);

  // Dodaj lokalne tracki
  localStream.getTracks().forEach(track => {
    pc.addTrack(track, localStream);
    console.log("➕ Dodano track:", track.kind);
  });

  // Odbierz zdalne tracki
  pc.ontrack = event => {
    console.log("📥 OTRZYMANO TRACK od:", peerId, event.track.kind);
    
    if (event.streams[0]) {
      connData.stream = event.streams[0];
      
      // Przypisz do video jeśli już istnieje
      const videoEl = document.getElementById(`video-${peerId}`);
      if (videoEl) {
        videoEl.srcObject = event.streams[0];
        console.log("✅ Strumień przypisany do video!");
      }
    }
  };

  // ICE candidates
  pc.onicecandidate = event => {
    if (event.candidate) {
      console.log("🧊 Wysyłam ICE candidate");
      socket.emit("webrtc-signal", {
        to: peerId,
        signal: {
          type: "ice-candidate",
          candidate: event.candidate
        }
      });
    }
  };

  // Monitoring stanu
  pc.onconnectionstatechange = () => {
    console.log(`🔗 ${peerId}: ${pc.connectionState}`);
    if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
      // Usuń strumień z video jeśli połączenie nieudane
      const videoEl = document.getElementById(`video-${peerId}`);
      if (videoEl) {
        videoEl.srcObject = null;
        console.log(`❌ Połączenie z ${peerId} nieudane, usunięto strumień`);
      }
      connData.stream = null;
      // Zamknij połączenie
      pc.close();
      connections.delete(peerId);
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log(`🧊 ${peerId}: ${pc.iceConnectionState}`);
  };

  // Jeśli jesteśmy CALLER - wyślij offer
  if (isCaller) {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      console.log("📤 Wysyłam OFFER do:", peerId);
      socket.emit("webrtc-signal", {
        to: peerId,
        signal: {
          type: "offer",
          sdp: offer
        }
      });
    } catch (err) {
      console.error("❌ Błąd tworzenia offer:", err);
    }
  }
}

// ======================
// OBSŁUGA SYGNAŁÓW
// ======================
socket.on("webrtc-signal", async ({ from, signal }) => {
  console.log("📨 Sygnał od:", from, "typ:", signal.type);

  let conn = connections.get(from);

  if (signal.type === "offer") {
    // Odbieramy offer - tworzymy połączenie jako CALLEE
    if (!conn) {
      await createConnection(from, false);
      conn = connections.get(from);
    }

    try {
      await conn.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      console.log("✅ Remote description (offer) ustawiony");

      const answer = await conn.pc.createAnswer();
      await conn.pc.setLocalDescription(answer);

      console.log("📤 Wysyłam ANSWER do:", from);
      socket.emit("webrtc-signal", {
        to: from,
        signal: {
          type: "answer",
          sdp: answer
        }
      });
    } catch (err) {
      console.error("❌ Błąd obsługi offer:", err);
    }
  }

  else if (signal.type === "answer") {
    if (!conn) {
      console.log("❌ Brak połączenia dla answer");
      return;
    }

    try {
      await conn.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      console.log("✅ Remote description (answer) ustawiony");
    } catch (err) {
      console.error("❌ Błąd obsługi answer:", err);
    }
  }

  else if (signal.type === "ice-candidate") {
    if (!conn) {
      console.log("❌ Brak połączenia dla ICE");
      return;
    }

    try {
      await conn.pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      console.log("✅ ICE candidate dodany");
    } catch (err) {
      console.error("❌ Błąd dodawania ICE:", err);
    }
  }
});

// PLAYER GUESSED
socket.on('player-guessed', ({ playerId }) => {
  if (currentGameData) {
    const player = currentGameData.players.find(p => p.id === playerId);
    if (player) {
      player.guessed = true;
      console.log(`${player.nick} zgadł hasło!`);
      // If it's me, disable guess input
      if (playerId === myId) {
        const guessInput = document.getElementById('guessInput');
        const guessBtn = document.getElementById('guessBtn');
        if (guessInput) guessInput.disabled = true;
        if (guessBtn) guessBtn.disabled = true;
        alert('Brawo! Zgadłeś swoje hasło!');
      }
    }
  }
});

// GAME END
socket.on('game-end', ({ winner }) => {
  alert(`🎉 Gra zakończona! Wszyscy zgadli swoje hasła!`);

  // Hide game section, show lobby or something
  const gameSection = document.getElementById('game-section');
  const lobby = document.getElementById('lobby');
  if (gameSection) gameSection.classList.add('hidden');
  if (lobby) lobby.classList.remove('hidden');

  // Reset
  currentGameData = null;
  const grid = document.getElementById('camera-grid');
  if (grid) grid.innerHTML = '';
  cleanupConnections(true); // stop local stream
});

// Expose functions to global scope for HTML onclick
window.createRoom = createRoom;
window.joinRoom = joinRoom;
window.submitWord = submitWord;
window.submitGuess = submitGuess;
window.startGame = startGame;
window.giveHint = giveHint;
window.leaveLobby = leaveLobby;
window.leaveGame = leaveGame;


