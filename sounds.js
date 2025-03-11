// Sound manager for Snake Game
class SoundManager {
    constructor() {
        this.sounds = {};
        this.muted = false;
        this.volume = 0.5; // Default volume (0.0 to 1.0)
        this.initialized = false;
        this.soundPaths = {
            'eat': 'sounds/eat.mp3',
            'gameOver': 'sounds/gameoverFull.wav',
            'powerUp': 'sounds/powerup.wav',
            'move': 'sounds/click.wav',
            'select': 'sounds/select.wav',
            'levelUp': 'sounds/levelup.mp3',
            'levelComplete': 'sounds/levelcomplete.mp3',
            'collision': 'sounds/notification.wav',
            'menuSelect': 'sounds/menuSelect.wav',
            'menuClick': 'sounds/click.wav',
            'teleport': 'sounds/transition.wav',
            'heartbeat': 'sounds/heartbeat.mp3',
            'background': 'sounds/backgroundMusic.wav',
            'bonus': 'sounds/bonus.wav',
            'ambient': 'sounds/ambient.wav'
        };
        
        // Preload common UI sounds and background music
        this.commonSounds = ['menuClick', 'menuSelect', 'select', 'background'];
        this.backgroundMusic = null; // Store reference to background music
    }

    init() {
        if (this.initialized) return;
        
        // Preload only essential sounds initially
        this.commonSounds.forEach(sound => {
            this.load(sound, this.soundPaths[sound]);
        });
        
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
    
    // Load sound on-demand if needed
    ensureLoaded(name) {
        // Check if the sound is already loaded
        if (!this.sounds[name] && this.soundPaths[name]) {
            // Load it now
            this.load(name, this.soundPaths[name]);
        }
        return this.sounds[name];
    }
    
    // Play a sound by name
    play(name, options = {}) {
        if (this.muted) return;
        
        // Load the sound if it's not already loaded
        this.ensureLoaded(name);
        
        const sound = this.sounds[name];
        if (!sound) {
            console.log(`Sound not found: ${name}`);
            return;
        }
        
        try {
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
            const playPromise = sound.play();
            if (playPromise !== undefined) {
                playPromise.catch(error => {
                    console.log(`Error playing sound ${name}: ${error.message}`);
                });
            }
            
            return sound;
        } catch (error) {
            console.log(`Exception playing sound ${name}: ${error.message}`);
            return null;
        }
    }
    
    // Play background music (loops automatically)
    playBackgroundMusic() {
        if (this.muted) return;
        
        // Stop any currently playing background music
        if (this.backgroundMusic) {
            this.stop('background');
        }
        
        // Load and play the background music
        this.ensureLoaded('background');
        const music = this.sounds['background'];
        if (!music) return;
        
        music.loop = true;
        music.volume = this.volume * 0.3; // Lower volume for background music
        
        music.play().catch(error => {
            console.log(`Error playing background music: ${error.message}`);
        });
        
        this.backgroundMusic = music;
        return music;
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
