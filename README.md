# Pikado - Dart Tournament Management System

A web-based application for managing dart tournaments with real-time synchronization between admin and display modes.

## Features

- **Dual Mode System**: 
  - **Admin Mode** (`?mode=admin`): Full control with editable inputs
  - **Display Mode** (`?mode=display`): Read-only display for public viewing

- **Real-time Synchronization**: Changes in admin mode automatically update display mode without page reload
- **Debounced Input**: All inputs have 1-second debounce to prevent excessive updates
- **Automat Management**: Add/remove dart machines (automats) dynamically
- **Player Queue System**: Manage next players and waiting queue
- **History Tracking**: Complete log of all pair transfers
- **Sound Effects**: Plays sound when transferring pairs (place `sound.mp3` in `sounds/` folder)

## Setup

1. Place your sound file in the `sounds/` folder:
   - File name: `sound.mp3`
   - Supported formats: MP3, WAV, OGG

2. Open `index.html` in a web browser

## Usage

### Admin Mode
Access admin mode by adding `?mode=admin` to the URL:
```
index.html?mode=admin
```

**Features:**
- Edit main title
- Add/remove automats
- Enter player names in textareas
- Transfer pairs using "PRENESI PAR" button
- View and clear history

### Display Mode
Access display mode by adding `?mode=display` or using the default:
```
index.html?mode=display
```

**Features:**
- Read-only display of all information
- Automatic updates when admin makes changes
- Clean, presentation-ready interface

## File Structure

```
pikado/
├── index.html          # Main HTML file
├── script.js           # JavaScript logic
├── style.css           # Styling
├── sounds/             # Sound effects folder
│   ├── sound.mp3       # Transfer sound (add your file here)
│   └── README.md       # Sounds folder instructions
└── README.md           # This file
```

## How It Works

- **LocalStorage**: All data is stored in browser's localStorage
- **Cross-tab Communication**: Uses `storage` event for real-time updates between tabs
- **Polling Fallback**: Polls for changes every 100ms as backup for same-window updates
- **Debounce**: Input changes are saved 1 second after typing stops

## Browser Compatibility

Works in all modern browsers that support:
- LocalStorage API
- ES6 JavaScript features
- CSS Grid/Flexbox

## Notes

- Data persists in browser localStorage
- Multiple admin/display windows can be open simultaneously
- Sound will only play if `sounds/sound.mp3` file exists
