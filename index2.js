/**
 * Foursquare Places AR Demo
 *
 * This demo fetches nearby places from the Foursquare API and displays them as
 * interactive AR links in your camera view. Places are loaded based on your GPS
 * location and appear anchored to their real-world positions.
 *
 * Features:
 * - Fetches places within configurable radius (default: 300m)
 * - Displays place names as clickable AR links
 * - Real-time GPS position tracking
 *
 * Requirements:
 * - Foursquare API credentials in config.js
 * - GPS-enabled device
 * - Camera and location permissions
 * - HTTPS connection
 */

/**
 * Fetches nearby places from the Foursquare API
 *
 * @param {Object} position - GPS coordinates with latitude and longitude
 * @returns {Promise<Array>} Array of venue objects from Foursquare
 */
async function loadPlaces(position) {
    // Load configuration from config.js
    if (!window.CONFIG) {
        console.error('Config not loaded! Make sure config.js is included before this script.');
        return [];
    }

    const params = {
        radius: window.CONFIG.ar.searchRadius,
        clientId: window.CONFIG.foursquare.clientId,
        clientSecret: window.CONFIG.foursquare.clientSecret,
        version: window.CONFIG.foursquare.version,
        method: 'GET',
        headers: {
            accept: 'application/json',
            Authorization: 'fsq3G3x+p/7LzoDS8jxsrhOegdXrYM8uBuDL1bBauE75NfU='
        }
    };

    // CORS proxy to avoid CORS issues when calling Foursquare API from browser
    // For production, replace with your own backend API
    const corsProxy = 'https://cors-anywhere.herokuapp.com/';

    // Build the Foursquare API endpoint URL
    const url = `${corsProxy}https://api.foursquare.com/v2/venues/search?intent=checkin
        &ll=${position.latitude},${position.longitude}
        &radius=${params.radius}
        &client_id=${params.clientId}
        &client_secret=${params.clientSecret}
        &limit=30
        &v=${params.version}`;

    try {
        const res = await fetch(url);
        const resp = await res.json();
        return resp.response.venues;
    } catch (err) {
        console.error('Error with places API', err);
        return [];
    }
}

// Initialize the AR experience when page loads
window.onload = () => {
    const scene = document.querySelector('a-scene');

    // Get current user's GPS location
    navigator.geolocation.getCurrentPosition(
        async function (position) {
            console.log('GPS position acquired:', position.coords);

            // Fetch nearby places based on current location
            const places = await loadPlaces(position.coords);

            if (!places || places.length === 0) {
                console.warn('No places found nearby');
                return;
            }

            console.log(`Found ${places.length} places nearby`);

            // Create an AR entity for each place
            places.forEach((place) => {
                const latitude = place.location.lat;
                const longitude = place.location.lng;

                // Create an interactive link element for the place
                const placeText = document.createElement('a-link');

                // Position the link at the place's GPS coordinates
                placeText.setAttribute('gps-new-entity-place', `latitude: ${latitude}; longitude: ${longitude};`);

                // Set the place name as the link title
                placeText.setAttribute('title', place.name);

                // Scale up the link so it's visible from a distance
                placeText.setAttribute('scale', '15 15 15');

                // Notify AR.js when the entity is loaded
                placeText.addEventListener('loaded', () => {
                    window.dispatchEvent(new CustomEvent('gps--new-entity-place-loaded'));
                });

                // Add the place to the AR scene
                scene.appendChild(placeText);
            });
        },
        (err) => {
            console.error('Error in retrieving position', err);
            alert('Unable to get your location. Please enable GPS and location permissions.');
        },
        {
            enableHighAccuracy: true,  // Request high accuracy GPS
            maximumAge: 0,             // Don't use cached position
            timeout: 27000,            // Wait up to 27 seconds for GPS lock
        }
    );
};
