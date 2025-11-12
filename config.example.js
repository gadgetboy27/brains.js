// Configuration file for API keys and settings
// INSTRUCTIONS:
// 1. Copy this file to 'config.js'
// 2. Replace the placeholder values with your actual API keys
// 3. Never commit config.js to version control!

const CONFIG = {
    // Foursquare API credentials
    // Get your API keys at: https://foursquare.com/developers/
    foursquare: {
        clientId: 'YOUR_FOURSQUARE_CLIENT_ID_HERE',
        clientSecret: 'YOUR_FOURSQUARE_CLIENT_SECRET_HERE',
        version: '20300101'
    },

    // Google Maps API key
    // Get your API key at: https://console.cloud.google.com/
    google: {
        mapsApiKey: 'YOUR_GOOGLE_MAPS_API_KEY_HERE'
    },

    // AR.js settings
    ar: {
        searchRadius: 300, // Search radius in meters for nearby places
        gpsMinDistance: 5, // Minimum GPS distance before updating position
        positionMinAccuracy: 100 // Minimum accuracy for GPS position
    }
};

// Make config available globally
window.CONFIG = CONFIG;
