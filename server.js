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
    
    // Create the safe zone at the center
    const safeZoneX = Math.floor(GRID_SIZE / 2);
    const safeZoneY = Math.floor(GRID_SIZE / 2);
    // This creates a square room that's slightly larger than the safe zone
    const safeRoomSize = SAFE_ZONE_RADIUS * 2; // Now 60x60 instead of 100x100
    const safeRoomStartX = safeZoneX - safeRoomSize / 2;
    const safeRoomStartY = safeZoneY - safeRoomSize / 2;
    
    // Add horizontal walls for the safe room
    for (let x = safeRoomStartX; x < safeRoomStartX + safeRoomSize; x++) {
        walls.push({x, y: safeRoomStartY});
        walls.push({x, y: safeRoomStartY + safeRoomSize});
    }
    
    // Add vertical walls for the safe room
    for (let y = safeRoomStartY; y < safeRoomStartY + safeRoomSize; y++) {
        walls.push({x: safeRoomStartX, y});
        walls.push({x: safeRoomStartX + safeRoomSize, y});
    }

    // Generate maze-like corridors and room structures
    generateMazeStructure();
    
    // Add themed areas with special challenges
    createThemedAreas();
    
    // Add narrow passages with high-value rewards
    createNarrowPassages();
    
    // Create interconnecting tunnels between regions
    createConnectingTunnels();
    
    // Keep teleport tunnels for gameplay value
    addPacManTeleportTunnels();
}

// Generate the main maze structure with interconnected corridors and rooms
function generateMazeStructure() {
    console.log("Generating maze structure...");
    const centerX = Math.floor(GRID_SIZE / 2);
    const centerY = Math.floor(GRID_SIZE / 2);
    
    // Divide the map into regions for different maze patterns
    const regions = [
        // Four quadrants around the safe zone
        { name: "northwest", x: 30, y: 30, width: centerX - 60, height: centerY - 60 },
        { name: "northeast", x: centerX + 30, y: 30, width: GRID_SIZE - centerX - 60, height: centerY - 60 },
        { name: "southwest", x: 30, y: centerY + 30, width: centerX - 60, height: GRID_SIZE - centerY - 60 },
        { name: "southeast", x: centerX + 30, y: centerY + 30, width: GRID_SIZE - centerX - 60, height: GRID_SIZE - centerY - 60 }
    ];
    
    // Create different maze patterns in each region
    regions.forEach(region => {
        switch(region.name) {
            case "northwest":
                createSpiralMaze(region.x, region.y, region.width, region.height);
                break;
            case "northeast": 
                createGridRooms(region.x, region.y, region.width, region.height);
                break;
            case "southwest":
                createRandomCurvedPaths(region.x, region.y, region.width, region.height);
                break;
            case "southeast":
                createLabyrinth(region.x, region.y, region.width, region.height);
                break;
        }
    });
    
    // Create corridors connecting the safe zone to each region
    createMainCorridors(centerX, centerY);
}

// Create a spiral maze in the given region
function createSpiralMaze(startX, startY, width, height) {
    console.log(`Creating spiral maze at (${startX},${startY}) with size ${width}x${height}`);
    
    // Parameters for the spiral
    const centerX = startX + Math.floor(width / 2);
    const centerY = startY + Math.floor(height / 2);
    const maxRadius = Math.min(width, height) / 2 - 5;
    const spiralSpacing = 8; // Space between spiral walls
    const spiralSegments = Math.floor(maxRadius / spiralSpacing);
    
    // Create spiral walls
    for (let i = 0; i < spiralSegments; i++) {
        const radius = (i + 1) * spiralSpacing;
        const angleStart = i * 0.5 * Math.PI;
        const angleEnd = angleStart + 2 * Math.PI - 0.1;
        
        // Create a spiral segment
        for (let angle = angleStart; angle <= angleEnd; angle += 0.05) {
            const x = Math.floor(centerX + radius * Math.cos(angle));
            const y = Math.floor(centerY + radius * Math.sin(angle));
            
            // Ensure we're within bounds
            if (x >= startX && x < startX + width && y >= startY && y < startY + height) {
                walls.push({x, y});
            }
        }
        
        // Create an opening in each spiral layer
        const openingAngle = angleStart + Math.PI / 2;
        const openX1 = Math.floor(centerX + radius * Math.cos(openingAngle));
        const openY1 = Math.floor(centerY + radius * Math.sin(openingAngle));
        const openX2 = Math.floor(centerX + (radius - spiralSpacing) * Math.cos(openingAngle));
        const openY2 = Math.floor(centerY + (radius - spiralSpacing) * Math.sin(openingAngle));
        
        // Remove walls at the opening
        walls = walls.filter(wall => 
            !(wall.x >= Math.min(openX1, openX2) && wall.x <= Math.max(openX1, openX2) && 
              wall.y >= Math.min(openY1, openY2) && wall.y <= Math.max(openY1, openY2)));
    }
    
    // Add valuable rewards at the center of the spiral
    for (let i = 0; i < 3; i++) {
        const foodX = centerX + Math.floor(Math.random() * 4) - 2;
        const foodY = centerY + Math.floor(Math.random() * 4) - 2;
        
        let food = generateNewFood();
        food.x = foodX;
        food.y = foodY;
        
        // Random power-up as reward
        const powerUpTypes = ['speed_boost', 'invincibility', 'magnet'];
        const randomPowerUp = powerUpTypes[Math.floor(Math.random() * powerUpTypes.length)];
        food.powerUp = randomPowerUp;
        food.duration = 15000; // Longer duration as reward
        food.points = 30;
        
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
        
        foods.push(food);
    }
    
    // Add treasure along the spiral path
    for (let i = 1; i < spiralSegments; i++) {
        const radius = (i + 0.5) * spiralSpacing;
        const angle = i * 0.7 * Math.PI;
        const foodX = Math.floor(centerX + radius * Math.cos(angle));
        const foodY = Math.floor(centerY + radius * Math.sin(angle));
        
        let food = generateNewFood();
        food.x = foodX;
        food.y = foodY;
        food.points = 15 + i * 5;
        food.color = '#FFC107';
        foods.push(food);
    }
}

// Create grid of interconnected rooms
function createGridRooms(startX, startY, width, height) {
    console.log(`Creating grid rooms at (${startX},${startY}) with size ${width}x${height}`);
    
    const roomsX = 3;
    const roomsY = 3; 
    const roomWidth = Math.floor(width / roomsX);
    const roomHeight = Math.floor(height / roomsY);
    
    // Track which rooms have been connected
    const connectedRooms = new Set();
    
    // Create rooms
    for (let x = 0; x < roomsX; x++) {
        for (let y = 0; y < roomsY; y++) {
            const roomStartX = startX + x * roomWidth;
            const roomStartY = startY + y * roomHeight;
            
            // Create room walls
            for (let wx = roomStartX; wx < roomStartX + roomWidth; wx++) {
                walls.push({x: wx, y: roomStartY});
                walls.push({x: wx, y: roomStartY + roomHeight - 1});
            }
            
            for (let wy = roomStartY; wy < roomStartY + roomHeight; wy++) {
                walls.push({x: roomStartX, y: wy});
                walls.push({x: roomStartX + roomWidth - 1, y: wy});
            }
            
            // Add room identifier to the set
            const roomId = `${x},${y}`;
            connectedRooms.add(roomId);
            
            // Add a special feature to each room
            const featureType = Math.floor(Math.random() * 4);
            switch(featureType) {
                case 0: // Center obstacle with food
                    createRoomCenterObstacle(roomStartX, roomStartY, roomWidth, roomHeight);
                    break;
                case 1: // Cross pattern
                    createRoomCrossPattern(roomStartX, roomStartY, roomWidth, roomHeight);
                    break;
                case 2: // Diagonal walls
                    createRoomDiagonalWalls(roomStartX, roomStartY, roomWidth, roomHeight);
                    break;
                case 3: // Island with treasure
                    createRoomIsland(roomStartX, roomStartY, roomWidth, roomHeight);
                    break;
            }
        }
    }
    
    // Create doorways between adjacent rooms
    for (let x = 0; x < roomsX; x++) {
        for (let y = 0; y < roomsY; y++) {
            const roomStartX = startX + x * roomWidth;
            const roomStartY = startY + y * roomHeight;
            
            // Create east doorway (if not on edge)
            if (x < roomsX - 1) {
                const doorY = roomStartY + Math.floor(roomHeight / 2);
                // Remove wall sections to create door
                walls = walls.filter(wall => 
                    !(wall.x === roomStartX + roomWidth - 1 && wall.y === doorY) &&
                    !(wall.x === roomStartX + roomWidth && wall.y === doorY));
            }
            
            // Create south doorway (if not on edge)
            if (y < roomsY - 1) {
                const doorX = roomStartX + Math.floor(roomWidth / 2);
                // Remove wall sections to create door
                walls = walls.filter(wall => 
                    !(wall.x === doorX && wall.y === roomStartY + roomHeight - 1) &&
                    !(wall.x === doorX && wall.y === roomStartY + roomHeight));
            }
        }
    }
}

// Create random curved paths in the given region
function createRandomCurvedPaths(startX, startY, width, height) {
    console.log(`Creating random curved paths at (${startX},${startY}) with size ${width}x${height}`);
    
    // Create a grid overlay for placing paths
    const gridSize = 10;
    const gridCellsX = Math.floor(width / gridSize);
    const gridCellsY = Math.floor(height / gridSize);
    
    // Generate random path points
    const pathPoints = [];
    const numPoints = 10;
    
    for (let i = 0; i < numPoints; i++) {
        pathPoints.push({
            x: startX + Math.floor(Math.random() * width),
            y: startY + Math.floor(Math.random() * height)
        });
    }
    
    // Connect the path points with curved walls
    for (let i = 0; i < pathPoints.length - 1; i++) {
        const p1 = pathPoints[i];
        const p2 = pathPoints[i + 1];
        
        // Create a curved wall between points
        createCurvedWall(p1.x, p1.y, p2.x, p2.y);
        
        // Add food along the path
        const midX = Math.floor((p1.x + p2.x) / 2);
        const midY = Math.floor((p1.y + p2.y) / 2);
        
        let food = generateNewFood();
        food.x = midX;
        food.y = midY;
        food.points = 20;
        food.color = '#FFC107';
        foods.push(food);
    }
    
    // Create some pockets of food surrounded by walls
    for (let i = 0; i < 5; i++) {
        const pocketX = startX + Math.floor(Math.random() * (width - 15));
        const pocketY = startY + Math.floor(Math.random() * (height - 15));
        const pocketSize = 5 + Math.floor(Math.random() * 7);
        
        // Create circular wall
        for (let angle = 0; angle < 2 * Math.PI; angle += 0.1) {
            const wallX = Math.floor(pocketX + pocketSize * Math.cos(angle));
            const wallY = Math.floor(pocketY + pocketSize * Math.sin(angle));
            walls.push({x: wallX, y: wallY});
        }
        
        // Create opening
        const openingAngle = Math.random() * 2 * Math.PI;
        const openX1 = Math.floor(pocketX + pocketSize * Math.cos(openingAngle));
        const openY1 = Math.floor(pocketY + pocketSize * Math.sin(openingAngle));
        const openX2 = Math.floor(pocketX + pocketSize * Math.cos(openingAngle + 0.3));
        const openY2 = Math.floor(pocketY + pocketSize * Math.sin(openingAngle + 0.3));
        
        walls = walls.filter(wall => 
            !(wall.x >= Math.min(openX1, openX2) && wall.x <= Math.max(openX1, openX2) && 
              wall.y >= Math.min(openY1, openY2) && wall.y <= Math.max(openY1, openY2)));
        
        // Add food or power-up inside
        if (Math.random() < 0.3) {
            // Add power-up
            let food = generateNewFood();
            food.x = pocketX;
            food.y = pocketY;
            
            const powerUpTypes = ['speed_boost', 'invincibility', 'magnet'];
            const randomPowerUp = powerUpTypes[Math.floor(Math.random() * powerUpTypes.length)];
            food.powerUp = randomPowerUp;
            food.duration = 12000;
            
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
            
            foods.push(food);
        } else {
            // Add high value food
            for (let j = 0; j < 3; j++) {
                const foodX = pocketX + Math.floor(Math.random() * 3) - 1;
                const foodY = pocketY + Math.floor(Math.random() * 3) - 1;
                
                let food = generateNewFood();
                food.x = foodX;
                food.y = foodY;
                food.points = 25;
                food.color = '#8BC34A';
                foods.push(food);
            }
        }
    }
}

// Create a labyrinth structure
function createLabyrinth(startX, startY, width, height) {
    console.log(`Creating labyrinth at (${startX},${startY}) with size ${width}x${height}`);
    
    // Use a modified recursive division algorithm
    createRecursiveDivisionMaze(startX, startY, width, height, 4);
    
    // Add some treasures in dead ends
    addTreasuresInDeadEnds(startX, startY, width, height);
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

// Create narrow passages with high-value rewards
function createNarrowPassages() {
    console.log("Creating narrow passages with rewards...");
    
    // Function to create a narrow passage between two points
    const createNarrowPassage = (x1, y1, x2, y2, width) => {
        // Determine direction
        const dx = x2 - x1;
        const dy = y2 - y1;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // Create walls along path
        for (let i = 0; i <= distance; i++) {
            const t = i / distance;
            const x = Math.floor(x1 + dx * t);
            const y = Math.floor(y1 + dy * t);
            
            // Create walls on both sides of the path
            const perpX = -dy / distance;
            const perpY = dx / distance;
            
            for (let j = 1; j <= width; j++) {
                // Left wall
                walls.push({x: Math.floor(x + perpX * j), y: Math.floor(y + perpY * j)});
                
                // Right wall
                walls.push({x: Math.floor(x - perpX * j), y: Math.floor(y - perpY * j)});
            }
        }
        
        // Place rewards along the passage
        for (let i = 0; i < distance; i += Math.max(3, Math.floor(distance / 10))) {
            const t = i / distance;
            const foodX = Math.floor(x1 + dx * t);
            const foodY = Math.floor(y1 + dy * t);
            
            // Skip if position is a wall
            const isWall = walls.some(wall => wall.x === foodX && wall.y === foodY);
            if (!isWall) {
                let food = generateNewFood();
                food.x = foodX;
                food.y = foodY;
                food.points = 10 + Math.floor(i / distance * 40); // Value increases as you go deeper
                food.color = '#FF9800';
                foods.push(food);
            }
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
        } else {
            let food = generateNewFood();
            food.x = x2;
            food.y = y2;
            food.points = 50;
            food.color = '#FF5722';
            foods.push(food);
        }
    };
    
    // Create 5 narrow passages in different parts of the map
    const centerX = Math.floor(GRID_SIZE / 2);
    const centerY = Math.floor(GRID_SIZE / 2);
    const safeZoneRadius = SAFE_ZONE_RADIUS * 2;
    
    const passageEndpoints = [
        // From edges to about halfway to center
        {start: {x: 30, y: 30}, end: {x: centerX - safeZoneRadius, y: centerY - safeZoneRadius}},
        {start: {x: GRID_SIZE - 30, y: 30}, end: {x: centerX + safeZoneRadius, y: centerY - safeZoneRadius}},
        {start: {x: 30, y: GRID_SIZE - 30}, end: {x: centerX - safeZoneRadius, y: centerY + safeZoneRadius}},
        {start: {x: GRID_SIZE - 30, y: GRID_SIZE - 30}, end: {x: centerX + safeZoneRadius, y: centerY + safeZoneRadius}},
        
        // One diagonal passage across the map
        {start: {x: 30, y: GRID_SIZE - 30}, end: {x: GRID_SIZE - 30, y: 30}}
    ];
    
    // Create each passage
    passageEndpoints.forEach((passage, index) => {
        const width = index === 4 ? 3 : 2; // Last passage is wider
        createNarrowPassage(passage.start.x, passage.start.y, passage.end.x, passage.end.y, width);
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



// Function to add teleport tunnels throughout the map
function addPacManTeleportTunnels() {
    console.log("Adding teleport tunnels...");
    
    // For traditional snake game, we'll add teleport tunnels to the main room
    const centerX = Math.floor(GRID_SIZE / 2);
    const centerY = Math.floor(GRID_SIZE / 2);
    const safeRoomSize = SAFE_ZONE_RADIUS * 2;
    const safeRoomStartX = centerX - safeRoomSize / 2;
    const safeRoomStartY = centerY - safeRoomSize / 2;
    
    // Create teleport tunnel on the right side of the main room
    const tunnelY = safeRoomStartY + Math.floor(safeRoomSize / 2);
    
    // Right tunnel entrance in the room - just one cell
    walls = walls.filter(w => !(w.x === safeRoomStartX + safeRoomSize && w.y === tunnelY));
    
    // Left tunnel entrance to match - just one cell
    walls = walls.filter(w => !(w.x === safeRoomStartX && w.y === tunnelY));
    
    // Add decorative walls around the teleport areas
    for (let i = 1; i <= 3; i++) {
        walls.push({x: safeRoomStartX + safeRoomSize + i, y: tunnelY - 1});
        walls.push({x: safeRoomStartX + safeRoomSize + i, y: tunnelY + 1});
        
        walls.push({x: safeRoomStartX - i, y: tunnelY - 1});
        walls.push({x: safeRoomStartX - i, y: tunnelY + 1});
    }
    
    // Add more teleport tunnels throughout the map (map edges)
    addEdgeTeleports();
    
    // Add secret warp tunnels at key points
    addSecretWarps();
}

// Add teleport tunnels at map edges
function addEdgeTeleports() {
    const border = 20; // Border position
    
    // Create horizontal teleports (top to bottom)
    for (let x = border + 20; x < GRID_SIZE - border - 20; x += 80) {
        // Top teleport
        const topY = border;
        
        // Bottom teleport
        const bottomY = GRID_SIZE - border - 1;
        
        // Create openings
        walls = walls.filter(w => !(w.x === x && w.y === topY));
        walls = walls.filter(w => !(w.x === x && w.y === bottomY));
        
        // Add visual indicators
        for (let i = 1; i <= 2; i++) {
            // Top teleport indicators
            walls.push({x: x-i, y: topY+1});
            walls.push({x: x+i, y: topY+1});
            
            // Bottom teleport indicators
            walls.push({x: x-i, y: bottomY-1});
            walls.push({x: x+i, y: bottomY-1});
        }
        
        // Add special food near teleports
        let topFood = generateNewFood();
        topFood.x = x;
        topFood.y = topY + 3;
        topFood.points = 25;
        topFood.color = '#FF9800';
        foods.push(topFood);
        
        let bottomFood = generateNewFood();
        bottomFood.x = x;
        bottomFood.y = bottomY - 3;
        bottomFood.points = 25;
        bottomFood.color = '#FF9800';
        foods.push(bottomFood);
    }
    
    // Create vertical teleports (left to right)
    for (let y = border + 20; y < GRID_SIZE - border - 20; y += 80) {
        // Left teleport
        const leftX = border;
        
        // Right teleport
        const rightX = GRID_SIZE - border - 1;
        
        // Create openings
        walls = walls.filter(w => !(w.x === leftX && w.y === y));
        walls = walls.filter(w => !(w.x === rightX && w.y === y));
        
        // Add visual indicators
        for (let i = 1; i <= 2; i++) {
            // Left teleport indicators
            walls.push({x: leftX+1, y: y-i});
            walls.push({x: leftX+1, y: y+i});
            
            // Right teleport indicators
            walls.push({x: rightX-1, y: y-i});
            walls.push({x: rightX-1, y: y+i});
        }
        
        // Add special food near teleports
        let leftFood = generateNewFood();
        leftFood.x = leftX + 3;
        leftFood.y = y;
        leftFood.points = 25;
        leftFood.color = '#FF9800';
        foods.push(leftFood);
        
        let rightFood = generateNewFood();
        rightFood.x = rightX - 3;
        rightFood.y = y;
        rightFood.points = 25;
        rightFood.color = '#FF9800';
        foods.push(rightFood);
    }
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

console.log('Snake game server running on port 8080');
