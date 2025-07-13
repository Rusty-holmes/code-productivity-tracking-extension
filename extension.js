
const vscode = require('vscode');
const simpleGit = require('simple-git');
const path = require('path');
const fs = require('fs');
const https = require('https');

let trackingInterval;
let statusBarItem;
let COMMIT_INTERVAL;
let lastCommitTime;
let isTracking = false;
let sessionStart;
let globalState;
let storagePath;
let username = '';
let REPO_NAME;

function loadConfiguration() {
    const config = vscode.workspace.getConfiguration('codeTracking');
    REPO_NAME = config.get('repositoryName', 'code-tracking-stats');
    COMMIT_INTERVAL = config.get('commitInterval', 1800000); // 30 minutes default
    console.log(`Loaded configuration: Repository=${REPO_NAME}, Interval=${COMMIT_INTERVAL}ms`);
}

async function getUserInfo(token) {
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
                if (res.statusCode === 200) resolve(JSON.parse(data));
                else reject(new Error(`GitHub API ${res.statusCode}: ${data}`));
            });
        });
        req.on('error', err => reject(err));
        req.end();
    });
}

async function createGitHubRepo(token) {
    const data = JSON.stringify({ name: REPO_NAME, private: true, description: 'Private repo for code tracking' });
    return new Promise((resolve, reject) => {
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
        const req = https.request(options, res => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => {
                if (res.statusCode === 201) return resolve(JSON.parse(body));
                if (res.statusCode === 422 && body.includes('already exists')) return resolve({ name: REPO_NAME });
                reject(new Error(`Repo creation failed ${res.statusCode}: ${body}`));
            });
        });
        req.on('error', err => reject(err));
        req.write(data);
        req.end();
    });
}

async function updateStatusBar() {
    if (!isTracking || !statusBarItem) return;
    const now = new Date();
    const diff = now - lastCommitTime;
    const remain = COMMIT_INTERVAL - diff;
    if (remain > 0) {
        const m = Math.floor(remain/60000), s = Math.floor((remain%60000)/1000);
        statusBarItem.text = `$(clock) Next commit in: ${m}m ${s}s`;
    } else {
        statusBarItem.text = `$(sync~spin) Committing...`;
    }
}



async function activate(context) {
    globalState = context.globalState;
    storagePath = context.globalStoragePath;

    // Ensure the directory exists before using it
    if (!fs.existsSync(storagePath)) {
        fs.mkdirSync(storagePath, { recursive: true });
    }

    const git = simpleGit(storagePath);
    const dataFile = path.join(storagePath, 'coding-data.json');


    loadConfiguration();
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('codeTracking')) {
                loadConfiguration();
                vscode.window.showInformationMessage('Code Tracking settings updated.');
            }
        })
    );

    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    context.subscriptions.push(statusBarItem);
    if (!fs.existsSync(storagePath)) fs.mkdirSync(storagePath, { recursive: true });

    const stored = globalState.get('lastCommitTime');
    lastCommitTime = stored ? new Date(stored) : new Date();

    const startCmd = vscode.commands.registerCommand('code-tracking.startTracking', async () => {
        if (isTracking) return vscode.window.showInformationMessage('Tracking already running.');
        let token = globalState.get('githubToken');
        if (!token) {
            token = await vscode.window.showInputBox({ prompt: 'GitHub token with repo scope', password: true });
            if (!token) return vscode.window.showErrorMessage('Token required.');
            await globalState.update('githubToken', token);
        }
        const userInfo = await getUserInfo(token);
        username = userInfo.login;
        await createGitHubRepo(token);

        // Initialize local git repo
        if (!fs.existsSync(path.join(storagePath, '.git'))) {
            await git.init();
        }
        // Setup remote with token
        const encoded = encodeURIComponent(token);
        const remotes = await git.getRemotes(true);
        const originExists = remotes.find(r => r.name === 'origin');

        if (!originExists) {
            await git.addRemote('origin', `https://${encoded}@github.com/${username}/${REPO_NAME}.git`);
            console.log('Added remote origin');
        } else {
            await git.remote(['set-url', 'origin', `https://${encoded}@github.com/${username}/${REPO_NAME}.git`]);
            console.log('Updated remote origin');
        }


        // Initial commit if none
        const log = await git.log().catch(() => ({ total: 0 }));
        if ((log.total || 0) === 0) {
            const initialData = { totalTime: 0, sessions: [] };
            fs.writeFileSync(dataFile, JSON.stringify(initialData, null, 2));
            await git.add(dataFile);
            await git.commit('Initial commit: setup tracking');
            await git.push('origin', 'main');
        }

        // Load or init trackingData
        let trackingData = fs.existsSync(dataFile)
            ? JSON.parse(fs.readFileSync(dataFile, 'utf8'))
            : { totalTime: 0, sessions: [] };

        isTracking = true;
        sessionStart = new Date();
        await globalState.update('sessionStart', sessionStart.toISOString());
        statusBarItem.show();
        updateStatusBar();
        context.subscriptions.push(setInterval(updateStatusBar, 1000));

        trackingInterval = setInterval(async () => {
            const now = new Date();
            if (now - lastCommitTime >= COMMIT_INTERVAL) {
                const sessSec = (now - sessionStart)/1000;
                trackingData.totalTime += sessSec;
                trackingData.sessions.push({ date: now.toISOString(), duration: sessSec, totalTime: trackingData.totalTime });
                fs.writeFileSync(dataFile, JSON.stringify(trackingData, null, 2));
                try {
                    await git.add(dataFile);
                    await git.commit(`Update coding stats: ${now.toISOString()}`);
                    await git.push('origin', 'main');
                    lastCommitTime = now;
                    await globalState.update('lastCommitTime', now.toISOString());
                    sessionStart = new Date();
                    await globalState.update('sessionStart', sessionStart.toISOString());
                    vscode.window.showInformationMessage(`Committed coding stats. Total: ${Math.floor(trackingData.totalTime/3600)}h`);
                } catch (e) {
                    vscode.window.showErrorMessage('Auto-commit failed: ' + e.message);
                }
            }
        }, 60000);

        vscode.window.showInformationMessage('Started code tracking.');
    });

    const stopLogic = async () => {
        if (!isTracking) return;
        clearInterval(trackingInterval);
        const now = new Date();
        const sessSec = (now - sessionStart)/1000;
        const dataFile = path.join(storagePath, 'coding-data.json');
        let trackingData = fs.existsSync(dataFile)
            ? JSON.parse(fs.readFileSync(dataFile, 'utf8'))
            : { totalTime: 0, sessions: [] };
        trackingData.totalTime += sessSec;
        trackingData.sessions.push({ date: now.toISOString(), duration: sessSec, totalTime: trackingData.totalTime, type: 'final' });
        fs.writeFileSync(dataFile, JSON.stringify(trackingData, null, 2));
        const token = globalState.get('githubToken');
        if (token) {
            const git = simpleGit(storagePath);
            const encoded = encodeURIComponent(token);
            const remotes = await git.getRemotes(true);
            const originExists = remotes.find(r => r.name === 'origin');

            if (!originExists) {
                await git.addRemote('origin', `https://${encoded}@github.com/${username}/${REPO_NAME}.git`);
                console.log('Added remote origin');
            } else {
                await git.remote(['set-url', 'origin', `https://${encoded}@github.com/${username}/${REPO_NAME}.git`]);
                console.log('Updated remote origin');
            }

            await git.add(dataFile);
            await git.commit(`Final update: ${now.toISOString()}`);
            await git.push('origin', 'main');
        }
        isTracking = false;
        statusBarItem.hide();
    };

    const stopCmd = vscode.commands.registerCommand('code-tracking.stopTracking', async () => {
        await stopLogic();
        vscode.window.showInformationMessage('Stopped code tracking.');
    });

    context.subscriptions.push(startCmd, stopCmd);
}

async function deactivate() {
    await stopLogic();
}

module.exports = {
    activate,
    deactivate: () => deactivate().catch(console.error)
};