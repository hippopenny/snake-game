// Sound manager for Snake Game
class SoundManager {
    constructor() {
        this.sounds = {};
        this.muted = false;
        this.volume = 0.5; // Default volume (0.0 to 1.0)
        this.initialized = false;
    }

    init() {
        if (this.initialized) return;
        
        // Define all sounds
        this.load('eat', 'sounds/eat.mp3');
        this.load('gameOver', 'sounds/gameover.mp3');
        this.load('gameOverFull', 'sounds/gameoverFull.wav');
        this.load('powerUp', 'sounds/powerup.wav');
        this.load('move', 'sounds/click.wav');
        this.load('select', 'sounds/select.wav');
        this.load('levelUp', 'sounds/levelup.mp3');
        this.load('levelComplete', 'sounds/levelcomplete.mp3');
        this.load('collision', 'sounds/notification.wav');
        this.load('menuSelect', 'sounds/menuSelect.wav');
        this.load('menuClick', 'sounds/click.wav');
        this.load('teleport', 'sounds/transition.wav');
        this.load('heartbeat', 'sounds/heartbeat.mp3');
        this.load('background', 'sounds/backgroundMusic.wav');
        this.load('bonus', 'sounds/bonus.wav');
        this.load('ambient', 'sounds/ambient.wav');
        
        // Create mute/unmute button
        this.createMuteButton();
        
        this.initialized = true;
    }
    
    // Load a sound from file
    load(name, path) {
        const audio = new Audio(path);
        audio.volume = this.volume;
        this.sounds[name] = audio;
        
        // Preload audio
        audio.load();
        
        return audio;
    }
    
    // Play a sound by name
    play(name, options = {}) {
        if (this.muted) return;
        
        const sound = this.sounds[name];
        if (!sound) return;
        
        // Reset the sound to start from beginning if it's already playing
        sound.currentTime = 0;
        
        // Apply options
        if (options.volume !== undefined) {
            sound.volume = options.volume * this.volume;
        } else {
            sound.volume = this.volume;
        }
        
        if (options.loop !== undefined) {
            sound.loop = options.loop;
        }
        
        // Play the sound
        sound.play().catch(error => {
            console.log(`Error playing sound ${name}: ${error.message}`);
        });
        
        return sound;
    }
    
    // Stop a sound
    stop(name) {
        const sound = this.sounds[name];
        if (!sound) return;
        
        sound.pause();
        sound.currentTime = 0;
    }
    
    // Stop all sounds
    stopAll() {
        for (const name in this.sounds) {
            this.stop(name);
        }
    }
    
    // Toggle mute status
    toggleMute() {
        this.muted = !this.muted;
        this.updateMuteButton();
        
        // If unmuting, play a quick sound to indicate sound is on
        if (!this.muted) {
            this.play('menuSelect', { volume: 0.3 });
        }
        
        return this.muted;
    }
    
    // Update the mute button to reflect current state
    updateMuteButton() {
        const muteButton = document.getElementById('mute-button');
        if (!muteButton) return;
        
        muteButton.textContent = this.muted ? '🔇' : '🔊';
        muteButton.title = this.muted ? 'Unmute' : 'Mute';
    }
    
    // Create a mute button in the top-right corner
    createMuteButton() {
        // Remove existing button if any
        const existingButton = document.getElementById('mute-button');
        if (existingButton) {
            existingButton.remove();
        }
        
        const muteButton = document.createElement('button');
        muteButton.id = 'mute-button';
        muteButton.textContent = this.muted ? '🔇' : '🔊';
        muteButton.title = this.muted ? 'Unmute' : 'Mute';
        muteButton.style.position = 'absolute';
        muteButton.style.top = '10px';
        muteButton.style.right = '10px';
        muteButton.style.fontSize = '24px';
        muteButton.style.width = '40px';
        muteButton.style.height = '40px';
        muteButton.style.borderRadius = '50%';
        muteButton.style.border = 'none';
        muteButton.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        muteButton.style.color = 'white';
        muteButton.style.cursor = 'pointer';
        muteButton.style.zIndex = '1002';
        muteButton.style.display = 'flex';
        muteButton.style.alignItems = 'center';
        muteButton.style.justifyContent = 'center';
        
        muteButton.addEventListener('click', () => {
            this.toggleMute();
        });
        
        document.body.appendChild(muteButton);
    }
    
    // Set global volume
    setVolume(level) {
        this.volume = Math.max(0, Math.min(1, level));
        
        // Update all sound volumes
        for (const name in this.sounds) {
            this.sounds[name].volume = this.volume;
        }
    }
}

// Create a single sound manager instance that can be used everywhere
const soundManager = new SoundManager();
