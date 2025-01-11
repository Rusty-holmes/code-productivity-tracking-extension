const vscode = require('vscode');
const simpleGit = require('simple-git');
const path = require('path');
const fs = require('fs');
const https = require('https');

let trackingInterval;
let statusBarItem;
let COMMIT_INTERVAL = 1 * 60 * 1000; // Will be updated from settings
let lastCommitTime;
let isTracking = false;
let sessionStart;
let globalState;
let username = '';
let REPO_NAME = 'code-tracking-stats'; // Will be updated from settings

function loadConfiguration() {
    const config = vscode.workspace.getConfiguration('codeTracking');
    // REPO_NAME = config.get('repositoryName', 'code-tracking-stats');
    COMMIT_INTERVAL = config.get('commitInterval', 60000); // 30 minutes default
    console.log(`Loaded configuration: Repository=${REPO_NAME}, Interval=${COMMIT_INTERVAL}ms`);
}

async function getUserInfo(token) {
    console.log('Fetching user info from GitHub...');
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.github.com',
            path: '/user',
            method: 'GET',
            headers: {
                'User-Agent': 'VS Code Extension',
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    const userInfo = JSON.parse(data);
                    console.log(`Successfully fetched user info for: ${userInfo.login}`);
                    resolve(userInfo);
                } else {
                    reject(new Error(`Failed to get user info: ${res.statusCode} ${data}`));
                }
            });
        });

        req.on('error', (error) => reject(error));
        req.end();
    });
}

async function createGitHubRepo(token) {
    console.log('Creating private repository for tracking...');
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({
            name: REPO_NAME,
            private: true,
            description: 'Private repository for tracking coding statistics'
        });

        const options = {
            hostname: 'api.github.com',
            path: '/user/repos',
            method: 'POST',
            headers: {
                'User-Agent': 'VS Code Extension',
                'Content-Type': 'application/json',
                'Accept': 'application/vnd.github.v3+json',
                'Authorization': `token ${token}`,
                'Content-Length': data.length
            }
        };

        const req = https.request(options, (res) => {
            let responseData = '';
            res.on('data', (chunk) => responseData += chunk);
            res.on('end', () => {
                if (res.statusCode === 201) {
                    console.log('Successfully created private repository');
                    resolve(JSON.parse(responseData));
                } else {
                    console.log(`Repository creation response: ${res.statusCode} ${responseData}`);
                    if (res.statusCode === 422 && responseData.includes('already exists')) {
                        console.log('Repository already exists, continuing...');
                        resolve({ name: REPO_NAME });
                    } else {
                        reject(new Error(`Failed to create repository: ${res.statusCode} ${responseData}`));
                    }
                }
            });
        });

        req.on('error', (error) => {
            console.error('Error creating repository:', error);
            reject(error);
        });

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
    console.log('Activating Code Productivity Tracking extension...');

    // Get the directory of the opened workspace or folder
    const workspaceDir = vscode.workspace.workspaceFolders 
        ? vscode.workspace.workspaceFolders[0].uri.fsPath 
        : null;
    
    if (workspaceDir) {
        console.log(`Workspace directory is: ${workspaceDir}`);
    } else {
        vscode.window.showErrorMessage("No workspace folder open.");
        return;
    }

    const git = simpleGit({ baseDir: workspaceDir }); // Set the correct directory for git operations


    globalState = context.globalState;
    const dataFile = path.join(context.globalStoragePath, 'coding-data.json');

    // Load configuration
    loadConfiguration();

    // Listen for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('codeTracking')) {
                console.log('Configuration changed, reloading settings...');
                loadConfiguration();
                vscode.window.showInformationMessage('Code Tracking settings updated. Changes will take effect on next commit.');
            }
        })
    );

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
                    password: true,
                    placeHolder: 'Token needs repo scope permissions'
                });

                if (!token) {
                    vscode.window.showErrorMessage('GitHub token is required to continue');
                    return;
                }

                // Store the token securely
                await globalState.update('githubToken', token);
            }

            // Get user info first
            const userInfo = await getUserInfo(token);
            username = userInfo.login;
            email = userInfo.email;
            console.log(`Starting tracking for GitHub user: ${username}`);

            // Create or ensure repository exists
            await createGitHubRepo(token);

            // Initialize tracking data
            let trackingData = {
                totalTime: 0,
                sessions: []
            };

            if (fs.existsSync(dataFile)) {
                console.log('Loading existing tracking data...');
                trackingData = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
            }

            // Configure git with remote if not already configured
            const remotes = await git.getRemotes();
            if (!remotes.find(remote => remote.name === 'origin')) {
                console.log('Configuring Git remote...');
                await git.addRemote('origin', `https://${username}:${token}@github.com/${username}/${REPO_NAME}.git`);
            }
            
            isTracking = true;
            sessionStart = new Date(globalState.get('sessionStart') || new Date());
            await globalState.update('sessionStart', sessionStart);
            console.log(`Started new coding session at: ${sessionStart.toISOString()}`);

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
                    console.log('Preparing to commit tracking data...');
                    // Calculate total session time including previous sessions
                    const sessionDuration = (currentTime - sessionStart) / 1000; // in seconds
                    trackingData.totalTime += sessionDuration;
                    trackingData.sessions.push({
                        date: currentTime.toISOString(),
                        duration: sessionDuration,
                        totalTime: trackingData.totalTime
                    });

                    // Save tracking data
                    console.log(`Saving tracking data: ${sessionDuration}s this session, ${trackingData.totalTime}s total`);
                    fs.writeFileSync(dataFile, JSON.stringify(trackingData, null, 2));

                    try {
                        await git.add('-A');
                        console.log('Changes staged');
                        await git.commit(`Update coding stats: ${currentTime.toISOString()}\nTotal coding time: ${Math.floor(trackingData.totalTime / 3600)} hours ${Math.floor((trackingData.totalTime % 3600) / 60)} minutes`);
                        console.log('Commit successful');
                        console.log('Pushing changes to GitHub...');
                        await git.push('origin', 'main');
                        console.log('Push successful');
                        lastCommitTime = currentTime;
                        await globalState.update('lastCommitTime', lastCommitTime.toISOString());
                        
                        // Reset session start time after successful commit
                        sessionStart = new Date();
                        await globalState.update('sessionStart', sessionStart);
                        console.log('Successfully committed and pushed tracking data');
                        
                        vscode.window.showInformationMessage(`Successfully committed coding stats! Total time: ${Math.floor(trackingData.totalTime / 3600)} hours ${Math.floor((trackingData.totalTime % 3600) / 60)} minutes`);
                    } catch (error) {
                        console.error('Failed to commit:', error);
                        vscode.window.showErrorMessage('Failed to commit: ' + error.message);
                    }
                }
            }, 60000); // Check every minute

            vscode.window.showInformationMessage('Started tracking coding time!');
        } catch (error) {
            console.error('Failed to start tracking:', error);
            vscode.window.showErrorMessage('Failed to start tracking: ' + error.message);
        }
    });

    let stopTracking = vscode.commands.registerCommand('code-tracking.stopTracking', async () => {
        if (!isTracking) {
            vscode.window.showInformationMessage('Code tracking is not running!');
            return;
        }

        try {
            console.log('Stopping code tracking...');
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

            console.log(`Final session duration: ${sessionDuration}s, Total time: ${trackingData.totalTime}s`);
            fs.writeFileSync(dataFile, JSON.stringify(trackingData, null, 2));

            const token = await globalState.get('githubToken');
            if (token) {
                try {
                    await git.add('.');
                    await git.commit(`Final update before stopping: ${currentTime.toISOString()}\nTotal coding time: ${Math.floor(trackingData.totalTime / 3600)} hours ${Math.floor((trackingData.totalTime % 3600) / 60)} minutes`);
                    console.log('Pushing final commit...');
                    await git.push('origin', 'main');
                } catch (error) {
                    console.error('Failed to commit final update:', error);
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
            
            console.log('Successfully stopped tracking');
            vscode.window.showInformationMessage(`Stopped code tracking. Total time coded: ${Math.floor(trackingData.totalTime / 3600)} hours ${Math.floor((trackingData.totalTime % 3600) / 60)} minutes`);
        } catch (error) {
            console.error('Failed to stop tracking:', error);
            vscode.window.showErrorMessage('Failed to stop tracking: ' + error.message);
        }
    });

    context.subscriptions.push(startTracking, stopTracking);
    console.log('Extension activated and ready to track coding time');
}

function deactivate() {
    if (trackingInterval) {
        clearInterval(trackingInterval);
    }
    if (statusBarItem) {
        statusBarItem.dispose();
    }
    isTracking = false;
    console.log('Extension deactivated');
}

module.exports = {
    activate,
    deactivate
};
