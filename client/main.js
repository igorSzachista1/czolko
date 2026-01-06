// Socket.IO loaded from CDN

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



// ======================
// NOWA FUNKCJONALNOŚĆ KAMEREK I WEBRTC
// ======================

// Stan kamery i połączeń
let localStream = null;
let peerConnections = new Map(); // peerId -> RTCPeerConnection
let remoteStreams = new Map(); // peerId -> MediaStream

// Inicjalizacja kamery - wywołaj raz na początku
async function initializeCamera() {
  if (localStream) return true; // już zainicjalizowana

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 320, height: 240 },
      audio: true
    });
    console.log("✅ Kamera zainicjalizowana");
    return true;
  } catch (error) {
    console.error("❌ Błąd kamery:", error);
    alert("Brak dostępu do kamery/mikrofonu!");
    return false;
  }
}

// Zatrzymaj kamerę całkowicie
function stopCamera() {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
    console.log("📷 Kamera zatrzymana");
  }
}

// Utwórz połączenie WebRTC z innym graczem
async function createPeerConnection(peerId, isInitiator) {
  if (peerConnections.has(peerId)) {
    console.log(`⚠️ Połączenie z ${peerId} już istnieje`);
    return;
  }

  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "turn:turn.anyfirewall.com:443?transport=tcp", username: "webrtc", credential: "webrtc" }
    ]
  });

  peerConnections.set(peerId, pc);

  // Dodaj lokalne media do połączenia
  if (localStream) {
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });
  }

  // Obsługa przychodzących strumieni
  pc.ontrack = (event) => {
    console.log(`📥 Strumień od ${peerId}`);
    remoteStreams.set(peerId, event.streams[0]);
    assignStreamToVideo(peerId, event.streams[0]);
  };

  // Obsługa ICE kandydatów
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("webrtc-signal", {
        to: peerId,
        signal: { type: "ice-candidate", candidate: event.candidate }
      });
    }
  };

  // Obsługa zmian stanu połączenia
  pc.onconnectionstatechange = () => {
    console.log(`🔗 Stan połączenia z ${peerId}: ${pc.connectionState}`);
    if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
      closePeerConnection(peerId);
    }
  };

  // Jeśli jesteśmy inicjatorem, wyślij ofertę
  if (isInitiator) {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("webrtc-signal", {
        to: peerId,
        signal: { type: "offer", sdp: offer }
      });
      console.log(`📤 Wysłano ofertę do ${peerId}`);
    } catch (error) {
      console.error(`❌ Błąd tworzenia oferty dla ${peerId}:`, error);
    }
  }
}

// Zamknij połączenie z graczem
function closePeerConnection(peerId) {
  const pc = peerConnections.get(peerId);
  if (pc) {
    pc.close();
    peerConnections.delete(peerId);
    remoteStreams.delete(peerId);
    console.log(`🔌 Zamknięto połączenie z ${peerId}`);
  }
}

// Zamknij wszystkie połączenia
function closeAllPeerConnections() {
  for (const peerId of peerConnections.keys()) {
    closePeerConnection(peerId);
  }
}

// Obsługa sygnałów WebRTC
socket.on("webrtc-signal", async ({ from, signal }) => {
  console.log(`📨 Sygnał od ${from}: ${signal.type}`);

  let pc = peerConnections.get(from);

  if (signal.type === "offer") {
    if (!pc) {
      await createPeerConnection(from, false);
      pc = peerConnections.get(from);
    }
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("webrtc-signal", {
        to: from,
        signal: { type: "answer", sdp: answer }
      });
      console.log(`📤 Wysłano odpowiedź do ${from}`);
    } catch (error) {
      console.error(`❌ Błąd obsługi oferty od ${from}:`, error);
    }
  } else if (signal.type === "answer") {
    if (pc) {
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        console.log(`✅ Ustawiono odpowiedź od ${from}`);
      } catch (error) {
        console.error(`❌ Błąd ustawiania odpowiedzi od ${from}:`, error);
      }
    }
  } else if (signal.type === "ice-candidate") {
    if (pc) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      } catch (error) {
        console.error(`❌ Błąd dodawania ICE od ${from}:`, error);
      }
    }
  }
});

// Renderuj graczy w gridzie kamer
async function renderPlayers(players) {
  const grid = document.getElementById("camera-grid");
  grid.innerHTML = "";

  for (const player of players) {
    const wrapper = document.createElement("div");
    wrapper.className = "video scale-in";
    wrapper.id = `player-${player.id}`;

    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    video.id = `video-${player.id}`;
    video.muted = player.id === myId; // wycisz swoją kamerę

    const nick = document.createElement("div");
    nick.className = "player-nick";
    nick.innerText = player.nick;

    wrapper.appendChild(video);

    if (player.id !== myId && player.assignedWord) {
      const word = document.createElement("div");
      word.className = "word";
      word.innerText = player.assignedWord;
      wrapper.appendChild(word);
    }

    wrapper.appendChild(nick);
    grid.appendChild(wrapper);

    // Utwórz połączenie jeśli potrzebne
    if (player.id !== myId && !peerConnections.has(player.id)) {
      const isInitiator = players.find(p => p.id === myId)?.isHost || false;
      await createPeerConnection(player.id, isInitiator);
    }

    // Przypisz strumień do video
    if (player.id === myId) {
      assignStreamToVideo(player.id, localStream);
    } else {
      const stream = remoteStreams.get(player.id);
      if (stream) {
        assignStreamToVideo(player.id, stream);
      }
    }
  }
}

// Przypisz strumień do elementu video
function assignStreamToVideo(peerId, stream) {
  const videoEl = document.getElementById(`video-${peerId}`);
  if (videoEl && stream) {
    videoEl.srcObject = stream;
    console.log(`📹 Strumień przypisany do ${peerId}`);
  }
}

// ======================
// RENDER GRACZY
// ======================
socket.on("round-start", async data => {
  console.log("🎮 Runda rozpoczęta");

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

// Obsługa istniejących graczy (po dołączeniu)
socket.on("existing-players", async (playerIds) => {
  console.log("📋 Istniejący gracze:", playerIds);
  for (const peerId of playerIds) {
    await createPeerConnection(peerId, true);
  }
});

// Obsługa nowego gracza
socket.on("user-joined", async (userId) => {
  console.log("🔔 Nowy gracz:", userId);
  // Czekamy na jego ofertę
});

// Obsługa wyjścia gracza
socket.on("user-left", (userId) => {
  console.log("👋 Gracz wyszedł:", userId);
  closePeerConnection(userId);
  // Usuń z UI jeśli potrzebne
  const wrapper = document.getElementById(`player-${userId}`);
  if (wrapper) wrapper.remove();
});

// Inicjalizuj kamerę na początku
initializeCamera();

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
  closeAllPeerConnections();
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
  closeAllPeerConnections();
  stopCamera();

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
    await initializeCamera();

    socket.emit('reconnect-room', { roomId: savedRoom, playerToken: savedToken, nick: savedNick });
  }
}

socket.on('connect', () => {
  myId = socket.id;
  attemptReconnect();
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
  closeAllPeerConnections(); // close connections but keep local stream active for next game
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


