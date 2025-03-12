// Sound manager for Snake Game
class SoundManager {
    constructor() {
        this.sounds = {};
        this.muted = false;
        this.volume = 0.5; // Default volume (0.0 to 1.0)
        this.initialized = false;
        this.soundPaths = {
            'eat': 'sounds/eat.mp3',
            'gameOver': 'sounds/gameover.mp3',
            'powerUp': 'sounds/powerup.wav',
            'select': 'sounds/select.wav',
            'levelUp': 'sounds/levelcomplete.mp3',
            'collision': 'sounds/notification.wav',
            'menuSelect': 'sounds/menuSelect.wav',
            'teleport': 'sounds/transition.wav',
            'heartbeat': 'sounds/heartbeat.mp3',
            'background': 'sounds/backgroundMusic.mp3',
            'bonus': 'sounds/bonus.wav'
        };
        
        // Preload common UI sounds and background music
        this.commonSounds = ['menuSelect', 'menuSelect', 'select', 'background'];
        this.backgroundMusic = null; // Store reference to background music
    }

    init() {
        if (this.initialized) return;
        
        // Track loading progress
        let loadedCount = 0;
        const totalSounds = Object.keys(this.soundPaths).length;
        
        // Update loading progress in UI
        const updateLoadingProgress = () => {
            loadedCount++;
            const progress = (loadedCount / totalSounds) * 100;
            const loadingProgress = document.getElementById('loading-progress');
            if (loadingProgress) {
                loadingProgress.style.width = `${progress}%`;
            }
            const loadingText = document.getElementById('loading-text');
            if (loadingText) {
                loadingText.textContent = `Loading sounds... ${Math.floor(progress)}%`;
            }
            
            // If all sounds are loaded, set global loaded state
            if (loadedCount >= totalSounds && typeof window.gameAssetsLoaded !== 'undefined') {
                window.gameAssetsLoaded = true;
            }
        };
        
        // Preload only essential sounds for initial startup
        const essentialSounds = ['menuSelect', 'select'];
        
        // Load essential sounds immediately
        for (const soundName of essentialSounds) {
            if (this.soundPaths[soundName]) {
                this.load(soundName, this.soundPaths[soundName], updateLoadingProgress);
            }
        }
        
        // Load remaining sounds after a delay
        setTimeout(() => {
            for (const soundName in this.soundPaths) {
                // Skip already loaded sounds
                if (essentialSounds.includes(soundName)) continue;
                this.load(soundName, this.soundPaths[soundName], updateLoadingProgress);
            }
        }, 500);
        
        this.initialized = true;
    }
    
    // Load a sound from file
    load(name, path, callback) {
        const audio = new Audio(path);
        audio.volume = this.volume;
        this.sounds[name] = audio;
        
        // Preload audio
        audio.load();
        
        // Set a flag to track if callback was already called
        let callbackFired = false;
        
        // Add event listener for when loading completes
        audio.addEventListener('canplaythrough', () => {
            if (!callbackFired && callback) {
                callbackFired = true;
                callback();
                
                // Dispatch a custom event to notify the loading screen
                window.dispatchEvent(new CustomEvent('assetLoaded', { 
                    detail: { sound: name } 
                }));
            }
        }, { once: true });
        
        // Handle audio loading errors
        audio.addEventListener('error', () => {
            console.warn(`Error loading sound: ${name}`);
            if (!callbackFired && callback) {
                callbackFired = true;
                callback();
                
                // Dispatch an asset loaded event even on error so we don't hang the loading screen
                window.dispatchEvent(new CustomEvent('assetLoaded', { 
                    detail: { sound: name, error: true } 
                }));
            }
        });
        
        // Fallback in case the event doesn't fire
        setTimeout(() => {
            if (!callbackFired && callback) {
                callbackFired = true;
                callback();
                
                // Dispatch an asset loaded event for the fallback case
                window.dispatchEvent(new CustomEvent('assetLoaded', { 
                    detail: { sound: name, fallback: true } 
                }));
            }
        }, 3000);
        
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
