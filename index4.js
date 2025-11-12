/**
 * Foursquare Places AR Demo (Alternative implementation)
 *
 * This demo fetches nearby places from the Foursquare API and displays them as
 * interactive links. This is an alternative implementation with improved error handling.
 *
 * Features:
 * - Fetches places within configurable radius
 * - Displays place names as clickable links
 * - Better error handling and logging
 *
 * Requirements:
 * - Foursquare API credentials in config.js
 * - GPS-enabled device
 * - Camera and location permissions
 */

/**
 * Fetches nearby places from Foursquare API
 *
 * @param {Object} position - GPS coordinates with latitude and longitude
 * @returns {Promise<Array>} Promise resolving to array of venue objects
 */
function loadPlaces(position) {
    // Load configuration from config.js
    if (!window.CONFIG) {
        console.error('Config not loaded! Make sure config.js is included before this script.');
        return Promise.reject(new Error('Config not loaded'));
    }

    const params = {
        radius: window.CONFIG.ar.searchRadius,
        clientId: window.CONFIG.foursquare.clientId,
        clientSecret: window.CONFIG.foursquare.clientSecret,
        version: window.CONFIG.foursquare.version,
    };

    // CORS Proxy to avoid CORS problems
    const corsProxy = 'https://cors-anywhere.herokuapp.com/';

    // Foursquare API (limit param: number of maximum places to fetch)
    const endpoint = `${corsProxy}https://api.foursquare.com/v2/venues/search?intent=checkin
        &ll=${position.latitude},${position.longitude}
        &radius=${params.radius}
        &client_id=${params.clientId}
        &client_secret=${params.clientSecret}
        &limit=30
        &v=${params.version}`;

    return fetch(endpoint)
        .then((res) => {
            if (!res.ok) {
                throw new Error(`HTTP error! status: ${res.status}`);
            }
            return res.json();
        })
        .then((resp) => {
            console.log('Found venues:', resp.response.venues);
            return resp.response.venues; // FIXED: Actually return the venues
        })
        .catch((err) => {
            console.error('Error with places API', err);
            return []; // Return empty array on error
        });
}

// Initialize AR experience when page loads
window.onload = () => {
    const scene = document.querySelector('a-scene');

    if (!scene) {
        console.error('No a-scene element found!');
        return;
    }

    // First get current user location
    navigator.geolocation.getCurrentPosition(
        function (position) {
            console.log('GPS position acquired:', position.coords);

            // Then use it to load nearby places from remote API
            loadPlaces(position.coords)
                .then((places) => {
                    if (!places || places.length === 0) {
                        console.warn('No places found nearby');
                        alert('No places found nearby. Try moving to a different location.');
                        return;
                    }

                    console.log(`Loading ${places.length} places into AR scene`);

                    places.forEach((place) => {
                        const latitude = place.location.lat;
                        const longitude = place.location.lng;

                        // Add place name as a link
                        const placeText = document.createElement('a-link');
                        placeText.setAttribute('gps-new-entity-place', `latitude: ${latitude}; longitude: ${longitude};`);
                        placeText.setAttribute('title', place.name);
                        placeText.setAttribute('scale', '15 15 15');

                        placeText.addEventListener('loaded', () => {
                            window.dispatchEvent(new CustomEvent('gps-new-entity-place-loaded'));
                        });

                        scene.appendChild(placeText);
                    });
                })
                .catch((err) => {
                    console.error('Error loading places:', err);
                    alert('Failed to load nearby places. Check console for details.');
                });
        },
        (err) => {
            console.error('Error in retrieving position', err);
            alert('Unable to get your location. Please enable GPS and location permissions.');
        },
        {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 27000,
        }
    );
};
