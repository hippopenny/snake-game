let playerId = null;
let players = {};
let snake = [];
let foods = [];
let direction = 'right';
let nextDirection = 'right';
let baseGameSpeed = 150;
let gameSpeed = baseGameSpeed;
let gameRunning = false;
let score = 0;
let highestScore = 0;
let level = 1;
let gameLoop;
let minimapVisible = true;
let leaderboardVisible = true;
let miniLeaderboardVisible = true;
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
const levelProgressBar = document.getElementById('level-progress-bar');
const levelProgressText = document.getElementById('level-progress-text');
const minimapCanvas = document.getElementById('minimap');
const minimapCtx = minimapCanvas.getContext('2d');
const minimapToggle = document.getElementById('minimap-toggle');

minimapCanvas.width = 150;
minimapCanvas.height = 150;

// Initialize heat map
function initHeatMap() {
    heatMap = new Array(GRID_SIZE);
    for (let i = 0; i < GRID_SIZE; i++) {
        heatMap[i] = new Array(GRID_SIZE).fill(0);
    }
}

// Create mini leaderboard container
const miniLeaderboardContainer = document.createElement('div');
miniLeaderboardContainer.id = 'mini-leaderboard';
miniLeaderboardContainer.style.position = 'absolute';
miniLeaderboardContainer.style.bottom = '10px';
miniLeaderboardContainer.style.right = '10px';
miniLeaderboardContainer.style.width = '150px';
miniLeaderboardContainer.style.height = '150px';
miniLeaderboardContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
miniLeaderboardContainer.style.border = '2px solid #444';
miniLeaderboardContainer.style.borderRadius = '5px';
miniLeaderboardContainer.style.color = 'white';
miniLeaderboardContainer.style.padding = '5px';
miniLeaderboardContainer.style.overflow = 'hidden';
miniLeaderboardContainer.style.fontFamily = 'Arial, sans-serif';
miniLeaderboardContainer.style.fontSize = '12px';
document.body.appendChild(miniLeaderboardContainer);

// Create mini leaderboard toggle button
const miniLeaderboardToggle = document.createElement('div');
miniLeaderboardToggle.id = 'mini-leaderboard-toggle';
miniLeaderboardToggle.className = 'game-control-icon';
miniLeaderboardToggle.innerHTML = 'L';
miniLeaderboardToggle.title = 'Toggle Mini Leaderboard';
miniLeaderboardToggle.style.position = 'absolute';
miniLeaderboardToggle.style.bottom = '130px';
miniLeaderboardToggle.style.right = '20px';
miniLeaderboardToggle.style.width = '30px';
miniLeaderboardToggle.style.height = '30px';
miniLeaderboardToggle.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
miniLeaderboardToggle.style.color = 'white';
miniLeaderboardToggle.style.borderRadius = '50%';
miniLeaderboardToggle.style.display = 'flex';
miniLeaderboardToggle.style.justifyContent = 'center';
miniLeaderboardToggle.style.alignItems = 'center';
miniLeaderboardToggle.style.cursor = 'pointer';
miniLeaderboardToggle.style.zIndex = '1000';
miniLeaderboardToggle.style.border = '2px solid #444';
miniLeaderboardToggle.style.fontWeight = 'bold';
document.body.appendChild(miniLeaderboardToggle);

// Mini leaderboard toggle functionality
miniLeaderboardToggle.addEventListener('click', toggleMiniLeaderboard);

function toggleMiniLeaderboard() {
    miniLeaderboardVisible = !miniLeaderboardVisible;
    miniLeaderboardContainer.style.display = miniLeaderboardVisible ? 'block' : 'none';
    miniLeaderboardToggle.textContent = 'L';
    if (miniLeaderboardVisible) {
        updateMiniLeaderboard();
    }
}

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

const socket = new WebSocket('ws://127.0.0.1:8080');

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
        updatePlayersCount();
        if (minimapVisible) {
            updateMinimap();
        }
        if (miniLeaderboardVisible) {
            updateMiniLeaderboard();
        }
    }
};

socket.onerror = (error) => {
    console.error('WebSocket error:', error);
};

socket.onclose = () => {
    console.log('Disconnected from server');
};

const GRID_SIZE = 50;
const CELL_SIZE = 10; // Size of each cell in pixels

// Set up the game canvas
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

// Set canvas size based on grid size and cell size
canvas.width = GRID_SIZE * CELL_SIZE;
canvas.height = GRID_SIZE * CELL_SIZE;

// Initialize leaderboard when the document is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Initialize the leaderboard
    if (window.Leaderboard) {
        window.Leaderboard.init();
    }
    
    // Add leaderboard button to game UI
    const gameContainer = document.querySelector('.game-container');
    if (gameContainer) {
        const leaderboardBtn = document.createElement('button');
        leaderboardBtn.id = 'leaderboard-btn';
        leaderboardBtn.textContent = 'L';
        leaderboardBtn.className = 'game-button toggle-button';
        leaderboardBtn.addEventListener('click', toggleLeaderboard);
        gameContainer.appendChild(leaderboardBtn);
    }
    
    // Initialize mini leaderboard
    updateMiniLeaderboard();
    
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
    
    // Reset heat map
    initHeatMap();
    
    updateScoreAndLevel();
    updateSpeedDisplay();
    updateLevelProgress();
    
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
    
    // Update minimap and mini leaderboard
    if (minimapVisible) {
        updateMinimap();
    }
    if (miniLeaderboardVisible) {
        updateMiniLeaderboard();
    }
    
    if (gameRunning) {
        requestAnimationFrame(draw);
    }
}

function drawFood(food) {
    ctx.fillStyle = food.blinking ? (Math.floor(Date.now() / 250) % 2 === 0 ? food.color : '#FFFFFF') : food.color;
    ctx.beginPath();
    ctx.arc(
        food.x * CELL_SIZE + CELL_SIZE / 2,
        food.y * CELL_SIZE + CELL_SIZE / 2,
        CELL_SIZE / 2,
        0,
        Math.PI * 2
    );
    ctx.fill();
    
    // Draw countdown
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '10px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(food.countdown, food.x * CELL_SIZE + CELL_SIZE / 2, food.y * CELL_SIZE + CELL_SIZE / 2);
    
    // Food spawn animation
    if (Date.now() - food.createdAt < 1000) {
        const progress = (Date.now() - food.createdAt) / 1000;
        const size = CELL_SIZE * (0.5 + 0.5 * Math.sin(progress * Math.PI));
        ctx.strokeStyle = food.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(
            food.x * CELL_SIZE + CELL_SIZE / 2,
            food.y * CELL_SIZE + CELL_SIZE / 2,
            size / 2,
            0,
            Math.PI * 2
        );
        ctx.stroke();
    }
}

function drawSnake(snakeBody, isCurrentPlayer) {
    snakeBody.forEach((segment, index) => {
        // Choose color based on whether it's the current player and if it's the head
        if (isCurrentPlayer) {
            ctx.fillStyle = index === 0 ? '#4CAF50' : '#8BC34A';
        } else {
            ctx.fillStyle = index === 0 ? '#3F51B5' : '#7986CB';
        }
        
        // Draw rounded rectangle for snake segments
        const x = segment.x * CELL_SIZE;
        const y = segment.y * CELL_SIZE;
        const size = CELL_SIZE;
        const radius = index === 0 ? CELL_SIZE / 3 : CELL_SIZE / 4;
        
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + size - radius, y);
        ctx.quadraticCurveTo(x + size, y, x + size, y + radius);
        ctx.lineTo(x + size, y + size - radius);
        ctx.quadraticCurveTo(x + size, y + size, x + size - radius, y + size);
        ctx.lineTo(x + radius, y + size);
        ctx.quadraticCurveTo(x, y + size, x, y + size - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
        ctx.fill();
        
        // Add eyes to the head
        if (index === 0) {
            ctx.fillStyle = 'white';
            
            // Position eyes based on direction
            let eyeX1, eyeY1, eyeX2, eyeY2;
            const eyeSize = CELL_SIZE / 5;
            const eyeOffset = CELL_SIZE / 4;
            
            switch (isCurrentPlayer ? direction : 'right') { // Default to right for other players
                case 'up':
                    eyeX1 = x + eyeOffset;
                    eyeY1 = y + eyeOffset;
                    eyeX2 = x + size - eyeOffset - eyeSize;
                    eyeY2 = y + eyeOffset;
                    break;
                case 'down':
                    eyeX1 = x + eyeOffset;
                    eyeY1 = y + size - eyeOffset - eyeSize;
                    eyeX2 = x + size - eyeOffset - eyeSize;
                    eyeY2 = y + size - eyeOffset - eyeSize;
                    break;
                case 'left':
                    eyeX1 = x + eyeOffset;
                    eyeY1 = y + eyeOffset;
                    eyeX2 = x + eyeOffset;
                    eyeY2 = y + size - eyeOffset - eyeSize;
                    break;
                case 'right':
                    eyeX1 = x + size - eyeOffset - eyeSize;
                    eyeY1 = y + eyeOffset;
                    eyeX2 = x + size - eyeOffset - eyeSize;
                    eyeY2 = y + size - eyeOffset - eyeSize;
                    break;
            }
            
            ctx.fillRect(eyeX1, eyeY1, eyeSize, eyeSize);
            ctx.fillRect(eyeX2, eyeY2, eyeSize, eyeSize);
        }
    });
}

function updateScoreAndLevel() {
    // Update highest score if current score is higher
    if (score > highestScore) {
        highestScore = score;
    }
    
    scoreDisplay.textContent = `Score: ${score} (Best: ${highestScore})`;
    levelDisplay.textContent = `Level: ${level}`;
}

function updateSpeedDisplay() {
    const speedMultiplier = (baseGameSpeed / gameSpeed).toFixed(1);
    speedDisplay.textContent = `Speed: ${speedMultiplier}x`;
}

function updateLevelProgress() {
    const currentThreshold = levelThresholds[level - 1];
    const nextThreshold = level < levelThresholds.length ? levelThresholds[level] : Infinity;
    
    const progressPoints = score - currentThreshold;
    const totalPointsNeeded = nextThreshold - currentThreshold;
    const progressPercentage = Math.min(100, (progressPoints / totalPointsNeeded) * 100);
    
    levelProgressBar.style.width = `${progressPercentage}%`;
    
    if (level < levelThresholds.length) {
        const pointsToNextLevel = nextThreshold - score;
        levelProgressText.textContent = `${progressPoints}/${totalPointsNeeded} points (${pointsToNextLevel} more to level ${level + 1})`;
    } else {
        levelProgressText.textContent = `Max level reached!`;
    }
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
    if (playerId && socket.readyState === WebSocket.OPEN) {
        const playerState = {
            type: 'update',
            id: playerId,
            snake: snake,
            score: score,
            level: level
        };
        socket.send(JSON.stringify(playerState));
    }
}

function gameStep() {
    direction = nextDirection;
    
    moveSnake();
    
    if (checkCollisions()) {
        gameOver();
        return;
    }
    
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
            updateLevelProgress();
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
}

function showFoodEffect(food) {
    const effectDiv = document.createElement('div');
    effectDiv.textContent = `+${food.points}`;
    effectDiv.style.position = 'absolute';
    effectDiv.style.left = `${food.x * CELL_SIZE}px`;
    effectDiv.style.top = `${food.y * CELL_SIZE}px`;
    effectDiv.style.color = food.color;
    effectDiv.style.fontSize = '20px';
    effectDiv.style.fontWeight = 'bold';
    effectDiv.style.pointerEvents = 'none';
    document.body.appendChild(effectDiv);
    
    let opacity = 1;
    const fadeEffect = setInterval(() => {
        if (opacity <= 0) {
            clearInterval(fadeEffect);
            document.body.removeChild(effectDiv);
        } else {
            opacity -= 0.1;
            effectDiv.style.opacity = opacity;
            effectDiv.style.top = `${parseFloat(effectDiv.style.top) - 1}px`;
        }
    }, 50);
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

function gameOver() {
    clearInterval(gameLoop);
    gameRunning = false;
    finalScoreDisplay.textContent = `Score: ${score} (Best: ${highestScore})`;
    finalLevelDisplay.textContent = `Level: ${level}`;
    gameOverScreen.style.display = 'block';
    
    // Check if the Leaderboard module is available
    if (window.Leaderboard) {
        // Check if the score qualifies for the leaderboard
        if (window.Leaderboard.isHighScore(score)) {
            // Prompt for player name and add to leaderboard
            window.Leaderboard.prompt(score, level);
        }
    }
    
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'gameOver',
            id: playerId
        }));
    }
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

// Update and render the mini leaderboard
function updateMiniLeaderboard() {
    // Clear the mini leaderboard
    miniLeaderboardContainer.innerHTML = '';
    
    // Add title
    const title = document.createElement('div');
    title.style.fontWeight = 'bold';
    title.style.textAlign = 'center';
    title.style.borderBottom = '1px solid #444';
    title.style.marginBottom = '5px';
    title.style.paddingBottom = '3px';
    title.textContent = 'Live Leaderboard';
    miniLeaderboardContainer.appendChild(title);
    
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
    
    // Create table for scores
    const table = document.createElement('table');
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';
    table.style.fontSize = '11px';
    
    // Add header row
    const headerRow = document.createElement('tr');
    
    const rankHeader = document.createElement('th');
    rankHeader.textContent = '#';
    rankHeader.style.textAlign = 'left';
    rankHeader.style.width = '15%';
    
    const nameHeader = document.createElement('th');
    nameHeader.textContent = 'Player';
    nameHeader.style.textAlign = 'left';
    nameHeader.style.width = '45%';
    
    const scoreHeader = document.createElement('th');
    scoreHeader.textContent = 'Score';
    scoreHeader.style.textAlign = 'right';
    scoreHeader.style.width = '40%';
    
    headerRow.appendChild(rankHeader);
    headerRow.appendChild(nameHeader);
    headerRow.appendChild(scoreHeader);
    table.appendChild(headerRow);
    
    // Add player rows
    sortedPlayers.forEach(([id, player], index) => {
        const row = document.createElement('tr');
        
        const isCurrentPlayer = id === playerId;
        if (isCurrentPlayer) {
            row.style.color = '#4CAF50';
            row.style.fontWeight = 'bold';
        }
        
        const rankCell = document.createElement('td');
        rankCell.textContent = `${index + 1}`;
        
        const nameCell = document.createElement('td');
        nameCell.textContent = isCurrentPlayer ? 'You' : `P${id.slice(-3)}`;
        
        const scoreCell = document.createElement('td');
        scoreCell.textContent = `${player.score}`;
        scoreCell.style.textAlign = 'right';
        
        row.appendChild(rankCell);
        row.appendChild(nameCell);
        row.appendChild(scoreCell);
        table.appendChild(row);
    });
    
    miniLeaderboardContainer.appendChild(table);
    
    // Add note at the bottom if no players
    if (sortedPlayers.length === 0) {
        const noPlayers = document.createElement('div');
        noPlayers.style.textAlign = 'center';
        noPlayers.style.marginTop = '20px';
        noPlayers.style.fontStyle = 'italic';
        noPlayers.textContent = 'No players yet';
        miniLeaderboardContainer.appendChild(noPlayers);
    }
}

function updatePlayersCount() {
    const count = Object.keys(players).length;
    playersCountDisplay.textContent = `Players: ${count}`;
}

function toggleLeaderboard() {
    if (window.Leaderboard) {
        leaderboardVisible = !leaderboardVisible;
        window.Leaderboard.toggle(leaderboardVisible);
    }
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

// Handle keyboard controls
document.addEventListener('keydown', function(e) {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd', 'W', 'A', 'S', 'D', 'm', 'M', 'l', 'L'].includes(e.key)) {
        e.preventDefault();
    }
    
    // Toggle minimap with 'M' key
    if (e.key === 'm' || e.key === 'M') {
        toggleMinimap();
        return;
    }
    
    // Toggle mini leaderboard with 'L' key
    if (e.key === 'l' || e.key === 'L') {
        toggleMiniLeaderboard();
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
