import { jest } from '@jest/globals';
const serverModule = require('../server');
const serverModule = require('../server');
const serverModule = require('../server');
const serverModule = require('../server');
const serverModule = require('../server');
const serverModule = require('../server');

// __tests__/server.test.js

// Mock WebSocket and its server
jest.mock('ws', () => {
    const mockClients = new Set();
    
    return {
        WebSocketServer: jest.fn(() => ({
            on: jest.fn((event, handler) => {
                if (event === 'connection') {
                    connectionHandler = handler;
                }
            }),
            clients: mockClients
        })),
        WebSocket: { OPEN: 1 }
    };
});

// Store the connection handler for testing
let connectionHandler;
let mockSocket;
let mockSendData;
let originalConsoleLog;

describe('Snake Game Server', () => {
    beforeEach(() => {
        // Reset modules to get a fresh server instance
        jest.resetModules();
        
        // Mock console.log to reduce test noise
        originalConsoleLog = console.log;
        console.log = jest.fn();
        
        // Clear mocks between tests
        mockSendData = [];
        
        // Create mock WebSocket object
        mockSocket = {
            on: jest.fn((event, handler) => {
                // Store handlers for testing
                if (event === 'message') mockMessageHandler = handler;
                if (event === 'close') mockCloseHandler = handler;
                if (event === 'pong') mockPongHandler = handler;
            }),
            send: jest.fn(data => mockSendData.push(JSON.parse(data))),
            ping: jest.fn(),
            terminate: jest.fn(),
            readyState: 1, // OPEN
            isAlive: true
        };
        
        // Import server after mocks are set up
        require('../server');
        
        // Simulate a connection if we have a handler
        if (connectionHandler) {
            connectionHandler(mockSocket);
        }
        
        // Mock Date.now and Math.random for deterministic tests
        jest.spyOn(Date, 'now').mockReturnValue(123456789);
        jest.spyOn(Math, 'random').mockReturnValue(0.5);
        
        // Mock setTimeout for testing delayed actions
        jest.useFakeTimers();
    });
    
    afterEach(() => {
        console.log = originalConsoleLog;
        jest.useRealTimers();
        jest.restoreAllMocks();
    });
    
    // Handler references to use in tests
    let mockMessageHandler;
    let mockCloseHandler;
    let mockPongHandler;
    
    test('should establish a WebSocket connection', () => {
        expect(connectionHandler).toBeDefined();
        expect(mockSocket.on).toHaveBeenCalledWith('message', expect.any(Function));
        expect(mockSocket.on).toHaveBeenCalledWith('close', expect.any(Function));
        expect(mockSocket.on).toHaveBeenCalledWith('pong', expect.any(Function));
    });

    test('should handle a new player connection', () => {
        // Trigger update message from client to create a player
        mockMessageHandler(JSON.stringify({
            type: 'update',
            id: 'player1',
            snake: [{ x: 100, y: 100 }],
            score: 0,
            level: 1
        }));
        
        // The server should have sent game state
        expect(mockSocket.send).toHaveBeenCalled();
        
        // Find the latest state message
        const stateMessage = mockSendData.find(data => data.type === 'state');
        expect(stateMessage).toBeDefined();
        expect(stateMessage.players).toHaveProperty('player1');
    });
    
    test('should handle food consumption', () => {
        // First set up a player
        mockMessageHandler(JSON.stringify({
            type: 'update',
            id: 'player1',
            snake: [{ x: 100, y: 100 }],
            score: 0,
            level: 1
        }));
        
        // Clear previous messages
        mockSendData = [];
        mockSocket.send.mockClear();
        
        // Directly modify the server's foods array via its module
        serverModule.foods = [{
            x: 105,
            y: 105,
            points: 10,
            color: '#FF5722',
            createdAt: Date.now(),
            lifetime: 30000
        }];
        
        // Send food eaten message
        mockMessageHandler(JSON.stringify({
            type: 'foodEaten',
            id: 'player1',
            foodIndex: 0
        }));
        
        // Should have broadcast updated game state
        expect(mockSocket.send).toHaveBeenCalled();
        
        // Food should be removed
        const stateMessage = mockSendData.find(data => data.type === 'state');
        expect(stateMessage).toBeDefined();
        expect(stateMessage.foods).toHaveLength(0);
    });
    
    test('should handle player collision and game over', () => {
        // Set up two players
        mockMessageHandler(JSON.stringify({
            type: 'update',
            id: 'player1',
            snake: [{ x: 100, y: 100 }],
            score: 0,
            level: 1
        }));
        
        mockMessageHandler(JSON.stringify({
            type: 'update',
            id: 'player2',
            snake: [{ x: 100, y: 101 }, { x: 100, y: 102 }],
            score: 0,
            level: 1
        }));
        
        // Clear previous messages
        mockSendData = [];
        mockSocket.send.mockClear();
        
        // Simulate player 1 colliding with player 2
        mockMessageHandler(JSON.stringify({
            type: 'update',
            id: 'player1',
            snake: [{ x: 100, y: 101 }], // Same position as player2's head
            score: 0,
            level: 1
        }));
        
        // Player 1 should be marked as dead
        const stateMessage = mockSendData.find(data => data.type === 'state');
        expect(stateMessage.players.player1.dead).toBe(true);
        
        // After the timeout, player 1 should be removed
        jest.advanceTimersByTime(500);
        
        mockSendData = [];
        mockSocket.send.mockClear();
        
        // Trigger another state update
        mockMessageHandler(JSON.stringify({
            type: 'update',
            id: 'player2',
            snake: [{ x: 100, y: 101 }],
            score: 0,
            level: 1
        }));
        
        // Check that player1 is gone
        const updatedStateMessage = mockSendData.find(data => data.type === 'state');
        expect(updatedStateMessage.players).not.toHaveProperty('player1');
    });

    test('should handle player disconnection', () => {
        // Set up a player
        mockMessageHandler(JSON.stringify({
            type: 'update',
            id: 'player1',
            snake: [{ x: 100, y: 100 }],
            score: 0,
            level: 1
        }));
        
        // Trigger disconnection
        mockCloseHandler();
        
        // Clear previous messages
        mockSendData = [];
        mockSocket.send.mockClear();
        
        // Simulate a state broadcast
        serverModule.broadcastGameState();
        
        // Player should be removed
        const stateMessage = mockSendData.find(data => data.type === 'state');
        expect(stateMessage.players).not.toHaveProperty('player1');
    });
    
    test('should apply rate limiting', () => {
        // Create a function to send many messages quickly
        const sendManyMessages = () => {
            for (let i = 0; i < 40; i++) {
                mockMessageHandler(JSON.stringify({
                    type: 'update',
                    id: `player${i}`,
                    snake: [{ x: 100, y: 100 }]
                }));
            }
        };
        
        // Send the messages
        sendManyMessages();
        
        // We should see no more than MESSAGE_RATE_LIMIT (30) players
        const stateMessage = mockSendData.find(data => data.type === 'state');
        expect(Object.keys(stateMessage.players).length).toBeLessThanOrEqual(30);
    });
    
    test('should create diagonal corridors correctly', () => {
        // Import server to access its functions and variables
        
        // Reset walls array
        serverModule.walls = [];
        
        // Add some test walls in a line
        for (let i = 0; i < 10; i++) {
            serverModule.walls.push({ x: 100 + i, y: 100 + i });
        }
        
        // Call diagonal corridor function (startX, startY, endX, endY)
        serverModule.createDiagonalCorridor(100, 100, 110, 110);
        
        // Walls should be cleared along the path
        for (let i = 0; i < 10; i++) {
            // Check that wall was removed
            expect(serverModule.walls).not.toContainEqual({ x: 100 + i, y: 100 + i });
        }
    });
    
    test('should handle power-up food', () => {
        // Set up a player
        mockMessageHandler(JSON.stringify({
            type: 'update',
            id: 'player1',
            snake: [{ x: 100, y: 100 }],
            score: 0,
            level: 1
        }));
        
        // Add a power-up food
        serverModule.foods = [{
            x: 105,
            y: 105,
            points: 5,
            color: '#00BCD4',
            powerUp: 'speed_boost',
            duration: 5000,
            createdAt: Date.now(),
            lifetime: 30000
        }];
        
        // Eat the power-up
        mockMessageHandler(JSON.stringify({
            type: 'foodEaten',
            id: 'player1',
            foodIndex: 0
        }));
        
        // Player should have the power-up
        const stateMessage = mockSendData.find(data => data.type === 'state');
        expect(stateMessage.players.player1.activePowerUp).toBeDefined();
        expect(stateMessage.players.player1.activePowerUp.type).toBe('speed_boost');
        
        // Advance time beyond power-up duration
        jest.advanceTimersByTime(6000);
        
        // Trigger cleanup interval
        const cleanupInterval = serverModule.cleanupPlayersInterval;
        if (cleanupInterval) {
            jest.runOnlyPendingTimers();
        }
        
        // Update player to trigger a state message
        mockMessageHandler(JSON.stringify({
            type: 'update',
            id: 'player1',
            snake: [{ x: 100, y: 100 }],
            score: 0,
            level: 1
        }));
        
        // Power-up should expire
        const updatedStateMessage = mockSendData[mockSendData.length - 1];
        expect(updatedStateMessage.players.player1.activePowerUp).toBeUndefined();
    });
    
    test('should handle food expiration', () => {
        // Create a food item with a short lifetime
        serverModule.foods = [{
            x: 105,
            y: 105,
            points: 10,
            color: '#FF5722',
            createdAt: Date.now() - 31000, // Already expired
            lifetime: 30000,
            countdown: 0
        }];
        
        // Trigger the update foods function
        serverModule.updateFoods();
        
        // Food should be removed
        expect(serverModule.foods).toHaveLength(0);
    });
    
    test('should generate valid food positions', () => {
        
        // Set up some walls and a player
        serverModule.walls = [
            { x: 50, y: 50 },
            { x: 51, y: 50 },
            { x: 52, y: 50 }
        ];
        
        serverModule.players = {
            player1: {
                snake: [{ x: 100, y: 100 }, { x: 101, y: 100 }]
            }
        };
        
        // Generate new food
        const food = serverModule.generateNewFood();
        
        // Food should not be on walls or snake
        expect(food.x).not.toBe(50);
        expect(food.x).not.toBe(51);
        expect(food.x).not.toBe(52);
        expect(food).not.toEqual(expect.objectContaining({ x: 100, y: 100 }));
        expect(food).not.toEqual(expect.objectContaining({ x: 101, y: 100 }));
        
        // Food should have required properties
        expect(food).toHaveProperty('x');
        expect(food).toHaveProperty('y');
        expect(food).toHaveProperty('points');
        expect(food).toHaveProperty('color');
        expect(food).toHaveProperty('createdAt');
        expect(food).toHaveProperty('lifetime');
    });
});import { jest } from '@jest/globals';
import { WebSocketServer } from 'ws';
import fs from 'fs/promises';
serverModule = require('../server.js');

// Test file for server.js
describe('Snake Game Server', () => {
    let mockServer;
    let mockClientSocket;
    let connectionHandler;
    let serverModule;
    
    // Mock functions and implementation
    beforeEach(() => {
        jest.resetModules();
        
        // Setup WebSocket mocks
        mockClientSocket = {
            on: jest.fn(),
            send: jest.fn(),
            ping: jest.fn(),
            terminate: jest.fn(),
            readyState: 1, // OPEN
            isAlive: true
        };
        
        mockServer = {
            on: jest.fn(),
            clients: new Set([mockClientSocket]),
        };
        
        // Mock WebSocketServer
        jest.mock('ws', () => {
            return {
                WebSocketServer: jest.fn(() => mockServer),
                WebSocket: { OPEN: 1 }
            };
        });
        
        // Import server after mocking
    });
    
    // Tests will go here
});