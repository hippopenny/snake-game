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
    
    // Create outer border walls with simpler structure
    const border = 20; 
    
    // Add horizontal border walls
    for (let x = border; x < GRID_SIZE - border; x += 2) { // Add gaps by incrementing by 2
        if (!isSafe(x, border)) walls.push({x, y: border});
        if (!isSafe(x, GRID_SIZE - border - 1)) walls.push({x, y: GRID_SIZE - border - 1});
    }
    
    // Add vertical border walls
    for (let y = border; y < GRID_SIZE - border; y += 2) { // Add gaps by incrementing by 2
        if (!isSafe(border, y)) walls.push({x: border, y});
        if (!isSafe(GRID_SIZE - border - 1, y)) walls.push({x: GRID_SIZE - border - 1, y});
    }
    
    // Create the safe zone at the center
    const safeRoomSize = SAFE_ZONE_RADIUS * 2; 
    const safeRoomStartX = centerX - safeRoomSize / 2;
    const safeRoomStartY = centerY - safeRoomSize / 2;
    
    // Add safe room walls with large entrances on all sides
    
    // Top and bottom walls with openings
    const topEntranceStart = safeRoomStartX + Math.floor(safeRoomSize * 0.4);
    const topEntranceEnd = safeRoomStartX + Math.floor(safeRoomSize * 0.6);
    for (let x = safeRoomStartX; x < safeRoomStartX + safeRoomSize; x++) {
        if (x < topEntranceStart || x > topEntranceEnd) {
            walls.push({x, y: safeRoomStartY});
            walls.push({x, y: safeRoomStartY + safeRoomSize});
        }
    }
    
    // Left and right walls with openings
    const sideEntranceStart = safeRoomStartY + Math.floor(safeRoomSize * 0.4);
    const sideEntranceEnd = safeRoomStartY + Math.floor(safeRoomSize * 0.6);
    for (let y = safeRoomStartY; y < safeRoomStartY + safeRoomSize; y++) {
        if (y < sideEntranceStart || y > sideEntranceEnd) {
            walls.push({x: safeRoomStartX, y});
            walls.push({x: safeRoomStartX + safeRoomSize, y});
        }
    }

    // Generate simpler room-based layout
    createRoomBasedLayout();
    
    // Add teleport tunnels for quick travel around the map
    addTeleportTunnels();
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
    console.log("Creating room-based layout...");
    const centerX = Math.floor(GRID_SIZE / 2);
    const centerY = Math.floor(GRID_SIZE / 2);
    
    // Define the main room regions
    const regions = [
        { name: "northwest", x: 40, y: 40, width: centerX - 70, height: centerY - 70 },
        { name: "northeast", x: centerX + 30, y: 40, width: GRID_SIZE - centerX - 70, height: centerY - 70 },
        { name: "southwest", x: 40, y: centerY + 30, width: centerX - 70, height: GRID_SIZE - centerY - 70 },
        { name: "southeast", x: centerX + 30, y: centerY + 30, width: GRID_SIZE - centerX - 70, height: GRID_SIZE - centerY - 70 }
    ];
    
    // Create different room layouts in each region
    regions.forEach(region => {
        switch(region.name) {
            case "northwest":
                createCircularRoomLayout(region.x, region.y, region.width, region.height);
                break;
            case "northeast": 
                createGridRoomsSimplified(region.x, region.y, region.width, region.height);
                break;
            case "southwest":
                createOpenAreaWithObstacles(region.x, region.y, region.width, region.height);
                break;
            case "southeast":
                createSimpleLabyrinth(region.x, region.y, region.width, region.height);
                break;
        }
    });
    
    // Create wide corridors connecting the safe zone to each region
    createWideCorridors(centerX, centerY);
}

// Function to create wider corridors connecting safe zone to each region
function createWideCorridors(centerX, centerY) {
    console.log("Creating wide corridors from safe zone to regions...");
    
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
        const corridorWidth = 5; // Make corridors wider (5 cells instead of 3)
        
        // Start offset from center to avoid overlapping with safe zone
        const safeZoneRadius = SAFE_ZONE_RADIUS;
        const startOffset = safeZoneRadius + 5;
        
        // Create corridor
        for (let i = startOffset; i <= corridor.length + startOffset; i += 2) { // Skip every other cell for a more open feel
            const x = Math.floor(centerX + i * corridor.dx);
            const y = Math.floor(centerY + i * corridor.dy);
            
            // Clear walls in a corridor width
            for (let w = -corridorWidth; w <= corridorWidth; w++) {
                const perpX = Math.floor(x + w * Math.cos(angle + Math.PI/2));
                const perpY = Math.floor(y + w * Math.sin(angle + Math.PI/2));
                
                walls = walls.filter(wall => !(wall.x === perpX && wall.y === perpY));
            }
            
            // Add food along the corridor
            if (i % 10 === 0 && Math.random() < 0.5) {
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

// Create a circular room layout with concentric rings
function createCircularRoomLayout(startX, startY, width, height) {
    console.log(`Creating circular room layout at (${startX},${startY}) with size ${width}x${height}`);
    
    // Parameters for the concentric rings
    const centerX = startX + Math.floor(width / 2);
    const centerY = startY + Math.floor(height / 2);
    const maxRadius = Math.min(width, height) / 2 - 10;
    const ringSpacing = 20; // Wider spaces between rings
    const rings = Math.floor(maxRadius / ringSpacing);
    
    // Create rings with large gaps at cardinal directions
    for (let i = 1; i <= rings; i++) {
        const radius = i * ringSpacing;
        
        // Place ring segments with gaps at cardinal directions
        for (let angle = 0; angle < 2 * Math.PI; angle += 0.05) {
            // Skip segments at cardinal directions to create gaps
            const cardinalGap = 0.3; // Gap size
            const isNearCardinal = (
                Math.abs(angle % (Math.PI/2)) < cardinalGap/2 || 
                Math.abs(angle % (Math.PI/2) - Math.PI/2) < cardinalGap/2
            );
            
            if (!isNearCardinal) {
                const x = Math.floor(centerX + radius * Math.cos(angle));
                const y = Math.floor(centerY + radius * Math.sin(angle));
                
                // Ensure we're within bounds
                if (x >= startX && x < startX + width && y >= startY && y < startY + height) {
                    walls.push({x, y});
                }
            }
        }
    }
    
    // Add ring-crossing paths at 45-degree angles
    for (let angle = Math.PI/4; angle < 2 * Math.PI; angle += Math.PI/2) {
        for (let r = 0; r < maxRadius; r += 3) { // Skip cells to make paths wider
            const x = Math.floor(centerX + r * Math.cos(angle));
            const y = Math.floor(centerY + r * Math.sin(angle));
            
            // Remove any walls at this position
            walls = walls.filter(wall => !(wall.x === x && wall.y === y));
        }
    }
    
    // Add valuable rewards in the center
    for (let i = 0; i < 3; i++) {
        const foodX = centerX + Math.floor(Math.random() * 6) - 3;
        const foodY = centerY + Math.floor(Math.random() * 6) - 3;
        
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
            case 'speed_boost': food.color = '#00BCD4'; break;
            case 'invincibility': food.color = '#9C27B0'; break;
            case 'magnet': food.color = '#FFEB3B'; break;
        }
        
        foods.push(food);
    }
    
    // Add treasure along each ring
    for (let i = 1; i <= rings; i++) {
        const radius = i * ringSpacing;
        
        // Place food at 8 positions around each ring
        for (let j = 0; j < 8; j++) {
            const angle = j * Math.PI / 4;
            const foodX = Math.floor(centerX + radius * Math.cos(angle));
            const foodY = Math.floor(centerY + radius * Math.sin(angle));
            
            let food = generateNewFood();
            food.x = foodX;
            food.y = foodY;
            food.points = 10 + i * 5;
            food.color = '#FFC107';
            foods.push(food);
        }
    }
}

// Create simplified grid of interconnected rooms with wider doorways
function createGridRoomsSimplified(startX, startY, width, height) {
    console.log(`Creating grid rooms at (${startX},${startY}) with size ${width}x${height}`);
    
    const roomsX = 2; // Fewer, larger rooms
    const roomsY = 2; 
    const roomWidth = Math.floor(width / roomsX);
    const roomHeight = Math.floor(height / roomsY);
    
    // Create rooms
    for (let x = 0; x < roomsX; x++) {
        for (let y = 0; y < roomsY; y++) {
            const roomStartX = startX + x * roomWidth;
            const roomStartY = startY + y * roomHeight;
            
            // Create room walls with gaps (don't make solid walls)
            // Top and bottom walls with some gaps
            for (let wx = roomStartX; wx < roomStartX + roomWidth; wx += 3) { // Add a wall, skip 2
                walls.push({x: wx, y: roomStartY});
                walls.push({x: wx, y: roomStartY + roomHeight - 1});
            }
            
            // Left and right walls with some gaps
            for (let wy = roomStartY; wy < roomStartY + roomHeight; wy += 3) { // Add a wall, skip 2
                walls.push({x: roomStartX, y: wy});
                walls.push({x: roomStartX + roomWidth - 1, y: wy});
            }
            
            // Add a simple feature to each room
            const featureType = Math.floor(Math.random() * 2); // Only 2 simple feature types
            switch(featureType) {
                case 0: // Center platform with food
                    createSimpleCenterPlatform(roomStartX, roomStartY, roomWidth, roomHeight);
                    break;
                case 1: // Cross paths 
                    createSimpleCrossPaths(roomStartX, roomStartY, roomWidth, roomHeight);
                    break;
            }
        }
    }
    
    // Create wide doorways between adjacent rooms
    for (let x = 0; x < roomsX; x++) {
        for (let y = 0; y < roomsY; y++) {
            const roomStartX = startX + x * roomWidth;
            const roomStartY = startY + y * roomHeight;
            
            // Create east doorway (if not on edge)
            if (x < roomsX - 1) {
                const doorY = roomStartY + Math.floor(roomHeight / 2);
                const doorHeight = Math.floor(roomHeight / 5); // 20% of room height
                
                // Remove wall sections to create wide door
                for (let dy = -doorHeight; dy <= doorHeight; dy++) {
                    walls = walls.filter(wall => 
                        !(wall.x === roomStartX + roomWidth - 1 && wall.y === doorY + dy) &&
                        !(wall.x === roomStartX + roomWidth && wall.y === doorY + dy));
                }
            }
            
            // Create south doorway (if not on edge)
            if (y < roomsY - 1) {
                const doorX = roomStartX + Math.floor(roomWidth / 2);
                const doorWidth = Math.floor(roomWidth / 5); // 20% of room width
                
                // Remove wall sections to create wide door
                for (let dx = -doorWidth; dx <= doorWidth; dx++) {
                    walls = walls.filter(wall => 
                        !(wall.x === doorX + dx && wall.y === roomStartY + roomHeight - 1) &&
                        !(wall.x === doorX + dx && wall.y === roomStartY + roomHeight));
                }
            }
        }
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

// Create an open area with scattered obstacles
function createOpenAreaWithObstacles(startX, startY, width, height) {
    console.log(`Creating open area with obstacles at (${startX},${startY}) with size ${width}x${height}`);
    
    // Create perimeter markers instead of walls (just corner posts)
    walls.push({x: startX, y: startY}); // Top-left
    walls.push({x: startX + width - 1, y: startY}); // Top-right
    walls.push({x: startX, y: startY + height - 1}); // Bottom-left
    walls.push({x: startX + width - 1, y: startY + height - 1}); // Bottom-right
    
    // Generate random obstacle points
    const obstaclePoints = [];
    const numObstacles = 8;
    
    // Place obstacles away from edges and not too close together
    for (let i = 0; i < numObstacles; i++) {
        const obX = startX + 20 + Math.floor(Math.random() * (width - 40));
        const obY = startY + 20 + Math.floor(Math.random() * (height - 40));
        
        // Check distance from existing obstacles
        let tooClose = false;
        for (const existing of obstaclePoints) {
            const dx = obX - existing.x;
            const dy = obY - existing.y;
            const distSq = dx * dx + dy * dy;
            if (distSq < 400) { // Minimum 20 cells apart
                tooClose = true;
                break;
            }
        }
        
        if (!tooClose) {
            obstaclePoints.push({x: obX, y: obY});
        }
    }
    
    // Create varied obstacle shapes
    obstaclePoints.forEach((point, index) => {
        const shapeType = index % 3;
        
        switch (shapeType) {
            case 0: // Square obstacle
                createSquareObstacle(point.x, point.y, 5 + Math.floor(Math.random() * 5));
                break;
            case 1: // Diamond obstacle
                createDiamondObstacle(point.x, point.y, 4 + Math.floor(Math.random() * 4));
                break;
            case 2: // L-shaped obstacle
                createLShapedObstacle(point.x, point.y, 6 + Math.floor(Math.random() * 4));
                break;
        }
    });
    
    // Add food or power-ups near obstacles
    obstaclePoints.forEach(point => {
        // Place food around obstacle
        for (let i = 0; i < 4; i++) {
            const angle = i * Math.PI / 2;
            const distance = 8 + Math.floor(Math.random() * 4);
            const foodX = Math.floor(point.x + distance * Math.cos(angle));
            const foodY = Math.floor(point.y + distance * Math.sin(angle));
            
            // Check if position is within bounds
            if (foodX > startX && foodX < startX + width - 1 && 
                foodY > startY && foodY < startY + height - 1) {
                
                // Check if position isn't a wall
                const isWall = walls.some(wall => wall.x === foodX && wall.y === foodY);
                if (!isWall) {
                    let food = generateNewFood();
                    food.x = foodX;
                    food.y = foodY;
                    food.points = 20;
                    food.color = '#FFC107';
                    foods.push(food);
                }
            }
        }
        
        // Small chance of power-up in center of obstacles
        if (Math.random() < 0.25) {
            // Add power-up
            let food = generateNewFood();
            food.x = point.x;
            food.y = point.y;
            
            const powerUpTypes = ['speed_boost', 'invincibility', 'magnet'];
            const randomPowerUp = powerUpTypes[Math.floor(Math.random() * powerUpTypes.length)];
            food.powerUp = randomPowerUp;
            food.duration = 12000;
            
            switch (randomPowerUp) {
                case 'speed_boost': food.color = '#00BCD4'; break;
                case 'invincibility': food.color = '#9C27B0'; break;
                case 'magnet': food.color = '#FFEB3B'; break;
            }
            
            foods.push(food);
        }
    });
    
    // Add bonus food in the center of the area
    const centerFood = generateNewFood();
    centerFood.x = startX + Math.floor(width / 2);
    centerFood.y = startY + Math.floor(height / 2);
    centerFood.points = 50;
    centerFood.color = '#FF5722';
    foods.push(centerFood);
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
// Create a simple labyrinth with wider paths and clear navigation
function createSimpleLabyrinth(startX, startY, width, height) {
    console.log(`Creating simple labyrinth at (${startX},${startY}) with size ${width}x${height}`);
    
    // Use a more generous grid size with wider paths
    const gridSize = 20; // Larger grid cells
    const gridWidth = Math.floor(width / gridSize);
    const gridHeight = Math.floor(height / gridSize);
    
    // Create a simple grid-based maze with wider corridors
    for (let x = 0; x < gridWidth; x++) {
        for (let y = 0; y < gridHeight; y++) {
            // Only place walls at even grid positions to create larger rooms
            if (x % 2 === 0 && y % 2 === 0) {
                // Place walls with deliberate gaps
                if (Math.random() < 0.7) {
                    const wallX = startX + x * gridSize;
                    const wallY = startY + y * gridSize;
                    const wallLength = Math.floor(gridSize * 0.7); // Leave gaps
                    
                    // Randomly choose horizontal or vertical wall
                    if (Math.random() < 0.5) {
                        // Horizontal wall
                        for (let i = 0; i < wallLength; i++) {
                            walls.push({x: wallX + i, y: wallY});
                        }
                    } else {
                        // Vertical wall
                        for (let i = 0; i < wallLength; i++) {
                            walls.push({x: wallX, y: wallY + i});
                        }
                    }
                }
            }
        }
    }
    
    // Add treasures throughout the labyrinth
    addTreasureChests(startX, startY, width, height);
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



// Function to add simplified teleport tunnels throughout the map
function addTeleportTunnels() {
    console.log("Adding teleport tunnels...");
    
    // For traditional snake game, we'll add teleport tunnels to the main room
    const centerX = Math.floor(GRID_SIZE / 2);
    const centerY = Math.floor(GRID_SIZE / 2);
    const safeRoomSize = SAFE_ZONE_RADIUS * 2;
    const safeRoomStartX = centerX - safeRoomSize / 2;
    const safeRoomStartY = centerY - safeRoomSize / 2;
    
    // Create teleport tunnel on the right side of the main room
    const tunnelY = safeRoomStartY + Math.floor(safeRoomSize / 2);
    
    // Right tunnel entrance in the room - wider opening (3 cells)
    for (let offset = -1; offset <= 1; offset++) {
        walls = walls.filter(w => !(w.x === safeRoomStartX + safeRoomSize && w.y === tunnelY + offset));
        walls = walls.filter(w => !(w.x === safeRoomStartX && w.y === tunnelY + offset));
    }
    
    // Add decorative walls around the teleport areas
    for (let i = 1; i <= 3; i++) {
        walls.push({x: safeRoomStartX + safeRoomSize + i, y: tunnelY - 2});
        walls.push({x: safeRoomStartX + safeRoomSize + i, y: tunnelY + 2});
        
        walls.push({x: safeRoomStartX - i, y: tunnelY - 2});
        walls.push({x: safeRoomStartX - i, y: tunnelY + 2});
    }
    
    // Add more teleport tunnels at the edges of the map
    addSimpleEdgeTeleports();
}

// Add teleport tunnels at map edges with clear markers
function addSimpleEdgeTeleports() {
    const border = 20; // Border position
    const teleportGap = 100; // Space between teleports
    
    // Create horizontal teleports (top to bottom)
    for (let x = border + 40; x < GRID_SIZE - border - 40; x += teleportGap) {
        // Top teleport
        const topY = border;
        
        // Bottom teleport
        const bottomY = GRID_SIZE - border - 1;
        
        // Create wider openings (3 cells wide)
        for (let offset = -1; offset <= 1; offset++) {
            // Clear walls at teleport locations
            walls = walls.filter(w => !(w.x === x + offset && w.y === topY));
            walls = walls.filter(w => !(w.x === x + offset && w.y === bottomY));
        }
        
        // Add visual markers for teleports
        for (let i = 1; i <= 3; i++) {
            // Mark top teleport
            walls.push({x: x - 3, y: topY + i});
            walls.push({x: x + 3, y: topY + i});
            
            // Mark bottom teleport
            walls.push({x: x - 3, y: bottomY - i});
            walls.push({x: x + 3, y: bottomY - i});
        }
        
        // Add food near teleports
        let topFood = generateNewFood();
        topFood.x = x;
        topFood.y = topY + 5;
        topFood.points = 25;
        topFood.color = '#FF9800';
        foods.push(topFood);
        
        let bottomFood = generateNewFood();
        bottomFood.x = x;
        bottomFood.y = bottomY - 5;
        bottomFood.points = 25;
        bottomFood.color = '#FF9800';
        foods.push(bottomFood);
    }
    
    // Create vertical teleports (left to right) similarly
    for (let y = border + 40; y < GRID_SIZE - border - 40; y += teleportGap) {
        // Left teleport
        const leftX = border;
        
        // Right teleport
        const rightX = GRID_SIZE - border - 1;
        
        // Create wider openings
        for (let offset = -1; offset <= 1; offset++) {
            walls = walls.filter(w => !(w.x === leftX && w.y === y + offset));
            walls = walls.filter(w => !(w.x === rightX && w.y === y + offset));
        }
        
        // Add visual markers for teleports
        for (let i = 1; i <= 3; i++) {
            // Mark left teleport
            walls.push({x: leftX + i, y: y - 3});
            walls.push({x: leftX + i, y: y + 3});
            
            // Mark right teleport
            walls.push({x: rightX - i, y: y - 3});
            walls.push({x: rightX - i, y: y + 3});
        }
        
        // Add food near teleports
        let leftFood = generateNewFood();
        leftFood.x = leftX + 5;
        leftFood.y = y;
        leftFood.points = 25;
        leftFood.color = '#FF9800';
        foods.push(leftFood);
        
        let rightFood = generateNewFood();
        rightFood.x = rightX - 5;
        rightFood.y = y;
        rightFood.points = 25;
        rightFood.color = '#FF9800';
        foods.push(rightFood);
    }
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

// Add our new reward passages
createRewardPassages();

console.log('Snake game server running on port 8080');
