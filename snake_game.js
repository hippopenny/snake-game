let playerId = null;
let players = {};
let snake = [];
let foods = [];
let direction = 'right';
let nextDirection = 'right';
let baseGameSpeed = 200; // Increased from 150 to make the game start slower
let gameSpeed = baseGameSpeed;
let gameRunning = false;
let score = 0;
let highestScore = 0;
let level = 1;
let gameLoop;
let minimapVisible = true;
let bestScoresVisible = true;
let bestScoresData = []; // Will store coordinates of highest scores
const MAX_BEST_SCORES = 10; // Maximum number of best scores to display

let hungerTimer = 100; // Starting hunger value (in game steps)
const MAX_HUNGER = 100;
const HUNGER_WARNING_THRESHOLD = 40; // Increased from 30 to give earlier warning
let hungerClockVisible = true;

// Animation and interpolation variables
let animationProgress = 1; // For interpolation
const INTERPOLATION_STEPS = 12; // Increased for even smoother transitions
let prevSnakePositions = []; // For storing previous positions
let animationFrameId = null; // Track animation frame for proper cancellation

// High-performance rendering variables
let lastFrameTime = 0;
const FIXED_FRAME_RATE = 60; // Render at 60fps for smooth movement
const FRAME_INTERVAL = 1000 / FIXED_FRAME_RATE; // ~16.7ms between frames
let frameAccumulator = 0;
let interpolationAlpha = 0; // Current interpolation factor

// Parallax background layers
const BACKGROUND_LAYERS = [
    { color: '#0d0d2a', speed: 0.05, elements: 150, size: [1, 3], type: 'star' },
    { color: '#1a1a4f', speed: 0.1, elements: 80, size: [2, 4], type: 'star' },
    { color: '#7251b5', speed: 0.15, elements: 40, size: [3, 6], type: 'nebula' },
    { color: '#34346e', speed: 0.2, elements: 15, size: [80, 120], type: 'cloud' }
];
let backgroundElements = [];

// Wall configuration
let WALLS = []; // Changed to let so it can be updated from server
const SAFE_ZONE_RADIUS = 50; // Safe zone radius in cells
const WALL_COLOR = '#444';

// Safe zone for new players
let safeZoneActive = false;
let safeZoneExpiry = 0;
const SAFE_ZONE_DURATION = 7000; // Safe zone protection lasts 7 seconds

// Add easing function for smoother animations
function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Camera system for large map
const GRID_SIZE = 400; // Increased from 200 to 400 for an even larger game world
const CELL_SIZE = 15; // Increased from 10 to 15 for larger, more visually appealing snakes and food
const VIEWPORT_WIDTH = 500; // Visible width in pixels
const VIEWPORT_HEIGHT = 500; // Visible height in pixels
const CAMERA_DEADZONE_X = 0.6; // Deadzone width as percentage of viewport width (60%)
const CAMERA_DEADZONE_Y = 0.6; // Deadzone height as percentage of viewport height (60%)

// Camera object to track position
let camera = {
    x: 0,
    y: 0,
    targetX: 0,
    targetY: 0,
    smoothFactor: 0.1 // Controls how smooth the camera follows (0.1 = 10% movement toward target per frame)
};

// Power-up related variables
let activePowerUp = null;
const POWER_UP_EFFECTS = {
    speed_boost: {
        speedMultiplier: 2.0,
        visualEffect: '#00BCD4'
    },
    invincibility: {
        visualEffect: '#9C27B0',
        duration: 15000
    },
    magnet: {
        range: 12,
        attractionStrength: 1.2,
        visualEffect: '#FFEB3B'
    }
};
// Add this after the POWER_UP_EFFECTS constant
// Particle system for visual effects
const particles = [];
const MAX_PARTICLES = 50;

// Function to create particles
function createParticles(x, y, color, count, speed, size, lifetime) {
    // Limit count if we're approaching MAX_PARTICLES
    if (particles.length > MAX_PARTICLES * 0.8) {
        count = Math.min(count, 5); // Reduce particle count when near limit
    }
    
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const velocity = speed * (0.5 + Math.random() * 0.5);
        
        particles.push({
            x: x * CELL_SIZE + CELL_SIZE / 2,
            y: y * CELL_SIZE + CELL_SIZE / 2,
            vx: Math.cos(angle) * velocity,
            vy: Math.sin(angle) * velocity,
            size: size * (0.5 + Math.random() * 0.5),
            color: color,
            alpha: 1,
            lifetime: lifetime * (0.8 + Math.random() * 0.4),
            birth: Date.now()
        });
        
        // Remove oldest particles if we exceed the maximum
        if (particles.length > MAX_PARTICLES) {
            particles.shift();
        }
    }
}

// Function to update and draw particles
function updateAndDrawParticles() {
    const now = Date.now();
    
    // Update particles
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        const age = now - p.birth;
        
        if (age > p.lifetime) {
            particles.splice(i, 1);
            continue;
        }
        
        // Update position
        p.x += p.vx;
        p.y += p.vy;
        
        // Update alpha based on age
        p.alpha = 1 - (age / p.lifetime);
        
        // Draw particle
        ctx.fillStyle = `rgba(${hexToRgb(p.color)}, ${p.alpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
    }
}

// Helper function to convert hex color to RGB
function hexToRgb(hex) {
    // Remove # if present
    hex = hex.replace('#', '');
    
    // Parse the hex values
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    
    return `${r}, ${g}, ${b}`;
}

let heatMap = [];
const HEAT_DECAY = 0.92; // Increased decay rate (was 0.98) - Makes heat fade away faster
const HEAT_MAX = 100; // Maximum heat value

const levelThresholds = [0, 50, 100, 150, 200, 300, 400, 500, 600, 800];

const startBtn = document.getElementById('start-btn');
const startScreen = document.getElementById('start-screen');
const gameOverScreen = document.getElementById('game-over');
const levelUpScreen = document.getElementById('level-up');
const restartBtn = document.getElementById('restart-btn');
const scoreDisplay = document.getElementById('score');
const levelDisplay = document.getElementById('level');
const speedDisplay = document.getElementById('speed');
const playersCountDisplay = document.getElementById('players-count');
const finalScoreDisplay = document.getElementById('final-score');
const finalLevelDisplay = document.getElementById('final-level');
const newLevelDisplay = document.getElementById('new-level');
const minimapCanvas = document.getElementById('minimap');
const minimapCtx = minimapCanvas.getContext('2d');
const minimapToggle = document.getElementById('minimap-toggle');

minimapCanvas.width = 150;
minimapCanvas.height = 150;

const bestScoresCanvas = document.getElementById('bestscores');
const bestScoresCtx = bestScoresCanvas.getContext('2d');
bestScoresCanvas.width = 150;
bestScoresCanvas.height = 150;

// Best scores toggle functionality
const bestScoresToggle = document.getElementById('bestscores-toggle');
bestScoresToggle.addEventListener('click', toggleBestScores);

function toggleBestScores() {
    bestScoresVisible = !bestScoresVisible;
    bestScoresCanvas.style.display = bestScoresVisible ? 'block' : 'none';
    bestScoresToggle.textContent = 'L';
    if (bestScoresVisible) {
        updateBestScores();
    }
}

// Initialize heat map
function initHeatMap() {
    heatMap = new Array(GRID_SIZE);
    for (let i = 0; i < GRID_SIZE; i++) {
        heatMap[i] = new Array(GRID_SIZE).fill(0);
    }
}

// Create meters container to hold both meters
const metersContainer = document.createElement('div');
metersContainer.id = 'meters-container';
metersContainer.style.position = 'absolute';
metersContainer.style.top = '60px';
metersContainer.style.left = '20px';
metersContainer.style.display = 'flex';
metersContainer.style.flexDirection = 'row';
metersContainer.style.alignItems = 'center'; 
metersContainer.style.justifyContent = 'center';    
metersContainer.style.gap = '20px'; // Space between meters
metersContainer.style.zIndex = '1002';
metersContainer.style.padding = '5px';
metersContainer.style.border = '1px solid transparent'; 
document.body.appendChild(metersContainer);

// Create heart container
const heartContainer = document.createElement('div');
heartContainer.id = 'heart-container';
heartContainer.style.position = 'relative'; // Use relative positioning within the container
heartContainer.style.display = 'flex';
heartContainer.style.alignItems = 'center';
heartContainer.style.justifyContent = 'center';
heartContainer.style.background = 'rgba(0, 0, 0, 0.6)';
heartContainer.style.padding = '5px';
heartContainer.style.borderRadius = '50%';
heartContainer.style.boxShadow = '0 0 3px rgba(0, 0, 0, 0.5)';
heartContainer.style.width = '60px';
heartContainer.style.height = '60px';
heartContainer.style.transition = 'all 0.3s ease';
heartContainer.style.margin = '0'; // Reset any margin
metersContainer.appendChild(heartContainer);


// Create hunger clock
const hungerClock = document.createElement('canvas');
hungerClock.id = 'hunger-clock';
hungerClock.width = 60;
hungerClock.height = 60;
hungerClock.style.position = 'absolute';
heartContainer.appendChild(hungerClock);

// Create heart icon
const heartIcon = document.createElement('span');
heartIcon.innerHTML = '❤️';
heartIcon.style.fontSize = '22px';
heartIcon.style.position = 'absolute';
heartIcon.style.top = '50%';
heartIcon.style.left = '50%';
heartIcon.style.transform = 'translate(-50%, -50%)';
heartIcon.style.filter = 'drop-shadow(0 0 3px rgba(0,0,0,0.5))';
heartContainer.appendChild(heartIcon);

// Create level progress container
const levelProgressContainer = document.createElement('div');
levelProgressContainer.id = 'level-progress-container';
levelProgressContainer.style.position = 'relative';
levelProgressContainer.style.display = 'flex';
levelProgressContainer.style.alignItems = 'center';
levelProgressContainer.style.justifyContent = 'center';
levelProgressContainer.style.background = 'rgba(0, 0, 0, 0.6)';
levelProgressContainer.style.borderRadius = '50%';
levelProgressContainer.style.boxShadow = '0 0 10px rgba(0, 0, 0, 0.5)';
levelProgressContainer.style.width = '60px';
levelProgressContainer.style.height = '60px';
levelProgressContainer.style.transition = 'all 0.3s ease';
levelProgressContainer.style.margin = '0';
metersContainer.appendChild(levelProgressContainer);

// Create the level progress canvas
const levelProgress = document.createElement('canvas');
levelProgress.id = 'level-progress';
levelProgress.width = 60;
levelProgress.height = 60;
levelProgressContainer.appendChild(levelProgress);

// Create the next level text element
const nextLevelText = document.createElement('div');
nextLevelText.id = 'next-level-text';
nextLevelText.style.position = 'absolute';
nextLevelText.style.top = '50%';
nextLevelText.style.left = '50%';
nextLevelText.style.transform = 'translate(-50%, -50%)';
nextLevelText.style.fontSize = '12px';
nextLevelText.style.color = 'white';
nextLevelText.style.textAlign = 'center';
nextLevelText.style.textShadow = '1px 1px 2px rgba(0,0,0,0.5)';
levelProgressContainer.appendChild(nextLevelText);

/* Power-Up Status Display */
const powerUpStatus = document.createElement('div');
powerUpStatus.id = 'power-up-status';
powerUpStatus.style.position = 'absolute';
powerUpStatus.style.top = '10px';
powerUpStatus.style.left = '50%';
powerUpStatus.style.transform = 'translateX(-50%)';
powerUpStatus.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
powerUpStatus.style.padding = '10px 20px';
powerUpStatus.style.borderRadius = '10px';
powerUpStatus.style.color = 'white';
powerUpStatus.style.fontFamily = 'Arial, sans-serif';
powerUpStatus.style.fontSize = '20px';
powerUpStatus.style.fontWeight = 'bold';
powerUpStatus.style.textShadow = '2px 2px 4px black';
powerUpStatus.style.zIndex = '1000';
powerUpStatus.style.border = '2px solid white';
powerUpStatus.style.boxShadow = '0 0 15px rgba(255, 255, 255, 0.5)';
powerUpStatus.style.display = 'none'; // Start hidden
document.body.appendChild(powerUpStatus);

 // Create power-up indicator
 const powerUpIndicator = document.createElement('div');
 powerUpIndicator.id = 'power-up-indicator';
 powerUpIndicator.style.position = 'absolute';
 powerUpIndicator.style.top = '10px';
 powerUpIndicator.style.left = '50%';
 powerUpIndicator.style.transform = 'translateX(-50%)';
 powerUpIndicator.style.padding = '5px 10px';
 powerUpIndicator.style.borderRadius = '5px';
 powerUpIndicator.style.fontWeight = 'bold';
 powerUpIndicator.style.display = 'none';
 powerUpIndicator.style.zIndex = '1000';
 document.body.appendChild(powerUpIndicator);

// Minimap toggle functionality
minimapToggle.addEventListener('click', toggleMinimap);

function toggleMinimap() {
    minimapVisible = !minimapVisible;
    minimapCanvas.style.display = minimapVisible ? 'block' : 'none';
    minimapToggle.textContent = 'M';
    if (minimapVisible) {
        updateMinimap();
    }
}

let socket = new WebSocket('ws://127.0.0.1:8080');

socket.onopen = () => {
    playerId = Date.now().toString();
    console.log("WebSocket connection established. Player ID:", playerId);
};

socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'state') {
        players = data.players;
        if (data.foods) {
            foods = data.foods;
        }
        if (data.walls) {
            WALLS = data.walls; // Update walls from server
        }
        // Check if our player has a power-up from the server
        if (players[playerId] && players[playerId].activePowerUp) {
            activePowerUp = players[playerId].activePowerUp;
            updatePowerUpIndicator();
        } else if (activePowerUp) {
            // If we had a power-up but it's no longer in the server state, clear it
            deactivatePowerUp();
        }
        updatePlayersCount();
        if (minimapVisible) {
            updateMinimap();
        }
    }
};

let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 2000; // 2 seconds

socket.onerror = (error) => {
    console.error('WebSocket error:', error);
    // Error handling will be managed by onclose handler
};

socket.onclose = (event) => {
    console.log('Disconnected from server:', event.code, event.reason);
    
    // Add connection lost indicator
    const connectionLostIndicator = document.createElement('div');
    connectionLostIndicator.id = 'connection-lost';
    connectionLostIndicator.style.position = 'fixed';
    connectionLostIndicator.style.top = '50%';
    connectionLostIndicator.style.left = '50%';
    connectionLostIndicator.style.transform = 'translate(-50%, -50%)';
    connectionLostIndicator.style.backgroundColor = 'rgba(244, 67, 54, 0.95)';
    connectionLostIndicator.style.color = 'white';
    connectionLostIndicator.style.padding = '20px 30px';
    connectionLostIndicator.style.borderRadius = '10px';
    connectionLostIndicator.style.fontWeight = 'bold';
    connectionLostIndicator.style.fontSize = '24px';
    connectionLostIndicator.style.zIndex = '2000';
    connectionLostIndicator.style.boxShadow = '0 0 20px rgba(0, 0, 0, 0.7)';
    connectionLostIndicator.style.border = '2px solid white';
    connectionLostIndicator.textContent = 'CONNECTION LOST. Attempting to reconnect...';
    document.body.appendChild(connectionLostIndicator);
    
    // Save current game state for reconnection
    const savedSnake = [...snake];
    const savedScore = score;
    const savedLevel = level;
    
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS && gameRunning) {
        console.log(`Attempting to reconnect (${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})...`);
        
        // Add visual reconnection indicator
        const reconnectingMessage = document.createElement('div');
        reconnectingMessage.id = 'reconnecting-message';
        reconnectingMessage.style.position = 'absolute';
        reconnectingMessage.style.top = '50%';
        reconnectingMessage.style.left = '50%';
        reconnectingMessage.style.transform = 'translate(-50%, -50%)';
        reconnectingMessage.style.background = 'rgba(0, 0, 0, 0.8)';
        reconnectingMessage.style.color = '#4CAF50';
        reconnectingMessage.style.padding = '20px';
        reconnectingMessage.style.borderRadius = '10px';
        reconnectingMessage.style.zIndex = '2000';
        reconnectingMessage.style.fontWeight = 'bold';
        reconnectingMessage.style.fontSize = '18px';
        reconnectingMessage.style.boxShadow = '0 0 20px rgba(76, 175, 80, 0.5)';
        reconnectingMessage.textContent = `Reconnecting (${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})...`;
        document.body.appendChild(reconnectingMessage);
        
        setTimeout(() => {
            reconnectAttempts++;
            // Create a new WebSocket connection
            const newSocket = new WebSocket('ws://127.0.0.1:8080');
            
            // Re-attach event handlers
            newSocket.onopen = () => {
                console.log("WebSocket reconnected. Player ID:", playerId);
                
                // Remove reconnection message if it exists
                const reconnectMessage = document.getElementById('reconnecting-message');
                if (reconnectMessage) {
                    document.body.removeChild(reconnectMessage);
                }
                
                // Remove connection lost indicator if it exists
                if (document.getElementById('connection-lost')) {
                    document.body.removeChild(document.getElementById('connection-lost'));
                }
                
                // Restore player state immediately after reconnection
                if (gameRunning && savedSnake.length > 0) {
                    // Send the saved state to restore the snake
                    const playerState = {
                        type: 'update',
                        id: playerId,
                        snake: savedSnake,
                        score: savedScore,
                        level: savedLevel,
                        activePowerUp: activePowerUp
                    };
                    setTimeout(() => {
                        newSocket.send(JSON.stringify(playerState));
                    }, 100);
                }
                
                // Reset reconnect attempts on successful connection
                reconnectAttempts = 0;
            };
            
            newSocket.onmessage = socket.onmessage;
            newSocket.onerror = socket.onerror;
            newSocket.onclose = socket.onclose;
            
            // Properly assign the new socket
            socket = newSocket;
        }, RECONNECT_DELAY);
    } else if (gameRunning) {
        // Remove any existing reconnection message
        const reconnectMessage = document.getElementById('reconnecting-message');
        if (reconnectMessage) {
            document.body.removeChild(reconnectMessage);
        }
        
        alert("Lost connection to server. Please refresh the page to reconnect.");
    }
};

// Camera update function with deadzone for smoother gameplay
function updateCamera(alpha = 1) {
    if (!snake.length) return;
    
    // Get snake head position
    const head = snake[0];
    let headX = head.x;
    let headY = head.y;
    
    // Use interpolated position for perfect synchronization
    if (prevSnakePositions.length > 0) {
        const eased = easeInOutCubic(alpha);
        headX = prevSnakePositions[0].x + (head.x - prevSnakePositions[0].x) * eased;
        headY = prevSnakePositions[0].y + (head.y - prevSnakePositions[0].y) * eased;
    }
    
    // Convert snake position to pixel coordinates
    const snakePxX = headX * CELL_SIZE + CELL_SIZE / 2;
    const snakePxY = headY * CELL_SIZE + CELL_SIZE / 2;
    
    // Calculate snake position relative to the viewport center
    const snakeViewportX = snakePxX - (camera.x + VIEWPORT_WIDTH / 2);
    const snakeViewportY = snakePxY - (camera.y + VIEWPORT_HEIGHT / 2);
    
    // Define deadzone as percentage of viewport dimensions
    const deadzoneWidth = VIEWPORT_WIDTH * CAMERA_DEADZONE_X;
    const deadzoneHeight = VIEWPORT_HEIGHT * CAMERA_DEADZONE_Y;
    
    // Target camera position (only calculate new position if outside deadzone)
    let targetX = camera.x;
    let targetY = camera.y;
    
    // Check if snake is outside horizontal deadzone
    if (Math.abs(snakeViewportX) > deadzoneWidth / 2) {
        // Calculate how far outside the deadzone we are
        const excessX = Math.abs(snakeViewportX) - deadzoneWidth / 2;
        // Move in the appropriate direction
        targetX = camera.x + Math.sign(snakeViewportX) * excessX;
    }
    
    // Check if snake is outside vertical deadzone
    if (Math.abs(snakeViewportY) > deadzoneHeight / 2) {
        // Calculate how far outside the deadzone we are
        const excessY = Math.abs(snakeViewportY) - deadzoneHeight / 2;
        // Move in the appropriate direction
        targetY = camera.y + Math.sign(snakeViewportY) * excessY;
    }
    
    // Apply smooth interpolation for camera movement
    const smoothFactor = 0.15;
    camera.x += (targetX - camera.x) * smoothFactor;
    camera.y += (targetY - camera.y) * smoothFactor;
    
    // Clamp camera to game bounds
    camera.x = Math.max(0, Math.min(camera.x, GRID_SIZE * CELL_SIZE - VIEWPORT_WIDTH));
    camera.y = Math.max(0, Math.min(camera.y, GRID_SIZE * CELL_SIZE - VIEWPORT_HEIGHT));
}

// Set up the game canvas
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

// Set canvas size based on viewport dimensions
canvas.width = VIEWPORT_WIDTH;
canvas.height = VIEWPORT_HEIGHT;

// Initialize leaderboard when the document is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Initialize mini leaderboard
    
    // Initialize heat map
    initHeatMap();
});

function initGame() {
    // Cancel any existing animation frame to avoid duplicate animation loops
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    
    // Start the snake at a reasonable position in the larger map
    const centerX = Math.floor(GRID_SIZE / 2);
    const centerY = Math.floor(GRID_SIZE / 2);
    
    snake = [
        {x: centerX, y: centerY},
        {x: centerX - 1, y: centerY},
        {x: centerX - 2, y: centerY}
    ];
    direction = 'right';
    nextDirection = 'right';
    score = 0;
    level = 1;
    gameSpeed = baseGameSpeed;
    activePowerUp = null;
    hungerTimer = MAX_HUNGER; // Reset hunger timer
    // Ensure heart container is always visible
    heartContainer.style.display = 'flex';
    powerUpIndicator.style.display = 'none';
    
    // Initialize camera to focus on snake head
    camera.x = snake[0].x * CELL_SIZE - VIEWPORT_WIDTH / 2;
    camera.y = snake[0].y * CELL_SIZE - VIEWPORT_HEIGHT / 2;
    camera.targetX = camera.x;
    camera.targetY = camera.y;
    
    // Ensure we have a valid snake before starting
    if (!snake || snake.length === 0) {
        snake = [
            {x: centerX, y: centerY},
            {x: centerX - 1, y: centerY},
            {x: centerX - 2, y: centerY}
        ];
    }
    
    // Reset heat map
    initHeatMap();
    
    // Initialize parallax background elements
    initBackgroundElements();
    
    // Walls are now managed by the server
    
    // Activate safe zone for new player
    activateSafeZone();
    
    // Spawn starting food around player
    spawnStartingFood();
    
    updateScoreAndLevel();
    updateSpeedDisplay();
    updateHungerBar(); // Initialize hunger bar
    
    gameOverScreen.style.display = 'none';
    levelUpScreen.style.display = 'none';
    
    sendPlayerState();
    
    if (gameLoop) clearInterval(gameLoop);
    gameLoop = setInterval(gameStep, gameSpeed);
    gameRunning = true;
    
    // Start the rendering loop separately with proper timing initialization
    lastFrameTime = performance.now();
    frameAccumulator = 0;
    interpolationAlpha = 0;
    
    // Store animation frame ID for proper cancellation later
    animationFrameId = requestAnimationFrame(renderFrame);
}

function renderFrame(timestamp) {
    if (!gameRunning) return;
    
    // Store animation frame ID so it can be properly cancelled if needed
    animationFrameId = requestAnimationFrame(renderFrame);
    
    // Calculate delta time since last frame
    const deltaTime = timestamp - lastFrameTime;
    lastFrameTime = timestamp;
    
    // Accumulate time but cap maximum delta to prevent extreme jumps
    // This prevents the snake from disappearing when tab is inactive
    const maxDelta = 50; // Maximum milliseconds to process in a single frame
    frameAccumulator = (frameAccumulator + Math.min(deltaTime, maxDelta));
    
    // Calculate interpolation factor between 0 and 1
    // This should be a percentage of how far we are between moves
    interpolationAlpha = Math.min(1, frameAccumulator / gameSpeed);
    
    // Draw with interpolation factor
    draw(interpolationAlpha);
}

function draw(alpha = 1) {
    // Update camera position with interpolation factor
    updateCamera(alpha);
    
    // Draw enhanced background with parallax
    drawEnhancedBackground();
    
    // Save the canvas state before applying transformations
    ctx.save();
    
    // Apply camera transformation
    ctx.translate(-Math.floor(camera.x), -Math.floor(camera.y));
    
    // Calculate visible grid range
    const startX = Math.floor(camera.x / CELL_SIZE);
    const startY = Math.floor(camera.y / CELL_SIZE);
    const endX = startX + Math.ceil(VIEWPORT_WIDTH / CELL_SIZE) + 1;
    const endY = startY + Math.ceil(VIEWPORT_HEIGHT / CELL_SIZE) + 1;
    
    // Grid lines removed for smoother visuals
    
    // Draw foods (only those in view)
    foods.forEach(food => {
        const foodX = food.x * CELL_SIZE;
        const foodY = food.y * CELL_SIZE;
        
        // Skip if food is outside viewport
        if (foodX + CELL_SIZE < camera.x || foodX > camera.x + VIEWPORT_WIDTH ||
            foodY + CELL_SIZE < camera.y || foodY > camera.y + VIEWPORT_HEIGHT) {
            return;
        }
        
        drawFood(food);
    });
    
    // Draw player's snake
    drawSnake(snake, true);
    
    // Draw other players' snakes (only those in view)
    for (const id in players) {
        if (id !== playerId && players[id].snake) {
            // Check if any part of the snake is visible
            const otherSnake = players[id].snake;
            let isVisible = false;
            
            for (const segment of otherSnake) {
                const segX = segment.x * CELL_SIZE;
                const segY = segment.y * CELL_SIZE;
                
                if (!(segX + CELL_SIZE < camera.x || segX > camera.x + VIEWPORT_WIDTH ||
                      segY + CELL_SIZE < camera.y || segY > camera.y + VIEWPORT_HEIGHT)) {
                    isVisible = true;
                    break;
                }
            }
            
            if (isVisible) {
                drawSnake(otherSnake, false);
            }
        }
    }
    
    // Draw magnet power-up effect if active
    if (activePowerUp && activePowerUp.type === 'magnet') {
        drawMagnetField();
    }
    
    // Draw particles on top of everything
    updateAndDrawParticles();
    
    // Draw walls
    drawWalls();
    
    // Draw safe zone if active
    if (safeZoneActive && Date.now() < safeZoneExpiry) {
        drawSafeZone();
    }
    
    // Restore canvas state
    ctx.restore();
    
    // Update minimap and mini leaderboard
    if (minimapVisible) {
        updateMinimap();
    }
    if (bestScoresVisible) {
        updateBestScores();
    }
    
    if (gameRunning && !animationFrameId) {
        // We don't need to request a new frame here as it's handled by renderFrame
    }
}

function drawFood(food) {
    // Calculate pulse effect
    const pulse = 1 + 0.1 * Math.sin(Date.now() / 200);
    const baseSize = CELL_SIZE / 2;
    const size = baseSize * pulse;
    
    // Determine color based on blinking state
    const color = food.blinking ? 
        (Math.floor(Date.now() / 250) % 2 === 0 ? food.color : '#FFFFFF') : 
        food.color;
    
    // Draw food with pulse effect
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(
        food.x * CELL_SIZE + CELL_SIZE / 2,
        food.y * CELL_SIZE + CELL_SIZE / 2,
        size,
        0,
        Math.PI * 2
    );
    ctx.fill();
    
    // Add glow effect for power-up foods
    if (food.powerUp) {
        ctx.shadowColor = food.color;
        ctx.shadowBlur = 10 + 5 * Math.sin(Date.now() / 300);
        
        ctx.beginPath();
        ctx.arc(
            food.x * CELL_SIZE + CELL_SIZE / 2,
            food.y * CELL_SIZE + CELL_SIZE / 2,
            size * 1.2,
            0,
            Math.PI * 2
        );
        ctx.strokeStyle = food.color;
        ctx.lineWidth = 2;
        ctx.stroke();
        
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
    }
    
    // Draw countdown
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '10px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(food.countdown, food.x * CELL_SIZE + CELL_SIZE / 2, food.y * CELL_SIZE + CELL_SIZE / 2);
    
    // Food spawn animation
    if (Date.now() - food.createdAt < 1000) {
        const progress = (Date.now() - food.createdAt) / 1000;
        const animSize = CELL_SIZE * (0.5 + 0.5 * Math.sin(progress * Math.PI));
        ctx.strokeStyle = food.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(
            food.x * CELL_SIZE + CELL_SIZE / 2,
            food.y * CELL_SIZE + CELL_SIZE / 2,
            animSize / 2,
            0,
            Math.PI * 2
        );
        ctx.stroke();
        
        // Add spawn particles
        if (progress < 0.3 && Math.random() < 0.3) {
            createParticles(
                food.x,
                food.y,
                food.color,
                1,
                1,
                3,
                500
            );
        }
    }
    
    // Draw power-up icon if applicable
    if (food.powerUp) {
        let icon = '';
        switch (food.powerUp) {
            case 'speed_boost':
                icon = '⚡';
                break;
            case 'invincibility':
                icon = '★';
                break;
            case 'magnet':
                icon = '🧲';
                break;
        }
        
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(icon, food.x * CELL_SIZE + CELL_SIZE / 2, food.y * CELL_SIZE + CELL_SIZE / 2);
    }
}

/* Enhanced drawSnake function with improved power-up visual effects */
function drawSnake(snakeBody, isCurrentPlayer) {
    // Do not attempt to draw an empty snake
    if (!snakeBody || snakeBody.length === 0) {
        console.error("Attempted to draw empty snake");
        return;
    }
    
    // Apply interpolation for smoother movement
    let positionsToRender = snakeBody;
    
    // Ensure previous positions exist before trying to interpolate
    if (isCurrentPlayer && prevSnakePositions && prevSnakePositions.length > 0) {
        // Use cubic easing for smoother animation
        const eased = easeInOutCubic(interpolationAlpha);
        
        // Create completely interpolated snake for smoother rendering
        positionsToRender = snakeBody.map((segment, i) => {
            if (i >= prevSnakePositions.length) return segment;
            
            return {
                x: prevSnakePositions[i].x + (segment.x - prevSnakePositions[i].x) * eased,
                y: prevSnakePositions[i].y + (segment.y - prevSnakePositions[i].y) * eased
            };
        });
    }
    
    // Add motion trail effect
    if (isCurrentPlayer && snakeBody.length > 2) {
        // Draw ghosted trail segments
        for (let i = snakeBody.length - 1; i >= 1; i--) {
            const segment = snakeBody[i];
            const x = segment.x * CELL_SIZE;
            const y = segment.y * CELL_SIZE;
            
            const trailOpacity = 0.15 - (i / snakeBody.length) * 0.1;
            
            // Draw ghost trail
            ctx.fillStyle = `rgba(255, 255, 255, ${trailOpacity})`;
            ctx.beginPath();
            ctx.arc(
                x + CELL_SIZE / 2,
                y + CELL_SIZE / 2,
                CELL_SIZE / 3 * (1 - i / snakeBody.length * 0.5),
                0,
                Math.PI * 2
            );
            ctx.fill();
        }
    }
    
    // Determine if this snake has an active power-up
    let powerUp = null;
    
    if (isCurrentPlayer) {
        powerUp = activePowerUp;
    } else {
        // Find the player ID for this snake
        for (const id in players) {
            if (players[id].snake === snakeBody && players[id].activePowerUp) {
                powerUp = players[id].activePowerUp;
                break;
            }
        }
    }
    
    // Base colors and styles
    let headColor = isCurrentPlayer ? '#4CAF50' : '#3F51B5';
    let bodyColor = isCurrentPlayer ? '#8BC34A' : '#7986CB';
    
    // Reset all effects flags
    let glowEffect = false;
    let trailEffect = false;
    let particleEffect = false;
    
    // Only apply visual effects if a power-up is active
    if (powerUp) {
        switch(powerUp.type) {
            case 'invincibility':
                headColor = '#9C27B0';
                bodyColor = '#CE93D8';
                glowEffect = true;
                break;
            case 'speed_boost':
                headColor = '#00BCD4';
                bodyColor = '#80DEEA';
                trailEffect = true;
                break;
            case 'magnet':
                headColor = '#FFEB3B';
                bodyColor = '#FFF59D';
                particleEffect = true;
                break;
        }
    }
    
    // Draw snake segments with enhanced power-up effects
    positionsToRender.forEach((segment, index) => {
        const x = segment.x * CELL_SIZE;
        const y = segment.y * CELL_SIZE;
        
        // Apply enhanced glow effect if power-up is active
        if (powerUp) {
            ctx.shadowColor = powerUp.type === 'invincibility' ? '#9C27B0' : 
                              powerUp.type === 'speed_boost' ? '#00BCD4' : 
                              powerUp.type === 'magnet' ? '#FFEB3B' : 'transparent';
            ctx.shadowBlur = 20;
        }
        
        // Set fill style based on segment type
        ctx.fillStyle = index === 0 ? headColor : bodyColor;
        
        // Determine pulsing effect scale
        let pulseScale = 1;
        if (powerUp) {
            pulseScale = 1 + 0.15 * Math.sin(Date.now() / 150);
        } else if (index === 0) {
            pulseScale = 1 + 0.05 * Math.sin(Date.now() / 200);
        }
        
        // Calculate dimensions for enhanced segment rendering
        const size = CELL_SIZE * pulseScale;
        const radius = index === 0 ? CELL_SIZE / 3 : CELL_SIZE / 4;
        const centerX = x + CELL_SIZE / 2;
        const centerY = y + CELL_SIZE / 2;
        
        ctx.beginPath();
        ctx.moveTo(centerX - size/2 + radius, centerY - size/2);
        ctx.lineTo(centerX + size/2 - radius, centerY - size/2);
        ctx.quadraticCurveTo(centerX + size/2, centerY - size/2, centerX + size/2, centerY - size/2 + radius);
        ctx.lineTo(centerX + size/2, centerY + size/2 - radius);
        ctx.quadraticCurveTo(centerX + size/2, centerY + size/2, centerX + size/2 - radius, centerY + size/2);
        ctx.lineTo(centerX - size/2 + radius, centerY + size/2);
        ctx.quadraticCurveTo(centerX - size/2, centerY + size/2, centerX - size/2, centerY + size/2 - radius);
        ctx.lineTo(centerX - size/2, centerY - size/2 + radius);
        ctx.quadraticCurveTo(centerX - size/2, centerY - size/2, centerX - size/2 + radius, centerY - size/2);
        ctx.closePath();
        ctx.fill();
        
        // Reset shadow effect after drawing segment
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        
        // Add eyes and head decorations for the head segment
        if (index === 0) {
            ctx.fillStyle = 'white';
            ctx.beginPath();
            ctx.arc(x + CELL_SIZE * 0.7, y + CELL_SIZE * 0.3, CELL_SIZE * 0.15, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(x + CELL_SIZE * 0.7, y + CELL_SIZE * 0.7, CELL_SIZE * 0.15, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.fillStyle = 'black';
            ctx.beginPath();
            ctx.arc(x + CELL_SIZE * 0.75, y + CELL_SIZE * 0.3, CELL_SIZE * 0.07, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(x + CELL_SIZE * 0.75, y + CELL_SIZE * 0.7, CELL_SIZE * 0.07, 0, Math.PI * 2);
            ctx.fill();
            
            if (powerUp) {
                if (powerUp.type === 'invincibility') {
                    ctx.fillStyle = '#FFD700';
                    ctx.beginPath();
                    ctx.moveTo(x + CELL_SIZE * 0.5, y - CELL_SIZE * 0.3);
                    ctx.lineTo(x + CELL_SIZE * 0.2, y + CELL_SIZE * 0.2);
                    ctx.lineTo(x + CELL_SIZE * 0.35, y);
                    ctx.lineTo(x + CELL_SIZE * 0.5, y + CELL_SIZE * 0.2);
                    ctx.lineTo(x + CELL_SIZE * 0.65, y);
                    ctx.lineTo(x + CELL_SIZE * 0.8, y + CELL_SIZE * 0.2);
                    ctx.closePath();
                    ctx.fill();
                    
                    ctx.strokeStyle = '#FFD700';
                    ctx.lineWidth = 3;
                    ctx.beginPath();
                    ctx.arc(x + CELL_SIZE/2, y + CELL_SIZE/2, CELL_SIZE * 1.0, 0, Math.PI * 2);
                    ctx.stroke();
                } else if (powerUp.type === 'speed_boost') {
                    ctx.fillStyle = '#FFFF00';
                    ctx.beginPath();
                    ctx.moveTo(x - CELL_SIZE * 0.2, y + CELL_SIZE * 0.2);
                    ctx.lineTo(x + CELL_SIZE * 0.6, y + CELL_SIZE * 0.2);
                    ctx.lineTo(x + CELL_SIZE * 0.3, y + CELL_SIZE * 0.8);
                    ctx.lineTo(x + CELL_SIZE * 0.7, y + CELL_SIZE * 0.5);
                    ctx.lineTo(x + CELL_SIZE * 0.4, y + CELL_SIZE * 0.5);
                    ctx.lineTo(x + CELL_SIZE * 0.9, y - CELL_SIZE * 0.2);
                    ctx.closePath();
                    ctx.fill();
                    
                    ctx.strokeStyle = '#FFFF00';
                    ctx.lineWidth = 2;
                    for (let i = 0; i < 3; i++) {
                        ctx.beginPath();
                        ctx.moveTo(x - CELL_SIZE * 0.3 - i * 5, y + CELL_SIZE * (0.3 + i * 0.2));
                        ctx.lineTo(x - CELL_SIZE * 0.1 - i * 3, y + CELL_SIZE * (0.3 + i * 0.2));
                        ctx.stroke();
                    }
                } else if (powerUp.type === 'magnet') {
                    ctx.fillStyle = '#FF5722';
                    ctx.beginPath();
                    ctx.rect(x + CELL_SIZE * 0.3, y - CELL_SIZE * 0.2, CELL_SIZE * 0.4, CELL_SIZE * 0.3);
                    ctx.fill();
                    ctx.beginPath();
                    ctx.rect(x + CELL_SIZE * 0.3, y + CELL_SIZE * 0.9, CELL_SIZE * 0.4, CELL_SIZE * 0.3);
                    ctx.fill();
                    ctx.beginPath();
                    ctx.rect(x + CELL_SIZE * 0.4, y - CELL_SIZE * 0.2, CELL_SIZE * 0.2, CELL_SIZE * 1.4);
                    ctx.fill();
                }
            }
        }
    });
    
    if (isCurrentPlayer && powerUp) {
        if (trailEffect) {
            for (let i = snakeBody.length - 1; i > 0; i--) {
                const segment = snakeBody[i];
                const x = segment.x * CELL_SIZE;
                const y = segment.y * CELL_SIZE;
                if (i % 2 === 0 || i % 3 === 0) {
                    const opacity = 0.8 * (1 - i / snakeBody.length);
                    ctx.fillStyle = `rgba(0, 188, 212, ${opacity})`;
                    ctx.beginPath();
                    ctx.moveTo(x - CELL_SIZE * 0.8, y + CELL_SIZE * 0.2);
                    ctx.lineTo(x, y + CELL_SIZE * 0.5);
                    ctx.lineTo(x - CELL_SIZE * 0.8, y + CELL_SIZE * 0.8);
                    ctx.closePath();
                    ctx.fill();
                    
                    if (Math.random() < 0.3) {
                        createParticles(segment.x, segment.y, '#00BCD4', 3, 2, 4, 500);
                    }
                }
            }
        } else if (glowEffect) {
            if (Math.random() < 0.3) {
                const head = snakeBody[0];
                createParticles(head.x, head.y, '#9C27B0', 5, 1.5, 5, 800);
            }
            ctx.strokeStyle = 'rgba(156, 39, 176, 0.5)';
            ctx.lineWidth = 4;
            for (let i = 0; i < snakeBody.length; i += 3) {
                const segment = snakeBody[i];
                ctx.beginPath();
                ctx.arc(segment.x * CELL_SIZE + CELL_SIZE/2, segment.y * CELL_SIZE + CELL_SIZE/2, CELL_SIZE * 1.2, 0, Math.PI * 2);
                ctx.stroke();
            }
        }
        
        if (particleEffect) {
            drawMagnetOrbits(snakeBody[0].x, snakeBody[0].y);
            ctx.strokeStyle = 'rgba(255, 235, 59, 0.6)';
            ctx.lineWidth = 2;
            for (let i = 0; i < snakeBody.length; i += 4) {
                const segment = snakeBody[i];
                const x = segment.x * CELL_SIZE + CELL_SIZE/2;
                const y = segment.y * CELL_SIZE + CELL_SIZE/2;
                for (let j = 0; j < 4; j++) {
                    const angle = (j / 4) * Math.PI * 2 + Date.now() / 1000;
                    ctx.beginPath();
                    ctx.moveTo(x, y);
                    ctx.lineTo(x + Math.cos(angle) * CELL_SIZE * 1.5, y + Math.sin(angle) * CELL_SIZE * 1.5);
                    ctx.stroke();
                }
            }
        }
    }
}

function updateScoreAndLevel() {
    // Update highest score if current score is higher
    if (score > highestScore) {
        highestScore = score;
    }
    
    scoreDisplay.textContent = `Score: ${score} (Best: ${highestScore})`;
    levelDisplay.textContent = `Level: ${level}`;
    updateLevelProgress();
}

function updateSpeedDisplay() {
    let speedMultiplier = (baseGameSpeed / gameSpeed).toFixed(1);
    
    // If speed boost is active, show the boosted speed
    if (activePowerUp && activePowerUp.type === 'speed_boost') {
        speedMultiplier = (baseGameSpeed / gameSpeed * POWER_UP_EFFECTS.speed_boost.speedMultiplier).toFixed(1);
    }
    
    speedDisplay.textContent = `Speed: ${speedMultiplier}x`;
}


function updateLevelProgress() {
    const canvas = document.getElementById('level-progress');
    const ctx = canvas.getContext('2d');
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = 25;

    // Find current level threshold and next level threshold
    let currentThreshold = 0;
    let nextThreshold = levelThresholds[0];
    
    for (let i = 0; i < levelThresholds.length; i++) {
        if (score >= levelThresholds[i]) {
            currentThreshold = levelThresholds[i];
            nextThreshold = levelThresholds[i + 1] || levelThresholds[i] + 100;
        } else {
            nextThreshold = levelThresholds[i];
            break;
        }
    }

    // Calculate progress percentage
    const progress = (score - currentThreshold) / (nextThreshold - currentThreshold);

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw background circle
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 5;
    ctx.stroke();

    // Draw progress arc
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * progress));
    ctx.strokeStyle = '#4CAF50';
    ctx.stroke();

    // Update next level text
    const pointsNeeded = nextThreshold - score;
    document.getElementById('next-level-text').textContent = `+${pointsNeeded}`;
}

function checkLevelUp() {
    let newLevel = 1;
    for (let i = 1; i < levelThresholds.length; i++) {
        if (score >= levelThresholds[i]) {
            newLevel = i + 1;
        } else {
            break;
        }
    }
    
    if (newLevel > level) {
        level = newLevel;
        
        gameSpeed = Math.max(50, baseGameSpeed - (level - 1) * 10);
        clearInterval(gameLoop);
        gameLoop = setInterval(gameStep, gameSpeed);
        
        updateScoreAndLevel();
        updateSpeedDisplay();
        updateLevelProgress();
        
        newLevelDisplay.textContent = `Level: ${level}`;
        levelUpScreen.style.display = 'block';
        
        setTimeout(() => {
            levelUpScreen.style.display = 'none';
        }, 2000);
    }
}

// Remove generateFood() and sendFoodPosition() functions as they're no longer needed

function sendPlayerState() {
    if (playerId && socket && socket.readyState === WebSocket.OPEN) {
        const playerState = {
            type: 'update',
            id: playerId,
            snake: snake,
            score: score,
            level: level,
            activePowerUp: activePowerUp
        };
        socket.send(JSON.stringify(playerState));
    }
}

function gameStep() {
    direction = nextDirection;
    
    // Calculate hunger rate based on game speed and level
    // Increase hunger rate by 2x and scale with game speed
    const baseHungerRate = 0.2; // Reduced from 0.3 to slow down hunger depletion
    const speedFactor = baseGameSpeed / gameSpeed; // Faster game = faster hunger
    const hungerRate = baseHungerRate * speedFactor;
    
    // Decrease hunger timer with the calculated rate
    hungerTimer -= hungerRate;
    updateHungerBar();
    
    // Check if snake is starving
    if (hungerTimer <= 0) {
        gameOver('starvation');
        return;
    }
    
    // Apply speed boost if active
    // Speed boost effect is handled by the interval timing
    
    // Check if any power-up has expired
    checkPowerUpExpiration();
    
    // Update power-up status display
    updatePowerUpStatus();
    
    // Apply magnet effect if active
    if (activePowerUp && activePowerUp.type === 'magnet') {
        applyMagnetEffect();
    }
    
    moveSnake();
    
    if (checkCollisions()) {
        gameOver();
        return;
    }
        
    // Initialize mobile controls if needed
    detectTouchDevice();
        
    // Check for food collisions
    let foodEaten = false;
    
    // Check each food to see if the snake head collides with it
    for (let i = 0; i < foods.length; i++) {
        const food = foods[i];
        if (snake[0].x === food.x && snake[0].y === food.y) {
            // Food was eaten
            foodEaten = true;
            
            // Update score and show effects
            score += food.points;
            
            // Track significant scores
            if (food.points >= 10) {
                trackBestScore(food.x, food.y, food.points);
            }
            
            // Restore hunger when food is eaten
            hungerTimer = Math.min(MAX_HUNGER, hungerTimer + (food.points * 0.8));
            updateHungerBar();
            
            showFoodEffect(food);
            
            // Notify server about the eaten food
            if (socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({
                    type: 'foodEaten',
                    id: playerId,
                    foodIndex: i
                }));
            }
            
            updateScoreAndLevel();
            checkLevelUp();
            
            break; // Exit the loop after eating one food
        }
    }
    
    if (!foodEaten) {
        // Only remove the tail if no food was eaten
        snake.pop();
    }
    
    // Update heat map with current snake position
    updateHeatMap();
    
    sendPlayerState();
    
    // Initialize mobile controls if needed
    detectTouchDevice();
}

function showFoodEffect(food) {
    // Create particles for food consumption
    createParticles(
        food.x,
        food.y,
        food.color,
        food.powerUp ? 12 : 8, // Fewer particles for regular food
        2,
        4,
        800
    );
    
    // Display score effect with bounce animation
    const effectDiv = document.createElement('div');
    effectDiv.textContent = `+${food.points}`;
    effectDiv.style.position = 'absolute';
    effectDiv.style.left = `${food.x * CELL_SIZE}px`;
    effectDiv.style.top = `${food.y * CELL_SIZE}px`;
    effectDiv.style.color = food.color;
    effectDiv.style.fontSize = '20px';
    effectDiv.style.fontWeight = 'bold';
    effectDiv.style.pointerEvents = 'none';
    effectDiv.style.textShadow = '0 0 5px rgba(0,0,0,0.7)';
    document.body.appendChild(effectDiv);

    // Activate power-up if the food has one
    if (food.powerUp) {
        // Set the active power-up with a duration of 10 seconds
        activePowerUp = {
            type: food.powerUp,
            duration: 10000, // 10 seconds
            expiresAt: Date.now() + 10000
        };
        
        // Update power-up indicator and status
        updatePowerUpIndicator();
        updatePowerUpStatus();
    }
    
    const startTime = Date.now();
    const animDuration = 1000;
    
    function animateScore() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(1, elapsed / animDuration);
        const yOffset = -20 * Math.sin(progress * Math.PI);
        const scale = 1 + 0.5 * Math.sin(progress * Math.PI / 2);
        
        effectDiv.style.transform = `translateY(${yOffset}px) scale(${scale})`;
        effectDiv.style.opacity = 1 - progress;
        
        if (progress < 1) {
            requestAnimationFrame(animateScore);
        } else {
            document.body.removeChild(effectDiv);
        }
    }
    
    requestAnimationFrame(animateScore);
    
    if (food.powerUp) {
        const powerUpEffect = document.createElement('div');
        let powerUpName = '';
        let powerUpColor = '';
        
        switch (food.powerUp) {
            case 'speed_boost':
                powerUpName = 'Speed Boost!';
                powerUpColor = POWER_UP_EFFECTS.speed_boost.visualEffect;
                break;
            case 'invincibility':
                powerUpName = 'Invincibility!';
                powerUpColor = POWER_UP_EFFECTS.invincibility.visualEffect;
                break;
            case 'magnet':
                powerUpName = 'Food Magnet!';
                powerUpColor = POWER_UP_EFFECTS.magnet.visualEffect;
                break;
        }
        
        powerUpEffect.textContent = powerUpName;
        powerUpEffect.style.position = 'absolute';
        powerUpEffect.style.left = `${food.x * CELL_SIZE}px`;
        powerUpEffect.style.top = `${(food.y * CELL_SIZE) - 20}px`;
        powerUpEffect.style.color = powerUpColor;
        powerUpEffect.style.fontSize = '18px';
        powerUpEffect.style.fontWeight = 'bold';
        powerUpEffect.style.pointerEvents = 'none';
        powerUpEffect.style.textShadow = '0 0 10px rgba(0,0,0,0.7)';
        document.body.appendChild(powerUpEffect);
        
        // NEW: Enhanced particle explosion for power-up activation
        createParticles(
            food.x,
            food.y,
            powerUpColor,
            15,
            3,
            5,
            1200
        );
        
        // NEW: Create a shockwave effect
        const shockwave = document.createElement('div');
        shockwave.style.position = 'absolute';
        shockwave.style.left = `${food.x * CELL_SIZE + CELL_SIZE/2}px`;
        shockwave.style.top = `${food.y * CELL_SIZE + CELL_SIZE/2}px`;
        shockwave.style.width = '10px';
        shockwave.style.height = '10px';
        shockwave.style.borderRadius = '50%';
        shockwave.style.backgroundColor = 'transparent';
        shockwave.style.border = `2px solid ${powerUpColor}`;
        shockwave.style.transform = 'translate(-50%, -50%)';
        shockwave.style.pointerEvents = 'none';
        shockwave.style.zIndex = '999';
        document.body.appendChild(shockwave);
        
        // Animate shockwave
        const swStartTime = Date.now();
        const swDuration = 800;
        
        function animateShockwave() {
            const elapsed = Date.now() - swStartTime;
            const progress = Math.min(1, elapsed / swDuration);
            const size = 100 * progress;
            
            shockwave.style.width = `${size}px`;
            shockwave.style.height = `${size}px`;
            shockwave.style.opacity = 1 - progress;
            
            if (progress < 1) {
                requestAnimationFrame(animateShockwave);
            } else {
                document.body.removeChild(shockwave);
            }
        }
        
        requestAnimationFrame(animateShockwave);
        
        // Add screen shake for power-up activation
        shakeScreen(10, 500);
        
        const puStartTime = Date.now();
        const puAnimDuration = 1500;
        
        function animatePowerUp() {
            const elapsed = Date.now() - puStartTime;
            const progress = Math.min(1, elapsed / puAnimDuration);
            const yOffset = -40 * progress;
            const scale = 1 + Math.sin(progress * Math.PI) * 0.5;
            
            powerUpEffect.style.transform = `translateY(${yOffset}px) scale(${scale})`;
            powerUpEffect.style.opacity = 1 - progress;
            
            if (progress < 1) {
                requestAnimationFrame(animatePowerUp);
            } else {
                document.body.removeChild(powerUpEffect);
            }
        }
        
        requestAnimationFrame(animatePowerUp);
    }
}

// Update heat map with current positions of all snakes
function updateHeatMap() {
    // Decay all heat values
    for (let x = 0; x < GRID_SIZE; x++) {
        for (let y = 0; y < GRID_SIZE; y++) {
            if (heatMap[x][y] > 0) {
                heatMap[x][y] *= HEAT_DECAY;
                if (heatMap[x][y] < 0.1) heatMap[x][y] = 0;
            }
        }
    }
    
    // Add heat for current player's snake
    snake.forEach((segment, index) => {
        const heatValue = index === 0 ? HEAT_MAX : HEAT_MAX * 0.7;
        if (segment.x >= 0 && segment.x < GRID_SIZE && segment.y >= 0 && segment.y < GRID_SIZE) {
            heatMap[segment.x][segment.y] = heatValue;
        }
    });
    
    // Add heat for other players' snakes
    for (const id in players) {
        if (id !== playerId && players[id].snake) {
            players[id].snake.forEach((segment, index) => {
                const heatValue = index === 0 ? HEAT_MAX * 0.8 : HEAT_MAX * 0.5;
                if (segment.x >= 0 && segment.x < GRID_SIZE && segment.y >= 0 && segment.y < GRID_SIZE) {
                    heatMap[segment.x][segment.y] = Math.max(heatMap[segment.x][segment.y], heatValue);
                }
            });
        }
    }
}

function moveSnake() {
    // Store previous positions for interpolation
    prevSnakePositions = JSON.parse(JSON.stringify(snake));
    
    const head = {x: snake[0].x, y: snake[0].y};
    
    switch (direction) {
        case 'up':
            head.y -= 1;
            break;
        case 'down':
            head.y += 1;
            break;
        case 'left':
            head.x -= 1;
            break;
        case 'right':
            head.x += 1;
            break;
    }
    
    snake.unshift(head);
    
    // Reset interpolation at the start of a new movement cycle
    frameAccumulator = 0;
    interpolationAlpha = 0;
}

function checkCollisions() {
    // Ensure snake has a valid head before checking collisions
    if (!snake || snake.length === 0) {
        console.error("Snake has no segments in checkCollisions");
        return false;
    }
    
    const head = snake[0];
    
    // If invincibility power-up or safe zone is active, skip collision detection
    if ((activePowerUp && activePowerUp.type === 'invincibility') || 
        (safeZoneActive && Date.now() < safeZoneExpiry)) {
        return false;
    }
    
    // Ensure head has valid coordinates
    if (head.x === undefined || head.y === undefined) {
        console.error("Snake head has invalid coordinates");
        return false;
    }
    
    // Check wall collisions
    if (head.x < 0 || head.x >= GRID_SIZE || head.y < 0 || head.y >= GRID_SIZE) {
        return true;
    }
    
    // Check wall object collisions
    for (let i = 0; i < WALLS.length; i++) {
        if (head.x === WALLS[i].x && head.y === WALLS[i].y) {
            return true;
        }
    }
    
    // Check self-collision
    for (let i = 1; i < snake.length; i++) {
        if (head.x === snake[i].x && head.y === snake[i].y) {
            return true;
        }
    }
    
    // Check collision with other players (except in safe zone)
    if (!safeZoneActive || Date.now() >= safeZoneExpiry) {
        for (const id in players) {
            if (id !== playerId) {
                const otherSnake = players[id].snake;
                if (otherSnake) {
                    for (let i = 0; i < otherSnake.length; i++) {
                        if (head.x === otherSnake[i].x && head.y === otherSnake[i].y) {
                            return true;
                        }
                    }
                }
            }
        }
    }
    
    return false;
}

// Power-up countdown bar is now defined earlier in the file

function cleanupGame() {
    // Remove temporary UI elements
    const tempElements = document.querySelectorAll('.temp-game-element');
    tempElements.forEach(el => {
        document.body.removeChild(el);
    });
    
    // Clear any running animations or intervals
    if (gameLoop) {
        clearInterval(gameLoop);
        gameLoop = null;
    }
    
    // Clear particles
    particles.length = 0;
    
    // Reset power-up related elements
    powerUpIndicator.style.display = 'none';
    powerUpStatus.style.display = 'none';
    powerUpCountdownContainer.style.display = 'none';
}

function gameOver(reason = 'collision') {
    // Cancel animation frame first to stop rendering
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    
    // Clear game interval
    if (gameLoop) {
        clearInterval(gameLoop);
        gameLoop = null;
    }
    
    gameRunning = false;
    
    // Clean up game resources
    cleanupGame();
    
    // Set different messages based on death reason
    let deathMessage = '';
    switch (reason) {
        case 'starvation':
            deathMessage = 'You starved to death!';
            break;
        case 'collision':
            deathMessage = 'You crashed!';
            break;
        default:
            deathMessage = 'Game Over!';
    }
    
    // Add death message to game over screen
    const deathMessageElement = document.getElementById('death-message') || document.createElement('div');
    if (!document.getElementById('death-message')) {
        deathMessageElement.id = 'death-message';
        deathMessageElement.style.color = '#F44336';
        deathMessageElement.style.fontSize = '24px';
        deathMessageElement.style.marginBottom = '15px';
        gameOverScreen.insertBefore(deathMessageElement, gameOverScreen.firstChild);
    }
    deathMessageElement.textContent = deathMessage;
    
    finalScoreDisplay.textContent = `Score: ${score} (Best: ${highestScore})`;
    finalLevelDisplay.textContent = `Level: ${level}`;
    gameOverScreen.style.display = 'block';
    
    // Store high scores locally
    if (score > localStorage.getItem('snake_highest_score') || !localStorage.getItem('snake_highest_score')) {
        localStorage.setItem('snake_highest_score', score);
    }
    
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'gameOver',
            id: playerId,
            reason: reason
        }));
    }
}

function shakeScreen(intensity, duration) {
    const gameContainer = document.querySelector('.game-container');
    if (!gameContainer) return;
    
    const startTime = Date.now();
    
    function shake() {
        const elapsed = Date.now() - startTime;
        if (elapsed < duration) {
            const diminishFactor = 1 - (elapsed / duration);
            const shakeX = (Math.random() - 0.5) * intensity * diminishFactor;
            const shakeY = (Math.random() - 0.5) * intensity * diminishFactor;
            
            gameContainer.style.transform = `translate(${shakeX}px, ${shakeY}px)`;
            requestAnimationFrame(shake);
        } else {
            gameContainer.style.transform = '';
        }
    }
    
    requestAnimationFrame(shake);
}

function initBackgroundElements() {
    backgroundElements = [];
    
    BACKGROUND_LAYERS.forEach(layer => {
        for (let i = 0; i < layer.elements; i++) {
            const element = {
                x: Math.random() * (GRID_SIZE * CELL_SIZE * 1.5) - (GRID_SIZE * CELL_SIZE * 0.25),
                y: Math.random() * (GRID_SIZE * CELL_SIZE * 1.5) - (GRID_SIZE * CELL_SIZE * 0.25),
                size: Math.random() * (layer.size[1] - layer.size[0]) + layer.size[0],
                color: layer.color,
                speed: layer.speed,
                type: layer.type,
                opacity: Math.random() * 0.5 + 0.5,
                rotation: Math.random() * Math.PI * 2
            };
            backgroundElements.push(element);
        }
    });
}

function drawEnhancedBackground() {
    // Base dark gradient background
    const gradient = ctx.createRadialGradient(
        canvas.width / 2, canvas.height / 2, 0,
        canvas.width / 2, canvas.height / 2, canvas.width
    );
    gradient.addColorStop(0, '#0f0f1a');
    gradient.addColorStop(1, '#060614');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Add subtle pulsing to background
    const pulseIntensity = 0.03 * Math.sin(Date.now() / 3000);
    
    // Draw background elements with enhanced parallax effect
    backgroundElements.forEach(element => {
        // Calculate parallax position based on camera movement with enhanced effect
        const parallaxX = element.x - (camera.x * (element.speed * (1 + pulseIntensity)));
        const parallaxY = element.y - (camera.y * (element.speed * (1 + pulseIntensity)));
        
        // Skip if not in viewport
        if (parallaxX + element.size < 0 || parallaxX > canvas.width ||
            parallaxY + element.size < 0 || parallaxY > canvas.height) {
            return;
        }
        
        ctx.save();
        
        // Draw based on element type with enhanced effects
        switch(element.type) {
            case 'star':
                // Add pulsing to stars
                const starPulse = 1 + 0.2 * Math.sin(Date.now() / 1000 + element.x * element.y);
                const starSize = element.size * starPulse;
                
                ctx.fillStyle = `rgba(${hexToRgb(element.color)}, ${element.opacity})`;
                ctx.beginPath();
                ctx.arc(parallaxX, parallaxY, starSize, 0, Math.PI * 2);
                ctx.fill();
                
                // Add glow to brighter stars
                if (element.size > 2) {
                    ctx.shadowColor = element.color;
                    ctx.shadowBlur = starSize * 2;
                    ctx.beginPath();
                    ctx.arc(parallaxX, parallaxY, starSize * 0.5, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.shadowBlur = 0;
                }
                break;
                
            case 'nebula':
                // Create a more dynamic nebula effect
                const nebulaGrad = ctx.createRadialGradient(
                    parallaxX, parallaxY, 0,
                    parallaxX, parallaxY, element.size
                );
                nebulaGrad.addColorStop(0, `rgba(${hexToRgb(element.color)}, ${element.opacity * (1 + pulseIntensity)})`);
                nebulaGrad.addColorStop(1, 'rgba(0,0,0,0)');
                    
                ctx.fillStyle = nebulaGrad;
                ctx.beginPath();
                ctx.arc(parallaxX, parallaxY, element.size * (1 + pulseIntensity), 0, Math.PI * 2);
                ctx.fill();
                break;
                
            case 'cloud':
                ctx.translate(parallaxX, parallaxY);
                // Add slow rotation to clouds
                const cloudRotation = element.rotation + (Date.now() / 30000);
                ctx.rotate(cloudRotation);
                ctx.fillStyle = `rgba(${hexToRgb(element.color)}, ${element.opacity * 0.3})`;
                
                // Draw cloud shape
                ctx.beginPath();
                for (let i = 0; i < 3; i++) {
                    ctx.ellipse(
                        (i - 1) * element.size * 0.3, 
                        Math.sin(i + Date.now()/5000) * element.size * 0.1, 
                        element.size * 0.4, 
                        element.size * 0.2, 
                        0, 0, Math.PI * 2
                    );
                }
                ctx.fill();
                break;
        }
        
        ctx.restore();
    });
    
    // Add enhanced grid pattern that shifts with camera
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    
    const gridStep = 100;
    const offsetX = -camera.x * 0.1 % gridStep;
    const offsetY = -camera.y * 0.1 % gridStep;
    
    // Create hexagonal grid pattern instead of square
    const hexHeight = gridStep;
    const hexWidth = gridStep * 0.866; // cos(30°) * 2 * height
    
    for (let y = -hexHeight; y < canvas.height + hexHeight; y += hexHeight * 0.75) {
        const rowOffset = Math.floor(y / (hexHeight * 0.75)) % 2 === 0 ? 0 : hexWidth * 0.5;
        for (let x = -hexWidth; x < canvas.width + hexWidth; x += hexWidth) {
            ctx.beginPath();
            for (let i = 0; i < 6; i++) {
                const angle = 2 * Math.PI / 6 * i;
                const hx = x + rowOffset + offsetX + hexWidth * 0.5 * Math.cos(angle);
                const hy = y + offsetY + hexHeight * 0.5 * Math.sin(angle);
                if (i === 0) {
                    ctx.moveTo(hx, hy);
                } else {
                    ctx.lineTo(hx, hy);
                }
            }
            ctx.closePath();
            ctx.stroke();
        }
    }
}

// generateWalls function removed - walls are now managed by the server

// Wall formation functions removed - now handled by the server

function drawWalls() {
    // Only draw walls that are in viewport
    for (const wall of WALLS) {
        const wallX = wall.x * CELL_SIZE;
        const wallY = wall.y * CELL_SIZE;
        
        // Skip if outside viewport
        if (wallX + CELL_SIZE < camera.x || wallX > camera.x + VIEWPORT_WIDTH ||
            wallY + CELL_SIZE < camera.y || wallY > camera.y + VIEWPORT_HEIGHT) {
            continue;
        }
        
        // Draw wall with 3D effect
        ctx.fillStyle = WALL_COLOR;
        ctx.fillRect(wallX, wallY, CELL_SIZE, CELL_SIZE);
        
        // Add highlights
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.fillRect(wallX, wallY, CELL_SIZE, CELL_SIZE / 4);
        ctx.fillRect(wallX, wallY, CELL_SIZE / 4, CELL_SIZE);
        
        // Add shadows
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.fillRect(wallX, wallY + CELL_SIZE - CELL_SIZE / 4, CELL_SIZE, CELL_SIZE / 4);
        ctx.fillRect(wallX + CELL_SIZE - CELL_SIZE / 4, wallY, CELL_SIZE / 4, CELL_SIZE);
    }
}

function activateSafeZone() {
    safeZoneActive = true;
    safeZoneExpiry = Date.now() + SAFE_ZONE_DURATION * 1.5; // Increased duration by 50%
    
    // Create visual indicator that safe zone is active
    const indicator = document.createElement('div');
    indicator.className = 'safe-zone-indicator temp-game-element';
    indicator.textContent = 'SAFE ZONE ACTIVE';
    indicator.style.position = 'absolute';
    indicator.style.top = '100px';
    indicator.style.left = '50%';
    indicator.style.transform = 'translateX(-50%)';
    indicator.style.padding = '10px 20px';
    indicator.style.backgroundColor = 'rgba(76, 175, 80, 0.8)';
    indicator.style.color = 'white';
    indicator.style.borderRadius = '5px';
    indicator.style.fontWeight = 'bold';
    indicator.style.boxShadow = '0 0 10px rgba(76, 175, 80, 0.7)';
    indicator.style.zIndex = '1000';
    document.body.appendChild(indicator);
    
    // Remove after a few seconds
    setTimeout(() => {
        if (document.body.contains(indicator)) {
            document.body.removeChild(indicator);
        }
    }, 4000);
}

function spawnStartingFood() {
    // Spawn extra food near the starting area for new players
    const centerX = Math.floor(GRID_SIZE / 2);
    const centerY = Math.floor(GRID_SIZE / 2);
    
    // Send request to server to create more food in starting area (increased from 8 to 15)
    for (let i = 0; i < 15; i++) {
        // Create food in multiple concentric spiral patterns for better distribution
        const angle = (i / 15) * Math.PI * 2;
        
        // Alternate between inner and outer food
        let distance;
        if (i % 2 === 0) {
            distance = 3 + (i / 2); // Closer food (3-10 cells from center)
        } else {
            distance = 10 + (i / 2); // Farther food (10-17 cells from center)
        }
        
        const x = Math.floor(centerX + Math.cos(angle) * distance);
        const y = Math.floor(centerY + Math.sin(angle) * distance);
        
        // Request food creation at this position
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: 'requestFood',
                x: x,
                y: y,
                safeZoneFood: true // Flag for server to prioritize this food
            }));
        }
    }
    
    // Add higher value foods including power-ups slightly further away as incentive
    for (let i = 0; i < 8; i++) { // Increased from 4 to 8
        const angle = (i / 8) * Math.PI * 2;
        const distance = 20 + Math.random() * 5; // 20-25 cells away
        
        const x = Math.floor(centerX + Math.cos(angle) * distance);
        const y = Math.floor(centerY + Math.sin(angle) * distance);
        
        // Request special food creation
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: 'requestFood',
                x: x,
                y: y,
                specialFood: true, // Flag for server to create higher value food
                points: i % 3 === 0 ? 50 : 20, // Alternate between 50 and 20 points
                powerUp: i % 4 === 0 // Every 4th special food is a power-up
            }));
        }
    }
}

function drawSafeZone() {
    const centerX = Math.floor(GRID_SIZE / 2);
    const centerY = Math.floor(GRID_SIZE / 2);
    const remainingTime = (safeZoneExpiry - Date.now()) / SAFE_ZONE_DURATION;
    
    if (remainingTime <= 0) {
        safeZoneActive = false;
        return;
    }
    
    // Draw enhanced safe zone with multiple visual effects
    
    // 1. Draw pulsing ground effect
    const groundRadius = SAFE_ZONE_RADIUS * CELL_SIZE;
    const groundGradient = ctx.createRadialGradient(
        centerX * CELL_SIZE + CELL_SIZE/2,
        centerY * CELL_SIZE + CELL_SIZE/2,
        0,
        centerX * CELL_SIZE + CELL_SIZE/2,
        centerY * CELL_SIZE + CELL_SIZE/2,
        groundRadius
    );
    
    // Create a colorful, cosmic-like ground effect
    const pulseSpeed = 300;
    const pulse = 0.3 + 0.7 * Math.sin(Date.now() / pulseSpeed);
    
    groundGradient.addColorStop(0, `rgba(50, 200, 100, ${0.15 * remainingTime * pulse})`);
    groundGradient.addColorStop(0.3, `rgba(76, 175, 120, ${0.12 * remainingTime * pulse})`);
    groundGradient.addColorStop(0.6, `rgba(100, 160, 140, ${0.1 * remainingTime * pulse})`);
    groundGradient.addColorStop(1, 'rgba(76, 175, 80, 0)');
    
    ctx.beginPath();
    ctx.arc(
        centerX * CELL_SIZE + CELL_SIZE/2,
        centerY * CELL_SIZE + CELL_SIZE/2,
        groundRadius,
        0,
        Math.PI * 2
    );
    ctx.fillStyle = groundGradient;
    ctx.fill();
    
    // 2. Draw multiple layers of circular effects
    for (let i = 0; i < 5; i++) { // Increased from 3 to 5 layers
        const pulseSpeed = 300 + i * 100;
        const pulse = 0.3 + 0.7 * Math.sin(Date.now() / pulseSpeed);
        const radius = (SAFE_ZONE_RADIUS - i * 2) * CELL_SIZE;
        
        ctx.beginPath();
        ctx.arc(
            centerX * CELL_SIZE + CELL_SIZE/2,
            centerY * CELL_SIZE + CELL_SIZE/2,
            radius * (0.98 + 0.02 * pulse),
            0,
            Math.PI * 2
        );
        
        const opacity = (0.2 - i * 0.03) * remainingTime * pulse;
        
        // Different color for each layer to create rainbow effect
        const hue = (120 + i * 30) % 360; // Green to blue range
        const gradient = ctx.createRadialGradient(
            centerX * CELL_SIZE + CELL_SIZE/2,
            centerY * CELL_SIZE + CELL_SIZE/2,
            0,
            centerX * CELL_SIZE + CELL_SIZE/2,
            centerY * CELL_SIZE + CELL_SIZE/2,
            radius
        );
        gradient.addColorStop(0, `hsla(${hue}, 80%, 60%, ${opacity * 0.3})`);
        gradient.addColorStop(0.7, `hsla(${hue}, 80%, 50%, ${opacity * 0.2})`);
        gradient.addColorStop(1, `hsla(${hue}, 80%, 40%, 0)`);
        
        ctx.fillStyle = gradient;
        ctx.fill();
    }
    
    // 3. Draw animated spinning border
    const time = Date.now() / 1000;
    const spinSpeed = time * 30; // Faster spin
    
    // Main border
    ctx.beginPath();
    ctx.arc(
        centerX * CELL_SIZE + CELL_SIZE/2,
        centerY * CELL_SIZE + CELL_SIZE/2,
        SAFE_ZONE_RADIUS * CELL_SIZE,
        0,
        Math.PI * 2
    );
    ctx.setLineDash([8, 12]);
    ctx.lineDashOffset = spinSpeed;
    ctx.strokeStyle = `rgba(76, 235, 80, ${0.5 * remainingTime + 0.5 * Math.sin(time * 3)})`;
    ctx.lineWidth = 4;
    ctx.stroke();
    
    // Secondary border (spinning the opposite direction)
    ctx.beginPath();
    ctx.arc(
        centerX * CELL_SIZE + CELL_SIZE/2,
        centerY * CELL_SIZE + CELL_SIZE/2,
        SAFE_ZONE_RADIUS * CELL_SIZE * 0.95,
        0,
        Math.PI * 2
    );
    ctx.setLineDash([6, 10]);
    ctx.lineDashOffset = -spinSpeed * 0.7;
    ctx.strokeStyle = `rgba(100, 255, 130, ${0.4 * remainingTime + 0.3 * Math.sin(time * 2.5)})`;
    ctx.lineWidth = 3;
    ctx.stroke();
    
    // Reset line dash
    ctx.setLineDash([]);
    
    // 4. Add celestial-like particles orbiting the safe zone
    const particleCount = 12;
    for (let i = 0; i < particleCount; i++) {
        const angle = (i / particleCount) * Math.PI * 2 + time * (i % 3 + 1);
        const distance = SAFE_ZONE_RADIUS * CELL_SIZE * (0.9 + 0.2 * Math.sin(time * 2 + i));
        
        const x = centerX * CELL_SIZE + CELL_SIZE/2 + Math.cos(angle) * distance;
        const y = centerY * CELL_SIZE + CELL_SIZE/2 + Math.sin(angle) * distance;
        
        const particleSize = 3 + 2 * Math.sin(time * 3 + i * 2);
        
        // Draw glowing particle
        ctx.beginPath();
        ctx.arc(x, y, particleSize, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(150, 255, 150, ${0.7 * remainingTime})`;
        ctx.fill();
        
        // Add glow effect
        ctx.shadowColor = 'rgba(76, 255, 80, 0.8)';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(x, y, particleSize * 0.6, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(200, 255, 200, 0.8)';
        ctx.fill();
        ctx.shadowBlur = 0;
        
        // Connect with glowing lines to center
        ctx.beginPath();
        ctx.moveTo(centerX * CELL_SIZE + CELL_SIZE/2, centerY * CELL_SIZE + CELL_SIZE/2);
        ctx.lineTo(x, y);
        ctx.strokeStyle = `rgba(100, 255, 100, ${0.15 * remainingTime})`;
        ctx.lineWidth = 1 + Math.sin(time + i) * 0.5;
        ctx.stroke();
    }
    
    // 5. Add text indicators with improved styling
    // Time remaining
    ctx.fillStyle = `rgba(255, 255, 255, ${0.8 * remainingTime + 0.2 * Math.sin(time * 3)})`;
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 5;
    ctx.fillText(
        `SAFE ZONE: ${Math.ceil(remainingTime * SAFE_ZONE_DURATION / 1000)}s`,
        centerX * CELL_SIZE + CELL_SIZE/2,
        centerY * CELL_SIZE - SAFE_ZONE_RADIUS * CELL_SIZE * 0.5
    );
    
    // Draw 'SAFE HAVEN' text in a stylish way
    ctx.font = 'bold 32px Arial';
    ctx.fillStyle = `rgba(150, 255, 180, ${0.7 * remainingTime + 0.3 * Math.sin(time * 2)})`;
    ctx.fillText(
        'SAFE HAVEN',
        centerX * CELL_SIZE + CELL_SIZE/2,
        centerY * CELL_SIZE
    );
    
    // Additional text
    ctx.font = 'bold 18px Arial';
    ctx.fillStyle = `rgba(255, 255, 255, ${0.7 * remainingTime + 0.2 * Math.sin(time * 3 + Math.PI)})`;
    ctx.fillText(
        'COLLISION FREE ZONE',
        centerX * CELL_SIZE + CELL_SIZE/2,
        centerY * CELL_SIZE + CELL_SIZE * 5
    );
    
    ctx.shadowBlur = 0;
    
    // Draw a decorative compass-like design in the center
    const compassRadius = SAFE_ZONE_RADIUS * CELL_SIZE * 0.2;
    
    // Draw compass circle
    ctx.beginPath();
    ctx.arc(
        centerX * CELL_SIZE + CELL_SIZE/2,
        centerY * CELL_SIZE + CELL_SIZE/2,
        compassRadius,
        0,
        Math.PI * 2
    );
    ctx.strokeStyle = `rgba(150, 255, 150, ${0.5 * remainingTime})`;
    ctx.lineWidth = 2;
    ctx.stroke();
    
    // Draw compass directions
    const directions = 8;
    for (let i = 0; i < directions; i++) {
        const angle = (i / directions) * Math.PI * 2;
        const x1 = centerX * CELL_SIZE + CELL_SIZE/2 + Math.cos(angle) * compassRadius * 0.7;
        const y1 = centerY * CELL_SIZE + CELL_SIZE/2 + Math.sin(angle) * compassRadius * 0.7;
        const x2 = centerX * CELL_SIZE + CELL_SIZE/2 + Math.cos(angle) * compassRadius * 1.3;
        const y2 = centerY * CELL_SIZE + CELL_SIZE/2 + Math.sin(angle) * compassRadius * 1.3;
        
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = `rgba(200, 255, 200, ${0.6 * remainingTime})`;
        ctx.lineWidth = 2;
        ctx.stroke();
    }
}

function drawMagnetField() {
    if (!activePowerUp || activePowerUp.type !== 'magnet') return;
    
    const head = snake[0];
    const range = POWER_UP_EFFECTS.magnet.range;
    
    // Draw a semi-transparent circle around the snake head
    ctx.beginPath();
    ctx.arc(
        head.x * CELL_SIZE + CELL_SIZE / 2,
        head.y * CELL_SIZE + CELL_SIZE / 2,
        range * CELL_SIZE,
        0,
        Math.PI * 2
    );
    ctx.fillStyle = 'rgba(255, 235, 59, 0.2)';
    ctx.fill();
    
    // Draw a pulsing border
    const pulseIntensity = 0.6 + 0.4 * Math.sin(Date.now() / 200);
    ctx.strokeStyle = `rgba(255, 235, 59, ${pulseIntensity})`;
    ctx.lineWidth = 3;
    ctx.stroke();
    
    // Add magnetic field lines
    const lineCount = 12;
    const time = Date.now() / 800;
    
    ctx.strokeStyle = 'rgba(255, 235, 59, 0.5)';
    ctx.lineWidth = 2;
    
    for (let i = 0; i < lineCount; i++) {
        const angle = (i / lineCount) * Math.PI * 2 + time;
        const innerRadius = range * CELL_SIZE * 0.3;
        const outerRadius = range * CELL_SIZE * 0.7; // Reduced from 0.9 to make the magnet field smaller
        
        ctx.beginPath();
        ctx.moveTo(
            head.x * CELL_SIZE + CELL_SIZE / 2 + Math.cos(angle) * innerRadius,
            head.y * CELL_SIZE + CELL_SIZE / 2 + Math.sin(angle) * innerRadius
        );
        ctx.lineTo(
            head.x * CELL_SIZE + CELL_SIZE / 2 + Math.cos(angle) * outerRadius,
            head.y * CELL_SIZE + CELL_SIZE / 2 + Math.sin(angle) * outerRadius
        );
        ctx.stroke();
    }
    
    // Occasionally create particles (increased frequency)
    if (Math.random() < 0.2) {
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * range * CELL_SIZE;
        
        createParticles(
            head.x + Math.cos(angle) * distance / CELL_SIZE,
            head.y + Math.sin(angle) * distance / CELL_SIZE,
            POWER_UP_EFFECTS.magnet.visualEffect,
            2,
            0.7,
            3,
            600
        );
    }
}

function trackBestScore(x, y, score) {
    // Add new score location to the array
    bestScoresData.push({
        x: x,
        y: y,
        score: score,
        timestamp: Date.now()
    });
    
    // Sort by score (highest first)
    bestScoresData.sort((a, b) => b.score - a.score);
    
    // Keep only the top scores
    if (bestScoresData.length > MAX_BEST_SCORES) {
        bestScoresData = bestScoresData.slice(0, MAX_BEST_SCORES);
    }
    
    // Update the visualization if visible
    if (bestScoresVisible) {
        updateBestScores();
    }
}

function updateBestScores() {
    bestScoresCtx.clearRect(0, 0, bestScoresCanvas.width, bestScoresCanvas.height);
    
    // Draw background
    bestScoresCtx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    bestScoresCtx.fillRect(0, 0, bestScoresCanvas.width, bestScoresCanvas.height);
    
    // Add title
    bestScoresCtx.fillStyle = 'white';
    bestScoresCtx.font = 'bold 12px Arial';
    bestScoresCtx.textAlign = 'center';
    bestScoresCtx.fillText('Leader board', bestScoresCanvas.width/2, 15);
    
    // Draw separator line
    bestScoresCtx.strokeStyle = '#444';
    bestScoresCtx.lineWidth = 1;
    bestScoresCtx.beginPath();
    bestScoresCtx.moveTo(10, 20);
    bestScoresCtx.lineTo(bestScoresCanvas.width - 10, 20);
    bestScoresCtx.stroke();
    
    // Get all players including current player
    const allPlayers = [...Object.entries(players)];
    
    // Add current player if not already in the list
    if (playerId && snake.length > 0) {
        const playerExists = allPlayers.some(([id]) => id === playerId);
        if (!playerExists) {
            allPlayers.push([playerId, { score, level, snake }]);
        }
    }
    
    // Sort players by score (highest first)
    const sortedPlayers = allPlayers
        .filter(([_, player]) => player.score !== undefined)
        .sort(([_, a], [__, b]) => b.score - a.score)
        .slice(0, 8); // Show top 8 players
    
    // If no players yet
    if (sortedPlayers.length === 0) {
        bestScoresCtx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        bestScoresCtx.font = 'italic 11px Arial';
        bestScoresCtx.textAlign = 'center';
        bestScoresCtx.fillText('No players yet', bestScoresCanvas.width/2, 60);
        return;
    }
    
    // Draw column headers
    bestScoresCtx.fillStyle = '#AAAAAA';
    bestScoresCtx.font = 'bold 10px Arial';
    bestScoresCtx.textAlign = 'left';
    bestScoresCtx.fillText('#', 15, 35);
    
    bestScoresCtx.textAlign = 'left';
    bestScoresCtx.fillText('PLAYER', 35, 35);
    
    bestScoresCtx.textAlign = 'right';
    bestScoresCtx.fillText('SCORE', 135, 35);
    
    // Draw each player row
    const rowHeight = 12;
    const startY = 50;
    
    sortedPlayers.forEach(([id, player], index) => {
        const y = startY + index * rowHeight;
        const isCurrentPlayer = id === playerId;
        
        // Calculate color based on rank (gradient from gold to red)
        let color;
        if (isCurrentPlayer) {
            color = '#4CAF50'; // Green for current player
        } else {
            const hue = 60 - (index * 6);
            color = `hsl(${hue}, 100%, 50%)`;
        }
        
        // Draw rank number
        bestScoresCtx.fillStyle = color;
        bestScoresCtx.font = isCurrentPlayer ? 'bold 10px Arial' : '10px Arial';
        bestScoresCtx.textAlign = 'left';
        bestScoresCtx.fillText(`${index + 1}`, 15, y);
        
        // Draw player name
        bestScoresCtx.textAlign = 'left';
        bestScoresCtx.fillStyle = isCurrentPlayer ? '#4CAF50' : 'white';
        bestScoresCtx.font = isCurrentPlayer ? 'bold 10px Arial' : '10px Arial';
        bestScoresCtx.fillText(isCurrentPlayer ? 'You' : `P${id.slice(-3)}`, 35, y);
        
        // Draw score
        bestScoresCtx.textAlign = 'right';
        bestScoresCtx.fillStyle = isCurrentPlayer ? '#4CAF50' : '#CCCCCC';
        bestScoresCtx.font = isCurrentPlayer ? 'bold 10px Arial' : '10px Arial';
        bestScoresCtx.fillText(`${player.score || 0}`, 135, y);
    });
}

function updateMinimap() {
    minimapCtx.clearRect(0, 0, minimapCanvas.width, minimapCanvas.height);
    
    // Add a dark background for better visibility
    minimapCtx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    minimapCtx.fillRect(0, 0, minimapCanvas.width, minimapCanvas.height);
    
    // Improved scale for the larger grid (was minimapCanvas.width / GRID_SIZE)
    const minimapScale = minimapCanvas.width / GRID_SIZE; // This creates very small pixels with GRID_SIZE of 400
    
    // Draw borders
    minimapCtx.strokeStyle = '#444';
    minimapCtx.lineWidth = 1;
    minimapCtx.strokeRect(0, 0, minimapCanvas.width, minimapCanvas.height);
    
    // Draw heat map with improved visibility
    for (let x = 0; x < GRID_SIZE; x += 4) { // Skip more cells for performance and better visibility
        for (let y = 0; y < GRID_SIZE; y += 4) {
            if (heatMap[x][y] > 0) {
                const intensity = Math.min(1, heatMap[x][y] / HEAT_MAX);
                const r = Math.floor(255 * intensity);
                const g = Math.floor(100 * (1 - intensity));
                const b = Math.floor(255 * (1 - intensity));
                const alpha = Math.min(0.8, 0.3 + intensity * 0.5); // Increased alpha for better visibility
                
                minimapCtx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
                minimapCtx.fillRect(
                    x * minimapScale,
                    y * minimapScale,
                    minimapScale * 4, // Make dots bigger
                    minimapScale * 4
                );
            }
        }
    }
    
    // Draw players with larger dots for visibility
    for (const id in players) {
        const player = players[id];
        if (!player.snake || player.snake.length === 0) continue;
        
        const isCurrentPlayer = id === playerId;
        const head = player.snake[0];
        
        // Just draw the head with a larger dot for visibility
        minimapCtx.fillStyle = isCurrentPlayer ? '#4CAF50' : '#3F51B5';
        
        // Enlarged player indicators
        minimapCtx.beginPath();
        minimapCtx.arc(
            head.x * minimapScale,
            head.y * minimapScale,
            isCurrentPlayer ? 3 : 2, // Fixed size regardless of scale
            0,
            Math.PI * 2
        );
        minimapCtx.fill();
    }
    
    // Draw foods with better visibility
    foods.forEach(food => {
        // Make power-up foods more visible
        const isPowerUp = food.powerUp !== undefined;
        const dotSize = isPowerUp ? 2 : 1;
        
        minimapCtx.fillStyle = food.color || '#FF5722';
        minimapCtx.beginPath();
        minimapCtx.arc(
            food.x * minimapScale,
            food.y * minimapScale,
            dotSize, // Fixed size dots
            0,
            Math.PI * 2
        );
        minimapCtx.fill();
        
        // Add glow effect to power-up foods
        if (isPowerUp) {
            minimapCtx.strokeStyle = food.color;
            minimapCtx.lineWidth = 1;
            minimapCtx.beginPath();
            minimapCtx.arc(
                food.x * minimapScale,
                food.y * minimapScale,
                3,
                0,
                Math.PI * 2
            );
            minimapCtx.stroke();
        }
    });
    
    // Draw viewport rectangle with improved visibility
    minimapCtx.strokeStyle = '#FFFFFF';
    minimapCtx.lineWidth = 2; // Increased from 1 for better visibility
    minimapCtx.strokeRect(
        (camera.x / CELL_SIZE) * minimapScale,
        (camera.y / CELL_SIZE) * minimapScale,
        (VIEWPORT_WIDTH / CELL_SIZE) * minimapScale,
        (VIEWPORT_HEIGHT / CELL_SIZE) * minimapScale
    );
    
    // Add "you are here" indicator
    if (snake.length > 0) {
        const head = snake[0];
        minimapCtx.fillStyle = '#4CAF50';
        minimapCtx.beginPath();
        minimapCtx.arc(
            head.x * minimapScale,
            head.y * minimapScale,
            4, // Larger indicator for player
            0,
            Math.PI * 2
        );
        minimapCtx.fill();
        
        // Add pulsing effect
        minimapCtx.strokeStyle = 'rgba(76, 175, 80, 0.7)';
        minimapCtx.lineWidth = 1;
        const pulseSize = 4 + Math.sin(Date.now() / 200) * 2;
        minimapCtx.beginPath();
        minimapCtx.arc(
            head.x * minimapScale,
            head.y * minimapScale,
            pulseSize,
            0, 
            Math.PI * 2
        );
        minimapCtx.stroke();
    }
}

function updatePlayersCount() {
    const count = Object.keys(players).length;
    playersCountDisplay.textContent = `Players: ${count}`;
}


startBtn.addEventListener('click', () => {
    startScreen.style.display = 'none';
    canvas.style.display = 'block';
    if (!gameRunning) {
        initGame();
    }
});

restartBtn.addEventListener('click', () => {
    gameOverScreen.style.display = 'none';
    initGame();
});

function checkPowerUpExpiration() {
    if (activePowerUp && Date.now() > activePowerUp.expiresAt) {
        deactivatePowerUp();
    }
}

// Deactivate the current power-up
function deactivatePowerUp() {
    if (!activePowerUp) return;
    
    // Reset game speed if speed boost was active
    if (activePowerUp.type === 'speed_boost') {
        clearInterval(gameLoop);
        gameLoop = setInterval(gameStep, gameSpeed);
    }
    
    // Clear all visual effects
    activePowerUp = null;
    powerUpIndicator.style.display = 'none';
    powerUpStatus.style.display = 'none';
    powerUpCountdownContainer.style.display = 'none';
    
    updateSpeedDisplay();
    
    // Add class to temporary elements created by power-ups for cleanup
    const powerUpEffects = document.querySelectorAll('.power-up-effect');
    powerUpEffects.forEach(el => {
        el.classList.add('temp-game-element');
    });
}

// Update the power-up indicator
function updatePowerUpIndicator() {
    if (!activePowerUp) {
        powerUpIndicator.style.display = 'none';
        return;
    }
    
    const timeLeft = Math.ceil((activePowerUp.expiresAt - Date.now()) / 1000);
    let powerUpName = '';
    let powerUpColor = '';
    
    switch (activePowerUp.type) {
        case 'speed_boost':
            powerUpName = 'SPEED BOOST';
            powerUpColor = POWER_UP_EFFECTS.speed_boost.visualEffect;
            break;
        case 'invincibility':
            powerUpName = 'INVINCIBILITY';
            powerUpColor = POWER_UP_EFFECTS.invincibility.visualEffect;
            break;
        case 'magnet':
            powerUpName = 'FOOD MAGNET';
            powerUpColor = POWER_UP_EFFECTS.magnet.visualEffect;
            break;
    }
    
    powerUpIndicator.innerHTML = `<span style="font-size:22px;">${powerUpName}</span>: <span style="font-size:24px; font-weight:bold;">${timeLeft}s</span>`;
    powerUpIndicator.style.display = 'block';
    powerUpIndicator.style.backgroundColor = powerUpColor;
    powerUpIndicator.style.boxShadow = `0 0 15px ${powerUpColor}, 0 0 25px ${powerUpColor}`;
    powerUpIndicator.style.padding = '10px 20px';
    powerUpIndicator.style.borderRadius = '10px';
    powerUpIndicator.style.color = 'white';
    powerUpIndicator.style.textShadow = '2px 2px 4px rgba(0,0,0,0.7)';
    
    if (timeLeft <= 3) {
        powerUpIndicator.style.animation = 'pulse 0.5s infinite alternate';
        if (!powerUpIndicator.style.animationName) {
            const style = document.createElement('style');
            style.textContent = `
                @keyframes pulse {
                    from { transform: translateX(-50%) scale(1); opacity: 1; }
                    to { transform: translateX(-50%) scale(1.2); opacity: 0.8; }
                }
            `;
            document.head.appendChild(style);
        }
    } else {
        powerUpIndicator.style.animation = '';
    }
    
    if (activePowerUp.type === 'speed_boost' && gameRunning) {
        const boostedSpeed = gameSpeed / POWER_UP_EFFECTS.speed_boost.speedMultiplier;
        clearInterval(gameLoop);
        gameLoop = setInterval(gameStep, boostedSpeed);
    }
}

// Add the missing updatePowerUpStatus function
function updatePowerUpStatus() {
    if (!activePowerUp) {
        powerUpStatus.style.display = 'none';
        powerUpCountdownContainer.style.display = 'none';
        return;
    }
    
    const timeLeft = Math.ceil((activePowerUp.expiresAt - Date.now()) / 1000);
    
    // Update countdown bar width based on remaining time percentage
    const totalDuration = 10000; // 10 seconds standard duration
    const percentLeft = ((activePowerUp.expiresAt - Date.now()) / totalDuration) * 100;
    powerUpCountdownBar.style.width = `${Math.max(0, percentLeft)}%`;
    
    // Change countdown bar color based on power-up type
    switch (activePowerUp.type) {
        case 'speed_boost':
            powerUpCountdownBar.style.backgroundColor = POWER_UP_EFFECTS.speed_boost.visualEffect;
            break;
        case 'invincibility':
            powerUpCountdownBar.style.backgroundColor = POWER_UP_EFFECTS.invincibility.visualEffect;
            break;
        case 'magnet':
            powerUpCountdownBar.style.backgroundColor = POWER_UP_EFFECTS.magnet.visualEffect;
            break;
    }
    
    // Show countdown container
    powerUpCountdownContainer.style.display = 'block';
}

// Apply magnet effect to attract nearby food
function applyMagnetEffect() {
    if (!activePowerUp || activePowerUp.type !== 'magnet') return;
    
    const head = snake[0];
    const range = POWER_UP_EFFECTS.magnet.range;
    const strength = POWER_UP_EFFECTS.magnet.attractionStrength;
    
    // Find foods within range
    for (let i = foods.length - 1; i >= 0; i--) {
        const food = foods[i];
        const dx = food.x - head.x;
        const dy = food.y - head.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance <= range && distance > 0) {
            // Calculate direction to snake
            const angle = Math.atan2(dy, dx);
            
            // Move food towards snake (faster when closer)
            // Enhanced attraction formula for stronger effect
            const moveSpeed = strength * (1.5 - distance / range);
            const moveX = Math.cos(angle) * moveSpeed;
            const moveY = Math.sin(angle) * moveSpeed;
            
            // Store original position for visual effect
            const oldX = food.x;
            const oldY = food.y;
            
            // Update food position with stronger movement
            food.x -= moveX;
            food.y -= moveY;
            
            // If food gets very close to the snake head, automatically consume it
            if (distance < 3) {
                // Update score and show effects
                score += food.points;
                
                // Restore hunger when food is eaten
                hungerTimer = Math.min(MAX_HUNGER, hungerTimer + (food.points * 0.8));
                updateHungerBar();
                
                showFoodEffect(food);
                
                // Notify server about the eaten food
                if (socket.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify({
                        type: 'foodEaten',
                        id: playerId,
                        foodIndex: i
                    }));
                }
                
                updateScoreAndLevel();
                checkLevelUp();
                
                // Grow the snake
                const tail = snake[snake.length - 1];
                snake.push({x: tail.x, y: tail.y});
                
                // No need to continue processing this food
                break;
            }
            
            // Visual effect for magnet attraction (more frequent for stronger effect)
            if (Math.random() < 0.8) {
                showMagnetEffect(oldX, oldY, food.x, food.y);
            }
        }
    }
}

// Show visual effect for magnet attraction
function showMagnetEffect(fromX, fromY, toX, toY) {
    // Create multiple particles for a more visible effect
    for (let i = 0; i < 5; i++) {
        const effect = document.createElement('div');
        effect.style.position = 'absolute';
        effect.style.left = `${fromX * CELL_SIZE + CELL_SIZE/2}px`;
        effect.style.top = `${fromY * CELL_SIZE + CELL_SIZE/2}px`;
        effect.style.width = '8px';
        effect.style.height = '8px';
        effect.style.borderRadius = '50%';
        effect.style.backgroundColor = POWER_UP_EFFECTS.magnet.visualEffect;
        effect.style.boxShadow = `0 0 12px ${POWER_UP_EFFECTS.magnet.visualEffect}`;
        effect.style.pointerEvents = 'none';
        effect.style.zIndex = '1000';
        document.body.appendChild(effect);
        
        // Animate the effect with slight delay between particles
        const startTime = Date.now() + i * 40;
        const duration = 250; // ms
        
        function animate() {
            const now = Date.now();
            if (now < startTime) {
                requestAnimationFrame(animate);
                return;
            }
            
            const elapsed = now - startTime;
            const progress = Math.min(1, elapsed / duration);
            
            effect.style.left = `${(fromX + (toX - fromX) * progress) * CELL_SIZE + CELL_SIZE/2}px`;
            effect.style.top = `${(fromY + (toY - fromY) * progress) * CELL_SIZE + CELL_SIZE/2}px`;
            effect.style.opacity = 1 - progress;
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                document.body.removeChild(effect);
            }
        }
        
        requestAnimationFrame(animate);
    }
}

function updateHungerBar() {
    const percentage = (hungerTimer / MAX_HUNGER) * 100;
    const clockCtx = hungerClock.getContext('2d');
    const centerX = hungerClock.width / 2;
    const centerY = hungerClock.height / 2;
    const radius = hungerClock.width / 2 - 5;
    
    // Clear the canvas
    clockCtx.clearRect(0, 0, hungerClock.width, hungerClock.height);
    
    // Draw background circle with increased contrast
    clockCtx.beginPath();
    clockCtx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    clockCtx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    clockCtx.fill();
    
    // Draw hunger meter arc with red border
    clockCtx.beginPath();
    clockCtx.moveTo(centerX, centerY);
    // Start at the top (12 o'clock position) and draw clockwise
    const startAngle = -Math.PI / 2;
    const endAngle = startAngle + (2 * Math.PI * percentage / 100);
    
    // Draw red border first
    clockCtx.lineWidth = 3;
    clockCtx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
    clockCtx.arc(centerX, centerY, radius, startAngle, endAngle);
    clockCtx.stroke();
    
    // Draw colored arc
    clockCtx.beginPath();
    clockCtx.moveTo(centerX, centerY);
    clockCtx.arc(centerX, centerY, radius, startAngle, endAngle);
    
    // Set color based on hunger level
    let clockColor;
    if (percentage > 70) {
        // Healthy - full red
        clockColor = '#ff4d4d';
        heartIcon.innerHTML = '❤️';
    } else if (percentage > 40) {
        // Warning - yellow
        clockColor = '#FFC107';
        heartIcon.innerHTML = '💛';
    } else if (percentage > 20) {
        // Danger - orange
        clockColor = '#FF9800';
        heartIcon.innerHTML = '🧡';
    } else {
        // Critical - broken heart
        clockColor = '#F44336';
        heartIcon.innerHTML = '💔';
    }
    
    clockCtx.fillStyle = clockColor;
    clockCtx.fill();
    
    // Draw outline
    clockCtx.beginPath();
    clockCtx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    clockCtx.strokeStyle = 'rgba(255, 0, 0, 0.7)';
    clockCtx.lineWidth = 2;
    clockCtx.stroke();
    
    // Add visual effects based on hunger level
    if (percentage <= 20) {
        if (!heartIcon.style.animation) {
            heartIcon.style.animation = 'heart-pulse 0.6s infinite alternate';
            heartContainer.style.animation = 'container-pulse 0.6s infinite alternate';
            
            const style = document.createElement('style');
            style.textContent = `
                @keyframes heart-pulse {
                    from { transform: translate(-50%, -50%) scale(1); opacity: 0.7; }
                    to { transform: translate(-50%, -50%) scale(1.2); opacity: 1; }
                }
                @keyframes container-pulse {
                    from { box-shadow: 0 0 10px rgba(244, 67, 54, 0.3); }
                    to { box-shadow: 0 0 15px rgba(244, 67, 54, 0.7); }
                }
            `;
            document.head.appendChild(style);
        }
    } else {
        heartIcon.style.animation = '';
        heartContainer.style.animation = '';
    }
    
    // Show warning when hunger is low
    if (percentage <= HUNGER_WARNING_THRESHOLD && gameRunning) {
        showHungerWarning();
    }
}

function showHungerWarning() {
    // Make warnings more frequent as hunger decreases
    const warningProbability = (HUNGER_WARNING_THRESHOLD - hungerTimer) / HUNGER_WARNING_THRESHOLD;
    if (Math.random() > warningProbability * 1.5) { // Increased frequency
        return;
    }
    
    const warning = document.createElement('div');
    warning.textContent = 'HUNGRY!';
    warning.style.position = 'absolute';
    warning.style.top = '50%';
    warning.style.left = '50%';
    warning.style.transform = 'translate(-50%, -50%)';
    warning.style.color = '#F44336';
    warning.style.fontSize = '36px'; // Increased from 32px
    warning.style.fontWeight = 'bold';
    warning.style.textShadow = '0 0 15px rgba(244, 67, 54, 0.8)'; // Enhanced glow
    warning.style.opacity = '0.9'; // Increased from 0.8
    warning.style.pointerEvents = 'none';
    warning.style.zIndex = '1000';
    document.body.appendChild(warning);
    
    // Add a subtle screen vignette effect when hungry
    const vignette = document.createElement('div');
    vignette.style.position = 'absolute';
    vignette.style.top = '0';
    vignette.style.left = '0';
    vignette.style.width = '100%';
    vignette.style.height = '100%';
    vignette.style.boxShadow = 'inset 0 0 150px rgba(244, 67, 54, 0.3)';
    vignette.style.pointerEvents = 'none';
    vignette.style.zIndex = '999';
    document.body.appendChild(vignette);
    
    // Animate and remove the warning and vignette
    let opacity = 0.9;
    const fadeInterval = setInterval(() => {
        opacity -= 0.05;
        warning.style.opacity = opacity;
        vignette.style.opacity = opacity;
        if (opacity <= 0) {
            clearInterval(fadeInterval);
            document.body.removeChild(warning);
            document.body.removeChild(vignette);
        }
    }, 50);
    
    // Add screen shake effect for critical hunger
    if (hungerTimer < HUNGER_WARNING_THRESHOLD * 0.5) {
        shakeScreen(3, 300);
    }
}

// Handle keyboard controls
document.addEventListener('keydown', function(e) {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd', 'W', 'A', 'S', 'D', 'm', 'M', 'l', 'L', 'b', 'B'].includes(e.key)) {
        e.preventDefault();
    }
    
    // Toggle minimap with 'M' key
    if (e.key === 'm' || e.key === 'M') {
        toggleMinimap();
        return;
    }
    
    // Toggle mini leaderboard with 'L' key
    if (e.key === 'l' || e.key === 'L') {
        toggleBestScores();
        return;
    }
    
    if (!gameRunning) return;
    
    switch (e.key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
            if (direction !== 'down') nextDirection = 'up';
            break;
        case 'ArrowDown':
        case 's':
        case 'S':
            if (direction !== 'up') nextDirection = 'down';
            break;
        case 'ArrowLeft':
        case 'a':
        case 'A':
            if (direction !== 'right') nextDirection = 'left';
            break;
        case 'ArrowRight':
        case 'd':
        case 'D':
            if (direction !== 'left') nextDirection = 'right';
            break;
    }
});
function drawMagnetOrbits(x, y) {
    const orbitRadius = CELL_SIZE * 1.5;
    const orbitCount = 5; // More orbiting particles
    const time = Date.now() / 400;
    
    for (let i = 0; i < orbitCount; i++) {
        const angle = time + (i * (2 * Math.PI / orbitCount));
        const orbitX = (x * CELL_SIZE + CELL_SIZE / 2) + orbitRadius * Math.cos(angle);
        const orbitY = (y * CELL_SIZE + CELL_SIZE / 2) + orbitRadius * Math.sin(angle);
        
        // Draw larger, more visible orbiting particles
        ctx.fillStyle = POWER_UP_EFFECTS.magnet.visualEffect;
        ctx.beginPath();
        ctx.arc(orbitX, orbitY, 4, 0, Math.PI * 2);
        ctx.fill();
        
        // Add glow effect
        ctx.shadowColor = POWER_UP_EFFECTS.magnet.visualEffect;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(orbitX, orbitY, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        
        // Connect particles to snake head with faint lines
        ctx.strokeStyle = `rgba(255, 235, 59, 0.4)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x * CELL_SIZE + CELL_SIZE/2, y * CELL_SIZE + CELL_SIZE/2);
        ctx.lineTo(orbitX, orbitY);
        ctx.stroke();
    }
}

// Create power-up countdown bar
const powerUpCountdownContainer = document.createElement('div');
powerUpCountdownContainer.id = 'power-up-countdown-container';
powerUpCountdownContainer.style.position = 'absolute';
powerUpCountdownContainer.style.top = '90px';
powerUpCountdownContainer.style.left = '50%';
powerUpCountdownContainer.style.transform = 'translateX(-50%)';
powerUpCountdownContainer.style.width = '200px';
powerUpCountdownContainer.style.height = '15px';
powerUpCountdownContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
powerUpCountdownContainer.style.borderRadius = '10px';
powerUpCountdownContainer.style.overflow = 'hidden';
powerUpCountdownContainer.style.display = 'none';
powerUpCountdownContainer.style.zIndex = '1000';
document.body.appendChild(powerUpCountdownContainer);

// Create a joystick container
const joystickContainer = document.createElement('div');
joystickContainer.id = 'joystick-container';
joystickContainer.style.position = 'absolute';
joystickContainer.style.bottom = '20px';
joystickContainer.style.right = '20px';  // Position 20px from the right
joystickContainer.style.width = '150px';
joystickContainer.style.height = '150px';
joystickContainer.style.zIndex = '1001';
document.body.appendChild(joystickContainer);

const powerUpCountdownBar = document.createElement('div');
powerUpCountdownBar.id = 'power-up-countdown-bar';
powerUpCountdownBar.style.height = '100%';
powerUpCountdownBar.style.width = '100%';
powerUpCountdownBar.style.transition = 'width 0.1s linear';
powerUpCountdownContainer.appendChild(powerUpCountdownBar);

// Map joystick movements to snake direction
joystick.on('dir:up', () => {
    if (direction !== 'down') nextDirection = 'up';
});

joystick.on('dir:down', () => {
    if (direction !== 'up') nextDirection = 'down';
});

joystick.on('dir:left', () => {
    if (direction !== 'right') nextDirection = 'left';
});

joystick.on('dir:right', () => {
    if (direction !== 'left') nextDirection = 'right';
});

// Create mobile menu buttons container
const mobileMenuContainer = document.createElement('div');
mobileMenuContainer.id = 'mobile-menu';
mobileMenuContainer.style.position = 'absolute';
mobileMenuContainer.style.bottom = '180px';
mobileMenuContainer.style.right = '20px';
mobileMenuContainer.style.display = 'none'; // Hidden by default, will show on touch devices
mobileMenuContainer.style.zIndex = '1001';
document.body.appendChild(mobileMenuContainer);

// Create mobile menu buttons
const menuButtons = [
    { id: 'minimap', symbol: 'M', title: 'Toggle Minimap' },
    { id: 'leaderboard', symbol: 'L', title: 'Toggle Leaderboard' },
    { id: 'settings', symbol: '⚙️', title: 'Game Settings' }
];

menuButtons.forEach((btn, index) => {
    const button = document.createElement('div');
    button.id = `mobile-${btn.id}`;
    button.className = 'mobile-menu-button';
    button.innerHTML = btn.symbol;
    button.title = btn.title;
    button.style.width = '60px';
    button.style.height = '60px';
    button.style.backgroundColor = 'rgba(0, 0, 0, 0.6)';
    button.style.color = 'white';
    button.style.borderRadius = '50%';
    button.style.display = 'flex';
    button.style.justifyContent = 'center';
    button.style.alignItems = 'center';
    button.style.fontSize = '28px';
    button.style.fontWeight = 'bold';
    button.style.marginBottom = '10px';
    button.style.cursor = 'pointer';
    button.style.userSelect = 'none';
    button.style.border = '2px solid rgba(255, 255, 255, 0.3)';
    
    // Add touch event listeners
    button.addEventListener('touchstart', (e) => {
        e.preventDefault();
        button.style.backgroundColor = 'rgba(76, 175, 80, 0.7)';
        handleMobileMenuButton(btn.id);
    });
    
    button.addEventListener('touchend', (e) => {
        e.preventDefault();
        button.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    });
    
    mobileMenuContainer.appendChild(button);
});

// Function to handle mobile control input
function handleMobileControl(direction) {
    if (!gameRunning) return;
    
    switch (direction) {
        case 'up':
            if (nextDirection !== 'down') nextDirection = 'up';
            break;
        case 'down':
            if (nextDirection !== 'up') nextDirection = 'down';
            break;
        case 'left':
            if (nextDirection !== 'right') nextDirection = 'left';
            break;
        case 'right':
            if (nextDirection !== 'left') nextDirection = 'right';
            break;
    }
}

// Function to handle mobile menu buttons
function handleMobileMenuButton(buttonId) {
    switch (buttonId) {
        case 'minimap':
            toggleMinimap();
            break;
        case 'leaderboard':
            toggleBestScores();
            break;
        case 'settings':
            openSettingsMenu();
            break;
    }
}

// Detect if device is touch-enabled and show mobile controls
function detectTouchDevice() {
    const isTouchDevice = 'ontouchstart' in window || 
                          navigator.maxTouchPoints > 0 ||
                          navigator.msMaxTouchPoints > 0;
    
    if (isTouchDevice) {
        joystickContainer.style.display = 'block'; // Ensure the joystick is visible
        mobileMenuContainer.style.display = 'flex';
        mobileMenuContainer.style.flexDirection = 'column';
    }
}

// Create settings menu
const settingsMenu = document.createElement('div');
settingsMenu.id = 'settings-menu';
settingsMenu.style.position = 'fixed';
settingsMenu.style.top = '50%';
settingsMenu.style.left = '50%';
settingsMenu.style.transform = 'translate(-50%, -50%)';
settingsMenu.style.backgroundColor = 'rgba(0, 0, 0, 0.85)';
settingsMenu.style.padding = '20px';
settingsMenu.style.borderRadius = '10px';
settingsMenu.style.zIndex = '2000';
settingsMenu.style.color = 'white';
settingsMenu.style.fontFamily = 'Arial, sans-serif';
settingsMenu.style.width = '300px';
settingsMenu.style.boxShadow = '0 0 20px rgba(0, 0, 0, 0.5)';
settingsMenu.style.border = '2px solid #4CAF50';
settingsMenu.style.display = 'none';
document.body.appendChild(settingsMenu);

// Add settings content
settingsMenu.innerHTML = `
    <h2 style="text-align: center; margin-top: 0; color: #4CAF50;">Game Settings</h2>
    <div style="margin: 15px 0;">
        <label for="swipe-sensitivity" style="display: block; margin-bottom: 5px;">
            Swipe Sensitivity: <span id="sensitivity-value">1.0</span>
        </label>
        <input type="range" id="swipe-sensitivity" min="0.5" max="1.5" step="0.1" value="1.0" 
               style="width: 100%; accent-color: #4CAF50;">
        <div style="display: flex; justify-content: space-between; font-size: 12px; margin-top: 5px;">
            <span>Less sensitive</span>
            <span>More sensitive</span>
        </div>
    </div>
    <button id="save-settings" style="display: block; width: 100%; padding: 10px; margin-top: 15px; 
                                     background-color: #4CAF50; color: white; border: none; 
                                     border-radius: 5px; cursor: pointer;">
        Save Settings
    </button>
    <button id="close-settings" style="display: block; width: 100%; padding: 10px; margin-top: 10px; 
                                      background-color: #555; color: white; border: none; 
                                      border-radius: 5px; cursor: pointer;">
        Close
    </button>
`;

// Initialize settings
function initSettings() {
    // Load saved swipe sensitivity
    const savedSensitivity = localStorage.getItem('snake_swipe_sensitivity') || "1.0";
    document.getElementById('swipe-sensitivity').value = savedSensitivity;
    document.getElementById('sensitivity-value').textContent = savedSensitivity;
    
    // Update sensitivity label when slider changes
    document.getElementById('swipe-sensitivity').addEventListener('input', function() {
        document.getElementById('sensitivity-value').textContent = this.value;
    });
    
    // Save settings
    document.getElementById('save-settings').addEventListener('click', function() {
        const sensitivity = document.getElementById('swipe-sensitivity').value;
        localStorage.setItem('snake_swipe_sensitivity', sensitivity);
        
        // Apply changes immediately
        swipeSensitivity = parseFloat(sensitivity);
        
        // Close settings menu
        settingsMenu.style.display = 'none';
        
        // Show confirmation
        const confirmation = document.createElement('div');
        confirmation.textContent = 'Settings saved!';
        confirmation.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background-color: rgba(76, 175, 80, 0.9);
            color: white;
            padding: 10px 20px;
            border-radius: 5px;
            z-index: 2000;
            font-family: Arial, sans-serif;
        `;
        document.body.appendChild(confirmation);
        setTimeout(() => document.body.removeChild(confirmation), 2000);
    });
    
    // Close settings menu
    document.getElementById('close-settings').addEventListener('click', function() {
        settingsMenu.style.display = 'none';
    });
}

// Open settings menu function
function openSettingsMenu() {
    settingsMenu.style.display = 'block';
}

// Add CSS for mobile controls
const mobileControlsStyle = document.createElement('style');
mobileControlsStyle.textContent = `
    @media (max-width: 768px) {
        #game-canvas {
            touch-action: none;
        }
        
        .mobile-control-button:active,
        .mobile-menu-button:active {
            transform: scale(0.95);
            background-color: rgba(76, 175, 80, 0.7) !important;
        }
        
        #mobile-controls {
            opacity: 0.8;
        }
        
        #mobile-menu {
            opacity: 0.8;
        }
        
        .game-container {
            transform: scale(0.9);
            transform-origin: top center;
        }
        
        #leaderboard-container {
            max-width: 90vw;
            max-height: 80vh;
            overflow-y: auto;
        }
        
        #mini-leaderboard {
            max-height: 120px;
            overflow-y: auto;
        }
        
        #power-up-status {
            font-size: 16px;
            padding: 5px 10px;
        }
    }
`;
mobileControlsStyle.textContent += `
    .swipe-indicator {
        transition: transform 0.15s ease-out, width 0.15s ease-out, height 0.15s ease-out, background-color 0.15s ease-out;
    }
    
    .swipe-path {
        transition: opacity 0.3s ease-out, height 0.15s ease-out, background-color 0.15s ease-out;
    }
    
    .swipe-effect {
        animation: swipe-feedback 0.7s forwards;
    }
    
    @keyframes swipe-feedback {
        0% { transform: translate(-50%, -50%) scale(0.5); opacity: 0.8; }
        50% { transform: translate(-50%, -50%) scale(1.5); opacity: 1; }
        100% { transform: translate(-50%, -50%) scale(2); opacity: 0; }
    }
    
    @keyframes swipe-ripple {
        0% { transform: scale(0); opacity: 0.8; }
        100% { transform: scale(1.5); opacity: 0; }
    }
    
    .swipe-up-anim {
        animation: swipe-up 0.6s ease-out forwards;
    }
    
    .swipe-down-anim {
        animation: swipe-down 0.6s ease-out forwards;
    }
    
    .swipe-left-anim {
        animation: swipe-left 0.6s ease-out forwards;
    }
    
    .swipe-right-anim {
        animation: swipe-right 0.6s ease-out forwards;
    }
    
    @keyframes swipe-up {
        0% { transform: translateY(30px) scale(0.5); opacity: 0; }
        50% { transform: translateY(-10px) scale(1.2); opacity: 1; }
        100% { transform: translateY(-50px) scale(0.8); opacity: 0; }
    }
    
    @keyframes swipe-down {
        0% { transform: translateY(-30px) scale(0.5); opacity: 0; }
        50% { transform: translateY(10px) scale(1.2); opacity: 1; }
        100% { transform: translateY(50px) scale(0.8); opacity: 0; }
    }
    
    @keyframes swipe-left {
        0% { transform: translateX(30px) scale(0.5); opacity: 0; }
        50% { transform: translateX(-10px) scale(1.2); opacity: 1; }
        100% { transform: translateX(-50px) scale(0.8); opacity: 0; }
    }
    
    @keyframes swipe-right {
        0% { transform: translateX(-30px) scale(0.5); opacity: 0; }
        50% { transform: translateX(10px) scale(1.2); opacity: 1; }
        100% { transform: translateX(50px) scale(0.8); opacity: 0; }
    }
`;
document.head.appendChild(mobileControlsStyle);

// Call the detection function when the document is loaded
document.addEventListener('DOMContentLoaded', () => {
    detectTouchDevice();
    initSettings();
});

function getPowerUpIcon(type) {
    switch (type) {
        case 'speed_boost': return '⚡';
        case 'invincibility': return '★';
        case 'magnet': return '🧲';
        default: return '✨';
    }
}
// Add a new maze-like structure
