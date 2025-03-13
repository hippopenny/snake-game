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
let joystick = null;
let gameLoop;
let minimapVisible = true;
let bestScoresVisible = true;
let bestScoresData = []; // Will store coordinates of highest scores
const MAX_BEST_SCORES = 10; // Maximum number of best scores to display
let soundEnabled = true; // Sound toggle

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

// Background configuration (simplified for cached approach)
const BACKGROUND_CONFIG = {
    baseColor: '#0f0f1a',
    starColor: '#ffffff',
    nebulaColors: ['#7251b5', '#34346e', '#1a1a4f']
};
let backgroundElements = []; // Keeping for compatibility

// Wall configuration
let WALLS = []; // Changed to let so it can be updated from server
const SAFE_ZONE_RADIUS = 30; // Safe zone radius in cells (reduced from 50 to 30)
const WALL_COLOR = '#444';

// Safe zone for new players
let safeZoneActive = false;
let safeZoneExpiry = 0;
const SAFE_ZONE_DURATION = 7000; // Safe zone protection lasts 7 seconds

const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

// 1. Completely disable shadows on mobile - will be called after ctx is initialized
function applyGraphicsSettings() {
    if (isMobile && ctx) {
        try {
            // Replace ALL shadow operations with this empty function
            const originalShadowBlur = ctx.__proto__.__lookupSetter__('shadowBlur');
            Object.defineProperty(ctx.__proto__, 'shadowBlur', {
                set: function(val) { /* Do nothing - shadows disabled */ },
                get: function() { return 0; }
            });
        } catch (e) {
            console.log("Failed to modify canvas shadows:", e);
        }
    }
}
// Will call this after canvas is initialized


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
        duration: 15000,
        canEatOtherSnakes: true,
        canPhaseWalls: true
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
const MAX_PARTICLES = 15;

// Function to create particles
function createParticles(x, y, color, count, speed, size, lifetime) {
    if (isMobile) {
        // Either skip particles entirely or use minimal count
        if (Math.random() > 0.5) return; // Only create 30% of particles
        count = Math.min(2, count); // Never more than 2 particles
    }

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

// Background text cache system
const bgTextCache = {
    initialized: false,
    canvases: [],
    lastCameraX: 0,
    lastCameraY: 0,
};

// Initialize the text canvases once
function initBackgroundTextCache() {
    if (bgTextCache.initialized) return;
    
    // Define text elements to be rendered
    const textElements = [
        { text: 'Hippo Penny', size: 80, color: '#ffffff', opacity: 0.3, positions: [
            { x: 200 * CELL_SIZE, y: 200 * CELL_SIZE, rotation: Math.PI / 30 },
            { x: 75 * CELL_SIZE, y: 75 * CELL_SIZE, rotation: Math.PI / 20 },
            { x: 325 * CELL_SIZE, y: 325 * CELL_SIZE, rotation: -Math.PI / 25 }
        ]},
        { text: 'Grok', size: 80, color: '#8A2BE2', opacity: 0.35, positions: [
            { x: 50 * CELL_SIZE, y: 50 * CELL_SIZE, rotation: -Math.PI / 40 }
        ]},
        { text: 'Pepsi', size: 90, color: '#0000FF', opacity: 0.35, positions: [
            { x: 100 * CELL_SIZE, y: 300 * CELL_SIZE, rotation: Math.PI / 45 }
        ]},
        { text: 'Suika', size: 85, color: '#50C878', opacity: 0.35, positions: [
            { x: 300 * CELL_SIZE, y: 200 * CELL_SIZE, rotation: -Math.PI / 30 }
        ]},
        { text: 'Wacky Wisher', size: 65, color: '#FF6347', opacity: 0.35, positions: [
            { x: 350 * CELL_SIZE, y: 350 * CELL_SIZE, rotation: Math.PI / 25 }
        ]},
        { text: 'Wacky Warper', size: 70, color: '#FF1493', opacity: 0.35, positions: [
            { x: 200 * CELL_SIZE, y: 75 * CELL_SIZE, rotation: Math.PI / 35 }
        ]},
        { text: 'McDonald', size: 70, color: '#FFD700', opacity: 0.35, positions: [
            { x: 350 * CELL_SIZE, y: 50 * CELL_SIZE, rotation: Math.PI / 35 }
        ]},
        // Add a few more interesting texts
        { text: 'Pixel Party', size: 75, color: '#9C27B0', opacity: 0.35, positions: [
            { x: 150 * CELL_SIZE, y: 250 * CELL_SIZE, rotation: Math.PI / 25 }
        ]},
        { text: 'Cosmic Snake', size: 85, color: '#00BCD4', opacity: 0.35, positions: [
            { x: 250 * CELL_SIZE, y: 150 * CELL_SIZE, rotation: -Math.PI / 20 }
        ]},
        { text: 'ASCII Dreams', size: 68, color: '#FF9800', opacity: 0.35, positions: [
            { x: 370 * CELL_SIZE, y: 230 * CELL_SIZE, rotation: Math.PI / 22 }
        ]}
    ];
    
    // Create a canvas for each text position
    textElements.forEach(element => {
        element.positions.forEach(position => {
            // Create canvas sized to contain the text
            const tempCanvas = document.createElement('canvas');
            const tempCtx = tempCanvas.getContext('2d');
            
            // Set canvas size based on text size (with padding)
            const padding = element.size * 2;
            tempCanvas.width = element.size * element.text.length + padding;
            tempCanvas.height = element.size * 2 + padding;
            
            // Clear canvas with transparent background
            tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
            
            // Set text properties
            tempCtx.save();
            tempCtx.translate(tempCanvas.width / 2, tempCanvas.height / 2);
            tempCtx.rotate(position.rotation);
            tempCtx.globalAlpha = element.opacity;
            tempCtx.fillStyle = element.color;
            tempCtx.font = `${element.size < 65 ? 'italic' : ''} bold ${element.size}px Arial`;
            tempCtx.textAlign = 'center';
            tempCtx.textBaseline = 'middle';
            
            // Draw text stroke for better visibility
            tempCtx.strokeStyle = 'rgba(0,0,0,0.5)';
            tempCtx.lineWidth = 3;
            tempCtx.strokeText(element.text, 0, 0);
            
            // Draw text to the canvas
            tempCtx.fillText(element.text, 0, 0);
            
            // Add an outer glow for better visibility
            tempCtx.strokeStyle = element.color;
            tempCtx.lineWidth = 1;
            tempCtx.globalAlpha = element.opacity * 0.5;
            tempCtx.strokeText(element.text, 0, 0);
            
            tempCtx.restore();
            
            // Store the pre-rendered text
            bgTextCache.canvases.push({
                canvas: tempCanvas,
                x: position.x - tempCanvas.width / 2,
                y: position.y - tempCanvas.height / 2,
                width: tempCanvas.width,
                height: tempCanvas.height
            });
        });
    });
    
    bgTextCache.initialized = true;
}

// Function to draw background text efficiently
function drawBackgroundText() {
    // Initialize cache if needed
    if (!bgTextCache.initialized) {
        initBackgroundTextCache();
    }
    
    // Draw text canvases that are visible on screen, every frame
    ctx.save();
    
    // Apply camera transformation to place texts at fixed world positions
    ctx.translate(-Math.floor(camera.x), -Math.floor(camera.y));
    
    bgTextCache.canvases.forEach(item => {
        // Check if this text would be visible in the viewport
        if (item.x + item.width < camera.x || item.x > camera.x + VIEWPORT_WIDTH ||
            item.y + item.height < camera.y || item.y > camera.y + VIEWPORT_HEIGHT) {
            return; // Skip drawing this text if not visible
        }
        
        // Make text visible by drawing with higher opacity
        ctx.globalAlpha = 0.3; // Increase opacity so text is more visible
        
        // Draw the pre-rendered text canvas
        ctx.drawImage(item.canvas, item.x, item.y);
    });
    
    ctx.restore();
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
nextLevelText.style.fontWeight = 'bold'; // Replaced text shadow with bold for better performance
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
            
            // Rebuild wall index when walls are updated
            if (wallIndex.initialized) {
                wallIndex.rebuild(WALLS);
            }
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
    
    // Save current game state for reconnection
    const savedSnake = [...snake];
    const savedScore = score;
    const savedLevel = level;
    
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS && gameRunning) {
        console.log(`Attempting to reconnect (${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})...`);
        
        // Add connection lost indicator with animated dots
        const connectionLostIndicator = document.createElement('div');
        connectionLostIndicator.id = 'connection-lost';
        connectionLostIndicator.style.position = 'fixed';
        connectionLostIndicator.style.top = '50%';
        connectionLostIndicator.style.left = '50%';
        connectionLostIndicator.style.transform = 'translate(-50%, -50%)';
        connectionLostIndicator.style.backgroundColor = 'rgba(244, 67, 54, 0.9)';
        connectionLostIndicator.style.color = 'white';
        connectionLostIndicator.style.padding = '20px 30px';
        connectionLostIndicator.style.borderRadius = '10px';
        connectionLostIndicator.style.fontWeight = 'bold';
        connectionLostIndicator.style.fontSize = '24px';
        connectionLostIndicator.style.zIndex = '2000';
        connectionLostIndicator.style.boxShadow = '0 0 20px rgba(0, 0, 0, 0.7)';
        connectionLostIndicator.style.border = '2px solid white';
        
        // Create a container for the message and dots
        const messageContainer = document.createElement('div');
        messageContainer.style.display = 'flex';
        messageContainer.style.alignItems = 'center';
        messageContainer.style.justifyContent = 'center';
        
        // Add the message text
        const messageText = document.createElement('div');
        messageText.textContent = 'CONNECTION LOST. Attempting to reconnect';
        messageContainer.appendChild(messageText);
        
        // Add animated dots
        const dotsContainer = document.createElement('div');
        dotsContainer.style.marginLeft = '5px';
        dotsContainer.style.width = '30px';
        dotsContainer.style.textAlign = 'left';
        messageContainer.appendChild(dotsContainer);
        
        connectionLostIndicator.appendChild(messageContainer);
        document.body.appendChild(connectionLostIndicator);
        
        // Animate dots
        let dotCount = 0;
        const dotAnimation = setInterval(() => {
            dotsContainer.textContent = '.'.repeat(dotCount % 4);
            dotCount++;
        }, 500);
        
        // Add visual reconnection indicator with attempt counter
        const reconnectingMessage = document.createElement('div');
        reconnectingMessage.id = 'reconnecting-message';
        reconnectingMessage.style.position = 'fixed';
        reconnectingMessage.style.bottom = '20%';
        reconnectingMessage.style.left = '50%';
        reconnectingMessage.style.transform = 'translateX(-50%)';
        reconnectingMessage.style.background = 'rgba(0, 0, 0, 0.8)';
        reconnectingMessage.style.color = '#4CAF50';
        reconnectingMessage.style.padding = '10px 20px';
        reconnectingMessage.style.borderRadius = '10px';
        reconnectingMessage.style.zIndex = '2000';
        reconnectingMessage.style.fontWeight = 'bold';
        reconnectingMessage.style.fontSize = '16px';
        reconnectingMessage.style.boxShadow = '0 0 20px rgba(76, 175, 80, 0.5)';
        reconnectingMessage.style.opacity = '0';
        reconnectingMessage.style.transition = 'opacity 0.5s';
        reconnectingMessage.textContent = `Reconnecting (${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`;
        document.body.appendChild(reconnectingMessage);
        
        // Fade in the reconnecting message
        setTimeout(() => {
            reconnectingMessage.style.opacity = '1';
        }, 100);
        
        setTimeout(() => {
            reconnectAttempts++;
            // Create a new WebSocket connection
            const newSocket = new WebSocket('ws://127.0.0.1:8080');
            
            // Re-attach event handlers
            newSocket.onopen = () => {
                console.log("WebSocket reconnected. Player ID:", playerId);
                
                // Clear the dot animation interval
                clearInterval(dotAnimation);
                
                // Remove reconnection message if it exists
                const reconnectMessage = document.getElementById('reconnecting-message');
                if (reconnectMessage) {
                    reconnectMessage.style.opacity = '0';
                    setTimeout(() => {
                        if (document.body.contains(reconnectMessage)) {
                            document.body.removeChild(reconnectMessage);
                        }
                    }, 500);
                }
                
                // Remove connection lost indicator if it exists
                const connectionLostElement = document.getElementById('connection-lost');
                if (connectionLostElement) {
                    connectionLostElement.style.opacity = '0';
                    connectionLostElement.style.transition = 'opacity 0.5s';
                    setTimeout(() => {
                        if (document.body.contains(connectionLostElement)) {
                            document.body.removeChild(connectionLostElement);
                        }
                    }, 500);
                }
                
                // Restore player state immediately after reconnection
                if (gameRunning && savedSnake && savedSnake.length > 0) {
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
                
                // Show a success message
                const reconnectedMessage = document.createElement('div');
                reconnectedMessage.style.position = 'fixed';
                reconnectedMessage.style.top = '10%';
                reconnectedMessage.style.left = '50%';
                reconnectedMessage.style.transform = 'translateX(-50%)';
                reconnectedMessage.style.background = 'rgba(76, 175, 80, 0.9)';
                reconnectedMessage.style.color = 'white';
                reconnectedMessage.style.padding = '10px 20px';
                reconnectedMessage.style.borderRadius = '5px';
                reconnectedMessage.style.zIndex = '2000';
                reconnectedMessage.style.fontWeight = 'bold';
                reconnectedMessage.textContent = 'Reconnected!';
                reconnectedMessage.style.opacity = '0';
                reconnectedMessage.style.transition = 'opacity 0.5s';
                document.body.appendChild(reconnectedMessage);
                
                setTimeout(() => {
                    reconnectedMessage.style.opacity = '1';
                    setTimeout(() => {
                        reconnectedMessage.style.opacity = '0';
                        setTimeout(() => {
                            if (document.body.contains(reconnectedMessage)) {
                                document.body.removeChild(reconnectedMessage);
                            }
                        }, 500);
                    }, 2000);
                }, 100);
            };
            
            newSocket.onmessage = socket.onmessage;
            newSocket.onerror = socket.onerror;
            newSocket.onclose = socket.onclose;
            
            // Properly assign the new socket
            socket = newSocket;
        }, RECONNECT_DELAY);
    } else if (gameRunning) {
        // End the game if we've exceeded reconnect attempts
        gameOver('disconnect');
        
        // Remove any existing reconnection message
        const reconnectMessage = document.getElementById('reconnecting-message');
        if (reconnectMessage) {
            document.body.removeChild(reconnectMessage);
        }
        
        // Show a more user-friendly message
        const disconnectMessage = document.createElement('div');
        disconnectMessage.style.position = 'fixed';
        disconnectMessage.style.top = '30%';
        disconnectMessage.style.left = '50%';
        disconnectMessage.style.transform = 'translateX(-50%)';
        disconnectMessage.style.background = 'rgba(33, 33, 33, 0.9)';
        disconnectMessage.style.color = 'white';
        disconnectMessage.style.padding = '20px';
        disconnectMessage.style.borderRadius = '10px';
        disconnectMessage.style.zIndex = '2500';
        disconnectMessage.style.textAlign = 'center';
        disconnectMessage.style.maxWidth = '80%';
        
        disconnectMessage.innerHTML = `
            <h3 style="margin-top: 0; color: #FF5722;">Connection Lost</h3>
            <p>Unable to reconnect to the server after multiple attempts.</p>
            <button style="background-color: #4CAF50; color: white; border: none; padding: 10px 15px; 
                     border-radius: 5px; cursor: pointer; margin-top: 10px;">
                Refresh Page
            </button>
        `;
        document.body.appendChild(disconnectMessage);
        
        // Add click handler for the refresh button
        disconnectMessage.querySelector('button').addEventListener('click', () => {
            window.location.reload();
        });
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

// Now that ctx is initialized, apply graphics settings
applyGraphicsSettings();

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
    
    // Initialize sound system
    if (!soundManager.initialized) {
        console.log("Initializing sound manager");
        soundManager.init();
    }
    
    // Initialize wall cache and spatial index
    wallCache.init();
    wallIndex.init();
    if (WALLS.length > 0) {
        wallIndex.rebuild(WALLS);
    }
    
    // All sounds are already preloaded during sound manager initialization
    
    // Play background music
    console.log("Playing background music");
    soundManager.playBackgroundMusic();
    
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
    if (!gameRunning) {
        // If game is not running but we have death effects, render them
        if (deathEffects.overlay || deathEffects.icon || deathEffects.particles.length > 0) {
            drawDeathEffects();
            animationFrameId = requestAnimationFrame(renderFrame);
            return;
        }
        return;
    }
    
    // Store animation frame ID so it can be properly cancelled if needed
    animationFrameId = requestAnimationFrame(renderFrame);
    
    // Calculate delta time since last frame
    const deltaTime = timestamp - lastFrameTime;
    lastFrameTime = timestamp;
    
    // Accumulate time but cap maximum delta to prevent extreme jumps
    // This prevents the snake from disappearing when tab is inactive
    const maxDelta = 50; // Maximum milliseconds to process in a single frame
    frameAccumulator = (frameAccumulator + Math.min(deltaTime, maxDelta));
    
    // Calculate base interpolation factor between 0 and 1
    // This should be a percentage of how far we are between moves
    interpolationAlpha = Math.min(1, frameAccumulator / gameSpeed);
    
    // Draw with interpolation factor
    draw(interpolationAlpha);
}

// Function to draw death effects without creating DOM elements
function drawDeathEffects() {
    const now = Date.now();
    
    // Clear the canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw overlay
    if (deathEffects.overlay) {
        const elapsed = now - deathEffects.overlay.startTime;
        const progress = Math.min(1, elapsed / deathEffects.overlay.duration);
        
        if (progress >= 1) {
            deathEffects.overlay = null;
        } else {
            // Draw radial gradient
            const gradient = ctx.createRadialGradient(
                canvas.width / 2, canvas.height / 2, canvas.width * 0.1,
                canvas.width / 2, canvas.height / 2, canvas.width
            );
            
            gradient.addColorStop(0, 'transparent');
            gradient.addColorStop(0.3, 'transparent');
            gradient.addColorStop(1, deathEffects.overlay.color);
            
            ctx.globalAlpha = progress;
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.globalAlpha = 1;
        }
    }
    
    // Draw icon
    if (deathEffects.icon) {
        const elapsed = now - deathEffects.icon.startTime;
        const progress = Math.min(1, elapsed / deathEffects.icon.duration);
        
        if (progress >= 1) {
            deathEffects.icon = null;
        } else {
            // Calculate scale with easing
            const easeOutBack = (x) => {
                const c1 = 1.70158;
                const c3 = c1 + 1;
                return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
            };
            
            const scale = progress < 0.6 ? 
                          easeOutBack(progress / 0.6) * deathEffects.icon.targetScale : 
                          deathEffects.icon.targetScale;
            
            ctx.font = `${100 * scale}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(deathEffects.icon.text, canvas.width / 2, canvas.height / 2);
        }
    }
    
    // Draw particles
    for (let i = deathEffects.particles.length - 1; i >= 0; i--) {
        const p = deathEffects.particles[i];
        const elapsed = now - p.startTime;
        
        if (elapsed >= p.life) {
            deathEffects.particles.splice(i, 1);
            continue;
        }
        
        const progress = elapsed / p.life;
        const opacity = 1 - progress;
        const size = p.size * (1 - progress * 0.7);
        
        // Update position
        p.x += p.vx;
        p.y += p.vy;
        
        // Draw
        ctx.globalAlpha = opacity;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
        ctx.fill();
    }
    
    ctx.globalAlpha = 1;
}

// Arrays to store canvas-based effects
const powerUpAnimations = [];
const shockwaves = [];

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
                // When drawing dead snakes, add visual decay effect
                if (players[id].dead) {
                    // Create particles for dead snake
                    if (Math.random() < 0.3 && otherSnake.length > 0) {
                        const randomSegment = otherSnake[Math.floor(Math.random() * otherSnake.length)];
                        createParticles(
                            randomSegment.x,
                            randomSegment.y,
                            'rgba(100, 100, 100, 0.8)',
                            3,
                            1.5,
                            4,
                            500
                        );
                    }
                }
                
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
    
    // Draw canvas-based score animations
    drawScoreAnimations();
    
    // Draw canvas-based power-up animations
    drawPowerUpAnimations();
    
    // Draw canvas-based shockwave effects
    drawShockwaves();
    
    // Restore canvas state
    ctx.restore();
    
    // Draw canvas-based warnings (in screen space, not world space)
    drawCanvasWarnings();
    
    // Draw vignette effect if active
    drawVignetteEffect();
    
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

// Function to draw canvas-based score animations
function drawScoreAnimations() {
    const now = Date.now();
    
    // Filter and draw score animations
    for (let i = scoreAnimations.length - 1; i >= 0; i--) {
        const anim = scoreAnimations[i];
        const elapsed = now - anim.startTime;
        const progress = Math.min(1, elapsed / anim.duration);
        
        if (progress >= 1) {
            scoreAnimations.splice(i, 1);
            continue;
        }
        
        const yOffset = -20 * Math.sin(progress * Math.PI);
        const scale = 1 + 0.5 * Math.sin(progress * Math.PI / 2);
        const opacity = 1 - progress;
        
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.font = `bold ${20 * scale}px Arial`;
        ctx.fillStyle = anim.color;
        ctx.textAlign = 'center';
        ctx.fillText(`+${anim.points}`, anim.x + CELL_SIZE/2, anim.y + yOffset);
        ctx.restore();
    }
}

// Function to draw canvas-based power-up animations
function drawPowerUpAnimations() {
    const now = Date.now();
    
    for (let i = powerUpAnimations.length - 1; i >= 0; i--) {
        const anim = powerUpAnimations[i];
        const elapsed = now - anim.startTime;
        const progress = Math.min(1, elapsed / anim.duration);
        
        if (progress >= 1) {
            powerUpAnimations.splice(i, 1);
            continue;
        }
        
        const yOffset = -40 * progress;
        const scale = 1 + Math.sin(progress * Math.PI) * 0.5;
        const opacity = 1 - progress;
        
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.font = `bold ${18 * scale}px Arial`;
        ctx.fillStyle = anim.color;
        ctx.textAlign = 'center';
        ctx.fillText(anim.text, anim.x + CELL_SIZE/2, anim.y + yOffset);
        ctx.restore();
    }
}

// Function to draw canvas-based shockwave effects
function drawShockwaves() {
    const now = Date.now();
    
    for (let i = shockwaves.length - 1; i >= 0; i--) {
        const wave = shockwaves[i];
        const elapsed = now - wave.startTime;
        const progress = Math.min(1, elapsed / wave.duration);
        
        if (progress >= 1) {
            shockwaves.splice(i, 1);
            continue;
        }
        
        const size = wave.maxSize * progress;
        const opacity = 1 - progress;
        
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.strokeStyle = wave.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(wave.x, wave.y, size/2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }
}

// Function to draw canvas-based hunger warnings
function drawCanvasWarnings() {
    const now = Date.now();
    ctx.save();
    
    for (let i = canvasWarnings.length - 1; i >= 0; i--) {
        const warning = canvasWarnings[i];
        const elapsed = now - warning.startTime;
        const progress = Math.min(1, elapsed / warning.duration);
        
        if (progress >= 1) {
            canvasWarnings.splice(i, 1);
            continue;
        }
        
        const opacity = 0.9 - progress * 0.9;
        const scale = 1 + 0.2 * Math.sin(progress * Math.PI);
        
        ctx.globalAlpha = opacity;
        ctx.font = `bold ${36 * scale}px Arial`;
        ctx.fillStyle = warning.color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(warning.text, canvas.width/2, canvas.height/2);
    }
    
    ctx.restore();
}

// Function to draw vignette effect on canvas
function drawVignetteEffect() {
    if (!currentVignette) return;
    
    const now = Date.now();
    const elapsed = now - currentVignette.startTime;
    const progress = Math.min(1, elapsed / currentVignette.duration);
    
    if (progress >= 1) {
        currentVignette = null;
        return;
    }
    
    const opacity = 0.5 - progress * 0.5;
    
    ctx.save();
    
    // Create radial gradient for vignette
    const gradient = ctx.createRadialGradient(
        canvas.width/2, canvas.height/2, 0,
        canvas.width/2, canvas.height/2, canvas.width/2
    );
    
    gradient.addColorStop(0, 'transparent');
    gradient.addColorStop(0.7, `rgba(244, 67, 54, ${opacity * 0.1})`);
    gradient.addColorStop(1, `rgba(244, 67, 54, ${opacity})`);
    
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
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
        // Draw highlight without shadow for better performance
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
        
        // Add a second layer for glow-like effect without shadows
        const glowColor = food.color.replace('rgb', 'rgba').replace(')', ', 0.5)');
        ctx.strokeStyle = glowColor;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(
            food.x * CELL_SIZE + CELL_SIZE / 2,
            food.y * CELL_SIZE + CELL_SIZE / 2,
            size * 1.4,
            0,
            Math.PI * 2
        );
        ctx.stroke();
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
    
    // Find if this snake belongs to a dead player and get its final position
    let isDead = false;
    let finalPosition = null;
    if (!isCurrentPlayer) {
        // Check if this snake belongs to a player marked as dead
        for (const id in players) {
            if (players[id].snake === snakeBody && players[id].dead) {
                isDead = true;
                // Get final position if available
                if (players[id].finalPosition) {
                    finalPosition = players[id].finalPosition;
                }
                break;
            }
        }
    }
    
    // Add visual indicator when player is invincible and can eat other snakes
    let isInvincible = false;
    if (isCurrentPlayer && activePowerUp && activePowerUp.type === 'invincibility') {
        isInvincible = true;
    } else if (!isCurrentPlayer) {
        // Check if other player has invincibility
        for (const id in players) {
            if (players[id].snake === snakeBody && 
                players[id].activePowerUp && 
                players[id].activePowerUp.type === 'invincibility') {
                isInvincible = true;
                break;
            }
        }
    }
    
    // Apply interpolation for smoother movement
    let positionsToRender = snakeBody;
    
    // For dead snakes with final position, use that instead
    if (isDead && finalPosition) {
        positionsToRender = finalPosition;
    } else {
        // Find if this snake has speed boost active
        const hasSpeedBoost = isCurrentPlayer ? 
            (activePowerUp && activePowerUp.type === 'speed_boost') : 
            getPlayerPowerUp(snakeBody) === 'speed_boost';
        
        // Ensure previous positions exist before trying to interpolate
        if (prevSnakePositions && prevSnakePositions.length > 0 && isCurrentPlayer) {
            // Use cubic easing for smoother animation
            let eased = easeInOutCubic(interpolationAlpha);
            
            // Make interpolation faster for speed boosted snake
            if (hasSpeedBoost) {
                eased = Math.min(1, eased * 1.5); // Speed up interpolation for boosted snake
            }
            
            // Create completely interpolated snake for smoother rendering
            positionsToRender = snakeBody.map((segment, i) => {
                if (i >= prevSnakePositions.length) return segment;
                
                return {
                    x: prevSnakePositions[i].x + (segment.x - prevSnakePositions[i].x) * eased,
                    y: prevSnakePositions[i].y + (segment.y - prevSnakePositions[i].y) * eased,
                    moveDirection: segment.moveDirection,
                    moveTime: segment.moveTime,
                    speedBoosted: segment.speedBoosted
                };
            });
        }
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
                // Add a special effect to show snake can eat others
                if (isCurrentPlayer) {
                    // Enhance the head to indicate it can eat other snakes
                    headColor = '#F44336'; // Bright red for more aggressive look
                }
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
        
        // If snake is dead, make it fade with translucent gray
        if (isDead) {
            ctx.fillStyle = index === 0 ? 'rgba(150, 150, 150, 0.6)' : 'rgba(100, 100, 100, 0.5)';
            ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
            ctx.shadowBlur = 5;
        } else {
            // Normal coloring for live snakes
            ctx.fillStyle = index === 0 ? headColor : bodyColor;
        }
        
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
    let displaySpeed = (baseGameSpeed / gameSpeed).toFixed(1);
    
    // If speed boost is active, show the boosted speed
    if (activePowerUp && activePowerUp.type === 'speed_boost') {
        displaySpeed = (baseGameSpeed / gameSpeed * POWER_UP_EFFECTS.speed_boost.speedMultiplier).toFixed(1);
    }
    
    speedDisplay.textContent = `Speed: ${displaySpeed}x`;
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
        
        // Play level-up sound (don't interrupt background music)
        soundManager.play('levelUp', { volume: 0.7 });
        
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

// Function to check for food collision and handle food consumption 
function checkAndEatFood() {
    // Check for food collisions
    for (let i = 0; i < foods.length; i++) {
        const food = foods[i];
        if (snake[0].x === food.x && snake[0].y === food.y) {
            // Food was eaten
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
            
            return true; // Food was eaten
        }
    }
    return false; // No food eaten
}

function gameStep() {
    direction = nextDirection;
    
    // Calculate hunger rate based on game speed and level
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
    
    // Check if any power-up has expired
    checkPowerUpExpiration();
    
    // Update power-up status display
    updatePowerUpStatus();
    
    // Apply magnet effect if active
    if (activePowerUp && activePowerUp.type === 'magnet') {
        applyMagnetEffect();
    }
    
    // Always move the snake in game step
    moveSnake();
    
    // Check for collisions immediately after first move
    const firstMoveCollision = checkCollisions();
    if (firstMoveCollision.collision) {
        console.log("Collision detected after first move! Reason:", firstMoveCollision.reason);
        gameOver(firstMoveCollision.reason);
        return;
    }
    
    // Check for food after first move
    let foodEatenFirstMove = checkAndEatFood();
    
    // If speed boost is active, make second movement
    if (activePowerUp && activePowerUp.type === 'speed_boost') {
        // Remove tail for the second movement unless food was eaten
        if (!foodEatenFirstMove) {
            snake.pop();
        }
        
        // Make second movement 
        moveSnake();
        
        // Check for collisions after second move
        const secondMoveCollision = checkCollisions();
        if (secondMoveCollision.collision) {
            console.log("Collision detected after second move! Reason:", secondMoveCollision.reason);
            gameOver(secondMoveCollision.reason);
            return;
        }
        
        // Check for food after second move
        let foodEatenSecondMove = checkAndEatFood();
        
        // Remove tail if no food was eaten in second move
        if (!foodEatenFirstMove && !foodEatenSecondMove) {
            snake.pop();
        }
    } else {
        // For normal speed, remove tail if no food was eaten
        if (!foodEatenFirstMove) {
            snake.pop();
        }
    }
    
    // Update heat map with current snake position
    updateHeatMap();
    
    sendPlayerState();
    
    // Initialize mobile controls if needed
    detectTouchDevice();
}

// Canvas-based score animations
const scoreAnimations = [];

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
    
    // Play eating sound
    if (food.powerUp) {
        soundManager.play('powerUp');
    } else {
        soundManager.play('eat');
    }
    
    // Add to canvas score animations instead of creating DOM elements
    scoreAnimations.push({
        x: food.x * CELL_SIZE,
        y: food.y * CELL_SIZE,
        points: food.points,
        color: food.color,
        startTime: Date.now(),
        duration: 1000
    });

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
    
    if (food.powerUp) {
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
        
        // Add canvas-based power-up text animation
        powerUpAnimations.push({
            text: powerUpName,
            x: food.x * CELL_SIZE,
            y: (food.y * CELL_SIZE) - 20,
            color: powerUpColor,
            startTime: Date.now(),
            duration: 1500
        });
        
        // Add canvas-based shockwave effect
        shockwaves.push({
            x: food.x * CELL_SIZE + CELL_SIZE/2,
            y: food.y * CELL_SIZE + CELL_SIZE/2,
            color: powerUpColor,
            startTime: Date.now(),
            maxSize: 100,
            duration: 800
        });
        
        // Enhanced particle explosion for power-up activation
        createParticles(
            food.x,
            food.y,
            powerUpColor,
            15,
            3,
            5,
            1200
        );
        
        // Add screen shake for power-up activation
        shakeScreen(10, 500);
    }
}

// Update heat map with current positions of all snakes
// Counter to reduce heat map update frequency
let heatMapUpdateCounter = 0;
const HEAT_MAP_UPDATE_INTERVAL = 10; // Update every 10 frames for better performance

// Update heat map with current positions of all snakes
function updateHeatMap() {
    // Only update every few frames for better performance
    if (heatMapUpdateCounter < HEAT_MAP_UPDATE_INTERVAL) {
        heatMapUpdateCounter++;
        return;
    }
    
    heatMapUpdateCounter = 0;
    
    // Decay all heat values
    for (let x = 0; x < GRID_SIZE; x += 4) {   // Skip every 4 cells for better performance
        for (let y = 0; y < GRID_SIZE; y += 4) {
            if (heatMap[x][y] > 0) {
                heatMap[x][y] *= HEAT_DECAY;
                if (heatMap[x][y] < 0.1) heatMap[x][y] = 0;
            }
        }
    }
    
    // Add heat for current player's snake
    snake.forEach((segment, index) => {
        if (index % 3 === 0) {  // Process every third segment for performance
            const heatValue = index === 0 ? HEAT_MAX : HEAT_MAX * 0.7;
            if (segment.x >= 0 && segment.x < GRID_SIZE && segment.y >= 0 && segment.y < GRID_SIZE) {
                heatMap[segment.x][segment.y] = heatValue;
            }
        }
    });
    
    // Add heat for other players' snakes
    for (const id in players) {
        if (id !== playerId && players[id].snake) {
            players[id].snake.forEach((segment, index) => {
                if (index % 3 === 0) {  // Process every third segment for performance
                    const heatValue = index === 0 ? HEAT_MAX * 0.8 : HEAT_MAX * 0.5;
                    if (segment.x >= 0 && segment.x < GRID_SIZE && segment.y >= 0 && segment.y < GRID_SIZE) {
                        heatMap[segment.x][segment.y] = Math.max(heatMap[segment.x][segment.y], heatValue);
                    }
                }
            });
        }
    }
}

function moveSnake() {
    // Store previous positions for interpolation
    prevSnakePositions = JSON.parse(JSON.stringify(snake));
    
    const head = {x: snake[0].x, y: snake[0].y};
    
    // Standard movement increment of 1 cell
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
    
    // Handle wraparound at edges (teleportation)
    if (head.x < 0) {
        head.x = GRID_SIZE - 1;
        soundManager.play('teleport');
    } else if (head.x >= GRID_SIZE) {
        head.x = 0;
        soundManager.play('teleport');
    }
    
    if (head.y < 0) {
        head.y = GRID_SIZE - 1;
        soundManager.play('teleport');
    } else if (head.y >= GRID_SIZE) {
        head.y = 0;
        soundManager.play('teleport');
    }
    
    // Store the direction used for this move for improved interpolation
    head.moveDirection = direction;
    
    // Store a timestamp for more accurate time-based interpolation
    head.moveTime = Date.now();
    head.speedBoosted = activePowerUp && activePowerUp.type === 'speed_boost';
    
    // Check if this is a valid move for speed boosted snake
    // Speed boosted snakes still can't go through walls (unless invincible)
    if ((activePowerUp && activePowerUp.type === 'speed_boost') && 
        !(activePowerUp && activePowerUp.type === 'invincibility')) {
        // Check collision with walls using spatial index
        if (wallIndex.initialized && wallIndex.hasWall(head.x, head.y)) {
            // Return to previous position if we'd hit a wall
            head.x = snake[0].x;
            head.y = snake[0].y;
        }
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
    
    // Ensure head has valid coordinates
    if (head.x === undefined || head.y === undefined) {
        console.error("Snake head has invalid coordinates");
        return false;
    }
    
    // Check wall collisions
    if (head.x < 0 || head.x >= GRID_SIZE || head.y < 0 || head.y >= GRID_SIZE) {
        // Map edge collision - invincibility can't bypass this
        return {collision: true, reason: 'collision', message: 'You hit the edge of the map!'};
    }
    
    // Check wall object collisions - invincibility can bypass this
    if (!(activePowerUp && activePowerUp.type === 'invincibility')) {
        // Initialize wall index if needed
        if (!wallIndex.initialized) {
            wallIndex.init();
            wallIndex.rebuild(WALLS);
        }
        
        if (wallIndex.hasWall(head.x, head.y)) {
            return {collision: true, reason: 'collision', message: 'You crashed into a wall!'};
        }
    }
    
    // Check self-collision (skip this check if invincibility power-up is active)
    if (!(activePowerUp && activePowerUp.type === 'invincibility')) {
        for (let i = 1; i < snake.length; i++) {
            if (head.x === snake[i].x && head.y === snake[i].y) {
                return {collision: true, reason: 'collision', message: 'You crashed into yourself!'};
            }
        }
    }
    
    // If safe zone is active, we don't die from other snake collisions ONLY in the safe zone area
    if (safeZoneActive && Date.now() < safeZoneExpiry) {
        // Get positions for checking if we're in the actual safe zone area
        const centerX = Math.floor(GRID_SIZE / 2);
        const centerY = Math.floor(GRID_SIZE / 2);
        
        // Calculate distance from center to determine if player is in physical safe zone
        const dx = head.x - centerX;
        const dy = head.y - centerY;
        const distanceFromCenter = Math.sqrt(dx * dx + dy * dy);
        
        // Only provide protection if physically inside the safe zone radius
        if (distanceFromCenter <= SAFE_ZONE_RADIUS) {
            return {collision: false};
        }
        // Otherwise, continue with regular collision detection
    }
    
    // If invincibility power-up is active, we don't die from other snake collisions
    // Instead, we can eat other snakes
    if (activePowerUp && activePowerUp.type === 'invincibility') {
        // Check if we can eat other snakes
        const snakeEaten = checkEatOtherSnake();
        if (snakeEaten) {
            // We've eaten another snake, no collision
            return {collision: false};
        }
        return {collision: false};
    }
    
    // Check for other players with invincibility trying to eat us
    for (const id in players) {
        if (id !== playerId && players[id].snake && players[id].snake.length > 0) {
            const otherHead = players[id].snake[0];
            const otherHasInvincibility = players[id].activePowerUp && 
                                         players[id].activePowerUp.type === 'invincibility';
            
            // If they have invincibility and they hit our head, we get eaten
            if (otherHasInvincibility && otherHead.x === head.x && otherHead.y === head.y) {
                return {collision: true, reason: 'eaten', message: 'You were eaten by an invincible snake!'};
            }
        }
    }
    
    // Check collision with other players
    for (const id in players) {
        if (id !== playerId) {
            const otherSnake = players[id].snake;
            if (otherSnake) {
                for (let i = 0; i < otherSnake.length; i++) {
                    if (head.x === otherSnake[i].x && head.y === otherSnake[i].y) {
                        // Different message depending on if it's a head-on collision or not
                        if (i === 0) {
                            return {collision: true, reason: 'collision', message: 'Head-on collision with another snake!'};
                        } else {
                            return {collision: true, reason: 'collision', message: 'You crashed into another snake!'};
                        }
                    }
                }
            }
        }
    }
    
    return {collision: false};
}

// Power-up countdown bar is now defined earlier in the file

function cleanupGame() {
    // Remove temporary UI elements safely
    const tempElements = document.querySelectorAll('.temp-game-element');
    tempElements.forEach(el => {
        if (document.body.contains(el)) {
            document.body.removeChild(el);
        }
    });
    
    // Clear any running animations or intervals
    if (gameLoop) {
        clearInterval(gameLoop);
        gameLoop = null;
    }
    
    // Cancel any animation frame to stop rendering
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    
    // Clear particles
    particles.length = 0;
    
    // Reset power-up related elements
    powerUpIndicator.style.display = 'none';
    powerUpStatus.style.display = 'none';
    powerUpCountdownContainer.style.display = 'none';
    
    // Stop all sounds
    soundManager.stopAll();
    
    // Clean up joystick if it exists
    if (joystick) {
        joystick.destroy();
        joystick = null;
        joystickContainer.style.display = 'none';
    }
    
    // Remove any hunger warning elements that might be lingering
    const hungerWarnings = document.querySelectorAll('div[textContent="HUNGRY!"]');
    hungerWarnings.forEach(el => {
        if (document.body.contains(el)) {
            document.body.removeChild(el);
        }
    });
    
    // Remove vignette effects that might be lingering
    const vignettes = document.querySelectorAll('div[style*="box-shadow: inset 0 0 150px rgba(244, 67, 54"]');
    vignettes.forEach(el => {
        if (document.body.contains(el)) {
            document.body.removeChild(el);
        }
    });
    
    // Clear any pending timeouts
    const highestId = setTimeout(() => {}, 0);
    for (let i = highestId; i >= highestId - 100; i--) {
        clearTimeout(i);
    }
    
    gameRunning = false;
}

function gameOver(reason = 'collision') {
    // Prevent multiple gameOver calls
    if (!gameRunning) return;

    // Set game state to not running
    gameRunning = false;
    
    console.log("Game Over called with reason:", reason);
    
    // Stop background music and play game over sound
    if (soundManager.backgroundMusic) {
        soundManager.stop('background');
    }
    
    // Play game over sound
    soundManager.play('gameOver');
    
    // Store the final snake position to ensure consistency
    const finalPosition = [...snake];
    
    // Make sure the element exists
    if (!gameOverScreen) {
        console.error("gameOverScreen element not found!");
        return;
    }
    
    // Set different messages based on death reason
    let deathMessage = '';
    let deathColor = '#F44336'; // Default red
    
    switch (reason) {
        case 'starvation':
            deathMessage = 'You starved to death!';
            deathColor = '#FF9800'; // Orange for starvation
            // Create starvation visual effect
            createHungerDeathEffect();
            break;
        case 'collision':
            deathMessage = 'You crashed!';
            deathColor = '#F44336'; // Red for collision
            // Create collision visual effect
            createCollisionEffect();
            break;
        case 'eaten':
            deathMessage = 'You were eaten by another snake!';
            deathColor = '#9C27B0'; // Purple for being eaten
            // Create eaten visual effect
            createEatenEffect();
            break;
        case 'disconnect':
            deathMessage = 'Connection lost!';
            deathColor = '#607D8B'; // Blue-grey for disconnect
            break;
        default:
            deathMessage = 'Game Over!';
    }
    
    // Send game over message to server BEFORE cleanup to ensure it's sent
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'gameOver',
            id: playerId,
            reason: reason,
            score: score,
            level: level,
            dead: true,
            finalPosition: finalPosition // Send final snake position
        }));
    }
    
    // Store high scores locally
    if (score > localStorage.getItem('snake_highest_score') || !localStorage.getItem('snake_highest_score')) {
        localStorage.setItem('snake_highest_score', score);
    }
    
    // Add a short delay before showing the game over screen for visual effects to complete
    setTimeout(() => {
        // Clean up game resources after showing effects
        cleanupGame();
        
        // Set display and ensure visibility
        gameOverScreen.style.display = 'block';
        gameOverScreen.style.zIndex = '1001'; // Make sure it's above other elements
        
        // Add death message to game over screen
        const deathMessageElement = document.getElementById('death-message') || document.createElement('div');
        if (!document.getElementById('death-message')) {
            deathMessageElement.id = 'death-message';
            deathMessageElement.style.fontSize = '24px';
            deathMessageElement.style.marginBottom = '15px';
            gameOverScreen.insertBefore(deathMessageElement, gameOverScreen.firstChild);
        }
        
        deathMessageElement.textContent = deathMessage;
        deathMessageElement.style.color = deathColor;
        
        // Add animation to the death message
        deathMessageElement.style.animation = 'pulseText 2s infinite';
        if (!document.getElementById('death-message-style')) {
            const style = document.createElement('style');
            style.id = 'death-message-style';
            style.textContent = `
                @keyframes pulseText {
                    0% { opacity: 0.7; transform: scale(1); }
                    50% { opacity: 1; transform: scale(1.05); }
                    100% { opacity: 0.7; transform: scale(1); }
                }
            `;
            document.head.appendChild(style);
        }
        
        // All sounds are already preloaded
        
        finalScoreDisplay.textContent = `Score: ${score} (Best: ${highestScore})`;
        finalLevelDisplay.textContent = `Level: ${level}`;
        
        // Add some details about the death
        const deathDetailsElement = document.getElementById('death-details') || document.createElement('div');
        if (!document.getElementById('death-details')) {
            deathDetailsElement.id = 'death-details';
            deathDetailsElement.style.color = '#AAAAAA';
            deathDetailsElement.style.fontSize = '16px';
            deathDetailsElement.style.marginBottom = '20px';
            gameOverScreen.insertBefore(deathDetailsElement, restartBtn);
        }
        
        // Show different details based on death reason
        switch (reason) {
            case 'starvation':
                deathDetailsElement.textContent = 'Remember to eat regularly to keep your hunger meter full!';
                break;
            case 'collision':
                deathDetailsElement.textContent = 'Watch out for walls and other snakes next time!';
                break;
            case 'eaten':
                deathDetailsElement.textContent = 'Players with invincibility power-ups can eat other snakes!';
                break;
            case 'disconnect':
                deathDetailsElement.textContent = 'Check your internet connection and try again.';
                break;
        }
        
        // Animate the game over screen appearing
        gameOverScreen.style.opacity = '0';
        gameOverScreen.style.display = 'block';
        gameOverScreen.style.transition = 'opacity 0.5s ease-in';
        
        setTimeout(() => {
            gameOverScreen.style.opacity = '1';
        }, 50);
    }, 800); // Short delay for death effects
}

// Death effect functions
// Store death effects for canvas-based rendering
const deathEffects = {
    overlay: null,
    icon: null,
    particles: []
};

function createHungerDeathEffect() {
    // Create canvas-based death effect
    deathEffects.overlay = {
        type: 'hunger',
        startTime: Date.now(),
        duration: 2000,
        color: 'rgba(255, 152, 0, 0.3)'
    };
    
    deathEffects.icon = {
        text: '💔',
        startTime: Date.now(),
        duration: 2000,
        scale: 0,
        targetScale: 2
    };
    
    // Add particles
    for (let i = 0; i < 20; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1 + Math.random() * 2;
        deathEffects.particles.push({
            x: canvas.width / 2,
            y: canvas.height / 2,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            color: '#FF9800',
            size: 5 + Math.random() * 10,
            life: 1500 + Math.random() * 500,
            startTime: Date.now()
        });
    }
    
    // Shake screen effect
    shakeScreen(10, 500);
}

function createCollisionEffect() {
    // Get snake head position
    if (!snake.length) return;
    
    const head = snake[0];
    const headX = head.x * CELL_SIZE + CELL_SIZE/2;
    const headY = head.y * CELL_SIZE + CELL_SIZE/2;
    
    // Create explosion particles
    for (let i = 0; i < 30; i++) {
        createParticles(
            head.x, 
            head.y, 
            '#FF5722', // Orange-red
            30, // More particles
            3, // Faster speed
            5, // Larger particles
            1200 // Longer lifetime
        );
    }
    
    // Play collision sound
    soundManager.play('collision');
    
    // Create impact flash
    const flash = document.createElement('div');
    flash.className = 'impact-flash temp-game-element';
    flash.style.position = 'fixed';
    flash.style.top = '0';
    flash.style.left = '0';
    flash.style.width = '100%';
    flash.style.height = '100%';
    flash.style.backgroundColor = 'white';
    flash.style.opacity = '0.8';
    flash.style.zIndex = '1000';
    document.body.appendChild(flash);
    
    // Animate flash
    setTimeout(() => {
        flash.style.transition = 'opacity 0.3s ease-out';
        flash.style.opacity = '0';
    }, 50);
    
    // Shake screen effect
    shakeScreen(15, 700);
}

function createEatenEffect() {
    // Create a purple overlay to indicate being eaten
    const overlay = document.createElement('div');
    overlay.className = 'eaten-overlay temp-game-element';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.background = 'radial-gradient(circle, rgba(156, 39, 176, 0.3) 0%, rgba(156, 39, 176, 0.6) 100%)';
    overlay.style.zIndex = '1000';
    overlay.style.opacity = '0';
    document.body.appendChild(overlay);
    
    // Create eaten message
    const message = document.createElement('div');
    message.className = 'eaten-message temp-game-element';
    message.textContent = 'EATEN!';
    message.style.position = 'fixed';
    message.style.top = '50%';
    message.style.left = '50%';
    message.style.transform = 'translate(-50%, -50%) scale(0)';
    message.style.color = '#9C27B0';
    message.style.fontSize = '80px';
    message.style.fontWeight = 'bold';
    message.style.zIndex = '1001';
    message.style.textShadow = '0 0 20px rgba(156, 39, 176, 0.8)';
    document.body.appendChild(message);
    
    // Animate
    setTimeout(() => {
        overlay.style.transition = 'opacity 0.5s ease-in';
        overlay.style.opacity = '1';
        
        message.style.transition = 'transform 0.5s ease-out';
        message.style.transform = 'translate(-50%, -50%) scale(1)';
        
        // Create particles from each body segment
        if (snake.length) {
            snake.forEach((segment, index) => {
                setTimeout(() => {
                    createParticles(
                        segment.x,
                        segment.y,
                        '#9C27B0', // Purple
                        10,
                        2,
                        4,
                        1000
                    );
                }, index * 50); // Staggered effect along snake body
            });
        }
        
        // Shake screen effect
        shakeScreen(8, 600);
    }, 100);
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

// Array to store decorative elements
let decorativeElements = [];

// Define decorative element types
const DECORATIVE_TYPES = [
    { name: 'crystal', color: '#9C27B0', size: [20, 40] },
    { name: 'rock', color: '#607D8B', size: [15, 30] },
    { name: 'flower', color: '#E91E63', size: [10, 25] }
];

function initBackgroundElements() {
    // We're not using backgroundElements with the new cached background approach
    // But we'll still initialize the text cache and decorative elements
    
    // Initialize background text cache system
    initBackgroundTextCache();
    
    // Initialize decorative elements across the map (important for gameplay)
    generateDecorativeElements();
}

// Generate decorative elements throughout the map
function generateDecorativeElements() {
    decorativeElements = [];
    const MAX_ELEMENTS = 40; // Limited for performance
    
    // Generate a few paths across the map
    const pathCount = 3;
    
    for (let p = 0; p < pathCount; p++) {
        // Create a curving path with elements
        const startX = Math.floor(Math.random() * GRID_SIZE);
        const startY = Math.floor(Math.random() * GRID_SIZE);
        let x = startX;
        let y = startY;
        
        // Generate a random angle for this path
        const baseAngle = Math.random() * Math.PI * 2;
        
        // Each path has a number of segments
        const segmentCount = 15; // Limited for performance
        
        for (let i = 0; i < segmentCount && decorativeElements.length < MAX_ELEMENTS; i++) {
            // Select random element type
            const typeIndex = Math.floor(Math.random() * DECORATIVE_TYPES.length);
            const type = DECORATIVE_TYPES[typeIndex];
            
            // Add element with variation
            decorativeElements.push({
                x: x * CELL_SIZE,
                y: y * CELL_SIZE,
                type: type.name,
                color: type.color,
                size: Math.random() * (type.size[1] - type.size[0]) + type.size[0],
                rotation: Math.random() * Math.PI,
                opacity: 0.4 + Math.random() * 0.4
            });
            
            // Move position with some randomness for a natural path
            const angle = baseAngle + (Math.random() - 0.5) * 0.8;
            const distance = 10 + Math.random() * 20;
            
            x = Math.floor(x + Math.cos(angle) * distance / CELL_SIZE);
            y = Math.floor(y + Math.sin(angle) * distance / CELL_SIZE);
            
            // Keep within grid bounds
            x = Math.max(0, Math.min(GRID_SIZE - 1, x));
            y = Math.max(0, Math.min(GRID_SIZE - 1, y));
        }
    }
}

// Static background canvas for caching the background
let backgroundCache = {
    canvas: null,
    ctx: null,
    lastCameraX: 0,
    lastCameraY: 0,
    updateInterval: 5, // Only update every 5 frames
    frameCounter: 0,
    patternCanvas: null,
    patternCtx: null
};

function drawEnhancedBackground() {
    // Initialize background cache if needed
    if (!backgroundCache.canvas) {
        initBackgroundCache();
    }
    
    // Only update background when camera has moved significantly or on periodic refreshes
    const cameraDist = Math.sqrt(
        Math.pow(backgroundCache.lastCameraX - camera.x, 2) + 
        Math.pow(backgroundCache.lastCameraY - camera.y, 2)
    );
    
    if (cameraDist > 10 || backgroundCache.frameCounter >= backgroundCache.updateInterval) {
        updateBackgroundCache();
        backgroundCache.frameCounter = 0;
    } else {
        backgroundCache.frameCounter++;
    }
    
    // Draw the cached background
    ctx.drawImage(backgroundCache.canvas, 0, 0, canvas.width, canvas.height);
    
    // Force initialize background text cache for big texts
    if (!bgTextCache.initialized) {
        initBackgroundTextCache();
    }
    
    // Draw the cached background texts on top
    drawBackgroundText();
}

function initBackgroundCache() {
    // Create canvas for background cache
    backgroundCache.canvas = document.createElement('canvas');
    backgroundCache.canvas.width = canvas.width;
    backgroundCache.canvas.height = canvas.height;
    backgroundCache.ctx = backgroundCache.canvas.getContext('2d');
    
    // Create a small canvas for the repeating pattern
    backgroundCache.patternCanvas = document.createElement('canvas');
    backgroundCache.patternCanvas.width = 200;
    backgroundCache.patternCanvas.height = 200;
    backgroundCache.patternCtx = backgroundCache.patternCanvas.getContext('2d');
    
    // Generate the base pattern just once
    generateBasePattern();
    
    // Force first update
    updateBackgroundCache();
}

function generateBasePattern() {
    const patternCtx = backgroundCache.patternCtx;
    const width = backgroundCache.patternCanvas.width;
    const height = backgroundCache.patternCanvas.height;
    
    // Clear the pattern canvas
    patternCtx.fillStyle = '#060614';
    patternCtx.fillRect(0, 0, width, height);
    
    // Add simple stars with reduced opacity
    patternCtx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    for (let i = 0; i < 40; i++) {  // Reduced from 50 to 40 stars
        const x = Math.random() * width;
        const y = Math.random() * height;
        const size = Math.random() * 1.2 + 0.3;  // Reduced size range
        
        patternCtx.beginPath();
        patternCtx.arc(x, y, size, 0, Math.PI * 2);
        patternCtx.fill();
    }
    
    // Add a few brighter stars, but less bright than before
    patternCtx.fillStyle = 'rgba(255, 255, 255, 0.5)';  // Reduced from 0.8 to 0.5
    for (let i = 0; i < 7; i++) {  // Reduced from 10 to 7
        const x = Math.random() * width;
        const y = Math.random() * height;
        const size = Math.random() * 1.5 + 0.8;  // Reduced max size
        
        patternCtx.beginPath();
        patternCtx.arc(x, y, size, 0, Math.PI * 2);
        patternCtx.fill();
    }
    
    // Add simple grid lines for visual texture
    patternCtx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    patternCtx.lineWidth = 1;
    
    // Horizontal lines
    for (let i = 0; i < height; i += 20) {
        patternCtx.beginPath();
        patternCtx.moveTo(0, i);
        patternCtx.lineTo(width, i);
        patternCtx.stroke();
    }
    
    // Vertical lines
    for (let i = 0; i < width; i += 20) {
        patternCtx.beginPath();
        patternCtx.moveTo(i, 0);
        patternCtx.lineTo(i, height);
        patternCtx.stroke();
    }
}

function updateBackgroundCache() {
    const bgCtx = backgroundCache.ctx;
    
    // Store current camera position
    backgroundCache.lastCameraX = camera.x;
    backgroundCache.lastCameraY = camera.y;
    
    // Clear the background with slightly darker color for better contrast with stars
    bgCtx.fillStyle = '#0c0c16';
    bgCtx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Calculate pattern offset based on camera position for parallax effect
    const patternOffsetX = (camera.x * 0.1) % backgroundCache.patternCanvas.width;
    const patternOffsetY = (camera.y * 0.1) % backgroundCache.patternCanvas.height;
    
    // Draw tiled pattern with parallax effect
    for (let y = -patternOffsetY; y < canvas.height; y += backgroundCache.patternCanvas.height) {
        for (let x = -patternOffsetX; x < canvas.width; x += backgroundCache.patternCanvas.width) {
            bgCtx.drawImage(backgroundCache.patternCanvas, x, y);
        }
    }
    
    // Draw a few larger animated elements for visual interest
    // Reduced count and opacity for less distraction
    const time = Date.now() / 3000;
    const elementsCount = isMobile ? 3 : 10;  // Reduced from 5:15 to 3:10
    
    for (let i = 0; i < elementsCount; i++) {
        const seed = (i * 123 + Math.floor(time)) % 1000;
        const x = ((seed * 17) % canvas.width);
        const y = ((seed * 13) % canvas.height);
        const size = 25 + (seed % 25);  // Reduced size
        
        // Simple nebula or cloud effect with reduced opacity
        const gradient = bgCtx.createRadialGradient(
            x, y, 0,
            x, y, size
        );
        
        // Use different colors for variety but with reduced saturation and opacity
        const hue = (i * 30 + time * 10) % 360;
        gradient.addColorStop(0, `hsla(${hue}, 50%, 20%, 0.07)`);  // Reduced opacity from 0.1 to 0.07
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        
        bgCtx.fillStyle = gradient;
        bgCtx.beginPath();
        bgCtx.arc(x, y, size, 0, Math.PI * 2);
        bgCtx.fill();
    }
    
    // Add minimal cosmic web lines (only 5 lines instead of 10)
    bgCtx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
    bgCtx.lineWidth = 1;
    
    for (let i = 0; i < 5; i++) {
        const seed = (i * 345 + Math.floor(time * 0.5)) % 1000;
        const startX = (seed * 7) % canvas.width;
        const startY = (seed * 11) % canvas.height;
        
        bgCtx.beginPath();
        bgCtx.moveTo(startX, startY);
        
        // Simpler lines - only 2 segments instead of 5
        for (let j = 0; j < 2; j++) {
            const endX = startX + Math.cos(seed + j) * 150;
            const endY = startY + Math.sin(seed + j) * 150;
            bgCtx.lineTo(endX, endY);
        }
        
        bgCtx.stroke();
    }
}

// generateWalls function removed - walls are now managed by the server

// Wall formation functions removed - now handled by the server

// Wall caching system to improve performance
const wallCache = {
    initialized: false,
    canvas: null,
    ctx: null,
    size: CELL_SIZE,
    init: function() {
        if (this.initialized) return;
        
        // Create offscreen canvas for wall rendering
        this.canvas = document.createElement('canvas');
        this.canvas.width = this.size;
        this.canvas.height = this.size;
        this.ctx = this.canvas.getContext('2d');
        
        // Pre-render wall with 3D effect
        this.ctx.fillStyle = WALL_COLOR;
        this.ctx.fillRect(0, 0, this.size, this.size);
        
        // Add highlights
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        this.ctx.fillRect(0, 0, this.size, this.size / 4);
        this.ctx.fillRect(0, 0, this.size / 4, this.size);
        
        // Add shadows
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        this.ctx.fillRect(0, this.size - this.size / 4, this.size, this.size / 4);
        this.ctx.fillRect(this.size - this.size / 4, 0, this.size / 4, this.size);
        
        this.initialized = true;
    }
};

// Wall spatial index for faster collision detection
const wallIndex = {
    grid: null,
    cellSize: 20, // Grid cell size for spatial indexing
    initialized: false,
    
    init: function() {
        if (this.initialized) return;
        this.grid = {};
        this.initialized = true;
    },
    
    // Add a wall to the spatial index
    add: function(x, y) {
        const cellX = Math.floor(x / this.cellSize);
        const cellY = Math.floor(y / this.cellSize);
        const key = `${cellX},${cellY}`;
        
        if (!this.grid[key]) {
            this.grid[key] = [];
        }
        this.grid[key].push({x, y});
    },
    
    // Check if a position has a wall using spatial index
    hasWall: function(x, y) {
        const cellX = Math.floor(x / this.cellSize);
        const cellY = Math.floor(y / this.cellSize);
        const key = `${cellX},${cellY}`;
        
        if (!this.grid[key]) return false;
        
        for (const wall of this.grid[key]) {
            if (wall.x === x && wall.y === y) {
                return true;
            }
        }
        return false;
    },
    
    // Rebuild the index from the full wall array
    rebuild: function(walls) {
        this.grid = {};
        for (const wall of walls) {
            this.add(wall.x, wall.y);
        }
    }
};

function drawWalls() {
    // Initialize wall cache if needed
    if (!wallCache.initialized) {
        wallCache.init();
    }
    
    // Calculate visible grid range
    const startX = Math.floor(camera.x / CELL_SIZE);
    const startY = Math.floor(camera.y / CELL_SIZE);
    const endX = startX + Math.ceil(VIEWPORT_WIDTH / CELL_SIZE) + 1;
    const endY = startY + Math.ceil(VIEWPORT_HEIGHT / CELL_SIZE) + 1;
    
    // Only draw walls that are in viewport
    for (const wall of WALLS) {
        const wallX = wall.x * CELL_SIZE;
        const wallY = wall.y * CELL_SIZE;
        
        // Skip if outside viewport
        if (wallX + CELL_SIZE < camera.x || wallX > camera.x + VIEWPORT_WIDTH ||
            wallY + CELL_SIZE < camera.y || wallY > camera.y + VIEWPORT_HEIGHT) {
            continue;
        }
        
        // Draw using pre-rendered wall cache
        ctx.drawImage(wallCache.canvas, wallX, wallY);
    }
}

function activateSafeZone() {
    safeZoneActive = true;
    safeZoneExpiry = Date.now() + SAFE_ZONE_DURATION; // Reduced from 1.5x to make game more challenging
    
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
    
    // Send request to server to create more food in starting area
    // Reduced from 15 to 10 food items for the smaller safe zone
    for (let i = 0; i < 10; i++) {
        // Create food in multiple concentric spiral patterns for better distribution
        const angle = (i / 10) * Math.PI * 2;
        
        // Alternate between inner and outer food - adjusted distances for smaller safe zone
        let distance;
        if (i % 2 === 0) {
            distance = 2 + (i / 2); // Closer food (2-7 cells from center)
        } else {
            distance = 8 + (i / 2); // Farther food (8-13 cells from center)
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
    
    // Check if it's mobile device for simplified rendering
    const simplifiedRendering = isMobile;
    
    // 1. Draw simplified ground effect - single gradient instead of multiple layers
    const groundRadius = SAFE_ZONE_RADIUS * CELL_SIZE;
    const groundGradient = ctx.createRadialGradient(
        centerX * CELL_SIZE + CELL_SIZE/2,
        centerY * CELL_SIZE + CELL_SIZE/2,
        0,
        centerX * CELL_SIZE + CELL_SIZE/2,
        centerY * CELL_SIZE + CELL_SIZE/2,
        groundRadius
    );
    
    // Simple pulse effect with fewer calculations
    const pulse = 0.3 + 0.5 * Math.sin(Date.now() / 400);
    
    // Fewer color stops for better performance
    groundGradient.addColorStop(0, `rgba(50, 200, 100, ${0.15 * remainingTime * pulse})`);
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
    
    // 2. Draw border (simplified to one or two layers based on device)
    const time = Date.now() / 1000;
    
    // Main border - always draw this
    ctx.beginPath();
    ctx.arc(
        centerX * CELL_SIZE + CELL_SIZE/2,
        centerY * CELL_SIZE + CELL_SIZE/2,
        SAFE_ZONE_RADIUS * CELL_SIZE,
        0,
        Math.PI * 2
    );
    ctx.setLineDash([8, 12]);
    ctx.lineDashOffset = time * 20; // Simplified animation
    ctx.strokeStyle = `rgba(76, 235, 80, ${0.6 * remainingTime})`;
    ctx.lineWidth = 4;
    ctx.stroke();
    
    // Second border only for non-mobile
    if (!simplifiedRendering) {
        ctx.beginPath();
        ctx.arc(
            centerX * CELL_SIZE + CELL_SIZE/2,
            centerY * CELL_SIZE + CELL_SIZE/2,
            SAFE_ZONE_RADIUS * CELL_SIZE * 0.95,
            0,
            Math.PI * 2
        );
        ctx.setLineDash([6, 10]);
        ctx.lineDashOffset = -time * 15; // Simplified animation
        ctx.strokeStyle = `rgba(100, 255, 130, ${0.4 * remainingTime})`;
        ctx.lineWidth = 2;
        ctx.stroke();
    }
    
    // Reset line dash
    ctx.setLineDash([]);
    
    // 3. Add minimal particles for mobile, more for desktop
    const particleCount = simplifiedRendering ? 4 : 8; // Reduced from 12 to 4/8
    
    for (let i = 0; i < particleCount; i++) {
        const angle = (i / particleCount) * Math.PI * 2 + time;
        const distance = SAFE_ZONE_RADIUS * CELL_SIZE;
        
        const x = centerX * CELL_SIZE + CELL_SIZE/2 + Math.cos(angle) * distance;
        const y = centerY * CELL_SIZE + CELL_SIZE/2 + Math.sin(angle) * distance;
        
        // Single circle instead of multiple for each particle
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(150, 255, 150, ${0.7 * remainingTime})`;
        ctx.fill();
        
        // Only draw connecting lines for non-mobile
        if (!simplifiedRendering) {
            ctx.beginPath();
            ctx.moveTo(centerX * CELL_SIZE + CELL_SIZE/2, centerY * CELL_SIZE + CELL_SIZE/2);
            ctx.lineTo(x, y);
            ctx.strokeStyle = `rgba(100, 255, 100, ${0.15 * remainingTime})`;
            ctx.lineWidth = 1;
            ctx.stroke();
        }
    }
    
    // 4. Text - always show countdown text, but fewer decorative texts on mobile
    ctx.fillStyle = `rgba(255, 255, 255, ${0.8 * remainingTime})`;
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
        `SAFE: ${Math.ceil(remainingTime * SAFE_ZONE_DURATION / 1000)}s`,
        centerX * CELL_SIZE + CELL_SIZE/2,
        centerY * CELL_SIZE - SAFE_ZONE_RADIUS * CELL_SIZE * 0.5
    );
    
    // Main "SAFE HAVEN" text - always show
    ctx.font = simplifiedRendering ? 'bold 28px Arial' : 'bold 32px Arial';
    ctx.fillStyle = `rgba(150, 255, 180, ${0.7 * remainingTime})`;
    ctx.fillText(
        'SAFE HAVEN',
        centerX * CELL_SIZE + CELL_SIZE/2,
        centerY * CELL_SIZE
    );
    
    // Skip additional text and compass for mobile
    if (!simplifiedRendering) {
        ctx.font = 'bold 18px Arial';
        ctx.fillStyle = `rgba(255, 255, 255, ${0.7 * remainingTime})`;
        ctx.fillText(
            'COLLISION FREE ZONE',
            centerX * CELL_SIZE + CELL_SIZE/2,
            centerY * CELL_SIZE + CELL_SIZE * 5
        );
        
        // Simple compass - only on desktop
        const compassRadius = SAFE_ZONE_RADIUS * CELL_SIZE * 0.2;
        ctx.beginPath();
        ctx.arc(
            centerX * CELL_SIZE + CELL_SIZE/2,
            centerY * CELL_SIZE + CELL_SIZE/2,
            compassRadius,
            0,
            Math.PI * 2
        );
        ctx.strokeStyle = `rgba(150, 255, 150, ${0.5 * remainingTime})`;
        ctx.lineWidth = 1;
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
        
        // Enlarged player indicators with bigger dots
        minimapCtx.beginPath();
        minimapCtx.arc(
            head.x * minimapScale,
            head.y * minimapScale,
            isCurrentPlayer ? 5 : 4, // Increased from 3/2 to 5/4 for better visibility
            0,
            Math.PI * 2
        );
        minimapCtx.fill();
        
        // Add outline to further improve visibility
        minimapCtx.strokeStyle = isCurrentPlayer ? '#FFFFFF' : '#AAAAFF';
        minimapCtx.lineWidth = 1;
        minimapCtx.stroke();
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
            6, // Increased from 4 to 6 for larger indicator for player
            0,
            Math.PI * 2
        );
        minimapCtx.fill();
        
        // Add pulsing effect with larger pulse
        minimapCtx.strokeStyle = 'rgba(76, 175, 80, 0.7)';
        minimapCtx.lineWidth = 1.5; // Increased from 1 to 1.5
        const pulseSize = 6 + Math.sin(Date.now() / 200) * 3; // Increased from 4+2 to 6+3
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


// Add both click and touch handlers for better mobile compatibility
function startGameHandler(e) {
    if (e) e.preventDefault();
    
    // Prevent starting the game if button is disabled
    if (startBtn.disabled) {
        return;
    }
    
    console.log("Start button clicked");
    soundManager.play('menuSelect');
    
    // If assets aren't loaded yet, show loading screen first then start game
    if (!gameAssetsLoaded) {
        showLoadingScreen(function() {
            // This callback runs when loading is complete
            startScreen.style.display = 'none'; // Hide start screen
            canvas.style.display = 'block';
            if (!gameRunning) {
                initGame();
                detectTouchDevice(); // Initialize touch controls when the game starts
            }
        });
    } else {
        // Assets already loaded, start game immediately
        startScreen.style.display = 'none';
        canvas.style.display = 'block';
        if (!gameRunning) {
            initGame();
            detectTouchDevice(); // Initialize touch controls when the game starts
        }
    }
}

// Add both regular click and touch events for the start button
startBtn.addEventListener('click', startGameHandler);
startBtn.addEventListener('touchend', function(e) {
    e.preventDefault();
    startGameHandler(e);
});

function restartGameHandler(e) {
    if (e) e.preventDefault();
    soundManager.play('menuSelect');
    gameOverScreen.style.display = 'none';
    initGame();
}

// Add both regular click and touch events for the restart button
restartBtn.addEventListener('click', restartGameHandler);
restartBtn.addEventListener('touchend', function(e) {
    e.preventDefault();
    restartGameHandler(e);
});

function checkPowerUpExpiration() {
    if (activePowerUp && Date.now() > activePowerUp.expiresAt) {
        deactivatePowerUp();
    }
}

// Deactivate the current power-up
function deactivatePowerUp() {
    if (!activePowerUp) return;
    
    // Reset any stored game speed
    if (activePowerUp.type === 'speed_boost' && window.originalGameSpeed) {
        window.originalGameSpeed = null;
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
    
    // Tell server about power-up deactivation
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'update',
            id: playerId,
            snake: snake,
            score: score,
            level: level,
            activePowerUp: null
        }));
    }
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
            powerUpName = 'INVINCIBILITY!';
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
    powerUpIndicator.style.fontWeight = 'bold'; // Replaced text shadow with bold for better performance
    
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
    
    // For speed boost, we keep the game loop the same speed but change the animation timing
    if (activePowerUp.type === 'speed_boost') {
        if (!window.originalGameSpeed) {
            window.originalGameSpeed = gameSpeed;
        }
    }
}

// Add the missing updatePowerUpStatus function
// Helper function to determine if another player's snake has a specific power-up
function getPlayerPowerUp(snakeBody) {
    // Find the player ID for this snake
    for (const id in players) {
        if (players[id].snake === snakeBody && players[id].activePowerUp) {
            return players[id].activePowerUp.type;
        }
    }
    return null;
}

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

// Function to check and handle eating other snakes when invincible
function checkEatOtherSnake() {
    if (!activePowerUp || activePowerUp.type !== 'invincibility' || !snake.length) {
        return false;
    }
    
    const head = snake[0];
    
    for (const id in players) {
        if (id === playerId) continue; // Skip our own snake
        
        const otherSnake = players[id].snake;
        if (!otherSnake || !otherSnake.length) continue;
        
        // Check for collision with each segment of other snake
        for (let i = 0; i < otherSnake.length; i++) {
            if (head.x === otherSnake[i].x && head.y === otherSnake[i].y) {
                // We found a collision! Eat this snake
                eatOtherSnake(id, i);
                return true;
            }
        }
    }
    
    return false;
}

// Function to handle eating another snake
function eatOtherSnake(otherPlayerId, segmentIndex) {
    const otherSnake = players[otherPlayerId].snake;
    if (!otherSnake) return;
    
    // Calculate points based on how much of the snake we're eating
    // We get points for each segment from the hit position to the end
    const segmentsEaten = otherSnake.length - segmentIndex;
    const pointsGained = segmentsEaten * 5; // 5 points per segment
    
    // Increase score - don't add it twice (we already add it below when we notify the server)
    // score += pointsGained;
    
    // Grow our snake based on how much we ate (but cap it)
    const growthAmount = Math.min(10, Math.floor(segmentsEaten / 3));
    for (let i = 0; i < growthAmount; i++) {
        const tail = snake[snake.length - 1];
        snake.push({x: tail.x, y: tail.y});
    }
    
    // Restore hunger based on segments eaten
    hungerTimer = Math.min(MAX_HUNGER, hungerTimer + (segmentsEaten * 1.5));
    updateHungerBar();
    
    // Show visual effect for eating a snake
    showSnakeEatenEffect(otherPlayerId, pointsGained);
    
    // Play sound effect
    soundManager.play('eat', { volume: 1.0 });
    
    // Notify server that we ate part of another snake
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'eatSnake',
            id: playerId,
            target: otherPlayerId,
            segmentIndex: segmentIndex,
            points: pointsGained
        }));
        
        // Update our local score immediately (server will confirm later)
        score += pointsGained;
        
        // Update the other player's snake locally to provide immediate feedback
        if (players[otherPlayerId] && players[otherPlayerId].snake) {
            if (segmentIndex === 0) {
                // If we ate the head, mark the snake as dead
                players[otherPlayerId].dead = true;
                
                // Create special effect for eating a head
                createParticles(
                    otherSnake[0].x,
                    otherSnake[0].y,
                    '#FF5722', // Orange color 
                    15, // More particles
                    3,  // Faster movement
                    6,  // Larger particles
                    1200 // Longer lifetime
                );
            } else {
                // If we ate part of the body, truncate the snake
                players[otherPlayerId].snake = players[otherPlayerId].snake.slice(0, segmentIndex);
                
                // Create effect for eating body segments
                createParticles(
                    otherSnake[segmentIndex].x,
                    otherSnake[segmentIndex].y,
                    '#9C27B0', // Purple color
                    10, // Fewer particles than head
                    2,  // Slower movement
                    4,  // Smaller particles
                    800 // Shorter lifetime
                );
            }
        }
    }
    
    // Show point gain
    scoreAnimations.push({
        x: otherSnake[segmentIndex].x * CELL_SIZE,
        y: otherSnake[segmentIndex].y * CELL_SIZE,
        points: pointsGained,
        color: '#FF5722',
        startTime: Date.now(),
        duration: 1000
    });
    
    updateScoreAndLevel();
    checkLevelUp();
    
    return true;
}

// Visual effect for eating another snake
function showSnakeEatenEffect(otherPlayerId, points) {
    if (!players[otherPlayerId] || !players[otherPlayerId].snake) return;
    
    const otherSnake = players[otherPlayerId].snake;
    if (!otherSnake.length) return;
    
    // Store the current snake before it gets updated by server
    const snakeSegments = [...otherSnake];
    
    // Create particle explosion at each segment
    for (let i = 0; i < snakeSegments.length; i++) {
        const segment = snakeSegments[i];
        // Create explosion effect
        createParticles(
            segment.x, 
            segment.y, 
            '#FF5722', // Orange color
            8, // More particles
            3, // Faster movement
            5, // Larger particles
            1000 // Longer lifetime
        );
    }
    
    // Show points gained
    const head = otherSnake[0];
    const effectDiv = document.createElement('div');
    effectDiv.textContent = `+${points}`;
    effectDiv.style.position = 'absolute';
    effectDiv.style.left = `${head.x * CELL_SIZE}px`;
    effectDiv.style.top = `${head.y * CELL_SIZE}px`;
    effectDiv.style.color = '#FF5722';
    effectDiv.style.fontSize = '24px';
    effectDiv.style.fontWeight = 'bold';
    effectDiv.style.pointerEvents = 'none';
    effectDiv.style.textShadow = '0 0 5px rgba(0,0,0,0.7)';
    document.body.appendChild(effectDiv);
    
    // Add "SNAKE EATEN!" text
    const messageDiv = document.createElement('div');
    messageDiv.textContent = 'SNAKE EATEN!';
    messageDiv.style.position = 'absolute';
    messageDiv.style.left = '50%';
    messageDiv.style.top = '30%';
    messageDiv.style.transform = 'translate(-50%, -50%)';
    messageDiv.style.color = '#FF5722';
    messageDiv.style.fontSize = '36px';
    messageDiv.style.fontWeight = 'bold';
    messageDiv.style.fontWeight = 'bold'; // Replaced text shadow with bold for better performance
    messageDiv.style.pointerEvents = 'none';
    document.body.appendChild(messageDiv);
    
    // Screen shake effect
    shakeScreen(15, 800);
    
    // Animate and remove the effect
    const startTime = Date.now();
    const animDuration = 1500;
    
    function animateText() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(1, elapsed / animDuration);
        const yOffset = -30 * Math.sin(progress * Math.PI);
        const scale = 1 + Math.sin(progress * Math.PI / 2);
        
        effectDiv.style.transform = `translateY(${yOffset}px) scale(${scale})`;
        effectDiv.style.opacity = 1 - progress;
        
        messageDiv.style.opacity = 1 - progress;
        messageDiv.style.fontSize = `${36 + 10 * Math.sin(progress * Math.PI)}px`;
        
        if (progress < 1) {
            requestAnimationFrame(animateText);
        } else {
            document.body.removeChild(effectDiv);
            document.body.removeChild(messageDiv);
        }
    }
    
    requestAnimationFrame(animateText);
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

// Store canvas-based warnings for rendering
const canvasWarnings = [];
let currentVignette = null;

function showHungerWarning() {
    // Make warnings more frequent as hunger decreases
    const warningProbability = (HUNGER_WARNING_THRESHOLD - hungerTimer) / HUNGER_WARNING_THRESHOLD;
    if (Math.random() > warningProbability * 1.5) { // Increased frequency
        return;
    }
    
    // Play heartbeat sound if hunger is very low
    if (hungerTimer < HUNGER_WARNING_THRESHOLD * 0.5) {
        soundManager.play('heartbeat', { volume: 0.3 + (1 - hungerTimer / HUNGER_WARNING_THRESHOLD) * 0.7 });
    }
    
    // Instead of creating DOM elements, add a canvas warning
    canvasWarnings.push({
        text: 'HUNGRY!',
        startTime: Date.now(),
        duration: 500,
        color: '#F44336'
    });
    
    // Set vignette effect that will be drawn directly on canvas
    currentVignette = {
        startTime: Date.now(),
        duration: 500,
        color: 'rgba(244, 67, 54, 0.1)'
    };
    
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
        soundManager.play('menuSelect');
        return;
    }
    
    // Toggle mini leaderboard with 'L' key
    if (e.key === 'l' || e.key === 'L') {
        toggleBestScores();
        soundManager.play('menuSelect');
        return;
    }
    
    if (!gameRunning) return;
    
    const oldDirection = direction;
    
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
    
    // Play movement sound if direction has actually changed
    if (oldDirection !== nextDirection) {
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
        
        // Draw orbiting particles without glow effect for better performance
        ctx.fillStyle = POWER_UP_EFFECTS.magnet.visualEffect;
        ctx.beginPath();
        ctx.arc(orbitX, orbitY, 4, 0, Math.PI * 2);
        ctx.fill();
        
        // Add a second layer for glow-like effect without shadow
        const glowColor = POWER_UP_EFFECTS.magnet.visualEffect.replace(')', ', 0.4)').replace('rgb', 'rgba');
        ctx.fillStyle = glowColor;
        ctx.beginPath();
        ctx.arc(orbitX, orbitY, 6, 0, Math.PI * 2);
        ctx.fill();
        
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

// Create mobile menu buttons container
const powerUpCountdownBar = document.createElement('div');
powerUpCountdownBar.id = 'power-up-countdown-bar';
powerUpCountdownBar.style.height = '100%';
powerUpCountdownBar.style.width = '100%';
powerUpCountdownBar.style.transition = 'width 0.1s linear';
powerUpCountdownContainer.appendChild(powerUpCountdownBar);

// Create a joystick container
const joystickContainer = document.createElement('div');
joystickContainer.id = 'joystick-container';
joystickContainer.style.position = 'absolute';
joystickContainer.style.bottom = '20px';
joystickContainer.style.right = '20px';  // Position 20px from the right
joystickContainer.style.width = '150px';
joystickContainer.style.height = '150px';
joystickContainer.style.zIndex = '1001';
joystickContainer.style.display = 'none'; // Hide by default
document.body.appendChild(joystickContainer);

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
    // { id: 'minimap', symbol: 'M', title: 'Toggle Minimap' },
    // { id: 'leaderboard', symbol: 'L', title: 'Toggle Leaderboard' },
    // { id: 'settings', symbol: '⚙️', title: 'Game Settings' }
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
        button.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        handleMobileMenuButton(btn.id);
    });
    
    button.addEventListener('touchend', (e) => {
        e.preventDefault();
        button.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    });
    
    mobileMenuContainer.appendChild(button);
});

// Function to handle mobile menu buttons
function handleMobileMenuButton(buttonId) {
    switch (buttonId) {
        case 'minimap':
            toggleMinimap();
            break;
        case 'leaderboard':
            toggleBestScores();
            break;
        // case 'settings':
        //     openSettingsMenu();
        //     break;
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

        // Initialize the joystick
        window.joystick = nipplejs.create({
            zone: joystickContainer,
            mode: 'static',
            position: { right: '75px', bottom: '75px' },
            color: 'rgba(0,255,0,0.05)',
            size: 100,
            opacity: 0.05
        });

        // Debounce function
        function debounce(func, delay) {
            let timeout;
            return function(...args) {
                const context = this;
                clearTimeout(timeout);
                timeout = setTimeout(() => func.apply(context, args), delay);
            }
        }

        // Map joystick movements to snake direction
        const setDirection = debounce((newDirection) => {
            if (direction !== newDirection &&
                ((newDirection === 'up' && direction !== 'down') ||
                 (newDirection === 'down' && direction !== 'up') ||
                 (newDirection === 'left' && direction !== 'right') ||
                 (newDirection === 'right' && direction !== 'left'))) {
                nextDirection = newDirection;
            }
        }, 100);

        window.joystick.on('dir:up', () => {
            setNextDirection('up');
        });

        window.joystick.on('dir:down', () => {
            setNextDirection('down');
        });

        window.joystick.on('dir:left', () => {
            setNextDirection('left');
        });

        window.joystick.on('dir:right', () => {
            setNextDirection('right');
        });
    }
}

// Function to set the next direction
function setNextDirection(newDirection) {
    if (direction !== newDirection &&
        ((newDirection === 'up' && direction !== 'down') ||
         (newDirection === 'down' && direction !== 'up') ||
         (newDirection === 'left' && direction !== 'right') ||
         (newDirection === 'right' && direction !== 'left'))) {
        nextDirection = newDirection;
    }
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

// Global loading state
let gameAssetsLoaded = false;

// Cache frequently accessed DOM elements
const domElements = {
    startScreen: null,
    canvas: null,
    startBtn: null,
    gameOverScreen: null,
    levelUpScreen: null,
    restartBtn: null,
    scoreDisplay: null,
    levelDisplay: null,
    speedDisplay: null,
    playersCountDisplay: null,
    finalScoreDisplay: null,
    finalLevelDisplay: null,
    newLevelDisplay: null,
    minimapCanvas: null,
    minimapCtx: null,
    bestScoresCanvas: null,
    bestScoresCtx: null,
    powerUpIndicator: null,
    powerUpStatus: null,
    powerUpCountdownContainer: null,
    powerUpCountdownBar: null,
    joystickContainer: null,
    mobileMenuContainer: null,
    heartContainer: null,
    hungerClock: null,
    heartIcon: null
};

// Call the detection function when the document is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Cache all DOM elements for better performance
    cacheDomElements();

    // // Show loading screen
    // showLoadingScreen(() => {
    //     // This callback runs when loading completes
    //     console.log("Loading completed, starting game automatically");
    //     startGameHandler(); // Automatically start the game when loading is done
    // });
    
    // Disable the start button until loading is complete
    domElements.startBtn.disabled = false;
    domElements.startBtn.style.opacity = "1";
    domElements.startBtn.style.cursor = "pointer";

    // Make sure start screen is visible
    if (domElements.startScreen) {
        domElements.startScreen.style.display = 'block';
    }
    
});

// Cache all DOM elements for better performance
function cacheDomElements() {
    domElements.startScreen = document.getElementById('start-screen');
    domElements.canvas = document.getElementById('game-canvas');
    domElements.startBtn = document.getElementById('start-btn');
    domElements.gameOverScreen = document.getElementById('game-over');
    domElements.levelUpScreen = document.getElementById('level-up');
    domElements.restartBtn = document.getElementById('restart-btn');
    domElements.scoreDisplay = document.getElementById('score');
    domElements.levelDisplay = document.getElementById('level');
    domElements.speedDisplay = document.getElementById('speed');
    domElements.playersCountDisplay = document.getElementById('players-count');
    domElements.finalScoreDisplay = document.getElementById('final-score');
    domElements.finalLevelDisplay = document.getElementById('final-level');
    domElements.newLevelDisplay = document.getElementById('new-level');
    domElements.minimapCanvas = document.getElementById('minimap');
    domElements.minimapCtx = domElements.minimapCanvas ? domElements.minimapCanvas.getContext('2d') : null;
    domElements.bestScoresCanvas = document.getElementById('bestscores');
    domElements.bestScoresCtx = domElements.bestScoresCanvas ? domElements.bestScoresCanvas.getContext('2d') : null;
    domElements.powerUpIndicator = document.getElementById('power-up-indicator');
    domElements.powerUpStatus = document.getElementById('power-up-status');
    domElements.powerUpCountdownContainer = document.getElementById('power-up-countdown-container');
    domElements.powerUpCountdownBar = document.getElementById('power-up-countdown-bar');
    domElements.joystickContainer = document.getElementById('joystick-container');
    domElements.mobileMenuContainer = document.getElementById('mobile-menu');
    domElements.heartContainer = document.getElementById('heart-container');
    domElements.hungerClock = document.getElementById('hunger-clock');
    domElements.heartIcon = document.getElementById('heart-icon');
    
    // Initialize any missing UI elements that will be needed
    initMissingElements();
}

// Initialize any UI elements that aren't in the HTML yet
function initMissingElements() {
    if (!domElements.powerUpIndicator) {
        domElements.powerUpIndicator = document.createElement('div');
        domElements.powerUpIndicator.id = 'power-up-indicator';
        document.body.appendChild(domElements.powerUpIndicator);
        styleElement(domElements.powerUpIndicator, {
            position: 'absolute',
            top: '10px',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '5px 10px',
            borderRadius: '5px',
            fontWeight: 'bold',
            display: 'none',
            zIndex: '1000'
        });
    }
    
    if (!domElements.powerUpStatus) {
        domElements.powerUpStatus = document.createElement('div');
        domElements.powerUpStatus.id = 'power-up-status';
        document.body.appendChild(domElements.powerUpStatus);
        styleElement(domElements.powerUpStatus, {
            position: 'absolute',
            top: '10px',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            padding: '10px 20px',
            borderRadius: '10px',
            color: 'white',
            fontFamily: 'Arial, sans-serif',
            fontSize: '20px',
            fontWeight: 'bold',
            zIndex: '1000',
            border: '2px solid white',
            boxShadow: '0 0 15px rgba(255, 255, 255, 0.5)',
            display: 'none'
        });
    }
    
    // Add other elements as needed
}

// Helper function to set multiple styles at once
function styleElement(element, styles) {
    for (const property in styles) {
        element.style[property] = styles[property];
    }
}

// Show loading screen function
function showLoadingScreen(callback) {
    // Hide start screen immediately when showing loading screen
    const startScreen = document.getElementById('start-screen');
    if (startScreen) {
        startScreen.style.display = 'none';
    }
    
    // Create loading screen container
    const loadingScreen = document.createElement('div');
    loadingScreen.id = 'loading-screen';
    loadingScreen.style.position = 'fixed';
    loadingScreen.style.top = '0';
    loadingScreen.style.left = '0';
    loadingScreen.style.width = '100%';
    loadingScreen.style.height = '100%';
    loadingScreen.style.backgroundColor = '#0a0a1a';
    loadingScreen.style.display = 'flex';
    loadingScreen.style.flexDirection = 'column';
    loadingScreen.style.justifyContent = 'center';
    loadingScreen.style.alignItems = 'center';
    loadingScreen.style.zIndex = '10000';
    document.body.appendChild(loadingScreen);

    // Create snake logo
    const snakeLogo = document.createElement('div');
    snakeLogo.style.fontSize = '42px';
    snakeLogo.style.color = '#4CAF50';
    snakeLogo.style.fontWeight = 'bold';
    snakeLogo.style.marginBottom = '30px';
    snakeLogo.style.fontWeight = 'bold';
    snakeLogo.innerHTML = 'Snake Vibe';
    loadingScreen.appendChild(snakeLogo);

    // Create loading animation - snake
    const snakeAnimation = document.createElement('div');
    snakeAnimation.style.display = 'flex';
    snakeAnimation.style.alignItems = 'center';
    snakeAnimation.style.justifyContent = 'center';
    snakeAnimation.style.marginBottom = '40px';
    loadingScreen.appendChild(snakeAnimation);

    // Create snake segments
    const segmentCount = 5;
    const segments = [];
    for (let i = 0; i < segmentCount; i++) {
        const segment = document.createElement('div');
        segment.style.width = '20px';
        segment.style.height = '20px';
        segment.style.borderRadius = '50%';
        segment.style.backgroundColor = i === 0 ? '#4CAF50' : '#8BC34A';
        segment.style.margin = '0 5px';
        segment.style.transform = 'scale(0.8)';
        segment.style.opacity = '0.8';
        segment.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
        snakeAnimation.appendChild(segment);
        segments.push(segment);
    }
    
    // Animate snake segments
    let currentIndex = 0;
    let snakeAnimationInterval = null;
    const animateSnake = () => {
        segments.forEach((segment, i) => {
            // Reset all segments
            segment.style.transform = 'scale(0.8)';
            segment.style.opacity = '0.8';
        });
        // Highlight current segment
        if (segments[currentIndex]) {
            segments[currentIndex].style.transform = 'scale(1.2)';
            segments[currentIndex].style.opacity = '1';
        }
        currentIndex = (currentIndex + 1) % segmentCount;
    };

    snakeAnimationInterval = setInterval(animateSnake, 300);
    animateSnake(); // Start immediately

    // Create loading text
    const loadingText = document.createElement('div');
    loadingText.id = 'loading-text';
    loadingText.style.color = '#ffffff';
    loadingText.style.fontSize = '18px';
    loadingText.style.marginBottom = '10px';
    loadingText.textContent = 'Loading...';
    loadingScreen.appendChild(loadingText);

    // Create progress bar container
    const progressContainer = document.createElement('div');
    progressContainer.style.width = '200px';
    progressContainer.style.height = '10px';
    progressContainer.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
    progressContainer.style.borderRadius = '5px';
    progressContainer.style.overflow = 'hidden';
    loadingScreen.appendChild(progressContainer);

    // Create progress bar
    const progressBar = document.createElement('div');
    progressBar.id = 'loading-progress';
    progressBar.style.width = '0%';
    progressBar.style.height = '100%';
    progressBar.style.backgroundColor = '#4CAF50';
    progressBar.style.borderRadius = '5px';
    progressBar.style.transition = 'width 0.3s ease';
    progressContainer.appendChild(progressBar);

    // Use actual asset loading progress
    let progress = 0;
    let totalAssets = Object.keys(soundManager.soundPaths).length;
    let loadedAssets = 0;
    
    // Set up a listener for asset loading progress
    window.addEventListener('assetLoaded', () => {
        loadedAssets++;
        progress = Math.min(100, (loadedAssets / totalAssets) * 100);
        progressBar.style.width = `${progress}%`;
        loadingText.textContent = `Loading... ${Math.floor(progress)}%`;
        
        if (loadedAssets >= totalAssets) {
            // All assets loaded
            completeLoading();
        }
    });
    
    // Start the asset loading
    soundManager.init();
    
    // Set a timeout to ensure we don't wait forever
    const loadingTimeout = setTimeout(() => {
        if (progress < 100) {
            console.log("Loading taking too long, proceeding anyway");
            completeLoading();
        }
    }, 10000); // 10 second timeout
    
    // Function to handle completion of loading
    function completeLoading() {
        clearTimeout(loadingTimeout);
        
        // When loading is complete
        loadingText.textContent = 'Ready!';
        if (snakeAnimationInterval) {
            clearInterval(snakeAnimationInterval);
        }
        
        // Set the global loading state to true
        gameAssetsLoaded = true;
        
        const transitionDelay = 500;
        
        setTimeout(() => {
            // Fade out loading screen
            loadingScreen.style.transition = 'opacity 0.5s ease';
            loadingScreen.style.opacity = '0';
            setTimeout(() => {
                if (document.body.contains(loadingScreen)) {
                    document.body.removeChild(loadingScreen);
                }
                
                // Re-enable the start button
                startBtn.disabled = false;
                startBtn.style.opacity = "1";
                startBtn.style.cursor = "pointer";
                
                // Execute callback if provided
                if (typeof callback === 'function') {
                    callback();
                }
            }, 500);
        }, transitionDelay);
    }
}

// The click handler for startBtn is already defined earlier in the file

// Draw decorative elements that are within the viewport
function drawDecorativeElements() {
    // Only process elements that could be visible
    for (const element of decorativeElements) {
        // Skip if element is outside viewport
        if (element.x + element.size < camera.x || 
            element.x > camera.x + VIEWPORT_WIDTH ||
            element.y + element.size < camera.y || 
            element.y > camera.y + VIEWPORT_HEIGHT) {
            continue;
        }
        
        // Draw based on element type
        switch(element.type) {
            case 'crystal':
                drawCrystal(element);
                break;
            case 'rock':
                drawRock(element);
                break;
            case 'flower':
                drawFlower(element);
                break;
        }
    }
}

// Draw a crystal formation
function drawCrystal(element) {
    ctx.save();
    ctx.translate(element.x + element.size/2, element.y + element.size/2);
    ctx.rotate(element.rotation);
    
    // Draw crystal shape
    ctx.fillStyle = `rgba(${hexToRgb(element.color)}, ${element.opacity})`;
    ctx.beginPath();
    
    // Simple crystal shape (hexagonal)
    for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        const x = Math.cos(angle) * element.size/2;
        const y = Math.sin(angle) * element.size/2;
        
        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }
    
    ctx.closePath();
    ctx.fill();
    
    // Add highlight
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    ctx.restore();
}

// Draw a rock formation
function drawRock(element) {
    ctx.save();
    ctx.translate(element.x + element.size/2, element.y + element.size/2);
    ctx.rotate(element.rotation);
    
    // Draw rock shape (irregular oval)
    ctx.fillStyle = `rgba(${hexToRgb(element.color)}, ${element.opacity})`;
    ctx.beginPath();
    
    // Draw an irregular boulder shape
    const points = 7;
    for (let i = 0; i < points; i++) {
        const angle = (i / points) * Math.PI * 2;
        const radius = element.size/2 * (0.8 + Math.sin(i * 3) * 0.2);
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        
        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }
    
    ctx.closePath();
    ctx.fill();
    
    // Add dark edge instead of shadow
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    ctx.restore();
}

// Draw a flower formation
function drawFlower(element) {
    ctx.save();
    ctx.translate(element.x + element.size/2, element.y + element.size/2);
    
    // Draw flower petals
    const petalCount = 5;
    const petalLength = element.size / 2;
    const innerRadius = element.size / 6;
    
    for (let i = 0; i < petalCount; i++) {
        const angle = (i / petalCount) * Math.PI * 2 + element.rotation;
        
        // Draw petal
        ctx.fillStyle = `rgba(${hexToRgb(element.color)}, ${element.opacity})`;
        ctx.beginPath();
        ctx.ellipse(
            Math.cos(angle) * petalLength/2, 
            Math.sin(angle) * petalLength/2,
            petalLength, 
            petalLength/3,
            angle,
            0, Math.PI * 2
        );
        ctx.fill();
    }
    
    // Draw center
    ctx.fillStyle = `rgba(255, 255, 150, ${element.opacity + 0.2})`;
    ctx.beginPath();
    ctx.arc(0, 0, innerRadius, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.restore();
}

function getPowerUpIcon(type) {
    switch (type) {
        case 'speed_boost': return '⚡';
        case 'invincibility': return '★';
        case 'magnet': return '🧲';
        default: return '✨';
    }
}
