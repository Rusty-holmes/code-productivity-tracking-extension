const vscode = require('vscode');
const simpleGit = require('simple-git');
const path = require('path');
const fs = require('fs');
const https = require('https');

let trackingInterval;
let statusBarItem;
const COMMIT_INTERVAL = 1 * 60 * 1000; // 30 minutes
let lastCommitTime;
let isTracking = false;
let sessionStart;
let globalState;

async function createGitHubRepo(token) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({
            name: 'code-tracking',
            description: 'Automatically tracks coding time and statistics',
            private: true  // Changed to private
        });

        const options = {
            hostname: 'api.github.com',
            path: '/user/repos',
            method: 'POST',
            headers: {
                'User-Agent': 'VS Code Extension',
                'Content-Type': 'application/json',
                'Authorization': `token ${token}`,
                'Content-Length': data.length
            }
        };

        const req = https.request(options, (res) => {
            let responseData = '';
            res.on('data', (chunk) => responseData += chunk);
            res.on('end', () => {
                if (res.statusCode === 201) {
                    resolve(JSON.parse(responseData));
                } else {
                    // If repo already exists, this is fine
                    if (res.statusCode === 422) {
                        resolve({ html_url: `https://github.com/Rusty-holmes/code-tracking` });
                    } else {
                        reject(new Error(`Failed to create repository: ${res.statusCode} ${responseData}`));
                    }
                }
            });
        });

        req.on('error', (error) => reject(error));
        req.write(data);
        req.end();
    });
}

async function updateStatusBar() {
    if (!isTracking || !statusBarItem) return;
    
    const currentTime = new Date();
    const timeDiff = currentTime - lastCommitTime;
    const remainingTime = COMMIT_INTERVAL - timeDiff;
    
    if (remainingTime > 0) {
        const minutes = Math.floor(remainingTime / 60000);
        const seconds = Math.floor((remainingTime % 60000) / 1000);
        statusBarItem.text = `$(clock) Next commit in: ${minutes}m ${seconds}s`;
        statusBarItem.tooltip = `Total coding time will be committed to GitHub in ${minutes} minutes and ${seconds} seconds`;
    } else {
        statusBarItem.text = `$(clock) Committing...`;
        statusBarItem.tooltip = 'Committing coding statistics to GitHub...';
    }
}

async function activate(context) {
    globalState = context.globalState;
    const git = simpleGit();
    const dataFile = path.join(context.globalStoragePath, 'coding-data.json');

    // Create status bar item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    context.subscriptions.push(statusBarItem);

    // Ensure the directory exists
    if (!fs.existsSync(context.globalStoragePath)) {
        fs.mkdirSync(context.globalStoragePath, { recursive: true });
    }

    // Load last commit time from global state
    lastCommitTime = new Date(globalState.get('lastCommitTime') || new Date());
    
    let startTracking = vscode.commands.registerCommand('code-tracking.startTracking', async () => {
        if (isTracking) {
            vscode.window.showInformationMessage('Code tracking is already running!');
            return;
        }

        try {
            // Get GitHub token from user or stored token
            let token = await globalState.get('githubToken');
            if (!token) {
                token = await vscode.window.showInputBox({
                    prompt: 'Please enter your GitHub personal access token',
                    password: true
                });

                if (!token) {
                    vscode.window.showErrorMessage('GitHub token is required to continue');
                    return;
                }

                // Store the token securely
                await globalState.update('githubToken', token);
            }

            // Create or ensure repository exists
            try {
                await createGitHubRepo(token);
            } catch (error) {
                if (!error.message.includes('422')) {  // 422 means repo exists
                    throw error;
                }
            }

            // Initialize tracking data
            let trackingData = {
                totalTime: 0,
                sessions: []
            };

            if (fs.existsSync(dataFile)) {
                trackingData = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
            }

            // Configure git with remote if not already configured
            const remotes = await git.getRemotes();
            if (!remotes.find(remote => remote.name === 'origin')) {
                await git.addRemote('origin', `https://Rusty-holmes:${token}@github.com/Rusty-holmes/code-tracking.git`);
            }

            isTracking = true;
            sessionStart = new Date(globalState.get('sessionStart') || new Date());
            await globalState.update('sessionStart', sessionStart);

            // Show status bar
            statusBarItem.show();
            updateStatusBar();

            // Start status bar update interval
            const statusUpdateInterval = setInterval(updateStatusBar, 1000);
            context.subscriptions.push({ dispose: () => clearInterval(statusUpdateInterval) });

            trackingInterval = setInterval(async () => {
                const currentTime = new Date();
                const timeDiff = currentTime - lastCommitTime;

                if (timeDiff >= COMMIT_INTERVAL) {
                    // Calculate total session time including previous sessions
                    const sessionDuration = (currentTime - sessionStart) / 1000; // in seconds
                    trackingData.totalTime += sessionDuration;
                    trackingData.sessions.push({
                        date: currentTime.toISOString(),
                        duration: sessionDuration,
                        totalTime: trackingData.totalTime
                    });

                    // Save tracking data
                    fs.writeFileSync(dataFile, JSON.stringify(trackingData, null, 2));

                    try {
                        await git.add('.');
                        await git.commit(`Update coding stats: ${currentTime.toISOString()}\nTotal coding time: ${Math.floor(trackingData.totalTime / 3600)} hours ${Math.floor((trackingData.totalTime % 3600) / 60)} minutes`);
                        await git.push('origin', 'main');
                        lastCommitTime = currentTime;
                        await globalState.update('lastCommitTime', lastCommitTime.toISOString());
                        
                        // Reset session start time after successful commit
                        sessionStart = new Date();
                        await globalState.update('sessionStart', sessionStart);
                        
                        vscode.window.showInformationMessage(`Successfully committed coding stats! Total time: ${Math.floor(trackingData.totalTime / 3600)} hours ${Math.floor((trackingData.totalTime % 3600) / 60)} minutes`);
                    } catch (error) {
                        vscode.window.showErrorMessage('Failed to commit: ' + error.message);
                    }
                }
            }, 60000); // Check every minute

            vscode.window.showInformationMessage('Started tracking coding time!');
        } catch (error) {
            vscode.window.showErrorMessage('Failed to start tracking: ' + error.message);
        }
    });

    let stopTracking = vscode.commands.registerCommand('code-tracking.stopTracking', async () => {
        if (!isTracking) {
            vscode.window.showInformationMessage('Code tracking is not running!');
            return;
        }

        try {
            // Perform final commit before stopping
            const currentTime = new Date();
            const sessionDuration = (currentTime - sessionStart) / 1000;
            
            let trackingData = {
                totalTime: 0,
                sessions: []
            };

            if (fs.existsSync(dataFile)) {
                trackingData = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
            }

            trackingData.totalTime += sessionDuration;
            trackingData.sessions.push({
                date: currentTime.toISOString(),
                duration: sessionDuration,
                totalTime: trackingData.totalTime,
                type: 'final'
            });

            fs.writeFileSync(dataFile, JSON.stringify(trackingData, null, 2));

            const token = await globalState.get('githubToken');
            if (token) {
                try {
                    await git.add('.');
                    await git.commit(`Final update before stopping: ${currentTime.toISOString()}\nTotal coding time: ${Math.floor(trackingData.totalTime / 3600)} hours ${Math.floor((trackingData.totalTime % 3600) / 60)} minutes`);
                    await git.push('origin', 'main');
                } catch (error) {
                    vscode.window.showErrorMessage('Failed to commit final update: ' + error.message);
                }
            }

            // Clear the interval and reset tracking state
            if (trackingInterval) {
                clearInterval(trackingInterval);
                trackingInterval = null;
            }
            isTracking = false;
            
            // Hide status bar
            statusBarItem.hide();
            
            vscode.window.showInformationMessage(`Stopped code tracking. Total time coded: ${Math.floor(trackingData.totalTime / 3600)} hours ${Math.floor((trackingData.totalTime % 3600) / 60)} minutes`);
        } catch (error) {
            vscode.window.showErrorMessage('Failed to stop tracking: ' + error.message);
        }
    });

    context.subscriptions.push(startTracking, stopTracking);
}

function deactivate() {
    if (trackingInterval) {
        clearInterval(trackingInterval);
    }
    if (statusBarItem) {
        statusBarItem.dispose();
    }
    isTracking = false;
}

module.exports = {
    activate,
    deactivate
};
