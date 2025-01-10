# Code Tracking Extension

A VS Code extension that tracks your coding time and automatically commits the statistics to a GitHub repository every 30 minutes.

## Features

- Tracks active coding time in VS Code
- Automatically commits tracking data to GitHub repository every 30 minutes
- Maintains a JSON file with detailed coding session information

## Requirements

- Git must be installed and configured
- GitHub repository must be set up and authenticated
- Node.js and npm must be installed

## Installation

1. Clone this repository
2. Run `npm install` to install dependencies
3. Press F5 to run the extension in debug mode

## Usage

1. Open the command palette (Ctrl+Shift+P)
2. Type "Start Code Tracking" and select the command
3. The extension will begin tracking your coding time
4. Every 30 minutes, it will automatically commit your coding stats to the GitHub repository

## Extension Settings

This extension doesn't require any additional settings.

## Known Issues

- The extension requires an active GitHub repository connection
- Make sure you have proper Git credentials configured

## Release Notes

### 0.0.1

Initial release of code-tracking extension
