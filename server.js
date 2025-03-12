import { WebSocket, WebSocketServer } from 'ws';

const wss = new WebSocketServer({ port: 8080 });

// Game constants
const GRID_SIZE = 400; // Match the client's grid size
const SAFE_ZONE_RADIUS = 20; // Safe zone radius, used throughout the code

// Connection health tracking
const clientHeartbeats = new Map();
const PING_INTERVAL = 30000; // Send ping every 30 seconds
const PONG_TIMEOUT = 10000; // Consider connection dead if no pong received within 10 seconds

// Rate limiting settings
const MESSAGE_RATE_LIMIT = 30; // Maximum messages per second
const MESSAGE_TRACKING_WINDOW = 1000; // Time window in milliseconds
const clientMessageCounts = new Map(); // Track message counts per client

// Game state
let players = {};
let foods = [];
let walls = []; // Store wall positions
const BASE_FOOD_DENSITY = 0.001; // Reduced from 0.0025
const MAX_FOODS = Math.max(80, Math.floor(Math.sqrt(GRID_SIZE * GRID_SIZE) * BASE_FOOD_DENSITY * GRID_SIZE)); // Reduced from 120 to 80
const BASE_FOOD_LIFETIME = 30000; // 30 seconds base lifetime

console.log(`Map size: ${GRID_SIZE}x${GRID_SIZE}, Maximum food items: ${MAX_FOODS}`);

// Food types
const FOOD_TYPES = [
    { type: 'normal', points: 10, color: '#FF5722', probability: 0.6 },
    { type: 'bonus', points: 20, color: '#FFC107', probability: 0.2 },
    { type: 'super', points: 50, color: '#8BC34A', probability: 0.1 },
    { type: 'speed_boost', points: 5, color: '#00BCD4', probability: 0.033, powerUp: 'speed_boost', duration: 5000 },
    { type: 'invincibility', points: 5, color: '#9C27B0', probability: 0.033, powerUp: 'invincibility', duration: 5000 },
    { type: 'magnet', points: 5, color: '#FFEB3B', probability: 0.034, powerUp: 'magnet', duration: 5000 }
];

// Track connected clients to handle disconnections properly
const clientMap = new Map();

wss.on('connection', (ws) => {
    console.log('New connection established');
    
    // Generate a unique connection ID for tracking this socket
    const connectionId = Date.now().toString() + Math.floor(Math.random() * 1000);
    clientMap.set(ws, connectionId);
    
    // Set up heartbeat handling
    ws.isAlive = true;
    ws.on('pong', () => {
        ws.isAlive = true;
        
        // Clear the timeout for this client
        const timeout = clientHeartbeats.get(ws);
        if (timeout) {
            clearTimeout(timeout);
        }
    });
    
    // Initialize rate limiting for this client
    clientMessageCounts.set(ws, { count: 0, lastReset: Date.now() });
    
    ws.on('message', (message) => {
        // Apply rate limiting
        const clientStats = clientMessageCounts.get(ws);
        const now = Date.now();
        
        // Reset counter if window has passed
        if (now - clientStats.lastReset > MESSAGE_TRACKING_WINDOW) {
            clientStats.count = 0;
            clientStats.lastReset = now;
        }
        
        // Increment message count
        clientStats.count++;
        
        // Check if rate limit exceeded
        if (clientStats.count > MESSAGE_RATE_LIMIT) {
            console.log(`Rate limit exceeded for client ${connectionId}`);
            return; // Silently drop the message
        }
        
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'update') {
                const playerId = data.id;
                
                // New player joined
                if (!players[playerId]) {
                    console.log(`New player joined with ID: ${playerId}`);
                }
                
                // Don't update dead players' snake positions - they should stay fixed
                if (players[playerId] && players[playerId].dead) {
                    // Only update non-position data
                    players[playerId].score = data.score;
                    players[playerId].level = data.level;
                    players[playerId].activePowerUp = data.activePowerUp;
                    players[playerId].lastUpdate = Date.now();
                } else {
                    // Update player data
                    players[playerId] = {
                        id: playerId,
                        snake: data.snake,
                        score: data.score,
                        level: data.level,
                        lastUpdate: Date.now(),
                        connectionId: clientMap.get(ws),
                        activePowerUp: data.activePowerUp
                    };
                    
                    // Preserve final position if it existed
                    if (players[playerId] && players[playerId].finalPosition) {
                        players[playerId].finalPosition = players[playerId].finalPosition;
                    }
                }
                
                // Check for collisions with other players
                const head = data.snake[0];
                if (head) {
                    checkPlayerCollisions(playerId, head);
                }
            } else if (data.type === 'foodEaten') {
                const playerId = data.id;
                const foodIndex = data.foodIndex;
                
                if (foodIndex >= 0 && foodIndex < foods.length) {
                    const eatenFood = foods[foodIndex];
                    foods.splice(foodIndex, 1);
                    console.log(`Food eaten by player ${playerId}`);
                    
                    // Activate power-up if the eaten food was a power-up
                    if (eatenFood.powerUp) {
                        players[playerId].activePowerUp = {
                            type: eatenFood.powerUp,
                            expiresAt: Date.now() + eatenFood.duration
                        };
                        console.log(`Power-up ${eatenFood.powerUp} activated for player ${playerId}`);
                    }
                    
                    // Generate new food
                    while (foods.length < MAX_FOODS) {
                        foods.push(generateNewFood());
                    }
                    
                    // Broadcast updated food positions to all clients
                    broadcastGameState();
                }
            } else if (data.type === 'requestFood') {
                // Create food at the requested position
                const food = {
                    x: data.x,
                    y: data.y,
                    createdAt: Date.now(),
                    blinking: false,
                    lifetime: BASE_FOOD_LIFETIME * 1.5, // Give safe zone food longer lifetime
                    countdown: Math.floor((BASE_FOOD_LIFETIME * 1.5) / 1000)
                };
                
                // Determine food type
                if (data.specialFood) {
                    // Special high-value food
                    if (data.powerUp) {
                        // Choose a random power-up
                        const powerUpTypes = ['speed_boost', 'invincibility', 'magnet'];
                        const randomPowerUp = powerUpTypes[Math.floor(Math.random() * powerUpTypes.length)];
                        
                        // Set power-up food properties
                        food.points = 5;
                        food.powerUp = randomPowerUp;
                        food.duration = 10000; // 10 seconds
                        
                        switch (randomPowerUp) {
                            case 'speed_boost':
                                food.color = '#00BCD4';
                                break;
                            case 'invincibility':
                                food.color = '#9C27B0';
                                break;
                            case 'magnet':
                                food.color = '#FFEB3B';
                                break;
                        }
                    } else {
                        // High-value food
                        food.points = data.points || 20;
                        food.color = data.points >= 50 ? '#8BC34A' : '#FFC107';
                    }
                } else {
                    // Regular food in safe zone
                    food.points = 10;
                    food.color = '#FF5722';
                }
                
                // Add to foods array if not colliding with anything
                let canPlace = true;
                
                // Check walls
                for (const wall of walls) {
                    if (wall.x === food.x && wall.y === food.y) {
                        canPlace = false;
                        break;
                    }
                }
                
                // Check other food
                for (const existingFood of foods) {
                    if (existingFood.x === food.x && existingFood.y === food.y) {
                        canPlace = false;
                        break;
                    }
                }
                
                if (canPlace) {
                    foods.push(food);
                }
            } else if (data.type === 'gameOver') {
                const playerId = data.id;
                const deathReason = data.reason || 'unknown';
                console.log(`Player ${playerId} game over. Reason: ${deathReason}`);
        
                // Mark player as dead first, then remove after a short delay
                // This ensures other clients see the dead state before removal
                if (players[playerId]) {
                    // Preserve the player's score and level in the dead state for leaderboard
                    players[playerId].dead = true;
                    players[playerId].deathReason = deathReason;
                    players[playerId].deathTime = Date.now();
                    
                    // Store final position to ensure consistency across all clients
                    if (data.finalPosition) {
                        players[playerId].finalPosition = data.finalPosition;
                        // Replace the snake with the final position
                        players[playerId].snake = data.finalPosition;
                    }
                    
                    if (data.score !== undefined) {
                        players[playerId].score = data.score;
                    }
                    
                    if (data.level !== undefined) {
                        players[playerId].level = data.level;
                    }
            
                    // Broadcast immediately that the player is dead
                    broadcastGameState();
            
                    // Remove the player after a longer delay to ensure death animation visibility
                    setTimeout(() => {
                        if (players[playerId]) {
                            delete players[playerId];
                            console.log(`Removed dead player ${playerId}`);
                            // Broadcast again to ensure all clients remove the player
                            broadcastGameState();
                        }
                    }, 3000); // Increased to 3 seconds for better visibility of death state
                }
            } else if (data.type === 'eatSnake') {
                const playerId = data.id;
                const targetId = data.target;
                const segmentIndex = data.segmentIndex;
                
                console.log(`Player ${playerId} eating player ${targetId} from segment ${segmentIndex}`);
                
                if (players[targetId] && players[targetId].snake) {
                    // Mark the target snake as partially eaten
                    if (segmentIndex === 0) {
                        // If head is eaten, mark the whole snake as dead
                        players[targetId].dead = true;
                        
                        // Add points to the eating player based on the eaten snake's length
                        if (players[playerId]) {
                            const pointsGained = players[targetId].snake.length * 5;
                            players[playerId].score = (players[playerId].score || 0) + pointsGained;
                            console.log(`Player ${playerId} gained ${pointsGained} points for eating player ${targetId}`);
                        }
                        
                        // Broadcast immediately that the player is dead
                        broadcastGameState();
                        
                        // Remove the player after a short delay
                        setTimeout(() => {
                            delete players[targetId];
                            console.log(`Removed eaten player ${targetId}`);
                            // Broadcast again to ensure all clients remove the player
                            broadcastGameState();
                        }, 1000); // Increased from 500ms to 1000ms for better visibility
                    } else {
                        // If body segment is eaten, remove that part of the snake
                        const eatenSegments = players[targetId].snake.length - segmentIndex;
                        players[targetId].snake = players[targetId].snake.slice(0, segmentIndex);
                        console.log(`Player ${targetId} snake shortened to ${players[targetId].snake.length} segments`);
                        
                        // Add points to the eating player based on eaten segments
                        if (players[playerId]) {
                            const pointsGained = eatenSegments * 5; // 5 points per segment
                            players[playerId].score = (players[playerId].score || 0) + pointsGained;
                            console.log(`Player ${playerId} gained ${pointsGained} points for eating segments from ${targetId}`);
                        }
                        
                        // Broadcast updated state
                        broadcastGameState();
                    }
                }
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });

    ws.on('close', () => {
        // Find and remove the disconnected player
        const connectionId = clientMap.get(ws);
        for (const playerId in players) {
            if (players[playerId].connectionId === connectionId) {
                console.log(`Player ${playerId} disconnected`);
                delete players[playerId];
                break;
            }
        }
        
        // Clean up resources
        const timeout = clientHeartbeats.get(ws);
        if (timeout) {
            clearTimeout(timeout);
        }
        clientHeartbeats.delete(ws);
        clientMessageCounts.delete(ws);
        clientMap.delete(ws);
        
        console.log('Client disconnected, active connections:', clientMap.size);
    });

    // Send initial game state to the new client
    sendGameState(ws);
});

// Check if a player's head collides with other players
function checkPlayerCollisions(playerId, head) {
    for (const otherId in players) {
        // Skip self-collision check (that's handled client-side)
        if (otherId === playerId) continue;
        
        const otherSnake = players[otherId].snake;
        if (!otherSnake) continue;
        
        // Check collision with other snake bodies
        for (let i = 0; i < otherSnake.length; i++) {
            if (head.x === otherSnake[i].x && head.y === otherSnake[i].y) {
                console.log(`Player ${playerId} collided with player ${otherId}`);
                // Mark this player as dead
                if (players[playerId]) {
                    players[playerId].dead = true;
                    // Remove the player after a short delay
                    setTimeout(() => {
                        delete players[playerId];
                        console.log(`Removed dead player ${playerId}`);
                    }, 500);
                }
                return;
            }
        }
    }
}

// Generate a new food position that's not on any snake
function generateNewFood() {
    let newFood;
    let validPosition = false;
    
    while (!validPosition) {
        // Generate random lifetime between 20-40 seconds
        const randomLifetime = BASE_FOOD_LIFETIME + Math.floor(Math.random() * 20000) - 10000;
        
        newFood = {
            x: Math.floor(Math.random() * GRID_SIZE),
            y: Math.floor(Math.random() * GRID_SIZE),
            createdAt: Date.now(),
            blinking: false,
            lifetime: randomLifetime,
            countdown: Math.floor(randomLifetime / 1000)
        };
        
        // Determine food type
        const rand = Math.random();
        let cumulativeProbability = 0;
        for (const foodType of FOOD_TYPES) {
            cumulativeProbability += foodType.probability;
            if (rand <= cumulativeProbability) {
                newFood = { ...newFood, ...foodType };
                break;
            }
        }
        
        validPosition = true;
        
        // Check if food would spawn on any snake or existing food
        for (const playerId in players) {
            const snake = players[playerId].snake;
            if (!snake) continue;
            
            for (let i = 0; i < snake.length; i++) {
                if (newFood.x === snake[i].x && newFood.y === snake[i].y) {
                    validPosition = false;
                    break;
                }
            }
            
            if (!validPosition) break;
        }
        
        for (const food of foods) {
            if (newFood.x === food.x && newFood.y === food.y) {
                validPosition = false;
                break;
            }
        }
    }
    
    return newFood;
}

// Send game state to a specific client
function sendGameState(ws) {
    if (ws.readyState === WebSocket.OPEN) {
        const gameState = JSON.stringify({ 
            type: 'state', 
            players: players,
            foods: foods,  // Send the foods array instead of a single food
            walls: walls   // Also send walls to clients
        });
        ws.send(gameState);
    }
}

// Broadcast game state to all clients
function broadcastGameState() {
    if (wss.clients.size > 0) {
        const gameState = JSON.stringify({ 
            type: 'state', 
            players: players,
            foods: foods,  // Send the foods array instead of a single food
            walls: walls   // Also send walls to clients
        });
        
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(gameState);
            }
        });
    }
}

// Regularly broadcast game state to all clients
setInterval(() => {
    broadcastGameState();
}, 50);

// WebSocket ping/pong heartbeat to detect dead connections
setInterval(() => {
    wss.clients.forEach((ws) => {
        const clientId = clientMap.get(ws);
        if (ws.isAlive === false) {
            console.log(`Client ${clientId} did not respond to ping, terminating connection`);
            clientHeartbeats.delete(ws);
            return ws.terminate();
        }
        
        ws.isAlive = false;
        ws.ping();
        
        // Set a timeout for response
        const timeout = setTimeout(() => {
            if (ws.isAlive === false) {
                console.log(`Client ${clientId} ping timeout, terminating connection`);
                ws.terminate();
            }
        }, PONG_TIMEOUT);
        
        clientHeartbeats.set(ws, timeout);
    });
}, PING_INTERVAL);

// Update foods and broadcast game state
setInterval(() => {
    if (Object.keys(players).length > 0) {
        updateFoods();
        broadcastGameState();
    }
}, 1000);

function updateFoods() {
    const now = Date.now();
    
    // Filter out expired foods based on their individual lifetimes
    foods = foods.filter(food => now - food.createdAt < food.lifetime);
    
    // Add new foods if needed, with reduced spawn rate
    if (foods.length < MAX_FOODS) {
        // Calculate how many foods to add (reduced from 8-12 to 3-6 at a time)
        const foodsToAdd = Math.min(
            MAX_FOODS - foods.length,
            Math.floor(Math.random() * 4) + 3 // Add 3-6 foods at a time
        );
        
        for (let i = 0; i < foodsToAdd; i++) {
            foods.push(generateNewFood());
        }
    }
    
    // Update countdown and blinking state for each food
    foods.forEach(food => {
        food.countdown = Math.max(0, Math.floor((food.lifetime - (now - food.createdAt)) / 1000));
        if (food.countdown <= 5 && !food.blinking) {
            food.blinking = true;
        }
    });
}

// Clean up disconnected players and expired power-ups
setInterval(() => {
    const now = Date.now();
    for (const id in players) {
        const player = players[id];
        // Increase timeout from 5000 to 15000 (15 seconds) to be more lenient with reconnections
        if (player.lastUpdate && now - player.lastUpdate > 15000) {
            console.log(`Removing inactive player ${id}`);
            delete players[id];
        } else if (player.activePowerUp && now > player.activePowerUp.expiresAt) {
            console.log(`Power-up ${player.activePowerUp.type} expired for player ${id}`);
            delete player.activePowerUp;
        }
    }
}, 1000);

// Wall generation functions
function generateWalls() {
    walls = [];
    
    // Basic parameters
    const centerX = Math.floor(GRID_SIZE / 2);
    const centerY = Math.floor(GRID_SIZE / 2);
    
    const isSafe = (x, y) => {
        const dx = x - centerX;
        const dy = y - centerY;
        return Math.sqrt(dx*dx + dy*dy) < SAFE_ZONE_RADIUS * 1.2;
    };
    
    // Create outer border walls only (with padded space)
    const border = 20; // Increased border size for larger gameplay area
    
    // Add horizontal border walls
    for (let x = border; x < GRID_SIZE - border; x++) {
        if (!isSafe(x, border)) walls.push({x, y: border});
        if (!isSafe(x, GRID_SIZE - border - 1)) walls.push({x, y: GRID_SIZE - border - 1});
    }
    
    // Add vertical border walls
    for (let y = border; y < GRID_SIZE - border; y++) {
        if (!isSafe(border, y)) walls.push({x: border, y});
        if (!isSafe(GRID_SIZE - border - 1, y)) walls.push({x: GRID_SIZE - border - 1, y});
    }
    
    // Add walls around the safe zone to create a traditional snake game room
    const safeZoneX = Math.floor(GRID_SIZE / 2);
    const safeZoneY = Math.floor(GRID_SIZE / 2);
    // This creates a square room that's slightly larger than the safe zone
    const roomSize = SAFE_ZONE_RADIUS * 2; // Now 60x60 instead of 100x100
    const roomStartX = safeZoneX - roomSize / 2;
    const roomStartY = safeZoneY - roomSize / 2;
    
    // Add horizontal walls for the room
    for (let x = roomStartX; x < roomStartX + roomSize; x++) {
        walls.push({x, y: roomStartY});
        walls.push({x, y: roomStartY + roomSize});
    }
    
    // Add vertical walls for the room
    for (let y = roomStartY; y < roomStartY + roomSize; y++) {
        walls.push({x: roomStartX, y});
        walls.push({x: roomStartX + roomSize, y});
    }

    // Create a room-based structure
    createRoomStructure();
    
    // Keep teleport tunnels for gameplay value
    addPacManTeleportTunnels();
}

// Create a room-based structure with connecting corridors
function createRoomStructure() {
    // Since we're creating a traditional snake game with just walls around the safe zone,
    // this function will be simplified to not create additional rooms outside the main one
    const centerX = Math.floor(GRID_SIZE / 2);
    const centerY = Math.floor(GRID_SIZE / 2);
    const border = 20;
    
    // Keep track of the room we already created around the safe zone
    const roomSize = SAFE_ZONE_RADIUS * 2;
    const roomStartX = centerX - roomSize / 2;
    const roomStartY = centerY - roomSize / 2;
    
    // Add some food inside the room
    for (let i = 0; i < 10; i++) {
        const x = Math.floor(roomStartX + Math.random() * roomSize);
        const y = Math.floor(roomStartY + Math.random() * roomSize);
        
        // Request food creation at this position
        let food = generateNewFood();
        food.x = x;
        food.y = y;
        foods.push(food);
    }
    
    // Add a maze of rooms grid
    addMazeOfRooms();
    
    // Add random obstacles outside the safe room
    addRandomObstacles();
}

// Add a grid-like maze of interconnected rooms
function addMazeOfRooms() {
    const gridCells = 4;
    const roomSpacing = Math.floor(GRID_SIZE / gridCells);
    const roomSize = Math.floor(roomSpacing * 0.6);
    
    // Create a maze of interconnected rooms
    for (let gridX = 0; gridX < gridCells - 1; gridX++) {
        for (let gridY = 0; gridY < gridCells - 1; gridY++) {
            // Skip the center area to avoid interfering with the safe zone
            if ((gridX === 1 || gridX === 2) && (gridY === 1 || gridY === 2)) continue;
            
            const startX = gridX * roomSpacing + Math.floor(roomSpacing * 0.2);
            const startY = gridY * roomSpacing + Math.floor(roomSpacing * 0.2);
            
            // Random door position
            const doorPositions = ['north', 'east', 'south', 'west'];
            const primaryDoor = doorPositions[Math.floor(Math.random() * doorPositions.length)];
            
            // Create room with just one opening
            const roomWalls = createRoomWithSmallOpening(startX, startY, roomSize, roomSize, primaryDoor);
            walls.push(...roomWalls);
            
            // Add valuable food inside
            for (let j = 0; j < 2; j++) {
                const foodX = Math.floor(startX + Math.random() * (roomSize - 2) + 1);
                const foodY = Math.floor(startY + Math.random() * (roomSize - 2) + 1);
                
                const special = Math.random() < 0.3;
                let food = generateNewFood();
                food.x = foodX;
                food.y = foodY;
                
                if (special) {
                    // Random power-up
                    const powerUpTypes = ['speed_boost', 'invincibility', 'magnet'];
                    const randomPowerUp = powerUpTypes[Math.floor(Math.random() * powerUpTypes.length)];
                    food.powerUp = randomPowerUp;
                    food.duration = 10000;
                    
                    switch (randomPowerUp) {
                        case 'speed_boost':
                            food.color = '#00BCD4';
                            break;
                        case 'invincibility':
                            food.color = '#9C27B0';
                            break;
                        case 'magnet':
                            food.color = '#FFEB3B';
                            break;
                    }
                } else {
                    // Just valuable food
                    food.points = 30;
                    food.color = '#8BC34A';
                }
                
                foods.push(food);
            }
        }
    }
}

// Add random obstacles throughout the map
function addRandomObstacles() {
    const centerX = Math.floor(GRID_SIZE / 2);
    const centerY = Math.floor(GRID_SIZE / 2);
    
    // Function to check if a position is safe (inside or near the safe zone)
    const isSafe = (x, y) => {
        const dx = x - centerX;
        const dy = y - centerY;
        // Keep a wider safety margin around the safe zone
        return Math.sqrt(dx*dx + dy*dy) < SAFE_ZONE_RADIUS * 2.5;
    };
    
    // Add random rectangular obstacles - reduced count to make room for new room types
    for (let i = 0; i < 8; i++) {
        const obstacleWidth = Math.floor(Math.random() * 15) + 5;
        const obstacleHeight = Math.floor(Math.random() * 15) + 5;
        
        // Place obstacles away from the center
        let obstacleX, obstacleY;
        do {
            obstacleX = Math.floor(Math.random() * (GRID_SIZE - obstacleWidth - 40)) + 20;
            obstacleY = Math.floor(Math.random() * (GRID_SIZE - obstacleHeight - 40)) + 20;
        } while (isSafe(obstacleX, obstacleY));
        
        // Create the obstacle
        for (let x = obstacleX; x < obstacleX + obstacleWidth; x++) {
            for (let y = obstacleY; y < obstacleY + obstacleHeight; y++) {
                // Only create walls at the perimeter of the obstacle
                if (x === obstacleX || x === obstacleX + obstacleWidth - 1 || 
                    y === obstacleY || y === obstacleY + obstacleHeight - 1) {
                    walls.push({x, y});
                }
            }
        }
        
        // Add some food inside the obstacle
        for (let j = 0; j < 3; j++) {
            const foodX = Math.floor(obstacleX + 1 + Math.random() * (obstacleWidth - 2));
            const foodY = Math.floor(obstacleY + 1 + Math.random() * (obstacleHeight - 2));
            
            let food = generateNewFood();
            food.x = foodX;
            food.y = foodY;
            // Make obstacle food more valuable
            food.points = 30;
            food.color = '#FFC107';
            foods.push(food);
        }
    }
    
    // Add rooms with small openings
    for (let i = 0; i < 6; i++) {
        const roomWidth = Math.floor(Math.random() * 15) + 10;
        const roomHeight = Math.floor(Math.random() * 15) + 10;
        
        // Place rooms away from the center
        let roomX, roomY;
        do {
            roomX = Math.floor(Math.random() * (GRID_SIZE - roomWidth - 40)) + 20;
            roomY = Math.floor(Math.random() * (GRID_SIZE - roomHeight - 40)) + 20;
        } while (isSafe(roomX, roomY));
        
        // Choose random door position
        const doorPositions = ['north', 'east', 'south', 'west'];
        const doorPosition = doorPositions[Math.floor(Math.random() * doorPositions.length)];
        
        // Create room with small opening
        const roomWalls = createRoomWithSmallOpening(roomX, roomY, roomWidth, roomHeight, doorPosition);
        walls.push(...roomWalls);
        
        // Add some valuable food inside the room
        for (let j = 0; j < 3; j++) {
            const foodX = Math.floor(roomX + 1 + Math.random() * (roomWidth - 2));
            const foodY = Math.floor(roomY + 1 + Math.random() * (roomHeight - 2));
            
            let food = generateNewFood();
            food.x = foodX;
            food.y = foodY;
            // Make room food more valuable
            food.points = 40;
            food.color = '#FFC107';
            foods.push(food);
        }
        
        // 30% chance to add a power-up in the room
        if (Math.random() < 0.3) {
            const powerUpX = Math.floor(roomX + roomWidth / 2);
            const powerUpY = Math.floor(roomY + roomHeight / 2);
            
            let powerUpFood = generateNewFood();
            powerUpFood.x = powerUpX;
            powerUpFood.y = powerUpY;
            
            // Randomly select a power-up type
            const powerUpTypes = ['speed_boost', 'invincibility', 'magnet'];
            const randomPowerUp = powerUpTypes[Math.floor(Math.random() * powerUpTypes.length)];
            
            powerUpFood.powerUp = randomPowerUp;
            powerUpFood.duration = 10000;
            
            switch (randomPowerUp) {
                case 'speed_boost':
                    powerUpFood.color = '#00BCD4';
                    break;
                case 'invincibility':
                    powerUpFood.color = '#9C27B0';
                    break;
                case 'magnet':
                    powerUpFood.color = '#FFEB3B';
                    break;
            }
            
            foods.push(powerUpFood);
        }
    }
    
    // Add random circular obstacles
    for (let i = 0; i < 8; i++) {
        const radius = Math.floor(Math.random() * 10) + 8;
        
        // Place circles away from the center
        let centerObsX, centerObsY;
        do {
            centerObsX = Math.floor(Math.random() * (GRID_SIZE - 40)) + 20;
            centerObsY = Math.floor(Math.random() * (GRID_SIZE - 40)) + 20;
        } while (isSafe(centerObsX, centerObsY));
        
        // Create circular obstacle
        for (let x = centerObsX - radius; x <= centerObsX + radius; x++) {
            for (let y = centerObsY - radius; y <= centerObsY + radius; y++) {
                if (x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE) {
                    const dx = x - centerObsX;
                    const dy = y - centerObsY;
                    const distance = Math.sqrt(dx*dx + dy*dy);
                    
                    // Only create walls at the perimeter of the circle
                    if (Math.abs(distance - radius) < 1.5) {
                        walls.push({x, y});
                    }
                }
            }
        }
        
        // Add power-up food in the center of the circle
        let powerUpFood = generateNewFood();
        powerUpFood.x = centerObsX;
        powerUpFood.y = centerObsY;
        
        // Randomly select a power-up type
        const powerUpTypes = ['speed_boost', 'invincibility', 'magnet'];
        const randomPowerUp = powerUpTypes[Math.floor(Math.random() * powerUpTypes.length)];
        
        powerUpFood.powerUp = randomPowerUp;
        powerUpFood.duration = 10000;
        
        switch (randomPowerUp) {
            case 'speed_boost':
                powerUpFood.color = '#00BCD4';
                break;
            case 'invincibility':
                powerUpFood.color = '#9C27B0';
                break;
            case 'magnet':
                powerUpFood.color = '#FFEB3B';
                break;
        }
        
        foods.push(powerUpFood);
    }
    
    // Add diagonal maze-like structures
    for (let i = 0; i < 5; i++) {
        // Place maze structures away from the center
        let mazeX, mazeY;
        const mazeSize = Math.floor(Math.random() * 30) + 20;
        
        do {
            mazeX = Math.floor(Math.random() * (GRID_SIZE - mazeSize - 40)) + 20;
            mazeY = Math.floor(Math.random() * (GRID_SIZE - mazeSize - 40)) + 20;
        } while (isSafe(mazeX, mazeY));
        
        // Create maze walls at intervals
        const interval = Math.floor(Math.random() * 3) + 3;
        for (let j = 0; j < mazeSize; j += interval) {
            // Create horizontal and vertical lines with gaps
            for (let k = 0; k < mazeSize; k += 2) {
                if (Math.random() > 0.3) { // 70% chance to place a wall segment
                    walls.push({x: mazeX + j, y: mazeY + k});
                }
                if (Math.random() > 0.3) {
                    walls.push({x: mazeX + k, y: mazeY + j});
                }
            }
        }
        
        // Add special food in the maze
        for (let j = 0; j < 5; j++) {
            const foodX = Math.floor(mazeX + Math.random() * mazeSize);
            const foodY = Math.floor(mazeY + Math.random() * mazeSize);
            
            // Check if position is not a wall
            const isWall = walls.some(wall => wall.x === foodX && wall.y === foodY);
            if (!isWall) {
                let food = generateNewFood();
                food.x = foodX;
                food.y = foodY;
                food.points = 20;
                food.color = '#8BC34A';
                foods.push(food);
            }
        }
    }
}



// Function to add teleport tunnels 
function addPacManTeleportTunnels() {
    // For traditional snake game, we'll add teleport tunnels to the main room
    const centerX = Math.floor(GRID_SIZE / 2);
    const centerY = Math.floor(GRID_SIZE / 2);
    const roomSize = SAFE_ZONE_RADIUS * 2;
    const roomStartX = centerX - roomSize / 2;
    const roomStartY = centerY - roomSize / 2;
    
    // Create teleport tunnel on the right side of the main room
    const tunnelY = roomStartY + Math.floor(roomSize / 2);
    
    // Right tunnel entrance in the room - just one cell
    walls = walls.filter(w => !(w.x === roomStartX + roomSize && w.y === tunnelY));
    
    // Left tunnel entrance to match - just one cell
    walls = walls.filter(w => !(w.x === roomStartX && w.y === tunnelY));

    
    // Add decorative walls around the teleport areas
    for (let i = 1; i <= 3; i++) {
        walls.push({x: roomStartX + roomSize + i, y: tunnelY - 1});
        walls.push({x: roomStartX + roomSize + i, y: tunnelY + 1});
        
        walls.push({x: roomStartX - i, y: tunnelY - 1});
        walls.push({x: roomStartX - i, y: tunnelY + 1});
    }
}

// Function to create room with a small 1-cell opening
function createRoomWithSmallOpening(startX, startY, width, height, doorPosition = 'north', doorOffset = null) {
    const roomWalls = [];
    
    // Calculate door offset if not specified
    if (doorOffset === null) {
        // Default door to middle of the wall
        if (doorPosition === 'north' || doorPosition === 'south') {
            doorOffset = Math.floor(width / 2);
        } else {
            doorOffset = Math.floor(height / 2);
        }
    }
    
    // Create walls for all four sides of the room with a 1-cell opening
    for (let i = 0; i < width; i++) {
        // North wall with gap
        if (doorPosition !== 'north' || i !== doorOffset) {
            roomWalls.push({x: startX + i, y: startY});
        }
        
        // South wall with gap
        if (doorPosition !== 'south' || i !== doorOffset) {
            roomWalls.push({x: startX + i, y: startY + height - 1});
        }
    }
    
    for (let i = 0; i < height; i++) {
        // West wall with gap
        if (doorPosition !== 'west' || i !== doorOffset) {
            roomWalls.push({x: startX, y: startY + i});
        }
        
        // East wall with gap
        if (doorPosition !== 'east' || i !== doorOffset) {
            roomWalls.push({x: startX + width - 1, y: startY + i});
        }
    }
    
    return roomWalls;
}


// Generate walls once during server initialization
generateWalls();

console.log('Snake game server running on port 8080');
