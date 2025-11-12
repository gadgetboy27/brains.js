/**
 * Navigation AR Demo with 3D Direction Arrows
 *
 * This demo displays 3D arrow models pointing to specific GPS locations,
 * helping you navigate to places in AR. Arrows appear anchored to real-world
 * locations and can be used for wayfinding.
 *
 * Features:
 * - 3D arrow models at GPS coordinates
 * - Animated arrows for better visibility
 * - Distance indicators
 * - Option to use static locations or fetch from API
 * - Arrows automatically face the user
 *
 * Requirements:
 * - GPS-enabled device
 * - Camera and location permissions
 * - HTTPS connection
 * - Optional: Foursquare API for dynamic places
 */

/**
 * Calculate distance between two GPS coordinates using Haversine formula
 *
 * @param {number} lat1 - Latitude of first point
 * @param {number} lon1 - Longitude of first point
 * @param {number} lat2 - Latitude of second point
 * @param {number} lon2 - Longitude of second point
 * @returns {number} Distance in meters
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
}

/**
 * Fetches nearby places from Foursquare API
 *
 * @param {Object} position - GPS coordinates
 * @returns {Promise<Array>} Array of places
 */
async function loadPlacesFromAPI(position) {
    if (!window.CONFIG) {
        console.warn('Config not loaded, using static places');
        return null;
    }

    const params = {
        radius: window.CONFIG.ar.searchRadius,
        clientId: window.CONFIG.foursquare.clientId,
        clientSecret: window.CONFIG.foursquare.clientSecret,
        version: window.CONFIG.foursquare.version,
    };

    const corsProxy = 'https://cors-anywhere.herokuapp.com/';
    const url = `${corsProxy}https://api.foursquare.com/v2/venues/search?intent=checkin
        &ll=${position.latitude},${position.longitude}
        &radius=${params.radius}
        &client_id=${params.clientId}
        &client_secret=${params.clientSecret}
        &limit=10
        &v=${params.version}`;

    try {
        const res = await fetch(url);
        const resp = await res.json();
        return resp.response.venues;
    } catch (err) {
        console.error('Error fetching places from API:', err);
        return null;
    }
}

/**
 * Get navigation destinations
 * Uses API if available, otherwise falls back to static destinations
 *
 * @param {Object} userPosition - User's current GPS coordinates
 * @returns {Promise<Array>} Array of destination objects
 */
async function getDestinations(userPosition) {
    // Try to load from API first
    const apiPlaces = await loadPlacesFromAPI(userPosition);

    if (apiPlaces && apiPlaces.length > 0) {
        console.log(`Loaded ${apiPlaces.length} places from API`);
        return apiPlaces.slice(0, 5).map(place => ({
            name: place.name,
            latitude: place.location.lat,
            longitude: place.location.lng
        }));
    }

    // Fallback to static destinations
    console.log('Using static destinations');
    return [
        {
            name: "North Point (100m)",
            latitude: userPosition.latitude + 0.0009, // ~100m north
            longitude: userPosition.longitude
        },
        {
            name: "East Point (100m)",
            latitude: userPosition.latitude,
            longitude: userPosition.longitude + 0.0009 // ~100m east
        },
        {
            name: "South Point (100m)",
            latitude: userPosition.latitude - 0.0009, // ~100m south
            longitude: userPosition.longitude
        },
        {
            name: "West Point (100m)",
            latitude: userPosition.latitude,
            longitude: userPosition.longitude - 0.0009 // ~100m west
        },
        {
            name: "Northeast Point (150m)",
            latitude: userPosition.latitude + 0.00135,
            longitude: userPosition.longitude + 0.00135
        }
    ];
}

/**
 * Creates a navigation arrow entity at a specific location
 *
 * @param {Object} destination - Destination object with name, latitude, longitude
 * @param {Object} userPosition - User's current position for distance calculation
 * @param {number} index - Index for color variation
 * @returns {HTMLElement} A-Frame entity element
 */
function createNavigationArrow(destination, userPosition, index) {
    // Calculate distance to destination
    const distance = calculateDistance(
        userPosition.latitude,
        userPosition.longitude,
        destination.latitude,
        destination.longitude
    );

    // Create container entity
    const container = document.createElement('a-entity');
    container.setAttribute('gps-entity-place', `latitude: ${destination.latitude}; longitude: ${destination.longitude}`);

    // Color variation based on index
    const colors = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF'];
    const color = colors[index % colors.length];

    // Create arrow using A-Frame cone primitive (pointing up by default)
    const arrow = document.createElement('a-cone');
    arrow.setAttribute('color', color);
    arrow.setAttribute('scale', '3 8 3'); // Tall and thin arrow shape
    arrow.setAttribute('position', '0 4 0'); // Elevate it
    arrow.setAttribute('rotation', '0 0 0'); // Point upward
    arrow.setAttribute('animation', 'property: position; to: 0 6 0; dir: alternate; dur: 1000; loop: true; easing: easeInOutSine');

    // Create base cylinder
    const base = document.createElement('a-cylinder');
    base.setAttribute('color', color);
    base.setAttribute('height', '2');
    base.setAttribute('radius', '1.5');
    base.setAttribute('position', '0 1 0');

    // Create text label with place name and distance
    const label = document.createElement('a-text');
    label.setAttribute('value', `${destination.name}\n${Math.round(distance)}m`);
    label.setAttribute('align', 'center');
    label.setAttribute('color', '#FFFFFF');
    label.setAttribute('width', '20');
    label.setAttribute('position', '0 10 0');
    label.setAttribute('look-at', '[gps-camera]'); // Always face the camera

    // Add click interaction
    container.setAttribute('class', 'clickable');
    container.addEventListener('click', () => {
        alert(`${destination.name}\nDistance: ${Math.round(distance)} meters\nLat: ${destination.latitude.toFixed(6)}\nLon: ${destination.longitude.toFixed(6)}`);
    });

    // Assemble the arrow entity
    container.appendChild(arrow);
    container.appendChild(base);
    container.appendChild(label);

    // Notify AR.js when loaded
    container.addEventListener('loaded', () => {
        window.dispatchEvent(new CustomEvent('gps-entity-place-loaded'));
        console.log(`Arrow loaded for: ${destination.name}`);
    });

    return container;
}

// Initialize navigation AR when page loads
window.onload = async () => {
    console.log('Initializing Navigation AR...');

    const scene = document.querySelector('a-scene');
    if (!scene) {
        console.error('No a-scene found!');
        alert('AR scene not found. Please check your HTML.');
        return;
    }

    // Get user's current GPS position
    navigator.geolocation.getCurrentPosition(
        async function (position) {
            console.log('GPS position acquired:', position.coords);

            const userPosition = {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude
            };

            // Get destinations (from API or static)
            const destinations = await getDestinations(userPosition);

            if (!destinations || destinations.length === 0) {
                console.error('No destinations available');
                alert('No destinations found. Check your internet connection or API configuration.');
                return;
            }

            console.log(`Creating navigation arrows for ${destinations.length} destinations`);

            // Create arrow for each destination
            destinations.forEach((destination, index) => {
                const arrow = createNavigationArrow(destination, userPosition, index);
                scene.appendChild(arrow);
            });

            // Show success message
            alert(`Navigation AR initialized!\n${destinations.length} destinations loaded.\n\nLook around to see direction arrows pointing to nearby locations.`);
        },
        (err) => {
            console.error('Error getting GPS position:', err);
            alert('Unable to get your location.\n\nPlease:\n1. Enable GPS/Location Services\n2. Grant location permission to this page\n3. Ensure you are outdoors for best GPS signal');
        },
        {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 27000,
        }
    );
};
