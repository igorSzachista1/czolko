import express from "express";
import http from "http";
import { Server } from "socket.io";
import { nanoid } from "nanoid";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "../client")));

const rooms = {};

io.on("connection", socket => {
  console.log("✅ Połączono:", socket.id);

  // CREATE ROOM
  socket.on("create-room", ({ nick, maxPlayers, hostToken }) => {
    const roomId = nanoid(6).toUpperCase();
    const playerToken = nanoid(8);

    rooms[roomId] = {
      id: roomId,
      hostToken,
      maxPlayers,
      players: {},
      status: "lobby", // lobby lub playing
      game: null
    };

    rooms[roomId].players[socket.id] = {
      id: socket.id,
      nick,
      isHost: true,
      hostToken,
      playerToken,
      word: null, // hasło gracza
      ready: false // czy gracz jest gotowy
    };

    socket.join(roomId);
    socket.emit("room-created", { roomId, playerToken });
    io.to(roomId).emit("players-update", Object.values(rooms[roomId].players));

    console.log("🏠 Pokój utworzony:", roomId);
  });

  // JOIN ROOM
  socket.on("join-room", ({ roomId, nick, hostToken }) => {
    const room = rooms[roomId];
    if (!room) {
      socket.emit("error", "Pokój nie istnieje");
      return;
    }
    const isHost = hostToken && hostToken === room.hostToken;
    const playerToken = nanoid(8);

    room.players[socket.id] = {
      id: socket.id,
      nick,
      isHost,
      hostToken: isHost ? hostToken : null,
      playerToken,
      word: null,
      ready: false
    };

    socket.join(roomId);

    io.to(roomId).emit("players-update", Object.values(room.players));
    socket.to(roomId).emit("user-joined", socket.id);

    const existingPlayers = Object.keys(room.players).filter(id => id !== socket.id);
    socket.emit("existing-players", existingPlayers);
    socket.emit("joined", { roomId, playerToken });

    console.log("👤 Dołączył:", nick);
  });

  // RECONNECT: klient odświeżył stronę i chce odzyskać swoje miejsce
  socket.on('reconnect-room', ({ roomId, playerToken, nick }) => {
    const room = rooms[roomId];
    if (!room) {
      socket.emit('error', 'Pokój nie istnieje');
      return;
    }

    const existing = Object.values(room.players).find(p => p.playerToken === playerToken);
    if (!existing) {
      socket.emit('error', 'Brak rekordu dla tokena');
      return;
    }

    const oldId = existing.id;
    // remove old record (old socket disconnected)
    delete room.players[oldId];
    // notify others that old socket left so they can close peers
    io.to(roomId).emit('user-left', oldId);

    // register under new socket.id
    room.players[socket.id] = {
      ...existing,
      id: socket.id,
      nick: nick || existing.nick
    };

    socket.join(roomId);

    // send updated lists
    io.to(roomId).emit('players-update', Object.values(room.players));
    socket.to(roomId).emit('user-joined', socket.id);

    const existingPlayers = Object.keys(room.players).filter(id => id !== socket.id);
    socket.emit('existing-players', existingPlayers);

    // if game in progress, update game data with new id and send to reconnected client
    if (room.status === 'playing' && room.game) {
      // update the player's id in game data
      room.game.players = room.game.players.map(p => p.id === oldId ? { ...p, id: socket.id } : p);
      // send full game data to the reconnected client
      socket.emit('round-start', room.game);
    }
  });

  // LEAVE ROOM (client left without disconnecting)
  socket.on('leave-room', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;

    if (room.players[socket.id]) {
      delete room.players[socket.id];
      socket.leave(roomId);

      io.to(roomId).emit('players-update', Object.values(room.players));
      io.to(roomId).emit('user-left', socket.id);

      if (!Object.values(room.players).some(p => p.isHost)) {
        const next = Object.values(room.players)[0];
        if (next) {
          next.isHost = true;
          room.hostToken = next.hostToken;
          io.to(roomId).emit('players-update', Object.values(room.players));
        }
      }
    }
  });

  // ⭐ NOWE: SUBMIT WORD - gracz wpisuje hasło
  socket.on("submit-word", ({ roomId, word }) => {
    const room = rooms[roomId];
    if (!room || !room.players[socket.id]) return;

    const trimmedWord = word.trim().toUpperCase();
    if (!trimmedWord) {
      socket.emit('error', 'Wpisz hasło');
      return;
    }

    // Sprawdź czy hasło już istnieje w pokoju
    const existingWords = Object.values(room.players).map(p => p.word).filter(w => w);
    if (existingWords.includes(trimmedWord)) {
      socket.emit('error', 'Hasło już istnieje, wybierz inne');
      return;
    }

    room.players[socket.id].word = trimmedWord;
    room.players[socket.id].ready = true;

    console.log("📝", room.players[socket.id].nick, "wpisał hasło:", trimmedWord);

    // Wyślij aktualizację do wszystkich
    io.to(roomId).emit("players-update", Object.values(room.players));
  });

  // START GAME
  socket.on("start-game", roomId => {
    const room = rooms[roomId];
    if (!room) return;

    const players = Object.values(room.players);
    
    console.log("Players in room:", players.map(p => ({id: p.id, nick: p.nick, word: p.word, ready: p.ready})));
    
    // Sprawdź czy wszyscy mają hasła
    const allReady = players.every(p => p.word);
    console.log("All ready:", allReady, players.map(p => ({nick: p.nick, word: p.word})));
    if (!allReady) {
      socket.emit("error", "Nie wszyscy gracze wpisali hasła!");
      return;
    }

    if (players.length < 2) {
      socket.emit("error", "Minimum 2 graczy!");
      return;
    }

    room.status = "playing";

    // ⭐ LOSUJ HASŁA - każdy gracz dostaje losowe hasło innego gracza (unikalne, bez własnego)
    const perm = randomDerangement(players.length);
    console.log("Perm:", perm);
    
    const gameData = {
      players: players.map((p, idx) => {
        const assignedIdx = perm[idx];
        return {
          id: p.id,
          nick: p.nick,
          myWord: p.word, // hasło które on wpisał
          assignedWord: players[assignedIdx].word, // hasło które on ma zgadywać
          hintLength: 1, // start with first letter
          guessed: false // czy już zgadł
        };
      })
    };

    // store game data for potential reconnections
    room.game = gameData;

    io.to(roomId).emit("round-start", gameData);
    console.log("🎮 Gra rozpoczęta:", roomId);
  });

  // GUESS CORRECT
  socket.on('guess-correct', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || room.status !== 'playing' || !room.game) return;

    const player = room.game.players.find(p => p.id === socket.id);
    if (!player || player.guessed) return; // already guessed

    player.guessed = true;
    io.to(roomId).emit('player-guessed', { playerId: socket.id });

    // Check if all players have guessed
    const allGuessed = room.game.players.every(p => p.guessed);
    if (allGuessed) {
      room.status = 'ended';
      io.to(roomId).emit('game-end', { winner: null }); // wszyscy zgadli
      console.log("🏆 Gra zakończona, wszyscy zgadli!");

      // Reset for new game
      room.status = 'lobby';
      room.game = null;
      Object.values(room.players).forEach(p => {
        p.word = null;
        p.ready = false;
      });
      io.to(roomId).emit('players-update', Object.values(room.players));
    }
  });

  // KICK PLAYER (host only)
  socket.on('kick-player', ({ roomId, playerId }) => {
    const room = rooms[roomId];
    if (!room || room.players[socket.id]?.isHost !== true) return;

    if (room.players[playerId]) {
      delete room.players[playerId];
      io.to(roomId).emit('players-update', Object.values(room.players));
      io.to(roomId).emit('user-left', playerId);
      io.to(playerId).emit('kicked');
      console.log("👢", socket.id, "wyrzucił", playerId);
    }
  });

  // GIVE HINT (host only)
  socket.on('give-hint', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || room.players[socket.id]?.isHost !== true || !room.game) return;

    // Increase hint length for all players
    room.game.players.forEach(p => {
      if (p.assignedWord) {
        p.hintLength = (p.hintLength || 1) + 1;
      }
    });

    io.to(roomId).emit('hint-update', room.game.players.map(p => ({
      id: p.id,
      hint: p.assignedWord.substring(0, p.hintLength) + '...'
    })));
    console.log("💡 Podpowiedź dana przez hosta");
  });

  // WEBRTC SIGNAL
  socket.on("webrtc-signal", ({ to, signal }) => {
    io.to(to).emit("webrtc-signal", {
      from: socket.id,
      signal
    });
  });

  // DISCONNECT
  socket.on("disconnect", () => {
    console.log("❌ Rozłączono:", socket.id);

    for (const roomId in rooms) {
      const room = rooms[roomId];
      if (room.players[socket.id]) {
        delete room.players[socket.id];

        io.to(roomId).emit("players-update", Object.values(room.players));
        io.to(roomId).emit("user-left", socket.id);

        if (!Object.values(room.players).some(p => p.isHost)) {
          const next = Object.values(room.players)[0];
          if (next) {
            next.isHost = true;
            room.hostToken = next.hostToken;
            io.to(roomId).emit("players-update", Object.values(room.players));
          }
        }
      }
    }
  });
});

// Helper: shuffle array
function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Helper: create random derangement (permutation with no fixed points)
function randomDerangement(n) {
  const perm = Array.from({length: n}, (_, i) => i);
  shuffleArray(perm);
  // Fix any fixed points by swapping with next
  for (let i = 0; i < n; i++) {
    if (perm[i] === i) {
      const next = (i + 1) % n;
      [perm[i], perm[next]] = [perm[next], perm[i]];
    }
  }
  return perm;
}

server.listen(3000, () => console.log("🚀 Server on :3000"));