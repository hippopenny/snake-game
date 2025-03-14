import { WebSocket, WebSocketServer } from 'ws';

const wss = new WebSocketServer({ port: 8080 });

// Game constants
const GRID_SIZE = 400; // Match the client's grid size
const SAFE_ZONE_RADIUS = 20; // Safe zone radius, used throughout the code
const MAX_SAFE_ZONE_FOOD = 12; // Limit total safe zone food
let currentSafeZoneFoodCount = 0; // Track current safe zone food count

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
            } else if (data.type === 'batchFoodRequest') {
                // Process batched food requests
                const requests = data.requests;
                
                if (requests && Array.isArray(requests)) {
                    requests.forEach(request => {
                        if (request.safeZoneFood && currentSafeZoneFoodCount >= MAX_SAFE_ZONE_FOOD) {
                            return;
                        }
                        
                        // Create food at the requested position
                        const food = {
                            x: request.x,
                            y: request.y,
                            createdAt: Date.now(),
                            blinking: false,
                            lifetime: BASE_FOOD_LIFETIME * 1.5, // Give safe zone food longer lifetime
                            countdown: Math.floor((BASE_FOOD_LIFETIME * 1.5) / 1000)
                        };
                        
                        // Determine food type
                        if (request.specialFood) {
                            // Special high-value food
                            if (request.powerUp) {
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
                                food.points = request.points || 20;
                                food.color = request.points >= 50 ? '#8BC34A' : '#FFC107';
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
                            if (request.safeZoneFood) {
                                currentSafeZoneFoodCount++;
                            }
                        }
                    });
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
    foods = foods.filter(food => {
        if (food.safeZoneFood) {
            currentSafeZoneFoodCount--;
        }
        return now - food.createdAt < food.lifetime;
    });

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

// Wall generation functions
function clearSafeZone() {
    const centerX = Math.floor(GRID_SIZE / 2);
    const centerY = Math.floor(GRID_SIZE / 2);
    const safeRadius = SAFE_ZONE_RADIUS * 0.7; 
    
    // Remove any walls within the safe zone
    walls = walls.filter(wall => {
        const dx = wall.x - centerX;
        const dy = wall.y - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        return distance > safeRadius;
    });
}

// Wall generation functions
function generateWalls() {
    walls = [];

    // Basic parameters
    const centerX = Math.floor(GRID_SIZE / 2);
    const centerY = Math.floor(GRID_SIZE / 2);
    
    // Define additional safe zones around teleport hubs
    const safeZones = [
        {x: 100, y: 100, radius: 20}, // Northwest hub
        {x: GRID_SIZE - 100, y: 100, radius: 20}, // Northeast hub
        {x: 100, y: GRID_SIZE - 100, radius: 20}, // Southwest hub
        {x: GRID_SIZE - 100, y: GRID_SIZE - 100, radius: 20} // Southeast hub
    ];
    
    // Expanded safe zone check that includes all safe zones
    const isSafe = (x, y) => {
        // Check main center safe zone
        const dxCenter = x - centerX;
        const dyCenter = y - centerY;
        if (Math.sqrt(dxCenter*dxCenter + dyCenter*dyCenter) < SAFE_ZONE_RADIUS * 1.2) {
            return true;
        }
        
        // Check teleport hub safe zones
        for (const zone of safeZones) {
            const dx = x - zone.x;
            const dy = y - zone.y;
            if (Math.sqrt(dx*dx + dy*dy) < zone.radius) {
                return true;
            }
        }
        
        return false;
    };
    
    // Create outer border walls with varied patterns and openings
    const border = 20; 
    
    // Add horizontal border walls with different patterns
    for (let x = border; x < GRID_SIZE - border; x += 2) {
        if (isSafe(x, border)) continue; // Skip safe zone
        if (isSafe(x, GRID_SIZE - border - 1)) continue; // Skip safe zone
        // Create different wall patterns based on position
        if (x % 8 === 0) {
            // Create decorative column with double thickness
            walls.push({x, y: border});
            walls.push({x, y: border - 1});
            walls.push({x, y: GRID_SIZE - border - 1});
            walls.push({x, y: GRID_SIZE - border - 2});
        } else if (x % 15 === 0) {
            // Create larger opening
            continue;
        } else {
            // Standard wall segments with small gaps
            walls.push({x, y: border});
            walls.push({x, y: GRID_SIZE - border - 1});
        }
    }
    
    // Add vertical border walls with varied patterns
    for (let y = border; y < GRID_SIZE - border; y += 2) {
        // Create different wall patterns based on position
        if (y % 8 === 0) {
            // Create decorative row with double thickness
            if (!isSafe(border, y)) {
                walls.push({x: border, y});
                walls.push({x: border - 1, y});
            }
            if (!isSafe(GRID_SIZE - border - 1, y)) {
                walls.push({x: GRID_SIZE - border - 1, y});
                walls.push({x: GRID_SIZE - border - 2, y});
            }
        } else if (y % 15 === 0) {
            // Create larger opening
            continue;
        } else {
            // Standard wall segments with small gaps
            if (!isSafe(border, y)) walls.push({x: border, y});
            if (!isSafe(GRID_SIZE - border - 1, y)) walls.push({x: GRID_SIZE - border - 1, y});
        }
    }
    
    // Create the safe zone at the center with enhanced visual design
    const safeRoomSize = SAFE_ZONE_RADIUS * 2; 
    const safeRoomStartX = centerX - safeRoomSize / 2;
    const safeRoomStartY = centerY - safeRoomSize / 2;
    
    // Add safe room walls with distinctive entrance patterns on all sides
    
    // Top and bottom walls with patterned openings
    const topEntranceStart = safeRoomStartX + Math.floor(safeRoomSize * 0.4);
    const topEntranceEnd = safeRoomStartX + Math.floor(safeRoomSize * 0.6);
    for (let x = safeRoomStartX; x < safeRoomStartX + safeRoomSize; x++) {
        if (x < topEntranceStart || x > topEntranceEnd) {
            // Add decorative wall patterns
            if ((x - safeRoomStartX) % 3 === 0) {
                // Create double-thickness decorative elements
                walls.push({x, y: safeRoomStartY - 1});
                walls.push({x, y: safeRoomStartY + safeRoomSize + 1});
            }
            walls.push({x, y: safeRoomStartY});
            walls.push({x, y: safeRoomStartY + safeRoomSize});
        } else {
            // Create distinctive gateway pattern at entrances
            if ((x - topEntranceStart) % 3 === 0) {
                walls.push({x, y: safeRoomStartY});
                walls.push({x, y: safeRoomStartY + safeRoomSize});
            }
            // Add visual gateway markers
            if (x === topEntranceStart || x === topEntranceEnd) {
                walls.push({x, y: safeRoomStartY - 2});
                walls.push({x, y: safeRoomStartY + safeRoomSize + 2});
            }
        }
    }
    
    // Left and right walls with distinctive openings
    const sideEntranceStart = safeRoomStartY + Math.floor(safeRoomSize * 0.4);
    const sideEntranceEnd = safeRoomStartY + Math.floor(safeRoomSize * 0.6);
    for (let y = safeRoomStartY; y < safeRoomStartY + safeRoomSize; y++) {
        if (y < sideEntranceStart || y > sideEntranceEnd) {
            // Add decorative wall patterns
            if ((y - safeRoomStartY) % 3 === 0) {
                // Create double-thickness decorative elements
                walls.push({x: safeRoomStartX - 1, y});
                walls.push({x: safeRoomStartX + safeRoomSize + 1, y});
            }
            walls.push({x: safeRoomStartX, y});
            walls.push({x: safeRoomStartX + safeRoomSize, y});
        } else {
            // Create distinctive gateway pattern at entrances
            if ((y - sideEntranceStart) % 3 === 0) {
                walls.push({x: safeRoomStartX, y});
                walls.push({x: safeRoomStartX + safeRoomSize, y});
            }
            // Add visual gateway markers
            if (y === sideEntranceStart || y === sideEntranceEnd) {
                walls.push({x: safeRoomStartX - 2, y});
                walls.push({x: safeRoomStartX + safeRoomSize + 2, y});
            }
        }
    }
    
    // Add distinctive corner decorations for visual interest
    // Top-left corner decoration
    createCornerDecoration(safeRoomStartX, safeRoomStartY, "top-left");
    // Top-right corner decoration
    createCornerDecoration(safeRoomStartX + safeRoomSize, safeRoomStartY, "top-right");
    // Bottom-left corner decoration
    createCornerDecoration(safeRoomStartX, safeRoomStartY + safeRoomSize, "bottom-left");
    // Bottom-right corner decoration
    createCornerDecoration(safeRoomStartX + safeRoomSize, safeRoomStartY + safeRoomSize, "bottom-right");

    // Generate enhanced room-based layout without adding cross patterns in the safe zone
    createRoomBasedLayout();
    
    // Add random connecting walls between regions
    addRandomConnectingWalls();
    
    // Add enhanced teleport tunnels with visual markers for quick travel
    addTeleportTunnels();
    
    // Add teleport hubs at strategic locations
    addTeleportHubs();

    clearSafeZone();
}

// Function to create decorative corner patterns
function createCornerDecoration(x, y, position) {
    const size = 4;
    
    // Create different corner decorations based on position
    switch(position) {
        case "top-left":
            for (let i = 0; i < size; i++) {
                walls.push({x: x - i, y: y - i});
            }
            break;
        case "top-right":
            for (let i = 0; i < size; i++) {
                walls.push({x: x + i, y: y - i});
            }
            break;
        case "bottom-left":
            for (let i = 0; i < size; i++) {
                walls.push({x: x - i, y: y + i});
            }
            break;
        case "bottom-right":
            for (let i = 0; i < size; i++) {
                walls.push({x: x + i, y: y + i});
            }
            break;
    }
}

// Function to add random connecting walls between different regions
function addRandomConnectingWalls() {
    console.log("Adding random connecting walls between regions...");
    
    // Define regions to connect
    const regions = [
        // Quadrant boundaries
        {x1: 50, y1: 50, x2: GRID_SIZE/2 - 50, y2: GRID_SIZE/2 - 50}, // Northwest
        {x1: GRID_SIZE/2 + 50, y1: 50, x2: GRID_SIZE - 50, y2: GRID_SIZE/2 - 50}, // Northeast
        {x1: 50, y1: GRID_SIZE/2 + 50, x2: GRID_SIZE/2 - 50, y2: GRID_SIZE - 50}, // Southwest
        {x1: GRID_SIZE/2 + 50, y1: GRID_SIZE/2 + 50, x2: GRID_SIZE - 50, y2: GRID_SIZE - 50} // Southeast
    ];
    
    // Create different types of connecting walls
    const wallTypes = ["zigzag", "dotted", "solid", "dashed"];
    
    // Connect regions with different wall types
    for (let i = 0; i < regions.length; i++) {
        const startRegion = regions[i];
        const endRegion = regions[(i + 1) % regions.length];
        
        // Choose start and end points
        const startX = Math.floor(startRegion.x1 + Math.random() * (startRegion.x2 - startRegion.x1));
        const startY = Math.floor(startRegion.y1 + Math.random() * (startRegion.y2 - startRegion.y1));
        const endX = Math.floor(endRegion.x1 + Math.random() * (endRegion.x2 - endRegion.x1));
        const endY = Math.floor(endRegion.y1 + Math.random() * (endRegion.y2 - endRegion.y1));
        
        // Choose a random wall type
        const wallType = wallTypes[Math.floor(Math.random() * wallTypes.length)];
        
        // Create connecting wall
        createConnectingWall(startX, startY, endX, endY, wallType);
    }
    
    // Add a few more random connections
    for (let i = 0; i < 5; i++) {
        const startRegionIdx = Math.floor(Math.random() * regions.length);
        let endRegionIdx;
        do {
            endRegionIdx = Math.floor(Math.random() * regions.length);
        } while (endRegionIdx === startRegionIdx);
        
        const startRegion = regions[startRegionIdx];
        const endRegion = regions[endRegionIdx];
        
        // Choose start and end points
        const startX = Math.floor(startRegion.x1 + Math.random() * (startRegion.x2 - startRegion.x1));
        const startY = Math.floor(startRegion.y1 + Math.random() * (startRegion.y2 - startRegion.y1));
        const endX = Math.floor(endRegion.x1 + Math.random() * (endRegion.x2 - endRegion.x1));
        const endY = Math.floor(endRegion.y1 + Math.random() * (endRegion.y2 - endRegion.y1));
        
        // Choose a random wall type
        const wallType = wallTypes[Math.floor(Math.random() * wallTypes.length)];
        
        // Create connecting wall
        createConnectingWall(startX, startY, endX, endY, wallType);
    }
}

// Function to create connecting walls with different visual styles
function createConnectingWall(startX, startY, endX, endY, type) {
    // Calculate direction vector
    const dx = endX - startX;
    const dy = endY - startY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Calculate step sizes
    const steps = Math.ceil(distance);
    const stepX = dx / steps;
    const stepY = dy / steps;
    
    // Create walls based on type
    switch (type) {
        case "zigzag":
            // Create zigzag pattern
            let zigWidth = 5;
            for (let i = 0; i <= steps; i++) {
                const t = i / steps;
                const offset = Math.sin(t * 10) * zigWidth;
                const perpX = -dy / distance;
                const perpY = dx / distance;
                
                const x = Math.floor(startX + dx * t + perpX * offset);
                const y = Math.floor(startY + dy * t + perpY * offset);
                
                // Add wall segment
                walls.push({x, y});
                
                // Add occasional perpendicular segments for visual interest
                if (i % 10 === 0) {
                    walls.push({x: x + Math.floor(perpX * 2), y: y + Math.floor(perpY * 2)});
                    walls.push({x: x - Math.floor(perpX * 2), y: y - Math.floor(perpY * 2)});
                }
            }
            break;
            
        case "dotted":
            // Create dotted path
            for (let i = 0; i <= steps; i += 3) {
                const x = Math.floor(startX + stepX * i);
                const y = Math.floor(startY + stepY * i);
                
                // Add dot (2x2 wall segment)
                walls.push({x, y});
                if (i % 9 === 0) {
                    walls.push({x: x+1, y});
                    walls.push({x, y: y+1});
                    walls.push({x: x+1, y: y+1});
                }
            }
            break;
            
        case "solid":
            // Create solid wall
            for (let i = 0; i <= steps; i++) {
                const x = Math.floor(startX + stepX * i);
                const y = Math.floor(startY + stepY * i);
                walls.push({x, y});
                
                // Add thickness for visual interest
                if (i % 5 === 0) {
                    const perpX = Math.floor(-dy / distance);
                    const perpY = Math.floor(dx / distance);
                    walls.push({x: x + perpX, y: y + perpY});
                }
            }
            break;
            
        case "dashed":
            // Create dashed wall
            for (let i = 0; i <= steps; i++) {
                // Only add wall segment for certain intervals
                if (Math.floor(i / 5) % 2 === 0) {
                    const x = Math.floor(startX + stepX * i);
                    const y = Math.floor(startY + stepY * i);
                    walls.push({x, y});
                }
            }
            break;
    }
    
    // Add openings in the wall for passage
    const numOpenings = 1 + Math.floor(Math.random() * 3); // 1-3 openings
    
    for (let i = 0; i < numOpenings; i++) {
        const openingPos = 0.2 + Math.random() * 0.6; // Opening position (20-80% along the wall)
        const openingX = Math.floor(startX + dx * openingPos);
        const openingY = Math.floor(startY + dy * openingPos);
        
        // Clear walls around the opening
        const openingSize = 1 + Math.floor(Math.random() * 2); // 1-2 cell opening
        for (let ox = -openingSize; ox <= openingSize; ox++) {
            for (let oy = -openingSize; oy <= openingSize; oy++) {
                walls = walls.filter(w => !(w.x === openingX + ox && w.y === openingY + oy));
            }
        }
        
        // Add food near opening as a visual marker
        let food = generateNewFood();
        food.x = openingX;
        food.y = openingY;
        food.points = 20;
        food.color = '#FFC107';
        foods.push(food);
    }
}

// Create interconnecting tunnels between different regions of the map
function createConnectingTunnels() {
    console.log("Creating connecting tunnels between regions...");
    
    // Define connection points between different regions of the map
    const connectionPoints = [
        // Northwest (spiral) to Northeast (grid rooms)
        {
            start: {x: 170, y: 100},
            end: {x: 230, y: 100},
            width: 3
        },
        // Northwest (spiral) to Southwest (random curved)
        {
            start: {x: 100, y: 170},
            end: {x: 100, y: 230},
            width: 3
        },
        // Northeast (grid) to Southeast (labyrinth)
        {
            start: {x: 300, y: 170},
            end: {x: 300, y: 230},
            width: 3
        },
        // Southwest (curves) to Southeast (labyrinth)
        {
            start: {x: 170, y: 300},
            end: {x: 230, y: 300},
            width: 3
        },
        // Diagonal connection (Northwest to Southeast)
        {
            start: {x: 140, y: 140},
            end: {x: 260, y: 260},
            width: 2
        }
    ];
    
    // Create each tunnel connection
    connectionPoints.forEach(connection => {
        const {start, end, width} = connection;
        
        // Determine direction vector
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const distance = Math.sqrt(dx*dx + dy*dy);
        
        // Create tunnel by removing walls along the path
        for (let i = 0; i <= distance; i++) {
            const t = i / distance;
            const x = Math.floor(start.x + dx * t);
            const y = Math.floor(start.y + dy * t);
            
            // Clear walls in a tunnel of specified width
            for (let w = -width; w <= width; w++) {
                // Calculate perpendicular offset
                const perpX = Math.floor(w * dy / distance);
                const perpY = Math.floor(-w * dx / distance);
                
                // Remove wall at this position
                walls = walls.filter(wall => 
                    !(wall.x === x + perpX && wall.y === y + perpY));
            }
            
            // Add food along the tunnel path occasionally
            if (i % 10 === 0 && Math.random() < 0.4) {
                let food = generateNewFood();
                food.x = x;
                food.y = y;
                food.points = 15;
                food.color = '#FF9800';
                foods.push(food);
            }
        }
        
        // Add indicator markers at tunnel entrances
        addTunnelMarkers(start.x, start.y, end.x, end.y);
    });
}

// Add visual indicators at tunnel entrances
function addTunnelMarkers(startX, startY, endX, endY) {
    // Create distinct markers at both ends of the tunnel
    const createMarker = (x, y) => {
        // Create a small diamond pattern
        walls.push({x: x+2, y});
        walls.push({x: x-2, y});
        walls.push({x, y: y+2});
        walls.push({x, y: y-2});
        
        // Add special food as a beacon
        let food = generateNewFood();
        food.x = x;
        food.y = y;
        food.points = 20;
        food.color = '#4CAF50'; // Green marker food
        foods.push(food);
    };
    
    // Create markers slightly offset from the actual tunnel entrances
    const dx = endX - startX;
    const dy = endY - startY;
    const distance = Math.sqrt(dx*dx + dy*dy);
    const normalizedDx = dx / distance;
    const normalizedDy = dy / distance;
    
    // Place markers 5 units away from the tunnel entrances
    const startMarkerX = Math.floor(startX - normalizedDx * 5);
    const startMarkerY = Math.floor(startY - normalizedDy * 5);
    const endMarkerX = Math.floor(endX + normalizedDx * 5);
    const endMarkerY = Math.floor(endY + normalizedDy * 5);
    
    // Create the markers
    createMarker(startMarkerX, startMarkerY);
    createMarker(endMarkerX, endMarkerY);
}

// Create a room-based layout with simpler navigation
function createRoomBasedLayout() {
    console.log("Creating room-based layout with narrow corridors...");
    const centerX = Math.floor(GRID_SIZE / 2);
    const centerY = Math.floor(GRID_SIZE / 2);
    
    // Ensure safe space around starting point
    const minSafeDistance = 20;
    const safeZoneRadius = SAFE_ZONE_RADIUS;
    
    // Define the main room regions - make them more separated with increased distance from center
    const regions = [
        { name: "northwest", x: 40, y: 40, width: centerX - 80 - minSafeDistance, height: centerY - 80 - minSafeDistance },
        { name: "northeast", x: centerX + 40 + minSafeDistance, y: 40, width: GRID_SIZE - centerX - 80 - minSafeDistance, height: centerY - 80 - minSafeDistance },
        { name: "southwest", x: 40, y: centerY + 40 + minSafeDistance, width: centerX - 80 - minSafeDistance, height: GRID_SIZE - centerY - 80 - minSafeDistance },
        { name: "southeast", x: centerX + 40 + minSafeDistance, y: centerY + 40 + minSafeDistance, width: GRID_SIZE - centerX - 80 - minSafeDistance, height: GRID_SIZE - centerY - 80 - minSafeDistance }
    ];
    
    // Create different room layouts in each region - more challenging versions
    regions.forEach(region => {
        switch(region.name) {
            case "northwest":
                createComplexCircularRoomLayout(region.x, region.y, region.width, region.height);
                break;
            case "northeast": 
                createDenseGridRooms(region.x, region.y, region.width, region.height);
                break;
            case "southwest":
                createMazeWithObstacles(region.x, region.y, region.width, region.height);
                break;
            case "southeast":
                createLabyrinth(region.x, region.y, region.width, region.height);
                break;
        }
    });
    
    // Create narrow corridors connecting the safe zone to each region
    createNarrowCorridors(centerX, centerY);
}

// Function to create narrow corridors connecting safe zone to each region
function createNarrowCorridors(centerX, centerY) {
    console.log("Creating narrow corridors from safe zone to regions...");
    
    // Define corridor directions and endpoints (relative to center)
    const corridors = [
        { dx: -1, dy: -1, length: 40 }, // Northwest
        { dx: 1, dy: -1, length: 40 },  // Northeast
        { dx: -1, dy: 1, length: 40 },  // Southwest
        { dx: 1, dy: 1, length: 40 }    // Southeast
    ];
    
    // Create each corridor
    corridors.forEach(corridor => {
        const angle = Math.atan2(corridor.dy, corridor.dx);
        const corridorWidth = 2; // Make corridors narrow (2 cells wide)
        
        // Start offset from center to avoid overlapping with safe zone
        // Ensure at least 20 cells of safe space around starting point
        const safeZoneRadius = Math.max(SAFE_ZONE_RADIUS, 20);
        const startOffset = safeZoneRadius + 5;
        
        // Create corridor with some zig-zag patterns
        let lastDirection = 0;
        for (let i = startOffset; i <= corridor.length + startOffset; i++) {
            // Calculate base position
            let x = Math.floor(centerX + i * corridor.dx);
            let y = Math.floor(centerY + i * corridor.dy);
            
            // Add some zig-zag pattern every 8-10 cells
            if (i % 10 === 0) {
                lastDirection = (lastDirection + 1) % 2; // Toggle between 0 and 1
                const zigAmount = lastDirection === 0 ? 2 : -2;
                
                // Apply zig-zag offset perpendicular to the corridor direction
                x += Math.floor(zigAmount * Math.cos(angle + Math.PI/2));
                y += Math.floor(zigAmount * Math.sin(angle + Math.PI/2));
            }
            
            // Clear walls in the narrow corridor width
            for (let w = -corridorWidth; w <= corridorWidth; w++) {
                const perpX = Math.floor(x + w * Math.cos(angle + Math.PI/2));
                const perpY = Math.floor(y + w * Math.sin(angle + Math.PI/2));
                
                walls = walls.filter(wall => !(wall.x === perpX && wall.y === perpY));
            }
            
            // Add walls on corridor edges to reinforce the narrow feeling
            if (i % 3 === 0) {
                const edgeX1 = Math.floor(x + (corridorWidth + 1) * Math.cos(angle + Math.PI/2));
                const edgeY1 = Math.floor(y + (corridorWidth + 1) * Math.sin(angle + Math.PI/2));
                const edgeX2 = Math.floor(x - (corridorWidth + 1) * Math.cos(angle + Math.PI/2));
                const edgeY2 = Math.floor(y - (corridorWidth + 1) * Math.sin(angle + Math.PI/2));
                
                walls.push({x: edgeX1, y: edgeY1});
                walls.push({x: edgeX2, y: edgeY2});
            }
            
            // Add food along the corridor, but less frequently in narrow passages
            if (i % 15 === 0 && Math.random() < 0.4) {
                let food = generateNewFood();
                food.x = x;
                food.y = y;
                food.points = 15;
                food.color = '#FF9800';
                foods.push(food);
            }
        }
    });
}

// Create a more complex circular room layout with narrower passages
function createComplexCircularRoomLayout(startX, startY, width, height) {
    console.log(`Creating complex circular maze at (${startX},${startY}) with size ${width}x${height}`);
    
    // Parameters for the concentric rings
    const centerX = startX + Math.floor(width / 2);
    const centerY = startY + Math.floor(height / 2);
    const maxRadius = Math.min(width, height) / 2 - 10;
    const ringSpacing = 12; // Closer rings for narrower passages
    const rings = Math.floor(maxRadius / ringSpacing);
    
    // Create rings with only small gaps at random positions
    for (let i = 1; i <= rings; i++) {
        const radius = i * ringSpacing;
        
        // Each ring has only 2 small gaps at semi-random positions
        const gap1Start = Math.random() * Math.PI * 2;
        const gap2Start = gap1Start + Math.PI; // Opposite side
        const gapWidth = 0.15; // Smaller gaps
        
        // Place ring segments with small gaps
        for (let angle = 0; angle < 2 * Math.PI; angle += 0.05) {
            // Check if this angle is within one of our gaps
            const isInGap1 = Math.abs((angle - gap1Start + 2 * Math.PI) % (2 * Math.PI)) < gapWidth;
            const isInGap2 = Math.abs((angle - gap2Start + 2 * Math.PI) % (2 * Math.PI)) < gapWidth;
            
            if (!isInGap1 && !isInGap2) {
                const x = Math.floor(centerX + radius * Math.cos(angle));
                const y = Math.floor(centerY + radius * Math.sin(angle));
                
                // Ensure we're within bounds
                if (x >= startX && x < startX + width && y >= startY && y < startY + height) {
                    walls.push({x, y});
                }
            }
        }
        
        // For some rings, add radial walls connecting to adjacent rings
        if (i > 1 && i < rings && i % 2 === 1) {
            for (let angle = 0; angle < 2 * Math.PI; angle += Math.PI / 6) {
                // Skip if angle is near a gap
                const isNearGap1 = Math.abs((angle - gap1Start + 2 * Math.PI) % (2 * Math.PI)) < gapWidth * 2;
                const isNearGap2 = Math.abs((angle - gap2Start + 2 * Math.PI) % (2 * Math.PI)) < gapWidth * 2;
                
                if (!isNearGap1 && !isNearGap2) {
                    // Create radial wall segment
                    const innerRadius = (i - 1) * ringSpacing;
                    const outerRadius = i * ringSpacing;
                    
                    for (let r = innerRadius; r <= outerRadius; r++) {
                        const x = Math.floor(centerX + r * Math.cos(angle));
                        const y = Math.floor(centerY + r * Math.sin(angle));
                        walls.push({x, y});
                    }
                }
            }
        }
    }
    
    // Create only one or two narrow passages to the center
    const pathAngles = [Math.PI / 4, Math.PI * 5/4]; // NE and SW paths
    for (let angleIndex = 0; angleIndex < pathAngles.length; angleIndex++) {
        const angle = pathAngles[angleIndex];
        // Create narrow zigzag path instead of straight line
        let currentAngle = angle;
        for (let r = maxRadius; r > 0; r -= 5) {
            // Zigzag the path slightly
            currentAngle += (Math.random() - 0.5) * 0.2;
            
            // Clear a narrow path (1 cell wide)
            const x = Math.floor(centerX + r * Math.cos(currentAngle));
            const y = Math.floor(centerY + r * Math.sin(currentAngle));
            walls = walls.filter(wall => !(wall.x === x && wall.y === y));
        }
    }
    
    // Create a secure inner chamber with high-value rewards
    const innerRadius = 8;
    for (let angle = 0; angle < 2 * Math.PI; angle += 0.05) {
        const x = Math.floor(centerX + innerRadius * Math.cos(angle));
        const y = Math.floor(centerY + innerRadius * Math.sin(angle));
        walls.push({x, y});
    }
    
    // Create exactly one entrance to the center
    const entranceAngle = Math.PI / 4; // Northeast entrance
    const entranceX = Math.floor(centerX + innerRadius * Math.cos(entranceAngle));
    const entranceY = Math.floor(centerY + innerRadius * Math.sin(entranceAngle));
    walls = walls.filter(wall => !(wall.x === entranceX && wall.y === entranceY));
    
    // Add valuable rewards in the center
    for (let i = 0; i < 2; i++) {
        // Place them more exactly to ensure they're in the chamber
        const angle = i * Math.PI;
        const radius = innerRadius / 2;
        const foodX = Math.floor(centerX + radius * Math.cos(angle));
        const foodY = Math.floor(centerY + radius * Math.sin(angle));
        
        let food = generateNewFood();
        food.x = foodX;
        food.y = foodY;
        
        // Random power-up as reward
        const powerUpTypes = ['speed_boost', 'invincibility', 'magnet'];
        const randomPowerUp = powerUpTypes[Math.floor(Math.random() * powerUpTypes.length)];
        food.powerUp = randomPowerUp;
        food.duration = 15000;
        food.points = 50; // Higher value
        
        switch (randomPowerUp) {
            case 'speed_boost': food.color = '#00BCD4'; break;
            case 'invincibility': food.color = '#9C27B0'; break;
            case 'magnet': food.color = '#FFEB3B'; break;
        }
        
        foods.push(food);
    }
    
    // Add regular food at specific positions along rings for fairness
    for (let i = 1; i <= rings; i++) {
        const radius = i * ringSpacing;
        
        // Place food at 4 positions (instead of 8) around each ring
        for (let j = 0; j < 4; j++) {
            const angle = j * Math.PI / 2;
            const foodX = Math.floor(centerX + radius * Math.cos(angle));
            const foodY = Math.floor(centerY + radius * Math.sin(angle));
            
            // Skip food placement if there's a wall here
            const isWall = walls.some(wall => wall.x === foodX && wall.y === foodY);
            if (!isWall) {
                let food = generateNewFood();
                food.x = foodX;
                food.y = foodY;
                food.points = 10 + i * 5;
                food.color = '#FFC107';
                foods.push(food);
            }
        }
    }
}

// Create dense grid of smaller, more challenging interconnected rooms
function createDenseGridRooms(startX, startY, width, height) {
    console.log(`Creating dense grid rooms at (${startX},${startY}) with size ${width}x${height}`);
    
    const roomsX = 3; // More, smaller rooms
    const roomsY = 3; 
    const roomWidth = Math.floor(width / roomsX);
    const roomHeight = Math.floor(height / roomsY);
    
    // Track which rooms have doorways to create a deliberate maze pattern
    const doorways = [];
    
    // Create rooms
    for (let x = 0; x < roomsX; x++) {
        for (let y = 0; y < roomsY; y++) {
            const roomStartX = startX + x * roomWidth;
            const roomStartY = startY + y * roomHeight;
            
            // Create solid walls without gaps
            for (let wx = roomStartX; wx < roomStartX + roomWidth; wx++) {
                walls.push({x: wx, y: roomStartY});
                walls.push({x: wx, y: roomStartY + roomHeight - 1});
            }
            
            for (let wy = roomStartY; wy < roomStartY + roomHeight; wy++) {
                walls.push({x: roomStartX, y: wy});
                walls.push({x: roomStartX + roomWidth - 1, y: wy});
            }
            
            // Add a complex feature to each room
            const featureType = Math.floor(Math.random() * 4); // Four feature types for variety
            switch(featureType) {
                case 0: // Obstacle course
                    createObstacleCourse(roomStartX, roomStartY, roomWidth, roomHeight);
                    break;
                case 1: // Spiral pattern 
                    createRoomSpiral(roomStartX, roomStartY, roomWidth, roomHeight);
                    break;
                case 2: // Central chamber with treasure
                    createTreasureChamber(roomStartX, roomStartY, roomWidth, roomHeight);
                    break;
                case 3: // Zigzag walls
                    createZigzagWalls(roomStartX, roomStartY, roomWidth, roomHeight);
                    break;
            }
        }
    }
    
    // Create a maze-like connection pattern between rooms
    // Use a simple version of depth-first search maze algorithm
    const visited = new Array(roomsX).fill(0).map(() => new Array(roomsY).fill(false));
    
    function createMazeConnections(x, y) {
        visited[x][y] = true;
        
        // Define potential directions: East, South, West, North
        const directions = [
            {dx: 1, dy: 0, doorDir: 'east'}, 
            {dx: 0, dy: 1, doorDir: 'south'},
            {dx: -1, dy: 0, doorDir: 'west'},
            {dx: 0, dy: -1, doorDir: 'north'}
        ];
        
        // Shuffle directions for randomness
        for (let i = directions.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [directions[i], directions[j]] = [directions[j], directions[i]];
        }
        
        // Try each direction
        for (const dir of directions) {
            const nx = x + dir.dx;
            const ny = y + dir.dy;
            
            // Check if new position is valid and unvisited
            if (nx >= 0 && nx < roomsX && ny >= 0 && ny < roomsY && !visited[nx][ny]) {
                // Create a doorway between current room and next room
                const currentRoomX = startX + x * roomWidth;
                const currentRoomY = startY + y * roomHeight;
                const nextRoomX = startX + nx * roomWidth;
                const nextRoomY = startY + ny * roomHeight;
                
                // Create narrow doorway (1 cell width)
                if (dir.doorDir === 'east') {
                    const doorY = currentRoomY + Math.floor(roomHeight / 2);
                    walls = walls.filter(wall => 
                        !(wall.x === currentRoomX + roomWidth - 1 && wall.y === doorY));
                    doorways.push({x: currentRoomX + roomWidth - 1, y: doorY});
                } else if (dir.doorDir === 'south') {
                    const doorX = currentRoomX + Math.floor(roomWidth / 2);
                    walls = walls.filter(wall => 
                        !(wall.x === doorX && wall.y === currentRoomY + roomHeight - 1));
                    doorways.push({x: doorX, y: currentRoomY + roomHeight - 1});
                } else if (dir.doorDir === 'west') {
                    const doorY = nextRoomY + Math.floor(roomHeight / 2);
                    walls = walls.filter(wall => 
                        !(wall.x === nextRoomX && wall.y === doorY));
                    doorways.push({x: nextRoomX, y: doorY});
                } else if (dir.doorDir === 'north') {
                    const doorX = nextRoomX + Math.floor(roomWidth / 2);
                    walls = walls.filter(wall => 
                        !(wall.x === doorX && wall.y === nextRoomY));
                    doorways.push({x: doorX, y: nextRoomY});
                }
                
                // Continue creating the maze
                createMazeConnections(nx, ny);
            }
        }
    }
    
    // Start creating maze connections from the center room
    createMazeConnections(Math.floor(roomsX/2), Math.floor(roomsY/2));
    
    // Make sure all rooms are connected by adding a few more random doorways if needed
    for (let x = 0; x < roomsX; x++) {
        for (let y = 0; y < roomsY; y++) {
            if (!visited[x][y]) {
                // Connect isolated rooms to a random adjacent room
                const adjacent = [];
                if (x > 0) adjacent.push({x: x-1, y: y, dir: 'west'});
                if (x < roomsX-1) adjacent.push({x: x+1, y: y, dir: 'east'});
                if (y > 0) adjacent.push({x: x, y: y-1, dir: 'north'});
                if (y < roomsY-1) adjacent.push({x: x, y: y+1, dir: 'south'});
                
                if (adjacent.length > 0) {
                    const connection = adjacent[Math.floor(Math.random() * adjacent.length)];
                    
                    // Create doorway based on direction
                    const currentRoomX = startX + x * roomWidth;
                    const currentRoomY = startY + y * roomHeight;
                    
                    if (connection.dir === 'west') {
                        const doorY = currentRoomY + Math.floor(roomHeight / 2);
                        walls = walls.filter(wall => 
                            !(wall.x === currentRoomX && wall.y === doorY));
                    } else if (connection.dir === 'east') {
                        const doorY = currentRoomY + Math.floor(roomHeight / 2);
                        walls = walls.filter(wall => 
                            !(wall.x === currentRoomX + roomWidth - 1 && wall.y === doorY));
                    } else if (connection.dir === 'north') {
                        const doorX = currentRoomX + Math.floor(roomWidth / 2);
                        walls = walls.filter(wall => 
                            !(wall.x === doorX && wall.y === currentRoomY));
                    } else if (connection.dir === 'south') {
                        const doorX = currentRoomX + Math.floor(roomWidth / 2);
                        walls = walls.filter(wall => 
                            !(wall.x === doorX && wall.y === currentRoomY + roomHeight - 1));
                    }
                    
                    visited[x][y] = true;
                }
            }
        }
    }
    
    // Add food rewards near doorways to guide players
    doorways.forEach(door => {
        let food = generateNewFood();
        food.x = door.x;
        food.y = door.y;
        food.points = 20;
        food.color = '#FF9800';
        foods.push(food);
    });
}

// Create an obstacle course pattern inside a room
function createObstacleCourse(startX, startY, width, height) {
    const padding = 5;
    const innerStartX = startX + padding;
    const innerStartY = startY + padding;
    const innerWidth = width - padding * 2;
    const innerHeight = height - padding * 2;
    
    // Create zigzag pattern of walls across the room
    const zigzagCount = Math.floor(innerHeight / 10);
    const spacing = Math.floor(innerHeight / zigzagCount);
    
    for (let i = 0; i < zigzagCount; i++) {
        const y = innerStartY + i * spacing;
        
        // Alternate between walls from left and right
        if (i % 2 === 0) {
            // Wall from left with gap on right
            for (let x = innerStartX; x < innerStartX + innerWidth * 0.8; x++) {
                walls.push({x, y});
            }
        } else {
            // Wall from right with gap on left
            for (let x = innerStartX + innerWidth * 0.2; x < innerStartX + innerWidth; x++) {
                walls.push({x, y});
            }
        }
    }
    
    // Add food rewards at strategic points
    for (let i = 0; i < zigzagCount; i++) {
        const y = innerStartY + i * spacing + Math.floor(spacing / 2);
        let x;
        
        if (i % 2 === 0) {
            x = innerStartX + innerWidth * 0.9; // Right side
        } else {
            x = innerStartX + innerWidth * 0.1; // Left side
        }
        
        let food = generateNewFood();
        food.x = x;
        food.y = y;
        food.points = 15;
        food.color = '#FF9800';
        foods.push(food);
    }
}

// Create a spiral pattern inside a room
function createRoomSpiral(startX, startY, width, height) {
    const centerX = startX + Math.floor(width / 2);
    const centerY = startY + Math.floor(height / 2);
    const maxRadius = Math.min(Math.floor(width / 2), Math.floor(height / 2)) - 3;
    
    // Create spiral wall
    const spacing = 3; // Spacing between spiral arms
    for (let radius = maxRadius; radius > 0; radius -= spacing) {
        const steps = Math.ceil(radius * 2 * Math.PI / 2); // Number of points to draw
        const angleStep = 2 * Math.PI / steps;
        
        for (let i = 0; i < steps; i++) {
            const angle = i * angleStep + (maxRadius - radius) * 0.5; // Spiral effect
            const x = Math.floor(centerX + radius * Math.cos(angle));
            const y = Math.floor(centerY + radius * Math.sin(angle));
            
            // Ensure we're within bounds
            if (x >= startX && x < startX + width && y >= startY && y < startY + height) {
                walls.push({x, y});
            }
        }
    }
    
    // Create an opening in the spiral
    const openingAngle = Math.PI / 4; // 45 degrees
    for (let radius = maxRadius; radius > 0; radius -= 1) {
        const x = Math.floor(centerX + radius * Math.cos(openingAngle));
        const y = Math.floor(centerY + radius * Math.sin(openingAngle));
        walls = walls.filter(wall => !(wall.x === x && wall.y === y));
    }
    
    // Add reward at the center
    let centerFood = generateNewFood();
    centerFood.x = centerX;
    centerFood.y = centerY;
    centerFood.points = 30;
    centerFood.color = '#FF5722';
    foods.push(centerFood);
    
    // Add a few guide foods along the spiral path
    for (let radius = maxRadius-1; radius > 0; radius -= spacing * 2) {
        const angle = openingAngle + (maxRadius - radius) * 0.5;
        const x = Math.floor(centerX + radius * Math.cos(angle));
        const y = Math.floor(centerY + radius * Math.sin(angle));
        
        let food = generateNewFood();
        food.x = x;
        food.y = y;
        food.points = 10;
        food.color = '#FFC107';
        foods.push(food);
    }
}

// Create a central treasure chamber with barriers
function createTreasureChamber(startX, startY, width, height) {
    const centerX = startX + Math.floor(width / 2);
    const centerY = startY + Math.floor(height / 2);
    const chamberSize = Math.min(Math.floor(width / 3), Math.floor(height / 3));
    
    // Create chamber walls
    for (let x = centerX - chamberSize; x <= centerX + chamberSize; x++) {
        walls.push({x, y: centerY - chamberSize});
        walls.push({x, y: centerY + chamberSize});
    }
    
    for (let y = centerY - chamberSize; y <= centerY + chamberSize; y++) {
        walls.push({x: centerX - chamberSize, y});
        walls.push({x: centerX + chamberSize, y});
    }
    
    // Create single entry point
    const entryX = centerX;
    const entryY = centerY - chamberSize;
    walls = walls.filter(wall => !(wall.x === entryX && wall.y === entryY));
    
    // Add barrier inside the chamber
    for (let x = centerX - chamberSize + 2; x < centerX + chamberSize - 1; x++) {
        walls.push({x, y: centerY - 2});
    }
    
    // Add gap in the barrier
    const barrierGapX = centerX + chamberSize - 4;
    walls = walls.filter(wall => !(wall.x === barrierGapX && wall.y === centerY - 2));
    
    // Add power-up in the inner chamber
    let powerUp = generateNewFood();
    powerUp.x = centerX;
    powerUp.y = centerY + 2;
    
    const powerUpTypes = ['speed_boost', 'invincibility', 'magnet'];
    const randomPowerUp = powerUpTypes[Math.floor(Math.random() * powerUpTypes.length)];
    powerUp.powerUp = randomPowerUp;
    powerUp.duration = 15000;
    
    switch (randomPowerUp) {
        case 'speed_boost': powerUp.color = '#00BCD4'; break;
        case 'invincibility': powerUp.color = '#9C27B0'; break;
        case 'magnet': powerUp.color = '#FFEB3B'; break;
    }
    
    foods.push(powerUp);
}

// Create zigzag walls pattern
function createZigzagWalls(startX, startY, width, height) {
    const padding = 5;
    const innerStartX = startX + padding;
    const innerStartY = startY + padding;
    const innerWidth = width - padding * 2;
    const innerHeight = height - padding * 2;
    
    const zigzagCount = 3; // Number of zigzags
    const segmentWidth = Math.floor(innerWidth / zigzagCount);
    
    for (let i = 0; i < zigzagCount; i++) {
        const x1 = innerStartX + i * segmentWidth;
        const x2 = x1 + segmentWidth;
        
        // Create zigzag line
        for (let x = x1; x < x2; x++) {
            const progress = (x - x1) / segmentWidth;
            const y = innerStartY + innerHeight * (i % 2 === 0 ? progress : 1 - progress);
            walls.push({x, y: Math.floor(y)});
        }
    }
    
    // Add food along the zigzag path
    for (let i = 0; i < zigzagCount; i++) {
        const x = innerStartX + i * segmentWidth + Math.floor(segmentWidth / 2);
        const y = innerStartY + innerHeight * (i % 2 === 0 ? 0.5 : 0.5);
        
        let food = generateNewFood();
        food.x = x;
        food.y = Math.floor(y);
        food.points = 15;
        food.color = '#FFC107';
        foods.push(food);
    }
}

// Create a simple center platform with food
function createSimpleCenterPlatform(startX, startY, width, height) {
    const centerX = startX + Math.floor(width / 2);
    const centerY = startY + Math.floor(height / 2);
    const platformSize = Math.floor(Math.min(width, height) * 0.2);
    
    // Create simple central platform
    for (let x = centerX - platformSize; x <= centerX + platformSize; x += 2) { // Skip walls to make it more open
        for (let y = centerY - platformSize; y <= centerY + platformSize; y += 2) {
            // Only create walls at the perimeter
            if (x === centerX - platformSize || x === centerX + platformSize || 
                y === centerY - platformSize || y === centerY + platformSize) {
                walls.push({x, y});
            }
        }
    }
    
    // Add power-up in the center
    let powerUp = generateNewFood();
    powerUp.x = centerX;
    powerUp.y = centerY;
    
    const powerUpTypes = ['speed_boost', 'invincibility', 'magnet'];
    const randomPowerUp = powerUpTypes[Math.floor(Math.random() * powerUpTypes.length)];
    powerUp.powerUp = randomPowerUp;
    powerUp.duration = 12000;
    
    switch (randomPowerUp) {
        case 'speed_boost': powerUp.color = '#00BCD4'; break;
        case 'invincibility': powerUp.color = '#9C27B0'; break;
        case 'magnet': powerUp.color = '#FFEB3B'; break;
    }
    
    foods.push(powerUp);
    
    // Create multiple openings in the platform
    for (let i = 0; i < 4; i++) {
        const angle = i * (Math.PI / 2); // 4 cardinal directions
        const openX = Math.floor(centerX + platformSize * Math.cos(angle));
        const openY = Math.floor(centerY + platformSize * Math.sin(angle));
        
        // Create wider openings (remove multiple adjacent walls)
        for (let offset = -1; offset <= 1; offset++) {
            const offsetX = Math.round(offset * Math.sin(angle)); // Perpendicular to angle
            const offsetY = Math.round(-offset * Math.cos(angle)); // Perpendicular to angle
            walls = walls.filter(wall => !(wall.x === openX + offsetX && wall.y === openY + offsetY));
        }
    }
}

// Create simple cross paths in a room
function createSimpleCrossPaths(startX, startY, width, height) {
    const centerX = startX + Math.floor(width / 2);
    const centerY = startY + Math.floor(height / 2);
    
    // Place food at the intersection
    let centerFood = generateNewFood();
    centerFood.x = centerX;
    centerFood.y = centerY;
    centerFood.points = 30;
    centerFood.color = '#FF5722';
    foods.push(centerFood);
    
    // Place food along the paths
    for (let i = 1; i <= 3; i++) {
        // Horizontal path foods
        let eastFood = generateNewFood();
        eastFood.x = centerX + (i * 10);
        eastFood.y = centerY;
        eastFood.points = 10 + i * 5;
        eastFood.color = '#FFC107';
        foods.push(eastFood);
        
        let westFood = generateNewFood();
        westFood.x = centerX - (i * 10);
        westFood.y = centerY;
        westFood.points = 10 + i * 5;
        westFood.color = '#FFC107';
        foods.push(westFood);
        
        // Vertical path foods
        let northFood = generateNewFood();
        northFood.x = centerX;
        northFood.y = centerY - (i * 10);
        northFood.points = 10 + i * 5;
        northFood.color = '#FFC107';
        foods.push(northFood);
        
        let southFood = generateNewFood();
        southFood.x = centerX;
        southFood.y = centerY + (i * 10);
        southFood.points = 10 + i * 5;
        southFood.color = '#FFC107';
        foods.push(southFood);
    }
}

// Create a complex maze with obstacles
function createMazeWithObstacles(startX, startY, width, height) {
    console.log(`Creating maze with obstacles at (${startX},${startY}) with size ${width}x${height}`);
    
    // Create full perimeter walls
    for (let x = startX; x < startX + width; x++) {
        walls.push({x, y: startY});
        walls.push({x, y: startY + height - 1});
    }
    
    for (let y = startY; y < startY + height; y++) {
        walls.push({x: startX, y});
        walls.push({x: startX + width - 1, y});
    }
    
    // Create a proper maze using a simplified recursive division method
    const createMaze = (x, y, w, h, orientation) => {
        if (w < 15 || h < 15) return; // Minimum size for division
        
        // Choose orientation based on room shape if not specified
        if (!orientation) {
            orientation = w > h ? 'vertical' : 'horizontal';
            if (w === h) orientation = Math.random() < 0.5 ? 'vertical' : 'horizontal';
        }
        
        if (orientation === 'horizontal') {
            // Create a horizontal wall
            const wallY = y + Math.floor(Math.random() * (h - 10)) + 5;
            
            // Create passage in the wall at a random point
            const passageX = x + Math.floor(Math.random() * (w - 2)) + 1;
            
            // Add the wall except for the passage
            for (let wx = x; wx < x + w; wx++) {
                if (wx !== passageX) {
                    walls.push({x: wx, y: wallY});
                }
            }
            
            // Recursively divide the two new sections
            createMaze(x, y, w, wallY - y, 'vertical');
            createMaze(x, wallY + 1, w, h - (wallY - y + 1), 'vertical');
        } else {
            // Create a vertical wall
            const wallX = x + Math.floor(Math.random() * (w - 10)) + 5;
            
            // Create passage in the wall at a random point
            const passageY = y + Math.floor(Math.random() * (h - 2)) + 1;
            
            // Add the wall except for the passage
            for (let wy = y; wy < y + h; wy++) {
                if (wy !== passageY) {
                    walls.push({x: wallX, y: wy});
                }
            }
            
            // Recursively divide the two new sections
            createMaze(x, y, wallX - x, h, 'horizontal');
            createMaze(wallX + 1, y, w - (wallX - x + 1), h, 'horizontal');
        }
    };
    
    // Create the initial maze structure
    createMaze(startX + 2, startY + 2, width - 4, height - 4);
    
    // Add complex obstacles at strategic junctions
    const obstaclePoints = [];
    const gridSize = 25;
    
    // Place obstacles at regular intervals
    for (let ox = startX + gridSize; ox < startX + width - gridSize; ox += gridSize) {
        for (let oy = startY + gridSize; oy < startY + height - gridSize; oy += gridSize) {
            // Only place if we're unlikely to block a crucial passage
            // Check if there are fewer than 4 nearby walls
            let nearbyWalls = 0;
            for (let dx = -2; dx <= 2; dx++) {
                for (let dy = -2; dy <= 2; dy++) {
                    const checkX = ox + dx;
                    const checkY = oy + dy;
                    if (walls.some(wall => wall.x === checkX && wall.y === checkY)) {
                        nearbyWalls++;
                    }
                }
            }
            
            if (nearbyWalls < 4 && Math.random() < 0.4) {
                obstaclePoints.push({x: ox, y: oy});
            }
        }
    }
    
    // Create complex obstacles at selected points
    obstaclePoints.forEach((point, index) => {
        const obstacleType = index % 4;
        
        switch (obstacleType) {
            case 0: // Cross-shaped obstacle
                for (let dx = -2; dx <= 2; dx++) {
                    walls.push({x: point.x + dx, y: point.y});
                }
                for (let dy = -2; dy <= 2; dy++) {
                    if (dy !== 0) {  // Avoid duplicate center point
                        walls.push({x: point.x, y: point.y + dy});
                    }
                }
                break;
                
            case 1: // Small room with one entrance
                for (let dx = -2; dx <= 2; dx++) {
                    for (let dy = -2; dy <= 2; dy++) {
                        if (dx === -2 || dx === 2 || dy === -2 || dy === 2) {
                            walls.push({x: point.x + dx, y: point.y + dy});
                        }
                    }
                }
                // Create entrance
                const entranceSide = Math.floor(Math.random() * 4);
                if (entranceSide === 0) { // North
                    walls = walls.filter(w => !(w.x === point.x && w.y === point.y - 2));
                } else if (entranceSide === 1) { // East
                    walls = walls.filter(w => !(w.x === point.x + 2 && w.y === point.y));
                } else if (entranceSide === 2) { // South
                    walls = walls.filter(w => !(w.x === point.x && w.y === point.y + 2));
                } else { // West
                    walls = walls.filter(w => !(w.x === point.x - 2 && w.y === point.y));
                }
                break;
                
            case 2: // Spiral fragment
                for (let i = 0; i < 8; i++) {
                    const angle = i * (Math.PI / 4);
                    const radius = 3;
                    const spiralX = Math.floor(point.x + radius * Math.cos(angle));
                    const spiralY = Math.floor(point.y + radius * Math.sin(angle));
                    walls.push({x: spiralX, y: spiralY});
                }
                break;
                
            case 3: // Random pattern
                for (let i = 0; i < 5; i++) {
                    const dx = Math.floor(Math.random() * 5) - 2;
                    const dy = Math.floor(Math.random() * 5) - 2;
                    if (dx !== 0 || dy !== 0) { // Don't place at center
                        walls.push({x: point.x + dx, y: point.y + dy});
                    }
                }
                break;
        }
        
        // Add reward inside or near obstacle
        if (obstacleType === 1) {
            // For room, place inside
            let reward = generateNewFood();
            reward.x = point.x;
            reward.y = point.y;
            reward.points = 25;
            reward.color = '#FF9800';
            foods.push(reward);
        } else {
            // For other obstacles, place nearby
            const angle = Math.random() * Math.PI * 2;
            const distance = 3;
            const rewardX = Math.floor(point.x + distance * Math.cos(angle));
            const rewardY = Math.floor(point.y + distance * Math.sin(angle));
            
            // Check if position isn't a wall
            const isWall = walls.some(wall => wall.x === rewardX && wall.y === rewardY);
            if (!isWall) {
                let reward = generateNewFood();
                reward.x = rewardX;
                reward.y = rewardY;
                
                if (Math.random() < 0.3) {
                    // Power-up
                    const powerUpTypes = ['speed_boost', 'invincibility', 'magnet'];
                    const randomPowerUp = powerUpTypes[Math.floor(Math.random() * powerUpTypes.length)];
                    reward.powerUp = randomPowerUp;
                    reward.duration = 12000;
                    
                    switch (randomPowerUp) {
                        case 'speed_boost': reward.color = '#00BCD4'; break;
                        case 'invincibility': reward.color = '#9C27B0'; break;
                        case 'magnet': reward.color = '#FFEB3B'; break;
                    }
                } else {
                    // Regular food
                    reward.points = 15;
                    reward.color = '#FFC107';
                }
                
                foods.push(reward);
            }
        }
    });
    
    // Create a special high-value reward in the center of the maze
    const centerFood = generateNewFood();
    centerFood.x = startX + Math.floor(width / 2);
    centerFood.y = startY + Math.floor(height / 2);
    centerFood.points = 50;
    centerFood.color = '#FF5722';
    foods.push(centerFood);
    
    // Now create a path to the center (to ensure it's accessible)
    const createPathToCenter = () => {
        // Define region variables before using them
        const region = {
            x: startX,
            y: startY, 
            width: width,
            height: height
        };
    
        const centerX = region.x + Math.floor(region.width / 2);
        const centerY = region.y + Math.floor(region.height / 2);
    
        // Start from a random edge point
        let pathStartX, pathStartY;
        const side = Math.floor(Math.random() * 4);
        
        switch (side) {
            case 0: // North
                pathStartX = region.x + Math.floor(region.width / 3) + Math.floor(Math.random() * (region.width / 3));
                pathStartY = region.y + 1;
                break;
            case 1: // East
                pathStartX = region.x + region.width - 2;
                pathStartY = region.y + Math.floor(region.height / 3) + Math.floor(Math.random() * (region.height / 3));
                break;
            case 2: // South
                pathStartX = region.x + Math.floor(region.width / 3) + Math.floor(Math.random() * (region.width / 3));
                pathStartY = region.y + region.height - 2;
                break;
            case 3: // West
                pathStartX = region.x + 1;
                pathStartY = region.y + Math.floor(region.height / 3) + Math.floor(Math.random() * (region.height / 3));
                break;
        }
        
        // Create a winding path to the center
        let currentX = pathStartX;
        let currentY = pathStartY;
        
        while (!(currentX === centerX && currentY === centerY)) {
            // Clear any walls at the current position
            walls = walls.filter(wall => !(wall.x === currentX && wall.y === currentY));
            
            // Determine direction to move (prefer toward center but with some randomness)
            const dx = centerX - currentX;
            const dy = centerY - currentY;
            
            // Occasionally place guide food
            if (Math.random() < 0.1) {
                let pathFood = generateNewFood();
                pathFood.x = currentX;
                pathFood.y = currentY;
                pathFood.points = 10;
                pathFood.color = '#8BC34A';
                foods.push(pathFood);
            }
            
            // 80% chance to move toward center, 20% chance for random movement
            if (Math.random() < 0.8) {
                // Move toward center
                if (Math.abs(dx) > Math.abs(dy)) {
                    // Move horizontally
                    currentX += Math.sign(dx);
                } else {
                    // Move vertically
                    currentY += Math.sign(dy);
                }
            } else {
                // Move randomly
                const randomDir = Math.floor(Math.random() * 4);
                switch (randomDir) {
                    case 0: currentX++; break;
                    case 1: currentX--; break;
                    case 2: currentY++; break;
                    case 3: currentY--; break;
                }
                
                // Make sure we stay in bounds
                currentX = Math.max(startX + 1, Math.min(startX + width - 2, currentX));
                currentY = Math.max(startY + 1, Math.min(startY + height - 2, currentY));
            }
        }
    };
    
    createPathToCenter();
}

// Create a square obstacle
function createSquareObstacle(centerX, centerY, size) {
    for (let dx = -size; dx <= size; dx++) {
        for (let dy = -size; dy <= size; dy++) {
            // Only add walls around the perimeter
            if (dx === -size || dx === size || dy === -size || dy === size) {
                walls.push({x: centerX + dx, y: centerY + dy});
            }
        }
    }
    
    // Create opening in the square
    const openingSide = Math.floor(Math.random() * 4);
    if (openingSide === 0) { // Top
        walls = walls.filter(w => !(w.x === centerX && w.y === centerY - size));
    } else if (openingSide === 1) { // Right
        walls = walls.filter(w => !(w.x === centerX + size && w.y === centerY));
    } else if (openingSide === 2) { // Bottom
        walls = walls.filter(w => !(w.x === centerX && w.y === centerY + size));
    } else { // Left
        walls = walls.filter(w => !(w.x === centerX - size && w.y === centerY));
    }
}

// Create a diamond obstacle
function createDiamondObstacle(centerX, centerY, size) {
    for (let i = -size; i <= size; i++) {
        // Calculate diamond width at this height
        const width = size - Math.abs(i);
        
        // Only place walls at the edges
        walls.push({x: centerX - width, y: centerY + i});
        walls.push({x: centerX + width, y: centerY + i});
    }
    
    // Create opening in the diamond
    const openingPos = Math.floor(Math.random() * 4);
    if (openingPos === 0) { // Top
        walls = walls.filter(w => !(w.x === centerX && w.y === centerY - size));
    } else if (openingPos === 1) { // Right
        walls = walls.filter(w => !(w.x === centerX + size && w.y === centerY));
    } else if (openingPos === 2) { // Bottom
        walls = walls.filter(w => !(w.x === centerX && w.y === centerY + size));
    } else { // Left
        walls = walls.filter(w => !(w.x === centerX - size && w.y === centerY));
    }
}

// Create an L-shaped obstacle
function createLShapedObstacle(cornerX, cornerY, size) {
    // Horizontal segment
    for (let x = cornerX; x < cornerX + size; x++) {
        walls.push({x, y: cornerY});
    }
    
    // Vertical segment
    for (let y = cornerY; y < cornerY + size; y++) {
        walls.push({x: cornerX, y});
    }
}

// Create a labyrinth structure
// Create a more complex labyrinth with narrow corridors
function createLabyrinth(startX, startY, width, height) {
    console.log(`Creating challenging labyrinth at (${startX},${startY}) with size ${width}x${height}`);
    
    // Use a recursive division method to create a proper maze
    // First create the outer walls
    for (let x = startX; x < startX + width; x++) {
        walls.push({x, y: startY});
        walls.push({x, y: startY + height - 1});
    }
    
    for (let y = startY; y < startY + height; y++) {
        walls.push({x: startX, y});
        walls.push({x: startX + width - 1, y});
    }
    
    // Function to divide a rectangular section recursively
    function divideChamber(x, y, w, h, orientation) {
        // If the chamber is too small, stop recursion
        if (w < 10 || h < 10) return;
        
        // Choose where to divide
        let wallX, wallY;
        let passageX, passageY;
        
        // Decide whether to divide horizontally or vertically
        if (orientation === 'horizontal') {
            // Horizontal division - place a wall with a single passage
            wallY = y + 2 + Math.floor(Math.random() * (h - 4));
            passageX = x + Math.floor(Math.random() * w);
            
            // Create a horizontal wall
            for (let i = 0; i < w; i++) {
                if (x + i !== passageX) {
                    walls.push({x: x + i, y: wallY});
                }
            }
            
            // Recursively divide the two new chambers
            const newOrientation = w > h ? 'vertical' : 'horizontal';
            divideChamber(x, y, w, wallY - y, newOrientation);
            divideChamber(x, wallY + 1, w, y + h - wallY - 1, newOrientation);
            
        } else {
            // Vertical division - place a wall with a single passage
            wallX = x + 2 + Math.floor(Math.random() * (w - 4));
            passageY = y + Math.floor(Math.random() * h);
            
            // Create a vertical wall
            for (let i = 0; i < h; i++) {
                if (y + i !== passageY) {
                    walls.push({x: wallX, y: y + i});
                }
            }
            
            // Recursively divide the two new chambers
            const newOrientation = h > w ? 'horizontal' : 'vertical';
            divideChamber(x, y, wallX - x, h, newOrientation);
            divideChamber(wallX + 1, y, x + w - wallX - 1, h, newOrientation);
        }
    }
    
    // Start the division with a horizontal or vertical wall based on dimensions
    const initialOrientation = width > height ? 'vertical' : 'horizontal';
    divideChamber(startX + 1, startY + 1, width - 2, height - 2, initialOrientation);
    
    // Add strategic treasures in dead-ends and challenging spots
    addLabyrinthTreasures(startX, startY, width, height);
}

// Add treasures at strategic locations in the labyrinth
function addLabyrinthTreasures(startX, startY, width, height) {
    const grid = Array(width).fill().map(() => Array(height).fill(0));
    
    // Mark walls on the grid
    for (const wall of walls) {
        const relX = wall.x - startX;
        const relY = wall.y - startY;
        if (relX >= 0 && relX < width && relY >= 0 && relY < height) {
            grid[relX][relY] = 1;
        }
    }
    
    // Find dead-ends (cells with 3 adjacent walls)
    const deadEnds = [];
    for (let x = 1; x < width - 1; x++) {
        for (let y = 1; y < height - 1; y++) {
            if (grid[x][y] === 0) { // Not a wall
                let wallCount = 0;
                if (grid[x-1][y] === 1) wallCount++;
                if (grid[x+1][y] === 1) wallCount++;
                if (grid[x][y-1] === 1) wallCount++;
                if (grid[x][y+1] === 1) wallCount++;
                
                if (wallCount === 3) {
                    deadEnds.push({x: startX + x, y: startY + y});
                }
            }
        }
    }
    
    // Place treasures in some of the dead-ends
    deadEnds.forEach((deadEnd, index) => {
        if (Math.random() < 0.7) {
            let reward = generateNewFood();
            reward.x = deadEnd.x;
            reward.y = deadEnd.y;
            
            if (index % 5 === 0) {
                // Power-up (approximately 20% of dead-end treasures)
                const powerUpTypes = ['speed_boost', 'invincibility', 'magnet'];
                const randomPowerUp = powerUpTypes[Math.floor(Math.random() * powerUpTypes.length)];
                reward.powerUp = randomPowerUp;
                reward.duration = 15000;
                
                switch (randomPowerUp) {
                    case 'speed_boost': reward.color = '#00BCD4'; break;
                    case 'invincibility': reward.color = '#9C27B0'; break;
                    case 'magnet': reward.color = '#FFEB3B'; break;
                }
            } else {
                // High-value food
                reward.points = 30 + Math.floor(Math.random() * 20);
                reward.color = '#FF5722';
            }
            
            foods.push(reward);
        }
    });
    
    // Place guide foods to create paths to important areas
    // Use a modified flood fill to place food along key corridors
    const visited = Array(width).fill().map(() => Array(height).fill(false));
    
    // Start from center and create paths to the edges
    const centerX = startX + Math.floor(width / 2);
    const centerY = startY + Math.floor(height / 2);
    
    // Place a special reward at the center
    let centerReward = generateNewFood();
    centerReward.x = centerX;
    centerReward.y = centerY;
    centerReward.points = 50;
    centerReward.color = '#E91E63';
    foods.push(centerReward);
    
    // Create paths to each corner with guide foods
    const corners = [
        {x: startX + 2, y: startY + 2},
        {x: startX + width - 3, y: startY + 2},
        {x: startX + 2, y: startY + height - 3},
        {x: startX + width - 3, y: startY + height - 3}
    ];
    
    corners.forEach(corner => {
        // Create path from center to this corner
        const pathPoints = findPath(grid, 
            {x: centerX - startX, y: centerY - startY}, 
            {x: corner.x - startX, y: corner.y - startY});
        
        // Place occasional food along the path as guides
        for (let i = 0; i < pathPoints.length; i += 3) { // Every 3rd cell
            if (Math.random() < 0.5) {
                let pathFood = generateNewFood();
                pathFood.x = startX + pathPoints[i].x;
                pathFood.y = startY + pathPoints[i].y;
                pathFood.points = 10;
                pathFood.color = '#8BC34A';
                foods.push(pathFood);
            }
        }
        
        // Place reward at the corner
        let cornerReward = generateNewFood();
        cornerReward.x = corner.x;
        cornerReward.y = corner.y;
        cornerReward.points = 30;
        cornerReward.color = '#FF9800';
        foods.push(cornerReward);
    });
}

// A simple path finding algorithm to help place guide foods
function findPath(grid, start, end) {
    const width = grid.length;
    const height = grid[0].length;
    const queue = [{x: start.x, y: start.y, path: []}];
    const visited = new Set();
    
    while (queue.length > 0) {
        const current = queue.shift();
        const key = `${current.x},${current.y}`;
        
        if (current.x === end.x && current.y === end.y) {
            return [...current.path, {x: current.x, y: current.y}];
        }
        
        if (visited.has(key)) continue;
        visited.add(key);
        
        const directions = [
            {dx: 0, dy: -1}, // Up
            {dx: 1, dy: 0},  // Right
            {dx: 0, dy: 1},  // Down
            {dx: -1, dy: 0}  // Left
        ];
        
        for (const dir of directions) {
            const newX = current.x + dir.dx;
            const newY = current.y + dir.dy;
            
            if (newX >= 0 && newX < width && newY >= 0 && newY < height && 
                grid[newX][newY] === 0 && !visited.has(`${newX},${newY}`)) {
                
                queue.push({
                    x: newX,
                    y: newY,
                    path: [...current.path, {x: current.x, y: current.y}]
                });
            }
        }
    }
    
    return []; // No path found
}

// Add treasure chests throughout the area
function addTreasureChests(startX, startY, width, height) {
    // Place treasures at regular intervals
    for (let x = 0; x < width; x += 40) {
        for (let y = 0; y < height; y += 40) {
            if (Math.random() < 0.7) {
                const treasureX = startX + x + Math.floor(Math.random() * 10);
                const treasureY = startY + y + Math.floor(Math.random() * 10);
                
                let powerChance = Math.random();
                if (powerChance < 0.3) {
                    // Power-up
                    const powerUpTypes = ['speed_boost', 'invincibility', 'magnet'];
                    const randomPowerUp = powerUpTypes[Math.floor(Math.random() * powerUpTypes.length)];
                    
                    let food = generateNewFood();
                    food.x = treasureX;
                    food.y = treasureY;
                    food.powerUp = randomPowerUp;
                    food.duration = 15000;
                    
                    switch (randomPowerUp) {
                        case 'speed_boost': food.color = '#00BCD4'; break;
                        case 'invincibility': food.color = '#9C27B0'; break;
                        case 'magnet': food.color = '#FFEB3B'; break;
                    }
                    
                    foods.push(food);
                } else {
                    // High value food
                    let food = generateNewFood();
                    food.x = treasureX;
                    food.y = treasureY;
                    food.points = 25 + Math.floor(Math.random() * 25);
                    food.color = '#FF5722';
                    foods.push(food);
                }
            }
        }
    }
}

// Helper to create curved walls between points
function createCurvedWall(x1, y1, x2, y2) {
    // Calculate distance and angle between points
    const dx = x2 - x1;
    const dy = y2 - y1;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);
    
    // Create a curved path with Bezier control point
    const controlScale = 0.6;
    const controlX = (x1 + x2) / 2 + controlScale * distance * Math.cos(angle + Math.PI/2);
    const controlY = (y1 + y2) / 2 + controlScale * distance * Math.sin(angle + Math.PI/2);
    
    // Sample points along the Bezier curve
    const numPoints = Math.floor(distance / 2);
    for (let i = 0; i <= numPoints; i++) {
        const t = i / numPoints;
        const tInv = 1 - t;
        
        // Quadratic Bezier formula
        const x = Math.floor(tInv * tInv * x1 + 2 * tInv * t * controlX + t * t * x2);
        const y = Math.floor(tInv * tInv * y1 + 2 * tInv * t * controlY + t * t * y2);
        
        walls.push({x, y});
    }
}

// Create recursive division maze
function createRecursiveDivisionMaze(x, y, width, height, minSize) {
    if (width < minSize || height < minSize) return;
    
    // Decide whether to divide horizontally or vertically
    const divideHorizontally = width < height ? true : 
                              width > height ? false :
                              Math.random() < 0.5;
    
    if (divideHorizontally) {
        // Divide horizontally
        const divideY = y + minSize + Math.floor(Math.random() * (height - 2 * minSize));
        
        // Create horizontal wall
        for (let wx = x; wx < x + width; wx++) {
            walls.push({x: wx, y: divideY});
        }
        
        // Create passage
        const passageX = x + Math.floor(Math.random() * (width - 1));
        walls = walls.filter(wall => !(wall.x === passageX && wall.y === divideY));
        
        // Add food near the passage
        let food = generateNewFood();
        food.x = passageX;
        food.y = divideY + (Math.random() < 0.5 ? -1 : 1);
        food.points = 15;
        food.color = '#FFC107';
        foods.push(food);
        
        // Recursively divide the spaces
        createRecursiveDivisionMaze(x, y, width, divideY - y, minSize);
        createRecursiveDivisionMaze(x, divideY + 1, width, y + height - divideY - 1, minSize);
    } else {
        // Divide vertically
        const divideX = x + minSize + Math.floor(Math.random() * (width - 2 * minSize));
        
        // Create vertical wall
        for (let wy = y; wy < y + height; wy++) {
            walls.push({x: divideX, y: wy});
        }
        
        // Create passage
        const passageY = y + Math.floor(Math.random() * (height - 1));
        walls = walls.filter(wall => !(wall.x === divideX && wall.y === passageY));
        
        // Add food near the passage
        let food = generateNewFood();
        food.x = divideX + (Math.random() < 0.5 ? -1 : 1);
        food.y = passageY;
        food.points = 15;
        food.color = '#FFC107';
        foods.push(food);
        
        // Recursively divide the spaces
        createRecursiveDivisionMaze(x, y, divideX - x, height, minSize);
        createRecursiveDivisionMaze(divideX + 1, y, x + width - divideX - 1, height, minSize);
    }
}

// Add treasures in dead ends of the labyrinth
function addTreasuresInDeadEnds(startX, startY, width, height) {
    const grid = Array(width).fill().map(() => Array(height).fill(0));
    
    // Mark walls in the grid
    for (const wall of walls) {
        const relX = wall.x - startX;
        const relY = wall.y - startY;
        if (relX >= 0 && relX < width && relY >= 0 && relY < height) {
            grid[relX][relY] = 1;
        }
    }
    
    // Find potential dead ends (cells with 3 walls adjacent)
    for (let x = 1; x < width - 1; x++) {
        for (let y = 1; y < height - 1; y++) {
            if (grid[x][y] === 0) { // Not a wall
                let wallCount = 0;
                if (grid[x-1][y] === 1) wallCount++;
                if (grid[x+1][y] === 1) wallCount++;
                if (grid[x][y-1] === 1) wallCount++;
                if (grid[x][y+1] === 1) wallCount++;
                
                // If it's likely a dead end (3 walls adjacent)
                if (wallCount === 3 && Math.random() < 0.5) {
                    // Add special treasure or power-up
                    let food = generateNewFood();
                    food.x = startX + x;
                    food.y = startY + y;
                    
                    if (Math.random() < 0.4) {
                        // Power-up
                        const powerUpTypes = ['speed_boost', 'invincibility', 'magnet'];
                        const randomPowerUp = powerUpTypes[Math.floor(Math.random() * powerUpTypes.length)];
                        food.powerUp = randomPowerUp;
                        food.duration = 15000; // Longer duration as reward
                        
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
                        // Very high value food
                        food.points = 50;
                        food.color = '#FF5722';
                    }
                    
                    foods.push(food);
                }
            }
        }
    }
}

// Create themed areas with special challenges
function createThemedAreas() {
    console.log("Creating themed areas...");
    
    // Create an ice skating area where movement is slippery
    createIceRink(50, 50, 60, 60);
    
    // Create a dark forest area with clusters of walls and hidden food
    createDarkForest(GRID_SIZE - 110, GRID_SIZE - 120, 80, 80);
    
    // Create a treasure vault with high rewards but difficult access
    createTreasureVault(GRID_SIZE - 110, 50, 60, 60);
    
    // Create a maze within a maze (fractal maze)
    createFractalMaze(50, GRID_SIZE - 120, 70, 70);
}

// Create an ice rink area with slippery movement (visual only)
function createIceRink(x, y, width, height) {
    console.log(`Creating ice rink at (${x},${y}) with size ${width}x${height}`);
    
    // Create the outer border of the ice rink
    for (let wx = x; wx < x + width; wx++) {
        walls.push({x: wx, y: y});
        walls.push({x: wx, y: y + height - 1});
    }
    
    for (let wy = y; wy < y + height; wy++) {
        walls.push({x: x, y: wy});
        walls.push({x: x + width - 1, y: wy});
    }
    
    // Create ice obstacles (small islands)
    const numObstacles = 5;
    for (let i = 0; i < numObstacles; i++) {
        const obsX = x + 10 + Math.floor(Math.random() * (width - 20));
        const obsY = y + 10 + Math.floor(Math.random() * (height - 20));
        const obsSize = Math.floor(Math.random() * 5) + 3;
        
        // Create circular ice obstacle
        for (let wx = obsX - obsSize; wx <= obsX + obsSize; wx++) {
            for (let wy = obsY - obsSize; wy <= obsY + obsSize; wy++) {
                const dx = wx - obsX;
                const dy = wy - obsY;
                const dist = Math.sqrt(dx*dx + dy*dy);
                
                if (dist <= obsSize && wx >= x && wx < x + width && wy >= y && wy < y + height) {
                    walls.push({x: wx, y: wy});
                }
            }
        }
        
        // Add power-up in center of some obstacles
        if (Math.random() < 0.5) {
            let food = generateNewFood();
            food.x = obsX;
            food.y = obsY;
            food.powerUp = 'speed_boost';  // Speed boost helps in the ice rink
            food.duration = 10000;
            food.color = '#00BCD4';
            foods.push(food);
        }
    }
    
    // Add speed strips (visual only)
    for (let i = 0; i < 4; i++) {
        const stripX = x + 10 + Math.floor(i * (width - 20) / 4);
        for (let wy = y + 5; wy < y + height - 5; wy += 2) {
            // Speed strip is just a visual element, not a wall
            if (Math.random() < 0.3) {
                let food = generateNewFood();
                food.x = stripX;
                food.y = wy;
                food.points = 5;
                food.color = '#B3E5FC'; // Light blue
                foods.push(food);
            }
        }
    }
    
    // Create entrances/exits
    // North entrance
    const northDoorX = x + Math.floor(width / 2);
    walls = walls.filter(wall => !(wall.x === northDoorX && wall.y === y));
    
    // South entrance
    const southDoorX = x + Math.floor(width / 3);
    walls = walls.filter(wall => !(wall.x === southDoorX && wall.y === y + height - 1));
    
    // East entrance
    const eastDoorY = y + Math.floor(height / 2);
    walls = walls.filter(wall => !(wall.x === x + width - 1 && wall.y === eastDoorY));
}

// Create a dark forest area with clusters of walls and hidden food
function createDarkForest(x, y, width, height) {
    console.log(`Creating dark forest at (${x},${y}) with size ${width}x${height}`);
    
    // Create outer border
    for (let wx = x; wx < x + width; wx++) {
        walls.push({x: wx, y: y});
        walls.push({x: wx, y: y + height - 1});
    }
    
    for (let wy = y; wy < y + height; wy++) {
        walls.push({x: x, y: wy});
        walls.push({x: x + width - 1, y: wy});
    }
    
    // Create tree clusters
    const numClusters = 8;
    for (let i = 0; i < numClusters; i++) {
        const clusterX = x + 5 + Math.floor(Math.random() * (width - 10));
        const clusterY = y + 5 + Math.floor(Math.random() * (height - 10));
        const clusterSize = Math.floor(Math.random() * 8) + 5;
        
        // Create irregular tree cluster
        for (let j = 0; j < 20; j++) { // Place trees randomly in the cluster area
            const angle = Math.random() * Math.PI * 2;
            const distance = Math.random() * clusterSize;
            const treeX = Math.floor(clusterX + Math.cos(angle) * distance);
            const treeY = Math.floor(clusterY + Math.sin(angle) * distance);
            
            if (treeX > x && treeX < x + width - 1 && 
                treeY > y && treeY < y + height - 1) {
                walls.push({x: treeX, y: treeY});
                
                // Maybe create a tree trunk
                if (Math.random() < 0.3) {
                    const trunkLength = Math.floor(Math.random() * 3) + 1;
                    for (let k = 1; k <= trunkLength; k++) {
                        const trunkX = treeX + k;
                        const trunkY = treeY;
                        if (trunkX < x + width - 1) {
                            walls.push({x: trunkX, y: trunkY});
                        }
                    }
                }
            }
        }
        
        // Add hidden food or power-ups in some clusters
        if (Math.random() < 0.6) {
            let food = generateNewFood();
            food.x = clusterX;
            food.y = clusterY;
            
            if (Math.random() < 0.3) {
                // Power-up (magnet is useful in the forest to find hidden food)
                food.powerUp = 'magnet';
                food.duration = 15000;
                food.color = '#FFEB3B';
            } else {
                // High value food
                food.points = 35;
                food.color = '#8BC34A';
            }
            
            foods.push(food);
        }
    }
    
    // Create winding paths through the forest
    const pathPoints = [];
    // Add path entry points
    pathPoints.push({x: x, y: y + Math.floor(height / 2)});
    pathPoints.push({x: x + Math.floor(width / 3), y: y + Math.floor(height / 4)});
    pathPoints.push({x: x + Math.floor(width * 2/3), y: y + Math.floor(height * 3/4)});
    pathPoints.push({x: x + width - 1, y: y + Math.floor(height / 2)});
    
    // Clear walls around entry points to create passages
    for (const point of pathPoints) {
        walls = walls.filter(wall => 
            !(Math.abs(wall.x - point.x) <= 1 && Math.abs(wall.y - point.y) <= 1));
    }
    
    // Create connection paths between points
    for (let i = 0; i < pathPoints.length - 1; i++) {
        const p1 = pathPoints[i];
        const p2 = pathPoints[i+1];
        
        // Create path by clearing walls along a curve
        const numPathPoints = 20;
        for (let j = 0; j <= numPathPoints; j++) {
            const t = j / numPathPoints;
            const pathX = Math.floor(p1.x + (p2.x - p1.x) * t);
            const pathY = Math.floor(p1.y + (p2.y - p1.y) * t + Math.sin(t * Math.PI) * 10);
            
            // Clear walls in a small radius around the path
            const pathRadius = 2;
            for (let dx = -pathRadius; dx <= pathRadius; dx++) {
                for (let dy = -pathRadius; dy <= pathRadius; dy++) {
                    const clearX = pathX + dx;
                    const clearY = pathY + dy;
                    if (clearX >= x && clearX < x + width && clearY >= y && clearY < y + height) {
                        walls = walls.filter(wall => !(wall.x === clearX && wall.y === clearY));
                    }
                }
            }
            
            // Maybe add food along the path
            if (Math.random() < 0.1) {
                let food = generateNewFood();
                food.x = pathX;
                food.y = pathY;
                food.points = 15;
                food.color = '#CDDC39';
                foods.push(food);
            }
        }
    }
}

// Create room with cross pattern
function createRoomCrossPattern(startX, startY, width, height) {
    const centerX = startX + Math.floor(width / 2);
    const centerY = startY + Math.floor(height / 2);
    
    // Create horizontal line
    for (let x = startX + 2; x < startX + width - 2; x++) {
        walls.push({x, y: centerY});
    }
    
    // Create vertical line
    for (let y = startY + 2; y < startY + height - 2; y++) {
        walls.push({x: centerX, y});
    }
    
    // Create openings in the cross
    walls = walls.filter(wall => 
        !((wall.x === centerX && Math.abs(wall.y - centerY) <= 1) || 
          (wall.y === centerY && Math.abs(wall.x - centerX) <= 1)));
    
    // Add food in each quadrant
    const quadrants = [
        {x: centerX - Math.floor(width / 4), y: centerY - Math.floor(height / 4)},
        {x: centerX + Math.floor(width / 4), y: centerY - Math.floor(height / 4)},
        {x: centerX - Math.floor(width / 4), y: centerY + Math.floor(height / 4)},
        {x: centerX + Math.floor(width / 4), y: centerY + Math.floor(height / 4)}
    ];
    
    quadrants.forEach((pos, i) => {
        let food = generateNewFood();
        food.x = pos.x;
        food.y = pos.y;
        food.points = 15 + i * 5;
        food.color = '#FFC107';
        foods.push(food);
    });
}

// Create room with diagonal walls
function createRoomDiagonalWalls(startX, startY, width, height) {
    // Create diagonal wall from top-left to bottom-right
    for (let i = 0; i < Math.min(width, height) - 4; i++) {
        walls.push({x: startX + 2 + i, y: startY + 2 + i});
    }
    
    // Create diagonal wall from top-right to bottom-left
    for (let i = 0; i < Math.min(width, height) - 4; i++) {
        walls.push({x: startX + width - 3 - i, y: startY + 2 + i});
    }
    
    // Create 2-3 openings in the diagonals
    for (let i = 0; i < 3; i++) {
        const pos = 2 + Math.floor(Math.random() * (Math.min(width, height) - 4));
        
        // Remove walls at opening
        walls = walls.filter(wall => 
            !(wall.x === startX + pos && wall.y === startY + pos) &&
            !(wall.x === startX + width - 1 - pos && wall.y === startY + pos));
        
        // Add food near openings
        if (Math.random() < 0.7) {
            let food = generateNewFood();
            food.x = startX + pos;
            food.y = startY + pos + 1;
            food.points = 20;
            food.color = '#FF9800';
            foods.push(food);
        }
    }
}

// Create room with island in center
function createRoomIsland(startX, startY, width, height) {
    const centerX = startX + Math.floor(width / 2);
    const centerY = startY + Math.floor(height / 2);
    const islandRadius = Math.min(Math.floor(width / 4), Math.floor(height / 4));
    
    // Create circular island
    for (let angle = 0; angle < 2 * Math.PI; angle += 0.2) {
        const wallX = Math.floor(centerX + islandRadius * Math.cos(angle));
        const wallY = Math.floor(centerY + islandRadius * Math.sin(angle));
        walls.push({x: wallX, y: wallY});
    }
    
    // Add bridge to island
    const bridgeAngle = Math.random() * Math.PI * 2;
    const bridgeX = Math.floor(centerX + islandRadius * Math.cos(bridgeAngle));
    const bridgeY = Math.floor(centerY + islandRadius * Math.sin(bridgeAngle));
    walls = walls.filter(wall => !(wall.x === bridgeX && wall.y === bridgeY));
    
    // Add treasure in center of island
    const treasureCount = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < treasureCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * islandRadius * 0.7;
        const foodX = Math.floor(centerX + distance * Math.cos(angle));
        const foodY = Math.floor(centerY + distance * Math.sin(angle));
        
        let food = generateNewFood();
        food.x = foodX;
        food.y = foodY;
        
        // Add either a power-up or high-value food
        if (i === 0 && Math.random() < 0.5) {
            // Power-up
            const powerUpTypes = ['speed_boost', 'invincibility', 'magnet'];
            const randomPowerUp = powerUpTypes[Math.floor(Math.random() * powerUpTypes.length)];
            food.powerUp = randomPowerUp;
            food.duration = 15000;
            
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
            // High value food
            food.points = 40;
            food.color = '#8BC34A';
        }
        
        foods.push(food);
    }
}

// Create a treasure vault with high rewards but difficult access
function createTreasureVault(x, y, width, height) {
    console.log(`Creating treasure vault at (${x},${y}) with size ${width}x${height}`);
    
    // Create thick outer walls for the vault
    const wallThickness = 3;
    for (let t = 0; t < wallThickness; t++) {
        for (let wx = x + t; wx < x + width - t; wx++) {
            walls.push({x: wx, y: y + t});
            walls.push({x: wx, y: y + height - 1 - t});
        }
        
        for (let wy = y + t; wy < y + height - t; wy++) {
            walls.push({x: x + t, y: wy});
            walls.push({x: x + width - 1 - t, y: wy});
        }
    }
    
    // Create vault sections with challenges
    createVaultAntiChamber(x, y, width, height);
    createVaultInnerChamber(x, y, width, height);
    createVaultTreasureRoom(x, y, width, height);
}

// Create the first section of the vault (entry chamber)
function createVaultAntiChamber(x, y, width, height) {
    const chamberWidth = Math.floor(width * 0.8);
    const chamberHeight = Math.floor(height / 3);
    const chamberX = x + Math.floor((width - chamberWidth) / 2);
    const chamberY = y + wallThickness;
    
    // Create entrance to vault - a narrow path
    const entranceX = x + Math.floor(width / 2);
    const entranceWidth = 3;
    
    for (let t = 0; t < wallThickness; t++) {
        for (let wx = entranceX - Math.floor(entranceWidth/2); wx <= entranceX + Math.floor(entranceWidth/2); wx++) {
            walls = walls.filter(wall => !(wall.x === wx && wall.y === y + t));
        }
    }
    
    // Add some basic treasures in the anti-chamber
    for (let i = 0; i < 5; i++) {
        const foodX = chamberX + Math.floor(Math.random() * chamberWidth);
        const foodY = chamberY + Math.floor(Math.random() * chamberHeight);
        
        let food = generateNewFood();
        food.x = foodX;
        food.y = foodY;
        food.points = 20;
        food.color = '#FFC107';
        foods.push(food);
    }
    
    // Add a passage to the inner chamber
    const innerEntranceX = x + Math.floor(width / 2);
    const innerEntranceY = chamberY + chamberHeight;
    walls = walls.filter(wall => !(wall.x === innerEntranceX && wall.y === innerEntranceY));
}

// Create the second section of the vault (inner chamber with obstacles)
function createVaultInnerChamber(x, y, width, height) {
    const chamberWidth = Math.floor(width * 0.6);
    const chamberHeight = Math.floor(height / 3);
    const chamberX = x + Math.floor((width - chamberWidth) / 2);
    const chamberY = y + Math.floor(height / 3) + wallThickness;
    
    // Create obstacles in the inner chamber - a simple maze
    for (let i = 0; i < 5; i++) {
        const obstacleY = chamberY + Math.floor(i * chamberHeight / 5);
        const direction = i % 2 === 0;
        
        if (direction) {
            // Wall from left with gap on right
            for (let wx = chamberX; wx < chamberX + Math.floor(chamberWidth * 0.8); wx++) {
                walls.push({x: wx, y: obstacleY});
            }
        } else {
            // Wall from right with gap on left
            for (let wx = chamberX + Math.floor(chamberWidth * 0.2); wx < chamberX + chamberWidth; wx++) {
                walls.push({x: wx, y: obstacleY});
            }
        }
    }
    
    // Add medium value treasures in the inner chamber
    for (let i = 0; i < 4; i++) {
        const foodX = chamberX + 5 + Math.floor(Math.random() * (chamberWidth - 10));
        const foodY = chamberY + 5 + Math.floor(Math.random() * (chamberHeight - 10));
        
        let food = generateNewFood();
        food.x = foodX;
        food.y = foodY;
        food.points = 30;
        food.color = '#FF9800';
        foods.push(food);
    }
    
    // Add a passage to the treasure room
    const treasureEntranceX = x + Math.floor(width / 2);
    const treasureEntranceY = chamberY + chamberHeight;
    walls = walls.filter(wall => !(wall.x === treasureEntranceX && wall.y === treasureEntranceY));
}

// Create the final section of the vault (treasure room)
function createVaultTreasureRoom(x, y, width, height) {
    const chamberWidth = Math.floor(width * 0.4);
    const chamberHeight = Math.floor(height / 3) - wallThickness;
    const chamberX = x + Math.floor((width - chamberWidth) / 2);
    const chamberY = y + Math.floor(2 * height / 3) + wallThickness;
    
    // Create a circle of walls around the treasure
    const centerX = x + Math.floor(width / 2);
    const centerY = chamberY + Math.floor(chamberHeight / 2);
    const radius = Math.min(chamberWidth, chamberHeight) / 2 - 2;
    
    for (let angle = 0; angle < 2 * Math.PI; angle += 0.1) {
        const wallX = Math.floor(centerX + radius * Math.cos(angle));
        const wallY = Math.floor(centerY + radius * Math.sin(angle));
        walls.push({x: wallX, y: wallY});
    }
    
    // Create a small entrance to the treasure circle
    const entranceAngle = Math.PI / 2; // Top of the circle
    const entranceX = Math.floor(centerX + radius * Math.cos(entranceAngle));
    const entranceY = Math.floor(centerY + radius * Math.sin(entranceAngle));
    walls = walls.filter(wall => !(wall.x === entranceX && wall.y === entranceY));
    
    // Add ultimate treasure in the center
    let ultimateTreasure = generateNewFood();
    ultimateTreasure.x = centerX;
    ultimateTreasure.y = centerY;
    ultimateTreasure.points = 100;
    ultimateTreasure.color = '#FF5722';
    foods.push(ultimateTreasure);
    
    // Add power-ups around the ultimate treasure
    const powerUpTypes = ['speed_boost', 'invincibility', 'magnet'];
    for (let i = 0; i < powerUpTypes.length; i++) {
        const angle = i * (2 * Math.PI / powerUpTypes.length);
        const powerUpX = Math.floor(centerX + (radius * 0.5) * Math.cos(angle));
        const powerUpY = Math.floor(centerY + (radius * 0.5) * Math.sin(angle));
        
        let powerUp = generateNewFood();
        powerUp.x = powerUpX;
        powerUp.y = powerUpY;
        powerUp.powerUp = powerUpTypes[i];
        powerUp.duration = 20000; // Extra long duration as reward
        
        switch (powerUpTypes[i]) {
            case 'speed_boost':
                powerUp.color = '#00BCD4';
                break;
            case 'invincibility':
                powerUp.color = '#9C27B0';
                break;
            case 'magnet':
                powerUp.color = '#FFEB3B';
                break;
        }
        
        foods.push(powerUp);
    }
}

// Create a fractal maze-like structure
function createFractalMaze(x, y, width, height) {
    console.log(`Creating fractal maze at (${x},${y}) with size ${width}x${height}`);
    
    // Create outer border
    for (let wx = x; wx < x + width; wx++) {
        walls.push({x: wx, y: y});
        walls.push({x: wx, y: y + height - 1});
    }
    
    for (let wy = y; wy < y + height; wy++) {
        walls.push({x: x, y: wy});
        walls.push({x: x + width - 1, y: wy});
    }
    
    // Create a fractal-like H-tree structure
    createHTree(x + Math.floor(width/2), y + Math.floor(height/2), Math.floor(width/4), 3);
    
    // Add entrances on all four sides
    const entrances = [
        {x: x + Math.floor(width/2), y: y}, // North
        {x: x + width - 1, y: y + Math.floor(height/2)}, // East
        {x: x + Math.floor(width/2), y: y + height - 1}, // South
        {x: x, y: y + Math.floor(height/2)} // West
    ];
    
    for (const entrance of entrances) {
        walls = walls.filter(wall => !(wall.x === entrance.x && wall.y === entrance.y));
    }
    
    // Add food throughout the maze structure
    for (let i = 0; i < 15; i++) {
        const foodX = x + 5 + Math.floor(Math.random() * (width - 10));
        const foodY = y + 5 + Math.floor(Math.random() * (height - 10));
        
        // Check if position is not a wall
        const isWall = walls.some(wall => wall.x === foodX && wall.y === foodY);
        if (!isWall) {
            let food = generateNewFood();
            food.x = foodX;
            food.y = foodY;
            food.points = 15 + Math.floor(Math.random() * 20);
            food.color = '#4CAF50';
            foods.push(food);
        }
    }
}

// Create an H-tree fractal structure recursively
function createHTree(centerX, centerY, size, depth) {
    if (depth <= 0) return;
    
    // Create the H shape
    // Horizontal bar
    for (let wx = centerX - size; wx <= centerX + size; wx++) {
        walls.push({x: wx, y: centerY});
    }
    
    // Left vertical bar
    for (let wy = centerY - size; wy <= centerY + size; wy++) {
        walls.push({x: centerX - size, y: wy});
    }
    
    // Right vertical bar
    for (let wy = centerY - size; wy <= centerY + size; wy++) {
        walls.push({x: centerX + size, y: wy});
    }
    
    // Create random openings in the H structure
    // Horizontal bar opening
    const hOpeningX = centerX + Math.floor(Math.random() * size * 2) - size;
    walls = walls.filter(wall => !(wall.x === hOpeningX && wall.y === centerY));
    
    // Left vertical bar opening
    const leftOpeningY = centerY + Math.floor(Math.random() * size * 2) - size;
    walls = walls.filter(wall => !(wall.x === centerX - size && wall.y === leftOpeningY));
    
    // Right vertical bar opening
    const rightOpeningY = centerY + Math.floor(Math.random() * size * 2) - size;
    walls = walls.filter(wall => !(wall.x === centerX + size && wall.y === rightOpeningY));
    
    // Maybe add food near openings
    if (Math.random() < 0.4) {
        let food = generateNewFood();
        food.x = hOpeningX;
        food.y = centerY + (Math.random() < 0.5 ? -1 : 1);
        food.points = 20;
        food.color = '#FF9800';
        foods.push(food);
    }
    
    // Recursively create smaller H-trees at the four endpoints
    const newSize = Math.floor(size / 2);
    const newDepth = depth - 1;
    
    // Skip recursion randomly for more interesting patterns
    if (Math.random() < 0.8) {
        createHTree(centerX - size, centerY - size, newSize, newDepth); // Top-left
    }
    if (Math.random() < 0.8) {
        createHTree(centerX + size, centerY - size, newSize, newDepth); // Top-right
    }
    if (Math.random() < 0.8) {
        createHTree(centerX - size, centerY + size, newSize, newDepth); // Bottom-left
    }
    if (Math.random() < 0.8) {
        createHTree(centerX + size, centerY + size, newSize, newDepth); // Bottom-right
    }
}

// Create wide reward passages between major areas
function createRewardPassages() {
    console.log("Creating reward passages...");
    
    // Function to create a wide passage between two points
    const createWideBonusPassage = (x1, y1, x2, y2, width) => {
        // Determine direction
        const dx = x2 - x1;
        const dy = y2 - y1;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // Create markers for the path (instead of walls)
        for (let i = 0; i <= distance; i += 8) { // Place markers every 8 cells
            const t = i / distance;
            const x = Math.floor(x1 + dx * t);
            const y = Math.floor(y1 + dy * t);
            
            // Place markers on both sides of path
            const perpX = -dy / distance;
            const perpY = dx / distance;
            
            // Add marker walls as dots
            if (i % 16 === 0) { // Every other marker
                walls.push({x: Math.floor(x + perpX * width), y: Math.floor(y + perpY * width)});
                walls.push({x: Math.floor(x - perpX * width), y: Math.floor(y - perpY * width)});
            }
        }
        
        // Place rewards along the passage
        for (let i = 5; i < distance; i += 10) {
            const t = i / distance;
            const foodX = Math.floor(x1 + dx * t);
            const foodY = Math.floor(y1 + dy * t);
            
            let food = generateNewFood();
            food.x = foodX;
            food.y = foodY;
            food.points = 10 + Math.floor(i / distance * 40); // Value increases as you go deeper
            food.color = '#FF9800';
            foods.push(food);
        }
        
        // Special reward at the end
        if (Math.random() < 0.7) {
            let powerUp = generateNewFood();
            powerUp.x = x2;
            powerUp.y = y2;
            
            const powerUpTypes = ['speed_boost', 'invincibility', 'magnet'];
            const randomPowerUp = powerUpTypes[Math.floor(Math.random() * powerUpTypes.length)];
            powerUp.powerUp = randomPowerUp;
            powerUp.duration = 15000;
            
            switch (randomPowerUp) {
                case 'speed_boost': powerUp.color = '#00BCD4'; break;
                case 'invincibility': powerUp.color = '#9C27B0'; break;
                case 'magnet': powerUp.color = '#FFEB3B'; break;
            }
            
            foods.push(powerUp);
        } else {
            let food = generateNewFood();
            food.x = x2;
            food.y = y2;
            food.points = 50;
            food.color = '#FF5722';
            foods.push(food);
        }
    };
    
    // Create wider passages with better spacing
    const centerX = Math.floor(GRID_SIZE / 2);
    const centerY = Math.floor(GRID_SIZE / 2);
    const safeZoneRadius = SAFE_ZONE_RADIUS * 2;
    
    const passageEndpoints = [
        // From edges toward center regions
        {start: {x: 50, y: 50}, end: {x: centerX - safeZoneRadius - 10, y: centerY - safeZoneRadius - 10}},
        {start: {x: GRID_SIZE - 50, y: 50}, end: {x: centerX + safeZoneRadius + 10, y: centerY - safeZoneRadius - 10}},
        {start: {x: 50, y: GRID_SIZE - 50}, end: {x: centerX - safeZoneRadius - 10, y: centerY + safeZoneRadius + 10}},
        {start: {x: GRID_SIZE - 50, y: GRID_SIZE - 50}, end: {x: centerX + safeZoneRadius + 10, y: centerY + safeZoneRadius + 10}}
    ];
    
    // Create each passage with increased width
    passageEndpoints.forEach(passage => {
        createWideBonusPassage(passage.start.x, passage.start.y, passage.end.x, passage.end.y, 4); // Width of 4 instead of 2-3
    });
}

// Create special room features
function createRoomCenterObstacle(startX, startY, width, height) {
    const centerX = startX + Math.floor(width / 2);
    const centerY = startY + Math.floor(height / 2);
    const obstacleSize = Math.floor(Math.min(width, height) * 0.2);
    
    // Create central obstacle
    for (let x = centerX - obstacleSize; x <= centerX + obstacleSize; x++) {
        for (let y = centerY - obstacleSize; y <= centerY + obstacleSize; y++) {
            // Only create walls at the perimeter
            if (x === centerX - obstacleSize || x === centerX + obstacleSize || 
                y === centerY - obstacleSize || y === centerY + obstacleSize) {
                walls.push({x, y});
            }
        }
    }
    
    // Add power-up in the center
    let powerUp = generateNewFood();
    powerUp.x = centerX;
    powerUp.y = centerY;
    
    const powerUpTypes = ['speed_boost', 'invincibility', 'magnet'];
    const randomPowerUp = powerUpTypes[Math.floor(Math.random() * powerUpTypes.length)];
    powerUp.powerUp = randomPowerUp;
    powerUp.duration = 12000;
    
    switch (randomPowerUp) {
        case 'speed_boost':
            powerUp.color = '#00BCD4';
            break;
        case 'invincibility':
            powerUp.color = '#9C27B0';
            break;
        case 'magnet':
            powerUp.color = '#FFEB3B';
            break;
    }
    
    foods.push(powerUp);
    
    // Create an opening in the obstacle
    const openingAngle = Math.random() * Math.PI * 2;
    const openX = Math.floor(centerX + obstacleSize * Math.cos(openingAngle));
    const openY = Math.floor(centerY + obstacleSize * Math.sin(openingAngle));
    walls = walls.filter(wall => !(wall.x === openX && wall.y === openY));
}



// Function to add prominent teleport tunnels throughout the map
function addTeleportTunnels() {
    console.log("Adding highly visible teleport tunnels...");
    
    // For traditional snake game, we'll add teleport tunnels to the main room
    const centerX = Math.floor(GRID_SIZE / 2);
    const centerY = Math.floor(GRID_SIZE / 2);
    const safeRoomSize = SAFE_ZONE_RADIUS * 2;
    const safeRoomStartX = centerX - safeRoomSize / 2;
    const safeRoomStartY = centerY - safeRoomSize / 2;
    
    // Create teleport tunnel on the right side of the main room
    const tunnelY = safeRoomStartY + Math.floor(safeRoomSize / 2);
    
    // Right tunnel entrance in the room - narrow opening (1 cell) for challenge
    walls = walls.filter(w => !(w.x === safeRoomStartX + safeRoomSize && w.y === tunnelY));
    walls = walls.filter(w => !(w.x === safeRoomStartX && w.y === tunnelY));
    
    // Add very distinctive portal markers around teleport entrances
    // Create portal-like pattern with concentric rings
    for (let ring = 1; ring <= 4; ring++) {
        // Right portal
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const x = Math.floor(safeRoomStartX + safeRoomSize + 3 + Math.cos(angle) * ring);
            const y = Math.floor(tunnelY + Math.sin(angle) * ring);
            
            // Only place walls at certain positions to create distinctive pattern
            if ((i % 2 === 0 && ring % 2 === 0) || (i % 2 === 1 && ring % 2 === 1)) {
                walls.push({x, y});
            }
        }
        
        // Left portal
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const x = Math.floor(safeRoomStartX - 3 + Math.cos(angle) * ring);
            const y = Math.floor(tunnelY + Math.sin(angle) * ring);
            
            // Only place walls at certain positions to create distinctive pattern
            if ((i % 2 === 0 && ring % 2 === 0) || (i % 2 === 1 && ring % 2 === 1)) {
                walls.push({x, y});
            }
        }
    }
    
    // Add very visible teleport food to make them obvious
    let rightPortalFood = generateNewFood();
    rightPortalFood.x = safeRoomStartX + safeRoomSize + 3;
    rightPortalFood.y = tunnelY;
    rightPortalFood.points = 50;
    rightPortalFood.color = '#9C27B0'; // Purple
    foods.push(rightPortalFood);
    
    let leftPortalFood = generateNewFood();
    leftPortalFood.x = safeRoomStartX - 3;
    leftPortalFood.y = tunnelY;
    leftPortalFood.points = 50;
    leftPortalFood.color = '#9C27B0'; // Purple
    foods.push(leftPortalFood);
    
    // Add teleport tunnels at the edges of the map
    addProminentEdgeTeleports();
}

// Add very prominent teleport tunnels at map edges
function addProminentEdgeTeleports() {
    const border = 20; // Border position
    const teleportGap = 100; // Space between teleports
    
    // Create horizontal teleports (top to bottom)
    for (let x = border + 40; x < GRID_SIZE - border - 40; x += teleportGap) {
        // Top teleport
        const topY = border;
        
        // Bottom teleport
        const bottomY = GRID_SIZE - border - 1;
        
        // Create narrow openings (1 cell wide) for challenge
        // Clear walls at teleport locations
        walls = walls.filter(w => !(w.x === x && w.y === topY));
        walls = walls.filter(w => !(w.x === x && w.y === bottomY));
        
        // Create distinctive star pattern portal markers
        const starSize = 5;
        
        // Top teleport star
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const wallX = Math.floor(x + Math.cos(angle) * starSize);
            const wallY = Math.floor((topY + 5) + Math.sin(angle) * starSize);
            walls.push({x: wallX, y: wallY});
            
            // Connect to center with spokes for visibility
            if (i % 2 === 0) {
                const midX = Math.floor(x + Math.cos(angle) * (starSize/2));
                const midY = Math.floor((topY + 5) + Math.sin(angle) * (starSize/2));
                walls.push({x: midX, y: midY});
            }
        }
        
        // Bottom teleport star
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const wallX = Math.floor(x + Math.cos(angle) * starSize);
            const wallY = Math.floor((bottomY - 5) + Math.sin(angle) * starSize);
            walls.push({x: wallX, y: wallY});
            
            // Connect to center with spokes for visibility
            if (i % 2 === 0) {
                const midX = Math.floor(x + Math.cos(angle) * (starSize/2));
                const midY = Math.floor((bottomY - 5) + Math.sin(angle) * (starSize/2));
                walls.push({x: midX, y: midY});
            }
        }
        
        // Add brightly colored food at the teleports
        let topFood = generateNewFood();
        topFood.x = x;
        topFood.y = topY + 1;
        topFood.points = 40;
        topFood.color = '#9C27B0'; // Purple for teleport identification
        foods.push(topFood);
        
        let bottomFood = generateNewFood();
        bottomFood.x = x;
        bottomFood.y = bottomY - 1;
        bottomFood.points = 40;
        bottomFood.color = '#9C27B0'; // Purple for teleport identification
        foods.push(bottomFood);
    }
    
    // Create vertical teleports (left to right) with similar patterns
    for (let y = border + 40; y < GRID_SIZE - border - 40; y += teleportGap) {
        // Left teleport
        const leftX = border;
        
        // Right teleport
        const rightX = GRID_SIZE - border - 1;
        
        // Create narrow openings (1 cell)
        walls = walls.filter(w => !(w.x === leftX && w.y === y));
        walls = walls.filter(w => !(w.x === rightX && w.y === y));
        
        // Create distinctive diamond pattern portal markers
        // Left teleport diamond
        for (let dx = -5; dx <= 5; dx++) {
            const width = 5 - Math.abs(dx);
            walls.push({x: leftX + 5 + dx, y: y - width});
            walls.push({x: leftX + 5 + dx, y: y + width});
        }
        
        // Right teleport diamond
        for (let dx = -5; dx <= 5; dx++) {
            const width = 5 - Math.abs(dx);
            walls.push({x: rightX - 5 + dx, y: y - width});
            walls.push({x: rightX - 5 + dx, y: y + width});
        }
        
        // Add brightly colored food at the teleports
        let leftFood = generateNewFood();
        leftFood.x = leftX + 1;
        leftFood.y = y;
        leftFood.points = 40;
        leftFood.color = '#9C27B0'; // Purple for teleport identification
        foods.push(leftFood);
        
        let rightFood = generateNewFood();
        rightFood.x = rightX - 1;
        rightFood.y = y;
        rightFood.points = 40;
        rightFood.color = '#9C27B0'; // Purple for teleport identification
        foods.push(rightFood);
    }
}

// Add teleport tunnels at map edges with improved visuals
function addEdgeTeleports() {
    const border = 20; // Border position
    
    // Create horizontal teleports (top to bottom) with enhanced visuals
    for (let x = border + 20; x < GRID_SIZE - border - 20; x += 80) {
        // Top teleport
        const topY = border;
        
        // Bottom teleport
        const bottomY = GRID_SIZE - border - 1;
        
        // Create openings
        walls = walls.filter(w => !(w.x === x && w.y === topY));
        walls = walls.filter(w => !(w.x === x && w.y === bottomY));
        
        // Create distinctive teleport markers (simplified visual without shadows)
        const markerSize = 4;
        
        // Top teleport marker - square pattern
        for (let dx = -markerSize; dx <= markerSize; dx += 2) {
            for (let dy = -markerSize; dy <= markerSize; dy += 2) {
                if (Math.abs(dx) === markerSize || Math.abs(dy) === markerSize) {
                    walls.push({x: x + dx, y: topY + Math.abs(dy) + 1});
                }
            }
        }
        
        // Bottom teleport marker - square pattern
        for (let dx = -markerSize; dx <= markerSize; dx += 2) {
            for (let dy = -markerSize; dy <= markerSize; dy += 2) {
                if (Math.abs(dx) === markerSize || Math.abs(dy) === markerSize) {
                    walls.push({x: x + dx, y: bottomY - Math.abs(dy) - 1});
                }
            }
        }
        
        // Add special food near teleports with distinctive color
        let topFood = generateNewFood();
        topFood.x = x;
        topFood.y = topY + 3;
        topFood.points = 25;
        topFood.color = '#9C27B0'; // Purple for teleport identification
        foods.push(topFood);
        
        let bottomFood = generateNewFood();
        bottomFood.x = x;
        bottomFood.y = bottomY - 3;
        bottomFood.points = 25;
        bottomFood.color = '#9C27B0'; // Purple for teleport identification
        foods.push(bottomFood);
    }
    
    // Create vertical teleports (left to right) with enhanced visuals
    for (let y = border + 20; y < GRID_SIZE - border - 20; y += 80) {
        // Left teleport
        const leftX = border;
        
        // Right teleport
        const rightX = GRID_SIZE - border - 1;
        
        // Create openings
        walls = walls.filter(w => !(w.x === leftX && w.y === y));
        walls = walls.filter(w => !(w.x === rightX && w.y === y));
        
        // Create distinctive teleport markers (simplified visual without shadows)
        const markerSize = 4;
        
        // Left teleport marker - circle pattern
        for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
            const dx = Math.floor(Math.cos(angle) * markerSize);
            const dy = Math.floor(Math.sin(angle) * markerSize);
            walls.push({x: leftX + Math.abs(dx) + 1, y: y + dy});
        }
        
        // Right teleport marker - circle pattern
        for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
            const dx = Math.floor(Math.cos(angle) * markerSize);
            const dy = Math.floor(Math.sin(angle) * markerSize);
            walls.push({x: rightX - Math.abs(dx) - 1, y: y + dy});
        }
        
        // Add special food near teleports with distinctive color
        let leftFood = generateNewFood();
        leftFood.x = leftX + 3;
        leftFood.y = y;
        leftFood.points = 25;
        leftFood.color = '#9C27B0'; // Purple for teleport identification
        foods.push(leftFood);
        
        let rightFood = generateNewFood();
        rightFood.x = rightX - 3;
        rightFood.y = y;
        rightFood.points = 25;
        rightFood.color = '#9C27B0'; // Purple for teleport identification
        foods.push(rightFood);
    }
}

// Create teleport hubs at strategic locations
function addTeleportHubs() {
    console.log("Adding teleport hubs at strategic locations...");
    
    // Define hub locations
    const hubLocations = [
        {x: 100, y: 100, radius: 20}, // Northwest hub
        {x: GRID_SIZE - 100, y: 100, radius: 20}, // Northeast hub  
        {x: 100, y: GRID_SIZE - 100, radius: 20}, // Southwest hub
        {x: GRID_SIZE - 100, y: GRID_SIZE - 100, radius: 20} // Southeast hub
    ];
    
    // Create each teleport hub
    hubLocations.forEach((hub, hubIndex) => {
        createTeleportHub(hub.x, hub.y, hubIndex);
    });
}

// Function to create a teleport hub with distinctive visual design
function createTeleportHub(centerX, centerY, hubIndex) {
    console.log(`Creating teleport hub at (${centerX},${centerY})`);
    
    const hubRadius = 15;
    const safeRadius = 20; // Ensure at least 20 steps of safe space
    
    // Clear any existing walls in the hub area AND the safe zone
    for (let dx = -safeRadius; dx <= safeRadius; dx++) {
        for (let dy = -safeRadius; dy <= safeRadius; dy++) {
            const x = centerX + dx;
            const y = centerY + dy;
            walls = walls.filter(w => !(w.x === x && w.y === y));
        }
    }
    
    // Create outer ring of teleport hub
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 16) {
        const x = Math.floor(centerX + Math.cos(angle) * hubRadius);
        const y = Math.floor(centerY + Math.sin(angle) * hubRadius);
        walls.push({x, y});
    }
    
    // Create 4 entrance/exit points at cardinal directions
    const entrances = [
        {dx: 0, dy: -hubRadius}, // North
        {dx: hubRadius, dy: 0},  // East
        {dx: 0, dy: hubRadius},  // South
        {dx: -hubRadius, dy: 0}  // West
    ];
    
    entrances.forEach(entrance => {
        // Clear entrance
        const entranceX = centerX + entrance.dx;
        const entranceY = centerY + entrance.dy;
        walls = walls.filter(w => !(w.x === entranceX && w.y === entranceY));
        
        // Add visual markers near entrance
        walls.push({x: entranceX + entrance.dy, y: entranceY + entrance.dx});
        walls.push({x: entranceX - entrance.dy, y: entranceY - entrance.dx});
    });
    
    // Create inner teleport markers
    for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2;
        const innerRadius = hubRadius * 0.6;
        
        const markerX = Math.floor(centerX + Math.cos(angle) * innerRadius);
        const markerY = Math.floor(centerY + Math.sin(angle) * innerRadius);
        
        // Create distinctive marker walls
        for (let mx = -1; mx <= 1; mx++) {
            for (let my = -1; my <= 1; my++) {
                if (mx === 0 && my === 0) continue; // Skip center
                walls.push({x: markerX + mx, y: markerY + my});
            }
        }
        
        // Add special teleport food at each marker
        let markerFood = generateNewFood();
        markerFood.x = markerX;
        markerFood.y = markerY;
        markerFood.points = 30;
        markerFood.color = '#9C27B0'; // Purple for teleport identification
        
        // Every other hub has power-ups
        if (hubIndex % 2 === 0) {
            const powerUpTypes = ['speed_boost', 'invincibility', 'magnet'];
            const randomPowerUp = powerUpTypes[i % powerUpTypes.length];
            markerFood.powerUp = randomPowerUp;
            markerFood.duration = 12000;
        }
        
        foods.push(markerFood);
    }
    
    // Add central hub marker
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue; // Skip center
            walls.push({x: centerX + dx, y: centerY + dy});
        }
    }
    
    // Add central high-value food
    let centerFood = generateNewFood();
    centerFood.x = centerX;
    centerFood.y = centerY;
    centerFood.points = 50;
    centerFood.color = '#E91E63'; // Pink for high-value hub center
    foods.push(centerFood);
}

// Add secret warp tunnels at key points in the map
function addSecretWarps() {
    // Define pairs of secret warp points
    const warpPairs = [
        // Pair 1: From treasure vault to ice rink
        {from: {x: GRID_SIZE - 110 + 30, y: 50 + 30}, to: {x: 50 + 30, y: 50 + 30}},
        
        // Pair 2: From dark forest to fractal maze
        {from: {x: GRID_SIZE - 110 + 40, y: GRID_SIZE - 120 + 40}, to: {x: 50 + 30, y: GRID_SIZE - 120 + 30}},
        
        // Pair 3: Secret warp from spiral maze center to a distant location
        {from: {x: 130, y: 130}, to: {x: GRID_SIZE - 130, y: GRID_SIZE - 130}}
    ];
    
    // Process each warp pair
    warpPairs.forEach(pair => {
        // Clear walls at warp points
        const clearRadius = 2;
        
        // Clear "from" point
        for (let dx = -clearRadius; dx <= clearRadius; dx++) {
            for (let dy = -clearRadius; dy <= clearRadius; dy++) {
                walls = walls.filter(w => 
                    !(w.x === pair.from.x + dx && w.y === pair.from.y + dy));
            }
        }
        
        // Clear "to" point
        for (let dx = -clearRadius; dx <= clearRadius; dx++) {
            for (let dy = -clearRadius; dy <= clearRadius; dy++) {
                walls = walls.filter(w => 
                    !(w.x === pair.to.x + dx && w.y === pair.to.y + dy));
            }
        }
        
        // Add visual indicators for secret warps
        const createWarpIndicator = (x, y) => {
            // Create a star-like pattern
            const starRadius = 4;
            for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
                const starX = Math.floor(x + starRadius * Math.cos(angle));
                const starY = Math.floor(y + starRadius * Math.sin(angle));
                walls.push({x: starX, y: starY});
            }
            
            // Add power-up in the center
            let powerUp = generateNewFood();
            powerUp.x = x;
            powerUp.y = y;
            powerUp.powerUp = 'invincibility';  // Secret warps grant invincibility
            powerUp.duration = 12000;
            powerUp.color = '#9C27B0';
            foods.push(powerUp);
        };
        
        createWarpIndicator(pair.from.x, pair.from.y);
        createWarpIndicator(pair.to.x, pair.to.y);
    });
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

// Global variable for wall thickness needed by some functions
const wallThickness = 3;


// Generate walls once during server initialization
generateWalls();

// Add our new reward passages
createRewardPassages();

console.log('Snake game server running on port 8080');
