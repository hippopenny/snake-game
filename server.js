import { WebSocket, WebSocketServer } from 'ws';

const wss = new WebSocketServer({ port: 8080 });

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
const GRID_SIZE = 400; // Match the client's grid size
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
    const SAFE_ZONE_RADIUS = 20;
    
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
    const SAFE_ZONE_RADIUS = 30; // Reduced from 50 to 30 for a more challenging game
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
    
    // No other rooms or corridors needed for traditional snake game
}


// Create a diagonal corridor to the center
function createDiagonalCorridor(startX, startY, endX, endY) {
    const dx = endX - startX;
    const dy = endY - startY;
    const steps = Math.max(Math.abs(dx), Math.abs(dy));
    
    // Clear any walls along the diagonal path
    for (let i = 0; i <= steps; i++) {
        const x = Math.floor(startX + (dx * i / steps));
        const y = Math.floor(startY + (dy * i / steps));
        
        // Clear a 3x3 area around the path point
        for (let offsetX = -1; offsetX <= 1; offsetX++) {
            for (let offsetY = -1; offsetY <= 1; offsetY++) {
                walls = walls.filter(wall => !(wall.x === x + offsetX && wall.y === y + offsetY));
            }
        }
    }
}

// Add decorative elements inside rooms
function addRoomDecorations(border, roomWidth, roomHeight, roomsPerSide) {
    // For traditional snake game, we'll add a few obstacles inside the safe zone room
    const centerX = Math.floor(GRID_SIZE / 2);
    const centerY = Math.floor(GRID_SIZE / 2);
    const roomSize = SAFE_ZONE_RADIUS * 2;
    const roomStartX = centerX - roomSize / 2;
    const roomStartY = centerY - roomSize / 2;
    
    // Add a small obstacle in the top-left corner of the room
    const obstacleSize = 5;
    const cornerX = roomStartX + 10;
    const cornerY = roomStartY + 10;
    
    // Create a small square obstacle
    for (let x = cornerX; x < cornerX + obstacleSize; x++) {
        for (let y = cornerY; y < cornerY + obstacleSize; y++) {
            // Make sure not to block the center starting area
            const dx = x - centerX;
            const dy = y - centerY;
            if (Math.sqrt(dx*dx + dy*dy) > 15) { // Keep center area clear
                walls.push({x, y});
            }
        }
    }
    
    // Add another small obstacle in the bottom-right
    const corner2X = roomStartX + roomSize - 15;
    const corner2Y = roomStartY + roomSize - 15;
    
    // Create another small square obstacle
    for (let x = corner2X; x < corner2X + obstacleSize; x++) {
        for (let y = corner2Y; y < corner2Y + obstacleSize; y++) {
            walls.push({x, y});
        }
    }
}

// Add a pillar decoration (small cluster of walls)
function addPillar(centerX, centerY, size) {
    const halfSize = Math.floor(size / 2);
    
    // Add walls in a circular pattern
    for (let dx = -halfSize; dx <= halfSize; dx++) {
        for (let dy = -halfSize; dy <= halfSize; dy++) {
            if (dx*dx + dy*dy <= halfSize*halfSize) {
                walls.push({x: centerX + dx, y: centerY + dy});
            }
        }
    }
}

function addWallFormation(centerX, centerY, width, height, type = 'square') {
    const safeZoneX = Math.floor(GRID_SIZE / 2);
    const safeZoneY = Math.floor(GRID_SIZE / 2);
    const SAFE_ZONE_RADIUS = 50;
    
    switch (type) {
        case 'square':
            for (let x = centerX - width/2; x <= centerX + width/2; x++) {
                for (let y = centerY - height/2; y <= centerY + height/2; y++) {
                    // Skip if too close to center safe zone
                    const dx = x - safeZoneX;
                    const dy = y - safeZoneY;
                    if (Math.sqrt(dx*dx + dy*dy) < SAFE_ZONE_RADIUS) continue;
                    
                    // Only add walls on the perimeter of the formation
                    if (x === centerX - width/2 || x === centerX + width/2 || 
                        y === centerY - height/2 || y === centerY + height/2) {
                        walls.push({x, y});
                    }
                }
            }
            break;
            
        case 'circle':
            const radius = width / 2;
            for (let x = centerX - radius; x <= centerX + radius; x++) {
                for (let y = centerY - radius; y <= centerY + radius; y++) {
                    // Skip if too close to center safe zone
                    const dxSafe = x - safeZoneX;
                    const dySafe = y - safeZoneY;
                    if (Math.sqrt(dxSafe*dxSafe + dySafe*dySafe) < SAFE_ZONE_RADIUS) continue;
                    
                    // Only add walls on the perimeter of the circle
                    const dx = x - centerX;
                    const dy = y - centerY;
                    const distance = Math.sqrt(dx*dx + dy*dy);
                    if (Math.abs(distance - radius) < 1.5) {
                        walls.push({x, y});
                    }
                }
            }
            break;
            
        case 'cross':
            for (let x = centerX - width/2; x <= centerX + width/2; x++) {
                for (let y = centerY - height/2; y <= centerY + height/2; y++) {
                    // Skip if too close to center safe zone
                    const dxSafe = x - safeZoneX;
                    const dySafe = y - safeZoneY;
                    if (Math.sqrt(dxSafe*dxSafe + dySafe*dySafe) < SAFE_ZONE_RADIUS) continue;
                    
                    // Create cross pattern
                    if (Math.abs(x - centerX) < width/6 || Math.abs(y - centerY) < height/6) {
                        walls.push({x, y});
                    }
                }
            }
            break;
            
        case 'diamond':
            const halfWidth = width / 2;
            const halfHeight = height / 2;
            for (let x = centerX - halfWidth; x <= centerX + halfWidth; x++) {
                for (let y = centerY - halfHeight; y <= centerY + halfHeight; y++) {
                    // Skip if too close to center safe zone
                    const dxSafe = x - safeZoneX;
                    const dySafe = y - safeZoneY;
                    if (Math.sqrt(dxSafe*dxSafe + dySafe*dySafe) < SAFE_ZONE_RADIUS) continue;
                    
                    // Create diamond pattern
                    if (Math.abs(x - centerX) / halfWidth + Math.abs(y - centerY) / halfHeight <= 1.1 &&
                        Math.abs(x - centerX) / halfWidth + Math.abs(y - centerY) / halfHeight >= 0.9) {
                        walls.push({x, y});
                    }
                }
            }
            break;
    }
}

// Add Pac-Man style maze function
function addPacmanStyleMaze(centerX, centerY, width, height) {
    const safeZoneX = Math.floor(GRID_SIZE / 2);
    const safeZoneY = Math.floor(GRID_SIZE / 2);
    const SAFE_ZONE_RADIUS = 50;
    
    // Ensure we're not too close to safe zone
    const safeZoneCheck = (x, y) => {
        const dx = x - safeZoneX;
        const dy = y - safeZoneY;
        return Math.sqrt(dx*dx + dy*dy) < SAFE_ZONE_RADIUS * 1.5;
    };
    
    const startX = centerX - width / 2;
    const startY = centerY - height / 2;
    
    // Create outer boundaries
    for (let x = startX; x < startX + width; x++) {
        if (!safeZoneCheck(x, startY)) walls.push({x, y: startY});
        if (!safeZoneCheck(x, startY + height - 1)) walls.push({x, y: startY + height - 1});
    }
    
    for (let y = startY; y < startY + height; y++) {
        if (!safeZoneCheck(startX, y)) walls.push({x: startX, y});
        if (!safeZoneCheck(startX + width - 1, y)) walls.push({x: startX + width - 1, y});
    }
    
    // Create Pac-Man style maze internal walls
    const gridW = Math.floor(width / 10);
    const gridH = Math.floor(height / 6);
    
    // Create T-junctions
    for (let i = 1; i < 4; i++) {
        // Horizontal bars
        for (let x = startX + gridW; x < startX + width - gridW; x++) {
            const y = startY + i * gridH * 1.5;
            if (!safeZoneCheck(x, y)) walls.push({x, y});
        }
        
        // Create openings
        const gap1 = startX + Math.floor(width * 0.25);
        const gap2 = startX + Math.floor(width * 0.75);
        for (let g = -1; g <= 1; g++) {
            const y = startY + i * gridH * 1.5;
            if (!safeZoneCheck(gap1 + g, y)) {
                walls = walls.filter(w => !(w.x === gap1 + g && w.y === y));
            }
            if (!safeZoneCheck(gap2 + g, y)) {
                walls = walls.filter(w => !(w.x === gap2 + g && w.y === y));
            }
        }
    }
    
    // Create vertical dividers
    for (let i = 1; i < 4; i++) {
        const x = startX + Math.floor(width / 4) * i;
        for (let y = startY + gridH; y < startY + height - gridH; y++) {
            // Skip if wall would be at an intersection with horizontal bars
            const isAtHorizontalBar = [1, 2, 3].some(j => 
                Math.abs(y - (startY + j * gridH * 1.5)) < 2
            );
            
            if (isAtHorizontalBar) continue;
            if (!safeZoneCheck(x, y)) walls.push({x, y});
        }
    }
    
    // Create ghost house in the center
    const ghostHouseWidth = Math.floor(width / 5);
    const ghostHouseHeight = Math.floor(height / 6);
    const ghostHouseX = startX + Math.floor(width / 2) - Math.floor(ghostHouseWidth / 2);
    const ghostHouseY = startY + Math.floor(height / 2) - Math.floor(ghostHouseHeight / 2);
    
    if (!safeZoneCheck(ghostHouseX, ghostHouseY)) {
        for (let x = ghostHouseX; x < ghostHouseX + ghostHouseWidth; x++) {
            if (!safeZoneCheck(x, ghostHouseY)) walls.push({x, y: ghostHouseY});
            if (!safeZoneCheck(x, ghostHouseY + ghostHouseHeight)) walls.push({x, y: ghostHouseY + ghostHouseHeight});
        }
        
        for (let y = ghostHouseY; y <= ghostHouseY + ghostHouseHeight; y++) {
            if (!safeZoneCheck(ghostHouseX, y)) walls.push({x: ghostHouseX, y});
            if (!safeZoneCheck(ghostHouseX + ghostHouseWidth, y)) walls.push({x: ghostHouseX + ghostHouseWidth, y});
        }
        
        // Create doorway
        const doorX = ghostHouseX + Math.floor(ghostHouseWidth / 2);
        walls = walls.filter(w => !(w.x === doorX && w.y === ghostHouseY));
    }
}

// Function to add teleport tunnels 
function addPacManTeleportTunnels() {
    // For traditional snake game, we'll add teleport tunnels to the main room
    const centerX = Math.floor(GRID_SIZE / 2);
    const centerY = Math.floor(GRID_SIZE / 2);
    const safeZoneRadius = 50; // Define it locally to avoid reference error
    const roomSize = safeZoneRadius * 2;
    const roomStartX = centerX - roomSize / 2;
    const roomStartY = centerY - roomSize / 2;
    
    // Create teleport tunnel on the right side of the main room
    const tunnelHeight = 8;
    const tunnelY = roomStartY + Math.floor(roomSize / 2);
    
    // Right tunnel entrance in the room
    for (let y = tunnelY - tunnelHeight; y <= tunnelY + tunnelHeight; y++) {
        // Create tunnel opening
        walls = walls.filter(w => !(w.x === roomStartX + roomSize && w.y === y));
    }
    
    // Left tunnel entrance to match
    for (let y = tunnelY - tunnelHeight; y <= tunnelY + tunnelHeight; y++) {
        // Create tunnel opening
        walls = walls.filter(w => !(w.x === roomStartX && w.y === y));
    }
    
    // Add decorative walls around the teleport areas
    for (let i = 1; i <= 3; i++) {
        walls.push({x: roomStartX + roomSize + i, y: tunnelY - tunnelHeight - 1});
        walls.push({x: roomStartX + roomSize + i, y: tunnelY + tunnelHeight + 1});
        
        walls.push({x: roomStartX - i, y: tunnelY - tunnelHeight - 1});
        walls.push({x: roomStartX - i, y: tunnelY + tunnelHeight + 1});
    }
}

// Add a function to create grid patterns of walls
function addGridPattern(startX, startY, width, height, spacing) {
    const safeZoneX = Math.floor(GRID_SIZE / 2);
    const safeZoneY = Math.floor(GRID_SIZE / 2);
    const SAFE_ZONE_RADIUS = 50;
    
    const safeZoneCheck = (x, y) => {
        const dx = x - safeZoneX;
        const dy = y - safeZoneY;
        return Math.sqrt(dx*dx + dy*dy) < SAFE_ZONE_RADIUS * 1.5;
    };
    
    for (let x = startX; x < startX + width; x += spacing) {
        for (let y = startY; y < startY + height; y += spacing) {
            if (!safeZoneCheck(x, y)) {
                walls.push({x, y});
            }
        }
    }
}

function addMazeFormation(centerX, centerY, width, height) {
    const safeZoneX = Math.floor(GRID_SIZE / 2);
    const safeZoneY = Math.floor(GRID_SIZE / 2);
    const SAFE_ZONE_RADIUS = 50;
    
    const startX = centerX - width / 2;
    const startY = centerY - height / 2;
    
    // Create the outer wall
    for (let x = startX; x < startX + width; x++) {
        const dx = x - safeZoneX;
        const dy = startY - safeZoneY;
        if (Math.sqrt(dx*dx + dy*dy) >= SAFE_ZONE_RADIUS) {
            walls.push({x, y: startY});
        }
        
        const dy2 = (startY + height - 1) - safeZoneY;
        if (Math.sqrt(dx*dx + dy2*dy2) >= SAFE_ZONE_RADIUS) {
            walls.push({x, y: startY + height - 1});
        }
    }
    
    for (let y = startY; y < startY + height; y++) {
        const dx = startX - safeZoneX;
        const dy = y - safeZoneY;
        if (Math.sqrt(dx*dx + dy*dy) >= SAFE_ZONE_RADIUS) {
            walls.push({x: startX, y});
        }
        
        const dx2 = (startX + width - 1) - safeZoneX;
        if (Math.sqrt(dx2*dx2 + dy*dy) >= SAFE_ZONE_RADIUS) {
            walls.push({x: startX + width - 1, y});
        }
    }
    
    // Create internal maze walls
    const cells = 5; // Number of cells in the maze
    const cellWidth = Math.floor(width / cells);
    const cellHeight = Math.floor(height / cells);
    
    for (let i = 0; i < cells - 1; i++) {
        for (let j = 0; j < cells - 1; j++) {
            // Skip some cells randomly to create passages
            if (Math.random() < 0.3) continue;
            
            // Decide whether to create a horizontal or vertical wall
            const isHorizontal = Math.random() > 0.5;
            
            if (isHorizontal) {
                // Create horizontal wall
                const wallY = startY + (j + 1) * cellHeight;
                const wallStartX = startX + i * cellWidth;
                const wallLength = Math.floor(cellWidth * (0.5 + Math.random() * 0.5));
                
                for (let x = wallStartX; x < wallStartX + wallLength; x++) {
                    const dx = x - safeZoneX;
                    const dy = wallY - safeZoneY;
                    if (Math.sqrt(dx*dx + dy*dy) < SAFE_ZONE_RADIUS) continue;
                    
                    walls.push({x, y: wallY});
                }
            } else {
                // Create vertical wall
                const wallX = startX + (i + 1) * cellWidth;
                const wallStartY = startY + j * cellHeight;
                const wallLength = Math.floor(cellHeight * (0.5 + Math.random() * 0.5));
                
                for (let y = wallStartY; y < wallStartY + wallLength; y++) {
                    const dx = wallX - safeZoneX;
                    const dy = y - safeZoneY;
                    if (Math.sqrt(dx*dx + dy*dy) < SAFE_ZONE_RADIUS) continue;
                    
                    walls.push({x: wallX, y});
                }
            }
        }
    }
}

// Generate circular walls
function addCircularWalls(centerX, centerY, innerRadius, outerRadius) {
    const safeZoneRadius = 30; // Reduced from 50 to 30 for a more challenging game
    
    // Loop through a square area that contains the circle
    for (let x = centerX - outerRadius - 1; x <= centerX + outerRadius + 1; x++) {
        for (let y = centerY - outerRadius - 1; y <= centerY + outerRadius + 1; y++) {
            // Skip invalid coordinates
            if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) continue;
            
            // Calculate distance from center
            const dx = x - centerX;
            const dy = y - centerY;
            const distance = Math.sqrt(dx*dx + dy*dy);
            
            // Add wall if it's in the ring area
            if (distance >= innerRadius && distance <= outerRadius) {
                // Make sure it's not too close to the safe zone
                if (distance > safeZoneRadius) {
                    walls.push({x, y});
                }
            }
        }
    }
}

// Generate radial walls spreading from center
function addRadialWalls(centerX, centerY, minDist, maxDist, count) {
    const safeZoneRadius = 50;
    const angleStep = 2 * Math.PI / count;
    
    for (let i = 0; i < count; i++) {
        const angle = i * angleStep;
        
        for (let dist = minDist; dist <= maxDist; dist++) {
            const x = Math.floor(centerX + Math.cos(angle) * dist);
            const y = Math.floor(centerY + Math.sin(angle) * dist);
            
            // Skip invalid coordinates
            if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) continue;
            
            // Calculate distance from center to ensure we're not in the safe zone
            const dx = x - centerX;
            const dy = y - centerY;
            const distance = Math.sqrt(dx*dx + dy*dy);
            
            if (distance > safeZoneRadius) {
                walls.push({x, y});
            }
        }
    }
}

// Add spiral maze
function addSpiralMaze(centerX, centerY, size) {
    const safeZoneX = Math.floor(GRID_SIZE / 2);
    const safeZoneY = Math.floor(GRID_SIZE / 2);
    const safeZoneRadius = 50;
    
    const safeCheck = (x, y) => {
        const dx = x - safeZoneX;
        const dy = y - safeZoneY;
        return Math.sqrt(dx*dx + dy*dy) < safeZoneRadius * 1.2;
    };
    
    const maxRadius = size / 2;
    let radius = 5;
    let angle = 0;
    const angleIncrement = 0.25;  // Smaller value = tighter spiral
    
    while (radius <= maxRadius) {
        const x = Math.floor(centerX + Math.cos(angle) * radius);
        const y = Math.floor(centerY + Math.sin(angle) * radius);
        
        if (x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE && !safeCheck(x, y)) {
            walls.push({x, y});
        }
        
        angle += angleIncrement;
        radius = 5 + (angle / (2 * Math.PI)) * 3;
    }
    
    // Add an entry point (gap) at a random position
    const entryAngle = Math.random() * 2 * Math.PI;
    const entryRadius = 5 + Math.random() * (maxRadius - 10);
    
    for (let a = entryAngle - 0.5; a <= entryAngle + 0.5; a += 0.1) {
        const x = Math.floor(centerX + Math.cos(a) * entryRadius);
        const y = Math.floor(centerY + Math.sin(a) * entryRadius);
        
        if (x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE) {
            walls = walls.filter(wall => !(wall.x === x && wall.y === y));
        }
    }
}

// Generate walls once during server initialization
generateWalls();

console.log('Snake game server running on port 8080');
