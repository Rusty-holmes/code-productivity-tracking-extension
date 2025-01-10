# Code Productivity Tracking

A VS Code extension that helps you track your coding time and productivity by automatically committing statistics to a private GitHub repository.

## Features

- **Automatic Time Tracking**: Tracks your active coding time in VS Code
- **Detailed Statistics**: Records session durations and total coding time
- **Private Repository**: Stores your coding statistics in your own private GitHub repository
- **Configurable Commits**: Automatically commits your statistics at customizable intervals
- **Progress Monitoring**: View your coding time directly in the VS Code status bar

## Installation

1. Install the extension from the VS Code Marketplace
2. Create a GitHub Personal Access Token:
   - Go to [GitHub Settings > Developer Settings > Personal Access Tokens > Tokens (classic)](https://github.com/settings/tokens)
   - Click "Generate new token (classic)"
   - Give it a descriptive name (e.g., "VS Code Coding Tracker")
   - Select the following scopes:
     - `repo` (Full control of private repositories)
   - Copy the generated token (you won't be able to see it again!)

## Setup

1. Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac)
2. Type "Start Code Tracking" and press Enter
3. When prompted, paste your GitHub Personal Access Token
4. The extension will:
   - Create a private repository (default name: `code-tracking-stats`)
   - Start tracking your coding time
   - Show a countdown timer in the status bar for the next commit

## Configuration

You can customize the extension's behavior in VS Code settings:

1. Open VS Code Settings (`Ctrl+,` or `Cmd+,`)
2. Search for "Code Productivity Tracking"
3. Available settings:
   - `codeTracking.repositoryName`: Name of your private statistics repository (default: "code-tracking-stats")
   - `codeTracking.commitInterval`: Time between commits in milliseconds (default: 1800000 - 30 minutes)

## Usage

### Start Tracking
1. `Ctrl+Shift+P` / `Cmd+Shift+P`
2. Type "Start Code Tracking"
3. Watch your coding time in the status bar!

### Stop Tracking
1. `Ctrl+Shift+P` / `Cmd+Shift+P`
2. Type "Stop Code Tracking"
3. A final commit will be made with your session statistics

## Understanding Your Statistics

The extension creates a JSON file in your private repository containing:
```json
{
  "totalTime": 3600,  // Total coding time in seconds
  "sessions": [
    {
      "date": "2025-01-10T12:00:00.000Z",  // Session timestamp
      "duration": 1800,                     // Session duration in seconds
      "totalTime": 1800                     // Cumulative total at this point
    },
    // ... more sessions ...
  ]
}
```

## Privacy

- All statistics are stored in your private GitHub repository
- Your GitHub token is stored securely in VS Code's global state
- No data is sent to any third-party servers

## Contributing

Found a bug or have a feature request? Please open an issue on the [GitHub repository](https://github.com/Rusty-holmes/code-productivity-tracking-extension).

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

If you find this extension helpful, please consider:
- Starring the repository
- Sharing it with others
- Reporting any issues you find
