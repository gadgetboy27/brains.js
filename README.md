# 🌍 Location-Based AR with AR.js

A collection of location-based augmented reality demos using AR.js, A-Frame, and WebXR. This project demonstrates how to create AR experiences that overlay digital content on real-world locations using GPS coordinates.

## 🎯 What is Location-Based AR?

Location-based AR uses your device's GPS and sensors to place virtual objects at specific geographic coordinates. As you move around in the real world, the AR content appears anchored to real locations.

## ✨ Features

- 📍 **GPS-based AR experiences** - Virtual objects anchored to real-world coordinates
- 🧭 **3D Navigation Arrows** - Direction arrows pointing to destinations in AR
- 🗺️ **Foursquare Integration** - Automatically display nearby places of interest
- 🎨 **Multiple Demo Implementations** - Different approaches to location-based AR
- 📱 **Mobile-friendly** - Works on smartphones with GPS and camera access
- 🔧 **Easy Configuration** - Simple setup with config files
- 📏 **Distance Calculation** - Real-time distance to destinations

## 🚀 Quick Start

### Prerequisites

- A modern web browser with WebGL support
- HTTPS connection (required for camera and GPS access)
- GPS-enabled device (smartphone recommended)
- Foursquare API credentials (for place search features)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/gadgetboy27/brains.js.git
   cd brains.js
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure API keys**
   ```bash
   # Copy the example config file
   cp config.example.js config.js
   ```

   Edit `config.js` and add your API keys:
   - Get Foursquare API credentials at: https://foursquare.com/developers/
   - Get Google Maps API key at: https://console.cloud.google.com/

4. **Serve the files**

   You need to serve the files over HTTPS. You can use:

   ```bash
   # Using Python
   python -m http.server 8000

   # Using Node.js http-server
   npx http-server -p 8000

   # Using PHP
   php -S localhost:8000
   ```

5. **Access the demos**

   Open your browser and navigate to:
   - `http://localhost:8000/index.html` - Basic AR demo with red box
   - `http://localhost:8000/navigation.html` - **🧭 Navigation with 3D arrows** (NEW!)
   - `http://localhost:8000/index2.html` - Foursquare places with links (needs index10.html)
   - `http://localhost:8000/index3.html` - Foursquare places with images
   - `http://localhost:8000/index4.html` - Enhanced places demo
   - `http://localhost:8000/index5.html` - Text-based places demo
   - `http://localhost:8000/index6.html` - Basic box demo
   - `http://localhost:8000/google.html` - Google Maps integration

## 📁 Project Structure

```
brains.js/
├── index.html          # Basic location-based AR demo
├── index.js            # Simple box placement demo
├── navigation.html     # 🧭 Navigation demo with 3D arrows (NEW!)
├── navigation.js       # Navigation logic with distance calculation (NEW!)
├── index2.js           # Foursquare places with links
├── index3.html         # Places demo with images (NEW!)
├── index3.js           # Foursquare places with images
├── index4.html         # Enhanced places demo (NEW!)
├── index4.js           # Enhanced places with better error handling
├── index5.html         # Text-based places demo
├── index6.html         # Basic box demo
├── index10.html        # Places demo with 3D models
├── google.html         # Google Maps integration demo
├── google.js           # Google Maps API integration
├── config.js           # API configuration (not in git - create from example)
├── config.example.js   # Example configuration file
├── data.js             # Training data for brain.js
├── data.json           # JSON training data
├── assets/             # Images and 3D models
│   ├── map-marker.png  # Location marker icon
│   └── models/         # 3D model files
│       └── arrow-model.glb  # 3D arrow model for navigation
└── styles/             # CSS stylesheets
    └── style.css
```

## 🎮 Usage

### 🧭 Navigation Demo (navigation.html) - NEW!

The navigation demo displays 3D arrow models pointing to destinations. Perfect for wayfinding and navigation!

Features:
- **Animated 3D arrows** pointing to destinations
- **Distance calculation** showing how far each location is
- **Color-coded markers** for easy identification
- **Interactive** - tap arrows for more info
- **Smart fallback** - works with or without API

```javascript
// Automatically creates arrows for nearby places or static destinations
// Shows distance in real-time
// Works both with Foursquare API and static coordinates
```

**Best for:** Navigation, wayfinding, location-based games

### Basic Demo (index.html)

The basic demo places a red box near your current location when the page loads.

```javascript
// Creates a box 0.001 degrees north of your position
const entity = document.createElement('a-box');
entity.setAttribute('gps-new-entity-place', {
    latitude: yourLatitude + 0.001,
    longitude: yourLongitude
});
```

**Best for:** Testing GPS functionality, understanding AR.js basics

### Places Demo (index3.html, index4.html, index10.html)

These demos fetch nearby places from the Foursquare API and display them as AR markers.

Features:
- Automatic place detection within 300m radius
- Interactive place markers
- Click to view place information
- Real-time GPS tracking

### Google Maps Demo (google.html)

Integrates Google Maps with Street View for a different perspective on location-based content.

## 🔧 Configuration

Edit `config.js` to customize:

```javascript
const CONFIG = {
    foursquare: {
        clientId: 'YOUR_CLIENT_ID',
        clientSecret: 'YOUR_CLIENT_SECRET',
        version: '20300101'
    },
    ar: {
        searchRadius: 300,        // meters
        gpsMinDistance: 5,        // minimum distance to update
        positionMinAccuracy: 100  // GPS accuracy threshold
    }
};
```

## 📱 Mobile Usage Tips

1. **Allow Permissions**: Grant camera and location access when prompted
2. **Outdoor Use**: GPS works best outdoors with clear sky view
3. **Calibrate Compass**: Move your device in a figure-8 pattern to calibrate
4. **Be Patient**: Initial GPS lock can take 10-30 seconds
5. **HTTPS Required**: Camera access requires secure connection

## 🐛 Troubleshooting

### Camera not working
- Ensure you're using HTTPS
- Check browser permissions for camera access
- Try a different browser (Chrome/Firefox work best)

### GPS not accurate
- Move outdoors for better GPS signal
- Wait for GPS to acquire more satellites
- Enable "High Accuracy" location mode

### Places not loading
- Check your API keys in `config.js`
- Verify you have an internet connection
- Check browser console for error messages
- Foursquare API has rate limits - don't refresh too quickly

### CORS Errors
- The demos use `cors-anywhere.herokuapp.com` as a CORS proxy
- For production, set up your own CORS proxy or backend API

## 🛠️ Development

### Adding New Places

Edit `index3.js` to add static places:

```javascript
const PLACES = [
    {
        name: "Your Custom Location",
        location: {
            lat: 40.7128,
            lng: -74.0060
        }
    }
];
```

### Customizing AR Markers

Modify the marker appearance:

```javascript
icon.setAttribute('scale', '20, 20');  // Size
icon.setAttribute('src', 'your-icon.png');  // Custom icon
```

## 🔧 Recent Fixes & Improvements

### Bug Fixes
- ✅ **Fixed critical selector bug** in `index.js:20` - Missing closing bracket `]` in `querySelector('[gps-new-camera]')`
- ✅ **Fixed promise chain** in `index4.js` - Now properly returns venues from API call
- ✅ **Added config.js integration** - All HTML files now properly load configuration
- ✅ **Fixed typos**:
  - `lonitude` → `longitude` in `index.js:19`
  - `nort` → `north` in comment
  - Duplicate `latitude` → `longitude` in `index.html:15`
  - `antialise` → `antialias` in `index.html:13`

### New Features
- 🎉 **Navigation Demo** - Brand new `navigation.html` with 3D direction arrows
- 🎉 **Distance Calculation** - Real-time distance to all destinations
- 🎉 **Better Error Handling** - Clear error messages and fallbacks
- 🎉 **HTML Files** - Created missing `index3.html` and `index4.html`
- 🎉 **Improved Documentation** - Enhanced code comments and JSDoc

### Security Improvements
- 🔒 **Removed hardcoded API keys** - Now use `config.js` (gitignored)
- 🔒 **Removed sensitive data** - Cryptocurrency seed phrases removed from `data.js`
- 🔒 **Added .gitignore** - Protects sensitive configuration files

## 📚 Resources

- [AR.js Documentation](https://ar-js-org.github.io/AR.js-Docs/)
- [A-Frame Documentation](https://aframe.io/docs/)
- [Foursquare Places API](https://developer.foursquare.com/docs/places-api-overview)
- [WebXR Device API](https://developer.mozilla.org/en-US/docs/Web/API/WebXR_Device_API)

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the ISC License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [AR.js](https://github.com/AR-js-org/AR.js) - Efficient Augmented Reality for the web
- [A-Frame](https://aframe.io/) - Web framework for building VR experiences
- [Foursquare](https://foursquare.com/) - Location data platform

## 🔗 Links

- **Live Demo**: https://gadgetboy27.github.io/brains.js
- **Repository**: https://github.com/gadgetboy27/brains.js
- **Issues**: https://github.com/gadgetboy27/brains.js/issues

## ⚠️ Important Notes

- **Browser Compatibility**: Works best on Chrome and Firefox mobile browsers
- **HTTPS Required**: Modern browsers require HTTPS for camera/GPS access
- **Rate Limits**: Be mindful of Foursquare API rate limits
- **Battery Usage**: AR experiences can drain battery quickly
- **Data Usage**: Fetching places and maps uses mobile data

---

Made with ❤️ for the AR community
