const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");
const { VM } = require("vm2");
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.use(cors());
app.use(express.json());

// Add this object to store room data
const rooms = {};

io.on("connection", (socket) => {
  console.log("New client connected");

  socket.on("join-room", ({ roomId, username }) => {
    if (!roomId || !username) {
      socket.emit("room-joined", false);
      return;
    }

    socket.join(roomId);
    socket.username = username;

    // Initialize room if it doesn't exist
    if (!rooms[roomId]) {
      rooms[roomId] = {
        code: "",
        messages: [],
        output: { consoleOutput: "", returnValue: undefined }
      };
    }

    // Send existing room data to the joining user
    socket.emit("room-data", rooms[roomId]);

    // Confirm room join to the client
    socket.emit("room-joined", true);

    // Notify others in the room
    io.to(roomId).emit("message", { 
      type: "join", 
      user: username, 
      text: `${username} has joined the room` 
    });

    // Add join message to room messages
    rooms[roomId].messages.push({
      type: "join",
      user: username,
      text: `${username} has joined the room`
    });
  });

  socket.on("sendMessage", ({ roomId, message, username }) => {
    const messageData = { 
      type: "chat", 
      user: username, 
      text: message 
    };
    io.to(roomId).emit("message", messageData);

    // Store the message in room data
    if (rooms[roomId]) {
      rooms[roomId].messages.push(messageData);
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected");
  
    // Find the room this socket was in
    const roomId = Object.keys(rooms).find(id => 
      socket.rooms.has(id)
    );

    if (roomId) {
      // Remove the user from the room
      socket.leave(roomId);
      
      // Notify others in the room
      io.to(roomId).emit("message", { 
        type: "leave", 
        user: socket.username, 
        text: `${socket.username} has left the room` 
      });

      // Add leave message to room messages
      rooms[roomId].messages.push({
        type: "leave",
        user: socket.username,
        text: `${socket.username} has left the room`
      });

      // Check if the room is empty
      const roomClients = io.sockets.adapter.rooms.get(roomId);
      if (!roomClients || roomClients.size === 0) {
        console.log(`Room ${roomId} is empty, deleting it`);
        delete rooms[roomId];
      }
    }
  });

  socket.on('execute-code', ({ roomId, code, username }) => {
    console.log(`Received execute-code event from ${username} in room ${roomId}`);
    console.log('Code to execute:', code);

    // Update room code
    if (rooms[roomId]) {
      rooms[roomId].code = code;
    }

    const vm = new VM({
      timeout: 1000,
      sandbox: {}
    });

    try {
      let consoleOutput = [];
      
      vm.setGlobal('console', {
        log: (...args) => {
          consoleOutput.push(args.join(' '));
        }
      });

      const result = vm.run(code);
      
      const output = {
        consoleOutput: consoleOutput.join('\n'),
        returnValue: result !== undefined ? String(result) : undefined
      };

      console.log('Execution successful:', output);

      // Update room output
      if (rooms[roomId]) {
        rooms[roomId].output = output;
      }

      io.to(roomId).emit('execution-result', {
        success: true,
        result: output
      });
    } catch (error) {
      console.error('Error executing code:', error);
      io.to(roomId).emit('execution-result', {
        success: false,
        error: error.message
      });
    }
  });
});

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));