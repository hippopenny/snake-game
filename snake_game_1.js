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
    
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS && gameRunning) {
        console.log(`Attempting to reconnect (${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})...`);
        setTimeout(() => {
            reconnectAttempts++;
            // Create a new WebSocket connection
            const newSocket = new WebSocket('ws://127.0.0.1:8080');
            
            // Re-attach event handlers
            newSocket.onopen = socket.onopen;
            newSocket.onmessage = socket.onmessage;
            newSocket.onerror = socket.onerror;
            newSocket.onclose = socket.onclose;
            
            // Properly assign the new socket
            socket = newSocket;
        }, RECONNECT_DELAY);
    } else if (gameRunning) {
        alert("Lost connection to server. Please refresh the page to reconnect.");
    }
};

const GRID_SIZE = 50;
let CELL_SIZE = 10; // Size of each cell in pixels

// Set up the game canvas
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

// Adjust the canvas size based on screen size
function getAvailableScreenSize() {
    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;
    
    // Subtract space for UI elements if needed
    const availableWidth = screenWidth - 40; // Adjust as needed
    const availableHeight = screenHeight - 200; // Adjust as needed for UI elements
    
    return { width: availableWidth, height: availableHeight };
}

function adjustCanvasSize() {
    const { width, height } = getAvailableScreenSize();
    
    // Calculate the maximum size that maintains the aspect ratio
    const maxGridSize = Math.min(width, height);
    
    // Set the canvas size
    canvas.width = maxGridSize;
    canvas.height = maxGridSize;
    
    // Adjust the cell size based on the new canvas size
    CELL_SIZE = Math.floor(maxGridSize / GRID_SIZE);
    
    // Update the canvas style to ensure it fits the screen
    canvas.style.width = `${maxGridSize}px`;
    canvas.style.height = `${maxGridSize}px`;
}

// Initialize leaderboard when the document is loaded
document.addEventListener('DOMContentLoaded', () => {
    adjustCanvasSize();
    
    // Initialize heat map
    initHeatMap();
});

function initGame() {
    snake = [
        {x: 5, y: 5},
        {x: 4, y: 5},
        {x: 3, y: 5}
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
    
    // Reset heat map
    initHeatMap();
    
    updateScoreAndLevel();
    updateSpeedDisplay();
    updateHungerBar(); // Initialize hunger bar
    
    // Hide leaderboard by default
    if (bestScoresVisible) {
        toggleBestScores();
    }
    
    gameOverScreen.style.display = 'none';
    levelUpScreen.style.display = 'none';
    
    sendPlayerState();
    
    if (gameLoop) clearInterval(gameLoop);
    gameLoop = setInterval(gameStep, gameSpeed);
    gameRunning = true;
    
    // Start the game loop
    requestAnimationFrame(draw);
}

function draw() {
    // Clear the canvas
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw grid lines
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 0.5;
    
    // Draw vertical grid lines
    for (let x = 0; x <= canvas.width; x += CELL_SIZE) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
    }
    
    // Draw horizontal grid lines
    for (let y = 0; y <= canvas.height; y += CELL_SIZE) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
    }
    
    // Draw foods
    foods.forEach(food => {
        drawFood(food);
    });
    
    // Draw player's snake
    drawSnake(snake, true);
    
    // Draw other players' snakes
    for (const id in players) {
        if (id !== playerId && players[id].snake) {
            drawSnake(players[id].snake, false);
        }
    }
    
    // Draw magnet power-up effect if active
    if (activePowerUp && activePowerUp.type === 'magnet') {
        drawMagnetField();
    }
    
    // Draw particles on top of everything
    updateAndDrawParticles();
    
    // Update minimap and mini leaderboard
    if (minimapVisible) {
        updateMinimap();
    }
    if (bestScoresVisible) {
        updateBestScores();
    }
    
    if (gameRunning) {
        requestAnimationFrame(draw);
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
    snakeBody.forEach((segment, index) => {
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
}

function checkCollisions() {
    const head = snake[0];
    
    // If invincibility is active, skip collision detection
    if (activePowerUp && activePowerUp.type === 'invincibility') {
        return false;
    }
    
    if (head.x < 0 || head.x >= GRID_SIZE || head.y < 0 || head.y >= GRID_SIZE) {
        return true;
    }
    
    for (let i = 1; i < snake.length; i++) {
        if (head.x === snake[i].x && head.y === snake[i].y) {
            return true;
        }
    }
    
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
    
    return false;
}

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
    
    // Clear particles
    particles.length = 0;
    
    // Reset power-up related elements
    powerUpIndicator.style.display = 'none';
    powerUpStatus.style.display = 'none';
    powerUpCountdownContainer.style.display = 'none';
}

function gameOver(reason = 'collision') {
    clearInterval(gameLoop);
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
    
    const cellSize = minimapCanvas.width / GRID_SIZE;
    
    // Draw heat map first (as the background)
    for (let x = 0; x < GRID_SIZE; x++) {
        for (let y = 0; y < GRID_SIZE; y++) {
            if (heatMap[x][y] > 0) {
                // Calculate heat color (from blue to red based on intensity)
                const intensity = Math.min(1, heatMap[x][y] / HEAT_MAX);
                const r = Math.floor(255 * intensity);
                const g = Math.floor(100 * (1 - intensity));
                const b = Math.floor(255 * (1 - intensity));
                const alpha = Math.min(0.7, 0.2 + intensity * 0.5);
                
                minimapCtx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
                minimapCtx.fillRect(
                    x * cellSize,
                    y * cellSize,
                    cellSize,
                    cellSize
                );
            }
        }
    }
    
    // Draw players on top of heat map
    for (const id in players) {
        const player = players[id];
        if (!player.snake || player.snake.length === 0) continue;
        
        const isCurrentPlayer = id === playerId;
        
        player.snake.forEach((segment, index) => {
            minimapCtx.fillStyle = isCurrentPlayer 
                ? (index === 0 ? '#4CAF50' : '#8BC34A') 
                : (index === 0 ? '#3F51B5' : '#7986CB');
            
            minimapCtx.fillRect(
                segment.x * cellSize,
                segment.y * cellSize,
                cellSize,
                cellSize
            );
        });
    }
    
    // Draw foods
    foods.forEach(food => {
        minimapCtx.fillStyle = food.color || '#FF5722';
        minimapCtx.fillRect(
            food.x * cellSize,
            food.y * cellSize,
            cellSize,
            cellSize
        );
    });
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
    
    // Toggle leaderboard with 'L' key
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

// Initialize the joystick
const joystick = nipplejs.create({
    zone: joystickContainer,
    mode: 'static',
    position: { left: '50%', bottom: '50%' },
    color: 'green',
    size: 100
});

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
    // { id: 'minimap', symbol: 'M', title: 'Toggle Minimap' },
    // { id: 'leaderboard', symbol: 'L', title: 'Toggle Leaderboard' }
];

menuButtons.forEach((btn, index) => {
    const button = document.createElement('div');
    button.id = `mobile-${btn.id}`;
    button.className = 'mobile-menu-button';
    button.innerHTML = btn.symbol;
    button.title = btn.title;
    button.style.width = '50px';
    button.style.height = '50px';
    button.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    button.style.color = 'white';
    button.style.borderRadius = '50%';
    button.style.display = 'flex';
    button.style.justifyContent = 'center';
    button.style.alignItems = 'center';
    button.style.fontSize = '20px';
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


// Add CSS for mobile controls
const mobileControlsStyle = document.createElement('style');
mobileControlsStyle.textContent = `
    @media (max-width: 768px) {
        #game-canvas {
            touch-action: none;
        }
        
        .mobile-menu-button:active {
            transform: scale(0.95);
            background-color: rgba(76, 175, 80, 0.7) !important;
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
document.head.appendChild(mobileControlsStyle);

// Call the detection function when the document is loaded
document.addEventListener('DOMContentLoaded', () => {
    detectTouchDevice();
});

function getPowerUpIcon(type) {
    switch (type) {
        case 'speed_boost': return '⚡';
        case 'invincibility': return '★';
        case 'magnet': return '🧲';
        default: return '✨';
    }
}

function updatePowerUpStatus() {
    if (!powerUpCountdownContainer) {
        console.error('Power-up countdown container not initialized');
        return;
    }
    
    if (!activePowerUp) {
        powerUpStatus.style.display = 'none';
        powerUpCountdownContainer.style.display = 'none';
        return;
    }

    const timeLeft = Math.ceil((activePowerUp.expiresAt - Date.now())
    / 1000);
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
    
    powerUpStatus.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center;">
            <span style="color:${powerUpColor}; font-size:22px;">${getPowerUpIcon(activePowerUp.type)} ${powerUpName}</span>
        </div>
        <div style="text-align: center; margin-top: 5px;">
            <span style="color:#FF5722; font-size:28px; font-weight: bold;">${timeLeft}s</span>
        </div>
    `;
    
    powerUpStatus.style.borderColor = powerUpColor;
    powerUpStatus.style.boxShadow = `0 0 15px ${powerUpColor}`;
    powerUpStatus.style.display = 'block';
    
    // Update countdown bar
    const totalDuration = activePowerUp.duration;
    const elapsed = Date.now() - (activePowerUp.expiresAt - totalDuration);
    const remainingPercentage = Math.max(0, Math.min(100, ((totalDuration - elapsed) / totalDuration) * 100));
    
    powerUpCountdownContainer.style.display = 'block';
    powerUpCountdownBar.style.width = `${remainingPercentage}%`;
    powerUpCountdownBar.style.backgroundColor = powerUpColor;
    
    if (timeLeft <= 3) {
        powerUpStatus.style.animation = 'power-up-pulse 0.5s infinite alternate';
        powerUpCountdownBar.style.animation = 'countdown-pulse 0.5s infinite alternate';
        if (!document.getElementById('power-up-pulse-style')) {
            const style = document.createElement('style');
            style.id = 'power-up-pulse-style';
            style.textContent = `
                @keyframes power-up-pulse {
                    from { transform: translateX(-50%) scale(1); }
                    to { transform: translateX(-50%) scale(1.15); }
                }
                @keyframes countdown-pulse {
                    from { opacity: 0.7; }
                    to { opacity: 1; }
                }
            `;
            document.head.appendChild(style);
        }
    } else {
        powerUpStatus.style.animation = '';
        powerUpCountdownBar.style.animation = '';
    }
}
window.addEventListener('resize', adjustCanvasSize);

window.moveSnake = moveSnake;
window.checkCollisions = checkCollisions;
window.updateScoreAndLevel = updateScoreAndLevel;
window.deactivatePowerUp = deactivatePowerUp;
window.gameOver = gameOver;
