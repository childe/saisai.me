// 从 maze-gen/maze.html 原样复制的迷宫生成器（只在 class 前加了 export）。
// 不要单独修改：tests/maze-3d-core.test.mjs 会逐 seed 比对两边的生成结果。

export class SeededRandom {
    constructor(seed) {
        this.seed = seed || Date.now();
        this.current = this.seed;
    }
    
    // Linear Congruential Generator (LCG)
    next() {
        this.current = (this.current * 1664525 + 1013904223) % Math.pow(2, 32);
        return this.current / Math.pow(2, 32);
    }
    
    // Generate random integer between min (inclusive) and max (exclusive)
    nextInt(min, max) {
        return Math.floor(this.next() * (max - min)) + min;
    }
    
    // Generate random boolean
    nextBool() {
        return this.next() < 0.5;
    }
    
    // Shuffle array in place using Fisher-Yates algorithm
    shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = this.nextInt(0, i + 1);
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }
}

export class MazeGenerator {
    constructor(width, height, seed) {
        this.width = width;
        this.height = height;
        this.maze = [];
        this.connections = []; // Store connection info for each cell
        this.originalMainPath = []; // Store the original main path
        this.random = new SeededRandom(seed);
        this.seed = seed || this.random.seed;
    }

    generate() {
        // Initialize maze with all walls (1 = wall, 0 = path)
        this.maze = Array(this.height).fill().map(() => Array(this.width).fill(1));
        
        // Set entrance and exit as paths
        this.maze[0][0] = 0; // Entrance
        this.maze[this.height - 1][this.width - 1] = 0; // Exit
        
        // Set entrance adjacent cells as paths
        if (this.width > 1) this.maze[0][1] = 0; // Right of entrance
        if (this.height > 1) this.maze[1][0] = 0; // Below entrance
        
        // Set exit adjacent cells as paths  
        if (this.width > 1) this.maze[this.height - 1][this.width - 2] = 0; // Left of exit
        if (this.height > 1) this.maze[this.height - 2][this.width - 1] = 0; // Above exit
        
        // Initialize connections array - each cell has connections in 4 directions
        // connections[row][col] = {up: false, down: false, left: false, right: false}
        this.connections = Array(this.height).fill().map(() => 
            Array(this.width).fill().map(() => ({up: false, down: false, left: false, right: false}))
        );
        
        // Step 1: Create entrance and exit - they are walls with openings to outside
        // Entrance at top-left corner - opening on top and left edges
        this.connections[0][0].up = true; // Opening to outside (top edge)
        this.connections[0][0].left = true; // Opening to outside (left edge)
        
        // Exit at bottom-right corner - opening on bottom and right edges  
        this.connections[this.height - 1][this.width - 1].down = true; // Opening to outside (bottom edge)
        this.connections[this.height - 1][this.width - 1].right = true; // Opening to outside (right edge)
        
        // Step 2: Generate a random path from entrance to exit
        this.createRandomMainPath();
        
        // Step 3: For non-path cells, randomly open 1-2 directions
        this.randomlyOpenWallConnections();
        
        // Step 4: Eliminate redundant paths, keeping only the main path
        // TEMPORARILY DISABLED FOR DEBUGGING
        // this.eliminateRedundantPaths();
        
        return {maze: this.maze, connections: this.connections};
    }
    
    createRandomMainPath() {
        // Generate path data and create connections immediately
        const pathSteps = this.generatePathSteps();
        this.createConnections(pathSteps);
    }
    
    generatePathSteps() {
        // Start from a cell adjacent to entrance to a cell adjacent to exit
        let currentRow = 1;
        let currentCol = 1;
        const targetRow = this.height - 2;
        const targetCol = this.width - 2;
        
        // Track visited cells to prevent going back
        const visited = Array(this.height).fill().map(() => Array(this.width).fill(false));
        const pathSteps = [];
        
        // Clear starting point
        visited[currentRow][currentCol] = true;
        pathSteps.push([currentRow, currentCol]);
        
        // Pure random walk to exit without revisiting cells
        while (currentRow !== targetRow || currentCol !== targetCol) {
            // Get all possible valid directions (within bounds and not visited)
            const validDirections = [];
            const allDirections = [[-1, 0], [1, 0], [0, -1], [0, 1]]; // up, down, left, right
            
            for (const [dr, dc] of allDirections) {
                const newRow = currentRow + dr;
                const newCol = currentCol + dc;
                
                // Check if within bounds and not previously visited
                if (newRow > 0 && newRow < this.height - 1 && 
                    newCol > 0 && newCol < this.width - 1 && 
                    !visited[newRow][newCol]) {
                    validDirections.push([dr, dc]);
                }
            }
            
            // If we have valid directions, choose randomly
            if (validDirections.length > 0) {
                const [dr, dc] = validDirections[this.random.nextInt(0, validDirections.length)];
                currentRow += dr;
                currentCol += dc;
                visited[currentRow][currentCol] = true;
                pathSteps.push([currentRow, currentCol]);
            } else {
                // If no valid unvisited directions, we're stuck
                // This could happen with pure random walk - need backtracking or restart
                console.log("Stuck at", currentRow, currentCol, "- restarting path generation");
                
                // Restart the path generation
                currentRow = 1;
                currentCol = 1;
                visited.forEach(row => row.fill(false));
                pathSteps.length = 0; // Clear path steps
                
                visited[currentRow][currentCol] = true;
                pathSteps.push([currentRow, currentCol]);
            }
        }
        
        return pathSteps;
    }
    
    createConnections(pathSteps) {
        // Store the original main path including entrance and exit
        this.originalMainPath = [[0, 0], ...pathSteps, [this.height - 1, this.width - 1]];
        
        // Set all path cells to be paths in the maze
        for (const [row, col] of pathSteps) {
            this.maze[row][col] = 0;
        }
        
        // Create connections between adjacent cells in the path
        for (let stepIndex = 0; stepIndex < pathSteps.length; stepIndex++) {
            const [row, col] = pathSteps[stepIndex];
            
            // Set up connections for this step
            if (stepIndex > 0) {
                const [prevRow, prevCol] = pathSteps[stepIndex - 1];
                
                // Connect current cell to previous cell
                if (prevRow === row - 1) { // Previous is above
                    this.connections[row][col].up = true;
                    this.connections[prevRow][prevCol].down = true;
                } else if (prevRow === row + 1) { // Previous is below
                    this.connections[row][col].down = true;
                    this.connections[prevRow][prevCol].up = true;
                } else if (prevCol === col - 1) { // Previous is left
                    this.connections[row][col].left = true;
                    this.connections[prevRow][prevCol].right = true;
                } else if (prevCol === col + 1) { // Previous is right
                    this.connections[row][col].right = true;
                    this.connections[prevRow][prevCol].left = true;
                }
            }
            
            // Connect to entrance - if this is (1,1), connect to entrance at (0,0)
            if (row === 1 && col === 1) {
                // Direct connection from entrance (0,0) to (1,1)
                // Method 1: Connect via (0,1)
                this.connections[row][col].up = true; // (1,1) -> (0,1)
                this.connections[0][1].down = true; // (0,1) -> (1,1)
                this.connections[0][1].left = true; // (0,1) -> (0,0)
                this.connections[0][0].right = true; // (0,0) -> (0,1)
                
                // Method 2: Connect via (1,0)
                this.connections[row][col].left = true; // (1,1) -> (1,0)
                this.connections[1][0].right = true; // (1,0) -> (1,1)
                this.connections[1][0].up = true; // (1,0) -> (0,0)
                this.connections[0][0].down = true; // (0,0) -> (1,0)
            }
            
            // Connect to exit - if this is (height-2, width-2), connect to exit at (height-1, width-1)
            if (row === this.height - 2 && col === this.width - 2) {
                // Direct connection from (height-2, width-2) to exit (height-1, width-1)
                // Method 1: Connect via (height-1, width-2)
                this.connections[row][col].down = true; // (h-2,w-2) -> (h-1,w-2)
                this.connections[this.height - 1][col].up = true; // (h-1,w-2) -> (h-2,w-2)
                this.connections[this.height - 1][col].right = true; // (h-1,w-2) -> (h-1,w-1)
                this.connections[this.height - 1][this.width - 1].left = true; // (h-1,w-1) -> (h-1,w-2)
                
                // Method 2: Connect via (height-2, width-1)
                this.connections[row][col].right = true; // (h-2,w-2) -> (h-2,w-1)
                this.connections[row][this.width - 1].left = true; // (h-2,w-1) -> (h-2,w-2)
                this.connections[row][this.width - 1].down = true; // (h-2,w-1) -> (h-1,w-1)
                this.connections[this.height - 1][this.width - 1].up = true; // (h-1,w-1) -> (h-2,w-1)
            }
        }
        
        console.log("Path generation complete! Total steps:", pathSteps.length);
    }
    
    randomlyOpenWallConnections() {
        // For each internal cell that is a wall, randomly open 1-2 directions
        for (let row = 1; row < this.height - 1; row++) {
            for (let col = 1; col < this.width - 1; col++) {
                // Skip cells that are already part of main path
                if (this.maze[row][col] === 0) {
                    continue;
                }
                
                // This is a wall cell, randomly open 1 or 2 directions
                const directions = ['up', 'down', 'left', 'right'];
                
                // Randomly choose to open 1 or 2 directions (70% chance for 1, 30% chance for 2)
                const numDirections = this.random.next() < 0.7 ? 1 : 2;
                
                // Shuffle directions and pick the first numDirections
                const shuffledDirections = this.random.shuffle([...directions]);
                const selectedDirections = shuffledDirections.slice(0, numDirections);
                
                // Open the selected directions
                for (const direction of selectedDirections) {
                    this.connections[row][col][direction] = true;
                    
                    // Also open the corresponding direction in the adjacent cell if it exists
                    let adjRow = row;
                    let adjCol = col;
                    let adjDirection = '';
                    
                    if (direction === 'up') {
                        adjRow = row - 1;
                        adjDirection = 'down';
                    } else if (direction === 'down') {
                        adjRow = row + 1;
                        adjDirection = 'up';
                    } else if (direction === 'left') {
                        adjCol = col - 1;
                        adjDirection = 'right';
                    } else if (direction === 'right') {
                        adjCol = col + 1;
                        adjDirection = 'left';
                    }
                    
                    // Check bounds and open adjacent cell's corresponding direction
                    if (adjRow >= 0 && adjRow < this.height && 
                        adjCol >= 0 && adjCol < this.width) {
                        this.connections[adjRow][adjCol][adjDirection] = true;
                    }
                }
            }
        }
    }
    
    randomlyOpenDirections() {
        // For each internal cell, randomly decide whether to make it a path
        for (let row = 1; row < this.height - 1; row++) {
            for (let col = 1; col < this.width - 1; col++) {
                // Skip cells that are already part of main path
                if (this.maze[row][col] === 0) {
                    continue;
                }
                
                // Random chance to make this cell a path (40% chance)
                if (this.random.next() < 0.4) {
                    this.maze[row][col] = 0;
                }
            }
        }
    }
    
    // Find all paths from entrance to exit and seal redundant ones
    eliminateRedundantPaths() {
        // Use a much simpler approach: check if multiple paths exist and block strategically
        const mainPath = this.findMainPath();
        if (!mainPath || mainPath.length === 0) {
            console.log("No main path found");
            return;
        }
        
        console.log("Main path found with length:", mainPath.length);
        const mainPathCells = new Set(mainPath.map(([r, c]) => `${r},${c}`));
        
        // Simple strategy: block cells that create shortcuts around the main path
        let blockedCells = this.blockShortcutCells(mainPathCells);
        
        console.log(`Simple blocking completed - blocked ${blockedCells} cells`);
    }
    
    // Find the main path from entrance to exit using BFS (shortest path)
    findMainPath() {
        const height = this.height;
        const width = this.width;
        const start = [0, 0]; // Entrance
        const end = [height - 1, width - 1]; // Exit
        
        // BFS to find shortest path
        const queue = [start];
        const visited = Array(height).fill().map(() => Array(width).fill(false));
        const parent = Array(height).fill().map(() => Array(width).fill(null));
        
        visited[start[0]][start[1]] = true;
        const directions = [
            [-1, 0, 'up', 'down'],
            [1, 0, 'down', 'up'],
            [0, -1, 'left', 'right'],
            [0, 1, 'right', 'left']
        ];
        
        while (queue.length > 0) {
            const [currentRow, currentCol] = queue.shift();
            
            if (currentRow === end[0] && currentCol === end[1]) {
                break;
            }
            
            for (const [dr, dc, fromDir, toDir] of directions) {
                const newRow = currentRow + dr;
                const newCol = currentCol + dc;
                
                // Check bounds
                if (newRow < 0 || newRow >= height || newCol < 0 || newCol >= width) {
                    continue;
                }
                
                // Check if already visited
                if (visited[newRow][newCol]) {
                    continue;
                }
                
                // Check if connected
                if (this.connections[currentRow][currentCol][fromDir] && 
                    this.connections[newRow][newCol][toDir]) {
                    
                    visited[newRow][newCol] = true;
                    parent[newRow][newCol] = [currentRow, currentCol];
                    queue.push([newRow, newCol]);
                }
            }
        }
        
        // Reconstruct path
        const path = [];
        let current = end;
        
        while (current) {
            path.unshift(current);
            if (current[0] === start[0] && current[1] === start[1]) {
                break;
            }
            current = parent[current[0]][current[1]];
        }
        
        return path.length > 1 ? path : [];
    }
    
    // Seal alternative paths by removing connections that create shortcuts
    sealAlternativePaths(mainPathCells) {
        let sealedCount = 0;
        
        // Iterate through all cells and find those that create alternative connections
        for (let row = 0; row < this.height; row++) {
            for (let col = 0; col < this.width; col++) {
                // Skip cells that are part of main path
                if (mainPathCells.has(`${row},${col}`)) {
                    continue;
                }
                
                // Check if this cell has connections that bypass the main path
                if (this.hasAlternativeConnections(row, col, mainPathCells)) {
                    if (this.canSealCell(row, col, mainPathCells)) {
                        this.sealCell(row, col);
                        sealedCount++;
                    }
                }
            }
        }
        
        return sealedCount;
    }
    
    // Simple and efficient method to block shortcut cells
    blockShortcutCells(mainPathCells) {
        let blockedCount = 0;
        
        // Check each cell to see if it creates shortcuts
        for (let row = 1; row < this.height - 1; row++) {
            for (let col = 1; col < this.width - 1; col++) {
                // Skip main path cells
                if (mainPathCells.has(`${row},${col}`)) {
                    continue;
                }
                
                // Check if this cell is connected to main path from multiple sides
                if (this.isShortcutCell(row, col, mainPathCells)) {
                    this.sealCell(row, col);
                    blockedCount++;
                    console.log(`Blocked shortcut cell at (${row}, ${col})`);
                    
                    // Limit the number of cells we block to avoid over-blocking
                    if (blockedCount >= 20) {
                        break;
                    }
                }
            }
            if (blockedCount >= 20) {
                break;
            }
        }
        
        return blockedCount;
    }
    
    // Check if a cell creates shortcuts by connecting to main path from multiple directions
    isShortcutCell(row, col, mainPathCells) {
        // Don't seal cells that are too close to entrance or exit
        if ((row <= 2 && col <= 2) || 
            (row >= this.height - 3 && col >= this.width - 3)) {
            return false;
        }
        
        const directions = [
            [-1, 0, 'up'],
            [1, 0, 'down'],
            [0, -1, 'left'],
            [0, 1, 'right']
        ];
        
        let mainPathConnections = 0;
        let connectedMainPathCells = [];
        
        for (const [dr, dc, dir] of directions) {
            const adjRow = row + dr;
            const adjCol = col + dc;
            
            // Check bounds
            if (adjRow < 0 || adjRow >= this.height || adjCol < 0 || adjCol >= this.width) {
                continue;
            }
            
            // Check if connected to this adjacent cell and if adjacent cell is on main path
            if (this.connections[row][col][dir] && mainPathCells.has(`${adjRow},${adjCol}`)) {
                mainPathConnections++;
                connectedMainPathCells.push([adjRow, adjCol]);
            }
        }
        
        // If connected to main path from 2+ directions, check if they are far apart
        if (mainPathConnections >= 2) {
            // Make sure the connected main path cells are not adjacent to each other
            // (to avoid breaking critical path segments)
            for (let i = 0; i < connectedMainPathCells.length; i++) {
                for (let j = i + 1; j < connectedMainPathCells.length; j++) {
                    const [r1, c1] = connectedMainPathCells[i];
                    const [r2, c2] = connectedMainPathCells[j];
                    const distance = Math.abs(r1 - r2) + Math.abs(c1 - c2);
                    
                    // If connected main path cells are far apart, it's likely a shortcut
                    if (distance > 2) {
                        return true;
                    }
                }
            }
        }
        
        return false;
    }
    
    // Check if a cell can be safely sealed without breaking main path connectivity
    canSealCell(row, col, mainPathCells) {
        // Don't seal cells that are part of the main path
        if (mainPathCells.has(`${row},${col}`)) {
            return false;
        }
        
        // Don't seal entrance or exit
        if ((row === 0 && col === 0) || (row === this.height - 1 && col === this.width - 1)) {
            return false;
        }
        
        // Check if sealing this cell would isolate any important areas
        // For simplicity, we'll seal cells that are not critical junctions
        const connectionCount = Object.values(this.connections[row][col]).filter(Boolean).length;
        
        // If the cell has only 1 or 2 connections, it's likely safe to seal
        // Cells with 3+ connections are junctions and should be preserved
        return connectionCount <= 2;
    }
    
    // Seal a cell by removing all its connections
    sealCell(row, col) {
        // Remove all connections from this cell
        const directions = [
            [-1, 0, 'up', 'down'],
            [1, 0, 'down', 'up'],
            [0, -1, 'left', 'right'],
            [0, 1, 'right', 'left']
        ];
        
        for (const [dr, dc, fromDir, toDir] of directions) {
            const adjRow = row + dr;
            const adjCol = col + dc;
            
            // Remove connection from current cell
            this.connections[row][col][fromDir] = false;
            
            // Remove corresponding connection from adjacent cell if it exists
            if (adjRow >= 0 && adjRow < this.height && adjCol >= 0 && adjCol < this.width) {
                this.connections[adjRow][adjCol][toDir] = false;
            }
        }
        
        console.log(`Sealed cell at (${row}, ${col})`);
    }
}
