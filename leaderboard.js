/**
 * Leaderboard functionality for the Snake Game
 * Handles storing, retrieving, and displaying high scores
 */

// Constants
const LEADERBOARD_KEY = 'snake_game_leaderboard';
const MAX_LEADERBOARD_ENTRIES = 10;

// Leaderboard state
let leaderboard = [];
let leaderboardContainer = null;

/**
 * Initialize the leaderboard
 */
function initLeaderboard() {
    loadLeaderboard();
    createLeaderboardHTML();
    createLeaderboardIcon();
    
    // Add event listeners for leaderboard controls
    document.addEventListener('DOMContentLoaded', () => {
        const closeBtn = document.getElementById('leaderboard-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => hideLeaderboard());
        }
        
        const clearBtn = document.getElementById('clear-leaderboard');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (confirm('Are you sure you want to clear the leaderboard?')) {
                    clearLeaderboard();
                }
            });
        }
    });
}

/**
 * Create a leaderboard toggle icon
 */
function createLeaderboardIcon() {
    if (!document.getElementById('leaderboard-icon')) {
        const leaderboardIcon = document.createElement('div');
        leaderboardIcon.id = 'leaderboard-icon';
        leaderboardIcon.className = 'game-control-icon';
        leaderboardIcon.innerHTML = 'L';
        leaderboardIcon.title = 'Toggle Leaderboard';
        
        // Add styles directly to the element
        leaderboardIcon.style.position = 'absolute';
        leaderboardIcon.style.bottom = '10px';
        leaderboardIcon.style.right = '10px';
        leaderboardIcon.style.width = '30px';
        leaderboardIcon.style.height = '30px';
        leaderboardIcon.style.backgroundColor = '#4CAF50';
        leaderboardIcon.style.color = 'white';
        leaderboardIcon.style.borderRadius = '50%';
        leaderboardIcon.style.display = 'flex';
        leaderboardIcon.style.justifyContent = 'center';
        leaderboardIcon.style.alignItems = 'center';
        leaderboardIcon.style.cursor = 'pointer';
        leaderboardIcon.style.fontWeight = 'bold';
        leaderboardIcon.style.zIndex = '1000';
        leaderboardIcon.style.boxShadow = '0 2px 5px rgba(0,0,0,0.3)';
        
        // Add to the game container or body
        const gameContainer = document.querySelector('.game-container');
        if (gameContainer) {
            gameContainer.appendChild(leaderboardIcon);
        } else {
            document.body.appendChild(leaderboardIcon);
        }
        
        // Add click event to toggle leaderboard
        leaderboardIcon.addEventListener('click', () => toggleLeaderboard());
    }
}

/**
 * Load leaderboard data from localStorage
 */
function loadLeaderboard() {
    const storedData = localStorage.getItem(LEADERBOARD_KEY);
    if (storedData) {
        try {
            leaderboard = JSON.parse(storedData);
        } catch (e) {
            console.error('Error parsing leaderboard data:', e);
            leaderboard = [];
        }
    } else {
        leaderboard = [];
    }
}

/**
 * Save leaderboard data to localStorage
 */
function saveLeaderboard() {
    try {
        localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(leaderboard));
    } catch (e) {
        console.error('Error saving leaderboard data:', e);
    }
}

/**
 * Add a new score to the leaderboard
 * @param {string} playerName - The name of the player
 * @param {number} score - The player's score
 * @param {number} level - The level reached
 * @returns {boolean} - Whether the score made it onto the leaderboard
 */
function addScore(playerName, score, level) {
    // Create a new score entry
    const newEntry = {
        name: playerName || 'Anonymous',
        score: score,
        level: level,
        date: new Date().toISOString()
    };
    
    // Add to leaderboard
    leaderboard.push(newEntry);
    
    // Sort by score (highest first)
    leaderboard.sort((a, b) => b.score - a.score);
    
    // Trim to max entries
    if (leaderboard.length > MAX_LEADERBOARD_ENTRIES) {
        leaderboard = leaderboard.slice(0, MAX_LEADERBOARD_ENTRIES);
    }
    
    // Save updated leaderboard
    saveLeaderboard();
    
    // Update the display if visible
    if (leaderboardContainer && leaderboardContainer.style.display !== 'none') {
        renderLeaderboard();
    }
    
    // Check if the new score made it onto the leaderboard
    return leaderboard.some(entry => entry === newEntry);
}

/**
 * Clear all leaderboard entries
 */
function clearLeaderboard() {
    leaderboard = [];
    saveLeaderboard();
    renderLeaderboard();
}

/**
 * Render the leaderboard in the UI
 */
function renderLeaderboard() {
    const leaderboardContent = document.getElementById('leaderboard-content');
    if (!leaderboardContent) return;
    
    // Clear existing entries
    leaderboardContent.innerHTML = '<h3>Top Scores</h3>';
    
    if (leaderboard.length === 0) {
        const emptyMessage = document.createElement('div');
        emptyMessage.className = 'empty-leaderboard';
        emptyMessage.textContent = 'No scores yet. Be the first!';
        leaderboardContent.appendChild(emptyMessage);
        return;
    }
    
    // Create a table for the leaderboard
    const table = document.createElement('table');
    table.className = 'leaderboard-table';
    
    // Add header row
    const headerRow = document.createElement('tr');
    headerRow.innerHTML = `
        <th>Rank</th>
        <th>Name</th>
        <th>Score</th>
        <th>Level</th>
    `;
    table.appendChild(headerRow);
    
    // Add each entry to the table
    leaderboard.forEach((entry, index) => {
        const row = document.createElement('tr');
        
        row.innerHTML = `
            <td>${index + 1}</td>
            <td>${entry.name}</td>
            <td>${entry.score}</td>
            <td>${entry.level}</td>
        `;
        
        table.appendChild(row);
    });
    
    leaderboardContent.appendChild(table);
    
    // Add clear button
    const clearButton = document.createElement('button');
    clearButton.id = 'clear-leaderboard';
    clearButton.textContent = 'Clear Scores';
    clearButton.className = 'leaderboard-button';
    clearButton.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear the leaderboard?')) {
            clearLeaderboard();
        }
    });
    
    leaderboardContent.appendChild(clearButton);
}

/**
 * Show the leaderboard panel
 */
function showLeaderboard() {
    if (leaderboardContainer) {
        renderLeaderboard();
        leaderboardContainer.style.display = 'block';
    }
}

/**
 * Hide the leaderboard panel
 */
function hideLeaderboard() {
    if (leaderboardContainer) {
        leaderboardContainer.style.display = 'none';
    }
}

/**
 * Toggle the leaderboard display
 * @param {boolean} [forceState] - Optional state to force (true for show, false for hide)
 */
function toggleLeaderboard(forceState) {
    if (leaderboardContainer) {
        const newState = forceState !== undefined ? forceState : 
            leaderboardContainer.style.display !== 'block';
        
        if (newState) {
            showLeaderboard();
        } else {
            hideLeaderboard();
        }
    }
}

/**
 * Check if a score qualifies for the leaderboard
 * @param {number} score - The score to check
 * @returns {boolean} - Whether the score qualifies
 */
function isLeaderboardScore(score) {
    if (leaderboard.length < MAX_LEADERBOARD_ENTRIES) {
        return true;
    }
    
    // Check if score is higher than the lowest score on the leaderboard
    const lowestScore = leaderboard[leaderboard.length - 1].score;
    return score > lowestScore;
}

/**
 * Prompt the user for their name and add their score to the leaderboard
 * @param {number} score - The player's score
 * @param {number} level - The level reached
 */
function promptForLeaderboard(score, level) {
    if (!isLeaderboardScore(score)) {
        showLeaderboard();
        return;
    }
    
    // Create a modal for name input if it doesn't exist
    let nameModal = document.getElementById('name-input-modal');
    if (!nameModal) {
        nameModal = document.createElement('div');
        nameModal.className = 'modal';
        nameModal.id = 'name-input-modal';
        nameModal.innerHTML = `
            <div class="modal-content">
                <h2>New High Score: ${score}!</h2>
                <p>Enter your name for the leaderboard:</p>
                <input type="text" id="player-name-input" maxlength="15" placeholder="Your Name">
                <button id="submit-score">Submit</button>
            </div>
        `;
        
        document.body.appendChild(nameModal);
    } else {
        // Update the score display
        nameModal.querySelector('h2').textContent = `New High Score: ${score}!`;
    }
    
    nameModal.style.display = 'flex';
    
    // Focus the input field
    const nameInput = document.getElementById('player-name-input');
    nameInput.value = '';
    nameInput.focus();
    
    // Remove old event listeners
    const submitBtn = document.getElementById('submit-score');
    const newSubmitBtn = submitBtn.cloneNode(true);
    submitBtn.parentNode.replaceChild(newSubmitBtn, submitBtn);
    
    // Handle submit button click
    newSubmitBtn.addEventListener('click', () => {
        const playerName = nameInput.value.trim() || 'Anonymous';
        addScore(playerName, score, level);
        nameModal.style.display = 'none';
        showLeaderboard();
    });
    
    // Handle Enter key
    nameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            newSubmitBtn.click();
        }
    });
}

/**
 * Create HTML structure for leaderboard if it doesn't exist
 */
function createLeaderboardHTML() {
    if (!document.getElementById('leaderboard-container')) {
        leaderboardContainer = document.createElement('div');
        leaderboardContainer.id = 'leaderboard-container';
        leaderboardContainer.className = 'game-panel';
        leaderboardContainer.innerHTML = `
            <div id="leaderboard-header">
                <h3>Leaderboard</h3>
                <button id="leaderboard-close">&times;</button>
            </div>
            <div id="leaderboard-content">
                <!-- Leaderboard entries will be inserted here -->
            </div>
        `;
        
        // Add styles directly to the leaderboard container
        leaderboardContainer.style.position = 'absolute';
        leaderboardContainer.style.bottom = '50px';
        leaderboardContainer.style.right = '10px';
        leaderboardContainer.style.width = '300px';
        leaderboardContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
        leaderboardContainer.style.color = 'white';
        leaderboardContainer.style.padding = '10px';
        leaderboardContainer.style.borderRadius = '5px';
        leaderboardContainer.style.zIndex = '900';
        leaderboardContainer.style.display = 'none'; // Hidden by default
        leaderboardContainer.style.maxHeight = '300px';
        leaderboardContainer.style.overflowY = 'auto';
        
        // Add to the game container
        const gameContainer = document.querySelector('.game-container');
        if (gameContainer) {
            gameContainer.appendChild(leaderboardContainer);
        } else {
            document.body.appendChild(leaderboardContainer);
        }
        
        // Add event listeners
        document.getElementById('leaderboard-close').addEventListener('click', () => hideLeaderboard());
        
        // Initial render
        renderLeaderboard();
    }
}

// Initialize when the script loads
document.addEventListener('DOMContentLoaded', () => {
    initLeaderboard();
});

// Add keyboard shortcut for toggling leaderboard
document.addEventListener('keydown', (e) => {
    if (e.key === 'l' || e.key === 'L') {
        toggleLeaderboard();
    }
});

// Export functions for use in other modules
window.Leaderboard = {
    init: initLeaderboard,
    add: addScore,
    show: showLeaderboard,
    hide: hideLeaderboard,
    clear: clearLeaderboard,
    prompt: promptForLeaderboard,
    isHighScore: isLeaderboardScore,
    toggle: toggleLeaderboard
};
